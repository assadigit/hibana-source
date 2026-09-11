import { describe, it, expect, afterEach } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { pingHealthcheck, normalizePingUrl } from '../services/healthcheck'
import { scheduledBackup } from '../routes/admin'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Dead-man's switch (dr-integrity session, docs/dr-integrity-closeout.md §1):
// - pingHealthcheck: success → GET base; failure → GET base + '/fail'; never throws;
//   invalid URL is a no-op.
// - scheduledBackup: returns its outcome (pushed/skipped/failed) so the cron wiring can
//   translate it into the heartbeat — while still never throwing.

const originalFetch = globalThis.fetch
let calls: string[] = []

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('healthcheck — normalizePingUrl', () => {
  it('strips trailing slashes and accepts https URLs', () => {
    expect(normalizePingUrl('https://hc-ping.com/abc-123/')).toBe('https://hc-ping.com/abc-123')
    expect(normalizePingUrl(' https://hc-ping.com/xyz ')).toBe('https://hc-ping.com/xyz')
  })
  it('rejects unparseable / non-http URLs', () => {
    expect(normalizePingUrl('not a url')).toBeNull()
    expect(normalizePingUrl('ftp://example.com/x')).toBeNull()
    expect(normalizePingUrl('')).toBeNull()
  })
})

describe('healthcheck — pingHealthcheck', () => {
  it('success pings the base URL exactly once and returns true', async () => {
    stubFetch(() => new Response('OK'))
    const ok = await pingHealthcheck('https://hc-ping.com/uuid-1', true)
    expect(ok).toBe(true)
    expect(calls).toEqual(['https://hc-ping.com/uuid-1'])
  })

  it('failure pings base + /fail (healthchecks.io immediate-alert signal)', async () => {
    stubFetch(() => new Response('OK'))
    const ok = await pingHealthcheck('https://hc-ping.com/uuid-2/', false)
    expect(ok).toBe(true)
    expect(calls).toEqual(['https://hc-ping.com/uuid-2/fail'])
  })

  it('network rejection never throws — returns false (watchdog must not break the cron chain)', async () => {
    stubFetch(() => Promise.reject(new Error('dns broken')))
    await expect(pingHealthcheck('https://hc-ping.com/uuid-3', true)).resolves.toBe(false)
  })

  it('non-2xx response returns false without throwing', async () => {
    stubFetch(() => new Response('nope', { status: 503 }))
    await expect(pingHealthcheck('https://hc-ping.com/uuid-4', true)).resolves.toBe(false)
  })

  it('invalid URL → no fetch at all, returns false', async () => {
    stubFetch(() => new Response('OK'))
    await expect(pingHealthcheck('garbage', true)).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})

describe('healthcheck — scheduledBackup outcome contract', () => {
  function cfg(db: Db, over: Partial<Config> = {}): Config {
    return {
      db,
      isProd: true,
      github: { owner: 'x', repo: 'y', token: 'gt' },
      // T1 (SWOT Session 26): prod requires BACKUP_ENCRYPTION_KEY — use a valid
      // 32-byte AES-GCM key for tests that exercise the scheduledBackup prod path.
      backupEncryptionKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      ...over,
    }
  }

  it('no GITHUB_TOKEN → { kind: "skipped" } (a prod skip is heartbeat-fail worthy)', async () => {
    const { db, close } = makeTestDb()
    try {
      const out = await scheduledBackup(cfg(db, { github: { owner: 'x', repo: 'y', token: '' } }))
      expect(out.kind).toBe('skipped')
    } finally {
      close()
    }
  })

  it('GitHub push fails → { kind: "failed" } — still never throws', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      stubFetch(() => new Response('rate limited', { status: 403 }))
      const out = await scheduledBackup(cfg(db))
      expect(out.kind).toBe('failed')
    } finally {
      close()
    }
  })

  it('GitHub push succeeds → { kind: "pushed", path } (heartbeat-success path)', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      stubFetch((url) => {
        if (url.includes('api.github.com') && url.includes('contents/')) {
          return new Response(JSON.stringify({ content: { path: 'backups/snap.json', sha: 'abc' }, commit: { sha: 'd' } }), { status: 201 })
        }
        return new Response('OK')
      })
      const out = await scheduledBackup(cfg(db))
      expect(out.kind).toBe('pushed')
      if (out.kind === 'pushed') expect(out.path).toContain('backups/')
    } finally {
      close()
    }
  })
})
