// S41 live probe (prod): the folder-emoji fragment round-trip on the REAL worker.
// Pattern: S38/S40's D1-discipline probe — create user+session via wrangler --file
// (WRITES always through real .mjs files), exercise the live API, then purge + parity.
// Values never printed; run: node scripts/live-emoji-probe.mjs [--dev]
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { secrets } from './lib.mjs'

const IS_DEV = process.argv.includes('--dev')
const BASE = IS_DEV ? 'https://hibana.aliassadi.workers.dev' : 'https://hibana.ir'
const DB = IS_DEV ? 'pm-app-dev' : 'pm-app-prod'
const sec = secrets()
const env = { ...process.env, CLOUDFLARE_API_TOKEN: sec.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: sec.CLOUDFLARE_ACCOUNT_ID }

const wr = (args) => execFileSync('npx', ['wrangler', ...args, '--json'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }).toString()

const id = randomUUID()
const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
// sessions.id = sha256(token) — only the hash is stored (sessions.ts rule); the raw
// token rides the cookie.
const { createHash } = await import('node:crypto')
const sid = createHash('sha256').update(token).digest('hex')
const now = new Date().toISOString()
// A throwaway probe user with a throwaway password (no valid hash — login happens via
// the session row we insert, exactly as S38/S40 did; the password is never used).
const sql = `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}', 'probe-s41', 'probe-s41@test.local', 'pbkdf2$1$AAAA$AAAA', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}');
INSERT INTO sessions (id, user_id, created_at, expires_at)
VALUES ('${sid}', '${id}', '${now}', '2999-01-01T00:00:00.000Z');`
const tmp = `/tmp/s41-probe-${id.slice(0, 8)}.sql`
writeFileSync(tmp, sql)
try {
  wr(['d1', 'execute', DB, '--remote', '--file', tmp])
} finally {
  unlinkSync(tmp)
}

const results = []
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

try {
  const jar = { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: BASE }
  // 1. Create a folder WITH an emoji through the live API.
  const create = await fetch(`${BASE}/api/projects/sparks/folders`, {
    method: 'POST', headers: jar, body: JSON.stringify({ name: 'probe emoji folder', icon: '🚀' }),
  })
  const created = await create.json()
  check('POST folder with icon → 201', create.status === 201, `icon=${created?.folder?.icon}`)
  check('created folder carries the emoji', created?.folder?.icon === '🚀')

  // 2. The home fragment renders the emoji on the grid card.
  const home = await fetch(`${BASE}/api/projects?status=spark&view=cards`, { headers: { ...jar, 'HX-Request': 'true' } })
  const homeHtml = await home.text()
  check('home fragment renders spark-folder-emoji', homeHtml.includes('spark-folder-emoji') && homeHtml.includes('🚀'))
  check('home fragment stamps data-sf-icon', homeHtml.includes('data-sf-icon="🚀"'))

  // 3. A folder view carries the bar + the HOME chip + the emoji chip.
  if (created?.folder?.id) {
    const inFolder = await fetch(`${BASE}/api/projects?status=spark&view=cards&folder=${created.folder.id}`, { headers: { ...jar, 'HX-Request': 'true' } })
    const barHtml = await inFolder.text()
    check('folder view: bar + sf-emoji chip', barHtml.includes('sf-emoji') && barHtml.includes('🚀'))
    check('folder view: the «پوشه‌ها» home chip rides the bar', barHtml.includes('sf-home') && barHtml.includes('data-sf=""'))
  }

  // 4. Rename-only PATCH keeps the icon; icon:null clears it; plain text 400s.
  const fid = created?.folder?.id
  if (fid) {
    const rename = await fetch(`${BASE}/api/projects/sparks/folders/${fid}`, {
      method: 'PATCH', headers: jar, body: JSON.stringify({ name: 'probe emoji folder v2' }),
    })
    check('rename-only PATCH → 200', rename.status === 200)
    const folders = await (await fetch(`${BASE}/api/projects/sparks/folders`, { headers: jar })).json()
    check('rename kept the emoji', folders.folders?.[0]?.icon === '🚀')
    const clear = await fetch(`${BASE}/api/projects/sparks/folders/${fid}`, {
      method: 'PATCH', headers: jar, body: JSON.stringify({ name: 'probe emoji folder v2', icon: null }),
    })
    check('icon:null PATCH → 200', clear.status === 200)
    const bad = await fetch(`${BASE}/api/projects/sparks/folders/${fid}`, {
      method: 'PATCH', headers: jar, body: JSON.stringify({ name: 'x', icon: '<script>' }),
    })
    check('non-emoji icon → 400 (schema gate)', bad.status === 400)
  }
} finally {
  // Purge the probe user (cascade: sessions + folders), then parity.
  const purge = `/tmp/s41-purge-${id.slice(0, 8)}.sql`
  writeFileSync(purge, `DELETE FROM users WHERE id = '${id}';`)
  try {
    wr(['d1', 'execute', DB, '--remote', '--file', purge])
  } finally {
    unlinkSync(purge)
  }
  const raw = wr(['d1', 'execute', DB, '--remote', '--command', "SELECT COUNT(*) AS n FROM users WHERE email = 'probe-s41@test.local'"])
  const start = raw.indexOf('{')
  const left = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1)).results[0].n
  check('probe user purged (cascade)', left === 0)
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nS41 live probe: ${results.length}/${results.length} PASS (${IS_DEV ? 'dev' : 'prod'})` : `\nS41 live probe: ${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
