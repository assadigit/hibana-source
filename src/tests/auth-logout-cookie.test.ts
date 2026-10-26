import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Autopilot Phase 0 characterization (gap: logout + cookie attributes).
//
// POST /api/auth/logout had ZERO test coverage (routes/auth.ts:165-170) — an
// auth-critical path. The login Set-Cookie was only pinned by its __Host- prefix,
// never by its full attribute set (SEC-10: sessions.ts:21-28 is "the ONE place the
// attributes live" — these tests make that claim load-bearing).
//
// These pin CURRENT behavior before any refactor touches auth or sessions.

const AUTHED_HEADERS = (cookie: string) => ({
  'Content-Type': 'application/json',
  Cookie: cookie,
  Origin: 'http://local', // T6 CSRF gate: mutations need a trusted Origin
})

async function makeApp(db: Db) {
  return createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    assets: undefined,
  })
}

describe('logout route (characterization)', () => {
  it('logout destroys the session row and clears the cookie with the prefix contract', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db, { username: 'logouttest', password: 'logout-pass-123' })
      const app = await makeApp(db)
      const token = await createSession(db, uid)
      const cookie = `__Host-hibana_session=${token}`

      // the session works before logout
      let res = await app.fetch(new Request('http://local/api/auth/me', { headers: { Cookie: cookie } }))
      expect(res.status).toBe(200)

      res = await app.fetch(
        new Request('http://local/api/auth/logout', { method: 'POST', headers: AUTHED_HEADERS(cookie) }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })

      // the clearing Set-Cookie carries the same __Host- prefix contract (SEC-10)
      expect(res.headers.get('set-cookie')).toBe(
        '__Host-hibana_session=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      )

      // the old token is dead: /me rejects it, and the sessions row is gone
      res = await app.fetch(new Request('http://local/api/auth/me', { headers: { Cookie: cookie } }))
      expect(res.status).toBe(401)
      const rows = await db.query<{ id: string }>('SELECT id FROM sessions')
      expect(rows).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('logout answers the htmx branch with an empty 200 (the client swaps/redirects itself)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db, { username: 'logout_htmx', password: 'logout-pass-123' })
      const app = await makeApp(db)
      const token = await createSession(db, uid)
      const res = await app.fetch(
        new Request('http://local/api/auth/logout', {
          method: 'POST',
          headers: { ...AUTHED_HEADERS(`__Host-hibana_session=${token}`), 'HX-Request': 'true' },
        }),
      )
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('')
    } finally {
      close()
    }
  })

  it('logout without a session is a harmless no-op that still clears the cookie', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = await makeApp(db)
      const res = await app.fetch(
        new Request('http://local/api/auth/logout', { method: 'POST', headers: AUTHED_HEADERS('') }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    } finally {
      close()
    }
  })
})

describe('login session cookie attributes (characterization, SEC-10)', () => {
  it('login issues the session cookie with the full documented attribute set', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = await makeApp(db)
      await makeUser(db, { username: 'cookietest', password: 'cookie-pass-123' })

      const res = await app.fetch(
        new Request('http://local/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
          body: JSON.stringify({ login: 'cookietest', password: 'cookie-pass-123' }),
        }),
      )
      expect(res.status).toBe(200)
      const setCookie = res.headers.get('set-cookie') ?? ''
      // SEC-10: the __Host- prefix contract — Secure REQUIRED, Path=/ REQUIRED,
      // Domain FORBIDDEN — plus HttpOnly, SameSite=Lax and the 30-day Max-Age.
      expect(setCookie.startsWith('__Host-hibana_session=')).toBe(true)
      expect(setCookie).toContain('; Secure;')
      expect(setCookie).toContain('; HttpOnly;')
      expect(setCookie).toContain('; SameSite=Lax;')
      expect(setCookie).toContain('; Path=/;')
      expect(setCookie).toContain('; Max-Age=2592000') // 30 days (sessions.ts COOKIE_MAX_AGE_S)
      expect(setCookie.toLowerCase()).not.toContain('domain=') // __Host- forbids Domain
      // the token itself: 32 bytes → 43-char base64url string, no padding
      const token = setCookie.split(';')[0].slice('__Host-hibana_session='.length)
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    } finally {
      close()
    }
  })
})
