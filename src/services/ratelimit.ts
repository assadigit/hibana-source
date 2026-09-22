// Spec §15 — basic rate limiting on the internet-facing endpoints. The preferred layer
// is Cloudflare free-tier rules (scripts/rate-limit.mjs), but the app enforces the same
// limits itself so the protection exists even without zone-WAF access (and on the Node
// port): fixed 60s windows per client IP, D1-backed (survives Worker restarts).
// Limits mirror the CF rule values: 30 req/60s for login + password reset, 300 req/60s
// for the Telegram webhook.

import type { Db } from '../db/types'
import { log } from '../lib/log'

interface RateRule {
  /** short key segment for the DB row, e.g. 'login' */
  name: string
  limit: number
  windowSec: number
}

export const RATE_RULES = {
  auth: { name: 'auth', limit: 30, windowSec: 60 },
  webhook: { name: 'webhook', limit: 300, windowSec: 60 },
  // Heavy authenticated endpoints (hardening 2026-08-28): export runs a ~20-query
  // user-scoped snapshot; import inflates and inserts unbounded rows; canvas sync can
  // carry 500-element batches. Under open registration these were unmetered.
  export: { name: 'export', limit: 10, windowSec: 60 },
  import: { name: 'import', limit: 5, windowSec: 60 },
  upload: { name: 'upload', limit: 30, windowSec: 60 },
  // L4 fix (2026-09-10): broadcast sends up to 40 sequential Resend API calls per request.
  // 2 per 60s per IP is generous for a real broadcast (owner-only) but stops a runaway
  // script or a compromised owner session from flooding Resend's API.
  broadcast: { name: 'broadcast', limit: 2, windowSec: 60 },
  // SWOT T-low: AI Magic Button (Workers AI). 20 req/60s per IP — generous for normal
  // use (the Magic Button is a per-task action, not a bulk operation) but stops a
  // runaway script from burning the free-tier neuron budget (10k/day).
  ai: { name: 'ai', limit: 20, windowSec: 60 },
} as const satisfies Record<string, RateRule>

/**
 * Counts one request from `ip` against `rule`. Returns true when the limit is
 * exceeded (caller replies 429). Best-effort: a DB failure never blocks the request
 * (P2.7/F-L11: fail-open is a deliberate availability tradeoff — the CF WAF rate-limiting
 * rule is the primary defense; this in-app limiter is secondary).
 *
 * P3.4 (F-L2): single UPSERT (was SELECT + INSERT/UPDATE = 2 round trips per
 * limited request). Uses INSERT ... ON CONFLICT(key) DO UPDATE with a CASE on
 * window_start to reset the count when the window rolled over. RETURNING (count > limit)
 * gives the over/under in the same statement.
 */
export async function hitRateLimit(db: Db, rule: RateRule, ip: string): Promise<boolean> {
  // S105 (2026-09-21, root cause of the recurring CI login-timeout flakes — S103 saw it
  // once, S105 twice in a row): the e2e suite logs in ~180 times from ONE client IP
  // (127.0.0.1 — the playwright server is single-origin by design), and a burst of fast
  // tests can put >30 logins inside one rolling 60s window. The limiter then answers the
  // 31st login with a 429/htmx-error-fragment → the shared login() helper's
  // waitForURL('**/app') times out → "1 failed" that walks to a DIFFERENT test every run
  // (whichever falls on the 31st+ login of the burst), and its within-run retry fails too
  // (the window is still saturated seconds later). Playwright's webServer now sets
  // RATE_LIMIT_DISABLE=1 (playwright.config.ts) so the scripted suite is never limited.
  // The flag is TEST-ONLY: prod/dev deploys never set it (not in wrangler.toml, not in
  // .dev.vars), and the vitest pins below run with it unset — the limiter's real
  // behavior stays fully covered.
  // S108 (2026-09-22, P0 hotfix — caught live): the S105 guard read bare
  // `process.env.RATE_LIMIT_DISABLE`, and Cloudflare Workers HAS NO `process` global —
  // every hitRateLimit caller (login, signup, password reset, uploads, AI, exports,
  // import, telegram webhook) threw `ReferenceError: process is not defined` and
  // app.onError turned it into a 500 on EVERY rate-limited request in prod (three
  // login 500s sat in the live error_log; the owner's own sign-in attempt included).
  // The `typeof` guard keeps the Node/test contract EXACTLY (vitest + playwright still
  // set RATE_LIMIT_DISABLE=1 through process.env) and never throws on the Workers
  // runtime, where the flag is simply absent — the limiter runs for real, as designed.
  if (typeof process !== 'undefined' && process.env.RATE_LIMIT_DISABLE === '1') return false
  const nowS = Math.floor(Date.now() / 1000)
  const bucket = Math.floor(nowS / rule.windowSec) * rule.windowSec
  const key = `${rule.name}:${ip}`
  try {
    const rows = await db.query<{ over: number }>(
      `INSERT INTO rate_limits (key, window_start, count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start,
         updated_at = excluded.updated_at
       RETURNING (count > ?) AS over`,
      [key, bucket, new Date().toISOString(), rule.limit],
    )
    return rows[0]?.over === 1
  } catch (err) {
    // Never fail the app because the guard itself hiccuped.
    // P3.1 (F-M12): structured log instead of console.error.
    log.error('rate_limiter_error', { err: err instanceof Error ? { message: err.message } : String(err) })
    return false
  }
}

/** Client IP seen at the edge: Cloudflare's header on the Worker, x-forwarded-for elsewhere. */
export function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}