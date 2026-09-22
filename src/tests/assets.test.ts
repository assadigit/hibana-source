import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Static-asset serving on the portability path. The Cloudflare assets binding serves files
// BEFORE the Worker's auth middleware (assets-first edge model), so login.html, css/js and
// the vendor libs are reachable unauthenticated — the Node file-serving path must mirror
// that. The assets-first middleware is registered before coreRoutes' global requireAuth
// wildcard, but must NEVER shadow authenticated API routes (rule 1 stays intact).
describe('static assets (portability path)', () => {
  // A fake assets fetcher standing in for serveFile/ASSETS: two files exist, everything
  // else 404s — exactly like a file lookup that misses.
  const fakeAssets =
    (files: string[]) =>
    (url: URL): Promise<Response> => {
      const p = url.pathname
      if (files.includes(p)) return Promise.resolve(new Response(`<body>${p}</body>`, { status: 200 }))
      return Promise.resolve(new Response('Not Found', { status: 404 }))
    }

  function makeApp(db: Db, files: string[]) {
    return createApp({
      db,
      isProd: false,
      github: { owner: 'x', repo: 'y', token: '' },
      emailKey: undefined,
      assets: fakeAssets(files),
    })
  }

  it('serves static files unauthenticated, before the auth wildcard', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db, ['/login.html', '/vendor/htmx.min.js', '/js/app.js'])

      const login = await app.fetch(new Request('http://local/login.html'))
      expect(login.status).toBe(200)

      const vendor = await app.fetch(new Request('http://local/vendor/htmx.min.js'))
      expect(vendor.status).toBe(200)
      expect(await vendor.text()).toContain('/vendor/htmx.min.js')
    } finally {
      close()
    }
  })

  it('does not mask API routes: unauthenticated calls still get 401, authenticated work', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = makeApp(db, ['/login.html'])

      // A GET that is not a static file falls through to the coreRoutes wildcard → 401.
      const unauth = await app.fetch(new Request('http://local/api/projects'))
      expect(unauth.status).toBe(401)

      // With a session, the same route works (assets middleware never short-circuits it).
      const token = await createSession(db, userId)
      const authed = await app.fetch(
        new Request('http://local/api/projects', { headers: { Cookie: `hibana_session=${token}` } }),
      )
      expect(authed.status).toBe(200)
    } finally {
      close()
    }
  })

  it('passes non-GET methods through unchanged (login POST still reaches auth routes)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db, ['/login.html'])
      const res = await app.fetch(
        new Request('http://local/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
          body: JSON.stringify({ login: 'nobody@test.dev', password: 'wrong' }),
        }),
      )
      // Handled by the auth route (registered before the assets middleware) — not a 200
      // static body, not a 401 from the wildcard, and not a 404 from the fake fetcher.
      expect(res.status).not.toBe(200)
      expect(res.status).not.toBe(404)
      expect(res.headers.get('content-type') || '').toContain('application/json')
    } finally {
      close()
    }
  })

  // S108 (v0.3.41.1): HTML served through the assets middleware is stamped no-store.
  // The Workers assets layer serves page HTML cacheable (extensionless pretty URLs never
  // matched the _headers /*.html rule) and revalidates lazily — a stale page references
  // dist hashes a newer build has purged → 404 stylesheets → "first opens render
  // unloaded". Worker-served + no-store closes the class at both legs (edge + browser).
  it('stamps no-store on HTML from the assets middleware (S108 stale-edge defense)', async () => {
    const { db, close } = makeTestDb()
    try {
      // A fake fetcher that mirrors the real binding: HTML pages carry the assets
      // default cache policy, css carries the versioned policy, and the binding itself
      // resolves the extensionless pretty URL to the page (html_handling=auto-trailing-
      // slash — verified live: /to-do-list serves sadhana.html bytes with _headers).
      const typedAssets =
        (files: string[]) =>
        (url: URL): Promise<Response> => {
          const p = url.pathname === '/notes' ? '/notes.html' : url.pathname
          if (!files.includes(p)) return Promise.resolve(new Response('Not Found', { status: 404 }))
          const type = p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.css') ? 'text/css' : 'application/javascript'
          return Promise.resolve(
            new Response('<html><body>x</body></html>', {
              status: 200,
              headers: { 'content-type': type, 'cache-control': 'public, max-age=0, must-revalidate' },
            }),
          )
        }
      const app = createApp({
        db,
        isProd: false,
        github: { owner: 'x', repo: 'y', token: '' },
        emailKey: undefined,
        assets: typedAssets(['/notes.html', '/css/notes.css']),
      })

      const page = await app.fetch(new Request('http://local/notes.html'))
      expect(page.status).toBe(200)
      expect(page.headers.get('content-type')).toContain('text/html')
      expect(page.headers.get('cache-control')).toBe('no-store')

      // The extensionless pretty URL serves the same file via the .html retry (Node path)
      // and gets the same stamp.
      const pretty = await app.fetch(new Request('http://local/notes'))
      expect(pretty.status).toBe(200)
      expect(pretty.headers.get('cache-control')).toBe('no-store')

      // Non-HTML keeps its own policy — the stamp must never touch css/js/vendor.
      const css = await app.fetch(new Request('http://local/css/notes.css'))
      expect(css.status).toBe(200)
      expect(css.headers.get('content-type')).toContain('text/css')
      expect(css.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    } finally {
      close()
    }
  })
})