// Telegram integration — route registration shell (Phase 4 modularization).
//
// Purpose: mounts the four Telegram HTTP routes on the app and owns the account-link
// management endpoints. The webhook handler logic lives in telegram-webhook.ts; the
// heavy project commands in telegram-commands.ts; the inline-keyboard callback
// dispatcher in telegram-callback.ts; shared schemas/sessions/keyboards in
// telegram-helpers.ts.
//
// Public API: registerTelegram(app, cfg) — called once from src/app.ts.
import { Hono, type MiddlewareHandler } from 'hono'
import { requireAuth } from '../../auth/middleware'
import { uuid } from '../../lib/ids'
import { clientIp, hitRateLimit, RATE_RULES } from '../../services/ratelimit'
import { errJson, ErrorCode } from '../../lib/errors'
import { LINK_CODE_TTL_MS, TELEGRAM_BOT } from './telegram-helpers'
import { telegramWebhookHandler } from './telegram-webhook'
import type { Config, UserRow } from '../../types'

export function registerTelegram(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  // Spec §15: flood guard BEFORE the secret check (the limiter must count hostile traffic
  // too; 300 req/60s per IP — same value as the CF webhook rule).
  const webhookLimiter: MiddlewareHandler = async (c, next) => {
    if (await hitRateLimit(cfg.db, RATE_RULES.webhook, clientIp(c))) {
      return errJson(c, ErrorCode.rate_limited)
    }
    return next()
  }

  app.post('/api/telegram/webhook', webhookLimiter, telegramWebhookHandler(cfg))

  // Any authenticated user can link their own Telegram chat (§4.10): Settings shows a
  // one-time code; the user sends /start <code> to the bot. Codes expire after 1h and
  // generating a new one invalidates any previous unused code for the same account.
  // M9 fix (2026-09-10): changed from GET to POST — this endpoint deletes + inserts in a
  // transaction (state-changing), so the CSRF middleware (which only checks POST/PUT/PATCH/
  // DELETE) must apply. A GET was exempt and could be triggered by <img src> or CSRF.
  app.post('/api/telegram/link-code', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    // 12 hex chars (48 bits, hardening 2026-08-28): the code links a chat to an account —
    // 8 hex chars was only ~4.3B guesses. Telegram's own flood limits make brute force
    // impractical either way, but doubling the entropy costs nothing.
    const code = uuid().replace(/-/g, '').slice(0, 12)
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM telegram_links WHERE created_at < ?', [new Date(Date.now() - LINK_CODE_TTL_MS).toISOString()]) // expired sweep
      tx.sql('DELETE FROM telegram_links WHERE user_id = ?', [user.id]) // one active code per account
      tx.sql('INSERT INTO telegram_links (code, user_id, created_at) VALUES (?, ?, ?)', [code, user.id, new Date().toISOString()])
    })
    return c.json({ ok: true, code })
  })

  // Authed status for Settings: is this account linked, and where is the bot?
  app.get('/api/telegram/status', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    return c.json({ ok: true, bot: TELEGRAM_BOT.handle, botUrl: TELEGRAM_BOT.url, linked: !!user.telegram_chat_id, chat_id: user.telegram_chat_id })
  })

  // Unlink: severs the chat mapping for this account. Captures already assigned stay —
  // they are account data now (rule 1); only the delivery channel is cut.
  app.delete('/api/telegram/link', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [user.id])
      tx.sql('DELETE FROM telegram_links WHERE user_id = ?', [user.id])
    })
    return c.json({ ok: true })
  })
}
