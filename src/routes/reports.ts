import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { etag } from '../lib/http'
import type { Config, UserRow } from '../types'

// Reports (spec §5.7): snapshot counts by status/type + activity over time in four
// granularities (day/week/month/year — the user asked for all four, explicitly).

const granularitySchema = z.enum(['day', 'week', 'month', 'year'])

function buckets(granularity: 'day' | 'week' | 'month' | 'year', now = new Date()): { key: string; label: string; start: Date; end: Date }[] {
  const b: { key: string; label: string; start: Date; end: Date }[] = []
  const startOf = (d: Date): Date => {
    const r = new Date(d)
    r.setUTCHours(0, 0, 0, 0)
    return r
  }
  const n = granularity === 'day' ? 30 : granularity === 'week' ? 12 : granularity === 'month' ? 12 : 6
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(now)
    const start = new Date(end)
    if (granularity === 'day') start.setUTCDate(end.getUTCDate() - i)
    else if (granularity === 'week') start.setUTCDate(end.getUTCDate() - i * 7)
    else if (granularity === 'month') start.setUTCMonth(end.getUTCMonth() - i)
    else start.setUTCFullYear(end.getUTCFullYear() - i)
    const key = start.toISOString().slice(0, 10)
    const label =
      granularity === 'day' ? key.slice(5) : granularity === 'week' ? `${key.slice(0, 7)} w${Math.ceil(start.getUTCDate() / 7)}` : granularity === 'month' ? key.slice(0, 7) : key.slice(0, 4)
    b.push({ key, label, start: startOf(start), end: new Date(end.getTime()) })
  }
  return b
}

export function reportsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/summary', async (c) => {
    const user = c.get('user')
    // S30 batch 3 (user request 2026-09-12, "make the data visible"): task analytics —
    //   · taskPrio: the priority MIX across every live task ("how much of my backlog
    //     is urgent?") — per tier {total, done}.
    //   · taskLabels: label distribution (top 12 by task usage, with done + fresh-30d
    //     counts — the "label trends over time" ask, counts-only per the vision).
    //   · sprintVel: the last 10 real sprints with DONE counts per priority tier —
    //     "which tier actually gets done per sprint" (no time tracking, ever).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const [byStatus, byType, totalHurdles, recents, taskPrio, taskLabels, sprintVel] = await Promise.all([
      cfg.db.query<{ status: string; n: number }>(
        'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL GROUP BY status',
        [user.id],
      ),
      cfg.db.query<{ type: string; n: number }>(
        'SELECT type, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL GROUP BY type',
        [user.id],
      ),
      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM hurdles WHERE project_id IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL)',
        [user.id],
      ),
      cfg.db.query<{ id: string; title: string; status: string }>(
        "SELECT id, title, status FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status IN ('operational', 'halted') ORDER BY updated_at DESC LIMIT 8",
        [user.id],
      ),
      cfg.db.query<{ priority: string; total: number; done: number }>(
        `SELECT priority, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
         FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL)
         GROUP BY priority`,
        [user.id],
      ),
      cfg.db.query<{ name: string; color: string; n: number; done: number; fresh: number }>(
        `SELECT tg.name, tg.color, COUNT(*) AS n,
           SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN t.created_at >= ? THEN 1 ELSE 0 END) AS fresh
         FROM dev_task_tags tt
         JOIN dev_tasks t ON t.id = tt.task_id
         JOIN projects p ON p.id = t.project_id AND p.user_id = ? AND p.deleted_at IS NULL
         JOIN tags tg ON tg.id = tt.tag_id
         GROUP BY tg.id ORDER BY n DESC, tg.name LIMIT 12`,
        [thirtyDaysAgo, user.id],
      ),
      cfg.db.query<{ id: string; name: string; project_id: string; project_title: string; started_at: string; ended_at: string | null; urgent: number; high: number; medium: number; low: number; done: number }>(
        `SELECT s.id, s.name, s.project_id, p.title AS project_title, s.started_at, s.ended_at,
           SUM(CASE WHEN t.priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
           SUM(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS high,
           SUM(CASE WHEN t.priority = 'medium' THEN 1 ELSE 0 END) AS medium,
           SUM(CASE WHEN t.priority = 'low' THEN 1 ELSE 0 END) AS low,
           COUNT(t.id) AS done
         FROM sprints s
         JOIN projects p ON p.id = s.project_id AND p.user_id = ? AND p.deleted_at IS NULL
         LEFT JOIN dev_tasks t ON t.sprint_id = s.id AND t.status = 'done'
         WHERE s.is_draft = 0
         GROUP BY s.id ORDER BY s.started_at DESC LIMIT 10`,
        [user.id],
      ),
    ])
    const status = { spark: 0, unreviewed: 0, investigating: 0, awaiting: 0, doing: 0, halted: 0, operational: 0 }
    for (const r of byStatus) if (r.status in status) status[r.status as keyof typeof status] = r.n
    const type = { personal: 0, client: 0 }
    for (const r of byType) type[r.type as keyof typeof type] = r.n
    // The Operational/Halted boxes moved here from the dashboard (user request 2026-08-21):
    // up to 4 recents per status, with links on the page.
    const recentsByStatus: Record<string, { id: string; title: string }[]> = { operational: [], halted: [] }
    for (const r of recents) {
      const list = recentsByStatus[r.status] ?? []
      if (list.length < 4) list.push({ id: r.id, title: r.title })
      recentsByStatus[r.status] = list
    }
    // S30 batch 3: the task analytics payload — normalized shapes for the reports page.
    const prio: Record<string, { total: number; done: number }> = { urgent: { total: 0, done: 0 }, high: { total: 0, done: 0 }, medium: { total: 0, done: 0 }, low: { total: 0, done: 0 } }
    for (const r of taskPrio) if (r.priority in prio) prio[r.priority] = { total: r.total, done: r.done ?? 0 }
    const tasksTotal = Object.values(prio).reduce((s, x) => s + x.total, 0)
    const tasksDone = Object.values(prio).reduce((s, x) => s + x.done, 0)
    const summary = {
      status, type, recents: recentsByStatus,
      totalProjects: byStatus.reduce((s, r) => s + r.n, 0), totalHurdles: totalHurdles[0]?.n ?? 0,
      tasks: { priority: prio, total: tasksTotal, done: tasksDone },
      labels: taskLabels.map((l) => ({ name: l.name, color: l.color, n: l.n, done: l.done ?? 0, fresh: l.fresh ?? 0 })),
      sprints: sprintVel.map((s) => ({ id: s.id, name: s.name, project_id: s.project_id, project_title: s.project_title, started_at: s.started_at, ended_at: s.ended_at, done: s.done, by: { urgent: s.urgent, high: s.high, medium: s.medium, low: s.low } })),
    }
    return await etag(c, c.json(summary))
  })

  app.get('/activity', async (c) => {
    const gran = granularitySchema.safeParse(c.req.query('granularity') ?? 'day')
    if (!gran.success) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const now = new Date()
    const b = buckets(gran.data)

    const [hurdles, created] = await Promise.all([
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(solved_at, 1, 10) AS bucket, COUNT(*) AS n FROM hurdles
         WHERE solved_at IS NOT NULL AND project_id IN (SELECT id FROM projects WHERE user_id = ?)
         GROUP BY bucket`,
        [user.id],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS n FROM projects WHERE user_id = ?
         GROUP BY bucket`,
        [user.id],
      ),
    ])
    const byHurdle = new Map(hurdles.map((r) => [r.bucket, r.n]))
    const byCreated = new Map(created.map((r) => [r.bucket, r.n]))
    const rows = b.map((bk) => ({
      key: bk.key,
      label: bk.label,
      hurdlesCompleted: byHurdle.get(bk.key) ?? 0,
      projectsCreated: byCreated.get(bk.key) ?? 0,
    }))
    return await etag(c, c.json({ granularity: gran.data, rows }))
  })

  // B3.6: calendar heatmap — last 91 days of activity. S52 widens the sources from
  // hurdles-solved + projects-created to the four real daily-work signals: hurdles
  // solved, projects created, to-dos completed, notes captured. The streak pills on
  // the reports page (S52) read the same rows, so a "day with activity" now means
  // ANY of the four — a fairer motivational metric for a personal productivity app.
  // To-do completion day is exact for both shapes: one-shot tasks stamp cleared_at
  // at check-off time (the Monday sweep only catches stragglers), recurring tasks
  // log every completion to sadhana_recur_history.completed_on. Un-completing a
  // one-shot clears cleared_at (it drops out again); a recurring un-check keeps its
  // history row — an acceptable over-count edge for a motivational stat.
  // Returns [{ date, hurdles, projects, todos, notes, total }] for the client to
  // render as a GitHub-style contribution grid + streak stats. Read-only, user_id-
  // scoped (rule 1), no schema change.
  app.get('/heatmap', async (c) => {
    const user = c.get('user')
    const days = 91
    const since = new Date(Date.now() - (days - 1) * 24 * 3600 * 1000)
    const sinceStr = since.toISOString().slice(0, 10)
    const [hurdles, created, todosOne, todosRec, notes] = await Promise.all([
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(solved_at, 1, 10) AS bucket, COUNT(*) AS n FROM hurdles
         WHERE solved_at IS NOT NULL AND solved_at >= ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)
         GROUP BY bucket`,
        [sinceStr, user.id],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS n FROM projects
         WHERE user_id = ? AND created_at >= ? AND deleted_at IS NULL
         GROUP BY bucket`,
        [user.id, sinceStr],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT cleared_at AS bucket, COUNT(*) AS n FROM sadhana_tasks
         WHERE user_id = ? AND done = 1 AND cleared_at IS NOT NULL AND deleted_at IS NULL AND cleared_at >= ?
         GROUP BY cleared_at`,
        [user.id, sinceStr],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT rh.completed_on AS bucket, COUNT(*) AS n FROM sadhana_recur_history rh
         JOIN sadhana_tasks st ON st.id = rh.task_id
         WHERE st.user_id = ? AND rh.completed_on >= ?
         GROUP BY rh.completed_on`,
        [user.id, sinceStr],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS n FROM quick_notes
         WHERE user_id = ? AND created_at >= ? AND deleted_at IS NULL
         GROUP BY bucket`,
        [user.id, sinceStr],
      ),
    ])
    const byHurdle = new Map(hurdles.map((r) => [r.bucket, r.n]))
    const byCreated = new Map(created.map((r) => [r.bucket, r.n]))
    const byTodo = new Map<string, number>()
    for (const r of [...todosOne, ...todosRec]) byTodo.set(r.bucket, (byTodo.get(r.bucket) ?? 0) + r.n)
    const byNote = new Map(notes.map((r) => [r.bucket, r.n]))
    const rows: { date: string; hurdles: number; projects: number; todos: number; notes: number; total: number }[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setUTCDate(since.getUTCDate() + i)
      const date = d.toISOString().slice(0, 10)
      const h = byHurdle.get(date) ?? 0
      const p = byCreated.get(date) ?? 0
      const t = byTodo.get(date) ?? 0
      const n = byNote.get(date) ?? 0
      rows.push({ date, hurdles: h, projects: p, todos: t, notes: n, total: h + p + t + n })
    }
    return await etag(c, c.json({ days, rows }))
  })

  return app
}