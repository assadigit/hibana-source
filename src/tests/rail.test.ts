import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S88 — the navigation rail's secondary panel data source: GET /api/rail returns
// every section's items in ONE round trip (projects/sparks/folders/notes/todos),
// user-scoped (Rule 1), soft-delete respected, live/parked rows only, no-store.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

describe('GET /api/rail (the navigation rail panel payload)', () => {
  it('401 without a session — the auth gate is the same as every /api route', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db))
      const res = await app.fetch(new Request('http://local/api/rail'))
      expect(res.status).toBe(401)
    } finally { close() }
  })

  it('returns every section\'s lists, user-scoped, no-store', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'rail-me' })
      const other = await makeUser(db, { username: 'rail-other' })
      const now = new Date().toISOString()
      // A project per bucket: live (doing), spark, PARKED (archived offline), and
      // another user's row that must never leak (Rule 1).
      for (const [id, user, status, archived] of [
        ['p1', me, 'doing', null],
        ['p2', me, 'spark', null],
        ['p3', me, 'doing', 'offline'],
        ['p9', other, 'doing', null],
      ] as const) {
        await db.execute(
          'INSERT INTO projects (id, user_id, title, status, archived_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, user, `Project ${id}`, status, archived, now, now],
        )
      }
      // A folder + a note (live), a soft-deleted note (never listed), + another
      // user's folder.
      await db.execute('INSERT INTO note_folders (id, user_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)', ['f1', me, 'Docs', now, now])
      await db.execute('INSERT INTO note_folders (id, user_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)', ['f9', other, 'Theirs', now, now])
      for (const [id, user, folder, deleted] of [
        ['n1', me, 'f1', null],
        ['n2', me, null, null],
        ['n3', me, null, now], // soft-deleted
      ] as const) {
        await db.execute(
          'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
          [id, user, folder, `Note ${id}`, 'body', '', deleted, now, now],
        )
      }
      // To-dos: one open, one done — open sorts first.
      for (const [id, done] of [['t1', 0], ['t2', 1]] as const) {
        await db.execute(
          'INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, done, position, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, 0, ?, ?)',
          [id, me, `Task ${id}`, '📌', done, now, now],
        )
      }

      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/rail', { headers: auth }))
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = (await res.json()) as {
        projects: { id: string; title: string; status: string }[]
        sparks: { id: string }[]
        folders: { id: string; note_count: number }[]
        notes: { id: string }[]
        todos: { id: string; done: number }[]
      }

      // Projects: live only (parked + spark excluded, other user's row never leaks).
      expect(body.projects.map((p) => p.id)).toEqual(['p1'])
      expect(body.projects[0]).toMatchObject({ id: 'p1', title: 'Project p1', status: 'doing' })
      // Sparks: the Ideas shelf.
      expect(body.sparks.map((p) => p.id)).toEqual(['p2'])
      // Folders: mine only, with LIVE note counts (the deleted note never counts).
      expect(body.folders.map((f) => f.id)).toEqual(['f1'])
      expect(body.folders[0].note_count).toBe(1)
      // Notes: live rows only (soft-deleted excluded), with folder_id + icon passthrough.
      expect(body.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])
      // To-dos: both rows, open first (done ASC).
      expect(body.todos.map((t) => t.id)).toEqual(['t1', 't2'])
      expect(body.todos[0]).toMatchObject({ id: 't1', done: 0 })
    } finally { close() }
  })
})
