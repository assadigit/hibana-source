import { Hono } from 'hono'
import { githubClient } from '../services/github'
import { requireAuth } from '../auth/middleware'
import { isHtmx, esc } from '../lib/http'
import { trFor } from '../lib/i18n'
import type { Config, UserRow } from '../types'

export function devRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

  app.get('/github-ping', requireAuth(cfg), async (c) => {
    const t = trFor(c)
    // Owner-only (SECURITY FIX 2026-08-28, matching the other three dev routes): this route
    // WRITES into the private GitHub assets repo and used to hand its URL to any member —
    // an unbounded repo-pollution vector under open registration.
    const user = c.get('user')
    if (user.role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    const g = cfg.github
    if (!g.token || !g.owner) {
      const msg = 'GitHub not configured — set the GITHUB_TOKEN secret and GITHUB_OWNER var.'
      if (isHtmx(c)) return c.html(`<div class="ping-result err">${esc(t(msg, 'گیت‌هاب تنظیم نشده — توکن GITHUB_TOKEN و متغیر GITHUB_OWNER را تنظیم کن.'))}</div>`)
      return c.json({ ok: false, error: msg }, 503)
    }

    const gh = githubClient(g)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `phase0/ping-${ts}.txt`
    const content = `Hibana phase-0 ping ${ts}\n`

    try {
      const pushed = await gh.pushFile(path, btoa(content), 'Hibana phase-0 ping')
      // Rule 7: read back with the raw Accept header from day one — this is the
      // quirk that silently empties >1MB files if forgotten.
      const readBack = await gh.readRaw(path)
      const ok = readBack === content
      const result = { ok, path, readBackMatches: ok, readBackLength: readBack.length, url: pushed.html_url }

      if (isHtmx(c)) {
        return c.html(
          `<div class="ping-result ${ok ? 'ok' : 'err'}">` +
            t(ok ? 'GitHub pipeline OK — test file pushed and read back.' : 'Read-back mismatch — file landed but content differs.', ok ? 'پایپلاین گیت‌هاب سالم است — فایل آزمایشی ارسال و بازخوانی شد.' : 'در بازخوانی ناهماهنگی وجود دارد — فایل آپلود شده اما محتوا متفاوت است.') +
            ` <a href="${esc(result.url)}" target="_blank">${t('view', 'مشاهده')}</a></div>`,
        )
      }
      return c.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (isHtmx(c)) return c.html(`<div class="ping-result err">${esc(t('GitHub ping failed: {err}', 'خطای پینگ گیت‌هاب: {err}', { err: msg }))}</div>`)
      return c.json({ ok: false, error: msg }, 502)
    }
  })

  app.post('/telegram-webhook', requireAuth(cfg), async (c) => {
    // Registers the bot webhook FROM the worker (Cloudflare reaches Telegram even when a
    // local sandbox cannot). Owner-only; uses the worker's own token + secret (rule 11).
    // Optional ?host= override points the bot at any base (e.g. prod's workers.dev URL
    // before the custom domain is live); defaults to the environment's canonical base.
    const user = c.get('user')
    if (user.role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    if (!cfg.telegramToken || !cfg.telegramSecret) return c.json({ error: 'telegram_not_configured' }, 503)
    const defaultBase = cfg.isProd ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
    const base = c.req.query('host') ?? defaultBase
    const res = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${base}/api/telegram/webhook`, secret_token: cfg.telegramSecret }),
    })
    const json = (await res.json()) as { ok?: boolean; description?: string }
    return c.json(json.ok ? { ok: true, url: `${base}/api/telegram/webhook` } : { error: json.description ?? 'webhook failed' }, json.ok ? 200 : 502)
  })

  app.get('/telegram-status', requireAuth(cfg), async (c) => {
    // Owner-only, browser-openable: reports what the bot is actually configured to do by
    // asking Telegram itself (getMe + getWebhookInfo). The Worker can reach api.telegram.org
    // when a local sandbox cannot, so this is the one place the live registration is visible
    // (same pattern as the webhook setter above). Never returns the token or secret.
    const user = c.get('user')
    if (user.role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    if (!cfg.telegramToken) return c.json({ error: 'telegram_not_configured' }, 503)
    const tg = (method: string) =>
      fetch(`https://api.telegram.org/bot${cfg.telegramToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    const [me, info] = await Promise.all([tg('getMe'), tg('getWebhookInfo')])
    const meJson = (await me.json()) as { ok?: boolean; result?: { username?: string } }
    const infoJson = (await info.json()) as {
      ok?: boolean
      result?: { url?: string; pending_update_count?: number; last_error_message?: string }
    }
    const defaultBase = cfg.isProd ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
    const expected = `${defaultBase}/api/telegram/webhook`
    const actual = infoJson.result?.url ?? null
    return c.json({
      ok: meJson.ok === true && infoJson.ok === true,
      bot: meJson.ok && meJson.result?.username ? `@${meJson.result.username}` : null,
      environment: cfg.isProd ? 'prod' : 'dev',
      expected_webhook: expected,
      webhook_url: actual,
      points_here: actual === expected,
      pending_updates: infoJson.result?.pending_update_count ?? null,
      last_error: infoJson.result?.last_error_message ?? null,
    })
  })

  app.post('/test-email', requireAuth(cfg), async (c) => {
    // Sends a verification email via the worker (Resend). Confirms the SMTP-style API path works.
    const user = c.get('user')
    if (user.role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    if (!cfg.emailKey || !cfg.ownerEmail) return c.json({ error: 'email_not_configured' }, 503)
    const { resendEmail, verifyEmailHtml } = await import('../services/email')
    // ?template=verify reuses the signup confirmation template + subject — reproduces the
    // exact send the register flow makes (2026-08-24: signup emails failed while the simple
    // template succeeded, so the template path needs its own probe).
    // ?to=<email> overrides the recipient: proves sends to NON-owner addresses work now
    // that the sending domain (hibana.ir) is verified. Owner-only route.
    const verify = c.req.query('template') === 'verify'
    const to = c.req.query('to') ?? cfg.ownerEmail
    try {
      await resendEmail(cfg.emailKey).send(
        to,
        verify ? 'Hibana — confirm your email' : 'Hibana — email setup verified',
        verify ? verifyEmailHtml('1234') : '<p>Your Hibana email pipeline works. Password resets and client reminders will now reach you.</p>',
      )
      return c.json({ ok: true, to, template: verify ? 'verify' : 'default' })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'send failed' }, 502)
    }
  })

  return app
}