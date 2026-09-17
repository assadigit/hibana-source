// e2e/vault-outline.spec.ts — S56 outline behavior pins (S59b queued item).
// The heading outline ("On this page") renders in the preview pane; this spec pins:
//   desktop split-mode → open by default (no pref), active item = first heading
//   mobile read-mode   → COLLAPSED by default (S59b dropdown variant) + the head's
//                        live current-section label; toggle → pref persists + wins
//                        over the mobile default after reload
// Run: npx playwright test e2e/vault-outline.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-outline@test.local'
const TEST_PASS = 'e2e-password-123'

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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-outline', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login.html')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

async function createNoteWithOutline(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/notes.html')
  await expect(page.locator('[data-vault-new]').first()).toBeVisible({ timeout: 10_000 })
  await page.click('[data-vault-new]')
  await page.fill('[data-vault-title]', 'Outline pin note')
  // LONG note: the preview pane must actually scroll — otherwise the outline's
  // at-bottom rule (short note: last visible heading wins) makes the LAST heading
  // active, not the first. A scrolling pane pins the top-of-pane rule instead.
  const filler = Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i + 1} — the note needs real length so the preview pane scrolls and the outline's top-of-pane rule applies.`).join('\n\n')
  await page.fill('[data-vault-src]', `# Title\n\n${filler}\n\n## Alpha\n\n${filler}\n\n## Beta\n\n${filler}\n\n### Gamma\n\n${filler}`)
  await expect(page.locator('[data-vault-save][data-state="saved"]')).toBeVisible({ timeout: 6000 })
}

test.use({ viewport: { width: 1280, height: 800 } })
test('outline: desktop split-mode renders OPEN by default with the first heading active', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
  page.on('console', (m) => { if (m.type() === 'error' && !expectedErrorPatterns.some((re) => re.test(m.text()))) errors.push(m.text()) })
  page.on('pageerror', (err) => { if (!expectedErrorPatterns.some((re) => re.test(err.message))) errors.push(err.message) })

  await login(page)
  await createNoteWithOutline(page)

  const nav = page.locator('[data-vault-outline]')
  await expect(nav).toBeVisible({ timeout: 10_000 })
  await expect(nav).toHaveAttribute('data-open', 'true') // desktop default: open, no pref
  await expect(nav.locator('.vault-outline-item')).toHaveCount(4) // h1 + 2×h2 + h3
  // initial active = heading 0 (the pane starts at the top)
  await expect(nav.locator('.vault-outline-item').first()).toHaveClass(/is-active/)
  // no explicit pref was written by just RENDERING (the toggle is the only writer)
  const prefsRaw = await page.evaluate(() => localStorage.getItem('hibana-vault-prefs'))
  expect(prefsRaw === null || !/"outline"/.test(prefsRaw)).toBe(true)

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

test.describe('mobile 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('outline: mobile read-mode starts COLLAPSED with the live section label; toggle persists the pref', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
    const errors: string[] = []
    const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
    page.on('console', (m) => { if (m.type() === 'error' && !expectedErrorPatterns.some((re) => re.test(m.text()))) errors.push(m.text()) })
    page.on('pageerror', (err) => { if (!expectedErrorPatterns.some((re) => re.test(err.message))) errors.push(err.message) })

    await login(page)
    await createNoteWithOutline(page)

    // DETERMINISTIC BOOT: a late SW controllerchange reload can wipe the mobile
    // editor state mid-helper (newNote sets no #n= hash, so a reload boots with
    // "Nothing open"). Reload deliberately, then open the note from the stable list.
    await page.reload()
    await expect(page.locator('[data-vault-card]').first()).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-vault-card]', { hasText: 'Outline pin note' }).first().click()
    await expect(page.locator('[data-vault-title]')).toHaveValue('Outline pin note', { timeout: 10_000 })
    // mobile default mode is EDIT — the outline lives in the preview pane, so open Read
    await page.click('[data-vault-mode="read"]')
    const nav = page.locator('[data-vault-outline]')
    await expect(nav).toBeVisible({ timeout: 10_000 })
    // S59b dropdown variant: collapsed by default on ≤940px (no pref)
    await expect(nav).toHaveAttribute('data-open', 'false')
    await expect(nav.locator('.vault-outline-list')).toBeHidden()
    // the collapsed head still answers "where am I?" — live label = heading 0
    await expect(nav.locator('.vault-outline-now')).toHaveText('Title')
    // the head is a real toggle with correct aria state
    await expect(nav.locator('[data-vault-outline-toggle]')).toHaveAttribute('aria-expanded', 'false')

    // open it: pref persists
    await page.click('[data-vault-outline-toggle]')
    await expect(nav).toHaveAttribute('data-open', 'true')
    await expect(nav.locator('.vault-outline-list')).toBeVisible()
    const prefsRaw = await page.evaluate(() => localStorage.getItem('hibana-vault-prefs'))
    expect(prefsRaw).toContain('"outline":true')

    // reload: the EXPLICIT pref wins over the mobile default — stays open
    await page.reload()
    await expect(nav).toBeVisible({ timeout: 10_000 })
    await expect(nav).toHaveAttribute('data-open', 'true')

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  })
})
