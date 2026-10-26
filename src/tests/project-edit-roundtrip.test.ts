import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'

// Autopilot Phase 0 characterization (gap: project edit round-trip at API level).
//
// PATCH title/description → GET read-back was previously exercised only by one e2e
// spec (s161-ideas-redesign.spec.ts, browser-level). These tests pin the API
// contract directly: edits persist, updated_at moves, and a status change writes
// the human-readable history-log entry (routes/projects/index.ts:700-705).

const headers = (cookie: string) => ({
  'Content-Type': 'application/json',
  Cookie: cookie,
  Origin: 'http://local',
})

describe('project edit round-trip (characterization)', () => {
  it('PATCH title + description persists and reads back', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const cookie = `__Host-hibana_session=${await createSession(db, uid)}`

      const create = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: headers(cookie),
          body: JSON.stringify({ title: 'Original Title', description: 'First description' }),
        }),
      )
      expect(create.status).toBe(201)
      const { id } = (await create.json()) as { id: string }

      const before = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: headers(cookie) }))).json()) as {
        project: { title: string; description: string; updated_at: string }
      }

      // let updated_at move (the column is timestamp-based; guarantee a tick)
      await new Promise((r) => setTimeout(r, 1100))

      const patch = await app.fetch(
        new Request(`http://local/api/projects/${id}`, {
          method: 'PATCH',
          headers: headers(cookie),
          body: JSON.stringify({ title: 'Edited Title', description: 'Second description' }),
        }),
      )
      expect(patch.status).toBe(200)
      expect(((await patch.json()) as { ok: boolean }).ok).toBe(true)

      const after = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: headers(cookie) }))).json()) as {
        project: { title: string; description: string; updated_at: string; status: string }
      }
      expect(after.project.title).toBe('Edited Title')
      expect(after.project.description).toBe('Second description')
      expect(new Date(after.project.updated_at).getTime()).toBeGreaterThan(new Date(before.project.updated_at).getTime())
    } finally {
      close()
    }
  })

  it('a status change writes the Status → history-log entry', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const cookie = `__Host-hibana_session=${await createSession(db, uid)}`

      const create = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: headers(cookie),
          body: JSON.stringify({ title: 'History project', status: 'spark' }),
        }),
      )
      const { id } = (await create.json()) as { id: string }

      const patch = await app.fetch(
        new Request(`http://local/api/projects/${id}`, {
          method: 'PATCH',
          headers: headers(cookie),
          body: JSON.stringify({ status: 'planning' }),
        }),
      )
      expect(patch.status).toBe(200)

      const detail = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: headers(cookie) }))).json()) as {
        project: { status: string }
      }
      expect(detail.project.status).toBe('planning')

      const history = await db.query<{ note: string }>(
        'SELECT note FROM project_history_log WHERE project_id = ? ORDER BY created_at',
        [id],
      )
      expect(history.length).toBeGreaterThan(0)
      expect(history.some((h) => /Status →/.test(h.note))).toBe(true)
    } finally {
      close()
    }
  })
})
