// e2e/todo-click-region.spec.ts — S82: the dashboard to-do completion hit-region.
//
// WHY THIS FILE EXISTS (S82, owner report: "clicking anywhere on a to-do task
// finishes it — miss-clicks lose the task"): the row used to be a <label
// data-task-complete> wrapping checkbox + TITLE, so ANY click inside it (the title
// included) completed the task. The row is now a plain div and the completion id
// rides on the checkbox input itself — only the checkbox (and its ≥40px ::before
// hit island) toggles completion. These specs pin the three faces of that contract:
//   1. a TITLE click never completes (the row survives, no API call fired)
//   2. a CHECKBOX click completes (the row enters is-completing, the task flips done)
//   3. the ::before hit ISLAND is real hit-test area (a click ~9px off the 16.8px
//      checkbox, inside the -0.85rem island, still completes) — pseudo-elements on
//      <input> only render in Chromium 105+, which is why this is Chromium-only.
// Run: npx playwright test e2e/todo-click-region.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-todoclick@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'

// Seed the test user + three OPEN quadrant-1 tasks before tests run (migrations
// auto-run on server boot; the dashboard's htmx /api/dashboard fetch renders them).
test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
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
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${id}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-todoclick', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // three distinct OPEN tasks so each spec clicks its own row without interference
  for (let i = 0; i < 3; i++) {
    db.exec(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
       VALUES ('${randomBytes(16).toString('hex')}', '${id}', 1, 'e2e click region ${i}', 0, 0, ${i}, 'untouched', '${now}', '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see viewport.spec.ts): settle before navigating.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// The dashboard's todo quadrants arrive via htmx (hx-get="/api/dashboard") — healthy
// boot = the skeleton is gone and our seeded quadrant-1 rows rendered.
async function openDashboard(page: Page) {
  await page.goto('/app')
  await page.waitForSelector('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-task', { timeout: 10_000 })
}

// 401s from /api/auth/me before login + the SW navigation probe are expected.
const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
]
const trackErrors = (page: Page) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })
  return errors
}

test('TITLE click never completes the task (the S82 miss-click regression pin)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page)
  await openDashboard(page)

  const row = page.locator('.dash-todo-task', { hasText: 'e2e click region 0' })
  await expect(row).toBeVisible()

  // Watch the completion POST — a title click must NEVER fire it.
  let completeCalls = 0
  page.on('request', (req) => {
    if (req.url().includes('/api/sadhana/tasks/') && req.url().endsWith('/complete') && req.method() === 'POST') completeCalls++
  })

  // 1. click dead-center on the TITLE text
  await row.locator('span[data-task-title]').click()
  await page.waitForTimeout(600)
  // 2. click the row's whitespace too (the old label's padding zone)
  await row.locator('.dash-todo-check').click({ position: { x: 100, y: 22 } })
  await page.waitForTimeout(600)

  // the row never entered the completing state, the checkbox never flipped
  await expect(row).not.toHaveClass(/is-completing/)
  await expect(row.locator('input[data-task-complete]')).not.toBeChecked()
  expect(completeCalls).toBe(0)
  expect(errors).toEqual([])
})

test('CHECKBOX click completes the task', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page)
  await openDashboard(page)

  const row = page.locator('.dash-todo-task', { hasText: 'e2e click region 1' })
  await expect(row).toBeVisible()
  const taskId = await row.locator('input[data-task-complete]').getAttribute('data-task-complete')

  await row.locator('input[data-task-complete]').click()

  // the row enters the completing state immediately (the delegated handler caught it)
  await expect(row).toHaveClass(/is-completing/, { timeout: 3_000 })
  // the DB is the source of truth: the task flips done=1
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  await expect
    .poll(async () => (db.prepare('SELECT done FROM sadhana_tasks WHERE id = ?').get(taskId) as { done: number } | undefined)?.done, { timeout: 5_000 })
    .toBe(1)
  db.close()
  expect(errors).toEqual([])
})

test('the ::before hit island extends the checkbox target (Chromium pseudo-element hit test)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium renders ::before on <input>; Firefox/Safari do not — the 16.8px bare checkbox still works there')
  const errors = trackErrors(page)

  await login(page)
  await openDashboard(page)

  const row = page.locator('.dash-todo-task', { hasText: 'e2e click region 2' })
  await expect(row).toBeVisible()
  const box = await row.locator('input[data-task-complete]').boundingBox()
  expect(box).not.toBeNull()

  // ~9px diagonally off the checkbox center: OUTSIDE the 16.8px visual box,
  // INSIDE the -0.85rem (13.6px) ::before island. If the pseudo-element renders,
  // hit-testing lands on the input and the delegated handler fires.
  await page.mouse.click(box!.x + box!.width / 2 + 9, box!.y + box!.height / 2 + 9)

  await expect(row).toHaveClass(/is-completing/, { timeout: 3_000 })
  expect(errors).toEqual([])
})
