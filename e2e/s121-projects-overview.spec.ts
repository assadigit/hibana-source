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
  for (const u of [U_EN, U_FA, U_EMPTY, U_NONE]) await seedUser(db, u, nowIso)

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
