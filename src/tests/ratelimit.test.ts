import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Spec §15 — the app enforces the same limits the Cloudflare rules would apply at the
// edge (login + password reset: 30 req/60s/IP; Telegram webhook: 300 req/60s/IP).

describe('rate limiting (spec §15)', () => {
  it('login blocks the 31st attempt in a 60s window (30 allowed)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
      const seed = await app.fetch(new Request('http://local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
      }))
      expect(seed.status).toBe(401) // wrong creds are 401, and the limiter counts them

      const statuses: number[] = []
      for (let i = 0; i < 35; i++) {
        const res = await app.fetch(new Request('http://local/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
        }))
        statuses.push(res.status)
      }
      expect(statuses.slice(0, 29)).not.toContain(429) // first 30 requests (incl. seed) pass through
      expect(statuses[29]).toBe(429) // #31 → blocked
      expect(statuses[30]).toBe(429) // stays blocked inside the window
      const row = await db.query<{ count: number }>("SELECT count FROM rate_limits WHERE key = 'auth:local'")
      expect(row[0].count).toBe(36)
    } finally {
      close()
    }
  })

  it('rate-limited htmx clients get a swappable fragment, not a swallowed 4xx JSON', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
      let last: Response | null = null
      for (let i = 0; i < 32; i++) {
        last = await app.fetch(new Request('http://local/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' },
          body: 'username=probe&email=probe@test.dev&password=correcthorsebattery&captcha=tok',
        }))
      }
      // the 31st+ request is rate-limited, but as an htmx FRAGMENT at 200 so the error
      // actually renders — the pre-fix behavior was a 429 JSON htmx silently dropped
      expect(last!.status).toBe(200)
      expect(await last!.text()).toContain('Too many attempts')
    } finally {
      close()
    }
  })

  it('password reset shares the auth limit (request + confirm)', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
      for (let i = 0; i < 30; i++) {
        const res = await app.fetch(new Request('http://local/api/auth/reset/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nobody@test.dev' }), // unknown → ok, no email sent
        }))
        expect(res.status).toBe(200)
      }
      const blocked = await app.fetch(new Request('http://local/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'x', password: 'whatever123' }),
      }))
      expect(blocked.status).toBe(429)
    } finally {
      close()
    }
  })

  it('a different client IP has its own budget', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
      for (let i = 0; i < 30; i++) {
        const res = await app.fetch(new Request('http://local/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
          body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
        }))
        expect(res.status).toBe(401) // never blocked: separate budget
      }
      // the original 'local' budget is untouched
      const fresh = await app.fetch(new Request('http://local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
      }))
      expect(fresh.status).toBe(401)
    } finally {
      close()
    }
  })

  it('the Telegram webhook blocks beyond 300 req/60s, before the secret check', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp({
        db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined,
        telegramToken: 'bot-token', telegramSecret: 'wxyz-secret',
      })
      for (let i = 0; i < 300; i++) {
        const res = await app.fetch(new Request('http://local/api/telegram/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
          body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: 1 }, text: 'x' } }),
        }))
        expect(res.status).toBe(403) // wrong secret → 403, but still counted
      }
      const blocked = await app.fetch(new Request('http://local/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret' },
        body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: 1 }, text: 'x' } }),
      }))
      expect(blocked.status).toBe(429) // the limiter ran BEFORE the secret check
    } finally {
      close()
    }
  })
})