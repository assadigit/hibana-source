// e2e/s247-acceptance.spec.ts — S247 (spec pack PHASE 8 — the acceptance-
// matrix e2e arm). The vitest side (src/tests/acceptance-s247.test.ts) carries
// the traceable matrix; this spec closes the rows that need a REAL browser:
//   1. §24-1 — the BARE CARD contract: a task with no sprint, no deadline and
//      no dependencies renders the PRE-FEATURE card shape (zero feature rows)
//      on BOTH board surfaces (/kanban + the project.html embedded board).
//   2. §24-7 — the threshold boundary SIDES on the EMBEDDED board surface:
//      the s244 e2e pinned the /kanban classes; the embedded board renders
//      through detail-helpers.ts's own server twin — the exact-48h/exactly-7d
//      edges are pinned on that surface here (the vitest round pins the exact
//      equalities on the twin's extracted source; this pins the rendered
//      classes through the real render path).
//   3. §24-6 — the SAME instant displays both ways: the EN board and the FA
//      board (two users, one seeded due instant) name the SAME day — the
//      Gregorian 'Nov 21' and the Jalali '۳۰ آبان' of the identical
//      millisecond (the dueDayLabel seam, spec §17).
//   4. The localization sweep — ONE FA pass over EVERY Phases 3-7 surface:
//      the sprint dropdown + quick-create (S242), the H2 lifecycle dialog
//      (S243), the due control + presets (S244), the J3 extend choice dialog
//      (S245), and the deps section + badges (S246) — Persian copy, dir=rtl.
// Contract owners: the shared devboard.js stack, detail-helpers.ts (the
// server twin), the i18n dictionaries, the seeded-board e2e harness.

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s247@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s247-fa@test.local'

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
  for (const [email, user, lang, cal] of [[TEST_EMAIL, 'e2e-s247', 'en', 'gregorian'], [FA_EMAIL, 'e2e-s247-fa', 'fa', 'shamsi']] as const) {
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
       VALUES ('${id}', '${user}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', '${cal}', 'UTC', '${now}', '${now}')`,
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

async function embeddedReady(page: Page) {
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })
}

/** One seeded board shared by tests 1-3: a bare task, boundary tasks, a
 * same-instant due task, a blocker pair, and (for the FA twin) its own board. */
interface Seed {
  pid: string
  bare: string
  justOver7d: string
  under7d: string
  justOver48h: string
  under48h: string
  sameInstant: string
  blocker: string
  blocked: string
}
async function seedBoard(page: Page, title: string): Promise<Seed> {
  const pid = await page.evaluate(async (t) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t, status: 'developing' }) })
    return ((await res.json()) as { id: string }).id
  }, title)
  return await page.evaluate(async ({ pid }) => {
    const mk = async (title: string, body: Record<string, unknown> = {}) => {
      const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, sprint_id: null, ...body }) })).json()) as { id: string }
      return r.id
    }
    const H = 3600000
    const DAY = 86400000
    const out: Partial<Seed> = { pid }
    out.bare = await mk('s247 bare task (nothing on it)')
    out.justOver7d = await mk('s247 just over 7 days', { due_at: new Date(Date.now() + 7 * DAY + H).toISOString() })
    out.under7d = await mk('s247 just under 7 days', { due_at: new Date(Date.now() + 7 * DAY - 60000).toISOString() })
    out.justOver48h = await mk('s247 just over 48 hours', { due_at: new Date(Date.now() + 48 * H + H).toISOString() })
    out.under48h = await mk('s247 just under 48 hours', { due_at: new Date(Date.now() + 48 * H - 60000).toISOString() })
    // §24-6's fixed instant: Nov 21 2026 12:00 UTC → 1405/08/30 (deterministic)
    out.sameInstant = await mk('s247 same instant task', { due_at: '2026-11-21T12:00:00.000Z' })
    const blocker = await mk('s247 blocker task')
    const blocked = await mk('s247 blocked task')
    await fetch(`/api/devtasks/${blocked}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: blocker }) })
    out.blocker = blocker
    out.blocked = blocked
    return out as Seed
  }, { pid })
}

// ---------------------------------------------------------------------- tests

test('§24-1 — the bare task (no sprint, no deadline, no deps) renders the PRE-FEATURE card shape on BOTH board surfaces', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedBoard(page, 's247 bare board')

  // surface 1 — /kanban (the client twin)
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  const kanbanCard = page.locator(`.pd-task-wrap[data-task-card="${seed.bare}"]`)
  await expect(kanbanCard).toBeVisible({ timeout: 10_000 })
  await expect(kanbanCard.locator('.db-sprint-badge')).toHaveCount(0) // no sprint row
  await expect(kanbanCard.locator('.db-due-row')).toHaveCount(0) // no deadline row
  await expect(kanbanCard.locator('.db-due-bar')).toHaveCount(0) // no bar
  await expect(kanbanCard.locator('.db-dep-badge')).toHaveCount(0) // no dep badges
  // the PRE-FEATURE shape is fully intact: the priority banner + the title +
  // the meta row still render exactly as the S144/S110 grammar dictates
  await expect(kanbanCard.locator('.prio-banner.prio-medium')).toHaveCount(1)
  await expect(kanbanCard.locator('.pd-task-title')).toContainText('s247 bare task')
  await expect(kanbanCard.locator('.pd-task-meta')).toHaveCount(1)
  // …while its loaded neighbors DO render their rows (the board really folds)
  const depCard = page.locator(`.pd-task-wrap[data-task-card="${seed.blocked}"]`)
  await expect(depCard.locator('.db-dep-badge')).toHaveCount(1)
  await expect(page.locator(`.pd-task-wrap[data-task-card="${seed.under48h}"] .db-due-row`)).toHaveClass(/st-urgent/)

  // surface 2 — the project.html embedded board (the server twin)
  await page.goto(`/project.html?id=${seed.pid}`)
  await embeddedReady(page)
  const embCard = page.locator(`.pd-task-wrap[data-pd-task="${seed.bare}"]`)
  await expect(embCard).toBeVisible({ timeout: 10_000 })
  await expect(embCard.locator('.db-sprint-badge')).toHaveCount(0)
  await expect(embCard.locator('.db-due-row')).toHaveCount(0)
  await expect(embCard.locator('.db-due-bar')).toHaveCount(0)
  await expect(embCard.locator('.db-dep-badge')).toHaveCount(0)
  await expect(embCard.locator('.prio-banner.prio-medium')).toHaveCount(1)
  await expect(embCard.locator('.pd-task-meta')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('§24-7 — the threshold boundary SIDES render on the EMBEDDED board surface too (the server twin)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const seed = await seedBoard(page, 's247 embedded boundaries')

  // the embedded board renders through detail-helpers.ts's own twin — the
  // classes must match the /kanban surface's (the exact equalities are pinned
  // on the twin's source in acceptance-s247.test.ts; here the RENDER path)
  await page.goto(`/project.html?id=${seed.pid}`)
  await embeddedReady(page)
  const rowOf = (id: string) => page.locator(`.pd-task-wrap[data-pd-task="${id}"] .db-due-row`)
  await expect(rowOf(seed.justOver7d)).toHaveClass(/st-comfortable/, { timeout: 10_000 })
  await expect(rowOf(seed.under7d)).toHaveClass(/st-approaching/)
  await expect(rowOf(seed.under7d)).toContainText('7 days left')
  await expect(rowOf(seed.justOver48h)).toHaveClass(/st-approaching/)
  await expect(rowOf(seed.under48h)).toHaveClass(/st-urgent/)
  // the WORD carries the meaning on this surface too (never color alone)
  await expect(rowOf(seed.under48h)).toContainText('Due ')
  // the bar renders under the row on the twin as well
  await expect(page.locator(`.pd-task-wrap[data-pd-task="${seed.under48h}"] .db-due-bar .db-due-fill`)).toHaveCount(1)
  expect(errors).toEqual([])
})

test('§24-6 — the SAME instant displays both ways: the EN card row and the FA card row agree on the day (the dueDayLabel seam)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  // the EN board names the seeded instant's day in Gregorian…
  await login(page)
  const seed = await seedBoard(page, 's247 same instant board')
  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  const enRow = page.locator(`.pd-task-wrap[data-task-card="${seed.sameInstant}"] .db-due-row`)
  await expect(enRow).toBeVisible({ timeout: 10_000 })
  // 2026-11-21T12:00Z → 'Due Nov 21 · N days left' — the day NAME is the fixed
  // instant's (deterministic); the DAYS-LEFT is DERIVED (the S250 fix: the count
  // was hardcoded '15' from the round's own 2026-11-06 run and broke overnight —
  // a fixed instant decays one day per day). S252 de-flake: the derivation now
  // mirrors the APP's calendar-day difference (localDayIdx in devboard.js's
  // deadlineLabel — midnight-to-midnight, the fractional 'now' cancels) instead
  // of Math.ceil on raw milliseconds, which disagreed with the app by one day
  // whenever the suite ran between 00:00 and ~12:00 UTC (proven pre-existing on
  // 8118e608 — not an S252 regression). Re-pin the whole test after the
  // instant passes (Nov 21 2026 → Overdue).
  const localDayIdx = (ms: number) => { const d = new Date(ms); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000) }
  const daysLeft = localDayIdx(Date.parse('2026-11-21T12:00:00.000Z')) - localDayIdx(Date.now())
  await expect(enRow).toContainText('Nov 21')
  await expect(enRow).toContainText(daysLeft + ' days left')

  // …and the FA board names the SAME instant's day in Jalali (the vendored
  // converter is the one truth — one underlying millisecond, two spellings)
  const faSeed = await (async () => {
    await login(page, FA_EMAIL)
    return seedBoard(page, 's247 same instant FA')
  })()
  await page.goto(`/kanban?project=${faSeed.pid}`)
  await boardReady(page)
  // the FA surface renders rtl + Farsi
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  const faRow = page.locator(`.pd-task-wrap[data-task-card="${faSeed.sameInstant}"] .db-due-row`)
  await expect(faRow).toBeVisible({ timeout: 10_000 })
  // 1405/08/30 — the SAME day as Nov 21 2026, in the Jalali calendar, in
  // Persian digits; the left-days count is the SAME derived N in Persian digits
  // (the S250 fix — was hardcoded ۱۵)
  const faDig = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
  await expect(faRow).toContainText('۳۰ آبان')
  await expect(faRow).toContainText(faDig(daysLeft) + ' روز مانده')
  expect(errors).toEqual([])
})

test('the localization sweep — ONE FA pass over every Phases 3-7 surface: the sprint dropdown + quick-create, the H2 lifecycle dialog', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)

  // seed: an ACTIVE sprint with a due date + a done task (the H2 dialog's
  // count) + an inheriting task (the J3 choice) + a blocker pair (the badges)
  const seed = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's247 FA sweep', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const s = (await (await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'امنیت', emoji: '🔥', due_at: new Date(Date.now() + 20 * 86400000).toISOString() }) })).json()) as { id: string }
    await fetch(`/api/sprints/${s.id}/start`, { method: 'POST' }) // active — the H2 finish round needs it
    const mk = async (title: string, body: Record<string, unknown> = {}) => {
      const r = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, sprint_id: s.id, ...body }) })).json()) as { id: string }
      return r.id
    }
    const doneT = await mk('کار انجام‌شده', { status: 'done' })
    const inheritor = await mk('کار وارث', {}) // inherits the sprint deadline → the J3 choice
    const blocker = await mk('مسدودکننده')
    const blocked = await mk('مسدودشده')
    await fetch(`/api/devtasks/${blocked}/deps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blocker_id: blocker }) })
    return { pid, sid: s.id, doneT, inheritor, blocked }
  }, undefined)

  await page.goto(`/kanban?project=${seed.pid}`)
  await boardReady(page)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  // S242 — the sprint dropdown: FA labels (بدون اسپرینت + the sprint's name)
  await page.click('.pd-tasks[data-pd-tasks="idea"] [data-add="idea"]')
  await page.waitForSelector('.db-modal-card')
  const sprintSelect = page.locator('select[data-db-sprint]')
  await expect(sprintSelect).toBeVisible()
  await expect(sprintSelect.locator('option', { hasText: 'بدون اسپرینت' })).toHaveCount(1)
  await expect(sprintSelect.locator('option', { hasText: '🔥 امنیت' })).toHaveCount(1)

  // S242 — the quick-create dialog: Persian copy (name + emoji + the two
  // OFF-by-default toggles + the create button) — opens at SELECTION time
  await page.selectOption('select[data-db-sprint]', '__new')
  const q = page.locator('.db-sprintq')
  await expect(q).toBeVisible({ timeout: 5_000 })
  await expect(q.locator('[data-sq-name]')).toBeFocused() // the focus pin (a11y twin)
  await expect(q).toContainText('ایموجی (اختیاری)')
  await expect(q).toContainText('افزودن توضیح')
  await expect(q).toContainText('تعیین مهلت')
  await expect(q.locator('[data-sq-create]')).toContainText('ساخت اسپرینت')
  // the FA due mount (shamsi default): toggle it ON → the Jalali input shows
  await q.locator('[data-sq-due-toggle]').check()
  const qc = q.locator('[data-sq-due-mount]')
  await expect(qc).toBeVisible()
  await expect(qc.locator('[data-due-j]')).toBeVisible() // the shamsi default calendar
  // the six presets in Persian
  for (const p of ['امروز', '۲۴ ساعت', '۴۸ ساعت', '۷۲ ساعت', 'این هفته', 'این ماه']) {
    await expect(qc.locator('.db-due-presets')).toContainText(p)
  }
  await q.locator('[data-sq-cancel]').click()
  await expect(q).toBeHidden()

  // S246 — the deps section: Persian labels, collapsed by default
  const depsToggle = page.locator('[data-db-deps-toggle]')
  await expect(depsToggle).toContainText('وابستگی‌ها (اختیاری)')
  await expect(depsToggle).toHaveAttribute('aria-expanded', 'false')
  await depsToggle.click()
  await expect(page.locator('[data-db-deps-mount]')).toBeVisible()
  await expect(page.locator('[data-db-deps-q]')).toHaveAttribute('placeholder', 'جستجوی وظایف…')
  await expect(page.locator('[data-db-deps-mount]')).toContainText('مسدود شده توسط')
  await page.keyboard.press('Escape') // the capture-phase shield closes the editor
  await expect(page.locator('.db-modal-card:not(.db-sprintq-card):not(.db-sprintmod-card)')).toBeHidden()

  // S246 — the dep badges on the FA card (Persian words + digits)
  const blockedCard = page.locator(`.pd-task-wrap[data-task-card="${seed.blocked}"]`)
  await expect(blockedCard.locator('.db-dep-badge')).toContainText('مسدود')

  // S243 — the H2 finish dialog: Persian copy + the counts (the /kanban
  // overview's own finish action)
  await page.selectOption('[data-db-filter-sprint]', seed.sid)
  const ov = page.locator('[data-db-sprint-ov]')
  await expect(ov).toBeVisible({ timeout: 5_000 })
  await ov.locator('[data-db-ov-finish]').click()
  const h2 = page.locator('.db-sprintmod')
  await expect(h2).toBeVisible({ timeout: 5_000 })
  await expect(h2).toContainText('اسپرینت پایان یابد؟')
  await expect(h2).toContainText('هیچ کاری حذف نمی‌شود.')
  await expect(h2.locator('[data-sm-cancel], .db-sprintmod [data-sm-close]')).toBeVisible()
  await h2.locator('[data-sm-close]').click()
  await expect(h2).toBeHidden()

  // S245 — the J3 extend CHOICE dialog: the two FA arms with their scope lines
  const inheritCard = page.locator(`.pd-task-wrap[data-task-card="${seed.inheritor}"]`)
  await expect(inheritCard.locator('.db-due-row')).toBeVisible({ timeout: 10_000 })
  await inheritCard.locator('.pd-task').hover()
  await inheritCard.locator('[data-db-extend]').click()
  const j3 = page.locator('.db-sprintmod')
  await expect(j3).toBeVisible({ timeout: 5_000 })
  await expect(j3).toContainText('تمدید این مهلت')
  await expect(j3).toContainText('تمدید مهلت اسپرینت')
  await expect(j3).toContainText('تمدید فقط همین وظیفه')
  await j3.locator('[data-sm-close]').click()
  await expect(j3).toBeHidden()
  expect(errors).toEqual([])
})
