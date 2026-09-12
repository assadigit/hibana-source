#!/usr/bin/env node
// Safe restore with canary verification (H3 fix, 2026-09-10).
//
// Restores a backup into pm-app-dev FIRST (sacrificial), then compares row counts
// across three sources before touching production:
//
//   Check A: restored-DEV vs backup file → "Did the restore process lose data?"
//   Check B: restored-DEV vs current-PROD → "Would applying this restore lose PROD data?"
//
// Only if both checks pass AND the operator types "yes" does it restore into pm-app-prod.
// This guarantees ZERO risk to production data during the restore process.
//
// Usage:
//   BACKUP_ENCRYPTION_KEY=<key> node scripts/restore-safe.mjs --file snapshot.json
//   BACKUP_ENCRYPTION_KEY=<key> node scripts/restore-safe.mjs --file snapshot.json --force  # skip the prompt
//   BACKUP_ENCRYPTION_KEY=<key> node scripts/restore-safe.mjs --file snapshot.json --dry-run  # check only, no prod restore
//
// Requires: wrangler auth (npx wrangler login), BACKUP_ENCRYPTION_KEY env var

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseBackupFile, decryptBackupBytes } from './lib-backup.mjs'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
if (fileIdx === -1) {
  console.error('Usage: node scripts/restore-safe.mjs --file snapshot.json [--force] [--dry-run]')
  console.error('')
  console.error('  --file <path>     Encrypted or plaintext backup snapshot')
  console.error('  --force           Skip the "yes" confirmation prompt for PROD restore')
  console.error('  --dry-run         Check only — restore into DEV, verify, but NEVER touch PROD')
  console.error('')
  console.error('Environment:')
  console.error('  BACKUP_ENCRYPTION_KEY   Required if the backup is encrypted (HIBENC1)')
  process.exit(1)
}

const file = args[fileIdx + 1]
const FORCE = args.includes('--force')
const DRY_RUN = args.includes('--dry-run')

const DEV_DB = 'pm-app-dev'
const PROD_DB = 'pm-app-prod'

// ─── Decrypt + parse (shared with restore.mjs via lib-backup.mjs) ─────────────
// Handles all three file shapes: raw-binary HIBENC1 (GitHub download_url), base64-text
// HIBENC1 (Telegram Plan B documents / GitHub JSON content field), legacy plaintext JSON.

// ─── D1 query helper ─────────────────────────────────────────────────────────

function d1Query(dbName, sql) {
  // Executes a single SQL command against a D1 database and returns the parsed JSON result.
  // Uses --json for machine-readable output (the default human format is harder to parse).
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  try {
    const output = execFileSync(npx, [
      'wrangler', 'd1', 'execute', dbName,
      '--remote', '--json',
      '--command', sql,
    ], { encoding: 'utf8', timeout: 60000 })
    // wrangler --json outputs an array of result objects (one per statement)
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
      return parsed[0].results
    }
    return []
  } catch (err) {
    throw new Error(`D1 query failed on ${dbName}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function d1RowCounts(dbName, tables) {
  // Queries row counts for all tables in one round-trip via UNION ALL.
  // Returns a Map<table, count>.
  const unionParts = tables
    .filter((t) => !t.endsWith('_fts') && t !== 'users') // skip FTS virtual tables + users (not restored)
    .map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t}`)
    .join(' UNION ALL ')
  const sql = `SELECT t, n FROM (${unionParts}) ORDER BY t`
  const rows = d1Query(dbName, sql)
  const map = new Map()
  for (const row of rows) {
    map.set(row.t, Number(row.n))
  }
  return map
}

// ─── Restore into D1 (reused from restore.mjs) ──────────────────────────────

function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'object') v = JSON.stringify(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

function generateRestoreSql(snapshot, tables) {
  const lines = []
  // FK-safe order: parents before children. The backup's table list is already in
  // SNAPSHOT_TABLES order (from backup.ts), which is FK-safe.
  for (const table of tables) {
    if (table.endsWith('_fts') || table === 'users') continue
    lines.push(`DELETE FROM ${table} WHERE 1=1;`)
    const rows = snapshot.data[table] ?? []
    for (const row of rows) {
      const keys = Object.keys(row)
      lines.push(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => sqlLiteral(row[k])).join(', ')});`)
    }
  }
  return lines.join('\n')
}

// Session 20 (backup-coverage audit): canonical FK-safe table order — a frozen mirror
// of SNAPSHOT_TABLES (src/services/backup.ts; parents before children: spark_folders →
// projects → … → task_categories/sprints → dev_tasks → dev_task_tags →
// project_archives → backlog_docs → backlog_doc_revisions). Object.keys(data).sort()
// (the previous derivation) is ALPHABETICAL — it put dev_task_tags BEFORE dev_tasks,
// which breaks inserts when the target enforces foreign keys mid-restore. Unknown
// tables (future schema growth in a newer snapshot) append at the end, preserving
// forward compatibility.
// 2026-09-12 (Session 27 backup audit): changelogs REMOVED — migration 0048 dropped the
// table from the schema, and an old snapshot still carrying changelogs rows would crash
// the generated SQL ("no such table"). Same treatment as restore.mjs: dropped-dead
// tables are filtered from the snapshot's table list before any SQL is generated.
const DROPPED_DEAD_TABLES = new Set(['changelogs', 'telegram_note_sessions'])
const FK_SAFE_TABLE_ORDER = [
  'invites', 'spark_folders', 'projects', 'project_history_log', 'hurdles', 'tags', 'project_tags',
  'links', 'screenshots', 'tasks', 'payments', 'telegram_captures', 'telegram_links',
  'canvas_elements', 'password_resets',
  'quick_notes',
  'sadhana_tasks', 'sadhana_tags', 'sadhana_updates', 'sadhana_recur_history',
  'sadhana_quadrant_names',
  'task_categories', 'sprints', 'dev_tasks', 'dev_task_tags', 'project_archives',
  'backlog_docs', 'backlog_doc_revisions',
]

function orderTablesFkSafe(tables) {
  const live = tables.filter((t) => !DROPPED_DEAD_TABLES.has(t))
  for (const t of tables) {
    if (DROPPED_DEAD_TABLES.has(t)) console.warn(`  ⚠ skipping dead table "${t}" (dropped by migration 0048 — data is inert)`)
  }
  const known = FK_SAFE_TABLE_ORDER.filter((t) => live.includes(t))
  const unknown = live.filter((t) => !FK_SAFE_TABLE_ORDER.includes(t)).sort()
  return [...known, ...unknown]
}

function restoreIntoD1(dbName, snapshot, tables) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'hibana-restore-safe-'))
  const sqlFile = join(tmpDir, 'restore.sql')
  const sql = generateRestoreSql(snapshot, tables)
  writeFileSync(sqlFile, sql)
  try {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    console.log(`  Restoring into ${dbName}...`)
    execFileSync(npx, [
      'wrangler', 'd1', 'execute', dbName,
      '--remote', '--file', sqlFile,
    ], { stdio: 'inherit', timeout: 300000 })
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ─── Summary table printer ──────────────────────────────────────────────────

function printSummary(backupCounts, devCounts, prodCounts, tables) {
  console.log('')
  console.log('┌' + '─'.repeat(90) + '┐')
  console.log('│ ' + 'Table'.padEnd(28) + 'Backup'.padStart(10) + 'Restored-DEV'.padStart(14) + 'Current-PROD'.padStart(14) + 'Status'.padStart(20) + ' │')
  console.log('├' + '─'.repeat(90) + '┤')

  let checkAFailures = 0
  let checkBWarnings = 0

  for (const table of tables) {
    if (table.endsWith('_fts') || table === 'users') continue
    const backup = backupCounts.get(table) ?? 0
    const dev = devCounts.get(table) ?? '?'
    const prod = prodCounts.get(table) ?? '?'

    let status, marker
    // Check A: restored-DEV must match backup exactly
    if (dev !== backup) {
      status = '✗ CHECK A FAILED'
      marker = 'A'
      checkAFailures++
    } else if (typeof prod === 'number' && prod > dev) {
      status = `⚠ PROD has ${prod - dev} more`
      marker = 'B'
      checkBWarnings++
    } else if (typeof prod === 'number' && prod < dev) {
      status = `✓ backup has ${dev - prod} more`
      marker = ' '
    } else {
      status = '✓ match'
      marker = ' '
    }

    const row = '│ ' +
      table.padEnd(28) +
      String(backup).padStart(10) +
      String(dev).padStart(14) +
      String(prod).padStart(14) +
      status.padStart(20) +
      ' │'
    console.log(row)
  }

  console.log('└' + '─'.repeat(90) + '┘')
  console.log('')

  return { checkAFailures, checkBWarnings }
}

// ─── Interactive prompt ─────────────────────────────────────────────────────

function confirm(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'yes')
    })
  })
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Hibana Safe Restore (canary verification)')
  console.log('  PROD is never touched until DEV is verified + you confirm')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')

  // 1. Decrypt + parse the backup
  console.log('Step 1: Load + decrypt backup')
  const rawFile = readFileSync(file)
  let jsonText
  const parsedFile = parseBackupFile(rawFile)
  if (parsedFile.kind === 'encrypted') {
    const encKey = process.env.BACKUP_ENCRYPTION_KEY
    if (!encKey) {
      console.error('  ✗ This backup is encrypted (HIBENC1). Set BACKUP_ENCRYPTION_KEY env var.')
      process.exit(1)
    }
    console.log('  Decrypting (AES-GCM)...')
    jsonText = await decryptBackupBytes(parsedFile.bytes, encKey)
  } else if (parsedFile.kind === 'plaintext-json') {
    console.log('  Plaintext JSON backup (no encryption).')
    jsonText = parsedFile.text
  } else {
    console.error(`  ✗ Not a recognizable Hibana backup (starts with: ${JSON.stringify(parsedFile.head)}).`)
    process.exit(1)
  }
  const snapshot = JSON.parse(jsonText)
  const tables = orderTablesFkSafe(Object.keys(snapshot.data))
  const totalRows = tables.reduce((n, t) => n + (snapshot.data[t]?.length ?? 0), 0)
  console.log(`  ✓ Backup loaded: ${tables.length} tables, ${totalRows} total rows`)
  console.log(`  ✓ Backup exported at: ${snapshot.exported_at ?? 'unknown'}`)
  console.log('')

  // 2. Count rows in the backup file (source of truth)
  console.log('Step 2: Count rows in backup file')
  const backupCounts = new Map()
  for (const t of tables) {
    if (t.endsWith('_fts') || t === 'users') continue
    backupCounts.set(t, snapshot.data[t]?.length ?? 0)
  }
  console.log(`  ✓ ${backupCounts.size} tables counted in backup`)
  console.log('')

  // 3. Restore into DEV (sacrificial)
  console.log(`Step 3: Restore into ${DEV_DB} (sacrificial — PROD is untouched)`)
  restoreIntoD1(DEV_DB, snapshot, tables)
  console.log(`  ✓ Restored into ${DEV_DB}`)
  console.log('')

  // 4. Count rows in DEV after restore
  console.log(`Step 4: Count rows in restored ${DEV_DB}`)
  let devCounts
  try {
    devCounts = d1RowCounts(DEV_DB, tables)
    console.log(`  ✓ ${devCounts.size} tables counted in ${DEV_DB}`)
  } catch (err) {
    console.error(`  ✗ Failed to query ${DEV_DB}: ${err.message}`)
    console.error('  PROD was NOT touched. Fix the DEV query issue and re-run.')
    process.exit(1)
  }
  console.log('')

  // 5. Count rows in current PROD (for Check B)
  console.log(`Step 5: Count rows in current ${PROD_DB} (for staleness check)`)
  let prodCounts
  try {
    prodCounts = d1RowCounts(PROD_DB, tables)
    console.log(`  ✓ ${prodCounts.size} tables counted in ${PROD_DB}`)
  } catch (err) {
    console.error(`  ⚠ Failed to query ${PROD_DB}: ${err.message}`)
    console.error('  Check B (staleness) cannot run. Check A still ran — see below.')
    prodCounts = new Map()
  }
  console.log('')

  // 6. Print summary + run checks
  console.log('Step 6: Verification summary')
  const { checkAFailures, checkBWarnings } = printSummary(backupCounts, devCounts, prodCounts, tables)

  // Check A: restored-DEV must match backup exactly
  if (checkAFailures > 0) {
    console.error(`✗ CHECK A FAILED: ${checkAFailures} table(s) in restored-DEV do not match the backup.`)
    console.error('  The restore process lost data. DO NOT restore into PROD.')
    console.error('  PROD was NOT touched. Investigate the restore script or the backup file.')
    process.exit(1)
  }
  console.log('✓ CHECK A PASSED: restored-DEV matches the backup exactly (no data lost in restore).')

  // Check B: warn if PROD has more rows than the backup (stale backup)
  if (checkBWarnings > 0) {
    console.error(`⚠ CHECK B WARNING: ${checkBWarnings} table(s) in PROD have MORE rows than the backup.`)
    console.error('  The backup is older than current PROD — restoring it would LOSE recent data.')
    console.error('  PROD was NOT touched. Use a more recent backup, or proceed with --force if you accept the loss.')
    if (!FORCE) {
      console.error('  (Re-run with --force to override this warning and proceed to PROD restore anyway.)')
      process.exit(1)
    }
    console.error('  --force specified: proceeding despite the staleness warning.')
  } else {
    console.log('✓ CHECK B PASSED: backup is current (PROD has no more rows than the backup).')
  }

  // 7. Confirm + restore into PROD
  if (DRY_RUN) {
    console.log('')
    console.log('── Dry run complete ──')
    console.log('  Both checks passed. PROD was NOT touched (--dry-run).')
    console.log('  To restore into PROD, re-run without --dry-run.')
    process.exit(0)
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Both checks passed. Ready to restore into ${PROD_DB}.`)
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')

  if (!FORCE) {
    const ok = await confirm(`  Type "yes" to restore into ${PROD_DB} (this WIPES and replaces PROD data): `)
    if (!ok) {
      console.log('  Cancelled. PROD was NOT touched.')
      process.exit(0)
    }
  }

  console.log('')
  console.log(`Step 7: Restore into ${PROD_DB}`)
  restoreIntoD1(PROD_DB, snapshot, tables)
  console.log(`  ✓ Restored into ${PROD_DB}`)
  console.log('')

  // 8. Final verification — count PROD rows after restore
  console.log(`Step 8: Verify ${PROD_DB} row counts after restore`)
  try {
    const prodAfter = d1RowCounts(PROD_DB, tables)
    let mismatches = 0
    for (const [t, n] of backupCounts) {
      if (prodAfter.get(t) !== n) {
        console.error(`  ✗ ${t}: expected ${n}, got ${prodAfter.get(t)}`)
        mismatches++
      }
    }
    if (mismatches > 0) {
      console.error(`  ⚠ ${mismatches} table(s) in PROD don't match the backup after restore.`)
      console.error('  The PROD restore may have partially failed. Check wrangler logs.')
      process.exit(1)
    }
    console.log(`  ✓ All ${backupCounts.size} tables in PROD match the backup exactly.`)
  } catch (err) {
    console.error(`  ⚠ Could not verify PROD after restore: ${err.message}`)
    console.error('  The restore ran but verification failed. Check PROD manually.')
    process.exit(1)
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  ✅ Safe restore complete. PROD now matches the backup.')
  console.log('  Log in at https://hibana.ir and verify your data.')
  console.log('═══════════════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error('')
  console.error('Safe restore FAILED:')
  console.error(err instanceof Error ? err.message : String(err))
  console.error('')
  console.error('PROD was NOT touched (the failure happened before the PROD restore step).')
  process.exit(1)
})
