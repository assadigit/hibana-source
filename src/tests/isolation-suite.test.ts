import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Phase 1 (PLAYBOOK §5 — M1): the exhaustive cross-user isolation suite, Node-runtime
// side (the Workers/D1 side is scripts/workers-smoke.mjs Test 5 — together they are the
// "passes on both runtimes" milestone). Covers the gaps the P1-a audit found untested:
// search groups beyond projects (the whole-body scan covers ALL groups at once),
// hurdle/link BY-ID routes, the screenshot FILE byte route, trash purge, the admin
// member-403 matrix, and the Telegram same-chat relink (H5).
//
// Shape: B seeds one marker ("ISOSECRET") into every user-owned surface via the real
// API; A then attacks each surface. The marker must never cross. B's own reads are the
// positive controls (the data exists and is reachable by its owner).

const MARK = 'ISOSECRET'

async function makeClient(db: Db, userId: string, over: Record<string, unknown> = {}) {
  const app = createApp({
    db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined, ...over,
  })
  const token = await createSession(db, userId)
  const auth = { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
  return { app, auth }
}

const req = (app: ReturnType<typeof createApp>, method: string, path: string, auth: Record<string, string>, body?: unknown) =>
  app.fetch(new Request('http://local' + path, {
    method,
    headers: auth,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }))

afterEach(() => vi.unstubAllGlobals())

describe('cross-user isolation suite (M1, Node runtime)', () => {
  it('every surface seeded by B stays invisible to A — search, by-id routes, file bytes, trash, admin', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db, { role: 'member' })
      const b = await makeUser(db, { role: 'member' })
      const { app: appB, auth: authB } = await makeClient(db, b)
      const { app: appA, auth: authA } = await makeClient(db, a)

      // ---- B seeds every surface via the real API ----
      let res = await req(appB, 'POST', '/api/projects', authB, { title: `${MARK} fortress`, status: 'planning' })
      expect(res.status).toBe(201)
      const bProject = (await res.json()) as { id: string }

      res = await req(appB, 'POST', '/api/notes', authB, { content: `${MARK} quicknote` })
      expect(res.status).toBe(201)

      res = await req(appB, 'POST', '/api/vault/notes', authB, { title: `${MARK} vault`, content: 'x' })
      expect(res.status).toBe(201)

      res = await req(appB, 'POST', '/api/sadhana/tasks', authB, { title: `${MARK} sadhana`, quadrant: 1 })
      expect(res.status).toBe(201)

      res = await req(appB, 'POST', `/api/projects/${bProject.id}/devtasks`, authB, { title: `${MARK} devtask` })
      expect(res.status).toBe(201)

      res = await req(appB, 'POST', `/api/projects/${bProject.id}/hurdles`, authB, { text: `${MARK} hurdle` })
      expect(res.status).toBe(201)
      const hurdles = await db.query<{ id: string }>('SELECT id FROM hurdles WHERE project_id = ?', [bProject.id])
      const bHurdleId = hurdles[0]!.id

      res = await req(appB, 'POST', `/api/projects/${bProject.id}/links`, authB, { label: `${MARK} link`, url: 'https://isosecret.example/x' })
      expect(res.status).toBe(201)
      const links = await db.query<{ id: string }>('SELECT id FROM links WHERE project_id = ?', [bProject.id])
      const bLinkId = links[0]!.id

      res = await req(appB, 'POST', '/api/canvas/sync', authB, {
        elements: [{ id: crypto.randomUUID(), type: 'note', x: 1, y: 2, content: `${MARK} canvas`, updated_at: new Date().toISOString() }],
      })
      expect(res.status).toBe(200)

      // screenshot row on B's project (bytes never fetched in these tests — the route
      // gates on ownership BEFORE any storage read)
      const bShotId = crypto.randomUUID()
      await db.execute(
        'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, 8, ?, ?)',
        [bShotId, bProject.id, `u-b/${bProject.id}/screenshots/${bShotId}-s.png`, 'image/png', '', 's.png', new Date().toISOString()],
      )

      // ---- A attacks every read surface ----
      // search: the whole response body must not carry the marker in ANY group
      res = await req(appA, 'GET', `/api/search?q=${MARK}`, authA)
      expect(res.status).toBe(200)
      const aSearch = await res.text()
      expect(aSearch).not.toContain(MARK)

      // positive control: B's own search finds the marker (the data IS searchable)
      res = await req(appB, 'GET', `/api/search?q=${MARK}`, authB)
      expect(await res.text()).toContain(MARK)

      // project by id + children lists
      res = await req(appA, 'GET', `/api/projects/${bProject.id}`, authA)
      expect(res.status).toBe(404)
      res = await req(appA, 'GET', `/api/projects/${bProject.id}/hurdles`, authA)
      expect(res.status).toBe(404)
      res = await req(appA, 'GET', `/api/projects/${bProject.id}/links`, authA)
      expect(res.status).toBe(404)
      res = await req(appA, 'GET', `/api/projects/${bProject.id}/screenshots`, authA)
      expect(res.status).toBe(404)

      // hurdle / link BY-ID routes (the gap P1-a flagged: only via-project was tested)
      res = await req(appA, 'PATCH', `/api/hurdles/${bHurdleId}`, authA, { text: 'hacked' })
      expect(res.status).toBe(404)
      res = await req(appA, 'DELETE', `/api/hurdles/${bHurdleId}`, authA)
      expect(res.status).toBe(404)
      res = await req(appA, 'PATCH', `/api/links/${bLinkId}`, authA, { label: 'hacked' })
      expect(res.status).toBe(404)
      res = await req(appA, 'DELETE', `/api/links/${bLinkId}`, authA)
      expect(res.status).toBe(404)
      // DATA INTEGRITY (the truth regardless of response codes): B's rows were neither
      // modified nor deleted by any of A's attempts.
      const bHurdle = await db.query<{ text: string }>('SELECT text FROM hurdles WHERE id = ?', [bHurdleId])
      expect(bHurdle[0]!.text).toBe(`${MARK} hurdle`)
      const bLink = await db.query<{ label: string }>('SELECT label FROM links WHERE id = ?', [bLinkId])
      expect(bLink[0]!.label).toBe(`${MARK} link`)

      // the screenshot FILE byte route — auth + ownership before any store read
      res = await req(appA, 'GET', `/api/media/screenshots/${bShotId}/file`, authA)
      expect(res.status).toBe(404)
      res = await req(appA, 'GET', `/api/media/screenshots/${bShotId}/file?variant=thumb`, authA)
      expect(res.status).toBe(404)

      // A's export never contains B's marker
      res = await req(appA, 'GET', '/api/export?format=json', authA)
      expect(res.status).toBe(200)
      expect(await res.text()).not.toContain(MARK)

      // ---- trash purge: A emptying A's trash never purges B's soft-deleted rows ----
      res = await req(appB, 'DELETE', `/api/projects/${bProject.id}`, authB)
      expect(res.status).toBe(200)
      res = await req(appA, 'POST', '/api/settings/trash/empty', authA)
      expect(res.status).toBe(200)
      const bRow = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects WHERE id = ?', [bProject.id])
      expect(bRow[0]!.n).toBe(1) // B's soft-deleted row survived A's purge

      // ---- admin routes: a member is refused everywhere (the P1-a untested set) ----
      const adminPaths: [string, string][] = [
        ['GET', '/api/admin/users'],
        ['GET', '/api/admin/emails'],
        ['POST', '/api/admin/email'],
        ['POST', '/api/admin/email/broadcast'],
        ['GET', '/api/admin/backup/status'],
        ['GET', '/api/admin/backup/download'],
        ['POST', '/api/admin/backup'],
        ['GET', '/api/admin/errors'],
        ['POST', '/api/admin/purge'],
      ]
      for (const [method, path] of adminPaths) {
        const r = await req(appA, method, path, authA, method === 'POST' ? {} : undefined)
        expect(`${method} ${path} → ${r.status}`).toBe(`${method} ${path} → 403`)
      }
    } finally {
      close()
    }
  })

  it('Telegram: a same-chat relink (H5) moves the chat to the NEW user and clears the old — never both', async () => {
    const { db, close } = makeTestDb()
    // Stub the outbound Telegram API (the /start reply) so the test needs no network.
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch)
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['9001', a]) // A currently owns chat 9001
      const { app, auth: authB } = await makeClient(db, b, { telegramToken: 'test-bot-token', telegramSecret: 'wxyz-secret' })

      // B requests a link code as the authenticated user
      let res = await req(app, 'POST', '/api/telegram/link-code', authB)
      expect(res.status).toBe(200)
      const { code } = (await res.json()) as { code: string }
      expect(code).toMatch(/^[0-9a-f]{12}$/)

      // chat 9001 sends /start with B's code — the H5 flow must clear A and bind B
      res = await app.fetch(new Request('http://local/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
        body: JSON.stringify({ message: { chat: { id: 9001 }, from: { id: 9001 }, text: `/start ${code}` } }),
      }))
      expect(res.status).toBe(200)

      const rows = await db.query<{ id: string; chat: string | null }>('SELECT id, telegram_chat_id AS chat FROM users WHERE id IN (?, ?)', [a, b])
      const byUser = new Map(rows.map((r) => [r.id, r.chat]))
      expect(byUser.get(a)).toBeNull() // the prior holder was cleared — B's link cannot steal INTO A, and A keeps no stale access to B's captures
      expect(byUser.get(b)).toBe('9001') // the new holder owns the chat

      // the code is single-use: replaying it binds nobody
      res = await app.fetch(new Request('http://local/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
        body: JSON.stringify({ message: { chat: { id: 4242 }, from: { id: 4242 }, text: `/start ${code}` } }),
      }))
      expect(res.status).toBe(200)
      const rows2 = await db.query<{ id: string; chat: string | null }>('SELECT id, telegram_chat_id AS chat FROM users WHERE id IN (?, ?)', [a, b])
      const byUser2 = new Map(rows2.map((r) => [r.id, r.chat]))
      expect(byUser2.get(b)).toBe('9001') // unchanged
      const c4242 = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE telegram_chat_id = '4242'")
      expect(c4242[0]!.n).toBe(0) // the replayed code linked no one
    } finally {
      close()
    }
  })
})
