import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createApp } from '../app'
import { createSession } from '../auth/sessions'
import { recordError } from '../services/errorlog'
import { scheduledPurge } from '../routes/admin'
import { apiError, ErrorCode } from '../lib/errors'
import type { Db } from '../db/types'
import type { Config } from '../types'

// Error observability (0045, docs/dr-integrity-closeout.md §4): app.onError persists
// unhandled throws + ApiErrors to error_log; the admin viewer is owner-only; the daily
// purge enforces 7-day retention; the recorder itself can never break a response.

function makeCfg(db: Db): Config {
  return {
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
  }
}

describe('error_log (0045)', () => {
  it('unhandled throw → 500 response AND a persisted row with stack + reqId', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      const app = createApp(makeCfg(db))
      // A test-only authed route that throws — exercises the real onError path. (Test
      // routes added after createApp land behind coreRoutes' requireAuth wildcard, so
      // the request carries a session — exactly how a real user would hit a throw.)
      app.get('/boom', () => {
        throw new Error('kaboom')
      })
      const res = await app.fetch(new Request('http://local/boom', {
        headers: { Cookie: `hibana_session=${token}` },
      }))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal_error' })
      const rows = await db.query<{ status: number; code: string; message: string; stack: string | null; req_id: string | null }>(
        'SELECT status, code, message, stack, req_id FROM error_log ORDER BY created_at DESC LIMIT 1',
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe(500)
      expect(rows[0].code).toBe('internal_error')
      expect(rows[0].message).toBe('kaboom')
      expect(rows[0].stack).toContain('kaboom')
      expect(rows[0].req_id).toBeTruthy()
    } finally {
      close()
    }
  })

  it('ApiError → row carries its status + code, no stack; body shape unchanged', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      const app = createApp(makeCfg(db))
      app.get('/api-test/oops', () => {
        throw apiError(ErrorCode.not_found, 'no such thing')
      })
      const res = await app.fetch(new Request('http://local/api-test/oops', {
        headers: { Cookie: `hibana_session=${token}` },
      }))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found', message: 'no such thing' })
      const rows = await db.query<{ status: number; code: string; stack: string | null }>(
        'SELECT status, code, stack FROM error_log',
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe(404)
      expect(rows[0].code).toBe('not_found')
      expect(rows[0].stack).toBeNull()
    } finally {
      close()
    }
  })

  it('viewer GET /api/admin/errors: owner sees rows, member gets 403 (rule 1 spirit: operational data is owner-only)', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner' })
      const memberId = await makeUser(db, { role: 'member' })
      await recordError(db, { path: '/x', status: 500, code: 'internal_error', message: 'm' })
      const app = createApp(makeCfg(db))

      const ownerToken = await createSession(db, ownerId)
      const memberToken = await createSession(db, memberId)

      const asOwner = await app.fetch(new Request('http://local/api/admin/errors?limit=10', {
        headers: { Cookie: `hibana_session=${ownerToken}` },
      }))
      expect(asOwner.status).toBe(200)
      const body = (await asOwner.json()) as { rows: unknown[]; counts_7d: { status: number; n: number }[] }
      expect(body.rows).toHaveLength(1)
      expect(body.counts_7d[0]).toMatchObject({ status: 500, n: 1 })

      const asMember = await app.fetch(new Request('http://local/api/admin/errors', {
        headers: { Cookie: `hibana_session=${memberToken}` },
      }))
      expect(asMember.status).toBe(403)

      // rule 10: query params are input — garbage limit is rejected, not 500'd.
      const bad = await app.fetch(new Request('http://local/api/admin/errors?limit=99999', {
        headers: { Cookie: `hibana_session=${ownerToken}` },
      }))
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })

  it('recorder failure never breaks the error response (self-guarded)', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('DROP TABLE error_log')
      await expect(recordError(db, { path: '/x', status: 500 })).resolves.toBeUndefined()

      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      const app = createApp(makeCfg(db))
      app.get('/boom', () => {
        throw new Error('still answers')
      })
      const res = await app.fetch(new Request('http://local/boom', {
        headers: { Cookie: `hibana_session=${token}` },
      }))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal_error' })
    } finally {
      close()
    }
  })

  it('scheduledPurge removes error_log rows older than 7 days, keeps fresh ones', async () => {
    const { db, close } = makeTestDb()
    try {
      await recordError(db, { path: '/old', status: 500, message: 'old' })
      await db.execute("UPDATE error_log SET created_at = ? WHERE path = '/old'", [
        new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
      ])
      await recordError(db, { path: '/fresh', status: 500, message: 'fresh' })
      await scheduledPurge(makeCfg(db))
      const rows = await db.query<{ path: string }>('SELECT path FROM error_log')
      expect(rows.map((r) => r.path)).toEqual(['/fresh'])
    } finally {
      close()
    }
  })
})
