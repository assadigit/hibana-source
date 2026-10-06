// e2e/s192-attention-path.spec.ts — S192: THE ATTENTION PATH (round 2).
//
// The path from the glance to the action gets shorter:
//   (a) the unreviewed-spark notifications link DIRECT to the lean spark page
//       (the old /project.html hop flashed an empty heavy shell + wasted a round
//       trip; every other spark surface already linked direct);
//   (b) the chrome rows (account menu + mobile More sheet) + the palette's
//       Notifications destination are SMART deep-links — the LEADING severity's
//       filter (#urgent > #warning > #info): two clicks from the badge to exactly
//       the list that needs attention;
//   (c) the palette's Notifications row carries the live-count sublabel (the
//       Trash pattern, the shared __hibNotifCounts memo, FA digits, 99+ cap);
//   (d) the badge's separation ring tracks the chip's hover/focus surface (the
//       white-halo-on-gray-hover mismatch, probe-confirmed).
//
// Run: npx playwright test e2e/s192-attention-path.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s192@test.local'
const FA_EMAIL = 'e2e-s192-fa@test.local'
const EMPTY_EMAIL = 'e2e-s192-empty@test.local'
const TEST_PASS = 'e2e-password-123'

const DAY = 24 * 3600 * 1000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const day = (ms: number) => iso(ms).slice(0, 10)

// Seed: 1 urgent (overdue task), 1 warning (deadline soon), 2 info (an old spark +
// a stale project) — the LEADING severity is URGENT, so every smart deep-link must
// answer #urgent.
function seed(db: import('node:sqlite').DatabaseSync, uid: string, email: string, uname: string, lang: 'en' | 'fa', withData: boolean) {
  const now = iso(0)
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${uid}', '${uname}', '${email}', 'PLACEHOLDER-HASH', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  if (!withData) return
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, type, due_date, created_at, updated_at)
     VALUES ('${uid}-p-due', '${uid}', 's192 due-soon host', 'developing', 'client', '${day(3 * DAY)}', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO tasks (id, project_id, title, done, due_date, created_at)
     VALUES ('${uid}-t-old', '${uid}-p-due', 's192 the overdue client task', 0, '${day(-DAY)}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
     VALUES ('${uid}-p-spark', '${uid}', 's192 the old unreviewed spark', 'spark', '${iso(-10 * DAY)}', '${iso(-10 * DAY)}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
     VALUES ('${uid}-p-stale', '${uid}', 's192 the stale project', 'developing', '${iso(-60 * DAY)}', '${iso(-40 * DAY)}')`,
  )
}

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  // ONCE, before the loop (the S191 lesson): explicit child-table deletes — raw
  // DatabaseSync runs WITHOUT PRAGMA foreign_keys.
  db.exec(`DELETE FROM tasks WHERE id LIKE 's192%' OR project_id LIKE 's192%'`)
  db.exec(`DELETE FROM projects WHERE id LIKE 's192%' OR user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-s192%')`)
  db.exec(`DELETE FROM users WHERE email LIKE 'e2e-s192%'`)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  for (const [uid, email, uname, lang, withData] of [
    ['s192u1', TEST_EMAIL, 'e2e-s192', 'en', true],
    ['s192u2', FA_EMAIL, 'e2e-s192-fa', 'fa', true],
    ['s192u3', EMPTY_EMAIL, 'e2e-s192-empty', 'en', false],
  ] as const) {
    seed(db, uid, email, uname, lang, withData)
  }
  db.exec(`UPDATE users SET password_hash = '${hash.replace(/'/g, "''")}' WHERE email LIKE 'e2e-s192%'`)
  db.close()
})

async function login(page: Page, email = TEST_EMAIL, theme?: 'claude-dark') {
  await page.addInitScript((args) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (args.theme) localStorage.setItem('hibana-theme', args.theme)
    } catch { /* storage blocked */ }
  }, { theme })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

test('the unreviewed-spark row links DIRECT to the lean page — no /project.html hop', async ({ page }) => {
  await login(page)
  await page.goto('/notifications.html')
  const sparkLink = page.locator('.notif-item a.notif-detail', { hasText: 's192 the old unreviewed spark' })
  await expect(sparkLink).toHaveAttribute('href', /\/spark\.html\?id=/)
  // the click lands on spark.html — the heavy page never appears
  await sparkLink.click()
  await page.waitForURL(/\/spark\.html\?id=/)
  await expect(page.locator('#spark-title')).toHaveValue('s192 the old unreviewed spark')
})

test('the account-menu row is a SMART deep-link: the leading severity\'s filter', async ({ page }) => {
  await login(page)
  // 1 urgent + 1 warning + 2 info → the badge leads URGENT → the row carries #urgent
  const row = page.locator('.user-menu-item[data-notif-row]')
  await expect(row.locator('.menu-count-pill')).toHaveText('4')
  await expect(row).toHaveAttribute('href', '/notifications.html#urgent')
  // the pop is HOVER-opened — bring the pointer onto the account cluster first
  await page.locator('.user-menu').hover()
  // clicking it lands on the page WITH the urgent filter active
  await row.click()
  await page.waitForURL(/#urgent$/)
  await expect(page.locator('.notif-group[data-sev="urgent"]')).toBeVisible()
  await expect(page.locator('.notif-group[data-sev="info"]')).toBeHidden()
  // the pressed chip mirrors the arrival
  await expect(page.locator('.notif-chip-btn.notif-urgent')).toHaveAttribute('aria-pressed', 'true')
})

test('the palette\'s Notifications row: the live-count sublabel + the smart destination', async ({ page }) => {
  await login(page)
  await page.keyboard.press('Control+k')
  const dlg = page.locator('#cmdk-dialog')
  await expect(dlg).toBeVisible()
  const row = dlg.locator('li.cmdk-item', { hasText: 'Notifications' })
  await expect(row).toBeVisible()
  // the sublabel carries the live count (4) — the Trash grammar
  await expect(row).toContainText('4 needing attention')
  // activate it → lands on the leading severity's filter
  await row.click()
  await page.waitForURL(/\/notifications(\.html)?#urgent$/)
  await expect(page.locator('.notif-group[data-sev="urgent"]')).toBeVisible()
})

test('mobile 390: the More sheet row\'s smart deep-link + the aria-current regression guard', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  // ON the notifications page — the sheet row must STAY aria-current even though
  // its href now carries the #urgent hash (the normPath hash fix).
  await page.goto('/notifications.html')
  await page.locator('.mobile-nav-more').click()
  const sheetRow = page.locator('#mobile-more-sheet a.mobile-more-row[data-notif-row]')
  await expect(sheetRow.locator('.menu-count-pill')).toHaveText('4')
  await expect(sheetRow).toHaveAttribute('href', '/notifications.html#urgent')
  await expect(sheetRow).toHaveAttribute('aria-current', 'page')
})

test('the badge ring tracks the chip\'s hover surface (the halo fix)', async ({ page }) => {
  await login(page)
  const badge = page.locator('.rail-user-chip .chip-notif-badge')
  await expect(badge).toHaveText('4')
  // REST: the ring is --card (the S191 contract)
  const restRing = await badge.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(restRing).toContain('rgb(255, 255, 255)')
  // HOVER (a REAL pointer — CSS :hover doesn't answer dispatched events): the chip
  // tints --bg-soft and the ring FOLLOWS onto the same surface — no white halo.
  const chip = page.locator('.rail-user-chip')
  await chip.hover()
  const hoverState = await chip.evaluate((el, badgeSel) => {
    const badge = el.querySelector(badgeSel) as HTMLElement
    return { chipBg: getComputedStyle(el).backgroundColor, ring: getComputedStyle(badge).boxShadow }
  }, '.chip-notif-badge')
  // the ring's color is the chip's hover SURFACE family (--bg-soft #DEDEDE), not
  // the resting --card white — the halo is gone. (The chip's own hover bg composites
  // the tint translucently; the ring paints the token's opaque form — both speak
  // var(--bg-soft), which is the contract.)
  expect(hoverState.ring).toContain('rgb(222, 222, 222)')
  expect(hoverState.ring).not.toContain('rgb(255, 255, 255)')
})

test('FA twin: the palette sublabel in Persian digits + the smart #urgent arrival', async ({ page }) => {
  await login(page, FA_EMAIL)
  await page.keyboard.press('Control+k')
  const row = page.locator('#cmdk-dialog li.cmdk-item', { hasText: 'اعلان‌ها' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('۴ مورد نیازمند توجه')
  await row.click()
  await page.waitForURL(/\/notifications(\.html)?#urgent$/)
  await expect(page.locator('.notif-group[data-sev="urgent"]')).toBeVisible()
  await expect(page.locator('.notif-group[data-sev="info"]')).toBeHidden()
})

test('the caught-up user: the rows reset to the plain page + no palette sublabel', async ({ page }) => {
  await login(page, EMPTY_EMAIL)
  await page.waitForTimeout(1200) // let the counts fetch settle
  const row = page.locator('.user-menu-item[data-notif-row]')
  await expect(row).toHaveAttribute('href', '/notifications.html')
  await expect(row.locator('.menu-count-pill')).toHaveCount(0)
  await page.keyboard.press('Control+k')
  const prow = page.locator('#cmdk-dialog li.cmdk-item', { hasText: 'Notifications' })
  await expect(prow).toBeVisible()
  await expect(prow).not.toContainText('needing attention')
  await prow.click()
  await page.waitForURL(/\/notifications(\.html)?$/)
  await expect(page.locator('.empty-state')).toBeVisible()
})

test('0 console errors + 0 page errors across the pass', async ({ page }) => {
  const consoleMsgs: string[] = []
  const pageErrors: string[] = []
  await login(page)
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.text()) })
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.goto('/notifications.html')
  await page.locator('.notif-chip-btn.notif-info').click()
  await page.locator('.notif-chip-btn').first().click()
  await page.keyboard.press('Control+k')
  await page.locator('#cmdk-dialog li.cmdk-item', { hasText: 'Notifications' }).click()
  await page.waitForURL(/#urgent$/)
  expect(pageErrors).toEqual([])
  const benign = consoleMsgs.filter((m) => !/favicon|sourcemap/i.test(m))
  expect(benign).toEqual([])
})
