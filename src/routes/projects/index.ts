// Projects routes — extracted from projects.ts Phase 4.
// CRUD + detail render + dev tasks + tags + logo (17 routes total).
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../auth/middleware'
import { esc, etag, jsonBody, extForMime, mimeForPath } from '../../lib/http'
import { html } from '../../lib/htmlx'
import { trFor, localeOf, trL, type Locale } from '../../lib/i18n'
import { faDigits, toJalali } from '../../lib/jalali'
import { personalProgress, clientProgress } from '../../services/progress'
import { githubClient, type GitHubConfig } from '../../services/github'
import { hitRateLimit, RATE_RULES, clientIp } from '../../services/ratelimit'
import { uuid } from '../../lib/ids'
import { PROJECT_STAGES, STATUS_ORDER } from '../../types'
import type { Config, ProjectRow, UserRow } from '../../types'
import { toastHtml, getOwnedProject, STATUS_LABEL, icon, STATUS_BADGE } from '../../lib/html'
import { noteSchema, reorderSchema, sparkFolderSchema, updateProjectSchema, createProjectSchema, listProjectsSchema } from '../../validation/schemas'
import type { HurdleRow, TagRow, ProjectStatus, SparkFolderRow } from '../../types'
import { loadProjectProgress } from './helpers'
import type { ProjectSignals } from './helpers'
import {
  loadTags, loadProjectSignals, projectProgress,
  bugBubbleHtml, signalsHtml, backlogMetaHtml,
  cardHtml, listFragment, glanceStrip,
  sparkEmptyHtml, sparkKanbanHtml, sparkFolderBar, sparkFolderGrid,
} from './helpers'
import { loadDetail, detailHtml } from './detail-helpers'
export function projectsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const query = listProjectsSchema.safeParse(c.req.query())
    const view = query.success ? query.data.view : 'cards'
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    const conds = ['deleted_at IS NULL', 'user_id = ?']
    const params: unknown[] = [user.id]
    if (query.success && query.data.status) {
      conds.push('status = ?')
      params.push(query.data.status)
    } else {
      // Sparks live on their own shelf (the Ideas page) — every other view excludes them.
      conds.push("status != 'spark'")
    }
    if (query.success && query.data.tag) {
      conds.push(
        'id IN (SELECT pt.project_id FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.id = ? AND t.user_id = ?)',
      )
      params.push(query.data.tag, user.id)
    }
    if (query.success && query.data.q) {
      const match = `"${query.data.q.replace(/"/g, '""')}"`
      conds.push('rowid IN (SELECT rowid FROM projects_fts WHERE projects_fts MATCH ?)')
      params.push(match)
    }
    const folderParam = query.success ? query.data.folder : undefined
    if (folderParam && folderParam !== 'all' && query.success && query.data.status === 'spark') {
      // Session 28 (user report: "نمایش همه ایده‌ها — the ideas don't appear"): 'all'
      // used to fall into the else branch and filter `folder_id = 'all'` — a literal
      // that matches nothing (ids are UUIDs) — so the shelf came back EMPTY and the
      // grid branch rendered the folder grid again. 'all' now skips the filter entirely.
      if (folderParam === 'none') conds.push('folder_id IS NULL')
      else {
        conds.push('folder_id = ?')
        params.push(folderParam)
      }
    }
    const projects = await cfg.db.query<ProjectRow>(
      `SELECT * FROM projects WHERE ${conds.join(' AND ')} ORDER BY status, sort_order, updated_at DESC`,
      params,
    )
    const tagsMap = await loadTags(cfg, user.id)
    if (c.req.header('HX-Request')) {
      const activeStatus = query.success ? query.data.status : undefined
      if (view === 'grid') {
        const countRows = await cfg.db.query<{ status: string; n: number }>(
          'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status != ? GROUP BY status',
          [user.id, 'spark'],
        )
        const counts = new Map<string, number>(countRows.map((r) => [r.status, r.n]))
        return await etag(c, c.html(glanceStrip(counts, activeStatus, lang, true)))
      }
      // P-signals: batch-load per-project signal counts (bugs, ideas, backlog, hurdles)
      const signalsMap = await loadProjectSignals(cfg, user.id, projects.map((p) => p.id))
      // S29 (agenda 5): batched progress per project — powers the kanban color weights.
      const progressMap = await loadProjectProgress(cfg, projects)
      let fragment = listFragment(projects, tagsMap, view, lang, signalsMap, activeStatus, progressMap)
      if (c.req.query('view') !== undefined && activeStatus !== 'spark') {
        const countRows = await cfg.db.query<{ status: string; n: number }>(
          'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status != ? GROUP BY status',
          [user.id, 'spark'],
        )
        const counts = new Map<string, number>(countRows.map((r) => [r.status, r.n]))
        if (countRows.some((r) => r.n > 0)) fragment = glanceStrip(counts, activeStatus, lang) + fragment
      }
      if (activeStatus === 'spark') {
        const folderRows = await cfg.db.query<SparkFolderRow & { n: number }>(
          `SELECT f.id, f.name, (SELECT COUNT(*) FROM projects p WHERE p.folder_id = f.id AND p.user_id = ? AND p.deleted_at IS NULL AND p.status = 'spark') AS n
           FROM spark_folders f WHERE f.user_id = ? ORDER BY f.sort_order, f.created_at`,
          [user.id, user.id],
        )
        const unfiledRows = await cfg.db.query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status = 'spark' AND folder_id IS NULL",
          [user.id],
        )
        if (projects.length === 0) {
          fragment = sparkFolderGrid(folderRows, unfiledRows[0]?.n ?? 0, lang)
        } else if (view === 'kanban') {
          fragment = sparkKanbanHtml(projects, folderRows, lang)
        } else if (!folderParam || folderParam === 'all') {
          // No folder param OR 'all' explicitly — show the folder grid (file-manager view)
          // UNLESS the user explicitly clicked "All ideas" (folder=all), in which case
          // we skip the grid and show the flat idea list with a breadcrumb bar.
          if (folderParam === 'all') {
            fragment = sparkFolderBar(folderRows, unfiledRows[0]?.n ?? 0, 'all', lang) + fragment
          } else {
            fragment = sparkFolderGrid(folderRows, unfiledRows[0]?.n ?? 0, lang)
          }
        } else {
          // A folder IS selected — show the breadcrumb back + the filtered idea list
          fragment = sparkFolderBar(folderRows, unfiledRows[0]?.n ?? 0, folderParam, lang) + fragment
        }
      }
      return await etag(c, c.html(fragment))
    }
    return await etag(c, c.json({ projects: projects.map((p) => ({ ...p, tags: tagsMap.get(p.id) ?? [] })) }))
  })

  app.post('/', async (c) => {
    const body = await jsonBody<z.infer<typeof createProjectSchema>>(c, createProjectSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const now = new Date().toISOString()
    const id = body.id ?? uuid()
    // Offline replay safety: a quick-add whose id already landed (response lost on a blip)
    // must not 500 on the primary key — the queue would retry it forever and the
    // “unsynced changes” badge would never clear. Same user + same id = already synced.
    const existing = await cfg.db.query<{ id: string; user_id: string }>('SELECT id, user_id FROM projects WHERE id = ?', [id])
    if (existing.length > 0) {
      if (existing[0].user_id === user.id) return c.json({ ok: true, duplicate: true }, 200)
      return c.json({ error: 'id_conflict' }, 409) // UUID collision across users — never 500
    }
    // Session 28 (user request: capture INTO the open folder): a spark born on the Ideas
    // page while a folder is open files itself there. Mirrors the PATCH path's ownership
    // check — the FK alone can't scope users — and only applies while the record is a
    // spark (a promoted/created project ignores the folder entirely).
    let folderId: string | null = null
    if (body.folder_id && body.status === 'spark') {
      const folderRow = await cfg.db.query<{ id: string }>(
        'SELECT id FROM spark_folders WHERE id = ? AND user_id = ?',
        [body.folder_id, user.id],
      )
      if (folderRow.length > 0) folderId = folderRow[0].id
    }
    await cfg.db.execute(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, client_name, due_date, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?, ?)`,
      [id, user.id, body.title, body.description, body.type, body.status, body.reminders_enabled ?? 0, body.client_name ?? null, body.due_date ?? null, folderId, now, now],
    )
    // Optional tags on create (quick-add modal, spec §5.5): find-or-create per user, then link.
    // H1 fix (2026-09-10): resolve tag IDs atomically via INSERT ... ON CONFLICT ... RETURNING
    // BEFORE the transaction. The old read-then-write pattern (SELECT inside the transaction)
    // raced on concurrent same-name tag creation — both requests saw no existing tag, both
    // tried INSERT, and the UNIQUE(user_id, name) violation rolled back the whole batch.
    if (body.tags && body.tags.length > 0) {
      const tagIds: string[] = []
      for (const t of body.tags ?? []) {
        const name = t.name.trim()
        if (!name) continue
        const rows = await cfg.db.query<{ id: string }>(
          `INSERT INTO tags (id, user_id, name, color, usage_count, created_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
           RETURNING id`,
          [uuid(), user.id, name, t.color ?? '#f6d365', now],
        )
        if (rows[0]) tagIds.push(rows[0].id)
      }
      await cfg.db.transaction(async (tx) => {
        for (const tagId of tagIds) {
          tx.sql('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [id, tagId])
        }
      })
    }
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', `/project.html?id=${id}`)
      return c.html('')
    }
    return c.json({ ok: true, id }, 201)
  })

  app.post('/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    // Reorder is always within a single status group (rule 1 + status coherence): an id of
    // another status (or another user's) is simply never updated.
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = ?', [
          i, new Date().toISOString(), id, user.id, body.status,
        ])
      })
    })
    if (c.req.header('HX-Request')) return c.html('')
    return c.json({ ok: true })
  })

  app.get('/sparks/folders', async (c) => {
    const user = c.get('user')
    const folders = await cfg.db.query<SparkFolderRow & { n: number }>(
      `SELECT f.id, f.name, f.sort_order, f.created_at,
              (SELECT COUNT(*) FROM projects p WHERE p.folder_id = f.id AND p.user_id = ? AND p.deleted_at IS NULL AND p.status = 'spark') AS n
       FROM spark_folders f WHERE f.user_id = ? ORDER BY f.sort_order, f.created_at`,
      [user.id, user.id],
    )
    return c.json({ folders })
  })

  app.post('/sparks/folders', async (c) => {
    const body = await jsonBody<z.infer<typeof sparkFolderSchema>>(c, sparkFolderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const now = new Date().toISOString()
    const id = uuid()
    const max = await cfg.db.query<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM spark_folders WHERE user_id = ?', [user.id])
    await cfg.db.execute(
      'INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, user.id, body.name, (max[0]?.m ?? -1) + 1, now],
    )
    return c.json({ folder: { id, name: body.name, n: 0 } }, 201)
  })

  app.patch('/sparks/folders/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof sparkFolderSchema>>(c, sparkFolderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const res = await cfg.db.execute('UPDATE spark_folders SET name = ? WHERE id = ? AND user_id = ?', [
      body.name, c.req.param('id'), user.id,
    ])
    if (!res.changes) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  })

  app.delete('/sparks/folders/:id', async (c) => {
    const user = c.get('user')
    const folder = await cfg.db.query<{ id: string; name: string }>('SELECT id, name FROM spark_folders WHERE id = ? AND user_id = ?', [
      c.req.param('id'), user.id,
    ])
    if (!folder.length) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM spark_folders WHERE id = ? AND user_id = ?', [folder[0].id, user.id])
    return c.json({ ok: true })
  })

  app.get('/duplicate-check', async (c) => {
    // Soft warning (spec §5.3): near-duplicate titles are flagged, never blocked.
    const user = c.get('user')
    const title = z.string().min(1).max(200).safeParse(c.req.query('title'))
    if (!title.success) return c.json({ error: 'invalid_input' }, 400)
    const rows = await cfg.db.query<{ id: string; title: string }>(
      'SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL AND lower(title) = lower(?)',
      [user.id, title.data],
    )
    return c.json({ duplicate: rows.length > 0, existing: rows[0] ?? null })
  })

  app.get('/:id', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const d = await loadDetail(cfg, p)
    if (c.req.header('HX-Request')) return await etag(c, c.html(detailHtml(p, d, lang)))
    return await etag(c, c.json({ project: { ...p, ...d } }))
  })

  app.patch('/:id', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const body = await jsonBody<z.infer<typeof updateProjectSchema>>(c, updateProjectSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    // batch (s) — folder_id only rides along while the project stays a spark: a folder
    // reference on a non-spark project is meaningless, so it is dropped; a non-null move
    // must point at one of the user's own folders.
    if (body.folder_id !== undefined) {
      const staysSpark = p.status === 'spark' || body.status === 'spark'
      if (!staysSpark) delete body.folder_id
      else if (body.folder_id !== null) {
        const own = await cfg.db.query<{ id: string }>('SELECT id FROM spark_folders WHERE id = ? AND user_id = ?', [
          body.folder_id, user.id,
        ])
        if (!own.length) return c.json({ error: 'folder_not_found' }, 404)
      }
    }
    const now = new Date().toISOString()
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`)
      params.push(v === undefined ? null : v)
    }
    sets.push('updated_at = ?')
    params.push(now)
    params.push(p.id, user.id)
    await cfg.db.execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
    if (body.status && body.status !== p.status) {
      await cfg.db.execute(
        'INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)',
        [uuid(), p.id, `Status → ${STATUS_LABEL[body.status]}`, now],
      )
    }
    if (body.latest_note !== undefined && body.latest_note !== p.latest_note) {
      await cfg.db.execute(
        'INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)',
        [uuid(), p.id, body.latest_note, now],
      )
    }
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Saved', 'ذخیره شد'), lang))
    return c.json({ ok: true })
  })

  app.delete('/:id', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const canHardDelete = p.status === 'spark' || p.status === 'unreviewed'
    const force = c.req.query('force') === '1'
    if (canHardDelete && force) {
      // Hard delete allowed only for Spark/Unreviewed that were force-confirmed (spec §4.15).
      await cfg.db.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', [p.id, user.id])
    } else {
      // Soft delete — undo-toast stays honest for 7 days (Q2 decision), then the cron purges.
      await cfg.db.execute('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
        new Date().toISOString(), new Date().toISOString(), p.id, user.id,
      ])
    }
    if (c.req.header('HX-Request')) {
      return c.html(toastHtml(t('Deleted "{title}".', '«{title}» حذف شد', { title: p.title }), lang, canHardDelete && force ? undefined : `/api/projects/${p.id}/restore`))
    }
    return c.json({ ok: true, soft: !(canHardDelete && force) })
  })

  app.post('/:id/restore', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    await cfg.db.execute('UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      new Date().toISOString(), c.req.param('id'), user.id,
    ])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Restored', 'بازگردانی شد'), lang))
    return c.json({ ok: true })
  })

  app.post('/:id/revive', async (c) => {
    // Halted revive (spec §5.6): asks every time which status fits — never assumes.
    const body = await jsonBody<{ status: 'unreviewed' | 'investigating' | 'awaiting' | 'doing' | 'operational' }>(c, z.object({ status: z.enum(['unreviewed', 'investigating', 'awaiting', 'doing', 'operational']) }))
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p || p.status !== 'halted') return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE projects SET status = ?, archived_state = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      body.status, now, p.id, user.id,
    ])
    await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
      uuid(), p.id, `Revived → ${STATUS_LABEL[body.status]}`, now,
    ])
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', `/project.html?id=${p.id}`)
      return c.html('')
    }
    return c.json({ ok: true })
  })

  app.post('/:id/note', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const body = await jsonBody<z.infer<typeof noteSchema>>(c, noteSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    // L2 fix (2026-09-10): add AND user_id = ? as belt-and-suspenders defense-in-depth.
    // The project p was pre-validated via getOwnedProject, but rule #1 says every user-owned
    // query should filter on user_id — consistency closes the "what if the pre-check regresses" gap.
    await cfg.db.execute('UPDATE projects SET latest_note = ?, updated_at = ? WHERE id = ? AND user_id = ?', [body.note, now, p.id, p.user_id])
    // Autosave can fire many times with the same text — only log a history entry when the
    // note actually changed, so the trail stays meaningful (user request: save as you type).
    if (body.note !== p.latest_note) {
      await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
        uuid(), p.id, body.note, now,
      ])
    }
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Note saved', 'یادداشت ذخیره شد'), lang))
    return c.json({ ok: true })
  })

  // --- Project logo upload (user request 2026-09) ---
  // Same pattern as user avatars: base64 PNG/JPEG → GitHub assets repo → logo_path on
  // the projects row. Served via GET /api/projects/:id/logo/file.
  const logoUploadSchema = z.object({
    dataBase64: z.string().min(1).max(3_500_000),
    mimeType: z.string().regex(/^image\/(png|jpeg|webp)$/),
  })
  app.put('/:id/logo', async (c) => {
    // T2 (SWOT Session 26): wire the upload rate limiter — logo uploads push bytes
    // into the GitHub assets repo, same as avatar uploads. 30 req/60s per IP.
    if (await hitRateLimit(cfg.db, RATE_RULES.upload, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many uploads — wait a minute and try again.' }, 429)
    }
    const body = await jsonBody<z.infer<typeof logoUploadSchema>>(c, logoUploadSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    if (!cfg.github.token) return c.json({ error: 'github_not_configured' }, 503)
    const gh = githubClient(cfg.github as GitHubConfig)
    const path = `project-logos/${p.id}/logo-${Date.now()}-${uuid().slice(0, 8)}${extForMime(body.mimeType)}`
    // Remove the old logo if there was one
    if (p.logo_path) {
      try { await gh.deleteFile(p.logo_path) } catch { /* old logo may be gone */ }
    }
    await gh.pushFile(path, body.dataBase64, `Hibana project logo: ${p.title}`)
    await cfg.db.execute('UPDATE projects SET logo_path = ?, updated_at = ? WHERE id = ?', [path, new Date().toISOString(), p.id])
    return c.json({ ok: true, path })
  })


  // Serve the logo bytes (rule 7: raw Accept header for files over 1MB).
  app.get('/:id/logo/file', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p?.logo_path) return c.json({ error: 'not_found' }, 404)
    if (!cfg.github.token) return c.json({ error: 'github_not_configured' }, 503)
    const gh = githubClient(cfg.github as GitHubConfig)
    const bytes = await gh.readBinary(p.logo_path)
    if (!bytes) return c.json({ error: 'not_found' }, 404)
    return new Response(bytes, { headers: { 'Content-Type': mimeForPath(p.logo_path), 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=604800' } })
  })

  // Remove the logo
  app.delete('/:id/logo', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    if (p.logo_path && cfg.github.token) {
      const gh = githubClient(cfg.github as GitHubConfig)
      try { await gh.deleteFile(p.logo_path) } catch { /* may be gone */ }
    }
    await cfg.db.execute('UPDATE projects SET logo_path = NULL, updated_at = ? WHERE id = ?', [new Date().toISOString(), p.id])
    return c.json({ ok: true })
  })

  return app
}
