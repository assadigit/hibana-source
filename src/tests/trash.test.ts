import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Trash (S50, Settings → Data): the user-facing listing of the 7-day soft-delete window.
// GET /api/settings/trash is read-only and user_id-scoped (rule 1); restore rides the
// existing per-entity endpoints. Covered here: empty state, all three kinds, newest-first
// ordering, isolation between users, auth, the days_left math (including backdated rows
// the cron hasn't purged yet — the listing must NOT filter by age), and that a restore
// removes the item from the listing.

type TrashItem = {
  id: string
  kind: 'project' | 'note' | 'todo'
  title: string
  snippet: string | null
  deleted_at: string
  days_left: number
}

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function listTrash(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }): Promise<TrashItem[]> {
  const res = await client.app.fetch(new Request('http://local/api/settings/trash', { headers: client.auth }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { items: TrashItem[] }
  return body.items
}

describe('trash (settings → data panel)', () => {
  it('requires auth', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db))
      const res = await app.fetch(new Request('http://local/api/settings/trash'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('empty trash → empty list', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const items = await listTrash(client)
      expect(items).toEqual([])
    } finally {
      close()
    }
  })

  it('lists deleted notes, to-dos and projects (newest first, correct kinds + days_left), and hides other users\' items', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const client = await makeClient(db, user)
      const otherClient = await makeClient(db, other)

      // Three deletions, in order: note → to-do → project (each newer than the last).
      let res = await client.app.fetch(new Request('http://local/api/notes', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ kind: 'note', content: 'buy milk' }),
      }))
      expect(res.status).toBe(201)
      const note = (await res.json()) as { id: string }

      res = await client.app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ title: 'water the plants', quadrant: 2 }),
      }))
      expect(res.status).toBe(201)
      const todo = (await res.json()) as { id: string }

      res = await client.app.fetch(new Request('http://local/api/projects', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ title: 'Side project', status: 'spark' }),
      }))
      expect(res.status).toBe(201)
      const project = (await res.json()) as { id: string }

      // Another user's deleted note must never appear (rule 1).
      res = await otherClient.app.fetch(new Request('http://local/api/notes', {
        method: 'POST', headers: otherClient.auth, body: JSON.stringify({ kind: 'note', content: 'their secret' }),
      }))
      const otherNote = (await res.json()) as { id: string }
      res = await otherClient.app.fetch(new Request(`http://local/api/notes/${otherNote.id}`, { method: 'DELETE', headers: otherClient.auth }))
      expect(res.status).toBe(200)

      // Nothing listed while the items are alive.
      expect(await listTrash(client)).toEqual([])

      for (const url of [
        `/api/notes/${note.id}`,
        `/api/sadhana/tasks/${todo.id}`,
        `/api/projects/${project.id}`,
      ] as const) {
        res = await client.app.fetch(new Request(`http://local${url}`, { method: 'DELETE', headers: client.auth }))
        expect(res.status).toBe(200)
      }

      const items = await listTrash(client)
      expect(items).toHaveLength(3)
      // Newest first: the project was deleted last.
      expect(items.map((i) => i.kind)).toEqual(['project', 'todo', 'note'])
      expect(items[0].id).toBe(project.id)
      expect(items[0].title).toBe('Side project')
      expect(items[1].id).toBe(todo.id)
      expect(items[1].title).toBe('water the plants')
      expect(items[2].id).toBe(note.id)
      expect(items[2].title).toBe('buy milk')
      // All deleted seconds ago → the full window remains.
      for (const i of items) expect(i.days_left).toBe(7)

      // The other user sees only their own note.
      const otherItems = await listTrash(otherClient)
      expect(otherItems.map((i) => i.id)).toEqual([otherNote.id])
    } finally {
      close()
    }
  })

  it('backdated items stay listed with days_left 0 until the cron purges them (age is not a filter)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)

      const res = await client.app.fetch(new Request('http://local/api/notes', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ kind: 'note', content: 'old note' }),
      }))
      const note = (await res.json()) as { id: string }
      await client.app.fetch(new Request(`http://local/api/notes/${note.id}`, { method: 'DELETE', headers: client.auth }))

      // Backdate the deletion 8 days — the purge cron owns removal, not the listing.
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
      await db.execute('UPDATE quick_notes SET deleted_at = ? WHERE id = ?', [eightDaysAgo, note.id])

      const items = await listTrash(client)
      expect(items).toHaveLength(1)
      expect(items[0].days_left).toBe(0)
    } finally {
      close()
    }
  })

  it('a restored item leaves the listing (list notes surface their first task as the title)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)

      // A LIST note: title falls back to the first task's text (the JSON item array).
      let res = await client.app.fetch(new Request('http://local/api/notes', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ kind: 'list', content: 'first task' }),
      }))
      const note = (await res.json()) as { id: string }
      await client.app.fetch(new Request(`http://local/api/notes/${note.id}`, { method: 'DELETE', headers: client.auth }))

      let items = await listTrash(client)
      expect(items).toHaveLength(1)
      expect(items[0].kind).toBe('note')
      expect(items[0].title).toBe('first task') // list title ← first item text, not raw JSON
      expect(items[0].snippet).toContain('first task')

      res = await client.app.fetch(new Request(`http://local/api/notes/${note.id}/restore`, { method: 'POST', headers: client.auth }))
      expect(res.status).toBe(200)

      items = await listTrash(client)
      expect(items).toEqual([])
    } finally {
      close()
    }
  })
})
