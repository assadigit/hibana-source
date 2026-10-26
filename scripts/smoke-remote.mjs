// scripts/smoke-remote.mjs — the Autopilot Ship Gate remote smoke suite (PLAYBOOK §3).
//
// Runs against a DEPLOYED base URL (dev or prod) and proves the live contract:
//   1. health endpoint is public, db up, schema version numeric
//   2. the login page loads (EN shell + i18n wiring present)
//   3. a THROWAWAY probe user + session are seeded directly in the target D1
//      (wrangler --file, D1-discipline rule — the owner's real account is never touched)
//   4. a REAL authenticated read (/api/auth/me + /api/projects) with the session cookie
//   5. write → read-back → hard-delete of one clearly-named throwaway project
//   6. EN + FA dictionaries load; the index shell renders
//   7. every /dist/*.<hash> asset referenced by the served HTML returns 200 with the
//      right content type (cache-busted wiring live)
//   8. the probe user is purged (ON DELETE CASCADE) and users row-count parity asserted
//
// Usage:
//   node --import tsx scripts/smoke-remote.mjs --target dev      # hibana.aliassadi.workers.dev
//   node --import tsx scripts/smoke-remote.mjs --target prod     # hibana.ir
//   node --import tsx scripts/smoke-remote.mjs --target dev --base https://custom
//
// Credentials: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from the environment or
// .secrets.env (scripts/lib.mjs — values never printed). No secret ever appears in
// output; the probe identities are single-use and timestamped.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { secrets } from './lib.mjs'
import { hashPassword } from '../src/auth/password.ts'

const BASE_URL = {
  dev: 'https://hibana.aliassadi.workers.dev',
  prod: 'https://hibana.ir',
}
const D1_NAME = { dev: 'pm-app-dev', prod: 'pm-app-prod' }

// ---- args ------------------------------------------------------------------------
const args = process.argv.slice(2)
const targetIdx = args.indexOf('--target')
const target = targetIdx >= 0 ? args[targetIdx + 1] : 'dev'
if (target !== 'dev' && target !== 'prod') {
  console.error(`FATAL: --target must be dev or prod (got '${target}')`)
  process.exit(1)
}
const baseIdx = args.indexOf('--base')
const base = (baseIdx >= 0 ? args[baseIdx + 1] : undefined) ?? BASE_URL[target]
const d1 = D1_NAME[target]

const sec = secrets()
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? sec.CLOUDFLARE_ACCOUNT_ID
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? sec.CLOUDFLARE_API_TOKEN
if (!CF_ACCOUNT || !CF_TOKEN) {
  console.error('FATAL: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing (env or .secrets.env)')
  process.exit(1)
}

console.log(`=== Ship Gate remote smoke — target: ${target} (${base}) ===`)

// ---- remote D1 layer (same discipline as live-shot-check) -------------------------
function sqlRemote(sql) {
  const isRead = /^\s*select/i.test(sql)
  const dir = mkdtempSync(join(tmpdir(), 'hibana-remote-smoke-'))
  const file = join(dir, 'stmt.sql')
  writeFileSync(file, sql)
  try {
    const argv = isRead
      ? ['wrangler', 'd1', 'execute', d1, '--remote', '--command', sql, '--json', '-y']
      : ['wrangler', 'd1', 'execute', d1, '--remote', '--file', file, '--json', '-y']
    const raw = execFileSync('npx', argv, {
      cwd: process.cwd(),
      env: { ...process.env, CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).toString()
    const start = raw.indexOf('[')
    if (start < 0) throw new Error('no JSON in wrangler output')
    const parsed = JSON.parse(raw.slice(start))
    const rows = []
    for (const batch of Array.isArray(parsed) ? parsed : [parsed]) rows.push(...(batch.results ?? []))
    return rows
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- probe identity (throwaway, clearly named, single-use) ------------------------
const userId = randomUUID()
const email = `zz-autopilot-smoke+${Date.now()}@hibana.local`
const pass = randomUUID() + randomUUID()
const now = new Date().toISOString()
const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const COOKIE_BYTES = new Uint8Array(32)
crypto.getRandomValues(COOKIE_BYTES)
const COOKIE = btoa(String.fromCharCode(...COOKIE_BYTES)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sessionRowId = await crypto.subtle
  .digest('SHA-256', new TextEncoder().encode(COOKIE))
  .then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''))

async function api(path, init = {}) {
  return fetch(base + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: base, // the CSRF gate trusts the request's own origin
      cookie: `__Host-hibana_session=${COOKIE}`,
      ...(init.headers ?? {}),
    },
  })
}

const results = []
const step = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

try {
  // 1. health
  const health = await fetch(base + '/api/health')
  const hb = await health.json().catch(() => ({}))
  step('health endpoint public + db up + schema version numeric',
    health.status === 200 && hb.ok === true && hb.db === 'up' && /^\d+$/.test(String(hb.schema_version)),
    `status=${health.status} schema=${hb.schema_version} storage=${hb.storage}`)

  // 2. login page
  const login = await fetch(base + '/login.html')
  const loginHtml = await login.text()
  step('login page loads with i18n wiring',
    login.status === 200 && /Sign in/i.test(loginHtml) && /data-i18n|hibanaI18n/i.test(loginHtml),
    `status=${login.status} bytes=${loginHtml.length}`)

  // 3. seed the throwaway probe user + session
  const before = sqlRemote('SELECT count(*) AS n FROM users')[0].n
  const hash = await hashPassword(pass)
  sqlRemote(
    `INSERT INTO users (id, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${userId}', '${email}', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}');
     INSERT INTO sessions (id, user_id, created_at, expires_at)
     VALUES ('${sessionRowId}', '${userId}', '${now}', '${expires}');`,
  )
  step('throwaway probe user + session seeded in remote D1', true, `users ${before} → ${Number(before) + 1} (${email})`)

  // 4. real authenticated reads
  const me = await api('/api/auth/me')
  const meBody = await me.json().catch(() => ({}))
  step('authenticated read: /api/auth/me', me.status === 200 && meBody.user?.email === email, `status=${me.status}`)
  const projects = await api('/api/projects')
  step('authenticated read: /api/projects list', projects.status === 200, `status=${projects.status}`)

  // 5. write → read-back → delete (clearly-named throwaway)
  const title = `AUTOPILOT-SMOKE-THROWAWAY ${new Date().toISOString()}`
  const create = await api('/api/projects', { method: 'POST', body: JSON.stringify({ title, status: 'spark' }) })
  const createBody = await create.json().catch(() => ({}))
  step('throwaway project created', create.status === 201 && typeof createBody.id === 'string', `status=${create.status}`)
  const projId = createBody.id
  const detail = await api(`/api/projects/${projId}`)
  const detailBody = await detail.json().catch(() => ({}))
  step('read-back matches', detail.status === 200 && detailBody.project?.title === title, `status=${detail.status}`)
  const del = await api(`/api/projects/${projId}?force=1`, { method: 'DELETE' })
  const delBody = await del.json().catch(() => ({}))
  step('hard delete of the spark throwaway', del.status === 200 && delBody.soft === false, `status=${del.status}`)
  const gone = await api(`/api/projects/${projId}`)
  step('deleted project is gone (404)', gone.status === 404, `status=${gone.status}`)

  // 6. EN + FA dictionaries + index shell
  const i18nEn = await fetch(base + '/js/i18n-en.js')
  const i18nEnBody = await i18nEn.text()
  step('EN dictionary loads', i18nEn.status === 200 && i18nEnBody.length > 10_000, `status=${i18nEn.status} bytes=${i18nEnBody.length}`)
  const i18nFa = await fetch(base + '/js/i18n-fa.js')
  const i18nFaBody = await i18nFa.text()
  step('FA dictionary loads (Persian content present)', i18nFa.status === 200 && /[\u0600-\u06FF]/.test(i18nFaBody), `status=${i18nFa.status} bytes=${i18nFaBody.length}`)
  const index = await fetch(base + '/')
  step('index shell renders', index.status === 200, `status=${index.status}`)

  // 7. hashed /dist assets referenced by the served HTML all load
  const distRefs = new Set()
  for (const html of [loginHtml, await index.text()]) {
    for (const m of html.matchAll(/(?:src|href)="(\/dist\/[^"]+\.(?:js|css))"/g)) distRefs.add(m[1])
  }
  let assetOk = distRefs.size > 0
  const assetDetails = []
  for (const ref of [...distRefs].slice(0, 12)) {
    const res = await fetch(base + ref)
    const type = res.headers.get('content-type') ?? ''
    const good = res.status === 200 && (ref.endsWith('.css') ? /text\/css/i.test(type) : /javascript/i.test(type))
    if (!good) assetOk = false
    assetDetails.push(`${ref.split('/').pop()}:${res.status}`)
  }
  step('all referenced /dist assets load with correct content types', assetOk,
    `${distRefs.size} refs — ${assetDetails.join(' ')}`)

  // 8. purge the probe user (cascade) + parity
  sqlRemote(`DELETE FROM users WHERE id = '${userId}';`)
  const after = sqlRemote('SELECT count(*) AS n FROM users')[0].n
  step('probe user purged, users row-count parity', Number(after) === Number(before), `users ${before} → ${after}`)
} catch (err) {
  console.error('SMOKE ERROR:', err instanceof Error ? err.message : err)
  // best-effort cleanup so a mid-run failure never leaves the probe behind
  try {
    sqlRemote(`DELETE FROM users WHERE id = '${userId}';`)
    console.error('(best-effort probe cleanup executed)')
  } catch { /* already gone or unreachable */ }
  process.exitCode = 1
}

const failed = results.filter((r) => !r.ok).length
console.log(failed === 0 ? `\nRemote smoke (${target}): ALL PASS (${results.length} checks)` : `\nRemote smoke (${target}): ${failed} FAILURE(S) of ${results.length}`)
process.exit(failed === 0 ? 0 : 1)
