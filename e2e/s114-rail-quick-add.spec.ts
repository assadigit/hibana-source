// e2e/s114-rail-quick-add.spec.ts — S114: the to-do panel's QUICK-ADD row.
//
// The two-jobs rule, job #1 — "never lose an idea": capture a task into any
// quadrant STRAIGHT FROM THE SIDEBAR, no board trip. One form (quadrant picker +
// borderless input + round + submit) rides EVERY panel state — open groups, the
// S113 all-clear finish line, and the nothing-yet empty. Submit POSTs the board's
// own create endpoint (/api/sadhana/tasks, {title, quadrant}), the panel
// re-renders from the updated cache (the Undo path's recipe), and the input lands
// EMPTY + FOCUSED so ideas keep flowing. Escape clears the DRAFT before it can
// close the panel (capture-phase listener); an empty submit is a quiet no-op.
//
// Run: npx playwright test e2e/s114-rail-quick-add.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-add@test.local'
const TEST_PASS = 'e2e-password-123'
let seedUserId = ''

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
  seedUserId = id
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-add', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // Two OPEN tasks in two quadrants — the panel has real groups to receive a
  // quick-added row, and the all-clear test has exactly two ticks to make.
  db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${id}'`)
  const today = now.slice(0, 10)
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, due_date, done, position, created_at, updated_at)
     VALUES ('${id}-t1', '${id}', 1, 'Add seed today task', '${today}', 0, 1, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, due_date, done, position, created_at, updated_at)
     VALUES ('${id}-t3', '${id}', 3, 'Add seed urgent task', NULL, 0, 2, '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // The first-visit tour overlay is a pointer-events wall — suppress it (the S85
  // recipe: BOTH suppression keys, tour + ln).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
  await page.evaluate(() => { try { localStorage.removeItem('hibana-rail-panel') } catch { /* storage blocked */ } })
}

async function openTodoPanel(page: Page) {
  await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
  await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')
  await expect(page.locator('.rail-group-head', { hasText: 'Today' })).toBeVisible()
}

test.describe('the to-do panel quick-add (S114 — never lose an idea)', () => {
  test('the panel grows a quick-add row: picker (default quadrant order), placeholder, round + submit', async ({ page }) => {
    await login(page)
    await openTodoPanel(page)
    const form = page.locator('[data-rail-add]')
    await expect(form).toBeVisible()
    // The picker defaults to the user's FIRST quadrant (order 1,3,2,4 → Today)
    // and lists all four in the saved order.
    const picker = form.locator('[data-rail-add-picker]')
    await expect(picker).toBeVisible()
    const labels = await picker.locator('option').allInnerTexts()
    expect(labels).toEqual(['Today', 'Urgent & High Value', 'Strategic', 'Personal & Sentimental'])
    await expect(picker).toHaveValue('1')
    // The input carries the placeholder + a11y label; the submit is a labeled
    // round + button.
    await expect(form.locator('[data-rail-add-input]')).toBeVisible()
    await expect(form.locator('[data-rail-add-input]')).toHaveAttribute('placeholder', 'New task…')
    await expect(form.locator('[data-rail-add-btn]')).toHaveAttribute('aria-label', 'Add task')
    // The leading dot exists (its color is CSS — visually QA'd, not pinnable here).
    await expect(form.locator('.rail-add-dot')).toBeVisible()
  })

  test('typing + Enter captures the task under the PICKED quadrant, toasts, and refocuses an EMPTY input', async ({ page }) => {
    await login(page)
    await openTodoPanel(page)
    const form = page.locator('[data-rail-add]')
    // Pick STRATEGIC (quadrant 2) and capture.
    await form.locator('[data-rail-add-picker]').selectOption('2')
    const input = form.locator('[data-rail-add-input]')
    await input.fill('Rail quick add task')
    await input.press('Enter')
    // The toast announces the capture…
    await expect(page.locator('#toast')).toContainText('Task added')
    // …the row LANDS inside the Strategic group…
    const strategic = page.locator('.rail-group', { hasText: 'Strategic' })
    await expect(strategic.locator('.rail-todo-item', { hasText: 'Rail quick add task' })).toHaveCount(1)
    // …the input re-focuses EMPTY (capture loop — the next idea starts clean)…
    const fresh = page.locator('[data-rail-add-input]')
    await expect(fresh).toHaveValue('')
    await expect(fresh).toBeFocused()
    // …the picker HOLDS the last-picked quadrant (S114 r2 — a capture loop stays
    // on the list you're filling; a second idea needs zero re-picking)…
    await expect(page.locator('[data-rail-add-picker]')).toHaveValue('2')
    // …and the task PERSISTED through the board's own create endpoint (the rail
    // payload now carries it, open, in quadrant 2).
    const rail = await page.request.get('/api/rail')
    expect(rail.status()).toBe(200)
    const data = await rail.json()
    const row = (data.todos as Array<{ title: string; quadrant: number; done: number }>).find((t) => t.title === 'Rail quick add task')
    expect(row).toBeTruthy()
    expect(row!.quadrant).toBe(2)
    expect(row!.done).toBe(0)
  })

  test('an EMPTY submit is a quiet no-op — nothing sent, focus stays, panel stays', async ({ page }) => {
    await login(page)
    await openTodoPanel(page)
    const rows = await page.locator('.rail-todo-item').count()
    const input = page.locator('[data-rail-add-input]')
    await input.press('Enter')
    // No toast, no row count change, no disabled-state churn — just focus back.
    await page.waitForTimeout(400)
    await expect(page.locator('.rail-todo-item')).toHaveCount(rows)
    await expect(input).toBeFocused()
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
  })

  test('Escape clears the DRAFT first; a second Escape closes the panel (the idea is never lost, the place either)', async ({ page }) => {
    await login(page)
    await openTodoPanel(page)
    const input = page.locator('[data-rail-add-input]')
    await input.fill('draft idea')
    await page.keyboard.press('Escape')
    // The draft is gone…
    await expect(input).toHaveValue('')
    // …but the PANEL IS STILL OPEN (the capture-phase handler ate the keypress).
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
    // An empty-input Escape falls through to the panel's own close.
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
  })

  test('the quick-add row rides the ALL-CLEAR state too — capture is what an empty list is for', async ({ page }) => {
    await login(page)
    await openTodoPanel(page)
    // Tick every open task (the list mutates as rows fold — re-resolve the FIRST
    // remaining checkbox each pass; the fold settles in ~360ms).
    await expect(page.locator('.rail-todo-item input[data-rail-todo]').first()).toBeVisible()
    for (let guard = 0; guard < 6; guard++) {
      const remaining = page.locator('.rail-todo-item input[data-rail-todo]')
      if ((await remaining.count()) === 0) break
      await remaining.first().check()
      await page.waitForTimeout(480)
    }
    // The S113 finish line shows…
    const clear = page.locator('.rail-todo-clear')
    await expect(clear).toBeVisible()
    await expect(clear).toContainText('All clear — every task here is done.')
    // …and the capture row RIDES it — the fastest path back to work is right there.
    await expect(page.locator('[data-rail-add]')).toBeVisible()
    // Restore the seeded state (this file runs serially through one server) — the
    // same /uncomplete endpoint the panel's Undo speaks, via the page's own fetch
    // (the API's origin guard 403s the out-of-page request context).
    await page.evaluate(async (uid) => {
      for (const suffix of ['t1', 't3']) {
        await fetch(`/api/sadhana/tasks/${uid}-${suffix}/uncomplete`, { method: 'POST', credentials: 'same-origin' })
      }
    }, seedUserId)
  })
})
