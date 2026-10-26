import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Autopilot Phase 0 characterization (gap: the hard-delete status matrix).
//
// The spark-only hard-delete rule (0060: "hard delete stays spark-ONLY",
// routes/projects/index.ts:722-733) was pinned only by scripts/smoke.mjs — coarse,
// CI-level — and the NON-spark force=1 path (must stay SOFT) was unpinned anywhere.
// This matrix attacks DELETE ?force=1 for every status in the 0060 vocabulary.
//
// Product rule being characterized: "a safe for my ideas" — once a project has real
// work in it (anything past the spark shelf), delete is archive-only; the row must
// survive with deleted_at set so the 7-day undo toast stays honest.

const STATUSES = ['spark', 'planning', 'queued', 'developing', 'awaiting_dev', 'operational'] as const

const headers = (cookie: string) => ({
  'Content-Type': 'application/json',
  Cookie: cookie,
  Origin: 'http://local',
})

async function setup(db: Db) {
  const uid = await makeUser(db)
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
  const token = await createSession(db, uid)
  return { app, cookie: `__Host-hibana_session=${token}` }
}

async function createProject(app: ReturnType<typeof createApp>, cookie: string, title: string, status: string) {
  const res = await app.fetch(
    new Request('http://local/api/projects', {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify({ title, status }),
    }),
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

describe('hard-delete status matrix (0060 rule characterization)', () => {
  for (const status of STATUSES) {
    it(`DELETE ?force=1 on '${status}' → ${status === 'spark' ? 'HARD delete (row gone)' : 'SOFT delete (row survives, deleted_at set)'}`, async () => {
      const { db, close } = makeTestDb()
      try {
        const { app, cookie } = await setup(db)
        const id = await createProject(app, cookie, `Matrix ${status}`, status)

        const res = await app.fetch(
          new Request(`http://local/api/projects/${id}?force=1`, { method: 'DELETE', headers: headers(cookie) }),
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { ok: boolean; soft: boolean }
        expect(body.ok).toBe(true)
        expect(body.soft).toBe(status !== 'spark')

        const rows = await db.query<{ id: string; deleted_at: string | null }>(
          'SELECT id, deleted_at FROM projects WHERE id = ?',
          [id],
        )
        if (status === 'spark') {
          // hard delete: the row is GONE (and purgeShotBytes ran best-effort first)
          expect(rows).toHaveLength(0)
        } else {
          // soft delete: the row survives with deleted_at stamped — the undo window
          expect(rows).toHaveLength(1)
          expect(rows[0].deleted_at).not.toBeNull()
        }
      } finally {
        close()
      }
    })
  }

  it('a spark WITHOUT ?force=1 is soft-deleted too (force is the explicit confirmation)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, cookie } = await setup(db)
      const id = await createProject(app, cookie, 'Unforced spark', 'spark')

      const res = await app.fetch(
        new Request(`http://local/api/projects/${id}`, { method: 'DELETE', headers: headers(cookie) }),
      )
      expect(res.status).toBe(200)
      expect(((await res.json()) as { soft: boolean }).soft).toBe(true)
      const rows = await db.query<{ deleted_at: string | null }>('SELECT deleted_at FROM projects WHERE id = ?', [id])
      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).not.toBeNull()
    } finally {
      close()
    }
  })

  it('soft-deleted non-spark projects restore cleanly (the undo path)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { app, cookie } = await setup(db)
      const id = await createProject(app, cookie, 'Restorable operational', 'operational')

      await app.fetch(new Request(`http://local/api/projects/${id}?force=1`, { method: 'DELETE', headers: headers(cookie) }))
      const res = await app.fetch(
        new Request(`http://local/api/projects/${id}/restore`, { method: 'POST', headers: headers(cookie) }),
      )
      expect(res.status).toBe(200)
      const rows = await db.query<{ deleted_at: string | null }>('SELECT deleted_at FROM projects WHERE id = ?', [id])
      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).toBeNull()
    } finally {
      close()
    }
  })
})
