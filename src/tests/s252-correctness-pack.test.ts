import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db, Row, Tx } from '../db/types'

// S252 (Phase 1 — the correctness & safety pack): the three regression pins the
// audit-remediation spec §4.6 demands, one per fixed finding:
//   (a) BE-6/BE-12 — the shared findOrCreateTag: same-name + case-twin + the
//       ON CONFLICT race path all resolve to ONE tag id (never a 500, never a
//       "ui/ux" next to "UI/UX" fork) across all three attach sites.
//   (b) BE-7 — a failing window on POST /sprints leaves the ACTIVE sprint OPEN
//       (the old close-then-assert order permanently closed it); the success
//       path stays byte-identical (active auto-closed the day before the new
//       start — same geometry as before the fix).
//   (c) BE-10 — archive-done is atomic: a mid-flow failure (archive PK conflict)
//       rolls the whole move back — tasks stay on the board, no partial archive
//       rows; after the blocker is cleared, a retry succeeds.

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

async function createTask(app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const addTaskTag = (app: App, headers: Record<string, string>, tid: string, name: string) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}/tags`, { method: 'POST', headers, body: JSON.stringify({ name }) }))

const addProjectTag = (app: App, headers: Record<string, string>, pid: string, name: string) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/tags`, { method: 'POST', headers, body: JSON.stringify({ name }) }))

const mkSprint = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify(body) }))

const startSprint = (app: App, headers: Record<string, string>, sid: string) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}/start`, { method: 'POST', headers }))

async function tagRows(db: Db, userId: string) {
  return db.query<{ id: string; name: string }>('SELECT id, name FROM tags WHERE user_id = ? ORDER BY created_at', [userId])
}

async function sprintRows(db: Db, pid: string) {
  return db.query<{ id: string; name: string; ended_at: string | null; status: string | null; is_draft: number }>(
    'SELECT id, name, ended_at, status, is_draft FROM sprints WHERE project_id = ? ORDER BY created_at',
    [pid],
  )
}

describe('S252 (a) BE-6/BE-12 — the shared findOrCreateTag', () => {
  it('task-tags add: same name twice and a case twin resolve to ONE id; one row in tags', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'tag probe')
      const tid = await createTask(app, headers, pid, { title: 't' })

      const r1 = await addTaskTag(app, headers, tid, 'UI/UX')
      expect(r1.status).toBe(201)
      const id1 = ((await r1.json()) as { id: string }).id
      const r2 = await addTaskTag(app, headers, tid, 'UI/UX')
      expect(r2.status).toBe(201)
      expect(((await r2.json()) as { id: string }).id).toBe(id1)
      const r3 = await addTaskTag(app, headers, tid, 'ui/ux')
      expect(r3.status).toBe(201)
      expect(((await r3.json()) as { id: string }).id).toBe(id1)

      const rows = await tagRows(db, userId)
      expect(rows).toHaveLength(1) // no case-twin fork — BE-12
      expect(rows[0].name).toBe('UI/UX') // the FIRST spelling owns the row
    } finally { close() }
  })

  it('project-tags add: the same NOCASE resolution on the second attach site', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'ptag probe')

      const r1 = await addProjectTag(app, headers, pid, 'Security')
      expect(r1.status).toBe(201)
      const id1 = ((await r1.json()) as { id: string }).id
      const r2 = await addProjectTag(app, headers, pid, 'SECURITY')
      expect(r2.status).toBe(201)
      expect(((await r2.json()) as { id: string }).id).toBe(id1)
      expect((await tagRows(db, userId))).toHaveLength(1)
    } finally { close() }
  })

  it('setTaskTags (task create with tags) shares the same row as the add-tag route', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'settags probe')
      await createTask(app, headers, pid, { title: 'labeled', tags: ['UI/UX'] })
      const tid = await createTask(app, headers, pid, { title: 'bare' })
      // a different case through the OTHER site (route add) lands on the same row
      const r = await addTaskTag(app, headers, tid, 'ui/ux')
      expect(((await r.json()) as { id: string }).id).toBe((await tagRows(db, userId))[0].id)
      expect((await tagRows(db, userId))).toHaveLength(1)
    } finally { close() }
  })

  it('ON CONFLICT race path: when both requests miss the NOCASE find, the INSERT resolves both to one id (no UNIQUE 500)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      // The race harness: wrap the adapter so findOrCreateTag's find-first ALWAYS
      // misses (what two in-flight requests both see) — the INSERT ... ON CONFLICT
      // DO UPDATE ... RETURNING must then absorb the collision (the H1 recipe).
      const raceMissDb: Db = {
        query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
          if (sql.includes('COLLATE NOCASE ORDER BY created_at')) return Promise.resolve([] as T[])
          return db.query<T>(sql, params)
        },
        execute: (sql: string, params?: unknown[]) => db.execute(sql, params),
        transaction: <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn),
      }
      const { app, headers } = await makeApp(raceMissDb, userId)
      const pid = await createProject(app, headers, 'race probe')
      const tid = await createTask(app, headers, pid, { title: 'race task' })

      const r1 = await addTaskTag(app, headers, tid, 'Race Tag')
      expect(r1.status).toBe(201) // was the 500 class under the old find-then-INSERT
      const r2 = await addTaskTag(app, headers, tid, 'Race Tag')
      expect(r2.status).toBe(201)
      const id1 = ((await r1.json()) as { id: string }).id
      expect(((await r2.json()) as { id: string }).id).toBe(id1)
      // exactly one row despite both requests taking the INSERT path
      const rows = await db.query<{ id: string }>('SELECT id FROM tags WHERE user_id = ?', [userId])
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(id1)
    } finally { close() }
  })
})

describe('S252 (b) BE-7 — a failing window leaves the active sprint OPEN', () => {
  it('create-with-dates that overlaps a CLOSED sibling → 400, and the ACTIVE sprint stays open (was: silently closed)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'be7 probe')

      // Sprint 1: Mar 1 → Mar 30 2026 (closed window)
      const s1 = await mkSprint(app, headers, pid, { name: 'Sprint 1', started_at: '2026-03-01T00:00:00.000Z', ended_at: '2026-03-30T00:00:00.000Z' })
      expect(s1.status).toBe(201)
      // Sprint 2: draft → start (ACTIVE, open-ended)
      const s2res = await mkSprint(app, headers, pid, { name: 'Sprint 2' })
      expect(s2res.status).toBe(201)
      const s2 = (await s2res.json()) as { id: string }
      expect((await startSprint(app, headers, s2.id)).status).toBe(200)

      // The failing create: Mar 20 → Mar 25 overlaps Sprint 1's closed window → 400.
      const bad = await mkSprint(app, headers, pid, { name: 'Bad window', started_at: '2026-03-20T00:00:00.000Z', ended_at: '2026-03-25T00:00:00.000Z' })
      expect(bad.status).toBe(400)

      // THE REGRESSION: the active sprint must still be open + active. The old
      // close-then-assert order stamped it closed (ended_at = the day before the
      // bad start) before the 400 fired.
      const after = await sprintRows(db, pid)
      expect(after).toHaveLength(2) // the failed sprint was not inserted
      const s2row = after.find((r) => r.id === s2.id)!
      expect(s2row.ended_at).toBeNull() // still open
      expect(s2row.status).toBe('active') // still active
    } finally { close() }
  })

  it('success path byte-identical: a clean dated create still auto-closes the active sprint the day before the new start', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'be7 ok probe')

      const s2res = await mkSprint(app, headers, pid, { name: 'Active one' })
      const s2 = (await s2res.json()) as { id: string }
      expect((await startSprint(app, headers, s2.id)).status).toBe(200)

      // a clean window: start 30 days out, end 45 days out (midnight-UTC days)
      const day = (offset: number) => new Date(Math.floor(Date.now() / 86400000) * 86400000 + offset * 86400000).toISOString()
      const ok = await mkSprint(app, headers, pid, { name: 'Clean window', started_at: day(30), ended_at: day(45) })
      expect(ok.status).toBe(201)

      const after = await sprintRows(db, pid)
      const s2row = after.find((r) => r.id === s2.id)!
      expect(s2row.ended_at).toBe(day(29)) // closed the day before the new start — the old geometry
      expect(s2row.status).toBe('completed')
      const s3row = after.find((r) => r.name === 'Clean window')!
      expect(s3row.ended_at).toBe(day(45))
      expect(s3row.status).toBe('completed') // created-with-both-dates = completed (S240)
    } finally { close() }
  })
})

describe('S252 (c) BE-10 — archive-done is atomic', () => {
  it('a mid-flow failure (archive PK conflict) rolls the whole move back: tasks stay, no partial archive rows; a clean retry succeeds', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'atomic archive probe')

      const a = await createTask(app, headers, pid, { title: 'done a', status: 'done' })
      const b = await createTask(app, headers, pid, { title: 'done b', status: 'done' })
      await createTask(app, headers, pid, { title: 'planned c', status: 'planned' })

      // The poison: a pre-existing archive row with task A's id — exactly the
      // residue the OLD non-transactional flow could leave behind (a partial
      // archive from a failure between the insert loop and the delete). The
      // INSERT for A now conflicts on the task-id PRIMARY KEY mid-transaction.
      await db.execute(
        `INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags)
         VALUES (?, ?, 'poison residue', 'done', 'medium', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '[]')`,
        [a, pid],
      )

      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks/archive-done`, { method: 'POST', headers }))
      expect(res.status).toBe(500) // the conflict surfaces as the app's generic 500

      // THE REGRESSION: nothing partial — both done tasks are STILL on the board
      // (alongside the planned one — the board payload carries every task)…
      const board = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string }[] }
      const ids = board.tasks.map((t) => t.id)
      expect(ids).toHaveLength(3) // a + b + the planned task — nothing was deleted
      expect(ids).toContain(a)
      expect(ids).toContain(b)
      // …and the archive table carries ONLY the pre-existing poison row (B's row
      // was rolled back with A's failed insert — the old code left it behind).
      const archives = await db.query<{ id: string }>('SELECT id FROM project_archives WHERE project_id = ?', [pid])
      expect(archives).toHaveLength(1)
      expect(archives[0].id).toBe(a)

      // Clear the blocker → the retry succeeds end-to-end (recovery works).
      await db.execute('DELETE FROM project_archives WHERE id = ?', [a])
      const retry = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks/archive-done`, { method: 'POST', headers }))
      expect(retry.status).toBe(200)
      expect(((await retry.json()) as { archived: number }).archived).toBe(2)
      const after = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string }[] }
      expect(after.tasks).toHaveLength(1) // only the planned task remains
      expect((await db.query<{ id: string }>('SELECT id FROM project_archives WHERE project_id = ?', [pid])).map((r) => r.id).sort()).toEqual([a, b].sort())
    } finally { close() }
  })
})
