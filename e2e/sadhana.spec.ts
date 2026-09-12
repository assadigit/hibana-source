// e2e/sadhana.spec.ts — Sadhana board (sadhana.html) E2E: boot + task round-trip.
//
// WHY THIS FILE EXISTS (Session 29): the sadhana/To-do board shipped DEAD for four
// release trains (v0.3.10.2 → v0.3.12.3) and nothing noticed — E2E had ZERO sadhana
// coverage. Root cause: jalali.js declared top-level `function g2j` etc. → var-like
// globals, colliding with sadhana-page.js's top-level `const { g2j, … } =
// window.__hibJalali` destructure → SyntaxError at parse → the whole page script
// never ran → board stuck on "Loading…", 0 quadrants, hdrDate empty. jalali.js is now
// IIFE-wrapped (window.__hibJalali = sole global). These specs pin BOTH the boot and
// the basic create flow so a dead page can never ship silently again.
// Run: npx playwright test e2e/sadhana.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-sadhana@test.local'
const TEST_PASS = 'e2e-password-123'

// Seed the test user before tests run (migrations auto-run on server boot).
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
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${id}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-sadhana', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see viewport.spec.ts): the login page's SW registration
  // activates + claims this page → boot.js reloads /app once — that reload can supersede
  // the next goto. Let the claim + reload settle first.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// 401s from /api/auth/me before login + the SW navigation probe are expected (login.spec.ts
// filters the same patterns).
const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
]
const trackErrors = (page: Page) => {
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

// Open the board and wait for a HEALTHY boot: the loading placeholder is gone, all four
// quadrant cards + their quick-add FABs exist, and the header date rendered (the P0's
// exact dead signature: loading pill forever, 0 quadrants, empty #hdrDate).
async function openSadhana(page: Page) {
  await page.goto('/sadhana.html')
  await expect(page).toHaveTitle(/To-do list — Hibana/)
  await page.waitForSelector('#boardLoading', { state: 'detached', timeout: 10_000 })
  await expect(page.locator('.quadrant')).toHaveCount(4, { timeout: 10_000 })
  await page.waitForFunction(() => {
    const d = document.getElementById('hdrDate')
    return !!d && d.textContent!.trim().length > 0
  }, null, { timeout: 10_000 })
}

test('sadhana board boots with zero page errors (jalali global-collision regression pin)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors = trackErrors(page)

  await login(page)
  await openSadhana(page)

  // The four quadrant quick-add FABs are wired (the page script actually ran).
  await expect(page.locator('.q-fab')).toHaveCount(4)
  expect(errors).toEqual([]) // a dead page script would surface the SyntaxError here
})

test('task-card create → reload round-trip', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  const marker = `e2e sadhana round-trip ${Date.now()}`

  await login(page)
  await openSadhana(page)

  // Quick-add into quadrant 1: FAB → inline textarea → Enter → POST /api/sadhana/tasks.
  await page.click('#ab-1')
  await page.fill('#ti-1', marker)
  await page.keyboard.press('Enter')

  // The task card renders with the typed title.
  await expect(page.locator('.task-card', { hasText: marker })).toBeVisible({ timeout: 5_000 })

  // RELOAD: the board re-fetches from the server — the card must survive the round-trip.
  await openSadhana(page)
  await expect(page.locator('.task-card', { hasText: marker })).toBeVisible({ timeout: 10_000 })
  expect(errors).toEqual([])
})
