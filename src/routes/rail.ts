import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { parseQuadrantOrder } from '../services/sadhana'
import type { Config, UserRow } from '../types'

// S88 — the navigation rail's SECONDARY PANEL (the VS Code Activity-Bar + Side-Bar
// pattern the owner specced): selecting a rail icon opens a list panel beside it,
// populated with that section's items under collapsible group headers. One endpoint
// serves every section in a single round trip — the panel flips between sections
// with zero additional latency, and the payload stays small (bounded lists, no
// content bodies, no excerpts).
//
// Shape (all lists user-scoped, soft-delete respected — Rule 1):
//   projects    — live (non-spark, non-parked) rows: id/title/status/due_date
//   sparks      — the Ideas shelf: id/title/folder_id (S89: grouped under folders
//                 client-side, mirroring the Notes panel's shelf anatomy)
//   sparkFolders— the Ideas shelves themselves: id/name/icon (S89)
//   folders     — note_folders + live note counts
//   notes       — vault note cards: id/title/icon/folder_id/starred/updated_at
//   todos       — sadhana tasks (open first, dated first): id/title/done/due_date/quadrant
//   todoNames   — the user's RENAMED quadrant names + picked accent token (S89 groups
//                 tasks under their quadrant/box name; the S93 owner round tints the
//                 quadrant groups with the user's pastel color)
//   todoOrder   — the user's saved quadrant order, parsed server-side via the ONE
//                 canonical parser (parseQuadrantOrder — '1,3,2,4' → [1,3,2,4])
//   tasks       — S93 (owner round, item 15): project tasks carrying a due_date in the
//                 next 14 days (id/title/due_date/project_id) — the calendar panel's
//                 "planned work" list draws them beside project deadlines + to-dos
//                 (the same `tasks` source /api/calendar aggregates).
//
// Grouping (status groups / quadrants / folders…) happens client-side in
// nav.js — the same rows feed several sections' views. no-store: this is live
// navigation data, never an edge/browser cache candidate (the S72 nav lesson).
interface RailProject { id: string; title: string; status: string; due_date: string | null }
interface RailSpark { id: string; title: string; folder_id: string | null }
interface RailSparkFolder { id: string; name: string; icon: string | null }
interface RailFolder { id: string; name: string; icon: string | null; note_count: number }
interface RailNote { id: string; title: string; icon: string | null; folder_id: string | null; starred: 0 | 1; updated_at: string }
interface RailTodo { id: string; title: string; done: number; due_date: string | null; quadrant: number }
interface RailTodoName { quadrant: number; name: string; accent_color: string | null }
interface RailTask { id: string; title: string; due_date: string; project_id: string }

export function railRoutes(cfg: Config): Hono<{ Variables: { user: UserRow } }> {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    const [projects, sparks, sparkFolders, folders, notes, todos, todoNames, tasks] = await Promise.all([
      cfg.db.query<RailProject>(
        `SELECT id, title, status, due_date FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND status != 'spark'
           AND (archived_state IS NULL OR archived_state != 'offline')
         ORDER BY updated_at DESC LIMIT 40`,
        [user.id],
      ),
      cfg.db.query<RailSpark>(
        `SELECT id, title, folder_id FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'spark'
         ORDER BY updated_at DESC LIMIT 60`,
        [user.id],
      ),
      cfg.db.query<RailSparkFolder>(
        `SELECT id, name, icon FROM spark_folders WHERE user_id = ?
         ORDER BY sort_order, name COLLATE NOCASE`,
        [user.id],
      ),
      cfg.db.query<RailFolder>(
        `SELECT f.id, f.name, f.icon,
                (SELECT COUNT(*) FROM vault_notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL) AS note_count
         FROM note_folders f WHERE f.user_id = ?
         ORDER BY f.sort_order, f.name COLLATE NOCASE`,
        [user.id],
      ),
      cfg.db.query<RailNote>(
        `SELECT id, title, icon, folder_id, starred, updated_at FROM vault_notes
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 40`,
        [user.id],
      ),
      cfg.db.query<RailTodo>(
        `SELECT id, title, done, due_date, quadrant FROM sadhana_tasks
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY done ASC, (due_date IS NULL), due_date ASC, position ASC LIMIT 60`,
        [user.id],
      ),
      cfg.db.query<RailTodoName>(
        'SELECT quadrant, name, accent_color FROM sadhana_quadrant_names WHERE user_id = ?',
        [user.id],
      ),
      cfg.db.query<RailTask>(
        `SELECT t.id, t.title, t.due_date, t.project_id FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE p.user_id = ? AND p.deleted_at IS NULL
           AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?
         ORDER BY t.due_date ASC LIMIT 15`,
        [user.id, today, in14],
      ),
    ])
    return c.json(
      {
        projects,
        sparks,
        sparkFolders,
        folders,
        notes,
        todos,
        todoNames,
        todoOrder: parseQuadrantOrder(user.sadhana_quadrant_order),
        tasks,
      },
      200,
      { 'Cache-Control': 'no-store' },
    )
  })

  return app
}
