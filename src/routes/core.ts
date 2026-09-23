import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody } from '../lib/http'
import { getOwnedProject, icon, toastHtml } from '../lib/html'
import { localeOf, trFor, trL, type Locale } from '../lib/i18n'
import { uuid } from '../lib/ids'
import { shotStoreFor } from '../services/shotstore'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import {
  createHurdleSchema,
  hurdleReorderSchema,
  updateHurdleSchema,
  createLinkSchema,
  updateLinkSchema,
  uploadScreenshotSchema,
} from '../validation/schemas'
import type { Config, HurdleRow, LinkRow, ScreenshotRow, UserRow } from '../types'

// One app for every route that lives at the root ('/'). Hono does not chain multiple
// sub-apps mounted at the same path (the first one returns its own 404), so everything
// root-mounted shares a single Hono instance. Full paths make the URL scheme explicit.

/** The five progress boxes a shot can be STUCK to (0054). Kept in lockstep with the
 *  COLS map in routes/projects/detail-helpers.ts — the SAME board the user sees. */
const SHOT_BOX: Record<string, [string, string]> = {
  idea: ['New Ideas', 'ایده‌های جدید'],
  bug: ['Problems', 'مشکلات'],
  planned: ['Plans', 'برنامه‌ها'],
  in_progress: ['In Progress', 'در حال انجام'],
  done: ['Done', 'انجام‌شده'],
}

/** Shared screenshot grid (Batch (p)): the project page's Screenshots tab and the
 *  HX screenshots endpoint render the same figures, so an uploaded shot appears in
 *  both after one swap.
 *  S35 (user request 2026-09): each shot is a UI/UX PROBLEM REPORT — image + note
 *  (caption) + open/fixed state. Clicking the image opens the lightbox; the note
 *  edits inline (client swaps the figcaption into a form); the resolve toggle PATCHes
 *  {resolved}; delete asks first. Bidi law: the note is dir="auto" + plaintext.
 *  S39 (user request 2026-09-13): the note is CLICK-TO-EDIT (the whole note area opens
 *  the form — the tiny pencil alone was undiscoverable, which read as "you can't add
 *  a note"), and each shot can be STUCK to a progress-box item: a pin button opens the
 *  task picker (project-page.js) and the pin line shows WHERE it lives — box + task
 *  title — with a one-click unpin. tasks: the id → {title, status} map of the project's
 *  dev_tasks (only pinned ids are needed; callers may pass a superset). */
/** S86 (0059): a doc upload's display name — the stored filename column, falling back
 *  to the stored-path basename (legacy image rows never hit this path). */
export function shotDisplayName(s: ScreenshotRow): string {
  if (s.filename && s.filename.trim()) return s.filename.trim()
  const base = (s.github_path || '').split('/').pop() || ''
  return base.replace(/^[0-9a-f-]{36}-/i, '') || 'file'
}

/** S86: doc uploads (PDF/CSV/XLSX/DOCX/MD/TXT) render a FILE tile, not an image —
 *  an extension badge + the name + a download affordance. Kept next to
 *  shotsGridHtml so every surface (grid + HX endpoint) speaks the same shape. */
export function shotFileTileHtml(s: ScreenshotRow, lang: Locale): string {
  const name = shotDisplayName(s)
  const ext = (name.split('.').pop() || '').toUpperCase().slice(0, 5) || 'FILE'
  return `<a class="shot-file" href="/api/media/screenshots/${s.id}/file" download aria-label="${trL(lang, 'Download {f}', 'دانلود {f}', { f: name })}" title="${trL(lang, 'Download {f}', 'دانلود {f}', { f: name })}">
        <span class="shot-file-ext" aria-hidden="true">${esc(ext)}</span>
        <span class="shot-file-name" dir="auto">${esc(name)}</span>
        <span class="shot-file-dl" aria-hidden="true">${icon('download')}</span>
      </a>`
}

export function shotsGridHtml(
  shots: ScreenshotRow[],
  lang: Locale,
  tasks: Map<string, { title: string; status: string }> = new Map(),
): string {
  return shots
    .map((s) => {
      // S115: a video (webm screen recording) is MEDIA, not a file tile — it renders
      // an inline <video> with native controls; preload="metadata" keeps a big grid
      // cheap (frames fetch on demand, bytes stay in KV until deleted).
      const isImage = String(s.mime_type || '').startsWith('image/')
      const isVideo = String(s.mime_type || '').startsWith('video/')
      return `<figure class="shot shot-card${s.resolved ? ' is-fixed' : ''}${isVideo ? ' is-video' : isImage ? '' : ' is-file'}" data-shot="${s.id}" data-resolved="${s.resolved ? '1' : '0'}"${s.task_id ? ` data-task="${s.task_id}"` : ''}>
        ${isImage
          ? `<button type="button" class="shot-img-btn" data-shot-zoom="${s.id}" aria-label="${trL(lang, 'View screenshot', 'دیدن اسکرین‌شات')}">
          <img src="/api/media/screenshots/${s.id}/file" alt="${esc(s.caption)}" loading="lazy">
        </button>`
          : isVideo
          ? `<video class="shot-video" src="/api/media/screenshots/${s.id}/file" controls preload="metadata" playsinline></video>`
          : shotFileTileHtml(s, lang)}
        <figcaption class="shot-body">
          ${s.task_id && tasks.get(s.task_id) ? (() => {
            const t = tasks.get(s.task_id)!
            const box = SHOT_BOX[t.status] ?? SHOT_BOX.idea
            const fullTitle = String(t.title || '').split('\n')[0]
            return `<div class="row spread shot-pin" dir="auto">
              <span class="row shot-pin-text" style="gap:0.25rem" title="${esc(fullTitle)}">${icon('pin')} <b>${trL(lang, box[0], box[1])}</b> · <span class="shot-pin-task">${esc(t.title)}</span></span>
              <button type="button" class="ghost small danger shot-unpin" data-shot-unpin="${s.id}" title="${trL(lang, 'Unpin — keep the picture, just detach it', 'برداشتن سنجاق — تصویر می‌ماند، فقط جدا می‌شود')}" aria-label="${trL(lang, 'Unpin', 'برداشتن سنجاق')}">${icon('x')}</button>
            </div>`
          })() : ''}
          <p class="shot-note muted small" dir="auto" data-shot-note-edit title="${trL(lang, 'Click to write the note — what & where to work', 'برای نوشتن یادداشت کلیک کن — چه چیزی و کجا')}" role="button" tabindex="0">${esc(s.caption) || '<span class="shot-note-empty">' + trL(lang, 'Add a note — what & where to work…', 'یادداشت اضافه کن — چه چیزی و کجا…') + '</span>'}</p>
          <div class="row spread shot-actions">
            <span class="shot-state${s.resolved ? ' is-fixed' : ''}" data-shot-state>${s.resolved ? '✓ ' + trL(lang, 'fixed', 'درست شد') : trL(lang, 'open problem', 'باز')}${''}</span>
            <!-- S107 (owner: "the settings like delete edit etc can be hidden under a
                 setting '...' menu for each uploaded picture"): the four inline icon
                 buttons (pin / note / toggle / delete) cluttered every tile — they now
                 live in the app's standard .spark-menu kebab popover (same pattern as
                 pd-task / kanban / note cards). The menu items keep the EXACT data-*
                 attributes the delegated project-page.js handler already speaks, so
                 the wiring is unchanged — only the affordance moved. -->
            <div class="spark-menu shot-menu">
              <button type="button" data-shot-menu data-menu-open aria-haspopup="true" aria-label="${trL(lang, 'More actions', 'کارهای بیشتر')}" title="${trL(lang, 'More actions', 'کارهای بیشتر')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg></button>
              <div class="spark-menu-pop" role="menu" hidden>
                <button type="button" role="menuitem" data-shot-pin="${s.id}" title="${trL(lang, 'Stick this picture to a progress-box item (e.g. the Problems box)', 'این تصویر را به یک قلم جعبهٔ پیشرفت سنجاق کن (مثلاً جعبهٔ مشکلات)')}">${icon('pin')} <span>${trL(lang, 'Pin to a task', 'سنجاق به یک کار')}</span></button>
                <button type="button" role="menuitem" data-shot-note="${s.id}" title="${trL(lang, 'Edit note', 'ویرایش یادداشت')}">${icon('pencil')} <span>${trL(lang, 'Edit note', 'ویرایش یادداشت')}</span></button>
                <button type="button" role="menuitem" data-shot-toggle="${s.id}" title="${s.resolved ? trL(lang, 'Mark as open again', 'بازگشتی به باز') : trL(lang, 'Mark as fixed', 'علامت درست‌شد')}">${s.resolved
                  ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>'
                  : icon('check')} <span>${s.resolved ? trL(lang, 'Mark as open again', 'بازگشتی به باز') : trL(lang, 'Mark as fixed', 'علامت درست‌شد')}</span></button>
                <button type="button" role="menuitem" class="danger" data-shot-del="${s.id}" title="${trL(lang, 'Delete', 'حذف')}">${icon('trash')} <span>${trL(lang, 'Delete', 'حذف')}</span></button>
              </div>
            </div>
          </div>
        </figcaption>
      </figure>`
    })
    .join('') || `<div class="empty-state empty"><span class="empty-state-icon" aria-hidden="true">${icon('image')}</span><p class="empty-state-title">${trL(lang, 'No files yet', 'هنوز فایلی نیست')}</p><p class="empty-state-text">${trL(lang, 'Snap the broken UI/UX, drop it here, write what & where — so you know exactly what to work on.', 'از UI/UX خراب عکس بگیر، همین‌جا رها کن و بنویس چه چیزی و کجاست — تا دقیقاً بدانی روی چه کار کنی.')}</p></div>`
}

/** The task map for pinned shots in ONE project (S39): id → {title, status} for every
 *  task a shot is stuck to, so the pin line can say WHICH box + item. */
export async function shotTaskMap(
  cfg: Config,
  shots: ScreenshotRow[],
): Promise<Map<string, { title: string; status: string }>> {
  const ids = [...new Set(shots.map((s) => s.task_id).filter((x): x is string => !!x))]
  const map = new Map<string, { title: string; status: string }>()
  if (!ids.length) return map
  const rows = await cfg.db.query<{ id: string; title: string; status: string }>(
    `SELECT id, title, status FROM dev_tasks WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )
  for (const r of rows) map.set(r.id, { title: r.title, status: r.status })
  return map
}

/** Scoped child lookup: row must belong to a project that belongs to the user (rule 1). */
// Phase 0 hardening: the table name is interpolated into SQL, so it MUST come from a fixed
// allowlist — never a caller-supplied string. Unknown tables throw (defensive fail-closed),
// which keeps this query-injection-shaped pattern from ever becoming a real vector.
const CHILD_TABLES = new Set(['hurdles', 'links', 'screenshots'])
function assertChildTable(table: string): void {
  if (!CHILD_TABLES.has(table)) throw new Error(`blocked child-table lookup: ${table}`)
}

async function ownedProjectId(cfg: Config, userId: string, table: string, recordId: string): Promise<string | null> {
  assertChildTable(table)
  const rows = await cfg.db.query<{ project_id: string }>(
    `SELECT project_id FROM ${table} WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL)`,
    [recordId, userId],
  )
  return rows.length ? rows[0].project_id : null
}

export function coreRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // Session-9 F1 (2026-09-14): NO leading slash. The GitHub Contents API 422s on
  // `path cannot start with a slash` — the historic `/${user}/…` shape broke EVERY
  // screenshot upload (500 internal_error) and the feature never worked in prod
  // (0 rows ever, 0 error_log entries — it was unreachable in the UI's eyes). Backups
  // and avatars were unaffected: their paths never carried the leading slash.
  const assetPath = (p: { user_id: string; project_id: string }, kind: 'screenshots', filename: string) =>
    `${p.user_id}/${p.project_id}/${kind}/${filename}` // namespaced per user (spec §15)

  // ---- hurdles ---------------------------------------------------------------
  const hurdlesHtml = (hurdles: HurdleRow[], lang: Locale): string =>
    hurdles
      .map(
        (h) => `<li class="hurdle ${h.status === 'solved' ? 'done' : ''}" id="hurdle-${h.id}" draggable="true" data-hurdle-id="${h.id}">
        <button class="ghost toggle" hx-patch="/api/hurdles/${h.id}" hx-vals='{"status":"${h.status === 'solved' ? 'open' : 'solved'}"}' hx-target="#hurdles" hx-swap="innerHTML" aria-label="${trL(lang, 'toggle', 'تغییر وضعیت')}">${icon(h.status === 'solved' ? 'check' : 'unchecked')}</button>
        <span class="hurdle-text">${esc(h.text)}</span>
        <button type="button" class="ghost hurdle-edit" data-hurdle-edit="${h.id}" aria-label="${trL(lang, 'Edit hurdle', 'ویرایش مانع')}" title="${trL(lang, 'Edit hurdle', 'ویرایش مانع')}">${icon('pencil')}</button>
        <button class="ghost danger" hx-delete="/api/hurdles/${h.id}" hx-target="#hurdles" hx-swap="innerHTML" aria-label="${trL(lang, 'delete', 'حذف')}">${icon('x')}</button>
      </li>`,
      )
      .join('') || `<li class="muted">${trL(lang, 'No hurdles — add the first one below.', 'هنوز هیچ مانعی نیست — اولین مورد را از پایین اضافه کن.')}</li>`

  app.get('/api/projects/:projectId/hurdles', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const hurdles = await cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [p.id])
    if (c.req.header('HX-Request')) return c.html(hurdlesHtml(hurdles, localeOf(c)))
    return c.json({ hurdles })
  })

  app.post('/api/projects/:projectId/hurdles', async (c) => {
    const body = await jsonBody<{ id?: string; text: string }>(c, createHurdleSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    // The composer works like the Quick Notebook (user request): Enter (or a pasted block)
    // can carry several lines — each non-empty line becomes its own hurdle.
    const lines = body.text
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 50)
    if (!lines.length) return c.json({ error: 'invalid_input' }, 400)
    const sort = await cfg.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM hurdles WHERE project_id = ?', [p.id])
    const now = new Date().toISOString()
    const ids: string[] = []
    let sortOrder = sort[0].n
    // P3.2 (F-M3): wrap the multi-line INSERTs + the projects.updated_at touch in ONE
    // transaction. Was up to 50 sequential round trips, not atomic — a failure mid-loop
    // left partial rows AND the UPDATE still ran. Now batched: all-or-nothing.
    await cfg.db.transaction(async (tx) => {
      for (const line of lines) {
        const id = uuid()
        ids.push(id)
        tx.sql('INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          id, p.id, line.slice(0, 500), 'open', sortOrder++, now,
        ])
      }
      tx.sql('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    })
    if (c.req.header('HX-Request')) {
      // Re-render the list fragment so the htmx swap is deterministic (no HX-Retarget dance).
      const hurdles = await cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [p.id])
      return c.html(hurdlesHtml(hurdles, localeOf(c)), 201)
    }
    return c.json({ ok: true, id: ids[0], ids }, 201)
  })

  // Drag-reorder within a project (spec §4.3): the owning project is already user-scoped (rule 1)
  // and every UPDATE is additionally bound to that project, so callers can only reorder their own.
  app.post('/api/projects/:projectId/hurdles/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof hurdleReorderSchema>>(c, hurdleReorderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE hurdles SET sort_order = ? WHERE id = ? AND project_id = ?', [i, id, p.id])
      })
      tx.sql('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    })
    return c.json({ ok: true })
  })

  app.patch('/api/hurdles/:id', async (c) => {
    const body = await jsonBody<{ status?: 'open' | 'solved'; text?: string }>(c, updateHurdleSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const projectId = await ownedProjectId(cfg, user.id, 'hurdles', c.req.param('id'))
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    if (body.status) {
      await cfg.db.execute('UPDATE hurdles SET status = ?, solved_at = ? WHERE id = ?', [
        body.status, body.status === 'solved' ? now : null, c.req.param('id'),
      ])
      await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId])
    }
    if (body.text) await cfg.db.execute('UPDATE hurdles SET text = ? WHERE id = ?', [body.text, c.req.param('id')])
    if (c.req.header('HX-Request')) {
      const hurdles = await cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [projectId])
      return c.html(hurdlesHtml(hurdles, localeOf(c)))
    }
    return c.json({ ok: true })
  })

  app.delete('/api/hurdles/:id', async (c) => {
    const user = c.get('user')
    const owned = await cfg.db.query<{ project_id: string }>(
      'SELECT project_id FROM hurdles WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
      [c.req.param('id'), user.id],
    )
    await cfg.db.execute('DELETE FROM hurdles WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [
      c.req.param('id'), user.id,
    ])
    if (c.req.header('HX-Request')) {
      const hurdles = owned.length
        ? await cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [owned[0].project_id])
        : []
      return c.html(hurdlesHtml(hurdles, localeOf(c)))
    }
    return c.json({ ok: true })
  })

  // ---- links -----------------------------------------------------------------
  const linksHtml = (links: LinkRow[], lang: Locale): string =>
    links
      .map(
        (l) => `<li class="row spread">
        <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>
        <button class="ghost danger" hx-delete="/api/links/${l.id}" hx-target="#links" hx-swap="innerHTML">${icon('x')}</button>
      </li>`,
      )
      .join('') || `<li class="muted">${trL(lang, 'No links yet.', 'هنوز پیوندی نیست.')}</li>`

  app.get('/api/projects/:projectId/links', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const links = await cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [p.id])
    if (c.req.header('HX-Request')) return c.html(linksHtml(links, localeOf(c)))
    return c.json({ links })
  })

  app.post('/api/projects/:projectId/links', async (c) => {
    const body = await jsonBody<z.infer<typeof createLinkSchema>>(c, createLinkSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const id = body.id ?? uuid()
    await cfg.db.execute('INSERT INTO links (id, project_id, label, url, created_at) VALUES (?, ?, ?, ?, ?)', [
      id, p.id, body.label, body.url, new Date().toISOString(),
    ])
    if (c.req.header('HX-Request')) {
      const links = await cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [p.id])
      return c.html(linksHtml(links, localeOf(c)), 201)
    }
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/links/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateLinkSchema>>(c, updateLinkSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedProjectId(cfg, user.id, 'links', c.req.param('id'))
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`)
      params.push(v)
    }
    params.push(c.req.param('id'))
    await cfg.db.execute(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`, params)
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Link updated', 'پیوند به‌روزرسانی شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true })
  })

  app.delete('/api/links/:id', async (c) => {
    const user = c.get('user')
    const owned = await cfg.db.query<{ project_id: string }>(
      'SELECT project_id FROM links WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
      [c.req.param('id'), user.id],
    )
    await cfg.db.execute('DELETE FROM links WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [
      c.req.param('id'), user.id,
    ])
    if (c.req.header('HX-Request')) {
      const links = owned.length
        ? await cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [owned[0].project_id])
        : []
      return c.html(linksHtml(links, localeOf(c)))
    }
    return c.json({ ok: true })
  })

  // ---- media (screenshots: KV → S3/R2 → GitHub, first configured wins) -------------
  // S38: Cloudflare Workers KV is the default store — free 1 GB on the account the
  // Worker already runs on, no card (R2's tier is payment-gated), values written with
  // NO expirationTtl → pictures never expire unless the user deletes them (the S38
  // requirement). S36's provider-generic S3 adapter stays the upgrade path (B2 10 GB)
  // via R2_* env vars; unset everything = GitHub Contents API exactly as before. The
  // `github_path` column stays (it is the storage key either way).
  // S39: the constructor moved to services/shotstore.ts so the project hard-delete +
  //  the purge cron clean remote bytes through the SAME precedence the routes use.
  const shotStore = shotStoreFor(cfg)

  async function ownedRecord(userId: string, id: string, table: 'screenshots') {
    return ownedProjectId(cfg, userId, table, id)
  }

  app.get('/api/projects/:projectId/screenshots', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const shots = await cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE project_id = ? ORDER BY created_at DESC', [p.id])
    if (c.req.header('HX-Request')) return c.html(shotsGridHtml(shots, localeOf(c), await shotTaskMap(cfg, shots)))
    return c.json({ screenshots: shots })
  })

  // S39 (user request: "archive gallery of pics, similar to wordpress — delete the
  // unneeded files to make up more space"): EVERY picture the user owns, across all
  // projects, in one listing. Joins project title (soft-deleted projects included —
  // their bytes are still real until purged, and the gallery is where you free them)
  // and the pinned task's title + status so each card can say where the picture
  // lives. totalBytes = the gallery's space meter (sum of the 0054 bytes column).
  app.get('/api/media', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<
      ScreenshotRow & {
        project_title: string
        project_deleted: string | null
        task_title: string | null
        task_status: string | null
      }
    >(
      `SELECT s.id, s.project_id, s.github_path, s.mime_type, s.caption, s.created_at, s.resolved, s.task_id, s.bytes, s.filename,
              p.title AS project_title, p.deleted_at AS project_deleted,
              dt.title AS task_title, dt.status AS task_status
       FROM screenshots s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN dev_tasks dt ON dt.id = s.task_id
       WHERE p.user_id = ?
       ORDER BY s.created_at DESC`,
      [user.id],
    )
    const totalBytes = rows.reduce((n, r) => n + (r.bytes || 0), 0)
    return c.json({ screenshots: rows, count: rows.length, totalBytes })
  })

  // S115 (owner: "we cannot afford to pile up hundreds or thousands of documents on
  // Cloudflare's free host — the gallery must have a Delete All"): ONE call purges
  // EVERY media row the user owns. The scope is EXACTLY the gallery's own listing
  // (the same JOIN as GET /api/media above — including shots of soft-deleted
  // projects, whose bytes are still real until purged); rule 1 honored through the
  // projects join. Byte-cleanup first (best-effort, the per-shot delete's order —
  // the row is the truth either way), then the rows in one statement.
  app.delete('/api/media/screenshots', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string; github_path: string; bytes: number }>(
      'SELECT s.id, s.github_path, s.bytes FROM screenshots s JOIN projects p ON p.id = s.project_id WHERE p.user_id = ?',
      [user.id],
    )
    if (rows.length) {
      for (const r of rows) {
        try {
          if (r.github_path) {
            await shotStore.deleteObject(r.github_path)
            await shotStore.deleteObject(`${r.github_path}.thumb`) // the S69 tile rides along — no orphan
          }
        } catch { /* storage hiccup — the row still goes */ }
      }
      await cfg.db.execute('DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', [user.id])
    }
    return c.json({ ok: true, deleted: rows.length, bytes: rows.reduce((n, r) => n + (r.bytes || 0), 0) })
  })

  app.post('/api/projects/:projectId/screenshots', async (c) => {
    // M8 fix (2026-09-10): wire the upload rate limiter — screenshots push bytes into the
    // storage backend (GitHub repo or R2 bucket), and under open registration (now
    // invite-only) an authed abuser could spam uploads unbounded. 30 req/60s per IP
    // matches the RATE_RULES.upload intent.
    if (await hitRateLimit(cfg.db, RATE_RULES.upload, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many uploads — wait a minute and try again.' }, 429)
    }
    // P1.1 (F-H1): reject oversized uploads BEFORE jsonBody() buffers the whole body — a
    // 140 MB base64 payload would OOM the Worker. 7 MB Content-Length ceiling sits above
    // the 5 MB base64 Zod cap (which rejects the rest), so legit screenshots never trip it.
    const cl = Number(c.req.header('Content-Length') ?? 0)
    if (cl > 7_000_000) return c.json({ error: 'file_too_large' }, 413)
    const body = await jsonBody<z.infer<typeof uploadScreenshotSchema>>(c, uploadScreenshotSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const id = body.id ?? uuid()
    const safeName = body.fileName.replace(/[^\w.\- ]/g, '_')
    const path = assetPath({ user_id: user.id, project_id: p.id }, 'screenshots', `${id}-${safeName}`)
    await shotStore.putObject(path, body.dataBase64, body.mimeType)
    // S69 (perf §10-F1): the grid-tile variant — a ≤320px WebP stored beside the
    // original (same key + '.thumb'). Best-effort: a failed thumb write must never
    // fail the upload itself (the original is the source of truth; the gallery falls
    // back to full-size + client self-heal).
    if (body.thumbBase64) {
      try { await shotStore.putObject(`${path}.thumb`, body.thumbBase64, 'image/webp') } catch { /* tile falls back to the original */ }
    }
    // S39 (0054): exact decoded size — base64 without padding × 3/4. Never re-encoded,
    // never estimated: the gallery's space meter sums THIS column.
    const byteLen = Math.floor(body.dataBase64.replace(/=+$/, '').length * 3 / 4)
    // S86 (0059): the ORIGINAL file name rides the row — doc tiles (PDF/XLSX/…) show
    // it; image rows keep it too (the lightbox title can use it later). Sanitized to
    // the same safe-charset as the stored path so it can never smuggle control chars
    // into the Content-Disposition header on serve.
    const displayName = (body.filename || body.fileName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || safeName
    await cfg.db.execute(
      'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)',
      [id, p.id, path, body.mimeType, body.caption, byteLen, displayName, new Date().toISOString()],
    )
    if (c.req.header('HX-Request')) return c.html(toastHtml(body.mimeType.startsWith('image/') ? t('Screenshot uploaded', 'اسکرین‌شات آپلود شد') : t('File uploaded', 'فایل آپلود شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true, id, mimeType: body.mimeType }, 201)
  })

  // S35: the note + the open/fixed state are editable after upload — the note is the
  // "what & where to work" text, resolved flips when the fix lands (and back).
  // S39: taskId sticks the shot to a progress-box item (0054) — uuid = pin, '' or
  // null = unpin. The task must live in the SAME project (a shot can't cross
  // projects) and belong to the caller (rule 1, through the projects join).
  const patchScreenshotSchema = z.object({
    caption: z.string().max(1000).optional(),
    resolved: z.union([z.literal(0), z.literal(1)]).optional(),
    taskId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional(),
    // S69 self-heal: the gallery generates the ≤320px WebP tile for legacy shots (the
    // ones whose ?variant=thumb fell back with X-Hibana-Thumb: miss) and PUTs it here
    // once — best-effort, capped, and NEVER over DB state (object-store only).
    thumbBase64: z.string().min(1).max(120_000).optional(),
  })
  app.patch('/api/screenshots/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchScreenshotSchema>>(c, patchScreenshotSchema)
    if (!body || (body.caption === undefined && body.resolved === undefined && body.taskId === undefined && body.thumbBase64 === undefined)) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    if (body.taskId !== undefined && body.taskId !== '' && body.taskId !== null) {
      const owned = await cfg.db.query<{ id: string }>(
        'SELECT dt.id FROM dev_tasks dt JOIN projects p ON p.id = dt.project_id WHERE dt.id = ? AND p.user_id = ? AND p.deleted_at IS NULL AND dt.project_id = ?',
        [body.taskId, user.id, projectId],
      )
      if (!owned.length) return c.json({ error: 'task_not_found' }, 404)
    }
    const now = new Date().toISOString()
    if (body.caption !== undefined) {
      await cfg.db.execute('UPDATE screenshots SET caption = ? WHERE id = ? AND project_id = ?', [body.caption, c.req.param('id'), projectId])
    }
    if (body.resolved !== undefined) {
      await cfg.db.execute('UPDATE screenshots SET resolved = ? WHERE id = ? AND project_id = ?', [body.resolved, c.req.param('id'), projectId])
    }
    if (body.taskId !== undefined) {
      const target = body.taskId === '' || body.taskId === null ? null : body.taskId
      await cfg.db.execute('UPDATE screenshots SET task_id = ? WHERE id = ? AND project_id = ?', [target, c.req.param('id'), projectId])
    }
    // S69: the self-heal tile write — after the field updates so a bad thumb can never
    // mask a real edit. Object-store only; a failure is silent (the next miss retries).
    if (body.thumbBase64 !== undefined) {
      const row = await cfg.db.query<{ github_path: string }>('SELECT github_path FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
      if (row[0]?.github_path) {
        try { await shotStore.putObject(`${row[0].github_path}.thumb`, body.thumbBase64, 'image/webp') } catch { /* best-effort */ }
      }
    }
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Saved', 'ذخیره شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true })
  })

  app.get('/api/media/screenshots/:id/file', async (c) => {
    const user = c.get('user')
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    const rec = await cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    // S116 (CI evidence): a row whose STORED OBJECT is gone (a purged KV entry, an
    // expired storage backend, a stale local-e2e DB) used to surface as an unhandled
    // ENOENT / storage-HTTP-error 500 via app.onError — the gallery tile got a
    // console error and nothing else. The row is the truth (it 404s above); a missing
    // OBJECT is the same fact one layer deeper, so it degrades to the SAME 404 and
    // the tile renders its alt/empty state instead of blaming the server.
    const getObjectOrNull = async (key: string): Promise<ArrayBuffer | null> => {
      try {
        return await shotStore.getObject(key)
      } catch {
        return null
      }
    }
    // S69 (perf §10-F1): ?variant=thumb serves the ≤320px WebP tile when one exists —
    // the gallery grid no longer transfers full-size originals. A miss (legacy shots,
    // or a failed thumb write) falls back to the original bytes and says so via
    // X-Hibana-Thumb: miss, which the gallery uses to self-heal (generate + PATCH the
    // thumb once, best-effort — every later visit on any device gets the cheap tile).
    const wantThumb = c.req.query('variant') === 'thumb'
    let bytes: ArrayBuffer | null
    let mime = rec[0].mime_type
    let thumbMiss = false
    if (wantThumb) {
      bytes = await getObjectOrNull(`${rec[0].github_path}.thumb`)
      if (bytes) {
        mime = 'image/webp'
      } else {
        bytes = await getObjectOrNull(rec[0].github_path)
        if (!bytes) return c.json({ error: 'not_found' }, 404)
        thumbMiss = true
      }
    } else {
      bytes = await getObjectOrNull(rec[0].github_path) // raw bytes — never text-decoded
      if (!bytes) return c.json({ error: 'not_found' }, 404)
    }
    if (!bytes) return c.json({ error: 'not_found' }, 404) // unreachable — narrows the type
    // S39 self-heal: legacy rows (pre-0054) have bytes=0; the object is ALREADY in
    // hand here, so record its true size once — the gallery's space meter goes honest
    // on the first view. Idempotent (guarded by bytes = 0) + best-effort (a failed
    // write never breaks the picture).
    if (rec[0].bytes === 0 && bytes.byteLength > 0) {
      try { await cfg.db.execute('UPDATE screenshots SET bytes = ? WHERE id = ? AND bytes = 0', [bytes.byteLength, c.req.param('id')]) } catch { /* meter stays 0 — harmless */ }
    }
    const headers: Record<string, string> = { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' }
    if (thumbMiss) headers['X-Hibana-Thumb'] = 'miss'
    // S86: doc uploads (PDF/XLSX/…) download instead of rendering inline — the
    // browser has no inline viewer inside an authed XHR-fetched blob flow, and the
    // display name is the point of a doc tile. Filename falls back to the stored
    // path's basename (legacy rows pre-0059 have no filename column value).
    if (!String(mime).startsWith('image/')) {
      const rec2 = rec[0] as { filename?: string | null; github_path: string }
      const base = (rec2.github_path || '').split('/').pop() || 'file'
      const name = rec2.filename || base.replace(/^[0-9a-f-]{36}-/i, '') || 'file'
      headers['Content-Disposition'] = `attachment; filename="${name.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
    return new Response(bytes, { headers })
  })

  app.delete('/api/screenshots/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    // S35: clean the remote bytes too (best-effort — the row is the truth either way).
    // S69: the .thumb sibling object rides along — a deleted shot leaves no tile orphan.
    const rec = await cfg.db.query<ScreenshotRow>('SELECT github_path FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    try {
      if (rec[0]?.github_path) {
        await shotStore.deleteObject(rec[0].github_path)
        await shotStore.deleteObject(`${rec[0].github_path}.thumb`)
      }
    } catch { /* storage hiccup — the row still goes */ }
    await cfg.db.execute('DELETE FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Screenshot deleted', 'اسکرین‌شات حذف شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true })
  })

  // ---- canvas sync (spec §3.4 — idempotent LWW batch upsert, Q4-A) ----------
  const elementSchema = z.object({
    id: z.string().uuid(),
    type: z.enum(['note', 'stroke', 'image', 'frame', 'shape', 'comment', 'block', 'sticky']),
    // frame: movable region that carries content (2026-08-26); shape/comment/block: 0032 squig batch (2026-08-31) — rect/oval/circle primitives, comment pins, lo-fi wireframe groups; sticky: notebook sticky notes (batch s)
    x: z.number(),
    y: z.number(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    color: z.string().max(20).optional().default('#fef08a'),
    content: z.string().max(10_000).optional().default(''),
    font_size: z.number().int().min(6).max(400).nullable().optional(),
    // 0055 (S40): fabric text alignment — NULL/absent = 'left' (the fabric default),
    // so legacy rows and old clients keep rendering exactly as before.
    text_align: z.enum(['left', 'center', 'right']).nullable().optional(),
    board: z.enum(['canvas', 'notebook']).optional().default('canvas'),
    promoted_project_id: z.string().uuid().nullable().optional(),
    z_index: z.number().int().optional().default(0),
    deleted: z.union([z.literal(0), z.literal(1)]).optional().default(0),
    locked: z.union([z.literal(0), z.literal(1)]).optional().default(0), // 0024: per-element lock
    angle: z.number().min(-3600).max(3600).optional().default(0), // 0049: persisted rotation (fabric mtr), degrees CW y-down
    created_at: z.string().optional(),
    updated_at: z.string().max(40),
  })
  const syncSchema = z.object({ elements: z.array(elementSchema).max(500), upto: z.string().optional() })
  const promoteSchema = z.object({ title: z.string().min(1).max(200).optional() })

  app.get('/api/canvas', async (c) => {
    const q = c.req.query()
    const board = q.board === 'notebook' ? 'notebook' : 'canvas'
    const user = c.get('user')
    // P1.5 (F-L4): Number('abc') returns NaN -> x < NaN is always false -> silent empty
    // canvas. Guard with a finite check: garbage/minX/maxY params fall back to the open
    // defaults (1e9 / -1e9) so a malformed viewport query returns all elements, not none.
    const num = (v: string | undefined, dflt: number): number => {
      if (v === undefined) return dflt
      const n = Number(v)
      return Number.isFinite(n) ? n : dflt
    }
    const rows = await cfg.db.query(
      `SELECT * FROM canvas_elements
       WHERE user_id = ? AND board = ? AND deleted = 0 AND x < ? AND x + COALESCE(width, 0) > ? AND y < ? AND y + COALESCE(height, 0) > ?
       ORDER BY z_index, created_at`,
      [user.id, board, num(q.maxX, 1e9), num(q.minX, -1e9), num(q.maxY, 1e9), num(q.minY, -1e9)],
    )
    return c.json({ elements: rows })
  })

  app.get('/api/canvas/full', async (c) => {
    const board = c.req.query('board') === 'notebook' ? 'notebook' : 'canvas'
    const user = c.get('user')
    const rows = await cfg.db.query('SELECT * FROM canvas_elements WHERE user_id = ? AND board = ? AND deleted = 0 ORDER BY z_index, created_at', [user.id, board])
    const [maxRow] = await cfg.db.query<{ m: string | null }>('SELECT MAX(updated_at) AS m FROM canvas_elements WHERE user_id = ? AND board = ?', [user.id, board])
    return c.json({ elements: rows, serverUpdatedAt: maxRow?.m ?? null })
  })

  app.post('/api/canvas/sync', async (c) => {
    const body = await jsonBody<z.infer<typeof syncSchema>>(c, syncSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)

    // The offline queue can hold several writes for the same element in one batch (IndexedDB
    // keys are random uuids, so array order is not time order). Keep only the newest per id:
    // without this, an older edit could apply after a newer one and win the conflict upsert.
    const byIdNewest = new Map<string, (typeof body.elements)[number]>()
    for (const el of body.elements) {
      const cur = byIdNewest.get(el.id)
      if (!cur || el.updated_at > cur.updated_at) byIdNewest.set(el.id, el)
    }
    const elements = [...byIdNewest.values()]

    const stored = await cfg.db.query<{ id: string; updated_at: string; created_at: string }>(
      `SELECT id, updated_at, created_at FROM canvas_elements
       WHERE user_id = ? AND id IN (${elements.map(() => '?').join(',')})`,
      [user.id, ...elements.map((e) => e.id)],
    )
    const byId = new Map(stored.map((r) => [r.id, r]))

    const applied: string[] = []
    await cfg.db.transaction(async (tx) => {
      for (const el of elements) {
        const prev = byId.get(el.id)
        if (prev && el.updated_at <= prev.updated_at) continue // LWW (Q4-A)
        const createdAt = el.created_at ?? prev?.created_at ?? new Date().toISOString()
        tx.sql(
          `INSERT INTO canvas_elements (id, user_id, board, type, x, y, width, height, color, content, font_size, text_align, promoted_project_id, z_index, deleted, locked, angle, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             board = excluded.board, type = excluded.type, x = excluded.x, y = excluded.y, width = excluded.width,
             height = excluded.height, color = excluded.color, content = excluded.content, font_size = excluded.font_size,
             text_align = excluded.text_align,
             promoted_project_id = excluded.promoted_project_id, z_index = excluded.z_index,
             deleted = excluded.deleted, locked = excluded.locked, angle = excluded.angle, updated_at = excluded.updated_at`,
          [el.id, user.id, el.board ?? 'canvas', el.type, el.x, el.y, el.width ?? null, el.height ?? null, el.color, el.content,
           el.font_size ?? null, el.text_align ?? null, el.promoted_project_id ?? null, el.z_index, el.deleted, el.locked ?? 0, el.angle ?? 0, createdAt, el.updated_at],
        )
        applied.push(el.id)
      }
    })

    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    await cfg.db.execute('DELETE FROM canvas_elements WHERE user_id = ? AND deleted = 1 AND updated_at < ?', [user.id, cutoff])

    const [maxRow] = await cfg.db.query<{ m: string | null }>('SELECT MAX(updated_at) AS m FROM canvas_elements WHERE user_id = ?', [user.id])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Synced {n} element(s)', '{n} مورد همگام شد', { n: applied.length }), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true, applied, serverUpdatedAt: maxRow?.m ?? null })
  })

  app.post('/api/canvas/elements/:id/promote', async (c) => {
    const body = await jsonBody<z.infer<typeof promoteSchema>>(c, promoteSchema)
    const user = c.get('user')
    const t = trFor(c)
    const rows = await cfg.db.query<{ id: string; content: string; type: string }>(
      'SELECT id, content, type FROM canvas_elements WHERE id = ? AND user_id = ? AND deleted = 0',
      [c.req.param('id'), user.id],
    )
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404)
    const el = rows[0]
    const projectId = uuid()
    const now = new Date().toISOString()
    const title = (body?.title ?? (el.content || 'Promoted from canvas')).slice(0, 200)
    await cfg.db.transaction(async (tx) => {
      tx.sql(
        'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
        [projectId, user.id, title, 'Promoted from the canvas', 'personal', 'spark', '', now, now],
      )
      tx.sql('UPDATE canvas_elements SET promoted_project_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', [projectId, now, el.id, user.id])
      if (el.type === 'note' && el.content) {
        tx.sql('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
          uuid(), projectId, `Promoted from canvas note: ${el.content.slice(0, 200)}`, now,
        ])
      }
    })
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Promoted to Idea — <a href="/project.html?id={id}">open it</a>', 'به ایده تبدیل شد — <a href="/project.html?id={id}">باز کردن آن</a>', { id: projectId }), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true, projectId }, 201)
  })

  return app
}
