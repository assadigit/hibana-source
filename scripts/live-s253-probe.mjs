#!/usr/bin/env node
// scripts/live-s253-probe.mjs — S253 (Phase 2 — database health, migration 0067) live
// functional probe, the S252 pattern: exercises the round's flows on a DEPLOYED
// worker through the REAL authenticated API (the owner's test account on prod; the
// seeded probe user on dev — scripts/live-s253-devseed.mjs), inside a disposable
// probe project (soft-deleted at the end; the dev purge sweeps what the cascade
// cannot reach).
//
//   (0) the health probe reports schema_version 66 (0067 applied to the live D1);
//   (1) DB-2/BE-8 belts — the 409 codes the catch-and-map maps TO are the ones a
//       racing client actually receives: duplicate sprint name (case-fold) → 409
//       duplicate, second draft → 409 draft_exists, strategy name twin → 409
//       duplicate — create + rename for both tiers, then clean deletes;
//   (2) BE-1 — setTaskTags batching: a tagged task save returns the same shape and
//       resolves a case variant onto the SAME tag row (no fork);
//   (3) BE-5b — archives GET: default page, ?offset= paging, bad offset → 400.
//
// Usage: node scripts/live-s253-probe.mjs [dev|prod|local]   (default: dev; local =
//        http://127.0.0.1:3017 against `npm run start:node` with a scratch DB)
// Env:   S253_LOGIN + S253_PASS (the test account) — never hardcoded.

import { randomUUID } from 'node:crypto'

const target = process.argv[2] || 'dev'
// local: 127.0.0.1, never `localhost` — some sandboxes resolve it to ::1 while the
// node server binds IPv4 only, and the probe dies with a spurious ECONNREFUSED.
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : target === 'local' ? 'http://127.0.0.1:3017' : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S253_LOGIN
const PASS = process.env.S253_PASS
if (!LOGIN || !PASS) {
  console.error('need S253_LOGIN + S253_PASS in env (the test account)')
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
  let json = null
  try { json = await res.json() } catch { /* html or empty */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie') }
}

const main = async () => {
  console.log(`S253 live probe → ${URL_BASE}`)

  // ---------- (0) the health probe carries schema_version 66 ----------
  const health = await api('/api/health')
  check('(0) /api/health answers', health.status === 200, String(health.status))
  check('(0) schema_version is 66 (0067 live on this D1)', Number(health.json?.schema_version) === 66, `schema_version=${health.json?.schema_version}`)

  // --- login
  const login = await api('/api/auth/login', 'POST', { login: LOGIN, password: PASS })
  if (login.status !== 200 || !login.cookie) {
    console.error(`login failed: ${login.status} ${JSON.stringify(login.json)}`)
    process.exit(1)
  }
  const cookie = login.cookie.split(';')[0]
  console.log('  signed in')

  // --- the disposable probe project
  const proj = await api('/api/projects', 'POST', { title: `S253 probe ${new Date().toISOString().slice(0, 10)} (safe to delete)` }, cookie)
  check('probe project created', proj.status === 201, String(proj.status))
  const pid = proj.json.id

  // ---------- (1) the sprint belt: create / duplicate / draft / rename / delete ----------
  const uniq = randomUUID().slice(0, 6)
  const s1 = await api(`/api/projects/${pid}/sprints`, 'POST', { name: `S253 Alpha ${uniq}`, started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' }, cookie)
  check('(1) sprint create (dated) → 201', s1.status === 201, String(s1.status))

  const dupCreate = await api(`/api/projects/${pid}/sprints`, 'POST', { name: `s253 alpha ${uniq} `, started_at: '2026-04-01T00:00:00.000Z', ended_at: '2026-04-30T00:00:00.000Z' }, cookie)
  check('(1) case-fold duplicate sprint CREATE → 409 duplicate', dupCreate.status === 409 && dupCreate.json?.error === 'duplicate', `${dupCreate.status} ${dupCreate.json?.error}`)

  const draft = await api(`/api/projects/${pid}/sprints`, 'POST', { name: `S253 Draft ${uniq}` }, cookie)
  check('(1) draft sprint created → 201 draft:true', draft.status === 201 && draft.json?.draft === true, String(draft.status))
  const draft2 = await api(`/api/projects/${pid}/sprints`, 'POST', { name: `S253 Second ${uniq}` }, cookie)
  check('(1) second draft → 409 draft_exists (+draft_id)', draft2.status === 409 && draft2.json?.error === 'draft_exists' && Boolean(draft2.json?.draft_id), `${draft2.status} ${draft2.json?.error}`)

  const renameOk = await api(`/api/sprints/${s1.json.id}`, 'PATCH', { name: `S253 Renamed ${uniq}` }, cookie)
  check('(1) sprint RENAME → 200', renameOk.status === 200, String(renameOk.status))
  const dupRename = await api(`/api/sprints/${draft.json.id}`, 'PATCH', { name: `S253 RENAMED ${uniq}` }, cookie)
  check('(1) case-fold duplicate sprint RENAME → 409 duplicate', dupRename.status === 409 && dupRename.json?.error === 'duplicate', `${dupRename.status} ${dupRename.json?.error}`)

  // ---------- (1b) the strategy belt: create / duplicate / rename / delete ----------
  const st1 = await api(`/api/projects/${pid}/strategies`, 'POST', { name: `Growth ${uniq}` }, cookie)
  check('(1) strategy create → 201', st1.status === 201, String(st1.status))
  const stDup = await api(`/api/projects/${pid}/strategies`, 'POST', { name: `growth ${uniq}` }, cookie)
  check('(1) case-fold duplicate strategy CREATE → 409 duplicate', stDup.status === 409 && stDup.json?.error === 'duplicate', `${stDup.status} ${stDup.json?.error}`)
  const st2 = await api(`/api/projects/${pid}/strategies`, 'POST', { name: `Retention ${uniq}` }, cookie)
  const stRename = await api(`/api/strategies/${st2.json.id}`, 'PATCH', { name: `GROWTH ${uniq}` }, cookie)
  check('(1) case-fold duplicate strategy RENAME → 409 duplicate', stRename.status === 409 && stRename.json?.error === 'duplicate', `${stRename.status} ${stRename.json?.error}`)
  const stDel = await api(`/api/strategies/${st2.json.id}`, 'DELETE', undefined, cookie)
  check('(1) strategy delete → 200', stDel.status === 200, String(stDel.status))

  // ---------- (2) BE-1: the batched setTaskTags keeps the shape + NOCASE reuse ----------
  const tagBase = `s253-${uniq}`
  const task = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 's253 probe task', status: 'planned', tags: [tagBase, 'Security'] }, cookie)
  check('(2) tagged task create → 201', task.status === 201, String(task.status))
  const patch = await api(`/api/devtasks/${task.json.id}`, 'PATCH', { tags: [tagBase.toUpperCase(), 'Fresh One'] }, cookie)
  const patchTags = patch.json?.tags
  check('(2) tag PATCH → 200 {ok, tags:[…]} shape', patch.status === 200 && patch.json?.ok === true && Array.isArray(patchTags) && patchTags.length === 2, `${patch.status} n=${patchTags?.length}`)
  const boardTags = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
  const boardRow = boardTags.json.tasks.find((t) => t.id === task.json.id)
  const boardTagIds = (boardRow?.tags ?? []).slice().sort().join(',')
  const patchTagIds = patchTags.map((t) => t.id).sort().join(',')
  check('(2) the board payload agrees with the PATCH response (same link set)', boardTagIds === patchTagIds, `${boardTagIds} vs ${patchTagIds}`)
  const tagRows = boardTags.json.tags.filter((t) => t.name.toLowerCase() === tagBase)
  check('(2) NOCASE reuse — one tag row for both spellings', tagRows.length === 1, String(tagRows.length))

  // ---------- (3) BE-5b: the archives cap + additive offset ----------
  const arch1 = await api(`/api/projects/${pid}/archives`, 'GET', undefined, cookie)
  check('(3) archives GET (default) → 200 [] shape', arch1.status === 200 && Array.isArray(arch1.json?.archives), `${arch1.status} n=${arch1.json?.archives?.length}`)
  const archOff = await api(`/api/projects/${pid}/archives?offset=0`, 'GET', undefined, cookie)
  check('(3) archives ?offset=0 = the default page', archOff.status === 200 && JSON.stringify(archOff.json?.archives) === JSON.stringify(arch1.json?.archives))
  const archFar = await api(`/api/projects/${pid}/archives?offset=500`, 'GET', undefined, cookie)
  check('(3) archives ?offset=500 → 200 empty page', archFar.status === 200 && archFar.json?.archives?.length === 0)
  const archBad = await api(`/api/projects/${pid}/archives?offset=abc`, 'GET', undefined, cookie)
  check('(3) archives ?offset=abc → 400 invalid_input', archBad.status === 400 && archBad.json?.error === 'invalid_input', `${archBad.status} ${archBad.json?.error}`)

  // ---------- sprint deletes: planned deletes clean; completed is protected history ----------
  // (S240 §6: deleting a COMPLETED sprint is a 409 sprint_completed — history never
  // goes away; the belt round's delete lane is the PLANNED/paused one. The DB-1
  // re-point UPDATE rides every successful delete.)
  const delDraft = await api(`/api/sprints/${draft.json.id}`, 'DELETE', undefined, cookie)
  check('(1) PLANNED sprint delete → 200 (the DB-1 re-point path rode the new index)', delDraft.status === 200, String(delDraft.status))
  const delCompleted = await api(`/api/sprints/${s1.json.id}`, 'DELETE', undefined, cookie)
  check('(1) COMPLETED sprint delete → 409 sprint_completed (protected history)', delCompleted.status === 409 && delCompleted.json?.error === 'sprint_completed', `${delCompleted.status} ${delCompleted.json?.error}`)

  // ---------- cleanup: the probe project leaves every view (trash; the 7-day cron purges)
  const del = await api(`/api/projects/${pid}`, 'DELETE', undefined, cookie)
  check('cleanup: probe project soft-deleted', del.status === 200, String(del.status))

  const failed = results.filter((r) => !r.ok)
  console.log(`\nS253 live probe (${target}): ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}`)
    process.exit(1)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
