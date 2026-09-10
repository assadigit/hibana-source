import { log } from '../lib/log'

// Dead-man's switch (dr-integrity session, docs/dr-integrity-closeout.md §1).
//
// Every alert Hibana owns travels through the Worker itself (Resend email, Telegram bot
// messages) — and the external uptime monitor only proves that /api/health answers, not
// that the scheduled trigger FIRES. If the cron dies silently (CF scheduled-trigger
// outage, a deploy that drops [triggers], a mis-wired env), the app looks healthy while
// no backup has run for days. The fix: on every successful backup tick the cron pings an
// external healthchecks.io URL, and that service alerts when the pings STOP. The watchdog
// lives outside Cloudflare on purpose — otherwise it shares the failure domain it guards.
//
// Semantics (healthchecks.io):
//   GET <base>        → success ping (resets the timer)
//   GET <base>/fail   → explicit failure (alerts immediately, not after the grace period)
//
// Hard rules, mirroring the Plan B failure-domain discipline:
//   - NEVER throws: a watchdog ping that could take down the backup chain would be worse
//     than no watchdog. All outcomes are logged and swallowed.
//   - 10s timeout — hc-ping answers in ~100 ms; we never let a slow watchdog stall a cron
//     that still has purge/reminders to run.
//   - Plain fetch: identical on Workers and Node (portability rule).

const PING_TIMEOUT_MS = 10_000

/** healthchecks.io base URL (no trailing slash, no path) — e.g. https://hc-ping.com/<uuid>. */
export function normalizePingUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.toString().replace(/\/+$/, '')
}

/**
 * Fire one dead-man's-switch ping. `ok=false` pings `<base>/fail` (immediate alert);
 * `ok=true` pings the base URL (timer reset). Never throws — returns true iff a 2xx was
 * received, so the caller can log (and only log) a watchdog outage.
 */
export async function pingHealthcheck(rawUrl: string, ok: boolean): Promise<boolean> {
  const base = normalizePingUrl(rawUrl)
  if (!base) {
    log.warn('healthcheck_skipped', { reason: 'invalid ping URL' })
    return false
  }
  const target = ok ? base : `${base}/fail`
  try {
    const res = await fetch(target, {
      method: 'GET',
      // healthchecks.io treats a body-less GET as a signal; keep it minimal and cache-proof.
      headers: { 'User-Agent': 'hibana-cron/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      // A dead-man's ping is one packet — redirect-following is unnecessary but harmless.
      redirect: 'follow',
    })
    if (!res.ok) {
      log.warn('healthcheck_ping_rejected', { status: res.status, fail: !ok })
      return false
    }
    return true
  } catch (err) {
    log.warn('healthcheck_ping_failed', { err: err instanceof Error ? err.message : String(err), fail: !ok })
    return false
  }
}
