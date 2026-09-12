import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S29 follow-up (user request 2026-09-12 — "O1: richer project progress box"):
//   1. POST /devtasks accepts priority + tags (labels like "UI/UX", "Security") —
//      find-or-create per user, palette colors, ONE round-trip.
//   2. Task listings are PRIORITY-FIRST (urgent → high → medium → low, then drag
//      order) — the boxes auto-sort (GET /devboard + GET /:id detail payload).
//   3. PATCH tags = replace-set semantics: an array makes the link set EXACTLY those
//      names ([] clears), omitted leaves them untouched; the response carries the
//      final set. tags NEVER reaches the generic SET builder (no dev_tasks column).
//   4. Tag rows are user-scoped and REUSED by name (no duplicates on re-create).
//   5. Isolation (rule 1): another user's task id → 404, no link writes.

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

type App = Awaited<ReturnType<typeof createApp>>

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const mkTask = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))

const patchTask = (app: App, headers: Record<string, string>, tid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

type BoardTask = { id: string; title: string; priority: string; tags: string[] }
type TaskTag = { task_id: string; id: string; name: string; color: string }

async function devboard(app: App, headers: Record<string, string>, pid: string) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
  expect(res.status).toBe(200)
  return (await res.json()) as { tasks: BoardTask[]; task_tags: TaskTag[] }
}

describe('dev-task priority + labels (S29 follow-up)', () => {
  it('create carries priority + tags; the listing is priority-first', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe one')

      // seeded in mixed priority order — the boxes must auto-sort regardless
      for (const [title, priority] of [['low first', 'low'], ['medium next', 'medium'], ['urgent jumps', 'urgent']] as const) {
        const res = await mkTask(app, headers, pid, { title, status: 'idea', priority })
        expect(res.status).toBe(201)
      }
      const urgentRes = await mkTask(app, headers, pid, { title: 'labeled urgent', status: 'idea', priority: 'urgent', tags: ['UI/UX', 'Security'] })
      expect(urgentRes.status).toBe(201)
      const created = (await urgentRes.json()) as { id: string; tags: TaskTag[] }
      // the create response carries the linked labels with palette colors
      expect(created.tags.map((t) => t.name).sort()).toEqual(['Security', 'UI/UX'])
      for (const t of created.tags) expect(t.color).toMatch(/^#[0-9a-fA-F]{6}$/)

      const { tasks, task_tags } = await devboard(app, headers, pid)
      // priority-first: both urgent tasks before medium before low
      const rank = (p: string) => ({ urgent: 0, high: 1, medium: 2, low: 3 })[p] ?? 4
      const ranks = tasks.map((t) => rank(t.priority))
      expect(ranks).toEqual([...ranks].sort())
      expect(tasks[0].priority).toBe('urgent')
      expect(tasks.at(-1)?.priority).toBe('low')
      // the labels ride the flat join, linked to the right task
      const labeled = task_tags.filter((t) => t.task_id === created.id)
      expect(labeled.map((t) => t.name).sort()).toEqual(['Security', 'UI/UX'])
      // and the task's tags array carries the tag ids (board.html editor contract)
      const labeledTask = tasks.find((t) => t.id === created.id)
      expect(labeledTask?.tags).toHaveLength(2)

      // the detail payload (project page) uses the SAME priority-first ordering
      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers }))
      expect(detail.status).toBe(200)
      const body = (await detail.json()) as { project: { devTasks: BoardTask[]; devTaskTags: TaskTag[] } }
      const dRanks = body.project.devTasks.map((t) => rank(t.priority))
      expect(dRanks).toEqual([...dRanks].sort())
      expect(body.project.devTaskTags.filter((t) => t.task_id === created.id)).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('PATCH tags replace-set: exact set, clear with [], untouched when omitted', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe two')
      const created = (await (await mkTask(app, headers, pid, { title: 't', tags: ['UI/UX', 'Security'] })).json()) as { id: string }
      const tid = created.id

      // replace with ONE label — the other link is dropped
      const first = (await (await patchTask(app, headers, tid, { tags: ['Security'] })).json()) as { tags: TaskTag[] }
      expect(first.tags.map((t) => t.name)).toEqual(['Security'])
      // tags with no other column changes still applies (the early-return is skipped)
      let links = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dev_task_tags WHERE task_id = ?', [tid])
      expect(links[0].n).toBe(1)

      // a no-column, no-tags PATCH is still a 200 no-op
      const noop = await patchTask(app, headers, tid, {})
      expect(noop.status).toBe(200)

      // omitted tags (title-only PATCH) leaves the link set untouched
      await patchTask(app, headers, tid, { title: 'renamed' })
      links = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dev_task_tags WHERE task_id = ?', [tid])
      expect(links[0].n).toBe(1)

      // [] clears everything
      const cleared = (await (await patchTask(app, headers, tid, { tags: [] })).json()) as { tags: TaskTag[] | undefined }
      expect(cleared.tags).toEqual([])
      links = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dev_task_tags WHERE task_id = ?', [tid])
      expect(links[0].n).toBe(0)
    } finally {
      close()
    }
  })

  it('tags are user-scoped rows REUSED by name (no case twins); priorities persist', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe three')

      const a = (await (await mkTask(app, headers, pid, { title: 'a', tags: ['UI/UX'] })).json()) as { id: string }
      // "ui/ux" normalizes onto the SAME tag row (case-insensitive dedupe)
      const b = (await (await mkTask(app, headers, pid, { title: 'b', tags: ['ui/ux', 'Security'] })).json()) as { id: string }
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', [userId])
      expect(rows[0].n).toBe(2) // UI/UX + Security — one row per name

      // PATCH the priority; the task row keeps its labels (no cross-contamination)
      await patchTask(app, headers, a.id, { priority: 'high' })
      const { tasks } = await devboard(app, headers, pid)
      const taskA = tasks.find((t) => t.id === a.id)
      expect(taskA?.priority).toBe('high')
      expect(taskA?.tags).toHaveLength(1)
      expect(tasks.find((t) => t.id === b.id)?.tags).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('isolation (rule 1): a foreign task id is 404, and no tags are written', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const strangerId = await makeUser(db)
      const { app, headers } = await makeApp(db, ownerId)
      const pid = await createProject(app, headers, 'probe four')
      const created = (await (await mkTask(app, headers, pid, { title: 'mine', tags: ['UI/UX'] })).json()) as { id: string }

      const stranger = await makeApp(db, strangerId)
      const res = await patchTask(stranger.app, stranger.headers, created.id, { priority: 'urgent', tags: ['Security'] })
      expect(res.status).toBe(404)
      // no link rows materialized for the stranger's attempt
      const links = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dev_task_tags WHERE task_id = ?', [created.id])
      expect(links[0].n).toBe(1) // only the owner's UI/UX
      const strangerTags = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM tags WHERE user_id = ?', [strangerId])
      expect(strangerTags[0].n).toBe(0)
    } finally {
      close()
    }
  })
})
