// e2e/screenshots.spec.ts — visual regression baselines.
// Captures screenshots of key pages on first run (establishes baseline).
// On subsequent runs, compares against the baseline — fails if pixels differ.
// Run: npx playwright test e2e/screenshots.spec.ts --update-snapshots (to establish/update baseline)
// Run: npx playwright test e2e/screenshots.spec.ts (to compare)

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e@test.local'
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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch {}
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

test.describe('visual regression — public pages', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login.html')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)
    await expect(page).toHaveScreenshot('login.png', { fullPage: true, maxDiffPixelRatio: 0.01 })
  })

  test('404 page', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    await expect(page).toHaveScreenshot('404.png', { fullPage: true, maxDiffPixelRatio: 0.01 })
  })
})

test.describe('visual regression — authed pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login.html')
    await page.fill('[name="login"]', TEST_EMAIL)
    await page.fill('[name="password"]', TEST_PASS)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/app', { timeout: 10_000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  test('dashboard', async ({ page }) => {
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true, maxDiffPixelRatio: 0.01 })
  })

  test('projects page', async ({ page }) => {
    await page.goto('/projects.html')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await expect(page).toHaveScreenshot('projects.png', { fullPage: true, maxDiffPixelRatio: 0.01 })
  })
})
