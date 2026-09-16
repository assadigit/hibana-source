import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S52: the heatmap's activity sources widened from (hurdles solved + projects created)
// to the four real daily-work signals — hurdles, projects, to-dos completed (one-shot
// via cleared_at + recurring via sadhana_recur_history.completed_on), notes captured.
// These tests pin the per-bucket arithmetic, the 91-day window, the done=1 guard
// (an un-completed one-shot has cleared_at NULL'd — a stale cleared_at must not count),
// and rule 1 (a stranger's heatmap stays empty).

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

type App = ReturnType<typeof createApp>

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10)
const isoNow = () => new Date().toISOString()

/** Minimal one-shot sadhana task with precise completion stamps (direct SQL — the API
 *  always stamps "now", but the heatmap math must hold for ANY historical date). */
const insertTask = (db: Db, uid: string, over: Partial<{ title: string; done: number; cleared_at: string | null; recurring: number }>) =>
  db.execute(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, done, deleted_at, cleared_at, recurring, position, created_at, updated_at)
     VALUES (?, ?, 1, ?, '📌', ?, NULL, ?, ?, 0, ?, ?)`,
    [crypto.randomUUID(), uid, over.title ?? 't', over.done ?? 0, over.cleared_at ?? null, over.recurring ?? 0, isoNow(), isoNow()],
  )

const insertRecurHistory = (db: Db, taskId: string, completedOn: string) =>
  db.execute(
    'INSERT INTO sadhana_recur_history (id, task_id, completed_on, created_at) VALUES (?, ?, ?, ?)',
    [crypto.randomUUID(), taskId, completedOn, isoNow()],
  )

async function heatmapRow(app: App, headers: Record<string, string>, date: string) {
  const res = await app.fetch(new Request('http://local/api/reports/heatmap', { headers }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { days: number; rows: { date: string; hurdles: number; projects: number; todos: number; notes: number; total: number }[] }
  return { meta: body, row: body.rows.find((r) => r.date === date) }
}

describe('reports /heatmap — four activity sources (S52)', () => {
  it('todos (one-shot + recurring) and notes land in their day bucket; total is the sum', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)

      // projects bucket: one project created today (via API — created_at is now)
      await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'heatmap probe' }) }))
      // notes bucket: one note captured today
      await app.fetch(new Request('http://local/api/notes', { method: 'POST', headers, body: JSON.stringify({ kind: 'note', content: 'today note' }) }))
      // todos bucket: one one-shot completed today + one recurring completed twice today
      await insertTask(db, userId, { done: 1, cleared_at: today() })
      const rec = crypto.randomUUID()
      await db.execute(
        `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, done, recurring, recur_type, recur_config, position, created_at, updated_at)
         VALUES (?, ?, 2, 'daily thing', '📌', 1, 1, 'daily', '1', 0, ?, ?)`,
        [rec, userId, isoNow(), isoNow()],
      )
      await insertRecurHistory(db, rec, today())
      await insertRecurHistory(db, rec, today())

      const { meta, row } = await heatmapRow(app, headers, today())
      expect(meta.days).toBe(91)
      expect(row).toMatchObject({ hurdles: 0, projects: 1, todos: 3, notes: 1, total: 5 })
    } finally {
      close()
    }
  })

  it('a completed to-do 100 days ago stays outside the 91-day window', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      await insertTask(db, userId, { done: 1, cleared_at: daysAgo(100) })
      const res = await app.fetch(new Request('http://local/api/reports/heatmap', { headers }))
      const body = (await res.json()) as { rows: { todos: number }[] }
      expect(body.rows.every((r) => r.todos === 0)).toBe(true)
    } finally {
      close()
    }
  })

  it('an un-completed one-shot (cleared_at stale, done=0) does not count', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      // the un-complete path nulls cleared_at; a done=0 row with a stale stamp (e.g. the
      // Monday sweep touched it) must not inflate the day
      await insertTask(db, userId, { done: 0, cleared_at: today() })
      const { row } = await heatmapRow(app, headers, today())
      expect(row?.todos ?? 0).toBe(0)
    } finally {
      close()
    }
  })

  it('rule 1: a stranger with no activity sees 91 zero rows, not the owner’s', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const strangerId = await makeUser(db)
      const owner = await makeApp(db, ownerId)
      await insertTask(db, ownerId, { done: 1, cleared_at: today() })

      const stranger = await makeApp(db, strangerId)
      const res = await stranger.app.fetch(new Request('http://local/api/reports/heatmap', { headers: stranger.headers }))
      const body = (await res.json()) as { rows: { total: number }[] }
      expect(body.rows).toHaveLength(91)
      expect(body.rows.every((r) => r.total === 0)).toBe(true)

      // sanity: the owner DOES see the activity the stranger must not
      const mine = await heatmapRow(owner.app, owner.headers, today())
      expect(mine.row?.todos).toBe(1)
    } finally {
      close()
    }
  })
})
