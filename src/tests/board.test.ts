import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

// The notebook is a second board on the same canvas_elements sync (migration 0009). These tests
// pin that boards never bleed into each other, users never see each other's boards (rule 1), and
// LWW + tombstone semantics survive per-board.
describe('canvas board scoping (0009)', () => {
  function el(over: Record<string, unknown> = {}) {
    return {
      id: crypto.randomUUID(),
      type: 'stroke',
      x: 10, y: 20, width: null, height: null,
      color: '#2f6fd1',
      content: JSON.stringify([[0, 0], [1, 1]]),
      board: 'notebook',
      deleted: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...over,
    }
  }

  it('notebook elements only appear on the notebook board, not the canvas', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const note = el()
      const canvasEl = el({ id: crypto.randomUUID(), board: 'canvas' })

      const sync = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [note, canvasEl] }) }))
      expect(sync.status).toBe(200)

      const nb = await app.fetch(new Request('http://local/api/canvas/full?board=notebook', { headers: auth }))
      const nbBody = (await nb.json()) as { elements: { id: string; board: string }[] }
      expect(nbBody.elements.map((e) => e.id)).toEqual([note.id])

      const cv = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const cvBody = (await cv.json()) as { elements: { id: string; board: string }[] }
      expect(cvBody.elements.map((e) => e.id)).toEqual([canvasEl.id])

      // bbox endpoint is board-aware too
      const bbox = await app.fetch(new Request('http://local/api/canvas', { headers: auth }))
      const bboxBody = (await bbox.json()) as { elements: { id: string }[] }
      expect(bboxBody.elements.map((e) => e.id)).toEqual([canvasEl.id])
    } finally {
      close()
    }
  })

  it('users never see each other\u2019s notebook boards (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u1 = await makeUser(db)
      const u2 = await makeUser(db)
      const { app, auth } = await makeClient(db, u1)
      const { app: app2, auth: auth2 } = await makeClient(db, u2)

      const note = el()
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [note] }) }))

      const res = await app2.fetch(new Request('http://local/api/canvas/full?board=notebook', { headers: auth2 }))
      const body = (await res.json()) as { elements: unknown[] }
      expect(body.elements).toEqual([])
    } finally {
      close()
    }
  })

  it('tombstones and last-write-wins still hold per board', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const note = el()
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [note] }) }))

      // older update cannot clobber a newer one (LWW)
      const stale = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [el({ id: note.id, updated_at: '2000-01-01T00:00:00.000Z' })] }) }))
      expect(stale.status).toBe(200)
      const afterStale = await app.fetch(new Request('http://local/api/canvas/full?board=notebook', { headers: auth }))
      const staleBody = (await afterStale.json()) as { elements: { deleted: number }[] }
      expect(staleBody.elements).toHaveLength(1)
      expect(staleBody.elements[0].deleted).toBe(0)

      // tombstone hides it from the board; a delayed older replay cannot resurrect it
      const del = el({ id: note.id, deleted: 1, updated_at: new Date(new Date().getTime() + 1000).toISOString() })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [del] }) }))

      const reviveAttempt = await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [el({ id: note.id, updated_at: new Date().toISOString() })] }) }))
      expect(reviveAttempt.status).toBe(200)

      const final = await app.fetch(new Request('http://local/api/canvas/full?board=notebook', { headers: auth }))
      const finalBody = (await final.json()) as { elements: unknown[] }
      expect(finalBody.elements).toEqual([]) // still gone — tombstone wins
    } finally {
      close()
    }
  })
})
