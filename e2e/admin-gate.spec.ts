// e2e/admin-gate.spec.ts — S94 (owner item 2): the "Admin" row must stay INVISIBLE
// for non-superadmin users, on BOTH surfaces that ship it:
//   1. the desktop account sliding menu (rail avatar hover pop), and
//   2. the mobile bottom-nav "More" sheet.
//
// The owner reported still seeing Admin despite the JS role-gating — root cause was
// CSS, not JS: .user-menu-item / .mobile-more-row set display:flex, which BEATS the
// UA [hidden] sheet (author rules always outrank UA rules — the Task-17 popover
// lesson). The rows shipped hidden + hib-init only un-hides role=owner… but the
// hidden attribute never took effect. The S94 guard
// (.user-menu-item[hidden], .mobile-more-row[hidden] { display:none !important })
// makes the attribute authoritative again.
//
// A role='member' account is seeded here precisely because the role=owner e2e accounts
// can never catch this class of leak — owners are SUPPOSED to see the row.
// Run: npx playwright test e2e/admin-gate.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-admingate@test.local'
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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-admingate', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // Suppress the first-visit tour overlay (the S85 recipe).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
}

test.describe('the Admin row role-gate (S94 item 2 — the [hidden] vs display:flex leak)', () => {
  test('a NON-owner never sees Admin: hidden in the account menu AND computed display:none', async ({ page }) => {
    await login(page)

    // The desktop account sliding menu: hover the rail avatar, the pop opens.
    await page.hover('.rail-user-chip')
    const pop = page.locator('.rail-user .user-menu-pop')
    await expect(pop).toBeVisible()

    // The Admin row EXISTS in the DOM (it ships in the partial) with the hidden
    // attribute intact — the JS never un-hid it (role=user)…
    const adminRow = pop.locator('[data-admin-link]')
    await expect(adminRow).toHaveCount(1)
    await expect(adminRow).toHaveAttribute('hidden', /.*/)
    // …and — the S94 regression — the hidden attribute now WINS over the flex row:
    // before the guard, display:flex beat the UA sheet and the row was VISIBLE
    // to every account. Computed display must be none.
    const display = await adminRow.evaluate((el) => getComputedStyle(el).display)
    expect(display).toBe('none')
    // Playwright's own visibility contract (the belt to the computed-style braces):
    await expect(adminRow).toBeHidden()
  })

  test('the mobile More sheet keeps Admin hidden for a non-owner too', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('nav.rail')).toBeHidden()

    await page.click('.mobile-nav-more')
    await page.waitForSelector('.mobile-more-sheet.open', { timeout: 5_000 })
    const sheetAdmin = page.locator('.mobile-more-sheet [data-admin-link]')
    await expect(sheetAdmin).toHaveCount(1)
    const display = await sheetAdmin.evaluate((el) => getComputedStyle(el).display)
    expect(display).toBe('none')
    await expect(sheetAdmin).toBeHidden()
  })
})
