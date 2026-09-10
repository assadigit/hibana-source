import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { esc, etag } from '../lib/http'
import { STATUS_BADGE, timeAgo } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { searchSchema } from '../validation/schemas'
import type { Config, ProjectRow, UserRow } from '../types'

// FTS5-backed search (spec §5.3). Exact-match phrasing: the query is quoted, so a search
// for "star map" finds the phrase, not fuzzy variants. FTS5 is SQLite-only and isolated
// to this module + the migrations that create the virtual tables.
//
// 0040 (search depth, 2026-09-09): the index was widened from just `projects` to also
// cover quick_notes, backlog_docs (برنامه آتی), sadhana_tasks, and canvas_elements
// (text-bearing types only: note/comment/block). Ali is keyword-driven per vision.md,
// so every text surface must be searchable — this is the highest-leverage gap in the
// matrix. Each result group respects CLAUDE.md rule 1 (user_id filter) and the base
// table's soft-delete/tombstone, so search never leaks another user's rows and never
// surfaces deleted content. The htmx branch is unchanged (still a project list); the
// new groups are returned in the JSON body for the command palette (command-palette.js).

type NoteHit = { id: string; title: string; kind: string }
type BacklogHit = { id: string; doc_id: string; project_id: string; project_title: string; title: string }
type SadhanaHit = { id: string; title: string; quadrant: number }
type CanvasHit = { id: string; type: string; board: string }

export function searchRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const q = searchSchema.safeParse(c.req.query())
    if (!q.success) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const match = `"${q.data.q.replace(/"/g, '""')}"`

    const projects = await cfg.db.query<ProjectRow>(
      `SELECT p.* FROM projects_fts f
       JOIN projects p ON p.rowid = f.rowid
       WHERE p.user_id = ? AND p.deleted_at IS NULL AND projects_fts MATCH ?
       ORDER BY p.updated_at DESC LIMIT 20`,
      [user.id, match],
    )

    // 0040: quick_notes — title + content. Only live (non-deleted) notes surface. Lists
    // store their items as JSON; the content column is matched as plain text so the JSON
    // brackets/punctuation are part of the index, but FTS5 tokenizes on them so task text
    // still matches cleanly. The dashboard/notebook page is the deep link target.
    const notes = await cfg.db.query<NoteHit>(
      `SELECT n.id, n.title, n.kind FROM quick_notes_fts f
       JOIN quick_notes n ON n.rowid = f.rowid
       WHERE n.user_id = ? AND n.deleted_at IS NULL AND quick_notes_fts MATCH ?
       ORDER BY n.updated_at DESC LIMIT 20`,
      [user.id, match],
    )

    // 0040: backlog_docs — the «برنامه آتی» tab. No user_id on the table itself; rule 1 is
    // satisfied by joining through project_id → projects.user_id. A deleted project's
    // backlog docs are CASCADE-deleted (0033), so the projects.deleted_at filter is belt-
    // and-suspenders, not strictly required. Deep link → the project page's backlog tab.
    const backlog = await cfg.db.query<BacklogHit>(
      `SELECT d.id, d.project_id, d.title, p.title AS project_title
       FROM backlog_docs_fts f
       JOIN backlog_docs d ON d.rowid = f.rowid
       JOIN projects p ON p.id = d.project_id
       WHERE p.user_id = ? AND p.deleted_at IS NULL AND backlog_docs_fts MATCH ?
       ORDER BY d.updated_at DESC LIMIT 20`,
      [user.id, match],
    )

    // 0040: sadhana_tasks — title + the per-task note (the journal field). Only live tasks;
    // cleared/archived (cleared_at IS NOT NULL) stay searchable because they are still the
    // user's history — Ali may want to find an old recurring task. Deep link → to-do-list.
    const sadhana = await cfg.db.query<SadhanaHit>(
      `SELECT t.id, t.title, t.quadrant FROM sadhana_tasks_fts f
       JOIN sadhana_tasks t ON t.rowid = f.rowid
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND sadhana_tasks_fts MATCH ?
       ORDER BY t.updated_at DESC LIMIT 20`,
      [user.id, match],
    )

    // 0040: canvas_elements — text-bearing types only (note/comment/block). Strokes carry
    // point-path JSON, images/frames/shapes carry no prose; the type filter at query time
    // keeps them out of results even though the FTS index technically contains every row.
    // The `deleted` tombstone (0/1 integer, not deleted_at) filters soft-deleted elements.
    // Deep link → the canvas/whiteboard page; we don't auto-pan to the element (the user
    // opens the board and searches visually, which is the canvas's whole point).
    const canvas = await cfg.db.query<CanvasHit>(
      `SELECT e.id, e.type, e.board FROM canvas_elements_fts f
       JOIN canvas_elements e ON e.rowid = f.rowid
       WHERE e.user_id = ? AND e.deleted = 0 AND e.type IN ('note','comment','block')
         AND canvas_elements_fts MATCH ?
       ORDER BY e.updated_at DESC LIMIT 20`,
      [user.id, match],
    )
    // P2.5 (F-L15): removed the changelogs_fts query block — the changelogs feature was
    // removed (RECOVERED.md), the table carries no live data, and the FTS index returns
    // nothing. The dead query was a wasted DB round trip per search.

    if (c.req.header('HX-Request')) {
      const t = trFor(c)
      const lang = localeOf(c)
      const body = projects.map(
        (p) => `<li class="row spread"><a href="/project.html?id=${p.id}">${esc(p.title)}</a> ${STATUS_BADGE(p.status, lang)} <span class="muted small">${timeAgo(p.updated_at, lang)}</span></li>`,
      )
      return await etag(c, c.html(
        body.length
          ? `<ul class="search-results">${body.join('')}</ul>`
          : `<div class="empty">${t('No matches.', 'نتیجه‌ای نیست.')}</div>`,
      ))
    }
    return await etag(c, c.json({ projects, notes, backlog, sadhana, canvas }))
  })

  return app
}
