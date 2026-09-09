import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'

// Q3 decision — super-admin bootstrap: an almost-unbrute-forceable login
// (`admin-<random>`) with a generated strong password. Same PBKDF2 format as the app
// (rule 6), inserted through the normal migration-compatible path.
//
//   npm run seed:admin        → writes to DEV database via wrangler
//   npm run seed:admin:prod   → writes to PROD database via wrangler
//   npm run seed:admin:node   → writes to local SQLite (DB_PATH env, non-Cloudflare deploy)

const PROD = process.argv.includes('--prod')
const NODE_MODE = process.argv.includes('--node')
const DB_NAME = PROD ? 'pm-app-prod' : 'pm-app-dev'

// --- generate credentials ---------------------------------------------------
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
let suffix = ''
for (const b of randomBytes(8)) suffix += alphabet[b % alphabet.length]
const username = `admin-${suffix}`
const password = randomBytes(32).toString('base64url')

// --- PBKDF2 hash identical to src/auth/password.ts --------------------------
const ITERATIONS = 100_000
const enc = new TextEncoder()
const salt = randomBytes(16)
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
const toB64 = (buf) => Buffer.from(buf).toString('base64')
const passwordHash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`

const now = new Date().toISOString()
const sql = `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at)
VALUES ('${randomUUID()}', '${username}', '${username}@local.invalid', '${passwordHash}', 'owner', 'en', 'gregorian', 'UTC', '${now}');`

// --- apply ------------------------------------------------------------------
if (NODE_MODE) {
  const { DatabaseSync } = await import('node:sqlite')
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'hibana.db')
  const db = new DatabaseSync(dbPath)
  db.exec(sql)
  db.close()
  console.log(`Applied to SQLite: ${dbPath}`)
} else {
  const tmp = join(tmpdir(), `hibana-seed-${Date.now()}.sql`)
  writeFileSync(tmp, sql)
  try {
    const r = spawnSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', tmp], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (r.status !== 0) process.exit(r.status ?? 1)
  } finally {
    unlinkSync(tmp)
  }
  console.log(`Applied to Cloudflare D1: ${DB_NAME}`)
}

console.log('\n=== Hibana super-admin created ===')
console.log(`Login    : ${username}`)
console.log(`Password : ${password}`)
console.log('\nSave these now — they are shown only once.')