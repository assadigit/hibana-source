// S127 QA seed — mirrors e2e/resume-continue.spec.ts's beforeAll (user + one project).
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const TEST_EMAIL = 'e2e-s127@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const USER_ID = randomBytes(16).toString('hex')

const ITERATIONS = 100_000
const salt = randomBytes(16)
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
const toB64 = (buf) => Buffer.from(buf).toString('base64')
const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
const now = new Date().toISOString()

const db = new DatabaseSync(DB)
db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
db.exec(
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
   VALUES ('${USER_ID}', 'e2e-s127', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
)
db.exec(
  `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
   VALUES ('s127-hero-project', '${USER_ID}', 'Hibana', '', 'personal', 'developing', 0, '${now}', '${now}')`,
)
db.close()
console.log('seeded', TEST_EMAIL)
