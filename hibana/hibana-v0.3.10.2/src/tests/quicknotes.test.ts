import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { scheduledPurge } from '../routes/admin'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Quick Notebook (dashboard widget, migration 0010). Covering rule 1 (user isolation),
// the two capture modes, item ops, soft delete + restore, Zod validation, and the 7-day purge.

type Note = { id: string; kind: 'note' | 'list'; title: string; content: string; project_id: string | null }
type Item = { id: string; t: string; d: 0 | 1 }

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json' } }
}

async function listNotes(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }): Promise<Note[]> {
  const res = await client.app.fetch(new Request('http://local/api/notes', { headers: client.auth }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { notes: Note[] }
  return body.notes
}

describe('quick notes (dashboard notebook)', () => {
  it('creates a note and a list (with first item), and GET lists both', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      let res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'note', content: 'buy milk' }),
      }))
      expect(res.status).toBe(201)
      const note = (await res.json()) as { id: string }

      res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'list', title: 'Ship list', content: 'first task' }),
      }))
      expect(res.status).toBe(201)
      const list = (await res.json()) as { id: string }

      const notes = await listNotes({ app, auth })
      expect(notes).toHaveLength(2)
      const gotList = notes.find((n) => n.id === list.id)!
      expect(gotList.kind).toBe('list')
      expect(gotList.title).toBe('Ship list')
      const items = JSON.parse(gotList.content) as Item[]
      expect(items).toHaveLength(1)
      expect(items[0].t).toBe('first task')
      expect(items[0].d).toBe(0)

      const gotNote = notes.find((n) => n.id === note.id)!
      expect(gotNote.kind).toBe('note')
      expect(gotNote.content).toBe('buy milk')
    } finally {
      close()
    }
  })

  it('list mode: every Enter/line becomes its own tickable item (no merged inline text)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      // Three lines in the composer (what Enter produces in list mode, or a pasted block).
      const res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'list', title: 'Day plan', content: 'first task\nsecond task\n  \nthird task' }),
      }))
      expect(res.status).toBe(201)

      const notes = await listNotes({ app, auth })
      const items = JSON.parse(notes[0].content) as Item[]
      expect(items).toHaveLength(3) // blank line dropped
      expect(items.map((i) => i.t)).toEqual(['first task', 'second task', 'third task'])
      for (const item of items) {
        expect(item.d).toBe(0) // every item starts unticked with its own checkbox
        expect(item.t).not.toContain('\n')
      }
    } finally {
      close()
    }
  })

  it('patches content (note), title (list), add item, toggle item — all reflected on GET', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      const res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'list', title: 'Tasks', content: 'first' }),
      }))
      const { id } = (await res.json()) as { id: string }
      const notes0 = await listNotes({ app, auth })
      const items0 = JSON.parse(notes0[0].content) as Item[]
      const itemId = items0[0].id

      // add a second item
      let r = await app.fetch(new Request(`http://local/api/notes/list/${id}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ text: 'second' }),
      }))
      expect(r.status).toBe(200)

      // toggle the first item done
      r = await app.fetch(new Request(`http://local/api/notes/list/${itemId}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ done: 1 }),
      }))
      expect(r.status).toBe(200)

      // rename the list
      r = await app.fetch(new Request(`http://local/api/notes/${id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ title: 'Renamed' }),
      }))
      expect(r.status).toBe(200)

      const notes = await listNotes({ app, auth })
      expect(notes[0].title).toBe('Renamed')
      const items = JSON.parse(notes[0].content) as Item[]
      expect(items).toHaveLength(2)
      expect(items.find((i) => i.id === itemId)!.d).toBe(1)
      expect(items.some((i) => i.t === 'second')).toBe(true)
    } finally {
      close()
    }
  })

  it('soft-deletes a note (hidden from GET) and restores it within the window', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      const res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'note', content: 'temp' }),
      }))
      const { id } = (await res.json()) as { id: string }

      let r = await app.fetch(new Request(`http://local/api/notes/${id}`, { method: 'DELETE', headers: auth }))
      expect(r.status).toBe(200)
      expect((await r.json()) as { soft?: boolean }).toMatchObject({ soft: true })
      expect(await listNotes({ app, auth })).toHaveLength(0)

      r = await app.fetch(new Request(`http://local/api/notes/${id}/restore`, { method: 'POST', headers: auth }))
      expect(r.status).toBe(200)
      const notes = await listNotes({ app, auth })
      expect(notes).toHaveLength(1)
      expect(notes[0].id).toBe(id)
    } finally {
      close()
    }
  })

  it('isolates users: B cannot list, patch, or delete A notes (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const aC = await makeClient(db, a)
      const bC = await makeClient(db, b)

      const res = await aC.app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: aC.auth,
        body: JSON.stringify({ kind: 'note', content: 'A secret' }),
      }))
      const { id } = (await res.json()) as { id: string }

      // B's list is empty
      expect(await listNotes(bC)).toHaveLength(0)

      // B cannot patch or delete A's note
      let r = await bC.app.fetch(new Request(`http://local/api/notes/${id}`, {
        method: 'PATCH',
        headers: bC.auth,
        body: JSON.stringify({ content: 'hacked' }),
      }))
      expect(r.status).toBe(404)
      r = await bC.app.fetch(new Request(`http://local/api/notes/${id}`, { method: 'DELETE', headers: bC.auth }))
      expect(r.status).toBe(404)

      // A's note is unchanged and intact
      const notes = await listNotes(aC)
      expect(notes).toHaveLength(1)
      expect(notes[0].content).toBe('A secret')
    } finally {
      close()
    }
  })

  it('rejects bad input via Zod (rule 10): wrong kind and oversized content → 400', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      let r = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'todo', content: 'x' }),
      }))
      expect(r.status).toBe(400)

      r = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'note', content: 'x'.repeat(20_001) }),
      }))
      expect(r.status).toBe(400)

      // User request: an empty note (or list) is never created — 400 from the API too.
      r = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'note', content: '   ' }),
      }))
      expect(r.status).toBe(400)
      r = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'list', content: '' }),
      }))
      expect(r.status).toBe(400)
    } finally {
      close()
    }
  })

  it('append splits a newline-joined draft into several items (commit-on-plus flow)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      const res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'list', title: 'Draft list', content: 'first line' }),
      }))
      const { id } = (await res.json()) as { id: string }

      // The + commits several drafted lines at once (joined with newlines).
      const r = await app.fetch(new Request(`http://local/api/notes/list/${id}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ text: 'two\nthree\n\n  four  ' }),
      }))
      expect(r.status).toBe(200)

      const notes = await listNotes({ app, auth })
      const items = JSON.parse(notes[0].content) as Item[]
      expect(items.map((i) => i.t)).toEqual(['first line', 'two', 'three', 'four'])
      expect(items.every((i) => i.d === 0)).toBe(true)
    } finally {
      close()
    }
  })

  it('keeps the composer in List mode across HX-Request swaps (?mode=list), defaults to Note', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      const res = await app.fetch(new Request('http://local/api/notes?mode=list', {
        method: 'POST',
        headers: { ...auth, 'HX-Request': 'true' },
        body: JSON.stringify({ kind: 'list', content: 'first task' }),
      }))
      expect(res.status).toBe(201)
      const html = await res.text()
      expect(html).toContain('name="kind" value="list"')
      expect(html).toContain('data-note-mode="list" aria-pressed="true"')

      // a refresh without the param falls back to Note mode (the default shell)
      const plain = await app.fetch(new Request('http://local/api/notes', {
        headers: { ...auth, 'HX-Request': 'true' },
      }))
      expect(await plain.text()).toContain('name="kind" value="note"')
    } finally {
      close()
    }
  })

  it('purges soft-deleted notes older than 7 days, keeps fresh ones', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)

      const create = async (content: string): Promise<string> => {
        const r = await app.fetch(new Request('http://local/api/notes', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ kind: 'note', content }),
        }))
        const d = (await r.json()) as { id: string }
        return d.id
      }
      const oldId = await create('old')
      const freshId = await create('fresh')

      // soft-delete both, then age the old one past the 7-day window
      await app.fetch(new Request(`http://local/api/notes/${oldId}`, { method: 'DELETE', headers: auth }))
      await app.fetch(new Request(`http://local/api/notes/${freshId}`, { method: 'DELETE', headers: auth }))
      await db.execute('UPDATE quick_notes SET deleted_at = ? WHERE id = ?', [
        new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
        oldId,
      ])

      await scheduledPurge(makeConfig(db))

      const rows = await db.query<{ id: string }>('SELECT id FROM quick_notes')
      const remaining = rows.map((r) => r.id)
      expect(remaining).not.toContain(oldId)
      expect(remaining).toContain(freshId)
    } finally {
      close()
    }
  })
})

describe('quick notes ↔ project attachment (user request)', () => {
  const insertProject = async (db: Db, userId: string, title: string, id = crypto.randomUUID()) => {
    const now = new Date().toISOString()
    await db.execute(
      "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, ?, '', 'personal', 'spark', 0, '', 0, ?, ?)",
      [id, userId, title, now, now],
    )
    return id
  }
  const createNote = async (app: ReturnType<typeof createApp>, auth: Record<string, string>, content: string, extra: Record<string, unknown> = {}) => {
    const res = await app.fetch(new Request('http://local/api/notes', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ kind: 'note', content, ...extra }),
    }))
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  it('create accepts an owned project_id; a foreign project is rejected (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const projectId = await insertProject(db, user, 'Idea XX')
      const foreign = await insertProject(db, other, 'Someone else')

      const id = await createNote(app, auth, 'new thought', { project_id: projectId })
      const notes = await listNotes({ app, auth })
      expect(notes[0].id).toBe(id)
      expect(notes[0].project_id).toBe(projectId)

      const res = await app.fetch(new Request('http://local/api/notes', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ kind: 'note', content: 'steal', project_id: foreign }),
      }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('project_not_found')
    } finally {
      close()
    }
  })

  it('PATCH attaches, rejects foreign targets, detaches with null', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const projectId = await insertProject(db, user, 'Ship project')
      const foreign = await insertProject(db, other, 'Foreign')
      const id = await createNote(app, auth, 'attach me')

      let r = await app.fetch(new Request(`http://local/api/notes/${id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ project_id: projectId }),
      }))
      expect(r.status).toBe(200)
      let notes = await listNotes({ app, auth })
      expect(notes[0].project_id).toBe(projectId)

      // cross-user project id → 400 (rule 1: never attach to someone else's project)
      r = await app.fetch(new Request(`http://local/api/notes/${id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ project_id: foreign }),
      }))
      expect(r.status).toBe(400)

      // untouched other user's note → 404 for this user
      r = await app.fetch(new Request(`http://local/api/notes/${crypto.randomUUID()}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ project_id: projectId }),
      }))
      expect(r.status).toBe(404)

      // detach
      r = await app.fetch(new Request(`http://local/api/notes/${id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ project_id: null }),
      }))
      expect(r.status).toBe(200)
      notes = await listNotes({ app, auth })
      expect(notes[0].project_id).toBeNull()
    } finally {
      close()
    }
  })

  it('notebook htmx: attach button → chip linking to the project after attach', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const projectId = await insertProject(db, user, 'Idea XX')
      const id = await createNote(app, auth, 'follow-up thought')

      let res = await app.fetch(new Request('http://local/api/notes', { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const before = await res.text()
      expect(before).toContain('attach-btn')
      expect(before).toContain(`/attach-picker?note_id=${id}`)

      res = await app.fetch(new Request(`http://local/api/notes/${id}`, {
        method: 'PATCH',
        headers: { ...auth, 'HX-Request': 'true' },
        body: JSON.stringify({ project_id: projectId }),
      }))
      expect(res.status).toBe(200)
      const after = await res.text()
      expect(after).toContain('attach-chip')
      expect(after).toContain('/project.html?id=' + projectId)
      expect(after).toContain('Idea XX')
    } finally {
      close()
    }
  })

  it('attach-picker lists only the user own projects; empty state when there are none', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await insertProject(db, user, 'Attach target')
      await insertProject(db, other, 'Not yours')
      const id = await createNote(app, auth, 'pick me')

      let res = await app.fetch(new Request(`http://local/api/notes/attach-picker?note_id=${id}`, { headers: auth }))
      expect(res.status).toBe(200)
      const picker = await res.text()
      expect(picker).toContain('Attach to…')
      expect(picker).toContain('Attach target')
      expect(picker).toContain(`hx-patch="/api/notes/${id}"`)
      expect(picker).not.toContain('Not yours')

      // not your note → 404
      res = await app.fetch(new Request(`http://local/api/notes/attach-picker?note_id=${crypto.randomUUID()}`, { headers: auth }))
      expect(res.status).toBe(404)

      // no projects at all → friendly hint
      const emptyUser = await makeUser(db)
      const { app: eApp, auth: eAuth } = await makeClient(db, emptyUser)
      const eNoteId = await createNote(eApp, eAuth, 'lonely')
      res = await eApp.fetch(new Request(`http://local/api/notes/attach-picker?note_id=${eNoteId}`, { headers: eAuth }))
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('No projects to attach to yet')
    } finally {
      close()
    }
  })

  it('project detail shows its related notes; other users notes stay invisible', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const projectId = await insertProject(db, user, 'Idea XX')
      await createNote(app, auth, 'follow-up thought', { project_id: projectId })

      const otherProject = await insertProject(db, other, 'Other project')
      const { app: oApp, auth: oAuth } = await makeClient(db, other)
      await createNote(oApp, oAuth, 'secret', { project_id: otherProject })

      const res = await app.fetch(new Request(`http://local/api/projects/${projectId}`, { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Related notes (1)')
      expect(html).toContain('follow-up thought')
      expect(html).not.toContain('secret')

      const otherHtml = await (await oApp.fetch(new Request(`http://local/api/projects/${otherProject}`, { headers: { ...oAuth, 'HX-Request': 'true' } }))).text()
      expect(otherHtml).toContain('secret')
    } finally {
      close()
    }
  })
})