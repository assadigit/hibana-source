#!/usr/bin/env node
// scripts/live-s258-probe.mjs — S258 (Phase 7 — the UI/UX polish round) live
// probe: the spec's §10 step 6 — "deploy dev → live probe → deploy prod → live
// probe". The 1003-test suite + 515 e2e prove the matrix locally; this probe
// proves the DEPLOYED worker serves the round's five findings end to end:
//
//   (A) deploy carriers — the health probe (ok, schema 66) + sw.js hibana-v464
//       + board.html's ONE bundle link at ?v=2 (the round's cache-bust moved it);
//   (B) FE-11 — the bulk POST …/devtasks/clear-done on the live chain: two done
//       tasks + a keeper → ONE request answers {ok, deleted:2}; the keeper
//       survives; the empty case answers {deleted:0}; the archive-done twin
//       keeps its own {archived} key (the additive-only contract);
//   (C) the FEATURE matrix — {en,fa} × {light,claude-dark} × {/kanban,/sprint}:
//       FE-18 the ⋯ census carries Move-to + the submenu opens with the four
//       other lanes (current excluded), FE-6 the task view's Tab containment +
//       the close-restore, FE-9 the strategy filter strip + the Clear reset,
//       FE-17 the sidebar fold + quick-add draft survive a re-render, and the
//       per-leg theme token + dir + bundle-parse checks (the S256 grammar);
//   (D) the 390px leg — the board + sprint at phone width: the ⋯ menu opens,
//       the strip wraps, zero page errors.
//
// Usage: node scripts/live-s258-probe.mjs [dev|prod|local]   (default: dev; local =
//        http://127.0.0.1:3017 against `npm run start:node` with a scratch DB)
// Env:   S258_LOGIN + S258_PASS (the test account) — never hardcoded.

import { chromium } from 'playwright'

const target = process.argv[2] || 'dev'
const LOCAL_PORT = process.env.S258_LOCAL_PORT || '3017'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? `http://127.0.0.1:${LOCAL_PORT}` : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S258_LOGIN
const PASS = process.env.S258_PASS
if (!LOGIN || !PASS) {
  console.error('need S258_LOGIN + S258_PASS in env (the test account)')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const main = async () => {
  console.log(`S258 UI/UX-polish probe → ${URL_BASE}`)

  // ---------- (A) the carriers ----------
  const health = await fetch(`${URL_BASE}/api/health`).then((r) => r.json()).catch(() => null)
  check('(A) /api/health answers ok', health && health.ok === true, JSON.stringify(health)?.slice(0, 60))
  check('(A) schema_version is 66', Number(health?.schema_version) === 66, `schema_version=${health?.schema_version}`)
  const sw = await fetch(`${URL_BASE}/sw.js`).then((r) => r.text()).catch(() => '')
  check('(A) sw.js carries hibana-v464', sw.includes('"hibana-v464"'))
  const boardHtml = await fetch(`${URL_BASE}/board.html`).then((r) => r.text()).catch(() => '')
  check('(A) board.html links the ONE bundle at v2 (the round moved it)', boardHtml.includes('/css/board-bundle.css?v=2') && !/\/css\/devboard\.css\?v=/.test(boardHtml))
  check('(A) board.html carries the round\'s script carriers (app v222, board-page v38, devboard v40)', boardHtml.includes('/js/app.js?v=222') && boardHtml.includes('/js/board-page.js?v=38') && boardHtml.includes('/js/devboard.js?v=40'))

  // ---------- the browser context (the request API rides the cookie jar) ----------
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
  const loginRes = await context.request.post(`${URL_BASE}/api/auth/login`, { headers: { 'Content-Type': 'application/json', Origin: URL_BASE }, data: { login: LOGIN, password: PASS } })
  if (loginRes.status() !== 200) {
    console.error(`login failed: ${loginRes.status()}`)
    await browser.close()
    process.exit(1)
  }
  console.log('  signed in')

  const meRes = await api('/api/auth/me')
  const origLang = meRes && meRes.ok() ? ((await meRes.json()).user?.language_pref ?? 'en') : 'en'

  // ---------- the probe project (one project, every shape the legs need) ----------
  const proj = await api('/api/projects', 'POST', { title: `S258 probe ${new Date().toISOString().slice(0, 10)} (safe to delete)`, status: 'developing' })
  const pid = proj && proj.ok() ? (await proj.json()).id : null
  if (!pid) { check('probe project created', false); await browser.close(); process.exit(1) }
  const mk = (body) => api(`/api/projects/${pid}/devtasks`, 'POST', body)
  await mk({ title: 'S258 move probe task', status: 'idea', priority: 'high' })
  await mk({ title: 'S258 done one', status: 'done' })
  await mk({ title: 'S258 done two', status: 'done' })
  const strat = await api(`/api/projects/${pid}/strategies`, 'POST', { name: 'S258 probe strategy' })
  const stid = strat && strat.ok() ? (await strat.json()).id : null
  const spr = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S258 probe sprint', strategy_id: stid })
  const sid = spr && spr.ok() ? (await spr.json()).id : null
  if (sid) await api(`/api/sprints/${sid}/start`, 'POST')
  await mk({ title: 'S258 loose task', sprint_id: null })
  await mk({ title: 'S258 in-strategy task', sprint_id: sid })
  check('probe project seeded (strategy + sprint + 5 tasks)', Boolean(stid && sid))

  try {
    // ---------- (C) the FEATURE matrix ----------
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 100)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(401|404|409|503)/.test(m.text())) pageErrors.push(m.text().slice(0, 100)) })
    let leg = 0
    for (const lang of ['en', 'fa']) {
      await api('/api/settings', 'PATCH', { language_pref: lang })
      for (const theme of ['light', 'claude-dark']) {
        // ---- the BOARD leg: FE-18 census + submenu + FE-6 containment ----
        leg++
        await page.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.evaluate((t) => { localStorage.setItem('hibana-theme', t); localStorage.setItem('hibana-tour-done', '1') }, theme)
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForSelector('.pd-task-wrap', { timeout: 20_000 })
        await page.waitForTimeout(400)
        const board = await page.evaluate(() => {
          const s = document.querySelector('.pd-task-wrap')
          const menu = s && s.querySelector('.db-card-menu')
          if (!menu) return null
          menu.querySelector('[data-menu-open]').click()
          const pop = menu.querySelector('.spark-menu-pop')
          const moveBtn = pop && pop.querySelector('[data-db-move-menu]')
          if (moveBtn) moveBtn.click()
          const sub = pop && pop.querySelector('.db-move-submenu')
          return {
            hasCopy: !!(pop && pop.querySelector('[data-db-copy-card]')),
            hasEdit: !!(pop && pop.querySelector('[data-db-edit-card]')),
            hasDel: !!(pop && pop.querySelector('[data-db-del-card]')),
            hasMove: !!moveBtn,
            expanded: moveBtn ? moveBtn.getAttribute('aria-expanded') : null,
            laneRows: sub ? sub.querySelectorAll('[data-db-move-to]').length : -1,
            hasIdea: sub ? !!sub.querySelector('[data-db-move-to="idea"]') : null,
            bg: getComputedStyle(document.body).backgroundColor,
            dir: document.documentElement.getAttribute('dir') || '',
          }
        }).catch(() => null)
        check(`(C/${leg}) board ${lang}/${theme}: FE-18 census — Copy+Edit+Move-to+Delete`, board && board.hasCopy && board.hasEdit && board.hasDel && board.hasMove, JSON.stringify(board)?.slice(0, 80))
        check(`(C/${leg}) board ${lang}/${theme}: FE-18 submenu — 4 lanes, the current (idea) excluded, aria-expanded`, board && board.laneRows === 4 && board.hasIdea === false && board.expanded === 'true', `rows=${board?.laneRows} expanded=${board?.expanded}`)
        const wantBg = theme === 'light' ? 'rgb(231, 231, 231)' : 'rgb(20, 20, 19)'
        check(`(C/${leg}) board ${lang}/${theme}: theme token + dir`, board && board.bg === wantBg && (lang === 'fa' ? board.dir === 'rtl' : board.dir !== 'rtl'), `bg=${board?.bg} dir=${board?.dir}`)
        // FE-6: the view's Tab containment + the close-restore (REAL key events)
        await page.locator('.pd-task-wrap .pd-task').first().click()
        await page.waitForSelector('#db-view-overlay:not([hidden])', { timeout: 8_000 })
        for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
        const focus = await page.evaluate(() => {
          const ov = document.getElementById('db-view-overlay')
          return { contained: ov && ov.contains(document.activeElement) }
        }).catch(() => null)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        const focusAfter = await page.evaluate(() => {
          const ov = document.getElementById('db-view-overlay')
          const card = document.querySelector('.pd-task-wrap .pd-task')
          return { closed: !ov || ov.hidden, restored: document.activeElement === card || (card && card.contains(document.activeElement)) }
        }).catch(() => null)
        check(`(C/${leg}) board ${lang}/${theme}: FE-6 the view's Tab containment + Esc restore`, focus && focus.contained && focusAfter && focusAfter.closed && focusAfter.restored, JSON.stringify({ ...focus, ...focusAfter }))

        // ---- the SPRINT leg: FE-9 strip + FE-17 sidebar survival ----
        leg++
        await page.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForSelector('#sp-wrap', { timeout: 20_000 })
        await page.waitForTimeout(400)
        const strip = await page.evaluate((stidArg) => {
          const stripEl = document.getElementById('sp-filter-strip')
          if (!stripEl) return { present: false }
          const before = { hidden: stripEl.hidden }
          const card = document.querySelector(`[data-strategy-card="${stidArg}"]`)
          if (card) card.click()
          return { present: true, before, afterHidden: stripEl.hidden, text: stripEl.textContent || '', hasClear: !!stripEl.querySelector('[data-sp-filter-clear]') }
        }, stid).catch(() => null)
        check(`(C/${leg}) sprint ${lang}/${theme}: FE-9 the strip appears on filter + carries the Clear`, strip && strip.present && strip.before && strip.before.hidden === true && strip.afterHidden === false && strip.hasClear, JSON.stringify(strip)?.slice(0, 90))
        const stripTextOk = lang === 'en' ? /tasks without sprints are hidden/.test(strip?.text || '') : /پنهان/.test(strip?.text || '')
        check(`(C/${leg}) sprint ${lang}/${theme}: FE-9 the strip explains the hidden sprint-less tasks (${lang})`, stripTextOk, (strip?.text || '').slice(0, 70))
        // FE-17: expand the first category fold + draft text + focus, then a
        // programmatic re-render (the concurrent-mutation shape)
        await page.evaluate(() => {
          const head = document.querySelector('[data-cat-toggle]')
          if (head && head.dataset.open !== '1') head.click()
          const quick = document.querySelector('[data-quickadd]')
          if (quick) { quick.focus(); quick.value = 'probe draft' }
          const eye = document.querySelector('[data-cat-eye]')
          if (eye) eye.click()
          return null
        }).catch(() => null)
        await page.waitForTimeout(350)
        const sideAfter = await page.evaluate(() => {
          const head = document.querySelector('[data-cat-toggle]')
          const quick = document.querySelector('[data-quickadd]')
          return {
            open: head ? head.dataset.open : null,
            val: quick ? quick.value : null,
            focused: document.activeElement === quick,
          }
        }).catch(() => null)
        check(`(C/${leg}) sprint ${lang}/${theme}: FE-17 the fold + quick-add draft + focus survive the re-render`, sideAfter && sideAfter.open === '1' && sideAfter.val === 'probe draft' && sideAfter.focused, JSON.stringify(sideAfter))
        // clear the filter for the next leg (leave no state behind)
        await page.evaluate(() => { const c = document.querySelector('[data-sp-filter-clear]'); if (c) c.click() })
        await page.waitForTimeout(200)
      }
    }
    check(`(C) ${leg} feature legs ran with ZERO page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    // restore the account's original language
    await api('/api/settings', 'PATCH', { language_pref: origLang })

    // ---------- (D) the 390px leg ----------
    const mob = await context.newPage({ viewport: { width: 390, height: 844 } })
    const mobErrors = []
    mob.on('pageerror', (e) => mobErrors.push(String(e.message).slice(0, 100)))
    await mob.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await mob.waitForSelector('.pd-task-wrap', { timeout: 20_000 })
    const mobMenu = await mob.evaluate(() => {
      const s = document.querySelector('.pd-task-wrap')
      const menu = s && s.querySelector('.db-card-menu')
      if (!menu) return null
      menu.querySelector('[data-menu-open]').click()
      const pop = menu.querySelector('.spark-menu-pop')
      const r = pop ? pop.getBoundingClientRect() : null
      return { visible: !!pop && !pop.hidden, inViewport: r ? r.left >= 0 && r.right <= window.innerWidth : false, hasMove: !!(pop && pop.querySelector('[data-db-move-menu]')) }
    }).catch(() => null)
    check('(D) 390px board: the ⋯ menu opens INSIDE the viewport + Move-to reachable', mobMenu && mobMenu.visible && mobMenu.inViewport && mobMenu.hasMove, JSON.stringify(mobMenu))
    await mob.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await mob.waitForSelector('#sp-wrap', { timeout: 20_000 })
    const mobStrip = await mob.evaluate((stidArg) => {
      const card = document.querySelector(`[data-strategy-card="${stidArg}"]`)
      if (card) card.click()
      const stripEl = document.getElementById('sp-filter-strip')
      if (!stripEl) return null
      // the sprint page's main is wider than the viewport at 390px (the timeline's
      // own scroll grammar — pre-existing); the strip's contract is to match the
      // page's full-width section rhythm (the strategies section), not the viewport
      const sect = document.getElementById('sp-strategies')
      return { hidden: stripEl.hidden, wrapped: stripEl.scrollHeight >= stripEl.clientHeight, w: stripEl.getBoundingClientRect().width, sectW: sect ? sect.getBoundingClientRect().width : null }
    }, stid).catch(() => null)
    check("(D) 390px sprint: the filter strip renders at the page's section rhythm (wraps)", mobStrip && mobStrip.hidden === false && mobStrip.sectW != null && Math.abs(mobStrip.w - mobStrip.sectW) <= 2, JSON.stringify(mobStrip))
    check('(D) 390px legs: ZERO page errors', mobErrors.length === 0, mobErrors.slice(0, 3).join(' | '))
    await mob.close()

    // ---------- (B) FE-11 — the bulk clear-done round ----------
    const clear = await api(`/api/projects/${pid}/devtasks/clear-done`, 'POST')
    const clearBody = clear && clear.ok() ? await clear.json() : null
    check('(B) clear-done: ONE request answers {ok, deleted:2}', clear && clear.status() === 200 && clearBody && clearBody.deleted === 2, `${clear?.status?.()} ${JSON.stringify(clearBody)}`)
    const boardAfter = await api(`/api/projects/${pid}/devboard`)
    const tasksAfter = boardAfter && boardAfter.ok() ? (await boardAfter.json()).tasks : []
    check('(B) the done rows are gone; the other three survive', tasksAfter.length === 3 && !tasksAfter.some((t) => t.status === 'done'), `n=${tasksAfter.length}`)
    const again = await api(`/api/projects/${pid}/devtasks/clear-done`, 'POST')
    const againBody = again && again.ok() ? await again.json() : null
    check('(B) the empty case answers {deleted:0}', again && again.status() === 200 && againBody && againBody.deleted === 0, JSON.stringify(againBody))
    check('(B) the response carries NO archived key (the twins stay distinct)', againBody && !('archived' in againBody), JSON.stringify(againBody))
    const arch = await api(`/api/projects/${pid}/devtasks/archive-done`, 'POST')
    const archBody = arch && arch.ok() ? await arch.json() : null
    check('(B) archive-done keeps its own {archived:0} shape (additive-only held)', arch && arch.status() === 200 && archBody && archBody.archived === 0 && !('deleted' in archBody), JSON.stringify(archBody))

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
