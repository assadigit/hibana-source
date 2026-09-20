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
  /** S86 (0059): the note's user-picked emoji. */
  icon?: string | null
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
      const boot = (await res.json()) as { folders: Folder[]; tags: { tag: string; count: number }[]; counts: { all: number; starred: number; trash: number; unfiled: number; has_sparks: boolean } }
      expect(boot.counts).toEqual({ all: 3, starred: 1, trash: 1, unfiled: 3, has_sparks: false, has_quicknotes: false }) // no sparks/quick notes in this fixture
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


  it('S54: sparks → vault import — copies into an Ideas folder, idempotent, sparks untouched', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      // two live sparks (one with a "where I left off" note) + one soft-deleted + one non-spark project
      const iso = () => new Date().toISOString()
      await db.execute(
        "INSERT INTO projects (id, user_id, title, description, latest_note, status, created_at, updated_at) VALUES ('sp1', ?, 'Idea one', 'The description.', 'Left off here', 'spark', ?, ?), ('sp2', ?, 'Idea two', '', '', 'spark', ?, ?), ('sp3', ?, 'Deleted idea', 'x', '', 'spark', ?, ?), ('pr1', ?, 'Real project', '', '', 'doing', ?, ?)",
        [user, iso(), iso(), user, iso(), iso(), user, iso(), iso(), user, iso(), iso()],
      )
      await db.execute("UPDATE projects SET deleted_at = ? WHERE id = 'sp3'", [iso()])

      // has_sparks flag is live in bootstrap
      let res = await app.fetch(new Request('http://local/api/vault/bootstrap', { headers: auth }))
      expect(((await res.json()) as { counts: { has_sparks: boolean } }).counts.has_sparks).toBe(true)

      res = await app.fetch(new Request('http://local/api/vault/import/sparks', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      let body = (await res.json()) as { created: number; skipped: number; folder_id?: string }
      expect(body.created).toBe(2) // sp1 + sp2 only
      expect(body.skipped).toBe(0)

      // the Ideas folder carries them, with the quote + tag
      const cards = await listNotes({ app, auth }, `?view=folder&folder=${body.folder_id}`)
      expect(cards).toHaveLength(2)
      const one = cards.find((c) => c.title === 'Idea one')!
      expect(one.tags).toBe('idea')
      const full = (await (await app.fetch(new Request(`http://local/api/vault/notes/${one.id}`, { headers: auth }))).json()) as { note: { content: string } }
      expect(full.note.content).toContain('The description.')
      expect(full.note.content).toContain('> Left off here')

      // the sparks THEMSELVES are untouched (copy, never move)
      const sparkCount = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND status = 'spark' AND deleted_at IS NULL", [user])
      expect(sparkCount[0].n).toBe(2)

      // re-run: idempotent (same titles present → skipped)
      res = await app.fetch(new Request('http://local/api/vault/import/sparks', { method: 'POST', headers: auth }))
      body = (await res.json()) as { created: number; skipped: number }
      expect(body.created).toBe(0)
      expect(body.skipped).toBe(2)

      // rule 1: another user's sparks are invisible to this import
      const userB = await makeUser(db)
      const b = await makeClient(db, userB)
      await db.execute(
        "INSERT INTO projects (id, user_id, title, description, status, created_at, updated_at) VALUES ('spb', ?, 'B secret', 'nope', 'spark', ?, ?)",
        [userB, iso(), iso()],
      )
      const bootB = (await (await b.app.fetch(new Request('http://local/api/vault/bootstrap', { headers: b.auth }))).json()) as { counts: { has_sparks: boolean } }
      expect(bootB.counts.has_sparks).toBe(true)
      const resB = (await (await b.app.fetch(new Request('http://local/api/vault/import/sparks', { method: 'POST', headers: b.auth }))).json()) as { created: number }
      expect(resB.created).toBe(1) // only B's own spark
      const bCards = await listNotes(b)
      expect(bCards.map((c) => c.title)).toEqual(['B secret'])
    } finally {
      close()
    }
  })

  it('S55: quick notes → vault import — copies into a Notebook folder, lists render as bullets, idempotent, quick notes untouched', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const { app, auth } = await makeClient(db, user)
      const iso = () => new Date().toISOString()
      // one plain note, one list (2 open + 1 done item), one soft-deleted, one EMPTY note
      await db.execute(
        "INSERT INTO quick_notes (id, user_id, kind, title, content, deleted_at, created_at, updated_at) VALUES ('qn1', ?, 'note', '', 'Fix the porch light\nbuy bulbs first', NULL, ?, ?), ('qn2', ?, 'list', 'Launch checklist', ?, NULL, ?, ?), ('qn3', ?, 'note', '', 'deleted capture', ?, ?, ?), ('qn4', ?, 'note', '', '', NULL, ?, ?)",
        [user, iso(), iso(), user, JSON.stringify([{ id: 'a', t: 'Renew domain', d: 0 }, { id: 'b', t: 'Email the accountant', d: 1 }, { id: 'c', t: 'Backup keys', d: 0 }]), iso(), iso(), user, iso(), iso(), iso(), user, iso(), iso()],
      )

      // has_quicknotes flag is live in bootstrap
      let res = await app.fetch(new Request('http://local/api/vault/bootstrap', { headers: auth }))
      expect(((await res.json()) as { counts: { has_quicknotes: boolean } }).counts.has_quicknotes).toBe(true)

      res = await app.fetch(new Request('http://local/api/vault/import/quicknotes', { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      let body = (await res.json()) as { created: number; skipped: number; folder_id?: string }
      expect(body.created).toBe(2) // qn1 + qn2; qn3 is soft-deleted
      expect(body.skipped).toBe(1) // qn4 is empty — not importable, counted as skipped

      // the Notebook folder carries them, with the quicknote tag
      const cards = await listNotes({ app, auth }, `?view=folder&folder=${body.folder_id}`)
      expect(cards).toHaveLength(2)
      const plain = cards.find((c) => c.title === 'Fix the porch light')!
      expect(plain.tags).toBe('quicknote')
      const full = (await (await app.fetch(new Request(`http://local/api/vault/notes/${plain.id}`, { headers: auth }))).json()) as { note: { content: string } }
      expect(full.note.content).toContain('buy bulbs first')

      const list = cards.find((c) => c.title === 'Launch checklist')!
      const listFull = (await (await app.fetch(new Request(`http://local/api/vault/notes/${list.id}`, { headers: auth }))).json()) as { note: { content: string } }
      expect(listFull.note.content).toContain('- Renew domain')
      expect(listFull.note.content).toContain('- ~~Email the accountant~~') // done item struck through
      expect(listFull.note.content).not.toContain('[ ]') // no task-list syntax (S53 owner rule)

      // the quick notes THEMSELVES are untouched (copy, never move)
      const qnCount = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL', [user])
      expect(qnCount[0].n).toBe(3)

      // re-run: idempotent
      res = await app.fetch(new Request('http://local/api/vault/import/quicknotes', { method: 'POST', headers: auth }))
      body = (await res.json()) as { created: number; skipped: number }
      expect(body.created).toBe(0)
      expect(body.skipped).toBe(3) // qn1 + qn2 present (idempotent) + qn4 empty again

      // rule 1: another user's quick notes are invisible to this import
      const userB = await makeUser(db)
      const b = await makeClient(db, userB)
      await db.execute(
        "INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES ('qnb', ?, 'note', '', 'B secret note', ?, ?)",
        [userB, iso(), iso()],
      )
      const bootB = (await (await b.app.fetch(new Request('http://local/api/vault/bootstrap', { headers: b.auth }))).json()) as { counts: { has_quicknotes: boolean } }
      expect(bootB.counts.has_quicknotes).toBe(true)
      const resB = (await (await b.app.fetch(new Request('http://local/api/vault/import/quicknotes', { method: 'POST', headers: b.auth }))).json()) as { created: number }
      expect(resB.created).toBe(1) // only B's own quick note
      const bCards = await listNotes(b)
      expect(bCards.map((c) => c.title)).toEqual(['B secret note'])
    } finally {
      close()
    }
  })

describe('vault helpers', () => {
  it('excerptOf strips markdown and clamps with an ellipsis', () => {
    expect(excerptOf('## Title\n\nsome **bold** and `code`')).toBe('Title some bold and code')
    expect(excerptOf('```js\nconst x = 1\n```')).toBe('')
    const long = 'word '.repeat(60)
    expect(excerptOf(long).endsWith('…')).toBe(true)
    expect(excerptOf(long).length).toBeLessThanOrEqual(160)
  })

  it('S84: excerptOf strips task markers (bulleted AND bare) — no raw "[ ]" on the card', () => {
    expect(excerptOf('- [ ] milk\n- [x] eggs\n- bread')).toBe('milk eggs bread')
    expect(excerptOf('[ ] bare first line\nsecond')).toBe('bare first line second')
    expect(excerptOf('- [ ]')).toBe('')
    // a link line whose text is x keeps its link text (space-after-] is required)
    expect(excerptOf('[x](https://a.com) link line stays')).toBe('x link line stays')
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

// ── S86 (0059): note/folder emoji + manual drag-reorder ─────────────────────────
describe('notes vault S86 — icons + manual reorder', () => {
  it('note icon: PATCH sets/clears; the value round-trips on cards + the full note; junk sanitizes to null', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const note = await mkNote(client, { title: 'Wishlist' })

      const set = async (icon: string | null) => {
        const res = await client.app.fetch(new Request(`http://local/api/vault/notes/${note.id}`, {
          method: 'PATCH', headers: client.auth, body: JSON.stringify({ icon }),
        }))
        expect(res.status).toBe(200)
        return ((await res.json()) as { note: Note }).note
      }

      const withIcon = await set('📚')
      expect(withIcon.icon).toBe('📚')
      // a ZWJ family emoji survives whole (multi-codepoint)
      const family = await set('👨‍👩‍👧‍👦')
      expect(family.icon).toBe('👨‍👩‍👧‍👦')
      // pasted sentences + control chars sanitize to null (no broken strings stored)
      expect((await set('hello world this is not an emoji')).icon).toBeNull()
      expect((await set('a\nb')).icon).toBeNull()
      // null clears
      const withIcon2 = await set('🎯')
      expect(withIcon2.icon).toBe('🎯')
      expect((await set(null)).icon).toBeNull()
      // the card list + full note both carry it
      const listed = await set('🎯')
      const cards = await listNotes(client)
      expect(cards.find((c) => c.id === listed.id)?.icon).toBe('🎯')
      const full = await client.app.fetch(new Request(`http://local/api/vault/notes/${listed.id}`, { headers: client.auth }))
      expect(((await full.json()) as { note: Note }).note.icon).toBe('🎯')
    } finally { close() }
  })

  it('folder icon: PATCH sets/clears and rides the bootstrap payload', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const folder = await mkFolder(client, 'Books')
      const res = await client.app.fetch(new Request(`http://local/api/vault/folders/${folder.id}`, {
        method: 'PATCH', headers: client.auth, body: JSON.stringify({ icon: '📕' }),
      }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { folder: Folder & { icon?: string | null } }).folder.icon).toBe('📕')
      const boot = await client.app.fetch(new Request('http://local/api/vault/bootstrap', { headers: client.auth }))
      const body = (await boot.json()) as { folders: (Folder & { icon?: string | null })[] }
      expect(body.folders.find((f) => f.id === folder.id)?.icon).toBe('📕')
      // clear
      const res2 = await client.app.fetch(new Request(`http://local/api/vault/folders/${folder.id}`, {
        method: 'PATCH', headers: client.auth, body: JSON.stringify({ icon: null }),
      }))
      expect(((await res2.json()) as { folder: Folder & { icon?: string | null } }).folder.icon).toBeNull()
    } finally { close() }
  })

  it('manual reorder: the sent ids renumber 0..n-1; others keep their order AFTER; updated_at untouched', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const a = await mkNote(client, { title: 'A' })
      const b = await mkNote(client, { title: 'B' })
      const c = await mkNote(client, { title: 'C' })
      const d = await mkNote(client, { title: 'D' })
      const before = new Map((await listNotes(client)).map((n) => [n.id, n.updated_at]))

      // drag C above A → order C, A, B, D
      const res = await client.app.fetch(new Request('http://local/api/vault/notes/reorder', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ ids: [c.id, a.id, b.id, d.id] }),
      }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { ok: boolean; moved: number }).moved).toBe(4)

      const manual = await listNotes(client, '?sort=manual')
      expect(manual.map((n) => n.title)).toEqual(['C', 'A', 'B', 'D'])
      // updated sorts are untouched by the drag (reorder ≠ edit)
      const after = new Map((await listNotes(client)).map((n) => [n.id, n.updated_at]))
      for (const [id, ts] of before) expect(after.get(id)).toBe(ts)

      // a PARTIAL payload (a filtered view) renumbers the sent block first and pushes
      // the rest after — the global rank stays coherent
      const res2 = await client.app.fetch(new Request('http://local/api/vault/notes/reorder', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ ids: [d.id, b.id] }),
      }))
      expect(res2.status).toBe(200)
      const manual2 = await listNotes(client, '?sort=manual')
      expect(manual2.map((n) => n.title)).toEqual(['D', 'B', 'C', 'A'])
    } finally { close() }
  })

  it('reorder: foreign/unknown ids are dropped silently; empty after filtering is a 400', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const other = await makeUser(db)
      const otherClient = await makeClient(db, other)
      const mine = await mkNote(client, { title: 'mine' })
      const theirs = await mkNote(otherClient, { title: 'theirs' })

      // my list, with a foreign id smuggled in — the foreign note is untouched, mine reorder
      const res = await client.app.fetch(new Request('http://local/api/vault/notes/reorder', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ ids: [theirs.id, mine.id] }),
      }))
      expect(res.status).toBe(200)
      const mineList = await listNotes(client, '?sort=manual')
      expect(mineList.map((n) => n.title)).toEqual(['mine'])
      const otherList = await listNotes(otherClient, '?sort=manual')
      expect(otherList.map((n) => n.title)).toEqual(['theirs'])

      // all-unknown → 400
      const res2 = await client.app.fetch(new Request('http://local/api/vault/notes/reorder', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ ids: ['00000000-0000-4000-8000-000000000000'] }),
      }))
      expect(res2.status).toBe(400)
      // invalid shape → 400
      const res3 = await client.app.fetch(new Request('http://local/api/vault/notes/reorder', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ ids: 'nope' }),
      }))
      expect(res3.status).toBe(400)
    } finally { close() }
  })

  it('manual sort is user-scoped: a second user ordering their notes never moves mine', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const other = await makeUser(db)
      const otherClient = await makeClient(db, other)
      const n1 = await mkNote(client, { title: 'x1' })
      const n2 = await mkNote(client, { title: 'x2' })
      const o1 = await mkNote(otherClient, { title: 'y1' })
      await otherClient.app.fetch(new Request('http://local/api/vault/notes/reorder', {
        method: 'POST', headers: otherClient.auth, body: JSON.stringify({ ids: [o1.id] }),
      }))
      const mine = await listNotes(client, '?sort=manual')
      expect(mine.map((n) => n.title).sort()).toEqual(['x1', 'x2'])
      expect(mine.find((n) => n.id === n1.id)).toBeTruthy()
      expect(mine.find((n) => n.id === n2.id)).toBeTruthy()
    } finally { close() }
  })
})
