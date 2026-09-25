// e2e/s122-overview-every-view.spec.ts — S122: the overview IS the projects home, in
// EVERY view.
//
// WHY THIS FILE EXISTS: S121 shipped the owner's wireframe (project-states carousel +
// overall-tasks donut + four recent boxes) but rendered it ONLY under view=grid — while
// the page REMEMBERS the view preference (hibana-projects-view, S45: "list stays list,
// kanban stays kanban"). The owner's browser had stored a non-grid preference, so they
// landed on their view and the wireframe's overview was nowhere in sight ("I don't see
// the new consolidated projects section"). The fix: the unfiltered home now OPENS with
// the overview in every view, the chosen view's body below it. This spec pins the parts
// a regression would silently break:
//   1. a remembered KANBAN preference still lands on the overview (and the board below
//      it — the overview must PREPEND, not replace)
//   2. a remembered CARDS preference ditto (overview above .card-grid)
//   3. a FILTERED home (?status=developing) keeps its focused render — no overview
//      noise while working a stage
//   4. a zero-projects account on a non-grid view still shows no overview (the S121
//      empty contract, now honored on the non-grid path too)
// Run: npx playwright test e2e/s122-overview-every-view.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const DB = '/tmp/hibana-e2e.db'
const PASS = 'e2e-password-123'
const MIN = 60_000

interface SeedUser { email: string; username: string; id: string; lang: 'en' | 'fa' }
const U_EN: SeedUser = { email: 'e2e-s122@test.local', username: 'e2e-s122', id: randomBytes(16).toString('hex'), lang: 'en' }
const U_NONE: SeedUser = { email: 'e2e-s122-none@test.local', username: 'e2e-s122-none', id: randomBytes(16).toString('hex'), lang: 'en' }

const P1 = 'e2e-s122-alpha'
const P2 = 'e2e-s122-beta'
const P3 = 'e2e-s122-gamma'

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
  for (const u of [U_EN, U_NONE]) await seedUser(db, u, nowIso)

  // EN user: 3 projects across stages + 4 OPEN tasks (one per pie bucket) — enough for
  // the carousel, a non-empty donut, and a non-empty board/grid below the overview.
  seedProject(db, U_EN.id, P2, 'S122 Beta', 'planning', 30, now)
  seedProject(db, U_EN.id, P1, 'S122 Alpha', 'developing', 60, now)
  seedProject(db, U_EN.id, P3, 'S122 Gamma', 'queued', 90, now)
  seedTask(db, P1, 't-s122-bug', 'Fix login loop', 'bug', 10, now)
  seedTask(db, P2, 't-s122-idea', 'Add dark mode', 'idea', 20, now)
  seedTask(db, P2, 't-s122-plan', 'Plan launch', 'planned', 15, now)
  seedTask(db, P1, 't-s122-ip', 'Build importer', 'in_progress', 5, now)
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

async function storeViewPref(page: import('@playwright/test').Page, v: string): Promise<void> {
  // The view preference rides localStorage — set it AFTER login (same origin), BEFORE
  // the projects page boots, exactly the way a returning owner's browser carries it.
  await page.evaluate((key) => localStorage.setItem('hibana-projects-view', key), v)
}

const CONSOLE_NOISE = [/Failed to load resource.*40[14]/]

function watchErrors(page: import('@playwright/test').Page, errors: string[]): void {
  page.on('console', (m) => { if (m.type() === 'error' && !CONSOLE_NOISE.some((re) => re.test(m.text()))) errors.push(m.text()) })
  page.on('pageerror', (err) => { if (!CONSOLE_NOISE.some((re) => re.test(err.message))) errors.push(err.message) })
}

test.use({ viewport: { width: 1280, height: 800 } })

test('remembered KANBAN preference: the BOARD leads, overview summary below it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EN.email)
  await storeViewPref(page, 'kanban')
  await page.goto('/projects.html')

  // the overview is present (S123: the carousel section is retired — the donut +
  // boxes ARE the overview; .ov-states must NOT render) …
  await expect(page.locator('.ov-tasks')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ov-states')).toHaveCount(0)
  await expect(page.locator('.ov-donut')).toHaveAttribute('aria-label', '4 open tasks across all projects')
  // … AND the remembered view's body renders too (S137: the BOARD is the first
  // section on the page — the overview follows BELOW it as the summary)
  await expect(page.locator('.kanban')).toBeVisible()
  await expect(page.locator('.kanban-col')).toHaveCount(5) // the five board stages (sparks live on the Ideas shelf)
  const ovY = (await page.locator('.ov-tasks').boundingBox())?.y ?? -1
  const kbY = (await page.locator('.kanban').boundingBox())?.y ?? -1
  expect(kbY).toBeGreaterThan(0)
  expect(ovY).toBeGreaterThan(kbY) // the board literally sits above the overview (S137 flip)
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('remembered CARDS preference ditto: overview above .card-grid', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EN.email)
  await storeViewPref(page, 'cards')
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.card-grid')).toBeVisible()
  await expect(page.locator('.card-grid .project-card')).toHaveCount(3)
  const ovY = (await page.locator('.ov-tasks').boundingBox())?.y ?? -1
  const gridY = (await page.locator('.card-grid').boundingBox())?.y ?? -1
  expect(gridY).toBeGreaterThan(ovY)
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('a FILTERED home keeps its focused render — no overview under ?status=', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_EN.email)
  await page.goto('/projects.html?status=developing')
  await expect(page.locator('.card-grid')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.card-grid .project-card')).toHaveCount(1) // only S122 Alpha
  await expect(page.locator('.ov-tasks')).toHaveCount(0)
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})

test('zero-projects account on a non-grid view: still no overview', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page, U_NONE.email)
  await storeViewPref(page, 'cards')
  await page.goto('/projects.html')
  // zero projects → the capture empty state renders (not .card-grid) and still NO overview
  await expect(page.locator('.empty-state')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.ov-tasks')).toHaveCount(0)
  expect(errors, 'console/page errors: ' + errors.join(' | ')).toEqual([])
})
