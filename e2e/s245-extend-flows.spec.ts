// e2e/s245-extend-flows.spec.ts — S245 (spec pack PHASE 6 — the deadline
// EXTENSION flows, spec §13 + Screens J1/J2/J3). Pure PATCH orchestration over
// the Phase 1+2 write surface — this spec pins the FLOWS end-to-end:
//   1. J1 (§13.2 + Screen J1): the sprint-deadline extension from the compact
//      Kanban overview — the dialog shows the sprint identity + the current
//      deadline + the BEFORE-confirmation impact counts (N inheritors follow /
//      M overrides protected); a +48h preset ADDS TO THE EXISTING deadline
//      (§13.1 — never to the current moment); after the Confirm the sprint's
//      due_at moved exactly +48h, its due_origin_at is UNCHANGED (§13.2's
//      no-reset), every inheritor's effective_due_at followed, the override's
//      did NOT, and another sprint's tasks did NOT.
//   2. J2 (§13.3 + Screen J2): the personal task-deadline extension from the
//      card deadline row's Extend affordance — only that task changes, its
//      due_origin_at survives (value→value preserves).
//   3. J3 task-only (§13.4 + Screen J3): an INHERITED row's Extend opens the
//      CHOICE modal (two clearly distinct paths, the scope visible); the
//      task-only arm creates the override based on the CURRENT INHERITED
//      deadline + the extension, riding the SPRINT'S due_origin_at (the §13.4
//      origin-preservation invariant — the bar does not reset); the sprint and
//      the other inheritors are untouched.
//   4. J3 sprint-wide (§13.4): the choice's sprint arm reuses the J1 dialog
//      (with its counts) — the sprint-wide effects.
//   5. The Custom date arm (§13.1): the SHARED D6 control, pre-loaded with the
//      current value — the picked day resolves to LOCAL 23:59.
//   6. FA/RTL (§17): the dialogs localize (Persian copy), the card mirrors,
//      and the choice arms read distinctly in the mirrored layout.
// Contract owners: devboard.js (the shared extension stack), board-page.js +
// project-page.js (the anchors), sprint-page.js (the popover + settings), the
// task PATCH's additive due_origin_at ride-along (src/routes/devboard.ts).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s245@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s245-fa@test.local'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s245', 'en'], [FA_EMAIL, 'e2e-s245-fa', 'fa']] as const) {
    const id = randomBytes(16).toString('hex')
    try {
      db.exec(`DELETE FROM dev_task_deps WHERE blocked_task_id IN (SELECT id FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}')))`)
      db.exec(`DELETE FROM project_archives WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}'))`)
      db.exec(`DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}'))`)
      db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}'))`)
      db.exec(`DELETE FROM sprints WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}'))`)
      db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}')`)
      db.exec(`DELETE FROM users WHERE email = '${email}'`)
    } catch { /* may not exist yet */ }
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${id}', '${user}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page, email = TEST_EMAIL) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForTimeout(400)
}

interface DueBoard {
  tasks: { id: string; title: string; status: string; sprint_id: string | null; due_at: string | null; due_origin_at: string | null; effective_due_at: string | null; effective_due_source: string | null; effective_due_origin_at: string | null }[]
  sprints: { id: string; name: string; status: string; due_at: string | null; due_origin_at: string | null }[]
}

async function boardOf(page: Page, pid: string): Promise<DueBoard> {
  return await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/, /Failed to load resource.*409/, /Failed to load resource.*400/]
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

/** The local (UTC in this sandbox) YYYY-MM-DD of now + N days. */
const localDay = (days: number) => {
  const d = new Date(Date.now() + days * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function boardReady(page: Page) {
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#db-loading')).toBeHidden()
}

/** Seeds a project with an ACTIVE sprint carrying a due date (+5d) and a known
 * origin, plus tasks: two INHERITORS (no personal deadline), one OVERRIDE
 * (personal deadline), one task in ANOTHER sprint (paused — assignment legal,
 * assumption 3; a completed sprint would 400 the assignment), one free task.
 * Returns the ids + the sprint's stamped origin. (The 'Beta' sprint is created
 * FIRST and PAUSED — a create-with-dates auto-closes any ACTIVE sibling, and a
 * completed target refuses new assignments.) */
async function seedSprintBoard(page: Page, title: string) {
  const pid = await page.evaluate(async (t) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, status: 'developing' }) })
    return ((await res.json()) as { id: string }).id
  }, title)
  // a PAUSED sibling sprint first (assignment to paused is legal — assumption 3;
  // paused keeps an open window and never blocks the later ACTIVE create)
  const otherId = await page.evaluate(async (pid) => {
    const r = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Beta', started_at: new Date(Date.now() - 30 * 86400000).toISOString() }) })).json()) as { id: string }
    await fetch(`/api/sprints/${r.id}/pause`, { method: 'POST' })
    return r.id
  }, pid)
  // the main sprint: created STARTED-ONLY (an open window = active — a
  // create-with-both-dates sprint is born COMPLETED, the legacy timeline rule)
  // + a due_at 5 days out at LOCAL day-end (the control loads a day-end value
  // with the time toggle OFF — §11.2's date-only sentinel)
  const mainId = await page.evaluate(async (pid) => {
    const r = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alpha', started_at: new Date().toISOString() }) })).json()) as { id: string }
    const d = new Date(Date.now() + 5 * 86400000)
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
    await fetch(`/api/sprints/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_at: dayEnd.toISOString() }) })
    return r.id
  }, pid)
  const mk = async (title2: string, body: Record<string, unknown>) =>
    page.evaluate(async ({ pid, title2, body }) => {
      const res = await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title2, ...body }) })
      return ((await res.json()) as { id: string }).id
    }, { pid, title2, body })
  const inh1 = await mk('s245 inheritor one', { sprint_id: mainId, status: 'in_progress' })
  const inh2 = await mk('s245 inheritor two', { sprint_id: mainId })
  const ovr = await mk('s245 override task', { sprint_id: mainId, due_at: new Date(Date.now() + 2 * 86400000).toISOString() })
  const elsewhere = await mk('s245 other-sprint task', { sprint_id: otherId })
  const free = await mk('s245 free task', { sprint_id: null })
  const board = await boardOf(page, pid)
  const origin = board.sprints.find((s) => s.id === mainId)!.due_origin_at
  return { pid, mainId, otherId, inh1, inh2, ovr, elsewhere, free, origin }
}

/** Opens the J1 dialog through the compact overview (the sprint filter select →
 * the panel → the Extend action). */
async function openJ1FromOverview(page: Page, pid: string, sprintId: string) {
  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await page.selectOption('[data-db-filter-sprint]', sprintId)
  await expect(page.locator('[data-db-sprint-ov]')).toBeVisible({ timeout: 5_000 })
  await page.click('[data-db-ov-extend]')
  await expect(page.locator('.db-sprintmod')).toBeVisible()
}

test('§13.1/§13.2 + Screen J1 — the sprint extension from the overview: the counts show BEFORE, +48h adds to the EXISTING deadline, the origin survives, inheritors follow, overrides stay', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedSprintBoard(page, 's245 j1 board')
  const before = await boardOf(page, seed.pid)
  const beforeDue = before.sprints.find((s) => s.id === seed.mainId)!.due_at!

  await openJ1FromOverview(page, seed.pid, seed.mainId)
  const modal = page.locator('.db-sprintmod')
  // the dialog: the sprint identity + the current deadline line
  await expect(modal).toContainText('Alpha')
  await expect(modal).toContainText('Current deadline')
  // §13.2: the impact counts BEFORE the confirmation — 2 inheritors, 1 protected
  await expect(modal).toContainText('2 tasks inherit this deadline and follow the extension.')
  await expect(modal).toContainText('1 tasks are protected by personal deadlines and stay unchanged.')
  // §13.2: the origin note
  await expect(modal).toContainText('The progress start point is preserved.')
  // the Confirm is disabled until a choice
  await expect(modal.locator('[data-ext-confirm]')).toBeDisabled()
  // pick +48h → the preview names the new deadline (the existing + 48h)
  await modal.locator('[data-ext-preset="48"]').click()
  await expect(modal.locator('[data-ext-confirm]')).toBeEnabled()
  await expect(modal.locator('[data-ext-preview]')).toContainText('New deadline:')
  await modal.locator('[data-ext-confirm]').click()
  await expect(page.locator('#toast', { hasText: 'Deadline extended' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  const after = await boardOf(page, seed.pid)
  const sprint = after.sprints.find((s) => s.id === seed.mainId)!
  // §13.1: +48h ON THE EXISTING DEADLINE — millisecond-exact, never now-based
  expect(Date.parse(sprint.due_at!) - Date.parse(beforeDue)).toBe(48 * 3600000)
  // §13.2: the origin is NOT reset
  expect(sprint.due_origin_at).toBe(seed.origin)
  // every inheritor followed (the server triple re-resolved)
  for (const tid of [seed.inh1, seed.inh2]) {
    const row = after.tasks.find((t) => t.id === tid)!
    expect(row.effective_due_source).toBe('sprint')
    expect(row.effective_due_at).toBe(sprint.due_at)
    expect(row.due_at).toBeNull() // still no personal deadline — inheritance, not copies
  }
  // the override did NOT move
  const ovrRow = after.tasks.find((t) => t.id === seed.ovr)!
  expect(ovrRow.effective_due_source).toBe('task')
  expect(ovrRow.effective_due_at).toBe(before.tasks.find((t) => t.id === seed.ovr)!.effective_due_at)
  // another sprint's task did not move
  const elsewhereRow = after.tasks.find((t) => t.id === seed.elsewhere)!
  expect(elsewhereRow.effective_due_at).toBeNull()
  expect(errors).toEqual([])
})

test('§13.3 + Screen J2 — the personal extension from the card row: only this task changes, the origin survives', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedSprintBoard(page, 's245 j2 board')
  const before = await boardOf(page, seed.pid)
  const ovrBefore = before.tasks.find((t) => t.id === seed.ovr)!

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  // the card deadline row's Extend affordance (hover-revealed; the click is its
  // own action — the card click itself would open the task view)
  const card = page.locator(`.pd-task-wrap[data-task-card="${seed.ovr}"]`)
  await expect(card.locator('.db-due-row')).toBeVisible({ timeout: 10_000 })
  await card.locator('.db-due-ext').click()
  const modal = page.locator('.db-sprintmod')
  await expect(modal).toBeVisible()
  // the task's identity + the CURRENT PERSONAL deadline + the only-this-task scope
  await expect(modal).toContainText('s245 override task')
  await expect(modal).toContainText('Current deadline')
  await expect(modal).toContainText('Only this task changes.')
  await expect(modal).not.toContainText('tasks inherit this deadline') // never the sprint-wide preview on J2
  await modal.locator('[data-ext-preset="24"]').click()
  await modal.locator('[data-ext-confirm]').click()
  await expect(page.locator('#toast', { hasText: 'Deadline extended' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  const after = await boardOf(page, seed.pid)
  const ovrAfter = after.tasks.find((t) => t.id === seed.ovr)!
  // only this task changed: +24h on its PERSONAL deadline, the origin preserved
  expect(Date.parse(ovrAfter.due_at!) - Date.parse(ovrBefore.due_at!)).toBe(24 * 3600000)
  expect(ovrAfter.due_origin_at).toBe(ovrBefore.due_origin_at) // §13.3: no reset
  // nobody else moved
  for (const tid of [seed.inh1, seed.inh2]) {
    const row = after.tasks.find((t) => t.id === tid)!
    expect(row.effective_due_at).toBe(before.tasks.find((t) => t.id === tid)!.effective_due_at)
  }
  expect(after.sprints.find((s) => s.id === seed.mainId)!.due_at).toBe(before.sprints.find((s) => s.id === seed.mainId)!.due_at)
  expect(errors).toEqual([])
})

test('§13.4 + Screen J3 — the inherited row opens the CHOICE modal; the TASK-ONLY arm creates the override riding the SPRINT\'S origin (the bar does not reset)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedSprintBoard(page, 's245 j3t board')
  const before = await boardOf(page, seed.pid)
  const sprintBefore = before.sprints.find((s) => s.id === seed.mainId)!
  const inhBefore = before.tasks.find((t) => t.id === seed.inh1)!

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  const card = page.locator(`.pd-task-wrap[data-task-card="${seed.inh1}"]`)
  await expect(card.locator('.db-due-row')).toBeVisible({ timeout: 10_000 })
  await expect(card.locator('.db-due-row')).toContainText('Sprint deadline ·') // §10.1: the inherited row
  await card.locator('.db-due-ext').click()
  const modal = page.locator('.db-sprintmod')
  await expect(modal).toBeVisible()
  // the CHOICE modal: the task + the inherited source + TWO clearly distinct arms
  await expect(modal).toContainText('s245 inheritor one')
  await expect(modal).toContainText('This task inherits the sprint deadline:')
  await expect(modal).toContainText('Alpha')
  await expect(modal.locator('[data-ext-arm-sprint]')).toBeVisible()
  await expect(modal.locator('[data-ext-arm-task]')).toBeVisible()
  // the scope is visible BEFORE confirmation (the counts in the sprint arm's sub-line)
  await expect(modal.locator('[data-ext-arm-sprint]')).toContainText('2 follow')
  await expect(modal.locator('[data-ext-arm-sprint]')).toContainText('1 protected')
  // the TASK-ONLY arm
  await modal.locator('[data-ext-arm-task]').click()
  await expect(modal.locator('[data-ext-arm-task]')).toHaveCount(0) // the choice closed…
  await expect(page.locator('.db-sprintmod [data-ext-preset="48"]')).toBeVisible() // …the picker opened
  const picker = page.locator('.db-sprintmod')
  await expect(picker).toContainText('Only this task changes.')
  await expect(picker).toContainText('Inherited from the sprint deadline')
  await picker.locator('[data-ext-preset="48"]').click()
  await picker.locator('[data-ext-confirm]').click()
  await expect(page.locator('#toast', { hasText: 'Deadline extended' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  const after = await boardOf(page, seed.pid)
  const row = after.tasks.find((t) => t.id === seed.inh1)!
  // the override landed: the inherited deadline + 48h
  expect(row.due_at).toBeTruthy()
  expect(Date.parse(row.due_at!) - Date.parse(inhBefore.effective_due_at!)).toBe(48 * 3600000)
  expect(row.effective_due_source).toBe('task') // the override now wins
  expect(row.effective_due_at).toBe(row.due_at)
  // THE §13.4 INVARIANT: the override's origin IS THE SPRINT'S ORIGIN — the
  // ride-along preserved the inherited progress start point (never `now`)
  expect(row.due_origin_at).toBe(seed.origin)
  expect(row.effective_due_origin_at).toBe(seed.origin)
  // the sprint did NOT silently change
  const sprintAfter = after.sprints.find((s) => s.id === seed.mainId)!
  expect(sprintAfter.due_at).toBe(sprintBefore.due_at)
  expect(sprintAfter.due_origin_at).toBe(seed.origin)
  // the other inheritor still inherits, unmoved
  const inh2After = after.tasks.find((t) => t.id === seed.inh2)!
  expect(inh2After.due_at).toBeNull()
  expect(inh2After.effective_due_source).toBe('sprint')
  expect(inh2After.effective_due_at).toBe(sprintBefore.due_at)
  expect(errors).toEqual([])
})

test('§13.4 + Screen J3 — the SPRINT-WIDE arm reuses J1: the choice opens the counted dialog, the extension moves every inheritor', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedSprintBoard(page, 's245 j3s board')
  const before = await boardOf(page, seed.pid)

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  const card = page.locator(`.pd-task-wrap[data-task-card="${seed.inh2}"]`)
  await card.locator('.db-due-ext').click()
  const modal = page.locator('.db-sprintmod')
  await expect(modal).toBeVisible()
  await modal.locator('[data-ext-arm-sprint]').click()
  // the J1 dialog with its full impact preview
  await expect(page.locator('.db-sprintmod [data-ext-preset="72"]')).toBeVisible()
  const j1 = page.locator('.db-sprintmod')
  await expect(j1).toContainText('2 tasks inherit this deadline and follow the extension.')
  await expect(j1).toContainText('1 tasks are protected by personal deadlines and stay unchanged.')
  await j1.locator('[data-ext-preset="72"]').click()
  await j1.locator('[data-ext-confirm]').click()
  await expect(page.locator('#toast', { hasText: 'Deadline extended' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  const after = await boardOf(page, seed.pid)
  const sprint = after.sprints.find((s) => s.id === seed.mainId)!
  expect(Date.parse(sprint.due_at!) - Date.parse(before.sprints.find((s) => s.id === seed.mainId)!.due_at!)).toBe(72 * 3600000)
  expect(sprint.due_origin_at).toBe(seed.origin)
  for (const tid of [seed.inh1, seed.inh2]) {
    const row = after.tasks.find((t) => t.id === tid)!
    expect(row.effective_due_at).toBe(sprint.due_at)
  }
  const ovr = after.tasks.find((t) => t.id === seed.ovr)!
  expect(ovr.effective_due_at).toBe(before.tasks.find((t) => t.id === seed.ovr)!.effective_due_at)
  expect(errors).toEqual([])
})

test('§13.1 Custom — the Custom date arm mounts the SHARED control pre-loaded; the picked day resolves to LOCAL 23:59', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedSprintBoard(page, 's245 custom board')

  await openJ1FromOverview(page, seed.pid, seed.mainId)
  const modal = page.locator('.db-sprintmod')
  await modal.locator('[data-ext-preset="custom"]').click()
  // the shared D6 control mounts, PRE-LOADED with the current value (§13.1 Custom)
  const gIn = modal.locator('[data-due-g]')
  await expect(gIn).toBeVisible()
  const loaded = await gIn.inputValue()
  const before = await boardOf(page, seed.pid)
  expect(loaded).toBe(before.sprints.find((s) => s.id === seed.mainId)!.due_at!.slice(0, 10)) // edits start from the current day
  // pick 9 days out → LOCAL 23:59 (§11.2 — the control's own resolution)
  await gIn.fill(localDay(9))
  await modal.locator('[data-ext-confirm]').click()
  await expect(page.locator('#toast', { hasText: 'Deadline extended' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  const after = await boardOf(page, seed.pid)
  const sprint = after.sprints.find((s) => s.id === seed.mainId)!
  expect(sprint.due_at!.slice(0, 10)).toBe(localDay(9))
  expect(sprint.due_at!.endsWith('T23:59:59.999Z')).toBe(true) // UTC sandbox → local == UTC
  expect(sprint.due_origin_at).toBe(seed.origin) // §13.2: the custom edit is still value→value
  expect(errors).toEqual([])
})

test('§17 — FA/RTL: the dialogs localize, the choice arms mirror, the row affordance rides the mirrored row', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)
  const seed = await seedSprintBoard(page, 's245 fa board')

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  // the FA card row reads Persian + the extend affordance is present
  const card = page.locator(`.pd-task-wrap[data-task-card="${seed.inh1}"]`)
  await expect(card.locator('.db-due-row')).toBeVisible({ timeout: 10_000 })
  await expect(card.locator('.db-due-row')).toContainText('مهلت اسپرینت')
  await card.locator('.db-due-ext').click()
  const modal = page.locator('.db-sprintmod')
  await expect(modal).toBeVisible()
  // the choice modal is RTL + fully Persian, the two arms read distinctly
  await expect(modal.locator('.db-sprintmod-card')).toHaveAttribute('dir', 'rtl')
  await expect(modal).toContainText('این وظیفه مهلت اسپرینت را به ارث برده است:')
  const armSprint = modal.locator('[data-ext-arm-sprint]')
  const armTask = modal.locator('[data-ext-arm-task]')
  await expect(armSprint).toContainText('تمدید مهلت اسپرینت')
  await expect(armTask).toContainText('تمدید فقط همین وظیفه')
  // the task-only arm → the picker is Persian too (the presets + the scope line)
  await armTask.click()
  const picker = page.locator('.db-sprintmod')
  await expect(picker.locator('[data-ext-preset="24"]')).toBeVisible()
  await expect(picker).toContainText('فقط این وظیفه تغییر می‌کند.')
  await picker.locator('[data-ext-preset="24"]').click()
  await picker.locator('[data-ext-confirm]').click()
  await expect(page.locator('#toast', { hasText: 'مهلت تمدید شد' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)
  // the override landed with the sprint's origin preserved (the FA round exercises
  // the same §13.4 invariant)
  const after = await boardOf(page, seed.pid)
  const row = after.tasks.find((t) => t.id === seed.inh1)!
  expect(row.due_origin_at).toBe(seed.origin)
  expect(errors).toEqual([])
})
