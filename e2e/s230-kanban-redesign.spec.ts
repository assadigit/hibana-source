// e2e/s230-kanban-redesign.spec.ts — S230 (the approved kanban UI redesign
// handoff pack): the five lanes become the board's center of gravity.
//   (1) the toolbar's completed/total summary is retired — the #db-counts span
//       is emptied + hidden (the base round's shape); no replacement widget
//   (2) five lanes keep the EXACT workflow names + order (the owner's Option 1)
//   (3) the board region below the toolbar is the quiet neutral canvas; the
//       lanes are full-height card surfaces with tinted headers on it
//   (4) empty lanes render the handoff's monochrome illustration + heading +
//       copy + lane-accent Add task; the empty state disappears when the lane
//       gets tasks
//   (5) ONE ⋯ overflow menu per lane header preserves the column actions
//   (6) the quiet monochrome helper hint rides below the lanes
//   (7) constrained widths scroll the LANES horizontally — never the toolbar,
//       never crushed columns
//   (8) dark theme + FA/RTL survive the redesign; the embedded board's
//       "Project Progress" heading is sr-only now (the base round's call)
// Contract owners: board.html, board-page.js (S230), devboard.css (S230),
// i18n-en.js/i18n-fa.js (db.empty.*, db.helperHint, db.colMenu).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s230@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s230-fa@test.local'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const ITERATIONS = 100_000
  const mkHash = async (pass: string) => {
    const salt = randomBytes(16)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
    return `pbkdf2$${ITERATIONS}$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`
  }
  const now = new Date().toISOString()
  for (const [email, user, lang] of [[TEST_EMAIL, 'e2e-s230', 'en'], [FA_EMAIL, 'e2e-s230-fa', 'fa']] as const) {
    const hash = await mkHash(TEST_PASS)
    const id = randomBytes(16).toString('hex')
    try {
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

async function login(page: Page, email = TEST_EMAIL, theme?: 'claude-dark') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (t) localStorage.setItem('hibana-theme', t)
    } catch { /* storage blocked */ }
  }, theme)
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForTimeout(400)
}

/** Create a project (+ optional tasks) through the API, as the logged-in user. */
async function seedProject(page: Page, title: string, tasks: { title: string; status: string }[] = []): Promise<string> {
  return await page.evaluate(async ([title, tasks]) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    for (const t of tasks) await fetch(`/api/projects/${id}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) })
    return id
  }, [title, tasks] as [string, { title: string; status: string }[]])
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

// The five workflow stages — EXACT visible names, EXACT order (the owner's locked
// Option 1; the stored keys ride [data-status]).
const LANES: { status: string; title: string; art: string; emptyTitle: string; emptyText: string }[] = [
  { status: 'idea', title: 'New Ideas', art: 'new-ideas-lamp.png', emptyTitle: 'No ideas yet', emptyText: 'Capture new ideas and potential improvements.' },
  { status: 'bug', title: 'Problems', art: 'problems-warning.png', emptyTitle: 'No problems yet', emptyText: 'Track issues and blockers here.' },
  { status: 'planned', title: 'Plans', art: 'plans-checklist.png', emptyTitle: 'No plans yet', emptyText: 'Plan upcoming work and define next steps.' },
  { status: 'in_progress', title: 'In Progress', art: 'in-progress-play.png', emptyTitle: 'Nothing in progress', emptyText: 'Move tasks here when you start working.' },
  { status: 'done', title: 'Implemented', art: 'implemented-check.png', emptyTitle: 'No completed tasks', emptyText: 'Completed tasks will appear here.' },
]

test('toolbar: the completed/total summary is retired; the switcher + actions stay; five lanes keep their exact names and order', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 toolbar board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // (1) the retired progress summary — the span stays (the base round's shape)
  // but renders NOTHING: hidden + empty
  const counts = page.locator('#db-counts')
  await expect(counts).toBeHidden()
  await expect(counts).toHaveText('')
  await expect(page.locator('#db-toolbar')).not.toContainText('done')
  // no replacement progress/summary widget joined the toolbar
  const toolbarSummaries = await page.evaluate(() => document.querySelectorAll('#db-toolbar progress, #db-toolbar [role=progressbar], #db-toolbar [aria-valuenow]').length)
  expect(toolbarSummaries).toBe(0)

  // (2) the workspace selector + the existing action group survive
  await expect(page.locator('#db-project-switch')).toBeVisible()
  await expect(page.locator('#db-sprint-link')).toBeVisible()
  await expect(page.locator('#db-labels-btn')).toBeVisible()

  // (3) the five lanes: exact workflow names, exact order
  const titles = await page.evaluate(() => [...document.querySelectorAll('.db-cols .pd-col-title')].map((el) => el.textContent.trim()))
  expect(titles).toEqual(LANES.map((l) => l.title))
  const statuses = await page.evaluate(() => [...document.querySelectorAll('.db-cols .pd-col')].map((el) => el.getAttribute('data-status')))
  expect(statuses).toEqual(LANES.map((l) => l.status))
  // each header: title + count + exactly ONE ellipsis menu (dot via ::before)
  for (const lane of LANES) {
    const col = page.locator(`.db-cols .pd-col[data-status="${lane.status}"]`)
    await expect(col.locator('.detail-tab-count')).toHaveText('0')
    await expect(col.locator('[data-db-col-menu]')).toHaveCount(1)
    await expect(col.locator('[data-db-col-menu]')).toHaveAttribute('aria-haspopup', 'true')
    // the old always-visible icon pair is folded in — no stray action buttons at rest
    await expect(col.locator('.pd-col-head > button:not([data-db-col-menu])')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('empty board: every lane shows its illustration + heading + copy + lane-accent Add task; the helper hint rides below; the lanes own the canvas height', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 empty board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  for (const lane of LANES) {
    const col = page.locator(`.db-cols .pd-col[data-status="${lane.status}"]`)
    // the illustration: the handoff asset, decorative, square, ~112px
    const img = col.locator('.pd-empty-icon')
    await expect(img).toHaveAttribute('src', `/icons/empty-state/${lane.art}`)
    await expect(img).toHaveAttribute('alt', '')
    const imgBox = await img.boundingBox()
    expect(Math.round(imgBox.width)).toBeGreaterThanOrEqual(110)
    expect(Math.round(imgBox.height)).toBeGreaterThanOrEqual(110)
    // the approved copy, verbatim
    await expect(col.locator('.pd-empty-title')).toHaveText(lane.emptyTitle)
    await expect(col.locator('.pd-empty-text')).toHaveText(lane.emptyText)
    // the Add task button rides the existing create flow (data-add → openEditor)
    await expect(col.locator('.pd-empty-add[data-add]')).toHaveCount(1)
    // the bottom add strip is hidden while the lane is empty
    await expect(col.locator('.pd-task-add')).toHaveCount(0)
  }

  // the helper hint: exact copy, monochrome, under the lanes, no pill enclosure
  const hint = page.locator('.db-hint')
  await expect(hint).toHaveCount(1)
  await expect(hint).toContainText('Start by adding a task to move your work forward.')
  const hintStyle = await page.evaluate(() => {
    const el = document.querySelector('.db-hint')
    const cs = getComputedStyle(el)
    return { pillBorder: cs.borderTopWidth, pillBg: cs.backgroundColor, color: cs.color, opacity: parseFloat(cs.opacity) }
  })
  expect(hintStyle.pillBorder).toBe('0px') // no pill/card enclosure
  expect(hintStyle.pillBg).toBe('rgba(0, 0, 0, 0)')
  expect(hintStyle.color).toBe('rgb(92, 92, 92)') // --muted — the quiet-but-legible ink
  expect(hintStyle.opacity).toBeGreaterThan(0.7) // low emphasis, never unreadable

  // the lanes own the canvas: every lane's bottom reaches the hint strip (the
  // only element below them — the hint's own margin is the whole gap)
  const geometry = await page.evaluate(() => {
    const hint = document.querySelector('.db-hint') as HTMLElement
    const canvas = document.querySelector('.db-board') as HTMLElement
    return {
      hintTop: Math.round(hint.getBoundingClientRect().top),
      canvasBottom: Math.round(canvas.getBoundingClientRect().bottom),
      laneBottoms: [...document.querySelectorAll('.db-cols .pd-col')].map((el) => Math.round(el.getBoundingClientRect().bottom)),
      laneWidths: [...document.querySelectorAll('.db-cols .pd-col')].map((el) => Math.round(el.getBoundingClientRect().width)),
    }
  })
  const spread = Math.max(...geometry.laneBottoms) - Math.min(...geometry.laneBottoms)
  expect(spread).toBeLessThan(2) // equal-height lanes (the full-height surface)
  expect(Math.min(...geometry.laneBottoms)).toBeGreaterThanOrEqual(geometry.hintTop - 30) // they reach the hint
  expect(Math.max(...geometry.laneBottoms)).toBeLessThan(geometry.canvasBottom) // inside the canvas
  const w = new Set(geometry.laneWidths)
  expect(w.size).toBe(1) // five EQUAL lanes
  expect(errors).toEqual([])
})

test('empty-state Add task opens the EXISTING create flow for the correct lane', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 add flow board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  await page.click('.pd-col[data-status="planned"] .pd-empty-add')
  await page.waitForSelector('.db-modal-card', { timeout: 5_000 })
  // the editor's status segment defaults to the lane's status (Plans)
  const onStatus = await page.evaluate(() =>
    [...document.querySelectorAll('.db-modal .db-seg[data-seg="status"] button')].map((b) => ({ s: b.getAttribute('data-val'), on: b.classList.contains('is-on') }))
  )
  const planned = onStatus.find((x) => x.s === 'planned')
  expect(planned && planned.on).toBe(true)
  await page.click('.db-modal [data-db-close]') // cancel — no task created
  await page.waitForSelector('.db-modal-card', { state: 'detached', timeout: 5_000 }).catch(() => {})
  expect(errors).toEqual([])
})

test('a lane that receives tasks loses its empty state; the bottom Add strip returns (the helper hint stays — the persistent nudge)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 populate board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // create one task in the Problems lane through the API, then re-render
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's230 blocker', status: 'bug' }) })
  }, pid)
  await page.reload()
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 10_000 })

  // the Problems lane: no empty state, count 1, bottom strip back
  const bugCol = page.locator('.pd-col[data-status="bug"]')
  await expect(bugCol.locator('[data-pd-empty]')).toHaveCount(0)
  await expect(bugCol.locator('.detail-tab-count')).toHaveText('1')
  await expect(bugCol.locator('.pd-task-add')).toHaveCount(1)
  // every OTHER lane keeps its empty state
  for (const lane of LANES.filter((l) => l.status !== 'bug')) {
    await expect(page.locator(`.pd-col[data-status="${lane.status}"] [data-pd-empty]`)).toHaveCount(1)
  }
  // the persistent helper hint survives (the base round's shape: always present)
  await expect(page.locator('.db-hint')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('the lane ⋯ overflow menu preserves the column actions (copy + export + archive/clear on a populated Done lane)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 menus board', [
    { title: 'shipped one', status: 'done' },
    { title: 'shipping soon', status: 'in_progress' },
  ])
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2, { timeout: 10_000 })

  // the Done lane (populated): the menu carries ALL FOUR actions
  const doneBtn = page.locator('.pd-col[data-status="done"] [data-db-col-menu]')
  await doneBtn.click()
  const doneMenu = page.locator('.pd-col[data-status="done"] .db-col-menu')
  await expect(doneMenu).toBeVisible()
  await expect(doneMenu.locator('[data-db-archive-done]')).toHaveCount(1)
  await expect(doneMenu.locator('[data-db-clear-done]')).toHaveCount(1)
  await expect(doneMenu.locator('[data-db-copy="done"]')).toHaveCount(1)
  await expect(doneMenu.locator('[data-db-export="done"]')).toHaveCount(1)
  // the toggle carries the open state
  await expect(doneBtn).toHaveAttribute('aria-expanded', 'true')
  // Escape closes (the shared menu contract)
  await page.keyboard.press('Escape')
  await expect(doneMenu).toBeHidden()
  await expect(doneBtn).toHaveAttribute('aria-expanded', 'false')

  // Quick copy still works THROUGH the menu (the clipboard stub reads the write)
  await page.evaluate(() => {
    window.__mdCopied = null
    navigator.clipboard.writeText = (t) => { (window as unknown as { __mdCopied: string }).__mdCopied = t; return Promise.resolve() }
  })
  await page.click('.pd-col[data-status="in_progress"] [data-db-col-menu]')
  await page.click('[data-db-copy="in_progress"]')
  const copied = await page.evaluate(() => (window as unknown as { __mdCopied: string | null }).__mdCopied)
  expect(copied).toContain('shipping soon')
  // the menu folded after the action
  await expect(page.locator('.pd-col[data-status="in_progress"] .db-col-menu')).toBeHidden()

  // an EMPTY lane's menu carries only the two universal actions
  await page.click('.pd-col[data-status="idea"] [data-db-col-menu]')
  const ideaMenu = page.locator('.pd-col[data-status="idea"] .db-col-menu')
  await expect(ideaMenu).toBeVisible()
  await expect(ideaMenu.locator('[data-db-archive-done]')).toHaveCount(0)
  await expect(ideaMenu.locator('[data-db-copy="idea"]')).toHaveCount(1)
  await expect(ideaMenu.locator('[data-db-export="idea"]')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('drag-and-drop across lanes still changes status (the S210 whole-board drop contract, on the new lane surfaces)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 dnd board', [{ title: 's230 move me', status: 'idea' }])
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1, { timeout: 10_000 })

  // synthetic HTML5 DnD (the handler-path truth): card → the PLANS lane
  const res = await page.evaluate(() => {
    const src = document.querySelector('.pd-task-wrap')
    const dst = document.querySelector('.pd-col[data-status="planned"]')
    if (!src || !dst) return 'missing'
    const dt = new DataTransfer()
    const fire = (el: Element, type: string) => {
      const r = el.getBoundingClientRect()
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + Math.min(r.height / 2, 120) })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    const s1 = fire(src, 'dragstart')
    const s2 = fire(dst, 'dragover')
    fire(dst, 'drop')
    fire(src, 'dragend')
    return JSON.stringify({ dragstartPrevented: s1, dragoverPrevented: s2 })
  })
  // dragstart needs no preventDefault (the drag begins regardless); dragOVER must
  // preventDefault or the browser refuses the drop — that pair is the contract.
  expect(JSON.parse(res)).toEqual({ dragstartPrevented: false, dragoverPrevented: true })
  // the reload lands the card in Plans (status PATCHed + board re-rendered)
  await expect(page.locator('.pd-col[data-status="planned"] .pd-task-wrap')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.locator('.pd-col[data-status="idea"] [data-pd-empty]')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('constrained width: five usable lanes, the BOARD scrolls horizontally — never the toolbar, never crushed', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 narrow board', [
    { title: 'narrow lane card with a reasonably long title', status: 'in_progress' },
  ])
  await page.setViewportSize({ width: 800, height: 720 })
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  const narrow = await page.evaluate(() => {
    const board = document.querySelector('.db-board') as HTMLElement
    const toolbar = document.getElementById('db-toolbar')!
    const lanes = [...document.querySelectorAll('.db-cols .pd-col')].map((el) => Math.round(el.getBoundingClientRect().width))
    return {
      n: lanes.length,
      lanes,
      boardScrolls: board.scrollWidth > board.clientWidth,
      toolbarLeft: Math.round(toolbar.getBoundingClientRect().left),
      switcherVisible: !!document.getElementById('db-project-switch') && document.getElementById('db-project-switch')!.getBoundingClientRect().width > 0,
    }
  })
  expect(narrow.n).toBe(5) // all five lanes exist — nothing hidden
  expect(Math.min(...narrow.lanes)).toBeGreaterThanOrEqual(170) // the 11rem usability floor
  expect(narrow.boardScrolls).toBe(true) // the BOARD region scrolls
  // the toolbar stays anchored (its scrollport never moves it)
  expect(narrow.toolbarLeft).toBeGreaterThanOrEqual(0)
  expect(narrow.toolbarLeft).toBeLessThan(40)
  expect(narrow.switcherVisible).toBe(true)
  expect(errors).toEqual([])
})

test('dark theme: the canvas + lane surfaces flip tokens; the illustrations stay visible (tuned opacity)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, TEST_EMAIL, 'claude-dark')
  const pid = await seedProject(page, 's230 dark board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  const dark = await page.evaluate(() => {
    const q = (sel: string) => getComputedStyle(document.querySelector(sel))
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      canvas: q('.db-board').backgroundColor,
      lane: q('.db-cols .pd-col').backgroundColor,
      imgOpacity: q('.pd-empty-icon').opacity,
      headerTint: q('.db-cols .pd-col-head').backgroundColor,
    }
  })
  expect(dark.theme).toBe('claude-dark')
  expect(dark.canvas).toBe('rgb(25, 24, 23)') // --statcard-bg dark #191817 — the neutral canvas
  expect(dark.lane).toBe('rgb(31, 30, 28)') // --card dark #1f1e1c — the lane surface on the canvas
  expect(dark.canvas).not.toBe(dark.lane) // the lanes read as surfaces
  expect(parseFloat(dark.imgOpacity)).toBeGreaterThan(0.6) // visible but subdued (0.72)
  expect(dark.headerTint).not.toBe('rgba(0, 0, 0, 0)') // the tinted header strip survives dark
  expect(errors).toEqual([])
})

test('FA/RTL: the lane titles, empty states + helper hint localize; the board mirrors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)
  const pid = await seedProject(page, 's230 fa board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  expect(await page.evaluate(() => document.documentElement.getAttribute('dir') || 'ltr')).toBe('rtl')
  const titles = await page.evaluate(() => [...document.querySelectorAll('.db-cols .pd-col-title')].map((el) => el.textContent.trim()))
  expect(titles).toEqual(['ایده‌های جدید', 'مشکلات', 'برنامه‌ها', 'در حال انجام', 'انجام‌شده'])
  // the FA empty-state copy + helper hint (localized, not the EN fallback)
  await expect(page.locator('.pd-col[data-status="idea"] .pd-empty-title')).toHaveText('هنوز ایده‌ای نیست')
  await expect(page.locator('.pd-col[data-status="done"] .pd-empty-text')).toHaveText('کارهای انجام‌شده اینجا نمایش داده می‌شوند.')
  await expect(page.locator('.db-hint')).toContainText('برای جلو بردن کارت، با افزودن یک کار شروع کن.')
  // the ⋯ menu localizes its accessible name
  await expect(page.locator('.pd-col[data-status="idea"] [data-db-col-menu]')).toHaveAttribute('aria-label', 'عملیات ستون')
  expect(errors).toEqual([])
})

test('the embedded board (project.html): the redesign keeps the documented exception — the "Project Progress" heading is sr-only, the actions stay', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's230 embedded board', [{ title: 'embedded card', status: 'in_progress' }])
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-board')).toBeVisible({ timeout: 10_000 })

  // the base round's call: the visible duplicate title is gone (sr-only), the
  // region stays accessible, and the action group survives intact
  const head = await page.evaluate(() => {
    const h3 = document.querySelector('.pd-board-head h3')!
    const cs = getComputedStyle(h3)
    return {
      srOnly: cs.position === 'absolute' && (cs.width === '1px' || cs.inlineSize === '1px'),
      text: h3.textContent.trim(),
      labelsBtn: !!document.querySelector('[data-pd-labels]'),
      sprintBtn: !!document.querySelector('[data-pd-new-sprint]'),
      catsBtn: !!document.querySelector('[data-pd-cats]'),
      boardLink: !!document.querySelector('a[href^="/board.html?project="]'),
    }
  })
  expect(head.srOnly).toBe(true)
  expect(head.text).toBe('Project Progress')
  expect(head.labelsBtn).toBe(true)
  expect(head.sprintBtn).toBe(true)
  expect(head.catsBtn).toBe(true)
  expect(head.boardLink).toBe(true)
  expect(errors).toEqual([])
})
