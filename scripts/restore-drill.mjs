#!/usr/bin/env node
// P0 restore drill (ROADMAP): prove `scripts/restore.mjs` can pull a real backup back into a
// working database. Run via `npm run drill` (harness under tsx; the actual restore.mjs child
// process runs in plain node — the same path a bare Node deploy uses).
//
// Part A — real production snapshot sanity:
//   fetch the newest backups/snapshot-*.json from the GitHub assets repo, check the format and
//   rule-8 exclusions (no users.password_hash, no sessions), restore into a scratch DB.
//   (Prod is brand-new, so idea tables may legitimately be empty — that's fine.)
// Part B — synthetic round-trip through the REAL export path:
//   build a small DB with representative rows, snapshot it with buildSnapshot() (the exact
//   production exporter), restore that snapshot into a second scratch DB, and assert data
//   moved, `users` was left untouched, and the FTS search index rebuilt from triggers.
//
// Prints counts/status only — never snapshot contents or secret values.

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { secrets } from './lib.mjs'
import { parseBackupFile, decryptBackupBytes } from './lib-backup.mjs'
import { buildSnapshot } from '../src/services/backup.ts'
import { createSqliteDb } from '../src/db/sqlite.ts'
import { applyMigrations } from '../src/db/migrate-node.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const migrationsDir = join(root, 'migrations')
const restoreScript = join(here, 'restore.mjs')

const s = secrets()
const OWNER = s.GITHUB_OWNER ?? 'assadigit'
const REPO = s.GITHUB_REPO ?? 'hibana-safe'
if (!s.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN not set in .secrets.env')
  process.exit(1)
}
const API = 'https://api.github.com'
const gh = (extra = {}) => ({
  'User-Agent': 'hibana-restore-drill',
  'X-GitHub-Api-Version': '2022-11-28',
  Authorization: `Bearer ${s.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3.raw', // rule 7: raw header for file reads
  ...extra,
})

async function restoreInto(snapPath, dbPath) {
  const s = secrets()
  execFileSync(process.execPath, [restoreScript, '--file', snapPath], {
    cwd: root,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      // Flow the key (env OR .secrets.env) into the child restore process — the drill
      // downloads encrypted snapshots since C3, and the child decrypts them itself.
      BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY ?? s.BACKUP_ENCRYPTION_KEY ?? '',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
}

function tableCounts(dbPath) {
  const db = new DatabaseSync(dbPath)
  const out = {}
  for (const t of ['users', 'projects', 'hurdles', 'tags', 'project_tags', 'links', 'canvas_elements', 'telegram_captures', 'tasks', 'payments', 'projects_fts', 'changelogs_fts']) {
    try {
      out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
    } catch {
      out[t] = 'n/a'
    }
  }
  db.close()
  return out
}

const work = mkdtempSync(join(tmpdir(), 'hibana-drill-'))
let exitCode = 1
let partASkipped = false
try {
  // ----------------------------------------------------------------------------
  // Part A — real production snapshot sanity
  // (2026-09-12: skippable when the newest backup is encrypted and BACKUP_ENCRYPTION_KEY
  // is absent — the key is owner-held and never pasted into agent sandboxes. Part B (the
  // synthetic round-trip that proves the restore MECHANICS) must still run: without this
  // skip, every fresh environment without the key could never execute the drill at all,
  // which made the DR tool itself unrestorable-verification-less. A skip is LOUD — the
  // final summary always reports it, so a pre-restore operator never mistakes a
  // skipped Part A for a verified one. Every other Part A failure (repo unreachable,
  // malformed snapshot, rule-8 violation) still hard-fails the drill.)
  // ----------------------------------------------------------------------------
  console.log('== Part A: real production backup ==')
  try {
    const listUrl = `${API}/repos/${OWNER}/${REPO}/contents/backups`
    const listRes = await fetch(listUrl, { headers: gh() })
    if (!listRes.ok) throw new Error(`GitHub list failed (${listRes.status}): ${await listRes.text()}`)
    const files = (await listRes.json())
      .filter((f) => f.name && f.name.startsWith('snapshot-') && f.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (files.length === 0) throw new Error('no backups/snapshot-*.json found in the assets repo')
    const latest = files[files.length - 1]
    console.log(`backups on GitHub: ${files.length}  (newest: ${latest.name}, ${latest.size} bytes)`)

  const snapA = join(work, latest.name)
  const dl = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${latest.path}`, { headers: gh() })
  if (!dl.ok) throw new Error(`snapshot download failed (${dl.status})`)
  writeFileSync(snapA, Buffer.from(await dl.arrayBuffer()))
  // 2026-09-11: the raw download is the RAW-BINARY HIBENC1 blob (GitHub decodes the
  // base64 PUT before storing). Part A decrypts it here when the key is available —
  // rule-8 checks + the restore round-trip then run on the real decrypted snapshot.
  // (Before this fix the drill JSON.parsed the binary directly and crashed.)
  const drillKey = process.env.BACKUP_ENCRYPTION_KEY ?? s.BACKUP_ENCRYPTION_KEY
  const parsedA = parseBackupFile(readFileSync(snapA))
  let real
  if (parsedA.kind === 'encrypted') {
    if (!drillKey) {
      partASkipped = true
      console.log('  ⚠ SKIPPED: the newest backup is AES-GCM encrypted and BACKUP_ENCRYPTION_KEY is not set in this environment (owner-held secret). Part A cannot verify the real backup — run the drill on the owner machine (credentials.md) for real-snapshot verification. Part B still proves the restore mechanics below.')
      rmSync(snapA)
    } else {
      console.log('  newest backup is AES-GCM encrypted — decrypting with BACKUP_ENCRYPTION_KEY...')
      real = JSON.parse(await decryptBackupBytes(parsedA.bytes, drillKey))
      // The file on disk stays RAW BINARY on purpose: the restore round-trip below then
      // exercises restore.mjs's raw-binary path — the exact runbook download shape.
    }
  } else if (parsedA.kind === 'plaintext-json') {
    real = JSON.parse(parsedA.text)
  } else {
    throw new Error('downloaded file is not a recognizable Hibana backup')
  }
  if (real) {
    if (!real.schema_version || !real.data) throw new Error('snapshot missing schema_version/data — not a Hibana backup')
    const usersHavePasswordHash = (real.data.users ?? []).some((r) => 'password_hash' in r)
    const hasSessions = 'sessions' in real.data
    if (usersHavePasswordHash || hasSessions) throw new Error('real snapshot violates rule 8 (password_hash/sessions present)')

    const dbA = join(work, 'a.db')
    applyMigrations(dbA, migrationsDir)
    await restoreInto(snapA, dbA)
    const countsA = tableCounts(dbA)
    const ideaRowsA = Object.entries(countsA).filter(([t]) => !['users', 'projects_fts', 'changelogs_fts'].includes(t)).reduce((n, [, c]) => n + (typeof c === 'number' ? c : 0), 0)
    console.log(`real snapshot restored cleanly (schema ${real.schema_version}); idea-data rows: ${ideaRowsA}`, countsA)
    console.log(`rule-8 ok: no users.password_hash in snapshot, no sessions table`)
    rmSync(snapA)
  }
  } catch (err) {
    // Only the no-key skip is recoverable — everything else (repo unreachable, malformed
    // snapshot, rule-8 violation, restore crash) is a REAL backup-system failure and
    // must fail the whole drill.
    if (!partASkipped) throw err
  }

  // ----------------------------------------------------------------------------
  // Part B — synthetic round-trip through the real export path
  // ----------------------------------------------------------------------------
  console.log('== Part B: synthetic data round-trip ==')
  const originDb = join(work, 'origin.db')
  applyMigrations(originDb, migrationsDir)
  const odb = createSqliteDb(originDb)
  const now = '2026-08-20T00:00:00.000Z'
  const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const P2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const H1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const H2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const T1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

  await odb.execute(
    `INSERT INTO users (id, username, email, password_hash, role, telegram_chat_id, language_pref, calendar_pref, timezone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [U, 'admin-drill', 'drill@example.com', 'pbkdf2$100000$salt$hash', 'owner', null, 'en', 'gregorian', 'UTC', now],
  )
  await odb.execute(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [P1, U, 'Drill personal project', 'proves restore works', 'personal', 'doing', 0, 'left off here', null, null, null, null, now, now],
  )
  await odb.execute(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [P2, U, 'Acme redesign', 'client delivery', 'client', 'awaiting', 0, '', null, null, 'Acme', '2026-09-01', now, now],
  )
  await odb.execute('INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at, solved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [H1, P1, 'infra blockers', 'open', 0, now, null])
  await odb.execute('INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at, solved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [H2, P1, 'done hurdle', 'solved', 1, now, now])
  await odb.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [T1, U, 'AI', '#f6d365', 1, now])
  await odb.execute('INSERT INTO project_tags (project_id, tag_id) VALUES (?, ?)', [P1, T1])
  await odb.execute('INSERT INTO links (id, project_id, label, url, created_at) VALUES (?, ?, ?, ?, ?)',
    ['11111111-1111-4111-8111-111111111111', P1, 'Repo', 'https://example.com', now])
  await odb.execute(
    `INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, promoted_project_id, z_index, deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['22222222-2222-4222-8222-222222222222', U, 'note', 120.5, 340, 220, 140, '#fef08a', 'vibe idea', null, 0, 0, now, now],
  )
  await odb.execute(
    `INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, promoted_project_id, z_index, deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['33333333-3333-4333-8333-333333333333', U, 'stroke', 10, 20, null, null, '#333333', '[[0,0],[5,8]]', null, 1, 0, now, now],
  )
  // Capture with a NULL user_id (message arrived before account linking — schema allows it).
  await odb.execute(
    'INSERT INTO telegram_captures (id, user_id, raw_text, telegram_user_id, received_at, promoted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['44444444-4444-4444-8444-444444444444', null, 'capture me', 'tg-123', now, 0, now],
  )
  await odb.execute('INSERT INTO tasks (id, project_id, title, done, due_date, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['55555555-5555-4555-8555-555555555555', P2, 'deliver mockups', 1, '2026-08-25', now, now])
  await odb.execute('INSERT INTO payments (id, project_id, label, amount, currency, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['66666666-6666-4666-8666-666666666666', P2, 'Deposit', 500, 'USD', 'paid', now])

  const snapshot = await buildSnapshot(odb)
  odb.close()
  if ((snapshot.data.users ?? []).some((r) => 'password_hash' in r)) throw new Error('buildSnapshot failed rule-8 (hash exported)')
  const snapB = join(work, 'drill-synthetic.json')
  writeFileSync(snapB, JSON.stringify(snapshot, null, 2))
  console.log('exported synthetic snapshot via buildSnapshot() — tables:', Object.keys(snapshot.data).length)

  const targetDb = join(work, 'target.db')
  applyMigrations(targetDb, migrationsDir)
  await restoreInto(snapB, targetDb)
  const countsB = tableCounts(targetDb)
  console.log('restored counts:', countsB)

  const checks = {
    'projects restored (2)': countsB.projects === 2,
    'hurdles restored (2)': countsB.hurdles === 2,
    'tags + project_tags restored (1+1)': countsB.tags === 1 && countsB.project_tags === 1,
    'links restored (1)': countsB.links === 1,
    'canvas elements restored (2)': countsB.canvas_elements === 2,
    'telegram captures restored (1, incl. null-user)': countsB.telegram_captures === 1,
    'client data restored (task/payment)': countsB.tasks === 1 && countsB.payments === 1,
    'users untouched (auth never restored)': countsB.users === 0,
    'FTS search index rebuilt via triggers (2)': countsB.projects_fts === 2,
  }
  let pass = true
  for (const [label, ok] of Object.entries(checks)) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
    if (!ok) pass = false
  }
  if (partASkipped) {
    console.log('SKIPPED Part A — real-snapshot verification needs BACKUP_ENCRYPTION_KEY (owner-held). The synthetic round-trip above still proves the restore path mechanics.')
  }
  console.log(pass ? 'RESTORE DRILL PASS — synthetic round-trip OK' + (partASkipped ? ' (Part A skipped: no key)' : ' + real backup sanity OK') : 'RESTORE DRILL FAIL — see checks above')
  exitCode = pass ? 0 : 1
} catch (err) {
  console.error('RESTORE DRILL ERROR:', err instanceof Error ? err.message : err)
  exitCode = 1
} finally {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch (e) {
    console.warn('cleanup skipped:', e instanceof Error ? e.message : String(e))
  }
}

process.exit(exitCode)
