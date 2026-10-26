// scripts/workers-smoke.mjs — Workers-runtime smoke test.
//
// Runs the Workers entry (src/index.ts) via `wrangler dev --local` (miniflare)
// and verifies the health + login + page-render paths work on the Workers runtime.
//
// Catches "works on Node, breaks on Workers" bugs — the PBKDF2 600k bug would
// have been caught here (Workers caps crypto.subtle.deriveBits at 100k iterations).
//
// Run: npm run test:workers
// CI: wired into .github/workflows/ci.yml (after the unit tests).
//
// Uses the LOCAL miniflare D1 (not the remote dev D1) so it's isolated + safe.
// Applies all migrations to the local D1 + seeds a test user before starting.

import { spawn, execSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'

const ROOT = process.cwd()
const PORT = 8812
const BASE = `http://localhost:${PORT}`

console.log('=== Workers-runtime smoke test (miniflare via wrangler dev --local) ===')
console.log('This catches "works on Node, breaks on Workers" bugs (e.g. PBKDF2 iteration cap).')
console.log('')

// Step 1: apply all migrations to the local D1 (idempotent — CREATE TABLE IF NOT EXISTS)
console.log('1. Applying migrations to local D1...')
const migrations = readdirSync(join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort()
for (const m of migrations) {
  try {
    execSync(`npx wrangler d1 execute pm-app-dev --local --file migrations/${m}`, {
      cwd: ROOT,
      stdio: 'pipe', // suppress output (migrations are idempotent, CREATE IF NOT EXISTS)
    })
  } catch { /* migration may already be applied — idempotent, safe to ignore */ }
}
console.log(`   ✓ ${migrations.length} migrations applied (idempotent)`)

// Step 2: seed a test user in the local D1
console.log('\n2. Seeding test user in local D1...')
const ITERATIONS = 100_000 // Workers cap — this is the KEY test (PBKDF2 verify on Workers runtime)
const salt = randomBytes(16)
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('workers-test-123'), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
const toB64 = (buf) => Buffer.from(buf).toString('base64')
const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
const now = new Date().toISOString()
const id = randomBytes(16).toString('hex')
// Phase 1 isolation seeds: project + canvas-element ids must be UUID-shaped (the
// route schemas uuid()-validate them) so the sync canary actually executes the upsert.
const bprojId = crypto.randomUUID()
const belemId = crypto.randomUUID()
const seedSql = `DELETE FROM users WHERE email = 'workers-test@hibana.local';
INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}', 'workerstest', 'workers-test@hibana.local', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}');
DELETE FROM users WHERE email = 'workers-owner@hibana.local';
INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}owner', 'workersowner', 'workers-owner@hibana.local', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}');
DELETE FROM users WHERE email IN ('workers-iso-a@hibana.local', 'workers-iso-b@hibana.local');
INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}isoa', 'isoa', 'workers-iso-a@hibana.local', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}');
INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}isob', 'isob', 'workers-iso-b@hibana.local', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}');
DELETE FROM canvas_elements WHERE id = '${belemId}';
DELETE FROM projects WHERE id = '${bprojId}';
DELETE FROM projects WHERE user_id IN ('${id}isoa', '${id}isob');
INSERT INTO projects (id, user_id, title, type, status, sort_order, created_at, updated_at)
VALUES ('${bprojId}', '${id}isob', 'ISO-B-SECRET-PROJECT', 'personal', 'planning', 0, '${now}', '${now}');
DELETE FROM canvas_elements WHERE user_id IN ('${id}isoa', '${id}isob');
INSERT INTO canvas_elements (id, user_id, board, type, x, y, content, z_index, deleted, locked, angle, created_at, updated_at)
VALUES ('${belemId}', '${id}isob', 'canvas', 'note', 10, 20, 'ISO-B-SECRET-NOTE', 0, 0, 0, 0, '${now}', '${now}');`
const seedFile = '/tmp/workers-seed-local.sql'
writeFileSync(seedFile, seedSql)
try {
  execSync(`npx wrangler d1 execute pm-app-dev --local --file ${seedFile}`, { cwd: ROOT, stdio: 'pipe' })
  console.log('   ✓ test user seeded')
} catch (e) {
  console.error('   ✗ failed to seed test user:', e.message)
  process.exit(1)
} finally {
  try { unlinkSync(seedFile) } catch {}
}

// Step 3: start wrangler dev in the background
console.log(`\n3. Starting wrangler dev --local on :${PORT}...`)
// 2026-09-12 (Session 27 finding): spawn in its own PROCESS GROUP (detached on POSIX) so
// cleanup can kill the whole tree. `wrangler.kill()` alone SIGTERMs only the npx wrapper —
// the `workerd serve` grandchildren survive and spin at 80-100% CPU, which starved every
// subsequent run's 30s startup (the smoke test could only run once per sandbox).
const wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--local'], {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: process.platform !== 'win32', // POSIX: new process group (pgid = child pid)
})

// Kill the ENTIRE wrangler process tree (npx → wrangler → workerd children). Order:
// group SIGKILL first (catches stragglers mid-spawn), then the wrapper itself. Idempotent.
function killWranglerTree() {
  try {
    if (wrangler.pid && process.platform !== 'win32') process.kill(-wrangler.pid, 'SIGKILL')
  } catch { /* group already gone */ }
  try {
    wrangler.kill('SIGKILL')
  } catch { /* wrapper already gone */ }
}
// Belt: any unexpected exit path still reaps the tree (failed assertions, thrown errors).
process.on('exit', killWranglerTree)

let started = false
const output = []
wrangler.stdout.on('data', (d) => {
  const text = d.toString()
  output.push(text)
  if (text.includes('Ready') || text.includes(`localhost:${PORT}`)) started = true
})
wrangler.stderr.on('data', (d) => output.push(d.toString()))

console.log('   waiting for wrangler dev to start...')
for (let i = 0; i < 60; i++) {
  if (started) break
  await new Promise((r) => setTimeout(r, 500))
}
if (!started) {
  console.error('   ✗ wrangler dev did not start in 30s')
  console.error('   output:', output.join('').slice(-1000))
  killWranglerTree()
  process.exit(1)
}
console.log('   ✓ wrangler dev ready')

// Step 4: run the smoke tests
const findings = []

async function fetchApi(path, opts = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE, // CSRF gate requires Origin on POST
        Referer: `${BASE}/login.html`,
        ...(opts.headers || {}),
      },
    })
    return { status: res.status, body: await res.text(), headers: res.headers }
  } catch (e) {
    return { status: 0, error: e.message }
  }
}

console.log('\n4. Running smoke tests...')

// Test 1: health endpoint
let r = await fetchApi('/api/health')
if (r.status === 200 && r.body.includes('"ok":true')) {
  console.log('   ✓ GET /api/health → 200 {"ok":true}')
} else {
  findings.push(`GET /api/health failed: status=${r.status}, body=${r.body?.slice(0, 200)}`)
  console.error(`   ✗ GET /api/health → ${r.status}`)
}

// Test 2: login (the PBKDF2 test — would have caught the 600k bug)
r = await fetchApi('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ login: 'workers-test@hibana.local', password: 'workers-test-123' }),
})
if (r.status === 200 && r.body.includes('"ok":true')) {
  console.log('   ✓ POST /api/auth/login → 200 {"ok":true} (PBKDF2 verify works on Workers)')
} else {
  findings.push(`POST /api/auth/login failed: status=${r.status}, body=${r.body?.slice(0, 300)}`)
  console.error(`   ✗ POST /api/auth/login → ${r.status}: ${r.body?.slice(0, 200)}`)
}

// Test 2b: owner login (feeds Test 4 — the usage analytics endpoint)
const ownerLogin = await fetchApi('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ login: 'workers-owner@hibana.local', password: 'workers-test-123' }),
})
const ownerCookie = String(ownerLogin.headers?.get?.('set-cookie') || '').split(';')[0]
if (ownerLogin.status === 200 && ownerCookie.startsWith('__Host-hibana_session=')) {
  console.log('   ✓ POST /api/auth/login (owner) → 200 (session cookie captured)')
} else {
  findings.push(`owner login failed: status=${ownerLogin.status}`)
  console.error(`   ✗ owner login → ${ownerLogin.status}`)
}

// Test 3: login page renders
r = await fetchApi('/login.html')
if (r.status === 200 && r.body.includes('Sign in')) {
  console.log('   ✓ GET /login.html → 200 (HTML renders)')
} else {
  findings.push(`GET /login.html failed: status=${r.status}`)
  console.error(`   ✗ GET /login.html → ${r.status}`)
}

// Test 4: admin usage analytics endpoint (2026-09-12 — added after the D1 compound-SELECT
// limit 500'd the 10-term UNION ALL live on the deployed worker while node:sqlite accepted
// it. This is the runtime-parity canary for every SQL the admin console runs.)
if (ownerCookie) {
  r = await fetchApi('/api/admin/usage', { headers: { Cookie: ownerCookie } })
  let usageOk = r.status === 200
  if (usageOk) {
    try {
      const body = JSON.parse(r.body)
      usageOk = Array.isArray(body.features) && body.features.length >= 15 && Array.isArray(body.daily) && body.daily.length === 14
    } catch { usageOk = false }
  }
  if (usageOk) {
    console.log('   ✓ GET /api/admin/usage → 200 (features + 14-day histogram work on the Workers runtime)')
  } else {
    findings.push(`GET /api/admin/usage failed on Workers runtime: status=${r.status}, body=${r.body?.slice(0, 300)}`)
    console.error(`   ✗ GET /api/admin/usage → ${r.status}: ${r.body?.slice(0, 200)}`)
  }
}

// Test 5 (Phase 1): cross-user isolation on the Workers runtime — the D1 side of the
// M1 milestone ("isolation suite passes on both runtimes"). Also the runtime-parity
// canary for the Phase 1 upsert fix: the canvas sync ON CONFLICT ... DO UPDATE ... WHERE
// arm must parse + execute on D1's SQLite, and a foreign element id must stay inert.
const isoLogin = async (email) => {
  const res = await fetchApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login: email, password: 'workers-test-123' }),
  })
  return String(res.headers?.get?.('set-cookie') || '').split(';')[0]
}
const cookieA = await isoLogin('workers-iso-a@hibana.local')
const cookieB = await isoLogin('workers-iso-b@hibana.local')
if (cookieA && cookieB) {
  console.log('   ✓ isolation users logged in (A + B)')
} else {
  findings.push('isolation users could not log in')
  console.error('   ✗ isolation user login failed')
}

if (cookieA && cookieB) {
  let isoOk = true
  // A's project list never contains B's project
  r = await fetchApi('/api/projects', { headers: { Cookie: cookieA } })
  const aList = r.status === 200 && !r.body.includes('ISO-B-SECRET-PROJECT')
  isoOk = isoOk && aList
  console.log(`   ${aList ? '✓' : '✗'} A's /api/projects has no B rows`)

  // A cannot read/patch/delete B's project by id
  const bId = bprojId
  for (const [method, path] of [['GET', `/api/projects/${bId}`], ['PATCH', `/api/projects/${bId}`], ['DELETE', `/api/projects/${bId}`]]) {
    const res = await fetchApi(path, { method, headers: { Cookie: cookieA }, ...(method === 'PATCH' ? { body: JSON.stringify({ title: 'hacked' }) } : {}) })
    const blocked = res.status === 404 || res.status === 403
    isoOk = isoOk && blocked
    console.log(`   ${blocked ? '✓' : '✗'} A ${method} B's project → ${res.status}`)
  }

  // A's canvas is empty; A cannot see B's element
  r = await fetchApi('/api/canvas/full', { headers: { Cookie: cookieA } })
  const aCanvasEmpty = r.status === 200 && !r.body.includes('ISO-B-SECRET-NOTE')
  isoOk = isoOk && aCanvasEmpty
  console.log(`   ${aCanvasEmpty ? '✓' : '✗'} A's /api/canvas/full has no B elements`)

  // THE AP-3 canary: A syncs B's element id with newer stamps — B's element must survive
  const newer = new Date(Date.now() + 60_000).toISOString()
  r = await fetchApi('/api/canvas/sync', {
    method: 'POST', headers: { Cookie: cookieA },
    body: JSON.stringify({ elements: [{ id: belemId, type: 'note', x: 99, y: 99, content: 'A-WAS-HERE', z_index: 0, deleted: 1, updated_at: newer }] }),
  })
  const syncRan = r.status === 200
  r = await fetchApi('/api/canvas/full', { headers: { Cookie: cookieB } })
  const bSurvives = r.status === 200 && r.body.includes('ISO-B-SECRET-NOTE') && !r.body.includes('A-WAS-HERE')
  isoOk = isoOk && syncRan && bSurvives
  console.log(`   ${syncRan && bSurvives ? '✓' : '✗'} canvas sync conflict arm is user-scoped on D1 (B's element intact after A's foreign-id sync)`)

  // A's search never returns B's content
  r = await fetchApi('/api/search?q=ISO-B-SECRET', { headers: { Cookie: cookieA } })
  const searchClean = r.status === 200 && !r.body.includes('ISO-B-SECRET-PROJECT')
  isoOk = isoOk && searchClean
  console.log(`   ${searchClean ? '✓' : '✗'} A's search has no B hits`)

  // A's export never contains B's project
  r = await fetchApi('/api/export?format=json', { headers: { Cookie: cookieA } })
  const exportClean = r.status === 200 && !r.body.includes('ISO-B-SECRET-PROJECT')
  isoOk = isoOk && exportClean
  console.log(`   ${exportClean ? '✓' : '✗'} A's export has no B data`)

  // A (member) cannot touch admin routes
  for (const [method, path] of [['GET', '/api/admin/users'], ['GET', '/api/admin/errors'], ['POST', '/api/admin/email']]) {
    const res = await fetchApi(path, { method, headers: { Cookie: cookieA }, ...(method === 'POST' ? { body: JSON.stringify({ to: 'x@x.dev', subject: 's', body: 'b' }) } : {}) })
    const blocked = res.status === 403 || res.status === 404
    isoOk = isoOk && blocked
    console.log(`   ${blocked ? '✓' : '✗'} member A ${method} ${path} → ${res.status}`)
  }

  if (!isoOk) findings.push('cross-user isolation FAILED on the Workers runtime')
  console.log(isoOk ? '   ✓ cross-user isolation suite PASSED on the Workers runtime (D1)' : '   ✗ cross-user isolation FAILED')
}

// Test 6 (Phase 2, AUDIT AP-20): D1 caps a single prepared statement at 100 bound
// parameters (workerd D1_ERROR "too many SQL variables"; node:sqlite has no cap, so the
// vitest suite can NEVER see this class). The canvas offline-sync schema allows 500
// elements per POST, so a >99-element sync used to 500 on Workers — and the client's
// 400-drop rule then silently discarded the whole offline batch. This is the
// runtime-parity canary for every chunked IN() site fixed in Phase 2.
if (ownerCookie) {
  const stamp = new Date().toISOString()
  const bigBatch = Array.from({ length: 120 }, (_, i) => ({
    id: crypto.randomUUID(), type: 'note', x: i, y: i, content: `AP-20 element ${i}`,
    z_index: 0, updated_at: stamp,
  }))
  r = await fetchApi('/api/canvas/sync', {
    method: 'POST', headers: { Cookie: ownerCookie },
    body: JSON.stringify({ elements: bigBatch }),
  })
  let bigOk = r.status === 200
  if (bigOk) {
    try { bigOk = Array.isArray(JSON.parse(r.body).applied) && JSON.parse(r.body).applied.length === 120 } catch { bigOk = false }
  }
  if (bigOk) {
    console.log('   ✓ POST /api/canvas/sync with 120 elements → 200 (chunked IN() stays under D1\'s 100-param cap)')
  } else {
    findings.push(`120-element canvas sync failed on Workers runtime (D1 param cap): status=${r.status}, body=${r.body?.slice(0, 300)}`)
    console.error(`   ✗ 120-element canvas sync → ${r.status}: ${r.body?.slice(0, 200)}`)
  }
  // Clean the probe elements out (tombstone + the 7-day sweep handles content; hard-clear here)
  const wipe = bigBatch.map((e) => ({ ...e, deleted: 1, updated_at: new Date().toISOString() }))
  await fetchApi('/api/canvas/sync', { method: 'POST', headers: { Cookie: ownerCookie }, body: JSON.stringify({ elements: wipe }) })
}

// Test 7 (Phase 2): D1 foreign-key enforcement parity — the trash purge relies on
// ON DELETE CASCADE for project children. If workerd ran FK-off (as an old in-repo
// note claimed), purged projects would orphan child rows on Workers only. Settled
// empirically every run via the real API flow: create → child task → soft-delete →
// purge → the child must be unreachable (search) and the purge must succeed.
if (ownerCookie) {
  let fkOk = false
  const mk = await fetchApi('/api/projects', { method: 'POST', headers: { Cookie: ownerCookie }, body: JSON.stringify({ title: 'AP20-FK-PROBE' }) })
  if (mk.status === 201) {
    let pid = null
    try { pid = JSON.parse(mk.body).id ?? null } catch { pid = null }
    if (pid) {
      const tk = await fetchApi(`/api/projects/${pid}/tasks`, { method: 'POST', headers: { Cookie: ownerCookie }, body: JSON.stringify({ title: 'AP20FKTASKSENTINEL' }) })
      await fetchApi(`/api/projects/${pid}`, { method: 'DELETE', headers: { Cookie: ownerCookie } })
      const purge = await fetchApi('/api/settings/trash/empty', { method: 'POST', headers: { Cookie: ownerCookie } })
      const sr = await fetchApi('/api/search?q=AP20FKTASKSENTINEL', { headers: { Cookie: ownerCookie } })
      fkOk = purge.status === 200 && tk.status === 201 && sr.status === 200 && !sr.body.includes('AP20FKTASKSENTINEL')
    }
  }
  if (fkOk) {
    console.log('   ✓ trash purge on Workers: purged project + child task unreachable (CASCADE parity)')
  } else {
    findings.push('trash purge / FK CASCADE parity check failed on the Workers runtime')
    console.error('   ✗ trash purge / FK CASCADE parity check failed')
  }
}

// Step 5: cleanup
console.log('\n5. Stopping wrangler dev...')
killWranglerTree()
await new Promise((r) => setTimeout(r, 500))

// Report
console.log('')
if (findings.length === 0) {
  console.log('✓ All Workers-runtime smoke tests PASSED')
  console.log('  (PBKDF2 verify + login flow + page render work on the Workers runtime)')
  process.exit(0)
} else {
  console.error(`✗ ${findings.length} Workers-runtime smoke test(s) FAILED:`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('\nWorkers-runtime log (last 30 lines):')
  console.error(output.join('').slice(-2000))
  process.exit(1)
}
