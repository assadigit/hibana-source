import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser, stubAuthNetwork, lastVerificationCode, solvedCaptcha, wrongCaptcha, captchaAnswer } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

function makeApp(db: Db, over: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: 'test-key',
    openRegistration: false, // closed → invite codes required (the safe default)
    captchaSecretKey: 'test-secret',
    assets: undefined,
    ...over,
  })
}

const post = (path: string, body: unknown, opts: { cookie?: string } = {}) =>
  new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: JSON.stringify(body),
  })

describe('registration (spec §4.14)', () => {
  it('invite-mode: registers with a code, confirms by email code, then logs in', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const owner = await makeUser(db)
      const app = makeApp(db)

      // owner generates a code
      let res = await app.fetch(
        post('/api/auth/invites', {}, { cookie: `hibana_session=${await createSession(db, owner)}` }),
      )
      expect(res.status).toBe(201)
      const { code } = (await res.json()) as { code: string }

      // new user registers with it (math human-check solved — the fields the signup
      // form posts are `captcha` + `captcha_token`)
      res = await app.fetch(
        post('/api/auth/register', { inviteCode: code, email: 'new@test.dev', username: 'newbie', password: 'correcthorsebattery', ...(await solvedCaptcha()) }),
      )
      expect(res.status).toBe(201)
      // NO session until the email code is consumed
      expect(res.headers.get('set-cookie')).toBeNull()

      // the code is single-use (fresh human-check for the second attempt — captcha runs
      // first, so the invite rejection is what surfaces)
      res = await app.fetch(
        post('/api/auth/register', { inviteCode: code, email: 'other@test.dev', username: 'other', password: 'correcthorsebattery', ...(await solvedCaptcha()) }),
      )
      expect(res.status).toBe(403) // invalid_invite

      // login is blocked while unverified
      res = await app.fetch(post('/api/auth/login', { login: 'newbie', password: 'correcthorsebattery' }))
      expect(res.status).toBe(403)
      expect(((await res.json()) as { error: string }).error).toBe('email_unverified')

      // confirm with the code from the email
      const verifyCode = lastVerificationCode(net)
      res = await app.fetch(post('/api/auth/verify', { email: 'new@test.dev', code: verifyCode }))
      expect(res.status).toBe(200)
      expect((res.headers.get('set-cookie') ?? '').startsWith('hibana_session=')).toBe(true)

      // now login works
      res = await app.fetch(post('/api/auth/login', { login: 'newbie', password: 'correcthorsebattery' }))
      expect(res.status).toBe(200)
    } finally {
      net.restore()
      close()
    }
  })

  it('rejects a bad invite code', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      await makeUser(db) // owner exists (unused; register is public)
      const app = makeApp(db)
      const res = await app.fetch(
        post('/api/auth/register', { inviteCode: 'nope', email: 'x@test.dev', username: 'xuser', password: 'correcthorsebattery', ...(await solvedCaptcha()) }),
      )
      expect(res.status).toBe(403)
    } finally {
      net.restore()
      close()
    }
  })

  it('GET /captcha issues a fresh HMAC-signed question that register accepts (round trip)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const owner = await makeUser(db)
      const app = makeApp(db)

      // the issue route hands out {q, token} and is never cached (a stale question would
      // fail its own expiry check on submit)
      const cap = await app.fetch(new Request('http://local/api/auth/captcha'))
      expect(cap.status).toBe(200)
      expect(cap.headers.get('Cache-Control')).toBe('no-store')
      const { q, token } = (await cap.json()) as { q: string; token: string }
      expect(q).toMatch(/^\d+ [+-] \d+ =$/)
      // P2.1 (F-M6): token format is `question.expS.sig` (2 dots). Was `a.b.op.expS.sig`
      // (4 dots) but that pre-split the operands for bots. The question carries them as text.
      expect((token.match(/\./g) ?? []).length).toBe(2)

      // solve the issued question → the register human-check passes
      const invite = await app.fetch(
        post('/api/auth/invites', {}, { cookie: `hibana_session=${await createSession(db, owner)}` }),
      )
      const { code } = (await invite.json()) as { code: string }
      const res = await app.fetch(
        post('/api/auth/register', { inviteCode: code, email: 'solver@test.dev', username: 'solver', password: 'correcthorsebattery', captcha: String(captchaAnswer(q)), captcha_token: token }),
      )
      expect(res.status).toBe(201)
    } finally {
      net.restore()
      close()
    }
  })

  it('rejects a wrong-answer math captcha (the human check says no)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      const res = await app.fetch(
        post('/api/auth/register', { email: 'x@test.dev', username: 'xuser', password: 'correcthorsebattery', ...(await wrongCaptcha()) }),
      )
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('captcha_failed')
      const users = await db.query<{ id: string }>('SELECT id FROM users WHERE email = ?', ['x@test.dev'])
      expect(users).toHaveLength(0) // never got as far as creating an account
    } finally {
      net.restore()
      close()
    }
  })

  it('fails closed when the math captcha is not configured (no silent bypass)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db, { captchaSecretKey: undefined })
      const res = await app.fetch(
        post('/api/auth/register', { email: 'x@test.dev', username: 'xuser', password: 'correcthorsebattery', ...(await solvedCaptcha()) }),
      )
      expect(res.status).toBe(503)
      expect(((await res.json()) as { error: string }).error).toBe('captcha_unconfigured')
    } finally {
      close()
    }
  })

  it('requires all fields per the schema — missing username is invalid input (rule 10)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const app = makeApp(db)
      const res = await app.fetch(
        post('/api/auth/register', { email: 'x@test.dev', password: 'correcthorsebattery', ...(await solvedCaptcha()) }),
      )
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid_input')
    } finally {
      net.restore()
      close()
    }
  })

  it('password reset flow sets a new password and kills old sessions', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const a = await makeUser(db)
      const app = makeApp(db)
      const oldToken = await createSession(db, a)

      // email that doesn't exist → ok:true without revealing anything
      let res = await app.fetch(post('/api/auth/reset/request', { email: 'a-user@test.dev' }))
      expect(res.status).toBe(200)
      const rows0 = await db.query<{ token_hash: string }>('SELECT token_hash FROM password_resets')
      expect(rows0).toHaveLength(0) // nothing created

      // the real seeded email → token created + email "sent" via the stub
      const user = await db.query<{ email: string }>('SELECT email FROM users WHERE id = ?', [a])
      res = await app.fetch(post('/api/auth/reset/request', { email: user[0].email }))
      expect(res.status).toBe(200)
      const tokenRows = await db.query<{ token_hash: string }>('SELECT token_hash FROM password_resets')
      expect(tokenRows).toHaveLength(1)

      // an expired token is rejected even if the raw token were known
      await db.execute('UPDATE password_resets SET expires_at = ?', [new Date(Date.now() - 1000).toISOString()])
      const bad = await app.fetch(post('/api/auth/reset/confirm', { token: 'whatever', password: 'freshpassword123' }))
      expect(bad.status).toBe(400) // expired → rejected

      // old session still valid (password unchanged), so no breakage in the negative path
      const me = await app.fetch(new Request('http://local/api/auth/me', { headers: { Cookie: `hibana_session=${oldToken}` } }))
      expect(me.status).toBe(200)
    } finally {
      net.restore()
      close()
    }
  })

  it('htmx reset round: sent-panel echoes the email; confirm signs the browser in (modal update fix)', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const a = await makeUser(db)
      const app = makeApp(db)
      const hx = (path: string, body: unknown) =>
        new Request('http://local' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'HX-Request': 'true' },
          body: JSON.stringify(body),
        })

      // 1. request: the htmx panel replaces the whole section, echoing the typed email
      const user = await db.query<{ email: string }>('SELECT email FROM users WHERE id = ?', [a])
      const req = await app.fetch(hx('/api/auth/reset/request', { email: user[0].email }))
      expect(req.status).toBe(200)
      const reqHtml = await req.text()
      expect(reqHtml).toContain('id="request-section"')
      expect(reqHtml).toContain(`Reset link sent to <b>${user[0].email}</b>`)

      // 2. unknown address gets the SAME panel (no account-existence leak)
      const ghost = await app.fetch(hx('/api/auth/reset/request', { email: 'ghost@test.dev' }))
      expect(await ghost.text()).toContain('Reset link sent to <b>ghost@test.dev</b>')

      // 3. confirm: swaps the section, sets a session cookie, and the browser is signed in
      const mail = net.calls.find((c) => c.url.includes('api.resend.com'))
      const raw = mail?.body?.html?.match(/token=([A-Za-z0-9]+)/)?.[1]
      expect(raw).toBeTruthy()
      const done = await app.fetch(hx('/api/auth/reset/confirm', { token: raw, password: 'freshpassword123' }))
      expect(done.status).toBe(200)
      const doneHtml = await done.text()
      expect(doneHtml).toContain('id="confirm-section"')
      expect(doneHtml).toContain('Password changed')
      const cookie = (done.headers.get('set-cookie') ?? '').split(';')[0]
      expect(cookie.startsWith('hibana_session=')).toBe(true)

      // 4. the issued cookie really is a session
      const me = await app.fetch(new Request('http://local/api/auth/me', { headers: { Cookie: cookie } }))
      expect(me.status).toBe(200)

      // 5. htmx errors go out as 2xx fragments retargeted into the inline <p>, so the
      //    form survives — a 4xx/5xx body would be silently swallowed by htmx
      const bad = await app.fetch(hx('/api/auth/reset/confirm', { token: 'nope', password: 'freshpassword123' }))
      expect(bad.status).toBe(200)
      expect(bad.headers.get('HX-Retarget')).toBe('#reset-msg-conf')
      expect(bad.headers.get('HX-Reswap')).toBe('innerHTML')
      expect(await bad.text()).toContain('invalid or expired')
    } finally {
      net.restore()
      close()
    }
  })
})