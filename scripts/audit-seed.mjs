// Session-9 audit helper: verify the seeded admin + create the e2e test user directly
// in the LOCAL SQLite DB (local scratch DB only — never touches D1). Uses node:sqlite
// like src/db/sqlite.ts. PBKDF2 matches src/auth/password.ts (SHA-256, 600k, b64 salt).
// Idempotent.
import { DatabaseSync } from 'node:sqlite'
import { pbkdf2, randomBytes } from 'node:crypto'

const db = new DatabaseSync('/home/z/my-project/hibana-work/data/hibana.db')

const up = db.prepare(
  "UPDATE users SET email_verified_at = COALESCE(email_verified_at, '2026-09-14T00:00:00.000Z') WHERE username LIKE 'admin-%'"
).run()
console.log('admin verified rows:', up.changes)

const exists = db.prepare('SELECT id FROM users WHERE email = ?').get('e2e@test.local')
if (!exists) {
  const id = crypto.randomUUID()
  const salt = randomBytes(16) // raw bytes
  const hash = await new Promise((res, rej) =>
    pbkdf2('E2eAudit#2026', salt, 600000, 32, 'sha256', (e, d) => (e ? rej(e) : res(d))))
  const saltB64 = salt.toString('base64')
  const hashB64 = hash.toString('base64')
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at)
     VALUES (?, ?, ?, ?, 'member', 'fa', 'shamsi', 'Asia/Tehran', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`
  ).run(id, 'e2e-audit', 'e2e@test.local', `pbkdf2$600000$${saltB64}$${hashB64}`)
  console.log('e2e user created:', id)
} else {
  console.log('e2e user exists:', exists.id)
}
db.close()
