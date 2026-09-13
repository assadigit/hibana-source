#!/usr/bin/env node
// scripts/live-tags-probe.mjs — S43's live functional probe (the S41/S42 D1-probe-user
// pattern). Verifies on a DEPLOYED worker that the consolidated /api/tags serves
// CHIP HTML to htmx (the settings #taglist bug class) and JSON to fetch, that the
// delete flow refreshes the chips, and that the touch-floor/sw wiring shipped.
// Usage: node scripts/live-tags-probe.mjs [dev|prod]   (default: dev)

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'

const target = process.argv[2] || 'dev'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
const DB = target === 'prod' ? 'pm-app-prod' : 'pm-app-dev'
const envArg = target === 'prod' ? '--env prod' : ''

const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const EMAIL = `probe-s43-${target}@hibana.local`
const PASS = 'probe-s43-password'
const TOKEN = randomBytes(32).toString('hex')

async function sha256(s) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex')
}

function d1(sql) {
  const file = `/tmp/live-tags-probe-${Date.now()}.sql`
  writeFileSync(file, sql)
  try {
    return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, envArg ? envArg.split(' ') : [], '--file', file, '--remote', '-y'].flat(), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } finally {
    rmSync(file, { force: true })
  }
}

const main = async () => {
  // --- seed: probe user + session (sessions.id stores sha256(token) — S41 gotcha)
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  const hash = `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
  const uid = UUID()
  const now = new Date().toISOString()
  const tagUsed = UUID()
  const tagLoose = UUID()
  const pid = UUID()
  await d1(`
    DELETE FROM users WHERE email = '${EMAIL}';
    INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
      VALUES ('${uid}', 'probe-s43', '${EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}');
    INSERT INTO projects (id, user_id, title, type, status, sort_order, reminders_enabled, created_at, updated_at)
      VALUES ('${pid}', '${uid}', 'پروب S43', 'personal', 'doing', 0, 0, '${now}', '${now}');
    INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${tagUsed}', '${uid}', 'استفاده‌شده', '#81b29a', 1, '${now}');
    INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${tagLoose}', '${uid}', 'آزاد', '#e63946', 0, '${now}');
    INSERT INTO project_tags (project_id, tag_id) VALUES ('${pid}', '${tagUsed}');
    INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${await sha256(TOKEN)}', '${uid}', '${now}', '${new Date(Date.now() + 3600_000).toISOString()}');
  `)

  const cookie = `hibana_session=${TOKEN}`
  const results = []
  const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

  // 1) HX GET → chips HTML + Vary
  const hx = await fetch(`${URL_BASE}/api/tags`, { headers: { Cookie: cookie, 'HX-Request': 'true', Origin: URL_BASE } })
  const hxBody = await hx.text()
  check('HX GET /api/tags → 200', hx.status === 200, String(hx.status))
  check('HX body is CHIP HTML (not JSON)', hxBody.includes('class="chip"') && !hxBody.includes('{"tags"'))
  check('Vary: HX-Request set', (hx.headers.get('vary') || '').includes('HX-Request'))

  // 2) fetch GET → JSON
  const js = await fetch(`${URL_BASE}/api/tags`, { headers: { Cookie: cookie, Accept: 'application/json', Origin: URL_BASE } })
  const data = await js.json()
  check('fetch GET /api/tags → JSON {tags}', Array.isArray(data?.tags) && data.tags.length === 2, JSON.stringify(data?.tags?.map((t) => t.name)))

  // 3) HX delete of the loose tag → chips HTML refresh
  const del = await fetch(`${URL_BASE}/api/tags/${tagLoose}`, { method: 'DELETE', headers: { Cookie: cookie, 'HX-Request': 'true', Origin: URL_BASE } })
  const delBody = await del.text()
  check('HX DELETE loose tag → 200 + refreshed chips', del.status === 200 && delBody.includes('class="chip"') && !delBody.includes('آزاد'))

  // 4) the used tag refuses (409 — delete-unused-only law)
  const refuse = await fetch(`${URL_BASE}/api/tags/${tagUsed}`, { method: 'DELETE', headers: { Cookie: cookie, 'HX-Request': 'true', Origin: URL_BASE } })
  check('HX DELETE used tag → 409', refuse.status === 409, String(refuse.status))

  // 5) shell wiring: settings.html carries the S43 css (wired dist or ?v=6) + sw v342
  const settings = await (await fetch(`${URL_BASE}/settings.html`)).text()
  check('settings.html serves the S43 shell', /misc\.[a-z0-9]+\.css|misc\.css\?v=6/.test(settings))
  const sw = await (await fetch(`${URL_BASE}/sw.js`)).text()
  check('sw version v342', sw.includes('hibana-v342'))
  const canvas = await (await fetch(`${URL_BASE}/canvas.html`)).text()
  check('canvas.html wired', /canvas\.[a-z0-9]+\.js|canvas\.js\?v=30/.test(canvas))

  // 6) purge the probe user (cascade)
  await d1(`DELETE FROM users WHERE email = '${EMAIL}';`)
  const gone = await (await fetch(`${URL_BASE}/api/tags`, { headers: { Cookie: cookie, Accept: 'application/json', Origin: URL_BASE } })).json()
  check('probe user purged (session dead → 401 body)', gone?.error === 'unauthorized' || gone?.error === 'auth_required', JSON.stringify(gone).slice(0, 80))

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${target.toUpperCase()} ${failed ? failed + ' FAILED' : 'ALL ' + results.length + ' PASS'}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
