import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser, stubAuthNetwork, lastVerificationCode, solvedCaptcha } from './helpers'
import { createApp } from '../app'
import { EMAIL_CODE_MAX_ATTEMPTS } from '../services/verify'
import type { Db } from '../db/types'

// Email-confirmation flow (added 2026-08-24): open signup → math human-check → unverified
// account → 4-digit code by email → /api/auth/verify consumes it → session. Login refuses
// unverified.

function makeApp(db: Db, over: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: 'test-key',
    openRegistration: true, // temporarily open (Ali's decision); invite gate off
    captchaSecretKey: 'test-secret',
    assets: undefined,
    ...over,
  })
}

const post = (path: string, body: unknown) =>
  new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
    body: JSON.stringify(body),
  })

// Register with a SOLVED math human-check (the fields the signup form posts).
const REGISTER = async (email: string, username: string) =>
  post('/api/auth/register', { email, username, password: 'correcthorsebattery', ...(await solvedCaptcha()) })

describe('email-code verification (open signup, temporarily)', () => {
  it('open signup lands an UNVERIFIED account with no session, and login is blocked', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      const res = await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))
      expect(res.status).toBe(201)
      expect(res.headers.get('set-cookie')).toBeNull() // no login until verified

      const users = await db.query<{ email_verified_at: string | null }>('SELECT email_verified_at FROM users WHERE email = ?', ['fresh@test.dev'])
      expect(users[0].email_verified_at).toBeNull()

      const codes = await db.query<{ id: string }>('SELECT id FROM email_verifications')
      expect(codes).toHaveLength(1) // one pending code row

      const login = await app.fetch(post('/api/auth/login', { login: 'freshuser', password: 'correcthorsebattery' }))
      expect(login.status).toBe(403)
      expect(((await login.json()) as { error: string }).error).toBe('email_unverified')
    } finally {
      net.restore()
      close()
    }
  })

  it('the emailed code unlocks the account and creates the session', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))
      const code = lastVerificationCode(net)

      const res = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code }))
      expect(res.status).toBe(200)
      expect((res.headers.get('set-cookie') ?? '').startsWith('hibana_session=')).toBe(true)

      const users = await db.query<{ email_verified_at: string | null }>('SELECT email_verified_at FROM users WHERE email = ?', ['fresh@test.dev'])
      expect(users[0].email_verified_at).not.toBeNull()

      // login now succeeds
      const login = await app.fetch(post('/api/auth/login', { login: 'freshuser', password: 'correcthorsebattery' }))
      expect(login.status).toBe(200)

      // the code is consumed — a replay is refused (account now verified)
      const replay = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code }))
      expect(replay.status).toBe(400)
      expect(((await replay.json()) as { error: string }).error).toBe('already_verified')
    } finally {
      net.restore()
      close()
    }
  })

  it('wrong codes count up and invalidate after the attempt cap', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))
      const code = lastVerificationCode(net)

      for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) {
        const res = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code: '0000' }))
        expect(res.status).toBe(400)
        expect(((await res.json()) as { error: string }).error).toBe('invalid_code')
      }

      // the correct code is now dead too (row invalidated at the cap) → resend needed
      const res = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid_code')

      // resend issues a fresh code that works (age the dead row out of the 60s cooldown)
      await db.execute('UPDATE email_verifications SET created_at = ?', [new Date(Date.now() - 120_000).toISOString()])
      const resent = await app.fetch(post('/api/auth/verify/resend', { email: 'fresh@test.dev' }))
      expect(resent.status).toBe(200)
      const fresh = lastVerificationCode(net)
      expect(fresh).not.toBe(code)
      const ok = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code: fresh }))
      expect(ok.status).toBe(200)
    } finally {
      net.restore()
      close()
    }
  })

  it('an expired code is rejected and must be resent', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))
      const code = lastVerificationCode(net)

      await db.execute('UPDATE email_verifications SET expires_at = ?', [new Date(Date.now() - 1000).toISOString()])
      const res = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid_or_expired_code')
    } finally {
      net.restore()
      close()
    }
  })

  it('resend respects the 60s cooldown, then issues a usable fresh code', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))
      const first = lastVerificationCode(net)

      // immediate resend → cooldown
      const cooled = await app.fetch(post('/api/auth/verify/resend', { email: 'fresh@test.dev' }))
      expect(cooled.status).toBe(429)
      expect(((await cooled.json()) as { error: string }).error).toBe('resend_cooldown')

      // age the last code out of the cooldown window
      await db.execute('UPDATE email_verifications SET created_at = ?', [new Date(Date.now() - 120_000).toISOString()])
      const ok = await app.fetch(post('/api/auth/verify/resend', { email: 'fresh@test.dev' }))
      expect(ok.status).toBe(200)

      const second = lastVerificationCode(net)
      expect(second).not.toBe(first)
      const verify = await app.fetch(post('/api/auth/verify', { email: 'fresh@test.dev', code: second }))
      expect(verify.status).toBe(200)
    } finally {
      net.restore()
      close()
    }
  })

  it('rejects duplicate email and username on register (409)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('dup@test.dev', 'dupusr'))
      const byEmail = await app.fetch(await REGISTER('dup@test.dev', 'otherusr'))
      expect(byEmail.status).toBe(409)
      expect(((await byEmail.json()) as { error: string }).error).toBe('email_taken')
      const byName = await app.fetch(await REGISTER('other@test.dev', 'dupusr'))
      expect(byName.status).toBe(409)
      expect(((await byName.json()) as { error: string }).error).toBe('username_taken')
    } finally {
      net.restore()
      close()
    }
  })

  it('rolls the account back when the confirmation email cannot be sent', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork({ resendOk: false })
    try {
      const app = makeApp(db)
      // the human check SUCCEEDS first — the mail failure is what surfaces (captcha runs
      // before any user row is created)
      const res = await app.fetch(await REGISTER('fail@test.dev', 'failuser'))
      expect(res.status).toBe(503)
      expect(((await res.json()) as { error: string }).error).toBe('email_send_failed')
      const users = await db.query<{ id: string }>('SELECT id FROM users WHERE email = ?', ['fail@test.dev'])
      expect(users).toHaveLength(0) // rolled back — a retry starts clean
    } finally {
      net.restore()
      close()
    }
  })

  it('verifying a nonexistent email looks identical to a wrong code (no leak)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      const res = await app.fetch(post('/api/auth/verify', { email: 'ghost@test.dev', code: '1234' }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid_code')
    } finally {
      net.restore()
      close()
    }
  })

  it('an already-verified account can never be opened through /verify (no passwordless login)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))
      const code = lastVerificationCode(net)

      // verified account B
      await makeUser(db, { email: 'bob@test.dev', username: 'bob', role: 'member' })

      // A's code submitted against B's verified email → refused, no session
      const res = await app.fetch(post('/api/auth/verify', { email: 'bob@test.dev', code }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('already_verified')
      expect(res.headers.get('set-cookie')).toBeNull()

      // unverified B' can't be unlocked with A's code either (rule 1: codes are per-user)
      await db.execute('UPDATE users SET email_verified_at = NULL WHERE email = ?', ['bob@test.dev'])
      const res2 = await app.fetch(post('/api/auth/verify', { email: 'bob@test.dev', code }))
      expect(res2.status).toBe(400)
      expect(((await res2.json()) as { error: string }).error).toBe('invalid_code')
      const bob = await db.query<{ email_verified_at: string | null }>('SELECT email_verified_at FROM users WHERE email = ?', ['bob@test.dev'])
      expect(bob[0].email_verified_at).toBeNull()
    } finally {
      net.restore()
      close()
    }
  })

  it('accepts the signup form\'s native captcha fields (real form shape)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      // the signup page posts the solved question as the form's own `captcha` +
      // `captcha_token` fields (urlencoded + htmx)
      const { captcha, captcha_token } = await solvedCaptcha()
      const res = await app.fetch(
        new Request('http://local/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true', Origin: 'http://local' },
          body: `username=nativefield&email=native@test.dev&password=correcthorsebattery&captcha=${encodeURIComponent(captcha)}&captcha_token=${encodeURIComponent(captcha_token)}`,
        }),
      )
      // the human check passed → account created (unverified) and htmx redirected to the
      // signup page's verification modal
      expect(res.status).toBe(200)
      expect(res.headers.get('HX-Redirect')).toContain('/signup?verify=1&email=')
      const users = await db.query<{ id: string }>('SELECT id FROM users WHERE email = ?', ['native@test.dev'])
      expect(users).toHaveLength(1)
    } finally {
      net.restore()
      close()
    }
  })

  it('htmx consumers get friendly fragments, not raw JSON (HX-Request branch)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      await app.fetch(await REGISTER('fresh@test.dev', 'freshuser'))

      // missing captcha token → a swappable fragment (not a silent 400 JSON); with the
      // token field now optional in the schema this rides the missing_token branch
      const noCaptcha = await app.fetch(
        new Request('http://local/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true', Origin: 'http://local' },
          body: 'username=nocap&email=nocap@test.dev&password=correcthorsebattery',
        }),
      )
      expect(noCaptcha.status).toBe(200)
      const noCapText = await noCaptcha.text()
      expect(noCapText).toContain('class="error"')
      expect(noCapText).toContain('human check')

      const wrong = await app.fetch(
        new Request('http://local/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'HX-Request': 'true', Origin: 'http://local' },
          body: JSON.stringify({ email: 'fresh@test.dev', code: '0000' }),
        }),
      )
      // htmx error fragments come back at 200 — same pattern as the login form errors
      expect(wrong.status).toBe(200)
      const text = await wrong.text()
      expect(text).toContain('class="error"')
      expect(text).toContain('doesn&#39;t match')
      expect(wrong.headers.get('HX-Redirect')).toBeNull()

      // success redirects to the app
      const ok = await app.fetch(
        new Request('http://local/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'HX-Request': 'true', Origin: 'http://local' },
          body: JSON.stringify({ email: 'fresh@test.dev', code: lastVerificationCode(net) }),
        }),
      )
      expect(ok.status).toBe(200)
      expect(ok.headers.get('HX-Redirect')).toBe('/app')
    } finally {
      net.restore()
      close()
    }
  })
})