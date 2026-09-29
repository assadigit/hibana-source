// S174 QA seed — a fresh owner + project in the local QA DB (mirrors qa/seed-qa-user.mjs).
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const TEST_EMAIL = 's174-qa@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-qa.db'
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
db.exec(`DELETE FROM projects WHERE id = 's174-qa-project'`)
db.exec(
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
   VALUES ('${USER_ID}', 's174-qa', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
)
db.exec(
  `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
   VALUES ('s174-qa-project', '${USER_ID}', 'QA Project', '', 'personal', 'developing', 0, '${now}', '${now}')`,
)
db.close()
console.log('seeded', TEST_EMAIL, '->', USER_ID)
