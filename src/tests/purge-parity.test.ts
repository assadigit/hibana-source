import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// AP-57 (Phase 3): the manual POST /api/admin/purge and the cron sweep ran the same
// 7-day retention — except the cron ALSO swept error_log (0045) and the manual route
// did not. One purge implementation now serves both (CQ-6), so this pins the manual
// route's error_log sweep — the same silent-divergence class as the 0058 email_log
// incident documented in the migrations.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

describe('AP-57: manual purge sweeps error_log like the cron does', () => {
  it('POST /api/admin/purge removes 7-day-old error_log rows', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const app = createApp(makeConfig(db))
      const token = await createSession(db, owner)
      const auth = { Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }

      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
      const fresh = new Date().toISOString()
      await db.execute(
        'INSERT INTO error_log (id, created_at, req_id, user_id, path, status, code, message, stack) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['err-old', old, null, owner, '/api/x', 500, 'internal_error', 'ancient failure', null],
      )
      await db.execute(
        'INSERT INTO error_log (id, created_at, req_id, user_id, path, status, code, message, stack) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['err-new', fresh, null, owner, '/api/x', 500, 'internal_error', 'recent failure', null],
      )

      const res = await app.fetch(new Request('http://local/api/admin/purge', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)

      const rows = await db.query<{ id: string }>('SELECT id FROM error_log')
      const ids = rows.map((r) => r.id)
      expect(ids).toContain('err-new') // inside the window — stays
      expect(ids).not.toContain('err-old') // past the window — swept
    } finally {
      close()
    }
  })
})

// S253 (audit DB-3): project_archives is the ONE child table with NO FK (0046 predates
// the FK discipline) — before the fix, a purged project's archive rows survived every
// purge path as orphans (1 such row already existed in prod). All THREE purge sites now
// sweep archives explicitly; these pins hold each site to it, row-count-asserted.
describe('S253 (DB-3): every purge site sweeps project_archives with its project', () => {
  const NOW = new Date().toISOString()

  async function seedProjectWithArchive(db: Db, userId: string, id: string, status: string, deletedAt: string | null) {
    await db.execute(
      'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at, deleted_at) VALUES (?, ?, ?, \'\', \'personal\', ?, 0, \'\', 0, ?, ?, ?)',
      [id, userId, `P ${id}`, status, NOW, NOW, deletedAt],
    )
    await db.execute(
      "INSERT INTO project_archives (id, project_id, title, status, priority, original_created_at, archived_at) VALUES (?, ?, ?, 'done', 'low', ?, ?)",
      [`ar-${id}`, id, `T ${id}`, NOW, NOW],
    )
  }

  function makeConfig(db: Db): Config {
    return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
  }

  it('the 7-day admin/cron purge sweeps a purged project\'s archive rows', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const app = createApp(makeConfig(db))
      const token = await createSession(db, owner)
      const auth = { Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }

      const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
      await seedProjectWithArchive(db, owner, 'purged-p', 'developing', old) // past the window
      await seedProjectWithArchive(db, owner, 'alive-p', 'developing', null) // live project

      const res = await app.fetch(new Request('http://local/api/admin/purge', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)

      const archives = await db.query<{ id: string }>('SELECT id FROM project_archives')
      expect(archives.map((r) => r.id)).toEqual(['ar-alive-p']) // the purged project's row went WITH it
      const projects = await db.query<{ id: string }>('SELECT id FROM projects')
      expect(projects.map((r) => r.id)).toEqual(['alive-p'])
    } finally {
      close()
    }
  })

  it('settings "Empty trash" sweeps the user\'s purged projects\' archive rows', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const app = createApp(makeConfig(db))
      const token = await createSession(db, owner)
      const auth = { Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }

      await seedProjectWithArchive(db, owner, 'trashed-p', 'developing', NOW) // in trash → purged
      await seedProjectWithArchive(db, owner, 'live-p', 'developing', null) // live → untouched

      const res = await app.fetch(new Request('http://local/api/settings/trash/empty', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)

      const archives = await db.query<{ id: string }>('SELECT id FROM project_archives')
      expect(archives.map((r) => r.id)).toEqual(['ar-live-p'])
      const projects = await db.query<{ id: string }>('SELECT id FROM projects')
      expect(projects.map((r) => r.id)).toEqual(['live-p'])
    } finally {
      close()
    }
  })

  it('a force-hard-deleted Spark takes its archive rows too (no new orphans)', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const app = createApp(makeConfig(db))
      const token = await createSession(db, owner)
      const auth = { Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }

      // A spark is the only hard-deletable status (0060). The archive row is the
      // belt-first residue class DB-3 exists for: 0046's missing FK would have left it.
      await seedProjectWithArchive(db, owner, 'spark-p', 'spark', null)

      const res = await app.fetch(new Request('http://local/api/projects/spark-p?force=1', { method: 'DELETE', headers: auth }))
      expect(res.status).toBe(200)

      const archives = await db.query<{ id: string }>('SELECT id FROM project_archives')
      expect(archives).toEqual([]) // swept with the project — no orphan left behind
      const projects = await db.query<{ id: string }>('SELECT id FROM projects')
      expect(projects).toEqual([])
    } finally {
      close()
    }
  })
})
