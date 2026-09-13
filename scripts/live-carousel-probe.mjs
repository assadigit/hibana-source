// S42 live probe (prod or --dev): the stage-carousel overlay structure round-trip on the
// REAL worker. Pattern: S38/S40/S41's D1-discipline probe — create user+session via
// wrangler --file (WRITES always through real .mjs files), exercise the live fragment,
// then purge + parity. Values never printed; run: node scripts/live-carousel-probe.mjs [--dev]
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
// the session row we insert; the password is never used).
const sql = `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
VALUES ('${id}', 'probe-s42', 'probe-s42@test.local', 'pbkdf2$1$AAAA$AAAA', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}');
INSERT INTO sessions (id, user_id, created_at, expires_at)
VALUES ('${sid}', '${id}', '${now}', '2999-01-01T00:00:00.000Z');`
const tmp = `/tmp/s42-probe-${id.slice(0, 8)}.sql`
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
  // Two projects in different stages so the carousel actually pages on the fragment.
  const projects = []
  for (const st of ['investigating', 'doing']) {
    const res = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: jar, body: JSON.stringify({ title: `probe s42 carousel ${st}` }) })
    const body = await res.json()
    if (body?.id) {
      projects.push(body.id)
      await fetch(`${BASE}/api/projects/${body.id}`, { method: 'PATCH', headers: jar, body: JSON.stringify({ status: st }) })
    }
  }
  check('seeded 2 probe projects', projects.length === 2)

  // The dashboard fragment: the S42 overlay structure (arrows AFTER the track, inside
  // .stat-stage — the old flank layout had them BEFORE the track).
  const dash = await fetch(`${BASE}/api/dashboard`, { headers: { ...jar, 'HX-Request': 'true' } })
  const html = await dash.text()
  check('GET /api/dashboard fragment → 200', dash.status === 200)
  const stageAt = html.indexOf('stat-stage')
  const trackAt = html.indexOf('data-stat-track')
  const prevAt = html.indexOf('data-stat-prev')
  const nextAt = html.indexOf('data-stat-next')
  const dotsAt = html.indexOf('data-stat-dots')
  check('stat-stage anchor present', stageAt > -1)
  check('track + both handles + dots present', trackAt > -1 && prevAt > -1 && nextAt > -1 && dotsAt > -1)
  check('overlay order: stage < track < prev < next', stageAt < trackAt && trackAt < prevAt && prevAt < nextAt)

  // The deployed shell: wired (hashed dist css) in prod, ?v= form on the local Node
  // runtime — both are the cache-busted reference; assert either.
  const shell = await (await fetch(`${BASE}/dashboard.html`, { headers: { ...jar } })).text()
  const shellCss = (shell.match(/(?:css\/dashboard\.css\?v=7|dist\/dashboard\.[a-f0-9]+\.css)/) ?? [])[0]
  check('shell references the S42 dashboard css (wired or ?v=7)', Boolean(shellCss), shellCss || 'no match')
  const css = await (await fetch(`${BASE}/css/dashboard.css?v=7`)).text()
  check('dashboard.css?v=7 carries the overlay rules', css.includes('.stat-stage') && css.includes('.stat-carousel.at-start .stat-arrow[data-stat-prev]'))
  const sw = await (await fetch(`${BASE}/sw.js`)).text()
  check('sw is hibana-v341', sw.includes('hibana-v341'))

  // Purge the probe projects first (hard-delete; the user purge below cascades anyway,
  // but explicit keeps the history log tidy).
  for (const pid of projects) await fetch(`${BASE}/api/projects/${pid}`, { method: 'DELETE', headers: jar }).catch(() => {})
} finally {
  // Purge the probe user (cascade: sessions + projects), then parity.
  const purge = `/tmp/s42-purge-${id.slice(0, 8)}.sql`
  writeFileSync(purge, `DELETE FROM users WHERE id = '${id}';`)
  try {
    wr(['d1', 'execute', DB, '--remote', '--file', purge])
  } finally {
    unlinkSync(purge)
  }
  const raw = wr(['d1', 'execute', DB, '--remote', '--command', "SELECT COUNT(*) AS n FROM users WHERE email = 'probe-s42@test.local'"])
  const start = raw.indexOf('{')
  const left = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1)).results[0].n
  check('probe user purged (cascade)', left === 0)
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nS42 live probe: ${results.length}/${results.length} PASS (${IS_DEV ? 'dev' : 'prod'})` : `\nS42 live probe: ${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
