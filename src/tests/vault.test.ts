import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { excerptOf, wordCount } from '../routes/vault'
import { safePathSegment } from '../services/obsidian-export'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Notes Vault (migration 0057, S53): the standalone long-form knowledge base behind
// /notes + /api/vault. Covering rule 1 (user isolation), folder nesting + cycle-safe
// moves, the never-lose-data rule (folder delete unfiles, note delete soft-deletes,
// purge is the only hard delete), the tag index (manual + inline), search, star,
// duplicate, and the .md export.

interface Folder { id: string; name: string; parent_id: string | null; note_count?: number }
interface NoteCard {
  id: string
  title: string
  content?: string
  tags: string
  starred: 0 | 1
  folder_id: string | null
  deleted_at: string | null
  excerpt: string
  word_count: number
  updated_at: string
}
type Note = NoteCard & { content: string }

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function mkFolder(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, name: string, parentId?: string | null): Promise<Folder> {
  const res = await client.app.fetch(new Request('http://local/api/vault/folders', {
    method: 'POST',
    headers: client.auth,
    body: JSON.stringify({ name, parentId: parentId ?? null }),
  }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { folder: Folder }).folder
}

async function mkNote(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, over: { title?: string; content?: string; folderId?: string | null; tags?: string } = {}): Promise<Note> {
  const res = await client.app.fetch(new Request('http://local/api/vault/notes', {
    method: 'POST',
    headers: client.auth,
    body: JSON.stringify({ title: over.title ?? '', content: over.content ?? '', folderId: over.folderId ?? null, tags: over.tags ?? '' }),
  }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { note: Note }).note
}

async function listNotes(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, qs = ''): Promise<NoteCard[]> {
  const res = await client.app.fetch(new Request(`http://local/api/vault/notes${qs}`, { headers: client.auth }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { notes: NoteCard[] }).notes
}

describe('notes vault (0057)', () => {
  it('creates notes; tags normalize (dedupe case-insensitive, # stripped, capped)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const note = await mkNote({ app, auth }, { title: 'Movies to watch', content: 'list', tags: 'film, Film, #cinema,  , ,x' })
      expect(note.tags).toBe('film, cinema, x')
      // default shape
      const bare = await mkNote({ app, auth })
      expect(bare.title).toBe('')
      expect(bare.content).toBe('')
      expect(bare.starred).toBe(0)
    } finally {
      close()
    }
  })

  it('folder tree: nested create, rename, move with cycle rejection, delete unfiles (never loses notes)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const movies = await mkFolder({ app, auth }, 'Movies')
      const scifi = await mkFolder({ app, auth }, 'Sci-fi', movies.id)
      await mkNote({ app, auth }, { title: 'Dune', folderId: scifi.id })

      // nested listing
      let cards = await listNotes({ app, auth }, `?view=folder&folder=${scifi.id}`)
      expect(cards).toHaveLength(1)
      expect(cards[0].title).toBe('Dune')
      cards = await listNotes({ app, auth }, `?view=folder&folder=${movies.id}`)
      expect(cards).toHaveLength(0) // not recursive — the folder view shows its own notes

      // cycle: scifi cannot become its own child's parent
      let res = await app.fetch(new Request(`http://local/api/vault/folders/${movies.id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ parentId: scifi.id }),
      }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('cycle')

      // rename
      res = await app.fetch(new Request(`http://local/api/vault/folders/${scifi.id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'Sci-fi classics' }),
      }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { folder: Folder }).folder.name).toBe('Sci-fi classics')

      // delete the PARENT folder: the note must survive, unfiled
      res = await app.fetch(new Request(`http://local/api/vault/folders/${movies.id}`, { method: 'DELETE', headers: auth }))
      expect(res.status).toBe(200)
      cards = await listNotes({ app, auth })
      expect(cards).toHaveLength(1)
      expect(cards[0].folder_id).toBeNull()
      expect(cards[0].title).toBe('Dune')
      // the Unfiled pseudo-folder finds it
      cards = await listNotes({ app, auth }, '?view=folder&folder=none')
      expect(cards).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('bootstrap: counts + tag index (manual pills AND inline #tags, one vote per note)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await mkNote({ app, auth }, { title: 'A', content: 'watch #dune and #blade-runner', tags: 'dune' })
      await mkNote({ app, auth }, { title: 'B', content: 'plain #dune' })
      const c = await mkNote({ app, auth }, { title: 'C', content: 'gone' })
      await mkNote({ app, auth }, { title: 'D', content: 'starred one' })

      // star D, trash C
      const cards = await listNotes({ app, auth })
      const d = cards.find((x) => x.title === 'D')!
      await app.fetch(new Request(`http://local/api/vault/notes/${d.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ starred: true }) }))
      await app.fetch(new Request(`http://local/api/vault/notes/${c.id}`, { method: 'DELETE', headers: auth }))

      const res = await app.fetch(new Request('http://local/api/vault/bootstrap', { headers: auth }))
      expect(res.status).toBe(200)
      const boot = (await res.json()) as { folders: Folder[]; tags: { tag: string; count: number }[]; counts: { all: number; starred: number; trash: number; unfiled: number } }
      expect(boot.counts).toEqual({ all: 3, starred: 1, trash: 1, unfiled: 3 }) // all three notes live unfiled
      // per-folder counts ride the folder rows
      expect(boot.folders.every((f) => typeof f.note_count === 'number')).toBe(true)
      const byTag = new Map(boot.tags.map((t) => [t.tag.toLowerCase(), t.count]))
      expect(byTag.get('dune')).toBe(2) // manual in A + inline in B (A's manual+inline = one vote)
      expect(byTag.get('blade-runner')).toBe(1)
      // markdown headings must NOT read as tags (C is trashed so its content is out)
      expect([...byTag.keys()].some((k) => k === 'heading')).toBe(false)
    } finally {
      close()
    }
  })

  it('search: q over title+content, tag filter over pills + inline; sort by title/created', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await mkNote({ app, auth }, { title: 'Dune review', content: 'epic #scifi', tags: 'movies' })
      await mkNote({ app, auth }, { title: 'Groceries', content: 'buy milk #errand', tags: 'home' })
      await mkNote({ app, auth }, { title: 'Blade Runner', content: 'also epic', tags: 'movies, epic' })

      let cards = await listNotes({ app, auth }, '?q=epic')
      expect(cards).toHaveLength(2) // content matches
      cards = await listNotes({ app, auth }, '?q=dune')
      expect(cards).toHaveLength(1)
      cards = await listNotes({ app, auth }, '?q=EPIC')
      expect(cards).toHaveLength(2) // case-insensitive
      // tag filter: manual pill
      cards = await listNotes({ app, auth }, '?tag=movies')
      expect(cards).toHaveLength(2)
      // tag filter: inline #tag
      cards = await listNotes({ app, auth }, '?tag=scifi')
      expect(cards).toHaveLength(1)
      // tag filter: case-insensitive pill match (Dune's 'epic' is a plain word, not #epic)
      cards = await listNotes({ app, auth }, '?tag=Epic')
      expect(cards).toHaveLength(1)
      // sort by title
      cards = await listNotes({ app, auth }, '?sort=title')
      expect(cards.map((x) => x.title)).toEqual(['Blade Runner', 'Dune review', 'Groceries'])
    } finally {
      close()
    }
  })

  it('soft delete → trash view → restore; purge is the only hard delete; editor PATCH on trashed note = 404', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const n = await mkNote({ app, auth }, { title: 'temp', content: 'will be deleted' })

      let res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}`, { method: 'DELETE', headers: auth }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { soft: boolean }).soft).toBe(true)

      // live views lose it, trash has it
      expect(await listNotes({ app, auth })).toHaveLength(0)
      const trash = await listNotes({ app, auth }, '?view=trash')
      expect(trash).toHaveLength(1)
      expect(trash[0].deleted_at).not.toBeNull()

      // autosave target: a trashed note is frozen
      res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ title: 'nope' }) }))
      expect(res.status).toBe(404)

      // restore
      res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}/restore`, { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      expect(await listNotes({ app, auth })).toHaveLength(1)

      // purge requires trash state
      res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}/purge`, { method: 'POST', headers: auth }))
      expect(res.status).toBe(404) // live note — purge refused
      await app.fetch(new Request(`http://local/api/vault/notes/${n.id}`, { method: 'DELETE', headers: auth }))
      res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}/purge`, { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      expect(await listNotes({ app, auth }, '?view=trash')).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('duplicate copies content/tags/folder with " (copy)" title; export.md serves the body + filename', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const folder = await mkFolder({ app, auth }, 'F')
      const n = await mkNote({ app, auth }, { title: 'Watchlist', content: '- Dune\n- Arrival', folderId: folder.id, tags: 'film' })

      let res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}/duplicate`, { method: 'POST', headers: auth }))
      expect(res.status).toBe(201)
      const dup = ((await res.json()) as { note: Note }).note
      expect(dup.title).toBe('Watchlist (copy)')
      expect(dup.content).toBe('- Dune\n- Arrival')
      expect(dup.folder_id).toBe(folder.id)
      expect(dup.tags).toBe('film')

      res = await app.fetch(new Request(`http://local/api/vault/notes/${n.id}/export.md`, { headers: auth }))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/markdown')
      const cd = res.headers.get('content-disposition') ?? ''
      expect(cd).toContain('attachment')
      expect(cd).toContain('Watchlist.md')
      const body = await res.text()
      expect(body).toContain('# Watchlist')
      expect(body).toContain('- Arrival')
    } finally {
      close()
    }
  })

  it('rule 1: a second user sees nothing — no list, no bootstrap, no read, no write', async () => {
    const { db, close } = makeTestDb()
    try {
      const userA = await makeUser(db)
      const userB = await makeUser(db)
      const a = await makeClient(db, userA)
      const b = await makeClient(db, userB)
      const folder = await mkFolder(a, 'A-folder')
      const n = await mkNote(a, { title: 'secret', content: 'private', folderId: folder.id })

      expect(await listNotes(b)).toHaveLength(0)
      let res = await b.app.fetch(new Request('http://local/api/vault/bootstrap', { headers: b.auth }))
      expect(((await res.json()) as { counts: { all: number } }).counts.all).toBe(0)
      res = await b.app.fetch(new Request(`http://local/api/vault/notes/${n.id}`, { headers: b.auth }))
      expect(res.status).toBe(404)
      res = await b.app.fetch(new Request(`http://local/api/vault/notes/${n.id}`, { method: 'PATCH', headers: b.auth, body: JSON.stringify({ title: 'stolen' }) }))
      expect(res.status).toBe(404)
      res = await b.app.fetch(new Request(`http://local/api/vault/notes/${n.id}`, { method: 'DELETE', headers: b.auth }))
      expect(res.status).toBe(404)
      res = await b.app.fetch(new Request(`http://local/api/vault/folders/${folder.id}`, { method: 'DELETE', headers: b.auth }))
      expect(res.status).toBe(404)
      // B creating a note in A's folder = rejected
      res = await b.app.fetch(new Request('http://local/api/vault/notes', { method: 'POST', headers: b.auth, body: JSON.stringify({ folderId: folder.id }) }))
      expect(res.status).toBe(400)
    } finally {
      close()
    }
  })

  it('cards carry excerpt + word_count (content stripped from list payloads)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      await mkNote({ app, auth }, { title: 'Long', content: '## Heading\n\n- one\n- two\n\n**bold** text here' })
      const cards = await listNotes({ app, auth })
      expect(cards).toHaveLength(1)
      expect((cards[0] as { content?: string }).content).toBeUndefined()
      expect(cards[0].excerpt).not.toContain('##')
      expect(cards[0].excerpt).not.toContain('**')
      expect(cards[0].word_count).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  it('unauthenticated access is walled (401)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app } = await makeClient(db, user)
      for (const path of ['/api/vault/bootstrap', '/api/vault/notes']) {
        const res = await app.fetch(new Request(`http://local${path}`))
        expect(res.status).toBe(401)
      }
    } finally {
      close()
    }
  })
})

describe('vault helpers', () => {
  it('excerptOf strips markdown and clamps with an ellipsis', () => {
    expect(excerptOf('## Title\n\nsome **bold** and `code`')).toBe('Title some bold and code')
    expect(excerptOf('```js\nconst x = 1\n```')).toBe('')
    const long = 'word '.repeat(60)
    expect(excerptOf(long).endsWith('…')).toBe(true)
    expect(excerptOf(long).length).toBeLessThanOrEqual(160)
  })

  it('wordCount counts whitespace-separated words (Persian included)', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('one two three')).toBe(3)
    expect(wordCount('فیلم  بازی  کتاب')).toBe(3)
  })

  it('safePathSegment scrubs path-hostile folder names', () => {
    expect(safePathSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
    expect(safePathSegment('..')).toBe('Folder')
    expect(safePathSegment('   ')).toBe('Folder')
  })
})
