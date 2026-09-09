import { log } from '../lib/log'
import type { Db } from '../db/types'

// Error observability (dr-integrity session, migration 0045, docs/dr-integrity-closeout.md §4).
//
// app.onError now persists what it sees: unhandled throws (500) always; ApiErrors with
// their status + code. Volume at solo scale is tiny, and 400/401 *patterns* are a security
// signal (credential stuffing shows up as auth_invalid bursts), so nothing is filtered —
// the 7-day retention in scheduledPurge keeps the table bounded.
//
// The recorder is self-guarding: an INSERT failure must NEVER break the error response
// the user is waiting for (if D1 is the thing failing, the console fallback stays
// `wrangler tail` — documented honestly in runbook §5).

export interface ErrorRecord {
  reqId?: string
  userId?: string
  path: string
  status: number
  code?: string
  message?: string
  stack?: string
}

/** Best-effort INSERT into error_log. Never throws; logs its own failures at warn level. */
export async function recordError(db: Db, rec: ErrorRecord): Promise<void> {
  try {
    await db.execute(
      'INSERT INTO error_log (id, created_at, req_id, user_id, path, status, code, message, stack) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(),
        new Date().toISOString(),
        rec.reqId ?? null,
        rec.userId ?? null,
        rec.path.slice(0, 500),
        rec.status,
        rec.code ?? null,
        rec.message?.slice(0, 2000) ?? null,
        rec.stack?.slice(0, 8000) ?? null,
      ],
    )
  } catch (err) {
    log.warn('error_log_write_failed', { err: err instanceof Error ? err.message : String(err) })
  }
}
