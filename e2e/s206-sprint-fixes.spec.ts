// e2e/s206-sprint-fixes.spec.ts — S206 (owner: "the sprint system is buggy",
// 2026-10-18). Five probe-confirmed bugs, each pinned here:
//   (1) the all-sprints list read "0 items" FOREVER (s.items never existed in
//       the payload — the count now derives from the task pool)
//   (2) the task editor's "＋ New sprint" with an existing DRAFT 409'd and
//       killed the whole save ("Couldn't save") — it now reuses the draft
//   (3) date-picked sprints landed one day early for non-UTC users (the define
//       dialog parsed local midnight; the axis is UTC-day based) — pinned in
//       Tehran time, the owner's timezone
//   (4) the sidebar task → sprint/draft/lane drop the browser always refused
//       (dragover never prevented default outside the sidebar lists)
//   (5) boundary rails stacked above task dots (lane z-index scope-capping) —
//       a dot under a rail could not be CLICKED (editor never opened)
// Contract owners: sprint-page.js (define commit + DnD + renderSprintsList),
// devboard.js (__new save path), devboard.css (the lane z-order fix).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s206sp@test.local'
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
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s206sp', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

/** A running sprint + N tasks assigned to it, through the real API. */
async function seedSprint(page: Page, nTasks: number): Promise<{ pid: string; sid: string }> {
  return await page.evaluate(async (nTasks) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's206 sprint fixes', status: 'developing' }) })
    const { id: pid } = (await res.json()) as { id: string }
    const today = new Date().toISOString().slice(0, 10)
    const sp = await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fix Target', started_at: `${today}T00:00:00Z` }) })
    const { id: sid } = (await sp.json()) as { id: string }
    for (let i = 0; i < nTasks; i++) {
      await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `s206 task ${i + 1}`, status: 'in_progress', sprint_id: sid }) })
    }
    return { pid, sid }
  }, nTasks)
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
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

/** Synthetic HTML5 DnD (the handler-path truth — real drags need hit-testing luck). */
async function synthDrag(page: Page, srcSel: string, dstSel: string, dx = 60, dy = 10) {
  return await page.evaluate(([srcSel, dstSel, dx, dy]) => {
    const src = document.querySelector(srcSel)
    const dst = document.querySelector(dstSel)
    if (!src || !dst) return 'missing ' + (src ? 'dst' : 'src')
    const dt = new DataTransfer()
    const fire = (el: Element, type: string, x?: number, y?: number) => {
      const r = el.getBoundingClientRect()
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x ?? r.x + r.width / 2, clientY: y ?? r.y + r.height / 2 })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    const s1 = fire(src, 'dragstart')
    const dr = dst.getBoundingClientRect()
    const s2 = fire(dst, 'dragover', dr.x + dx, dr.y + dy)
    fire(dst, 'drop', dr.x + dx, dr.y + dy)
    fire(src, 'dragend')
    return JSON.stringify({ dragstartPrevented: s1, dragoverPrevented: s2 })
  }, [srcSel, dstSel, dx, dy] as [string, string, number, number])
}

test('all-sprints list: the item count is REAL (was an eternal "0 items" — s.items never in the payload)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const { pid } = await seedSprint(page, 2)
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 10_000 })
  const row = page.locator('.sp-list-row', { hasText: 'Fix Target' })
  await expect(row).toBeVisible()
  // THE bug: this read "0 items" while 2 tasks sat in the sprint
  await expect(row).toContainText('2 items', { timeout: 5_000 })
  // the chip's stats agree (✓ 0/2)
  await expect(page.locator('.sp-sprint-chip')).toContainText('0/2')
  expect(errors).toEqual([])
})

test('task editor "＋ New sprint": an existing draft is REUSED — the save succeeds (was a 409 save-kill)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const { pid } = await seedSprint(page, 1)
  // a draft exists (the one-draft-at-a-time rule)
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pre-existing draft' }) })
  }, pid)
  // open a task in the board editor and pick "＋ New sprint"
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 10_000 })
  await page.click('.pd-task-wrap >> nth=0')
  await page.waitForSelector('.db-modal-card')
  await page.selectOption('select[data-db-sprint]', '__new')
  await page.click('[data-db-save]')
  // THE bug: this toast was "Couldn't save the idea" + the modal stuck open
  await expect(page.locator('#toast', { hasText: 'Saved' })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(800)
  // the task is saved INTO the pre-existing draft (not lost, not failed)
  const board = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
  const draft = (board.sprints as { id: string; is_draft: number; name: string }[]).find((s) => s.is_draft)
  expect(draft?.name).toBe('Pre-existing draft')
  const assigned = (board.tasks as { title: string; sprint_id: string | null }[]).filter((t) => t.sprint_id === draft!.id)
  expect(assigned).toHaveLength(1)
  expect(errors).toEqual([])
})

test('define with dates: the picked day lands on its OWN cell (Tehran time — the owner\'s timezone; was one day early + a day too wide)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // THE REPRO: a Tehran context. Old code parsed "T00:00:00" (LOCAL midnight) →
  // 20:30Z the previous day → dayIdx one cell left + a phantom extra day.
  const ctx = await page.context().browser()!.newContext({ timezoneId: 'Asia/Tehran', viewport: { width: 1440, height: 900 } } as never)
  const tpage = await ctx.newPage()
  tpage.setDefaultTimeout(15000)
  await tpage.goto('/login.html')
  await tpage.fill('[name="login"]', TEST_EMAIL)
  await tpage.fill('[name="password"]', TEST_PASS)
  await tpage.click('button[type=submit]')
  await tpage.waitForURL('**/app', { timeout: 10_000 })
  const pid = await seedSprint(tpage, 0).then((r) => r.pid)
  await tpage.goto(`/sprint.html?project=${pid}`)
  await tpage.waitForSelector('#sp-wrap:not([hidden])', { timeout: 10_000 })

  // pick today → +3 days (an inclusive 4-day window)
  const localToday = await tpage.evaluate(() => new Date().toLocaleDateString('en-CA'))
  const plus3 = await tpage.evaluate(() => new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-CA'))
  await tpage.click('#sp-new-sprint')
  await tpage.waitForSelector('.sp-define-pop')
  await tpage.fill('[data-sp-define-name]', 'TZ Fixed')
  await tpage.fill('[data-sp-define-start]', localToday)
  await tpage.fill('[data-sp-define-end]', plus3)
  await tpage.click('[data-sp-define-ok]')
  await page.waitForTimeout(1500)

  // duration: 4 inclusive days — the old bug read "5 days"
  await expect(tpage.locator('.sp-sprint-chip', { hasText: 'TZ Fixed' })).toContainText('4 days', { timeout: 5_000 })
  // geometry: the band's start == the LEFT EDGE of today's cell (the today line
  // marks the cell's center; band ≈ line − half a cell, never a full cell left)
  const geom = await tpage.evaluate(() => {
    const tl = document.getElementById('sp-timeline')!
    const band = tl.querySelector('.sp-band') as HTMLElement
    const today = tl.querySelector('.sp-today-line') as HTMLElement
    const body = tl.querySelector('.sp-body')!.getBoundingClientRect().width
    return { bandStart: parseFloat(band.style.insetInlineStart), todayPct: parseFloat(today.style.insetInlineStart), body }
  })
  const halfCellPct = 100 / 34 / 2 // m1 zoom: 31-day window + 3-day pad = 34 cells
  // within a half-cell of the today line's LEFT side (the S44/S48k cell contract)
  expect(Math.abs(geom.bandStart - (geom.todayPct - halfCellPct))).toBeLessThan(halfCellPct)
  await ctx.close()
  expect(errors).toEqual([])
})

test('DnD: a SIDEBAR task dropped on a sprint strip ASSIGNS it (the browser used to refuse the drop outright)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // a sprint with NO tasks + one task sitting unassigned in the sidebar
  const { pid, sid } = await seedSprint(page, 0)
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'sidebar dragger', status: 'in_progress' }) })
  }, pid)
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 10_000 })
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(300)

  // THE bug: dragoverPrevented was FALSE over the sprint strip — the drop died.
  const res = await synthDrag(page, '[data-sptask]', '.sp-sprint', 80, 10)
  expect(JSON.parse(res).dragoverPrevented).toBe(true)
  await page.waitForTimeout(1200)
  // the assignment landed
  const board = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
  const task = (board.tasks as { title: string; sprint_id: string | null }[]).find((t) => t.title === 'sidebar dragger')
  expect(task?.sprint_id).toBe(sid)
  // and the chip's stats now count it
  await expect(page.locator('.sp-sprint-chip')).toContainText('0/1')
  expect(errors).toEqual([])
})

test('DnD: a sidebar task dropped on the DRAFT card joins the draft (the advertised "drag them here" affordance)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const { pid } = await seedSprint(page, 0)
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'draft dragger', status: 'in_progress' }) })
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Draft Drop' }) })
  }, pid)
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 10_000 })
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(300)
  await synthDrag(page, '[data-sptask]', '.sp-draft-card', 120, 20)
  await page.waitForTimeout(1200)
  const board = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
  const draft = (board.sprints as { id: string; is_draft: number }[]).find((s) => s.is_draft)
  const task = (board.tasks as { title: string; sprint_id: string | null }[]).find((t) => t.title === 'draft dragger')
  expect(task?.sprint_id).toBe(draft?.id)
  expect(errors).toEqual([])
})

test('the devboard client NEVER touches the HTTP cache (the live-hang fix — mutations must always re-render)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const { pid } = await seedSprint(page, 1)
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 10_000 })
  // watch every fetch the HibanaBoard client makes — all of them must carry
  // cache: 'no-store'. (Root cause of the LIVE hang: a post-mutation reload of the
  // same URL hung forever in the SW+revalidation path on the Worker host — the
  // timeline went stale until a manual refresh. Pinned here so the flag can't regress.)
  await page.evaluate(() => {
    window.__apiCalls = []
    const orig = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (/devboard|devtasks|\/sprints/.test(url)) window.__apiCalls.push({ url: url.slice(-30), cache: (init && init.cache) || null })
      return orig.apply(this, arguments)
    }
  })
  // quick-add a task (Enter in the sidebar row) — the create + reload round-trip
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(300)
  await page.fill('[data-quickadd="none"]', 'no-store witness')
  await page.press('[data-quickadd="none"]', 'Enter')
  await page.waitForTimeout(1500)
  const calls = await page.evaluate(() => window.__apiCalls)
  expect(calls.length).toBeGreaterThanOrEqual(2) // at least one GET devboard + one POST devtasks
  for (const c of calls) expect(c.cache, JSON.stringify(c)).toBe('no-store')
  // and the reload landed — the new task is IN the re-rendered sidebar (the list
  // collapses again after a reload — presence, not visibility, is the contract)
  await expect(page.locator('.sp-task', { hasText: 'no-store witness' })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('z-order: a task dot under a boundary rail is CLICKABLE (the editor opens — was rail-shadowed dead pixels)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // the common collision: a sprint starting today + a task created today — the
  // dot and the start rail sit in the same cells
  const { pid } = await seedSprint(page, 1)
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 10_000 })
  // THE bug: elementFromPoint at the dot's center returned .sp-bound — the dot
  // could not be clicked or dragged. Now the dot wins the crossing.
  const hit = await page.evaluate(() => {
    const dot = document.querySelector('.sp-dot') as HTMLElement | null
    if (!dot) return 'no dot'
    const r = dot.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return el ? (el.className + ' ' + el.tagName) : 'nothing'
  })
  expect(hit).toContain('sp-dot')
  // clicking it opens the task editor (devboard's shared modal)
  await page.click('.sp-dot >> nth=0')
  await expect(page.locator('.db-modal-card')).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})
