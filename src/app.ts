import { Hono } from 'hono'
import { ApiError, errorBody, internalErrorResponse } from './lib/errors'
import { log, withReqId } from './lib/log'
import { recordError } from './services/errorlog'
import { authRoutes } from './routes/auth'
import { devRoutes } from './routes/dev'
import { projectsRoutes } from './routes/projects/index'
import { coreRoutes } from './routes/core'
import { devboardRoutes } from './routes/devboard'
import { tagsRoutes } from './routes/tags'
import { searchRoutes } from './routes/search'
import { dashboardRoutes } from './routes/dashboard'
import { quickNotesRoutes } from './routes/quicknotes'
import { sadhanaRoutes } from './routes/sadhana'
import { registrationRoutes } from './routes/registration'
import { resetRoutes } from './routes/reset'
import { adminRoutes } from './routes/admin'
import { reportsRoutes } from './routes/reports'
import { settingsRoutes } from './routes/settings'
import { moduleRoutes } from './routes/module'
import { exportRoutes } from './routes/export'
import { calendarRoutes } from './routes/calendar'
import { timelineRoutes } from './routes/timeline'
import { notificationsRoutes } from './routes/notifications'
import { registerTelegram } from './routes/integrations/telegram'
import { registerImport } from './routes/integrations/import'
import { registerHealth } from './routes/health'
import { aiRoutes } from './routes/ai'
import { requireAuth } from './auth/middleware'
import type { Config, UserRow } from './types'

// The entire app — one Hono instance. Three layers:
//   1. API routes (JSON, or HTML fragments when HX-Request is present — Q1-A)
//   2. The protected /app shell (asset, but only for authenticated sessions)
//   3. Static asset fallback (login.html, css, js, …)
// Both runtime entries (Workers in src/index.ts, Node in src/server.ts) call this.
export function createApp(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow; reqId?: string } }>()

  // P3.1 (F-M12): per-request id, generated first so every subsequent middleware + route
  // + onError log line carries it. crypto.randomUUID() on Workers/Node 20+. Set on c.var
  // so handlers can read it via c.get('reqId'); withReqId scopes the log module to it.
  app.use('*', async (c, next) => {
    const reqId = crypto.randomUUID()
    c.set('reqId', reqId)
    await next()
  })

  // Force HTTPS: prod sets the session cookie `Secure`, so any request arriving over plain
  // HTTP cannot hold a session — the user gets kicked back to login. Cloudflare sends the
  // original scheme in `x-forwarded-proto` (or `cf-visitor`). Local Node dev has neither
  // header, so it keeps working over http://localhost. Redirect once at the edge of every.
  app.use('*', async (c, next) => {
    let proto = c.req.header('x-forwarded-proto') ?? ''
    if (!proto) {
      const cf = c.req.header('cf-visitor')
      if (cf) { try { proto = (JSON.parse(cf) as { scheme?: string }).scheme ?? '' } catch {} }
    }
    if (proto === 'http') {
      const url = new URL(c.req.url)
      url.protocol = 'https:'
      url.port = ''
      return c.redirect(url.toString(), 301)
    }
    return next()
  })

  // Security headers (hardening 2026-08-28) on every Worker-generated response — API JSON,
  // htmx fragments, proxied media, redirects. Static pages are covered by public/_headers
  // (the assets binding serves those before the Worker runs — the same set lives there).
  // CSP notes: 'unsafe-inline' + 'unsafe-eval' are required by the no-build frontend (inline
  // <script> blocks, Alpine.js expression evaluation); the CSP still blocks external script
  // loads, plugins (object-src), foreign form targets, framing (clickjacking) and base-tag
  // hijack — defense in depth behind the escaping discipline, not a substitute for it.
  // 2026-09-06 (k): img-src gains https: — the canvas/notebook image-from-link tools
  // hotlink user-pasted picture URLs; 'self'-only blocked every external image (lockstep
  // with public/_headers; https only — no mixed-content http:).
  const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
  app.use('*', async (c, next) => {
    await next()
    // Assets-binding responses arrive with IMMUTABLE headers — decorating them in place
    // throws "Can't modify immutable headers" (regression caught on /to-do-list + /app,
    // 2026-08-28: those routes return env.ASSETS.fetch() responses directly). Clone such
    // responses once, then set the header set on the mutable copy.
    const decorate = (h: Headers) => {
      h.set('X-Content-Type-Options', 'nosniff')
      h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
      h.set('X-Frame-Options', 'SAMEORIGIN')
      h.set('Cross-Origin-Opener-Policy', 'same-origin')
      h.set('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()') // microphone stays enabled: voice quick-add
      h.set('Strict-Transport-Security', 'max-age=15552000') // no includeSubDomains: mail.hibana.ir is DNS-only
      h.set('Content-Security-Policy', CSP)
    }
    try {
      decorate(c.res.headers)
    } catch {
      const res = c.res
      c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) })
      decorate(c.res.headers)
    }
  })

  // CSRF hardening: every state-changing request must originate from the app's own origin
  // — or, since v0.3.2, from an explicitly configured mirror origin (MIRROR_ORIGIN, see
  // docs/edge-mirror.md: a CDN front like ArvanCloud rewrites the Host to the origin at
  // pull time, so the browser's Origin (https://fast.hibana.ir) can never equal the
  // request's own origin; the allow-list is exact-string, empty by default, and
  // SameSite=Lax still drops the cookie for every other cross-site caller). Browsers
  // always attach an `Origin` (or `Referer`) to cross-site POST/PUT/PATCH/DELETE, so a
  // mismatched header is rejected before any route runs — this covers the form-encoded
  // htmx surface that the JSON-content-type argument can't, on top of SameSite=Lax already
  // dropping the session cookie cross-site (defense in depth).
  //
  // 2026-09-11 (SWOT T6): tightened the headerless-caller carve-out. Previously, a request
  // with NEITHER Origin NOR Referer was allowed (intentional for server-side callers).
  // Now at least one header must be present and trusted — a request with neither is
  // rejected with 403. The Telegram webhook is exempted (rule 11 governs via secret-token).
  // Server-side automation callers that need access should send an explicit Origin header.
  app.use('*', async (c, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) return next()
    if (c.req.path === '/api/telegram/webhook') return next() // rule 11 governs it
    const self = new URL(c.req.url).origin
    const mirrors = cfg.mirrorOrigins ?? []
    const trusted = (o: string) => o === self || mirrors.includes(o)
    const origin = c.req.header('Origin')
    const referer = c.req.header('Referer')
    // T6: require at least one header to be present AND trusted (was: allow if neither present)
    if (origin) {
      if (!trusted(origin)) return c.json({ error: 'forbidden' }, 403)
    } else if (referer) {
      try {
        if (!trusted(new URL(referer, self).origin)) return c.json({ error: 'forbidden' }, 403)
      } catch {
        return c.json({ error: 'forbidden' }, 403)
      }
    } else {
      // Neither Origin nor Referer present — reject (was: allowed pre-T6)
      return c.json({ error: 'forbidden' }, 403)
    }
    return next()
  })

  app.onError(async (err, c) => {
    // Structured ApiError → serialize at its own status with { error, message? }.
    // Any other throw → the legacy { error: 'internal_error' } 500, so existing
    // routes (and the existing frontend error handling) keep their exact shape.
    //
    // dr-integrity session (0045): every error is also PERSISTED to error_log (7-day
    // retention, owner-only viewer in the admin console) — errors were previously only
    // visible during a live `wrangler tail` session. recordError is self-guarded (never
    // throws, own try/catch) so observability can never break the response itself.
    const reqId = c.get('reqId')
    const path = c.req.path
    const userId = c.get('user')?.id
    if (err instanceof ApiError) {
      withReqId(reqId, () => log.warn('api_error', { code: err.code, detail: err.detail ?? '', path }))
      await recordError(cfg.db, {
        reqId,
        userId,
        path,
        status: err.status,
        code: err.code,
        message: err.detail,
      })
      return c.json(errorBody(err), err.status)
    }
    withReqId(reqId, () => log.error('unhandled_error', { err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err), path }))
    const stack = err instanceof Error ? err.stack : undefined
    await recordError(cfg.db, {
      reqId,
      userId,
      path,
      status: 500,
      code: 'internal_error',
      message: err instanceof Error ? err.message : String(err),
      stack,
    })
    return c.json(internalErrorResponse, 500)
  })

  // Root-level routes first: the webhook is public (no auth) and must not be captured by
  // coreRoutes' global requireAuth wildcard. Registering on the root app guarantees this.
  registerTelegram(app, cfg)
  registerImport(app, cfg)
  registerHealth(app, cfg)

  app.route('/api/auth', authRoutes(cfg))
  app.route('/api/auth', registrationRoutes(cfg))
  app.route('/api/auth', resetRoutes(cfg))
  app.route('/api/projects', projectsRoutes(cfg))

  // Worker-served page routes (2026-09-06 (k)): the GETs below are served by Worker routes,
  // not the assets binding — the 404 branch of the assets middleware checks this set so they
  // fall through to their routes (and /api/* likewise) instead of hitting the branded 404 page.
  const WORKER_PAGE_ROUTES = new Set([
    '/app',
    '/register',
    '/register.html',
    '/verify',
    '/verify.html',
    '/signup',
    '/confirm',
    '/to-do-list',
    '/to-do-list.html',
    '/timeline',
    '/timeline.html',
  ])

  const assetsFirst = cfg.assets

  // Branded 404 page (2026-09-06 (k)): fetch /404.html through the assets binding and
  // re-stamp it as a real 404 (the binding serves hits with its own status). Any miss or
  // throw → null, and the caller falls back to plain next() / the raw response.
  const notFoundPage = async (reqUrl: string): Promise<Response | null> => {
    if (!assetsFirst) return null
    try {
      const res = await assetsFirst(new URL('/404.html', reqUrl))
      if (res.status === 404) return null
      return new Response(res.body, { status: 404, statusText: 'Not Found', headers: res.headers })
    } catch {
      return null
    }
  }

  // Assets-first static serving, mirroring the Cloudflare edge model (where the assets
  // binding serves files BEFORE the Worker's auth middleware runs). Static files carry no
  // user data — every data route is separately auth'd — so the login page, css/js and the
  // /vendor libs must stay reachable unauthenticated on the Node path too. This must be
  // registered before coreRoutes' global requireAuth wildcard; the final app.get('*')
  // fallback stays last so specific routes keep priority. Missing files serve the branded
  // /404.html (2026-09-06 (k)); /api/* and the Worker-served page routes fall through.
  if (assetsFirst) {
    app.use('*', async (c, next) => {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
      const url = new URL(c.req.url)
      if (url.pathname === '/app') return next() // authenticated shell, handled below
      const res = await assetsFirst(url, c.req.raw)
      if (res.status !== 404) return res
      if (url.pathname.startsWith('/api/') || WORKER_PAGE_ROUTES.has(url.pathname)) return next()
      const nf = await notFoundPage(c.req.url)
      if (nf) return nf
      return next()
    })
  }

  // The signup/confirm pages live at /signup + /confirm (rename, 2026-08-24): the assets
  // binding's extensionless machinery had cached WRONG variants under /register + /verify
  // (a 9-byte body and an attribute-stripped page that failed the app.js public-page check
  // and bounced guests to login). The old URLs now 301 here; the new ones are plain files.
  app.get('/register', (c) => c.redirect('/signup', 301))
  app.get('/register.html', (c) => c.redirect('/signup', 301))
  app.get('/verify', (c) => c.redirect('/confirm', 301))
  app.get('/verify.html', (c) => c.redirect('/confirm', 301))
  // Canonical pages at their exact file names (the assets-first middleware above already
  // serves the .html files; these routes cover extensionless URLs wherever the assets
  // layer doesn't map them — e.g. the Node path, which has no extensionless redirect).
  app.get('/signup', async (c) => (cfg.assets ? cfg.assets(new URL('/signup.html', c.req.url), c.req.raw) : c.redirect('/signup.html', 302)))
  app.get('/confirm', async (c) => (cfg.assets ? cfg.assets(new URL('/confirm.html', c.req.url), c.req.raw) : c.redirect('/confirm.html', 302)))
  // The to-do list board moved URL (2026-08-25): /sadhana served a corrupted edge-cache
  // variant to some visitors (blank page that survived cache busts), so the canonical URL
  // is now /to-do-list, served from the same asset. The old path keeps working for links;
  // the .html variant 301s to the short form.
  app.get('/to-do-list', async (c) => (cfg.assets ? cfg.assets(new URL('/sadhana.html', c.req.url), c.req.raw) : c.redirect('/sadhana.html', 302)))
  app.get('/to-do-list.html', (c) => c.redirect('/to-do-list', 301))
  // Activity merged into Reports (user request 2026-08-29): the standalone page is gone;
  // old links land on the Reports page, where the activity feed now lives.
  app.get('/timeline', (c) => c.redirect('/reports.html', 301))
  app.get('/timeline.html', (c) => c.redirect('/reports.html', 301))

  app.route('/', coreRoutes(cfg))
  app.route('/', moduleRoutes(cfg))
  // Dev-board + sprints (0029): full-path /api/… routes; mounted with the other
  // auth'd sub-apps, AFTER the assets middleware (its requireAuth wildcard must
  // never see static file paths).
  app.route('/', devboardRoutes(cfg))
  app.route('/api/tags', tagsRoutes(cfg))
  app.route('/api/search', searchRoutes(cfg))
  app.route('/api/dashboard', dashboardRoutes(cfg))
  app.route('/api/notes', quickNotesRoutes(cfg))
  app.route('/api/sadhana', sadhanaRoutes(cfg))
  app.route('/api/admin', adminRoutes(cfg))
  app.route('/api/dev', devRoutes(cfg))
  app.route('/api/reports', reportsRoutes(cfg))
  app.route('/api/settings', settingsRoutes(cfg))
  app.route('/api/export', exportRoutes(cfg))
  app.route('/api/calendar', calendarRoutes(cfg))
  app.route('/api/timeline', timelineRoutes(cfg))
  app.route('/api/notifications', notificationsRoutes(cfg))
  // Magic Button (idea §1, green-lit): POST /api/ai/text — polish/rewrite/translate via the
  // Workers AI binding. Auth + CSRF same as every other write route; no schema, no cron.
  app.route('/api/ai', aiRoutes(cfg))

  const assets = cfg.assets
  if (assets) {
    // /app is the authenticated landing page — serve the real Dashboard (not the Phase-0
    // skeleton shell, which it was mistakenly still serving). dashboard.html is also a
    // data-free static asset: its data loads through authed APIs (rule 1, verified by the
    // 401-on-unauthenticated tests), and its JS bounces unknown visitors to login.
    app.get('/app', requireAuth(cfg), async (c) => assets(new URL('/dashboard.html', c.req.url), c.req.raw))
    // Final fallback: the asset binding's own answer, or the branded 404 when it has none
    // (2026-09-06 (k)) — never a bare Worker 404 for a missing static path.
    app.get('*', async (c) => {
      const res = await assets(new URL(c.req.url), c.req.raw)
      if (res.status !== 404) return res
      const nf = await notFoundPage(c.req.url)
      return nf ?? res
    })
  }

  return app
}