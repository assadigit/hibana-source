// The one database abstraction in the app. Everything goes through this interface so the
// same code runs on Cloudflare D1 and on plain Node/better-sqlite3 (portability requirement).
// Same SQL, same migrations — only the adapter changes.

export type SqlValue = string | number | boolean | null | Uint8Array

export interface Row {
  [k: string]: unknown
}

export interface ExecResult {
  changes: number
  lastRowId?: number | bigint
}

/** Writes queued inside a transaction. Reads happen outside the tx (matches D1 batch semantics). */
export interface Tx {
  sql(sql: string, params?: unknown[]): void
}

export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<ExecResult>
  /**
   * D1/batch semantics (P1.6 / F-M13): statements queued via `tx.sql()` inside `fn` are
   * executed atomically by `d1.batch()` AFTER `fn` returns. Reads performed inside `fn`
   * see PRE-batch state and are NOT isolated from concurrent writes.
   *
   * Convention: use this ONLY for write-only batches. For a read-modify-write that must
   * be atomic, use a single `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement
   * (one statement = one atomic D1 op) instead of a transaction.
   *
   * Today every call site is write-only (the abstraction cannot enforce this), so the
   * pre-batch read gap is latent — this comment exists so the next dev doesn't write a
   * non-atomic read-modify-write inside `fn`.
   */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}