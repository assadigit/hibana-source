import { getCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import type { Config, UserRow } from '../types'
import { SESSION_COOKIE, validateSessionWithUser, extendSession, deleteSessionById } from './sessions'
import { isBanned, banQueryParams } from './ban'

// Presence freshness window (batch e): requireAuth re-stamps users.last_seen_at at most
// this often — the admin console's "online" dot reads the same column.
const PRESENCE_STALE_MS = 5 * 60 * 1000

// Gate every user-owned route behind this. Rule 1 starts at the auth boundary:
// the authenticated user id is the single filter for every subsequent query.
export function requireAuth(cfg: Config): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    // P3.3 (F-L1): one JOIN query validates the session AND fetches the user (was 2-3
    // round trips: validateSession SELECT + maybe DELETE/UPDATE, then SELECT * FROM users).
    // The extend-on-activity + expired-session-cleanup are fire-and-forget via waitUntil.
    const result = await validateSessionWithUser<UserRow>(cfg.db, token)
    if (!result) {
      const wantsDocument =
        c.req.header('Sec-Fetch-Dest') === 'document' ||
        c.req.header('HX-Request') !== undefined ||
        // Session 20 (SW-navigation fix): a service worker's navigate-mode re-fetch
        // (network-first shell strategy, public/sw.js) re-stamps the request as a
        // worker-initiated fetch — Sec-Fetch-Dest: document is LOST on the way to the
        // origin, so an expired-session reload of /app rendered the raw JSON 401 body
        // instead of bouncing to login. Browsers always send Accept: text/html on real
        // document navigations and the SW fetch preserves the original Accept header —
        // this closes the gap for every HTML-expecting caller. JSON API clients (curl,
        // the offline queue, XHR/fetch with */* or application/json) are unaffected.
        (c.req.header('accept') ?? '').includes('text/html')
      if (wantsDocument) return c.redirect('/login.html')
      return c.json({ error: 'unauthorized' }, 401)
    }
    const { user, sessionId, expiresAt, needsExtend } = result
    const expiresMs = new Date(expiresAt).getTime()
    if (expiresMs <= Date.now()) {
      // Expired — best-effort delete via waitUntil; treat as unauthed.
      fireAndForget(c, () => deleteSessionById(cfg.db, sessionId))
      // Session 20: same Accept:text/html document check as the no-session branch (SW
      // navigate re-fetches lose Sec-Fetch-Dest — see the comment above).
      const wantsDocument =
        c.req.header('Sec-Fetch-Dest') === 'document' ||
        c.req.header('HX-Request') !== undefined ||
        (c.req.header('accept') ?? '').includes('text/html')
      if (wantsDocument) return c.redirect('/login.html')
      return c.json({ error: 'unauthorized' }, 401)
    }
    // Suspended accounts are locked out here (batch e): htmx requests get an HX-Redirect
    // to the login page with the ban notice in the query string; JSON clients get a 403.
    if (isBanned(user)) {
      if (c.req.header('HX-Request') !== undefined) {
        c.header('HX-Redirect', `/login.html?${banQueryParams(user)}`)
        return c.html('')
      }
      return c.json({ error: 'banned', until: user.banned_until, reason: user.ban_reason }, 403)
    }
    // Extend-on-activity (rolling 30-day) — fire-and-forget via waitUntil.
    if (needsExtend) fireAndForget(c, () => extendSession(cfg.db, sessionId))
    // Presence stamp — fire-and-forget: a failed write must never fail the request.
    // P1.3 (F-L9): wrapped in ctx.waitUntil on Workers so it survives past the response.
    const last = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0
    if (Date.now() - last > PRESENCE_STALE_MS) {
      fireAndForget(c, () =>
        cfg.db.execute('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), user.id]),
      )
    }
    c.set('user', user)
    await next()
  }
}

/** Run a best-effort promise via ctx.waitUntil on Workers; fire-and-forget on Node. */
function fireAndForget(c: Context, fn: () => Promise<unknown>): void {
  const p = fn().catch(() => {})
  // c.executionCtx is a getter that THROWS outside Workers (Node/tests) — try/catch-guarded.
  try {
    const ec = (c as unknown as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx
    if (ec?.waitUntil) ec.waitUntil(p)
  } catch {
    // Node/test path: no ExecutionContext — leave the promise fire-and-forget.
  }
}