import { createApp } from './app'
import { createD1Db } from './db/d1'
import { classifyTick } from './lib/cron'
import { scheduledBackup, scheduledPurge, type BackupOutcome } from './routes/admin'
import { runReminders } from './services/reminders'
import { runSadhanaReminders, sweepCompletedTasks, resetDueRecurring } from './services/sadhana'
import { pingHealthcheck } from './services/healthcheck'
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
    backupEncryptionKey: env.BACKUP_ENCRYPTION_KEY,
    // Dead-man's switch (dr-integrity session): prod-only secret; unset = feature off.
    healthcheckUrl: env.HEALTHCHECK_PING_URL,
    // Mirror origins for the CSRF gate (docs/edge-mirror.md) — full origins, trailing
    // slashes stripped; empty when unset (the gate then trusts only the request's own origin).
    mirrorOrigins: (env.MIRROR_ORIGIN ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((o) => o.replace(/\/+$/, '')),
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
  // must NOT multiply ×4 — they stay pinned to the 03:17 run only (classifyTick keys the
  // daily slot on the trigger's scheduled hour, so a late-firing 03:17 still counts).
  // v0.3.2: the tick TYPE comes from the trigger that fired (controller.cron), not the
  // wall clock — CF fires scheduled events with jitter, and the old clock rule
  // (`minute % 30 !== 0` ⇒ backup) misread a */30 event landing at :31 as a backup tick
  // (observed live 2026-09-07 15:31:18 UTC: a second backup + an extra watchdog ping,
  // which could mask a dead cron). The daily slot keys on the trigger's SCHEDULED hour
  // (classifyTick → scheduledTime), so a late-firing 03:17 still counts as the daily run.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cfg = buildConfig(env)
    const { backupTick, dailyTick } = classifyTick(controller)
    // P1.4 (F-L3): run the jobs SEQUENTIALLY, not via Promise.all. They share the Worker's
    // CPU + subrequest budget, so concurrent backup (28 SELECTs + GitHub PUT + retention
    // deletes) and reminders (task scan + Resend emails) could starve each other. The
    // sequence is cheap-to-expensive: backup (DB + GitHub) → purge (DB) → sweep (DB) →
    // Sadhana reminders (DB + Resend) → client reminders (Resend). A failure in an early
    // step now blocks later steps — acceptable: a failed backup should not fire emails.
    ctx.waitUntil(
      (async () => {
        const backupResult: BackupOutcome | null = backupTick ? await scheduledBackup(cfg) : null
        // Plan B (0044 → session 14): the Telegram backup channel is ON-DEMAND ONLY now —
        // the owner asks for a document from the bot's ⚙ Settings (🗄 item) or the admin
        // route. The automatic 4×/day push was removed per user request (it filled the
        // chat with backup documents); the GitHub channel above remains the automatic
        // path and still pings the watchdog below.
        // Dead-man's switch (dr-integrity session, docs/dr-integrity-closeout.md §1):
        // after the automatic backup completes, ping the external watchdog. Runs ONLY on
        // the prod worker with the secret set — a dev tick must never reset the prod timer
        // (same masking reasoning the old Plan B prod gate used). Success ping only when
        // the PRIMARY channel actually pushed; a failed OR skipped backup (e.g. missing
        // GITHUB_TOKEN in prod — as dangerous as a failure) pings /fail, which alerts
        // immediately instead of waiting out the grace period. pingHealthcheck never
        // throws, so the watchdog can never break the remaining cron jobs below.
        // Manual POST /api/admin/backup deliberately does NOT ping: a heartbeat must
        // only beat for the automated path it guards.
        if (backupResult && cfg.isProd && cfg.healthcheckUrl) {
          await pingHealthcheck(cfg.healthcheckUrl, backupResult.kind === 'pushed')
        }
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