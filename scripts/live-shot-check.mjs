// S38 live storage round-trip — proves the user's exact ask on a REAL deployment:
//   "upload in hibana → check they're really uploaded → shown in hibana →
//    never expire unless the user deletes them (deleting removes the cloud bytes)"
//
// What it does (against the chosen target):
//   1. GET /api/health                 → storage MUST be 'kv' (the wiring is live)
//   2. creates a THROWAWAY probe user + session directly in the DB (wrangler --file /
//      node:sqlite — the D1-discipline-compliant write paths; never the owner's account)
//   3. POST /api/projects              → probe project
//   4. POST .../screenshots            → a real 70-byte PNG upload (the app's own route)
//   5. GET .../screenshots             → the row (+ its storage key)
//   6. GET /api/media/.../file         → the SAME bytes back through Hibana ("shown")
//   7. KV REST GET <key>               → the SAME bytes at Cloudflare ("really uploaded")
//   8. DELETE /api/screenshots/:id     → then media 404s AND the KV key 404s ("deletes
//      themselves" is the ONLY thing that removes the picture — no TTL exists)
//   9. purges the probe user (ON DELETE CASCADE) + asserts users row-count parity
//
// Usage (creds come from .secrets.env — values are never printed):
//   node --import tsx scripts/live-shot-check.mjs --local            # http://localhost:8788, node:sqlite
//   node --import tsx scripts/live-shot-check.mjs --remote dev       # hibana.aliassadi.workers.dev + pm-app-dev
//   node --import tsx scripts/live-shot-check.mjs --remote prod      # hibana.ir + pm-app-prod
//   --base https://…   override the target URL
//   --keep             skip cleanup (leaves the probe shot for eyeballing in a browser)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { secrets } from './lib.mjs'
import { hashPassword } from '../src/auth/password.ts'

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Buffer.from(PNG_B64, 'base64')

const KV_NS = {
  dev: '7c6eb81bac1a42c09e2a2d4686d48199', // wrangler.toml (top-level [[kv_namespaces]])
  prod: '1a64052f77364c2f979be26bdec95d67', // wrangler.toml ([[env.prod.kv_namespaces]])
}
const BASE_URL = {
  local: 'http://127.0.0.1:8788', // 127.0.0.1, not localhost — Node's fetch resolves
  // localhost → ::1 first and the node-server binds IPv4 (curl masks this, fetch fails
  // with ECONNREFUSED).
  dev: 'https://hibana.aliassadi.workers.dev',
  prod: 'https://hibana.ir',
}
const D1_NAME = { dev: 'pm-app-dev', prod: 'pm-app-prod' }

// ---- args ------------------------------------------------------------------------
const args = process.argv.slice(2)
const remoteIdx = args.indexOf('--remote')
const mode = args.includes('--local')
  ? 'local'
  : args.includes('--prod') || (remoteIdx >= 0 && args[remoteIdx + 1] === 'prod')
    ? 'prod'
    : 'dev'
const keep = args.includes('--keep')
const baseIdx = args.indexOf('--base')
const base = (baseIdx >= 0 ? args[baseIdx + 1] : undefined) ?? (mode === 'local' ? BASE_URL.local : BASE_URL[mode])
const sec = secrets()
const CF_ACCOUNT = sec.CLOUDFLARE_ACCOUNT_ID
const CF_TOKEN = sec.CLOUDFLARE_API_TOKEN
if (!CF_ACCOUNT || !CF_TOKEN) {
  console.error('FATAL: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing from .secrets.env')
  process.exit(1)
}

// ---- DB layer: local node:sqlite OR remote wrangler d1 execute --file --------------
function sqlLocal(sql) {
  const db = new DatabaseSync(join(process.cwd(), 'data', 'hibana.db'))
  try {
    const out = []
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      out.push(...db.prepare(stmt).all())
    }
    return out
  } finally {
    db.close()
  }
}
function sqlRemote(sql, d1) {
  // Wrangler quirk (hit live, 2026-09-13): --json with --file returns execution
  // SUMMARY rows ("Total queries executed"…), not result rows; --command returns the
  // real rows. So: reads → --command (fixed in-process strings, argv array — no shell
  // interpolation ever), writes → --file (the D1-discipline rule).
  const isRead = /^\s*select/i.test(sql)
  const dir = mkdtempSync(join(tmpdir(), 'hibana-shot-check-'))
  const file = join(dir, 'stmt.sql')
  writeFileSync(file, sql)
  try {
    const args = isRead
      ? ['wrangler', 'd1', 'execute', d1, '--remote', '--command', sql, '--json', '-y']
      : ['wrangler', 'd1', 'execute', d1, '--remote', '--file', file, '--json', '-y']
    const raw = execFileSync('npx', args, {
      cwd: process.cwd(),
      env: { ...process.env, CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).toString()
    const start = raw.indexOf('[') // wrangler prints banner lines before the JSON
    if (start < 0) throw new Error('no JSON in wrangler output')
    const parsed = JSON.parse(raw.slice(start))
    const rows = []
    for (const batch of Array.isArray(parsed) ? parsed : [parsed]) rows.push(...(batch.results ?? []))
    return rows
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const runSql = mode === 'local' ? (sql) => sqlLocal(sql) : (sql) => sqlRemote(sql, D1_NAME[mode])

// ---- HTTP layer (Origin + cookie — the CSRF gate trusts the request's own origin) ---
const COOKIE = (() => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
})()
async function api(path, init = {}) {
  return fetch(base + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: base, // CSRF: must equal the request origin
      cookie: `hibana_session=${COOKIE}`,
      ...(init.headers ?? {}),
    },
  })
}
async function kvGet(key) {
  const ns = mode === 'prod' ? KV_NS.prod : KV_NS.dev
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`
  return fetch(url, { headers: { authorization: `Bearer ${CF_TOKEN}` } })
}

// ---- probe identities -------------------------------------------------------------
const userId = randomUUID()
const email = `zzprobe+${Date.now()}@hibana.local`
const pass = randomUUID() + randomUUID()
const now = new Date().toISOString()
const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const sessionRowId = await crypto.subtle
  .digest('SHA-256', new TextEncoder().encode(COOKIE))
  .then((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''))

// ---- the series -------------------------------------------------------------------
const results = []
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) process.exitCode = 1
}
const fail = (name, detail) => step(name, false, detail)

try {
  const before = runSql('SELECT count(*) AS n FROM users')[0].n
  const hash = await hashPassword(pass)
  runSql(
    `INSERT INTO users (id, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${userId}', '${email}', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}');
     INSERT INTO sessions (id, user_id, created_at, expires_at)
     VALUES ('${sessionRowId}', '${userId}', '${now}', '${expires}');`,
  )

  // 1. health: the deployment must actually be on KV
  const health = await api('/api/health')
  const hb = await health.json().catch(() => ({}))
  step('health ok', health.status === 200 && hb.ok === true, `status=${health.status}`)
  step('storage = kv (wiring live)', hb.storage === 'kv', `storage=${hb.storage}`)

  // 2. create probe project
  const projRes = await api('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'zz-storage-probe' }) })
  const proj = await projRes.json().catch(() => ({}))
  const projId = proj.id ?? proj.project?.id
  projRes.status === 201 || projRes.status === 200
    ? step('project created', Boolean(projId), `status=${projRes.status}`)
    : fail('project created', `status=${projRes.status} body=${JSON.stringify(proj).slice(0, 120)}`)

  // 3. upload the PNG through the app's own route
  const upRes = await api(`/api/projects/${projId}/screenshots`, {
    method: 'POST',
    body: JSON.stringify({ fileName: 'storage-check.png', mimeType: 'image/png', dataBase64: PNG_B64, caption: 'S38 live storage check' }),
  })
  const up = await upRes.json().catch(() => ({}))
  const shotId = up.id
  upRes.status === 201 ? step('screenshot uploaded (API)', true, `status=201 id=${shotId}`) : fail('screenshot uploaded (API)', `status=${upRes.status} body=${JSON.stringify(up).slice(0, 160)}`)

  // 4. the row (+ its storage key)
  const listRes = await api(`/api/projects/${projId}/screenshots`)
  const list = await listRes.json().catch(() => ({}))
  const row = (list.screenshots ?? []).find((s) => s.id === shotId)
  const key = row?.github_path
  step('row in DB with storage key', Boolean(key), `key=${key}`)

  // 5. shown in hibana: the media route returns the SAME bytes
  const mediaRes = await api(`/api/media/screenshots/${shotId}/file`)
  const mediaBytes = mediaRes.status === 200 ? Buffer.from(await mediaRes.arrayBuffer()) : null
  step(
    'shown in Hibana (media route)',
    mediaRes.status === 200 && mediaBytes?.equals(PNG_BYTES) && (mediaRes.headers.get('content-type') || '').startsWith('image/png'),
    `status=${mediaRes.status} bytes=${mediaBytes?.length ?? 0}/${PNG_BYTES.length} type=${mediaRes.headers.get('content-type')}`,
  )

  // 6. really uploaded: the SAME bytes at Cloudflare KV (direct REST, bypassing the app)
  const kvRes = await kvGet(key)
  const kvBytes = kvRes.status === 200 ? Buffer.from(await kvRes.arrayBuffer()) : null
  step('really uploaded (Cloudflare KV round-trip)', kvRes.status === 200 && kvBytes?.equals(PNG_BYTES), `status=${kvRes.status} bytes=${kvBytes?.length ?? 0}/${PNG_BYTES.length}`)

  if (!keep) {
    // 7. delete removes BOTH the row and the cloud bytes — the only removal path
    const delRes = await api(`/api/screenshots/${shotId}`, { method: 'DELETE' })
    const mediaAfter = await api(`/api/media/screenshots/${shotId}/file`)
    const kvAfter = await kvGet(key)
    step('delete via Hibana removes cloud bytes', delRes.status === 200 && mediaAfter.status === 404 && kvAfter.status === 404, `delete=${delRes.status} media-after=${mediaAfter.status} kv-after=${kvAfter.status}`)

    // 8. purge the probe user (cascade) + parity
    runSql(`DELETE FROM users WHERE id = '${userId}';`)
    const after = runSql('SELECT count(*) AS n FROM users')[0].n
    step('probe purged, users parity', Number(after) === Number(before), `users ${before} → ${after}`)
  } else {
    console.log(`KEEP: probe left for eyeballing — user ${email} / project ${projId} / shot ${shotId}`)
    // Written under $HOME (never the repo) so an agent can drive a browser with the
    // probe session: "cookie project shot base". Cleaned up by whoever consumed it.
    const { writeFileSync: wf } = await import('node:fs')
    wf('/home/z/hibana-tmp/live-keep-session.txt', `${COOKIE} ${projId} ${shotId} ${base}`)
  }
} catch (err) {
  fail('unexpected error', String(err).slice(0, 200))
  try {
    runSql(`DELETE FROM users WHERE id = '${userId}';`)
  } catch { /* best-effort cleanup */ }
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${base} [${mode}] — ${passed}/${results.length} steps passed`)
process.exit(process.exitCode ?? 0)
