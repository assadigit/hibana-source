import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
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
      // S124: the retired fire strip stays retired — even with urgent-priority tasks burning
      expect(busyHtml).not.toContain('dash-urgent')
      expect(busyHtml).not.toContain('/board.html?project=')
    } finally {
      close()
    }
  })
})
