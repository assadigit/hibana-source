import { getCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import type { Config, UserRow } from '../types'
import { SESSION_COOKIE, validateSession } from './sessions'
import { isBanned, banQueryParams } from './ban'

// Presence freshness window (batch e): requireAuth re-stamps users.last_seen_at at most
// this often — the admin console's "online" dot reads the same column.
const PRESENCE_STALE_MS = 5 * 60 * 1000

// Gate every user-owned route behind this. Rule 1 starts at the auth boundary:
// the authenticated user id is the single filter for every subsequent query.
export function requireAuth(cfg: Config): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    const userId = await validateSession(cfg.db, token)
    if (!userId) {
      const wantsDocument = c.req.header('Sec-Fetch-Dest') === 'document' || c.req.header('HX-Request') !== undefined
      if (wantsDocument) return c.redirect('/login.html')
      return c.json({ error: 'unauthorized' }, 401)
    }
    const users = await cfg.db.query<UserRow>('SELECT * FROM users WHERE id = ?', [userId])
    if (users.length === 0) return c.json({ error: 'unauthorized' }, 401)
    const user = users[0]
    // Suspended accounts are locked out here (batch e): htmx requests get an HX-Redirect
    // to the login page with the ban notice in the query string; JSON clients get a 403.
    if (isBanned(user)) {
      if (c.req.header('HX-Request') !== undefined) {
        c.header('HX-Redirect', `/login.html?${banQueryParams(user)}`)
        return c.html('')
      }
      return c.json({ error: 'banned', until: user.banned_until, reason: user.ban_reason }, 403)
    }
    // Presence stamp — fire-and-forget: a failed write must never fail the request.
    // P1.3 (F-L9): on Cloudflare Workers an un-awaited promise may be terminated once the
    // response returns, so the last_seen_at UPDATE could be dropped mid-flight. Wrap it in
    // ctx.waitUntil so the runtime keeps it alive past the response. c.executionCtx is a
    // getter that throws outside Workers (Node/tests), so the access is try/catch-guarded —
    // on Node there's no reaper, so the fire-and-forget .catch stays as the fallback.
    const last = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0
    if (Date.now() - last > PRESENCE_STALE_MS) {
      const stamp = cfg.db
        .execute('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), user.id])
        .catch(() => {})
      // P1.3 (F-L9): c.executionCtx is a getter that THROWS "This context has no
      // ExecutionContext" on Node/tests (not undefined), so guard with try/catch. On
      // Workers it returns the real ExecutionContext → waitUntil keeps the stamp alive
      // past the response. On Node there's no reaper → the fire-and-forget .catch stays.
      try {
        const ec = (c as unknown as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx
        if (ec?.waitUntil) ec.waitUntil(stamp)
      } catch {
        // Node/test path: no ExecutionContext — leave the promise fire-and-forget.
      }
    }
    c.set('user', user)
    await next()
  }
}