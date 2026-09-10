import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Profile picture (user request, spec §5.8 Account): the worker stores bytes in the GitHub
// assets repo (rule 8 — never in the DB) and D1 keeps `users.avatar_path`. These tests stub
// the GitHub API at the fetch boundary (same pattern as telegram.test.ts) and assert the
// auth boundary + Zod validation + per-user scoping (rule 1).

async function makeClient(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'o', repo: 'r', token: 'tok' },
    emailKey: undefined,
    assets: undefined,
  })
  return { app, auth: { Cookie: `hibana_session=${await createSession(db, userId)}`, 'Content-Type': 'application/json' } }
}

const cookie = (auth: Record<string, string>) => ({ Cookie: auth.Cookie ?? '' })
const PUT = (auth: Record<string, string>, body: unknown) =>
  new Request('http://local/api/settings/avatar', { method: 'PUT', headers: auth, body: JSON.stringify(body) })

// Stub the GitHub REST calls: PUT push → html_url; GET list → one avatar file; DELETE → ok;
// any other GET (raw file read) → the file body (string or raw bytes).
let deletedPaths: string[] = []
function stubGithub(body: string | Uint8Array, pushed: string[] = []): () => void {
  deletedPaths = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'PUT') {
      pushed.push(url.split('/contents/')[1])
      return new Response(JSON.stringify({ content: { html_url: 'https://github.com/x' } }), { status: 201 })
    }
    if (method === 'DELETE') { deletedPaths.push(url); return new Response('{}', { status: 200 }) }
    if (method === 'GET' && /\.png$/.test(url)) {
      // raw file read — keep bytes binary-safe (string or Uint8Array)
      const init: BodyInit = typeof body === 'string' ? body : (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
      return new Response(init, { status: 200 })
    }
    if (method === 'GET') {
      // a dir listing under /contents/avatars/<uid> reflects the avatar last pushed
      const last = pushed[pushed.length - 1]
      const entries = last ? [{ name: last.split('/').pop(), path: last, sha: 'sha1', type: 'file' }] : []
      return new Response(JSON.stringify(entries), { status: 200 })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
  return () => { globalThis.fetch = originalFetch }
}

describe('profile picture (settings.avatar)', () => {
  it('requires a session and rejects malformed input via Zod (rules 1 + 10)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)

      const noAuth = await app.fetch(PUT({ 'Content-Type': 'application/json' }, { mimeType: 'image/png', dataBase64: 'aGk=' }))
      expect(noAuth.status).toBe(401)

      expect((await app.fetch(PUT(auth, { mimeType: 'text/html', dataBase64: 'aGk=' }))).status).toBe(400)
      expect((await app.fetch(PUT(auth, { mimeType: 'image/png', dataBase64: 'x'.repeat(3_500_001) }))).status).toBe(400)
      expect((await app.fetch(PUT(auth, { mimeType: 'image/png', dataBase64: '' }))).status).toBe(400)
    } finally {
      close()
    }
  })

  it('upload stores a scoped path, serves it back, and replace/remove clear the old file (stubbed GitHub)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const pushed: string[] = []
      // Real binary bytes (PNG signature + non-ASCII values): serving must round-trip them
      // EXACTLY — text-decoding the GitHub raw response corrupts exactly these bytes.
      const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xfe, 0xff, 0x80, 0x7f])
      const restore = stubGithub(PNG_BYTES, pushed)

      const up1 = await app.fetch(PUT(auth, { mimeType: 'image/png', dataBase64: 'aGk=' }))
      expect(up1.status).toBe(200)
      const path1 = (await db.query<{ avatar_path: string | null }>('SELECT avatar_path FROM users WHERE id = ?', [userId]))[0].avatar_path
      expect(path1).toMatch(/^avatars\/.+\/avatar-.*\.png$/)

      // replace: the second upload must drop the first remote file
      const up2 = await app.fetch(PUT(auth, { mimeType: 'image/png', dataBase64: 'aGk=' }))
      expect(up2.status).toBe(200)
      const path2 = (await db.query<{ avatar_path: string | null }>('SELECT avatar_path FROM users WHERE id = ?', [userId]))[0].avatar_path
      expect(path2).not.toBe(path1)
      expect(deletedPaths.some((u) => u.includes(path1 as string))).toBe(true) // old file pruned by SHA

      const file = await app.fetch(new Request('http://local/api/settings/avatar/file', { headers: cookie(auth) }))
      expect(file.status).toBe(200)
      expect(file.headers.get('content-type')).toContain('image/png')
      // Byte-exact round-trip (regression: the old route text-decoded the raw response and
      // served corrupted bytes for any non-ASCII value → broken image).
      const served = new Uint8Array(await file.arrayBuffer())
      expect([...served]).toEqual([...PNG_BYTES])

      const me = await app.fetch(new Request('http://local/api/auth/me', { headers: cookie(auth) }))
      const meBody = (await me.json()) as { user: { avatar_path: string | null } }
      expect(meBody.user.avatar_path).toBe(path2) // publicUser exposes it for the nav chip

      const rm = await app.fetch(new Request('http://local/api/settings/avatar', { method: 'DELETE', headers: auth }))
      expect(rm.status).toBe(200)
      const after = await db.query<{ avatar_path: string | null }>('SELECT avatar_path FROM users WHERE id = ?', [userId])
      expect(after[0].avatar_path).toBeNull()
      expect(deletedPaths.some((u) => u.includes(path2 as string))).toBe(true)
      restore()
    } finally {
      close()
    }
  })

  it('avatar is user-scoped: another user cannot read your picture (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app, auth } = await makeClient(db, a)
      const pushed: string[] = []
      const restore = stubGithub('FAKEAVATAR', pushed)
      await app.fetch(PUT(auth, { mimeType: 'image/png', dataBase64: 'aGk=' }))

      const clientB = await makeClient(db, b)
      const other = await app.fetch(new Request('http://local/api/settings/avatar/file', { headers: cookie(clientB.auth) }))
      expect(other.status).toBe(404) // B has no avatar of their own
      restore()
    } finally {
      close()
    }
  })
})