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
