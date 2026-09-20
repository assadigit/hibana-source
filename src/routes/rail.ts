import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import type { Config, UserRow } from '../types'

// S88 — the navigation rail's SECONDARY PANEL (the VS Code Activity-Bar + Side-Bar
// pattern the owner specced): selecting a rail icon opens a list panel beside it,
// populated with that section's items under collapsible group headers. One endpoint
// serves every section in a single round trip — the panel flips between sections
// with zero additional latency, and the payload stays small (bounded lists, no
// content bodies, no excerpts).
//
// Shape (all lists user-scoped, soft-delete respected — Rule 1):
//   projects — live (non-spark, non-parked) rows: id/title/status/due_date
//   sparks   — the Ideas shelf: id/title
//   folders  — note_folders + live note counts
//   notes    — vault note cards: id/title/icon/folder_id/starred/updated_at
//   todos    — sadhana tasks (open first, dated first): id/title/done/due_date/quadrant
//
// Grouping (All / Ongoing / Done / Today / Folders…) happens client-side in
// nav.js — the same rows feed several sections' views. no-store: this is live
// navigation data, never an edge/browser cache candidate (the S72 nav lesson).
interface RailProject { id: string; title: string; status: string; due_date: string | null }
interface RailSpark { id: string; title: string }
interface RailFolder { id: string; name: string; icon: string | null; note_count: number }
interface RailNote { id: string; title: string; icon: string | null; folder_id: string | null; starred: 0 | 1; updated_at: string }
interface RailTodo { id: string; title: string; done: number; due_date: string | null; quadrant: number }

export function railRoutes(cfg: Config): Hono<{ Variables: { user: UserRow } }> {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    const [projects, sparks, folders, notes, todos] = await Promise.all([
      cfg.db.query<RailProject>(
        `SELECT id, title, status, due_date FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND status != 'spark'
           AND (archived_state IS NULL OR archived_state != 'offline')
         ORDER BY updated_at DESC LIMIT 40`,
        [user.id],
      ),
      cfg.db.query<RailSpark>(
        `SELECT id, title FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'spark'
         ORDER BY updated_at DESC LIMIT 30`,
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
         ORDER BY done ASC, (due_date IS NULL), due_date ASC, position ASC LIMIT 24`,
        [user.id],
      ),
    ])
    return c.json(
      { projects, sparks, folders, notes, todos },
      200,
      { 'Cache-Control': 'no-store' },
    )
  })

  return app
}
