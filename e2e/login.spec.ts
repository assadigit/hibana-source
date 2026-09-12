// e2e/login.spec.ts — basic E2E test: login → dashboard renders.
// Catches "the app compiles but doesn't actually work" regressions that unit tests miss.
// Run: npx playwright test e2e/login.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e@test.local'
const TEST_PASS = 'e2e-password-123'

// Seed the test user before tests run (migrations auto-run on boot).
test.beforeAll(async () => {
  // The Node server creates the DB on boot via applyMigrations. We seed via the
  // register API (which also verifies the email-verification gate works end-to-end).
  // Or we can hash the password and INSERT directly — simpler for CI.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')

  // Hash the password using the same PBKDF2 format as the app (100k iterations, Workers cap).
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
     VALUES ('${id}', 'e2e', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

test('login → dashboard renders with zero console errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')

  const errors: string[] = []
  const expectedErrorPatterns = [
    /Failed to load resource.*401/, // /api/auth/me before login + SW navigation check (expected: unauthenticated)
    /Failed to load resource.*404/, // SW manifest fetch on first load (expected: not built in CI before build step)
  ]
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (expectedErrorPatterns.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on('pageerror', (err) => {
    // Filter known-expected page errors
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })

  // Go to login page
  await page.goto('/login.html')
  await expect(page).toHaveTitle(/Sign in/)

  // Fill the login form
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')

  // Wait for redirect to dashboard
  await page.waitForURL('**/app', { timeout: 10_000 })
  await expect(page).toHaveTitle(/Dashboard/)

  // Verify the dashboard actually rendered content (the topbar nav is present)
  await page.waitForTimeout(3000) // wait for i18n to settle
  await expect(page.locator('nav.topbar')).toBeVisible({ timeout: 10_000 })
  // The "Projects" link appears in both topbar + mobile nav — use first()
  await expect(page.locator('a[href="/projects.html"]').first()).toBeVisible({ timeout: 10_000 })

  // Assert zero UNEXPECTED console errors (401s from auth-me + SW checks are expected)
  expect(errors).toEqual([])
})

test('404 page renders correctly', async ({ page }) => {
  await page.goto('/nonexistent-page-xyz')
  await expect(page).toHaveTitle(/404|پیدا نشد/)
})

test('health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.ok()).toBe(true)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.db).toBe('up')
})
