// e2e/notes-reveal-gate.spec.ts — S84: the full-page loader's reveal gate on notes.html.
// The owner's report: "when loading the note.html, it still appears pre-emptively and
// unloaded, so elements are not looking proper." Root cause: #hibana-page-loader hid
// at DOMContentLoaded — which only proves the scripts PARSED. On a slow link the vault
// data lands seconds later, so the veil lifted over a skeleton page (and the old 8s
// safety could lift it over a half-booted one). notes.html now declares
// <html data-hibana-reveal="gated"> and app.js keeps the veil until the page's own
// controller signals its first REAL paint (data-hibana-ready / hibana:page-ready).
// This spec pins: (1) a DELAYED list API keeps the veil DOWN past DOMContentLoaded and
// it lifts exactly when real cards render; (2) a FAILED list fetch reveals the honest
// load-failed Retry panel — the veil never traps; (3) the parse-time bootstrap preload
// actually fires from the inline head script (window.__hibanaVaultBoot consumed once).
// Run: npx playwright test e2e/notes-reveal-gate.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

// The route interception this spec depends on (delay / abort the vault APIs) only
// sees DIRECT page requests — a CONTROLLING service worker passes them outside
// page.route's reach (a known Playwright limitation), which makes the delays
// silently not apply. Blocking SWs for this spec keeps every request interceptable
// (settleIn's controller-wait tolerates the absent SW via its .catch).
test.use({ serviceWorkers: 'block' })

const TEST_EMAIL = 'e2e-reveal@test.local'
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
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-reveal', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  try {
    db.exec(`DELETE FROM vault_notes WHERE user_id = '${id}'`)
  } catch { /* schema drift safety */ }
  db.close()
})

const settleIn = async (page: import('@playwright/test').Page) => {
  await page.goto('/login.html')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

const veilHidden = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const veil = document.getElementById('hibana-page-loader')
    return !veil || veil.classList.contains('is-hidden')
  })

test('a slow list API keeps the veil DOWN past DOMContentLoaded; it lifts exactly when real cards paint', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  await settleIn(page)

  // delay the LIST api by 2.5s — the slow-link shape (scripts cached, data slow)
  let release: (() => void) | null = null
  await page.route('**/api/vault/notes**', async (route) => {
    await new Promise<void>((r) => { release = r; setTimeout(r, 2500) })
    release = null
    await route.continue()
  })

  await page.goto('/notes.html')
  // DOM is complete (scripts parsed + mount ran)…
  await page.waitForFunction(() => document.readyState === 'complete')
  // …but the veil is STILL DOWN (the skeleton must not show through)
  await expect.poll(() => veilHidden(page), { timeout: 300 }).toEqual(false)
  // the gate contract markers exist on this page
  await expect(page.locator('html[data-hibana-reveal="gated"]')).toHaveCount(1)

  // the delayed data lands → real cards render → the veil lifts
  await expect(page.locator('.vault-card, .vault-empty')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => veilHidden(page), { timeout: 5_000 }).toEqual(true)
  await expect(page.locator('html[data-hibana-ready="1"]')).toHaveCount(1)
  release?.()
})

test('a failed list fetch reveals the honest load-failed Retry panel — the veil never traps', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  await settleIn(page)

  let fails = 0
  await page.route('**/api/vault/notes**', async (route) => {
    fails += 1
    if (fails <= 2) await route.abort('failed') // the fetch + its one retry both drop
    else await route.continue()
  })

  await page.goto('/notes.html')
  // both attempts fail → the honest panel (never the fake "No notes yet", never an eternal veil)
  await expect(page.locator('.vault-load-failed')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => veilHidden(page), { timeout: 5_000 }).toEqual(true)

  // Retry works: the click re-runs the fetch pair — now allowed through — cards render
  await page.click('[data-vault-retry]')
  await expect(page.locator('.vault-card, .vault-empty')).toBeVisible({ timeout: 15_000 })
})

test('the inline head script starts the bootstrap fetch at parse time (window.__hibanaVaultBoot)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  await settleIn(page)

  let bootHits = 0
  await page.route('**/api/vault/bootstrap', async (route) => {
    bootHits += 1
    await route.continue()
  })

  await page.goto('/notes.html')
  // the preload fired (parse-time), and after boot it was consumed (nulled) exactly once
  await expect.poll(() => page.evaluate(() => (window as unknown as { __hibanaVaultBoot?: unknown }).__hibanaVaultBoot === null || (window as unknown as { __hibanaVaultBoot?: unknown }).__hibanaVaultBoot === undefined), { timeout: 10_000 }).toEqual(true)
  expect(bootHits).toBeGreaterThanOrEqual(1)
  // only ONE bootstrap round trip for the whole page load (the stash is consumed, not re-fetched)
  await page.waitForTimeout(800)
  expect(bootHits).toBe(1)
})
