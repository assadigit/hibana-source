import { describe, it, expect } from 'vitest'
import { makeTestDb } from './helpers'
import { queryIn, executeIn } from '../lib/inchunk'
import type { Db } from '../db/types'

// AP-20 (Phase 2): D1 caps one prepared statement at 100 bound params — the canvas
// offline sync (schema cap 500 elements), grouped project lookups, and batched tag
// rewrites are all user-reachable beyond 99 ids. queryIn/executeIn chunk those IN
// lists. The vitest suite runs on node:sqlite (no cap), so these tests pin the
// CHUNKING CONTRACT itself: every emitted statement stays ≤ 100 params, chunks merge
// rows / sum changes, and the single-statement fast path is preserved.

function wrap(db: Db, seen: number[]): Db {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      seen.push(params.length)
      return db.query(sql, params)
    },
    execute: async (sql: string, params: unknown[] = []) => {
      seen.push(params.length)
      return db.execute(sql, params)
    },
    transaction: (fn) => db.transaction(fn),
  }
}

describe('chunked IN lists (AP-20 — D1 100-param cap)', () => {
  it('queryIn: 250 ids → 3 chunked statements (≤100 params each), all rows merged', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE inchunk (id TEXT PRIMARY KEY, n INTEGER)')
      const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
      for (let i = 0; i < ids.length; i += 50) {
        await db.transaction(async (tx) => {
          for (const id of ids.slice(i, i + 50)) tx.sql('INSERT INTO inchunk (id, n) VALUES (?, ?)', [id, 1])
        })
      }
      const seen: number[] = []
      const rows = await queryIn<{ id: string }>(wrap(db, seen), 'SELECT id FROM inchunk WHERE id IN {{IN}}', [], ids)
      expect(rows.length).toBe(250)
      expect(seen.length).toBe(3) // 100 + 100 + 50 (the cap is inclusive: 100 params OK, 101 fails)
      for (const n of seen) expect(n).toBeLessThanOrEqual(100)
      expect(seen[0]).toBe(100)
      expect(seen[2]).toBe(50)
    } finally {
      close()
    }
  })

  it('queryIn: before/after params are positioned around each chunk (≤100 total)', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE inchunk2 (id TEXT PRIMARY KEY, user_id TEXT, n INTEGER)')
      const ids = Array.from({ length: 130 }, (_, i) => `x-${i}`)
      const seen: number[] = []
      const rows = await queryIn<{ id: string }>(
        wrap(db, seen),
        'SELECT id FROM inchunk2 WHERE user_id = ? AND id IN {{IN}} AND n IS NULL ORDER BY id',
        ['u1'],
        ids,
        [],
      )
      expect(rows.length).toBe(0) // table is empty — but the statement must have executed chunked
      expect(seen).toEqual([100, 32]) // 1 before + 99 ids = 100 params, then 1 + 30 = 31... chunked as 99+31 ids
      for (const n of seen) expect(n).toBeLessThanOrEqual(100)
    } finally {
      close()
    }
  })

  it('queryIn: ≤99 ids take the single-statement fast path (no chunking overhead)', async () => {
    const { db, close } = makeTestDb()
    try {
      const seen: number[] = []
      const rows = await queryIn(wrap(db, seen), 'SELECT 1 AS one WHERE 1 IN {{IN}}', [], [1, 2, 3])
      expect(rows.length).toBe(1)
      expect(seen).toEqual([3])
    } finally {
      close()
    }
  })

  it('queryIn: empty id list → no statement at all; missing {{IN}} token → clear error', async () => {
    const { db, close } = makeTestDb()
    try {
      const seen: number[] = []
      const w = wrap(db, seen)
      expect(await queryIn(w, 'SELECT 1 WHERE 1 IN {{IN}}', [], [])).toEqual([])
      expect(seen.length).toBe(0)
      await expect(queryIn(w, 'SELECT 1 WHERE 1 IN (?)', [], [1])).rejects.toThrow(/{{IN}}/)
      await expect(executeIn(w, 'DELETE FROM t WHERE id IN (?)', [], [1])).rejects.toThrow(/{{IN}}/)
    } finally {
      close()
    }
  })

  it('executeIn: 250-row DELETE chunks and sums changes (≤100 params per statement)', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE inchunk3 (id TEXT PRIMARY KEY)')
      const ids = Array.from({ length: 250 }, (_, i) => `d-${i}`)
      await db.transaction(async (tx) => {
        for (const id of ids) tx.sql('INSERT INTO inchunk3 (id) VALUES (?)', [id])
      })
      const seen: number[] = []
      const r = await executeIn(wrap(db, seen), 'DELETE FROM inchunk3 WHERE id IN {{IN}}', [], ids)
      expect(r.changes).toBe(250)
      expect(seen).toEqual([100, 100, 50])
      for (const n of seen) expect(n).toBeLessThanOrEqual(100)
      const left = await db.query<{ c: number }>('SELECT COUNT(*) AS c FROM inchunk3')
      expect(left[0].c).toBe(0)
    } finally {
      close()
    }
  })
})
