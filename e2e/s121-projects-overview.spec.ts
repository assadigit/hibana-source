// e2e/s121-projects-overview.spec.ts — S121: the projects home becomes the OVERVIEW.
//
// WHY THIS FILE EXISTS: the owner drew a wireframe — "an overall view of all projects":
// an overall-tasks pie + four recent boxes (problems / in-progress / ideas / plans —
// the EXISTING rail vocabulary, per the owner's note that the wireframe labels were
// draft placeholders). The pure home now renders the server-side overview sections;
// this spec pins the parts a regression would silently break:
//   1. the donut counts OPEN tasks only (done rows must not leak into the pie) and
//      the four recent boxes carry the newest item of their status, linking to the
//      owning project
//   2. the FA user gets the rail's own Persian vocabulary + Persian digits (parity is
//      not just key-count — the overview is data-dense, digits and labels both show)
//   3. the empty states stay honest: zero tasks → 'Nothing here' boxes; zero projects
//      → NO overview sections at all
// S123: the original project-states CAROUSEL pins (card order, chips, paging) are
// RETIRED with the feature — the owner asked for the card strip to go; the donut +
// boxes ARE the overview now.
// S126: the status cards CAP at the 3 most recently updated items (no internal
// scroller), their headers carry a View all link, and that link lands on the new
// /tasks.html?status=… page (the ov-tasks fragment) which lists EVERYTHING. The
// metadata line wears the project's stage dot, truncated titles carry title+
// data-full recovery, the bug bubble is a glyph+count chip, and the whole anatomy
// mirrors in FA/RTL via logical properties (text-align: start, not left).
// Run: npx playwright test e2e/s121-projects-overview.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const DB = '/tmp/hibana-e2e.db'
const PASS = 'e2e-password-123'
const MIN = 60_000

interface SeedUser { email: string; username: string; id: string; lang: 'en' | 'fa' }
const U_EN: SeedUser = { email: 'e2e-s121@test.local', username: 'e2e-s121', id: randomBytes(16).toString('hex'), lang: 'en' }
const U_FA: SeedUser = { email: 'e2e-s121-fa@test.local', username: 'e2e-s121-fa', id: randomBytes(16).toString('hex'), lang: 'fa' }
const U_EMPTY: SeedUser = { email: 'e2e-s121-empty@test.local', username: 'e2e-s121-empty', id: randomBytes(16).toString('hex'), lang: 'en' }
const U_NONE: SeedUser = { email: 'e2e-s121-none@test.local', username: 'e2e-s121-none', id: randomBytes(16).toString('hex'), lang: 'en' }
const U_CAP: SeedUser = { email: 'e2e-s121-cap@test.local', username: 'e2e-s121-cap', id: randomBytes(16).toString('hex'), lang: 'en' }

const P1 = 'e2e-s121-alpha'
const P2 = 'e2e-s121-beta'
const P3 = 'e2e-s121-gamma'

async function seedUser(db: Awaited<ReturnType<typeof openDb>>, u: SeedUser, now: string): Promise<void> {
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const hash = `pbkdf2$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`
  db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id = '${u.id}')`)
  db.exec(`DELETE FROM projects WHERE user_id = '${u.id}'`)
  db.exec(`DELETE FROM users WHERE email = '${u.email}'`)
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${u.id}', '${u.username}', '${u.email}', '${hash.replace(/'/g, "''")}', 'owner', '${u.lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
}

function seedProject(db: Awaited<ReturnType<typeof openDb>>, uid: string, id: string, title: string, status: string, ageMin: number, now: number): void {
  const ts = new Date(now - ageMin * MIN).toISOString()
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${id}', '${uid}', '${title}', '', 'personal', '${status}', 0, '${ts}', '${ts}')`,
  )
}

function seedTask(db: Awaited<ReturnType<typeof openDb>>, pid: string, id: string, title: string, status: string, ageMin: number, now: number): void {
  const ts = new Date(now - ageMin * MIN).toISOString()
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${id}', '${pid}', '${title}', '${status}', 'medium', 0, '${ts}')`,
  )
}

async function openDb(): Promise<import('node:sqlite').DatabaseSync> {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(DB)
}

test.beforeAll(async () => {
  const db = await openDb()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  for (const u of [U_EN, U_FA, U_EMPTY, U_NONE, U_CAP]) await seedUser(db, u, nowIso)

  // EN user: 3 projects (Beta is the newest touch), 7 tasks of which 6 are OPEN
  // (the done one must stay out of every count) — total pie = 6.
  seedProject(db, U_EN.id, P2, 'S121 Beta', 'planning', 30, now)
  seedProject(db, U_EN.id, P1, 'S121 Alpha', 'developing', 60, now)
  seedProject(db, U_EN.id, P3, 'S121 Gamma', 'operational', 90, now)
  seedTask(db, P1, 't-bug-1', 'Fix login loop', 'bug', 10, now)
  seedTask(db, P3, 't-bug-2', 'Crash on export', 'bug', 50, now)
  seedTask(db, P2, 't-idea-1', 'Add dark mode', 'idea', 20, now)
  seedTask(db, P1, 't-idea-2', 'Voice notes', 'idea', 40, now)
  seedTask(db, P2, 't-plan-1', 'Plan launch', 'planned', 15, now)
  seedTask(db, P1, 't-ip-1', 'Build importer', 'in_progress', 5, now)
  seedTask(db, P1, 't-done-1', 'Old done task', 'done', 120, now)

  // FA user: one project, one bug, one idea — labels + Persian digits pinned
  seedProject(db, U_FA.id, 'e2e-s121-fa-p', 'پروژهٔ آزمون', 'developing', 20, now)
  seedTask(db, 'e2e-s121-fa-p', 't-fa-bug', 'رفع خطای ورود', 'bug', 10, now)
  seedTask(db, 'e2e-s121-fa-p', 't-fa-idea', 'یادداشت صوتی', 'idea', 8, now)

  // EMPTY user: a project but zero tasks — honest zeros, no crash, no ghost chips
  seedProject(db, U_EMPTY.id, 'e2e-s121-hollow', 'S121 Hollow', 'queued', 45, now)

  // CAP user (S126): five planned tasks born 5..25 minutes ago + one bug — the box
  // must show exactly 3 (newest-born first; nothing edited here) with the rest one
  // View all click away, and the bug bubble rides the Developing kanban row as a
  // glyph+count chip.
  seedProject(db, U_CAP.id, 'e2e-s121-cap-p', 'S121 Cap Project', 'developing', 40, now)
  seedTask(db, 'e2e-s121-cap-p', 't-cap-plan-1', 'cap plan 1', 'planned', 25, now)
  seedTask(db, 'e2e-s121-cap-p', 't-cap-plan-2', 'cap plan 2', 'planned', 20, now)
  seedTask(db, 'e2e-s121-cap-p', 't-cap-plan-3', 'cap plan 3', 'planned', 15, now)
  seedTask(db, 'e2e-s121-cap-p', 't-cap-plan-4', 'cap plan 4', 'planned', 10, now)
  seedTask(db, 'e2e-s121-cap-p', 't-cap-plan-5', 'cap plan 5', 'planned', 5, now)
  seedTask(db, 'e2e-s121-cap-p', 't-cap-bug-1', 'cap bug 1', 'bug', 3, now)
  db.close()
})

async function login(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/login.html')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', email)
  await page.fill('input[name="password"]', PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

const CONSOLE_NOISE = [/Failed to load resource.*40[14]/]

function watchErrors(page: import('@playwright/test').Page, errors: string[]): void {
  page.on('console', (m) => { if (m.type() === 'error' && !CONSOLE_NOISE.some((re) => re.test(m.text()))) errors.push(m.text()) })
  page.on('pageerror', (err) => { if (!CONSOLE_NOISE.some((re) => re.test(err.message))) errors.push(err.message) })
}

test.use({ viewport: { width: 1280, height: 800 } })

test('EN overview: donut totals + box order and links', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EN.email)
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toBeVisible({ timeout: 15_000 })

  // 1) donut: OPEN tasks only (6 — the done row is invisible to it)
  const donut = page.locator('.ov-donut')
  await expect(donut).toHaveAttribute('aria-label', '6 open tasks across all projects')
  await expect(page.locator('.ov-legend [data-st="bug"] .ov-leg-n')).toHaveText('2')
  await expect(page.locator('.ov-legend [data-st="planned"] .ov-leg-n')).toHaveText('1')
  await expect(page.locator('.ov-legend [data-st="idea"] .ov-leg-n')).toHaveText('2')
  await expect(page.locator('.ov-legend [data-st="in_progress"] .ov-leg-n')).toHaveText('1')
  await expect(page.locator('.ov-seg')).toHaveCount(4) // every bucket is non-zero → 4 slices

  // 2) the four boxes, wireframe order, newest-first items linking to their project
  const boxes = page.locator('.ov-box')
  await expect(boxes).toHaveCount(4)
  await expect(boxes.nth(0)).toHaveAttribute('data-ov-box', 'bug')
  await expect(boxes.nth(1)).toHaveAttribute('data-ov-box', 'in_progress')
  await expect(boxes.nth(2)).toHaveAttribute('data-ov-box', 'idea')
  await expect(boxes.nth(3)).toHaveAttribute('data-ov-box', 'planned')
  const firstBug = boxes.nth(0).locator('.ov-item').first()
  await expect(firstBug).toContainText('Fix login loop') // born 10m ago beats the 50m one
  await expect(firstBug).toHaveAttribute('href', `/project.html?id=${P1}`)
  await expect(boxes.nth(1).locator('.ov-item')).toHaveCount(1)
  await expect(boxes.nth(1).locator('.ov-item')).toContainText('Build importer')
  // the done task appears NOWHERE (open-only feeds)
  const boxTexts = (await boxes.allTextContents()).join('\n')
  expect(boxTexts).not.toContain('Old done task')

  // S126 item anatomy: full-text recovery (native title on the truncated span +
  // data-full on the anchor for the focus tooltip) + the stage-dot metadata line
  // + a View all link on every box header
  await expect(firstBug.locator('.ov-item-title')).toHaveAttribute('title', 'Fix login loop')
  await expect(firstBug).toHaveAttribute('data-full', 'Fix login loop')
  await expect(firstBug.locator('.ov-proj-dot')).toHaveAttribute('data-stage', /developing|planning|operational/)
  for (let i = 0; i < 4; i++) {
    await expect(boxes.nth(i).locator('.ov-viewall')).toHaveAttribute('href', new RegExp(`/tasks.html\\?status=(bug|in_progress|idea|planned)$`))
  }

  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('FA overview: the rail\'s own Persian vocabulary + Persian digits', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_FA.email)
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#ov-tasks-h')).toHaveText('کارهای همهٔ پروژه‌ها')
  const donut = page.locator('.ov-donut')
  await expect(donut).toHaveAttribute('aria-label', '۲ کار باز در همهٔ پروژه‌ها')
  await expect(page.locator('.ov-legend [data-st="bug"] .ov-leg-label')).toHaveText('مشکلات')
  await expect(page.locator('.ov-legend [data-st="idea"] .ov-leg-label')).toHaveText('ایده‌ها')
  await expect(page.locator('.ov-legend [data-st="bug"] .ov-leg-n')).toHaveText('۱')
  await expect(page.locator('.ov-box[data-ov-box="bug"] .ov-item').first()).toContainText('رفع خطای ورود')
  // S126 RTL belt: the truncation + metadata line mirror — computed direction is
  // rtl and the alignment speaks logical start (resolves RIGHT in FA), never a
  // physical left. The metadata line steps down below the title's size.
  const faTitle = page.locator('.ov-box[data-ov-box="bug"] .ov-item-title').first()
  expect(await faTitle.evaluate((el) => getComputedStyle(el).textAlign)).toBe('start')
  expect(await faTitle.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  const faTitlePx = await faTitle.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  const faProjPx = await page.locator('.ov-box[data-ov-box="bug"] .ov-item-proj').first().evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(faProjPx).toBeLessThan(faTitlePx)
  // S126 View all (FA): the reachable path speaks Persian
  await expect(page.locator('.ov-box[data-ov-box="bug"] .ov-viewall')).toHaveText('مشاهده همه')
  // and the destination page mirrors too (fragment heading + item, RTL-safe)
  await page.goto('/tasks.html?status=bug')
  await expect(page.locator('.ovt[data-ovt-status="bug"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ovt-h')).toContainText('مشکلات')
  await expect(page.locator('.ovt-row')).toHaveCount(1)
  await expect(page.locator('.ovt-row').first()).toContainText('رفع خطای ورود')
  expect(await page.locator('.ovt-list').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('empty states: zero tasks shows honest zeros; zero projects shows no overview', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EMPTY.email)
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ov-donut')).toHaveAttribute('aria-label', '0 open tasks across all projects')
  await expect(page.locator('.ov-seg')).toHaveCount(0) // an empty gauge, not a fake full ring
  await expect(page.locator('.ov-empty')).toHaveCount(4)
  await expect(page.locator('.ov-item')).toHaveCount(0)
  // the S121 carousel is retired (S123): no card strip, no state chips anywhere
  await expect(page.locator('.ov-card')).toHaveCount(0)
  await expect(page.locator('.ov-states')).toHaveCount(0)
  // zero-projects user: the overview sections never render at all
  await login(page, U_NONE.email)
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toHaveCount(0)
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('S126: cards cap at 3 (no scroller), full-width row, View all reaches the rest, distinct badges', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_CAP.email)
  await page.goto('/dashboard.html')
  const lower = page.locator('.dash-proj-lower')
  await expect(lower).toBeVisible({ timeout: 15_000 })

  // 1) cap: exactly 3 planned rows, newest-born first, and NO internal scrollbar
  const plannedBox = lower.locator('[data-ov-box="planned"]')
  await expect(plannedBox.locator('.ov-item')).toHaveCount(3)
  await expect(plannedBox.locator('.ov-item').first()).toContainText('cap plan 5')
  const scrollHeights = await plannedBox.locator('.ov-items').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  expect(scrollHeights.sh).toBeLessThanOrEqual(scrollHeights.ch + 1)

  // 2) the ≥900px row distributes evenly and consumes the container's full width
  //    (no dead gap after the last card)
  const cards = lower.locator('> .card')
  const geo = await cards.evaluateAll((els) => {
    const rects = els.map((e) => e.getBoundingClientRect())
    const lower2 = (els[0].parentElement as HTMLElement).getBoundingClientRect()
    const widths = rects.map((r) => r.width)
    const spread = Math.max(...widths) - Math.min(...widths)
    return { rightGap: lower2.right - rects[rects.length - 1].right, spread }
  })
  expect(geo.spread).toBeLessThan(3) // four equal tracks
  expect(geo.rightGap).toBeLessThan(4) // the row ends where the container ends

  // 3) badge collision resolved: the row badge (bug chip) is a rounded-square with a
  //    glyph, the header count a bare circular pill
  const bubble = page.locator('.stat-kanban-card .bug-bubble').first()
  await expect(bubble).toBeVisible()
  await expect(bubble.locator('svg')).toBeVisible()
  const bubbleRadius = await bubble.evaluate((el) => getComputedStyle(el).borderRadius)
  expect(bubbleRadius).not.toBe('999px')
  const headerN = plannedBox.locator('.board-count.ov-box-n')
  await expect(headerN).toBeVisible()
  expect(await headerN.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px')

  // 4) View all: one click reaches EVERY item the cap hid (all 5 plans)
  await plannedBox.locator('.ov-viewall').click()
  await expect(page.locator('.ovt[data-ovt-status="planned"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ovt-row')).toHaveCount(5)
  await expect(page.locator('.ovt-row').first()).toContainText('cap plan 5')
  await expect(page.locator('.ovt-switch-chip.is-active')).toHaveText('Plans')

  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})
