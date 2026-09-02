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
    const changelogHits = await cfg.db.query<{ project_id: string; filename: string; uploaded_at: string; snippet: string }>(
      `SELECT c.project_id, c.filename, c.uploaded_at,
              snippet(changelogs_fts, 0, '[', ']', '…', 12) AS snippet
       FROM changelogs_fts f
       JOIN changelogs c ON c.rowid = f.rowid
       JOIN projects p ON p.id = c.project_id
       WHERE p.user_id = ? AND p.deleted_at IS NULL AND changelogs_fts MATCH ?
       ORDER BY c.uploaded_at DESC LIMIT 10`,
      [user.id, match],
    )

    if (c.req.header('HX-Request')) {
      const t = trFor(c)
      const lang = localeOf(c)
      const body = [
        ...projects.map(
          (p) => `<li class="row spread"><a href="/project.html?id=${p.id}">${esc(p.title)}</a> ${STATUS_BADGE(p.status, lang)} <span class="muted small">${timeAgo(p.updated_at, lang)}</span></li>`,
        ),
        ...changelogHits.map(
          (h) => `<li class="muted"><span class="badge badge-building">${t('changelog', 'تغییرات')}</span> ${esc(h.snippet)} <a href="/project.html?id=${h.project_id}">${t('→ project', '→ پروژه')}</a></li>`,
        ),
      ]
      return await etag(c, c.html(
        body.length
          ? `<ul class="search-results">${body.join('')}</ul>`
          : `<div class="empty">${t('No matches.', 'نتیجه‌ای نیست.')}</div>`,
      ))
    }
    return await etag(c, c.json({ projects, changelogHits }))
  })

  return app
}