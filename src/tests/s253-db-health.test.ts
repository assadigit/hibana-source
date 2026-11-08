import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db, Row, Tx } from '../db/types'

// S253 (Phase 2 — database health, migration 0067): the spec §5.6 regression pins:
//   (a) the TOCTOU belts fire as the EXISTING 409s — a find-miss db wrapper replays
//       the race (both in-flight requests pass the pre-check; the 0067 unique index
//       is the only thing left standing) at every sprint/strategy create+rename site;
//   (b) BE-1's batched setTaskTags is behavior-equivalent (same final tag set, same
//       response shape, same NOCASE/oldest-wins/ON CONFLICT race semantics);
//   (c) BE-5b's archives GET is capped (LIMIT 200) with the additive ?offset= page.

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

const mkSprint = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify(body) }))

const mkStrategy = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/strategies`, { method: 'POST', headers, body: JSON.stringify(body) }))

const patchSprint = (app: App, headers: Record<string, string>, sid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

const patchStrategy = (app: App, headers: Record<string, string>, sid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/strategies/${sid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

const patchTask = (app: App, headers: Record<string, string>, tid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

/** The race harness (the s252 pattern): wrap the adapter so a chosen PRE-CHECK view
 * misses — what two in-flight requests both see — leaving the 0067 unique index as
 * the only line of defense. Everything else passes through untouched. */
function hideViewDb(db: Db, hideSqlFragment: string): Db {
  return {
    query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes(hideSqlFragment)) return Promise.resolve([] as T[])
      return db.query<T>(sql, params)
    },
    execute: (sql: string, params?: unknown[]) => db.execute(sql, params),
    transaction: <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn),
  }
}

const DRAFT_CHECK = 'AND is_draft = 1 ORDER BY created_at DESC' // POST /sprints' draft pre-check (findActiveSprint uses no ORDER BY)
const SPRINT_NAME_CHECK = 'lower(trim(name)) = lower(trim(?))' // sprintNameTaken

describe('S253 (0067 belts): a raced create/rename answers the pre-check\'s own 409, never a 500', () => {
  it('one-draft belt: a raced second draft answers draft_exists with the winner\'s id', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'belt draft')

      const first = await mkSprint(app, headers, pid, { name: 'S1' })
      expect(first.status).toBe(201)
      const draftId = ((await first.json()) as { id: string }).id

      // Replay the race: the draft pre-check misses (both requests saw no draft) —
      // the partial unique idx_sprints_one_draft fires; the catch must answer the
      // pre-check's own 409 (draft_exists + the WINNING draft's id).
      const raced = hideViewDb(db, DRAFT_CHECK)
      const { app: app2, headers: headers2 } = await makeApp(raced, userId)
      const second = await mkSprint(app2, headers2, pid, { name: 'S2' })
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({ error: 'draft_exists', draft_id: draftId })

      const drafts = await db.query<{ id: string }>('SELECT id FROM sprints WHERE project_id = ? AND is_draft = 1', [pid])
      expect(drafts.map((d) => d.id)).toEqual([draftId]) // exactly one draft survived the race
    } finally { close() }
  })

  it('sprint-name belt: a raced duplicate name on CREATE answers duplicate (409)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'belt sprint name')
      const first = await mkSprint(app, headers, pid, { name: 'Push', started_at: '2026-01-05T00:00:00.000Z', ended_at: '2026-01-20T00:00:00.000Z' })
      expect(first.status).toBe(201)

      const raced = hideViewDb(db, SPRINT_NAME_CHECK)
      const { app: app2, headers: headers2 } = await makeApp(raced, userId)
      const second = await mkSprint(app2, headers2, pid, { name: 'push ' }) // case+trim twin — the expression index folds it
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({ error: 'duplicate' })
    } finally { close() }
  })

  it('sprint-name belt: a raced RENAME answers duplicate (409)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'belt sprint rename')
      await mkSprint(app, headers, pid, { name: 'Alpha', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-10T00:00:00.000Z' })
      const s2 = ((await (await mkSprint(app, headers, pid, { name: 'Beta', started_at: '2026-02-01T00:00:00.000Z', ended_at: '2026-02-10T00:00:00.000Z' })).json()) as { id: string }).id

      const raced = hideViewDb(db, SPRINT_NAME_CHECK)
      const { app: app2, headers: headers2 } = await makeApp(raced, userId)
      const res = await patchSprint(app2, headers2, s2, { name: 'ALPHA' })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'duplicate' })
      expect(((await db.query<{ name: string }>('SELECT name FROM sprints WHERE id = ?', [s2]))[0]).name).toBe('Beta') // rename did not land
    } finally { close() }
  })

  it('strategy-name belt: raced CREATE + RENAME both answer duplicate (409)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'belt strategy')
      const first = await mkStrategy(app, headers, pid, { name: 'Growth' })
      expect(first.status).toBe(201)

      // strategyNameTaken's scan is strategy-table-scoped; hide by its FROM clause.
      const raced = hideViewDb(db, 'FROM strategies WHERE project_id = ? AND lower(trim(name))')
      const { app: app2, headers: headers2 } = await makeApp(raced, userId)
      const dup = await mkStrategy(app2, headers2, pid, { name: 'growth' })
      expect(dup.status).toBe(409)
      expect(await dup.json()).toEqual({ error: 'duplicate' })

      const second = await mkStrategy(app, headers, pid, { name: 'Retention' })
      const sid2 = ((await second.json()) as { id: string }).id
      const res = await patchStrategy(app2, headers2, sid2, { name: 'GROWTH' })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'duplicate' })
      expect(((await db.query<{ name: string }>('SELECT name FROM strategies WHERE id = ?', [sid2]))[0]).name).toBe('Retention')
    } finally { close() }
  })

  it('the belts hold on plain double-create too: the SECOND draft create still 409s through the pre-check (byte-identical to pre-S253)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'belt plain')
      const first = await mkSprint(app, headers, pid, { name: 'Only' })
      const draftId = ((await first.json()) as { id: string }).id
      const second = await mkSprint(app, headers, pid, { name: 'Another' })
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({ error: 'draft_exists', draft_id: draftId })
    } finally { close() }
  })
})

describe('S253 (BE-1): batched setTaskTags is behavior-equivalent', () => {
  it('replace-set semantics: NOCASE reuse + create + drop + usage/search sync, same response shape', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'settags batch')
      const tid = await createTask(app, headers, pid, { title: 't1', tags: ['UI/UX', 'Security'] })

      const r = await patchTask(app, headers, tid, { tags: ['ui/ux', 'New Tag'] })
      expect(r.status).toBe(200)
      const body = (await r.json()) as { ok: boolean; tags: { task_id: string; id: string; name: string; color: string }[] }
      expect(body.ok).toBe(true)
      // The response carries the STORED spellings (same final query as before S253),
      // name-ordered — the byte-identical TaskTagJoin shape.
      expect(body.tags.map((t) => t.name)).toEqual(['New Tag', 'UI/UX'])
      expect(body.tags.every((t) => t.task_id === tid && typeof t.id === 'string' && /^#[0-9A-F]{6}$/i.test(t.color))).toBe(true)

      // 'UI/UX' was reused (NOCASE — no third row); 'Security' link dropped (usage 0)
      const tags = await db.query<{ name: string; usage_count: number }>('SELECT name, usage_count FROM tags ORDER BY created_at')
      expect(tags.map((t) => t.name)).toEqual(['UI/UX', 'Security', 'New Tag'])
      const usage = Object.fromEntries(tags.map((t) => [t.name, t.usage_count]))
      expect(usage['UI/UX']).toBe(1)
      expect(usage['Security']).toBe(0)
      expect(usage['New Tag']).toBe(1)

      const links = await db.query<{ tag_id: string }>('SELECT tag_id FROM dev_task_tags WHERE task_id = ?', [tid])
      expect(links).toHaveLength(2)
      const search = await db.query<{ search_tags: string }>('SELECT search_tags FROM dev_tasks WHERE id = ?', [tid])
      expect(['New Tag UI/UX', 'UI/UX New Tag']).toContain(search[0].search_tags) // the FINAL set, space-joined (group_concat order is scan-dependent)
    } finally { close() }
  })

  it('legacy exact-case twins: the OLDEST row wins, no fork', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      await db.execute("INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('old-t', ?, 'ui/ux', '#111111', 0, '2026-01-01T00:00:00.000Z')", [userId])
      await db.execute("INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('new-t', ?, 'UI/UX', '#222222', 0, '2026-02-01T00:00:00.000Z')", [userId])
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'twins batch')
      const tid = await createTask(app, headers, pid, { title: 't', tags: ['UI/UX'] })

      const links = await db.query<{ tag_id: string }>('SELECT tag_id FROM dev_task_tags WHERE task_id = ?', [tid])
      expect(links.map((l) => l.tag_id)).toEqual(['old-t']) // oldest wins — findOrCreateTag's grammar
      expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM tags')).at(0)?.n).toBe(2) // no third row created
    } finally { close() }
  })

  it('the batched ON CONFLICT race path: an exact-name replay with a find-miss still resolves to the EXISTING row id', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'race batch')
      const tid = await createTask(app, headers, pid, { title: 't', tags: ['Race Tag'] })
      const before = (await db.query<{ id: string; name: string }>('SELECT id, name FROM tags'))[0]

      // The race (the s252 harness semantics): the NOCASE IN find misses — both
      // in-flight saves see no library — and the replay sends the SAME exact name
      // (double-click / offline-queue replay). The multi-row INSERT ... ON CONFLICT
      // (user_id, name) DO UPDATE ... RETURNING must absorb the collision and hand
      // back the EXISTING row's id; 'Fresh One' rides the same statement cleanly.
      const raced = hideViewDb(db, 'COLLATE NOCASE IN')
      const { app: app2, headers: headers2 } = await makeApp(raced, userId)
      const r = await patchTask(app2, headers2, tid, { tags: ['Race Tag', 'Fresh One'] })
      expect(r.status).toBe(200)
      const body = (await r.json()) as { tags: { id: string; name: string }[] }
      const raceRow = body.tags.find((t) => t.name === 'Race Tag')
      expect(raceRow?.id).toBe(before.id) // resolved to the EXISTING row, not a fork
      expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', [userId])).at(0)?.n).toBe(2) // Race Tag + Fresh One only
    } finally { close() }
  })

  it('a 12-tag set (the schema cap) rides the chunked paths fine', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'twelve batch')
      const names = Array.from({ length: 12 }, (_, i) => `Tag ${i + 1}`)
      const tid = await createTask(app, headers, pid, { title: 't', tags: names })
      const links = await db.query<{ tag_id: string }>('SELECT tag_id FROM dev_task_tags WHERE task_id = ?', [tid])
      expect(links).toHaveLength(12)
      const colors = await db.query<{ color: string }>('SELECT color FROM tags')
      expect(new Set(colors.map((c) => c.color)).size).toBe(8) // the 8-color palette spreads before doubling (the sequential pick)
    } finally { close() }
  })

  it('clearing ([]): links dropped, usage refreshed, search_tags emptied, response []', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'clear batch')
      const tid = await createTask(app, headers, pid, { title: 't', tags: ['A1', 'B2'] })
      const r = await patchTask(app, headers, tid, { tags: [] })
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ ok: true, tags: [] })
      expect((await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dev_task_tags WHERE task_id = ?', [tid]))[0].n).toBe(0)
      expect(((await db.query<{ search_tags: string }>('SELECT search_tags FROM dev_tasks WHERE id = ?', [tid]))[0]).search_tags).toBe('')
    } finally { close() }
  })
})

describe('S253 (BE-5b): archives GET is capped at 200 with an additive ?offset=', () => {
  it('returns the newest 200 by default, pages deeper with ?offset=, rejects bad offsets', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'archives cap')
      const now = new Date().toISOString()
      // 205 direct archive rows (archived_at DESC = a204..a200 on page 2)
      for (let i = 0; i < 205; i++) {
        await db.execute(
          "INSERT INTO project_archives (id, project_id, title, status, priority, original_created_at, archived_at) VALUES (?, ?, ?, 'done', 'low', ?, ?)",
          [`ar-${i}`, pid, `T${i}`, now, new Date(Date.parse(now) + i * 1000).toISOString()],
        )
      }

      const p1 = await app.fetch(new Request(`http://local/api/projects/${pid}/archives`, { headers }))
      expect(p1.status).toBe(200)
      const b1 = (await p1.json()) as { archives: { id: string }[] }
      expect(b1.archives).toHaveLength(200)
      expect(b1.archives[0].id).toBe('ar-204') // newest first
      expect(b1.archives[199].id).toBe('ar-5')

      const p2 = await app.fetch(new Request(`http://local/api/projects/${pid}/archives?offset=200`, { headers }))
      const b2 = (await p2.json()) as { archives: { id: string }[] }
      expect(b2.archives.map((a) => a.id)).toEqual(['ar-4', 'ar-3', 'ar-2', 'ar-1', 'ar-0'])

      const beyond = await app.fetch(new Request(`http://local/api/projects/${pid}/archives?offset=205`, { headers }))
      expect(((await beyond.json()) as { archives: unknown[] }).archives).toEqual([]) // an empty page, not an error

      for (const bad of ['offset=-1', 'offset=abc', 'offset=100001']) {
        const r = await app.fetch(new Request(`http://local/api/projects/${pid}/archives?${bad}`, { headers }))
        expect(r.status).toBe(400)
        expect(await r.json()).toEqual({ error: 'invalid_input' })
      }
    } finally { close() }
  })
})
