import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// CSRF hardening (app.ts middleware): state-changing requests must come from the app's own
// origin. Browsers always send Origin (fallback Referer) on cross-site POST/PUT/PATCH/DELETE,
// so a mismatched header is rejected. SameSite=Lax already blocks the cookie cross-site — this
// closes the form-encoded htmx surface too. Server callers with neither header are allowed
// (internal automation + the rule-11 Telegram webhook).

async function makeClient(db: Db, userId: string, mirrorOrigins?: string[]) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: undefined,
    telegramToken: 'test-bot-token',
    telegramSecret: 'wxyz-secret',
    mirrorOrigins,
    assets: undefined,
  })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json' } }
}

describe('CSRF hardening — cross-site state-changing requests are rejected', () => {
  it('blocks a POST with a cross-site Origin (JSON), creating nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { ...auth, Origin: 'https://evil.example' },
          body: JSON.stringify({ title: 'csrf idea' }),
        }),
      )
      expect(res.status).toBe(403)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('blocks a form-encoded htmx POST with a cross-site Referer (no Origin)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://evil.example/attack.html' },
          body: 'title=htmx+csrf',
        }),
      )
      expect(res.status).toBe(403)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('allows a same-origin POST (browser sends Origin = app origin)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { ...auth, Origin: 'http://local' },
          body: JSON.stringify({ title: 'legit idea' }),
        }),
      )
      expect(res.status).toBe(201)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(1)
    } finally {
      close()
    }
  })

  it('rejects requests with neither Origin nor Referer (T6: headerless carve-out tightened)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(
        new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'script idea' }) }),
      )
      expect(res.status).toBe(403) // T6: no browser headers → reject (was: 201 pre-T6)
    } finally {
      close()
    }
  })

  it('does not block reads: a GET with a cross-site Origin and a valid session still returns data', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(new Request('http://local/api/projects', { headers: { ...auth, Origin: 'https://evil.example' } }))
      expect(res.status).toBe(200) // GETs never mutate, so they are exempt
    } finally {
      close()
    }
  })

  it('exempts the Telegram webhook: an evil Origin still passes when the rule-11 secret-token is correct', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp({
        db,
        isProd: false,
        github: { owner: 'x', repo: 'y', token: '' },
        emailKey: undefined,
        telegramToken: 'test-bot-token',
        telegramSecret: 'wxyz-secret',
        assets: undefined,
      })
      const originalFetch = globalThis.fetch
      let outbound = ''
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.telegram.org/bot')) {
          outbound = String(init?.body)
          return new Response('{"ok":true}')
        }
        return originalFetch(input, init)
      }) as typeof fetch
      try {
        const res = await app.fetch(
          new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret', Origin: 'https://evil.example' },
            body: JSON.stringify({ message: { chat: { id: 555 }, from: { id: 11 }, text: 'cross-site idea' } }),
          }),
        )
        expect(res.status).toBe(200)
        const caps = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM telegram_captures')
        expect(caps[0].n).toBe(1)
        expect(outbound).toContain('/start')
        expect(outbound).not.toContain('evil.example')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      close()
    }
  })
})

describe('CSRF mirror origins (v0.3.2 — MIRROR_ORIGIN allow-list, docs/edge-mirror.md)', () => {
  // A CDN front (ArvanCloud) proxies the Worker with the Host rewritten to the origin
  // (hibana.ir), so a browser on https://fast.hibana.ir sends an Origin that can never
  // equal the request's own origin — the gate needs the explicit allow-list for exactly
  // that origin, and nothing else.
  const MIRROR = 'https://fast.hibana.ir'

  it('allows a state-changing POST whose Origin is a configured mirror', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId, [MIRROR])
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { ...auth, Origin: MIRROR },
          body: JSON.stringify({ title: 'mirror idea' }),
        }),
      )
      expect(res.status).toBe(201)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(1)
    } finally {
      close()
    }
  })

  it('rejects the mirror Origin when no mirror is configured (opt-in, default off)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { ...auth, Origin: MIRROR },
          body: JSON.stringify({ title: 'unconfigured mirror' }),
        }),
      )
      expect(res.status).toBe(403)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('allows a form-encoded htmx POST whose Referer origin is a configured mirror', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId, [MIRROR])
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: {
            Cookie: auth.Cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${MIRROR}/index.html`,
          },
          body: 'title=htmx+via+mirror',
        }),
      )
      expect(res.status).toBe(201)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(1)
    } finally {
      close()
    }
  })

  it('a configured mirror does not widen the gate: every other cross-site Origin is still rejected', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId, [MIRROR])
      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { ...auth, Origin: 'https://evil.example' },
          body: JSON.stringify({ title: 'still blocked' }),
        }),
      )
      expect(res.status).toBe(403)
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
      expect(rows[0].n).toBe(0)
    } finally {
      close()
    }
  })
})
