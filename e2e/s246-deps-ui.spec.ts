// e2e/s246-deps-ui.spec.ts — S246 (spec pack PHASE 7 — the task DEPENDENCIES
// UI, spec §14-§16 + Screens K/L). The mechanics all exist (the S240/S241
// write + read surfaces); this spec pins the UI end-to-end:
//   1. Screen K + the CROSS-SPRINT link (§14.1: dependencies connect tasks in
//      different sprints of the SAME project): the editor's Dependencies
//      section is COLLAPSED by default; expanding reveals the searchable
//      Blocked-by multi-select; selecting a task in ANOTHER sprint links LIVE
//      (the recorded decision — POST at the pick); Save reloads the board and
//      BOTH ends wear their badges: the blocked task `Blocked`, the blocker
//      the DERIVED `Blocks 1` (spec §15 — never a second input).
//   2. §16.1 multi-blocker + resolution: A blocked by B+C reads `Blocked · 2`;
//      completing B alone keeps it BLOCKED (until ALL blockers complete);
//      completing C flips it to `Ready` — and the relationship is RETAINED
//      (§16: resolving never erases the link).
//   3. The SOFT constraint (assumption 2 / §16.1): a BLOCKED task still moves
//      to done through the editor — nothing gates Kanban movement.
//   4. The CYCLE rejection inline (§14.2): with A blocked-by B, opening B's
//      editor and picking A answers the 409 INLINE with the pick named; the
//      failed pick never sticks.
//   5. The SELF rejection inline (§14.2): picking the task itself answers the
//      400 INLINE ("a task cannot block itself"); never sticks.
//   6. The ADD-MODE staged flow: a NEW task created with a staged blocker link
//      POSTs the link right after the create ack — both badges render.
//   7. The task view (the details surface, §16): the blocked card's read-only
//      view carries the blocker NAMES.
//   8. FA/RTL (§17): the section + the badges localize (Persian copy) and the
//      mirrored layout renders.
// Contract owners: devboard.js (the shared dep stack + the modal section),
// board-page.js (the card badges + the view twin), project-page.js (the
// repaint twin), detail-helpers.ts (the server twin + the detail pool's
// taskDeps), src/routes/devboard.ts (the existing deps endpoints).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s246@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s246-fa@test.local'

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
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s246', 'en'], [FA_EMAIL, 'e2e-s246-fa', 'fa']] as const) {
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

interface DepBoard {
  tasks: { id: string; title: string; status: string; sprint_id: string | null }[]
  sprints: { id: string; name: string }[]
  task_deps: { blocker_task_id: string; blocked_task_id: string }[]
}

async function boardOf(page: Page, pid: string): Promise<DepBoard> {
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

async function boardReady(page: Page) {
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#db-loading')).toBeHidden()
}

/** Opens the EDIT modal through the ⋯ menu (the S238 contract). */
async function openEditModal(page: Page, taskId: string) {
  await page.locator(`.pd-task-wrap[data-task-card="${taskId}"] .pd-task`).hover()
  await page.locator(`.pd-task-wrap[data-task-card="${taskId}"] .db-card-menu [data-menu-open]`).click()
  await page.locator(`.pd-task-wrap[data-task-card="${taskId}"] [data-db-edit-card]`).click()
  await expect(page.locator('.db-modal-card')).toBeVisible({ timeout: 5_000 })
}

/** Expands the Dependencies section (collapsed by default — Screen K). */
async function expandDeps(page: Page) {
  const toggle = page.locator('[data-db-deps-toggle]')
  await expect(toggle).toBeVisible()
  await expect(page.locator('[data-db-deps-mount]')).toBeHidden() // collapsed by default
  await toggle.click()
  await expect(page.locator('[data-db-deps-mount]')).toBeVisible()
  await expect(page.locator('[data-db-deps-list] .db-deps-opt').first()).toBeVisible({ timeout: 5_000 })
}

/** Seeds a project with an ACTIVE sprint Alpha + a PAUSED sprint Beta (the
 * S245 seed recipe: a create-with-dates sprint auto-closes the active sibling,
 * so the sibling seeds FIRST and PAUSES) + tasks in both sprints. */
async function seedDepsBoard(page: Page, title: string) {
  const pid = await page.evaluate(async (t) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, status: 'developing' }) })
    return ((await res.json()) as { id: string }).id
  }, title)
  const mkSprint = async (name: string, pause: boolean) =>
    page.evaluate(async ({ pid, name, pause }) => {
      const r = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, started_at: new Date(Date.now() - 30 * 86400000).toISOString() }) })).json()) as { id: string }
      if (pause) await fetch(`/api/sprints/${r.id}/pause`, { method: 'POST' })
      return r.id
    }, { pid, name, pause })
  const betaId = await mkSprint('Beta', true) // paused — cross-sprint target
  const alphaId = await mkSprint('Alpha', false) // active
  const mk = async (taskTitle: string, body: Record<string, unknown>) =>
    page.evaluate(async ({ pid, taskTitle, body }) => {
      const res = await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: taskTitle, ...body }) })
      return ((await res.json()) as { id: string }).id
    }, { pid, taskTitle, body })
  const a = await mk('s246 task A (alpha)', { sprint_id: alphaId })
  const b = await mk('s246 task B (beta)', { sprint_id: betaId }) // a DIFFERENT sprint
  const c = await mk('s246 task C (no sprint)', { sprint_id: null })
  return { pid, alphaId, betaId, a, b, c }
}

// ---------------------------------------------------------------------- tests

test('Screen K + §14.1 + §15 — the collapsed section, the searchable multi-select, the LIVE cross-sprint link, and the DERIVED reverse badge', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 link board')

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  await openEditModal(page, seed.a)
  await expandDeps(page)

  // the section's anatomy: the Blocked-by label, the search, the note, the
  // derived-reverse explanation (Screen K)
  const mount = page.locator('[data-db-deps-mount]')
  await expect(mount).toContainText('Blocked by')
  await expect(mount).toContainText('The reverse Blocks view is derived automatically')
  // every option carries the title + sprint identity + status (Screen K)
  const optB = mount.locator(`[data-dep="${seed.b}"]`)
  await expect(optB).toContainText('s246 task B (beta)')
  await expect(optB).toContainText('Beta')
  await expect(optB).toContainText('New Ideas')
  // the SEARCH narrows the list by title
  await page.fill('[data-db-deps-q]', 'task C')
  await expect(mount.locator('.db-deps-opt')).toHaveCount(1)
  await expect(optB).toBeHidden()
  await page.fill('[data-db-deps-q]', '')
  const optCount = await mount.locator('.db-deps-opt').count()
  expect(optCount).toBeGreaterThanOrEqual(3)

  // the LIVE link (the recorded decision): selecting B POSTs immediately —
  // the option flips selected WITHOUT saving the modal
  await optB.click()
  await expect(optB).toHaveClass(/is-on/, { timeout: 5_000 })
  await expect(optB).toHaveAttribute('aria-selected', 'true')
  // the server already carries the edge (live, never a save-batched diff)
  const mid = await boardOf(page, seed.pid)
  expect(mid.task_deps).toEqual([{ blocker_task_id: seed.b, blocked_task_id: seed.a }])

  // Save → the board reloads → BOTH ends wear their badges (Screen L)
  await page.locator('[data-db-save]').click()
  await page.waitForTimeout(600)
  const cardA = page.locator(`.pd-task-wrap[data-task-card="${seed.a}"]`)
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toBeVisible({ timeout: 5_000 })
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toContainText('Blocked')
  const cardB = page.locator(`.pd-task-wrap[data-task-card="${seed.b}"]`)
  await expect(cardB.locator('.db-dep-badge.st-blocks')).toBeVisible({ timeout: 5_000 })
  await expect(cardB.locator('.db-dep-badge.st-blocks')).toContainText('Blocks 1')
  // §14.1: the cross-sprint link EXISTS (A in Alpha, B in Beta)
  const after = await boardOf(page, seed.pid)
  expect(after.tasks.find((t) => t.id === seed.a)!.sprint_id).toBe(seed.alphaId)
  expect(after.tasks.find((t) => t.id === seed.b)!.sprint_id).toBe(seed.betaId)
  expect(after.task_deps.length).toBe(1)
  expect(errors).toEqual([])
})

test('§16.1 — multi-blocker stays BLOCKED until ALL complete; the resolution flips to Ready and RETAINS the relationship', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 resolution board')
  // A blocked by B + C
  for (const blocker of [seed.b, seed.c]) {
    await page.evaluate(async ({ a, blocker }) => {
      await fetch(`/api/devtasks/${a}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: blocker }) })
    }, { a: seed.a, blocker })
  }

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  const cardA = page.locator(`.pd-task-wrap[data-task-card="${seed.a}"]`)
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toBeVisible({ timeout: 5_000 })
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toContainText('Blocked · 2')

  // B done → A is STILL blocked (C remains)
  await page.evaluate(async (b) => { await fetch(`/api/devtasks/${b}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }) }, seed.b)
  await page.reload()
  await boardReady(page)
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toBeVisible({ timeout: 5_000 })
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toContainText('Blocked · 2')

  // C done → the RESOLUTION: Ready (§16.1's completion surfacing)
  await page.evaluate(async (c) => { await fetch(`/api/devtasks/${c}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }) }, seed.c)
  await page.reload()
  await boardReady(page)
  await expect(cardA.locator('.db-dep-badge.st-ready')).toBeVisible({ timeout: 5_000 })
  await expect(cardA.locator('.db-dep-badge.st-ready')).toContainText('Ready')
  // §16: the RELATIONSHIP is retained — resolving never erases the links
  const after = await boardOf(page, seed.pid)
  expect(after.task_deps.length).toBe(2)
  expect(errors).toEqual([])
})

test('§16.1 + assumption 2 — the SOFT constraint: a BLOCKED task still moves to done through the editor (nothing gates Kanban movement)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 soft board')
  await page.evaluate(async ({ a, b }) => {
    await fetch(`/api/devtasks/${a}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: b }) })
  }, { a: seed.a, b: seed.b })

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  await expect(page.locator(`.pd-task-wrap[data-task-card="${seed.a}"] .db-dep-badge.st-blocked`)).toBeVisible({ timeout: 5_000 })

  // the blocked task moves to done THROUGH THE EDITOR — no gate, no warning
  await openEditModal(page, seed.a)
  await page.locator('.db-seg[data-seg="status"] button[data-val="done"]').click()
  await page.locator('[data-db-save]').click()
  await page.waitForTimeout(600)
  // the task LANDED in done (the move succeeded) + its badge still renders
  const doneCard = page.locator(`.pd-tasks[data-pd-tasks="done"] .pd-task-wrap[data-task-card="${seed.a}"]`)
  await expect(doneCard).toBeVisible({ timeout: 5_000 })
  const after = await boardOf(page, seed.pid)
  expect(after.tasks.find((t) => t.id === seed.a)!.status).toBe('done')
  // the blocker B keeps its derived Blocks badge + was never mutated
  expect(after.tasks.find((t) => t.id === seed.b)!.status).toBe('idea')
  expect(errors).toEqual([])
})

test('§14.2 — the CYCLE rejection inline: picking a task this one already blocks answers the 409 with the pick named; the pick never sticks', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 cycle board')
  // A blocked-by B (so B→A would close the loop A→B→A)
  await page.evaluate(async ({ a, b }) => {
    await fetch(`/api/devtasks/${a}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: b }) })
  }, { a: seed.a, b: seed.b })

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  await openEditModal(page, seed.b) // B's editor: picking A must 409
  await expandDeps(page)
  const optA = page.locator(`[data-dep="${seed.a}"]`)
  await optA.click()
  // the INLINE error names the offending pick (never a generic toast)
  const err = page.locator('[data-db-deps-err]')
  await expect(err).toBeVisible({ timeout: 5_000 })
  await expect(err).toContainText('Circular dependency: s246 task A (alpha)')
  // the failed pick never sticks (the option stays unselected)
  await expect(optA).not.toHaveClass(/is-on/)
  await expect(optA).toHaveAttribute('aria-selected', 'false')
  // the edge was NEVER written (the board carries exactly the one A←B edge)
  const after = await boardOf(page, seed.pid)
  expect(after.task_deps).toEqual([{ blocker_task_id: seed.b, blocked_task_id: seed.a }])
  expect(errors).toEqual([])
})

test('§14.2 — the SELF rejection inline: picking the task itself answers the 400 ("a task cannot block itself"); never sticks', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 self board')

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  await openEditModal(page, seed.a)
  await expandDeps(page)
  // the current task stays LISTED (marked "this task") — the honest surface
  const optSelf = page.locator(`[data-dep="${seed.a}"]`)
  await expect(optSelf).toContainText('this task')
  await optSelf.click()
  const err = page.locator('[data-db-deps-err]')
  await expect(err).toBeVisible({ timeout: 5_000 })
  await expect(err).toContainText('A task cannot block itself.')
  await expect(optSelf).not.toHaveClass(/is-on/)
  // no edge was written
  const after = await boardOf(page, seed.pid)
  expect(after.task_deps).toEqual([])
  expect(errors).toEqual([])
})

test('Screen K (add mode) — the STAGED flow: a new task created with a staged blocker link POSTs after the create ack; both badges render', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 staged board')

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  await page.click('.pd-tasks[data-pd-tasks="idea"] [data-add="idea"]')
  await expect(page.locator('.db-modal-card')).toBeVisible({ timeout: 5_000 })
  await expandDeps(page)
  const mount = page.locator('[data-db-deps-mount]')
  // the add-mode note (the recorded decision's add-mode contract)
  await expect(mount).toContainText('Links are created when the task is saved.')
  // stage B as the blocker of the NEW task
  await mount.locator(`[data-dep="${seed.b}"]`).click()
  await expect(mount.locator(`[data-dep="${seed.b}"]`)).toHaveClass(/is-on/)
  // nothing posted yet (the task does not exist — staging only)
  const mid = await boardOf(page, seed.pid)
  expect(mid.task_deps).toEqual([])
  // create the task
  await page.fill('[name=title]', 's246 the new blocked task')
  await page.locator('[data-db-save]').click()
  await page.waitForTimeout(700)
  const after = await boardOf(page, seed.pid)
  const created = after.tasks.find((t) => t.title === 's246 the new blocked task')!
  expect(created).toBeTruthy()
  expect(after.task_deps).toEqual([{ blocker_task_id: seed.b, blocked_task_id: created.id }])
  // both ends wear their badges
  await expect(page.locator(`.pd-task-wrap[data-task-card="${created.id}"] .db-dep-badge.st-blocked`)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator(`.pd-task-wrap[data-task-card="${seed.b}"] .db-dep-badge.st-blocks`)).toContainText('Blocks 1')
  expect(errors).toEqual([])
})

test('§16 — the task VIEW (the details surface) carries the blocker NAMES; the card stays compact', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedDepsBoard(page, 's246 view board')
  for (const blocker of [seed.b, seed.c]) {
    await page.evaluate(async ({ a, blocker }) => {
      await fetch(`/api/devtasks/${a}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: blocker }) })
    }, { a: seed.a, blocker })
  }

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  // the CARD badge stays compact (counts, never the long names)
  const cardA = page.locator(`.pd-task-wrap[data-task-card="${seed.a}"]`)
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toContainText('Blocked · 2')
  await expect(cardA.locator('.db-dep-badge.st-blocked')).not.toContainText('task B')
  // the VIEW (a card click) names the blockers (§16: names belong in details)
  await cardA.locator('.pd-task').click()
  const view = page.locator('.db-view-card')
  await expect(view).toBeVisible({ timeout: 5_000 })
  await expect(view.locator('.db-dep-badge.st-blocked')).toContainText('Blocked by: s246 task B (beta) · s246 task C (no sprint)')
  // the blocker's view carries the reverse row with the blocked task's name
  await page.keyboard.press('Escape')
  await page.locator(`.pd-task-wrap[data-task-card="${seed.b}"] .pd-task`).click()
  await expect(view.locator('.db-dep-badge.st-blocks')).toContainText('Blocks: s246 task A (alpha)')
  expect(errors).toEqual([])
})

test('§17 — FA/RTL: the section + the badges localize; the mirrored layout renders', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)
  const seed = await seedDepsBoard(page, 's246 fa board')
  await page.evaluate(async ({ a, b }) => {
    await fetch(`/api/devtasks/${a}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: b }) })
  }, { a: seed.a, b: seed.b })

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  // the FA badges read Persian + the digits mirror
  const cardA = page.locator(`.pd-task-wrap[data-task-card="${seed.a}"]`)
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toBeVisible({ timeout: 5_000 })
  await expect(cardA.locator('.db-dep-badge.st-blocked')).toContainText('مسدود')
  await expect(page.locator(`.pd-task-wrap[data-task-card="${seed.b}"] .db-dep-badge.st-blocks`)).toContainText('مسدودکنندهٔ ۱')
  // the FA view row reads Persian
  await cardA.locator('.pd-task').click()
  await expect(page.locator('.db-view-card .db-dep-badge.st-blocked')).toContainText('مسدود شده توسط: s246 task B (beta)')
  await page.keyboard.press('Escape')
  // the section localizes + the RTL mount renders the mirrored options
  await openEditModal(page, seed.a)
  const toggle = page.locator('[data-db-deps-toggle]')
  await expect(toggle).toContainText('وابستگی‌ها (اختیاری)')
  await toggle.click()
  const mount = page.locator('[data-db-deps-mount]')
  await expect(mount).toBeVisible()
  await expect(mount).toContainText('مسدود شده توسط')
  await expect(mount.locator('[data-db-deps-q]')).toHaveAttribute('placeholder', 'جستجوی وظایف…')
  await expect(mount).toContainText('نمای معکوس «مسدود می‌کند» به‌صورت خودکار محاسبه می‌شود')
  // the current blockers are pre-selected in the FA editor
  await expect(mount.locator(`[data-dep="${seed.b}"]`)).toHaveClass(/is-on/)
  expect(errors).toEqual([])
})
