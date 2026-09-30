// S180 QA seed — dashboard Quick Notebook + resume round.
// Mirrors e2e/notebook.spec.ts's beforeAll (verified owner user), plus:
//   - 8 quick notes (5 visible in the compact row + beyond-cap View all (N))
//   - 2 projects (Move-to / attach targets + resume realism)
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const TEST_EMAIL = 'e2e-s180@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = process.env.QA_DB || '/tmp/hibana-s180.db'
const USER_ID = 's180-user-' + randomBytes(8).toString('hex')

const ITERATIONS = 100_000
const salt = randomBytes(16)
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
const toB64 = (buf) => Buffer.from(buf).toString('base64')
const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
const now = Date.now()
const iso = (msAgo) => new Date(now - msAgo).toISOString()

const db = new DatabaseSync(DB)
db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
db.exec(`DELETE FROM quick_notes WHERE user_id LIKE 's180-user-%'`)
db.exec(`DELETE FROM projects WHERE user_id LIKE 's180-user-%'`)
db.exec(
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
   VALUES ('${USER_ID}', 'e2e-s180', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${iso(86400000 * 30)}', '${iso(86400000 * 30)}')`,
)
db.exec(
  `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
   VALUES ('s180-proj-alpha', '${USER_ID}', 'Alpha website', '', 'personal', 'developing', 0, '${iso(86400000 * 12)}', '${iso(3600000 * 8)}')`,
)
db.exec(
  `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
   VALUES ('s180-proj-beta', '${USER_ID}', 'Beta research', '', 'personal', 'planning', 1, '${iso(86400000 * 6)}', '${iso(3600000 * 20)}')`,
)

// 8 notes: newest first by sort_order DESC (the S180 cap shows the 5 highest).
const notes = [
  { id: 's180-n1', kind: 'note', title: '', content: 'Call the dentist about the appointment reschedule', color: 'yellow', ms: 3600000 * 2 },
  { id: 's180-n2', kind: 'note', title: '', content: 'Landlord said the repair team comes Thursday morning — be home', color: 'yellow', ms: 3600000 * 9 },
  { id: 's180-n3', kind: 'note', title: '', content: 'Book idea: a quiet guide to keeping a small notebook every day, even when nothing happens', color: 'green', ms: 86400000 * 1 },
  { id: 's180-n4', kind: 'note', title: '', content: 'Groceries: olive oil, bread, tomatoes, coffee filters', color: 'yellow', ms: 86400000 * 2 },
  { id: 's180-n5', kind: 'note', title: '', content: 'Ask Nima which microphone he uses for the podcast', color: 'pink', ms: 86400000 * 3 },
  { id: 's180-n6', kind: 'note', title: '', content: 'Draft the client-work reminder email template', color: 'yellow', ms: 86400000 * 5 },
  { id: 's180-n7', kind: 'list', title: 'Launch checklist', content: JSON.stringify([
    { id: 'i1', t: 'Write the changelog', d: 1 },
    { id: 'i2', t: 'Ping the translator', d: 0 },
    { id: 'i3', t: 'Record the demo clip', d: 0 },
  ]), color: 'blue', ms: 86400000 * 7 },
  { id: 's180-n8', kind: 'note', title: '', content: 'Old note beyond the cap — lives in the archive only', color: 'yellow', ms: 86400000 * 12 },
]
notes.forEach((n, i) => {
  db.exec(
    `INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, deleted_at, sort_order, color, note_date, sticky, done, created_at, updated_at)
     VALUES ('${n.id}', '${USER_ID}', '${n.kind}', '${n.title.replace(/'/g, "''")}', '${n.content.replace(/'/g, "''")}', NULL, NULL, ${100 - i}, '${n.color}', NULL, 0, 0, '${iso(n.ms)}', '${iso(n.ms)}')`,
  )
})
db.close()
console.log('seeded', TEST_EMAIL, 'user', USER_ID)
