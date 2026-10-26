import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'

// Phase 1 (PLAYBOOK §5 — uploads): the declared MIME must match the sniffed magic
// bytes of the payload. These tests were RED against the pre-fix route (the bytes
// were never inspected) and GREEN after: mislabeled HTML can no longer ride an
// image/png path into the store, every allowlisted type accepts its true container,
// declared text with binary magic is refused, and a non-WebP thumb is dropped
// (best-effort tile) while a real WebP thumb is stored.

const magic = (bytes: number[], tail = 'payload') =>
  Buffer.concat([Buffer.from(bytes), Buffer.from(tail)]).toString('base64')
const PNG = magic([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = magic([0xff, 0xd8, 0xff, 0xe0])
const WEBP = magic([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const GIF = magic([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBM = magic([0x1a, 0x45, 0xdf, 0xa3])
const ZIP = magic([0x50, 0x4b, 0x03, 0x04])
const PDF = magic([0x25, 0x50, 0x44, 0x46], '-1.4 test doc\n')
const TEXT = Buffer.from('a,b,c\n1,2,3\n').toString('base64')
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>').toString('base64')

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function setup() {
  const { db, close } = makeTestDb()
  const userId = await makeUser(db)
  const projectId = crypto.randomUUID()
  await db.execute(
    "INSERT INTO projects (id, user_id, title, type, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, 'personal', 'planning', 0, ?, ?)",
    [projectId, userId, 'Sniff test', new Date().toISOString(), new Date().toISOString()],
  )
  const app = createApp({ db, isProd: false, github: { owner: 'o', repo: 'r', token: 't' }, assets: undefined })
  const token = await createSession(db, userId)
  const auth = { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }

  // GitHub Contents API stub: GET (SHA probe) → 404, PUT → 201; PUTs are captured.
  const puts: string[] = []
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://api.github.com/repos/o/r/contents/')) {
      if (init?.method === 'PUT') puts.push(url)
      return new Response(JSON.stringify({ content: { html_url: 'x' } }), { status: init?.method === 'PUT' ? 201 : 404, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200 })
  }) as typeof fetch)

  const upload = (mimeType: string, dataBase64: string, extra: Record<string, unknown> = {}) =>
    app.fetch(new Request(`http://local/api/projects/${projectId}/screenshots`, {
      method: 'POST', headers: auth, body: JSON.stringify({ fileName: 'f.bin', mimeType, dataBase64, ...extra }),
    }))

  return { db, close, upload, puts }
}

afterEach(() => vi.unstubAllGlobals())

describe('upload content sniffing (Phase 1 fix)', () => {
  it('rejects mislabeled payloads: HTML-as-png, gif-as-png, png-as-jpeg, pdf-as-text', async () => {
    const { close, upload } = await setup()
    try {
      expect((await upload('image/png', HTML)).status).toBe(400) // the auditor's canonical exploit
      expect((await upload('image/png', GIF)).status).toBe(400)
      expect((await upload('image/jpeg', PNG)).status).toBe(400)
      expect((await upload('text/plain', PDF)).status).toBe(400) // binary magic riding a text label
      expect((await upload('image/png', 'not-base64-at-all!!')).status).toBe(400) // undecodable bytes die too
    } finally {
      close()
    }
  })

  it('accepts every allowlisted type with its true container', async () => {
    const { close, upload } = await setup()
    try {
      const cases: [string, string][] = [
        ['image/png', PNG], ['image/jpeg', JPEG], ['image/webp', WEBP], ['image/gif', GIF],
        ['video/webm', WEBM], ['application/pdf', PDF], [XLSX, ZIP], [DOCX, ZIP],
        ['text/csv', TEXT], ['text/markdown', TEXT], ['text/plain', TEXT],
      ]
      for (const [mimeType, data] of cases) {
        expect(`${mimeType} → ${(await upload(mimeType, data)).status}`).toBe(`${mimeType} → 201`)
      }
    } finally {
      close()
    }
  })

  it('a non-WebP thumb is dropped while the upload succeeds; a real WebP thumb is stored', async () => {
    const { close, upload, puts } = await setup()
    try {
      // PNG payload + a PNG-magic thumb (not webp) → 201, no .thumb object written
      let res = await upload('image/png', PNG, { thumbBase64: PNG })
      expect(res.status).toBe(201)
      expect(puts.filter((u) => u.endsWith('.thumb'))).toHaveLength(0)

      // PNG payload + a genuine WebP thumb → 201, one .thumb object written
      puts.length = 0
      res = await upload('image/png', PNG, { thumbBase64: WEBP })
      expect(res.status).toBe(201)
      expect(puts.filter((u) => u.endsWith('.thumb'))).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('the sniff result gates storage: a rejected upload writes no objects at all', async () => {
    const { close, upload, puts } = await setup()
    try {
      const res = await upload('image/png', HTML)
      expect(res.status).toBe(400)
      expect(puts).toHaveLength(0) // nothing reached any storage tier
      const body = (await res.json()) as { error?: string }
      expect(body.error).toBe('mime_mismatch')
    } finally {
      close()
    }
  })
})
