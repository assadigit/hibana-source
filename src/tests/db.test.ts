import { describe, it, expect } from 'vitest'
import { makeTestDb } from './helpers'

// The Db interface (src/db/types.ts) is the portability seam — both adapters must
// behave identically. These tests run against better-sqlite3; the D1 adapter is
// exercised by the same SQL on Cloudflare (identical statements, rule 4).
describe('Db interface', () => {
  it('migrates and round-trips rows (insert → query → count)', async () => {
    const { db, close } = makeTestDb()
    try {
      const id = crypto.randomUUID()
      await db.execute(
        'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, 'tester', 't@test.dev', 'x', 'member', 'en', 'gregorian', 'UTC', new Date().toISOString()],
      )
      const rows = await db.query<{ username: string }>("SELECT username FROM users WHERE id = ?", [id])
      expect(rows[0].username).toBe('tester')
      const total = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
      expect(total[0].n).toBe(1)
    } finally {
      close()
    }
  })

  it('transactions commit all statements', async () => {
    const { db, close } = makeTestDb()
    try {
      await db.transaction(async (tx) => {
        tx.sql(
          'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), 'a', 'a@test.dev', 'x', 'member', 'en', 'gregorian', 'UTC', new Date().toISOString()],
        )
        tx.sql(
          'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), 'b', 'b@test.dev', 'x', 'member', 'en', 'gregorian', 'UTC', new Date().toISOString()],
        )
      })
      const total = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
      expect(total[0].n).toBe(2)
    } finally {
      close()
    }
  })

  it('transactions roll back when a statement fails', async () => {
    const { db, close } = makeTestDb()
    try {
      const attempt = db.transaction(async (tx) => {
        tx.sql(
          'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), 'keep', 'keep@test.dev', 'x', 'member', 'en', 'gregorian', 'UTC', new Date().toISOString()],
        )
        tx.sql(
          'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), 'lat', 'keep@test.dev', 'x', 'member', 'en', 'gregorian', 'UTC', new Date().toISOString()],
        ) // duplicate email → constraint violation
      })
      await expect(attempt).rejects.toThrow()
      const total = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
      expect(total[0].n).toBe(0) // nothing leaked from the failed transaction
    } finally {
      close()
    }
  })
})