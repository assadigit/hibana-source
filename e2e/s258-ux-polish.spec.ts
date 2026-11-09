// e2e/s258-ux-polish.spec.ts — S258 (AUDIT-REMEDIATION-SPEC.md §10 — Phase 7,
// the UI/UX polish round). Pins the four island findings end-to-end:
//   1. FE-18 — the "Move to" submenu in the card ⋯ menu: the CENSUS (Copy +
//      Edit + Move to + Delete), the keyboard-reachable lane change (no DnD
//      required), the current lane excluded, the two touched lanes repaint.
//   2. FE-11 (scoped) — "Clear done" fires EXACTLY ONE network request to the
//      bulk POST …/devtasks/clear-done (was: a per-task DELETE fan-out), the
//      lane empties, the toast carries the server's count.
//   3. FE-9 — the strategy focus-filter explainer strip on the sprint page:
//      naming the active strategy, explaining the hidden sprint-less tasks,
//      and the one-click Clear; EN + FA/RTL legs.
//   4. FE-17 — the sprint sidebar survives re-renders: an expanded category
//      stays expanded, a quick-add draft keeps its text (and focus).
// (FE-6's focus containment lives in s247-a11y.spec.ts — the a11y spec's own
// extension, per the audit's ask to assert containment, not just Tab-walks.)

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s258@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s258-fa@test.local'

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
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s258', 'en'], [FA_EMAIL, 'e2e-s258-fa', 'fa']] as const) {
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

async function boardReady(page: Page) {
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#db-loading')).toBeHidden()
}

async function sprintsReady(page: Page) {
  await expect(page.locator('#sp-wrap')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#sp-loading')).toBeHidden()
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

// ---------------------------------------------------------------------- tests

test('FE-18 — the card ⋯ menu census + the Move-to submenu: keyboard-reachable lane change, current lane excluded, both lanes repaint', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 move board', status: 'developing' }) })
    return ((await res.json()) as { id: string }).id
  }, undefined)
  const tid = await page.evaluate(async (pid) => {
    const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 movable task', status: 'idea' }) })).json()) as { id: string }
    return r.id
  }, pid)
  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)

  // THE CENSUS (re-pinned for the new member): Copy + Edit + Move to + Delete
  const wrap = page.locator(`.pd-task-wrap[data-task-card="${tid}"]`)
  await wrap.locator('.pd-task').hover()
  await wrap.locator('.db-card-menu [data-menu-open]').click()
  const pop = wrap.locator('.spark-menu-pop')
  await expect(pop).toBeVisible()
  await expect(pop.locator('[data-db-copy-card]')).toBeVisible()
  await expect(pop.locator('[data-db-edit-card]')).toBeVisible()
  await expect(pop.locator('[data-db-del-card]')).toBeVisible()
  const moveBtn = pop.locator('[data-db-move-menu]')
  await expect(moveBtn).toBeVisible()
  await expect(moveBtn).toHaveAttribute('aria-haspopup', 'true')
  await expect(moveBtn).toHaveAttribute('aria-expanded', 'false')
  await expect(moveBtn).toContainText('Move to')

  // THE SUBMENU: hidden until toggled; the CURRENT lane (idea) is excluded
  const sub = pop.locator('.db-move-submenu')
  await expect(sub).toBeHidden()
  await moveBtn.click()
  await expect(sub).toBeVisible()
  await expect(moveBtn).toHaveAttribute('aria-expanded', 'true')
  const laneRows = sub.locator('[data-db-move-to]')
  await expect(laneRows).toHaveCount(4) // the five lanes minus the task's own
  await expect(sub.locator('[data-db-move-to="idea"]')).toHaveCount(0)
  await expect(laneRows.first()).toBeFocused() // the keyboard path lands in the choices

  // THE MOVE (keyboard): Enter on the focused first row → the task changes lanes
  await laneRows.first().press('Enter') // first row = bug (STATUSES order, idea excluded)
  await expect(page.locator('.pd-col[data-status="bug"] .pd-task-wrap')).toHaveCount(1)
  await expect(page.locator('.pd-col[data-status="idea"] .pd-task-wrap')).toHaveCount(0)
  await expect(page.locator('.pd-col[data-status="bug"] [data-task-card]')).toHaveAttribute('data-task-card', tid)
  // the menu closed + the toast named the destination
  await expect(page.locator('.spark-menu-pop:not([hidden])')).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('Moved to')

  // server truth + a second move back (the row set re-derives from the NEW lane)
  const board = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
  expect((board as { tasks: { id: string; status: string }[] }).tasks.find((t) => t.id === tid)?.status).toBe('bug')
  const wrapBug = page.locator(`.pd-task-wrap[data-task-card="${tid}"]`)
  await wrapBug.locator('.pd-task').hover()
  await wrapBug.locator('.db-card-menu [data-menu-open]').click()
  await wrapBug.locator('[data-db-move-menu]').click()
  const subBug = wrapBug.locator('.db-move-submenu')
  await expect(subBug.locator('[data-db-move-to="bug"]')).toHaveCount(0) // the new current lane excluded
  await subBug.locator('[data-db-move-to="planned"]').click()
  await expect(page.locator('.pd-col[data-status="planned"] .pd-task-wrap')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('FE-11 (scoped) — Clear done is ONE bulk request to the new endpoint; the lane empties + the toast carries the server count', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 clear board', status: 'developing' }) })
    return ((await res.json()) as { id: string }).id
  }, undefined)
  await page.evaluate(async (pid) => {
    const mk = (title: string, status: string) => fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status }) })
    await mk('s258 done one', 'done')
    await mk('s258 done two', 'done')
    await mk('s258 done three', 'done')
    await mk('s258 keeper', 'planned')
  }, pid)
  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page)
  await expect(page.locator('.pd-col[data-status="done"] .pd-task-wrap')).toHaveCount(3)

  // count EVERY devtasks network request the clear fires
  const reqs: string[] = []
  page.on('request', (r) => { if (r.url().includes('/devtasks')) reqs.push(r.method() + ' ' + r.url()) })

  await page.locator('.pd-col[data-status="done"] [data-db-col-menu]').click()
  await page.locator('[data-db-clear-done]').click()
  const confirmOverlay = page.locator('.hib-confirm-overlay')
  await expect(confirmOverlay).toBeVisible()
  await confirmOverlay.locator('[data-hib-confirm="ok"]').click()
  await expect(page.locator('.pd-col[data-status="done"] .pd-task-wrap')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('.pd-col[data-status="planned"] .pd-task-wrap')).toHaveCount(1) // the keeper survives

  // THE ONE REQUEST: exactly one POST to the bulk endpoint, ZERO per-task DELETEs
  const clears = reqs.filter((r) => r.startsWith('POST') && r.includes('/devtasks/clear-done'))
  const deletes = reqs.filter((r) => r.startsWith('DELETE') && /\/api\/devtasks\//.test(r))
  expect(clears, 'exactly one bulk clear-done POST').toHaveLength(1)
  expect(deletes, 'zero per-task DELETEs (the fan-out is retired)').toHaveLength(0)
  await expect(page.locator('.toast')).toContainText('3')
  expect(errors).toEqual([])
})

test('FE-9 — the strategy focus-filter explainer strip: names the strategy, explains the hidden sprint-less tasks, the Clear resets; FA/RTL leg', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 strip board', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const strat = (await (await fetch(`/api/projects/${pid}/strategies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Be seen more' }) })).json()) as { id: string }
    const spr = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'SEO', strategy_id: strat.id }) })).json()) as { id: string }
    // a task IN the strategy's sprint + a sprint-less task (the silently-hidden victim)
    const inSprint = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 in strategy', sprint_id: spr.id }) })).json()) as { id: string }
    const loose = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 loose task', sprint_id: null }) })).json()) as { id: string }
    await fetch(`/api/sprints/${spr.id}/start`, { method: 'POST' })
    return { pid, strat: strat.id, spr: spr.id, inSprint: inSprint.id, loose: loose.id }
  }, undefined)

  await page.goto(`/sprint.html?project=${ids.pid}`)
  await sprintsReady(page)
  const strip = page.locator('#sp-filter-strip')
  await expect(strip).toBeHidden() // no filter → no strip

  // turn the focus filter ON (the strategy card click)
  await page.locator(`[data-strategy-card="${ids.strat}"]`).click()
  await expect(strip).toBeVisible()
  await expect(strip).toContainText('Be seen more')
  await expect(strip).toContainText('tasks without sprints are hidden')
  // the sprint-less task's bar is gone from the timeline; the strategy's stays
  await expect(page.locator(`[data-bar="${ids.inSprint}"]`)).toBeVisible()
  await expect(page.locator(`[data-bar="${ids.loose}"]`)).toHaveCount(0)

  // THE CLEAR — the audit's "weak reset discoverability" fix
  await strip.locator('[data-sp-filter-clear]').click()
  await expect(strip).toBeHidden()
  await expect(page.locator(`[data-bar="${ids.loose}"]`)).toBeVisible() // the sprint-less task is back

  // ---- the FA/RTL leg: the strip localizes + mirrors
  await login(page, FA_EMAIL)
  const faIds = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 strip fa', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const strat = (await (await fetch(`/api/projects/${pid}/strategies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'دیده‌شدن بیشتر' }) })).json()) as { id: string }
    const spr = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'سئو', strategy_id: strat.id }) })).json()) as { id: string }
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'کار آزاد', sprint_id: null }) })
    await fetch(`/api/sprints/${spr.id}/start`, { method: 'POST' })
    return { pid, strat: strat.id }
  }, undefined)
  await page.goto(`/sprint.html?project=${faIds.pid}`)
  await sprintsReady(page)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.locator(`[data-strategy-card="${faIds.strat}"]`).click()
  const faStrip = page.locator('#sp-filter-strip')
  await expect(faStrip).toBeVisible()
  await expect(faStrip).toContainText('دیده‌شدن بیشتر')
  await expect(faStrip).toContainText('کارهای بدون اسپرینت پنهان شده‌اند')
  await expect(faStrip.locator('[data-sp-filter-clear]')).toContainText('پاک‌کردن')
  await faStrip.locator('[data-sp-filter-clear]').click()
  await expect(faStrip).toBeHidden()
  expect(errors).toEqual([])
})

test('FE-17 — the sprint sidebar survives re-renders: the expanded fold stays open, the quick-add draft keeps its text + focus', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 side board', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const cat = (await (await fetch(`/api/projects/${pid}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'SideCat', color_fill: '#5B8DEF', color_text: '#FFFFFF' }) })).json()) as { id: string }
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's258 side task', category_id: cat.id }) })
    return { pid, cat: cat.id }
  }, undefined)

  await page.goto(`/sprint.html?project=${ids.pid}`)
  await sprintsReady(page)

  // expand the category fold + draft text into its quick-add
  const catHead = page.locator(`[data-cat-toggle="${ids.cat}"]`)
  await expect(catHead).toHaveAttribute('data-open', '0')
  await catHead.click()
  await expect(catHead).toHaveAttribute('data-open', '1')
  const quick = page.locator(`[data-quickadd="${ids.cat}"]`)
  await expect(quick).toBeVisible()
  await quick.type('draft not to lose')

  // trigger a FULL re-render through the eye toggle (render() — the same path a
  // concurrent mutation takes)
  await page.locator(`[data-cat-eye="${ids.cat}"]`).click()
  await page.waitForTimeout(300)

  // the fold SURVIVED + the draft text SURVIVED + focus came back to the input
  await expect(catHead).toHaveAttribute('data-open', '1')
  await expect(page.locator(`[data-spcat="${ids.cat}"] .sp-cat-tasks`)).not.toHaveClass(/is-collapsed/)
  await expect(quick).toHaveValue('draft not to lose')
  await expect(quick).toBeFocused()

  // toggle the eye back (restore the lane) — the state still survives
  await page.locator(`[data-cat-eye="${ids.cat}"]`).click()
  await page.waitForTimeout(300)
  await expect(catHead).toHaveAttribute('data-open', '1')
  await expect(quick).toHaveValue('draft not to lose')

  // and the draft still SUBMITS cleanly after all those re-renders
  await quick.press('Enter')
  await expect(page.locator(`[data-spcat="${ids.cat}"] .sp-task`)).toHaveCount(2, { timeout: 10_000 })
  expect(errors).toEqual([])
})
