#!/usr/bin/env node
// scripts/live-s252-probe.mjs — S252 (Phase 1 — the correctness & safety pack) live
// functional probe, the S41/S43 pattern: exercises the three fixed flows on a
// DEPLOYED worker through the REAL authenticated API, on the owner-designated
// test account, inside a disposable probe project (soft-deleted at the end).
//
//   (a) BE-6/BE-12 — tag add ×2 same name + a case twin resolve to ONE id
//       (the old code 500'd the race and forked "ui/ux" next to "UI/UX");
//   (b) BE-7 — a sprint create with a BAD window (overlapping a closed sibling)
//       while an ACTIVE sprint is open → 400 AND the active sprint stays OPEN
//       (the old close-then-assert order permanently closed it); plus the
//       success-path geometry (clean dated create auto-closes the active sprint
//       the day before the new start);
//   (c) BE-10 — archive-done moves exactly the done tasks, atomically, and the
//       board + archives reflect it.
//
// Usage: node scripts/live-s252-probe.mjs [dev|prod]   (default: dev)
// Env:   S252_LOGIN + S252_PASS (the test account) — never hardcoded.

import { randomUUID } from 'node:crypto'

const target = process.argv[2] || 'dev'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
const LOGIN = process.env.S252_LOGIN
const PASS = process.env.S252_PASS
if (!LOGIN || !PASS) {
  console.error('need S252_LOGIN + S252_PASS in env (the test account)')
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
      ...(cookie ? { Cookie: cookie, Origin: URL_BASE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* html or empty */ }
  return { status: res.status, json, cookie: res.headers.get('set-cookie') }
}

const main = async () => {
  console.log(`S252 live probe → ${URL_BASE}`)

  // --- login (the test account's real session)
  const login = await api('/api/auth/login', 'POST', { login: LOGIN, password: PASS })
  if (login.status !== 200 || !login.cookie) {
    console.error(`login failed: ${login.status} ${JSON.stringify(login.json)}`)
    process.exit(1)
  }
  const cookie = login.cookie.split(';')[0]
  console.log('  signed in as the test account')

  // --- the disposable probe project
  const proj = await api('/api/projects', 'POST', { title: `S252 probe ${new Date().toISOString().slice(0, 10)} (safe to delete)` }, cookie)
  check('probe project created', proj.status === 201, String(proj.status))
  const pid = proj.json.id

  // ---------- (a) BE-6/BE-12: tag find-or-create, race + case twin ----------
  const tagBase = `s252-${randomUUID().slice(0, 6)}`
  const t1 = await api(`/api/projects/${pid}/tags`, 'POST', { name: tagBase }, cookie)
  const t2 = await api(`/api/projects/${pid}/tags`, 'POST', { name: tagBase }, cookie)
  check('(a) same-name tag add ×2 → both 201', t1.status === 201 && t2.status === 201, `${t1.status}/${t2.status}`)
  check('(a) same-name tag add ×2 → ONE id (ON CONFLICT)', t1.json?.id === t2.json?.id && Boolean(t1.json?.id))
  const t3 = await api(`/api/projects/${pid}/tags`, 'POST', { name: tagBase.toUpperCase() }, cookie)
  check('(a) case-twin add → same id (NOCASE)', t3.status === 201 && t3.json?.id === t1.json?.id, `${t3.status} ${t3.json?.id === t1.json?.id ? 'same' : 'DIFFERENT'}`)

  const task = await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 's252 probe task', status: 'planned' }, cookie)
  const tt = await api(`/api/devtasks/${task.json.id}/tags`, 'POST', { name: tagBase.toLowerCase() }, cookie)
  check('(a) task-tag add with the other case → same id', tt.status === 201 && tt.json?.id === t1.json?.id)

  // ---------- (b) BE-7: bad window leaves the active sprint OPEN ----------
  const s1 = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S252 closed sibling', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' }, cookie)
  check('(b) closed sibling created (Mar 1→30)', s1.status === 201, String(s1.status))
  const s2 = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S252 active one' }, cookie)
  const start = await api(`/api/sprints/${s2.json.id}/start`, 'POST', undefined, cookie)
  check('(b) second sprint started (active, open)', s2.status === 201 && start.status === 200, `${s2.status}/${start.status}`)

  const bad = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S252 bad window', started_at: '2026-03-20T00:00:00.000Z', ended_at: '2026-03-25T00:00:00.000Z' }, cookie)
  check('(b) bad-window create → 400', bad.status === 400, String(bad.status))

  const board1 = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
  const s2row = board1.json.sprints.find((s) => s.id === s2.json.id)
  check('(b) THE REGRESSION: active sprint still OPEN after the 400', s2row && s2row.ended_at === null && s2row.status === 'active', `ended_at=${s2row?.ended_at} status=${s2row?.status}`)
  check('(b) failed sprint was not inserted', board1.json.sprints.length === 2, String(board1.json.sprints.length))

  const day = (offset) => new Date(Math.floor(Date.now() / 86400000) * 86400000 + offset * 86400000).toISOString()
  const ok = await api(`/api/projects/${pid}/sprints`, 'POST', { name: 'S252 clean window', started_at: day(30), ended_at: day(45) }, cookie)
  const board2 = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
  const s2after = board2.json.sprints.find((s) => s.id === s2.json.id)
  check('(b) clean dated create → 201 (success path byte-identical)', ok.status === 201, String(ok.status))
  check('(b) active sprint auto-closed the day before the new start', s2after && s2after.ended_at === day(29) && s2after.status === 'completed', `ended_at=${s2after?.ended_at}`)

  // ---------- (c) BE-10: archive-done is the atomic move ----------
  await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 's252 done a', status: 'done', tags: [tagBase] }, cookie)
  await api(`/api/projects/${pid}/devtasks`, 'POST', { title: 's252 done b', status: 'done' }, cookie)
  const arch = await api(`/api/projects/${pid}/devtasks/archive-done`, 'POST', undefined, cookie)
  check('(c) archive-done → 200 {archived:2}', arch.status === 200 && arch.json?.archived === 2, `${arch.status} ${JSON.stringify(arch.json)}`)
  const board3 = await api(`/api/projects/${pid}/devboard`, 'GET', undefined, cookie)
  const remaining = board3.json.tasks.map((t) => t.title)
  check('(c) only the planned task remains on the board', remaining.length === 1 && remaining[0] === 's252 probe task', JSON.stringify(remaining))
  const archives = await api(`/api/projects/${pid}/archives`, 'GET', undefined, cookie)
  check('(c) the archives shelf carries both done tasks (labeled)', archives.json?.archives?.length === 2 && archives.json.archives.every((r) => r.id), String(archives.json?.archives?.length))
  const labeled = archives.json.archives.find((r) => r.title === 's252 done a')
  check('(c) the label snapshot rode into the archive', labeled && Array.isArray(labeled.tags) && labeled.tags.some((t) => t.name === tagBase), JSON.stringify(labeled?.tags))

  // ---------- cleanup: the probe project leaves every view (trash; the 7-day cron purges)
  const del = await api(`/api/projects/${pid}`, 'DELETE', undefined, cookie)
  check('cleanup: probe project soft-deleted', del.status === 200, String(del.status))

  const failed = results.filter((r) => !r.ok)
  console.log(`\nS252 live probe (${target}): ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}`)
    process.exit(1)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
