import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser, makeTestDbUpto } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S30 batch 3 (user request 2026-09-12, "make the data visible"): the analytics
// endpoints —
//   1. /api/reports/summary gains tasks.priority (per-tier {total, done}), labels
//      (top 12 by task usage with done + fresh-30d), and sprints (last 10 real sprints
//      with DONE counts per tier — count-only velocity, no time tracking).
//   2. /api/dashboard (JSON branch) gains the urgent strip payload: cross-project
//      urgent+high non-done tasks (+ total count).
//   3. Rule 1 on both: a stranger's tasks/sprints/labels never leak.

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

type App = ReturnType<typeof createApp>

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const mkTask = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))

describe('reports /summary — task analytics (S30 batch 3)', () => {
  it('priority mix, label distribution, and sprint velocity by tier', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe one')

      // mixed board: 2 urgent (1 done), 1 high, 1 low — labels on two of them
      const u1 = (await (await mkTask(app, headers, pid, { title: 'u1', status: 'idea', priority: 'urgent', tags: ['Security'] })).json()) as { id: string }
      await mkTask(app, headers, pid, { title: 'u2', status: 'done', priority: 'urgent', tags: ['Security'] })
      await mkTask(app, headers, pid, { title: 'h1', status: 'in_progress', priority: 'high' })
      await mkTask(app, headers, pid, { title: 'l1', status: 'planned', priority: 'low' })

      // a sprint with the done urgent task attached → velocity {urgent: 1, done: 1}
      const sprint = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify({ name: 'S9' }) }))).json()) as { id: string }
      await app.fetch(new Request(`http://local/api/sprints/${sprint.id}/start`, { method: 'POST', headers }))
      await app.fetch(new Request(`http://local/api/devtasks/${u1.id}`, { method: 'PATCH', headers, body: JSON.stringify({}) }))
      // attach the DONE task (u2) to the sprint by direct PATCH (find it via the board)
      const board = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string; title: string }[] }
      const u2 = board.tasks.find((t) => t.title === 'u2')!
      await app.fetch(new Request(`http://local/api/devtasks/${u2.id}`, { method: 'PATCH', headers, body: JSON.stringify({ sprint_id: sprint.id }) }))

      const res = await app.fetch(new Request('http://local/api/reports/summary', { headers }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        tasks: { priority: Record<string, { total: number; done: number }>; total: number; done: number }
        labels: { name: string; n: number; done: number; fresh: number }[]
        sprints: { name: string; done: number; by: Record<string, number> }[]
      }

      expect(body.tasks.priority.urgent).toEqual({ total: 2, done: 1 })
      expect(body.tasks.priority.high).toEqual({ total: 1, done: 0 })
      expect(body.tasks.priority.low).toEqual({ total: 1, done: 0 })
      expect(body.tasks.total).toBe(4)
      expect(body.tasks.done).toBe(1)

      expect(body.labels).toHaveLength(1)
      expect(body.labels[0]).toMatchObject({ name: 'Security', n: 2, done: 1, fresh: 2 })

      expect(body.sprints).toHaveLength(1)
      expect(body.sprints[0]).toMatchObject({ name: 'S9', done: 1 })
      expect(body.sprints[0].by).toMatchObject({ urgent: 1, high: 0, medium: 0, low: 0 })
    } finally {
      close()
    }
  })

  it('rule 1: a stranger sees empty analytics, not the owner’s data', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const strangerId = await makeUser(db)
      const { app, headers } = await makeApp(db, ownerId)
      const pid = await createProject(app, headers, 'isolated')
      await mkTask(app, headers, pid, { title: 'secret urgent', status: 'idea', priority: 'urgent', tags: ['Secret'] })

      const stranger = await makeApp(db, strangerId)
      const res = await stranger.app.fetch(new Request('http://local/api/reports/summary', { headers: stranger.headers }))
      const body = (await res.json()) as { tasks: { total: number }; labels: unknown[]; sprints: unknown[] }
      expect(body.tasks.total).toBe(0)
      expect(body.labels).toEqual([])
      expect(body.sprints).toEqual([])
    } finally {
      close()
    }
  })
})

describe('dashboard urgent strip payload (S30 batch 3)', () => {
  it('JSON branch carries cross-project urgent+high non-done tasks + total', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const a = await createProject(app, headers, 'proj A')
      const b = await createProject(app, headers, 'proj B')
      await mkTask(app, headers, a, { title: 'burning', status: 'in_progress', priority: 'urgent' })
      await mkTask(app, headers, b, { title: 'hot', status: 'idea', priority: 'high' })
      await mkTask(app, headers, b, { title: 'settled', status: 'done', priority: 'urgent' }) // done — excluded
      await mkTask(app, headers, b, { title: 'calm', status: 'idea', priority: 'low' }) // low — excluded

      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: { ...headers, Accept: 'application/json' } }))
      expect(res.status).toBe(200)
      const data = (await res.json()) as { urgent: { title: string; priority: string; project_title: string }[]; urgentTotal: number }
      expect(data.urgentTotal).toBe(2)
      expect(data.urgent.map((u) => u.title).sort()).toEqual(['burning', 'hot'])
      expect(data.urgent[0].priority).toBe('urgent') // urgent outranks high in the ordering
      expect(data.urgent.every((u) => u.project_title)).toBe(true)
    } finally {
      close()
    }
  })

  it('HTML branch: the unified projects container renders the overview row; the fire strip is retired (S124)', async () => {
    const { db, close } = makeTestDb()
    try {
      // quiet account: the overview row ALWAYS renders (it is content, not an alert
      // layer) — donut at zero + "Nothing here" boxes; the retired strip nowhere.
      const quietId = await makeUser(db)
      const quiet = await makeApp(db, quietId)
      const hx = { ...quiet.headers, 'HX-Request': 'true' }
      const quietRes = await quiet.app.fetch(new Request('http://local/api/dashboard', { headers: hx }))
      const quietHtml = await quietRes.text()
      expect(quietHtml).not.toContain('dash-urgent')
      expect(quietHtml).toContain('dash-proj-unified')
      expect(quietHtml).toContain('dash-proj-lower')
      expect(quietHtml).toContain('ov-donut')

      const busyId = await makeUser(db)
      const busy = await makeApp(db, busyId)
      const pid = await createProject(busy.app, busy.headers, 'busy')
      // the bug bubble rides the stage-box kanban cards — a spark-stage project never
      // reaches the dashboard's signal map (PROJECT_STAGES only), so move it in-stage
      await busy.app.fetch(new Request(`http://local/api/projects/${pid}`, { method: 'PATCH', headers: busy.headers, body: JSON.stringify({ status: 'developing' }) }))
      await mkTask(busy.app, busy.headers, pid, { title: 'fire drill', status: 'bug', priority: 'urgent' })
      const busyRes = await busy.app.fetch(new Request('http://local/api/dashboard', { headers: { ...busy.headers, 'HX-Request': 'true' } }))
      const busyHtml = await busyRes.text()
      // the unified container: ONE card wrapping the stage carousel + the overview row
      expect(busyHtml).toContain('dash-proj-unified')
      expect(busyHtml).toContain('data-stat-track')
      expect(busyHtml).toContain('dash-proj-lower')
      expect(busyHtml).toContain('dash-proj-fab')
      // the wireframe order: the pie first, then Plans → Problems → In Progress
      const lower = busyHtml.indexOf('dash-proj-lower')
      expect(busyHtml.indexOf('ov-pie-card', lower)).toBeGreaterThan(-1)
      expect(busyHtml.indexOf('data-ov-box="planned"', lower)).toBeGreaterThan(busyHtml.indexOf('ov-pie-card', lower))
      expect(busyHtml.indexOf('data-ov-box="bug"', lower)).toBeGreaterThan(busyHtml.indexOf('data-ov-box="planned"', lower))
      expect(busyHtml.indexOf('data-ov-box="in_progress"', lower)).toBeGreaterThan(busyHtml.indexOf('data-ov-box="bug"', lower))
      // the recent Problems item deep-links to its project
      expect(busyHtml).toContain('fire drill')
      expect(busyHtml).toContain(`/project.html?id=${pid}`)
      // S126: the bug bubble NAMES its count — the glyph rides the chip
      expect(busyHtml).toContain('bug-bubble')
      expect(busyHtml).toMatch(/class="bug-bubble"[^>]*><svg/)
      // S124: the retired fire strip stays retired — even with urgent-priority tasks burning
      expect(busyHtml).not.toContain('dash-urgent')
      expect(busyHtml).not.toContain('/board.html?project=')
    } finally {
      close()
    }
  })
})

describe('overview status cards — S126 contract (cap 3, last-updated, View all)', () => {
  it('caps the box at 3 items sorted by last-updated — an edited old task outranks newer untouched ones', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'ov proj')
      for (const name of ['p1', 'p2', 'p3', 'p4', 'p5']) {
        await mkTask(app, headers, pid, { title: name, status: 'planned' })
      }
      // EDIT the OLDEST task (p1) — its fresh updated_at must lift it above p4/p5
      // (the owner's note: "recent" means last-updated, NOT last-created)
      const board = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string; title: string }[] }
      const p1 = board.tasks.find((t) => t.title === 'p1')!
      await app.fetch(new Request(`http://local/api/devtasks/${p1.id}`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'p1 edited' }) }))

      const hx = { ...headers, 'HX-Request': 'true' }
      const html = await (await app.fetch(new Request('http://local/api/dashboard', { headers: hx }))).text()
      const from = html.indexOf('data-ov-box="planned"')
      const to = html.indexOf('data-ov-box="bug"', from)
      const seg = html.slice(from, to)
      // cap: exactly 3 rows despite 5 planned tasks
      expect(seg.match(/class="ov-item"/g)?.length).toBe(3)
      // last-updated order: the edited p1 first, then the newest-born untouched p5
      expect(seg.indexOf('p1 edited')).toBeGreaterThan(-1)
      expect(seg.indexOf('p1 edited')).toBeLessThan(seg.indexOf('p5'))
      // the header carries the View all affordance (the cap's reachable path)
      expect(seg).toContain('href="/tasks.html?status=planned"')
      expect(seg).toContain('View all')
      // truncated-title recovery: full text on BOTH the native title and data-full
      expect(seg).toContain('title="p1 edited"')
      expect(seg).toContain('data-full="p1 edited"')
      // the project-name metadata line wears the owning project's stage dot
      expect(seg).toMatch(/ov-proj-dot" data-stage="[a-z_]+"/)
    } finally {
      close()
    }
  })

  it('S57 belt: a D1 that has not applied 0061 yet still renders the boxes (born-order fallback)', async () => {
    const { db, close } = makeTestDbUpto(60)
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'lagging')
      await db.execute(
        "INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at) VALUES (?, ?, 'legacy one', 'planned', 'medium', 0, '2026-01-01T00:00:00.000Z')",
        [crypto.randomUUID(), pid],
      )
      const hx = { ...headers, 'HX-Request': 'true' }
      const res = await app.fetch(new Request('http://local/api/dashboard', { headers: hx }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('data-ov-box="planned"')
      expect(html).toContain('legacy one')
    } finally {
      close()
    }
  })

  it('ov-tasks route: the full status list, the switcher, rule 1, and the status allowlist', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const strangerId = await makeUser(db)
      const { app, headers } = await makeApp(db, ownerId)
      const pid = await createProject(app, headers, 'listing')
      for (const name of ['b1', 'b2', 'b3', 'b4']) {
        await mkTask(app, headers, pid, { title: name, status: 'bug' })
      }
      await mkTask(app, headers, pid, { title: 'not a problem', status: 'planned' })

      const hx = { ...headers, 'HX-Request': 'true' }
      const res = await app.fetch(new Request('http://local/api/ov-tasks?status=bug', { headers: hx }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('data-ovt-status="bug"')
      // ALL FOUR bug tasks (the cards cap at 3 — this page does not)
      for (const name of ['b1', 'b2', 'b3', 'b4']) expect(html).toContain(name)
      expect(html).not.toContain('not a problem')
      // the status switcher + aria-current on the active chip
      expect(html).toContain('href="/tasks.html?status=planned"')
      expect(html).toMatch(/aria-current="page"/)

      // rule 1: a stranger's list is empty, not the owner's
      const stranger = await makeApp(db, strangerId)
      const strangerRes = await stranger.app.fetch(new Request('http://local/api/ov-tasks?status=bug', { headers: { ...stranger.headers, 'HX-Request': 'true' } }))
      const strangerHtml = await strangerRes.text()
      expect(strangerHtml).not.toContain('b1')

      // rule 10: only the four known statuses pass the allowlist
      const bad = await app.fetch(new Request('http://local/api/ov-tasks?status=done', { headers }))
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })
})
