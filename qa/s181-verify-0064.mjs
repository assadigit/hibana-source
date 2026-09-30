#!/usr/bin/env node
// s181-verify-0064.mjs — the COMPLETE machine proof of the 0064 user-scoped
// categories migration (the owner's written approval). 0064 is MUTATIVE by
// design (categories rebuilt with user_id, references remapped, secondary
// owners get '-u<n>' copies), so the additive byte-proof tool
// (d1-verify-migration.mjs R2) is not the right gate for the three mutated
// tables. This script is: it snapshots the before-state, then proves the
// after-state against the EXACT backfill contract the migration documents.
//
// Proof lattice:
//   R1  no table dropped (all before-tables exist after)
//   R2  every UNTOUCHED table (all but categories/project_categories/dev_tasks,
//       bookkeeping, and the live-traffic transient class) carries IDENTICAL
//       row count AND sha256 — the byte-proof, computed the same canonical way
//       d1-table-digest.mjs does it
//   R3  d1_migrations gained EXACTLY {0064_user_categories}, nothing else
//   R4  NO new tables appeared (0064 creates none; temp tables die in-file)
//   B1  categories after == the EXPECTED set exactly (per-row: id, user_id,
//       name, colors, is_archived, created_at) — first owner keeps the row,
//       install-oldest user inherits untouched rows, secondary owners get
//       deterministic '-u<ordinal>' copies (ordinal = rank by uid)
//   B2  project_categories: same row count; every enable remapped exactly as
//       the copy-map prescribes (expectedNewId(owner(project), before cat))
//   B3  dev_tasks: same row count; every task's category_id remapped exactly
//       as prescribed (NULL stays NULL)
//   B4  per-user live-name uniqueness holds (0 duplicates)
//   B5  every category's user_id resolves to a real user (0 orphans)
//   B6  zero dangling + zero cross-owner references (pc + dev_tasks)
//
// Usage:
//   node qa/s181-verify-0064.mjs --db pm-app-dev  --phase before
//   node qa/s181-verify-0064.mjs --db pm-app-dev  --phase after
//   node qa/s181-verify-0064.mjs --db pm-app-prod --phase before --prod-ok
//   node qa/s181-verify-0064.mjs --db pm-app-prod --phase after  --prod-ok
//
// State: data/s181-0064-<db>.json (+ -report.md) — data/ is gitignored
// (snapshots carry user ids/emails-adjacent rows; they never ship).
// Creds from .secrets.env via scripts/lib.mjs (never printed).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { secrets } from '../scripts/lib.mjs'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const db = argOf('--db')
const phase = argOf('--phase')
if (!db || !phase || !['before', 'after'].includes(phase)) {
  console.error('usage: node qa/s181-verify-0064.mjs --db <pm-app-dev|pm-app-prod> --phase <before|after> [--prod-ok]')
  process.exit(1)
}
if (db !== 'pm-app-dev' && db !== 'pm-app-prod') {
  console.error('refusing unknown db name')
  process.exit(1)
}
if (db === 'pm-app-prod' && !args.includes('--prod-ok')) {
  console.error('REFUSED: prod needs the deliberate --prod-ok opt-in (the §5 ritual runs it right after the d1-migrate step).')
  process.exit(1)
}

const sec = secrets()
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? sec.CLOUDFLARE_API_TOKEN
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? sec.CLOUDFLARE_ACCOUNT_ID
if (!CF_TOKEN || !CF_ACCOUNT) {
  console.error('FATAL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID missing')
  process.exit(1)
}

const query = (sql) => {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--command', sql, '--json', '-y'], {
    cwd: process.cwd(),
    env: { ...process.env, CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    maxBuffer: 256 * 1024 * 1024,
  }).toString()
  const start = raw.indexOf('[')
  if (start < 0) throw new Error(`unexpected wrangler output for: ${sql.slice(0, 80)}…`)
  const parsed = JSON.parse(raw.slice(start))
  const rows = []
  for (const batch of Array.isArray(parsed) ? parsed : [parsed]) rows.push(...(batch.results ?? []))
  return rows
}

// classification mirrors d1-table-digest.mjs: FTS5 virtual tables are DERIVED
// (recorded by name — both ride changelogs/projects, which 0064 never touches);
// _cf_* are Cloudflare-internal and unreadable via d1 execute; everything else
// (incl. FTS shadow tables — real tables) is fingerprinted. 0064 has no FTS
// triggers on categories/project_categories/dev_tasks, so shadows stay stable.
const enumTables = () => {
  const rows = query("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\\' ORDER BY name")
  const real = []
  const virtual = []
  for (const r of rows) {
    const name = String(r.name)
    if (String(r.sql ?? '').toUpperCase().includes('VIRTUAL TABLE')) virtual.push(name)
    else if (name.startsWith('_cf_')) continue
    else real.push(name)
  }
  return { real, virtual }
}

const MUTATED = new Set(['categories', 'project_categories', 'dev_tasks'])
// external-content FTS5 shadow tables of the MUTATED tables (dev_tasks_fts_* —
// the dev_tasks_fts_au AFTER UPDATE trigger fires when the 0064 remap rewrites
// category_id). Derived data of mutated tables: drift is EXPECTED, advisory only.
const DERIVED = (t) => [...MUTATED].some((m) => t.startsWith(`${m}_fts`))
const BOOKKEEPING = new Set(['d1_migrations', '_migrations'])
const TRANSIENT = new Set(
  'sessions,password_resets,email_verifications,rate_limits,email_log,error_log,sadhana_reminder_logs,telegram_bot_sessions,planb_backups'.split(','),
)
const MIGRATION = '0064_user_categories'

// canonical digest — same shape d1-table-digest.mjs produces
const digestOf = (rows) => {
  const canon = rows
    .map((r) => {
      const keys = Object.keys(r).sort()
      return JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k]])))
    })
    .sort()
  return { sha256: createHash('sha256').update(canon.join('\n')).digest('hex'), count: rows.length }
}

mkdirSync('data', { recursive: true })
const statePath = join('data', `s181-0064-${db}.json`)
const reportPath = join('data', `s181-0064-${db}-report.md`)

// ─── the shared owner-resolution model (mirrors the migration SQL exactly) ───
const OWNER_PAIRS_SQL = `SELECT cid, uid, MIN(first_touch) AS first_touch FROM (
  SELECT c.id AS cid, p.user_id AS uid, MIN(p.created_at) AS first_touch
  FROM categories c
  JOIN project_categories pc ON pc.category_id = c.id
  JOIN projects p ON p.id = pc.project_id
  GROUP BY c.id, p.user_id
  UNION ALL
  SELECT c.id AS cid, p.user_id AS uid, MIN(p.created_at) AS first_touch
  FROM categories c
  JOIN dev_tasks t ON t.category_id = c.id
  JOIN projects p ON p.id = t.project_id
  GROUP BY c.id, p.user_id
) GROUP BY cid, uid ORDER BY cid, uid`

const modelOf = (snap) => {
  const pairs = snap.ownerPairs
  const byCat = new Map()
  for (const p of pairs) {
    if (!byCat.has(p.cid)) byCat.set(p.cid, [])
    byCat.get(p.cid).push(p)
  }
  const firstOwner = new Map()
  const secondary = new Map()
  for (const [cid, list] of byCat) {
    const minTouch = list.reduce((m, p) => (p.first_touch < m ? p.first_touch : m), list[0].first_touch)
    const winners = list.filter((p) => p.first_touch === minTouch).map((p) => p.uid).sort()
    firstOwner.set(cid, winners[0])
    secondary.set(
      cid,
      list.map((p) => p.uid).filter((u) => u !== winners[0]).sort(),
    )
  }
  const expectedRows = []
  for (const c of snap.categories) {
    const owner = firstOwner.get(c.id) ?? snap.installOldestUser
    expectedRows.push({ id: c.id, user_id: owner, name: c.name, color_fill: c.color_fill, color_text: c.color_text, is_archived: c.is_archived, created_at: c.created_at })
    const secOwners = secondary.get(c.id) ?? []
    secOwners.forEach((uid, i) => {
      expectedRows.push({ id: `${c.id}-u${i + 1}`, user_id: uid, name: c.name, color_fill: c.color_fill, color_text: c.color_text, is_archived: c.is_archived, created_at: c.created_at })
    })
  }
  const expectedNewId = (uid, cid) => {
    if (firstOwner.get(cid) === uid) return cid
    const idx = (secondary.get(cid) ?? []).indexOf(uid)
    if (idx < 0) return undefined
    return `${cid}-u${idx + 1}`
  }
  return { expectedRows, expectedNewId, firstOwner, secondary }
}

const rowKey = (r) => JSON.stringify([r.id, r.user_id, r.name, r.color_fill, r.color_text, r.is_archived, r.created_at])

// ─── phase: before ─────────────────────────────────────────────────────────
if (phase === 'before') {
  const { real: tables, virtual } = enumTables()
  const digests = {}
  for (const t of tables) {
    if (BOOKKEEPING.has(t)) continue
    digests[t] = digestOf(query(`SELECT * FROM "${t}"`))
  }
  const snap = {
    taken_at: new Date().toISOString(),
    database: db,
    tables,
    virtualTables: virtual,
    digests,
    migrations: query('SELECT name FROM d1_migrations ORDER BY name').map((r) => r.name),
    categories: query('SELECT id, name, color_fill, color_text, is_archived, created_at FROM categories ORDER BY id'),
    ownerPairs: query(OWNER_PAIRS_SQL),
    installOldestUser: (query('SELECT id FROM users ORDER BY created_at, id LIMIT 1')[0] ?? {}).id ?? null,
    projects: query('SELECT id, user_id FROM projects'),
    projectCategories: query('SELECT project_id, category_id FROM project_categories'),
    devTasks: query('SELECT id, project_id, category_id FROM dev_tasks'),
  }
  writeFileSync(statePath, JSON.stringify(snap, null, 2))
  const m = modelOf(snap)
  console.log(`BEFORE snapshot (${db}): ${snap.categories.length} categories · ${snap.ownerPairs.length} owner-pairs · ${snap.projectCategories.length} enables · ${snap.devTasks.length} tasks · ${snap.tables.length} tables · schema ${snap.migrations.length}`)
  console.log(`  expected post-migration rows: ${m.expectedRows.length} (${snap.categories.length} originals kept + ${m.expectedRows.length - snap.categories.length} copies)`)
  console.log(`  state → ${statePath}`)
  process.exit(0)
}

// ─── phase: after ──────────────────────────────────────────────────────────
if (!existsSync(statePath)) {
  console.error(`FATAL: no before-snapshot at ${statePath} — run --phase before first`)
  process.exit(1)
}
const before = JSON.parse(readFileSync(statePath, 'utf8'))
const violations = []
const notes = []

// R1 + R4 — table set unchanged (real tables hard; FTS virtual noted)
const afterEnum = enumTables()
const afterTables = afterEnum.real
for (const t of before.tables) if (!afterTables.includes(t)) violations.push(`R1 VIOLATION — table "${t}" DROPPED`)
for (const t of afterTables) if (!before.tables.includes(t)) violations.push(`R4 VIOLATION — table "${t}" APPEARED (0064 creates no tables)`)
const vtDrift = afterEnum.virtual.filter((t) => !before.virtualTables.includes(t)).concat(before.virtualTables.filter((t) => !afterEnum.virtual.includes(t)))
if (vtDrift.length) notes.push(`ADVISORY — FTS virtual table set changed: ${vtDrift.join(', ')} (0064 touches no FTS source; unexpected)`)
notes.push(`tables: ${before.tables.length} → ${afterTables.length} real (+${before.virtualTables.length} FTS virtual, unchanged set expected)`)

// R2 — untouched tables byte-identical (hard), transient advisory
const unchangedTables = []
const afterDigests = {}
for (const t of afterTables) {
  if (BOOKKEEPING.has(t) || MUTATED.has(t)) continue
  afterDigests[t] = digestOf(query(`SELECT * FROM "${t}"`))
}
for (const [t, d] of Object.entries(before.digests)) {
  if (MUTATED.has(t) || BOOKKEEPING.has(t)) continue
  const a = afterDigests[t]
  if (!a) continue // R1 already flagged
  if (a.count !== d.count || a.sha256 !== d.sha256) {
    if (TRANSIENT.has(t)) notes.push(`ADVISORY — transient "${t}" drifted (${d.count} → ${a.count} rows): live traffic, unrelated to 0064`)
    else if (DERIVED(t)) notes.push(`ADVISORY — derived FTS index "${t}" drifted (${d.count} → ${a.count} rows): the dev_tasks_fts_au trigger fires on the 0064 remap; the source table's exactness is proven by B3`)
    else violations.push(`R2 VIOLATION — untouched table "${t}" CHANGED: ${d.count}/${a.count} rows, sha ${d.sha256.slice(0, 12)}… vs ${a.sha256.slice(0, 12)}…`)
  } else unchangedTables.push({ table: t, count: d.count })
}
notes.push(`R2 byte-proof: ${unchangedTables.length} untouched tables IDENTICAL (count + sha256)`)

// R3 — bookkeeping grew by exactly the one registration
const afterMigrations = query('SELECT name FROM d1_migrations ORDER BY name').map((r) => r.name)
const added = afterMigrations.filter((m) => !before.migrations.includes(m))
const removed = before.migrations.filter((m) => !afterMigrations.includes(m))
if (removed.length) violations.push(`R3 VIOLATION — registrations removed: ${removed.join(', ')}`)
if (added.length !== 1 || added[0] !== MIGRATION) violations.push(`R3 VIOLATION — expected exactly +["${MIGRATION}"], got +[${added.join(', ')}]`)
else notes.push(`R3: "${MIGRATION}" registered — the only bookkeeping change (schema ${before.migrations.length} → ${afterMigrations.length})`)

// B1 — categories == expected set exactly
const m = modelOf(before)
const afterCats = query('SELECT id, user_id, name, color_fill, color_text, is_archived, created_at FROM categories ORDER BY id')
const expected = new Map(m.expectedRows.map((r) => [rowKey(r), r]))
const actual = new Set(afterCats.map(rowKey))
for (const k of actual) if (!expected.has(k)) violations.push(`B1 VIOLATION — UNEXPECTED category row: ${k}`)
for (const [k, r] of expected) if (!actual.has(k)) violations.push(`B1 VIOLATION — MISSING expected category row: ${k}`)
notes.push(`B1 backfill exactness: ${afterCats.length} rows == ${m.expectedRows.length} expected (${before.categories.length} originals + ${m.expectedRows.length - before.categories.length} copies); every id/user_id/name/color/archive/stamp matched`)

// B2 — project_categories remap
const projectOwner = new Map(before.projects.map((p) => [p.id, p.user_id]))
const afterPc = query('SELECT project_id, category_id FROM project_categories')
if (afterPc.length !== before.projectCategories.length) violations.push(`B2 VIOLATION — enables count changed: ${before.projectCategories.length} → ${afterPc.length}`)
const pcBefore = new Map(before.projectCategories.map((r) => [`${r.project_id}|${r.category_id}`, r]))
for (const r of afterPc) {
  const uid = projectOwner.get(r.project_id)
  const match = before.projectCategories.find((b) => b.project_id === r.project_id)
  // find the before-pair whose remap equals this after-pair
  const src = before.projectCategories.find((b) => b.project_id === r.project_id && m.expectedNewId(uid, b.category_id) === r.category_id)
  if (!uid) violations.push(`B2 VIOLATION — enable on unknown project ${r.project_id}`)
  else if (!src) violations.push(`B2 VIOLATION — enable (${r.project_id} → ${r.category_id}) matches NO prescribed remap`)
}
if (afterPc.length === before.projectCategories.length) {
  const seen = new Set()
  for (const b of before.projectCategories) {
    const nid = m.expectedNewId(projectOwner.get(b.project_id), b.category_id)
    if (nid === undefined) violations.push(`B2 VIOLATION — before enable (${b.project_id} → ${b.category_id}) has NO prescribed remap`)
    else seen.add(`${b.project_id}|${nid}`)
  }
  for (const r of afterPc) if (!seen.has(`${r.project_id}|${r.category_id}`)) violations.push(`B2 VIOLATION — extra enable (${r.project_id} → ${r.category_id})`)
  if (!violations.some((v) => v.startsWith('B2'))) notes.push(`B2 enables: all ${afterPc.length} remapped exactly as prescribed`)
}
void pcBefore

// B3 — dev_tasks remap
const afterTasks = query('SELECT id, project_id, category_id FROM dev_tasks')
if (afterTasks.length !== before.devTasks.length) violations.push(`B3 VIOLATION — dev_tasks count changed: ${before.devTasks.length} → ${afterTasks.length}`)
const afterTaskMap = new Map(afterTasks.map((t) => [t.id, t]))
let b3bad = 0
for (const b of before.devTasks) {
  const a = afterTaskMap.get(b.id)
  if (!a) { violations.push(`B3 VIOLATION — task ${b.id} vanished`); b3bad++; continue }
  const expect = b.category_id === null || b.category_id === undefined ? null : m.expectedNewId(projectOwner.get(b.project_id), b.category_id)
  if (expect === undefined) { violations.push(`B3 VIOLATION — task ${b.id} reference (${b.category_id}) has NO prescribed remap`); b3bad++; continue }
  if ((a.category_id ?? null) !== expect) { violations.push(`B3 VIOLATION — task ${b.id}: category ${b.category_id} → ${a.category_id}, expected ${expect}`); b3bad++ }
}
if (!b3bad) notes.push(`B3 tasks: all ${afterTasks.length} category references remapped exactly as prescribed (NULLs preserved)`)

// B4/B5/B6 — live invariants
const dups = query('SELECT user_id, lower(trim(name)) AS k, COUNT(*) AS n FROM categories WHERE is_archived = 0 GROUP BY user_id, k HAVING n > 1')
if (dups.length) violations.push(`B4 VIOLATION — per-user live-name duplicates: ${dups.length}`)
else notes.push('B4 per-user live-name uniqueness: 0 duplicates')
const orphans = query('SELECT COUNT(*) AS n FROM categories c LEFT JOIN users u ON u.id = c.user_id WHERE u.id IS NULL')
if (orphans[0].n > 0) violations.push(`B5 VIOLATION — ${orphans[0].n} categories with unknown owner`)
else notes.push('B5 ownership: every category resolves to a real user')
const danglePc = query('SELECT COUNT(*) AS n FROM project_categories pc LEFT JOIN categories c ON c.id = pc.category_id WHERE c.id IS NULL')
const crossPc = query("SELECT COUNT(*) AS n FROM project_categories pc JOIN categories c ON c.id = pc.category_id JOIN projects p ON p.id = pc.project_id WHERE c.user_id <> p.user_id")
const dangleT = query('SELECT COUNT(*) AS n FROM dev_tasks t LEFT JOIN categories c ON c.id = t.category_id WHERE t.category_id IS NOT NULL AND c.id IS NULL')
const crossT = query("SELECT COUNT(*) AS n FROM dev_tasks t JOIN categories c ON c.id = t.category_id JOIN projects p ON p.id = t.project_id WHERE c.user_id <> p.user_id")
if (danglePc[0].n || crossPc[0].n || dangleT[0].n || crossT[0].n) violations.push(`B6 VIOLATION — dangling/cross-owner refs: pc(${danglePc[0].n}/${crossPc[0].n}) tasks(${dangleT[0].n}/${crossT[0].n})`)
else notes.push('B6 references: zero dangling, zero cross-owner (every enable + task ref same-owner)')

const verdict = violations.length ? 'FAIL — DO NOT TRUST THIS MIGRATION (bookmark is the recovery path)' : 'PASS — the backfill contract holds exactly'
const md = [
  `# 0064 user-scoped categories — integrity proof (${db})`,
  '',
  `- **Before:** ${before.taken_at} · schema ${before.migrations.length}`,
  `- **After:** ${new Date().toISOString()} · schema ${afterMigrations.length}`,
  `- **Verdict: ${verdict}**`,
  '',
  ...notes.map((n) => `- ${n}`),
  '',
  ...(violations.length ? ['## Violations', ...violations.map((v) => `- ${v}`)] : []),
  '',
  `- snapshot: ${statePath}`,
]
mkdirSync('data', { recursive: true })
writeFileSync(reportPath, md.join('\n'))
console.log(md.join('\n'))
process.exit(violations.length ? 1 : 0)
