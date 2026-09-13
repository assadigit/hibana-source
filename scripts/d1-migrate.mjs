// d1-migrate.mjs — applies ONE numbered migration to a REMOTE D1 database and
// registers it in `d1_migrations` (the bookkeeping table the Workers runtime
// reads; the Node runner mirrors it via `_migrations` — see src/routes/health.ts).
// The D1-discipline rule: remote writes go through `wrangler d1 execute --file`,
// never inline SQL in a double-quoted shell.
//
// Usage:
//   node scripts/d1-migrate.mjs --db pm-app-dev  --name 0054_screenshot_pin_bytes
//   node scripts/d1-migrate.mjs --db pm-app-prod --name 0054_screenshot_pin_bytes
//
// Creds come from .secrets.env via scripts/lib.mjs (values never printed).
// Idempotency guard: refuses to run if the name is already in d1_migrations.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { secrets } from './lib.mjs'

const args = process.argv.slice(2)
const dbIdx = args.indexOf('--db')
const nameIdx = args.indexOf('--name')
const db = dbIdx >= 0 ? args[dbIdx + 1] : null
const name = nameIdx >= 0 ? args[nameIdx + 1] : null
if (!db || !name) {
  console.error('usage: node scripts/d1-migrate.mjs --db <pm-app-dev|pm-app-prod> --name <0054_screenshot_pin_bytes>')
  process.exit(1)
}
const sqlPath = join(process.cwd(), 'migrations', `${name}.sql`)
if (!existsSync(sqlPath)) {
  console.error(`FATAL: migrations/${name}.sql not found`)
  process.exit(1)
}

const sec = secrets()
const CF_TOKEN = sec.CLOUDFLARE_API_TOKEN
const CF_ACCOUNT = sec.CLOUDFLARE_ACCOUNT_ID
if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error('FATAL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID missing from .secrets.env')
  process.exit(1)
}

const wr = (wrArgs) =>
  execFileSync('npx', ['wrangler', ...wrArgs], {
    cwd: process.cwd(),
    env: { ...process.env, CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  }).toString()

const rowsJson = (raw) => {
  const start = raw.indexOf('[')
  if (start < 0) return []
  const parsed = JSON.parse(raw.slice(start))
  const rows = []
  for (const batch of Array.isArray(parsed) ? parsed : [parsed]) rows.push(...(batch.results ?? []))
  return rows
}

// 1. idempotency check (read → --command, fixed in-process string)
const known = rowsJson(wr(['d1', 'execute', db, '--remote', '--command', `SELECT name FROM d1_migrations WHERE name = '${name}'`, '--json', '-y']))
if (known.length) {
  console.log(`SKIP: ${name} already registered in ${db} (applied ${known[0].applied_at ?? 'earlier'})`)
  process.exit(0)
}

// 2. apply the migration file (write → --file)
console.log(`applying migrations/${name}.sql to ${db} (remote)…`)
wr(['d1', 'execute', db, '--remote', '--file', sqlPath, '-y'])
console.log('  statements executed')

// 3. register in d1_migrations (write → --file with the fixed INSERT)
const reg = `INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', '${new Date().toISOString()}');`
const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const dir = mkdtempSync(join(tmpdir(), 'hibana-d1-mig-'))
try {
  const file = join(dir, 'register.sql')
  writeFileSync(file, reg)
  wr(['d1', 'execute', db, '--remote', '--file', file, '-y'])
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`DONE: ${name} applied + registered on ${db}`)
console.log(`  migration bytes: ${readFileSync(sqlPath, 'utf8').length}`)
