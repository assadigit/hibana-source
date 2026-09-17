import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S62: vault_notes in the global palette search (/api/search). The 0040 search-depth
// matrix covered projects, quick notes, backlog, sadhana, canvas, and dev tasks — the
// Notes Vault (0057) shipped after it and was the one text surface the palette could
// not find. This pins the LIKE-based group: title + content hits, the snippet window,
// folder resolution, the starred flag, rule 1 (user isolation), soft-delete exclusion,
// and LIKE-wildcard escaping (a stray % must not match everything).

interface Folder { id: string; name: string }
interface VaultHit { id: string; title: string; starred: number; folder: string | null; folder_id: string | null; snippet: string }

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function mkFolder(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, name: string): Promise<Folder> {
  const res = await client.app.fetch(new Request('http://local/api/vault/folders', {
    method: 'POST', headers: client.auth, body: JSON.stringify({ name, parentId: null }),
  }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { folder: Folder }).folder
}

async function mkNote(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, over: { title?: string; content?: string; folderId?: string | null; starred?: boolean }): Promise<{ id: string }> {
  const res = await client.app.fetch(new Request('http://local/api/vault/notes', {
    method: 'POST', headers: client.auth,
    body: JSON.stringify({ title: over.title ?? '', content: over.content ?? '', folderId: over.folderId ?? null }),
  }))
  expect(res.status).toBe(201)
  const note = ((await res.json()) as { note: { id: string } }).note
  if (over.starred) {
    const r = await client.app.fetch(new Request(`http://local/api/vault/notes/${note.id}`, {
      method: 'PATCH', headers: client.auth, body: JSON.stringify({ starred: true }),
    }))
    expect(r.status).toBe(200)
  }
  return note
}

async function search(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, q: string): Promise<VaultHit[]> {
  const res = await client.app.fetch(new Request(`http://local/api/search?q=${encodeURIComponent(q)}`, { headers: client.auth }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { vault: VaultHit[] }).vault
}

describe('S62: vault notes in global search', () => {
  it('title and content hits surface, with folder + snippet + starred; quick notes stay separate', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const folder = await mkFolder(client, 'Design notes')
      await mkNote(client, { title: 'Kaveh typography research', content: 'serif pairings for the rebrand', folderId: folder.id, starred: true })
      await mkNote(client, { title: 'grocery', content: 'remember to check the discount newsletter because the kaveh font family discount might appear there next month or so' })
      await mkNote(client, { title: 'unrelated', content: 'nothing about fonts here' })

      const hits = await search(client, 'kaveh')
      expect(hits.length).toBeGreaterThanOrEqual(2)
      const titled = hits.find((h) => h.title === 'Kaveh typography research')
      expect(titled).toBeTruthy()
      expect(titled!.starred).toBe(1)
      expect(titled!.folder).toBe('Design notes')
      // S67: folder_id rides along — the palette's folder chip navigates to
      // /notes.html?view=folder&folder=<id>, so the hit must carry the id.
      expect(titled!.folder_id).toBe(folder.id)
      // title hit → snippet falls back to a head-window of the content (no content match)
      expect(titled!.snippet.length).toBeGreaterThan(0)
      const body = hits.find((h) => h.title === 'grocery')
      expect(body).toBeTruthy()
      expect(body!.folder).toBeNull()
      expect(body!.folder_id).toBeNull()
      // content hit → the snippet centers the match
      expect(body!.snippet.toLowerCase()).toContain('kaveh')
      expect(body!.snippet).toContain('…')
      // the unrelated note is absent
      expect(hits.find((h) => h.title === 'unrelated')).toBeUndefined()
    } finally { close() }
  })

  it('soft-deleted notes never surface; strangers see none (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db)
      const stranger = await makeUser(db)
      const ownerClient = await makeClient(db, owner)
      const strangerClient = await makeClient(db, stranger)

      const note = await mkNote(ownerClient, { title: 'secret kaveh notes', content: 'private' })
      expect((await search(ownerClient, 'kaveh')).length).toBe(1)
      expect((await search(strangerClient, 'kaveh')).length).toBe(0)

      const del = await ownerClient.app.fetch(new Request(`http://local/api/vault/notes/${note.id}`, { method: 'DELETE', headers: ownerClient.auth }))
      expect(del.status).toBe(200)
      expect((await search(ownerClient, 'kaveh')).length).toBe(0)
    } finally { close() }
  })

  it('LIKE wildcards in the query are escaped — % and _ do not match everything', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      await mkNote(client, { title: 'percent note', content: 'plain' })
      expect(await search(client, '%')).toEqual([])
      expect(await search(client, '_')).toEqual([])
      expect(await search(client, '\\')).toEqual([])
    } finally { close() }
  })
})
