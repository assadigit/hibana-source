import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { etag } from '../lib/http'
import type { Config, ProjectRow, UserRow } from '../types'
import type { SadhanaTask } from '../services/sadhana'
import type { QuickNote } from './quicknotes'

// Calendar view (Phase B4.1 + B4.5 locale-aware) — a month grid showing tasks + sadhana
// tasks by their existing due_date. Zero DB changes: pure read aggregation.
//
// The backend is calendar-system-agnostic: it accepts a Gregorian [start, end] date range
// and returns items keyed by Gregorian 'YYYY-MM-DD'. The frontend computes the range for
// whichever calendar system the user's locale selects (Gregorian for en, Hijri-Shamsi/Jalali
// for fa) and renders the grid in that calendar — the data-date keys stay Gregorian so the
// lookup is always correct even when a Jalali month spans two Gregorian months.

const rangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type CalendarItem = {
  date: string // Gregorian 'YYYY-MM-DD' (the storage key — never converted)
  kind: 'project' | 'task' | 'sadhana' | 'note'
  id: string
  title: string
  status?: string
  done?: boolean
  href: string
  sticky?: boolean // day-bound sticky note (colored chip; 0028)
  color?: string // sticky-note palette name for sticky day notes
}

export function calendarRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const q = rangeSchema.safeParse(c.req.query())
    if (!q.success) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const { start, end } = q.data

    // Sanity: start must be <= end. Reject ranges over 400 days (a calendar month is ≤ 31).
    if (start > end) return c.json({ error: 'invalid_input' }, 400)

    const [projects, tasks, sadhana, notes] = await Promise.all([
      cfg.db.query<ProjectRow>(
        `SELECT id, title, status, due_date FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?`,
        [user.id, start, end],
      ),
      cfg.db.query<{ id: string; project_id: string; title: string; done: 0 | 1; due_date: string }>(
        `SELECT t.id, t.project_id, t.title, t.done, t.due_date FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE p.user_id = ? AND p.deleted_at IS NULL AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?`,
        [user.id, start, end],
      ),
      cfg.db.query<SadhanaTask>(
        `SELECT id, title, done, due_date FROM sadhana_tasks
         WHERE user_id = ? AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?`,
        [user.id, start, end],
      ),
      // Day-bound quick notes (0028): sticky notes + plain day notes pinned to a date.
      cfg.db.query<QuickNote>(
        `SELECT id, kind, title, content, color, sticky, note_date FROM quick_notes
         WHERE user_id = ? AND deleted_at IS NULL AND note_date IS NOT NULL AND note_date >= ? AND note_date <= ?`,
        [user.id, start, end],
      ),
    ])

    const items: CalendarItem[] = [
      ...projects.map((p) => ({
        date: p.due_date!, kind: 'project' as const, id: p.id, title: p.title, status: p.status,
        href: `/project.html?id=${p.id}`,
      })),
      ...tasks.map((t) => ({
        date: t.due_date, kind: 'task' as const, id: t.id, title: t.title, done: t.done === 1,
        href: `/project.html?id=${t.project_id}`,
      })),
      ...sadhana.map((s) => ({
        date: s.due_date!, kind: 'sadhana' as const, id: s.id, title: s.title, done: s.done === 1,
        href: '/to-do-list',
      })),
      ...notes.map((n) => ({
        date: n.note_date!, kind: 'note' as const, id: n.id,
        title: (n.content || n.title || 'Note').replace(/\s+/g, ' ').slice(0, 80),
        sticky: n.sticky === 1,
        color: n.color,
        href: '/app', // the day detail opens notes inline; href is the notebook fallback
      })),
    ]

    const byDay: Record<string, CalendarItem[]> = {}
    for (const it of items) (byDay[it.date] ??= []).push(it)
    return await etag(c, c.json({ start, end, byDay }))
  })

  return app
}
