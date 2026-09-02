import { createApp } from './app'
import { createD1Db } from './db/d1'
import { scheduledBackup, scheduledPurge } from './routes/admin'
import { runReminders } from './services/reminders'
import { runSadhanaReminders, sweepCompletedTasks, resetDueRecurring } from './services/sadhana'
import type { Config, Env } from './types'

// Cloudflare Workers entry — a thin shell over createApp() plus the daily cron.
// D1 + the static-assets binding are injected here; every other contract is CF-agnostic.

function buildConfig(env: Env): Config {
  return {
    db: createD1Db(env.DB),
    // workers-types' Response type differs slightly from the DOM one — the cast keeps the
    // Config contract runtime-agnostic (Node's Response is the DOM-aligned global).
    assets: (url) => env.ASSETS.fetch(url) as Promise<Response>,
    isProd: env.ENVIRONMENT === 'prod',
    github: { owner: env.GITHUB_OWNER ?? '', repo: env.GITHUB_REPO ?? '', token: env.GITHUB_TOKEN },
    emailKey: env.RESEND_KEY,
    ownerEmail: env.OWNER_EMAIL ?? '',
    telegramToken: env.TELEGRAM_BOT_TOKEN ?? '',
    telegramSecret: env.TELEGRAM_SECRET ?? '',
    captchaSecretKey: env.CAPTCHA_SECRET_KEY ?? env.TURNSTILE_SECRET_KEY,
    // math captcha — Turnstile secret kept as legacy fallback
    openRegistration: env.OPEN_REGISTRATION === 'true',
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createApp(buildConfig(env)).fetch(request, env)
  },
  // Scheduled triggers (wrangler.toml, batch r): backup 4×/day at :17 (03:17/09:17/15:17/21:17
  // UTC — "a very very recent backup to restore from"), plus the 30-minute cadence (spec
  // §7.3) that runs ONLY the Sadhana reminder pass (so the 2h-before-deadline window
  // actually works). The remaining daily jobs (purge, weekly sweep, client reminders)
  // must NOT multiply ×4 — they stay pinned to the 03:17 run only, so `hour === 3 &&
  // utcMin % 30 !== 0` uniquely identifies the daily slot, `utcMin % 30 !== 0` the backup
  // slots.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cfg = buildConfig(env)
    const now = new Date()
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes()
    const backupTick = utcMin % 30 !== 0
    const dailyTick = backupTick && now.getUTCHours() === 3
    // P1.4 (F-L3): run the jobs SEQUENTIALLY, not via Promise.all. They share the Worker's
    // CPU + subrequest budget, so concurrent backup (28 SELECTs + GitHub PUT + retention
    // deletes) and reminders (task scan + Resend emails) could starve each other. The
    // sequence is cheap-to-expensive: backup (DB + GitHub) → purge (DB) → sweep (DB) →
    // Sadhana reminders (DB + Resend) → client reminders (Resend). A failure in an early
    // step now blocks later steps — acceptable: a failed backup should not fire emails.
    ctx.waitUntil(
      (async () => {
        if (backupTick) await scheduledBackup(cfg)
        if (dailyTick) await scheduledPurge(cfg)
        // Sadhana weekly sweep (Mondays Asia/Tehran) — idempotent, daily is enough.
        if (dailyTick) await sweepCompletedTasks(cfg.db)
        // P5.1 (F-M1): resetDueRecurring moved off the dashboard read path to the daily
        // cron. Was a write on every dashboard GET; now runs once daily at the 03:17 tick.
        // Idempotent (only resets tasks past their due date), so daily is frequent enough.
        if (dailyTick) {
          const users = await cfg.db.query<{ id: string; timezone: string }>('SELECT id, timezone FROM users')
          for (const u of users) await resetDueRecurring(cfg.db, u.id, u.timezone)
        }
        // Sadhana deadline reminders (7d/3d/1d/0d/2h) — every tick (30-min cadence, §7.3).
        await runSadhanaReminders(cfg)
        // Client reminders go to the owner's email (the account is single-owner by design).
        if (dailyTick && cfg.emailKey && cfg.ownerEmail) await runReminders(cfg, cfg.ownerEmail)
      })(),
    )
  },
}