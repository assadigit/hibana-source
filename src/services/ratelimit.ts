// Spec §15 — basic rate limiting on the internet-facing endpoints. The preferred layer
// is Cloudflare free-tier rules (scripts/rate-limit.mjs), but the app enforces the same
// limits itself so the protection exists even without zone-WAF access (and on the Node
// port): fixed 60s windows per client IP, D1-backed (survives Worker restarts).
// Limits mirror the CF rule values: 30 req/60s for login + password reset, 300 req/60s
// for the Telegram webhook.

import type { Db } from '../db/types'

export interface RateRule {
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
} as const satisfies Record<string, RateRule>

/**
 * Counts one request from `ip` against `rule`. Returns true when the limit is
 * exceeded (caller replies 429). Best-effort: a DB failure never blocks the request.
 */
export async function hitRateLimit(db: Db, rule: RateRule, ip: string): Promise<boolean> {
  const nowS = Math.floor(Date.now() / 1000)
  const bucket = Math.floor(nowS / rule.windowSec) * rule.windowSec
  const key = `${rule.name}:${ip}`
  try {
    const rows = await db.query<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limits WHERE key = ?', [key])
    if (rows.length === 0) {
      await db.execute('INSERT INTO rate_limits (key, window_start, count, updated_at) VALUES (?, ?, 1, ?)', [key, bucket, new Date().toISOString()])
      return false
    }
    if (rows[0].window_start !== bucket) {
      await db.execute('UPDATE rate_limits SET window_start = ?, count = 1, updated_at = ? WHERE key = ?', [bucket, new Date().toISOString(), key])
      return false
    }
    const count = rows[0].count + 1
    await db.execute('UPDATE rate_limits SET count = ?, updated_at = ? WHERE key = ?', [count, new Date().toISOString(), key])
    return count > rule.limit
  } catch (err) {
    // Never fail the app because the guard itself hiccuped.
    console.error('rate limiter error:', err)
    return false
  }
}

/** Client IP seen at the edge: Cloudflare's header on the Worker, x-forwarded-for elsewhere. */
export function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
}