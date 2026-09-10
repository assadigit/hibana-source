// One-off local dev seed: creates a known login for QA in the local SQLite DB.
// Run: node --import tsx scripts/seed-local-user.ts
// NOT for prod. Mirrors src/auth/password.ts (PBKDF2 600k, SHA-256).
import { randomBytes, randomUUID } from 'node:crypto'

const ITERATIONS = 600_000
const enc = new TextEncoder()

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
}

const dbPath = process.env.DB_PATH ?? new URL('../data/hibana.db', import.meta.url).pathname
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(dbPath)

const email = 'ali@hibana.local'
const username = 'ali'
const password = 'hibana123'

// Remove any prior test user (idempotent re-seed), cascade cleans sessions.
try { db.exec(`DELETE FROM users WHERE email = '${email}'`) } catch {}

const hash = await hashPassword(password)
const now = new Date().toISOString()
const id = randomUUID()
db.exec(
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at)
   VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'Asia/Tehran', '${now}')`,
)

db.close()
console.log(`Local test user ready — email: ${email}  password: ${password}  (db: ${dbPath})`)
