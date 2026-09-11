import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Session-9 F1 (2026-09-14): the screenshot upload path REGRESSION test.
// assetPath() used to build `/${user}/${project}/screenshots/…` — the GitHub
// Contents API 422s on "path cannot start with a slash", pushFile() threw, and
// EVERY upload died as 500 internal_error. Prod evidence: screenshots table 0 rows
// ever, error_log 0 entries (feature never used), hibana-safe repo 0 screenshot
// paths. This test pins the path shape end-to-end through the real route so a
// leading slash (or any other API-illegal shape) can never silently return.

// Tiny valid PNG (1×1) as base64 — under every size cap, decodable, real bytes.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeProject(db: Db, userId: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    [id, userId, 'Shot test', '', 'personal', 'spark', '', new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

describe('screenshot upload path shape (session-9 F1)', () => {
  it('pushes to GitHub with NO leading slash — Contents API-legal path, 201 response', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const app = createApp({
        db,
        isProd: false,
        github: { owner: 'testowner', repo: 'testrepo', token: 't' },
        emailKey: undefined,
        assets: undefined,
      })
      const token = await createSession(db, userId)

      // Capture the Contents API PUT: URL + body, and answer like GitHub would (201).
      const puts: { url: string; body: { message: string; content: string } }[] = []
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith('https://api.github.com/repos/testowner/testrepo/contents/')) {
          puts.push({ url, body: JSON.parse(String(init?.body)) })
          return new Response(
            JSON.stringify({ content: { html_url: 'https://github.com/testowner/testrepo/blob/main/x' } }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('{}', { status: 200 })
      }) as typeof fetch)

      const res = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, {
          method: 'POST',
          headers: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' },
          body: JSON.stringify({ fileName: 'shot.png', mimeType: 'image/png', dataBase64: PNG_B64, caption: 'regression pin' }),
        }),
      )

      // The historic bug: pushFile throws on the 422 → route 500s and no row lands.
      expect(res.status).toBe(201)
      const body = (await res.json()) as { ok: boolean; id: string }
      expect(body.ok).toBe(true)

      // THE PIN — the pushed URL must be `…/contents/<user>/<project>/screenshots/<file>`,
      // never `…/contents//<user>/…` (leading slash) — GitHub 422s that shape.
      expect(puts).toHaveLength(1)
      const path = puts[0].url.replace('https://api.github.com/repos/testowner/testrepo/contents/', '')
      expect(path.startsWith('/')).toBe(false) // the regression: this WAS true
      expect(path.startsWith('//')).toBe(false)
      expect(path).toMatch(/^[0-9a-f-]+\/[0-9a-f-]+\/screenshots\/.+\.png$/)
      // The repo-relative path never double-slashes when joined onto the API base.
      expect(puts[0].url).not.toContain('/contents//')

      // DB row carries the same slash-free shape (the media route reads it back with
      // the identical string — a mismatched stored path would 404 every image).
      const rows = await db.query<{ github_path: string }>('SELECT github_path FROM screenshots WHERE project_id = ?', [projectId])
      expect(rows).toHaveLength(1)
      expect(rows[0].github_path).toBe(path)
      expect(rows[0].github_path.startsWith('/')).toBe(false)
    } finally {
      close()
    }
  })

  it('a leading-slash path shape would surface as a 500 — the offline queue and the #shots refresh depend on 2xx here', async () => {
    // Mirror of the failure mode the fix removed (documents the F16 dependency):
    // the project page only refreshes the gallery when res.ok — a 500 means the
    // upload toast says "failed" and the grid never re-renders. This test asserts
    // the happy path stays 201 with a well-formed path even when the client id is
    // supplied by the caller (queue replay shape).
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const projectId = await makeProject(db, userId)
      const app = createApp({
        db,
        isProd: false,
        github: { owner: 'o', repo: 'r', token: 't' },
        emailKey: undefined,
        assets: undefined,
      })
      const token = await createSession(db, userId)
      const clientId = crypto.randomUUID()

      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/contents/')) {
          expect(url).not.toContain('/contents//') // the pin again, on the replay path
          return new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201 })
        }
        return new Response('{}', { status: 200 })
      }) as typeof fetch)

      const res = await app.fetch(
        new Request(`http://local/api/projects/${projectId}/screenshots`, {
          method: 'POST',
          headers: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' },
          body: JSON.stringify({ id: clientId, fileName: 're play.jpeg', mimeType: 'image/jpeg', dataBase64: PNG_B64 }),
        }),
      )
      expect(res.status).toBe(201)
      // Sanitization contract unchanged: only \w . - and space survive; the path
      // shape stays Contents-API-legal either way.
      const rows = await db.query<{ github_path: string }>('SELECT github_path FROM screenshots WHERE id = ?', [clientId])
      expect(rows[0].github_path).toBe(`${userId}/${projectId}/screenshots/${clientId}-re play.jpeg`)
    } finally {
      close()
    }
  })
})
