import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config, Db } from '../types'

// AP-34 (Phase 2, auditors P2-e F2/F3): the canvas offline-sync batch was all-or-nothing.
// ONE invalid element (content over the 10k cap, an unknown type from a newer client)
// 400'd the ENTIRE body — and the client's 400-drop rule then silently discarded every
// OTHER queued edit with it, after which the badge painted "Saved". The queue can also
// legally exceed the server's 500-element cap after long offline accumulation (one row
// per edit; a layer renumber writes one row per element) — that 400 mass-dropped the
// whole offline batch too. Server fix: per-element validation with skip + a `skipped`
// count in the response. Client fix (pinned in offline-queue.test.ts): chunked flush.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, telegramToken: 'test-bot', telegramSecret: 's' }
}

function h(token: string) {
  return { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
}

const el = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'note', x: 1, y: 2, content: 'c', z_index: 0, updated_at: new Date().toISOString(), ...over,
})

describe('AP-34 — canvas sync tolerates one bad element instead of poisoning the batch', () => {
  it('a 10k+ content element is SKIPPED; the valid elements in the same batch still land', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const app = createApp(makeConfig(db))
      const token = await createSession(db, uid)
      const good1 = crypto.randomUUID()
      const good2 = crypto.randomUUID()
      const bad = crypto.randomUUID()
      const res = await app.fetch(
        new Request('http://local/api/canvas/sync', {
          method: 'POST',
          headers: h(token),
          body: JSON.stringify({
            elements: [
              el(good1),
              el(bad, { content: 'x'.repeat(10_001) }), // over the cap — was a whole-batch 400
              el(good2),
            ],
          }),
        }),
      )
      expect(res.status).toBe(200) // old: 400 invalid_input — the WHOLE batch died
      const body = (await res.json()) as { applied: string[]; skipped: number }
      expect(body.skipped).toBe(1)
      expect(body.applied.sort()).toEqual([good1, good2].sort())
      const rows = await db.query<{ id: string }>('SELECT id FROM canvas_elements WHERE user_id = ?', [uid])
      expect(rows.map((r) => r.id).sort()).toEqual([good1, good2].sort())
    } finally {
      close()
    }
  })

  it('an unknown element type is skipped; a body that is not an element array still 400s', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const app = createApp(makeConfig(db))
      const token = await createSession(db, uid)
      const good = crypto.randomUUID()
      const res = await app.fetch(
        new Request('http://local/api/canvas/sync', {
          method: 'POST',
          headers: h(token),
          body: JSON.stringify({ elements: [el(good), el(crypto.randomUUID(), { type: 'hologram' })] }),
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { applied: string[]; skipped: number }
      expect(body.applied).toEqual([good])
      expect(body.skipped).toBe(1)
      // body-level malformation stays a 400
      const res2 = await app.fetch(
        new Request('http://local/api/canvas/sync', { method: 'POST', headers: h(token), body: JSON.stringify({ elements: 'nope' }) }),
      )
      expect(res2.status).toBe(400)
    } finally {
      close()
    }
  })
})
