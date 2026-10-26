import type { Db, ExecResult, Row } from '../db/types'

// D1 (workerd) caps a single prepared statement at 100 bound parameters — above it the
// query fails with D1_ERROR "too many SQL variables" (verified live on wrangler dev
// --local: 100 params OK, 101 fails). node:sqlite has no such cap, so the vitest suite
// can NEVER surface this failure class. Several app surfaces are user-reachable beyond
// 99 ids — the canvas offline-sync schema allows 500 elements per POST, a spark shelf
// can hold hundreds of projects feeding the grouped lookups, and a done-task archive
// can exceed 99 rows — so every unbounded IN (...) must run in chunks.
//
// Usage: the SQL template marks the placeholder list with the literal token {{IN}}.
// Parameters listed BEFORE the ids go in `before`, AFTER them in `after`. The helper
// replaces the token with the per-chunk placeholder list and merges rows / sums
// changes. Fixed-size lists (≤ a known small bound) may keep a plain IN — this helper
// is for the unbounded/user-reachable ones.

const D1_PARAM_CAP = 100
const TOKEN = '{{IN}}'

const ph = (n: number) => `(${Array.from({ length: n }, () => '?').join(',')})`

function chunkSize(before: unknown[], after: unknown[]): number {
  return Math.max(1, D1_PARAM_CAP - before.length - after.length)
}

/** SELECT with an unbounded IN list, chunked under D1's 100-param cap; rows merged. */
export async function queryIn<T = Row>(
  db: Db,
  sql: string,
  before: unknown[],
  ids: unknown[],
  after: unknown[] = [],
): Promise<T[]> {
  if (ids.length === 0) return []
  if (!sql.includes(TOKEN)) throw new Error('queryIn: SQL template is missing the {{IN}} marker')
  const per = chunkSize(before, after)
  if (ids.length <= per) {
    return db.query<T>(sql.replace(TOKEN, ph(ids.length)), [...before, ...ids, ...after])
  }
  const out: T[] = []
  for (let i = 0; i < ids.length; i += per) {
    const part = ids.slice(i, i + per)
    const rows = await db.query<T>(sql.replace(TOKEN, ph(part.length)), [...before, ...part, ...after])
    out.push(...rows)
  }
  return out
}

/** UPDATE/DELETE with an unbounded IN list, chunked under D1's 100-param cap; changes summed. */
export async function executeIn(
  db: Db,
  sql: string,
  before: unknown[],
  ids: unknown[],
  after: unknown[] = [],
): Promise<ExecResult> {
  if (ids.length === 0) return { changes: 0 }
  if (!sql.includes(TOKEN)) throw new Error('executeIn: SQL template is missing the {{IN}} marker')
  const per = chunkSize(before, after)
  if (ids.length <= per) {
    return db.execute(sql.replace(TOKEN, ph(ids.length)), [...before, ...ids, ...after])
  }
  let changes = 0
  let lastRowId: number | bigint | undefined
  for (let i = 0; i < ids.length; i += per) {
    const part = ids.slice(i, i + per)
    const r = await db.execute(sql.replace(TOKEN, ph(part.length)), [...before, ...part, ...after])
    changes += r.changes
    lastRowId = r.lastRowId ?? lastRowId
  }
  return { changes, lastRowId }
}
