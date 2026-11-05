// e2e/s243-sprint-lifecycle.spec.ts — S243 (spec pack PHASE 4 — sprint
// management, overview and lifecycle). The full lifecycle round on top of the
// Phase 1+2 API surface + the Phase 3 Kanban UI:
//   1. The H1 one-active CONFLICT modal (spec §5.2 + Screen H1): starting a
//      sprint while another is active opens the modal with BOTH identities and
//      three explicit actions — Cancel (nothing changes), Pause A & Start B,
//      and Finish A & Start B (the archive count rides the note; the unfinished
//      tasks stay put + keep the sprint).
//   2. The H3 pause + the resume: the paused sprint renders distinctly
//      (spec §5.5) on the timeline + the grouped list, and resumes.
//   3. The H2 finish CONFIRMATION (spec §5.3 + Screen H2): the Implemented
//      count preview + the unfinished-stay-put count + "No tasks will be
//      deleted." → the toast quotes the SERVER's archived count; the
//      completed sprint's Tasks tab lists the archived history.
//   4. The Screen-I DELETE confirmation (spec §6): completed sprints answer
//      inline (history is not deletable); a paused sprint with archived rows
//      deletes through the EXACT-counts modal — the archive keeps the
//      "Sprint: <name> (deleted)" snapshot.
//   5. The compact Kanban overview (spec §7.4 + Screen G): the five lane
//      counts + total (the client fold) on BOTH board surfaces — /kanban and
//      the embedded project-page board (the SHIPPED parity decision).
//   6. FA/RTL: the overview + the grouped list + the H2 dialog localize and
//      mirror (spec §17).
// Contract owners: devboard.js (the shared lifecycle stack), sprint-page.js
// (the Sprints page extension — D5), board-page.js + project-page.js (the
// overview twins), devboard.ts (the archives list's sprint identity).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s243@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s243-fa@test.local'

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
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s243', 'en'], [FA_EMAIL, 'e2e-s243-fa', 'fa']] as const) {
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

interface Board {
  tasks: { id: string; title: string; status: string; sprint_id: string | null }[]
  sprints: { id: string; name: string; status: string; ended_at: string | null }[]
}

async function boardOf(page: Page, pid: string): Promise<Board> {
  return await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
}

// 400s are expected + asserted here: the H1 finish arm's start answers 400
// invalid_input when the finished sprint still owns today (the S235 day-window
// seam — the dayBlocked honest path is PART of this spec's contract).
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

/** The Sprints page ready wait: the wrap renders (timeline + list boot). */
async function sprintsReady(page: Page) {
  await expect(page.locator('#sp-wrap')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#sp-loading')).toBeHidden()
}

test('H1 (Screen H1): start-while-active opens the conflict modal — Cancel changes nothing; Pause&Start resolves; Finish&Start resolves on a multi-day sprint + answers honestly on a same-day one', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 h1 board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const ids = await page.evaluate(async (pid) => {
    // Alpha: draft → start (ACTIVE). Beta: the project's next draft (planned).
    const a = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Alpha' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${a.id}/start`, { method: 'POST' })
    const b = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Beta', emoji: '🚀' }) })).json()) as { id: string }
    return { a: a.id, b: b.id }
  }, pid)

  await page.goto(`/sprint.html?project=${pid}`)
  await sprintsReady(page)
  // the draft card's Start on Beta — Alpha is active, so the H1 modal opens
  await expect(page.locator('[data-sp-draft-card]')).toBeVisible({ timeout: 10_000 })
  await page.click('[data-sp-draft-start]')
  const modal = page.locator('.db-sprintmod-card')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal).toContainText('Another sprint is active')
  await expect(modal).toContainText('Alpha')
  await expect(modal).toContainText('Beta')
  await expect(modal.locator('[data-sm-pause-start]')).toContainText('Pause Alpha & Start Beta')
  await expect(modal.locator('[data-sm-finish-start]')).toContainText('Finish Alpha & Start Beta')

  // CANCEL: nothing changes (spec §5.2 — make no changes)
  await page.click('[data-sm-cancel]')
  await expect(modal).toBeHidden()
  let board = await boardOf(page, pid)
  expect(board.sprints.find((s) => s.id === ids.a)?.status).toBe('active')
  expect(board.sprints.find((s) => s.id === ids.b)?.status).toBe('planned')

  // PAUSE Alpha & Start Beta: Alpha paused, Beta active — never two active
  await page.click('[data-sp-draft-start]')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await page.click('[data-sm-pause-start]')
  await expect(modal).toBeHidden({ timeout: 5_000 })
  await page.waitForTimeout(500)
  board = await boardOf(page, pid)
  expect(board.sprints.find((s) => s.id === ids.a)?.status).toBe('paused')
  expect(board.sprints.find((s) => s.id === ids.b)?.status).toBe('active')

  // FINISH Beta & Start Gamma — Beta started TODAY, so its window still owns
  // today even after the trim (the create-with-dates convention cannot move an
  // edge before its own start): the arm lands the FINISH and answers the start
  // with the honest dayBlocked message — Gamma stays planned (the S235 seam).
  const gammaId = await page.evaluate(async (pid) => {
    const c = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Gamma' }) })).json()) as { id: string }
    return c.id
  }, pid)
  await page.reload()
  await sprintsReady(page)
  await expect(page.locator('[data-sp-draft-card]')).toBeVisible({ timeout: 10_000 })
  await page.click('[data-sp-draft-start]')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal.locator('[data-sm-finish-start]')).toContainText('Finish Beta & Start Gamma')
  await expect(modal).toContainText('0 will be archived')
  await page.click('[data-sm-finish-start]')
  await expect(modal).toBeHidden({ timeout: 5_000 })
  await expect(page.locator('#toast')).toContainText('could not start', { timeout: 5_000 })
  await page.waitForTimeout(500)
  board = await boardOf(page, pid)
  expect(board.sprints.find((s) => s.id === ids.b)?.status).toBe('completed') // the finish landed
  expect(board.sprints.find((s) => s.id === ids.b)?.ended_at).toBeTruthy()
  expect(board.sprints.find((s) => s.id === gammaId)?.status).toBe('planned') // the start answered honestly — never two active

  // The SUCCESSFUL finish arm: a multi-day Beta — the trim moves its edge to
  // yesterday (the create-with-dates convention) and Gamma starts today clean.
  const pid2 = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 h1b board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const ids2 = await page.evaluate(async (pid2) => {
    // Delta: created STARTED two days ago (the legacy create-with-dates arm — a
    // multi-day ACTIVE window). Epsilon: the planned draft the user starts.
    const d = (await (await fetch(`/api/projects/${pid2}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Delta', started_at: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z' }) })).json()) as { id: string }
    const e = (await (await fetch(`/api/projects/${pid2}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Epsilon' }) })).json()) as { id: string }
    return { d: d.id, e: e.id }
  }, pid2)
  await page.goto(`/sprint.html?project=${pid2}`)
  await sprintsReady(page)
  await expect(page.locator('[data-sp-draft-card]')).toBeVisible({ timeout: 10_000 })
  await page.click('[data-sp-draft-start]')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal.locator('[data-sm-finish-start]')).toContainText('Finish Delta & Start Epsilon')
  await page.click('[data-sm-finish-start]')
  await expect(modal).toBeHidden({ timeout: 5_000 })
  await expect(page.locator('#toast')).toContainText('Sprint started', { timeout: 5_000 })
  await page.waitForTimeout(500)
  const board2 = await boardOf(page, pid2)
  const delta = board2.sprints.find((s) => s.id === ids2.d)
  expect(delta?.status).toBe('completed')
  expect(delta?.ended_at).toBeTruthy()
  // the trim landed: Delta's band edge moved to YESTERDAY (the create-with-dates
  // auto-close convention) so Epsilon could start TODAY — one sprint per day.
  expect(delta!.ended_at!.slice(0, 10) < new Date().toISOString().slice(0, 10)).toBe(true)
  expect(board2.sprints.find((s) => s.id === ids2.e)?.status).toBe('active')
  expect(errors).toEqual([])
})

test('H3 pause + resume (spec §5.5): the paused sprint renders distinctly everywhere, then resumes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 pause board', status: 'developing' }) })
    const { id: pid } = (await res.json()) as { id: string }
    const s = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Security', emoji: '🔥' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${s.id}/start`, { method: 'POST' })
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 stays put', status: 'in_progress', sprint_id: s.id }) })
    return { pid, sid: s.id }
  }, undefined)

  await page.goto(`/sprint.html?project=${ids.pid}`)
  await sprintsReady(page)
  // the DISTINCT paused render asserts BEFORE + AFTER
  await expect(page.locator('.sp-sprint.is-paused')).toHaveCount(0)

  // pause through the row's ⋯ popover → the H3 lightweight confirm
  await page.click(`.sp-list-row[data-sp-open="${ids.sid}"] .sp-list-more`)
  await page.waitForSelector('.sp-sprint-pop', { timeout: 5_000 })
  await page.click('.sp-sprint-pop [data-sp-pause]')
  await expect(page.locator('.hib-confirm-overlay')).toBeVisible()
  await expect(page.locator('.hib-confirm-overlay')).toContainText('Tasks stay where they are')
  await page.click('.hib-confirm-overlay [data-hib-confirm="ok"]')
  await expect(page.locator('#toast')).toContainText('Sprint paused', { timeout: 5_000 })
  await page.waitForTimeout(400)

  // the timeline band + chip wear the paused classes; the list groups under Paused
  await expect(page.locator('.sp-band.is-paused-band')).toHaveCount(1)
  await expect(page.locator('.sp-sprint.is-paused')).toHaveCount(1)
  await expect(page.locator('.sp-sprint-chip')).toContainText('⏸')
  const group = page.locator('[data-sp-group="paused"]', { hasText: 'Security' })
  await expect(group).toBeVisible()
  await expect(group.locator('.sp-list-badge')).toHaveText('Paused')
  // the task stayed put + associated (spec §5.5 — pausing changes nothing else)
  const board = await boardOf(page, ids.pid)
  const task = board.tasks.find((t) => t.title === 's243 stays put')
  expect(task?.sprint_id).toBe(ids.sid)
  expect(task?.status).toBe('in_progress')

  // resume through the popover — back to active
  await page.click(`.sp-list-row[data-sp-open="${ids.sid}"] .sp-list-more`)
  await page.waitForSelector('.sp-sprint-pop', { timeout: 5_000 })
  await page.click('.sp-sprint-pop [data-sp-resume]')
  await page.waitForTimeout(500)
  await expect(page.locator('.sp-sprint.is-paused')).toHaveCount(0)
  const board2 = await boardOf(page, ids.pid)
  expect(board2.sprints.find((s) => s.id === ids.sid)?.status).toBe('active')
  expect(errors).toEqual([])
})

test('H2 (Screen H2): the finish confirmation previews the counts, toasts the SERVER count, and unfinished tasks stay put + archived history shows', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 finish board', status: 'developing' }) })
    const { id: pid } = (await res.json()) as { id: string }
    const s = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Release', emoji: '📦' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${s.id}/start`, { method: 'POST' })
    const mk = (title: string, status: string) =>
      fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status, sprint_id: s.id }) })
    await mk('s243 shipped a', 'done')
    await mk('s243 shipped b', 'done')
    await mk('s243 open a', 'in_progress')
    await mk('s243 open b', 'idea')
    return { pid, sid: s.id }
  }, undefined)

  await page.goto(`/sprint.html?project=${ids.pid}`)
  await sprintsReady(page)
  // the toolbar Finish opens the CONFIRMATION (never a silent finish)
  await page.click('#sp-finish-btn')
  const modal = page.locator('.db-sprintmod-card')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal).toContainText('Finish sprint?')
  await expect(modal).toContainText('📦')
  await expect(modal).toContainText('Release')
  await expect(modal).toContainText('2 tasks in Implemented will be archived.')
  await expect(modal).toContainText('2 unfinished tasks stay in their columns and keep this sprint.')
  await expect(modal).toContainText('No tasks will be deleted.')

  await page.click('[data-sm-finish]')
  // the toast quotes the SERVER's additive count (2), not a preview
  await expect(page.locator('#toast')).toContainText('Sprint finished — 2 tasks archived', { timeout: 5_000 })
  await expect(modal).toBeHidden({ timeout: 5_000 })
  await page.waitForTimeout(400)

  // unfinished stay put + associated; the done pair left for the archive
  const board = await boardOf(page, ids.pid)
  const openA = board.tasks.find((t) => t.title === 's243 open a')
  const openB = board.tasks.find((t) => t.title === 's243 open b')
  expect(openA?.sprint_id).toBe(ids.sid)
  expect(openA?.status).toBe('in_progress')
  expect(openB?.sprint_id).toBe(ids.sid)
  expect(board.tasks.filter((t) => t.title.startsWith('s243 shipped'))).toHaveLength(0)

  // the completed sprint's Tasks tab lists the ARCHIVED history (spec §7.3)
  await page.click(`.sp-list-row[data-sp-open="${ids.sid}"]`)
  const detail = page.locator('.db-sprintdetail-card')
  await expect(detail).toBeVisible({ timeout: 5_000 })
  await page.click('[data-sd-tab-tasks]')
  await expect(detail).toContainText('Archived when finished', { timeout: 5_000 })
  await expect(detail).toContainText('s243 shipped a')
  await expect(detail).toContainText('s243 shipped b')
  await expect(detail).toContainText('s243 open a') // the unfinished stay visible too
  expect(errors).toEqual([])
})

test('Screen I: completed history answers inline; the paused sprint deletes through the EXACT-counts modal with the snapshot label', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const mkProj = async (title: string) => {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'developing' }) })
      return ((await res.json()) as { id: string }).id
    }
    // P1 — the finished sprint: completed = NOT deletable (spec §5.4). Its done
    // task archived at finish keeps sprint_id (the completed history case).
    const pidHist = await mkProj('s243 delete hist board')
    const hist = (await (await fetch(`/api/projects/${pidHist}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'History sprint' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${hist.id}/start`, { method: 'POST' })
    await fetch(`/api/projects/${pidHist}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 hist task', status: 'done', sprint_id: hist.id }) })
    await fetch(`/api/sprints/${hist.id}/finish`, { method: 'POST' })
    // P2 — the deletable case: a PAUSED sprint holding one ARCHIVED row (the bulk
    // archive-done kept sprint_id) + one open task. Separate project: the S235
    // day-window rule must never poison the seeding (two same-day starts 400).
    const pidTemp = await mkProj('s243 delete temp board')
    const temp = (await (await fetch(`/api/projects/${pidTemp}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Temp', emoji: '🧹' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${temp.id}/start`, { method: 'POST' })
    await fetch(`/api/projects/${pidTemp}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 archived one', status: 'done', sprint_id: temp.id }) })
    await fetch(`/api/projects/${pidTemp}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 stays behind', status: 'idea', sprint_id: temp.id }) })
    await fetch(`/api/projects/${pidTemp}/devtasks/archive-done`, { method: 'POST' })
    await fetch(`/api/sprints/${temp.id}/pause`, { method: 'POST' })
    return { pidHist, hist: hist.id, pidTemp, temp: temp.id }
  }, undefined)

  // P1 — COMPLETED: the delete answers INLINE (history is not deletable) — no modal
  await page.goto(`/sprint.html?project=${ids.pidHist}`)
  await sprintsReady(page)
  await page.click(`.sp-list-row[data-sp-open="${ids.hist}"] .sp-list-more`)
  await page.waitForSelector('.sp-sprint-pop', { timeout: 5_000 })
  await page.click('.sp-sprint-pop [data-sp-del]')
  await expect(page.locator('#toast')).toContainText("can't be deleted", { timeout: 5_000 })
  await expect(page.locator('.db-sprintmod-card')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const board0 = await boardOf(page, ids.pidHist)
  expect(board0.sprints.find((s) => s.id === ids.hist)).toBeTruthy() // nothing deleted

  // P2 — PAUSED: the exact-counts modal — total 2, one unassigned, one archived-with-snapshot
  await page.goto(`/sprint.html?project=${ids.pidTemp}`)
  await sprintsReady(page)
  await page.click(`.sp-list-row[data-sp-open="${ids.temp}"] .sp-list-more`)
  await page.waitForSelector('.sp-sprint-pop', { timeout: 5_000 })
  await page.click('.sp-sprint-pop [data-sp-del]')
  const modal = page.locator('.db-sprintmod-card')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal).toContainText('Delete sprint?')
  await expect(modal).toContainText('🧹') // Temp's emoji identity
  await expect(modal).toContainText('2 tasks are associated with this sprint.')
  await expect(modal).toContainText('1 non-archived tasks will become unassigned (No sprint).')
  await expect(modal).toContainText('1 archived tasks stay archived, labeled "Sprint: Temp (deleted)".')
  await expect(modal).toContainText('No tasks will be deleted.')

  await page.click('[data-sm-del]')
  await expect(page.locator('#toast')).toContainText('Sprint deleted', { timeout: 5_000 })
  await expect(modal).toBeHidden({ timeout: 5_000 })
  await page.waitForTimeout(400)

  // the dev task DETACHED (No sprint, still alive); the archive kept the snapshot
  const board = await boardOf(page, ids.pidTemp)
  const stays = board.tasks.find((t) => t.title === 's243 stays behind')
  expect(stays?.sprint_id).toBeNull()
  expect(stays?.status).toBe('idea')
  expect(board.sprints.find((s) => s.id === ids.temp)).toBeFalsy()
  const archives = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/archives`)).json(), ids.pidTemp)
  const snap = (archives.archives || []).find((a: { title: string }) => a.title === 's243 archived one')
  expect(snap?.sprint_id).toBeNull()
  expect(snap?.sprint_name_snapshot).toBe('Temp (deleted)')
  expect(errors).toEqual([])
})

test('Screen G: the compact overview folds the five lanes + total on BOTH board surfaces (zero new fetches)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 overview board', status: 'developing' }) })
    const { id: pid } = (await res.json()) as { id: string }
    const s = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Security', emoji: '🔥', due_at: '2026-12-31T23:59:59Z' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${s.id}/start`, { method: 'POST' })
    const mk = (title: string, status: string, sprint_id: string | null) =>
      fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status, sprint_id }) })
    await mk('s243 idea a', 'idea', s.id)
    await mk('s243 idea b', 'idea', s.id)
    await mk('s243 bug a', 'bug', s.id)
    await mk('s243 plan a', 'planned', s.id)
    await mk('s243 wip a', 'in_progress', s.id)
    await mk('s243 wip b', 'in_progress', s.id)
    await mk('s243 done a', 'done', s.id)
    await mk('s243 unassigned', 'idea', null)
    return { pid, sid: s.id }
  }, undefined)

  await page.goto(`/kanban?project=${ids.pid}`)
  await expect(page.locator('.db-filter')).toBeVisible({ timeout: 10_000 })
  await page.selectOption('[data-db-filter-sprint]', ids.sid)

  // the overview panel: identity + badge + the five lanes + total + the actions
  const ov = page.locator('[data-db-sprint-ov]')
  await expect(ov).toBeVisible({ timeout: 5_000 })
  await expect(ov).toContainText('🔥')
  await expect(ov).toContainText('Security')
  await expect(ov.locator('.sp-list-badge')).toHaveText('Active')
  await expect(ov).toContainText('Due Dec 31')
  const counts = ov.locator('.db-sprint-ov-count')
  await expect(counts).toHaveCount(6) // five lanes + total
  await expect(counts.filter({ hasText: 'New Ideas' })).toContainText('2')
  await expect(counts.filter({ hasText: 'Problems' })).toContainText('1')
  await expect(counts.filter({ hasText: 'Plans' })).toContainText('1')
  await expect(counts.filter({ hasText: 'In Progress' })).toContainText('2')
  await expect(counts.filter({ hasText: 'Implemented' })).toContainText('1')
  await expect(ov.locator('.db-sprint-ov-total')).toContainText('7')
  // the actions the ACTIVE state permits + the Settings deep link (Screen G)
  await expect(ov.locator('[data-db-ov-pause]')).toBeVisible()
  await expect(ov.locator('[data-db-ov-finish]')).toBeVisible()
  await expect(ov.locator('[data-db-ov-settings]')).toHaveAttribute('href', `/sprint.html?project=${ids.pid}&sprint=${ids.sid}`)

  // the Settings deep link opens the detail panel (Screen F's mount)
  await page.click('[data-db-ov-settings]')
  await expect(page.locator('.db-sprintdetail-card')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.db-sprintdetail-card .sp-list-badge')).toHaveText('Active')
  await expect(page.locator('.db-sprintdetail-card [data-sd-tab-tasks]')).toBeVisible()

  // the EMBEDDED board ships the same overview (the SHIPPED parity decision)
  await page.goto(`/project.html?id=${ids.pid}`)
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })
  await page.selectOption('[data-pd-filter-sprint]', ids.sid)
  const pdOv = page.locator('[data-pd-sprint-ov]')
  await expect(pdOv).toBeVisible({ timeout: 5_000 })
  await expect(pdOv).toContainText('Security')
  await expect(pdOv.locator('.db-sprint-ov-total')).toContainText('7')
  await expect(pdOv.locator('[data-pd-ov-pause]')).toBeVisible()
  await expect(pdOv.locator('[data-pd-ov-finish]')).toBeVisible()
  expect(errors).toEqual([])
})

test('FA/RTL: the overview + the grouped list + the finish dialog localize and mirror (spec §17)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's243 fa board', status: 'developing' }) })
    const { id: pid } = (await res.json()) as { id: string }
    const s = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'امنیت', emoji: '🔥' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${s.id}/start`, { method: 'POST' })
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'کار امنیتی', status: 'idea', sprint_id: s.id }) })
    return { pid, sid: s.id }
  }, undefined)

  await page.goto(`/kanban?project=${ids.pid}`)
  await expect(page.locator('.db-filter')).toBeVisible({ timeout: 10_000 })
  expect(await page.evaluate(() => document.documentElement.getAttribute('dir') || 'ltr')).toBe('rtl')
  await page.selectOption('[data-db-filter-sprint]', ids.sid)
  const ov = page.locator('[data-db-sprint-ov]')
  await expect(ov).toBeVisible({ timeout: 5_000 })
  await expect(ov.locator('.sp-list-badge')).toHaveText('فعال')
  await expect(ov).toContainText('🔥')
  await expect(ov).toContainText('امنیت')
  await expect(ov.locator('.db-sprint-ov-total')).toContainText('کل')
  // the actions read FA
  await expect(ov.locator('[data-db-ov-pause]')).toContainText('توقف اسپرینت')
  await expect(ov.locator('[data-db-ov-finish]')).toContainText('پایان اسپرینت')
  await expect(ov.locator('[data-db-ov-settings]')).toContainText('تنظیمات')

  // the Sprints page: the grouped sections + the finish dialog mirror to RTL FA
  await page.goto(`/sprint.html?project=${ids.pid}`)
  await sprintsReady(page)
  await expect(page.locator('[data-sp-group="active"]', { hasText: 'امنیت' })).toBeVisible()
  await expect(page.locator('[data-sp-group="active"] .sp-list-badge')).toHaveText('فعال')
  await page.click('#sp-finish-btn')
  const modal = page.locator('.db-sprintmod-card')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal).toHaveAttribute('dir', 'rtl')
  await expect(modal).toContainText('اسپرینت پایان یابد؟')
  await expect(modal).toContainText('هیچ کاری حذف نمی‌شود')
  await page.click('[data-sm-cancel]')
  await expect(modal).toBeHidden()
  expect(errors).toEqual([])
})
