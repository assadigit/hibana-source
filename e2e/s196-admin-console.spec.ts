// e2e/s196-admin-console.spec.ts — S196 (Track A coverage-gap audit): /admin.html
// was the app's only unguarded CONSOLE page — admin-gate.spec.ts pins the ROW
// visibility for members (a CSS lesson), but no spec ever rendered the page itself.
// The console carries the app's most destructive controls (bans, deletes, role
// changes, broadcasts), so its render contract gets pinned NON-DESTRUCTIVELY here:
//   1. an owner boots the console: the deny card stays hidden, the tab rail renders,
//      the overview KPIs arrive from the API, the users tab lists seeded users.
//   2. a member gets the deny card (the UI layer of the owner gate — the API side
//      is pinned in admin-users.test.ts) and never sees the console root.
//   3. the users tab's search narrows the list (the one list interaction).
//   4. 0 console/page errors on both passes.
// NOTHING destructive is driven: no ban, no delete, no email is sent.
// Run: npx playwright test e2e/s196-admin-console.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const OWNER_EMAIL = 'e2e-s196-admin@test.local'
const MEMBER_EMAIL = 'e2e-s196-admin-member@test.local'
const TEST_PASS = 'e2e-password-123'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()

  const seed = (id: string, email: string, name: string, role: string) => {
    try { db.exec(`DELETE FROM users WHERE email = '${email}'`) } catch { /* may not exist yet */ }
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${id}', '${name}', '${email}', '${hash.replace(/'/g, "''")}', '${role}', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
    return id
  }
  seed(randomBytes(16).toString('hex'), OWNER_EMAIL, 'e2e-s196-admin', 'owner')
  seed(randomBytes(16).toString('hex'), MEMBER_EMAIL, 'e2e-s196-mem', 'member')
  db.close()
})

async function loginAs(page: Page, email: string) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

test.describe('the admin console page (/admin.html) — the render contract, non-destructive', () => {
  test('an owner boots the console: tabs + KPIs + the seeded users', async ({ page }) => {
    await loginAs(page, OWNER_EMAIL)
    // console listeners attach AFTER login — the logged-out /api/auth/me 401 on the
    // login page is expected noise (the s193 lesson)
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/admin.html')

    // the deny card stays hidden; the console root renders
    await expect(page.locator('#adm-root')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#adm-deny')).toBeHidden()
    // the six tabs
    const tabs = page.locator('[data-adm-tab]')
    await expect(tabs).toHaveCount(6)
    // the overview KPIs arrive from the API (users ≥ 2: the owner + the member)
    await expect(page.locator('#adm-kpis')).not.toContainText('Loading', { timeout: 10_000 })
    const kpis = await page.locator('#adm-kpis').textContent()
    expect(kpis).toBeTruthy()

    // the users tab: the seeded pair renders (the member is searchable)
    await page.click('[data-adm-tab="users"]')
    const list = page.locator('#adm-userlist')
    await expect(list).toBeVisible()
    await expect(list).toContainText('e2e-s196-admin', { timeout: 10_000 })
    await expect(list).toContainText('e2e-s196-mem')

    // the search narrows to the member only
    await page.fill('#adm-search', 'e2e-s196-mem')
    await expect(page.locator('#adm-userlist')).toContainText('e2e-s196-mem')
    const countText = await page.locator('#adm-users-count').textContent()
    expect(countText).toContain('1')
    expect(errors).toEqual([])
  })

  test('a member gets the deny card — the console root never renders', async ({ page }) => {
    await loginAs(page, MEMBER_EMAIL)
    // console listeners attach AFTER login (the s193 lesson)
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/admin.html')
    await expect(page.locator('#adm-deny')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#adm-root')).toBeHidden()
    await expect(page.locator('#adm-deny')).toContainText('owner-only')
    expect(errors).toEqual([])
  })
})
