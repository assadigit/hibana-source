import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Spec §11 + Phase 2 gate: "a queued offline change lands correctly once reconnected,
// without duplication or loss." The sync endpoint must be idempotent, last-write-wins,
// tombstone-respecting, and user-isolated.

async function makeCanvasClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json' } }
}

const ago = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

const el = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  type: 'note' as const,
  x: 10,
  y: 20,
  width: 160,
  height: 120,
  color: '#fef08a',
  content: 'offline thought',
  z_index: 0,
  deleted: 0,
  created_at: ago(30),
  updated_at: ago(2),
  ...over,
})

describe('canvas sync (rule 2 + Q4-A + Phase 2 gate)', () => {
  it('quick-add replay is idempotent: repeating the same client id never 500s (unsynced-badge healing)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u1 = await makeUser(db)
      const u2 = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, u1)
      const { app: app2, auth: auth2 } = await makeCanvasClient(db, u2)
      const id = crypto.randomUUID()
      const body = { id, title: 'Offline idea', description: 'queued once' }

      const first = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify(body) }))
      expect(first.status).toBe(201)

      // The queue lost the response and replays the same quick-add: it must be treated as
      // already-synced, not crash on the primary key (which would strand the badge forever).
      const replay = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify(body) }))
      expect(replay.status).toBe(200)
      const replayBody = (await replay.json()) as { duplicate: boolean }
      expect(replayBody.duplicate).toBe(true)
      const rows = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE id = ? AND user_id = ?", [id, u1])
      expect(rows[0].n).toBe(1) // no duplication

      // The same id under ANOTHER user is a UUID collision, not a replay — a clean 409
      // (the queue drops 4xx permanently; it never strands the badge).
      const other = await app2.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth2, body: JSON.stringify(body) }))
      expect(other.status).toBe(409)
    } finally {
      close()
    }
  })

  it('flush → replay: applied exactly once, no duplication', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)
      const a = el({ id: crypto.randomUUID(), updated_at: ago(2) })
      const b = el({ id: crypto.randomUUID(), updated_at: ago(1) })

      let res = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [a, b] }) }))
      expect(res.status).toBe(200)
      let body = (await res.json()) as { applied: string[] }
      expect(body.applied).toHaveLength(2)

      // Replay the same batch (retry after a dropped response) — must not duplicate.
      res = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [a, b] }) }))
      body = (await res.json()) as { applied: string[] }
      expect(body.applied).toHaveLength(0) // equal timestamps are not re-applied

      res = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full = (await res.json()) as { elements: { id: string }[] }
      expect(full.elements.map((e) => e.id).sort()).toEqual([a.id, b.id].sort())
    } finally {
      close()
    }
  })

  it('last-write-wins: newer write beats older replay; older write cannot clobber newer', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)

      // newer first, then a delayed old replay must lose
      const id = crypto.randomUUID()
      const old = el({ id, content: 'old version', updated_at: ago(5) })
      const newer = el({ id, content: 'newer version', updated_at: ago(1) })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [newer] }) }))
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [old] }) }))

      const fullRes1 = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full = (await fullRes1.json()) as { elements: { id: string; content: string }[] }
      expect(full.elements.find((e) => e.id === id)!.content).toBe('newer version')

      // old first, then newer via the queue — newer wins
      const id2 = crypto.randomUUID()
      const old2 = el({ id: id2, content: 'a', updated_at: ago(5) })
      const newer2 = el({ id: id2, content: 'b', updated_at: ago(1) })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [old2] }) }))
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [newer2] }) }))
      const fullRes2 = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full2 = (await fullRes2.json()) as { elements: { id: string; content: string }[] }
      expect(full2.elements.find((e) => e.id === id2)!.content).toBe('b')
    } finally {
      close()
    }
  })

  it('one batch with two edits of the same element: the newer one wins regardless of order (queue keys are uuid, not time)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)
      const id = crypto.randomUUID()
      const older = el({ id, content: 'older edit', height: 120, updated_at: ago(5) })
      const newer = el({ id, content: 'newer edit', height: 1194, updated_at: ago(1) })

      // older first, newer second — the newer must survive
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [older, newer] }) }))
      // and in the reverse order too (IndexedDB returns by uuid key, not insertion time)
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [newer, older] }) }))

      const fullRes = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full = (await fullRes.json()) as { elements: { id: string; content: string; height: number }[] }
      const row = full.elements.find((e) => e.id === id)!
      expect(row.content).toBe('newer edit')
      expect(row.height).toBe(1194)
    } finally {
      close()
    }
  })

  it('delete tombstone beats an older upsert replay (no resurrection)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)
      const id = crypto.randomUUID()

      const live = el({ id, content: 'delete me', updated_at: ago(20) })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [live] }) }))

      // tombstone created 1 day ago (younger than the 7-day purge window)
      const tombstone = el({ id, deleted: 1, updated_at: ago(1) })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [tombstone] }) }))

      // a straggling replay of the pre-delete version (from a device that went offline earlier)
      // must NOT resurrect it
      const straggler = el({ id, content: 'delete me', updated_at: ago(19) })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [straggler] }) }))

      const fullRes3 = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full = (await fullRes3.json()) as { elements: { id: string; deleted: number }[] }
      expect(full.elements).toHaveLength(0) // tombstone wins; nothing resurrected
    } finally {
      close()
    }
  })

  it('canvas is user-isolated (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, auth: authA } = await makeCanvasClient(db, a)
      const { app: appB, auth: authB } = await makeCanvasClient(db, b)

      const note = el({ content: "A's secret sketch" })
      await appA.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: authA, body: JSON.stringify({ elements: [note] }) }))

      const res = await appB.fetch(new Request('http://local/api/canvas/full', { headers: authB }))
      const body = (await res.json()) as { elements: unknown[] }
      expect(body.elements).toHaveLength(0)

      const read = await appB.fetch(new Request('http://local/api/canvas?minX=-100&maxX=100&minY=-100&maxY=100', { headers: authB }))
      const readBody = (await read.json()) as { elements: unknown[] }
      expect(readBody.elements).toHaveLength(0)
      const promote = await appB.fetch(
        new Request(`http://local/api/canvas/elements/${note.id}/promote`, { method: 'POST', headers: authB, body: JSON.stringify({ title: 'steal' }) }),
      )
      expect(promote.status).toBe(404)
    } finally {
      close()
    }
  })

  it('promote creates a Spark, keeps the note on the canvas, marked promoted', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)
      const note = el({ content: 'A product idea worth keeping' })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [note] }) }))

      const res = await app.fetch(
        new Request(`http://local/api/canvas/elements/${note.id}/promote`, { method: 'POST', headers: auth, body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(201)
      const { projectId } = (await res.json()) as { projectId: string }

      // the note is still on the canvas and now points at the new project
      const fullRes4 = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full2 = (await fullRes4.json()) as { elements: { id: string; promoted_project_id: string | null }[] }
      expect(full2.elements).toHaveLength(1)
      expect(full2.elements[0].promoted_project_id).toBe(projectId)

      // and the spark exists
      const projRes = await app.fetch(new Request(`http://local/api/projects/${projectId}`, { headers: auth }))
      const proj = (await projRes.json()) as { project: { title: string; status: string } }
      expect(proj.project.status).toBe('spark')
      expect(proj.project.title).toContain('A product idea worth keeping')
    } finally {
      close()
    }
  })

  it('image elements sync and persist their type + URL content (rule 2)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)
      const img = {
        id: crypto.randomUUID(),
        type: 'image',
        x: 30, y: 40, width: 480, height: 300,
        color: '',
        content: 'https://example.com/flowchart.png',
        z_index: 0, deleted: 0,
        created_at: ago(1), updated_at: ago(1),
      }
      const res = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [img] }) }))
      expect(res.status).toBe(200)

      const full = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const body = (await full.json()) as { elements: { id: string; type: string; content: string; width: number; height: number }[] }
      expect(body.elements).toHaveLength(1)
      expect(body.elements[0]).toMatchObject({ type: 'image', content: 'https://example.com/flowchart.png', width: 480, height: 300 })
    } finally {
      close()
    }
  })

  it('font_size round-trips through sync — manual text resize survives reload (0013)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeCanvasClient(db, userId)
      const a = el({ type: 'note', color: 'text', content: 'Resizable', width: 40, font_size: 48, updated_at: ago(1) })
      const b = el({ type: 'note', color: 'text', content: 'Default size', width: 40, updated_at: ago(1) }) // no font_size — NULL

      const res = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [a, b] }) }))
      expect(res.status).toBe(200)
      const full = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const body = (await full.json()) as { elements: { id: string; font_size: number | null }[] }
      const byId = new Map(body.elements.map((e) => [e.id, e]))
      expect(byId.get(a.id)?.font_size).toBe(48) // manually-resized size persisted
      expect(byId.get(b.id)?.font_size).toBeNull() // untouched text stays default
    } finally {
      close()
    }
  })
})