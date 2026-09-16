// Scheduled-tick classification (v0.3.2).
//
// The wrangler trigger set is ["17 3,9,15,21 * * *", "*/30 * * * *"]: backup ticks at
// :17 (03/09/15/21 UTC) and a half-hourly Sadhana-reminder cadence. Before v0.3.2 the
// handler classified each invocation by WALL-CLOCK minute (`minute % 30 !== 0` ⇒ backup
// tick) — but Cloudflare fires scheduled events with jitter, and a */30 event landing at
// :31 (observed live 2026-09-07 15:31:18 UTC: a second backup ran, and the healthchecks.io
// watchdog was reset by a ping that was not a backup heartbeat) got misread as a backup
// tick. That weakens the dead-man's switch — a random late half-hourly tick could keep
// resetting the timer while the real backup cron is dead. Classification now keys on
// `controller.cron` — the trigger that actually fired — which jitter cannot change.

/** The backup triggers, exactly as configured in wrangler.toml.
 *
 * S59: prod's backup cron moved :17 → :23 ([env.prod.triggers]) — the dev and prod
 * workers share the hibana-safe assets repo + GITHUB_TOKEN and used to fire at the
 * SAME second (both "17 3,9,15,21"): their concurrent Contents-API commits raced on
 * the repo's branch ref and the bigger (prod, ~600KB snapshot) PUT intermittently
 * lost — a missing prod snapshot + a /fail watchdog ping on ~40% of ticks
 * (9 fail pings 09-12→09-16, always with exactly dev's commit landed). Six minutes
 * apart means no shared window; both expressions stay recognized so old deploys
 * classify correctly too. */
export const BACKUP_CRONS = new Set(['17 3,9,15,21 * * *', '23 3,9,15,21 * * *'])

/** Legacy single-expression export (tests + any external pin) — the dev trigger. */
export const BACKUP_CRON = '17 3,9,15,21 * * *'

/** The minimum a scheduled controller must carry for classification. The real
 *  ScheduledController satisfies this structurally (cron: string, scheduledTime: number). */
interface TickController {
  cron?: string
  scheduledTime: number
}

/** Collapse whitespace so a toml-formatted expression still matches BACKUP_CRON. */
export function normalizeCron(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Which jobs this invocation should run, derived from the trigger (not the clock).
 * `dailyTick` is true only for the 03:xx backup run — keyed on the trigger's SCHEDULED
 * hour (`scheduledTime`), so a late-firing 03:17/03:23 event still runs the daily jobs
 * and no other backup slot ever will.
 */
export function classifyTick(
  controller: TickController,
  now = new Date(),
): { backupTick: boolean; dailyTick: boolean } {
  const cron = normalizeCron(controller.cron)
  if (cron) {
    const backupTick = BACKUP_CRONS.has(cron)
    const dailyTick = backupTick && new Date(controller.scheduledTime).getUTCHours() === 3
    return { backupTick, dailyTick }
  }
  // Fallback for harnesses that invoke scheduled() with no cron string: the legacy
  // wall-clock heuristic (kept for compatibility — jitter-blind by nature).
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  const backupTick = utcMin % 30 !== 0
  return { backupTick, dailyTick: backupTick && now.getUTCHours() === 3 }
}
