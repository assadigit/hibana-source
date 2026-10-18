import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S205 (Kanban entry-point spec §3.1/§3.3): the dedicated /kanban page route.
//   /kanban            → auth-gated board.html (the /app pattern) with the login bounce
//                        preserving the FULL entry URL (?next=/kanban?project=…) so a
//                        bookmarked deep link survives an expired session.
//   /kanban.html       → 301 → /kanban (the /to-do-list.html canonical-URL pattern).
//   /kanban (JSON API) → 401 JSON for non-document callers (curl / future Go desktop
//                        client probing the URL) — never an HTML leak.
// The assets middleware must let BOTH paths fall through to their Worker routes
// (WORKER_PAGE_ROUTES) instead of answering the branded 404.
describe('GET /kanban — the dedicated Kanban entry point', () => {
  // A fake assets fetcher standing in for serveFile/ASSETS: board.html exists, everything
  // else 404s — exactly the live shape (there is no kanban.html file on disk; the route
  // serves board.html BY DESIGN — one file, one cache-bust surface, zero duplication).
  const fakeAssets = (files: string[]) => (url: URL): Promise<Response> => {
    const p = url.pathname
    if (files.includes(p)) return Promise.resolve(new Response('<!doctype html><title>board</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    return Promise.resolve(new Response('Not Found', { status: 404 }))
  }

  function makeApp(db: Db, files: string[] = ['/board.html']) {
    return createApp({
      db,
      isProd: false,
      github: { owner: 'x', repo: 'y', token: '' },
      emailKey: undefined,
      assets: fakeAssets(files),
    })
  }

  const DOC_HEADERS = { 'Sec-Fetch-Dest': 'document', Accept: 'text/html' }
  const AUTH_HEADERS = (token: string) => ({ Cookie: `__Host-hibana_session=${token}` })

  it('serves board.html to an authenticated document navigation', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      const app = makeApp(db)

      const res = await app.fetch(new Request('http://local/kanban', { headers: { ...DOC_HEADERS, ...AUTH_HEADERS(token) } }))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')?.includes('text/html')).toBe(true)
      expect(await res.text()).toContain('board')
    } finally {
      close()
    }
  })

  it('preserves the full entry URL in the login bounce (?next=)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db)

      // No session: a document navigation bounces to login WITH the entry URL.
      const res = await app.fetch(new Request('http://local/kanban?project=abc', { headers: DOC_HEADERS }))
      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc.startsWith('/login.html?next=')).toBe(true)
      // The query is URL-encoded verbatim — safeNext (hib-init.js) accepts exactly this shape.
      expect(decodeURIComponent(loc.split('next=')[1] ?? '')).toBe('/kanban?project=abc')

      // Expired session: the same contract (the expired branch carries next too).
      // A session row past its 30-day lifetime is inserted directly — createSession
      // always mints a fresh 30-day window.
      const userId = await makeUser(db)
      const stale = await createSession(db, userId)
      const staleId = await (await import('../auth/sessions')).sessionHash(stale)
      await db.execute('UPDATE sessions SET expires_at = ? WHERE id = ?', [
        new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        staleId,
      ])
      const res2 = await app.fetch(new Request('http://local/kanban', { headers: { ...DOC_HEADERS, ...AUTH_HEADERS(stale) } }))
      expect(res2.status).toBe(302)
      expect(decodeURIComponent((res2.headers.get('location') ?? '').split('next=')[1] ?? '')).toBe('/kanban')
    } finally {
      close()
    }
  })

  it('answers 401 JSON (never HTML) to non-document callers', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db)
      const res = await app.fetch(new Request('http://local/kanban'))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    } finally {
      close()
    }
  })

  it('301s /kanban.html to the canonical /kanban (unauthenticated — the /to-do-list.html pattern)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db)
      const res = await app.fetch(new Request('http://local/kanban.html'))
      expect(res.status).toBe(301)
      expect(res.headers.get('location')).toBe('/kanban')
    } finally {
      close()
    }
  })

  it('the assets middleware falls /kanban through to its Worker route (no branded 404)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      // board.html EXISTS as a file, kanban.html does NOT — the binding 404s /kanban,
      // WORKER_PAGE_ROUTES must catch it and let the route serve board.html.
      const app = makeApp(db, ['/board.html'])

      const res = await app.fetch(new Request('http://local/kanban', { headers: { ...DOC_HEADERS, ...AUTH_HEADERS(token) } }))
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('board')
    } finally {
      close()
    }
  })

  it('stamps Worker-served /kanban HTML no-store (the S108 page-freshness contract)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      const app = makeApp(db)

      const res = await app.fetch(new Request('http://local/kanban', { headers: { ...DOC_HEADERS, ...AUTH_HEADERS(token) } }))
      // The assets middleware stamps HTML no-store as it passes through (app.ts
      // stampHtmlNoStore) — /kanban rides the same guarantee as every Worker-served page.
      expect(res.headers.get('cache-control')).toBe('no-store')
    } finally {
      close()
    }
  })

  it('serves deep-link queries untouched (?task= / ?add= ride through to board-page.js)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      const app = makeApp(db)

      // The route never parses or rewrites the query — the response body is the plain
      // board.html shell whatever the query carries (board-page.js consumes ?project/
      // ?task/?add client-side). Any 2xx here IS the untouched passthrough.
      const res = await app.fetch(
        new Request('http://local/kanban?project=p1&task=t1&add=bug', { headers: { ...DOC_HEADERS, ...AUTH_HEADERS(token) } }),
      )
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('board')
    } finally {
      close()
    }
  })
})
