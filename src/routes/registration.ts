import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { hashPassword } from '../auth/password'
import { SESSION_COOKIE, createSession } from '../auth/sessions'
import { isHtmx, jsonBody, requestOrigin } from '../lib/http'
import { uuid } from '../lib/ids'
import { registerSchema, resendVerifySchema, verifyEmailSchema } from '../validation/schemas'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import { issueMathCaptcha, verifyMathCaptcha } from '../services/captcha'
import { createEmailCode, verifyEmailCode, RESEND_COOLDOWN_MS } from '../services/verify'
import { sendAndLog, verifyEmailHtml, inviteEmailHtml } from '../services/email'
import type { Config, InviteRow, UserRow } from '../types'

// Registration (spec §4.14) + email-code confirmation, added 2026-08-24.
// Flow: register (CAPTCHA) → email 6-digit code → /verify (code) → session → /app.
// Accounts land UNVERIFIED (email_verified_at NULL) and login refuses them until the code
// is consumed — so a signup with a typo'd email is harmless dead weight, and the code is
// the only unlock. Invite codes are required again the moment cfg.openRegistration flips
// off (it is temporarily open by decision — Ali can open/close it via wrangler.toml).

export function registrationRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

  // Spec §15: same auth bucket as login/reset — public endpoints that would otherwise be
  // spammable (30 req/60s per IP). htmx gets a swappable fragment (2xx) — a 4xx JSON body
  // would be silently swallowed by htmx's default response handling (Ali's "nothing
  // happens" bug, 2026-08-24).
  const authLimiter: MiddlewareHandler = async (c, next) => {
    if (await hitRateLimit(cfg.db, RATE_RULES.auth, clientIp(c))) {
      if (isHtmx(c)) return c.html('<p class="error">Too many attempts — wait a minute and try again.</p>')
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }
  app.use('/register', authLimiter)
  app.use('/verify', authLimiter)
  app.use('/verify/resend', authLimiter)

  // Math human-check (2026-08-30 (e)): issue an HMAC-signed arithmetic question. Never
  // cached (no-store) — a stale question would fail its own expiry check on submit, but
  // every layer should still hand out a fresh one.
  app.get('/captcha', async (c) => {
    if (!cfg.captchaSecretKey) return c.json({ error: 'captcha_unconfigured' }, 503)
    const { question, token } = await issueMathCaptcha(cfg.captchaSecretKey)
    return c.json({ q: question, token }, 200, { 'Cache-Control': 'no-store' })
  })

  app.post('/register', async (c) => {
    const body = await jsonBody<z.infer<typeof registerSchema>>(c, registerSchema)
    if (!body) {
      if (isHtmx(c)) return c.html('<p class="error">Please fill in every field (and complete the human check).</p>')
      return c.json({ error: 'invalid_input' }, 400)
    }

    // Human check FIRST, fail-closed (missing secret key = 503, never a silent bypass).
    const captchaResult = await verifyMathCaptcha(cfg.captchaSecretKey, body.captcha_token, body.captcha)
    if (captchaResult === 'missing_secret') {
      if (isHtmx(c)) return c.html('<p class="error">Sign-up is paused — the human check isn&#39;t configured yet.</p>')
      return c.json({ error: 'captcha_unconfigured' }, 503)
    }
    if (captchaResult === 'missing_token') {
      if (isHtmx(c)) return c.html('<p class="error">The human check is missing — reload the page and try again.</p>')
      return c.json({ error: 'captcha_failed' }, 400)
    }
    if (captchaResult === 'expired') {
      if (isHtmx(c)) return c.html('<p class="error">The human check expired — a fresh question is shown, answer that one.</p>')
      return c.json({ error: 'captcha_failed' }, 400)
    }
    if (captchaResult !== 'ok') {
      if (!body.captcha || !body.captcha.trim()) {
        if (isHtmx(c)) return c.html('<p class="error">Please answer the human check first.</p>')
        return c.json({ error: 'captcha_failed' }, 400)
      }
      if (isHtmx(c)) return c.html('<p class="error">That answer isn&#39;t right — try the new question below the form.</p>')
      return c.json({ error: 'captcha_failed' }, 400)
    }

    // Duplicate checks, separately so the error is precise (rule 1: users are global).
    const byEmail = await cfg.db.query<{ id: string }>('SELECT id FROM users WHERE email = ?', [body.email])
    if (byEmail.length > 0) {
      if (isHtmx(c)) return c.html('<p class="error">That email is already registered — sign in instead.</p>')
      return c.json({ error: 'email_taken' }, 409)
    }
    const byName = await cfg.db.query<{ id: string }>('SELECT id FROM users WHERE username = ?', [body.username])
    if (byName.length > 0) {
      if (isHtmx(c)) return c.html('<p class="error">That username is taken.</p>')
      return c.json({ error: 'username_taken' }, 409)
    }

    // Invite gate — only enforced while registration is CLOSED (temporarily open now).
    let invite: InviteRow | undefined
    if (!cfg.openRegistration) {
      if (!body.inviteCode) {
        if (isHtmx(c)) return c.html('<p class="error">An invite code is required.</p>')
        return c.json({ error: 'invalid_invite' }, 403)
      }
      const invites = await cfg.db.query<InviteRow>(
        'SELECT * FROM invites WHERE code = ? AND used_at IS NULL',
        [body.inviteCode],
      )
      if (invites.length === 0) {
        if (isHtmx(c)) return c.html('<p class="error">That invite code is invalid or already used.</p>')
        return c.json({ error: 'invalid_invite' }, 403)
      }
      invite = invites[0]
    }

    const id = uuid()
    const now = new Date().toISOString()
    await cfg.db.transaction(async (tx) => {
      // email_verified_at stays NULL — the account is locked until the code lands.
      tx.sql(
        'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, body.username, body.email, await hashPassword(body.password), 'member', 'en', 'gregorian', 'UTC', now],
      )
      if (invite) tx.sql('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?', [now, id, invite.id])
    })

    // Mail the 6-digit code. If the send fails, roll the account back so a retry starts
    // clean instead of stranding an unverifiable account behind "email already registered".
    // One immediate retry absorbs transient provider hiccups (Resend rate windows etc.).
    const code = await createEmailCode(cfg.db, id)
    const mail = () =>
      sendAndLog(cfg, {
        origin: requestOrigin(c),
        to: body.email,
        subject: 'Confirm your email — تأیید ایمیل',
        kind: 'verify',
        title: 'تأیید ایمیل — Confirm your email',
        bodyHtml: verifyEmailHtml(code),
      })
    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await mail()
        lastError = null
        break
      } catch (err) {
        lastError = err
        console.error('signup email send failed (attempt', attempt + 1, '):', err instanceof Error ? err.message : err)
      }
    }
    if (lastError) {
      await cfg.db.execute('DELETE FROM users WHERE id = ?', [id]) // cascades email_verifications
      if (isHtmx(c)) return c.html('<p class="error">We couldn&#39;t send the confirmation email — please try again in a minute.</p>')
      return c.json({ error: 'email_send_failed', detail: lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError).slice(0, 300) }, 503)
    }

    // No session yet — verification first (login refuses unverified accounts). The
    // signup page opens its verification modal on receipt of the ?verify=1 marker.
    if (isHtmx(c)) {
      c.header('HX-Redirect', `/signup?verify=1&email=${encodeURIComponent(body.email)}`)
      return c.html('')
    }
    return c.json({ ok: true }, 201)
  })

  app.post('/verify', async (c) => {
    const body = await jsonBody<z.infer<typeof verifyEmailSchema>>(c, verifyEmailSchema)
    if (!body) {
      if (isHtmx(c)) return c.html('<p class="error">Enter your email and the 6-digit code.</p>')
      return c.json({ error: 'invalid_input' }, 400)
    }

    const users = await cfg.db.query<UserRow>('SELECT * FROM users WHERE email = ?', [body.email])
    // No such account → the same response as a wrong code (no existence leak).
    if (users.length === 0) {
      if (isHtmx(c)) return c.html('<p class="error">That code doesn&#39;t match — check it and try again.</p>')
      return c.json({ error: 'invalid_code' }, 400)
    }
    const user = users[0]

    // Already-verified accounts must NOT be given a session here — the 6-digit code is
    // the only gate standing between an email address and an account, so the idempotent
    // short-circuit would turn /verify into a passwordless login. Polite refusal instead.
    if (user.email_verified_at) {
      if (isHtmx(c)) return c.html('<p class="error">This account is already verified — sign in instead.</p>')
      return c.json({ error: 'already_verified' }, 400)
    }

    const result = await verifyEmailCode(cfg.db, user.id, body.code)
    if (result !== 'ok') {
      const msg =
        result === 'expired'
          ? '<p class="error">That code expired — request a new one.</p>'
          : result === 'too_many_attempts'
            ? '<p class="error">Too many wrong attempts — request a new code.</p>'
            : '<p class="error">That code doesn&#39;t match — check it and try again.</p>'
      const err =
        result === 'expired' ? 'invalid_or_expired_code' : result === 'too_many_attempts' ? 'code_invalidated' : 'invalid_code'
      if (isHtmx(c)) return c.html(msg)
      return c.json({ error: err }, 400)
    }

    const token = await createSession(cfg.db, user.id)
    const secure = cfg.isProd ? 'Secure; ' : ''
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; ${secure}Max-Age=${30 * 24 * 60 * 60}`,
    )
    if (isHtmx(c)) {
      c.header('HX-Redirect', '/app')
      return c.html('')
    }
    return c.json({ ok: true })
  })

  app.post('/verify/resend', async (c) => {
    const body = await jsonBody<z.infer<typeof resendVerifySchema>>(c, resendVerifySchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)

    const users = await cfg.db.query<UserRow>('SELECT * FROM users WHERE email = ?', [body.email])
    // Same policy as reset/request: never reveal whether an address exists.
    if (users.length === 0 || users[0].email_verified_at) return c.json({ ok: true })
    const user = users[0]

    const last = await cfg.db.query<{ created_at: string }>(
      'SELECT created_at FROM email_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id],
    )
    if (last.length > 0 && Date.now() - new Date(last[0].created_at).getTime() < RESEND_COOLDOWN_MS) {
      return c.json({ error: 'resend_cooldown' }, 429)
    }

    const code = await createEmailCode(cfg.db, user.id)
    try {
      await sendAndLog(cfg, {
        origin: requestOrigin(c),
        to: user.email,
        subject: 'Confirm your email — تأیید ایمیل',
        kind: 'verify',
        title: 'تأیید ایمیل — Confirm your email',
        bodyHtml: verifyEmailHtml(code),
      })
    } catch {
      return c.json({ error: 'email_send_failed' }, 503)
    }
    return c.json({ ok: true })
  })

  // Invite management (Settings screen). Any authenticated user can generate invite
  // codes — "invite-only by existing users" (2026-09-10): the trust model is that every
  // member can bring people they vouch for in. Users see only their own invites; the
  // owner still sees all (for oversight). Codes are required at signup now that
  // OPEN_REGISTRATION is gone.
  app.get('/invites', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    const rows = user.role === 'owner'
      ? await cfg.db.query<InviteRow>('SELECT * FROM invites ORDER BY created_at DESC')
      : await cfg.db.query<InviteRow>('SELECT * FROM invites WHERE created_by = ? ORDER BY created_at DESC', [user.id])
    if (c.req.header('HX-Request')) {
      return c.html(
        rows
          .map((inv) => `<li class="row spread"><code>${inv.code}</code><span class="muted small">${inv.used_at ? 'used' : 'available'} · ${inv.created_at}</span></li>`)
          .join('') || '<li class="muted">No invites yet — generate one below.</li>',
      )
    }
    return c.json({ invites: rows })
  })

  app.post('/invites', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    const code = uuid().replace(/-/g, '').slice(0, 12)
    await cfg.db.execute('INSERT INTO invites (id, code, created_by, created_at) VALUES (?, ?, ?, ?)', [
      uuid(), code, user.id, new Date().toISOString(),
    ])
    if (c.req.header('HX-Request')) {
      return c.html(
        `<li class="row spread"><code>${code}</code><button class="ghost" onclick="navigator.clipboard.writeText('${code}')">copy</button></li>`,
      )
    }
    return c.json({ ok: true, code }, 201)
  })

  // Invite-by-email (user request 2026-09-09, opened to all users 2026-09-10): any
  // authenticated user enters an email address; Hibana generates an invite code,
  // persists it, and emails it to that address via Resend. The recipient uses the code
  // at signup. The email send uses the existing sendAndLog pipeline (branded HTML +
  // delivery log + quota).
  app.post('/invites/email', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    const body = await jsonBody<{ email: string }>(c, z.object({ email: z.string().email() }).strict())
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    // Don't leak whether the address is already a user — just send the invite regardless.
    const code = uuid().replace(/-/g, '').slice(0, 12)
    await cfg.db.execute('INSERT INTO invites (id, code, created_by, created_at) VALUES (?, ?, ?, ?)', [
      uuid(), code, user.id, new Date().toISOString(),
    ])
    if (!cfg.emailKey || !cfg.assets) {
      return c.json({ error: 'email_not_configured', detail: 'Resend key or assets binding missing — set RESEND_KEY as a Worker secret' }, 503)
    }
    const origin = requestOrigin(c)
    const inviterName = user.username || user.email
    try {
      await sendAndLog(
        { db: cfg.db, emailKey: cfg.emailKey, assets: cfg.assets },
        { to: body.email, kind: 'invite', subject: "You're invited to Hibana", title: 'You\'re invited to Hibana', bodyHtml: inviteEmailHtml(code, inviterName), origin },
      )
    } catch (e) {
      return c.json({ error: 'email_failed', detail: e instanceof Error ? e.message : String(e) }, 502)
    }
    return c.json({ ok: true, sent_to: body.email, code }, 201)
  })

  return app
}