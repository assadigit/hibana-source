// e2e/s191-notifications.spec.ts — S191: THE ATTENTION SURFACE.
//
// The derived notifications surface gained (a) its count in the chrome — a quiet
// severity-tinted pill on the rail's user chip + count pills on the account-menu row
// and the mobile More sheet's row (PASSIVE: no animation, no toasts — §7-safe), and
// (b) page structure: severity GROUPS with sticky heads + the summary chips promoted
// to FILTER toggles + hash deep-links. Also fixed this round: --badge-pending-bg/-fg
// was referenced since R2.1 but NEVER DEFINED — every "Soon" surface silently
// rendered unstyled (the unit + qa suites pin the palette; here we pin the pixels).
//
// Run: npx playwright test e2e/s191-notifications.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s191@test.local'
const FA_EMAIL = 'e2e-s191-fa@test.local'
const EMPTY_EMAIL = 'e2e-s191-empty@test.local'
const TEST_PASS = 'e2e-password-123'

const DAY = 24 * 3600 * 1000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const day = (ms: number) => iso(ms).slice(0, 10)

// Seed a user carrying all three severities:
//   urgent — a client task overdue since yesterday (via a due-soon project host)
//   warning — a client project due in 3 days
//   info ×2 — an unreviewed spark (10d old) + a stale developing project (40d)
function seed(db: import('node:sqlite').DatabaseSync, uid: string, email: string, uname: string, lang: 'en' | 'fa', withData: boolean) {
  const now = iso(0)
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${uid}', '${uname}', '${email}', 'PLACEHOLDER-HASH', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  if (!withData) return
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, type, due_date, created_at, updated_at)
     VALUES ('${uid}-p-due', '${uid}', 's191 due-soon host', 'developing', 'client', '${day(3 * DAY)}', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO tasks (id, project_id, title, done, due_date, created_at)
     VALUES ('${uid}-t-old', '${uid}-p-due', 's191 the overdue client task', 0, '${day(-DAY)}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
     VALUES ('${uid}-p-spark', '${uid}', 's191 the old unreviewed spark', 'spark', '${iso(-10 * DAY)}', '${iso(-10 * DAY)}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
     VALUES ('${uid}-p-stale', '${uid}', 's191 the stale project', 'developing', '${iso(-60 * DAY)}', '${iso(-40 * DAY)}')`,
  )
}

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  // ONCE, before the loop: explicit child-table deletes (the s173 lesson — raw
  // DatabaseSync connections run WITHOUT PRAGMA foreign_keys, so user-row deletes do
  // NOT cascade; the deterministic s191-* ids also catch orphans from any prior
  // failed run). These must run BEFORE the per-user seed loop, never inside it (the
  // first debug lesson of this spec: a per-call cleanup wipes the earlier seeds).
  db.exec(`DELETE FROM tasks WHERE id LIKE 's191-%' OR project_id LIKE 's191-%'`)
  db.exec(`DELETE FROM projects WHERE id LIKE 's191-%' OR user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}', '${EMPTY_EMAIL}'))`)
  db.exec(`DELETE FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}', '${EMPTY_EMAIL}')`)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  for (const [uid, email, uname, lang, withData] of [
    ['s191u1', TEST_EMAIL, 'e2e-s191', 'en', true],
    ['s191u2', FA_EMAIL, 'e2e-s191-fa', 'fa', true],
    ['s191u3', EMPTY_EMAIL, 'e2e-s191-empty', 'en', false],
  ] as const) {
    seed(db, uid, email, uname, lang, withData)
  }
  // patch the seeded hash (kept out of seed() so the SQL above stays readable)
  db.exec(`UPDATE users SET password_hash = '${hash.replace(/'/g, "''")}' WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}', '${EMPTY_EMAIL}')`)
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

test('the fragment renders severity GROUPS in order, sticky heads, count pills', async ({ page }) => {
  await login(page)
  await page.goto('/notifications.html')
  const groups = page.locator('.notif-group[data-sev]')
  await expect(groups).toHaveCount(3)
  // severity order: urgent → warning → info
  await expect(groups.nth(0)).toHaveAttribute('data-sev', 'urgent')
  await expect(groups.nth(1)).toHaveAttribute('data-sev', 'warning')
  await expect(groups.nth(2)).toHaveAttribute('data-sev', 'info')
  // the heads carry labels + count pills (urgent 1, warning 1, info 2)
  await expect(groups.nth(0).locator('.notif-group-head')).toContainText('Urgent')
  await expect(groups.nth(0).locator('.notif-group-count')).toHaveText('1')
  await expect(groups.nth(2).locator('.notif-group-count')).toHaveText('2')
  // the items live inside their groups
  await expect(groups.nth(0).locator('.notif-item')).toHaveCount(1)
  await expect(groups.nth(2).locator('.notif-item')).toHaveCount(2)
  // the head is sticky + solid-cover (the S188 pattern) — computed proof
  const headPos = await groups.nth(0).locator('.notif-group-head').evaluate((el) => getComputedStyle(el).position)
  expect(headPos).toBe('sticky')
})

test('the summary chips are FILTER toggles: pressed = family fill, click narrows', async ({ page }) => {
  await login(page)
  await page.goto('/notifications.html')
  const summary = page.locator('#notif-summary')
  await expect(summary).toBeVisible()
  // All + the three severities, with counts; All pressed by default
  const chips = summary.locator('.notif-chip-btn')
  await expect(chips).toHaveCount(4)
  await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(chips.nth(0)).toContainText('All')
  await expect(chips.nth(1)).toContainText('Urgent')
  await expect(chips.nth(1)).toContainText('1')
  // click Urgent → only the urgent group stays; the pressed chip flips
  await chips.nth(1).click()
  await expect(page.locator('.notif-group[data-sev="urgent"]')).toBeVisible()
  await expect(page.locator('.notif-group[data-sev="warning"]')).toBeHidden()
  await expect(page.locator('.notif-group[data-sev="info"]')).toBeHidden()
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false')
  // the URL carries the filter (deep-linkable)
  await expect(page).toHaveURL(/#urgent$/)
  // back to All → everything returns
  await chips.nth(0).click()
  await expect(page.locator('.notif-group[data-sev="info"]')).toBeVisible()
  await expect(page).toHaveURL(/\/notifications(\.html)?$/)
  // the chips have their own focus ring (S61 doctrine) — set the page's keyboard
  // modality first (a bare el.focus() is script-initiated and :focus-visible won't
  // match in headless; a Tab press flips the modality), then read the outline
  await page.keyboard.press('Tab')
  const ring = await chips.nth(1).evaluate((el) => {
    el.focus()
    const cs = getComputedStyle(el)
    return cs.outlineStyle + ' ' + cs.outlineWidth
  })
  expect(ring).toContain('2px')
})

test('hash deep-link: #warning arrives pre-filtered', async ({ page }) => {
  await login(page)
  await page.goto('/notifications.html#warning')
  await expect(page.locator('.notif-group[data-sev="warning"]')).toBeVisible()
  await expect(page.locator('.notif-group[data-sev="urgent"]')).toBeHidden()
  const pressed = page.locator('.notif-chip-btn.notif-warning')
  await expect(pressed).toHaveAttribute('aria-pressed', 'true')
})

test('the chrome badge: a severity pill on the rail user chip + the account-menu row', async ({ page }) => {
  await login(page)
  // the chip badge paints after the counts fetch — wait for it
  const badge = page.locator('.rail-user-chip .chip-notif-badge')
  await expect(badge).toHaveCount(1)
  // 4 items, one urgent (the overdue task) → the URGENT family leads the tint
  await expect(badge).toHaveText('4')
  await expect(badge).toHaveClass(/chip-notif-urgent/)
  // the pill is decorative; the chip's aria-label carries the state
  const label = await page.locator('.rail-user-chip').getAttribute('aria-label')
  expect(label).toContain('4 needing attention')
  expect(label).toContain('Account menu')
  // the account-menu row's count pill (same severity family, the S188 badge column)
  const pill = page.locator('.user-menu-item[data-notif-row] .menu-count-pill')
  await expect(pill).toHaveText('4')
  await expect(pill).toHaveClass(/menu-count-urgent/)
  // the pill sits at the row's inline-end: margin-inline-start:auto (the S188 badge
  // column pattern — logical, RTL-true). Computed margins resolve 'auto' to USED px
  // (never the literal), so the probe reads the authored rule via CSSOM instead.
  const hasAutoRule = await pill.evaluate(() =>
    Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((r) =>
          r instanceof CSSStyleRule && r.selectorText === '.menu-count-pill' &&
          (r as CSSStyleRule).style.marginInlineStart === 'auto')
      } catch { return false }
    }))
  expect(hasAutoRule).toBe(true)
  // and geometrically: the pill's END edge sits at the row's END padding edge
  const geo = await pill.evaluate((el) => {
    const row = el.closest('.user-menu-item') as HTMLElement
    const p = el.getBoundingClientRect(), r = row.getBoundingClientRect()
    const cs = getComputedStyle(row)
    return { gap: r.right - p.right, pad: parseFloat(cs.paddingInlineEnd || cs.paddingRight || '12') }
  })
  expect(geo.gap).toBeGreaterThanOrEqual(geo.pad - 2)
  expect(geo.gap).toBeLessThanOrEqual(geo.pad + 2)
})

test('mobile 390: the More sheet row carries its pill; the sheet opens with a refresh', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/notifications.html')
  // the mobile brand bar + bottom nav replace the rail
  const moreBtn = page.locator('.mobile-nav-more')
  await moreBtn.click()
  const sheet = page.locator('#mobile-more-sheet')
  await expect(sheet).toHaveClass(/open/)
  // S192 re-pin: the row's href now carries the smart deep-link (#urgent etc. once
  // the counts land), so the stable data-notif-row hook owns the lookup — never
  // the rewritten href.
  const row = sheet.locator('a.mobile-more-row[data-notif-row]')
  const pill = row.locator('.menu-count-pill')
  await expect(pill).toHaveText('4')
  // FA digits under fa — pinned in the FA twin below; here the EN digits
  await expect(pill).toHaveClass(/menu-count-urgent/)
})

test('FA/RTL twin: group labels in Persian, mirrored layout, FA digit pills', async ({ page }) => {
  await login(page, FA_EMAIL)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.goto('/notifications.html')
  const groups = page.locator('.notif-group[data-sev]')
  await expect(groups).toHaveCount(3)
  await expect(groups.nth(0).locator('.notif-group-label')).toHaveText('فوری')
  await expect(groups.nth(1).locator('.notif-group-label')).toHaveText('به‌زودی')
  await expect(groups.nth(2).locator('.notif-group-label')).toHaveText('توجه')
  // FA digits in the count pills + the filter chips
  await expect(groups.nth(2).locator('.notif-group-count')).toHaveText('۲')
  const chips = page.locator('.notif-chip-btn')
  await expect(chips.nth(0)).toContainText('همه')
  await expect(chips.nth(1)).toContainText('فوری')
  // the chrome badge speaks FA: ۴ needing attention (the aria-label)
  const badge = page.locator('.rail-user-chip .chip-notif-badge')
  await expect(badge).toHaveText('۴')
  const label = await page.locator('.rail-user-chip').getAttribute('aria-label')
  expect(label).toContain('نیازمند توجه')
  // filter interaction rides the same chips in RTL
  await chips.nth(1).click()
  await expect(page.locator('.notif-group[data-sev="urgent"]')).toBeVisible()
  await expect(page.locator('.notif-group[data-sev="info"]')).toBeHidden()
})

test('dark twin: the pills + heads read on the dark canvas', async ({ page }) => {
  await login(page, TEST_EMAIL, 'claude-dark')
  await page.goto('/notifications.html')
  // the pressed chip's family fill — dark tokens apply (computed bg is a solid hex now
  // that the pair is defined; before the fix this computed to rgba(0,0,0,0))
  const head = page.locator('.notif-group-head-urgent .notif-group-label')
  await expect(head).toContainText('Urgent')
  const headColor = await head.evaluate((el) => getComputedStyle(el).color)
  expect(headColor).not.toBe('rgba(0, 0, 0, 0)')
  // the chip badge paints the dark warning family
  const badge = page.locator('.rail-user-chip .chip-notif-badge')
  await expect(badge).toHaveText('4')
  const badgeBg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(badgeBg).not.toBe('rgba(0, 0, 0, 0)')
  // the sticky head's cover is the dark canvas
  const cover = await page.locator('.notif-group-head').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(cover).not.toBe('rgba(0, 0, 0, 0)')
})

test('the caught-up user: empty state + NO chrome badge', async ({ page }) => {
  await login(page, EMPTY_EMAIL)
  // no badge on the chip (fail-silent / count-0 = nothing)
  await page.waitForTimeout(1500) // let the counts fetch settle
  await expect(page.locator('.rail-user-chip .chip-notif-badge')).toHaveCount(0)
  const label = await page.locator('.rail-user-chip').getAttribute('aria-label')
  expect(label).not.toContain('needing attention')
  await page.goto('/notifications.html')
  await expect(page.locator('.empty-state')).toBeVisible()
  await expect(page.locator('.empty-state-title')).toContainText('All caught up')
  // no filter chips for nothing to filter
  await expect(page.locator('.notif-chip-btn')).toHaveCount(0)
})

test('0 console errors + 0 page errors across the pass', async ({ page }) => {
  const consoleMsgs: string[] = []
  const pageErrors: string[] = []
  await login(page)
  // Listeners attach AFTER login: the login page's own pre-session /api/auth/me 401
  // is the auth guard working as designed, not a defect of this surface.
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.text()) })
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.goto('/notifications.html')
  await expect(page.locator('.notif-group[data-sev="info"]')).toBeVisible()
  await page.locator('.notif-chip-btn').nth(1).click()
  await page.locator('.notif-chip-btn').nth(0).click()
  expect(pageErrors).toEqual([])
  const benign = consoleMsgs.filter((m) => !/favicon|sourcemap/i.test(m))
  expect(benign).toEqual([])
})
