import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { effectiveDeadlineOf } from '../routes/devboard-helpers'
import type { Db } from '../db/types'

type App = Awaited<ReturnType<typeof createApp>>

// S241 (the Sprint/Deadline/Dependency feature pack, Phase 2 — the API read surface):
//   §15   the board payload's 7th key `task_deps` — the flat per-project edge join,
//         rule-1 scoped (a stranger's edges never leak), cascade-clean;
//   §10   effective-deadline resolution as SERVER-computed additive fields on the task
//         rows (the documented Phase 2 default — spec §18: one resolution, so web and
//         desktop never fork deadline logic): personal > sprint-inherited-while-not-
//         completed > none, the four §10 scenarios + §10.3 completed-sprint neutrality
//         + §5.5 paused inheritance + the §12.2 origin rules;
//   S209  the legacy payload shape pin — every pre-S240/pre-0065 key the desktop
//         island @ 04218ca reads stays exactly where it was (docs/project-kanban/
//         API-AND-SYNC-CONTRACT.md v0.4.1.35/S209, the six-key payload); additive
//         keys ride along (the island's Go json.Unmarshal ignores unknown keys), any
//         future REMOVAL/RENAME fails here before it can ship.

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

const mkSprint = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify(body) }))

const patchSprint = (app: App, headers: Record<string, string>, sid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

const sprintAction = (app: App, headers: Record<string, string>, sid: string, action: string) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}/${action}`, { method: 'POST', headers }))

const startSprint = (app: App, headers: Record<string, string>, sid: string) => sprintAction(app, headers, sid, 'start')
const pauseSprint = (app: App, headers: Record<string, string>, sid: string) => sprintAction(app, headers, sid, 'pause')
const finishSprint = (app: App, headers: Record<string, string>, sid: string) => sprintAction(app, headers, sid, 'finish')

const mkTask = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))

async function createTask(app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) {
  const res = await mkTask(app, headers, pid, body)
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const deleteTask = (app: App, headers: Record<string, string>, tid: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'DELETE', headers }))

const addDep = (app: App, headers: Record<string, string>, blockedId: string, blockerId: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${blockedId}/deps`, { method: 'POST', headers, body: JSON.stringify({ blocker_id: blockerId }) }))

const delDep = (app: App, headers: Record<string, string>, blockedId: string, blockerId: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${blockedId}/deps/${blockerId}`, { method: 'DELETE', headers }))

type TaskDepEdge = { blocker_task_id: string; blocked_task_id: string }
type BoardPayload = {
  project: Record<string, unknown>
  tasks: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  sprints: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  task_tags: Record<string, unknown>[]
  task_deps: TaskDepEdge[]
}

async function getBoard(app: App, headers: Record<string, string>, pid: string): Promise<{ res: Response; body: BoardPayload }> {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
  expect(res.status).toBe(200)
  return { res, body: (await res.json()) as BoardPayload }
}

describe('S241 §15 — task_deps: the board payload dependency read surface', () => {
  it('rides the payload as the 7th additive key; edges are flat {blocker_task_id, blocked_task_id} rows the client folds by task', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'deps payload probe')
      const a1 = await createTask(app, headers, pid, { title: 'Fix authentication architecture', sprint_id: null })
      const a2 = await createTask(app, headers, pid, { title: 'Implement session security', sprint_id: null })
      const a3 = await createTask(app, headers, pid, { title: 'Add security audit logging', sprint_id: null })
      expect((await addDep(app, headers, a2, a1)).status).toBe(201) // a1 blocks a2
      expect((await addDep(app, headers, a3, a1)).status).toBe(201) // a1 blocks a3
      const { body } = await getBoard(app, headers, pid)
      // the seven-key payload: the S209 six + task_deps (additive #7)
      expect(Object.keys(body).sort()).toEqual(['categories', 'project', 'sprints', 'tags', 'task_deps', 'task_tags', 'tasks'])
      // every edge carries EXACTLY the two id keys (the task_tags flat-join shape)
      expect(body.task_deps).toHaveLength(2)
      for (const e of body.task_deps) expect(Object.keys(e).sort()).toEqual(['blocked_task_id', 'blocker_task_id'])
      // the client-side fold the spec derives (§14/§15): Blocked-by + reverse Blocks-N
      const blockedBy = (t: string) => body.task_deps.filter((e) => e.blocked_task_id === t).map((e) => e.blocker_task_id)
      const blocksCount = (t: string) => body.task_deps.filter((e) => e.blocker_task_id === t).length
      expect(blockedBy(a2)).toEqual([a1])
      expect(blocksCount(a1)).toBe(2)
      expect(blocksCount(a2)).toBe(0)
      // removal round-trips (DELETE is the tag-link shape: 200 always)
      expect((await delDep(app, headers, a3, a1)).status).toBe(200)
      expect((await getBoard(app, headers, pid)).body.task_deps).toHaveLength(1)
    } finally { close() }
  })

  it('rule 1 scoping — a stranger\'s (or another project\'s) edges never leak into this payload', async () => {
    const { db, close } = makeTestDb()
    try {
      const userA = await makeUser(db, { username: 'alice' })
      const userB = await makeUser(db, { username: 'bob' })
      const a = await makeApp(db, userA)
      const b = await makeApp(db, userB)
      const pa = await createProject(a.app, a.headers, 'alice board')
      const pa2 = await createProject(a.app, a.headers, 'alice other board')
      const pb = await createProject(b.app, b.headers, 'bob board')
      const a1 = await createTask(a.app, a.headers, pa, { title: 'a1', sprint_id: null })
      const a2 = await createTask(a.app, a.headers, pa, { title: 'a2', sprint_id: null })
      const c1 = await createTask(a.app, a.headers, pa2, { title: 'c1', sprint_id: null })
      const c2 = await createTask(a.app, a.headers, pa2, { title: 'c2', sprint_id: null })
      const b1 = await createTask(b.app, b.headers, pb, { title: 'b1', sprint_id: null })
      const b2 = await createTask(b.app, b.headers, pb, { title: 'b2', sprint_id: null })
      expect((await addDep(a.app, a.headers, a2, a1)).status).toBe(201)
      expect((await addDep(a.app, a.headers, c2, c1)).status).toBe(201)
      expect((await addDep(b.app, b.headers, b2, b1)).status).toBe(201)
      // alice's first board carries ONLY its own edge — not her other project's, not bob's
      const paBoard = (await getBoard(a.app, a.headers, pa)).body
      expect(paBoard.task_deps).toEqual([{ blocker_task_id: a1, blocked_task_id: a2 }])
      const pa2Board = (await getBoard(a.app, a.headers, pa2)).body
      expect(pa2Board.task_deps).toEqual([{ blocker_task_id: c1, blocked_task_id: c2 }])
      const pbBoard = (await getBoard(b.app, b.headers, pb)).body
      expect(pbBoard.task_deps).toEqual([{ blocker_task_id: b1, blocked_task_id: b2 }])
      // a foreign project id is simply not found (rule 1 — scoped through the owner)
      const foreign = await a.app.fetch(new Request(`http://local/api/projects/${pb}/devboard`, { headers: a.headers }))
      expect(foreign.status).toBe(404)
    } finally { close() }
  })

  it('deleting a task cascades its edges out of the payload (the 0065 ON DELETE CASCADE contract)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'cascade probe')
      const a1 = await createTask(app, headers, pid, { title: 'blocker', sprint_id: null })
      const a2 = await createTask(app, headers, pid, { title: 'blocked', sprint_id: null })
      expect((await addDep(app, headers, a2, a1)).status).toBe(201)
      expect((await getBoard(app, headers, pid)).body.task_deps).toHaveLength(1)
      expect((await deleteTask(app, headers, a1)).status).toBe(200)
      // no dangling half-edge: the join is clean without a manual sweep
      expect((await getBoard(app, headers, pid)).body.task_deps).toEqual([])
    } finally { close() }
  })
})

describe('S241 — the legacy payload shape pin (the desktop island @ 04218ca contract)', () => {
  it('every pre-S240 key stays in place per section; additive keys ride along (a removal/rename fails here)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'island pin probe')
      // a fully-populated board: category (enabled), tagged task, sprint with the
      // 0052 doc fields, and the S240/S241 additive fields stamped via their endpoints
      const cat = await app.fetch(new Request(`http://local/api/projects/${pid}/categories`, { method: 'POST', headers, body: JSON.stringify({ name: 'UI/UX', color_fill: '#CCE2F0', color_text: '#274F68' }) }))
      expect(cat.status).toBe(201)
      const catId = ((await cat.json()) as { id: string }).id
      const s = await mkSprint(app, headers, pid, { name: 'Security', version: '12.1', description: 'the hardening pass' })
      expect(s.status).toBe(201)
      const sid = ((await s.json()) as { id: string }).id
      expect((await patchSprint(app, headers, sid, { emoji: '🔐', due_at: '2026-12-01T23:59:00.000Z' })).status).toBe(200)
      const t = await createTask(app, headers, pid, { title: 'Ship the board', sprint_id: sid, category_id: catId, tags: ['UI/UX'], due_at: '2026-11-20T23:59:00.000Z' })
      const { res, body } = await getBoard(app, headers, pid)
      // ETag-wrapped (§8 of the contract — the desktop sends If-None-Match)
      expect(res.headers.get('etag')).toBeTruthy()
      // ---- the task row: the post-0062 legacy set + tags array + shot_count, plus the
      // S240 raw due pair and the S241 effective triple (additive)
      const task = body.tasks.find((x) => x.id === t)!
      expect(task).toBeTruthy()
      for (const k of ['id', 'project_id', 'title', 'status', 'priority', 'category_id', 'sprint_id', 'sort_order', 'created_at', 'done_at', 'start_at', 'end_at', 'search_tags', 'updated_at', 'tags', 'shot_count']) {
        expect(k in task, `task row lost legacy key ${k}`).toBe(true)
      }
      expect(Array.isArray(task.tags)).toBe(true)
      expect(task.shot_count).toBe(0)
      for (const k of ['due_at', 'due_origin_at', 'effective_due_at', 'effective_due_source', 'effective_due_origin_at']) {
        expect(k in task, `task row lost additive key ${k}`).toBe(true)
      }
      // ---- the sprint row: the post-0052 legacy set + the 0065 additive columns
      const sprint = body.sprints.find((x) => x.id === sid)!
      for (const k of ['id', 'project_id', 'name', 'started_at', 'ended_at', 'created_at', 'is_draft', 'version', 'description']) {
        expect(k in sprint, `sprint row lost legacy key ${k}`).toBe(true)
      }
      for (const k of ['status', 'emoji', 'due_at', 'due_origin_at', 'updated_at']) {
        expect(k in sprint, `sprint row lost additive key ${k}`).toBe(true)
      }
      // ---- categories carry the S152 enabled split; tags + task_tags keep their shapes
      const category = body.categories.find((x) => x.id === catId)!
      for (const k of ['id', 'user_id', 'name', 'color_fill', 'color_text', 'is_archived', 'created_at', 'enabled']) {
        expect(k in category, `category row lost key ${k}`).toBe(true)
      }
      expect(body.tags.length).toBeGreaterThan(0)
      for (const k of ['id', 'user_id', 'name', 'color', 'usage_count', 'created_at']) expect(k in body.tags[0]!).toBe(true)
      expect(body.task_tags).toHaveLength(1)
      for (const k of ['task_id', 'id', 'name', 'color']) expect(k in body.task_tags[0]!).toBe(true)
      // ---- project keeps its four-key shape
      for (const k of ['id', 'title', 'status', 'type']) expect(k in body.project).toBe(true)
    } finally { close() }
  })
})

describe('S241 §10 — effective deadline on the board payload (server-computed additive fields)', () => {
  it('the four §10 scenarios, then §10.3 completed-sprint neutrality (history kept, countdown dropped)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'effective deadline probe')
      const s = await mkSprint(app, headers, pid, { name: 'Security' })
      const sid = ((await s.json()) as { id: string }).id
      expect((await startSprint(app, headers, sid)).status).toBe(200)
      const sprintDue = '2026-12-01T23:59:00.000Z'
      expect((await patchSprint(app, headers, sid, { due_at: sprintDue })).status).toBe(200)
      // T1: no sprint + no personal deadline → nothing (§10 row 1)
      const t1 = await createTask(app, headers, pid, { title: 'plain', sprint_id: null })
      // T2: personal deadline + no sprint → the personal date + its own origin (§10 row 2)
      const personalDue = '2026-11-20T23:59:00.000Z'
      const t2 = await createTask(app, headers, pid, { title: 'own deadline', sprint_id: null, due_at: personalDue })
      // T3: sprint deadline + no personal → inherits, with the SPRINT's origin (§10 row 3, §12.2)
      const t3 = await createTask(app, headers, pid, { title: 'inheriting', sprint_id: sid })
      // T4: sprint deadline + personal deadline → the override wins (§10 row 4)
      const t4 = await createTask(app, headers, pid, { title: 'override', sprint_id: sid, due_at: personalDue })
      let board = (await getBoard(app, headers, pid)).body
      const row = (id: string) => board.tasks.find((x) => x.id === id)!
      const sprintRow = board.sprints.find((x) => x.id === sid)!
      expect(row(t1)).toMatchObject({ effective_due_at: null, effective_due_source: null, effective_due_origin_at: null })
      expect(row(t2)).toMatchObject({ effective_due_at: personalDue, effective_due_source: 'task' })
      expect(Date.parse(row(t2).effective_due_origin_at as string)).not.toBeNaN() // origin stamped at create
      expect(row(t3)).toMatchObject({ effective_due_at: sprintDue, effective_due_source: 'sprint', effective_due_origin_at: sprintRow.due_origin_at })
      expect(row(t4)).toMatchObject({ effective_due_at: personalDue, effective_due_source: 'task' })
      expect(Date.parse(row(t4).effective_due_origin_at as string)).not.toBeNaN() // own origin, not the sprint's
      // ---- finish the sprint: T3's inherited countdown goes neutral (§10.3 — the raw
      // sprint date stays in the sprints section as history), T4's personal override
      // is independent of the completed sprint's deadline
      expect((await finishSprint(app, headers, sid)).status).toBe(200)
      board = (await getBoard(app, headers, pid)).body
      expect(row(t3)).toMatchObject({ effective_due_at: null, effective_due_source: null, effective_due_origin_at: null })
      expect(row(t4)).toMatchObject({ effective_due_at: personalDue, effective_due_source: 'task' })
      expect(board.sprints.find((x) => x.id === sid)!.due_at).toBe(sprintDue) // history preserved
    } finally { close() }
  })

  it('a PAUSED sprint\'s deadline keeps inheriting (§5.5 — pausing preserves deadline info)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'paused inheritance probe')
      const s = await mkSprint(app, headers, pid, { name: 'Ops' })
      const sid = ((await s.json()) as { id: string }).id
      expect((await startSprint(app, headers, sid)).status).toBe(200)
      const due = '2026-12-15T23:59:00.000Z'
      expect((await patchSprint(app, headers, sid, { due_at: due })).status).toBe(200)
      const t = await createTask(app, headers, pid, { title: 'paused sprint task', sprint_id: sid })
      expect((await pauseSprint(app, headers, sid)).status).toBe(200)
      const board = (await getBoard(app, headers, pid)).body
      expect(board.tasks.find((x) => x.id === t)).toMatchObject({ effective_due_at: due, effective_due_source: 'sprint' })
    } finally { close() }
  })

  it('unit: effectiveDeadlineOf — origin coalescing, precedence, and lagging pre-0065 rows', () => {
    // §10 precedence 1 with a missing origin stamp → coalesce to the due_at itself
    expect(effectiveDeadlineOf({ due_at: '2026-11-20T23:59:00.000Z', due_origin_at: null }, null)).toEqual({
      effective_due_at: '2026-11-20T23:59:00.000Z', effective_due_source: 'task', effective_due_origin_at: '2026-11-20T23:59:00.000Z',
    })
    // precedence 2 — an explicit legacy-shaped sprint row (status NULL → derived active)
    expect(effectiveDeadlineOf({ due_at: null, due_origin_at: null }, { due_at: '2026-12-01T00:00:00.000Z', due_origin_at: '2026-11-01T00:00:00.000Z', status: null, is_draft: 0, ended_at: null })).toEqual({
      effective_due_at: '2026-12-01T00:00:00.000Z', effective_due_source: 'sprint', effective_due_origin_at: '2026-11-01T00:00:00.000Z',
    })
    // §10.3 — a completed sprint never lends its deadline
    expect(effectiveDeadlineOf({ due_at: null, due_origin_at: null }, { due_at: '2026-12-01T00:00:00.000Z', due_origin_at: null, status: 'completed', is_draft: 0, ended_at: '2026-11-30T00:00:00.000Z' })).toEqual({
      effective_due_at: null, effective_due_source: null, effective_due_origin_at: null,
    })
    // a sprint without a due date lends nothing
    expect(effectiveDeadlineOf({ due_at: null, due_origin_at: null }, { due_at: null, due_origin_at: null, status: 'active', is_draft: 0, ended_at: null })).toEqual({
      effective_due_at: null, effective_due_source: null, effective_due_origin_at: null,
    })
    // no sprint at all
    expect(effectiveDeadlineOf({ due_at: null, due_origin_at: null }, undefined)).toEqual({
      effective_due_at: null, effective_due_source: null, effective_due_origin_at: null,
    })
    // lagging pre-0065 rows: no due columns at all (undefined keys) → the null triple,
    // never a throw — the deploy-ahead-of-D1 race must not 500 the board
    expect(effectiveDeadlineOf({} as { due_at: null; due_origin_at: null }, {} as { due_at: null; due_origin_at: null; status: null; is_draft: 0; ended_at: null })).toEqual({
      effective_due_at: null, effective_due_source: null, effective_due_origin_at: null,
    })
  })
})
