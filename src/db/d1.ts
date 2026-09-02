import type { D1Database } from '@cloudflare/workers-types'
import type { Db, ExecResult, Row, SqlValue, Tx } from './types'

// Cloudflare D1 adapter. D1 has no begin/commit — `batch()` runs statements in a single
// transaction (all-or-nothing), which is what the Tx interface models.
export function createD1Db(d1: D1Database): Db {
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const res = await d1.prepare(sql).bind(...params).all<T>()
      return res.results
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
      const res = await d1.prepare(sql).bind(...params).run()
      return { changes: res.meta.changes, lastRowId: res.meta.last_row_id }
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const stmts: { sql: string; params: unknown[] }[] = []
      const tx: Tx = {
        sql: (sql, params = []) => stmts.push({ sql, params }),
      }
      const result = await fn(tx)
      if (stmts.length > 0) {
        await d1.batch(stmts.map((s) => d1.prepare(s.sql).bind(...s.params)))
      }
      return result
    },
  }
}