import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config, Db } from '../types'

// S39 (user request 2026-09-13): two asks pinned here.
//   1. THE MEDIA GALLERY — GET /api/media lists EVERY picture the user owns across
//      projects (rule 1 via the projects join) with its project + pin + the 0054
//      bytes column summed into totalBytes; uploads now record their true size.
//   2. STICKING SHOTS TO PROGRESS-BOX ITEMS — PATCH /api/screenshots/:id {taskId}
//      pins (uuid) / unpins ('' or null); the task must belong to the SAME project
//      AND the caller; the shared grid + the project board render the pin.

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeProject(db: Db, userId: string, title = 'S39 test project', status = 'spark'): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    [id, userId, title, '', 'personal', status, '', new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

async function makeTask(db: Db, projectId: string, title: string, status: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    "INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at) VALUES (?, ?, ?, ?, 'medium', 0, ?)",
    [id, projectId, title, status, new Date().toISOString()],
  )
  return id
}

function jsonHeaders(token: string) {
  return { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
}

const testApp = (db: Db, extra: Record<string, unknown> = {}) =>
  createApp({ db, isProd: false, github: { owner: 'o', repo: 'r', token: 't' }, ...extra } as unknown as Config)

async function uploadShot(app: ReturnType<typeof testApp>, token: string, projectId: string): Promise<string> {
  const up = await app.fetch(
    new Request(`http://local/api/projects/${projectId}/screenshots`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ fileName: 'broken.png', mimeType: 'image/png', dataBase64: PNG_B64, caption: '' }),
    }),
  )
  expect(up.status).toBe(201)
  return ((await up.json()) as { id: string }).id
}

describe('S39: sticking screenshots to progress-box items', () => {
  it('PATCH taskId pins + unpins; the shared grid + the project board render the pin', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const taskId = await makeTask(db, projectId, 'Dashboard cards overlap at 390px', 'bug')
      const app = testApp(db)
      const token = await createSession(db, userId)
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

      const shotId = await uploadShot(app, token, projectId)

      // pin it to the Problems-box item
      const pin = await app.fetch(
        new Request(`http://local/api/screenshots/${shotId}`, { method: 'PATCH', headers: jsonHeaders(token), body: JSON.stringify({ taskId }) }),
      )
      expect(pin.status).toBe(200)
      let rows = await db.query<{ task_id: string | null }>('SELECT task_id FROM screenshots WHERE id = ?', [shotId])
      expect(rows[0].task_id).toBe(taskId)

      // the shared grid fragment says WHICH box + item (the categorization)
      const grid = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const gridHtml = await grid.text()
      expect(gridHtml).toContain('shot-pin')
      expect(gridHtml).toContain('Problems')
      expect(gridHtml).toContain('Dashboard cards overlap at 390px')
      expect(gridHtml).toContain(`data-shot-unpin="${shotId}"`)

      // the project detail fragment carries the 📌 badge on the task card + Problems tab row
      const detail = await app.fetch(
        new Request(`http://local/api/projects/${projectId}`, { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const detailHtml = await detail.text()
      expect(detailHtml).toContain(`data-pd-shots="${taskId}"`)

      // unpin via the empty-string form (the picker's ✕ row) — the picture survives
      const unpin = await app.fetch(
        new Request(`http://local/api/screenshots/${shotId}`, { method: 'PATCH', headers: jsonHeaders(token), body: JSON.stringify({ taskId: '' }) }),
      )
      expect(unpin.status).toBe(200)
      rows = await db.query<{ task_id: string | null }>('SELECT task_id FROM screenshots WHERE id = ?', [shotId])
      expect(rows[0].task_id).toBeNull()

      const grid2 = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      // NB: the pin BUTTON (data-shot-pin) always exists — the pin LINE (class="shot-pin")
      // is what disappears.
      expect(await grid2.text()).not.toContain('class="shot-pin"')
    } finally {
      close()
    }
  })

  it('a task from ANOTHER project (or another user) can never be pinned — 404, row untouched', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const otherId = await makeUser(db, { email: 'other@test.dev' })
      const projectA = await makeProject(db, ownerId, 'project A')
      const projectB = await makeProject(db, ownerId, 'project B')
      const foreignProject = await makeProject(db, otherId, 'foreign project')
      const taskB = await makeTask(db, projectB, 'task in another project', 'bug')
      const foreignTask = await makeTask(db, foreignProject, 'someone else task', 'bug')
      const app = testApp(db)
      const ownerToken = await createSession(db, ownerId)
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

      const shotId = await uploadShot(app, ownerToken, projectA)
      const cross = await app.fetch(
        new Request(`http://local/api/screenshots/${shotId}`, { method: 'PATCH', headers: jsonHeaders(ownerToken), body: JSON.stringify({ taskId: taskB }) }),
      )
      expect(cross.status).toBe(404)
      expect(await cross.json()).toEqual({ error: 'task_not_found' })
      const foreign = await app.fetch(
        new Request(`http://local/api/screenshots/${shotId}`, { method: 'PATCH', headers: jsonHeaders(ownerToken), body: JSON.stringify({ taskId: foreignTask }) }),
      )
      expect(foreign.status).toBe(404)
      const rows = await db.query<{ task_id: string | null }>('SELECT task_id FROM screenshots WHERE id = ?', [shotId])
      expect(rows[0].task_id).toBeNull()
    } finally {
      close()
    }
  })
})

describe('S39: the media gallery (GET /api/media)', () => {
  it('lists every picture of the CALLER only, with project + pin + size; uploads record bytes', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const otherId = await makeUser(db, { email: 'other@test.dev' })
      const projectA = await makeProject(db, ownerId, 'Hibana redesign')
      const projectB = await makeProject(db, ownerId, 'Sedanama shop')
      const taskB = await makeTask(db, projectA, 'Checkout button misaligned', 'bug')
      const app = testApp(db)
      const ownerToken = await createSession(db, ownerId)
      const otherToken = await createSession(db, otherId)
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

      const shotA = await uploadShot(app, ownerToken, projectA)
      const shotB = await uploadShot(app, ownerToken, projectB)
      await uploadShot(app, otherToken, await makeProject(db, otherId, 'other project'))
      await app.fetch(
        new Request(`http://local/api/screenshots/${shotA}`, { method: 'PATCH', headers: jsonHeaders(ownerToken), body: JSON.stringify({ taskId: taskB }) }),
      )

      const media = await app.fetch(new Request('http://local/api/media', { headers: { Cookie: `hibana_session=${ownerToken}` } }))
      expect(media.status).toBe(200)
      const body = (await media.json()) as {
        screenshots: Array<{ id: string; project_title: string; task_title: string | null; task_status: string | null; bytes: number }>
        count: number
        totalBytes: number
      }
      expect(body.count).toBe(2)
      expect(body.screenshots.map((s) => s.id).sort()).toEqual([shotA, shotB].sort())
      const pinned = body.screenshots.find((s) => s.id === shotA)!
      expect(pinned.project_title).toBe('Hibana redesign')
      expect(pinned.task_title).toBe('Checkout button misaligned')
      expect(pinned.task_status).toBe('bug')

      // the 0054 bytes column: exact decoded size (base64 without padding × 3/4)
      const expectedBytes = Math.floor(PNG_B64.replace(/=+$/, '').length * 3 / 4)
      expect(pinned.bytes).toBe(expectedBytes)
      expect(body.totalBytes).toBe(expectedBytes * 2)
    } finally {
      close()
    }
  })

  it('legacy rows (bytes=0) self-heal their size on the first media-file view', async () => {
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

      // raw 7-byte object; the row is inserted DIRECTLY with bytes=0 (a pre-0054 row)
      const shotId = crypto.randomUUID()
      const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('http://localhost:9999/') && String(init?.method) === 'GET') {
          return new Response(payload as unknown as BodyInit, { status: 200 })
        }
        return new Response('', { status: 200 })
      }) as typeof fetch)
      await db.execute(
        "INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, 'image/png', '', 0, NULL, 0, ?)",
        [shotId, projectId, `u/${shotId}.png`, new Date().toISOString()],
      )

      const file = await app.fetch(new Request(`http://local/api/media/screenshots/${shotId}/file`, { headers: { Cookie: `hibana_session=${token}` } }))
      expect(file.status).toBe(200)
      const rows = await db.query<{ bytes: number }>('SELECT bytes FROM screenshots WHERE id = ?', [shotId])
      expect(rows[0].bytes).toBe(7) // self-healed — the gallery meter goes honest

      const media = await app.fetch(new Request('http://local/api/media', { headers: { Cookie: `hibana_session=${token}` } }))
      const body = (await media.json()) as { totalBytes: number }
      expect(body.totalBytes).toBe(7)
    } finally {
      close()
    }
  })
})

// S115 (owner: "the gallery must have a Delete All — Cloudflare's free host can't
// pile up hundreds or thousands of documents"): DELETE /api/media/screenshots purges
// EVERY media row the caller owns (rule 1 via the projects join — the same scope as
// GET /api/media), other users' rows survive, and the response reports the count.
describe('S115: gallery DELETE-ALL', () => {
  it('deletes every owned screenshot in one call; other users keep theirs', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const otherId = await makeUser(db, { email: 'other-s115@test.dev' })
      const projectA = await makeProject(db, ownerId, 'owner project A')
      const projectB = await makeProject(db, ownerId, 'owner project B')
      const foreignProject = await makeProject(db, otherId, 'foreign project')
      const app = testApp(db)
      const ownerToken = await createSession(db, ownerId)
      const otherToken = await createSession(db, otherId)
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

      const a1 = await uploadShot(app, ownerToken, projectA)
      const a2 = await uploadShot(app, ownerToken, projectB)
      const f1 = await uploadShot(app, otherToken, foreignProject)

      const del = await app.fetch(new Request('http://local/api/media/screenshots', { method: 'DELETE', headers: { Cookie: `hibana_session=${ownerToken}`, Origin: 'http://local' } }))
      expect(del.status).toBe(200)
      const body = (await del.json()) as { ok: boolean; deleted: number }
      expect(body.ok).toBe(true)
      expect(body.deleted).toBe(2)

      const gone = await db.query<{ id: string }>('SELECT id FROM screenshots WHERE id IN (?, ?)', [a1, a2])
      expect(gone.length).toBe(0)
      const survivor = await db.query<{ id: string }>('SELECT id FROM screenshots WHERE id = ?', [f1])
      expect(survivor.length).toBe(1)

      // the caller's gallery is empty now; the other user's is untouched
      const mine = await app.fetch(new Request('http://local/api/media', { headers: { Cookie: `hibana_session=${ownerToken}` } }))
      expect(((await mine.json()) as { count: number }).count).toBe(0)
      const theirs = await app.fetch(new Request('http://local/api/media', { headers: { Cookie: `hibana_session=${otherToken}` } }))
      expect(((await theirs.json()) as { count: number }).count).toBe(1)

      // a second call on an empty gallery is a cheap ok (no rows, no work)
      const again = await app.fetch(new Request('http://local/api/media/screenshots', { method: 'DELETE', headers: { Cookie: `hibana_session=${ownerToken}`, Origin: 'http://local' } }))
      expect(again.status).toBe(200)
      expect(((await again.json()) as { deleted: number }).deleted).toBe(0)
    } finally {
      close()
    }
  })
})

// S116 (CI evidence): a screenshot row whose STORED OBJECT is gone (a purged KV
// entry, an expired storage backend, a stale local-e2e DB) used to surface as an
// unhandled storage-error 500 via app.onError — the gallery tile got a console
// error and nothing else. The route now degrades to the SAME 404 a missing row
// speaks, for both the original and the ?variant=thumb path (a missing thumb still
// falls back to the original; a missing ORIGINAL is the honest 404).
describe('S116: a missing stored object degrades to 404, never 500', () => {
  it('GET file → 404 when the object read throws (original + thumb variant)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const app = testApp(db)
      const token = await createSession(db, userId)
      // The upload succeeds (the write path is stubbed ok)…
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      const shotId = await uploadShot(app, token, projectId)

      // …then the storage backend goes away (every read throws — the ENOENT class).
      vi.stubGlobal('fetch', async () => { throw new Error('ENOENT: no such file or directory') })

      const orig = await app.fetch(new Request(`http://local/api/media/screenshots/${shotId}/file`, { headers: { Cookie: `hibana_session=${token}` } }))
      expect(orig.status).toBe(404)
      expect(((await orig.json()) as { error: string }).error).toBe('not_found')

      const thumb = await app.fetch(new Request(`http://local/api/media/screenshots/${shotId}/file?variant=thumb`, { headers: { Cookie: `hibana_session=${token}` } }))
      expect(thumb.status).toBe(404)

      // the row SURVIVES (the gallery still lists it; cleanup is the owner's job)
      const list = await app.fetch(new Request('http://local/api/media', { headers: { Cookie: `hibana_session=${token}` } }))
      expect(((await list.json()) as { count: number }).count).toBe(1)
    } finally {
      close()
    }
  })
})
