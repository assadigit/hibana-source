// e2e/s143-rail-live.spec.ts — S143 (owner: "currently the sidebar data is not updated
// when the page data changes … can't we make it same-time no refresh update?"): the rail
// panel follows every task mutation in the same beat, BOTH directions, no page reload.
//
// WHY: the rail panel read /api/rail ONCE at boot and cached it for the document's
// lifetime — a task completed on the board (or the dashboard rows, or the FAB quick-add)
// stayed visible in the sidebar until a physical refresh. nav.js now invalidates its
// cache and re-renders the OPEN section on 'hibana:tasks-changed' (detail.source
// 'board', dispatched by sadhana-page's api() and the app.js complete/add paths), and
// the panel's own checkboxes announce back (detail.source 'rail-panel') so the BOARD
// card follows the panel tick in the same beat. These pins hold both directions plus
// the no-reload canary (a live window flag must survive every assertion).
// Run: npx playwright test e2e/s143-rail-live.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s143@test.local'
const TEST_PASS = 'e2e-password-123'

// Seed the test user + three open quadrant-1 tasks (migrations auto-run on boot).
// alpha → board→rail pin · beta → rail→board pin · gamma → dashboard→rail pin.
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
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${id}'`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s143', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  for (const t of ['s143-alpha', 's143-beta', 's143-gamma']) {
    db.exec(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
       VALUES ('${t}', '${id}', 1, '${t} title', 0, 0, 0, 'untouched', '${now}', '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page) {
  // Suppress the onboarding coachmarks (the tour backdrop intercepts pointer clicks —
  // same gates resume-continue.spec.ts suppresses for its fresh e2e user), and persist
  // the todo panel so its boot restore opens it on every page this spec lands on.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.setItem('hibana-rail-panel', 'todo')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see sadhana.spec.ts): let the claim + reload settle.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// Open the board and wait for BOTH surfaces: the board boot (#boardLoading detached)
// and the persisted rail panel's todo rows (the boot restore polls for the panel host).
async function openBoardWithPanel(page: Page) {
  await page.goto('/to-do-list')
  await expect(page).toHaveTitle(/To-do list — Hibana/)
  await page.waitForSelector('#boardLoading', { state: 'detached', timeout: 10_000 })
  await page.waitForSelector('.rail-panel-body .rail-todo-item', { timeout: 10_000 })
}

test('completing a task on the BOARD removes it from the rail panel — no reload', async ({ page }) => {
  await login(page)
  await openBoardWithPanel(page)
  // reload canary: a live window flag must survive the whole flow (a physical
  // reload — the exact behavior this round replaces — would wipe it)
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s143 = 1 })
  const panelRow = page.locator('.rail-todo-item', { hasText: 's143-alpha title' })
  await expect(panelRow).toBeVisible()
  // the BOARD card's own done control (.t-check) — NOT the panel checkbox
  await page.locator('#tc-s143-alpha .t-check').click()
  // the panel's debounced /api/rail re-read re-renders the row away
  await expect(panelRow).toHaveCount(0, { timeout: 5_000 })
  // the board card archived away too (the togDone semantics) — same document throughout
  await expect(page.locator('#tc-s143-alpha')).toHaveCount(0, { timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s143)).toBe(1)
})

test('ticking the PANEL checkbox removes the BOARD card — no reload', async ({ page }) => {
  await login(page)
  await openBoardWithPanel(page)
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s143 = 1 })
  await expect(page.locator('#tc-s143-beta')).toBeVisible()
  // the PANEL's checkbox announces back (source 'rail-panel') — the board card follows
  await page.locator('.rail-check[data-rail-todo="s143-beta"]').check()
  // the S113 retire folds the panel row away…
  await expect(page.locator('.rail-todo-item', { hasText: 's143-beta title' })).toHaveCount(0, { timeout: 5_000 })
  // …and the board card leaves with the removing animation (the targeted update)
  await expect(page.locator('#tc-s143-beta')).toHaveCount(0, { timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s143)).toBe(1)
})

test('completing a DASHBOARD row updates the rail panel — no reload', async ({ page }) => {
  await login(page)
  await page.goto('/dashboard.html')
  await page.waitForSelector('.rail-panel-body .rail-todo-item', { timeout: 12_000 })
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s143 = 1 })
  const panelRow = page.locator('.rail-todo-item', { hasText: 's143-gamma title' })
  await expect(panelRow).toBeVisible()
  const dashCheck = page.locator('[data-task-complete="s143-gamma"]').first()
  await expect(dashCheck).toBeVisible()
  await dashCheck.click()
  // the app.js complete path announces 'board' — the panel re-renders the row away
  await expect(panelRow).toHaveCount(0, { timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s143)).toBe(1)
})
