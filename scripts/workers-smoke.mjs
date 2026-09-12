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
const seedSql = `DELETE FROM users WHERE email = 'workers-test@hibana.local';
INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}', 'workerstest', 'workers-test@hibana.local', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}', '${now}');`
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
    return { status: res.status, body: await res.text() }
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

// Test 3: login page renders
r = await fetchApi('/login.html')
if (r.status === 200 && r.body.includes('Sign in')) {
  console.log('   ✓ GET /login.html → 200 (HTML renders)')
} else {
  findings.push(`GET /login.html failed: status=${r.status}`)
  console.error(`   ✗ GET /login.html → ${r.status}`)
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
