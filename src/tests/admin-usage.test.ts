import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Admin Usage analytics (2026-09-12, the §6 open-items "feature-usage analytics +
// top-10 activity ranking"). The endpoint is one owner-scoped read; these tests pin:
//   1. owner-only — a member gets 403 (same gate class as /purge).
//   2. surface totals + shape — 17 features, correct counts, last_at recency.
//   3. soft-deletes are respected — a tombstoned project drops out of the totals.
//   4. project-scoped attribution — dev_tasks count under their project's owner.
//   5. weighted ranking — deliberate acts (project=3) outrank doodles (canvas=1),
//      and the board caps at 10 entries.
//   6. daily histogram — 14 zero-filled days, newest last, today carries today's rows.

async function makeAuthedApp(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    assets: undefined,
  })
  const token = await createSession(db, userId)
  return { app, cookie: `hibana_session=${token}` }
}

const post = (cookie: string, path: string, body: unknown) =>
  new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://local' },
    body: JSON.stringify(body),
  })
const get = (cookie: string, path: string) =>
  new Request('http://local' + path, { headers: { Cookie: cookie } })
const del = (cookie: string, path: string) =>
  new Request('http://local' + path, { method: 'DELETE', headers: { Cookie: cookie, Origin: 'http://local' } })

type Usage = {
  features: Array<{ key: string; count: number; last_at: string | null }>
  top_users: Array<{ id: string; username: string | null; email: string; score: number; parts: Record<string, number> }>
  daily: Array<{ day: string; count: number }>
}

describe('admin usage analytics (2026-09-12)', () => {
  it('is owner-only: a member gets 403 and no data', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const member = await makeUser(db, { role: 'member' })
      const { app: appMember, cookie: cm } = await makeAuthedApp(db, member)
      const { app: appOwner, cookie: co } = await makeAuthedApp(db, owner)
      await appOwner.fetch(post(co, '/api/projects', { title: 'owner-project' }))

      const res = await appMember.fetch(get(cm, '/api/admin/usage'))
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('forbidden')
    } finally {
      close()
    }
  })

  it('returns 17 surface totals with counts and last_at recency', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const { app, cookie } = await makeAuthedApp(db, owner)
      await app.fetch(post(cookie, '/api/projects', { title: 'Star Map' }))
      await app.fetch(
        post(cookie, '/api/canvas/sync', {
          elements: [
            { id: crypto.randomUUID(), type: 'note', x: 1, y: 2, width: 10, height: 10, color: '#fff', content: 'hi', z_index: 0, deleted: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          ],
        }),
      )

      const res = await app.fetch(get(cookie, '/api/admin/usage'))
      expect(res.status).toBe(200)
      const usage = (await res.json()) as Usage
      expect(usage.features).toHaveLength(17)
      const keys = usage.features.map((f) => f.key)
      expect(keys).toContain('projects')
      expect(keys).toContain('notebook')
      expect(keys).toContain('telegramCaptures')
      const projects = usage.features.find((f) => f.key === 'projects')!
      expect(projects.count).toBe(1)
      expect(projects.last_at).toBeTruthy()
      const canvas = usage.features.find((f) => f.key === 'canvas')!
      expect(canvas.count).toBe(1)
      // Zero surfaces report null recency, not a bogus timestamp
      const empty = usage.features.find((f) => f.key === 'payments')!
      expect(empty.count).toBe(0)
      expect(empty.last_at).toBeNull()
    } finally {
      close()
    }
  })

  it('never counts tombstoned rows: a soft-deleted project drops out of the totals', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const { app, cookie } = await makeAuthedApp(db, owner)
      const created = await app.fetch(post(cookie, '/api/projects', { title: 'gone-soon', status: 'spark' }))
      const { id } = (await created.json()) as { id: string }
      await app.fetch(del(cookie, `/api/projects/${id}`))

      const usage = (await (await app.fetch(get(cookie, '/api/admin/usage'))).json()) as Usage
      expect(usage.features.find((f) => f.key === 'projects')!.count).toBe(0)
      // And it never contributed to the ranking either
      expect(usage.top_users.find((u) => u.id === owner)).toBeUndefined()
    } finally {
      close()
    }
  })

  it('attributes project-scoped rows to the project owner and ranks by weighted score', async () => {
    const { db, close } = makeTestDb()
    try {
      const heavy = await makeUser(db, { role: 'owner', username: 'heavy', email: 'heavy@test.dev' })
      const doodler = await makeUser(db, { role: 'member', username: 'doodler', email: 'doodler@test.dev' })
      const { app: appH, cookie: ch } = await makeAuthedApp(db, heavy)
      const { app: appD, cookie: cd } = await makeAuthedApp(db, doodler)

      // heavy: one project + one dev task under it (3 + 2 = 5)
      const created = await appH.fetch(post(ch, '/api/projects', { title: 'planned-work' }))
      const { id: pid } = (await created.json()) as { id: string }
      await db.execute(
        "INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at) VALUES ('dt1', ?, 'build', 'idea', 'medium', 0, ?)",
        [pid, new Date().toISOString()],
      )
      // doodler: three canvas strokes (3 × 1 = 3)
      const now = new Date().toISOString()
      for (let i = 0; i < 3; i++) {
        await appD.fetch(
          post(cd, '/api/canvas/sync', {
            elements: [{ id: crypto.randomUUID(), type: 'stroke', x: 0, y: 0, width: null, height: null, color: '#000', content: '[[0,0]]', z_index: i, deleted: 0, created_at: now, updated_at: now }],
          }),
        )
      }

      const usage = (await (await appH.fetch(get(ch, '/api/admin/usage'))).json()) as Usage
      const devTasks = usage.features.find((f) => f.key === 'devTasks')!
      expect(devTasks.count).toBe(1) // joined through to the (live) project
      expect(devTasks.last_at).toBeTruthy()

      const heavyRow = usage.top_users.find((u) => u.id === heavy)!
      expect(heavyRow.score).toBe(5)
      expect(heavyRow.parts.devtasks).toBe(1)
      const doodlerRow = usage.top_users.find((u) => u.id === doodler)!
      expect(doodlerRow.score).toBe(3)
      // Weighted ranking: deliberate acts first, doodles second
      expect(usage.top_users[0].id).toBe(heavy)
    } finally {
      close()
    }
  })

  it('caps the ranking at 10 users, highest score first', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const { app, cookie } = await makeAuthedApp(db, owner)
      // 12 users; user k owns k canvas elements → score = k. Direct SQL (no API
      // round-trips): canvas_elements carries a NOT NULL user FK, so every row is
      // attributable — the orphan-filter path in the endpoint is FK-redundant defense
      // for restore-imported edge cases and cannot be materialized here (by design).
      const now = new Date().toISOString()
      for (let k = 1; k <= 12; k++) {
        const uid = await makeUser(db, { role: 'member', username: `user${String(k).padStart(2, '0')}`, email: `u${k}@test.dev` })
        for (let j = 0; j < k; j++) {
          await db.execute(
            'INSERT INTO canvas_elements (id, user_id, type, x, y, color, content, z_index, deleted, created_at, updated_at, board) VALUES (?, ?, \'note\', 0, 0, \'#fff\', \'x\', 0, 0, ?, ?, \'canvas\')',
            [crypto.randomUUID(), uid, now, now],
          )
        }
      }

      const usage = (await (await app.fetch(get(cookie, '/api/admin/usage'))).json()) as Usage
      expect(usage.top_users).toHaveLength(10)
      // Ranked descending by score: user12 (12) first … user3 (3) last; user1/user2 cut.
      expect(usage.top_users[0].username).toBe('user12')
      expect(usage.top_users[9].username).toBe('user03')
      expect(usage.top_users.map((u) => u.username)).not.toContain('user01')
      expect(usage.top_users.map((u) => u.username)).not.toContain('user02')
    } finally {
      close()
    }
  })

  it('daily histogram is 14 zero-filled days, newest last, today carries today’s rows', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const { app, cookie } = await makeAuthedApp(db, owner)
      await app.fetch(post(cookie, '/api/projects', { title: 'today-1' }))
      await app.fetch(post(cookie, '/api/projects', { title: 'today-2' }))
      // A row dated 40 days ago — outside the 14-day window, must not appear
      await db.execute(
        'INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (\'q-old\', ?, \'note\', \'ancient\', \'x\', ?, ?)',
        [owner, new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(), new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()],
      )

      const usage = (await (await app.fetch(get(cookie, '/api/admin/usage'))).json()) as Usage
      expect(usage.daily).toHaveLength(14)
      const today = new Date().toISOString().slice(0, 10)
      expect(usage.daily[13].day).toBe(today)
      expect(usage.daily[13].count).toBe(2)
      expect(usage.daily.slice(0, 13).every((d) => d.count === 0)).toBe(true)
      const total = usage.daily.reduce((n, d) => n + d.count, 0)
      expect(total).toBe(2) // the 40-day-old note is outside the window
    } finally {
      close()
    }
  })
})
