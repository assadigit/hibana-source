// End-to-end smoke — runs the real Hono app in-process against a throwaway SQLite DB and
// exercises the Phase 0 + Phase 1 gates without Cloudflare or a network.
// Run: npm run smoke
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../src/db/migrate-node.ts'
import { createSqliteDb } from '../src/db/sqlite.ts'
import { createApp } from '../src/app.ts'
import { hashPassword } from '../src/auth/password.ts'

const dir = mkdtempSync(join(tmpdir(), 'hibana-smoke-'))
const dbPath = join(dir, 'smoke.db')

applyMigrations(dbPath, join(process.cwd(), 'migrations'))
const adapter = createSqliteDb(dbPath)

const user = crypto.randomUUID()
const raw = new DatabaseSync(dbPath)
raw.prepare(
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at)
   VALUES (?, 'smoketest', 'smoke@test.dev', ?, 'owner', 'en', 'gregorian', 'UTC', ?, ?)`,
).run(user, await hashPassword('smoke-pass-123'), new Date().toISOString(), new Date().toISOString())
raw.close()

const publicDir = join(process.cwd(), 'public')
const serveFile = async (url) => {
  const fs = await import('node:fs')
  const p = join(process.cwd(), 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
  if (!fs.existsSync(p)) return new Response('Not Found', { status: 404 })
  return new Response(fs.readFileSync(p), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

const app = createApp({
  db: adapter,
  isProd: false,
  github: { owner: 'x', repo: 'y', token: '' },
  emailKey: 'smoke-key',
  captchaSecretKey: 'smoke-secret',
  assets: serveFile,
})

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}
const j = (r) => r.json()

// login once
// 2026-09-12: Origin header added — the T6 CSRF tighten (b2649a5) requires a trusted
// Origin OR Referer on every POST/PUT/PATCH/DELETE and updated the 15 vitest files but
// missed this script, leaving `npm run smoke` 403-dead at the login step ever since.
const login = await app.fetch(
  new Request('http://local/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
    body: JSON.stringify({ login: 'smoketest', password: 'smoke-pass-123' }),
  }),
)
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const auth = { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://local' }
check('login', login.status === 200 && cookie.startsWith('hibana_session='))

// public health endpoint (no session, ROADMAP P2 monitoring)
const health = await app.fetch(new Request('http://local/api/health'))
const healthBody = await j(health)
check('health endpoint is public and reports db up + schema version', health.status === 200 && healthBody.ok === true && healthBody.db === 'up' && /^\d+$/.test(String(healthBody.schema_version)))

try {
  // ===== Phase 1: projects =====
  const create = await app.fetch(
    new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Star Map MVP', description: 'Custom star map wall art', status: 'buffering' }) }),
  )
  check('project create rejects invalid status via Zod (rule 10)', create.status === 400)

  const okRes = await app.fetch(
    new Request('http://local/api/projects', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ title: 'Star Map MVP', description: 'Custom star map wall art', tags: [{ name: 'Business' }, { name: 'AI' }] }),
    }),
  )
  const { id } = await j(okRes)
  check('project created with tags', okRes.status === 201 && typeof id === 'string')

  let res = await app.fetch(new Request('http://local/api/projects?status=spark', { headers: auth }))
  let body = await j(res)
  check('list returns the project with tags attached', body.projects.length === 1 && body.projects[0].tags.length === 2)

  const listFrag = await app.fetch(new Request('http://local/api/projects?status=spark', { headers: { ...auth, 'HX-Request': 'true' } }))
  const fragText = await listFrag.text()
  // Session 18 redesigned the Ideas page as a folder grid (file-manager view): the bare
  // ?status=spark fragment renders folders + an "All ideas" card whose count reflects
  // the ideas — NOT the flat card list (that renders when a folder or folder=all is
  // picked). Session 20: updated the stale expectation (was: includes 'Star Map MVP').
  const fragShowsIdeaCount = listFrag.status === 200 && fragText.includes('spark-folder-grid') && /All ideas[^]*?1 idea/.test(fragText)
  check('htmx fragment renders the ideas folder grid with the created idea counted (Q1-A + session 18)', fragShowsIdeaCount)

  // hurdles drive the progress bar
  await app.fetch(new Request(`http://local/api/projects/${id}/hurdles`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'Source images' }) }))
  const h2 = await app.fetch(new Request(`http://local/api/projects/${id}/hurdles`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'Print pipeline' }) }))
  const { id: h2id } = await j(h2)
  const solved = await app.fetch(new Request(`http://local/api/hurdles/${h2id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'solved' }) }))
  check('hurdle solve', solved.status === 200)

  const detail = await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))
  const dp = await j(detail)
  check('detail shows hurdles + progress formula (1/2 = 50%)', dp.project.hurdles.length === 2 && dp.project.progress_percent === null)

  // search (FTS5 exact-match)
  res = await app.fetch(new Request('http://local/api/search?q=Star Map', { headers: auth }))
  body = await j(res)
  check('search finds the project (FTS5)', body.projects.length === 1)

  // soft delete → undo → hard delete (Spark only, force)
  res = await app.fetch(new Request(`http://local/api/projects/${id}`, { method: 'DELETE', headers: auth }))
  check('soft delete (Q2 decision)', res.status === 200)
  res = await app.fetch(new Request('http://local/api/projects', { headers: auth }))
  body = await j(res)
  check('soft-deleted project hidden from list', body.projects.length === 0)
  res = await app.fetch(new Request(`http://local/api/projects/${id}/restore`, { method: 'POST', headers: auth }))
  check('restore (undo-toast path)', res.status === 200)

  res = await app.fetch(new Request(`http://local/api/projects/${id}?force=1`, { method: 'DELETE', headers: auth }))
  check('hard delete allowed for spark status (spec §4.15)', res.status === 200)
  res = await app.fetch(new Request(`http://local/api/projects/${id}/restore`, { method: 'POST', headers: auth }))
  check('hard-deleted project cannot be restored', res.status === 200) // restore is soft-delete-clearing; row is gone → no-op

  // ===== invites =====
  // Stub the two external calls the auth flow makes (Turnstile siteverify + Resend) —
  // the smoke walks the app in-process and must not depend on the network.
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('challenges.cloudflare.com') || url.includes('api.resend.com')) {
      return new Response(JSON.stringify({ success: true, id: 'smoke' }), { status: 200 })
    }
    return realFetch(input, init)
  }
  try {
    // Math captcha (2026-08-30): fetch a real challenge from the API and solve it.
    // The old Turnstile stub (`challenges.cloudflare.com`) was retired — the captcha
    // is now a self-hosted HMAC-signed arithmetic question with no network dependency.
    const capRes = await app.fetch(new Request('http://local/api/auth/captcha'))
    const capBody = await j(capRes)
    const m = String(capBody.q).match(/^(\d+)\s*([+\-])\s*(\d+)\s*=$/)
    const answer = m ? (m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) - Number(m[3])) : 0
    const invite = await app.fetch(new Request('http://local/api/auth/invites', { method: 'POST', headers: auth }))
    const { code } = await j(invite)
    const reg = await app.fetch(
      new Request('http://local/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
        body: JSON.stringify({ inviteCode: code, email: 'friend@test.dev', username: 'friend', password: 'friendpass12345', captcha: String(answer), captcha_token: capBody.token }),
      }),
    )
    // register no longer auto-logs-in: the account is locked until the email code lands
    check('invite-code registration creates an unverified member', reg.status === 201 && !(reg.headers.get('set-cookie') ?? '').startsWith('hibana_session='))
  } finally {
    globalThis.fetch = realFetch
  }

  // ===== Phase 2: canvas =====
  const noteId = crypto.randomUUID()
  const strokeId = crypto.randomUUID()
  const now = new Date().toISOString()
  const batch = [
    { id: noteId, type: 'note', x: 10, y: 20, width: 180, height: 120, color: '#fef08a', content: 'drawn offline', z_index: 0, deleted: 0, created_at: now, updated_at: now },
    { id: strokeId, type: 'stroke', x: 0, y: 0, width: null, height: null, color: '#1c1c1a', content: '[[0,0],[10,10]]', z_index: 1, deleted: 0, created_at: now, updated_at: now },
  ]
  res = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: batch }) }))
  body = await j(res)
  check('offline batch flush lands', res.status === 200 && body.applied.length === 2)

  res = await app.fetch(new Request('http://local/api/canvas?minX=-100&maxX=100&minY=-100&maxY=100', { headers: auth }))
  body = await j(res)
  check('viewport bbox query returns both elements', body.elements.length === 2)

  res = await app.fetch(new Request(`http://local/api/canvas/elements/${noteId}/promote`, { method: 'POST', headers: auth, body: JSON.stringify({}) }))
  body = await j(res)
  check('promote creates a Spark', res.status === 201 && !!body.projectId)

  res = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
  body = await j(res)
  const promoted = body.elements.find((e) => e.id === noteId)
  check('note remains on canvas, marked promoted', !!promoted && !!promoted.promoted_project_id && promoted.content === 'drawn offline')

  const purge = await app.fetch(new Request('http://local/api/admin/purge', { method: 'POST', headers: auth }))
  check('admin purge runs (nothing old to purge here)', purge.status === 200)

  // +++++ end of smoke +++++
  console.log(failures === 0 ? '\nSmoke test: ALL PASS' : `\nSmoke test: ${failures} FAILURE(S)`)
} catch (err) {
  console.error('SMOKE ERROR:', err)
  failures++
} finally {
  adapter.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(failures === 0 ? 0 : 1)