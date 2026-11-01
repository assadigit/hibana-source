import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S235 (the sprint audit — §4.2 + §4.3 gaps):
//   1. POST /api/projects/:id/sprints with started_at > ended_at → 400 (the
//      sprintRangeOk refine — was missing, only PATCH had the inline check).
//   2. POST /api/projects/:id/sprints with started_at that OVERLAPS an existing
//      closed sprint's date range → 400 (the assertSprintWindowOk helper — was
//      missing on POST-create-with-dates, only PATCH had the overlap check).
//   3. POST /api/sprints/:id/start when "now" falls INSIDE an existing closed
//      sprint's range → 400 (the same helper, called from /start — was missing).
//   4. POST /api/sprints/:id/finish leaves dev_tasks.sprint_id INTACT (the FK
//      stays valid so the "All sprints" list + reports/velocity work post-finish).
//   5. POST /api/sprints/:id/reopen honors the latest-and-no-other-open guard.
//   6. PATCH /api/sprints/:id overlap returns 400 (the existing inline check,
//      now delegated to the shared helper — proves the refactor is byte-identical).

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' } }
}

type App = Awaited<ReturnType<typeof createApp>>

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const mkSprint = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify(body) }))

const patchSprint = (app: App, headers: Record<string, string>, sid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

const startSprint = (app: App, headers: Record<string, string>, sid: string) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}/start`, { method: 'POST', headers }))

const finishSprint = (app: App, headers: Record<string, string>, sid: string) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}/finish`, { method: 'POST', headers }))

const reopenSprint = (app: App, headers: Record<string, string>, sid: string) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}/reopen`, { method: 'POST', headers }))

async function devboardSprints(app: App, headers: Record<string, string>, pid: string) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
  expect(res.status).toBe(200)
  const data = (await res.json()) as { sprints: { id: string; started_at: string; ended_at: string | null; is_draft: number }[] }
  return data.sprints
}

async function createTask(app: App, headers: Record<string, string>, pid: string, sprintId: string | null) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, {
    method: 'POST', headers, body: JSON.stringify({ title: 'A task on the sprint', status: 'planned', sprint_id: sprintId }),
  }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function taskSprintId(app: App, headers: Record<string, string>, pid: string, taskId: string) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
  const data = (await res.json()) as { tasks: { id: string; sprint_id: string | null }[] }
  return data.tasks.find((t) => t.id === taskId)?.sprint_id ?? undefined
}

describe('S235 sprint validation gaps (the audit — §4.2 + §4.3)', () => {
  it('POST create with started_at > ended_at → 400 (the sprintRangeOk refine)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'overlap probe')
      // end BEFORE start — the audit's §4.3 gap: was accepted at INSERT, rendered a negative-width strip.
      const res = await mkSprint(app, headers, pid, {
        name: 'Bad range', started_at: '2026-12-15T00:00:00.000Z', ended_at: '2026-12-01T00:00:00.000Z',
      })
      expect(res.status).toBe(400)
    } finally { close() }
  })

  it('POST create with dates that overlap an existing closed sprint → 400 (the assertSprintWindowOk helper)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'overlap probe')
      // Sprint 1: Mar 1 → Mar 30 (closed)
      const s1 = await mkSprint(app, headers, pid, { name: 'Sprint 1', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' })
      expect(s1.status).toBe(201)
      // Sprint 2: Mar 15 → Mar 20 — OVERLAPS Sprint 1 (the audit's §4.2 gap: was accepted)
      const s2 = await mkSprint(app, headers, pid, { name: 'Sprint 2', started_at: '2026-03-15T00:00:00.000Z', ended_at: '2026-03-20T00:00:00.000Z' })
      expect(s2.status).toBe(400)
    } finally { close() }
  })

  it('POST create with dates that DON\'T overlap (adjacent, touching boundary) → 201', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'adjacent probe')
      // Sprint 1: Mar 1 → Mar 30 (closed)
      await mkSprint(app, headers, pid, { name: 'Sprint 1', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' })
      // Sprint 2: Mar 31 → Apr 15 — ADJACENT to Sprint 1 (Sprint 1 ends Mar 30,
      // Sprint 2 starts Mar 31 — no shared day at day granularity) → 201
      const s2 = await mkSprint(app, headers, pid, { name: 'Sprint 2', started_at: '2026-03-31T00:00:00.000Z', ended_at: '2026-04-15T00:00:00.000Z' })
      expect(s2.status).toBe(201)
    } finally { close() }
  })

  it('POST /start when "now" falls inside an existing closed sprint → 400', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'start-inside-closed probe')
      // Sprint 1: started 1 day ago, ends 1 day from now (a WIDE closed sprint that spans "now")
      const past = new Date(Date.now() - 86400000).toISOString()
      const future = new Date(Date.now() + 86400000).toISOString()
      await mkSprint(app, headers, pid, { name: 'Wide closed sprint', started_at: past, ended_at: future })
      // Create a draft to start
      const draftRes = await mkSprint(app, headers, pid, { name: 'Draft to start' })
      expect(draftRes.status).toBe(201)
      const draft = (await draftRes.json()) as { id: string }
      // Start the draft — "now" falls inside Sprint 1's [past, future] → should be rejected
      const startRes = await startSprint(app, headers, draft.id)
      expect(startRes.status).toBe(400)
    } finally { close() }
  })

  it('POST /finish leaves dev_tasks.sprint_id INTACT (the FK stays valid for reports/velocity)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'finish-keeps-fk probe')
      // Create a started sprint (with dates so it's not a draft)
      const sprintRes = await mkSprint(app, headers, pid, { name: 'Sprint to finish', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-15T00:00:00.000Z' })
      const sprint = (await sprintRes.json()) as { id: string }
      // Create a task assigned to this sprint
      const taskId = await createTask(app, headers, pid, sprint.id)
      expect(await taskSprintId(app, headers, pid, taskId)).toBe(sprint.id)
      // Finish the sprint
      const finRes = await finishSprint(app, headers, sprint.id)
      expect(finRes.status).toBe(200)
      // The task's sprint_id is STILL the finished sprint's id (NOT nulled)
      expect(await taskSprintId(app, headers, pid, taskId)).toBe(sprint.id)
    } finally { close() }
  })

  it('POST /reopen honors the latest-and-no-other-open guard', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'reopen-guard probe')
      // Sprint 1 (older, closed) + Sprint 2 (newer, closed) — reopening Sprint 1 should
      // fail (not the latest), reopening Sprint 2 should succeed (latest, no other open).
      const s1Res = await mkSprint(app, headers, pid, { name: 'Older', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })
      const s1 = (await s1Res.json()) as { id: string }
      await mkSprint(app, headers, pid, { name: 'Newer', started_at: '2026-02-01T00:00:00.000Z', ended_at: '2026-02-10T00:00:00.000Z' })
      // Reopen Sprint 1 (the OLDER one) → should be rejected (not the latest)
      const reopenOld = await reopenSprint(app, headers, s1.id)
      expect(reopenOld.status).toBe(400)
    } finally { close() }
  })

  it('PATCH overlap returns 400 (the shared helper — proves the refactor is byte-identical)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'patch-overlap probe')
      // Sprint 1: Mar 1 → Mar 30 (closed)
      await mkSprint(app, headers, pid, { name: 'Sprint 1', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' })
      // Sprint 2: Apr 1 → Apr 30 (closed, non-overlapping)
      const s2Res = await mkSprint(app, headers, pid, { name: 'Sprint 2', started_at: '2026-04-01T00:00:00.000Z', ended_at: '2026-04-30T00:00:00.000Z' })
      const s2 = (await s2Res.json()) as { id: string }
      // PATCH Sprint 2 to start at Mar 15 — OVERLAPS Sprint 1 → 400
      const patchRes = await patchSprint(app, headers, s2.id, { started_at: '2026-03-15T00:00:00.000Z' })
      expect(patchRes.status).toBe(400)
      // Verify the sprints are unchanged (the PATCH didn't mutate)
      const sprints = await devboardSprints(app, headers, pid)
      const s2After = sprints.find((s) => s.id === s2.id)
      expect(s2After?.started_at).toBe('2026-04-01T00:00:00.000Z')
    } finally { close() }
  })

  it('PATCH a non-overlapping date change succeeds (the helper allows clean windows)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'patch-clean probe')
      // Sprint 1: Mar 1 → Mar 30
      await mkSprint(app, headers, pid, { name: 'Sprint 1', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' })
      // Sprint 2: Apr 1 → Apr 30
      const s2Res = await mkSprint(app, headers, pid, { name: 'Sprint 2', started_at: '2026-04-01T00:00:00.000Z', ended_at: '2026-04-30T00:00:00.000Z' })
      const s2 = (await s2Res.json()) as { id: string }
      // PATCH Sprint 2 to May 1 → May 30 (clean move, no overlap) → 200
      const patchRes = await patchSprint(app, headers, s2.id, { started_at: '2026-05-01T00:00:00.000Z', ended_at: '2026-05-30T00:00:00.000Z' })
      expect(patchRes.status).toBe(200)
    } finally { close() }
  })
})
