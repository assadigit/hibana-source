// e2e/s209-kanban-parity.spec.ts — S209 (owner ask 2026-10-20): "Making sure the
// kanban in the hibana is 1:1 the same as the kanban in projects.hibana.ir/kanban.
// Basically they're the same thing — this domain is just meant as a direct,
// less-distracting way to reach the kanban."
//
// The 1:1 parity contract:
//   1. /board.html?project= ≡ /kanban — same file, same contracts (frame,
//      switcher, filter bar, labels button, editor) — the ONLY deltas are the two
//      documented ENTRY-CONTEXTUAL ones: the Back link (visible where a back
//      context exists) and the rail mode (icons-rail in-app vs edge-hover entry).
//   2. THE SHARED EDITOR carries the ORIGINAL full formatting toolbar (bold /
//      underline / strikethrough | bullet / ordered | align ×4 | code — the
//      project page editor's complete markdown-lite vocabulary, written as raw
//      markdown) + the FULLSCREEN WRITING toggle (Esc/✕ exit focus mode FIRST).
//   3. THE EMBEDDED BOARD (project.html) wears the SAME mother container
//      (.db-frame + the hairline header row; the card outline + reading measure
//      stay — embedded context; NO 100dvh floor) and gains the LABEL MANAGER
//      (the same shared devboard.js dialog /kanban's toolbar opens).
//   4. THE EMBEDDED CARDS read identically to /kanban cards: the ◆ sprint badge
//      renders on BOTH surfaces; the pin badge SURVIVES client-side repaints
//      (the +N expand / pdRepaintColumns paths — it used to vanish).
//   5. ARCHIVE-DONE on the embedded board refreshes IN PLACE (the board's
//      POST → toast → reload contract), never location.reload().
//   6. sprint.html's Board link targets the CANONICAL /kanban entry.
//
// Contract owners: board.html/board-page.js/devboard.js (the shared modal),
// detail-helpers.ts (the embedded fragment), project-page.js (labels wiring +
// pdTruthWrap), devboard.css (.pd-board.db-frame + .db-fullscreen).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s209@test.local'
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
    db.exec(`DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}'))`)
    db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}'))`)
    db.exec(`DELETE FROM sprints WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}'))`)
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s209', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

async function seedProject(page: Page, title: string): Promise<string> {
  return await page.evaluate(async (title) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, title)
}

async function seedTask(page: Page, pid: string, title: string, status = 'in_progress', priority = 'medium'): Promise<string> {
  return await page.evaluate(async ([pid, title, status, priority]) => {
    const res = await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status, priority }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, [pid, title, status, priority])
}

/** Seed a screenshot row directly (no storage creds in e2e) — the s208 recipe. */
async function seedShot(pid: string, taskId: string | null): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const id = `s209shot${randomBytes(6).toString('hex')}`
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 100, ?)')
    .run(id, pid, `u/${id}.png`, 'image/png', '', taskId, new Date().toISOString())
  db.close()
  return id
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

const FULL_TOOLBAR_KINDS = ['bold', 'underline', 'strikethrough', 'list', 'ordered-list', 'align-left', 'align-center', 'align-right', 'align-justify', 'code']

test('parity: /board.html?project= ≡ /kanban — same contracts; ONLY the Back link + rail mode differ (the documented entry-contextual exceptions)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 parity board')

  // ---- /kanban (the canonical entry) ----
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const kanban = await page.evaluate(() => ({
    frame: !!document.querySelector('.db-frame'),
    switcher: !!document.getElementById('db-project-switch'),
    labelsBtn: !!document.getElementById('db-labels-btn'),
    sprintLink: !!document.getElementById('db-sprint-link'),
    filterRail: 'db-filter', // the bar renders when tasks exist; the surface itself is board-page.js's
    backHidden: document.querySelector('[data-back-link]')?.hidden === true,
    edgeRail: document.body.classList.contains('rail-edge'),
  }))
  expect(kanban.frame).toBe(true)
  expect(kanban.switcher).toBe(true)
  expect(kanban.labelsBtn).toBe(true)
  expect(kanban.sprintLink).toBe(true)
  // the two documented EXCEPTIONS on the entry: no Back link (nothing to go back
  // to), the edge-hover rail (the less-distracting entry — the owner's words)
  expect(kanban.backHidden).toBe(true)
  expect(kanban.edgeRail).toBe(true)

  // ---- /board.html?project= (the in-app context) ----
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const board = await page.evaluate(() => ({
    frame: !!document.querySelector('.db-frame'),
    switcher: !!document.getElementById('db-project-switch'),
    labelsBtn: !!document.getElementById('db-labels-btn'),
    sprintLink: !!document.getElementById('db-sprint-link'),
    backVisible: !!(document.querySelector('[data-back-link]') as HTMLElement | null)?.offsetParent,
    backHref: document.querySelector('[data-back-link]')?.getAttribute('href'),
    iconsRail: document.body.classList.contains('rail-icons-only'),
    edgeRail: document.body.classList.contains('rail-edge'),
  }))
  // the SAME feature contracts (one board.html serves both entries)
  expect(board.frame).toBe(true)
  expect(board.switcher).toBe(true)
  expect(board.labelsBtn).toBe(true)
  expect(board.sprintLink).toBe(true)
  // the two documented EXCEPTIONS here: the Back link (a back context exists) +
  // the classic icons-rail (in-app navigation context)
  expect(board.backVisible).toBe(true)
  expect(board.backHref).toBe(`/project.html?id=${pid}`)
  expect(board.iconsRail).toBe(true)
  expect(board.edgeRail).toBe(false)
  expect(errors).toEqual([])
})

test('parity: the shared task editor carries the FULL formatting toolbar (the original editor\'s 10-op markdown-lite vocabulary)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 toolbar board')
  await seedTask(page, pid, 'toolbar host task')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // open the edit modal — the card click path
  await page.click('.pd-task')
  const modal = page.locator('.db-modal')
  await expect(modal).toBeVisible()
  // the FULL toolbar — the exact button set + order of the project page's editor
  const kinds = await page.evaluate(() => Array.from(document.querySelectorAll('.db-modal .pd-tb [data-tb]')).map((b) => (b as HTMLElement).dataset.tb))
  expect(kinds).toEqual(FULL_TOOLBAR_KINDS)
  // the separators + the toolbar's aria grammar
  expect(await page.locator('.db-modal .pd-tb .pd-tb-sep').count()).toBe(3)

  // the OPS write raw markdown — one inline wrap + one line-prefix + one align
  await page.evaluate(() => {
    const ta = document.querySelector('.db-modal [name=title]') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(0, 4) // "tool" in "toolbar host task"
  })
  await page.click('.db-modal [data-tb="underline"]')
  await page.evaluate(() => {
    const ta = document.querySelector('.db-modal [name=title]') as HTMLTextAreaElement
    ta.setSelectionRange(ta.value.length, ta.value.length)
  })
  await page.click('.db-modal [data-tb="ordered-list"]')
  await page.click('.db-modal [data-tb="align-center"]')
  const marked = await page.evaluate(() => (document.querySelector('.db-modal [name=title]') as HTMLTextAreaElement).value)
  expect(marked).toContain('__tool__') // underline wrap
  expect(marked).toContain('1. __tool__') // the ordered-list line prefix rode the whole line
  expect(marked).toContain('{:center}1. ') // the align marker landed at line start

  // the fullscreen writing toggle exists in the head row (the S46.7 affordance)
  await expect(page.locator('.db-modal [data-db-fullscreen]')).toBeVisible()
  await page.click('.db-modal [data-db-close]') // cancel — discard the edit
  expect(errors).toEqual([])
})

test('parity: the FULLSCREEN WRITING mode — Esc exits focus mode FIRST, never the modal', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 fullscreen board')
  await seedTask(page, pid, 'fullscreen host task')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await page.click('.pd-task')
  const modal = page.locator('.db-modal')
  await expect(modal).toBeVisible()

  // enter focus mode — the card grows, the metadata rows hide, the writing row stays
  await page.click('.db-modal [data-db-fullscreen]')
  const focused = await page.evaluate(() => {
    const card = document.querySelector('.db-modal .db-modal-card')!
    const statusField = document.querySelector('.db-modal .db-seg[data-seg="status"]')!.closest('.db-field') as HTMLElement
    return {
      cls: card.classList.contains('db-fullscreen'),
      height: Math.round(card.getBoundingClientRect().height),
      vh: innerHeight,
      // the FIELD hides (its inner seg still computes its own display — measure
      // the row's visibility through offsetParent, the hidden-subtree truth)
      statusFieldHidden: statusField.offsetParent === null,
      titleVisible: !!(document.querySelector('.db-modal [name=title]') as HTMLElement).offsetParent,
    }
  })
  expect(focused.cls).toBe(true)
  expect(focused.height).toBeGreaterThan(focused.vh - 80) // ~the viewport
  expect(focused.statusFieldHidden).toBe(true) // metadata hidden in focus mode
  expect(focused.titleVisible).toBe(true)

  // THE CONTRACT: the first Esc EXITS FULLSCREEN (the modal stays); the second closes it
  await page.keyboard.press('Escape')
  await expect
    .poll(async () => await page.evaluate(() => document.querySelector('.db-modal .db-modal-card')!.classList.contains('db-fullscreen')), { timeout: 3_000 })
    .toBe(false)
  await expect(modal).toBeVisible() // still open — the writing was never discarded
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  expect(errors).toEqual([])
})

test('parity: the EMBEDDED board (project.html) wears the mother container — .db-frame, hairline header row, NO viewport floor + the LABEL MANAGER', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 embedded frame')
  await seedTask(page, pid, 'embedded host task')
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })

  const frame = await page.evaluate(() => {
    const el = document.getElementById('pd-board')!
    const head = el.querySelector('.pd-board-head')!
    const cs = getComputedStyle(el)
    const hs = getComputedStyle(head)
    return {
      hasFrame: el.classList.contains('db-frame'),
      bg: cs.backgroundColor,
      border: cs.borderTopWidth !== '0px',
      // NO viewport floor — the board sits under the header. (A default
      // min-block-size COMPUTES to 0px; the page-owning floor is ~100dvh — so
      // assert the numeric floor is tiny, nothing viewport-sized.)
      floorPx: parseFloat(cs.minBlockSize) || 0,
      headToolbar: head.classList.contains('db-toolbar'),
      headBg: hs.backgroundColor,
      headHairline: hs.borderBottomWidth,
      labelsBtn: !!document.querySelector('[data-pd-labels]'),
    }
  })
  // the SAME mother-container recipe: one var(--card) surface, the toolbar as the
  // frame's hairline header row (transparent chrome)
  expect(frame.hasFrame).toBe(true)
  expect(frame.bg).toBe('rgb(255, 255, 255)')
  expect(frame.border).toBe(true) // the embedded context keeps the card outline
  expect(frame.floorPx).toBeLessThan(100) // NO 100dvh floor — the board sits under the header
  expect(frame.headToolbar).toBe(true)
  expect(frame.headBg).toBe('rgba(0, 0, 0, 0)')
  expect(frame.headHairline).toBe('1px')
  expect(frame.labelsBtn).toBe(true)

  // the LABEL MANAGER opens — the same shared devboard.js dialog as /kanban's
  await page.click('[data-pd-labels]')
  await expect(page.locator('.db-labels-card')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.db-labels-card h3')).toContainText('Labels')
  await page.keyboard.press('Escape')
  await expect(page.locator('.db-labels-card')).toBeHidden({ timeout: 5_000 })
  expect(errors).toEqual([])
})

test('parity: the ◆ SPRINT BADGE renders on BOTH surfaces\' cards; the PIN BADGE survives the embedded board\'s +N expand repaint', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 badges board')
  // a sprint + a sprinted task
  const sprintId = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'S209 Sprint' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, pid)
  const sprintedTask = await seedTask(page, pid, 's209 sprinted task')
  await page.evaluate(async ([tid, sid]) => {
    await fetch(`/api/devtasks/${tid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sprint_id: sid }) })
  }, [sprintedTask, sprintId])
  // 7 tasks in ONE column (MAX_VISIBLE=5 → the +N expand path) + a pinned shot on the 7th
  for (let i = 1; i <= 7; i++) await seedTask(page, pid, `s209 col task ${i}`, 'in_progress')
  const colTasks = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/devboard`)
    const body = (await res.json()) as { tasks: { id: string; title: string; status: string }[] }
    return body.tasks.filter((t) => t.title.startsWith('s209 col task')).sort((a, b) => a.title.localeCompare(b.title)).map((t) => t.id)
  }, pid)
  expect(colTasks.length).toBe(7)
  await seedShot(pid, colTasks[6]) // pinned to the 7th (beyond the visible window)

  // ---- /kanban: the sprint badge + the pin badge ----
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const kanbanCard = page.locator(`[data-task-card="${sprintedTask}"]`)
  await expect(kanbanCard.locator('.db-sprint-badge')).toContainText('S209 Sprint')

  // ---- the embedded board: BOTH badges + the expand repaint keeps the pin badge ----
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })
  const embeddedSprint = await page.evaluate((tid) => !!document.querySelector(`.pd-task-wrap[data-pd-task="${tid}"] .db-sprint-badge`)?.textContent?.includes('S209 Sprint'), sprintedTask)
  expect(embeddedSprint).toBe(true)

  // the 7th card is behind "+2 more" — expand: the pdTruthWrap path must render
  // the pin badge (it used to VANISH on repaint). Poll — the expand is an async
  // fetch + insertBefore chain.
  await expect(page.locator('[data-pd-more="in_progress"]')).toBeVisible()
  await page.click('[data-pd-more="in_progress"]')
  await expect
    .poll(async () => await page.evaluate((tid) => {
      const badge = document.querySelector(`.pd-task-wrap[data-pd-task="${tid}"] .pd-task-shots`)
      return { present: !!badge, count: badge?.textContent?.trim() || '' }
    }, colTasks[6]), { timeout: 10_000 })
    .toEqual({ present: true, count: expect.stringContaining('1') })
  expect(errors).toEqual([])
})

test('parity: ARCHIVE-DONE on the embedded board refreshes IN PLACE — no location.reload (the board\'s POST → toast → reload contract)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 archive board')
  await seedTask(page, pid, 's209 done task 1', 'done')
  await seedTask(page, pid, 's209 done task 2', 'done')
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })

  // a page-lifetime marker: a location.reload() destroys it; an in-place htmx
  // refresh (bodyRefresh) keeps it
  await page.evaluate(() => { (window as unknown as { __s209alive: boolean }).__s209alive = true })
  // S210: the archive confirm is now a Hibana design-system modal (was a native
  // window.confirm() — page.on('dialog') no longer fires). Click the modal's OK.
  await page.click('[data-pd-archive-done]')
  await page.locator('.hib-confirm-overlay [data-hib-confirm="ok"]').click()
  await expect
    .poll(async () => await page.evaluate(() => document.querySelectorAll('.pd-col[data-status="done"] .pd-task-wrap').length), { timeout: 10_000 })
    .toBe(0)
  const alive = await page.evaluate(() => (window as unknown as { __s209alive?: boolean }).__s209alive === true)
  expect(alive).toBe(true) // the SAME page context — no reload threw away scroll/tabs
  expect(errors).toEqual([])
})

test('parity: sprint.html\'s Board link targets the CANONICAL /kanban entry', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's209 sprint link board')
  await page.goto(`/sprint.html?project=${pid}`)
  await expect(page.locator('#sp-wrap')).toBeVisible({ timeout: 10_000 })
  const href = await page.evaluate(() => document.getElementById('sp-board-link')?.getAttribute('href'))
  expect(href).toBe(`/kanban?project=${pid}`)
  expect(errors).toEqual([])
})
