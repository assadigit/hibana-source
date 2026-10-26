import { describe, it, expect } from 'vitest'
import { makeTestDb } from './helpers'

// AUDIT AP-15 (Phase 2): the node:sqlite adapter's single shared connection could not
// host two OPEN transactions. transaction() awaited fn() between BEGIN and COMMIT, so
// concurrent requests interleaved: the loser's BEGIN hit "cannot start a transaction
// within a transaction" (or the COMMITs raced) and the route 500'd. Worse: a plain
// write from request B issued during request A's open transaction silently JOINED A's
// transaction on the shared connection — A's rollback then destroyed B's already-
// acknowledged write; a plain read observed A's uncommitted rows. D1 serializes its
// statements/batches and has none of these failure modes — these tests pin the Node
// adapter to the same contract (fix: a per-connection async mutex).

describe('node:sqlite adapter — concurrent transactions (AUDIT AP-15)', () => {
  it('two concurrent transactions both commit — no "cannot start a transaction" errors', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE conc_a (tag TEXT)')
      const out = await Promise.all([
        db.transaction(async (tx) => {
          tx.sql("INSERT INTO conc_a (tag) VALUES ('a1')")
          tx.sql("INSERT INTO conc_a (tag) VALUES ('a2')")
          return 'a'
        }),
        db.transaction(async (tx) => {
          tx.sql("INSERT INTO conc_a (tag) VALUES ('b1')")
          return 'b'
        }),
      ])
      expect(out.sort()).toEqual(['a', 'b'])
      const rows = await db.query<{ tag: string }>('SELECT tag FROM conc_a ORDER BY tag')
      expect(rows.map((r) => r.tag)).toEqual(['a1', 'a2', 'b1'])
    } finally {
      close()
    }
  })

  it('a plain write issued DURING an open transaction is not destroyed by that transaction\'s rollback', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE conc_b (tag TEXT)')
      let releaseA!: () => void
      const gateA = new Promise<void>((r) => { releaseA = r })
      const txnA = db.transaction(async (tx) => {
        tx.sql("INSERT INTO conc_b (tag) VALUES ('a-victim')")
        await gateA // request A goes async mid-transaction (the await gap)
        throw new Error('boom') // A fails → its own write must roll back
      })
      await Promise.resolve()
      await Promise.resolve() // A parks at its gate (BEGIN + insert already run)
      const writeB = db.execute("INSERT INTO conc_b (tag) VALUES ('b-survivor')") // request B's acknowledged write
      await Promise.resolve()
      await Promise.resolve()
      releaseA()
      await expect(txnA).rejects.toThrow('boom')
      await writeB
      const rows = await db.query<{ tag: string }>('SELECT tag FROM conc_b')
      expect(rows.map((r) => r.tag)).toEqual(['b-survivor']) // B's write survived A's rollback
    } finally {
      close()
    }
  })

  it('a concurrent READ waits for the open transaction instead of observing uncommitted rows', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE conc_c (tag TEXT)')
      let releaseA!: () => void
      const gateA = new Promise<void>((r) => { releaseA = r })
      const txnA = db.transaction(async (tx) => {
        tx.sql("INSERT INTO conc_c (tag) VALUES ('uncommitted')")
        await gateA
      })
      await Promise.resolve()
      await Promise.resolve()
      let readDone = false
      const readB = db.query<{ tag: string }>('SELECT tag FROM conc_c').then((r) => {
        readDone = true
        return r
      })
      // the read must NOT observe the uncommitted row — it stays parked until A commits
      await new Promise((r) => setTimeout(r, 25))
      expect(readDone).toBe(false)
      releaseA()
      await txnA
      const rows = await readB
      expect(rows.map((r) => r.tag)).toEqual(['uncommitted']) // post-commit: visible
    } finally {
      close()
    }
  })

  it('20 concurrent transactions all commit — every row lands exactly once (mutex drains fairly)', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE conc_d (n INTEGER)')
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          db.transaction(async (tx) => {
            tx.sql('INSERT INTO conc_d (n) VALUES (?)', [i])
          }),
        ),
      )
      const rows = await db.query<{ c: number }>('SELECT COUNT(*) AS c FROM conc_d')
      expect(rows[0].c).toBe(20)
    } finally {
      close()
    }
  })

  it('after a rolled-back transaction the lock is released — the next transaction proceeds', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.execute('CREATE TABLE conc_e (tag TEXT)')
      await expect(
        db.transaction(async (tx) => {
          tx.sql("INSERT INTO conc_e (tag) VALUES ('x')")
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      await db.transaction(async (tx) => {
        tx.sql("INSERT INTO conc_e (tag) VALUES ('y')")
      })
      const rows = await db.query<{ tag: string }>('SELECT tag FROM conc_e ORDER BY tag')
      expect(rows.map((r) => r.tag)).toEqual(['y'])
    } finally {
      close()
    }
  })

  it('a nested db.transaction inside a transaction fails fast with a clear error instead of deadlocking', async () => {
    const { db, close } = makeTestDb()
    try {
      await expect(
        db.transaction(async () => {
          await db.transaction(async () => {}) // would deadlock on the connection mutex
        }),
      ).rejects.toThrow(/nested/i)
    } finally {
      close()
    }
  })
})
