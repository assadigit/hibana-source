// e2e/alpine-hard-load.spec.ts — regression net for the 2026-09-12 P0: Alpine components
// dead on hard load. The inline-script extraction (317724e) moved page scripts that
// register Alpine.data components to the END of <body> with defer — after alpine.min.js
// had already walked the tree (defer order = document order). Reports lost Snapshot/
// heatmap/chart; settings lost ALL interactivity (~80 expression errors). The soft-nav
// twin: Alpine's own MutationObserver auto-initialized the swapped shell before nav.js
// finished loading the page script. Both fixed (script order + observer pause) — this
// spec pins them. Run: npx playwright test e2e/alpine-hard-load.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const TEST_EMAIL = 'e2e-alp@test.local'
const TEST_PASS = 'e2e-password-123'

// Same seeding pattern as notebook.spec.ts (PBKDF2 hash + direct row insert).
test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-alp', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see viewport.spec.ts for the full write-up): the login
  // page's SW registration activates + claims /app → boot.js reloads it once — that
  // reload can supersede the very next navigation (observed here: a soft-nav to
  // /settings.html being dragged back to /app as navType "reload"). Settle first.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// THE signal of this bug class: Alpine logs expression failures as console *warnings*
// ("Alpine Expression Error: prefs is not defined") — invisible to error-only trackers,
// which is exactly how two review rounds missed the dead pages.
function trackAlpineWarnings(page: Page): string[] {
  const warnings: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && /Alpine Expression Error/.test(msg.text())) {
      warnings.push(msg.text())
    }
  })
  return warnings
}

// 401s from /api/auth/me before login + the SW navigation probe are expected.
const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })
  return errors
}

test('reports page: hard load registers the report component (Snapshot + heatmap + chart)', async ({ page }) => {
  const alpine = trackAlpineWarnings(page)
  const errors = trackErrors(page)
  await login(page)
  await page.goto('/reports.html')
  await expect(page.locator('#report-body')).toBeVisible()
  // The x-if="summary" section renders only when the component actually initialized and
  // load() resolved — the single clearest "Alpine is alive" assertion on this page.
  await expect(page.getByRole('heading', { name: 'Snapshot', exact: true })).toBeVisible({ timeout: 10_000 })
  // Heatmap grid (13 weeks + padding ≈ 90+ cells) + activity bars both render from data.
  // NOTE: .first() is the pad-to-Sunday cell whenever the 91-day window starts mid-week
  // (it renders but stays x-show="d" hidden — a date-dependent flake found 2026-09-13,
  // a Sunday-window day). Index 7 is always inside the first full week = a real cell.
  await expect(page.locator('.heatmap-cell').nth(7)).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#report-body .bar-row').first()).toBeVisible({ timeout: 10_000 })
  expect(alpine, `Alpine expression warnings: ${alpine.join(' | ')}`).toEqual([])
  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
})

test('settings page: hard load registers all eight Alpine components', async ({ page }) => {
  const alpine = trackAlpineWarnings(page)
  const errors = trackErrors(page)
  await login(page)
  await page.goto('/settings.html')
  // account.load() populates the email from /api/auth/me — dead scope ⇒ empty forever.
  await expect(page.locator('#settings-account input[type="email"]')).toHaveValue(TEST_EMAIL, { timeout: 10_000 })
  // Alpine scope sanity via the reactive DOM: the views x-for renders its row list
  // (order.length ≥ 1 after load) — with a dead scope the rows never render.
  await expect(page.locator('#settings-views .view-sort-row').first()).toBeVisible({ timeout: 10_000 })
  expect(alpine, `Alpine expression warnings: ${alpine.join(' | ')}`).toEqual([])
  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
})

test('soft navigation: dashboard → reports keeps the report component alive', async ({ page }) => {
  const alpine = trackAlpineWarnings(page)
  await login(page)
  // Soft-navigate exactly like the nav links do (nav.js go()) — the MutationObserver race
  // only reproduces on the real path: swap shell → await page script → initTree.
  await page.evaluate(() => (window as unknown as { hibanaNav?: { go: (p: string) => void } }).hibanaNav?.go('/reports.html'))
  await page.waitForURL('**/reports.html')
  await expect(page.getByRole('heading', { name: 'Snapshot', exact: true })).toBeVisible({ timeout: 10_000 })
  expect(alpine, `Alpine expression warnings: ${alpine.join(' | ')}`).toEqual([])
})

test('soft navigation: dashboard → settings keeps the prefs component alive', async ({ page }) => {
  const alpine = trackAlpineWarnings(page)
  await login(page)
  await page.evaluate(() => (window as unknown as { hibanaNav?: { go: (p: string) => void } }).hibanaNav?.go('/settings.html'))
  await page.waitForURL('**/settings.html')
  await expect(page.locator('#settings-prefs')).toBeVisible()
  // prefs.load() fills the language <select> value from /api/settings.
  await expect.poll(async () => page.locator('#settings-prefs select[x-model="language_pref"]').inputValue(), { timeout: 10_000 }).toMatch(/en|fa/)
  expect(alpine, `Alpine expression warnings: ${alpine.join(' | ')}`).toEqual([])
})

// Review-round 2 feature: the digest export (Copy-as-Markdown + CSV) builds from the
// live Alpine scope — if the component is dead, both buttons no-op with a toast.
test('reports export: digest copy + CSV download produce real content', async ({ page }) => {
  const alpine = trackAlpineWarnings(page)
  await login(page)
  await page.goto('/reports.html')
  await expect(page.getByRole('button', { name: /copy as markdown/i })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /download csv/i })).toBeVisible()

  // Copy-as-Markdown: grant clipboard permission, click, read back the digest.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: /copy as markdown/i }).click()
  const digest = await page.evaluate(() => navigator.clipboard.readText())
  expect(digest).toContain('# ')
  expect(digest).toContain('## ')

  // CSV download: intercept the blob anchor download (no dialog) and check the file.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.getByRole('button', { name: /download csv/i }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^hibana-report-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = await download.path().then((p) => (p ? readFileSync(p, 'utf8') : ''))
  expect(csv).toContain('"section","label","value"')
  expect(csv).toContain('"snapshot"')
  expect(alpine, `Alpine expression warnings: ${alpine.join(' | ')}`).toEqual([])
})
