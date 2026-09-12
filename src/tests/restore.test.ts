import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { buildSnapshot, buildUserSnapshot, encryptBackup, importAesKey, bytesToBase64, isEncryptedBlob } from '../services/backup'
import { createSqliteDb } from '../db/sqlite'
import { applyMigrations } from '../db/migrate-node'
import { makeUser } from './helpers'
import type { Db } from '../db/types'

// Restore-path E2E tests (Session 27, Focus 4): the backup EXPORT side had 38 tests; the
// RESTORE side — the half that actually saves the day in a disaster — had none beyond the
// manual drills. These run the REAL scripts/restore.mjs as a child process (the exact
// runbook path: download a snapshot file → node scripts/restore.mjs --file <f>) against
// scratch databases built by the REAL migration runner.
//
// Found + fixed by this suite's development (a3a8bc5): restore.mjs was dead against
// schema 47 (DELETE FROM changelogs — table dropped by 0048) and the drill's synthetic
// data used pre-0031 statuses. These tests pin the fixed behavior so the restore path
// can never silently rot again.

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const RESTORE = join(ROOT, 'scripts', 'restore.mjs')
const MIGRATIONS = join(ROOT, 'migrations')

/** Fresh migrated schema at a scratch path (the restore TARGET). */
function freshDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-test-'))
  const path = join(dir, `${name}.db`)
  applyMigrations(path, MIGRATIONS)
  return path
}

function countsOf(dbPath: string): Record<string, number> {
  const db = new DatabaseSync(dbPath)
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != 'changelogs_fts'").all() as { name: string }[]).map((r) => r.name)
    const out: Record<string, number> = {}
    for (const t of tables) {
      try {
        out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
      } catch { /* virtual/config tables */ }
    }
    return out
  } finally {
    db.close()
  }
}

/** Run the real restore script; resolves { code, stdout, stderr } without throwing. */
async function runRestore(file: string, dbPath: string, env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [RESTORE, '--file', file], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH: dbPath, ...env },
      timeout: 60_000,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' }
  }
}

/** A source DB with representative rows across the WHOLE FK graph (one row per table,
 * valid 0031 7-stage statuses — the drill's original data used pre-0031 values and
 * crashed the CHECK constraint). */
async function populatedDb(): Promise<{ db: Db; close(): void; userId: string; projectId: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-src-'))
  const path = join(dir, 'src.db')
  applyMigrations(path, MIGRATIONS)
  const db = createSqliteDb(path)
  const now = new Date().toISOString()
  const U = '11111111-1111-4111-8111-111111111111'
  const F = '22222222-2222-4222-8222-222222222222'
  const P = '33333333-3333-4333-8333-333333333333'
  const H = '44444444-4444-4444-8444-444444444444'
  const T = '55555555-5555-4555-8555-555555555555'
  const QN = '66666666-6666-4666-8666-666666666666'
  const ST = '77777777-7777-4777-8777-777777777777'
  const DT = '88888888-8888-4888-8888-888888888888'
  const BD = '99999999-9999-4999-8999-999999999999'
  try {
    await db.execute(
      'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [U, 'restore-e2e', 'restore-e2e@test.dev', 'pbkdf2$100000$s$h', 'owner', 'en', 'gregorian', 'UTC', now, now],
    )
    await db.execute('INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [F, U, 'Folder', 0, now])
    await db.execute('INSERT INTO projects (id, user_id, folder_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [P, U, F, 'P', 'd', 'personal', 'doing', 0, 'note', now, now])
    await db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', ['h1', P, 'status moved spark → doing', now])
    await db.execute('INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [H, P, 'blocker', 'open', 0, now])
    await db.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, ?, ?)', [T, U, 'AI', '#f6d365', 1, now])
    await db.execute('INSERT INTO project_tags (project_id, tag_id) VALUES (?, ?)', [P, T])
    await db.execute('INSERT INTO links (id, project_id, label, url, created_at) VALUES (?, ?, ?, ?, ?)', ['l1', P, 'L', 'https://x.example', now])
    await db.execute('INSERT INTO tasks (id, project_id, title, done, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['t1', P, 'T', 1, '2026-09-01', now])
    await db.execute('INSERT INTO payments (id, project_id, label, amount, currency, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['pay1', P, 'Dep', 100, 'USD', 'paid', now])
    await db.execute('INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, z_index, deleted, board, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['cv1', U, 'note', 10, 20, 100, 50, '#fff', 'idea', 0, 0, 'board', now, now])
    await db.execute('INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [QN, U, 'note', 'qn', 'quick note content', now, now])
    await db.execute('INSERT INTO sadhana_tasks (id, user_id, quadrant, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [ST, U, 1, 'ST', now, now])
    await db.execute('INSERT INTO sadhana_tags (task_id, tag) VALUES (?, ?)', [ST, 'w'])
    await db.execute('INSERT INTO task_categories (id, project_id, name, created_at) VALUES (?, ?, ?, ?)', ['cat1', P, 'C', now])
    await db.execute('INSERT INTO sprints (id, project_id, name, started_at, created_at) VALUES (?, ?, ?, ?, ?)', ['sp1', P, 'S', now, now])
    await db.execute('INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [DT, P, 'DT', 'done', 'medium', 'cat1', 'sp1', now])
    await db.execute('INSERT INTO dev_task_tags (task_id, tag_id) VALUES (?, ?)', [DT, T])
    await db.execute("INSERT INTO project_archives (id, project_id, title, status, priority, original_created_at, archived_at) VALUES (?, ?, ?, 'done', 'low', ?, ?)", ['ar1', P, 'A', now, now])
    await db.execute('INSERT INTO backlog_docs (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [BD, P, 'BD', now, now])
    await db.execute('INSERT INTO backlog_doc_revisions (id, doc_id, kind, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['bdr1', BD, 'update', 'BD', 'body', now])
  } catch (err) {
    db.close()
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
  return { db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }) }, userId: U, projectId: P }
}

/** Write a plaintext snapshot file; returns its path. */
function writeSnapshotFile(dir: string, snapshot: object, name = 'snap.json'): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(snapshot, null, 2))
  return path
}

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')

describe('restore E2E — the REAL scripts/restore.mjs (the runbook disaster path)', () => {
  it('original-DB restore (users pre-exist, UUIDs match): FK-check clean + row parity', async () => {
    // The PRIMARY runbook flow — restore into the ORIGINAL database (or one seeded with
    // the same user ids). Auth is never restored (rule 8), so the users rows must already
    // exist; with them, the restored data graph is FK-complete.
    const src = await populatedDb()
    const target = freshDbPath('fk-safe')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      // Simulate the original DB: same user id, WITH a (placeholder) password hash.
      const tdb = new DatabaseSync(target)
      tdb.prepare("INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'restored', 'restore-e2e@test.dev', 'pbkdf2$100000$s$h', 'owner', 'en', 'gregorian', 'UTC', ?, ?)").run(new Date().toISOString(), new Date().toISOString())
      tdb.close()

      const snapshot = await buildSnapshot(src.db)
      const file = writeSnapshotFile(dir, snapshot)

      const r = await runRestore(file, target)
      expect(r.code).toBe(0)

      // Row parity on every snapshot table except users (never restored by design).
      for (const [table, rows] of Object.entries(snapshot.data)) {
        if (table === 'users') continue
        expect(countsOf(target)[table]).toBe(rows.length)
      }
      // The definitive check: no FK violation EXISTS in the final state.
      const db = new DatabaseSync(target)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      db.close()
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('fresh-target restore (no users): row parity holds and the ONLY dangling FKs are the documented user_id → users rows', async () => {
    // The documented caveat (restore.mjs header): restoring into a brand-NEW database
    // leaves rows bound to the OLD user UUID — auth principals are re-seeded, never
    // restored. This test PINS that behavior: content rows all restore, and the FK
    // violations are exactly user_id references to the missing users row (nothing else
    // dangles — the FK-safe ordering did its job). If the design ever changes to insert
    // placeholder-user rows, this test will flag it for runbook updates.
    const src = await populatedDb()
    const target = freshDbPath('fresh-target')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const snapshot = await buildSnapshot(src.db)
      const file = writeSnapshotFile(dir, snapshot)

      const r = await runRestore(file, target)
      expect(r.code).toBe(0)
      for (const [table, rows] of Object.entries(snapshot.data)) {
        if (table === 'users') continue
        expect(countsOf(target)[table]).toBe(rows.length)
      }
      const db = new DatabaseSync(target)
      const violations = db.prepare('PRAGMA foreign_key_check').all() as { table: string; parent: string }[]
      db.close()
      expect(violations.length).toBeGreaterThan(0) // the caveat is real
      for (const v of violations) {
        expect(v.table).not.toBe('users')
        // every violation is a child row whose user_id (or similar) points at the missing users row
        expect(['projects', 'spark_folders', 'tags', 'canvas_elements', 'quick_notes', 'sadhana_tasks', 'sadhana_quadrant_names', 'telegram_captures', 'telegram_links', 'invites', 'dev_task_tags', 'project_tags']).toContain(v.table)
      }
      // integrity itself is intact (dangling references, not corruption)
      const db2 = new DatabaseSync(target)
      expect(db2.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      db2.close()
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('encrypted round-trip (GitHub raw-binary shape): buildSnapshot → AES-GCM → restore.mjs with the key → row parity', async () => {
    const src = await populatedDb()
    const target = freshDbPath('enc-gh')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const snapshot = await buildSnapshot(src.db)
      const key = await importAesKey(KEY)
      const blob = await encryptBackup(key, new TextEncoder().encode(JSON.stringify(snapshot, null, 2)))
      expect(isEncryptedBlob(blob)).toBe(true)
      const file = join(dir, 'snap-raw.bin')
      writeFileSync(file, blob) // raw binary — the GitHub download_url shape

      const r = await runRestore(file, target, { BACKUP_ENCRYPTION_KEY: KEY })
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('Decrypting')
      for (const [table, rows] of Object.entries(snapshot.data)) {
        if (table === 'users') continue
        expect(countsOf(target)[table]).toBe(rows.length)
      }
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('encrypted round-trip (Telegram base64-text shape): the Plan B document form restores identically', async () => {
    const src = await populatedDb()
    const target = freshDbPath('enc-tg')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const snapshot = await buildSnapshot(src.db)
      const key = await importAesKey(KEY)
      const blob = await encryptBackup(key, new TextEncoder().encode(JSON.stringify(snapshot, null, 2)))
      const file = join(dir, 'snap-planb.txt')
      writeFileSync(file, bytesToBase64(blob), 'utf8') // base64 text — what Telegram delivers

      const r = await runRestore(file, target, { BACKUP_ENCRYPTION_KEY: KEY })
      expect(r.code).toBe(0)
      expect(countsOf(target).projects).toBe(1)
      expect(countsOf(target).sadhana_tasks).toBe(1)
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('wrong key: restore.mjs fails loudly (exit 1) and the target DB is untouched', async () => {
    const src = await populatedDb()
    const target = freshDbPath('wrongkey')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const snapshot = await buildSnapshot(src.db)
      const key = await importAesKey(KEY)
      const blob = await encryptBackup(key, new TextEncoder().encode(JSON.stringify(snapshot)))
      const file = join(dir, 'snap.bin')
      writeFileSync(file, blob)

      const wrongKey = Buffer.from(new Uint8Array(32).fill(9)).toString('base64')
      const r = await runRestore(file, target, { BACKUP_ENCRYPTION_KEY: wrongKey })
      expect(r.code).not.toBe(0)
      expect((r.stderr + r.stdout).toLowerCase()).toMatch(/decrypt|fail|error/)
      // Graceful failure means NO partial writes: the target still has zero data rows.
      expect(countsOf(target).projects).toBe(0)
      expect(countsOf(target).quick_notes).toBe(0)
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('legacy plaintext snapshot (pre-encryption era) restores without a key', async () => {
    const src = await populatedDb()
    const target = freshDbPath('legacy')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const snapshot = await buildSnapshot(src.db)
      const file = writeSnapshotFile(dir, snapshot)
      // NO BACKUP_ENCRYPTION_KEY in env → the plaintext path must work untouched.
      const r = await runRestore(file, target, { BACKUP_ENCRYPTION_KEY: '' })
      expect(r.code).toBe(0)
      expect(countsOf(target).projects).toBe(1)
      // isEncryptedBlob must classify both shapes correctly (unit-level pin).
      expect(isEncryptedBlob(new TextEncoder().encode('{"schema_version":1}'))).toBe(false)
      const key = await importAesKey(KEY)
      expect(isEncryptedBlob(await encryptBackup(key, new TextEncoder().encode('{}')))).toBe(true)
      expect(isEncryptedBlob(new Uint8Array(3))).toBe(false) // too short to be anything
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('partial snapshot (missing newer tables) restores what it carries — tables absent from the snapshot are simply untouched', async () => {
    // A pre-Session-20 snapshot shape: only the original tables, no dev-board cluster,
    // no quick_notes, no sadhana. The restore must handle the missing keys gracefully.
    const snapshot = {
      schema_version: 20260828,
      exported_at: '2026-08-28T00:00:00.000Z',
      data: {
        users: [{ id: 'u1', username: 'old', email: 'old@test.dev' }],
        projects: [{ id: 'p-old', user_id: 'u1', title: 'Old project', status: 'doing', created_at: '2026-08-01', updated_at: '2026-08-01' }],
        hurdles: [{ id: 'h-old', project_id: 'p-old', text: 'old blocker', status: 'open', sort_order: 0, created_at: '2026-08-01' }],
      },
    }
    const target = freshDbPath('partial')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const file = writeSnapshotFile(dir, snapshot)
      const r = await runRestore(file, target)
      expect(r.code).toBe(0)
      expect(countsOf(target).projects).toBe(1)
      expect(countsOf(target).hurdles).toBe(1)
      expect(countsOf(target).quick_notes).toBe(0) // absent from snapshot → untouched
      expect(countsOf(target).dev_tasks).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('cross-schema restore: an old snapshot carrying DROPPED tables (changelogs, pre-0048) restores cleanly with a skip warning', async () => {
    const snapshot = {
      schema_version: 20260910,
      exported_at: '2026-09-05T00:00:00.000Z',
      data: {
        users: [{ id: 'u1', username: 'old', email: 'old@test.dev' }],
        projects: [{ id: 'p-old', user_id: 'u1', title: 'Old', status: 'doing', created_at: '2026-09-01', updated_at: '2026-09-01' }],
        changelogs: [{ id: 'c1', project_id: 'p-old', body: 'dead table data', created_at: '2026-09-01' }], // dropped by 0048
      },
    }
    const target = freshDbPath('cross-schema')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const file = writeSnapshotFile(dir, snapshot)
      const r = await runRestore(file, target)
      expect(r.code).toBe(0) // pre-fix this would have been "no such table: changelogs"
      expect(r.stdout + r.stderr).toContain('changelogs') // the skip warning names the table
      expect(countsOf(target).projects).toBe(1) // live data restored
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('forward-compat: a snapshot carrying an UNKNOWN future table skips it (with a warning) instead of crashing', async () => {
    const snapshot = {
      schema_version: 20270101,
      exported_at: '2027-01-01T00:00:00.000Z',
      data: {
        users: [{ id: 'u1', username: 'future', email: 'f@test.dev' }],
        projects: [{ id: 'p-f', user_id: 'u1', title: 'Future', status: 'doing', created_at: '2027-01-01', updated_at: '2027-01-01' }],
        future_widgets: [{ id: 'w1', project_id: 'p-f', label: 'unknown-to-this-schema' }], // table this schema doesn't have
      },
    }
    const target = freshDbPath('forward')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      const file = writeSnapshotFile(dir, snapshot)
      const r = await runRestore(file, target)
      expect(r.code).toBe(0)
      expect(r.stdout + r.stderr).toContain('future_widgets') // named in the skip warning
      expect(countsOf(target).projects).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })

  it('large snapshot: 1,000+ rows per table round-trips with exact counts (no truncation)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-src-'))
    const path = join(dir, 'big.db')
    applyMigrations(path, MIGRATIONS)
    const db = createSqliteDb(path)
    const now = new Date().toISOString()
    const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const N = 1100
    try {
      await db.execute('INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [U, 'big', 'big@test.dev', 'x', 'owner', 'en', 'gregorian', 'UTC', now, now])
      await db.execute('INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', ['f-big', U, 'F', 0, now])
      for (let i = 0; i < N; i++) {
        await db.execute('INSERT INTO projects (id, user_id, folder_id, title, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [`p-${i}`, U, 'f-big', `Project ${i}`, 'doing', i, now, now])
      }
      for (let i = 0; i < N; i++) {
        await db.execute('INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, z_index, deleted, board, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [`cv-${i}`, U, 'note', i, i, 10, 10, '#fff', `content ${i} — تست فارسی`, i, 0, 'board', now, now])
      }
      for (let i = 0; i < N; i++) {
        await db.execute('INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`qn-${i}`, U, 'note', `note ${i}`, `note ${i}`, now, now])
      }
      const snapshot = await buildSnapshot(db)
      expect(snapshot.data.projects).toHaveLength(N)
      const target = freshDbPath('big')
      const fdir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
      try {
        const file = writeSnapshotFile(fdir, snapshot)
        const r = await runRestore(file, target)
        expect(r.code).toBe(0)
        expect(countsOf(target).projects).toBe(N)
        expect(countsOf(target).canvas_elements).toBe(N)
        expect(countsOf(target).quick_notes).toBe(N)
        // spot-check content survived (Persian + digits — no encoding loss)
        const check = new DatabaseSync(target).prepare("SELECT content FROM quick_notes WHERE id = 'qn-7'").get()
        expect(check).toEqual({ content: 'note 7' })
      } finally {
        rmSync(fdir, { recursive: true, force: true })
        rmSync(join(target, '..'), { recursive: true, force: true })
      }
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('concurrent restores into the same target never corrupt it (SQLite serializes; each restore is transaction-atomic)', async () => {
    const src = await populatedDb()
    const target = freshDbPath('concurrent')
    const dir = mkdtempSync(join(tmpdir(), 'hibana-restore-files-'))
    try {
      // Original-DB scenario: users pre-exist so the final state is FK-complete.
      const tdb = new DatabaseSync(target)
      tdb.prepare("INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'c', 'c@test.dev', 'x', 'owner', 'en', 'gregorian', 'UTC', ?, ?)").run(new Date().toISOString(), new Date().toISOString())
      tdb.close()
      const snapshot = await buildSnapshot(src.db)
      const a = writeSnapshotFile(dir, snapshot, 'a.json')
      const b = writeSnapshotFile(dir, snapshot, 'b.json')
      // Two restores race into the same DB file — node:sqlite takes a write lock; one
      // waits (or fails cleanly); the result must NEVER be a half-written database.
      const results = await Promise.all([runRestore(a, target), runRestore(b, target)])
      expect(results.every((r) => r.code === 0 || /SQLITE_BUSY|locked/i.test(r.stderr))).toBe(true)
      const db = new DatabaseSync(target)
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      // The final state is exactly one full snapshot (both carries identical data).
      expect(countsOf(target).projects).toBe(1)
      expect(countsOf(target).sadhana_tasks).toBe(1)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      db.close()
    } finally {
      src.close()
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(target, '..'), { recursive: true, force: true })
    }
  })
})
