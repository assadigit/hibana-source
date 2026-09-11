import { Hono, type MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { hashPassword, verifyPassword, needsRehash } from '../auth/password'
import { SESSION_COOKIE, sessionHash, createSession, destroySession } from '../auth/sessions'
import { requireAuth } from '../auth/middleware'
import { isBanned } from '../auth/ban'
import { BANNED_FOREVER_DATE } from '../auth/ban'
import { isHtmx, esc, jsonBody } from '../lib/http'
import { calendarFor } from '../lib/jalali'
import { toastHtml } from '../lib/html'
import { localeOf } from '../lib/i18n'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import type { Config, UserRow } from '../types'

// Rule 10: Zod at the route level, one schema per endpoint, consistently.
const loginSchema = z.object({
  login: z.string().min(1).max(200), // email or username (super-admin has no real email)
  password: z.string().min(1).max(200),
})

// Spec §15: brute-force guard on the public login endpoint (30 req/60s per IP,
// same values as the Cloudflare rate-limiting rule the edge would otherwise apply).

// Account (spec §5.8): change password with the current one, then kill every other session.
const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(8).max(200),
  // same floor as register/reset — numbers-only OK (2026-08-30 (f))
})

const USER_FIELDS = ['id', 'username', 'email', 'role', 'avatar_path'] as const

// Ban notice shared by the htmx login fragment and the JSON error path: dated bans say
// "suspended — until <date> UTC" (ISO sliced to 16 chars, T→space), the owner-entered
// reason rides on a new line. Both halves are escaped — they come from the DB, not us.
function banNoticeHtml(u: Pick<UserRow, 'banned_until' | 'ban_reason'>) {
  // L8 fix: treat both the legacy 'forever' sentinel and the new BANNED_FOREVER_DATE as permanent
  const isPermanent = !u.banned_until || u.banned_until === 'forever' || u.banned_until === BANNED_FOREVER_DATE
  const until = isPermanent ? '' : ` — until ${esc(u.banned_until!.slice(0, 16).replace('T', ' '))} UTC`
  const reason = u.ban_reason ? `<br>${esc(u.ban_reason)}` : ''
  return `This account is suspended${until}.${reason}`
}

function publicUser(u: UserRow) {
  const out: Record<string, unknown> = {}
  for (const f of USER_FIELDS) out[f] = u[f]
  return out
}

export function authRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  const loginLimiter: MiddlewareHandler<{ Variables: { user: UserRow } }> = async (c, next) => {
    if (await hitRateLimit(cfg.db, RATE_RULES.auth, clientIp(c))) {
      // htmx needs a swappable 2xx fragment — a 4xx JSON body is silently swallowed.
      if (isHtmx(c)) return c.html('<p class="error">Too many attempts — wait a minute and try again.</p>')
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }
  app.use('/login', loginLimiter)

  // Accepts both JSON (offline queue / API clients) and form-encoded (htmx login form).
  app.post('/login', async (c) => {
    const contentType = c.req.header('Content-Type') ?? ''
    let parsed: unknown
    try {
      if (contentType.includes('application/json')) {
        parsed = await c.req.json()
      } else {
        const form = await c.req.parseBody()
        parsed = { login: form.login, password: form.password }
      }
    } catch {
      parsed = null
    }

    const body = loginSchema.safeParse(parsed)
    if (!body.success) {
      if (isHtmx(c)) return c.html('<p class="error">Enter both fields.</p>')
      return c.json({ error: 'invalid_input' }, 400)
    }

    const { login, password } = body.data
    // Email is case-insensitive (RFC 5321) — normalize to lowercase at lookup time.
    // SQLite's = operator is case-sensitive by default; a user who types Email@Example.com
    // after registering as email@example.com would otherwise get "wrong credentials".
    const loginLower = login.toLowerCase()
    const users = await cfg.db.query<UserRow>('SELECT * FROM users WHERE email = ? OR username = ?', [loginLower, login])
    if (users.length === 0) {
      if (isHtmx(c)) return c.html('<p class="error">Wrong email/username or password.</p>')
      return c.json({ error: 'invalid_credentials' }, 401)
    }

    const user = users[0]
    const ok = await verifyPassword(password, user.password_hash)
    if (!ok) {
      if (isHtmx(c)) return c.html('<p class="error">Wrong email/username or password.</p>')
      return c.json({ error: 'invalid_credentials' }, 401)
    }

    // Ban gate: after the credential check (ban status must not leak which accounts
    // exist) but BEFORE the email-verified gate — a banned+unverified account gets the
    // suspension notice, not the verification redirect.
    if (isBanned(user)) {
      const until = user.banned_until ?? ''
      const reason = user.ban_reason ?? undefined
      if (isHtmx(c)) return c.html(`<p class="error">${banNoticeHtml(user)}</p>`)
      // L8 fix: permanent bans (both legacy 'forever' and new BANNED_FOREVER_DATE) → null
      const isPermanent = until === 'forever' || until === BANNED_FOREVER_DATE
      return c.json({ error: 'banned', until: isPermanent ? null : until, reason: reason ?? null }, 403)
    }

    // Email confirmation gate (spec §4.14, added 2026-08-24): accounts created by the
    // public register form are locked until the 6-digit email code is consumed. Redirect
    // htmx straight to the verification page (the server knows the real email even when
    // the user logged in with a username). Existing/pre-verification accounts are open.
    if (!user.email_verified_at) {
      if (isHtmx(c)) {
        c.header('HX-Redirect', `/confirm.html?email=${encodeURIComponent(user.email)}`)
        return c.html('')
      }
      return c.json({ error: 'email_unverified' }, 403)
    }

    const token = await createSession(cfg.db, user.id)
    const secure = cfg.isProd ? 'Secure; ' : ''
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; ${secure}Max-Age=${30 * 24 * 60 * 60}`,
    )

    // M2 fix (2026-09-10): lazy PBKDF2 rehash. If the stored hash was created at a lower
    // iteration count than the current target (600k), silently upgrade it now — the
    // plaintext password is in hand, so we can rehash at the new target. Fire-and-forget
    // via waitUntil so the login response isn't delayed by the ~200ms derive. If the
    // Worker hits its CPU limit, the rehash silently fails and the next login retries.
    if (needsRehash(user.password_hash)) {
      const rehash = (async () => {
        try {
          const newHash = await hashPassword(password)
          await cfg.db.execute('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', [
            newHash, user.id, user.password_hash,
          ])
        } catch { /* best-effort: the old hash still works, next login retries */ }
      })()
      try {
        const ec = (c as unknown as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx
        ec?.waitUntil?.(rehash)
      } catch { /* Node/test path: no ExecutionContext, leave fire-and-forget */ }
    }

    if (isHtmx(c)) {
      c.header('HX-Redirect', '/app')
      return c.html('')
    }
    return c.json({ ok: true, user: publicUser(user) })
  })

  app.post('/logout', async (c) => {
    await destroySession(cfg.db, getCookie(c, SESSION_COOKIE))
    c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
    if (isHtmx(c)) return c.html('')
    return c.json({ ok: true })
  })

  app.get('/me', requireAuth(cfg), (c) => {
    const u = c.get('user')
    return c.json({
      user: {
        ...publicUser(u),
        language_pref: u.language_pref,
        calendar_pref: calendarFor(u.language_pref),
        timezone: u.timezone,
        created_at: u.created_at,
      },
    })
  })

  app.patch('/password', requireAuth(cfg), async (c) => {
    const body = await jsonBody<z.infer<typeof changePasswordSchema>>(c, changePasswordSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')

    const currentOk = await verifyPassword(body.current_password, user.password_hash)
    if (!currentOk) {
      if (isHtmx(c)) return c.html(`<p class="error">${esc('Current password is incorrect.')}</p>`)
      return c.json({ error: 'invalid_current_password' }, 400)
    }

    const passwordHash = await hashPassword(body.new_password)
    const currentToken = getCookie(c, SESSION_COOKIE)
    const currentSessionId = currentToken ? await sessionHash(currentToken) : null
    // Set the new hash and revoke every OTHER session atomically (§5.8) — the device
    // making this request stays logged in; everyone else is signed out.
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id])
      if (currentSessionId) tx.sql('DELETE FROM sessions WHERE user_id = ? AND id != ?', [user.id, currentSessionId])
      else tx.sql('DELETE FROM sessions WHERE user_id = ?', [user.id])
    })

    if (isHtmx(c)) return c.html(toastHtml('Password changed — other devices signed out', localeOf(c)))
    return c.json({ ok: true })
  })

  return app
}