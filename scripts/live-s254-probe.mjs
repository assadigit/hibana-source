#!/usr/bin/env node
// scripts/live-s254-probe.mjs — S254 (Phase 3 — interaction performance) live
// FEEL probe: exercises the round's interaction contracts on a DEPLOYED worker
// through the REAL browser (Playwright chromium, logged in as the test account
// on prod / the seeded probe user on dev), inside a disposable probe project
// (soft-deleted at the end; the dev purge sweeps what the cascade cannot reach).
//
//   (A) deploy carriers — the health probe (ok, schema 66), sw.js VERSION
//       hibana-v461, and the served HTML carries the round's asset versions:
//       /kanban → board-page.js v35 + devboard.js v38 + touch-drag.js v2 +
//       chip-render.js v14 + due-control.js v2; /sprint.html → sprint-page.js
//       v29; /project.html → project-page.js v86;
//   (B) FE-3 — a draggable card's computed touch-action at REST is not `none`
//       (the 250 ms arm is the only place it may appear — quick swipes scroll);
//   (C) FE-2 + FE-1 drag — synthetic HTML5 DnD idea→planned: dragover
//       preventDefault-ed (the rAF batch flushes before the sync drop), the
//       card lands in the target lane, and the board does NOT refetch (the
//       reorder merged into state — ZERO extra GET devboard);
//   (D) FE-1 done round-trip — drag planned→done: card in the done lane, the
//       server stamped done_at, still ZERO extra GET devboard;
//   (E) FE-1 quick-add — sprint sidebar Enter: ONE POST devtasks, ZERO board
//       GET (the retired reload), and the task renders in the sidebar;
//   (F) zero page errors on every surface (console 401/404/409 resource noise
//       tolerated, the e2e convention).
//
// Usage: node scripts/live-s254-probe.mjs [dev|prod|local]   (default: dev; local =
//        http://127.0.0.1:3017 against `npm run start:node` with a scratch DB)
// Env:   S254_LOGIN + S254_PASS (the test account) — never hardcoded.

import { chromium } from 'playwright'
import { randomUUID } from 'node:crypto'

const target = process.argv[2] || 'dev'
// local: 127.0.0.1, never `localhost` — some sandboxes resolve it to ::1 while the
// node server binds IPv4 only, and the probe dies with a spurious ECONNREFUSED.
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? 'http://127.0.0.1:3017' : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S254_LOGIN
const PASS = process.env.S254_PASS
if (!LOGIN || !PASS) {
  console.error('need S254_LOGIN + S254_PASS in env (the test account)')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const api = async (path, method = 'GET', body, cookie) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // The T6 CSRF rule: every state-changing request carries a TRUSTED Origin
      // (the app's own) — server-side callers send it explicitly.
      Origin: URL_BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  // read the body ONCE as text, then try JSON — a failed res.json() consumes
  // the stream and a follow-up res.text() returns "" (the rehearsal's lesson)
  const raw = await res.text().catch(() => '')
  let json = null
  try { json = raw ? JSON.parse(raw) : null } catch { /* html or empty */ }
  return { status: res.status, json, text: json ? null : raw, cookie: res.headers.get('set-cookie') }
}

// the round's carriers (the SW v461 line names exactly these). On the CANONICAL
// tree (local) they ride as /js/<name>.js?v=N; on DEPLOYED trees the deploy-time
// wiring rewrites them to content-hashed /dist/<name>.<hash>.js (the ?v= is
// consumed by the hashed URL) — so the deployed check is: the page references
// the carrier (either form) AND every referenced asset resolves 200. The round's
// version identity itself rides the SW v461 line + the un-hashed due-control ?v=2.
const PAGE_CARRIERS = [
  ['/kanban', ['board-page.js', 'devboard.js', 'touch-drag.js', 'chip-render.js', 'due-control.js']],
  ['/sprint.html', ['sprint-page.js']],
  ['/project.html', ['project-page.js']],
]

const main = async () => {
  console.log(`S254 live feel probe → ${URL_BASE}`)

  // ---------- (A) the health probe + the SW carrier ----------
  const health = await api('/api/health')
  check('(A) /api/health answers ok', health.status === 200 && health.json?.ok === true, String(health.status))
  check('(A) schema_version is 66', Number(health.json?.schema_version) === 66, `schema_version=${health.json?.schema_version}`)

  const sw = await fetch(`${URL_BASE}/sw.js`).then((r) => r.text())
  check('(A) sw.js carries hibana-v461 (the S254 cache-bust round)', sw.includes('"hibana-v461"'))

  // --- login
  const login = await api('/api/auth/login', 'POST', { login: LOGIN, password: PASS })
  if (login.status !== 200 || !login.cookie) {
    console.error(`login failed: ${login.status} ${JSON.stringify(login.json)}`)
    process.exit(1)
  }
  const cookie = login.cookie.split(';')[0]
  console.log('  signed in')

  // ---------- (A cont.) the served HTML carries the round's carriers, all resolving ----------
  // every /dist|/js|/css asset the page references must answer 200 — the wired
  // tree's integrity (a stale hash or a missed wiring is exactly the 404 class)
  const assetOk = async (url) => (await fetch(`${URL_BASE}${url}`).then((r) => r.status).catch(() => 0)) === 200
  for (const [path, carriers] of PAGE_CARRIERS) {
    const html = await api(path, 'GET', undefined, cookie)
    const text = html.text || ''
    check(`(A) ${path} serves the page`, html.status === 200, String(html.status))
    for (const name of carriers) {
      // NOTE: template literals eat single backslashes (\? → ?, \d → d) — double them.
      // The wired form swaps the EXTENSION for the hash: /dist/board-page.<hash>.js
      const stem = name.replace(/\.js$/, '')
      const wired = text.match(new RegExp(`["'](/dist/${stem.replace(/\./g, '\\.')}\.[0-9a-f]{8}\\.js)["']`))
      const plain = text.match(new RegExp(`["'](/js/${name.replace(/\./g, '\\.')}\\?v=\\d+)["']`))
      const ref = wired || plain
      check(`(A) ${path} references ${name} (${wired ? 'wired' : 'plain'})`, Boolean(ref), ref ? ref[1] : 'not found')
      if (ref) check(`(A) ${path}'s ${name} resolves 200`, await assetOk(ref[1]))
    }
  }
  // the ONE round carrier the hasher skips (not in the manifest): its ?v= rides
  // the deployed HTML verbatim — v2 IS the S254 bump
  const kanHtml = await api('/kanban', 'GET', undefined, cookie)
  check('(A) /kanban carries due-control.js?v=2 (the round\'s un-hashed carrier)', (kanHtml.text || '').includes('/js/due-control.js?v=2'))
  // FE-19's belt through the wiring: the deployed board-page bundle lazy-injects
  // devboard by its WIRED /dist/ URL (never a stale /js/devboard.js?v= path)
  const bpRef = (kanHtml.text || '').match(/["'](\/dist\/board-page\.[0-9a-f]{8}\.js)["']/)
  if (bpRef) {
    const bpJs = await fetch(`${URL_BASE}${bpRef[1]}`).then((r) => r.text()).catch(() => '')
    const belt = bpJs.match(/["'](\/dist\/devboard\.[0-9a-f]{8}\.js)["']/)
    check('(A) the deployed board-page belt injects the WIRED devboard bundle', Boolean(belt), belt ? belt[1] : 'no wired literal')
    if (belt) check('(A) the belt\'s devboard bundle resolves 200', await assetOk(belt[1]))
  }

  // --- the disposable probe project + the drag subject
  const proj = await api('/api/projects', 'POST', { title: `S254 feel probe ${new Date().toISOString().slice(0, 10)} (safe to delete)`, status: 'developing' }, cookie)
  check('probe project created', proj.status === 201, String(proj.status))
  const pid = proj.json.id
  const t1 = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S254 drag me', status: 'idea' }, cookie)
  const t2 = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S254 spare card', status: 'idea' }, cookie)
  check('probe tasks created (the drag subject + a neighbor)', t1.status === 201 && t2.status === 201, `${t1.status}/${t2.status}`)

  // ---------- (B)-(E) the browser feel test ----------
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource.*(401|404|409)/.test(msg.text())) pageErrors.push(msg.text())
  })
  const callCount = (matcher) => page.evaluate((m) => {
    const re = new RegExp(m)
    return window.__apiCalls.filter((c) => re.test(c.url))
  }, matcher.source)
  const boardGets = async () => (await callCount(/\/devboard/)).filter((c) => c.method === 'GET').length

  // count every fetch every page makes (method + url) — installed as an init
  // script so it survives navigation; the FE-1 contract is "mutations merge
  // into state, the board GET never re-fires"
  await context.addInitScript(() => {
    window.__apiCalls = []
    const orig = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      window.__apiCalls.push({ url, method: (init && init.method) || 'GET', cache: (init && init.cache) || null })
      return orig.apply(this, arguments)
    }
  })

  // ---- sign in through the REAL login page (the __Host- session cookie lands
  //      via the browser's own Set-Cookie path — addCookies cannot carry a
  //      __Host-prefixed cookie, and this is the faithful user session anyway)
  await page.goto(`${URL_BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.fill('[name="login"]', LOGIN)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 30_000 })

  try {
    // ---- the board boots (FE-8's parallel path renders the same board) ----
    await page.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.pd-task-wrap', { timeout: 30_000 })
    check('(B) /kanban renders the probe board (parallel boot)', (await page.locator('.pd-task-wrap').count()) === 2)
    const bootGets = await boardGets()
    check('(B) the boot fired exactly ONE board GET', bootGets === 1, `n=${bootGets}`)

    // ---- (B) FE-3: touch-action at REST is not none (quick swipes scroll) ----
    const touchAction = await page.evaluate(() => {
      const el = document.querySelector('.pd-task')
      return el ? getComputedStyle(el).touchAction : 'missing'
    })
    check('(B) FE-3: a draggable card at rest does NOT block touch scroll', touchAction !== 'none', `touch-action=${touchAction}`)

    // ---- (C) FE-2 + FE-1: drag idea → planned ----
    const drag1 = await page.evaluate(() => {
      const src = document.querySelector('.pd-task-wrap')
      const dst = document.querySelector('.pd-col[data-status="planned"]')
      if (!src || !dst) return 'missing'
      const dt = new DataTransfer()
      const fire = (el, type) => {
        const r = el.getBoundingClientRect()
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + Math.min(r.height / 2, 120) })
        el.dispatchEvent(ev)
        return ev.defaultPrevented
      }
      fire(src, 'dragstart')
      const over = fire(dst, 'dragover')
      fire(dst, 'drop')
      fire(src, 'dragend')
      return String(over)
    })
    check('(C) drag: dragover prevented (the rAF sample flushed before drop)', drag1 === 'true', String(drag1))
    await page.waitForSelector('.pd-col[data-status="planned"] .pd-task-wrap', { timeout: 15_000 })
    check('(C) drag: the card landed in PLANNED (per-column repaint)', (await page.locator('.pd-col[data-status="planned"] .pd-task-wrap').count()) === 1)
    const gets1 = await boardGets()
    check('(C) FE-1: the reorder did NOT refetch the board', gets1 === bootGets, `board GETs ${bootGets}→${gets1}`)

    // ---- (D) FE-1: the done round-trip — drag planned → done ----
    const drag2 = await page.evaluate(() => {
      const src = document.querySelector('.pd-col[data-status="planned"] .pd-task-wrap')
      const dst = document.querySelector('.pd-col[data-status="done"]')
      if (!src || !dst) return 'missing'
      const dt = new DataTransfer()
      const fire = (el, type) => {
        const r = el.getBoundingClientRect()
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + Math.min(r.height / 2, 120) })
        el.dispatchEvent(ev)
        return ev.defaultPrevented
      }
      fire(src, 'dragstart')
      const over = fire(dst, 'dragover')
      fire(dst, 'drop')
      fire(src, 'dragend')
      return String(over)
    })
    check('(D) done-drag: dragover prevented', drag2 === 'true', String(drag2))
    await page.waitForSelector('.pd-col[data-status="done"] .pd-task-wrap', { timeout: 15_000 })
    check('(D) done-drag: the card landed in DONE (the done lane)', (await page.locator('.pd-col[data-status="done"] .pd-task-wrap').count()) === 1)
    const gets2 = await boardGets()
    check('(D) FE-1: the done flip did NOT refetch the board', gets2 === bootGets, `board GETs ${bootGets}→${gets2}`)
    // the repaint is OPTIMISTIC (FE-1's merge) — the PATCH commits a beat later;
    // poll the server truth until done + done_at land (up to 10 s)
    let doneRow = null
    for (let i = 0; i < 20 && !(doneRow?.status === 'done' && doneRow?.done_at); i++) {
      await new Promise((r) => setTimeout(r, 500))
      const boardAfter = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
      doneRow = boardAfter.json.tasks.find((t) => t.id === t1.json.id)
    }
    check('(D) the server stamped done_at on the done card', doneRow?.status === 'done' && Boolean(doneRow?.done_at), `${doneRow?.status} done_at=${doneRow?.done_at ? 'yes' : 'no'}`)

    // ---- (E) FE-1: sprint quick-add = ONE POST, ZERO board GET ----
    await page.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('#sp-wrap', { timeout: 30_000 })
    await page.click('[data-cat-toggle="none"]')
    await page.waitForTimeout(400)
    const sprintBootGets = await boardGets()
    await page.fill('[data-quickadd="none"]', 'S254 quick-add witness')
    await page.press('[data-quickadd="none"]', 'Enter')
    // POLL for the merged-state render (a fixed sleep raced dev's real latency —
    // the rehearsal lesson; up to 15 s, the first .sp-task with the title wins)
    let rendered = false
    for (let i = 0; i < 30 && !rendered; i++) {
      await page.waitForTimeout(500)
      rendered = (await page.locator('.sp-task', { hasText: 'S254 quick-add witness' }).count()) === 1
    }
    check('(E) the task renders in the sidebar from merged state', rendered)
    const callsAfter = await callCount(/devtasks/)
    const posts = callsAfter.filter((c) => c.method === 'POST')
    check('(E) quick-add: exactly ONE POST devtasks', posts.length === 1, `n=${posts.length}`)
    check('(E) FE-1: the quick-add did NOT reload the board (GET devboard unchanged)', (await boardGets()) === sprintBootGets, `board GETs ${sprintBootGets}→${await boardGets()}`)

    // ---- (F) zero page errors across every surface ----
    check('(F) zero page errors (board + sprint surfaces)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ').slice(0, 200))
  } finally {
    await browser.close()
  }

  // ---------- cleanup: the probe project leaves every view (trash; the 7-day cron purges)
  const del = await api(`/api/projects/${pid}`, 'DELETE', undefined, cookie)
  check('cleanup: probe project soft-deleted', del.status === 200, String(del.status))

  const failed = results.filter((r) => !r.ok)
  console.log(`\nS254 live feel probe (${target}): ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}`)
    process.exit(1)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
