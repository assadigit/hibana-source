#!/usr/bin/env node
// Disaster-recovery restore tool (spec §10): pulls a backup snapshot back into a database.
// Usage:
//   node scripts/restore.mjs --file snapshot-XXX.json            # into local SQLite (DB_PATH env or ./data/hibana.db)
//   node scripts/restore.mjs --file snapshot-XXX.json --d1 pm-app-dev   # into Cloudflare D1 (requires wrangler auth)
// The snapshot format is exactly what src/services/backup.ts writes (schema_version + data tables).
// C3 fix (2026-09-10): if the file carries the HIBENC1 magic prefix, it's an AES-GCM
// encrypted backup — set BACKUP_ENCRYPTION_KEY (base64 32-byte key) to decrypt. Legacy
// plaintext JSON files are still handled for backwards compatibility.
//
// Auth is intentionally NOT restored: snapshots carry no password_hash (rule 8) and users has
// NOT NULL password_hash, so `users`/`sessions` are skipped — seed the admin on a fresh target
// (npm run seed:admin). Restoring into the ORIGINAL database is seamless (user UUIDs still
// match); restoring into a brand-NEW database will leave restored rows bound to the old user
// UUID — re-point projects/canvas/tags user_id at the new admin if you ever do that.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseBackupFile, decryptBackupBytes } from './lib-backup.mjs'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const d1Idx = args.indexOf('--d1')
if (fileIdx === -1) {
  console.error('Usage: node scripts/restore.mjs --file snapshot.json [--d1 pm-app-dev|pm-app-prod]')
  process.exit(1)
}
const file = args[fileIdx + 1]
const d1Name = d1Idx !== -1 ? args[d1Idx + 1] : null

// 2026-09-11 (perf/data-safety session): format detection moved to scripts/lib-backup.mjs.
// Backups arrive in THREE shapes now — raw-binary HIBENC1 (GitHub download_url / raw
// Accept header: the Contents API decodes our base64 PUT before storing), base64-text
// HIBENC1 (Telegram Plan B documents, GitHub JSON content field), and legacy plaintext
// JSON. The old detector only knew base64-text, so the runbook's documented GitHub
// download path crashed JSON.parse on binary — every encrypted GitHub backup since C3
// was unrestorable via that path. All three shapes are handled below.

const rawFile = readFileSync(file)
let jsonText
const parsedFile = parseBackupFile(rawFile)
if (parsedFile.kind === 'encrypted') {
  const encKey = process.env.BACKUP_ENCRYPTION_KEY
  if (!encKey) {
    console.error('This backup is encrypted (HIBENC1). Set BACKUP_ENCRYPTION_KEY env var (base64 32-byte key) to decrypt.')
    process.exit(1)
  }
  console.log('Decrypting encrypted backup (HIBENC1 / AES-GCM)...')
  jsonText = await decryptBackupBytes(parsedFile.bytes, encKey)
} else if (parsedFile.kind === 'plaintext-json') {
  jsonText = parsedFile.text
} else {
  console.error(`This file is not a recognizable Hibana backup (starts with: ${JSON.stringify(parsedFile.head)}).`)
  console.error('Expected: HIBENC1 binary, HIBENC1 base64 text, or plaintext snapshot JSON.')
  process.exit(1)
}

const snapshot = JSON.parse(jsonText)
// 2026-09-12 (Session 27 backup audit — CRITICAL fix): the restore table list is now
// DERIVED from the snapshot's own data keys (like restore-safe.mjs), ordered FK-safe —
// the previous hardcoded tableOrder unconditionally emitted `DELETE FROM changelogs`...
// but migration 0048 DROPPED changelogs, so every restore against schema 47 crashed with
// "no such table: changelogs" (found by running the drill — the restore path was broken
// at HEAD). Deriving from the snapshot keys also fixes the drift class permanently: any
// table a FUTURE backup carries is restored (unknown tables append after the FK-safe
// knowns, mirroring restore-safe.mjs), and tables the snapshot doesn't carry produce no
// statements at all (no phantom DELETEs against tables the target may not have).
// `users` is intentionally excluded: rule 8 strips users.password_hash from backups, the
// column is NOT NULL, and auth principals are created on the target via seed:admin, never
// by a restore. Sessions are auth records too and are absent from snapshots by design.
// Dead tables dropped from the schema (0048: changelogs, telegram_note_sessions) — data
// for them in OLD snapshots is dead by definition; skipped with a warning, never restored.
const DROPPED_DEAD_TABLES = new Set(['changelogs', 'telegram_note_sessions'])
const FK_SAFE_ORDER = [
  'invites', 'spark_folders', 'projects', 'project_history_log', 'hurdles', 'tags', 'project_tags',
  'links', 'screenshots', 'tasks', 'payments', 'telegram_captures', 'telegram_links',
  'canvas_elements', 'password_resets',
  'quick_notes',
  'sadhana_tasks', 'sadhana_tags', 'sadhana_updates', 'sadhana_recur_history',
  'sadhana_quadrant_names',
  'task_categories', 'sprints', 'dev_tasks', 'dev_task_tags', 'project_archives',
  'backlog_docs', 'backlog_doc_revisions',
] // FK-safe order (parents before children; FTS virtual tables rebuild via triggers)
const snapshotTables = Object.keys(snapshot.data ?? {}).filter((t) => t !== 'users' && !t.endsWith('_fts'))
for (const t of snapshotTables) {
  if (DROPPED_DEAD_TABLES.has(t)) console.warn(`skipping dead table "${t}" (dropped by migration 0048 — its data is inert)`)
}
const tableOrder = [
  ...FK_SAFE_ORDER.filter((t) => snapshotTables.includes(t)),
  ...snapshotTables.filter((t) => !FK_SAFE_ORDER.includes(t) && !DROPPED_DEAD_TABLES.has(t)).sort(),
]

const snapshotUsers = snapshot.data.users ?? []
console.log(`users in snapshot: ${snapshotUsers.length} (skipped by design — re-seed the admin on a fresh target via npm run seed:admin)`)

const sqlStatement = (table, row) => {
  const keys = Object.keys(row)
  return (
    `INSERT INTO ${table} (${keys.join(', ')})
     VALUES (${keys.map((k) => sqlLiteral(row[k])).join(', ')});`
  )
}

// Render a JSON-typed value as a correct SQLite literal: strings MUST be single-quoted
// (double quotes mean identifier), embedded single quotes are doubled. SQLite's own
// type affinity coerces numbers/booleans on the way in.
function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'object') v = JSON.stringify(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

const sqlStatements = (() => {
  const lines = []
  // Deterministic free! No — restore is deliberate disaster recovery; wipe and refill.
  // Only tables the snapshot actually carries (tableOrder was derived from snapshot.data
  // keys) — a table absent from the snapshot is not managed by this restore.
  for (const table of tableOrder) {
    lines.push(`DELETE FROM ${table} WHERE 1=1;`)
    const rows = snapshot.data[table] ?? []
    for (const row of rows) lines.push(sqlStatement(table, row))
  }
  return lines
})()

if (!d1Name) {
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'hibana.db')
  const db = new DatabaseSync(dbPath)
  // Belt + braces: a snapshot table the TARGET schema doesn't have (e.g. an old snapshot
  // carrying a table a later migration renamed/dropped) is skipped with a warning
  // instead of crashing the whole restore.
  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
  )
  const missing = tableOrder.filter((t) => !existing.has(t))
  for (const t of missing) console.warn(`skipping "${t}" — table does not exist in the target schema (nothing to restore into)`)
  const runnable = tableOrder.filter((t) => existing.has(t))
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;')
  try {
    for (const table of runnable) {
      db.exec(`DELETE FROM ${table} WHERE 1=1;`)
      const rows = snapshot.data[table] ?? []
      for (const row of rows) db.exec(sqlStatement(table, row))
    }
    db.exec('COMMIT; PRAGMA foreign_keys = ON;')
  } catch (err) {
    db.exec('ROLLBACK; PRAGMA foreign_keys = ON;')
    throw err
  }
  db.close()
  console.log(`Restored into SQLite at ${dbPath} (${runnable.reduce((n, t) => n + (snapshot.data[t]?.length ?? 0), 0)} rows)`)
} else {
  const tmpDir = mkdtempSync(join(tmpdir(), 'hibana-restore-'))
  const sqlFile = join(tmpDir, 'restore.sql')
  writeFileSync(sqlFile, sqlStatements.join('\n'))
  try {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    execFileSync(npx, ['wrangler', 'd1', 'execute', d1Name, '--remote', '--file', sqlFile], { stdio: 'inherit' })
    console.log(`Restored into Cloudflare D1 database "${d1Name}"`)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

console.log('Restore complete. Verify by logging in and checking your projects/history before trusting it.')