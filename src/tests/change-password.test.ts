import { describe, it, expect } from 'vitest'
import { createApp } from '../app'
import { createSession, validateSession } from '../auth/sessions'
import { verifyPassword } from '../auth/password'
import { makeTestDb, makeUser } from './helpers'

function makeApp(db: Parameters<typeof createApp>[0]['db']) {
  return createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
}

function passwordRequest(token: string | undefined, current_password: string, new_password: string) {
  return new Request('http://local/api/auth/password', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://local',
      ...(token ? { Cookie: `hibana_session=${token}` } : {}),
    },
    body: JSON.stringify({ current_password, new_password }),
  })
}

describe('change password (spec §5.8 Account)', () => {
  it('rejects a wrong current password and changes nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db, { password: 'old-secret-123' })
      const app = makeApp(db)
      const token = await createSession(db, user)

      const res = await app.fetch(passwordRequest(token, 'wrong-password', 'new-secret-456'))
      expect(res.status).toBe(400)
      const { error } = (await res.json()) as { error?: string }
      expect(error).toBe('invalid_current_password')

      const rows = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user])
      await expect(verifyPassword('old-secret-123', rows[0].password_hash)).resolves.toBe(true)
      await expect(validateSession(db, token)).resolves.toBe(user) // current session intact
    } finally {
      close()
    }
  })

  it('changes the password, kills other sessions, keeps the current one', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db, { password: 'old-secret-123' })
      const app = makeApp(db)
      const current = await createSession(db, user)
      const other = await createSession(db, user)

      const res = await app.fetch(passwordRequest(current, 'old-secret-123', 'new-secret-456'))
      expect(res.status).toBe(200)
      const { ok } = (await res.json()) as { ok?: boolean }
      expect(ok).toBe(true)

      const rows = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user])
      await expect(verifyPassword('new-secret-456', rows[0].password_hash)).resolves.toBe(true)
      await expect(verifyPassword('old-secret-123', rows[0].password_hash)).resolves.toBe(false)
      await expect(validateSession(db, current)).resolves.toBe(user) // this device stays logged in
      await expect(validateSession(db, other)).resolves.toBeNull() // every other device signed out
    } finally {
      close()
    }
  })

  it('rejects a short new password via Zod (rule 10)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db, { password: 'old-secret-123' })
      const app = makeApp(db)
      const token = await createSession(db, user)

      const res = await app.fetch(passwordRequest(token, 'old-secret-123', 'short'))
      expect(res.status).toBe(400)
    } finally {
      close()
    }
  })

  it('requires a session (rule 1 auth boundary)', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db, { password: 'old-secret-123' })
      const app = makeApp(db)
      const res = await app.fetch(passwordRequest(undefined, 'old-secret-123', 'new-secret-456'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('only changes the authenticated user (user isolation, rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const alice = await makeUser(db, { password: 'alice-secret', email: 'alice@test.dev' })
      const bob = await makeUser(db, { password: 'bob-secret', email: 'bob@test.dev' })
      const app = makeApp(db)
      const aliceToken = await createSession(db, alice)

      await app.fetch(passwordRequest(aliceToken, 'alice-secret', 'new-alice-secret'))

      const bobRows = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [bob])
      await expect(verifyPassword('bob-secret', bobRows[0].password_hash)).resolves.toBe(true)
    } finally {
      close()
    }
  })
})
