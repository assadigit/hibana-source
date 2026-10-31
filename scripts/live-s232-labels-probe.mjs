#!/usr/bin/env node
// scripts/live-s232-labels-probe.mjs — S232's live functional probe (the S43
// live-tags-probe pattern: seed a probe user straight into D1, exercise the
// DEPLOYED worker, purge). Verifies the delete-any-label round end-to-end on a
// real deployment: the 409 guard without force, the force=1 cascade (links drop
// + removed_from), the tag's disappearance, and the settings chips' new
// hx-confirm + force=1 affordance on a used chip.
// Usage: CLOUDFLARE_API_TOKEN=… node scripts/live-s232-labels-probe.mjs [dev|prod]   (default: prod)

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'

const target = process.argv[2] || 'prod'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
const DB = target === 'prod' ? 'pm-app-prod' : 'pm-app-dev'
const envArg = target === 'prod' ? ['--env', 'prod'] : []

const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const EMAIL = `probe-s232-${target}@hibana.local`
const TOKEN = randomBytes(32).toString('hex')

async function sha256(s) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex')
}

function d1(sql) {
  const file = `/tmp/live-s232-probe-${Date.now()}.sql`
  writeFileSync(file, sql)
  try {
    return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, ...envArg, '--file', file, '--remote', '-y'].flat(), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } finally {
    rmSync(file, { force: true })
  }
}

// (d1Row retired: wrangler's d1 execute --json returns only an execution summary,
// never the SELECT rows — the cascade is verified through the LIVE API below, the
// same shape as the vitest suite.)

const main = async () => {
  // --- seed: probe user + session + a project with one task carrying one USED tag
  // (sessions.id stores sha256(token) — the S41 gotcha)
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('probe-s232-password'), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  const hash = `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
  const uid = UUID()
  const now = new Date().toISOString()
  const tagUsed = UUID()
  const pid = UUID()
  const tid = UUID()
  await d1(`
    DELETE FROM users WHERE email = '${EMAIL}';
    INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
      VALUES ('${uid}', 'probe-s232', '${EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}');
    INSERT INTO projects (id, user_id, title, type, status, sort_order, reminders_enabled, created_at, updated_at)
      VALUES ('${pid}', '${uid}', 'probe s232', 'personal', 'developing', 0, 0, '${now}', '${now}');
    INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, search_tags, created_at, updated_at)
      VALUES ('${tid}', '${pid}', 'probe task', 'idea', 'medium', 0, 's232-used', '${now}', '${now}');
    INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${tagUsed}', '${uid}', 's232-used', '#81b29a', 1, '${now}');
    INSERT INTO dev_task_tags (task_id, tag_id) VALUES ('${tid}', '${tagUsed}');
    INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${await sha256(TOKEN)}', '${uid}', '${now}', '${new Date(Date.now() + 3600_000).toISOString()}');
  `)

  const cookie = `__Host-hibana_session=${TOKEN}`
  const H = { Cookie: cookie, Origin: URL_BASE }
  const results = []
  const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

  // 1) the guard holds on the deployed worker: DELETE used without force → 409
  const refuse = await fetch(`${URL_BASE}/api/tags/${tagUsed}`, { method: 'DELETE', headers: H })
  check('DELETE used tag WITHOUT force → 409 tag_in_use', refuse.status === 409, String(refuse.status))

  // 1b) the pre-state is honest: the task carries the tag + FTS finds it by name
  const board0 = await (await fetch(`${URL_BASE}/api/projects/${pid}/devboard`, { headers: { ...H, Accept: 'application/json' } })).json()
  const task0 = (board0?.tasks || []).find((t) => t.id === tid)
  check('pre: the task carries the tag', Array.isArray(task0?.tags) && task0.tags.length === 1, JSON.stringify(task0?.tags))
  const fts0 = await (await fetch(`${URL_BASE}/api/search?q=s232-used`, { headers: { ...H, Accept: 'application/json' } })).json()
  check('pre: FTS finds the task by tag name', Array.isArray(fts0?.tasks) && fts0.tasks.length >= 1, JSON.stringify(fts0?.tasks?.map((t) => t.title)))

  // 2) the S232 cascade: DELETE ?force=1 → 200 + removed_from: 1
  const forced = await fetch(`${URL_BASE}/api/tags/${tagUsed}?force=1`, { method: 'DELETE', headers: { ...H, Accept: 'application/json' } })
  const forcedBody = await forced.json().catch(() => ({}))
  check('DELETE used tag ?force=1 → 200', forced.status === 200, String(forced.status))
  check('response carries removed_from: 1', forcedBody?.removed_from === 1, JSON.stringify(forcedBody))

  // 3) the tag is gone from the JSON list
  const js = await fetch(`${URL_BASE}/api/tags`, { headers: { ...H, Accept: 'application/json' } })
  const data = await js.json()
  check('tag gone from GET /api/tags', Array.isArray(data?.tags) && data.tags.every((t) => t.name !== 's232-used'), JSON.stringify(data?.tags?.map((t) => t.name)))

  // 4) the cascade through the LIVE API (the vitest shape): the task SURVIVES
  // (a label delete never deletes tasks), its tags empty, FTS forgot the name
  const board = await (await fetch(`${URL_BASE}/api/projects/${pid}/devboard`, { headers: { ...H, Accept: 'application/json' } })).json()
  const task = (board?.tasks || []).find((t) => t.id === tid)
  check('the task survived (the label goes, not the tasks)', !!task, '')
  check('the task\'s tags are empty (link cascaded)', !!task && Array.isArray(task.tags) && task.tags.length === 0, JSON.stringify(task?.tags))
  const fts = await (await fetch(`${URL_BASE}/api/search?q=s232-used`, { headers: { ...H, Accept: 'application/json' } })).json()
  check('FTS forgot the name (search_tags rewritten)', Array.isArray(fts?.tasks) && fts.tasks.length === 0, JSON.stringify(fts?.tasks?.map((t) => t.title)))

  // 5) the settings chips: a used chip carries hx-confirm + force=1 (re-seed one)
  const tagUsed2 = UUID()
  await d1(`
    INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${tagUsed2}', '${uid}', 's232-used-2', '#e63946', 1, '${now}');
    INSERT INTO dev_task_tags (task_id, tag_id) VALUES ('${tid}', '${tagUsed2}');
    UPDATE dev_tasks SET search_tags = 's232-used-2' WHERE id = '${tid}';
  `)
  const hx = await fetch(`${URL_BASE}/api/tags`, { headers: { ...H, 'HX-Request': 'true' } })
  const hxBody = await hx.text()
  check('HX chips: the used chip carries hx-confirm', hxBody.includes('hx-confirm='), '')
  check('HX chips: the used chip DELETEs with force=1', hxBody.includes(`/api/tags/${tagUsed2}?force=1`), '')
  check('HX chips: the count rides the confirm message', hxBody.includes('used by 1 tasks') || hxBody.includes('used by 2 tasks'), '')

  // 6) purge the probe user (cascade)
  await d1(`DELETE FROM users WHERE email = '${EMAIL}';`)
  const gone = await (await fetch(`${URL_BASE}/api/tags`, { headers: { ...H, Accept: 'application/json' } })).json()
  check('probe user purged (session dead → 401 body)', gone?.error === 'unauthorized' || gone?.error === 'auth_required', JSON.stringify(gone).slice(0, 80))

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${target.toUpperCase()} ${failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASS'}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
