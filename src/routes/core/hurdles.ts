// Core — hurdle routes (Phase 4 split from routes/core.ts).
//
// Purpose: the project hurdle checklist — list (htmx fragment + JSON), the
// multi-line composer (one hurdle per non-empty line, batched in one tx),
// drag-reorder, toggle/edit PATCH, DELETE. Every query user-scoped (rule 1).
//
// Public API: registerCoreHurdles(app, cfg) — registered by core/index.ts.
import { z } from 'zod'
import { jsonBody, esc, isHtmx } from '../../lib/http'
import { getOwnedProject, icon } from '../../lib/html'
import { localeOf, trL, type Locale } from '../../lib/i18n'
import { uuid } from '../../lib/ids'
import { createHurdleSchema, hurdleReorderSchema, updateHurdleSchema } from '../../validation/schemas'
import { errJson, ErrorCode } from '../../lib/errors'
import { ownedProjectId } from './ownership'
import type { Config, HurdleRow, UserRow } from '../../types'

export function registerCoreHurdles(app: import('hono').Hono<{ Variables: { user: UserRow; reqId?: string } }>, cfg: Config) {
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
    if (!p) return errJson(c, ErrorCode.not_found)
    const hurdles = await cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [p.id])
    if (isHtmx(c)) return c.html(hurdlesHtml(hurdles, localeOf(c)))
    return c.json({ hurdles })
  })

  app.post('/api/projects/:projectId/hurdles', async (c) => {
    const body = await jsonBody<{ id?: string; text: string }>(c, createHurdleSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // The composer works like the Quick Notebook (user request): Enter (or a pasted block)
    // can carry several lines — each non-empty line becomes its own hurdle.
    const lines = body.text
      .split(/\r?\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 50)
    if (!lines.length) return errJson(c, ErrorCode.invalid_input)
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
    if (isHtmx(c)) {
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
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
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
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const projectId = await ownedProjectId(cfg, user.id, 'hurdles', c.req.param('id'))
    if (!projectId) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    if (body.status) {
      await cfg.db.execute('UPDATE hurdles SET status = ?, solved_at = ? WHERE id = ?', [
        body.status, body.status === 'solved' ? now : null, c.req.param('id'),
      ])
      await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId])
    }
    if (body.text) await cfg.db.execute('UPDATE hurdles SET text = ? WHERE id = ?', [body.text, c.req.param('id')])
    if (isHtmx(c)) {
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
    // Phase 1 (isolation suite): a foreign/missing id is a 404 like the PATCH above —
    // the old rowcount-agnostic {ok:true} answered a no-op delete with a false 200.
    if (owned.length === 0) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM hurdles WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [
      c.req.param('id'), user.id,
    ])
    if (isHtmx(c)) {
      const hurdles = owned.length
        ? await cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [owned[0].project_id])
        : []
      return c.html(hurdlesHtml(hurdles, localeOf(c)))
    }
    return c.json({ ok: true })
  })
}
