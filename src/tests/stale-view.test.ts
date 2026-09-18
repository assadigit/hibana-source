import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S75: the FULL stale view (GET /api/projects?stale=1 — /projects.html?stale=1).
// Same semantics as the S72 dashboard nudge (one source of truth, both 14 days):
// in-motion projects (unreviewed/investigating/awaiting/doing) untouched 14+ days,
// OLDEST first. halted/operational/spark are excluded by design. Covered here:
// auth, the filter itself, the ordering, stage exclusions, composition with a
// status filter, the HX banner fragment (+ its exit hatch), and the honest
// empty state when nothing is stale.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

const DAY = 24 * 3600 * 1000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()

async function seedProject(db: Db, userId: string, id: string, title: string, status: string, daysAgo: number) {
  await db.execute(
    'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, title, status, iso(daysAgo), iso(daysAgo)],
  )
}

type P = { id: string; title: string; status: string; updated_at: string }

async function listJson(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, query: string): Promise<P[]> {
  const res = await client.app.fetch(new Request(`http://local/api/projects${query}`, { headers: client.auth }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { projects: P[] }
  return body.projects
}

describe('stale view (S75 — projects.html?stale=1)', () => {
  it('requires auth', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db))
      const res = await app.fetch(new Request('http://local/api/projects?stale=1'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('lists in-motion projects untouched 14+ days, oldest first — and excludes halted/operational/spark/fresh', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 's-old', 'Oldest hanging', 'unreviewed', 40)
      await seedProject(db, user, 's-mid', 'Mid hanging', 'doing', 20)
      await seedProject(db, user, 's-edge', 'Exactly at the line (15d)', 'awaiting', 15)
      // Excluded by design: deliberately paused, done, raw capture, too fresh.
      await seedProject(db, user, 'x-halted', 'Halted', 'halted', 40)
      await seedProject(db, user, 'x-op', 'Operational', 'operational', 40)
      await seedProject(db, user, 'x-spark', 'Spark', 'spark', 40)
      await seedProject(db, user, 'x-fresh', 'Fresh', 'doing', 3)
      // Other users' rows are invisible (rule 1).
      const other = await makeUser(db)
      await seedProject(db, other, 'o-1', 'Their stale', 'doing', 30)

      const client = await makeClient(db, user)
      const rows = await listJson(client, '?stale=1')
      expect(rows.map((p) => p.id)).toEqual(['s-old', 's-mid', 's-edge'])
      // Oldest first — the whole point is "what you left hanging longest".
      expect(rows[0].updated_at <= rows[1].updated_at).toBe(true)
      expect(rows[1].updated_at <= rows[2].updated_at).toBe(true)
    } finally {
      close()
    }
  })

  it('composes with a status filter (stale + doing = stale doing projects only)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 's-doing', 'Stale doing', 'doing', 20)
      await seedProject(db, user, 's-unrev', 'Stale unreviewed', 'unreviewed', 20)
      const client = await makeClient(db, user)
      const rows = await listJson(client, '?stale=1&status=doing')
      expect(rows.map((p) => p.id)).toEqual(['s-doing'])
    } finally {
      close()
    }
  })

  it('degrades a stray stale value instead of failing the whole query parse', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 'n-1', 'Normal', 'doing', 1)
      const client = await makeClient(db, user)
      // stale=0 (not '1') → undefined → the plain list; the other params still parse.
      const rows = await listJson(client, '?stale=0&sort=recent')
      expect(rows.map((p) => p.id)).toEqual(['n-1'])
    } finally {
      close()
    }
  })

  it('HX fragment: banner + cards, and the honest empty state when nothing is stale', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 's-1', 'Hanging', 'investigating', 21)
      const client = await makeClient(db, user)

      const hx = { ...client.auth, 'HX-Request': 'true' }
      const res = await client.app.fetch(new Request('http://local/api/projects?stale=1&view=grid', { headers: hx }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('pg-stale-banner')
      expect(html).toContain('data-stale-clear')
      expect(html).toContain('Untouched for 2+ weeks')
      expect(html).toContain('oldest first')
      // view=grid degrades to cards — the stages home is meaningless for the special view.
      expect(html).toContain('card-grid')
      expect(html).not.toContain('pglance-grid')

      // Empty: nothing hanging → the dedicated empty state, NOT "No projects yet".
      await db.execute("UPDATE projects SET updated_at = ? WHERE id = 's-1'", [iso(1)])
      const res2 = await client.app.fetch(new Request('http://local/api/projects?stale=1', { headers: hx }))
      const html2 = await res2.text()
      expect(html2).toContain('pg-stale-empty')
      expect(html2).toContain('Nothing is hanging')
      expect(html2).not.toContain('No projects yet')
    } finally {
      close()
    }
  })
})
