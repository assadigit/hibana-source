#!/usr/bin/env node
// d1-verify-migration.mjs — PROVE an applied migration harmed zero pre-existing bytes (S57).
//
// Compares two digests (scripts/d1-table-digest.mjs) taken around a migration and
// enforces the additive-migration contract the owner demands ("not even 1 byte can
// be removed/missed"):
//
//   R1  Every table in BEFORE must still exist in AFTER (nothing dropped).
//   R2  Every pre-existing table — EXCEPT the migration bookkeeping table — must have
//       the IDENTICAL count AND sha256 (not one row, one byte changed).
//   R3  The bookkeeping table's migration-name set must be exactly BEFORE ∪ {migration}
//       (one new registration row, nothing else).
//   R4  Any table present only in AFTER must be in the --allow-new list (the tables
//       this migration was declared to CREATE). Anything else appearing = FAIL.
//
// Exit 0 = proven safe (report written). Exit 1 = ANY violation (report written,
// full detail printed — the workflow fails loudly and the Time Travel bookmark is
// the recovery path).
//
// Usage:
//   node scripts/d1-verify-migration.mjs \
//     --before digest-before.json --after digest-after.json \
//     --migration 0057_notes_vault \
//     --allow-new note_folders,vault_notes \
//     --report integrity-report.md
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const beforePath = argOf('--before')
const afterPath = argOf('--after')
const migration = argOf('--migration')
const reportPath = argOf('--report') ?? 'integrity-report.md'
const allowNew = (argOf('--allow-new') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!beforePath || !afterPath || !migration) {
  console.error('usage: node scripts/d1-verify-migration.mjs --before <json> --after <json> --migration <name> [--allow-new t1,t2] [--report out.md]')
  process.exit(1)
}

const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))

const violations = []
const notes = []
const BOOKKEEPING = new Set(['d1_migrations', '_migrations'])

const beforeTables = Object.keys(before.tables).sort()
const afterTables = Object.keys(after.tables).sort()

// R1 — nothing dropped
const dropped = beforeTables.filter((t) => !(t in after.tables))
for (const t of dropped) violations.push(`R1 VIOLATION — table "${t}" existed BEFORE and is GONE after (data loss!)`)

// R2 — byte-identical pre-existing tables (except bookkeeping)
const unchanged = []
for (const t of beforeTables) {
  if (!(t in after.tables) || BOOKKEEPING.has(t)) continue
  const b = before.tables[t]
  const a = after.tables[t]
  if (b.count !== a.count || b.sha256 !== a.sha256) {
    violations.push(`R2 VIOLATION — table "${t}" CHANGED: before ${b.count} rows / sha256 ${b.sha256}, after ${a.count} rows / sha256 ${a.sha256}`)
  } else {
    unchanged.push({ table: t, count: b.count, sha256: b.sha256 })
  }
}

// R3 — bookkeeping grew by exactly the one migration registration
if (before.migrations && after.migrations) {
  const b = new Set(before.migrations)
  const a = new Set(after.migrations)
  const added = [...a].filter((m) => !b.has(m))
  const removed = [...b].filter((m) => !a.has(m))
  if (removed.length) violations.push(`R3 VIOLATION — migration registrations REMOVED: ${removed.join(', ')}`)
  if (added.length !== 1 || added[0] !== migration) {
    violations.push(`R3 VIOLATION — expected exactly one new registration ("${migration}"), found: [${added.join(', ')}]`)
  } else {
    notes.push(`bookkeeping: "${migration}" registered — the only bookkeeping change`)
  }
} else if (before.migrations || after.migrations) {
  violations.push('R3 VIOLATION — bookkeeping table appeared/disappeared between digests')
}

// R4 — only declared-new tables may appear
const appeared = afterTables.filter((t) => !(t in before.tables))
for (const t of appeared) {
  if (BOOKKEEPING.has(t)) continue
  if (!allowNew.includes(t)) violations.push(`R4 VIOLATION — table "${t}" appeared after the migration but is NOT in the declared allow-list [${allowNew.join(', ')}]`)
  else notes.push(`new table "${t}": ${after.tables[t].count} rows (declared — allowed)`)
}

const userTablesBefore = beforeTables.filter((t) => !BOOKKEEPING.has(t))
const totalRows = unchanged.reduce((n, u) => n + u.count, 0)
const verdict = violations.length ? 'FAIL — DO NOT TRUST THIS MIGRATION' : 'PASS — every pre-existing byte is provably intact'

const md = [
  `# D1 migration integrity report`,
  ``,
  `- **Database:** ${after.database} (${before.database})`,
  `- **Migration applied:** ${migration}`,
  `- **Digest before:** ${before.taken_at} · **after:** ${after.taken_at}`,
  `- **Verdict: ${verdict}**`,
  ``,
  `## The one-line proof`,
  ``,
  `All ${unchanged.length} pre-existing tables (excluding migration bookkeeping) carry IDENTICAL row counts AND sha256 digests before and after — **${totalRows} rows, not one byte changed**. The only additions are: ${appeared.filter((t) => !BOOKKEEPING.has(t)).join(', ') || '(none)'} plus the single "${migration}" registration row.`,
  ``,
  `## Per-table digests`,
  ``,
  `| table | rows | sha256 (before = after) |`,
  `|---|---|---|`,
  ...unchanged.map((u) => `| ${u.table} | ${u.count} | \`${u.sha256.slice(0, 16)}…\` |`),
  ...appeared.filter((t) => !BOOKKEEPING.has(t)).map((t) => `| ${t} (NEW) | ${after.tables[t].count} | — |`),
  ...dropped.map((t) => `| ${t} (DROPPED!) | ${before.tables[t].count} | — |`),
  ``,
  `## Notes`,
  ...notes.map((n) => `- ${n}`),
  ...(violations.length ? ['', '## VIOLATIONS', ...violations.map((v) => `- ${v}`)] : []),
  ``,
].join('\n')

writeFileSync(reportPath, md)
console.log(md)
if (violations.length) {
  console.error(`\n${violations.length} VIOLATION(S) — see ${reportPath}. Recovery: wrangler d1 time-travel restore (bookmark from the run evidence).`)
  process.exit(1)
}
console.log(`\nPASS written to ${reportPath}`)
