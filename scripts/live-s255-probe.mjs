#!/usr/bin/env node
// scripts/live-s255-probe.mjs — S255 (Phase 4 — payload & network diet) live
// probe: exercises the round's contracts on a DEPLOYED worker (the test account
// on prod / the seeded probe user on dev), inside a disposable probe project
// (soft-deleted at the end; the dev purge sweeps what the cascade cannot reach).
//
//   (A) deploy carriers — the health probe (ok, schema 66) + sw.js VERSION
//       hibana-v462 + every carrier the three pages reference resolves 200;
//   (B) BE-3 — the LEAN board payload: description omitted, the derived
//       doc_checked rides (the planted "- [x] " count), every other column
//       verbatim; the DEFAULT payload keeps description + has no doc_checked;
//       the byte delta default vs lean is RECORDED (the diet measurement);
//   (C) BE-25 — the version-stamp ETag: a matching If-None-Match answers 304
//       with an empty body on BOTH variants; the two never cross-304; a
//       mutation moves the stamp (the old validator gets the fresh 200, the
//       new one 304s again);
//   (D) BE-3 — GET /api/sprints/:id/doc: the FULL row (description round-trips,
//       version + emoji verbatim); a missing id 404s;
//   (E) the browser feel — /kanban + /sprint.html boot on the LEAN payload
//       (exactly ONE board GET and it carries ?lean=1), the sprint chip's ☑
//       stat renders from doc_checked, /project.html's cross-box drag repaint
//       rides the lean board payload (FE-4: the devboard?lean=1 GET fires, NO
//       second full /api/projects/:id refetch), zero page errors.
//
// Usage: node scripts/live-s255-probe.mjs [dev|prod|local]   (default: dev; local =
//        http://127.0.0.1:3017 against `npm run start:node` with a scratch DB)
// Env:   S255_LOGIN + S255_PASS (the test account) — never hardcoded.

import { chromium } from 'playwright'

const target = process.argv[2] || 'dev'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? 'http://127.0.0.1:3017' : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S255_LOGIN
const PASS = process.env.S255_PASS
if (!LOGIN || !PASS) {
  console.error('need S255_LOGIN + S255_PASS in env (the test account)')
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

// A ~60 KB doc: 40 checked lines, 35 unchecked, prose filler to make the bytes real.
const plantedChecked = 40
let docBody = '## The probe plan\n'
for (let i = 1; i <= plantedChecked; i++) docBody += `- [x] checked item ${i} — ${'filler '.repeat(12)}\n`
for (let i = 1; i <= 35; i++) docBody += `- [ ] open item ${i} — ${'filler '.repeat(12)}\n`
docBody += 'Prose paragraph.\n'.repeat(200)

const main = async () => {
  console.log(`S255 live payload-diet probe → ${URL_BASE}`)

  // ---------- (A) the health probe + the SW carrier ----------
  const health = await api('/api/health')
  check('(A) /api/health answers ok', health.status === 200 && health.json?.ok === true, String(health.status))
  check('(A) schema_version is 66', Number(health.json?.schema_version) === 66, `schema_version=${health.json?.schema_version}`)
  const sw = await fetch(`${URL_BASE}/sw.js`).then((r) => r.text())
  check('(A) sw.js carries hibana-v462 (the S255 cache-bust round)', sw.includes('"hibana-v462"'))

  // --- login
  const login = await api('/api/auth/login', 'POST', { login: LOGIN, password: PASS })
  if (login.status !== 200 || !login.cookie) {
    console.error(`login failed: ${login.status} ${JSON.stringify(login.json)}`)
    process.exit(1)
  }
  const cookie = login.cookie.split(';')[0]
  console.log('  signed in')

  // ---------- (A cont.) every carrier the three pages reference resolves ----------
  const assetOk = async (url) => (await fetch(`${URL_BASE}${url}`).then((r) => r.status).catch(() => 0)) === 200
  for (const [path, stems] of [['/kanban', ['board-page', 'devboard']], ['/sprint.html', ['sprint-page']], ['/project.html', ['project-page']]]) {
    const html = await api(path, 'GET', undefined, cookie)
    const text = html.text || ''
    check(`(A) ${path} serves the page`, html.status === 200, String(html.status))
    for (const stem of stems) {
      const wired = text.match(new RegExp(`["'](/dist/${stem}\\.[0-9a-f]{8}\\.js)["']`))
      const plain = text.match(new RegExp(`["'](/js/${stem}\\.js\\?v=\\d+)["']`))
      const ref = wired || plain
      check(`(A) ${path} references ${stem}.js (${wired ? 'wired' : 'plain'})`, Boolean(ref), ref ? ref[1] : 'not found')
      if (ref) check(`(A) ${path}'s ${stem}.js resolves 200`, await assetOk(ref[1]))
    }
  }

  // --- the disposable probe project: a sprint with the heavy doc + tasks
  const proj = await api('/api/projects', 'POST', { title: `S255 diet probe ${new Date().toISOString().slice(0, 10)} (safe to delete)`, status: 'developing' }, cookie)
  check('probe project created', proj.status === 201, String(proj.status))
  const pid = proj.json.id
  const spr = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'Diet Sprint', description: docBody, version: '7.7', emoji: '🥗' }, cookie)
  check('probe sprint created (the heavy doc rides)', spr.status === 201, String(spr.status))
  const sid = spr.json.id
  // the draft must START to render a timeline band (the .sp-sprint strip + its chip)
  const start = await api(`/api/sprints/${sid}/start`, 'POST', undefined, cookie)
  check('probe sprint started (renders on the timeline)', start.status === 200, String(start.status))
  const t1 = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 'S255 probe task', status: 'idea' }, cookie)
  check('probe task created', t1.status === 201, String(t1.status))
  const tid = t1.json.id

  // ---------- (B) the lean payload + the diet measurement ----------
  const def = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
  const lean = await api(`/api/projects/${pid}/devboard?lean=1`, 'GET', undefined, cookie)
  check('(B) default payload: description present, doc_checked ABSENT', typeof def.json.sprints[0].description === 'string' && !('doc_checked' in def.json.sprints[0]))
  check('(B) lean payload: description OMITTED', !('description' in lean.json.sprints[0]))
  check(`(B) lean payload: doc_checked = ${plantedChecked} (the planted "- [x] " count)`, lean.json.sprints[0].doc_checked === plantedChecked, `got ${lean.json.sprints[0].doc_checked}`)
  check('(B) lean payload: every other column verbatim', lean.json.sprints[0].name === 'Diet Sprint' && lean.json.sprints[0].version === '7.7' && lean.json.sprints[0].emoji === '🥗')
  const saved = def.bytes - lean.bytes
  check('(B) the diet measurement: lean saves bytes on this project', saved > 0, `default ${def.bytes}B vs lean ${lean.bytes}B — saved ${saved}B (${Math.round((saved / def.bytes) * 100)}%)`)

  // ---------- (C) the version-stamp ETag ----------
  check('(C) both variants carry a stamp ETag', Boolean(def.etag && lean.etag), `default ${def.etag} · lean ${lean.etag}`)
  check('(C) the lean and default validators differ (no cross-304)', def.etag !== lean.etag)
  const hitDef = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie, { 'If-None-Match': def.etag })
  check('(C) default: a matching If-None-Match → 304 empty', hitDef.status === 304 && hitDef.bytes === 0)
  const hitLean = await api(`/api/projects/${pid}/devboard?lean=1`, 'GET', undefined, cookie, { 'If-None-Match': lean.etag })
  check('(C) lean: a matching If-None-Match → 304 empty', hitLean.status === 304 && hitLean.bytes === 0)
  const cross = await api(`/api/projects/${pid}/devboard?lean=1`, 'GET', undefined, cookie, { 'If-None-Match': def.etag })
  check('(C) the default validator does NOT satisfy a lean poll', cross.status === 200)
  const fresh = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
  check('(C) a NON-conditional GET never 304s (RequestFresh contract)', fresh.status === 200)
  const moved = await api(`/api/devtasks/${tid}`, 'PATCH', { priority: 'urgent' }, cookie)
  check('(C) mutation applied (task PATCH)', moved.status === 200, String(moved.status))
  const after = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie, { 'If-None-Match': def.etag })
  check('(C) the mutation MOVED the stamp — the old validator gets the fresh 200', after.status === 200)
  const rehit = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie, { 'If-None-Match': after.etag })
  check('(C) the new validator 304s again (the round is stable)', rehit.status === 304)

  // ---------- (D) the doc endpoint ----------
  const doc = await api(`/api/sprints/${sid}/doc`, 'GET', undefined, cookie)
  check('(D) GET /api/sprints/:id/doc returns the FULL row', doc.status === 200 && doc.json.description === docBody && doc.json.version === '7.7' && doc.json.emoji === '🥗', `${doc.status}, ${doc.json?.description?.length ?? 0} chars`)
  const missing = await api('/api/sprints/nope/doc', 'GET', undefined, cookie)
  check('(D) a missing sprint id 404s (never a 500)', missing.status === 404, String(missing.status))

  // ---------- (E) the browser feel ----------
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
    // ---- /kanban boots on the LEAN payload ----
    await page.goto(`${URL_BASE}/kanban?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.pd-task-wrap', { timeout: 30_000 })
    const kanCalls = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url)))
    check('(E) /kanban: exactly ONE board GET', kanCalls.filter((c) => c.method === 'GET').length === 1, `n=${kanCalls.length}`)
    check('(E) /kanban: the board GET rides ?lean=1', kanCalls.every((c) => /lean=1/.test(c.url)), kanCalls[0]?.url)

    // ---- /sprint.html boots on the LEAN payload + the ☑ stat renders from doc_checked ----
    await page.goto(`${URL_BASE}/sprint.html?project=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.sp-sprint', { timeout: 30_000 })
    const sprCalls = await page.evaluate(() => window.__apiCalls.filter((c) => /\/devboard/.test(c.url)))
    check('(E) /sprint.html: exactly ONE board GET', sprCalls.filter((c) => c.method === 'GET').length === 1, `n=${sprCalls.length}`)
    check('(E) /sprint.html: the board GET rides ?lean=1', sprCalls.every((c) => /lean=1/.test(c.url)), sprCalls[0]?.url)
    const chipText = await page.evaluate(() => {
      const chip = document.querySelector('.sp-sprint-chip')
      return chip ? chip.textContent : ''
    })
    check(`(E) the sprint chip's ☑ stat renders ${plantedChecked} from doc_checked (no description shipped)`, new RegExp(`☑ ${plantedChecked}`).test(chipText), chipText.trim().slice(0, 80))

    // ---- /project.html: FE-4 — the cross-box repaint rides the lean board payload ----
    await page.goto(`${URL_BASE}/project.html?id=${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.pd-task-wrap', { timeout: 30_000 })
    const beforeRepaint = await page.evaluate(() => window.__apiCalls.filter((c) => c.method === 'GET').map((c) => c.url))
    const detailBoots = beforeRepaint.filter((u) => new RegExp(`/api/projects/${pid}$`).test(u)).length
    check('(E) /project.html: the boot detail GET happened (the page contract)', detailBoots >= 1, `n=${detailBoots}`)
    const drop = await page.evaluate((projectId) => {
      // the drag contract: dragstart fires on the INNER .pd-task (draggable=true);
      // the wrap (data-pd-task/data-pd-status) is what the handler carries. The
      // drop target must sit inside the destination .pd-col (the handler resolves
      // the column through e.target.closest('#pd-board .pd-col')).
      const card = document.querySelector('#pd-board [data-pd-tasks="idea"] .pd-task')
      const dst = document.querySelector('#pd-board [data-pd-tasks="planned"]')
      if (!card || !dst) return 'missing'
      const dt = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return 'dropped'
    }, pid)
    check('(E) FE-4: the synthetic cross-box drop fired', drop === 'dropped', drop)
    await page.waitForTimeout(2500) // the PATCH + the repaint's lean GET
    const calls = await page.evaluate(() => window.__apiCalls)
    const leanRepaint = calls.filter((c) => c.method === 'GET' && new RegExp(`/api/projects/${pid}/devboard\\?lean=1$`).test(c.url))
    check('(E) FE-4: the repaint fired the LEAN board GET', leanRepaint.length === 1, `n=${leanRepaint.length}`)
    const detailAfter = calls.filter((c) => c.method === 'GET' && new RegExp(`/api/projects/${pid}$`).test(c.url))
    check('(E) FE-4: NO second full detail refetch (the 13-query pull is retired)', detailAfter.length === detailBoots, `boot ${detailBoots} → after ${detailAfter.length}`)
    const landed = await page.evaluate(() => Boolean(document.querySelector('[data-pd-tasks="planned"] .pd-task-wrap')))
    check('(E) FE-4: the card landed in the planned box', landed)

    check('(E) zero page errors across all three surfaces', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
  }

  // --- cleanup: soft-delete the probe project (trash; the 7-day cron purges)
  const del = await api(`/api/projects/${pid}`, 'DELETE', undefined, cookie)
  check('probe project soft-deleted (trash)', del.status === 200, String(del.status))

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${failed === 0 ? 'ALL ' + results.length + ' CHECKS GREEN' : failed + ' CHECKS FAILED (of ' + results.length + ')'}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
