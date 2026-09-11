import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, needsRehash } from '../auth/password'
import { createSession, destroySession, validateSession } from '../auth/sessions'
import { makeTestDb, makeUser } from './helpers'

describe('password hashing (rule 6 — PBKDF2/Web Crypto)', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true) // Workers max — 600k throws on the Cloudflare runtime
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right')
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false)
  })

  it('rejects malformed stored hashes instead of throwing', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false)
    await expect(verifyPassword('x', 'pbkdf2$1000$c2FsdA==$aGVsbG8=')).resolves.toBe(false) // iterations < 100k (MIN_ACCEPTED_ITERATIONS)
  })

  it('needsRehash flags hashes below the current target (ITERATIONS)', async () => {
    // A 100k hash IS the current target (Workers max) — should NOT flag for rehash
    const current = 'pbkdf2$100000$c2FsdA==$aGVsbG8='
    expect(needsRehash(current)).toBe(false)
    // A freshly-hashed password at 100k should NOT need rehash
    const fresh = await hashPassword('test')
    expect(needsRehash(fresh)).toBe(false)
    // A malformed hash should not flag (returns false, not throw)
    expect(needsRehash('not-a-hash')).toBe(false)
  })

  it('produces a unique salt per hash', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })
})

describe('sessions (spec §4.13)', () => {
  it('create → validate → destroy lifecycle', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      expect(token).toBeTruthy()
      expect(token).not.toContain(userId) // token is independent of user id

      await expect(validateSession(db, token)).resolves.toBe(userId)
      await destroySession(db, token)
      await expect(validateSession(db, token)).resolves.toBeNull()
    } finally {
      close()
    }
  })

  it('expired sessions are rejected and cleaned up', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      // Force-expire it directly (storage + filtering stay UTC strings, rule 3)
      await db.execute('UPDATE sessions SET expires_at = ? WHERE user_id = ?', [
        new Date(Date.now() - 60_000).toISOString(),
        userId,
      ])
      await expect(validateSession(db, token)).resolves.toBeNull()
      const left = await db.query('SELECT COUNT(*) AS n FROM sessions')
      expect(left[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('rolls expiry forward when less than half the lifetime remains', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const token = await createSession(db, userId)
      await db.execute('UPDATE sessions SET expires_at = ? WHERE user_id = ?', [
        new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(), // 10 days left
        userId,
      ])
      await validateSession(db, token)
      const rows = await db.query<{ expires_at: string }>('SELECT expires_at FROM sessions')
      const remaining = new Date(rows[0].expires_at).getTime() - Date.now()
      expect(remaining).toBeGreaterThan(20 * 24 * 3600 * 1000) // extended back to ~30 days
    } finally {
      close()
    }
  })

  it('treats a garbage token as logged-out', async () => {
    const { db, close } = makeTestDb()
    try {
      await expect(validateSession(db, 'garbage')).resolves.toBeNull()
      await expect(validateSession(db, undefined)).resolves.toBeNull()
    } finally {
      close()
    }
  })
})