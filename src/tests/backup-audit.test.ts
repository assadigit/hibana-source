import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { SNAPSHOT_TABLES, buildSnapshot, buildUserSnapshot, enforceRetention, importAesKey, encryptBackup, bytesToBase64 } from '../services/backup'
import { githubClient } from '../services/github'
import { makeTestDb, makeTestDbUpto, makeUser } from './helpers'

// Session 27 (Focus 4): backup-system AUDIT tests — the drift guards and isolation
// checks that keep "never lose an idea" true as the schema grows:
//   1. schema-change guard: every table in the REAL schema is classified — a new
//      user-content table that misses SNAPSHOT_TABLES fails here (the Session 20
//      coverage drift can never happen silently again)
//   2. personal-export isolation: every row in a user's export belongs to that user
//   3. retention exactness: exactly N kept, oldest pruned
//   4. Plan B receive-side round-trip: the Telegram document shape (base64 HIBENC1)
//      → sha256 verification → decrypt → REAL restore.mjs → row parity

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()

/** Tables deliberately excluded from snapshots, with the reason. When a NEW migration
 * adds a table, this test forces a conscious decision: add it to SNAPSHOT_TABLES (user
 * content) or to one of these exclusion classes (with a reason comment). */
const FTS_AND_BOOKKEEPING = new Set([
  '_migrations', // migration bookkeeping — never user data
])
const TRANSIENT_STATE = new Set([
  'sessions', // auth state (rule 8)
  'password_resets', // transient auth tokens
  'email_verifications', // transient signup tokens
  'rate_limits', // transient throttle buckets
  'email_log', // delivery diagnostics
  'error_log', // admin diagnostics (7-day retention by design)
  'sadhana_reminder_logs', // transient reminder state
  'telegram_bot_sessions', // bot navigation/UI state (menu position, in-flight intents)
  'planb_backups', // bookkeeping OF the backup system itself
])

function isFtsShadow(name: string): boolean {
  return name.includes('_fts') || name.startsWith('sqlite_')
}

describe('snapshot coverage vs the real schema (the drift guard)', () => {
  it('every table in the migrated schema is either snapshotted or consciously excluded', async () => {
    const { db, close } = makeTestDb()
    try {
      const rows = (await db.query("SELECT name FROM sqlite_master WHERE type='table'")) as { name: string }[]
      const names = rows.map((r) => r.name)
      expect(names.length).toBeGreaterThan(30) // sanity: the schema actually materialized
      const snapshotSet = new Set<string>(SNAPSHOT_TABLES)
      const unclassified: string[] = []
      for (const t of names) {
        if (isFtsShadow(t)) continue // FTS virtual tables rebuild from triggers
        if (FTS_AND_BOOKKEEPING.has(t)) continue
        if (TRANSIENT_STATE.has(t)) continue
        // Not classified → MUST be in the snapshot; this is the guard.
        if (!snapshotSet.has(t)) unclassified.push(t)
      }
      expect(unclassified).toEqual([]) // a new user-content table missing from SNAPSHOT_TABLES lands here
    } finally {
      close()
    }
  })

  it('S53 race guard: a not-yet-migrated DB yields a PARTIAL snapshot with missing_tables, not a crash', async () => {
    // Simulates the deploy-vs-migrate window: the code (SNAPSHOT_TABLES incl. 0057's
    // note_folders/vault_notes) deployed before the owner applied the migration to a
    // remote D1. The snapshot must survive, record the gap loudly, and still carry
    // every table that DOES exist.
    const { db, close } = makeTestDb()
    try {
      await db.execute('DROP TABLE note_folders')
      await db.execute('DROP TABLE vault_notes')
      const { buildSnapshot } = await import('../services/backup')
      const snap = await buildSnapshot(db)
      expect(snap.missing_tables).toEqual(['note_folders', 'vault_notes'])
      expect(snap.data.users).toBeDefined()
      expect(snap.data.projects).toBeDefined()
      expect(snap.data.note_folders).toBeUndefined()
    } finally {
      close()
    }
  })

  it('no transient table leaked INTO the snapshot list (would bloat backups with throwaway rows)', () => {
    for (const t of SNAPSHOT_TABLES) {
      expect(TRANSIENT_STATE.has(t)).toBe(false)
      expect(isFtsShadow(t)).toBe(false)
      expect(FTS_AND_BOOKKEEPING.has(t)).toBe(false)
    }
  })
})

describe('personal export isolation (buildUserSnapshot)', () => {
  it('every row in every exported table belongs to the requesting user — no cross-user leak', async () => {
    const { db, close } = makeTestDb()
    try {
      const alice = await makeUser(db, { username: 'alice', email: 'alice@test.dev' })
      const bob = await makeUser(db, { username: 'bob', email: 'bob@test.dev' })
      const now = new Date().toISOString()
      // Both users own a full graph of data.
      for (const [label, uid] of [['a', alice], ['b', bob]] as const) {
        await db.execute('INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [`f-${label}`, uid, 'F', 0, now])
        await db.execute('INSERT INTO projects (id, user_id, folder_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`p-${label}`, uid, `f-${label}`, `P ${label}`, 'developing', now, now])
        await db.execute('INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [`h-${label}`, `p-${label}`, 'H', 'open', 0, now])
        await db.execute('INSERT INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)', [`t-${label}`, uid, 'T', '#123456', now])
        await db.execute('INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`qn-${label}`, uid, 'note', 'N', 'c', now, now])
        await db.execute('INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, z_index, deleted, board, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [`cv-${label}`, uid, 'note', 1, 2, 3, 4, '#fff', 'x', 0, 0, 'board', now, now])
        await db.execute('INSERT INTO sadhana_tasks (id, user_id, quadrant, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [`st-${label}`, uid, 1, 'S', now, now])
        await db.execute('INSERT INTO task_categories (id, project_id, name, created_at) VALUES (?, ?, ?, ?)', [`cat-${label}`, `p-${label}`, 'C', now])
        await db.execute('INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`dt-${label}`, `p-${label}`, 'D', 'done', 'low', `cat-${label}`, now])
        await db.execute('INSERT INTO backlog_docs (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [`bd-${label}`, `p-${label}`, 'B', now, now])
      }

      const export_ = await buildUserSnapshot(db, alice)
      expect(Object.keys(export_.data).length).toBeGreaterThan(10) // the export is substantive

      // Ownership verifier: every row must reference ONLY alice-owned parents.
      for (const [table, rows] of Object.entries(export_.data)) {
        for (const row of rows as Record<string, unknown>[]) {
          if (table === 'users') {
            expect(row.id).toBe(alice)
            expect('password_hash' in row).toBe(false) // rule 8 on the personal export too
            continue
          }
          if ('user_id' in row && row.user_id !== null) expect(row.user_id).toBe(alice)
          if ('project_id' in row && row.project_id !== null) expect(String(row.project_id)).toMatch(/^p-a$/)
          if ('task_id' in row && row.task_id !== null && table.startsWith('sadhana')) expect(String(row.task_id)).toBe('st-a')
          if ('task_id' in row && row.task_id !== null && table.startsWith('dev_')) expect(String(row.task_id)).toBe('dt-a')
          if ('doc_id' in row && row.doc_id !== null) expect(String(row.doc_id)).toBe('bd-a')
        }
      }

      // Spot-check the cross-user tables actually contain bob's rows in the DB (the
      // isolation above is meaningful only because the other user's data exists).
      const bobs = await db.query('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', [bob])
      expect(bobs[0].n).toBe(1)
    } finally {
      close()
    }
  })

  // S57: the personal JSON export (Settings → JSON export) must CARRY the Notes Vault —
  // folders before notes (FK-safe restore order) and soft-deleted notes too (a backup
  // carries the Trash; "trash is not content" is the Obsidian READ rule, not the backup rule).
  it('includes the Notes Vault (folders + notes, trash included) in the user scope', async () => {
    const { db, close } = makeTestDb()
    try {
      const alice = await makeUser(db, { username: 'al-va', email: 'al-va@test.dev' })
      const bob = await makeUser(db, { username: 'bo-va', email: 'bo-va@test.dev' })
      const now = new Date().toISOString()
      await db.execute("INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES ('nf-a', ?, NULL, 'Alice folder', 0, ?, ?)", [alice, now, now])
      await db.execute("INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES ('vn-a1', ?, 'nf-a', 'Live note', 'body', 't1', 1, ?, ?)", [alice, now, now])
      await db.execute("INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, deleted_at, created_at, updated_at) VALUES ('vn-a2', ?, NULL, 'Trashed note', 'gone', '', 0, ?, ?, ?)", [alice, now, now, now])
      await db.execute("INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES ('vn-b1', ?, NULL, 'Bob note', 'b', '', 0, ?, ?)", [bob, now, now])

      const export_ = await buildUserSnapshot(db, alice)
      expect(export_.missing_tables).toEqual([])
      expect((export_.data.note_folders as { id: string }[]).map((r) => r.id)).toEqual(['nf-a'])
      const notes = export_.data.vault_notes as { id: string }[]
      expect(notes.map((r) => r.id).sort()).toEqual(['vn-a1', 'vn-a2']) // trash rides along
      expect(notes.some((r) => r.id === 'vn-b1')).toBe(false) // bob's never leaks

      // FK-safe restore order: folders serialize BEFORE notes in the JSON key order
      const keys = Object.keys(export_.data)
      expect(keys.indexOf('note_folders')).toBeLessThan(keys.indexOf('vault_notes'))
    } finally {
      close()
    }
  })

  // S57: same deploy-ahead-of-D1 window as the obsidian export — a lagging D1 must yield
  // a PARTIAL personal export with missing_tables, not a 500 on "download my data".
  it('S57 race guard: a not-yet-migrated DB yields a PARTIAL personal export, not a crash', async () => {
    const { db, close } = makeTestDbUpto(56)
    try {
      const alice = await makeUser(db, { username: 'al-race', email: 'al-race@test.dev' })
      const now = new Date().toISOString()
      await db.execute("INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES ('p-race', ?, 'P', 'doing', ?, ?)", [alice, now, now])

      const export_ = await buildUserSnapshot(db, alice)
      // S152 re-pin: the categories slice (guardedQuery on 'categories') + the
      // project_categories join join the missing list in the pre-0062 window.
      expect(export_.missing_tables).toEqual(['note_folders', 'vault_notes', 'project_categories', 'categories'])
      expect(export_.data.projects).toHaveLength(1) // everything else still exports
      expect(export_.data.note_folders).toBeUndefined()
      expect(export_.data.vault_notes).toBeUndefined()
      expect(export_.data.categories).toBeUndefined()
    } finally {
      close()
    }
  })
})

describe('retention exactness (enforceRetention)', () => {
  it('keeps EXACTLY keepN snapshots: N+K present → K oldest deleted, N remain', async () => {
    const client = githubClient({ owner: 'o', repo: 'r', token: 't' })
    const K = 3
    const N = 5
    const entries = Array.from({ length: N + K }, (_, i) => ({
      name: `snapshot-2026-09-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.json`,
      path: `backups/snapshot-2026-09-${String(i + 1).padStart(2, '0')}T00-00-00-000Z.json`,
      sha: `s${i}`,
      type: 'file',
    }))
    const remaining = new Set(entries.map((e) => e.path))
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'DELETE') {
        remaining.delete(url.split('/contents/')[1])
        return new Response('{}', { status: 200 })
      }
      return new Response(JSON.stringify(entries.filter((e) => remaining.has(e.path))), { status: 200 })
    }) as typeof fetch
    try {
      const deleted = await enforceRetention(client, N)
      expect(deleted).toHaveLength(K)
      expect(deleted[0]).toContain('snapshot-2026-09-01') // oldest-first
      expect(deleted[K - 1]).toContain('snapshot-2026-09-03')
      expect(remaining.size).toBe(N) // exactly N survive
      expect([...remaining].some((p) => p.includes('snapshot-2026-09-01'))).toBe(false)
      expect([...remaining].some((p) => p.includes(`snapshot-2026-09-${String(N + K).padStart(2, '0')}`))).toBe(true) // newest kept
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('Plan B receive-side round-trip (the Telegram document disaster path)', () => {
  it('document (base64 HIBENC1) → sha256 verify → decrypt → REAL restore.mjs → row parity', async () => {
    // The send side (sendPlanBBackupToChat) is covered in planb.test.ts; this covers the
    // RECOVERY half an owner performs manually: download the document from the chat,
    // verify it, and restore from it. sha256 is what the planb_backups row + caption carry.
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const now = new Date().toISOString()
      await db.execute('INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ['p-planb', userId, 'PlanB project', 'developing', now, now])
      await db.execute('INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['qn-planb', userId, 'note', 'N', 'planb note — تست', now, now])

      const snapshot = await buildSnapshot(db)
      const KEY = Buffer.from(new Uint8Array(32).fill(3)).toString('base64')
      const key = await importAesKey(KEY)
      // Exactly what sendPlanBBackupToChat ships: AES-GCM blob, base64 text document.
      const docBytes = await encryptBackup(key, new TextEncoder().encode(JSON.stringify(snapshot, null, 2)))
      const docText = bytesToBase64(docBytes)
      const loggedSha = createHash('sha256').update(docText, 'utf8').digest('hex')

      // Step 1: the owner verifies integrity against the logged hash (captured at send
      // time into planb_backups + the caption).
      expect(createHash('sha256').update(docText, 'utf8').digest('hex')).toBe(loggedSha)

      // Step 2: write the document to disk (what "download from Telegram" gives you) and
      // run the REAL restore script with the key.
      const dir = mkdtempSync(join(tmpdir(), 'hibana-planb-rcv-'))
      const docPath = join(dir, 'hibana-backup.planb.txt')
      writeFileSync(docPath, docText, 'utf8')
      const target = join(dir, 'restored.db')
      // Migrations on a raw connection (the same pattern as the drill).
      const { applyMigrations } = await import('../db/migrate-node')
      applyMigrations(target, join(ROOT, 'migrations'))
      // Original-DB scenario: the user pre-exists (rule 8 — auth never restored).
      const tdb = new DatabaseSync(target)
      tdb.prepare('INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(userId, 'owner', 'owner@test.dev', 'x', 'owner', 'en', 'gregorian', 'UTC', now, now)
      tdb.close()
      try {
        const { stdout } = await execFileAsync(process.execPath, [join(ROOT, 'scripts', 'restore.mjs'), '--file', docPath], {
          cwd: ROOT,
          env: { ...process.env, DB_PATH: target, BACKUP_ENCRYPTION_KEY: KEY },
          timeout: 60_000,
        })
        expect(stdout).toContain('Decrypting')

        // Step 3: row parity + FK-complete (the user row pre-exists).
        const rdb = new DatabaseSync(target)
        expect((rdb.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n).toBe(1)
        expect((rdb.prepare('SELECT COUNT(*) AS n FROM quick_notes').get() as { n: number }).n).toBe(1)
        const content = rdb.prepare("SELECT content FROM quick_notes WHERE id = 'qn-planb'").get() as { content: string }
        expect(content.content).toBe('planb note — تست') // Persian survives the whole channel
        expect(rdb.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        rdb.close()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    } finally {
      close()
    }
  })
})
