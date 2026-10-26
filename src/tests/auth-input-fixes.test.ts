import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser, stubAuthNetwork, solvedCaptcha } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { burnDummyVerify } from '../auth/password'
import type { Db } from '../db/types'

// Module mock hoisted to the top level (vitest requirement): the password module is
// re-exported verbatim except burnDummyVerify, which becomes a spying delegate. All
// other tests in this file are unaffected — they never assert on it.
vi.mock('../auth/password', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../auth/password')>()
  return { ...orig, burnDummyVerify: vi.fn(orig.burnDummyVerify) }
})

// Phase 1 (PLAYBOOK §5 — auth/session + input hardening) regression pins, each
// red-then-green proven against the pre-fix code:
//   1. link URLs are http(s)-only at the boundary (javascript:/data: die in Zod —
//      escaping neutralizes markup, not URI schemes)
//   2. invite-code single-use is ATOMIC (burn-first conditional UPDATE — two
//      concurrent registrations can never both spend one code)
//   3. unknown-account login burns the same PBKDF2 work as a wrong password
//      (the timing enumeration oracle is closed)
//   4. the invite-email sender is rate-limited (was the one unmetered Resend call)
//   5. public auth routes return generic errors on email-provider failure (no
//      provider internals to anonymous callers) — see reset-error-leak tests below

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
  const token = await createSession(db, userId)
  return {
    app,
    auth: { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } as Record<string, string>,
  }
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://local', ...headers },
    body: JSON.stringify(body),
  }))

describe('link URLs are http(s)-only at the boundary (P1-b IO-1, Phase 1 fix)', () => {
  it('rejects javascript:, data:, and vbscript: URLs on create and update; accepts http(s)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      let res = await post(app, '/api/projects', { title: 'L', status: 'planning' }, auth)
      const p = (await res.json()) as { id: string }

      const bad = [
        'javascript:alert(document.cookie)',
        'JavaScript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
      ]
      for (const url of bad) {
        res = await post(app, `/api/projects/${p.id}/links`, { label: 'x', url }, auth)
        expect(res.status, `create must reject ${url}`).toBe(400)
      }

      res = await post(app, `/api/projects/${p.id}/links`, { label: 'ok', url: 'https://example.com/a' }, auth)
      expect(res.status).toBe(201)
      const { id } = (await res.json()) as { id: string }

      res = await app.fetch(new Request(`http://local/api/links/${id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ url: 'javascript:alert(1)' }),
      }))
      expect(res.status).toBe(400)

      // uppercase scheme + http still pass (case-insensitive)
      res = await app.fetch(new Request(`http://local/api/links/${id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ url: 'HTTPS://example.com/b' }),
      }))
      expect(res.status).toBe(200)
    } finally {
      close()
    }
  })
})

describe('invite single-use is atomic (P1-b IO-2, Phase 1 fix)', () => {
  // The vitest harness runs on the node:sqlite adapter, whose single shared connection
  // cannot host two OPEN transactions at once (a pre-existing adapter property, not
  // this fix's subject) — so the concurrent interleaving is pinned where the D1
  // runtime semantics actually allow it (workers-smoke). Here we pin the primitive
  // the fix rests on: the conditional burn is atomic at the SQL layer (the same
  // single-statement guard SEC-5 used for reset tokens), plus the route wiring.
  it('the conditional burn updates exactly one row, exactly once — the guard primitive', async () => {
    const { db, close } = makeTestDb()
    try {
      const creator = await makeUser(db)
      const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      const inviteId = crypto.randomUUID()
      await db.execute('INSERT INTO invites (id, code, created_by, created_at) VALUES (?, ?, ?, ?)', [inviteId, code, creator, new Date().toISOString()])

      const first = await db.execute(
        'UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL',
        [new Date().toISOString(), inviteId],
      )
      expect(first.changes).toBe(1) // the winner spends the code

      const second = await db.execute(
        'UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL',
        [new Date().toISOString(), inviteId],
      )
      expect(second.changes).toBe(0) // every later attempt is refused — no read-then-write window
    } finally {
      close()
    }
  })

  it('sequential double-spend of one code: first registers, second is a 403, used_by is recorded', async () => {
    const { db, close } = makeTestDb()
    const net = stubAuthNetwork()
    try {
      const owner = await makeUser(db)
      const app = createApp({
        db, isProd: false, github: { owner: 'x', repo: 'y', token: '' },
        openRegistration: false, captchaSecretKey: 'test-secret', emailKey: 'test-key', assets: undefined,
      })
      const ownerCookie = `__Host-hibana_session=${await createSession(db, owner)}`
      let res = await post(app, '/api/auth/invites', {}, { Cookie: ownerCookie })
      expect(res.status).toBe(201)
      const { code } = (await res.json()) as { code: string }

      res = await post(app, '/api/auth/register', { inviteCode: code, email: 'first@test.dev', username: 'first', password: 'correcthorsebattery', ...(await solvedCaptcha()) })
      expect(res.status).toBe(201)
      res = await post(app, '/api/auth/register', { inviteCode: code, email: 'second@test.dev', username: 'second', password: 'correcthorsebattery', ...(await solvedCaptcha()) })
      expect(res.status).toBe(403)

      const users = await db.query<{ email: string }>("SELECT email FROM users WHERE email IN ('first@test.dev', 'second@test.dev')")
      expect(users).toHaveLength(1)
      const invite = await db.query<{ used_at: string | null; used_by: string | null }>('SELECT used_at, used_by FROM invites WHERE code = ?', [code])
      expect(invite[0]!.used_at).not.toBeNull()
      expect(invite[0]!.used_by).not.toBeNull() // points at the one account that spent it
    } finally {
      net.restore()
      close()
    }
  })
})

describe('unknown-account login burns equal PBKDF2 work (P1-b IO-3, Phase 1 fix)', () => {
  afterEach(() => vi.clearAllMocks())

  it('calls burnDummyVerify for a nonexistent login and not for a real wrong-password attempt', async () => {
    const { db, close } = makeTestDb()
    try {
      const real = await makeUser(db, { email: 'real@test.dev', username: 'real', password: 'real-password-1' })
      expect(real).toBeTruthy()
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })

      // nonexistent account → dummy work burned
      let res = await post(app, '/api/auth/login', { login: 'ghost@test.dev', password: 'whatever-123' })
      expect(res.status).toBe(401)
      expect(burnDummyVerify).toHaveBeenCalledTimes(1)

      // real account + wrong password → the REAL verify path, no dummy call
      res = await post(app, '/api/auth/login', { login: 'real@test.dev', password: 'wrong-password-9' })
      expect(res.status).toBe(401)
      expect(burnDummyVerify).toHaveBeenCalledTimes(1)

      // identical bodies for both cases (no enumeration in the response either)
      res = await post(app, '/api/auth/login', { login: 'ghost@test.dev', password: 'whatever-123' })
      expect(await res.json()).toEqual({ error: 'invalid_credentials' })
    } finally {
      close()
    }
  })
})

describe('invite-email sender is rate-limited (P1-b A7, Phase 1 fix)', () => {
  it('the 6th invite-email request inside the window is a 429', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)

      const results: number[] = []
      for (let i = 0; i < 6; i++) {
        const res = await post(app, '/api/auth/invites/email', { email: `friend${i}@test.dev` }, auth)
        results.push(res.status)
      }
      // first 5 pass the limiter (they 503 on email_not_configured in this harness —
      // the limiter counts before the handler); the 6th is cut off at the gate itself
      expect(results.slice(0, 5)).toEqual([503, 503, 503, 503, 503])
      expect(results[5]).toBe(429)
    } finally {
      close()
    }
  })
})

describe('public auth routes keep provider internals out of responses (SC-9, Phase 1 fix)', () => {
  afterEach(() => vi.unstubAllGlobals())

  afterEach(() => {
    vi.clearAllMocks() // reset burnDummyVerify call counts between tests
  })

  it('reset/request returns a generic code when Resend fails — never the provider body', async () => {
    const { db, close } = makeTestDb()
    // The Resend call is stubbed to fail with a body carrying would-be provider internals.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ SECRET_PROVIDER_DETAIL: 'account internals' }), { status: 500 }),
    )
    try {
      await makeUser(db, { email: 'victim@test.dev' })
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key', assets: undefined })
      const res = await post(app, '/api/auth/reset/request', { email: 'victim@test.dev' })
      expect(res.status).toBe(503)
      const json = (await res.json()) as { error?: string }
      const body = JSON.stringify(json)
      expect(body).not.toContain('SECRET_PROVIDER_DETAIL')
      expect(body).not.toContain('Resend')
      expect(json.error).toBe('email_send_failed')
    } finally {
      close()
    }
  })

  it('register returns a generic code when the signup email cannot be sent', async () => {
    const { db, close } = makeTestDb()
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ SECRET_PROVIDER_DETAIL: 'account internals' }), { status: 500 }),
    )
    try {
      const app = createApp({
        db, isProd: false, github: { owner: 'x', repo: 'y', token: '' },
        openRegistration: true, captchaSecretKey: 'test-secret', emailKey: 'test-key', assets: undefined,
      })
      const res = await post(app, '/api/auth/register', {
        email: 'new@test.dev', username: 'newbie', password: 'correcthorsebattery', ...(await solvedCaptcha()),
      })
      expect(res.status).toBe(503)
      const body = JSON.stringify(await res.json())
      expect(body).not.toContain('SECRET_PROVIDER_DETAIL')
      expect(body).not.toContain('detail')
    } finally {
      close()
    }
  })
})
