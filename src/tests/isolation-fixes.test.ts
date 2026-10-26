import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Phase 1 (PLAYBOOK §5 — Security and data isolation): regression pins for the three
// SC-5 write-scoping fixes. Each test was RED against the pre-fix code and GREEN after:
//   1. canvas sync's ON CONFLICT arm must not update another user's element
//      (the LWW pre-check only sees the caller's rows — a foreign id rode the
//      conflict arm straight onto the victim's row).
//   2. the screenshot-delete cover_shot_id clear must stay user-scoped (drift rows
//      in other users' projects keep their value; the serve path degrades gracefully).
//   3. the project-logo byte route must declare Cache-Control: private like every
//      other authed byte route (media/avatar/banner) — the shared-cache tier does
//      not key on cookies.

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
  const token = await createSession(db, userId)
  return {
    app,
    auth: { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } as Record<string, string>,
  }
}

const ago = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
const nowIso = () => new Date().toISOString()

const canvasEl = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  type: 'note' as const,
  x: 10,
  y: 20,
  width: 160,
  height: 120,
  color: '#fef08a',
  content: 'A secret note',
  z_index: 0,
  deleted: 0,
  created_at: ago(30),
  updated_at: ago(2),
  ...over,
})

describe('canvas sync cross-user write scoping (SC-5, Phase 1 fix)', () => {
  it('a foreign element id can neither overwrite nor tombstone another user\'s element', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, auth: authA } = await makeClient(db, a)
      const { app: appB, auth: authB } = await makeClient(db, b)

      // A owns element X with private content
      const X = canvasEl({ content: 'A secret note', updated_at: ago(1) })
      let res = await appA.fetch(new Request('http://local/api/canvas/sync', {
        method: 'POST', headers: authA, body: JSON.stringify({ elements: [X] }),
      }))
      expect(res.status).toBe(200)
      const applied1 = (await res.json()) as { applied: string[] }
      expect(applied1.applied).toContain(X.id)

      // B — knowing X's id — tries to overwrite it with newer LWW stamps
      res = await appB.fetch(new Request('http://local/api/canvas/sync', {
        method: 'POST', headers: authB,
        body: JSON.stringify({ elements: [canvasEl({ id: X.id, content: 'B was here', updated_at: nowIso() })] }),
      }))
      expect(res.status).toBe(200) // the sync itself succeeds — the foreign element is just ignored

      // A's element is untouched
      res = await appA.fetch(new Request('http://local/api/canvas/full', { headers: authA }))
      const full = (await res.json()) as { elements: { id: string; content: string; deleted: number }[] }
      const aEl = full.elements.find((e) => e.id === X.id)
      expect(aEl).toBeDefined()
      expect(aEl!.content).toBe('A secret note')
      expect(aEl!.deleted).toBe(0)

      // B never gained the element either
      res = await appB.fetch(new Request('http://local/api/canvas/full', { headers: authB }))
      const bFull = (await res.json()) as { elements: { id: string }[] }
      expect(bFull.elements.find((e) => e.id === X.id)).toBeUndefined()

      // B tries the tombstone route: deleted:1 with the newest stamp
      res = await appB.fetch(new Request('http://local/api/canvas/sync', {
        method: 'POST', headers: authB,
        body: JSON.stringify({ elements: [canvasEl({ id: X.id, deleted: 1, updated_at: new Date(Date.now() + 60_000).toISOString() })] }),
      }))
      expect(res.status).toBe(200)

      res = await appA.fetch(new Request('http://local/api/canvas/full', { headers: authA }))
      const full2 = (await res.json()) as { elements: { id: string; content: string; deleted: number }[] }
      const aEl2 = full2.elements.find((e) => e.id === X.id)
      expect(aEl2).toBeDefined()
      expect(aEl2!.content).toBe('A secret note')
      expect(aEl2!.deleted).toBe(0)
    } finally {
      close()
    }
  })

  it('the same user\'s own LWW overwrite still works (the guard only fences foreign rows)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app, auth } = await makeClient(db, a)
      const X = canvasEl({ content: 'v1', updated_at: ago(1) })
      await app.fetch(new Request('http://local/api/canvas/sync', { method: 'POST', headers: auth, body: JSON.stringify({ elements: [X] }) }))
      await app.fetch(new Request('http://local/api/canvas/sync', {
        method: 'POST', headers: auth, body: JSON.stringify({ elements: [canvasEl({ id: X.id, content: 'v2', updated_at: nowIso() })] }),
      }))
      const res = await app.fetch(new Request('http://local/api/canvas/full', { headers: auth }))
      const full = (await res.json()) as { elements: { id: string; content: string }[] }
      expect(full.elements.find((e) => e.id === X.id)?.content).toBe('v2')
    } finally {
      close()
    }
  })
})

describe('screenshot delete: cover_shot_id clear stays user-scoped (SC-5, Phase 1 fix)', () => {
  it('deleting A\'s shot never nulls a drift cover reference on B\'s project, but does clear A\'s own', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, auth: authA } = await makeClient(db, a)

      // A creates a project and a shot row on it (github_path NULL — storage is
      // best-effort on delete, so the row-level contract is what we pin).
      let res = await appA.fetch(new Request('http://local/api/projects', {
        method: 'POST', headers: authA, body: JSON.stringify({ title: 'A project', status: 'unreviewed' }),
      }))
      const aProject = (await res.json()) as { id: string }
      const shotId = crypto.randomUUID()
      await db.execute(
        'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, 8, ?, ?)',
        [shotId, aProject.id, `u/a/${aProject.id}/screenshots/${shotId}-s.png`, 'image/png', '', 's.png', nowIso()],
      )

      // B's project drift-references A's shot (legacy restore / DB tampering simulation)
      const bProjectId = crypto.randomUUID()
      await db.execute(
        'INSERT INTO projects (id, user_id, title, type, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [bProjectId, b, 'B project', 'personal', 'planning', nowIso(), nowIso()],
      )
      await db.execute('UPDATE projects SET cover_shot_id = ? WHERE id = ?', [shotId, bProjectId])

      // A's own project also uses the shot as its cover — the legitimate case
      await db.execute('UPDATE projects SET cover_shot_id = ? WHERE id = ?', [shotId, aProject.id])

      res = await appA.fetch(new Request(`http://local/api/screenshots/${shotId}`, { method: 'DELETE', headers: authA }))
      expect(res.status).toBe(200)

      // B's drift reference survives (the serve path degrades a missing shot on its own)
      const bRow = await db.query<{ cover_shot_id: string | null }>('SELECT cover_shot_id FROM projects WHERE id = ?', [bProjectId])
      expect(bRow[0]!.cover_shot_id).toBe(shotId)

      // A's own reference was cleared — the S161 behavior itself is unchanged
      const aRow = await db.query<{ cover_shot_id: string | null }>('SELECT cover_shot_id FROM projects WHERE id = ?', [aProject.id])
      expect(aRow[0]!.cover_shot_id).toBeNull()
    } finally {
      close()
    }
  })
})

describe('project logo byte route: Cache-Control contract (P1-a-2, Phase 1 fix)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serves authed logo bytes with a private cache directive, like media/avatar/banner', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: 'test-token' }, assets: undefined })
      const token = await createSession(db, u)
      const auth = { Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' }

      let res = await app.fetch(new Request('http://local/api/projects', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Logo\'d', status: 'unreviewed' }),
      }))
      const p = (await res.json()) as { id: string }
      const logoPath = `project-logos/${p.id}/logo-1.png`
      await db.execute('UPDATE projects SET logo_path = ? WHERE id = ?', [logoPath, p.id])

      // The GitHub assets read is stubbed — the header contract is the unit under test.
      vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        if (String(input).includes('api.github.com')) {
          return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { status: 200 })
        }
        return new Response('{}', { status: 404 })
      })

      res = await app.fetch(new Request(`http://local/api/projects/${p.id}/logo/file`, { headers: auth }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600')
      expect(res.headers.get('Cache-Control')!.startsWith('private')).toBe(true)
    } finally {
      close()
    }
  })
})
