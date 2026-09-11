// One-off local dev seed: creates a known login for QA in the local SQLite DB.
// Run: node --import tsx scripts/seed-local-user.ts
// NOT for prod. Imports the canonical hashPassword() from src/auth/password.ts so the
// hash format always matches the login verifier (rule 6), and sets email_verified_at so
// the email-verification gate (0015) passes without a real email round-trip.
import { randomUUID } from 'node:crypto'
import { hashPassword } from '../src/auth/password'

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
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
   VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'Asia/Tehran', '${now}', '${now}')`,
)

db.close()
console.log(`Local test user ready — email: ${email}  password: ${password}  (db: ${dbPath})`)
