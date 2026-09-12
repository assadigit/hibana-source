import { describe, it, expect, afterEach } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S29 (agenda 4 — backup-health visibility): GET /api/admin/backup/status grew three
// fields the admin console now renders — health (fresh/late/stale/never/unknown from
// the newest snapshot filename's age), planb {count, lastSentAt} (the Telegram channel
// is on-demand only, so empty ≠ error — it's the standing owner action, surfaced), and
// encrypted (boolean — the key itself never leaves the worker). These tests pin:
//   1. owner-only gate (a member gets 403, same as every admin route)
//   2. freshness math: fresh ≤ 6h, late ≤ 12h, stale > 12h, never, unknown
//   3. the dashed-ISO filename round-trip (the ':' and '.' → '-' reconstruction)
//   4. planb bookkeeping reads the real table (count + lastSentAt)
//   5. every branch answers planb + encrypted (they are GitHub-independent)
// The GitHub Contents API is stubbed on globalThis.fetch — no network, real route code.

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** snapshot filename for "ageHours ago", in the exact dashed-ISO format backup.ts writes. */
const snapName = (ageHours: number) =>
  `snapshot-${new Date(Date.now() - ageHours * 3_600_000).toISOString().replace(/[:.]/g, '-')}.json`

/** Intercept the GitHub Contents API listing with the given snapshot names. */
function stubGithubDir(names: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/contents/backups')) {
      return new Response(
        JSON.stringify(names.map((n, i) => ({ name: n, path: `backups/${n}`, sha: `sha${i}`, type: 'file' }))),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

type Status = {
  configured?: boolean
  count?: number
  newest?: string | null
  newestAt?: string | null
  ageHours?: number | null
  health?: 'fresh' | 'late' | 'stale' | 'never' | 'unknown'
  retention?: number
  planb?: { count: number; lastSentAt: string | null }
  encrypted?: boolean
  error?: string
}

async function makeApp(db: Db, userId: string, over: Record<string, unknown> = {}) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: 'test-token' },
    emailKey: undefined,
    assets: undefined,
    ...over,
  })
  const token = await createSession(db, userId)
  return { app, cookie: `hibana_session=${token}` }
}

const get = (cookie: string) =>
  new Request('http://local/api/admin/backup/status', { headers: { Cookie: cookie } })

describe('admin backup status — health + planb + encrypted (S29 agenda 4)', () => {
  it('is owner-only: a member gets 403', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const memberId = await makeUser(db, { role: 'member' })
      const { app, cookie } = await makeApp(db, ownerId)
      const { app: memberApp, cookie: memberCookie } = await makeApp(db, memberId)

      const ok = await app.fetch(get(cookie))
      expect(ok.status).toBe(200)
      const denied = await memberApp.fetch(get(memberCookie))
      expect(denied.status).toBe(403)
    } finally {
      close()
    }
  })

  it('freshness ladder: 2h → fresh, 8h → late, 30h → stale (ageHours to 0.1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, cookie } = await makeApp(db, userId)
      for (const [age, expected] of [[2, 'fresh'], [8, 'late'], [30, 'stale']] as const) {
        const [older, newest] = [snapName(age + 10), snapName(age)] // computed once — ms jitter must not flip the sort
        stubGithubDir([older, newest])
        const res = await app.fetch(get(cookie))
        expect(res.status).toBe(200)
        const body = (await res.json()) as Status
        expect(body.health).toBe(expected)
        expect(body.ageHours).toBeGreaterThan(age - 0.2)
        expect(body.ageHours).toBeLessThan(age + 0.2)
        expect(body.newest).toBe(newest)
        expect(body.newestAt).toBeTypeOf('string')
        expect(body.count).toBe(2)
        expect(body.planb).toEqual({ count: 0, lastSentAt: null })
        expect(body.encrypted).toBe(false)
      }
    } finally {
      close()
    }
  })

  it('empty repo → health "never"; malformed newest name → "unknown" (never a crash)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, cookie } = await makeApp(db, userId)

      stubGithubDir([])
      const never = (await (await app.fetch(get(cookie))).json()) as Status
      expect(never.health).toBe('never')
      expect(never.newest).toBeNull()
      expect(never.newestAt).toBeNull()
      expect(never.ageHours).toBeNull()

      stubGithubDir(['snapshot-weird-name.json'])
      const unknown = (await (await app.fetch(get(cookie))).json()) as Status
      expect(unknown.health).toBe('unknown')
      expect(unknown.newest).toBe('snapshot-weird-name.json')
    } finally {
      close()
    }
  })

  it('planb bookkeeping reads the real table; encrypted reflects the key (every branch)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const sentAt = new Date(Date.now() - 5 * 3600_000).toISOString()
      await db.execute(
        'INSERT INTO planb_backups (id, user_id, chat_id, message_id, file_id, file_size, sha256, schema_version, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['p1', userId, '111', 1, 'f1', 1024, 'deadbeef', 48, sentAt],
      )
      // configured repo branch
      const { app, cookie } = await makeApp(db, userId, { backupEncryptionKey: 'a-key' })
      stubGithubDir([snapName(1)])
      const body = (await (await app.fetch(get(cookie))).json()) as Status
      expect(body.planb).toEqual({ count: 1, lastSentAt: sentAt })
      expect(body.encrypted).toBe(true)

      // unconfigured-repo branch still answers both (Plan B + key are GitHub-independent)
      const { app: bareApp, cookie: bareCookie } = await makeApp(db, userId, {
        github: { owner: 'x', repo: 'y', token: '' },
        backupEncryptionKey: 'a-key',
      })
      const bare = (await (await bareApp.fetch(get(bareCookie))).json()) as Status
      expect(bare.configured).toBe(false)
      expect(bare.planb).toEqual({ count: 1, lastSentAt: sentAt })
      expect(bare.encrypted).toBe(true)
    } finally {
      close()
    }
  })

  it('a GitHub listing failure reports the error as data WITHOUT dropping planb/encrypted', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, cookie } = await makeApp(db, userId)
      globalThis.fetch = (async () => new Response('boom', { status: 502 })) as typeof fetch
      const body = (await (await app.fetch(get(cookie))).json()) as Status
      expect(body.configured).toBe(true)
      expect(body.error).toContain('502')
      expect(body.planb).toEqual({ count: 0, lastSentAt: null })
      expect(body.encrypted).toBe(false)
      // and the status stays 200 — a GitHub hiccup must not break the console page
    } finally {
      close()
    }
  })
})
