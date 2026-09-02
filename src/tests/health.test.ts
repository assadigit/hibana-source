import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeTestDb } from './helpers'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Public health endpoint (ROADMAP P2 — monitoring). Unlike every data route, it must work
// WITHOUT a session (uptime monitors have no cookie) — so it is registered on the root app
// alongside the webhook, outside coreRoutes' requireAuth wildcard. It exposes app + DB
// liveness and the applied schema version, and nothing else.
describe('health endpoint', () => {
  const fakeAssets =
    (files: string[]) =>
    (url: URL): Promise<Response> => {
      const p = url.pathname
      if (files.includes(p)) return Promise.resolve(new Response(`<body>${p}</body>`, { status: 200 }))
      return Promise.resolve(new Response('Not Found', { status: 404 }))
    }

  function makeApp(db: Db) {
    return createApp({
      db,
      isProd: false,
      github: { owner: 'x', repo: 'y', token: '' },
      emailKey: undefined,
      assets: fakeAssets(['/login.html']),
    })
  }

  it('is public — no session needed, auth wildcard does not capture it', async () => {
    const { db, close } = makeTestDb()
    try {
      const res = await makeApp(db).fetch(new Request('http://local/api/health'))
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(body.db).toBe('up')
      expect(body.service).toBe('hibana')
      expect(body.environment).toBe('dev')
      // The migrations bookkeeping table is tracked per runtime; the Node runner's is
      // `_migrations`, so the version must equal the real number of applied migration
      // files — proving the drift signal is real, not a placeholder.
      const migrationCount = String(readdirSync(join(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql')).length)
      expect(body.schema_version).toBe(migrationCount)
    } finally {
      close()
    }
  })

  it('is not masked by the assets-first middleware (API routes stay API routes)', async () => {
    const { db, close } = makeTestDb()
    try {
      // The fake assets fetcher would serve /api/health as a "static file" if the
      // middleware wrongly claimed it — the health route must win instead.
      const res = await makeApp(db).fetch(new Request('http://local/api/health'))
      expect(res.status).toBe(200)
      expect((res.headers.get('content-type') || '')).toContain('application/json')
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(true)
    } finally {
      close()
    }
  })

  it('reports 503 when the DB is unreachable, without crashing', async () => {
    const broken: Db = {
      query: async () => {
        throw new Error('db gone')
      },
      execute: async () => {
        throw new Error('db gone')
      },
      transaction: async () => {
        throw new Error('db gone')
      },
    }
    const res = await makeApp(broken).fetch(new Request('http://local/api/health'))
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(false)
    expect(body.db).toBe('down')
  })

  it('exposes no user data — the payload is a fixed, safe key set (rule 8 spirit)', async () => {
    const { db, close } = makeTestDb()
    try {
      const res = await makeApp(db).fetch(new Request('http://local/api/health'))
      const body = (await res.json()) as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual(['db', 'environment', 'ok', 'schema_version', 'service', 'time'])
      const text = JSON.stringify(body)
      expect(text.toLowerCase()).not.toContain('user')
      expect(text.toLowerCase()).not.toContain('project')
      expect(text.toLowerCase()).not.toContain('password')
    } finally {
      close()
    }
  })
})