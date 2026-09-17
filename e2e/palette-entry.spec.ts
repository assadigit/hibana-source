// e2e/palette-entry.spec.ts — S61: the command palette's visible entries.
//
// The palette was keyboard-only (Ctrl+K / "/"): touch users had ZERO access (phones
// have no keyboard shortcuts) and desktop users had no visible affordance to discover
// any of it. Two entries exist now — the topbar search pill (desktop chrome, nav
// partial) and the More sheet's "Search & commands" action row (touch) — both pinned
// here end-to-end, including the sheet's close-then-open sequencing.
// Run: npx playwright test e2e/palette-entry.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-cmdk@test.local'
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
     VALUES ('${id}', 'e2e-cmdk', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

test.describe('desktop: the topbar search pill', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('renders in the nav chrome and opens the palette with focus', async ({ page }) => {
    // The nav partial loads async — the pill must appear on every authed page.
    await page.waitForSelector('.topbar-search', { timeout: 10_000 })
    const pill = page.locator('.topbar-search')
    await expect(pill).toBeVisible()
    await expect(pill).toHaveAttribute('data-cmdk-open', '')

    await pill.click()
    const dlg = page.locator('#cmdk-dialog')
    await expect(dlg).toBeVisible()
    // Type-ahead lands in the input — the palette's whole contract.
    await expect(page.locator('#cmdk-input')).toBeFocused()
    // Quick-action rows render (the always-available command list).
    await expect(dlg.locator('.cmdk-item').first()).toBeVisible()

    // Esc closes — the pill didn't break the palette's keyboard contract.
    await page.keyboard.press('Escape')
    await expect(dlg).not.toBeVisible()
  })

  test('the pill still works after a soft navigation (delegated binding)', async ({ page }) => {
    await page.waitForSelector('.topbar-search', { timeout: 10_000 })
    // Soft-nav to another page (nav.js swaps <main> without a reload).
    await page.click('.topbar .nav-links a[href="/projects.html"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    await page.waitForTimeout(600)
    await page.click('.topbar-search')
    await expect(page.locator('#cmdk-dialog')).toBeVisible()
  })
})

test.describe('mobile: the More sheet action row', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
  })

  test('the sheet offers Search & commands and opens the palette from touch', async ({ page }) => {
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.click('.mobile-nav-more')
    const sheet = page.locator('#mobile-more-sheet')
    await expect(sheet).toHaveClass(/open/)

    // The action row exists, sits above the first divider, and is a button (not a link).
    const row = sheet.locator('[data-mobile-cmdk]')
    await expect(row).toBeVisible()
    await expect(row).toHaveText(/Search & commands/)

    await row.click()
    // The sheet closes first, then the palette opens — the close-then-open sequencing.
    await expect(sheet).not.toHaveClass(/open/)
    const dlg = page.locator('#cmdk-dialog')
    await expect(dlg).toBeVisible()
    await expect(page.locator('#cmdk-input')).toBeFocused()

    // Esc still closes on touch viewport sizes (physical keyboards attach to phones).
    await page.keyboard.press('Escape')
    await expect(dlg).not.toBeVisible()
  })

  test('FA locale: the sheet row and palette both localize', async ({ page }) => {
    await login(page)
    // Flip to FA through the app's own API (the More-sheet language toggle's path),
    // then reload so the dictionaries + dir re-apply.
    await page.evaluate(async () => {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language_pref: 'fa' }),
      })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/projects.html')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.click('.mobile-nav-more')
    const row = page.locator('[data-mobile-cmdk]')
    await expect(row).toBeVisible()
    await expect(row).toHaveText(/جست‌وجو و فرمان‌ها/)
    await row.click()
    await expect(page.locator('#cmdk-dialog')).toBeVisible()
    // RTL: the document direction must carry into the palette context.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    // Back to EN so the shared account stays predictable for other specs.
    await page.evaluate(async () => {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language_pref: 'en' }),
      })
    })
  })
})
