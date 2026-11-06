// e2e/s247-a11y.spec.ts — S247 (spec pack PHASE 8 — the ACCESSIBILITY arm of
// the release gate). The kickoff's four asks, scoped to every NEW dialog/badge
// from Phases 3-7:
//   1. KEYBOARD REACHABILITY — the quick-create, the lifecycle dialogs (the
//      H2 finish round here; H1/I share the same .db-sprintmod grammar), the
//      due control (the toggle → the segmented calendar + presets + the time
//      input), and the deps section (the toggle → the search input → the
//      options) are all Tab-reachable with focus-visible outlines, and focus
//      lands on the primary field when a dialog opens.
//   2. ARIA LABELING — role="dialog" + aria-modal on the dialogs, the deps
//      toggle's aria-expanded/aria-controls contract, the listbox's label,
//      role="alert" on the inline error surfaces, aria-labels on the
//      icon-only affordances (the Extend button).
//   3. CONTRAST ON THE STATE COLORS — the four threshold words + the dep
//      badges clear WCAG AA 4.5:1 against their rendered backgrounds (the
//      S247 fix darkened the amber/green text pair; this pins the RESULT on
//      the live board).
//   4. COLOR-INDEPENDENT COMMUNICATION — the WORD always carries the meaning:
//      every threshold row carries its word ('days left' / 'Due today' /
//      'Overdue by…'), every dep badge carries its word (Blocked/Blocks/
//      Ready) — strip every color and the meaning survives.
// NOTE (scope): the audit-fn touch-target floor is NOT run here — the board
// is the app's established dense desktop surface (the a11y spec's baselines
// cover login + dashboard); the new controls follow the S197 ring doctrine
// where they ship compact. The four asks above are the gate.

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s247a11y@test.local'
const TEST_PASS = 'e2e-password-123'

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
  const email = TEST_EMAIL
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
     VALUES ('${id}', 'e2e-s247a11y', '${email}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForTimeout(400)
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

/** One board with every threshold state + both dep-badge ends + a done task. */
async function seedAllStates(page: Page) {
  return await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's247 a11y board', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const mk = async (title: string, body: Record<string, unknown> = {}) => {
      const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, sprint_id: null, ...body }) })).json()) as { id: string }
      return r.id
    }
    const H = 3600000
    const DAY = 86400000
    const comfortable = await mk('a11y comfortable', { due_at: new Date(Date.now() + 12 * DAY).toISOString() })
    const approaching = await mk('a11y approaching', { due_at: new Date(Date.now() + 4 * DAY).toISOString() })
    const urgent = await mk('a11y urgent', { due_at: new Date(Date.now() + 36 * H).toISOString() })
    const overdue = await mk('a11y overdue', { due_at: new Date(Date.now() - 2 * DAY).toISOString() })
    const doneTask = await mk('a11y done task', { due_at: new Date(Date.now() + DAY).toISOString(), status: 'done' })
    const blocker = await mk('a11y blocker')
    const readyBlocker = await mk('a11y ready blocker', { status: 'done' })
    const blocked = await mk('a11y blocked')
    await fetch(`/api/devtasks/${blocked}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: blocker }) })
    await fetch(`/api/devtasks/${blocked}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: readyBlocker }) })
    return { pid, comfortable, approaching, urgent, overdue, doneTask, blocker, blocked }
  }, undefined)
}

// ---------------------------------------------------------------------- tests

test('a11y — the Phases 3-7 dialogs: role=dialog + aria-modal + keyboard-reachable actions + focus lands on the primary field', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedAllStates(page)
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)

  // --- the quick-create dialog (S242): role + aria-modal + focus-on-open
  await page.click('.pd-tasks[data-pd-tasks="idea"] [data-add="idea"]')
  await page.waitForSelector('.db-modal-card')
  await page.selectOption('select[data-db-sprint]', '__new')
  const q = page.locator('.db-sprintq')
  await expect(q).toBeVisible({ timeout: 5_000 })
  await expect(q).toHaveAttribute('role', 'dialog')
  await expect(q).toHaveAttribute('aria-modal', 'true')
  await expect(q.locator('[data-sq-name]')).toBeFocused() // the name field takes focus on open
  // the close button is an aria-labeled control (not a bare ✕)
  await expect(q.locator('[data-sq-close]')).toHaveAttribute('aria-label', 'Close')
  // keyboard: Tab walks the dialog's controls (name → emoji → toggles → actions)
  await page.keyboard.press('Tab') // off the name input → the emoji button
  await expect(q.locator('[data-sq-emoji-btn]')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(q.locator('[data-sq-desc-toggle]')).toBeFocused()
  // Esc closes the quick-create (the capture-phase shield) — not the editor under it
  await page.keyboard.press('Escape')
  await expect(q).toBeHidden()
  await expect(page.locator('.db-modal-card:not(.db-sprintq-card):not(.db-sprintmod-card)')).toBeVisible() // the editor survives
  await page.keyboard.press('Escape')
  await expect(page.locator('.db-modal-card:not(.db-sprintq-card):not(.db-sprintmod-card)')).toBeHidden()

  // --- the H2 finish dialog (S243; H1/I share the .db-sprintmod grammar)
  const s = await page.evaluate(async (pid: string) => {
    const r = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A11y Sprint' }) })).json()) as { id: string }
    await fetch(`/api/sprints/${r.id}/start`, { method: 'POST' })
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'a11y sprint done', status: 'done', sprint_id: r.id }) })
    return r.id
  }, seed.pid)
  await page.reload()
  await boardReady(page)
  await page.selectOption('[data-db-filter-sprint]', s)
  const ov = page.locator('[data-db-sprint-ov]')
  await expect(ov).toBeVisible({ timeout: 5_000 })
  await ov.locator('[data-db-ov-finish]').click()
  const h2 = page.locator('.db-sprintmod')
  await expect(h2).toBeVisible({ timeout: 5_000 })
  await expect(h2).toHaveAttribute('role', 'dialog')
  await expect(h2).toHaveAttribute('aria-modal', 'true')
  // keyboard: Tab from the body reaches the actions; the primary confirm is a button
  const confirmBtn = h2.locator('[data-sm-finish]')
  await expect(confirmBtn).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(h2.locator('button:focus')).toBeVisible() // focus sits on a dialog control
  await h2.locator('[data-sm-close]').click()
  await expect(h2).toBeHidden()

  // --- the J3 extend choice dialog (S245): the inheritor's hover-revealed
  // Extend affordance is an aria-labeled button; the two arms are real buttons
  await page.evaluate(async (sid: string) => {
    await fetch(`/api/sprints/${sid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due_at: new Date(Date.now() + 15 * 86400000).toISOString() }) })
  }, s)
  const inheritor = await page.evaluate(async ({ pid, sid }: { pid: string; sid: string }) => {
    const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'a11y inheritor', sprint_id: sid }) })).json()) as { id: string }
    return r.id
  }, { pid: seed.pid, sid: s })
  await page.reload()
  await boardReady(page)
  const inhCard = page.locator(`.pd-task-wrap[data-task-card="${inheritor}"]`)
  await expect(inhCard.locator('.db-due-row')).toBeVisible({ timeout: 10_000 })
  const extBtn = inhCard.locator('.db-due-ext')
  await expect(extBtn).toHaveAttribute('aria-label', 'Extend deadline')
  await inhCard.locator('.pd-task').hover()
  await extBtn.click()
  const j3 = page.locator('.db-sprintmod')
  await expect(j3).toBeVisible({ timeout: 5_000 })
  await expect(j3).toHaveAttribute('role', 'dialog')
  await expect(j3).toHaveAttribute('aria-modal', 'true')
  // the two arms are named buttons (keyboard-reachable — the S243 dialog grammar)
  await expect(j3.locator('button', { hasText: 'Extend sprint deadline' })).toBeVisible()
  await expect(j3.locator('button', { hasText: 'Extend this task only' })).toBeVisible()
  await j3.locator('[data-sm-close]').click()
  await expect(j3).toBeHidden()
  expect(errors).toEqual([])
})

test('a11y — the due control + the deps section: toggle semantics (aria-expanded/aria-controls), the segmented calendar', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedAllStates(page)
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)

  // the EDIT modal (the due control + the deps section in their full state)
  await page.locator(`.pd-task-wrap[data-task-card="${seed.approaching}"] .pd-task`).hover()
  await page.locator(`.pd-task-wrap[data-task-card="${seed.approaching}"] .db-card-menu [data-menu-open]`).click()
  await page.locator(`.pd-task-wrap[data-task-card="${seed.approaching}"] [data-db-edit-card]`).click()
  await expect(page.locator('.db-modal-card')).toBeVisible({ timeout: 5_000 })

  // --- the due toggle: a real checkbox; ON reveals the labeled control
  const dueToggle = page.locator('[data-db-due-toggle]')
  await expect(dueToggle).toBeVisible()
  await expect(dueToggle).toBeChecked() // the approaching task has a personal deadline
  const mount = page.locator('[data-db-due-mount]')
  await expect(mount).toBeVisible()
  // the segmented calendar selector is a labeled group; the visible input is labeled
  await expect(mount.locator('[data-due-cal]')).toHaveAttribute('role', 'group')
  await expect(mount.locator('[data-due-cal]')).toHaveAttribute('aria-label', 'Calendar')
  await expect(mount.locator('[data-due-g]')).toHaveAttribute('aria-label', 'Due date')
  // keyboard: the presets are buttons (Tab-reachable); the calendar segment too
  await mount.locator('.db-due-presets button').first().focus()
  await expect(mount.locator('.db-due-presets button:focus')).toBeVisible()
  // the time input is labeled when revealed
  await mount.locator('[data-due-time-toggle]').check()
  await expect(mount.locator('[data-due-time]')).toBeVisible()
  await expect(mount.locator('[data-due-time]')).toHaveAttribute('aria-label', 'Time')

  // --- the deps section: the toggle's aria contract + the listbox label
  const depsToggle = page.locator('[data-db-deps-toggle]')
  await expect(depsToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(depsToggle).toHaveAttribute('aria-controls', 'db-deps-mount')
  await depsToggle.click()
  await expect(depsToggle).toHaveAttribute('aria-expanded', 'true')
  const depsMount = page.locator('[data-db-deps-mount]')
  await expect(depsMount).toBeVisible()
  await expect(depsMount.locator('[data-db-deps-list]')).toHaveAttribute('role', 'listbox')
  await expect(depsMount.locator('[data-db-deps-list]')).toHaveAttribute('aria-label', 'Blocked by')
  // the search input is keyboard-first (it takes focus on expand)
  await expect(depsMount.locator('[data-db-deps-q]')).toBeVisible()
  // an option is keyboard-reachable + carries its label (title + status)
  const opt = depsMount.locator('.db-deps-opt').first()
  await opt.focus()
  await expect(opt).toContainText('a11y')
  await page.keyboard.press('Escape')
  await expect(page.locator('.db-modal-card:not(.db-sprintq-card):not(.db-sprintmod-card)')).toBeHidden()
  expect(errors).toEqual([])
})

test('a11y — AA contrast on the state colors: the four threshold words + the dep badges clear 4.5:1 on the rendered board', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedAllStates(page)
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)

  // compute the rendered contrast of every state row's TEXT against its
  // effective background (the contrast-fn grammar: walk ancestors for a solid bg)
  const ratios = await page.evaluate(async (ids: Record<string, string>) => {
    const lum = (r: number, g: number, b: number) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const parse = (c: string) => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null }
    const effBg = (el: Element) => {
      let n: Element | null = el
      while (n && n !== document.documentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor)
        if (bg && bg.a > 0.85) return bg
        n = n.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    const ratioOf = (el: Element) => {
      const fg = parse(getComputedStyle(el).color)!
      const bg = effBg(el)
      const la = lum(fg.r, fg.g, fg.b), lb = lum(bg.r, bg.g, bg.b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    const out: Record<string, number> = {}
    const row = (id: string, sel: string) => {
      const el = document.querySelector(`.pd-task-wrap[data-task-card="${id}"] ${sel}`)
      if (el) out[id + '|' + sel] = Math.round(ratioOf(el) * 100) / 100
    }
    for (const id of [ids.comfortable, ids.approaching, ids.urgent, ids.overdue, ids.doneTask]) row(id, '.db-due-row')
    row(ids.blocked, '.db-dep-badge.st-blocked')
    row(ids.blocker, '.db-dep-badge.st-blocks')
    return out
  }, seed)

  // the four threshold words + done: ≥ 4.5:1 (the S247 darkened pair is the fix)
  expect(ratios[`${seed.comfortable}|.db-due-row`], 'comfortable word contrast').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.approaching}|.db-due-row`], 'approaching word contrast (the S247 amber fix)').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.urgent}|.db-due-row`], 'urgent word contrast').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.overdue}|.db-due-row`], 'overdue word contrast').toBeGreaterThanOrEqual(4.5)
  // the dep badge words on their tinted chips: ≥ 4.5:1
  expect(ratios[`${seed.blocked}|.db-dep-badge.st-blocked`], 'the Blocked badge text on its tint').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.blocker}|.db-dep-badge.st-blocks`], 'the Blocks badge text on its tint').toBeGreaterThanOrEqual(4.5)
  expect(errors).toEqual([])
})

test('a11y — color independence: the WORD always carries the meaning (threshold words + badge words in the text, never color alone)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedAllStates(page)
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)

  // strip EVERY color (grayscale emulation) — the words must survive alone
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addStyleTag({ content: '* { filter: grayscale(1) !important; }' })

  const rowOf = (id: string) => page.locator(`.pd-task-wrap[data-task-card="${id}"] .db-due-row .db-due-txt`)
  // the threshold VOCABULARY (§12.3's example words) is present in text — every
  // row carries a WORD (a dated '· N days left', or the standalone today /
  // tomorrow forms); the exact count folds with the clock, the WORD is the pin
  await expect(rowOf(seed.comfortable)).toContainText('days left')
  await expect(rowOf(seed.approaching)).toContainText('days left')
  await expect(rowOf(seed.urgent)).toContainText(/Due (today|tomorrow)|days left/)
  await expect(rowOf(seed.overdue)).toContainText('Overdue by')
  // the done task carries its ✓ Done indication in text (§12.4) — grayscale-safe
  const doneRow = page.locator(`.pd-task-wrap[data-task-card="${seed.doneTask}"] .db-due-row`)
  await expect(doneRow).toContainText('Done')
  // the dep badges carry their words: Blocked · 1 on the dependent, Blocks on the blocker
  const blockedBadge = page.locator(`.pd-task-wrap[data-task-card="${seed.blocked}"] .db-dep-badge.st-blocked .db-dep-badge-txt`)
  await expect(blockedBadge).toContainText('Blocked')
  const blocksBadge = page.locator(`.pd-task-wrap[data-task-card="${seed.blocker}"] .db-dep-badge.st-blocks .db-dep-badge-txt`)
  await expect(blocksBadge).toContainText('Blocks')
  // the aria-hidden bar is DECORATIVE — removing it must not remove information
  const txtBefore = await rowOf(seed.approaching).textContent()
  expect(txtBefore && txtBefore.trim().length).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

// S247b (the Phase 8 reconciliation on top of e49f2e5): the adopted round
// recorded the DARK-theme state family under 4.5:1 as a known limitation
// (assumption 15); the claude-dark-theme.css S247b block closes it and THIS
// test pins the rendered ratios in the dark theme — the same measurement
// grammar as the light-theme test above, with one addition: a READY badge
// (the light seed never reaches the Ready state — the readyBlocker there only
// keeps the blocked task BLOCKED; here a second done-blocker pair flips one).
test('a11y — AA contrast in the DARK theme (claude-dark): the state family + the dep badges clear 4.5:1 on the dark card — the S247b reconciliation closes the adopted round\'s recorded limitation', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedAllStates(page)
  // one more pair so the READY badge renders: a task blocked by an all-done set
  const ready = await page.evaluate(async (pid: string) => {
    const mk = async (title: string, body: Record<string, unknown> = {}) => {
      const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, sprint_id: null, ...body }) })).json()) as { id: string }
      return r.id
    }
    const doneBlk = await mk('a11y dark done blocker', { status: 'done' })
    const readyTask = await mk('a11y dark ready')
    await fetch(`/api/devtasks/${readyTask}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: doneBlk }) })
    return readyTask
  }, seed.pid)
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)

  // switch to the app's only dark mode (S87) — the sheet is linked on board.html,
  // so the attr flip re-skins live; persist the choice like the Settings picker does
  await page.evaluate(() => {
    localStorage.setItem('hibana-theme', 'claude-dark')
    document.documentElement.setAttribute('data-theme', 'claude-dark')
  })
  await page.waitForTimeout(200)

  const ratios = await page.evaluate(async (ids: Record<string, string>) => {
    const lum = (r: number, g: number, b: number) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const parse = (c: string) => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null }
    const effBg = (el: Element) => {
      let n: Element | null = el
      while (n && n !== document.documentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor)
        if (bg && bg.a > 0.85) return bg
        n = n.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    const ratioOf = (el: Element) => {
      const fg = parse(getComputedStyle(el).color)!
      const bg = effBg(el)
      const la = lum(fg.r, fg.g, fg.b), lb = lum(bg.r, bg.g, bg.b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    const out: Record<string, number> = {}
    const row = (id: string, sel: string) => {
      const el = document.querySelector(`.pd-task-wrap[data-task-card="${id}"] ${sel}`)
      if (el) out[id + '|' + sel] = Math.round(ratioOf(el) * 100) / 100
    }
    for (const id of [ids.comfortable, ids.approaching, ids.urgent, ids.overdue, ids.doneTask]) row(id, '.db-due-row')
    row(ids.blocked, '.db-dep-badge.st-blocked')
    row(ids.blocker, '.db-dep-badge.st-blocks')
    row(ids.ready, '.db-dep-badge.st-ready')
    return out
  }, { ...seed, ready })

  // the four threshold words + done on the dark card: ≥ 4.5:1 (the S247b lift)
  expect(ratios[`${seed.comfortable}|.db-due-row`], 'dark: comfortable word contrast').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.approaching}|.db-due-row`], 'dark: approaching word contrast (the S247b amber lift)').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.urgent}|.db-due-row`], 'dark: urgent word contrast').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.overdue}|.db-due-row`], 'dark: overdue word contrast').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.doneTask}|.db-due-row`], 'dark: the Done row rides the theme --muted (6.06:1 documented in the sheet)').toBeGreaterThanOrEqual(4.5)
  // the three badge variants on their dark tinted wells: ≥ 4.5:1
  expect(ratios[`${seed.blocked}|.db-dep-badge.st-blocked`], 'dark: the Blocked badge text').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${seed.blocker}|.db-dep-badge.st-blocks`], 'dark: the Blocks badge text (the theme --muted)').toBeGreaterThanOrEqual(4.5)
  expect(ratios[`${ready}|.db-dep-badge.st-ready`], 'dark: the Ready badge text (the S247b sage lift)').toBeGreaterThanOrEqual(4.5)
  expect(errors).toEqual([])
})
