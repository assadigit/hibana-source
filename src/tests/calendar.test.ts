import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S199 (HLTH-16): /api/calendar was the only endpoint-prefix with zero unit coverage.
// The route is a pure read-aggregation over four tables — its contract worth pinning:
//   1. the 401 gate (rule 1: no data without a session);
//   2. Zod range validation (rule 10): malformed dates, start > end, >400-day spans;
//   3. user scoping: another user's project/task/sadhana/note rows NEVER appear —
//      the exact four-way WHERE user_id discipline the route is built on;
//   4. soft-deleted rows drop out (projects + sadhana + notes carry deleted_at);
//   5. the per-kind shaping: Gregorian date keys, kinds, hrefs (project page /
//      clients checklist anchor / to-do quadrant anchor / notes fallback), done flags,
//      sticky + color on day notes, and the 80-char whitespace-flattened note title;
//   6. client-project scoping on tasks (S100): a non-client project's task is NOT a
//      calendar item (its href would be a dead link by design).

function makeApp(db: Db) {
  return createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: undefined,
    assets: undefined,
  })
}

async function seedWorld(db: Db) {
  const uid = await makeUser(db)
  const other = await makeUser(db)
  const pid = crypto.randomUUID()
  const otherPid = crypto.randomUUID()
  const clientPid = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.execute(
    "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, due_date, created_at, updated_at) VALUES (?, ?, 'My project', '', 'personal', 'developing', 0, '', 0, '2026-10-15', ?, ?)",
    [pid, uid, now, now],
  )
  await db.execute(
    "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, due_date, created_at, updated_at) VALUES (?, ?, 'Foreign project', '', 'personal', 'developing', 0, '', 0, '2026-10-15', ?, ?)",
    [otherPid, other, now, now],
  )
  // client project (S100): its tasks are calendar items
  await db.execute(
    "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, 'Client project', '', 'client', 'operational', 0, '', 0, ?, ?)",
    [clientPid, uid, now, now],
  )
  const taskId = crypto.randomUUID()
  await db.execute(
    "INSERT INTO tasks (id, project_id, title, done, due_date, created_at, completed_at) VALUES (?, ?, 'Deliver design', 1, '2026-10-16', ?, ?)",
    [taskId, clientPid, now, now],
  )
  const sadhanaId = crypto.randomUUID()
  await db.execute(
    "INSERT INTO sadhana_tasks (id, user_id, title, done, quadrant, due_date, created_at, updated_at) VALUES (?, ?, 'Review the roadmap', 0, 2, '2026-10-17', ?, ?)",
    [sadhanaId, uid, now, now],
  )
  const noteId = crypto.randomUUID()
  await db.execute(
    "INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, deleted_at, sort_order, color, note_date, sticky, done, created_at, updated_at) VALUES (?, ?, 'note', '', ?, NULL, NULL, 0, 'amber', '2026-10-18', 1, 0, ?, ?)",
    [noteId, uid, 'the   sticky\nnote    body', now, now],
  )
  // foreign sadhana row — must never surface
  await db.execute(
    "INSERT INTO sadhana_tasks (id, user_id, title, done, quadrant, due_date, created_at, updated_at) VALUES (?, ?, 'Foreign to-do', 0, 1, '2026-10-17', ?, ?)",
    [crypto.randomUUID(), other, now, now],
  )
  // soft-deleted project with a due date inside the window — must drop out
  await db.execute(
    "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, due_date, deleted_at, created_at, updated_at) VALUES (?, ?, 'Deleted project', '', 'personal', 'developing', 0, '', 0, '2026-10-19', ?, ?, ?)",
    [crypto.randomUUID(), uid, now, now, now],
  )
  return { uid, pid, taskId, sadhanaId, noteId }
}

describe('GET /api/calendar (S199 coverage-gap close — the four-way user-scoped month feed)', () => {
  it('401 without a session (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = makeApp(db)
      const res = await app.fetch(new Request('http://local/api/calendar?start=2026-10-01&end=2026-10-31'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('rejects malformed ranges (rule 10): bad date shape, start > end, >400-day span', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const token = await createSession(db, uid)
      const app = makeApp(db)
      const auth = { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}` }
      for (const qs of ['?start=Oct-1&end=2026-10-31', '?start=2026-10-31&end=2026-10-01', '?start=2025-01-01&end=2026-12-31', '']) {
        const res = await app.fetch(new Request(`http://local/api/calendar${qs}`, { headers: auth }))
        expect(res.status, qs).toBe(400)
      }
    } finally {
      close()
    }
  })

  it('returns the four kinds shaped per contract — Gregorian keys, hrefs, done, sticky+color, flattened title', async () => {
    const { db, close } = makeTestDb()
    try {
      const { uid, pid, taskId, sadhanaId, noteId } = await seedWorld(db)
      const token = await createSession(db, uid)
      const app = makeApp(db)
      const res = await app.fetch(
        new Request('http://local/api/calendar?start=2026-10-01&end=2026-10-31', {
          headers: { Cookie: `hibana_session=${token}` },
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { start: string; end: string; byDay: Record<string, { kind: string; id: string; href: string; sticky?: boolean; color?: string; done?: boolean; title: string }[]> }
      expect(body.start).toBe('2026-10-01')

      const projectItem = body.byDay['2026-10-15']?.find((i) => i.kind === 'project')
      expect(projectItem?.id).toBe(pid)
      expect(projectItem?.href).toBe(`/project.html?id=${pid}`)

      const taskItem = body.byDay['2026-10-16']?.find((i) => i.kind === 'task')
      expect(taskItem?.id).toBe(taskId)
      expect(taskItem?.done).toBe(true)
      expect(taskItem?.href).toBe(`/clients.html#task-${taskId}`)

      const sadhanaItem = body.byDay['2026-10-17']?.find((i) => i.kind === 'sadhana')
      expect(sadhanaItem?.id).toBe(sadhanaId)
      expect(sadhanaItem?.href).toBe('/to-do-list#Q2') // its own board quadrant (S100)

      const noteItem = body.byDay['2026-10-18']?.find((i) => i.kind === 'note')
      expect(noteItem?.id).toBe(noteId)
      expect(noteItem?.sticky).toBe(true)
      expect(noteItem?.color).toBe('amber')
      expect(noteItem?.title).toBe('the sticky note body') // whitespace-flattened content
    } finally {
      close()
    }
  })

  it('never surfaces another user’s rows, soft-deleted rows, or non-client tasks (rules 1 + S100)', async () => {
    const { db, close } = makeTestDb()
    try {
      const { uid } = await seedWorld(db)
      const token = await createSession(db, uid)
      const app = makeApp(db)
      const res = await app.fetch(
        new Request('http://local/api/calendar?start=2026-10-01&end=2026-10-31', {
          headers: { Cookie: `hibana_session=${token}` },
        }),
      )
      const body = (await res.json()) as { byDay: Record<string, { kind: string; title: string }[]> }
      const all = Object.values(body.byDay).flat()
      const titles = all.map((i) => i.title)
      expect(titles).not.toContain('Foreign project')
      expect(titles).not.toContain('Foreign to-do')
      expect(titles).not.toContain('Deleted project')
      // the non-client project's task never rides the feed (S100: dead-link guard)
      expect(all.filter((i) => i.kind === 'task')).toHaveLength(1)
      expect(titles).toContain('Deliver design')
    } finally {
      close()
    }
  })
})
