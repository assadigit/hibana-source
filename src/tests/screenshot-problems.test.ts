import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config, Db } from '../types'

// S35: screenshots as UI/UX PROBLEM REPORTS — the note (caption) and the open/fixed
// state are PATCHable after upload, and the storage backend is pluggable (R2 when
// cfg.r2 is set, GitHub otherwise). These tests pin: the PATCH contract + rule 1,
// the R2 routing (uploads STOP going to GitHub), and the DELETE-with-remote-cleanup.

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeProject(db: Db, userId: string, status = 'spark'): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    [id, userId, 'Shot test', '', 'personal', status, '', new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

function jsonHeaders(token: string) {
  return { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
}

describe('screenshot problem reports (S35)', () => {
  it('PATCH edits the note and flips resolved — and back; the detail grid carries the state', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const app = createApp({ db, isProd: false, github: { owner: 'o', repo: 'r', token: 't' } } as unknown as Config)
      const token = await createSession(db, userId)
      // the GitHub fallback path: pushFile parses the Contents API shape
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

      const up = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, {
          method: 'POST',
          headers: jsonHeaders(token),
          body: JSON.stringify({ fileName: 'broken.png', mimeType: 'image/png', dataBase64: PNG_B64, caption: '' }),
        }),
      )
      expect(up.status).toBe(201)
      const { id } = (await up.json()) as { id: string }

      // default state: an OPEN problem
      let rows = await db.query<{ caption: string; resolved: number }>('SELECT caption, resolved FROM screenshots WHERE id = ?', [id])
      expect(rows[0].resolved).toBe(0)

      // write the note (what & where to work)
      const patch1 = await app.fetch(
        new Request(`http://local/api/screenshots/${id}`, {
          method: 'PATCH',
          headers: jsonHeaders(token),
          body: JSON.stringify({ caption: 'gallery padding is off — cards touch' }),
        }),
      )
      expect(patch1.status).toBe(200)
      // fix it
      await app.fetch(
        new Request(`http://local/api/screenshots/${id}`, { method: 'PATCH', headers: jsonHeaders(token), body: JSON.stringify({ resolved: 1 }) }),
      )
      rows = await db.query<{ caption: string; resolved: number }>('SELECT caption, resolved FROM screenshots WHERE id = ?', [id])
      expect(rows[0]).toEqual({ caption: 'gallery padding is off — cards touch', resolved: 1 })

      // the shared grid fragment renders the fixed state + the note
      const grid = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const html = await grid.text()
      expect(html).toContain('is-fixed')
      expect(html).toContain('gallery padding is off')

      // and back to open
      await app.fetch(
        new Request(`http://local/api/screenshots/${id}`, { method: 'PATCH', headers: jsonHeaders(token), body: JSON.stringify({ resolved: 0 }) }),
      )
      const openRows = await db.query<{ resolved: number }>('SELECT resolved FROM screenshots WHERE id = ?', [id])
      expect(openRows[0].resolved).toBe(0)
    } finally {
      close()
    }
  })

  it("rule 1: a foreign user cannot PATCH or DELETE another user's screenshot", async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const otherId = await makeUser(db, { email: 'other@test.dev' })
      const projectId = await makeProject(db, ownerId)
      const app = createApp({ db, isProd: false, github: { owner: 'o', repo: 'r', token: 't' } } as unknown as Config)
      const ownerToken = await createSession(db, ownerId)
      const otherToken = await createSession(db, otherId)
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

      const up = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, {
          method: 'POST',
          headers: jsonHeaders(ownerToken),
          body: JSON.stringify({ fileName: 'x.png', mimeType: 'image/png', dataBase64: PNG_B64 }),
        }),
      )
      const { id } = (await up.json()) as { id: string }

      const patch = await app.fetch(
        new Request(`http://local/api/screenshots/${id}`, { method: 'PATCH', headers: jsonHeaders(otherToken), body: JSON.stringify({ resolved: 1 }) }),
      )
      expect(patch.status).toBe(404)
      const del = await app.fetch(new Request(`http://local/api/screenshots/${id}`, { method: 'DELETE', headers: jsonHeaders(otherToken) }))
      expect(del.status).toBe(404)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM screenshots WHERE id = ?', [id])
      expect(rows[0].n).toBe(1) // untouched
    } finally {
      close()
    }
  })

  it('cfg.r2 set: uploads go to the R2 endpoint (NOT GitHub), reads and deletes too', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const app = createApp({
        db,
        isProd: false,
        github: { owner: 'o', repo: 'r', token: 't' },
        r2: { endpoint: 'http://localhost:9999', bucket: 'shots', accessKeyId: 'k', secretAccessKey: 's' },
      } as unknown as Config)
      const token = await createSession(db, userId)

      const seen: { url: string; method: string }[] = []
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), method: String(init?.method ?? 'GET') })
        if (String(input).startsWith('http://localhost:9999/')) {
          if (String(init?.method) === 'GET') return new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, { status: 200 })
          return new Response('', { status: 200 })
        }
        throw new Error('GitHub must NOT be called when cfg.r2 is set: ' + String(input))
      }) as typeof fetch)

      const up = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, {
          method: 'POST',
          headers: jsonHeaders(token),
          body: JSON.stringify({ fileName: 'broken.png', mimeType: 'image/png', dataBase64: PNG_B64, caption: 'note' }),
        }),
      )
      expect(up.status).toBe(201)
      const { id } = (await up.json()) as { id: string }
      expect(seen.some((s) => s.url.startsWith('http://localhost:9999/shots/') && s.method === 'PUT')).toBe(true)
      expect(seen.some((s) => s.url.includes('api.github.com'))).toBe(false)

      // the media route reads back through the SAME adapter
      const media = await app.fetch(new Request(`http://local/api/media/screenshots/${id}/file`, { headers: { Cookie: `hibana_session=${token}` } }))
      expect(media.status).toBe(200)
      expect(await media.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)

      // DELETE cleans the remote object too
      const del = await app.fetch(new Request(`http://local/api/screenshots/${id}`, { method: 'DELETE', headers: jsonHeaders(token) }))
      expect(del.status).toBe(200)
      expect(seen.some((s) => s.url.startsWith('http://localhost:9999/shots/') && s.method === 'DELETE')).toBe(true)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM screenshots')
      expect(rows[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('PATCH with neither field is a 400 (zod guard)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const app = createApp({ db, isProd: false, github: { owner: 'o', repo: 'r', token: 't' } } as unknown as Config)
      const token = await createSession(db, userId)
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      const res = await app.fetch(
        new Request(`http://local/api/screenshots/${crypto.randomUUID()}`, { method: 'PATCH', headers: jsonHeaders(token), body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(400)
    } finally {
      close()
    }
  })
})
