// e2e/mobile-nav-active.spec.ts — S59: the bottom bar's position feedback.
//
// The S59 bug (found via VLM sweep + live verification): the mobile bottom nav's
// active state was computed ONCE at build time — (a) it went STALE after every soft
// navigation (nav.js swaps <main> without a reload; its markNav() only refreshed the
// desktop topbar — notes → projects kept "Notes" lit), and (b) secondary pages (the
// More sheet's destinations: reports/calendar/…) left the bar with NO active tab at
// all, and the More button never lit up even when the current page lives inside its
// sheet. These specs pin the fix: mark() runs on every soft navigation, secondary
// pages light the More tab, and the current page's row is marked inside the sheet.
// Run: npx playwright test e2e/mobile-nav-active.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-mobnav@test.local'
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
     VALUES ('${id}', 'e2e-mobnav', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // SW claim + settle (see viewport.spec.ts login() for the why).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

/** aria-current of every bottom-bar tab + the More button, in DOM order. */
const barState = (page: Page) =>
  page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.mobile-nav a')].map((a) => a.getAttribute('aria-current'))
    const more = document.querySelector('.mobile-nav-more')
    return { tabs, more: more ? more.getAttribute('aria-current') : 'missing' }
  })

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
})

test('hard load marks the current primary tab (notes)', async ({ page }) => {
  await page.goto('/notes.html')
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
  const state = await barState(page)
  // Tab order: dashboard, to-do, projects, sparks, notes.
  expect(state.tabs).toEqual(['false', 'false', 'false', 'false', 'page'])
  expect(state.more).toBeNull() // More stays quiet on primary pages
})

test('S59 regression pin: soft navigation refreshes the active tab', async ({ page }) => {
  await page.goto('/notes.html')
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('.mobile-nav a[href="/projects.html"]', { timeout: 10_000 })
  // Soft-navigate (nav.js intercepts the tap — no full reload).
  await page.click('.mobile-nav a[href="/projects.html"]')
  await page.waitForURL('**/projects.html', { timeout: 10_000 })
  await page.waitForTimeout(600) // let the swap + markNav settle
  const state = await barState(page)
  // The bug: "notes" stayed 'page' after landing on projects.
  expect(state.tabs).toEqual(['false', 'false', 'page', 'false', 'false'])
  expect(state.more).toBeNull()
})

test('secondary pages light the More tab + mark their sheet row', async ({ page }) => {
  await page.goto('/reports.html')
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
  const state = await barState(page)
  expect(state.tabs).toEqual(['false', 'false', 'false', 'false', 'false']) // no primary tab lies
  expect(state.more).toBe('page') // the current destination lives in the sheet

  // Open the More sheet — the Reports row must carry the current-page mark.
  await page.click('.mobile-nav-more')
  await page.waitForSelector('.mobile-more-sheet.open', { timeout: 5_000 })
  const marked = await page.evaluate(() =>
    [...document.querySelectorAll('.mobile-more-sheet a.mobile-more-row')]
      .filter((a) => a.getAttribute('aria-current') === 'page')
      .map((a) => a.getAttribute('href')),
  )
  expect(marked).toEqual(['/reports.html'])
})
