import { DatabaseSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
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

  // AP-15 (fixed, Phase 2): one shared connection means BEGIN…COMMIT must never
  // interleave. The old transaction() awaited fn() between BEGIN and COMMIT, so
  // concurrent requests interleaved: the loser's BEGIN hit "cannot start a transaction
  // within a transaction" (a 500), a plain write landed INSIDE the open transaction and
  // was silently rolled back with it, and a plain read saw uncommitted rows. D1
  // serializes its API calls, so the mutex below is parity, not new behavior: every
  // statement and transaction on this connection goes through a FIFO promise-chain
  // mutex. Statements issued from INSIDE the transaction's own async context (tracked
  // via AsyncLocalStorage) bypass the mutex and join the open transaction — the
  // read-your-writes path for transaction fns (all current call sites are tx.sql-only,
  // so this is purely a future-proofing escape hatch).
  const txContext = new AsyncLocalStorage<{ owner: true }>()
  let txTail: Promise<void> = Promise.resolve()
  const acquire = (): Promise<() => void> => {
    const prev = txTail
    let release!: () => void
    txTail = new Promise<void>((r) => { release = r })
    return prev.then(() => release)
  }

  // SQLite has no boolean type; D1 stores them as 0/1 — normalize here so both
  // adapters behave identically for the same SQL and parameters (rule 4).
  const norm = (params: unknown[]): SQLInputValue[] =>
    params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : (p as SQLInputValue)))
  return {
    async query<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      if (txContext.getStore()) return db.prepare(sql).all(...norm(params)) as T[]
      const release = await acquire()
      try {
        return db.prepare(sql).all(...norm(params)) as T[]
      } finally {
        release()
      }
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
      const run = (): ExecResult => {
        const r = db.prepare(sql).run(...norm(params))
        return { changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) }
      }
      if (txContext.getStore()) return run()
      const release = await acquire()
      try {
        return run()
      } finally {
        release()
      }
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      // Fail fast with a clear error instead of deadlocking on the mutex.
      if (txContext.getStore()) {
        throw new Error('nested db.transaction is not supported — use tx.sql() only inside a transaction (see Db.transaction doc)')
      }
      const release = await acquire()
      try {
        db.exec('BEGIN')
        const tx: Tx = {
          sql: (sql, params = []) => {
            db.prepare(sql).run(...norm(params))
          },
        }
        const result = await txContext.run({ owner: true }, fn, tx)
        db.exec('COMMIT')
        return result
      } catch (err) {
        // ROLLBACK can itself throw if SQLite already auto-rolled-back the
        // transaction — never mask the original error.
        try {
          db.exec('ROLLBACK')
        } catch {
          /* transaction already closed by SQLite */
        }
        throw err
      } finally {
        release()
      }
    },
    close: () => db.close(),
  }
}

export interface SqliteDb extends Db {
  close(): void
}
