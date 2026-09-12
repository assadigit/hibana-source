import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S29 (agenda 5 — richer progress box): the manual override (projects.progress_percent,
// 0002) finally has UI + HISTORY. These pin the server contract:
//   1. PATCH with a CHANGED progress_percent lands a project_progress_log row (0050),
//      carrying the optional progress_note; a re-send of the SAME value logs nothing.
//   2. progress_note NEVER reaches the generic SET builder (no projects column — a
//      rider for the timeline only).
//   3. GET /:id/progress answers entries (newest-first) + current { pct, auto, autoPct }
//      with the manual-override-wins formula (dev tasks → hurdles → 0).
//   4. null = back to Auto: logged with a null pct, current.auto flips true.
//   5. ?format=html renders the htmx-swappable timeline fragment.
//   6. user isolation (rule 1): another user's project → 404, no log writes.

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

const progress = (app: App, headers: Record<string, string>, id: string, format?: string) =>
  app.fetch(new Request(`http://local/api/projects/${id}/progress${format ? `?format=${format}` : ''}`, { headers }))

type Entry = { pct: number | null; note: string; created_at: string }
type Current = { pct: number; auto: boolean; autoPct: number }

describe('project progress box — override + timeline (S29 agenda 5, 0050)', () => {
  it('a changed override logs (with the note); a same-value re-send logs nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const id = await createProject(app, headers, 'probe one')

      const first = await patch(app, headers, id, { progress_percent: 40, progress_note: 'Design review passed' })
      expect(first.status).toBe(200)
      const again = await patch(app, headers, id, { progress_percent: 40 }) // no-op — same value
      expect(again.status).toBe(200)

      const body = (await (await progress(app, headers, id)).json()) as { entries: Entry[]; current: Current }
      expect(body.entries).toHaveLength(1) // the re-send logged nothing
      expect(body.entries[0]).toMatchObject({ pct: 40, note: 'Design review passed' })
      expect(body.current).toEqual({ pct: 40, auto: false, autoPct: 0 })

      // the note never became a column (the generic SET builder would 500 on it)
      const rows = await db.query<{ progress_note: unknown }>('SELECT * FROM projects WHERE id = ?', [id])
      expect(rows[0]).toBeTruthy()
    } finally {
      close()
    }
  })

  it('null = back to Auto: logged with a null pct, current flips to the computed number', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const id = await createProject(app, headers, 'probe two')
      await patch(app, headers, id, { progress_percent: 75 })
      await patch(app, headers, id, { progress_percent: null })

      // seed the AUTO formula: two hurdles, one solved → 50
      for (const [text, status] of [['a', 'open'], ['b', 'solved']] as const) {
        await db.execute('INSERT INTO hurdles (id, project_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), id, text, status, new Date().toISOString()])
      }
      const body = (await (await progress(app, headers, id)).json()) as { entries: Entry[]; current: Current }
      expect(body.entries.map((e) => e.pct)).toEqual([null, 75]) // newest first
      expect(body.current.auto).toBe(true)
      expect(body.current.autoPct).toBe(50)
      expect(body.current.pct).toBe(50)
    } finally {
      close()
    }
  })

  it('dev tasks drive the auto formula once they exist (user model 2026-08-29)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const id = await createProject(app, headers, 'probe three')
      for (const status of ['idea', 'done', 'done', 'in_progress']) {
        await db.execute(
          "INSERT INTO dev_tasks (id, project_id, title, status, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)",
          [crypto.randomUUID(), id, 't', status, new Date().toISOString()],
        )
      }
      const body = (await (await progress(app, headers, id)).json()) as { current: Current }
      expect(body.current.autoPct).toBe(50) // 2 of 4 done
    } finally {
      close()
    }
  })

  it('?format=html renders the swappable timeline fragment (bucket classes + escaping)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const id = await createProject(app, headers, 'probe four')
      await patch(app, headers, id, { progress_percent: 100, progress_note: '<script>x</script> shipped' })
      const html = await (await progress(app, headers, id, 'html')).text()
      expect(html).toContain('pd-pl-entry')
      expect(html).toContain('is-done') // the 100% bucket
      expect(html).toContain('&lt;script&gt;') // the note is escaped
      expect(html).not.toContain('<script>')
    } finally {
      close()
    }
  })

  it('another user gets 404 — no entries, no writes (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const otherId = await makeUser(db, { role: 'member' })
      const { app, headers } = await makeApp(db, ownerId)
      const { app: otherApp, headers: otherHeaders } = await makeApp(db, otherId)
      const id = await createProject(app, headers, 'isolated')

      const denied = await otherApp.fetch(new Request(`http://local/api/projects/${id}/progress`, { headers: otherHeaders }))
      expect(denied.status).toBe(404)
      const deniedPatch = await otherApp.fetch(new Request(`http://local/api/projects/${id}`, { method: 'PATCH', headers: otherHeaders, body: JSON.stringify({ progress_percent: 99 }) }))
      expect(deniedPatch.status).toBe(404)

      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM project_progress_log WHERE project_id = ?', [id])
      expect(rows[0].n).toBe(0) // nothing leaked through
    } finally {
      close()
    }
  })
})
