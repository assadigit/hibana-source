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

  it('RATE_LIMIT_DISABLE=1 turns the limiter off (the S105 e2e login-burst root cause)', async () => {
    // S105 (2026-09-21): the playwright suite logs in ~180× from one IP; >30 inside a
    // rolling 60s window made the 31st login a 429 → random login() waitForURL
    // timeouts on CI. playwright.config.ts now boots the e2e server with
    // RATE_LIMIT_DISABLE=1 — this pin holds that contract: the flag means NEVER block.
    // (Vitest itself runs with the flag unset, so the other tests above keep the
    // limiter's real behavior fully covered.)
    const { db, close } = makeTestDb()
    const prev = process.env.RATE_LIMIT_DISABLE
    process.env.RATE_LIMIT_DISABLE = '1'
    try {
      await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
      const statuses: number[] = []
      for (let i = 0; i < 60; i++) { // double the 30/60s auth budget — none may 429
        const res = await app.fetch(new Request('http://local/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
          body: JSON.stringify({ login: 'a-user@test.dev', password: 'wrong-password' }),
        }))
        statuses.push(res.status)
      }
      expect(statuses).not.toContain(429)
      expect(statuses.every((s) => s === 401)).toBe(true) // still authenticated, just never limited
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM rate_limits')
      expect(rows[0].n).toBe(0) // the flag short-circuits BEFORE the DB write
    } finally {
      if (prev === undefined) delete process.env.RATE_LIMIT_DISABLE
      else process.env.RATE_LIMIT_DISABLE = prev
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

// S108 (2026-09-22, the P0 hotfix pin): the S105 kill-switch read bare `process.env`
// inside src/services/ratelimit.ts — shared code that ALSO runs on Cloudflare Workers,
// where `process` does not exist. Every rate-limited endpoint (login, signup, reset,
// uploads, AI, exports…) 500'd in prod with `ReferenceError: process is not defined`
// (three login 500s in the live error_log, 2026-09-22). This static pin guards the
// whole CLASS: shared src/ code (everything except the Node-only entry server.ts and
// the Node-only disk-shots/migrate scripts) must reference `process` ONLY behind a
// `typeof process` guard. A bare reference here would compile fine in vitest (Node)
// and only explode after the next deploy — exactly the S105r3 failure shape.
describe('Workers runtime safety (S108 pin)', () => {
  const NODE_ONLY = new Set([
    'src/server.ts', // the Node entry — process is its native env
    'src/services/disk-shots.ts', // Node-only object store (HIBANA_SHOTS_DIR)
    'src/db/migrate-node.ts', // the Node migration runner
  ])
  const ROOT = new URL('../..', import.meta.url).pathname
  const SHARED = [
    'src/services/ratelimit.ts',
  ]
  it('shared runtime code never touches a bare `process` global (Workers has none)', async () => {
    const { readFileSync } = await import('node:fs')
    for (const rel of SHARED) {
      const src = readFileSync(ROOT + rel, 'utf-8')
      const bare = src.match(/(^|[^.\w])process\./g)
      const guarded = src.match(/typeof process\s*!==\s*['"]undefined['"]\s*&&\s*process\./g) ?? []
      // every `process.` occurrence must be preceded by the typeof guard on the same line
      const lines = src.split('\n').filter((l) => /(^|[^.\w])process\./.test(l))
      const unguarded = lines.filter((l) => !/typeof process\s*!==\s*['"]undefined['"]/.test(l) && !/^\s*\/\//.test(l))
      expect(unguarded, `${rel} must guard every process ref (bare hits: ${bare?.length ?? 0}, guarded: ${guarded.length})`).toEqual([])
    }
    // and the S108 fix itself is present in the limiter
    const limiter = readFileSync(ROOT + 'src/services/ratelimit.ts', 'utf-8')
    expect(limiter).toContain("typeof process !== 'undefined' && process.env.RATE_LIMIT_DISABLE")
  })
  it('the Node-only allowlist stays honest (no new shared file silently gains process)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const name of readdirSync(dir)) {
        const p = dir + '/' + name
        if (statSync(p).isDirectory()) {
          if (p.endsWith('/src/tests')) continue // test code never ships to Workers
          out.push(...walk(p))
        } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p)
      }
      return out
    }
    const files = walk(ROOT + 'src')
    const offenders: string[] = []
    for (const f of files) {
      const rel = f.replace(ROOT, '')
      if (NODE_ONLY.has(rel)) continue
      const src = readFileSync(f, 'utf-8')
      const lines = src.split('\n').filter((l) => /(^|[^.\w])process\./.test(l) && !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      const unguarded = lines.filter((l) => !/typeof process\s*!==\s*['"]undefined['"]/.test(l))
      if (unguarded.length) offenders.push(`${rel}: ${unguarded.length} bare process ref(s)`)
    }
    expect(offenders, 'shared code must not reference bare `process` — Workers throws ReferenceError').toEqual([])
  })
})