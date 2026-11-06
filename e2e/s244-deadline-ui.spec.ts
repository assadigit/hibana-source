// e2e/s244-deadline-ui.spec.ts — S244 (spec pack PHASE 5 — the deadline engine
// + UI). The full client round over the Phase 1+2 API surface (the S240 write
// paths + the S241 server-computed effective-deadline triple):
//   1. The task-modal DUE DATE (optional) TOGGLE (spec §9.1 + Screen C): OFF by
//      default (no date controls while OFF); the read-only inherited line
//      (§10.1 — 'Using <sprint> sprint deadline · <date>'); toggling ON reveals
//      the SHARED Gregorian/Jalali control; a date-only pick resolves to LOCAL
//      23:59 (§11.2 — the S242 UTC interim parse superseded); toggling OFF on
//      an edited task REMOVES the personal override (the explicit due_at:null —
//      §10.2) and inheritance resumes.
//   2. The CARD DEADLINE ROW + the thin bar (spec §12 + Screen A): the row's
//      threshold word + state class, the bar's presence, the no-deadline card
//      staying clean, the personal-over-sprint PRECEDENCE (§10.2), the
//      completed-task DONE neutrality (§12.4), the completed-sprint neutrality
//      (§10.3 — no countdown), and the PAUSED sprint's continuing inheritance
//      (§5.5).
//   3. The thresholds at the §24 boundary edges (7d / 48h — the exact-equality
//      proofs live in sprint-ui-s244.test.ts's VM round; this spec pins the
//      near-boundary sides end-to-end) + the Overdue state.
//   4. The quick-create + settings CONTROL SWAP: the sprint quick-create's Set
//      due date reveals the shared control; the stored instant = LOCAL 23:59;
//      the sprint SETTINGS panel edits the due date through the control with
//      the ORIGIN preserved (value→value — §13.2's semantics, contract §12.1).
//   5. The Jalali selector round: the Jalali text input (Persian digits)
//      stores the SAME day the calendar shows.
//   6. FA/RTL: the card rows localize (Persian threshold wording), the card
//      mirrors, and the BAR stays direction-locked LTR (§17's explicit
//      exception).
// Contract owners: due-control.js (the D6 control), devboard.js (the shared
// render stack + the modal), board-page.js (the /kanban card twin),
// detail-helpers.ts + project-page.js (the embedded board's server + repaint
// twins), sprint-page.js (the settings panel's control).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s244@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s244-fa@test.local'

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
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s244', 'en'], [FA_EMAIL, 'e2e-s244-fa', 'fa']] as const) {
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

async function openAddModal(page: Page) {
  await page.click('.pd-tasks[data-pd-tasks="idea"] [data-add="idea"]')
  await page.waitForSelector('.db-modal-card')
}

/** Opens the EDIT modal through the ⋯ menu (the S238 contract: the card click
 * opens the read-only view; the editor opens from the menu's Edit). */
async function openEditModal(page: Page, taskId: string) {
  await page.locator(`.pd-task-wrap[data-task-card="${taskId}"] .pd-task`).hover()
  await page.locator(`.pd-task-wrap[data-task-card="${taskId}"] .db-card-menu [data-menu-open]`).click()
  await page.locator('[data-db-edit-card]').first().click()
  await expect(page.locator('.db-modal-card')).toBeVisible({ timeout: 5_000 })
}

test('§9.1/§10.1/§10.2/§11.2 — the toggle flow: OFF by default + the inherited line → ON sets the override (LOCAL 23:59) → the row + bar render → OFF removes → inheritance resumes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 toggle board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  // a sprint WITH a due date (+20 days) — the inheritance source
  const sprintId = await page.evaluate(async (pid) => {
    const r = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Inheritor' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_at: new Date(Date.now() + 20 * 86400000).toISOString() }) })
    return r.id
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await openAddModal(page)
  await page.fill('[name=title]', 's244 override task')

  // §9.1: the toggle is OFF by default — the date controls stay hidden
  const dueToggle = page.locator('[data-db-due-toggle]')
  await expect(dueToggle).toHaveCount(1)
  await expect(dueToggle).not.toBeChecked()
  await expect(page.locator('.db-modal-card [data-due-cal]')).toBeHidden()
  await expect(page.locator('[data-db-due-inherited]')).toBeHidden() // no sprint drafted yet

  // select the sprint — the read-only inherited line appears while the toggle stays OFF (§10.1)
  await page.selectOption('select[data-db-sprint]', sprintId)
  const line = page.locator('[data-db-due-inherited]')
  await expect(line).toBeVisible()
  await expect(line).toContainText('Using Inheritor sprint deadline')
  await expect(dueToggle).not.toBeChecked()
  await expect(page.locator('.db-modal-card [data-due-cal]')).toBeHidden() // still hidden while OFF

  // §9.1: toggling ON reveals the shared control (§11.1's selector + presets)
  await dueToggle.check()
  const ctl = page.locator('.db-modal-card [data-due-cal]')
  await expect(ctl).toBeVisible()
  await expect(page.locator('.db-modal-card [data-due-presets]')).toBeVisible()
  await expect(page.locator('.db-modal-card [data-due-g]')).toBeVisible()
  await expect(line).toBeHidden() // the personal override replaces the inherited read

  // a date-only pick 3 days out → §11.2: LOCAL 23:59 (the sandbox runs UTC —
  // the stored instant reads T23:59:59.999Z; the S242 UTC-string interim is gone)
  await page.fill('.db-modal-card [data-due-g]', localDay(3))
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Task added' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  let board = await boardOf(page, pid)
  const task = board.tasks.find((t) => t.title === 's244 override task')
  expect(task).toBeTruthy()
  expect(task!.due_at).toBeTruthy()
  expect(task!.due_at!.endsWith('T23:59:59.999Z')).toBe(true) // LOCAL 23:59 (UTC sandbox)
  expect(task!.due_at!.slice(0, 10)).toBe(localDay(3))
  expect(task!.due_origin_at).toBeTruthy() // the first assignment stamps the origin
  // §10.2 precedence: personal > sprint — the server triple reads the task's own
  expect(task!.effective_due_source).toBe('task')
  expect(task!.effective_due_at).toBe(task!.due_at)

  // the card renders the row + the thin bar (Screen A's seam) — a FRESH deadline's
  // elapsed fill is legitimately ~0% wide (the timeline just started), so the pin
  // is the visible track + the fill's presence, not the fill's visibility
  const card = page.locator(`.pd-task-wrap[data-task-card="${task!.id}"]`)
  await expect(card.locator('.db-due-row')).toBeVisible({ timeout: 10_000 })
  await expect(card.locator('.db-due-row')).toContainText('3 days left')
  await expect(card.locator('.db-due-bar')).toBeVisible()
  await expect(card.locator('.db-due-bar .db-due-fill')).toHaveCount(1)
  await expect(card.locator('.db-due-row')).not.toContainText('Sprint deadline') // the personal override wins on the card

  // §10.2 removal: Edit → toggle OFF → Save → the explicit null clears both,
  // inheritance resumes (the row flips to the sprint's own deadline)
  await openEditModal(page, task!.id)
  const editToggle = page.locator('[data-db-due-toggle]')
  await expect(editToggle).toBeChecked() // a saved personal deadline shows ON with its value
  await expect(page.locator('.db-modal-card [data-due-g]')).toHaveValue(localDay(3))
  await editToggle.uncheck()
  await expect(page.locator('[data-db-due-inherited]')).toBeVisible() // back to the inherited line
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Saved' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  board = await boardOf(page, pid)
  const after = board.tasks.find((t) => t.id === task!.id)
  expect(after!.due_at).toBeNull() // the explicit-null removal
  expect(after!.due_origin_at).toBeNull()
  expect(after!.effective_due_source).toBe('sprint') // inheritance resumed
  expect(after!.effective_due_at).toBe(board.sprints.find((s) => s.id === sprintId)!.due_at)
  // the card's row now identifies the SOURCE (§10.1's card wording)
  await expect(card.locator('.db-due-row')).toContainText('Sprint deadline ·', { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('§12.3/§24 — the thresholds at the boundary sides + Overdue; §10/§12.1 — the no-deadline card stays clean', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 thresholds board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const ids = await page.evaluate(async (pid) => {
    const mk = async (title: string, due: string | null) => {
      const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, due_at: due, sprint_id: null }) })).json()) as { id: string }
      return r.id
    }
    const H = 3600000
    return {
      // the §24 boundary SIDES (the exact-equality proofs live in the vitest VM
      // round — sprint-ui-s244.test.ts; these pin the rendered classes):
      justOver7d: await mk('just over 7 days', new Date(Date.now() + 7 * 86400000 + H).toISOString()),
      under7d: await mk('just under 7 days', new Date(Date.now() + 7 * 86400000 - 60000).toISOString()),
      justOver48h: await mk('just over 48 hours', new Date(Date.now() + 48 * H + H).toISOString()),
      under48h: await mk('just under 48 hours', new Date(Date.now() + 48 * H - 60000).toISOString()),
      overdue: await mk('past its deadline', new Date(Date.now() - 2 * 86400000).toISOString()),
      clean: await mk('no deadline at all', null),
    }
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  const rowOf = (id: string) => page.locator(`.pd-task-wrap[data-task-card="${id}"] .db-due-row`)

  await expect(rowOf(ids.justOver7d)).toHaveClass(/st-comfortable/, { timeout: 10_000 })
  await expect(rowOf(ids.under7d)).toHaveClass(/st-approaching/)
  await expect(rowOf(ids.under7d)).toContainText('7 days left')
  await expect(rowOf(ids.justOver48h)).toHaveClass(/st-approaching/)
  await expect(rowOf(ids.under48h)).toHaveClass(/st-urgent/)
  // the overdue word — the WORD carries the meaning, never color alone (§12.3)
  await expect(rowOf(ids.overdue)).toHaveClass(/st-overdue/)
  await expect(rowOf(ids.overdue)).toContainText('Overdue by 2 days')
  // §12.1: no deadline → no row, no bar — the card keeps its ordinary shape
  await expect(page.locator(`.pd-task-wrap[data-task-card="${ids.clean}"] .db-due-row`)).toHaveCount(0)
  await expect(page.locator(`.pd-task-wrap[data-task-card="${ids.clean}"] .db-due-bar`)).toHaveCount(0)
  // every other card carries the thin bar's track (§12.1: only when an active
  // deadline exists; a fresh deadline's fill is ~0% — the track is the pin)
  for (const id of [ids.justOver7d, ids.under7d, ids.justOver48h, ids.under48h, ids.overdue]) {
    await expect(page.locator(`.pd-task-wrap[data-task-card="${id}"] .db-due-bar`)).toBeVisible()
    await expect(page.locator(`.pd-task-wrap[data-task-card="${id}"] .db-due-bar .db-due-fill`)).toHaveCount(1)
  }
  expect(errors).toEqual([])
})

test('§12.4 + §10.3 + §5.5 — the done-task neutrality, the completed-sprint neutrality, and the PAUSED sprint keeps inheriting', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 neutrality board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const ids = await page.evaluate(async (pid) => {
    const mkSprint = async (name: string, dueDays: number) => {
      const r = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json()) as { id: string }
      await fetch(`/api/sprints/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_at: new Date(Date.now() + dueDays * 86400000).toISOString() }) })
      return r.id
    }
    const mkTask = async (title: string, sprintId: string | null, opts: { due?: string; status?: string } = {}) => {
      const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, sprint_id: sprintId, due_at: opts.due ?? null, status: opts.status ?? 'idea' }) })).json()) as { id: string }
      return r.id
    }
    // a DONE task with a personal deadline close enough to scream urgent — §12.4
    // says neutral Done, no live countdown, no urgency wording
    const doneTask = await mkTask('done with deadline', null, { due: new Date(Date.now() + 3600000).toISOString(), status: 'done' })
    // a completed sprint's task: the sprint HAS a due date, but §10.3 makes it
    // historically neutral — the server nulls the triple, the client renders null.
    // (The association is made while ACTIVE — a NEW assignment to a completed
    // sprint 400s; the finish then completes around the existing association.)
    const finished = await mkSprint('Finished With Due', 5)
    await fetch(`/api/sprints/${finished}/start`, { method: 'POST' })
    const heir = await mkTask('heir of finished sprint', finished)
    await fetch(`/api/sprints/${finished}/finish`, { method: 'POST' })
    // a PAUSED sprint's task: the deadline KEEPS inheriting (§5.5) — 10 days out
    // reads comfortable (beyond the 7-day band)
    const paused = await mkSprint('Paused With Due', 10)
    await fetch(`/api/sprints/${paused}/start`, { method: 'POST' })
    await fetch(`/api/sprints/${paused}/pause`, { method: 'POST' })
    const pausedHeir = await mkTask('heir of paused sprint', paused)
    return { doneTask, heir, pausedHeir, paused }
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  // §12.4: neutral gray + the Done indication — no urgency wording
  const doneRow = page.locator(`.pd-task-wrap[data-task-card="${ids.doneTask}"] .db-due-row`)
  await expect(doneRow).toHaveClass(/st-done/, { timeout: 10_000 })
  await expect(doneRow).toContainText('✓ Done')
  await expect(doneRow).not.toContainText('Due today')
  // §10.3: the completed sprint's heir renders NO countdown at all
  await expect(page.locator(`.pd-task-wrap[data-task-card="${ids.heir}"] .db-due-row`)).toHaveCount(0)
  await expect(page.locator(`.pd-task-wrap[data-task-card="${ids.heir}"] .db-due-bar`)).toHaveCount(0)
  // §5.5: the paused sprint's heir keeps its inherited countdown
  const pausedRow = page.locator(`.pd-task-wrap[data-task-card="${ids.pausedHeir}"] .db-due-row`)
  await expect(pausedRow).toHaveClass(/st-comfortable/)
  await expect(pausedRow).toContainText('Sprint deadline ·')
  // the payload confirms the server-side truth for all three
  const board = await boardOf(page, pid)
  expect(board.tasks.find((t) => t.id === ids.doneTask)!.effective_due_source).toBe('task')
  expect(board.tasks.find((t) => t.id === ids.heir)!.effective_due_at).toBeNull() // §10.3 nulled
  expect(board.tasks.find((t) => t.id === ids.pausedHeir)!.effective_due_source).toBe('sprint') // §5.5 kept
  expect(errors).toEqual([])
})

test('D6 — the quick-create + the sprint SETTINGS swapped to the shared control: LOCAL 23:59 on create, the ORIGIN preserved on edit (contract §12.1)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 control board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await openAddModal(page)
  await page.fill('[name=title]', 's244 dated task')
  // the quick-create through the modal's ＋ New sprint
  await page.selectOption('select[data-db-sprint]', '__new')
  const dlg = page.locator('.db-sprintq-card')
  await expect(dlg).toBeVisible({ timeout: 5_000 })
  await page.fill('[data-sq-name]', 'Dated Sprint')
  // the due toggle reveals the SHARED control (not the old bare date input)
  await page.check('[data-sq-due-toggle]')
  await expect(page.locator('[data-sq-due-mount] [data-due-cal]')).toBeVisible()
  await expect(page.locator('[data-sq-due-mount] [data-due-g]')).toBeVisible()
  await page.fill('[data-sq-due-mount] [data-due-g]', localDay(9))
  await page.click('[data-sq-create]')
  // the quick-create's success contract: the dialog closes + the new sprint is
  // selected for the current task (no toast rides this flow)
  await expect(page.locator('.db-sprintq-card')).toBeHidden({ timeout: 5_000 })
  await expect(page.locator('select[data-db-sprint]')).toHaveValue(/.+/, { timeout: 5_000 })
  await expect(page.locator('select[data-db-sprint] option:checked')).toContainText('Dated Sprint')
  await page.waitForTimeout(400)
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Task added' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  let board = await boardOf(page, pid)
  const sprint = board.sprints.find((s) => s.name === 'Dated Sprint')
  expect(sprint).toBeTruthy()
  // §11.2 through the quick-create too: LOCAL 23:59 (the S242 UTC interim gone)
  expect(sprint!.due_at).toBeTruthy()
  expect(sprint!.due_at!.endsWith('T23:59:59.999Z')).toBe(true)
  expect(sprint!.due_at!.slice(0, 10)).toBe(localDay(9))
  const originBefore = sprint!.due_origin_at
  expect(originBefore).toBeTruthy()

  // the sprint SETTINGS panel: the read-only line became the control — edit the
  // due date through it and the ORIGIN survives (value→value preserves it)
  await page.goto(`/sprint.html?project=${pid}`)
  await expect(page.locator('#sp-wrap')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#sp-loading')).toBeHidden()
  await page.locator(`[data-sp-open="${sprint!.id}"]`).click()
  const detail = page.locator('.db-sprintdetail-card')
  await expect(detail).toBeVisible({ timeout: 5_000 })
  await expect(detail.locator('[data-sd-due-toggle]')).toBeChecked() // a saved due date shows ON
  await expect(detail.locator('[data-sd-due-mount] [data-due-g]')).toHaveValue(localDay(9))
  await page.fill('[data-sd-due-mount] [data-due-g]', localDay(12))
  await page.click('[data-sd-save]')
  await expect(page.locator('#toast', { hasText: 'Sprint settings saved' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  board = await boardOf(page, pid)
  const edited = board.sprints.find((s) => s.id === sprint!.id)
  expect(edited!.due_at!.slice(0, 10)).toBe(localDay(12)) // the value moved…
  expect(edited!.due_at!.endsWith('T23:59:59.999Z')).toBe(true)
  expect(edited!.due_origin_at).toBe(originBefore) // …the ORIGIN did not (§13.2's semantics)
  expect(errors).toEqual([])
})

test('§11.1 — the Jalali selector round: the Jalali text input stores the SAME day (the vendored converter is the truth)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 jalali board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await openAddModal(page)
  await page.fill('[name=title]', 's244 jalali task')
  await page.check('[data-db-due-toggle]')
  // §11.1: the explicit segmented selector — switch to Jalali
  await page.click('.db-modal-card [data-due-cal] [data-cal="jalali"]')
  const jIn = page.locator('.db-modal-card [data-due-j]')
  await expect(jIn).toBeVisible()
  await expect(page.locator('.db-modal-card [data-due-g]')).toBeHidden() // only ONE editable date
  // the day +2 in Jalali, computed through the page's own vendored converter
  const jText = await page.evaluate(() => {
    const d = new Date(Date.now() + 2 * 86400000)
    const j = window.jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate())
    return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`
  })
  await jIn.fill(jText)
  await jIn.press('Enter')
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Task added' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  // the SAME underlying date (§11.1: two displays of one instant, not two deadlines)
  const board = await boardOf(page, pid)
  const task = board.tasks.find((t) => t.title === 's244 jalali task')
  expect(task!.due_at).toBeTruthy()
  expect(task!.due_at!.slice(0, 10)).toBe(localDay(2))
  expect(task!.due_at!.endsWith('T23:59:59.999Z')).toBe(true)
  expect(errors).toEqual([])
})

test('§17 — FA/RTL: the rows localize + the card mirrors, and the BAR stays direction-locked LTR (the explicit exception)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 fa board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const taskId = await page.evaluate(async (pid) => {
    const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's244 fa deadline task', due_at: new Date(Date.now() + 5 * 86400000).toISOString(), sprint_id: null }) })).json()) as { id: string }
    return r.id
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  // the page mirrors
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  // the row localizes: Persian threshold wording + Persian digits (5 days out →
  // approaching per §12.3 — within the 7-day band)
  const row = page.locator(`.pd-task-wrap[data-task-card="${taskId}"] .db-due-row`)
  await expect(row).toHaveClass(/st-approaching/, { timeout: 10_000 })
  await expect(row).toContainText('روز مانده')
  await expect(row).toContainText('مهلت')
  // §17's EXCEPTION: the bar's time progression stays LTR even inside the RTL card
  const barDir = await page.evaluate((id) => {
    const bar = document.querySelector(`.pd-task-wrap[data-task-card="${id}"] .db-due-bar`)
    return bar ? getComputedStyle(bar).direction : 'missing'
  }, taskId)
  expect(barDir).toBe('ltr')
  expect(errors).toEqual([])
})
