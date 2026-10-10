import { describe, it, expect } from 'vitest'
import { makeTestDb } from './helpers'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S196 (Track A coverage-gap audit): GET /api/nav had zero unit coverage. The route
// is small but load-bearing: it exists BECAUSE the CF edge cached the static
// /partials/nav.html URL past deploys (S72 — a stale-topbar incident class), so its
// contract is exactly the cache-bypass shape:
//   1. serves the partial's bytes through the API path (200, real markup, not the 404
//      the static path degenerates to);
//   2. no-store — never the edge, never the browser cache, never a stale topbar;
//   3. when the assets binding misses the partial (a broken deploy), a clean 404 —
//      not a 500 or a mojibake body;
//   4. public by design (zero user data — the account chip hydrates via /api/auth/me),
//      matching the static partial it replaced.

// A fake assets fetcher standing in for serveFile/ASSETS: /partials/nav.html exists,
// everything else 404s — exactly like a file lookup that misses.
const fakeAssets =
  (files: string[], body = '<nav id="rail">chrome</nav>') =>
  (url: URL): Promise<Response> => {
    if (files.includes(url.pathname)) return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } }))
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

describe('GET /api/nav (S196 coverage-gap close — the S72 edge-cache-proof chrome route)', () => {
  it('serves the partial 200 with no-store and the real markup — unauthenticated, by design', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db, ['/partials/nav.html'])
      const res = await app.fetch(new Request('http://local/api/nav'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Content-Type')).toContain('text/html')
      const body = await res.text()
      expect(body).toContain('<nav id="rail">')
    } finally { close() }
  })

  it('a missing partial (broken deploy) answers a clean 404, not a 500 or mojibake', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db, []) // the assets binding misses everything
      const res = await app.fetch(new Request('http://local/api/nav'))
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('Not Found')
    } finally { close() }
  })

  it('no assets binding configured (the bare-Node test shape) → 404, not a crash', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const res = await app.fetch(new Request('http://local/api/nav'))
      expect(res.status).toBe(404)
    } finally { close() }
  })
})
