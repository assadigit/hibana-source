import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S64: quick notes in the global search (/api/search) gain the FTS5 snippet() — the
// same information scent the vault group has (S62). An untitled note's palette row
// previously read "Untitled note" with no hint of WHERE the query hit; now the row
// carries a ~12-token window around the first content match. This pins: content hits
// surface WITH a snippet, the snippet is centered near the match, rule 1 (user
// isolation), and soft-delete exclusion.

interface NoteHit { id: string; title: string; kind: string; snippet?: string }

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function mkNote(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, content: string, title = ''): Promise<{ id: string }> {
  const res = await client.app.fetch(new Request('http://local/api/notes', {
    method: 'POST', headers: client.auth, body: JSON.stringify({ kind: 'note', title, content }),
  }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { ok: boolean; id: string })
}

async function search(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, q: string): Promise<NoteHit[]> {
  const res = await client.app.fetch(new Request(`http://local/api/search?q=${encodeURIComponent(q)}`, { headers: client.auth }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { notes: NoteHit[] }).notes
}

describe('S64: quick-note search snippet', () => {
  it('a content hit carries a snippet containing the needle — an untitled note is more than "Untitled"', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const client = await makeClient(db, userId)
      await mkNote(client, 'grocery list for the weekend: bread quillneedle butter and jam', '')
      const hits = await search(client, 'quillneedle')
      expect(hits.length).toBe(1)
      expect(hits[0].snippet).toBeTruthy()
      expect(hits[0].snippet).toContain('quillneedle')
    } finally { close() }
  })

  it('isolation + soft-delete: another user\'s hit and a deleted note never surface', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const ca = await makeClient(db, a)
      const cb = await makeClient(db, b)
      const note = await mkNote(cb, 'private secret needle for user b')
      expect(note.id).toBeTruthy()
      expect(await search(ca, 'needle')).toHaveLength(0)
      const del = await ca.app.fetch(new Request(`http://local/api/notes/${(await mkNote(ca, 'shared needle then deleted')).id}`, { method: 'DELETE', headers: ca.auth }))
      expect(del.status).toBe(200)
      expect(await search(ca, 'needle')).toHaveLength(0)
      expect(await search(cb, 'needle')).toHaveLength(1)
    } finally { close() }
  })
})
