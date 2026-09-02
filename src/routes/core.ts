import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody } from '../lib/http'
import { getOwnedProject, icon, toastHtml } from '../lib/html'
import { localeOf, trFor, trL, type Locale } from '../lib/i18n'
import { uuid } from '../lib/ids'
import { githubClient, type GitHubConfig } from '../services/github'
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

/** Shared screenshot grid (Batch (p)): the project page's Screenshots tab and the
 *  HX screenshots endpoint render the same figures, so an uploaded shot appears in
 *  both after one swap. */
export function shotsGridHtml(shots: ScreenshotRow[], lang: Locale): string {
  return shots
    .map(
      (s) => `<figure class="shot">
        <img src="/api/media/screenshots/${s.id}/file" alt="${esc(s.caption)}" loading="lazy">
        <figcaption class="muted small">${esc(s.caption)}</figcaption>
      </figure>`,
    )
    .join('') || `<p class="muted">${trL(lang, 'No screenshots yet — use the button above.', 'هنوز اسکرین‌شاتی نیست — از دکمه بالا استفاده کن.')}</p>`
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

  const gh = () => githubClient(cfg.github as GitHubConfig)
  const assetPath = (p: { user_id: string; project_id: string }, kind: 'screenshots', filename: string) =>
    `/${p.user_id}/${p.project_id}/${kind}/${filename}` // namespaced per user (spec §15)

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
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Link updated', 'پیوند به‌روزرسانی شد'), localeOf(c)))
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

  // ---- media (screenshots via GitHub) ----------------------------------------
  async function ownedRecord(userId: string, id: string, table: 'screenshots') {
    return ownedProjectId(cfg, userId, table, id)
  }

  app.get('/api/projects/:projectId/screenshots', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const shots = await cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE project_id = ? ORDER BY created_at DESC', [p.id])
    if (c.req.header('HX-Request')) return c.html(shotsGridHtml(shots, localeOf(c)))
    return c.json({ screenshots: shots })
  })

  app.post('/api/projects/:projectId/screenshots', async (c) => {
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
    await gh().pushFile(path, body.dataBase64, `Screenshot for ${p.title}`)
    await cfg.db.execute(
      'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, p.id, path, body.mimeType, body.caption, new Date().toISOString()],
    )
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Screenshot uploaded', 'اسکرین‌شات آپلود شد'), localeOf(c)))
    return c.json({ ok: true, id }, 201)
  })

  app.get('/api/media/screenshots/:id/file', async (c) => {
    const user = c.get('user')
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    const rec = await cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    const bytes = await gh().readBinary(rec[0].github_path) // rule 7: raw Accept header for >1MB files
    return new Response(bytes, {
      headers: { 'Content-Type': rec[0].mime_type, 'Cache-Control': 'private, max-age=3600' },
    })
  })

  app.delete('/api/screenshots/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Screenshot deleted', 'اسکرین‌شات حذف شد'), localeOf(c)))
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
    board: z.enum(['canvas', 'notebook']).optional().default('canvas'),
    promoted_project_id: z.string().uuid().nullable().optional(),
    z_index: z.number().int().optional().default(0),
    deleted: z.union([z.literal(0), z.literal(1)]).optional().default(0),
    locked: z.union([z.literal(0), z.literal(1)]).optional().default(0), // 0024: per-element lock
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
          `INSERT INTO canvas_elements (id, user_id, board, type, x, y, width, height, color, content, font_size, promoted_project_id, z_index, deleted, locked, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             board = excluded.board, type = excluded.type, x = excluded.x, y = excluded.y, width = excluded.width,
             height = excluded.height, color = excluded.color, content = excluded.content, font_size = excluded.font_size,
             promoted_project_id = excluded.promoted_project_id, z_index = excluded.z_index,
             deleted = excluded.deleted, locked = excluded.locked, updated_at = excluded.updated_at`,
          [el.id, user.id, el.board ?? 'canvas', el.type, el.x, el.y, el.width ?? null, el.height ?? null, el.color, el.content,
           el.font_size ?? null, el.promoted_project_id ?? null, el.z_index, el.deleted, el.locked ?? 0, createdAt, el.updated_at],
        )
        applied.push(el.id)
      }
    })

    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    await cfg.db.execute('DELETE FROM canvas_elements WHERE user_id = ? AND deleted = 1 AND updated_at < ?', [user.id, cutoff])

    const [maxRow] = await cfg.db.query<{ m: string | null }>('SELECT MAX(updated_at) AS m FROM canvas_elements WHERE user_id = ?', [user.id])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Synced {n} element(s)', '{n} مورد همگام شد', { n: applied.length }), localeOf(c)))
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
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Promoted to Idea — <a href="/project.html?id={id}">open it</a>', 'به ایده تبدیل شد — <a href="/project.html?id={id}">باز کردن آن</a>', { id: projectId }), localeOf(c)))
    return c.json({ ok: true, projectId }, 201)
  })

  return app
}
