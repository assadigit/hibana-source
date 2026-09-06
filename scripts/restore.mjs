#!/usr/bin/env node
// Disaster-recovery restore tool (spec §10): pulls a backup snapshot back into a database.
// Usage:
//   node scripts/restore.mjs --file snapshot-XXX.json            # into local SQLite (DB_PATH env or ./data/hibana.db)
//   node scripts/restore.mjs --file snapshot-XXX.json --d1 pm-app-dev   # into Cloudflare D1 (requires wrangler auth)
// The snapshot format is exactly what src/services/backup.ts writes (schema_version + data tables).
// C3 fix (2026-09-10): if the file starts with the HIBENC1 magic prefix, it's an AES-GCM
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
import { webcrypto } from 'node:crypto'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const d1Idx = args.indexOf('--d1')
if (fileIdx === -1) {
  console.error('Usage: node scripts/restore.mjs --file snapshot.json [--d1 pm-app-dev|pm-app-prod]')
  process.exit(1)
}
const file = args[fileIdx + 1]
const d1Name = d1Idx !== -1 ? args[d1Idx + 1] : null

const ENCRYPTED_MAGIC = 'HIBENC1'
const IV_BYTES = 12

function base64ToBytes(b64) {
  const cleaned = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const bin = Buffer.from(cleaned, 'base64')
  return new Uint8Array(bin)
}

function isBase64Content(raw) {
  // Heuristic: if the file content is valid base64 AND starts with the encrypted magic
  // prefix after decoding, it's an encrypted backup. Otherwise it's plaintext JSON.
  try {
    const text = raw.toString('utf8').trim()
    if (text.startsWith('{')) return false // plaintext JSON
    const decoded = Buffer.from(text, 'base64')
    if (decoded.length < ENCRYPTED_MAGIC.length + 1) return false
    const magic = decoded.subarray(0, ENCRYPTED_MAGIC.length).toString('utf8')
    return magic === ENCRYPTED_MAGIC
  } catch {
    return false
  }
}

async function decryptSnapshot(b64Content, keyB64) {
  const raw = base64ToBytes(b64Content)
  const magicLen = ENCRYPTED_MAGIC.length
  const iv = raw.subarray(magicLen + 1, magicLen + 1 + IV_BYTES)
  const cipher = raw.subarray(magicLen + 1 + IV_BYTES)
  const keyBytes = base64ToBytes(keyB64)
  if (keyBytes.byteLength !== 32) throw new Error(`BACKUP_ENCRYPTION_KEY must be 32 bytes, got ${keyBytes.byteLength}`)
  const key = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return Buffer.from(plain).toString('utf8')
}

const rawFile = readFileSync(file)
let jsonText
if (isBase64Content(rawFile)) {
  const encKey = process.env.BACKUP_ENCRYPTION_KEY
  if (!encKey) {
    console.error('This backup is encrypted (HIBENC1). Set BACKUP_ENCRYPTION_KEY env var (base64 32-byte key) to decrypt.')
    process.exit(1)
  }
  console.log('Decrypting encrypted backup (HIBENC1 / AES-GCM)...')
  jsonText = await decryptSnapshot(rawFile.toString('utf8').trim(), encKey)
} else {
  jsonText = rawFile.toString('utf8')
}

const snapshot = JSON.parse(jsonText)
// FK-safe order (parents before children; FTS virtual tables rebuild via triggers).
// `users` is intentionally NOT here: rule 8 excludes users.password_hash from backups, the
// column is NOT NULL, and auth principals are created on the target via seed:admin, never
// by a restore. Sessions are auth records too and are absent from snapshots by design.
// 2026-08-28: quick_notes + sadhana tables added — restores previously skipped the notebook
// and the whole to-do board (those tables were also missing from SNAPSHOT_TABLES, so old
// snapshots don't carry them; both sides are fixed together from this version on).
const tableOrder = [
  'invites', 'projects', 'project_history_log', 'hurdles', 'tags', 'project_tags',
  'links', 'screenshots', 'changelogs', 'tasks', 'payments', 'telegram_captures', 'telegram_links',
  'canvas_elements', 'password_resets',
  'quick_notes',
  'sadhana_tasks', 'sadhana_tags', 'sadhana_updates', 'sadhana_recur_history',
  'sadhana_quadrant_names',
] // FK-safe order (parents before children; FTS virtual tables rebuild via triggers)

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
  for (const table of tableOrder) {
    if (table.endsWith('_fts')) continue // rebuilt automatically by triggers
    lines.push(`DELETE FROM ${table} WHERE 1=1;`)
    const rows = snapshot.data[table] ?? []
    for (const row of rows) lines.push(sqlStatement(table, row))
  }
  return lines
})()

if (!d1Name) {
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'hibana.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;')
  try {
    for (const sql of sqlStatements) db.exec(sql)
    db.exec('COMMIT; PRAGMA foreign_keys = ON;')
  } catch (err) {
    db.exec('ROLLBACK; PRAGMA foreign_keys = ON;')
    throw err
  }
  db.close()
  console.log(`Restored into SQLite at ${dbPath} (${Object.values(snapshot.data).reduce((n, r) => n + r.length, 0)} rows)`)
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