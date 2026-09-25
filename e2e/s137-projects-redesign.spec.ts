// e2e/s137-projects-redesign.spec.ts — S137: the projects home redesign.
//
// WHY THIS FILE EXISTS: the owner redesigned the projects overview page —
//   1. the KANBAN BOARD is the first section; the summary (donut + four status
//      cards) follows BELOW it (the other views keep the overview-first order),
//   2. «Queued» → «Up Next» and «Awaiting Development» → «On Hold» everywhere,
//   3. ONE canonical --st-* color token per status (variables.css) referenced
//      identically by the kanban column head dots, the status badges and the
//      overview donut segments/legend swatches — the chart no longer hardcodes
//      its own shade of a status,
//   4. the kanban card surface is the page's WHITE card (var(--card), the exact
//      surface the summary cards wear) — the per-status tinted fills are gone,
//      status signaling lives on the head dot + count pill and the badges.
// These pins guard the parts a regression would silently break: the section
// order, the dot+count head anatomy, the card surface, the renames (EN + FA),
// and the cross-surface token EQUALITY (board dot == chart swatch for the same
// status — computed styles, so a re-hardcoded shade fails the pin).
// Run: npx playwright test e2e/s137-projects-redesign.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const DB = '/tmp/hibana-e2e.db'
const PASS = 'e2e-password-123'
const MIN = 60_000

interface SeedUser { email: string; username: string; id: string; lang: 'en' | 'fa' }
const U_EN: SeedUser = { email: 'e2e-s137@test.local', username: 'e2e-s137', id: randomBytes(16).toString('hex'), lang: 'en' }
const U_FA: SeedUser = { email: 'e2e-s137-fa@test.local', username: 'e2e-s137-fa', id: randomBytes(16).toString('hex'), lang: 'fa' }

const P = {
  planning: 'e2e-s137-p-pl',
  queued: 'e2e-s137-p-qu',
  developing: 'e2e-s137-p-de',
  awaiting: 'e2e-s137-p-aw',
  operational: 'e2e-s137-p-op',
}

async function openDb(): Promise<import('node:sqlite').DatabaseSync> {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(DB)
}

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

test.beforeAll(async () => {
  const db = await openDb()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  for (const u of [U_EN, U_FA]) await seedUser(db, u, nowIso)
  // One project per stage + open tasks in every donut bucket (the token-equality
  // pins need a live segment AND a live board for the same status hue).
  seedProject(db, U_EN.id, P.planning, 'S137 Planning', 'planning', 30, now)
  seedProject(db, U_EN.id, P.queued, 'S137 Up Next', 'queued', 60, now)
  seedProject(db, U_EN.id, P.developing, 'S137 Developing', 'developing', 90, now)
  seedProject(db, U_EN.id, P.awaiting, 'S137 On Hold', 'awaiting_dev', 120, now)
  seedProject(db, U_EN.id, P.operational, 'S137 Operational', 'operational', 150, now)
  seedTask(db, P.planning, 's137-t-idea', 'S137 idea task', 'idea', 20, now)
  seedTask(db, P.queued, 's137-t-plan', 'S137 plan task', 'planned', 15, now)
  seedTask(db, P.developing, 's137-t-prog', 'S137 prog task', 'in_progress', 5, now)
  seedTask(db, P.operational, 's137-t-bug', 'S137 bug task', 'bug', 10, now)
  // FA user: one queued project — the renamed column must read «بعدی»
  seedProject(db, U_FA.id, 'e2e-s137-fa-p', 'پروژهٔ آزمون', 'queued', 40, now)
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

test('EN kanban home: board first, dot+count heads, white cards, renamed labels', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EN.email)
  await page.goto('/projects.html?view=kanban')
  await expect(page.locator('.kanban-col')).toHaveCount(5, { timeout: 15_000 })

  // 1. the BOARD leads; the summary follows below it
  const kbY = (await page.locator('.kanban').boundingBox())?.y ?? -1
  const ovY = (await page.locator('.ov-tasks').boundingBox())?.y ?? -1
  expect(kbY).toBeGreaterThan(0)
  expect(ovY).toBeGreaterThan(kbY)

  // 2. the head anatomy: [dot] [label] [count pill] — renamed labels, no badge
  const heads = page.locator('.kanban-col-head')
  await expect(heads).toHaveCount(5)
  await expect(page.locator('.kanban-col[data-status="queued"] .kanban-col-label')).toHaveText('Up Next')
  await expect(page.locator('.kanban-col[data-status="awaiting_dev"] .kanban-col-label')).toHaveText('On Hold')
  await expect(page.locator('.kanban-col[data-status="planning"] .kanban-dot')).toBeVisible()
  await expect(page.locator('.kanban-col[data-status="queued"] .board-count')).toHaveText('1')
  await expect(page.locator('.kanban-col .kanban-col-head .badge')).toHaveCount(0)

  // 3. the card surface is the page WHITE — every card, no per-status tint
  const cardBgs = await page.$$eval('.kanban-col .kanban-card', (els) => els.map((el) => getComputedStyle(el).backgroundColor))
  expect(cardBgs.length).toBeGreaterThan(0)
  for (const bg of cardBgs) expect(bg, 'kanban card must be white').toBe('rgb(255, 255, 255)')

  // 4. one token per status ACROSS surfaces: the board dot and the donut legend
  //    swatch of the same status resolve to the SAME computed color (both reference
  //    the --st-* token; a re-hardcoded shade breaks this pin)
  const eq = await page.evaluate(() => {
    const cc = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : null)
    const pairs: Array<[string, string]> = [
      ['.kanban-dot[data-status="planning"]', '.ov-dot[data-st="planned"]'],
      ['.kanban-dot[data-status="developing"]', '.ov-dot[data-st="in_progress"]'],
    ]
    return pairs.map(([a, b]) => ({
      a: cc(document.querySelector(a), 'background-color'),
      b: cc(document.querySelector(b), 'background-color'),
    }))
  })
  for (const pair of eq) expect(pair.a, 'board dot == chart swatch').not.toBeNull()
  for (const pair of eq) expect(pair.a).toBe(pair.b)
  // the donut segment and its legend swatch share the token too
  const segIdea = await page.evaluate(() => ({
    seg: getComputedStyle(document.querySelector('.ov-seg[data-st="idea"]')!).stroke,
    dot: getComputedStyle(document.querySelector('.ov-dot[data-st="idea"]')!).backgroundColor,
  }))
  expect(segIdea.seg).toBe(segIdea.dot)

  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('EN cards view: the status badges carry the renamed labels', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EN.email)
  await page.goto('/projects.html?view=cards')
  await expect(page.locator('.card-grid .project-card').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.badge-queued').first()).toHaveText(/Up Next/)
  await expect(page.locator('.badge-awaiting_dev').first()).toHaveText(/On Hold/)
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('FA kanban home: بعدی / متوقف column labels + Persian count digits', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_FA.email)
  await page.goto('/projects.html?view=kanban')
  await expect(page.locator('.kanban-col')).toHaveCount(5, { timeout: 15_000 })
  await expect(page.locator('.kanban-col[data-status="queued"] .kanban-col-label')).toHaveText('بعدی')
  await expect(page.locator('.kanban-col[data-status="awaiting_dev"] .kanban-col-label')).toHaveText('متوقف')
  const digits = await page.locator('.kanban-col[data-status="queued"] .board-count').textContent()
  expect(digits).toBe('۱')
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})
