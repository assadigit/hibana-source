import { DatabaseSync } from 'node:sqlite'
import type { Db, ExecResult, Row, SqlValue, Tx } from './types'

type SQLInputValue = string | number | bigint | null | Uint8Array

// better-sqlite3-free adapter using Node's built-in SQLite (node:sqlite, stable since
// Node 24). Zero native dependencies — nothing to compile, nothing to break on a Node
// upgrade. Used by tests, the Node server, and any non-Cloudflare deploy.
// Same SQL as the D1 adapter; only the driver differs.
export function createSqliteDb(file: string): SqliteDb {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // SQLite has no boolean type; D1 stores them as 0/1 — normalize here so both
  // adapters behave identically for the same SQL and parameters (rule 4).
  const norm = (params: unknown[]): SQLInputValue[] =>
    params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : (p as SQLInputValue)))
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...norm(params)) as T[]
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
      const r = db.prepare(sql).run(...norm(params))
      return { changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) }
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      db.exec('BEGIN')
      try {
        const tx: Tx = {
          sql: (sql, params = []) => {
            db.prepare(sql).run(...norm(params))
          },
        }
        const result = await fn(tx)
        db.exec('COMMIT')
        return result
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    close: () => db.close(),
  }
}

export interface SqliteDb extends Db {
  close(): void
}