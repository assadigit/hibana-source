import { describe, it, expect, vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Phase 3 error-consistency fixes (AP-52/AP-53/AP-54): one code ↔ one status.
// Before these fixes the same error string was answered at different statuses on
// different routes (folder_not_found 400 vs 404; too_many 400 vs 413; the email
// failure spelled two ways at 502/503) — clients could not branch reliably.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key', assets: undefined }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

describe('AP-52: folder_not_found is a 404 on every surface', () => {
  it('POST /api/vault/notes with an unknown folderId answers 404 (was 400)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { email: 'p52a@test.dev' })
      const client = await makeClient(db, userId)
      const res = await client.app.fetch(new Request('http://local/api/vault/notes', {
        method: 'POST',
        headers: client.auth,
        body: JSON.stringify({ title: 't', content: 'c', folderId: '11111111-1111-4111-8111-111111111111' }),
      }))
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: string }).error).toBe('folder_not_found')
    } finally {
      close()
    }
  })

  it('PATCH /api/vault/notes/:id moving to an unknown folder answers 404 (was 400)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { email: 'p52b@test.dev' })
      const client = await makeClient(db, userId)
      const mk = await client.app.fetch(new Request('http://local/api/vault/notes', {
        method: 'POST', headers: client.auth, body: JSON.stringify({ title: 't', content: 'c' }),
      }))
      const { note } = (await mk.json()) as { note: { id: string } }
      const res = await client.app.fetch(new Request(`http://local/api/vault/notes/${note.id}`, {
        method: 'PATCH', headers: client.auth, body: JSON.stringify({ folderId: '11111111-1111-4111-8111-111111111111' }),
      }))
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: string }).error).toBe('folder_not_found')
    } finally {
      close()
    }
  })
})

describe('AP-53: too_many (400) vs too_large (413) — count vs payload', () => {
  it('POST /api/import/obsidian with 201 direct files answers 400 too_many', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db, { email: 'p53a@test.dev' })
      const client = await makeClient(db, userId)
      const form = new FormData()
      for (let i = 0; i < 201; i++) form.append('files', new Blob([`# note ${i}\n`], { type: 'text/markdown' }), `n${i}.md`)
      const res = await client.app.fetch(new Request('http://local/api/import/obsidian', {
        method: 'POST', headers: { Cookie: client.auth.Cookie, Origin: 'http://local' }, body: form,
      }))
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('too_many')
    } finally {
      close()
    }
  })

  // Source-contract pin (the route-level 413 paths need a >64MB zip or >100MB body —
  // impractical in unit tests; the taxonomy is pinned against the source instead,
  // the same pattern Phase 2 used for client-side contracts):
  // the payload-size rejections must answer too_large @ 413, the count rejection
  // too_many @ 400 — one code, one status, on every site.
  it('import.ts source contract: 413 sites say too_large, 400 site says too_many', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/routes/integrations/import.ts', 'utf8'))
    // Line-level check (template literals in messages break naive regex pairing).
    const large = src.split('\n').filter((l) => l.includes('ErrorCode.too_large'))
    const many = src.split('\n').filter((l) => l.includes('ErrorCode.too_many'))
    expect(large.length).toBe(2) // payload budget + zip budget
    expect(large.every((l) => l.includes('413'))).toBe(true)
    expect(many.length).toBe(1) // file-count cap
    expect(many.every((l) => l.includes('400'))).toBe(true)
    expect(src.includes('email_send_failed')).toBe(false) // AP-54: spelling retired repo-wide (this file)
  })
})

describe('AP-54: the email failure is ONE code at ONE status — email_failed @ 502', () => {
  it('reset/request answers 502 email_failed (was 503 email_send_failed)', async () => {
    const { db, close } = makeTestDb()
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ SECRET_PROVIDER_DETAIL: 'internals' }), { status: 500 }))
    try {
      await makeUser(db, { email: 'p54a@test.dev' })
      const app = createApp(makeConfig(db))
      const res = await app.fetch(new Request('http://local/api/auth/reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
        body: JSON.stringify({ email: 'p54a@test.dev' }),
      }))
      expect(res.status).toBe(502)
      expect(((await res.json()) as { error: string }).error).toBe('email_failed')
    } finally {
      vi.unstubAllGlobals()
      close()
    }
  })
})
