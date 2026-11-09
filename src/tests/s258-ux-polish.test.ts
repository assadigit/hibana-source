import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S258 (Phase 7 — the UI/UX polish round, AUDIT-REMEDIATION-SPEC.md §10): the
// backend regression pins for FE-11's scoped half — the bulk
// POST /api/projects/:id/devtasks/clear-done:
//   (a) one request hard-deletes every DONE task and NOTHING else (planned/
//       in-progress/idea rows survive; deps + tag links cascade away);
//   (b) the empty case answers {ok, deleted: 0} without touching anything;
//   (c) tag usage counts are recounted honestly after the bulk cascade (the
//       single-DELETE contract, in bulk);
//   (d) owner scoping — a stranger's project id is a 404, never a delete;
//   (e) additive-only: the response carries the NEW `deleted` key; the
//       archive-done twin keeps its own `archived` key byte-identically.
type App = Awaited<ReturnType<typeof createApp>>

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' } }
}

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function createTask(app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const clearDone = (app: App, headers: Record<string, string>, pid: string) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks/clear-done`, { method: 'POST', headers }))

const archiveDone = (app: App, headers: Record<string, string>, pid: string) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks/archive-done`, { method: 'POST', headers }))

const addTaskTag = (app: App, headers: Record<string, string>, tid: string, name: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}/tags`, { method: 'POST', headers, body: JSON.stringify({ name }) }))

const boardTaskIds = async (app: App, headers: Record<string, string>, pid: string) => {
  const body = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string }[] }
  return body.tasks.map((t) => t.id)
}

describe('S258 (a) FE-11 — the bulk clear-done endpoint', () => {
  it('one request deletes every DONE task and nothing else; deps + tag links cascade; the response counts the deletion', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'clear-done probe')

      const d1 = await createTask(app, headers, pid, { title: 'done one', status: 'done' })
      const d2 = await createTask(app, headers, pid, { title: 'done two', status: 'done' })
      const survivor = await createTask(app, headers, pid, { title: 'still planned', status: 'planned' })
      const idea = await createTask(app, headers, pid, { title: 'an idea', status: 'idea' })
      // a dep edge BETWEEN a done task and a survivor — the done end's rows cascade
      await app.fetch(new Request(`http://local/api/devtasks/${survivor}/deps`, { method: 'POST', headers, body: JSON.stringify({ blocker_id: d1 }) }))

      const res = await clearDone(app, headers, pid)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { ok: boolean; deleted: number })).toEqual({ ok: true, deleted: 2 })

      const ids = await boardTaskIds(app, headers, pid)
      expect(ids).toHaveLength(2)
      expect(ids).not.toContain(d2) // both done rows are gone
      expect(ids.sort()).toEqual([survivor, idea].sort())

      // the dep edge lost its done blocker end — no dangling half-edge (0065's CASCADE)
      const deps = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dev_task_deps')
      expect(deps[0].n).toBe(0)
      // the project stamp moved (touchProject) + a history row landed
      const hist = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM project_history_log WHERE project_id = ?', [pid])
      expect(hist[0].n).toBeGreaterThanOrEqual(1)
    } finally { close() }
  })

  it('the empty case: {ok, deleted: 0} and the planned rows are untouched', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'clear-done empty probe')
      await createTask(app, headers, pid, { title: 'planned only', status: 'planned' })

      const res = await clearDone(app, headers, pid)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { deleted: number }).deleted).toBe(0)
      expect((await boardTaskIds(app, headers, pid))).toHaveLength(1)
    } finally { close() }
  })

  it('tag usage counts are recounted after the bulk cascade (the single-DELETE contract, in bulk)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'clear-done tags probe')

      const d1 = await createTask(app, headers, pid, { title: 'done labeled', status: 'done' })
      const keeper = await createTask(app, headers, pid, { title: 'planned labeled', status: 'planned' })
      expect((await addTaskTag(app, headers, d1, 'SharedTag')).status).toBe(201)
      expect((await addTaskTag(app, headers, keeper, 'SharedTag')).status).toBe(201)
      expect((await addTaskTag(app, headers, d1, 'OnlyDoneTag')).status).toBe(201)

      const before = await db.query<{ name: string; usage_count: number }>('SELECT name, usage_count FROM tags WHERE user_id = ? ORDER BY name', [userId])
      expect(before.find((r) => r.name === 'SharedTag')!.usage_count).toBe(2)
      expect(before.find((r) => r.name === 'OnlyDoneTag')!.usage_count).toBe(1)

      expect((await clearDone(app, headers, pid)).status).toBe(200)

      const after = await db.query<{ name: string; usage_count: number }>('SELECT name, usage_count FROM tags WHERE user_id = ? ORDER BY name', [userId])
      expect(after.find((r) => r.name === 'SharedTag')!.usage_count).toBe(1) // the planned task's link survives
      expect(after.find((r) => r.name === 'OnlyDoneTag')!.usage_count).toBe(0) // recounted down from 1
      // the label rows survive (only their links cascaded) — the manager never ghosts
      expect(after).toHaveLength(2)
    } finally { close() }
  })

  it('owner scoping: a stranger\'s project id is a 404 and deletes nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'clear-done scoped probe')
      await createTask(app, headers, pid, { title: 'done scoped', status: 'done' })

      // a SECOND user asking for the first user's project
      const strangerId = await makeUser(db, { username: 'stranger' })
      const stranger = await makeApp(db, strangerId)
      const res = await clearDone(stranger.app, stranger.headers, pid)
      expect(res.status).toBe(404)

      expect((await boardTaskIds(app, headers, pid))).toHaveLength(1) // nothing deleted
    } finally { close() }
  })

  it('additive-only: archive-done keeps its own {ok, archived} shape; clear-done never feeds it', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'clear-done twin probe')
      await createTask(app, headers, pid, { title: 'done for archive', status: 'done' })

      const arch = await archiveDone(app, headers, pid)
      expect(arch.status).toBe(200)
      const archBody = (await arch.json()) as Record<string, unknown>
      expect(archBody.archived).toBe(1)
      expect(archBody.deleted).toBeUndefined() // the twins stay distinct

      const clr = await clearDone(app, headers, pid)
      expect(clr.status).toBe(200)
      const clrBody = (await clr.json()) as Record<string, unknown>
      expect(clrBody.deleted).toBe(0) // the archive already moved them
      expect(clrBody.archived).toBeUndefined()
    } finally { close() }
  })
})
