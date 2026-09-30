// S178 QA seed — the five-stage tree the advisor's mockup describes: projects in
// every stage (Planning / Up Next / Developing / On Hold / Operational), one
// branch project carrying board tasks (New ideas / Problems / Plans …) and one
// CHILDLESS project (the chevron-slot case), in EN + FA (RTL) owner accounts.
// Mirrors qa/seed-s174-qa.mjs (PBKDF2 hash, dedicated /tmp/hibana-qa.db).
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const DB = '/tmp/hibana-qa.db'
const ITERATIONS = 100_000
const now = new Date().toISOString()

const mkHash = async (pass) => {
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf) => Buffer.from(buf).toString('base64')
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
}

const seed = async (email, name, lang, uid) => {
  const db = new DatabaseSync(DB)
  db.exec(`DELETE FROM users WHERE email = '${email}'`)
  db.exec(`DELETE FROM dev_tasks WHERE project_id LIKE '${uid}-%'`)
  db.exec(`DELETE FROM projects WHERE user_id = '${uid}'`)
  const hash = await mkHash('e2e-password-123')
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${uid}', '${name}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // one branch project per interesting stage + the childless row
  const stages = [
    ['branch', 'developing', 'Hibana'],
    ['plain', 'operational', 'Scribo'],
    ['p1', 'planning', 'Atlas Notes'],
    ['p2', 'queued', 'Lumen Board'],
    ['p3', 'awaiting_dev', 'Quill Sync'],
  ]
  for (const [key, status, title] of stages) {
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, sort_order, created_at, updated_at)
       VALUES ('${uid}-${key}', '${uid}', '${title}', '${status}', 0, '${now}', '${now}')`,
    )
  }
  // the branch's aspect tasks: 2 ideas, 1 problem, 1 plan (sub-groups + leaves)
  const tasks = [
    ['t1', 'idea', 'Offline-first drafts'],
    ['t2', 'idea', 'Keyboard-only capture'],
    ['t3', 'bug', 'Sync stalls on large canvases'],
    ['t4', 'planned', 'Ship the quiet sidebar'],
  ]
  for (const [key, status, title] of tasks) {
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${uid}-${key}', '${uid}-branch', '${title}', '${status}', 'medium', 0, '${now}')`,
    )
  }
  db.close()
  console.log('seeded', email, '->', uid, `(${lang})`)
}

await seed('s178-qa@test.local', 's178-qa', 'en', randomBytes(16).toString('hex'))
await seed('s178-qa-fa@test.local', 's178-qa-fa', 'fa', randomBytes(16).toString('hex'))
