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
        headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
        body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
      }))
      expect(seed.status).toBe(401) // wrong creds are 401, and the limiter counts them

      const statuses: number[] = []
      for (let i = 0; i < 35; i++) {
        const res = await app.fetch(new Request('http://local/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
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
      let tripped = false
      // S76 (CI flake fix, 2026-09-18): the limiter buckets on FIXED 60s-aligned
      // windows (floor(now/60)*60) — if this loop straddles a window boundary the
      // count resets and the first 32 requests never trip it (~0.4% per run at CI's
      // ~260ms span; observed on the v0.3.15.1 CI run). Keep sending until the
      // limiter trips: worst case a boundary split costs one extra full bucket
      // (30 partial + 31 fresh ≈ 62 requests) — 75 covers it with margin.
      for (let i = 0; i < 75 && !tripped; i++) {
        last = await app.fetch(new Request('http://local/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true', Origin: 'http://local' },
          body: 'username=probe&email=probe@test.dev&password=correcthorsebattery&captcha=tok',
        }))
        tripped = (await last.text()).includes('Too many attempts')
      }
      // the 31st+ request is rate-limited, but as an htmx FRAGMENT at 200 so the error
      // actually renders — the pre-fix behavior was a 429 JSON htmx silently dropped
      expect(last!.status).toBe(200)
      expect(tripped).toBe(true)
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
          headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
          body: JSON.stringify({ email: 'nobody@test.dev' }), // unknown → ok, no email sent
        }))
        expect(res.status).toBe(200)
      }
      const blocked = await app.fetch(new Request('http://local/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
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
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7', Origin: 'http://local' },
          body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
        }))
        expect(res.status).toBe(401) // never blocked: separate budget
      }
      // the original 'local' budget is untouched
      const fresh = await app.fetch(new Request('http://local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
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
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret', Origin: 'http://local' },
          body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: 1 }, text: 'x' } }),
        }))
        expect(res.status).toBe(403) // wrong secret → 403, but still counted
      }
      // CI-timing flake guard (S91, 2026-09-20): the limiter's 60s windows are FIXED
      // wall-clock buckets (Math.floor(now/60)*60 — ratelimit.ts). A slow runner can
      // straddle a minute boundary mid-loop: the requests after the rollover count
      // into a FRESH bucket, the current bucket sits under 300, and the final
      // correct-secret request sailed through as 200 (CI run 35524029741 — expected
      // 429, received 200; locally green twice, purely a bucket-edge race). Top the
      // CURRENT bucket back up to 300 counted hits (wrong-secret requests are
      // 403-but-counted — the exact path the loop pins), then the limiter-precedes-
      // secret assertion is deterministic. A rollover landing in the final request's
      // few-ms gap is still possible in theory → up to 3 attempts, re-topping-up.
      const counted = async () =>
        (await db.query<{ count: number }>("SELECT count FROM rate_limits WHERE key = 'webhook:local'"))[0]?.count ?? 0
      const topUp = async () => {
        while (await counted() < 300) {
          const res = await app.fetch(new Request('http://local/api/telegram/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret', Origin: 'http://local' },
            body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: 1 }, text: 'x' } }),
          }))
          expect(res.status).toBe(403) // still counted, never blocked under 300
        }
      }
      let blocked: Response | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        await topUp()
        blocked = await app.fetch(new Request('http://local/api/telegram/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wxyz-secret', Origin: 'http://local' },
          body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: 1 }, text: 'x' } }),
        }))
        if (blocked.status === 429) break // the limiter ran BEFORE the secret check
      }
      expect(blocked!.status).toBe(429)
    } finally {
      close()
    }
  })
})