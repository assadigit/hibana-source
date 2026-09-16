#!/usr/bin/env node
// d1-dump-tables.mjs — full SQL dump of a REMOTE D1 database, FTS5-aware (S57).
//
// WHY: `wrangler d1 export <db> --remote` REFUSES databases that contain virtual
// tables ("D1 Export error: cannot export databases with Virtual Tables (fts5)") —
// and Hibana's schema has carried FTS5 full-text indexes since 0004. This wrapper
// enumerates the REAL tables itself and exports exactly those via `--table` flags,
// writing a sidecar manifest of what was excluded.
//
// Virtual tables (projects_fts, changelogs_fts, …) and their FTS shadow rows are
// DERIVED data — they rebuild from the triggers the migrations recreate (the same
// classification the backup-audit drift guard uses). The dump's job is human-readable
// evidence of the REAL tables; the byte-level proof is d1-table-digest.mjs.
//
// Usage:
//   node scripts/d1-dump-tables.mjs --db pm-app-dev --output pre-migration.sql
//
// Creds: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from env (values never printed).
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const db = argOf('--db')
const output = argOf('--output')
if (!db || !output) {
  console.error('usage: node scripts/d1-dump-tables.mjs --db <pm-app-dev> --output <dump.sql>')
  process.exit(1)
}
if (db === 'pm-app-prod') {
  console.error('REFUSED: dev-verify tooling only — the owner runs prod dumps personally.')
  process.exit(1)
}
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('FATAL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID must be in the environment')
  process.exit(1)
}

const query = (sql) => {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--command', sql, '--json', '-y'], {
    timeout: 180_000,
    maxBuffer: 256 * 1024 * 1024,
  }).toString()
  const start = raw.indexOf('[') >= 0 ? raw.indexOf('[') : raw.indexOf('{')
  if (start < 0) throw new Error(`unexpected wrangler output for: ${sql.slice(0, 60)}…`)
  const parsed = JSON.parse(raw.slice(start))
  const rows = []
  for (const batch of Array.isArray(parsed) ? parsed : [parsed]) rows.push(...(batch.results ?? []))
  return rows
}

console.log(`enumerating tables of ${db} (remote, read-only)…`)
const rows = query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
const real = []
const virtual = []
for (const r of rows) {
  if (String(r.sql ?? '').toUpperCase().includes('VIRTUAL TABLE')) virtual.push(String(r.name))
  else real.push(String(r.name))
}
console.log(`real tables (${real.length}): ${real.join(', ')}`)
if (virtual.length) console.log(`virtual tables EXCLUDED (rebuild from triggers): ${virtual.join(', ')}`)

// One export invocation, one --table flag per real table (yargs array flag).
const wrArgs = ['d1', 'export', db, '--remote', '--output', output, '-y']
for (const t of real) wrArgs.push('--table', t)
console.log(`exporting ${real.length} tables to ${output}…`)
execFileSync('npx', ['wrangler', ...wrArgs], { timeout: 300_000, stdio: ['ignore', 'inherit', 'inherit'] })

// Sidecar manifest — what the dump contains and why the virtual tables are absent.
writeFileSync(`${output}.manifest.json`, JSON.stringify({
  database: db,
  taken_at: new Date().toISOString(),
  tool: 'scripts/d1-dump-tables.mjs (wrangler d1 export --table per real table)',
  exported_tables: real,
  excluded_virtual_tables: virtual,
  excluded_reason: 'FTS5 virtual tables cannot pass `wrangler d1 export` and are derived data — they rebuild from the migration-defined triggers (backup-audit classification).',
}, null, 2) + '\n')
console.log(`DONE: ${output} (+ ${output}.manifest.json)`)
