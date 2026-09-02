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
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}