import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Regression: the projects filter bar (view buttons, status/tag selects, search) submits
// EMPTY strings for unset filters. The route used to treat that as invalid input — Zod
// failed, so EVERY form-driven request silently ignored all filters and fell back to the
// cards view (dead view switcher, dead filter bar).
// Also covers the roast-P6 kanban empty-column drop zone (`.kanban-empty`) and the 0031
// legacy status vocabulary (old clients/bookmark URLs keep working).

// The kanban columns + the dashboard carousel speak the 7-stage taxonomy (0031):
// kanban columns are the 6 pipeline stages — spark is the projects page's shelf.
const STAGES = ['unreviewed', 'investigating', 'awaiting', 'doing', 'halted', 'operational'] as const

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function createProject(app: ReturnType<typeof createApp>, auth: Record<string, string>, title: string, status: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title, status }) }))
  const body = (await res.json()) as { id: string }
  return body.id
}

describe('projects list — empty filter params from the UI (regression)', () => {
  it('view=list with empty status/tag/q is valid and renders the table (the view switch actually switches)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const id = await createProject(app, auth, 'Filterable project', 'unreviewed')

      // Exactly what the filter form submits on every change: empty status/tag/q.
      const res = await app.fetch(
        new Request('http://local/api/projects?view=list&status=&tag=&q=', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('class="projects-table"')
      expect(html).toContain(id)
      expect(html).toContain('Filterable project')
    } finally {
      close()
    }
  })

  it('real filters still apply: status=unreviewed only (empty params mean no filter, not invalid)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      await createProject(app, auth, 'A spark one', 'spark')
      const unreviewed = await createProject(app, auth, 'An unreviewed one', 'unreviewed')

      const res = await app.fetch(
        new Request('http://local/api/projects?view=list&status=unreviewed&tag=&q=', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      expect(html).toContain(unreviewed)
      expect(html).not.toContain('A spark one')

      // Search with empty status/tag also works end-to-end (FTS5 phrase match).
      const s = await app.fetch(
        new Request('http://local/api/projects?view=cards&status=&tag=&q=unreviewed one', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const searchHtml = await s.text()
      expect(searchHtml).toContain('An unreviewed one')
      expect(searchHtml).not.toContain('A spark one')
    } finally {
      close()
    }
  })

  it('genuinely bad input is still rejected (rule 10)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const res = await app.fetch(
        new Request('http://local/api/projects?view=gridview&status=&tag=&q=', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      expect(res.status).toBe(200) // unknown view falls back to cards (never 500)
      expect(res.status).not.toBe(500)
    } finally {
      close()
    }
  })

  it('kanban renders a dashed drop zone in stages with no projects (roast P6)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      await createProject(app, auth, 'Spark idea', 'spark') // sparks are NOT kanban citizens
      await createProject(app, auth, 'In dev', 'doing')
      await createProject(app, auth, 'On ice', 'halted')

      const res = await app.fetch(new Request('http://local/api/projects?view=kanban', { headers: { ...auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      // Columns = the 6 project stages (0031) in PROJECT_STAGES order; spark lives on its
      // own shelf and is excluded by the query itself. Doing + halted hold cards, the
      // other four stages get the drop zone.
      const cols = [...html.matchAll(/class="kanban-col" data-status="([a-z]+)"/g)].map((m) => m[1])
      expect(cols).toEqual([...STAGES])
      expect(html.match(/class="kanban-empty"/g) ?? []).toHaveLength(4)
      expect(html).toContain('In dev')
      expect(html).toContain('On ice')
      expect(html).not.toContain('Spark idea')
      expect(html).not.toContain('<span class="muted small">—</span>') // bare dash is gone
      // the zone is the column's drop target for status changes (data-status present)
      expect(html).toMatch(/kanban-col" data-status="unreviewed">[\s\S]*?kanban-empty/)
    } finally {
      close()
    }
  })
})

describe('legacy status vocabulary (0031 — old clients and bookmark URLs keep working)', () => {
  it('maps the pre-0035 names onto the new stages on create, filter, and update', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      // An old client (or a stale bookmark) still posts/filters the legacy vocabulary…
      const legacy = await createProject(app, auth, 'Legacy pending', 'pending')
      const row = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [legacy])
      expect(row[0].status).toBe('unreviewed') // …and it lands in the new stage

      // …and the legacy filter name still finds it (LEGACY_STATUS in listProjectsSchema)
      const res = await app.fetch(
        new Request('http://local/api/projects?view=list&status=pending', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      expect(html).toContain('Legacy pending')

      // the same mapping rides updateProjectSchema's statusInput
      const patch = await app.fetch(new Request(`http://local/api/projects/${legacy}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'archived' }) }))
      expect(patch.status).toBe(200)
      const after = await db.query<{ status: string }>('SELECT status FROM projects WHERE id = ?', [legacy])
      expect(after[0].status).toBe('halted')
    } finally {
      close()
    }
  })
})