#!/usr/bin/env node
// d1-table-digest.mjs — byte-level fingerprint of a REMOTE D1 database (S57).
//
// The user constraint this serves: "not even 1 byte can be removed/missed" by a
// migration. A dump diff is eyeball-dependent; this script produces a canonical,
// order-independent per-table digest that the verifier (d1-verify-migration.mjs)
// can PROVE identical before/after a migration:
//
//   1. Table list: sqlite_master (type='table', no sqlite_* shadows), sorted.
//   2. Per table: `SELECT *` via `wrangler d1 execute --remote --command --json`
//      (READ-ONLY; the command string is built in-process from the table list —
//      never from user input, per the D1 discipline in d1-migrate.mjs).
//   3. Canonical form: each row's keys sorted → JSON.stringify; rows sorted
//      lexicographically; joined with '\n'. sha256 + count + byte length.
//      (Order-independent: D1 has no row-order guarantee, and two reads of the
//      same data must fingerprint identically.)
//   4. The migration bookkeeping tables (_migrations / d1_migrations) additionally
//      record their sorted migration-NAME list, so the verifier can assert the
//      migration added EXACTLY one registration row and nothing else.
//
// Usage:
//   node scripts/d1-table-digest.mjs --db pm-app-dev --out digest.json
//
// Creds: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from env (values never printed).
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const db = argOf('--db')
const out = argOf('--out')
if (!db || !out) {
  console.error('usage: node scripts/d1-table-digest.mjs --db <pm-app-dev> --out <digest.json>')
  process.exit(1)
}
if (db === 'pm-app-prod') {
  console.error('REFUSED: this digest helper is dev-verify tooling — it is read-only, but the')
  console.error('operator decided its usage stays on non-prod databases. Prod digests are')
  console.error('taken by the owner directly (see Changelogs.md §4 migration ritual).')
  process.exit(1)
}

const env = { ...process.env }
if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('FATAL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID must be in the environment')
  process.exit(1)
}

/** Run a read-only query against the remote D1 and return its rows. */
const query = async (sql) => {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--command', sql, '--json', '-y'], {
    env,
    timeout: 180_000,
    maxBuffer: 256 * 1024 * 1024,
  }).toString()
  const start = raw.indexOf('[') >= 0 ? raw.indexOf('[') : raw.indexOf('{')
  if (start < 0) throw new Error(`unexpected wrangler output for: ${sql.slice(0, 60)}…`)
  const parsed = JSON.parse(raw.slice(start))
  const batches = Array.isArray(parsed) ? parsed : [parsed]
  const rows = []
  for (const batch of batches) rows.push(...(batch.results ?? []))
  return rows
}

/** Canonical, order-independent fingerprint of a row set. */
const digestRows = (rows) => {
  const canonical = rows
    .map((row) => {
      const sorted = {}
      for (const key of Object.keys(row).sort()) sorted[key] = row[key]
      return JSON.stringify(sorted)
    })
    .sort()
  const joined = canonical.join('\n')
  return {
    count: rows.length,
    bytes: Buffer.byteLength(joined, 'utf8'),
    sha256: createHash('sha256').update(joined, 'utf8').digest('hex'),
  }
}

console.log(`digesting ${db} (remote, read-only)…`)
const tableRows = await query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
// FTS5 virtual tables are derived data (rebuild from triggers — the backup-audit
// classification) and are recorded by name only, not fingerprinted. Their SHADOW
// tables (x_data, x_idx, …) are real tables and DO get fingerprinted.
const tables = []
const virtualTables = []
for (const r of tableRows) {
  if (String(r.sql ?? '').toUpperCase().includes('VIRTUAL TABLE')) virtualTables.push(String(r.name))
  else tables.push(String(r.name))
}
console.log(`real tables (${tables.length}): ${tables.join(', ')}`)
if (virtualTables.length) console.log(`virtual tables (recorded, not fingerprinted): ${virtualTables.join(', ')}`)

const outJson = {
  database: db,
  taken_at: new Date().toISOString(),
  wrangler: 'd1 execute --remote --json (read-only)',
  tables: {},
  virtual_tables: virtualTables,
  migrations: null, // sorted migration names from whichever bookkeeping table exists
}

for (const t of tables) {
  const rows = await query(`SELECT * FROM "${t}"`)
  outJson.tables[t] = digestRows(rows)
  if (t === 'd1_migrations' || t === '_migrations') {
    outJson.migrations = rows.map((r) => String(r.name)).sort()
  }
  console.log(`  ${t}: ${outJson.tables[t].count} rows · sha256 ${outJson.tables[t].sha256.slice(0, 12)}…`)
}

if (!outJson.migrations) {
  console.warn('WARN: no migration bookkeeping table found (fresh database?)')
}

writeFileSync(out, JSON.stringify(outJson, null, 2) + '\n')
console.log(`DONE: ${out} (${tables.length} tables fingerprinted)`)
