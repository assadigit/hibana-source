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

async function makeClient(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: undefined,
    telegramToken: 'test-bot-token',
    telegramSecret: 'wxyz-secret',
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

  it('allows requests with neither Origin nor Referer (server-side/internal automation)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const res = await app.fetch(
        new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'script idea' }) }),
      )
      expect(res.status).toBe(201) // no browser to correlate — same contract as server-side callers
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
