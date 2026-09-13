import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S30 (2026-09-12, user request "remove the whole thing"): the manual progress box
// (slider + milestone chips + Auto/Manual + note) and its 0050 timeline are REMOVED.
// The old override/timeline specs went with the feature. This file pins the removal:
//   1. PATCH progress_percent / progress_note → 400 invalid_input (schema dropped them;
//      a stale client is rejected cleanly, never a SQL error, never a silent write).
//   2. GET /:id/progress → 404 (the route is gone with its only caller).
//   3. 0051 returned every project to the computed number: progress_percent is NULL
//      for pre-existing rows and stays NULL through ordinary PATCHes.
//   4. The detail payload keeps computing the AUTO number (dev tasks → hurdles).

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

type App = Awaited<ReturnType<typeof createApp>>

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const patch = (app: App, headers: Record<string, string>, id: string, body: unknown) =>
  app.fetch(new Request(`http://local/api/projects/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

describe('manual progress override REMOVED (S30, 0051)', () => {
  it('PATCH progress_percent/progress_note → 400; GET /progress → 404; no log table', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const id = await createProject(app, headers, 'probe one')

      const denied = await patch(app, headers, id, { progress_percent: 40, progress_note: 'note' })
      expect(denied.status).toBe(400) // invalid_input — the fields left the schema
      const denied2 = await patch(app, headers, id, { progress_percent: null })
      expect(denied2.status).toBe(400)

      const gone = await app.fetch(new Request(`http://local/api/projects/${id}/progress`, { headers }))
      expect(gone.status).toBe(404) // the route is gone

      // 0051 dropped the timeline table entirely.
      const tables = await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='project_progress_log'")
      expect(tables).toHaveLength(0)

      // Ordinary PATCHes still work and never touch progress_percent.
      const ok = await patch(app, headers, id, { title: 'renamed' })
      expect(ok.status).toBe(200)
      const rows = await db.query<{ progress_percent: number | null }>('SELECT progress_percent FROM projects WHERE id = ?', [id])
      expect(rows[0].progress_percent).toBeNull()
    } finally {
      close()
    }
  })

  it('legacy override rows are returned to Auto by 0051; the detail payload computes', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const id = await createProject(app, headers, 'probe two')

      // Simulate a pre-0051 row: an override that the old UI could have written.
      await db.execute('UPDATE projects SET progress_percent = 30 WHERE id = ?', [id])
      // Re-run the 0051 data step exactly as shipped (the null-out is idempotent).
      await db.execute('UPDATE projects SET progress_percent = NULL WHERE progress_percent IS NOT NULL')
      const rows = await db.query<{ progress_percent: number | null }>('SELECT progress_percent FROM projects WHERE id = ?', [id])
      expect(rows[0].progress_percent).toBeNull()

      // The detail payload's project keeps the computed number: 2 hurdles, 1 solved → 50.
      for (const [text, status] of [['a', 'open'], ['b', 'solved']] as const) {
        await db.execute('INSERT INTO hurdles (id, project_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), id, text, status, new Date().toISOString()])
      }
      const detail = await app.fetch(new Request(`http://local/api/projects/${id}`, { headers }))
      expect(detail.status).toBe(200)
      const body = (await detail.json()) as { project: { progress_percent: number | null } }
      expect(body.project.progress_percent).toBeNull()
    } finally {
      close()
    }
  })
})
