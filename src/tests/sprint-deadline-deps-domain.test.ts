import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDb } from '../db/sqlite'
import { applyMigrations } from '../db/migrate-node'
import type { Db } from '../db/types'

type App = Awaited<ReturnType<typeof createApp>>

// S240 (0065 — the Sprint/Deadline/Dependency feature pack, Phase 1): the domain
// invariants the service layer now enforces, one test cluster per spec-pack rule:
//   §4.3  sprint names are unique CASE-INSENSITIVELY within a project, ALL states;
//   §5.1  at most ONE active sprint per project (409 sprint_active_exists + id;
//         the partial unique index is the race belt);
//   §5.5  pause/resume (active⇄paused, subject to one-active);
//   §5.3  finish archives ONLY this sprint's done tasks (snapshot + sprint_id kept),
//         unfinished tasks keep status AND sprint association;
//   §6    delete: planned/paused only; tasks detach (never delete), archived rows
//         get the "<name> (deleted)" snapshot, active/completed refuse;
//   §8    no NEW assignment to completed sprints (re-asserting one's own is legal —
//         the old Edit modal resends fields verbatim);
//   §12.2 deadline origin stamping: set → stamp, edit → preserve, clear → both,
//         re-add → fresh timeline (task + sprint); every sprint PATCH stamps updated_at;
//   §14   deps: no self, no cross-project, no cycles (direct + transitive),
//         multi-blocker, idempotent re-add, task-delete cascades;
//   0065  the migration's backfill + one-active normalization, exercised on a REAL
//         pre-0065 schema upgraded through the REAL runner (the D1 upgrade path).

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
const resumeSprint = (app: App, headers: Record<string, string>, sid: string) => sprintAction(app, headers, sid, 'resume')
const finishSprint = (app: App, headers: Record<string, string>, sid: string) => sprintAction(app, headers, sid, 'finish')
const reopenSprint = (app: App, headers: Record<string, string>, sid: string) => sprintAction(app, headers, sid, 'reopen')
const deleteSprint = (app: App, headers: Record<string, string>, sid: string) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'DELETE', headers }))

const mkTask = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))

async function createTask(app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) {
  const res = await mkTask(app, headers, pid, body)
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const patchTask = (app: App, headers: Record<string, string>, tid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

const addDep = (app: App, headers: Record<string, string>, blockedId: string, blockerId: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${blockedId}/deps`, { method: 'POST', headers, body: JSON.stringify({ blocker_id: blockerId }) }))

const delDep = (app: App, headers: Record<string, string>, blockedId: string, blockerId: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${blockedId}/deps/${blockerId}`, { method: 'DELETE', headers }))

type SprintDbRow = { status: string | null; ended_at: string | null; is_draft: 0 | 1; emoji: string | null; due_at: string | null; due_origin_at: string | null; updated_at: string | null; started_at: string }
async function sprintRow(db: Db, sid: string): Promise<SprintDbRow> {
  const r = await db.query<SprintDbRow>('SELECT status, ended_at, is_draft, emoji, due_at, due_origin_at, updated_at, started_at FROM sprints WHERE id = ?', [sid])
  if (!r[0]) throw new Error(`sprint ${sid} missing`)
  return r[0]
}

type TaskDbRow = { sprint_id: string | null; status: string; due_at: string | null; due_origin_at: string | null; priority: string }
async function taskRow(db: Db, tid: string): Promise<TaskDbRow> {
  const r = await db.query<TaskDbRow>('SELECT sprint_id, status, due_at, due_origin_at, priority FROM dev_tasks WHERE id = ?', [tid])
  if (!r[0]) throw new Error(`task ${tid} missing`)
  return r[0]
}

type ArchiveDbRow = { id: string; sprint_id: string | null; sprint_name_snapshot: string | null; status: string; tags: string }
const archiveRows = (db: Db, pid: string) => db.query<ArchiveDbRow>('SELECT id, sprint_id, sprint_name_snapshot, status, tags FROM project_archives WHERE project_id = ?', [pid])

// A REAL pre-0065 schema (makeTestDbUpto's recipe), seeded through the raw adapter,
// then upgraded THROUGH THE REAL RUNNER with the full migrations dir — the exact
// sequence a lagging D1 walks when 0065 applies.
async function makeDbThroughUpgrade(upto: number, seed: (db: Db) => Promise<void>): Promise<{ db: Db; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'hibana-test-up-'))
  const path = join(dir, 'test.db')
  const src = join(process.cwd(), 'migrations')
  const subset = join(dir, 'migrations')
  mkdirSync(subset)
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.sql')) continue
    const n = Number.parseInt(f.slice(0, 4), 10)
    if (Number.isFinite(n) && n <= upto) copyFileSync(join(src, f), join(subset, f))
  }
  applyMigrations(path, subset)
  let adapter = createSqliteDb(path)
  await seed(adapter)
  adapter.close()
  applyMigrations(path, src) // 0065 (+ nothing else — ≤ upto are recorded) lands on the legacy schema
  adapter = createSqliteDb(path)
  return { db: adapter, close: () => { adapter.close(); rmSync(dir, { recursive: true, force: true }) } }
}

const nowIso = () => new Date().toISOString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('S240 §4.3 — sprint name uniqueness (case-insensitive, project-scoped, ALL states)', () => {
  it('create: Security vs SECURITY vs " security " in one project → 409 duplicate; another project → 201', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'name-unique probe')
      const p2 = await createProject(app, headers, 'other project')
      // 'Security' as a closed January window (completed at birth — the backfill mapping)
      const s1 = await mkSprint(app, headers, pid, { name: 'Security', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })
      expect(s1.status).toBe(201)
      // case-twin on a clean February window → held by the COMPLETED sprint's name
      const s2 = await mkSprint(app, headers, pid, { name: 'SECURITY', started_at: '2026-02-01T00:00:00.000Z', ended_at: '2026-02-10T00:00:00.000Z' })
      expect(s2.status).toBe(409)
      expect(((await s2.json()) as { error: string }).error).toBe('duplicate')
      // whitespace + case fold (lower(trim(name)) — the categories' 0064 precedent)
      const s3 = await mkSprint(app, headers, pid, { name: '  security  ', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-10T00:00:00.000Z' })
      expect(s3.status).toBe(409)
      // the same name in ANOTHER project is legal (sprint scope is project-specific)
      const s4 = await mkSprint(app, headers, p2, { name: 'SECURITY', started_at: '2026-02-01T00:00:00.000Z', ended_at: '2026-02-10T00:00:00.000Z' })
      expect(s4.status).toBe(201)
    } finally { close() }
  })

  it('PATCH rename: onto a sibling case-twin → 409; onto one\'s OWN name (any case) → 200', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'rename probe')
      const a = ((await (await mkSprint(app, headers, pid, { name: 'Alpha', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })).json()) as { id: string }).id
      const b = ((await (await mkSprint(app, headers, pid, { name: 'Beta', started_at: '2026-02-01T00:00:00.000Z', ended_at: '2026-02-10T00:00:00.000Z' })).json()) as { id: string }).id
      // rename Beta onto Alpha's name (case-twin) → 409
      const bad = await patchSprint(app, headers, b, { name: 'ALPHA' })
      expect(bad.status).toBe(409)
      expect(((await bad.json()) as { error: string }).error).toBe('duplicate')
      // re-asserting one's own name — even changing its case — stays legal
      const own = await patchSprint(app, headers, b, { name: 'BETA' })
      expect(own.status).toBe(200)
      // and now Alpha's lowercase twin IS taken (BETA holds it after the re-case)
      const bad2 = await patchSprint(app, headers, a, { name: 'beta' })
      expect(bad2.status).toBe(409)
    } finally { close() }
  })

  it('the auto-generated name bumps past collisions instead of 409ing a nameless create', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'autoname probe')
      // an explicit 'Sprint 2' draft, then start it (a draft is one-per-project)
      const s2 = (await (await mkSprint(app, headers, pid, { name: 'Sprint 2' })).json()) as { id: string }
      await startSprint(app, headers, s2.id)
      // nameless create: count=1 → 'Sprint 2' is TAKEN → bump to 'Sprint 3'
      const res = await mkSprint(app, headers, pid, {})
      expect(res.status).toBe(201)
      expect(((await res.json()) as { name: string }).name).toBe('Sprint 3')
      // and a fresh project's first nameless create is plain 'Sprint 1' (legacy shape)
      const p2 = await createProject(app, headers, 'fresh autoname')
      const first = await mkSprint(app, headers, p2, {})
      expect(((await first.json()) as { name: string }).name).toBe('Sprint 1')
    } finally { close() }
  })
})

describe('S240 §5.1 — one ACTIVE sprint per project (sequential lifecycle)', () => {
  it('start/pause/resume/finish/reopen walk the state machine with one-active at every step', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'one-active probe')
      // One is born a draft and STARTED first — 0034's one-draft-per-project rule means
      // Two can only be drafted after One left the draft state.
      const one = ((await (await mkSprint(app, headers, pid, { name: 'One' })).json()) as { id: string }).id
      expect((await sprintRow(db, one)).status).toBe('planned')
      expect((await startSprint(app, headers, one)).status).toBe(200)
      expect((await sprintRow(db, one)).status).toBe('active')
      const two = ((await (await mkSprint(app, headers, pid, { name: 'Two' })).json()) as { id: string }).id
      // a second sprint can't start while One is active — 409 carries One's id
      const conflict = await startSprint(app, headers, two)
      expect(conflict.status).toBe(409)
      expect(((await conflict.json()) as { error: string; active_id: string })).toMatchObject({ error: 'sprint_active_exists', active_id: one })
      // pause One → Two may start
      expect((await pauseSprint(app, headers, one)).status).toBe(200)
      expect((await sprintRow(db, one)).status).toBe('paused')
      expect((await sprintRow(db, one)).ended_at).toBeNull() // §5.5: the window survives a pause
      expect((await startSprint(app, headers, two)).status).toBe(200)
      // resume One while Two is active → the same conflict, now with Two's id
      const conflict2 = await resumeSprint(app, headers, one)
      expect(conflict2.status).toBe(409)
      expect(((await conflict2.json()) as { error: string; active_id: string })).toMatchObject({ error: 'sprint_active_exists', active_id: two })
      // finish Two → completed (ended_at stamped for the timeline) → One may resume
      expect((await finishSprint(app, headers, two)).status).toBe(200)
      const twoAfter = await sprintRow(db, two)
      expect(twoAfter.status).toBe('completed')
      expect(twoAfter.ended_at).not.toBeNull()
      expect((await resumeSprint(app, headers, one)).status).toBe(200)
      expect((await sprintRow(db, one)).status).toBe('active')
    } finally { close() }
  })

  it('reopen = completed → active, subject to one-active; the not-latest sprint still 400s', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'reopen probe')
      const older = ((await (await mkSprint(app, headers, pid, { name: 'Older', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })).json()) as { id: string }).id
      const newer = ((await (await mkSprint(app, headers, pid, { name: 'Newer', started_at: '2026-02-01T00:00:00.000Z', ended_at: '2026-02-10T00:00:00.000Z' })).json()) as { id: string }).id
      expect((await sprintRow(db, older)).status).toBe('completed')
      // not the LATEST by started_at → 400 (the S235 contract, kept)
      expect((await reopenSprint(app, headers, older)).status).toBe(400)
      // the latest reopens into ACTIVE (completed → active, the S240 transition)
      expect((await reopenSprint(app, headers, newer)).status).toBe(200)
      expect((await sprintRow(db, newer)).status).toBe('active')
      // NOTE: reopen's one-active 409 arm is deliberately NOT exercised here — under
      // the timeline invariants an open (active/paused) band always carries the
      // LATEST started_at, so the isLatest guard (kept from S235) answers 400 before
      // the one-active check can fire. The 409 shape itself is pinned by the
      // start/resume tests above.
    } finally { close() }
  })

  it('the partial unique index is the belt: a raw second ACTIVE row in one project is rejected', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'index probe')
      const p2 = await createProject(app, headers, 'index probe 2')
      const active = (await (await mkSprint(app, headers, pid, { name: 'A', started_at: '2026-01-01T00:00:00.000Z' })).json()) as { id: string }
      await startSprint(app, headers, active.id)
      // direct DB writes bypass the service layer — the 0065 index must still hold
      await expect(db.execute(
        "INSERT INTO sprints (id, project_id, name, started_at, created_at, is_draft, status) VALUES ('raw-2', ?, 'B', '2026-02-01T00:00:00.000Z', ?, 0, 'active')",
        [pid, nowIso()],
      )).rejects.toThrow()
      // another project's active sprint is untouched by the index (project-scoped)
      await db.execute(
        "INSERT INTO sprints (id, project_id, name, started_at, created_at, is_draft, status) VALUES ('raw-3', ?, 'C', '2026-02-01T00:00:00.000Z', ?, 0, 'active')",
        [p2, nowIso()],
      )
    } finally { close() }
  })
})

describe('S240 §5.5 — pause/resume endpoint guards', () => {
  it('pause only accepts ACTIVE; resume only accepts PAUSED', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'pause-guards probe')
      const planned = (await (await mkSprint(app, headers, pid, { name: 'Planned one' })).json()) as { id: string }
      expect((await pauseSprint(app, headers, planned.id)).status).toBe(400) // planned isn't pausable
      expect((await resumeSprint(app, headers, planned.id)).status).toBe(400) // …or resumable
      await startSprint(app, headers, planned.id)
      expect((await resumeSprint(app, headers, planned.id)).status).toBe(400) // active isn't resumable
      expect((await pauseSprint(app, headers, planned.id)).status).toBe(200)
      expect((await pauseSprint(app, headers, planned.id)).status).toBe(400) // paused isn't pausable again
      expect((await sprintRow(db, planned.id)).status).toBe('paused')
      // a finished sprint can take neither
      const done = (await (await mkSprint(app, headers, pid, { name: 'Finished one', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-05T00:00:00.000Z' })).json()) as { id: string }
      expect((await pauseSprint(app, headers, done.id)).status).toBe(400)
      expect((await resumeSprint(app, headers, done.id)).status).toBe(400)
    } finally { close() }
  })
})

describe('S240 §5.3 + D4 — finish archives ONLY this sprint\'s done tasks', () => {
  it('done-in-sprint → archived (snapshot + sprint_id kept); every other task untouched', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'finish-archive probe')
      const otherProject = await createProject(app, headers, 'foreign sprint project')
      const ship = (await (await mkSprint(app, headers, pid, { name: 'Ship' })).json()) as { id: string }
      await startSprint(app, headers, ship.id)
      const other = (await (await mkSprint(app, headers, pid, { name: 'Other' })).json()) as { id: string } // stays a PLANNED draft
      const elsewhere = (await (await mkSprint(app, headers, otherProject, { name: 'Elsewhere' })).json()) as { id: string }
      await startSprint(app, headers, elsewhere.id)
      // the cast: A done-in-Ship (with labels), B unfinished-in-Ship, C done-no-sprint,
      // D done-in-a-PLANNED sprint, E done-in-another project's sprint
      const a = await createTask(app, headers, pid, { title: 'A done in Ship', status: 'done', sprint_id: ship.id, tags: ['UI/UX'] })
      const b = await createTask(app, headers, pid, { title: 'B wip in Ship', status: 'in_progress', sprint_id: ship.id })
      const c = await createTask(app, headers, pid, { title: 'C done, no sprint', status: 'done', sprint_id: null })
      const d = await createTask(app, headers, pid, { title: 'D done in planned', status: 'done', sprint_id: other.id })
      const e = await createTask(app, headers, otherProject, { title: 'E done elsewhere', status: 'done', sprint_id: elsewhere.id })
      const fin = await finishSprint(app, headers, ship.id)
      expect(fin.status).toBe(200)
      expect(((await fin.json()) as { archived: number }).archived).toBe(1)
      // A moved to the archive: sprint identity KEPT (sprint_id + name snapshot), labels
      // snapshotted as JSON, priority carried — the 0046/0051 archive-done shape.
      const archived = await archiveRows(db, pid)
      expect(archived).toHaveLength(1)
      expect(archived[0].id).toBe(a)
      expect(archived[0].sprint_id).toBe(ship.id)
      expect(archived[0].sprint_name_snapshot).toBe('Ship')
      expect(archived[0].status).toBe('done')
      expect(JSON.parse(archived[0].tags)).toEqual([{ name: 'UI/UX', color: expect.stringMatching(/^#/) }])
      // B/C/D/E all still live, with their status and sprint associations untouched
      expect((await taskRow(db, b)).sprint_id).toBe(ship.id)
      expect((await taskRow(db, b)).status).toBe('in_progress')
      expect((await taskRow(db, c)).status).toBe('done')
      expect((await taskRow(db, c)).sprint_id).toBeNull()
      expect((await taskRow(db, d)).sprint_id).toBe(other.id)
      expect((await taskRow(db, e)).sprint_id).toBe(elsewhere.id)
      // Ship completed; Other/Elsewhere untouched
      expect((await sprintRow(db, ship.id)).status).toBe('completed')
      expect((await sprintRow(db, other.id)).status).toBe('planned')
      expect((await sprintRow(db, elsewhere.id)).status).toBe('active')
    } finally { close() }
  })

  it('a finished sprint keeps sprint_id on archived rows (history) — the S235 contract, modern flow', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'finish-fk probe')
      const sprint = (await (await mkSprint(app, headers, pid, { name: 'With done work', started_at: '2026-01-01T00:00:00.000Z' })).json()) as { id: string }
      const t = await createTask(app, headers, pid, { title: 'done rider', status: 'done', sprint_id: sprint.id })
      expect((await finishSprint(app, headers, sprint.id)).status).toBe(200)
      const archived = await archiveRows(db, pid)
      expect(archived[0].sprint_id).toBe(sprint.id) // the FK stays valid for sprint history
      expect(archived[0].id).toBe(t)
    } finally { close() }
  })
})

describe('S240 §6 + D3 — sprint deletion semantics', () => {
  it('active → 409 sprint_active; completed → 409 sprint_completed; planned → detach + snapshot', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'delete probe')
      const active = (await (await mkSprint(app, headers, pid, { name: 'Running' })).json()) as { id: string }
      await startSprint(app, headers, active.id)
      expect((await deleteSprint(app, headers, active.id)).status).toBe(409)
      expect(((await (await deleteSprint(app, headers, active.id)).json()) as { error: string }).error).toBe('sprint_active')
      const completed = (await (await mkSprint(app, headers, pid, { name: 'Done deal', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })).json()) as { id: string }
      const gone = await deleteSprint(app, headers, completed.id)
      expect(gone.status).toBe(409)
      expect(((await gone.json()) as { error: string }).error).toBe('sprint_completed')
      // the deletable case: a PLANNED sprint holding a live task + an archived row
      const planned = (await (await mkSprint(app, headers, pid, { name: 'Gone' })).json()) as { id: string }
      const t = await createTask(app, headers, pid, { title: 'survivor', status: 'planned', sprint_id: planned.id })
      const aid = crypto.randomUUID()
      await db.execute(
        "INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags) VALUES (?, ?, 'archived rider', 'done', 'low', NULL, ?, ?, ?, ?, '[]')",
        [aid, pid, planned.id, nowIso(), nowIso(), nowIso()],
      )
      expect((await deleteSprint(app, headers, planned.id)).status).toBe(200)
      // the live task detached, NOT deleted — priority/status/deadlines untouched
      const detached = await taskRow(db, t)
      expect(detached.sprint_id).toBeNull()
      expect(detached.status).toBe('planned')
      // the archived row keeps the sprint's IDENTITY as the historical label
      const rows = await archiveRows(db, pid)
      expect(rows[0].sprint_id).toBeNull() // AP-27: the FK never dangles
      expect(rows[0].sprint_name_snapshot).toBe('Gone (deleted)')
      expect(await db.query('SELECT id FROM sprints WHERE id = ?', [planned.id])).toHaveLength(0) // the sprint itself is gone
    } finally { close() }
  })

  it('a PAUSED sprint is deletable (the planned/paused deletable set)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'delete-paused probe')
      const s = (await (await mkSprint(app, headers, pid, { name: 'Paused soon' })).json()) as { id: string }
      await startSprint(app, headers, s.id)
      await pauseSprint(app, headers, s.id)
      expect((await deleteSprint(app, headers, s.id)).status).toBe(200)
    } finally { close() }
  })
})

describe('S240 §8 — no NEW assignment to completed sprints (existing associations stay)', () => {
  it('task create and re-PATCH into a completed sprint → 400 sprint_completed', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'assign guard probe')
      const finished = (await (await mkSprint(app, headers, pid, { name: 'Finished', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })).json()) as { id: string }
      expect((await sprintRow(db, finished.id)).status).toBe('completed')
      const bad = await mkTask(app, headers, pid, { title: 'too late', sprint_id: finished.id })
      expect(bad.status).toBe(400)
      expect(((await bad.json()) as { error: string }).error).toBe('sprint_completed')
      // a task already created (no sprint) can't be moved in either
      const t = await createTask(app, headers, pid, { title: 'mover', sprint_id: null })
      const move = await patchTask(app, headers, t, { sprint_id: finished.id })
      expect(move.status).toBe(400)
      expect(((await move.json()) as { error: string }).error).toBe('sprint_completed')
    } finally { close() }
  })

  it('re-asserting the CURRENT (completed) sprint is legal — the old Edit modal stays working', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'echo guard probe')
      const s = (await (await mkSprint(app, headers, pid, { name: 'Later finished', started_at: '2026-01-01T00:00:00.000Z' })).json()) as { id: string }
      await startSprint(app, headers, s.id)
      const t = await createTask(app, headers, pid, { title: 'stays put', status: 'planned', sprint_id: s.id })
      await finishSprint(app, headers, s.id) // the task is NOT done → untouched, still associated
      // the old modal PATCHes the FULL field set — sprint_id verbatim:
      expect((await patchTask(app, headers, t, { title: 'stays put', sprint_id: s.id })).status).toBe(200)
      expect((await taskRow(db, t)).sprint_id).toBe(s.id)
      // explicit null (No sprint) is always a legal move; other fields ride along
      expect((await patchTask(app, headers, t, { sprint_id: null, priority: 'high' })).status).toBe(200)
      expect((await taskRow(db, t)).sprint_id).toBeNull()
      expect((await taskRow(db, t)).priority).toBe('high')
    } finally { close() }
  })

  it('assignment into planned/active/paused sprints all stays legal (assumption 3)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'assign ok probe')
      // one draft at a time (0034): Pausable is born, started, paused — THEN the next
      // draft (Plannable) can exist.
      const pausable = ((await (await mkSprint(app, headers, pid, { name: 'Pausable' })).json()) as { id: string }).id
      await startSprint(app, headers, pausable)
      await pauseSprint(app, headers, pausable)
      const plannable = ((await (await mkSprint(app, headers, pid, { name: 'Plannable' })).json()) as { id: string }).id
      const t1 = await createTask(app, headers, pid, { title: 'into planned', sprint_id: plannable })
      expect((await taskRow(db, t1)).sprint_id).toBe(plannable)
      const t2 = await createTask(app, headers, pid, { title: 'into paused', sprint_id: pausable })
      expect((await taskRow(db, t2)).sprint_id).toBe(pausable)
      await startSprint(app, headers, plannable) // a paused sibling doesn't block (D1)
      const t3 = await createTask(app, headers, pid, { title: 'into active', sprint_id: plannable })
      expect((await taskRow(db, t3)).sprint_id).toBe(plannable)
    } finally { close() }
  })
})

describe('S240 §12.2/§13 — deadline origin stamping (task level)', () => {
  it('set → stamp; edit → PRESERVE; clear → both gone; re-add → fresh timeline', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'task deadline probe')
      const t = await createTask(app, headers, pid, { title: 'deadline carrier', due_at: '2026-12-01T23:59:00.000Z' })
      let row = await taskRow(db, t)
      expect(row.due_at).toBe('2026-12-01T23:59:00.000Z')
      expect(row.due_origin_at).not.toBeNull() // first assignment stamps the progress start
      const origin1 = row.due_origin_at!
      // a DIFFERENT value (the extension case) keeps the origin — §13.2
      await patchTask(app, headers, t, { due_at: '2026-12-15T23:59:00.000Z' })
      row = await taskRow(db, t)
      expect(row.due_at).toBe('2026-12-15T23:59:00.000Z')
      expect(row.due_origin_at).toBe(origin1)
      // the SAME value is just an edit — origin untouched
      await patchTask(app, headers, t, { due_at: '2026-12-15T23:59:00.000Z' })
      expect((await taskRow(db, t)).due_origin_at).toBe(origin1)
      // clear → both gone
      await patchTask(app, headers, t, { due_at: null })
      row = await taskRow(db, t)
      expect(row.due_at).toBeNull()
      expect(row.due_origin_at).toBeNull()
      // re-add → a NEW timeline starts
      await sleep(5)
      await patchTask(app, headers, t, { due_at: '2026-12-20T23:59:00.000Z' })
      row = await taskRow(db, t)
      expect(row.due_origin_at).not.toBeNull()
      expect(row.due_origin_at!).not.toBe(origin1)
      // a task born without a deadline carries neither column
      const plain = await createTask(app, headers, pid, { title: 'no deadline' })
      const plainRow = await taskRow(db, plain)
      expect(plainRow.due_at).toBeNull()
      expect(plainRow.due_origin_at).toBeNull()
    } finally { close() }
  })
})

describe('S240 §12.2/§13 + D8 — sprint deadline origin + updated_at on every PATCH', () => {
  it('the sprint PATCH carries the same origin rules; updated_at is stamped on every write', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'sprint deadline probe')
      const sprintId = ((await (await mkSprint(app, headers, pid, { name: 'Due sprint', due_at: '2026-12-01T23:59:00.000Z' })).json()) as { id: string }).id
      let row = await sprintRow(db, sprintId)
      expect(row.due_at).toBe('2026-12-01T23:59:00.000Z')
      expect(row.due_origin_at).not.toBeNull()
      expect(row.updated_at).not.toBeNull() // stamped at create (D8)
      const origin1 = row.due_origin_at!
      const stamp1 = row.updated_at!
      // extend (different value) → origin preserved
      await patchSprint(app, headers, sprintId, { due_at: '2026-12-15T23:59:00.000Z' })
      row = await sprintRow(db, sprintId)
      expect(row.due_origin_at).toBe(origin1)
      // clear → both gone; re-add → fresh origin
      await patchSprint(app, headers, sprintId, { due_at: null })
      expect((await sprintRow(db, sprintId)).due_at).toBeNull()
      expect((await sprintRow(db, sprintId)).due_origin_at).toBeNull()
      await sleep(5)
      await patchSprint(app, headers, sprintId, { due_at: '2026-12-20T23:59:00.000Z' })
      row = await sprintRow(db, sprintId)
      expect(row.due_origin_at).not.toBe(origin1)
      // a PATCH that touches NOTHING deadline-related still stamps updated_at (D8)
      await sleep(5)
      await patchSprint(app, headers, sprintId, { description: 'doc edit' })
      row = await sprintRow(db, sprintId)
      expect(row.updated_at).not.toBe(stamp1)
      // emoji rides the same PATCH (explicit null clears it back to the default glyph)
      await patchSprint(app, headers, sprintId, { emoji: '🚀' })
      expect((await sprintRow(db, sprintId)).emoji).toBe('🚀')
      await patchSprint(app, headers, sprintId, { emoji: null })
      expect((await sprintRow(db, sprintId)).emoji).toBeNull()
    } finally { close() }
  })
})

describe('S240 §14 — task dependencies (self / cross-project / cycles / multi-blocker)', () => {
  it('self and cross-project (and cross-user) blockers are rejected; same-project cross-sprint links work', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const stranger = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const { headers: strangerHeaders } = await makeApp(db, stranger)
      const pid = await createProject(app, headers, 'deps probe')
      const otherPid = await createProject(app, headers, 'other project')
      const strangerPid = await createProject(app, strangerHeaders, 'stranger project')
      const a = await createTask(app, headers, pid, { title: 'A' })
      const b = await createTask(app, headers, pid, { title: 'B' })
      // self
      expect((await addDep(app, headers, a, a)).status).toBe(400)
      // a task in ANOTHER project (same user)
      const foreign = await createTask(app, headers, otherPid, { title: 'foreign' })
      expect((await addDep(app, headers, b, foreign)).status).toBe(400)
      // a task owned by ANOTHER user
      const strangerTask = await createTask(app, strangerHeaders, strangerPid, { title: 'stranger' })
      expect((await addDep(app, headers, b, strangerTask)).status).toBe(400)
      // same-project, cross-sprint: A sits in sprint 1, B in sprint 2 — legal (§14.1)
      const s1 = (await (await mkSprint(app, headers, pid, { name: 'DepSprintOne' })).json()) as { id: string }
      await startSprint(app, headers, s1.id)
      await patchTask(app, headers, a, { sprint_id: s1.id })
      expect((await addDep(app, headers, b, a)).status).toBe(201)
      const rows = await db.query<{ blocker_task_id: string; blocked_task_id: string }>('SELECT blocker_task_id, blocked_task_id FROM dev_task_deps')
      expect(rows).toEqual([{ blocker_task_id: a, blocked_task_id: b }])
      // a dep never mutates the task's own fields (§15: priority/status/sprint untouched)
      const bRow = await taskRow(db, b)
      expect(bRow.priority).toBe('medium')
      expect(bRow.status).toBe('idea')
      expect(bRow.sprint_id).toBeNull()
    } finally { close() }
  })

  it('cycles are rejected (direct reverse edge AND transitive 3-loop) with 409 cycle', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'cycle probe')
      const a = await createTask(app, headers, pid, { title: 'A' })
      const b = await createTask(app, headers, pid, { title: 'B' })
      const c = await createTask(app, headers, pid, { title: 'C' })
      expect((await addDep(app, headers, b, a)).status).toBe(201) // A blocks B
      // the direct reverse edge closes a 2-cycle
      const direct = await addDep(app, headers, a, b)
      expect(direct.status).toBe(409)
      expect(((await direct.json()) as { error: string }).error).toBe('cycle')
      // B blocks C; then C→A would close the 3-loop (A already reaches C transitively)
      expect((await addDep(app, headers, c, b)).status).toBe(201)
      const transitive = await addDep(app, headers, a, c)
      expect(transitive.status).toBe(409)
      expect(((await transitive.json()) as { error: string }).error).toBe('cycle')
    } finally { close() }
  })

  it('multi-blocker edges, idempotent re-add, delete, and task-delete cascade', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'multi blocker probe')
      const a = await createTask(app, headers, pid, { title: 'A' })
      const e = await createTask(app, headers, pid, { title: 'E' })
      const d = await createTask(app, headers, pid, { title: 'D' })
      // D blocked by BOTH A and E (a task may be blocked by many)
      expect((await addDep(app, headers, d, a)).status).toBe(201)
      expect((await addDep(app, headers, d, e)).status).toBe(201)
      let rows = await db.query('SELECT blocker_task_id, blocked_task_id FROM dev_task_deps ORDER BY blocker_task_id')
      expect(rows).toHaveLength(2)
      // re-adding an existing edge is a 200 that writes nothing
      const again = await addDep(app, headers, d, a)
      expect(again.status).toBe(200)
      expect(((await again.json()) as { existing: boolean }).existing).toBe(true)
      rows = await db.query('SELECT blocker_task_id, blocked_task_id FROM dev_task_deps')
      expect(rows).toHaveLength(2)
      // removing one edge leaves the other; removing an absent edge is still a 200
      expect((await delDep(app, headers, d, a)).status).toBe(200)
      rows = await db.query('SELECT blocker_task_id, blocked_task_id FROM dev_task_deps')
      expect(rows).toEqual([{ blocker_task_id: e, blocked_task_id: d }])
      expect((await delDep(app, headers, d, a)).status).toBe(200)
      // deleting a TASK cascades its edges (ON DELETE CASCADE — no half-edges survive);
      // the E→D edge (both endpoints alive) is untouched
      expect((await addDep(app, headers, d, a)).status).toBe(201)
      await app.fetch(new Request(`http://local/api/devtasks/${a}`, { method: 'DELETE', headers }))
      rows = await db.query('SELECT blocker_task_id, blocked_task_id FROM dev_task_deps')
      expect(rows).toEqual([{ blocker_task_id: e, blocked_task_id: d }])
    } finally { close() }
  })
})

describe('S240 — the board payload carries the new fields additively (old clients keep working)', () => {
  it('GET /api/projects/:id/devboard: sprints gain status/emoji/due_at/due_origin_at/updated_at; tasks gain due_at/due_origin_at', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'payload probe')
      const sid = ((await (await mkSprint(app, headers, pid, { name: 'Payload', emoji: '🔥', due_at: '2026-12-01T23:59:00.000Z' })).json()) as { id: string }).id
      await startSprint(app, headers, sid)
      const t = await createTask(app, headers, pid, { title: 'task', sprint_id: sid, due_at: '2026-11-20T23:59:00.000Z' })
      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        sprints: Record<string, unknown>[]
        tasks: Record<string, unknown>[]
      }
      const sprint = data.sprints.find((x) => x.id === sid)!
      // the new keys ride along…
      expect(sprint.status).toBe('active')
      expect(sprint.emoji).toBe('🔥')
      expect(sprint.due_at).toBe('2026-12-01T23:59:00.000Z')
      expect(sprint.due_origin_at).toBeTruthy()
      expect(sprint.updated_at).toBeTruthy()
      // …AND every legacy key the pinned island reads is still there (backward compat)
      for (const key of ['id', 'project_id', 'name', 'started_at', 'ended_at', 'created_at', 'is_draft', 'version', 'description']) {
        expect(key in sprint).toBe(true)
      }
      const task = data.tasks.find((x) => x.id === t)!
      expect(task.due_at).toBe('2026-11-20T23:59:00.000Z')
      expect(task.due_origin_at).toBeTruthy()
      for (const key of ['id', 'project_id', 'title', 'status', 'priority', 'category_id', 'sprint_id', 'sort_order', 'created_at', 'done_at', 'updated_at', 'tags', 'shot_count']) {
        expect(key in task).toBe(true)
      }
    } finally { close() }
  })
})

describe('S240 — migration 0065 backfill correctness (the real pre-0065 → 0065 upgrade path)', () => {
  it('legacy rows map to the CASE backfill; new columns arrive NULL; the one-active index enforces', async () => {
    const seeded = async (db: Db) => {
      const uid = await makeUser(db)
      await db.execute(
        'INSERT INTO projects (id, user_id, title, type, status, sort_order, archived_state, created_at, updated_at) VALUES (?, ?, \'P\', \'personal\', \'developing\', 0, NULL, ?, ?)',
        ['p1', uid, nowIso(), nowIso()],
      )
      await db.execute(
        'INSERT INTO projects (id, user_id, title, type, status, sort_order, archived_state, created_at, updated_at) VALUES (?, ?, \'P2\', \'personal\', \'developing\', 0, NULL, ?, ?)',
        ['p2', uid, nowIso(), nowIso()],
      )
      // the three legacy shapes: draft / open / closed
      await db.execute("INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft) VALUES ('draft1', 'p1', 'Draft', ?, NULL, ?, 1)", [nowIso(), nowIso()])
      await db.execute("INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft) VALUES ('open1', 'p1', 'Open', ?, NULL, ?, 0)", ['2026-01-01T00:00:00.000Z', nowIso()])
      await db.execute("INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft) VALUES ('closed1', 'p1', 'Closed', '2025-12-01T00:00:00.000Z', '2025-12-15T00:00:00.000Z', ?, 0)", [nowIso()])
      // a task and an archive row in the OLD shape (no deadline / snapshot columns)
      await db.execute("INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at) VALUES ('t1', 'p1', 'T', 'planned', 'medium', 0, ?)", [nowIso()])
      await db.execute("INSERT INTO project_archives (id, project_id, title, status, priority, original_created_at, archived_at) VALUES ('ar1', 'p1', 'A', 'done', 'low', ?, ?)", [nowIso(), nowIso()])
    }
    const { db, close } = await makeDbThroughUpgrade(64, seeded)
    try {
      // the D1 mapping, verbatim: ended → completed, draft → planned, open → active
      const sprints = await db.query<{ id: string; status: string; emoji: string | null; due_at: string | null; due_origin_at: string | null; updated_at: string | null }>(
        'SELECT id, status, emoji, due_at, due_origin_at, updated_at FROM sprints',
      )
      const byId = Object.fromEntries(sprints.map((s) => [s.id, s]))
      expect(byId.draft1.status).toBe('planned')
      expect(byId.open1.status).toBe('active')
      expect(byId.closed1.status).toBe('completed')
      // the appended columns arrive nullable, untouched
      expect(byId.open1.emoji).toBeNull()
      expect(byId.open1.due_at).toBeNull()
      expect(byId.open1.due_origin_at).toBeNull()
      expect(byId.open1.updated_at).toBeNull()
      const t = (await db.query<{ due_at: string | null; due_origin_at: string | null }>('SELECT due_at, due_origin_at FROM dev_tasks WHERE id = \'t1\''))[0]
      expect(t.due_at).toBeNull()
      expect(t.due_origin_at).toBeNull()
      const ar = (await db.query<{ sprint_name_snapshot: string | null }>('SELECT sprint_name_snapshot FROM project_archives WHERE id = \'ar1\''))[0]
      expect(ar.sprint_name_snapshot).toBeNull()
      // the one-active partial index enforces on a second ACTIVE row in p1…
      await expect(db.execute(
        "INSERT INTO sprints (id, project_id, name, started_at, created_at, is_draft, status) VALUES ('open2', 'p1', 'Second', '2026-02-01T00:00:00.000Z', ?, 0, 'active')",
        [nowIso()],
      )).rejects.toThrow()
      // …but another project's active row is fine (the index is project-scoped)
      await db.execute(
        "INSERT INTO sprints (id, project_id, name, started_at, created_at, is_draft, status) VALUES ('open2b', 'p2', 'Other', '2026-02-01T00:00:00.000Z', ?, 0, 'active')",
        [nowIso()],
      )
    } finally { close() }
  })

  it('legacy data with TWO open windows in one project normalizes: latest stays active, older is paused', async () => {
    const seeded = async (db: Db) => {
      const uid = await makeUser(db)
      await db.execute(
        'INSERT INTO projects (id, user_id, title, type, status, sort_order, archived_state, created_at, updated_at) VALUES (?, ?, \'P\', \'personal\', \'developing\', 0, NULL, ?, ?)',
        ['p1', uid, nowIso(), nowIso()],
      )
      // direct-DB-edit damage: two OPEN windows in one project (the service layer has
      // enforced one-open since 0030 — this simulates the pathological legacy row).
      await db.execute("INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft) VALUES ('older', 'p1', 'Older', '2026-01-01T00:00:00.000Z', NULL, ?, 0)", [nowIso()])
      await db.execute("INSERT INTO sprints (id, project_id, name, started_at, ended_at, created_at, is_draft) VALUES ('newer', 'p1', 'Newer', '2026-03-01T00:00:00.000Z', NULL, ?, 0)", [nowIso()])
    }
    const { db, close } = await makeDbThroughUpgrade(64, seeded)
    try {
      const rows = await db.query<{ id: string; status: string }>('SELECT id, status FROM sprints')
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]))
      expect(byId.newer).toBe('active') // the LATEST open window stays active
      expect(byId.older).toBe('paused') // the older one is parked resumable — nothing deleted
    } finally { close() }
  })
})
