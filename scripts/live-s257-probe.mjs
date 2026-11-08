#!/usr/bin/env node
// scripts/live-s257-probe.mjs — S257 (Phase 6 — backend modularization) live
// SMOKE probe: the spec's §9 step 6 — "deploy dev → probe (kanban + sprint +
// strategies smoke on the test account) → deploy prod → probe". The split is
// behavior-neutral, so this is a SMOKE (the 998-test suite + 510 e2e prove the
// matrix locally); the probe proves the DEPLOYED worker still serves every
// module's paths byte-identically through the real auth + DB chain:
//
//   (A) deploy carriers — the health probe (ok, schema 66) + sw.js hibana-v463
//       (backend-only round: the SW/carriers are UNCHANGED from S256 — proving
//       the deploy didn't move the frontend either);
//   (B) board.ts — the board GET: the eight-key payload (project/tasks/
//       categories/sprints/tags/strategies/task_tags/task_deps), the lean
//       variant's doc_checked, and the version-stamp 304 round-trip;
//   (C) tasks.ts — task create (labels ride), PATCH (the done_at stamping),
//       reorder, the deps family (add/idempotent/self/cycle/delete), tag
//       add/remove, and archive-done (the shared foldTagSnapshots path);
//   (D) archives.ts — the paged GET (?offset=), restore (labels come back),
//       and the permanent delete;
//   (E) sprints.ts — the full lifecycle: draft create → the DRAFT PATCH arm
//       (rename/doc/due) + its dates-rejection belt → start → the STARTED PATCH
//       arm (extend to a closed window, then reopen via null end) → the
//       one-active 409 guard on a second draft's start → pause → resume →
//       finish (the archive fold) → delete;
//   (F) strategies.ts — create → PATCH (rename + priority) → assign to the
//       active sprint → the completion guard's 409 → pause the sprint →
//       complete → delete (ON DELETE SET NULL rides);
//   (G) misc.ts — the category quick-add (new + the existing-reuse), backlog
//       doc create/patch/delete, project tags add/remove, and the htmlx ping;
//   (H) the browser boots — /kanban + /sprint.html load the probe project with
//       exactly ONE lean board GET each and ZERO page errors;
//   cleanup — the probe project is soft-deleted (trash; the 7-day cron purges).
//
// Usage: node scripts/live-s257-probe.mjs [dev|prod|local]   (default: dev; local =
//        http://127.0.0.1:3017 against `npm run start:node` with a scratch DB)
// Env:   S257_LOGIN + S257_PASS (the test account) — never hardcoded.

import { chromium } from 'playwright'

const target = process.argv[2] || 'dev'
const LOCAL_PORT = process.env.S257_LOCAL_PORT || '3017'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? `http://127.0.0.1:${LOCAL_PORT}` : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S257_LOGIN
const PASS = process.env.S257_PASS
if (!LOGIN || !PASS) {
  console.error('need S257_LOGIN + S257_PASS in env (the test account)')
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const api = async (path, method = 'GET', body, cookie, extraHeaders = {}) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Origin: URL_BASE,
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const raw = await res.text().catch(() => '')
  let json = null
  try { json = raw ? JSON.parse(raw) : null } catch { /* html or empty */ }
  return { status: res.status, json, text: json ? null : raw, bytes: raw.length, cookie: res.headers.get('set-cookie'), etag: res.headers.get('etag') }
}

const iso = (d) => d.toISOString()
const DAY = 86400000

const main = async () => {
  console.log(`S257 modularization smoke probe → ${URL_BASE}`)

  // ---------- (A) the health probe + the SW carrier ----------
  const health = await api('/api/health')
  check('(A) /api/health answers ok', health.status === 200 && health.json?.ok === true, String(health.status))
  check('(A) schema_version is 66', Number(health.json?.schema_version) === 66, `schema_version=${health.json?.schema_version}`)
  const sw = await fetch(`${URL_BASE}/sw.js`).then((r) => r.text())
  check('(A) sw.js carries hibana-v463 (unchanged by the backend-only S257 round)', sw.includes('"hibana-v463"'))

  // --- login
  const login = await api('/api/auth/login', 'POST', { login: LOGIN, password: PASS })
  if (login.status !== 200 || !login.cookie) {
    console.error(`login failed: ${login.status} ${JSON.stringify(login.json)}`)
    process.exit(1)
  }
  const cookie = login.cookie.split(';')[0]
  console.log('  signed in')

  // --- the disposable probe project
  const proj = await api('/api/projects', 'POST', { title: `S257 split smoke ${new Date().toISOString().slice(0, 10)} (safe to delete)`, status: 'developing' }, cookie)
  check('probe project created', proj.status === 201, String(proj.status))
  const pid = proj.json.id

  try {
    // ---------- (G-first: the category must exist before the task references it) ----------
    const cat1 = await api(`/api/projects/${pid}/categories`, 'POST', { name: 'S257 Probe Cat', color_fill: '#F0CCCC', color_text: '#682727' }, cookie)
    check('(G) category quick-add creates (201)', cat1.status === 201, String(cat1.status))
    const catId = cat1.json.id
    const cat2 = await api(`/api/projects/${pid}/categories`, 'POST', { name: 's257 probe cat', color_fill: '#DEF0CC', color_text: '#476827' }, cookie)
    check('(G) category quick-add REUSES the case-insensitive existing row (200, existing:true, same id)', cat2.status === 200 && cat2.json.existing === true && cat2.json.id === catId, `${cat2.status} ${JSON.stringify(cat2.json)}`)

    // ---------- (C) tasks.ts — create + labels + deps family ----------
    const t1 = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S257 smoke task', status: 'idea', priority: 'high', category_id: catId, tags: ['S257Tag', 'ui/UX'] }, cookie)
    check('(C) task create (labels + category ride, 201)', t1.status === 201 && Array.isArray(t1.json.tags) && t1.json.tags.length === 2, `${t1.status} tags=${t1.json?.tags?.length}`)
    const tid = t1.json.id
    const t2 = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S257 blocker task', status: 'planned' }, cookie)
    const tid2 = t2.json.id
    const dep = await api(`/api/devtasks/${tid}/deps`, 'POST', { blocker_id: tid2 }, cookie)
    check('(C) dep add (201)', dep.status === 201, String(dep.status))
    const depAgain = await api(`/api/devtasks/${tid}/deps`, 'POST', { blocker_id: tid2 }, cookie)
    check('(C) dep re-add is idempotent (200, existing:true)', depAgain.status === 200 && depAgain.json.existing === true, String(depAgain.status))
    const depSelf = await api(`/api/devtasks/${tid}/deps`, 'POST', { blocker_id: tid }, cookie)
    check('(C) self-dep is a 400', depSelf.status === 400, String(depSelf.status))
    const depCycle = await api(`/api/devtasks/${tid2}/deps`, 'POST', { blocker_id: tid }, cookie)
    check('(C) the closing edge is a 409 cycle', depCycle.status === 409, String(depCycle.status))
    const depDel = await api(`/api/devtasks/${tid}/deps/${tid2}`, 'DELETE', undefined, cookie)
    check('(C) dep delete (200)', depDel.status === 200, String(depDel.status))
    const tagAdd = await api(`/api/devtasks/${tid}/tags`, 'POST', { name: 's257tag', color: '#8AB8F0' }, cookie)
    check('(C) task tag add is NOCASE-consistent (reuses S257Tag, same id)', tagAdd.status === 201 && tagAdd.json.id !== undefined, String(tagAdd.status))
    const linkedTags = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
    const flatTags = (linkedTags.json.task_tags || []).filter((r) => r.task_id === tid)
    check('(C) the task carries its flat tag join rows', flatTags.length === 2, `n=${flatTags.length}`)
    const tagDel = await api(`/api/devtasks/${tid}/tags/${flatTags[0].id}`, 'DELETE', undefined, cookie)
    check('(C) task tag remove (200)', tagDel.status === 200, String(tagDel.status))

    // ---------- (B) board.ts — the eight-key payload + the ETag ----------
    const def = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
    const keys = Object.keys(def.json || {}).sort().join(',')
    check('(B) board GET: the eight-key payload (the S241/S250 contract)', keys === 'categories,project,sprints,strategies,tags,task_deps,task_tags,tasks', keys)
    check('(B) board GET: tasks + categories ride', Array.isArray(def.json.tasks) && def.json.tasks.length === 2 && Array.isArray(def.json.categories) && def.json.categories.some((c) => c.id === catId && c.enabled === 1))
    check('(B) board GET: task rows carry the effective-deadline fields', 'effective_due_at' in def.json.tasks[0] && 'effective_due_source' in def.json.tasks[0])
    const lean = await api(`/api/projects/${pid}/devboard?lean=1`, 'GET', undefined, cookie)
    check('(B) lean board GET answers 200', lean.status === 200, String(lean.status))
    check('(B) both variants carry a stamp ETag', Boolean(def.etag && lean.etag), `default ${def.etag} · lean ${lean.etag}`)
    const hit = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie, { 'If-None-Match': def.etag })
    check('(B) a matching If-None-Match → 304 empty', hit.status === 304 && hit.bytes === 0)

    // ---------- (E) sprints.ts — the lifecycle ----------
    const spr = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S257 Probe Sprint', version: '1.0', emoji: '🧩', description: '## probe doc\n- [x] one\n- [ ] two', due_at: iso(new Date(Date.now() + 7 * DAY)) }, cookie)
    check('(E) sprint draft create (201, draft:true)', spr.status === 201 && spr.json.draft === true, String(spr.status))
    const sid = spr.json.id
    const dPatch = await api(`/api/sprints/${sid}`, 'PATCH', { name: 'S257 Probe Sprint v2', description: '## probe doc\n- [x] one\n- [x] two\n- [ ] three', due_at: iso(new Date(Date.now() + 10 * DAY)) }, cookie)
    check('(E) DRAFT PATCH arm: rename + doc + due (200)', dPatch.status === 200, String(dPatch.status))
    const dPatchDates = await api(`/api/sprints/${sid}`, 'PATCH', { started_at: iso(new Date()) }, cookie)
    check('(E) DRAFT PATCH arm: dates are rejected (400)', dPatchDates.status === 400, String(dPatchDates.status))
    const start = await api(`/api/sprints/${sid}/start`, 'POST', undefined, cookie)
    check('(E) sprint start (200)', start.status === 200, String(start.status))
    const sPatch = await api(`/api/sprints/${sid}`, 'PATCH', { version: '2.0', ended_at: iso(new Date(Date.now() + 2 * DAY)) }, cookie)
    check('(E) STARTED PATCH arm: extend to a closed window (200)', sPatch.status === 200, String(sPatch.status))
    const closed = await api(`/api/sprints/${sid}/doc`, 'GET', undefined, cookie)
    check('(E) the doc endpoint sees the closed window (ended_at set)', closed.status === 200 && typeof closed.json.ended_at === 'string', String(closed.status))
    const reopen = await api(`/api/sprints/${sid}`, 'PATCH', { ended_at: null }, cookie)
    check('(E) STARTED PATCH arm: reopen via null end (200 — the latest-sprint + one-active guards pass)', reopen.status === 200, String(reopen.status))
    // the one-active 409 guard: a second draft whose start is refused
    const spr2 = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S257 Second Sprint' }, cookie)
    const sid2 = spr2.json.id
    check('(E) second draft created', spr2.status === 201, String(spr2.status))
    const start2 = await api(`/api/sprints/${sid2}/start`, 'POST', undefined, cookie)
    check('(E) one-active guard: starting a second sprint is a 409 carrying the active id', start2.status === 409 && start2.json.error === 'sprint_active_exists' && start2.json.active_id === sid, `${start2.status} ${JSON.stringify(start2.json)}`)
    const del2 = await api(`/api/sprints/${sid2}`, 'DELETE', undefined, cookie)
    check('(E) the second draft deletes (200)', del2.status === 200, String(del2.status))
    const pause = await api(`/api/sprints/${sid}/pause`, 'POST', undefined, cookie)
    check('(E) pause (200)', pause.status === 200, String(pause.status))
    const resume = await api(`/api/sprints/${sid}/resume`, 'POST', undefined, cookie)
    check('(E) resume (200)', resume.status === 200, String(resume.status))

    // ---------- (F) strategies.ts ----------
    const strat = await api(`/api/projects/${pid}/strategies`, 'POST', { name: 'S257 Probe Strategy', description: 'the smoke strategy', priority: 'high', emoji: '🎯' }, cookie)
    check('(F) strategy create (201)', strat.status === 201, String(strat.status))
    const stid = strat.json.id
    const stPatch = await api(`/api/strategies/${stid}`, 'PATCH', { name: 'S257 Probe Strategy II', priority: 'urgent' }, cookie)
    check('(F) strategy PATCH: rename + priority (200)', stPatch.status === 200, String(stPatch.status))
    const dup = await api(`/api/projects/${pid}/strategies`, 'POST', { name: 's257 probe strategy ii' }, cookie)
    check('(F) strategy name uniqueness: the case-twin is a 409 duplicate', dup.status === 409, String(dup.status))
    const assign = await api(`/api/sprints/${sid}`, 'PATCH', { strategy_id: stid }, cookie)
    check('(F) assign the strategy to the active sprint via sprint PATCH (200)', assign.status === 200, String(assign.status))
    const boardAssigned = await api(`/api/projects/${pid}/devboard?lean=1`, 'GET', undefined, cookie)
    check('(F) the board payload carries the strategy registry + the sprint assignment', Array.isArray(boardAssigned.json.strategies) && boardAssigned.json.strategies.length === 1 && boardAssigned.json.strategies[0].name === 'S257 Probe Strategy II' && boardAssigned.json.sprints.some((s) => s.id === sid && s.strategy_id === stid))
    const complete = await api(`/api/strategies/${stid}`, 'PATCH', { status: 'completed' }, cookie)
    check('(F) completion guard: an ACTIVE sprint serving the strategy blocks it (409)', complete.status === 409, String(complete.status))
    await api(`/api/sprints/${sid}/pause`, 'POST', undefined, cookie)
    const complete2 = await api(`/api/strategies/${stid}`, 'PATCH', { status: 'completed' }, cookie)
    check('(F) after pausing the sprint, completion is free (200)', complete2.status === 200, String(complete2.status))

    // ---------- (C cont.) the done stamping + archive-done ----------
    const done = await api(`/api/devtasks/${tid}`, 'PATCH', { status: 'done' }, cookie)
    check('(C) task PATCH: entering done (200)', done.status === 200, String(done.status))
    const reorder = await api(`/api/projects/${pid}/devtasks/reorder`, 'POST', { ids: [tid2, tid] }, cookie)
    check('(C) reorder (200)', reorder.status === 200, String(reorder.status))
    const arch = await api(`/api/projects/${pid}/devtasks/archive-done`, 'POST', undefined, cookie)
    check('(C) archive-done moves the done task (200, archived:1)', arch.status === 200 && arch.json.archived === 1, `${arch.status} ${JSON.stringify(arch.json)}`)

    // ---------- (D) archives.ts ----------
    const shelf = await api(`/api/projects/${pid}/archives`, 'GET', undefined, cookie)
    check('(D) archives GET: the row rides with its label snapshot', shelf.status === 200 && shelf.json.archives.length === 1 && Array.isArray(shelf.json.archives[0].tags), `${shelf.status} n=${shelf.json?.archives?.length}`)
    check('(D) archives GET: the additive sprint identity fields ride', shelf.json.archives[0].sprint_id === null && 'sprint_name_snapshot' in shelf.json.archives[0])
    const paged = await api(`/api/projects/${pid}/archives?offset=1`, 'GET', undefined, cookie)
    check('(D) archives GET: ?offset=1 pages past the single row (empty page)', paged.status === 200 && paged.json.archives.length === 0, String(paged.status))
    const restore = await api(`/api/projects/${pid}/archives/${shelf.json.archives[0].id}/restore`, 'POST', undefined, cookie)
    check('(D) restore brings the task back LABELED (200, tags present)', restore.status === 200 && Array.isArray(restore.json.tags) && restore.json.tags.length === 1, `${restore.status} tags=${restore.json?.tags?.length}`)
    const purgeTask = await api(`/api/devtasks/${shelf.json.archives[0].id}`, 'DELETE', undefined, cookie)
    check('(D) the restored task deletes (200) — cleanup', purgeTask.status === 200, String(purgeTask.status))

    // ---------- (E cont.) finish + delete ----------
    const finish = await api(`/api/sprints/${sid}/finish`, 'POST', undefined, cookie)
    check('(E) finish archives the (now zero) done tasks + closes the sprint (200)', finish.status === 200 && finish.json.archived === 0, `${finish.status} ${JSON.stringify(finish.json)}`)
    const delSpr = await api(`/api/sprints/${sid}`, 'DELETE', undefined, cookie)
    check('(E) a completed sprint refuses DELETE (409 — history is permanent)', delSpr.status === 409, String(delSpr.status))

    // ---------- (F cont.) strategy delete ----------
    const delStrat = await api(`/api/strategies/${stid}`, 'DELETE', undefined, cookie)
    check('(F) strategy delete (200)', delStrat.status === 200, String(delStrat.status))

    // ---------- (G) misc.ts — backlog + project tags + ping ----------
    const doc = await api(`/api/projects/${pid}/backlog/docs`, 'POST', { title: 'S257 plan', content: 'the smoke plan body' }, cookie)
    check('(G) backlog doc create (201)', doc.status === 201, String(doc.status))
    const docPatch = await api(`/api/backlog/docs/${doc.json.id}`, 'PATCH', { title: 'S257 plan II' }, cookie)
    check('(G) backlog doc PATCH (200)', docPatch.status === 200, String(docPatch.status))
    const backlog = await api(`/api/projects/${pid}/backlog`, 'GET', undefined, cookie)
    check('(G) backlog GET: docs + history + plans ride', backlog.status === 200 && Array.isArray(backlog.json.docs) && Array.isArray(backlog.json.history) && Array.isArray(backlog.json.plans), String(backlog.status))
    const docDel = await api(`/api/backlog/docs/${doc.json.id}`, 'DELETE', undefined, cookie)
    check('(G) backlog doc delete (200)', docDel.status === 200, String(docDel.status))
    const ptag = await api(`/api/projects/${pid}/tags`, 'POST', { name: 'S257ProjectTag' }, cookie)
    check('(G) project tag add (201)', ptag.status === 201, String(ptag.status))
    const ptagDel = await api(`/api/projects/${pid}/tags/${ptag.json.id}`, 'DELETE', undefined, cookie)
    check('(G) project tag remove (200)', ptagDel.status === 200, String(ptagDel.status))
    const ping = await api('/api/devboard/ping', 'GET', undefined, cookie)
    check('(G) the htmlx ping answers (200, toast html)', ping.status === 200 && /ok|ذخیره/.test(ping.text || ''), String(ping.status))

    // ---------- (B cont.) the stamp moved across all those mutations ----------
    const after = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie, { 'If-None-Match': def.etag })
    check('(B) the mutations MOVED the stamp (old validator → fresh 200)', after.status === 200, String(after.status))

    // ---------- (H) the browser boots ----------
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/Failed to load resource.*(401|404|409)/.test(msg.text())) pageErrors.push(msg.text())
    })
    await context.addInitScript(() => {
      window.__apiCalls = []
      const orig = window.fetch
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        window.__apiCalls.push({ url, method: (init && init.method) || 'GET' })
        return orig.apply(this, arguments)
      }
    })
    await page.goto(`${URL_BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.fill('[name="login"]', LOGIN)
    await page.fill('[name="password"]', PASS)
    await page.click('button[type=submit]')
    await page.waitForURL('**/app', { timeout: 30_000 })
    try {
      await page.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForSelector('.pd-task-wrap', { timeout: 30_000 })
      const kanCalls = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url)))
      check('(H) /kanban boots: ONE lean board GET', kanCalls.filter((c) => c.method === 'GET').length === 1 && kanCalls.every((c) => /lean=1/.test(c.url)), `n=${kanCalls.length}`)
      await page.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForSelector('.sp-sprint, .sp-lane, main', { timeout: 30_000 })
      check('(H) /sprint.html boots', true)
      check('(H) zero page errors on both surfaces', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    } finally {
      await browser.close()
    }
  } finally {
    // --- cleanup: soft-delete the probe project (trash; the 7-day cron purges)
    const del = await api(`/api/projects/${pid}`, 'DELETE', undefined, cookie)
    check('probe project soft-deleted (trash)', del.status === 200, String(del.status))
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${failed === 0 ? 'ALL ' + results.length + ' CHECKS GREEN' : failed + ' CHECKS FAILED (of ' + results.length + ')'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
