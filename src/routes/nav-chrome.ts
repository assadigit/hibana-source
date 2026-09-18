import { Hono } from 'hono'
import type { Config, UserRow } from '../types'

// S72: the topbar/nav partial served through the API path. The CF edge caches the
// static /partials/nav*.html URL under a zone-level Edge-TTL override that IGNORES
// the origin's max-age=0 (verified live 2026-09-18: cf-cache-status HIT served a
// stale partial hours after deploy, and Standard cache level drops query strings,
// so ?v= busting can't reach the cache key either — the deploy token lacks zone
// purge). API paths carry no cacheable file extension, so this route always reaches
// the Worker: every nav-partial change ships on deploy, deterministically.
//
// Public by design, exactly like the static partial it replaces: the markup is
// static shell chrome with zero user data — the account chip's specifics load via
// /api/auth/me after injection (unchanged). One code path serves both runtimes:
// cfg.assets is the Workers ASSETS binding upstream and Node's serveFile locally.
//
// sw.js precaches '/api/nav' in its SHELL list (offline boots keep the chrome) and
// its fetch handler serves it network-first (Class 3) — a deploy lands on next load.

export function registerNavChrome(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.get('/api/nav', async (c) => {
    const assets = cfg.assets
    if (!assets) return c.text('Not Found', 404)
    try {
      // A CLEAN Request (no Accept-Encoding): Node's serveFile gzips only when the
      // caller accepts gzip, and re-wrapping a compressed body would need its
      // Content-Encoding header carried along (dropping it ships raw gzip bytes as
      // HTML — caught locally: the nav mount rendered \x1f\x8b mojibake). The clean
      // request gets the identity body; the header pass-through below is the
      // belt-and-suspenders for any runtime that compresses regardless.
      const url = new URL('/partials/nav.html', c.req.url)
      const res = await assets(url, new Request(url))
      if (!res.ok) return c.text('Not Found', 404)
      const headers: Record<string, string> = {
        'Content-Type': 'text/html; charset=utf-8',
        // no-store: never the edge, never the browser cache, never a stale topbar.
        // (The /api/* middleware default is private,no-cache — S69's no-store lesson
        // about pending bodies applies to the auth guard, not here; this body IS read.)
        'Cache-Control': 'no-store',
      }
      const ce = res.headers.get('content-encoding')
      if (ce) headers['Content-Encoding'] = ce
      // Raw Response (not c.body): Hono's typed c.body() rejects ReadableStream|null.
      return new Response(res.body, { status: 200, headers })
    } catch {
      return c.text('Not Found', 404)
    }
  })
}
