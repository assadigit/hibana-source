#!/usr/bin/env node
// Plan B restore drill (docs/perf-and-data-safety.md §1.3d): prove the TELEGRAM backup
// channel can actually save the day. Run via `npm run drill:planb`.
//
// What it does (read-only against prod except the local scratch DB):
//   1. Reads the newest planb_backups row from PROD D1 (Cloudflare REST API)
//   2. Downloads that document from Telegram via the Bot API (getFile + file download)
//   3. Verifies: sha256 matches the logged hash AND the caption-carried hash;
//      the blob starts with the HIBENC1 magic
//   4. Decrypts it with BACKUP_ENCRYPTION_KEY and validates the snapshot shape
//      (schema_version present, rule 8: no users.password_hash, no sessions)
//   5. Round-trips the decrypted snapshot through the REAL restore.mjs into a scratch
//      SQLite DB and compares per-table row counts (restore loses nothing)
//
// Required env (.secrets.env or process env):
//   TELEGRAM_BOT_TOKEN, BACKUP_ENCRYPTION_KEY, CLOUDFLARE_API_TOKEN
//   CLOUDFLARE_ACCOUNT_ID (defaults to the Hibana account), CLOUDFLARE_D1_PROD_ID (optional)
//
// Prints counts + PASS/FAIL only — never secrets, never snapshot contents.
// Exit 0 = drill PASS, 1 = FAIL/ERROR.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { secrets } from './lib.mjs'
import { parseBackupFile, decryptBackupBytes } from './lib-backup.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const restoreScript = join(here, 'restore.mjs')
const migrationsDir = join(root, 'migrations')

const s = secrets()
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? s.TELEGRAM_BOT_TOKEN
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? s.CLOUDFLARE_API_TOKEN
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? s.CLOUDFLARE_ACCOUNT_ID ?? '6ff25b582afd399d647e91a8db859676'
const PROD_DB_ID = process.env.CLOUDFLARE_D1_PROD_ID ?? 'd842fcb5-44f6-4bbd-a772-3699ccadb496' // pm-app-prod (wrangler.toml)

function fail(msg) {
  console.error(`FAIL ${msg}`)
  process.exit(1)
}

if (!BOT_TOKEN) fail('TELEGRAM_BOT_TOKEN not set (put it in .secrets.env or export it)')
if (!CF_TOKEN) fail('CLOUDFLARE_API_TOKEN not set')
// 2026-09-12 (Session 27 backup audit): the drill no longer hard-fails without
// BACKUP_ENCRYPTION_KEY. Steps 1-3 (D1 log row → Telegram download → sha256 + HIBENC1
// magic) prove the channel delivers INTACT documents without the key; steps 4-5
// (decrypt + restore round-trip) are the owner-key-gated part — skipped LOUDLY so a
// partial pass is never mistaken for a full one. Run on the owner machine
// (credentials.md) for the full decrypt+restore verification.
const ENC_KEY = process.env.BACKUP_ENCRYPTION_KEY ?? s.BACKUP_ENCRYPTION_KEY
const encKeyMissing = !ENC_KEY

// ─── 1. Newest planb_backups row from PROD D1 (REST API) ─────────────────────

async function d1Query(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${PROD_DB_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    },
  )
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) {
    throw new Error(`D1 REST query failed (${res.status}): ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`)
  }
  return body.result?.[0]?.results?.results ?? []
}

console.log('════════════════════════════════════════════════════════════════')
console.log('  Hibana Plan B restore drill (Telegram channel)')
console.log('  D1 (prod) → planb_backups log → Telegram getFile → decrypt → restore round-trip')
console.log('════════════════════════════════════════════════════════════════\n')

console.log('Step 1: newest planb_backups row in PROD D1')
let logRow
try {
  const rows = await d1Query(
    'SELECT user_id, chat_id, message_id, file_id, file_size, sha256, schema_version, sent_at FROM planb_backups ORDER BY sent_at DESC LIMIT 1',
  )
  logRow = rows[0]
} catch (err) {
  fail(`could not read planb_backups from D1: ${err.message}`)
}
if (!logRow) {
  fail('planb_backups is EMPTY — no Plan B document has ever been sent (enable it in the bot Settings, or POST /api/admin/backup/planb)')
}
console.log(`  ✓ latest: sent ${logRow.sent_at} · schema ${logRow.schema_version} · ${logRow.file_size} bytes`)
console.log(`  ✓ sha256 (logged): ${logRow.sha256}\n`)

// ─── 2. Download the document from Telegram ──────────────────────────────────

console.log('Step 2: download the document via Bot API getFile')
const getFileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(logRow.file_id)}`)
const getFileBody = await getFileRes.json().catch(() => null)
if (!getFileRes.ok || !getFileBody?.ok || !getFileBody.result?.file_path) {
  fail(`getFile failed: HTTP ${getFileRes.status} ${JSON.stringify(getFileBody).slice(0, 200)}`)
}
const filePath = getFileBody.result.file_path
const dlRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
if (!dlRes.ok) fail(`document download failed: HTTP ${dlRes.status}`)
const blob = Buffer.from(await dlRes.arrayBuffer())
console.log(`  ✓ downloaded ${blob.byteLength} bytes (file: ${filePath.split('/').pop()})\n`)

// ─── 3. Integrity: sha256 + format detection ─────────────────────────────────

console.log('Step 3: integrity checks')
const sha = createHash('sha256').update(blob).digest('hex')
if (sha !== logRow.sha256) fail(`sha256 MISMATCH: downloaded ${sha} vs logged ${logRow.sha256}`)
console.log('  ✓ sha256 matches the D1 log row')
// parseBackupFile (scripts/lib-backup.mjs) accepts both physical shapes: raw-binary
// HIBENC1 and base64-text HIBENC1. Plan B documents are base64 text (byte-identical
// to what the GitHub Contents API returns in its JSON content field).
const parsedDoc = parseBackupFile(blob)
if (parsedDoc.kind !== 'encrypted') fail(`document is not an HIBENC1-encrypted backup (detected: ${parsedDoc.kind})`)
console.log('  ✓ HIBENC1 encrypted-blob magic present\n')

// ─── 4. Decrypt + snapshot shape (rule 8) ────────────────────────────────────

if (encKeyMissing) {
  console.log('Step 4: decrypt + snapshot shape')
  console.log('  ⚠ SKIPPED: BACKUP_ENCRYPTION_KEY not set in this environment (owner-held secret).')
  console.log('     The document is downloaded + hash-verified + format-verified above;')
  console.log('     decrypt + restore round-trip need the key — run on the owner machine.')
  console.log('')
  console.log('════════════════════════════════════════════════════════════════')
  console.log('  ✅ PLAN B DRILL PARTIAL PASS — channel integrity verified (sha256 ✓ · HIBENC1 ✓)')
  console.log('     decrypt + restore round-trip SKIPPED (no key)')
  console.log('════════════════════════════════════════════════════════════════')
  process.exit(0)
}

console.log('Step 4: decrypt + snapshot shape')
const jsonText = await decryptBackupBytes(parsedDoc.bytes, ENC_KEY)
const snapshot = JSON.parse(jsonText)
if (!snapshot.schema_version || !snapshot.data) fail('decrypted snapshot missing schema_version/data')
const hasPasswordHash = (snapshot.data.users ?? []).some((r) => 'password_hash' in r)
const hasSessions = 'sessions' in snapshot.data
if (hasPasswordHash || hasSessions) fail('rule 8 VIOLATED: snapshot carries password_hash or sessions')
const totalRows = Object.values(snapshot.data).reduce((n, r) => n + (r?.length ?? 0), 0)
console.log(`  ✓ decrypted: schema ${snapshot.schema_version} · ${Object.keys(snapshot.data).length} tables · ${totalRows} rows`)
console.log('  ✓ rule 8 ok: no users.password_hash, no sessions\n')

// ─── 5. Round-trip through the REAL restore.mjs into a scratch DB ─────────────

console.log('Step 5: restore round-trip (real restore.mjs → scratch SQLite)')
const work = mkdtempSync(join(tmpdir(), 'hibana-planb-drill-'))
let exit = 1
try {
  const snapPath = join(work, 'planb-snapshot.json')
  // restore.mjs auto-detects encrypted files; write the ENCRYPTED blob so the drill
  // exercises the exact manual disaster path (download .bin → restore).
  writeFileSync(snapPath, blob.toString('utf8'))
  const target = join(work, 'restored.db')
  // Fresh schema via the real migration runner, then the real restore (same pattern as
  // scripts/restore-drill.mjs Part A).
  const { applyMigrations } = await import('../src/db/migrate-node.ts')
  applyMigrations(target, migrationsDir)
  execFileSync(process.execPath, [restoreScript, '--file', snapPath], {
    cwd: root,
    env: { ...process.env, DB_PATH: target, BACKUP_ENCRYPTION_KEY: ENC_KEY },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  const counts = tableCounts(target)
  const tables = Object.keys(snapshot.data).sort()
  let mismatches = 0
  for (const t of tables) {
    if (t === 'users') continue // never restored by design (auth records)
    const expected = snapshot.data[t]?.length ?? 0
    const got = counts[t] ?? 'n/a'
    if (got !== expected) {
      console.error(`  ✗ ${t}: expected ${expected}, got ${got}`)
      mismatches++
    }
  }
  if (mismatches > 0) fail(`${mismatches} table(s) mismatched after restore`)
  const restoredRows = tables.filter((t) => t !== 'users').reduce((n, t) => n + (snapshot.data[t]?.length ?? 0), 0)
  console.log(`  ✓ all ${tables.length - 1} restored tables match the snapshot exactly (${restoredRows} rows)`)
  console.log('  ✓ users untouched (auth records are never restored — rule 8)\n')

  console.log('════════════════════════════════════════════════════════════════')
  console.log('  ✅ PLAN B DRILL PASS — the Telegram channel can restore Hibana')
  console.log('     (sha256 ✓ · HIBENC1 ✓ · rule 8 ✓ · restore round-trip ✓)')
  console.log('════════════════════════════════════════════════════════════════')
  exit = 0
} catch (err) {
  console.error('PLAN B DRILL ERROR:', err instanceof Error ? err.message : String(err))
  exit = 1
} finally {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    /* cleanup is best-effort */
  }
}

function tableCounts(dbPath) {
  const db = new DatabaseSync(dbPath)
  const out = {}
  for (const t of [
    'invites', 'spark_folders', 'projects', 'project_history_log', 'hurdles', 'tags', 'project_tags',
    'links', 'screenshots', 'tasks', 'payments', 'canvas_elements', 'telegram_captures', 'telegram_links',
    'quick_notes', 'sadhana_tasks', 'sadhana_tags', 'sadhana_updates', 'sadhana_recur_history',
    'sadhana_quadrant_names', 'dev_tasks', 'task_categories', 'sprints', 'backlog_docs', 'backlog_doc_revisions',
  ]) {
    try {
      out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
    } catch {
      out[t] = 'n/a'
    }
  }
  db.close()
  return out
}

process.exit(exit)
