import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { hashPassword } from '../auth/password'
import { SESSION_COOKIE, createSession } from '../auth/sessions'
import { esc, jsonBody, requestOrigin, isHtmx } from '../lib/http'
import { resetRequestSchema, resetConfirmSchema } from '../validation/schemas'
import { sendAndLog, resetEmailHtml } from '../services/email'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import { createResetToken, sha256Hex } from '../services/reset'
import type { Config, UserRow } from '../types'

// Password reset via Resend email (spec §8). Token is one-time, hashed in D1, 1-hour expiry.
// The Resend key is a Workers secret (rule 5) — without it the request responds 503 with a
// clear message instead of failing silently.

// htmx plumbing: the forms swap their whole section on success, so the modal visibly
// changes ("reset link sent to …" / "password changed"); errors are retargeted into the
// section's inline message <p> (HX-Retarget) so the form survives a failed attempt.
// Everything goes out as 2xx — htmx silently drops 4xx/5xx bodies by default.
const hxError = (c: Context, text: string) => {
  c.header('HX-Retarget', c.req.path.endsWith('/reset/confirm') ? '#reset-msg-conf' : '#reset-msg-req')
  c.header('HX-Reswap', 'innerHTML')
  return c.html(`<p class="error">${text}</p>`)
}

// Spec §15: the reset endpoints are public and can be used to spam the owner's inbox, so
// they share the auth limiter (30 req/60s per IP — same values as the CF rule).
export function resetRoutes(cfg: Config) {
  const app = new Hono()
  const resetLimiter: MiddlewareHandler = async (c, next) => {
    if (await hitRateLimit(cfg.db, RATE_RULES.auth, clientIp(c))) {
      if (isHtmx(c)) return hxError(c, 'Too many attempts — wait a minute and try again.')
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }
  app.use('/reset/*', resetLimiter)

  app.post('/reset/request', async (c) => {
    const body = await jsonBody<z.infer<typeof resetRequestSchema>>(c, resetRequestSchema)
    if (!body) return isHtmx(c) ? hxError(c, 'Enter a valid email address.') : c.json({ error: 'invalid_input' }, 400)
    const users = await cfg.db.query<UserRow>('SELECT * FROM users WHERE email = ?', [body.email])
    // Same response whether or not the email exists — never leak account existence. The
    // htmx panel only echoes the address the user typed themselves, never a stored one.
    const sent = `<section id="request-section" data-reset-sent="1">
      <h3>Check your inbox</h3>
      <p class="ok">✓ Reset link sent to <b>${esc(body.email)}</b> — it expires in 1 hour.</p>
      <p class="muted small">Didn't arrive? Check spam, then try again.</p>
    </section>`
    if (users.length === 0) return isHtmx(c) ? c.html(sent) : c.json({ ok: true })

    const token = await createResetToken(cfg.db, users[0].id)

    const link = `${requestOrigin(c)}/reset.html?token=${token}`
    try {
      await sendAndLog(cfg, {
        origin: requestOrigin(c),
        to: users[0].email,
        subject: 'Password reset — بازنشانی گذرواژه',
        kind: 'reset',
        title: 'بازنشانی گذرواژه — Password reset',
        bodyHtml: resetEmailHtml(link),
      })
    } catch (err) {
      if (isHtmx(c)) return hxError(c, "We couldn't send the reset email — please try again in a minute.")
      return c.json({ error: err instanceof Error ? err.message : 'email not configured' }, 503)
    }
    return isHtmx(c) ? c.html(sent) : c.json({ ok: true })
  })

  app.post('/reset/confirm', async (c) => {
    const body = await jsonBody<z.infer<typeof resetConfirmSchema>>(c, resetConfirmSchema)
    if (!body) return isHtmx(c) ? hxError(c, 'Enter a password of at least 8 characters.') : c.json({ error: 'invalid_input' }, 400)
    const hash = await sha256Hex(body.token)
    const rows = await cfg.db.query<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM password_resets WHERE token_hash = ? AND used_at IS NULL',
      [hash],
    )
    const expired = rows.length === 0 || new Date(rows[0].expires_at).getTime() < Date.now()
    if (expired) {
      if (isHtmx(c)) return hxError(c, 'This link is invalid or expired — request a new password reset.')
      return c.json({ error: 'invalid_or_expired_token' }, 400)
    }
    const passwordHash = await hashPassword(body.password)
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].user_id])
      tx.sql('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [new Date().toISOString(), hash])
      tx.sql('DELETE FROM sessions WHERE user_id = ?', [rows[0].user_id]) // reset kills old sessions
    })
    // Sign this browser straight in — the one-time link is the account's own proof.
    const token = await createSession(cfg.db, rows[0].user_id)
    const secure = cfg.isProd ? 'Secure; ' : ''
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; ${secure}Max-Age=${30 * 24 * 60 * 60}`,
    )
    if (isHtmx(c)) {
      return c.html(`<section id="confirm-section" data-reset-done="1">
        <h3>All set ✓</h3>
        <p class="ok">Password changed. Taking you to your dashboard…</p>
        <script>setTimeout(function(){ location.href = '/app' }, 1200)<\/script>
      </section>`)
    }
    return c.json({ ok: true })
  })

  return app
}