// e2e/s242-sprint-ui.spec.ts — S242 (spec pack PHASE 3 — the Core Kanban +
// task-form UI, sprint integration). The full client round on top of the
// Phase 1+2 API surface:
//   1. D2 CLOSED: the Add-Task modal's create body sends an EXPLICIT
//      sprint_id — "No sprint" really means No sprint (a draft sprint exists
//      in the project; the created task must land UNASSIGNED, not in the
//      legacy draft/open auto-assign the old `|| undefined` body tripped).
//   2. The toolbar SPRINT VIEW FILTER: default All tasks; No sprint; a named
//      sprint (with its emoji glyph); composing with search + priority; and
//      it never mutates assignments.
//   3. The sprint dropdown: identity glyph per option; COMPLETED sprints are
//      not new-assignment options, but a task ALREADY in one keeps it as its
//      selected value (historical association).
//   4. The QUICK-CREATE dialog: required name, the shared emoji picker, the
//      duplicate-name 409 answered INLINE (no silent rename), success closes
//      + selects the new sprint for the current task.
//   5. The card SPRINT IDENTITY row: emoji (or the default ◆) + name under
//      the description; absent for unassigned tasks.
// Contract owners: devboard.js (modal + quick-create), board-page.js (filter
// + cards), project-page.js (the embedded filter twin), devboard.css.

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s242@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s242-fa@test.local'

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
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s242', 'en'], [FA_EMAIL, 'e2e-s242-fa', 'fa']] as const) {
    const id = randomBytes(16).toString('hex')
    try {
      db.exec(`DELETE FROM dev_task_deps WHERE blocked_task_id IN (SELECT id FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${email}')))`)
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
  tasks: { id: string; title: string; status: string; priority: string; sprint_id: string | null }[]
  sprints: { id: string; name: string; is_draft: number; status: string; emoji: string | null; ended_at: string | null }[]
}

async function boardOf(page: Page, pid: string): Promise<Board> {
  return await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/, /Failed to load resource.*409/]
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

/** Opens the ADD-TASK modal from the idea lane's Add control (the bottom
 *  .pd-task-add on a populated lane, the .pd-empty-add on an empty one). */
async function openAddModal(page: Page) {
  await page.click('.pd-tasks[data-pd-tasks="idea"] [data-add="idea"]')
  await page.waitForSelector('.db-modal-card')
}

/** The board-ready wait: the columns render whether or not tasks exist (the
 *  filter bar only renders on a populated board). */
async function boardReady(page: Page) {
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#db-loading')).toBeHidden()
}

test('D2 closed: Add Task with "No sprint" lands the task UNASSIGNED — even with a draft sprint in the project (the old undefined body auto-assigned)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 d2 board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  // a DRAFT sprint exists — the legacy auto-assign would swallow the task into it
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 's242 dangling draft' }) })
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await openAddModal(page)
  await page.fill('[name=title]', 's242 no-sprint task')
  // the sprint select defaults to No sprint — leave it untouched
  const sprintVal = await page.locator('select[data-db-sprint]').inputValue()
  expect(sprintVal).toBe('')
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Task added' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)

  // THE D2 PIN: the created task carries sprint_id = null (NOT the draft's id)
  const board = await boardOf(page, pid)
  const created = board.tasks.find((t) => t.title === 's242 no-sprint task')
  expect(created).toBeTruthy()
  expect(created!.sprint_id).toBeNull()
  expect(errors).toEqual([])
})

test('the toolbar sprint VIEW FILTER: All tasks default → No sprint → a named sprint → composes with search + priority; never mutates', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 filter board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const seed = await page.evaluate(async (pid) => {
    // Lifecycle-correct seeding (the Phase 1 invariants): a task may only be
    // ASSIGNED while its sprint is not completed — so Old runs ACTIVE first,
    // takes its task, and Security's create-with-dates auto-closes it (the
    // legacy mechanic; the VIEW filter must still find its unfinished task).
    const old = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Old sprint', started_at: '2026-10-01T00:00:00Z' }) })).json()) as { id: string }
    const mk = (title: string, sprint_id: string | null, priority: string) =>
      fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'idea', priority, sprint_id }) })
    await mk('delta in old completed', old.id, 'medium')
    const sprint = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Security', emoji: '🔥', started_at: '2026-10-10T00:00:00Z' }) })).json()) as { id: string }
    await mk('alpha in security', sprint.id, 'high')
    await mk('beta in security', sprint.id, 'low')
    await mk('gamma unassigned', null, 'high')
    return { sid: sprint.id, doneId: old.id }
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-filter')).toBeVisible({ timeout: 10_000 })
  const sel = page.locator('[data-db-filter-sprint]')

  // DEFAULT = All tasks; every task visible
  await expect(page.locator('.pd-task-wrap')).toHaveCount(4, { timeout: 10_000 })
  await expect(sel).toHaveValue('')

  // the options carry the identity glyphs (emoji / default ◆ / No sprint / All)
  const options = await sel.locator('option').allTextContents()
  expect(options.some((o) => o.includes('🔥') && o.includes('Security'))).toBe(true)
  expect(options.some((o) => o.includes('Old sprint'))).toBe(true) // completed stays a VIEW option
  expect(options.some((o) => o === 'No sprint')).toBe(true)
  expect(options[0]).toBe('All tasks')

  // NO SPRINT: only the unassigned task
  await sel.selectOption('__none')
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator('.pd-task-wrap .pd-task-title')).toContainText('gamma unassigned')

  // a NAMED sprint: only its two tasks
  await sel.selectOption(seed.sid)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2, { timeout: 5_000 })

  // the COMPLETED sprint stays filterable (its unfinished task is findable)
  await sel.selectOption(seed.doneId)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator('.pd-task-wrap .pd-task-title')).toContainText('delta in old completed')

  // COMPOSES with search: back to Security + search "beta" → 1 task
  await sel.selectOption(seed.sid)
  await page.fill('[data-db-filter-q]', 'beta')
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 5_000 })
  // …× priority HIGH → 0 (beta is low) — and the miss state shows
  await page.click('[data-fp="high"]')
  await expect(page.locator('.pd-task-wrap')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('[data-db-filter-empty]')).toBeVisible()
  // clear everything → all four back
  await page.click('[data-db-filter-clear]')
  await expect(page.locator('.pd-task-wrap')).toHaveCount(4, { timeout: 5_000 })
  await expect(sel).toHaveValue('')

  // NEVER MUTATES: the assignments are untouched after all that filtering
  const board = await boardOf(page, pid)
  expect(board.tasks.filter((t) => t.sprint_id === seed.sid)).toHaveLength(2)
  expect(board.tasks.filter((t) => t.sprint_id === null)).toHaveLength(1)
  expect(errors).toEqual([])
})

test('the sprint dropdown: completed sprints are hidden from NEW assignment — but a task already in one keeps it selected', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 dropdown board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const ids = await page.evaluate(async (pid) => {
    // Lifecycle-correct: Finished runs ACTIVE, takes its task, then /finish
    // completes it (the task KEEPS its association — the historical case).
    // Open is created as the project's DRAFT after the finish (its window
    // would overlap Finished's [start → finish-stamped end] — S235's guard).
    const finished = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Finished sprint', started_at: '2026-10-01T00:00:00Z' }) })).json()) as { id: string }
    const legacy = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 legacy task', status: 'idea', sprint_id: finished.id }) })).json()) as { id: string }
    await fetch(`/api/sprints/${finished.id}/finish`, { method: 'POST' })
    const open = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Open sprint', emoji: '🚀' }) })).json()) as { id: string }
    return { open: open.id, completed: finished.id, legacy: legacy.id }
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-filter')).toBeVisible({ timeout: 10_000 })

  // ADD modal: the completed sprint is NOT among the options (spec §8/Screen D)
  await openAddModal(page)
  const addOptions = await page.locator('select[data-db-sprint] option').allTextContents()
  expect(addOptions.some((o) => o.includes('Finished sprint'))).toBe(false)
  expect(addOptions.some((o) => o.includes('🚀') && o.includes('Open sprint'))).toBe(true)
  expect(addOptions[0]).toBe('No sprint')
  await page.click('[data-db-close]')

  // EDIT the legacy task: its CURRENT completed sprint STAYS the selected value
  // (historical association — the PATCH re-assert stays legal server-side)
  await page.click(`[data-task-card="${ids.legacy}"]`)
  await page.waitForSelector('.db-view-card')
  await page.click('[data-db-view-edit]')
  await page.waitForSelector('.db-modal-card')
  const editVal = await page.locator('select[data-db-sprint]').inputValue()
  expect(editVal).toBe(ids.completed)
  const editOptions = await page.locator('select[data-db-sprint] option').allTextContents()
  expect(editOptions.some((o) => o.includes('Finished sprint'))).toBe(true) // its own row survives
  // the re-assert save is legal (no 400 sprint_completed on the CURRENT sprint)
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Saved' })).toBeVisible({ timeout: 5_000 })
  expect(errors).toEqual([])
})

test('the quick-create dialog: name + emoji picker + duplicate 409 INLINE + auto-select on success', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 quickcreate board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  await page.evaluate(async (pid) => {
    // ACTIVE (not a draft) — the quick-create's 'Performance' must be able to
    // become the project's one draft (spec: one draft per project)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Security', emoji: '🔥', started_at: '2026-10-10T00:00:00Z' }) })
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await openAddModal(page)
  await page.fill('[name=title]', 's242 quickcreated task')

  // ＋ New sprint → the quick-create dialog opens ON TOP of the task modal
  await page.selectOption('select[data-db-sprint]', '__new')
  await expect(page.locator('.db-sprintq-card')).toBeVisible({ timeout: 5_000 })
  // the description + due inputs are hidden until their toggles flip (spec §4.2)
  await expect(page.locator('[data-sq-desc]')).toBeHidden()
  await expect(page.locator('[data-sq-due]')).toBeHidden()

  // the emoji picker (the shared full-library picker): open + pick a tile
  await page.click('[data-sq-emoji-btn]')
  await expect(page.locator('.emoji-pop.open')).toBeVisible({ timeout: 10_000 })
  await page.click('.emoji-pop-em >> nth=0')
  await expect(page.locator('[data-sq-emoji-cur]')).not.toContainText('◆')

  // required name: empty → inline error, dialog stays
  await page.click('[data-sq-create]')
  await expect(page.locator('[data-sq-error]')).toContainText('name', { timeout: 5_000 })

  // DUPLICATE (case-insensitive): "SECURITY" → 409 duplicate → INLINE error,
  // the dialog stays open, nothing renamed
  await page.fill('[data-sq-name]', 'SECURITY')
  await page.click('[data-sq-create]')
  await expect(page.locator('[data-sq-error]')).toContainText('case-insensitive', { timeout: 5_000 })
  await expect(page.locator('.db-sprintq-card')).toBeVisible()
  const board1 = await boardOf(page, pid)
  expect(board1.sprints.filter((s) => /security/i.test(s.name))).toHaveLength(1) // no silent twin

  // a FRESH name succeeds: dialog closes, the dropdown refreshes + selects the
  // new sprint for the current task (spec §7.1 recommended default)
  await page.fill('[data-sq-name]', 'Performance')
  await page.click('[data-sq-create]')
  await expect(page.locator('.db-sprintq-card')).toBeHidden({ timeout: 5_000 })
  await expect(page.locator('.db-modal-card:not(.db-sprintq-card)')).toBeVisible()
  const selVal = await page.locator('select[data-db-sprint]').inputValue()
  const board2 = await boardOf(page, pid)
  const created = board2.sprints.find((s) => s.name === 'Performance')
  expect(created).toBeTruthy()
  expect(selVal).toBe(created!.id)
  expect(created!.emoji).toBeTruthy() // the picked emoji rode the create body

  // save the task INTO it (end-to-end): the task lands in the new sprint
  await page.click('[data-db-save]')
  await expect(page.locator('#toast', { hasText: 'Task added' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(600)
  const board3 = await boardOf(page, pid)
  const task = board3.tasks.find((t) => t.title === 's242 quickcreated task')
  expect(task?.sprint_id).toBe(created!.id)
  expect(errors).toEqual([])
})

test('the card SPRINT IDENTITY row: emoji (or ◆) + name under the description — absent for unassigned', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 cards board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const ids = await page.evaluate(async (pid) => {
    // Emoji runs ACTIVE; Plain is the project's DRAFT (planned — both assignable;
    // one active + one draft coexist legally)
    const emoji = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Emoji Sprint', emoji: '🚀', started_at: '2026-10-10T00:00:00Z' }) })).json()) as { id: string }
    const plain = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Plain Sprint' }) })).json()) as { id: string }
    const mk = (title: string, sprint_id: string | null) =>
      fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'idea', sprint_id }) })
    await mk('s242 emoji task', emoji.id)
    await mk('s242 plain task', plain.id)
    await mk('s242 bare task', null)
    return { emoji: emoji.id, plain: plain.id }
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-filter')).toBeVisible({ timeout: 10_000 })

  // the emoji sprint's card: 🚀 + name, as its OWN row under the description
  const emojiCard = page.locator(`[data-task-card]`, { hasText: 's242 emoji task' }).locator('.pd-task-body > .db-sprint-badge')
  await expect(emojiCard).toHaveText('🚀 Emoji Sprint', { timeout: 10_000 })
  // the plain sprint's card: the default ◆ glyph (the legacy shape)
  const plainCard = page.locator(`[data-task-card]`, { hasText: 's242 plain task' }).locator('.pd-task-body > .db-sprint-badge')
  await expect(plainCard).toHaveText('◆ Plain Sprint')
  // the unassigned card: NO badge row at all
  const bareCard = page.locator('[data-task-card]', { hasText: 's242 bare task' })
  await expect(bareCard).toHaveCount(1)
  await expect(bareCard.locator('.db-sprint-badge')).toHaveCount(0)

  // the embedded board renders the byte-identical twin (S209 1:1 parity)
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })
  const embeddedEmoji = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pd-task-wrap')] as HTMLElement[]
    const card = cards.find((c) => c.textContent?.includes('s242 emoji task'))
    const badge = card?.querySelector('.pd-task-body > .db-sprint-badge')
    return badge?.textContent?.trim() || ''
  })
  expect(embeddedEmoji).toBe('🚀 Emoji Sprint')
  expect(errors).toEqual([])
})

test('FA/RTL: the sprint filter, the dropdown and the quick-create dialog localize + mirror (spec §17)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's242 fa board', status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, undefined)
  const sid = await page.evaluate(async (pid) => {
    const sprint = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'امنیت', emoji: '🔥' }) })).json()) as { id: string }
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'کار امنیتی', status: 'idea', sprint_id: sprint.id }) })
    return sprint.id
  }, pid)

  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await expect(page.locator('.db-filter')).toBeVisible({ timeout: 10_000 })
  expect(await page.evaluate(() => document.documentElement.getAttribute('dir') || 'ltr')).toBe('rtl')

  // the FILTER select reads FA: All tasks / No sprint / the sprint with its glyph
  const sel = page.locator('[data-db-filter-sprint]')
  await expect(sel.locator('option').first()).toHaveText('همهٔ کارها')
  const faOptions = await sel.locator('option').allTextContents()
  expect(faOptions.some((o) => o.includes('بدون اسپرینت'))).toBe(true)
  expect(faOptions.some((o) => o.includes('🔥') && o.includes('امنیت'))).toBe(true)
  // filtering works in RTL exactly as LTR (the named sprint → only its task)
  await sel.selectOption(sid)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 5_000 })
  // the card badge sits at the READING-START edge — in RTL that is the RIGHT
  // half of the card (logical ordering; justify-self:start mirrors with dir)
  const badgeSide = await page.evaluate(() => {
    const badge = document.querySelector('.pd-task-body > .db-sprint-badge') as HTMLElement | null
    if (!badge) return ''
    const b = badge.getBoundingClientRect()
    const card = (badge.closest('.pd-task') as HTMLElement).getBoundingClientRect()
    const badgeCenter = (b.left + b.right) / 2
    const cardCenter = (card.left + card.right) / 2
    return badgeCenter > cardCenter ? 'right' : 'left'
  })
  expect(badgeSide).toBe('right')

  // the quick-create dialog: FA labels + the card's dir follows the locale
  await openAddModal(page)
  await page.selectOption('select[data-db-sprint]', '__new')
  await expect(page.locator('.db-sprintq-card')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.db-sprintq-card')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('.db-sprintq-card .db-field span').first()).toHaveText('نام اسپرینت')
  await expect(page.locator('[data-sq-emoji-label]')).toHaveText('انتخاب ایموجی')
  await expect(page.locator('.db-sq-toggle').first()).toContainText('افزودن توضیح')
  await expect(page.locator('.db-sq-toggle').nth(1)).toContainText('تعیین مهلت')
  // required-name inline error reads FA too
  await page.click('[data-sq-create]')
  await expect(page.locator('[data-sq-error]')).toContainText('نام', { timeout: 5_000 })
  await page.click('[data-sq-cancel]')
  await page.click('[data-db-close]')
  expect(errors).toEqual([])
})
