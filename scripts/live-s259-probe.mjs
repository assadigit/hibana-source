#!/usr/bin/env node
// scripts/live-s259-probe.mjs — S259 (Phase 8 — close-out & full verification)
// live probe: the spec's §11 step 3 — the FULL-SYSTEM regression on the deployed
// worker, end to end through the REAL UI, after seven phases of remediation.
//
//   (A) deploy carriers — the health probe (ok, schema 66) + sw.js hibana-v464;
//   (B) THE USER JOURNEY (the REAL login page, the real session cookie):
//       login → /projects (the overview home + the cards view) → /project.html
//       (the detail) → /kanban (create → tag → move → done → archive) →
//       /sprint.html (strategy create → sprint with strategy → task → start →
//       task done → finish → complete strategy → delete a draft sprint);
//   (C) the Phase-3/4/5 behaviors, re-proven on the same chain:
//       FE-1 the repaint contracts (the editor-create's ONE lean reload — staged
//       shots/deps/tags are not in the 201 ack, the documented S254 design; the
//       EDIT/MOVE/DONE rounds repaint WITHOUT any board GET; the focus-sheet
//       quick-add merges with ZERO), BE-3 the lean payload (?lean=1 on both
//       surfaces + the byte delta + the default contract intact), BE-25 the
//       version-stamp ETag (a matching If-None-Match → 304 empty; a mutation
//       moves the stamp), FE-5 the 4-CSS-request pages;
//   (D) the {en,fa} × {light,dark} matrix on /kanban + /sprint (theme token +
//       dir + the board renders), and the 390px leg — console 0 / page errors 0
//       everywhere.
//
// Usage: node scripts/live-s259-probe.mjs [dev|prod|local]   (default: dev; local =
//        http://127.0.0.1:3017 against `npm run start:node` with a scratch DB)
// Env:   S259_LOGIN + S259_PASS (the test account) — never hardcoded.

import { chromium } from 'playwright'

const target = process.argv[2] || 'dev'
const LOCAL_PORT = process.env.S259_LOCAL_PORT || '3017'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? `http://127.0.0.1:${LOCAL_PORT}` : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S259_LOGIN
const PASS = process.env.S259_PASS
if (!LOGIN || !PASS) {
  console.error('need S259_LOGIN + S259_PASS in env (the test account)')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
// poll until truthy (the live worker's board GET can take ~2s; fixed sleeps lie)
const waitFor = async (fn, timeoutMs = 20_000, everyMs = 400) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() - t0 > timeoutMs) return null
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

const main = async () => {
  console.log(`S259 close-out full-system regression → ${URL_BASE}`)

  // ---------- (A) the carriers ----------
  const health = await fetch(`${URL_BASE}/api/health`).then((r) => r.json()).catch(() => null)
  check('(A) /api/health answers ok', health && health.ok === true, JSON.stringify(health)?.slice(0, 60))
  check('(A) schema_version is 66', Number(health?.schema_version) === 66, `schema_version=${health?.schema_version}`)
  const sw = await fetch(`${URL_BASE}/sw.js`).then((r) => r.text()).catch(() => '')
  check('(A) sw.js carries hibana-v464 (the Phase-7 final carrier)', sw.includes('"hibana-v464"'))

  // ---------- the browser context ----------
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const api = async (path, method, body) => {
    const res = await context.request.fetch(`${URL_BASE}${path}`, {
      method: method || 'GET',
      headers: { Origin: URL_BASE, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      data: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    return res
  }

  // ---------- (B1) LOGIN — the REAL login page ----------
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 100)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|404|409|503)/.test(m.text())) pageErrors.push(m.text().slice(0, 100)) })
  // count every fetch every page makes (method + url) — the FE-1/FE-4 contracts
  await context.addInitScript(() => {
    window.__apiCalls = []
    const orig = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      window.__apiCalls.push({ url, method: (init && init.method) || 'GET' })
      return orig.apply(this, arguments)
    }
  })
  const cssRequests = []
  page.on('request', (r) => { if (r.resourceType() === 'stylesheet') cssRequests.push(r.url()) })
  const cssCount = () => { const n = cssRequests.length; cssRequests.length = 0; return n }

  await page.goto(`${URL_BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.fill('[name="login"]', LOGIN)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 30_000 })
  check('(B1) login through the REAL login page → /app', true)

  const meRes = await api('/api/auth/me')
  const origLang = meRes && meRes.ok() ? ((await meRes.json()).user?.language_pref ?? 'en') : 'en'
  if (origLang !== 'en') await api('/api/settings', 'PATCH', { language_pref: 'en' })

  // ---------- the disposable probe project ----------
  const proj = await api('/api/projects', 'POST', { title: `S259 regression ${new Date().toISOString().slice(0, 10)} (safe to delete)`, status: 'developing' })
  const pid = proj && proj.ok() ? (await proj.json()).id : null
  if (!pid) { check('probe project created', false); await browser.close(); process.exit(1) }
  check('probe project created', true)

  try {
    // ---------- (B2) the PROJECTS home: overview + the cards view ----------
    cssCount() // drop the login/app landing's requests
    await page.goto(`${URL_BASE}/projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const ovOk = await page.waitForSelector('.ov-tasks', { timeout: 20_000 }).then(() => true).catch(() => false)
    const glanceOk = await page.evaluate((pidArg) => {
      const dev = [...document.querySelectorAll('[data-glance-box], .pglance [data-st], .glance [data-st]')].find((el) => el.textContent || '')
      return Boolean(dev) || Boolean(document.querySelector('#project-list'))
    }, pid).catch(() => false)
    check('(B2) /projects renders the overview home (the donut + boxes)', ovOk)
    check('(B2) /projects renders the glance rail / list container', glanceOk)
    const cssProjects = cssCount()
    check('(C/FE-5) /projects: exactly 4 stylesheet requests (the Phase-5 diet)', cssProjects === 4, `n=${cssProjects}`)
    await page.goto(`${URL_BASE}/projects?view=cards`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    cssCount() // the cards round is the same page's stylesheet set — measured above
    const cardOk = await page.waitForSelector(`[data-project-id="${pid}"]`, { timeout: 20_000 }).then(() => true).catch(() => false)
    check('(B2) /projects?view=cards renders the probe project card', cardOk)

    // ---------- (B3) the PROJECT DETAIL ----------
    await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S259 detail task', status: 'idea' })
    await page.goto(`${URL_BASE}/project.html?id=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const detailOk = await page.waitForSelector('.pd-task-wrap', { timeout: 20_000 }).then(() => true).catch(() => false)
    check('(B3) /project.html renders the detail + the dev task', detailOk)
    const cssProject = cssCount()
    check('(C/FE-5) /project.html: exactly 4 stylesheet requests', cssProject === 4, `n=${cssProject}`)

    // ---------- (B4) THE KANBAN ROUND ----------
    await page.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForSelector('.pd-col[data-status="idea"]', { timeout: 20_000 })
    const cssBoard = cssCount()
    check('(C/FE-5) /kanban: exactly 4 stylesheet requests', cssBoard === 4, `n=${cssBoard}`)
    const bootCalls = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url)))
    check('(C/BE-3) /kanban boots on ONE lean board GET (?lean=1)', bootCalls.filter((c) => c.method === 'GET').length === 1 && bootCalls.every((c) => /lean=1/.test(c.url)), bootCalls[0]?.url)
    const boardGets = async () => (await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url)))).filter((c) => c.method === 'GET').length
    const bootGets = await boardGets()

    // create: the Add task button → the editor → save (the designed contract:
    // ONE lean reload — the staged shots/deps/tags are not in the 201 ack)
    await page.click('.pd-col[data-status="idea"] [data-add="idea"]')
    await page.waitForSelector('.db-modal:not([hidden])', { timeout: 8_000 })
    await page.fill('.db-modal [name=title]', 'S259 created by regression')
    await page.click('.db-modal [data-db-save]')
    await page.waitForSelector('.pd-col[data-status="idea"] .pd-task-wrap:has-text("S259 created by regression")', { timeout: 10_000 })
    check('(B4) kanban CREATE: the editor round-trip renders the card', true)
    const afterCreate = await boardGets()
    const createCalls = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url) && c.method === 'GET'))
    check('(C/FE-1) the editor-create repainted via exactly ONE LEAN reload (the S254 design)', afterCreate === bootGets + 1 && /lean=1/.test(createCalls[createCalls.length - 1]?.url || ''), `GETs ${bootGets}→${afterCreate}`)

    // tag: the card ⋯ → Edit → the tag input + Enter → save (a repaint, zero GET)
    const cardSel = '.pd-col[data-status="idea"] .pd-task-wrap:has-text("S259 created by regression")'
    await page.click(`${cardSel} .db-card-menu [data-menu-open]`)
    await page.click('.spark-menu-pop:not([hidden]) [data-db-edit-card]')
    await page.waitForSelector('.db-modal:not([hidden])', { timeout: 8_000 })
    await page.waitForTimeout(700) // let the editor's async shots round settle before typing
    await page.fill('.db-modal [data-db-tag-in]', 's259-regression')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.db-modal .db-tag:has-text("s259-regression")', { timeout: 5_000 })
    await page.click('.db-modal [data-db-save]')
    await page.waitForTimeout(900)
    // THE S259 FINDING (recorded, not fixed — per the session's red line): the tag
    // POST landed (201, the data is SAFE server-side) and the editor shows the chip,
    // but Phase-3's repaint reads state.tasks — which the immediate tag POST never
    // merges — so the CARD stays chipless until the next reload. Pre-S254 the save's
    // full reload() refetched the tags and the chip appeared. Regression class: FE-1's
    // merge contract missed the editor's immediate tag add/remove round.
    const cardChip = await page.evaluate((sel) => {
      const wrap = document.querySelector(sel)
      return wrap ? wrap.textContent.includes('s259-regression') : false
    }, cardSel).catch(() => false)
    check('(B4) kanban TAG: the chip renders on the card', cardChip, cardChip ? '' : 'THE S259 FINDING — the tag saved (201) but the repaint misses it (state.tasks never merged); pre-S254 the reload showed it. Recorded as the regression ticket.')
    const truth = await api(`/api/projects/${pid}/devboard`)
    const truthBody = truth && truth.ok() ? await truth.json() : null
    const taggedTask = (truthBody?.tasks || []).find((t) => (t.title || '').includes('S259 created by regression'))
    check('(B4) kanban TAG: the server truth carries the tag (data SAFE — display-only gap)', (taggedTask?.tags || []).length > 0, `tags=${JSON.stringify(taggedTask?.tags || [])}`)
    check('(C/FE-1) the tag save repainted WITHOUT a board refetch', (await boardGets()) === afterCreate, `GETs ${afterCreate}→${await boardGets()}`)

    // move: the card ⋯ → Move to → planned (the FE-18 keyboard path; zero GET)
    await page.click(`${cardSel} .db-card-menu [data-menu-open]`)
    await page.click('.spark-menu-pop:not([hidden]) [data-db-move-menu]')
    await page.click('.spark-menu-pop:not([hidden]) .db-move-submenu:not([hidden]) [data-db-move-to="planned"]')
    await page.waitForSelector('.pd-col[data-status="planned"] .pd-task-wrap:has-text("S259 created by regression")', { timeout: 10_000 })
    check('(B4) kanban MOVE: the FE-18 Move-to lands the card in planned', true)
    check('(C/FE-1) the move repainted WITHOUT a board refetch', (await boardGets()) === afterCreate, `GETs ${afterCreate}→${await boardGets()}`)

    // done: the card ⋯ → Edit → status done → save (a repaint, zero GET)
    const movedSel = '.pd-col[data-status="planned"] .pd-task-wrap:has-text("S259 created by regression")'
    await page.click(`${movedSel} .db-card-menu [data-menu-open]`)
    await page.click('.spark-menu-pop:not([hidden]) [data-db-edit-card]')
    await page.waitForSelector('.db-modal:not([hidden])', { timeout: 8_000 })
    await page.waitForTimeout(700) // the same settle for the done round
    await page.click('.db-modal .db-seg[data-seg="status"] button[data-val="done"]')
    await page.click('.db-modal [data-db-save]')
    await page.waitForSelector('.pd-col[data-status="done"] .pd-task-wrap:has-text("S259 created by regression")', { timeout: 10_000 })
    check('(B4) kanban DONE: the card lands in the done lane', true)
    check('(C/FE-1) the done save repainted WITHOUT a board refetch', (await boardGets()) === afterCreate, `GETs ${afterCreate}→${await boardGets()}`)

    // archive: the done column ⋯ → Archive done tasks → the confirm (one lean reload)
    await page.click('.pd-col[data-status="done"] [data-db-col-menu]')
    await page.click('.db-col-menu:not([hidden]) [data-db-archive-done]')
    await page.waitForSelector('.hib-confirm-overlay', { timeout: 5_000 })
    await page.click('[data-hib-confirm="ok"]')
    const doneGone = await waitFor(async () => (await page.evaluate(() => document.querySelectorAll('.pd-col[data-status="done"] .pd-task-wrap').length)) === 0)
    check('(B4) kanban ARCHIVE: archive-done sweeps the done lane', doneGone === true, doneGone === true ? '' : 'the done card never left')
    const archRes = await api(`/api/projects/${pid}/archives`)
    const archBody = archRes && archRes.ok() ? await archRes.json() : null
    check('(B4) the archived snapshot row exists (restorable)', (archBody?.archives || []).some((a) => (a.title || '').includes('S259 created by regression')), `archives=${archBody?.archives?.length ?? '?'}`)

    // ---------- (B5) THE SPRINT ROUND ----------
    await page.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForSelector('#sp-wrap', { timeout: 20_000 })
    const cssSprint = cssCount()
    check('(C/FE-5) /sprint.html: exactly 4 stylesheet requests', cssSprint === 4, `n=${cssSprint}`)
    const sprBoot = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url)))
    check('(C/BE-3) /sprint.html boots on ONE lean board GET (?lean=1)', sprBoot.filter((c) => c.method === 'GET').length === 1 && sprBoot.every((c) => /lean=1/.test(c.url)), sprBoot[0]?.url)

    // strategy create: the toolbar button → the modal → save
    await page.click('#sp-new-strategy')
    await page.waitForSelector('.db-strategy-modal', { timeout: 8_000 })
    await page.fill('.db-strategy-modal [data-stg-name]', 'S259 regression strategy')
    await page.click('.db-strategy-modal [data-stg-save]')
    await page.waitForSelector('[data-strategy-card]:has-text("S259 regression strategy")', { timeout: 10_000 })
    const stratCard = await page.evaluate(() => document.querySelector('[data-strategy-card]')?.dataset.strategyCard || null)
    check('(B5) sprint STRATEGY CREATE: the card renders', Boolean(stratCard), stratCard || '')

    // sprint with strategy: the define popover (name-only → DRAFT)
    await page.click('#sp-new-sprint')
    await page.waitForSelector('.sp-define-pop', { timeout: 8_000 })
    await page.fill('.sp-define-pop [data-sp-define-name]', 'S259 regression sprint')
    await page.selectOption('.sp-define-pop [data-sp-define-strategy]', stratCard)
    await page.click('.sp-define-pop [data-sp-define-ok]')
    await page.waitForSelector('[data-sp-draft-card]', { timeout: 10_000 })
    const draftStrategyChip = await page.evaluate(() => document.querySelector('[data-sp-draft-card]')?.textContent || '')
    check('(B5) sprint WITH STRATEGY: the draft card carries the strategy chip', draftStrategyChip.includes('S259 regression strategy'), draftStrategyChip.slice(0, 90))

    // a task joins the draft (the sidebar quick-add — server-side draft preference;
    // the S254 FE-1b contract: ONE POST devtasks, ZERO board GET). The Uncategorized
    // fold starts collapsed — open it first (the FE-17 fold grammar).
    await page.evaluate(() => { const head = document.querySelector('[data-cat-toggle="none"]'); if (head && head.dataset.open !== '1') head.click() })
    await page.waitForSelector('[data-quickadd="none"]', { timeout: 8_000 })
    const sprGetsBefore = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url) && c.method === 'GET').length)
    const postsBefore = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devtasks$/.test(c.url) && c.method === 'POST').length)
    await page.fill('[data-quickadd="none"]', 'S259 sprint task')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.sp-task:has-text("S259 sprint task")', { timeout: 15_000 })
    check('(B5) the sidebar quick-add task joins the draft', true)
    const sprGetsAfter = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url) && c.method === 'GET').length)
    const postsAfter = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devtasks$/.test(c.url) && c.method === 'POST').length)
    check('(C/FE-1) the quick-add: ONE POST devtasks, ZERO board GET (the merge)', sprGetsAfter === sprGetsBefore && postsAfter === postsBefore + 1, `GETs ${sprGetsBefore}→${sprGetsAfter}, POSTs ${postsBefore}→${postsAfter}`)

    // start
    await page.click('[data-sp-draft-start]')
    const started = await waitFor(async () => page.evaluate(() => {
      const strip = document.querySelector('.sp-sprint')
      return strip && strip.textContent.includes('S259 regression sprint') ? strip.textContent.slice(0, 120) : null
    }))
    check('(B5) sprint START: the active sprint strip renders', Boolean(started), String(started || 'never rendered').slice(0, 80))

    // task done: the timeline dot (the sprint's task) → the editor → done → save
    const taskId = await page.evaluate(() => {
      const t = (window.HibanaBoard.state.tasks || []).find((x) => x.title === 'S259 sprint task')
      return t ? t.id : null
    })
    check('(B5) the task renders on the timeline (the dot)', Boolean(taskId))
    await page.click(`[data-bar="${taskId}"]`)
    await page.waitForSelector('.db-modal:not([hidden])', { timeout: 8_000 })
    await page.waitForTimeout(700) // the same settle for the sprint-task round
    await page.click('.db-modal .db-seg[data-seg="status"] button[data-val="done"]')
    await page.click('.db-modal [data-db-save]')
    await page.waitForSelector(`[data-bar="${taskId}"] .sp-dot-check`, { timeout: 10_000 })
    check('(B5) sprint TASK DONE: the dot carries the ✓', true)

    // finish
    await page.click('#sp-finish-btn')
    await page.waitForSelector('.db-sprintmod-card', { timeout: 8_000 })
    const finishModalText = await page.evaluate(() => document.querySelector('.db-sprintmod-card')?.textContent || '')
    check('(B5) the finish modal shows the exact-counts contract', /1 tasks in Implemented will be archived/.test(finishModalText) && /No tasks will be deleted/.test(finishModalText), finishModalText.slice(0, 110))
    await page.click('.db-sprintmod-card [data-sm-finish]')
    const main = await waitFor(async () => {
      const finished = await api(`/api/projects/${pid}/devboard`)
      const sprintsAfter = finished && finished.ok() ? (await finished.json()).sprints : []
      return sprintsAfter.find((s) => s.name === 'S259 regression sprint' && s.ended_at) || null
    })
    check('(B5) sprint FINISH: the sprint is completed (ended_at set)', Boolean(main), `status=${main?.status} ended=${Boolean(main?.ended_at)}`)

    // complete strategy: the strategy ⋯ → Complete strategy
    await page.click(`[data-strategy-menu="${stratCard}"]`)
    await page.waitForSelector('.sp-strategy-pop', { timeout: 8_000 })
    await page.click('.sp-strategy-pop [data-stg-complete]')
    const stratAfter = await waitFor(async () => {
      const board = await api(`/api/projects/${pid}/devboard`)
      const body = board && board.ok() ? await board.json() : null
      return (body?.strategies || []).find((s) => s.id === stratCard && s.status === 'completed') || null
    })
    check('(B5) strategy COMPLETE: the strategy is completed', Boolean(stratAfter), `status=${stratAfter?.status}`)

    // delete: a fresh DRAFT sprint → the row ⋯ → the exact-counts modal → Delete
    await page.click('#sp-new-sprint')
    await page.waitForSelector('.sp-define-pop', { timeout: 8_000 })
    await page.fill('.sp-define-pop [data-sp-define-name]', 'S259 delete-me draft')
    await page.click('.sp-define-pop [data-sp-define-ok]')
    // the draft card's name rides an <input value> — :has-text can't see it; poll it
    const draftId = await waitFor(async () => page.evaluate(() => {
      const card = document.querySelector('[data-sp-draft-card]')
      const name = card ? (card.querySelector('[data-sp-draft-name]') || {}).value : ''
      return card && name === 'S259 delete-me draft' ? card.dataset.spDraftCard : null
    }))
    await page.click(`.sp-list-row[data-sp-open="${draftId}"] .sp-list-more`)
    await page.click('.sp-sprint-pop:not([hidden]) [data-sp-del]')
    await page.waitForSelector('.db-sprintmod-card', { timeout: 8_000 })
    const delModalText = await page.evaluate(() => document.querySelector('.db-sprintmod-card')?.textContent || '')
    check('(B5) the delete modal shows the exact-counts contract', /No tasks will be deleted/.test(delModalText), delModalText.slice(0, 90))
    await page.click('.db-sprintmod-card [data-sm-del]')
    const delState = await waitFor(async () => {
      const afterDel = await api(`/api/projects/${pid}/devboard`)
      const sprintsDel = afterDel && afterDel.ok() ? (await afterDel.json()).sprints : []
      return (!sprintsDel.some((s) => s.name === 'S259 delete-me draft') && sprintsDel.some((s) => s.name === 'S259 regression sprint')) ? sprintsDel : null
    })
    check('(B5) sprint DELETE: the draft is gone; the finished sprint stays (history)', Boolean(delState), `n=${delState?.length ?? '?'}`)

    // ---------- (C) BE-25 — the version-stamp ETag round (raw, both variants) ----------
    const def = await api(`/api/projects/${pid}/devboard`)
    const defBody = def && def.ok() ? await def.json() : null
    const defEtag = def ? def.headers().etag : null
    check('(C/BE-25) the default board GET carries a stamp ETag', Boolean(defEtag), defEtag || 'none')
    check('(C/BE-3) the DEFAULT payload keeps sprints[].description (the desktop contract)', defBody && typeof defBody.sprints[0]?.description === 'string')
    const lean = await context.request.fetch(`${URL_BASE}/api/projects/${pid}/devboard?lean=1`, { headers: { Origin: URL_BASE } }).catch(() => null)
    const leanText = lean ? await lean.text() : ''
    const leanSprints = leanText ? (JSON.parse(leanText).sprints || []) : []
    check('(C/BE-3) the LEAN payload omits sprints[].description', leanSprints.length > 0 && !('description' in leanSprints[0]), `sprints=${leanSprints.length}`)
    const leanEtag = lean ? lean.headers().etag : null
    check('(C/BE-25) the lean variant carries its own validator (no cross-304)', Boolean(leanEtag) && leanEtag !== defEtag, `${defEtag} vs ${leanEtag}`)
    const hit = await context.request.fetch(`${URL_BASE}/api/projects/${pid}/devboard`, { headers: { Origin: URL_BASE, 'If-None-Match': defEtag || '' } }).catch(() => null)
    const hitText = hit ? await hit.text() : ''
    check('(C/BE-25) a matching If-None-Match → 304 with an empty body', hit?.status() === 304 && hitText.length === 0, `${hit?.status?.()} bytes=${hitText.length}`)
    const mutated = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S259 stamp mover', status: 'idea' })
    const mutId = mutated && mutated.ok() ? (await mutated.json()).id : null
    const stale = await context.request.fetch(`${URL_BASE}/api/projects/${pid}/devboard`, { headers: { Origin: URL_BASE, 'If-None-Match': defEtag || '' } }).catch(() => null)
    check('(C/BE-25) the mutation MOVED the stamp — the old validator gets the fresh 200', stale?.status() === 200, String(stale?.status?.()))

    // ---------- (D) the {en,fa} × {light,dark} matrix ----------
    let leg = 0
    for (const lang of ['en', 'fa']) {
      await api('/api/settings', 'PATCH', { language_pref: lang })
      for (const theme of ['light', 'claude-dark']) {
        leg++
        await page.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.evaluate((t) => { localStorage.setItem('hibana-theme', t); localStorage.setItem('hibana-tour-done', '1') }, theme)
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 })
        const boardOk = await page.waitForSelector('.pd-col[data-status="idea"]', { timeout: 20_000 }).then(() => true).catch(() => false)
        const mat = await page.evaluate(() => ({
          bg: getComputedStyle(document.body).backgroundColor,
          dir: document.documentElement.getAttribute('dir') || '',
          lanes: document.querySelectorAll('.pd-col').length,
        })).catch(() => null)
        const wantBg = theme === 'light' ? 'rgb(231, 231, 231)' : 'rgb(20, 20, 19)'
        check(`(D/${leg}) board ${lang}/${theme}: renders + theme token + dir`, boardOk && mat && mat.bg === wantBg && (lang === 'fa' ? mat.dir === 'rtl' : mat.dir !== 'rtl') && mat.lanes >= 4, `bg=${mat?.bg} dir=${mat?.dir} lanes=${mat?.lanes}`)
        await page.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        const sprintOk = await page.waitForSelector('#sp-wrap', { timeout: 20_000 }).then(() => true).catch(() => false)
        const smat = await page.evaluate(() => ({
          bg: getComputedStyle(document.body).backgroundColor,
          dir: document.documentElement.getAttribute('dir') || '',
          stratCards: document.querySelectorAll('[data-strategy-card]').length,
        })).catch(() => null)
        check(`(D/${leg}) sprint ${lang}/${theme}: renders + the strategy card + dir`, sprintOk && smat && smat.bg === wantBg && (lang === 'fa' ? smat.dir === 'rtl' : smat.dir !== 'rtl') && smat.stratCards >= 1, `bg=${smat?.bg} dir=${smat?.dir} strategies=${smat?.stratCards}`)
      }
    }
    check(`(D) the ${leg}-leg matrix ran with ZERO page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    // restore the account's original language
    await api('/api/settings', 'PATCH', { language_pref: origLang })

    // ---------- (D cont.) the 390px leg ----------
    const mob = await context.newPage({ viewport: { width: 390, height: 844 } })
    const mobErrors = []
    mob.on('pageerror', (e) => mobErrors.push(String(e.message).slice(0, 100)))
    mob.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|404|409|503)/.test(m.text())) mobErrors.push(m.text().slice(0, 100)) })
    await mob.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const mobBoard = await mob.waitForSelector('.pd-col[data-status="idea"]', { timeout: 20_000 }).then(() => true).catch(() => false)
    check('(D) 390px board renders', mobBoard)
    await mob.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const mobSprint = await mob.waitForSelector('#sp-wrap', { timeout: 20_000 }).then(() => true).catch(() => false)
    check('(D) 390px sprint renders', mobSprint)
    check('(D) 390px legs: ZERO page errors', mobErrors.length === 0, mobErrors.slice(0, 3).join(' | '))
    await mob.close()

    // ---------- the whole-journey console verdict ----------
    check('(F) the FULL journey: ZERO page errors / ZERO console errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

    await page.close()
  } finally {
    const del = await api(`/api/projects/${pid}`, 'DELETE')
    check('probe project soft-deleted (trash)', del && del.status() === 200, String(del && del.status()))
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${failed === 0 ? 'ALL ' + results.length + ' CHECKS GREEN' : failed + ' CHECKS FAILED (of ' + results.length + ')'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
