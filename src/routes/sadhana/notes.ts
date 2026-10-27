// Sadhana board — inline task notes + updates journal routes (Phase 4 split
// from routes/sadhana.ts).
//
// Purpose: the notes surface (GET/POST on /tasks/:id/notes, legacy note clear,
// single-note delete) and the legacy updates journal (GET/POST /tasks/:id/updates,
// DELETE/PATCH /updates/:id). Notes reuse the sadhana_updates table; user-scoped
// through the task join everywhere.
//
// Public API: registerSadhanaNotes(app, cfg) — registered by sadhana/index.ts.
import { z } from 'zod'
import { esc, jsonBody } from '../../lib/http'
import { icon } from '../../lib/html'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow } from '../../types'
import { updateSchema } from '../sadhana-helpers'
import { loadAll, ownedTask } from './data'
import { ctxOf, zone, isHx, t, boardZoneHtml } from './render'

export function registerSadhanaNotes(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  // ---- inline task notes -------------------------------------------------------------
  // Notes reuse the existing updates journal table. `task.note` is retained as a legacy
  // single-note field and is rendered as a deletable note until the user removes it.
  app.get('/tasks/:id/notes', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const data = await loadAll(cfg.db, ctx.user.id)
    return c.json({ notes: data.notes.get(task.id) ?? [] })
  })

  app.post('/tasks/:id/notes', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const body = await jsonBody<z.infer<typeof updateSchema>>(c, updateSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const id = uuid()
    const text = body.text.trim()
    const ts = new Date().toISOString()
    await cfg.db.execute('INSERT INTO sadhana_updates (id, task_id, text, created_at) VALUES (?, ?, ?, ?)', [id, task.id, text, ts])
    // Echo text + ts (2026-09-02): the board page paints the fresh note row from the
    // response — the old {ok,id}-only payload made `u.ts.slice` throw, so a just-added
    // note never rendered until a full page refresh.
    return c.json({ ok: true, id, text, ts }, 201)
  })

  app.delete('/tasks/:id/notes/legacy', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('UPDATE sadhana_tasks SET note = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['', new Date().toISOString(), task.id, ctx.user.id])
    return c.json({ ok: true })
  })

  app.delete('/notes/:id', async (c) => {
    const ctx = ctxOf(c)
    const noteId = c.req.param('id')
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT u.id FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE u.id = ? AND t.user_id = ?',
      [noteId, ctx.user.id],
    )
    if (!rows.length) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute(
      'DELETE FROM sadhana_updates WHERE id = ? AND task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)',
      [noteId, ctx.user.id],
    )
    return c.json({ ok: true })
  })

  // ---- updates journal (legacy route, spec §5.9) -----------------------------------
  app.get('/tasks/:id/updates', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const rows = await cfg.db.query<{ id: string; text: string; created_at: string }>(
      'SELECT id, text, created_at FROM sadhana_updates WHERE task_id = ? ORDER BY created_at',
      [task.id],
    )
    const entries = rows.map((r) => `<li class="row spread"><div class="column"><span class="muted small">${esc(r.created_at.slice(0, 16).replace('T', ' '))}</span>${esc(r.text)}</div><button type="button" class="ghost danger" hx-delete="/api/sadhana/updates/${r.id}" hx-target="closest .sadhana-zone" hx-swap="outerHTML" aria-label="${t(ctx.lang, 'Delete', 'حذف')}">${icon('x')}</button></li>`).join('')
    return c.html(zone(`<section class="card sadhana-updates">
      <h3>${t(ctx.lang, 'Updates — {title}', 'یادداشتها — {title}', { title: esc(task.title) })}</h3>
      <ul class="sadhana-updatelist">${entries || `<li class="muted">${t(ctx.lang, 'No updates yet', 'هنوز یادداشتی نیست')}</li>`}</ul>
      <form class="row" hx-post="/api/sadhana/tasks/${task.id}/updates" hx-target="closest .sadhana-zone" hx-swap="outerHTML">
        <input name="text" maxlength="500" required placeholder="${t(ctx.lang, 'Log an update…', 'ثبت یادداشت…')}" autocomplete="off">
        <button class="qa-btn" aria-label="${t(ctx.lang, 'Add', 'افزودن')}">${icon('plus')}</button>
      </form>
      <button type="button" class="ghost" hx-get="/api/sadhana" hx-target="closest .sadhana-zone" hx-swap="outerHTML">${icon('arrow-right', 'icon arrow')} ${t(ctx.lang, 'Back', 'بازگشت')}</button>
    </section>`))
  })

  app.post('/tasks/:id/updates', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const body = await jsonBody<z.infer<typeof updateSchema>>(c, updateSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    await cfg.db.execute('INSERT INTO sadhana_updates (id, task_id, text, created_at) VALUES (?, ?, ?, ?)', [
      uuid(), task.id, body.text.trim(), new Date().toISOString(),
    ])
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  app.delete('/updates/:id', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT u.id FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE u.id = ? AND t.user_id = ?',
      [c.req.param('id'), ctx.user.id],
    )
    if (!rows.length) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM sadhana_updates WHERE id = ?', [rows[0].id])
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // R10: PATCH a single note's text. Reuses the existing `updateSchema` (1..500 chars,
  // trimmed). User-scoped through the same join as DELETE so a forged id from another
  // user's task is a 404. No schema change — only `text` is updated (the table has no
  // updated_at column; created_at is preserved as the note's origin timestamp).
  app.patch('/updates/:id', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT u.id FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE u.id = ? AND t.user_id = ?',
      [c.req.param('id'), ctx.user.id],
    )
    if (!rows.length) return errJson(c, ErrorCode.not_found)
    const body = await jsonBody<z.infer<typeof updateSchema>>(c, updateSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    await cfg.db.execute('UPDATE sadhana_updates SET text = ? WHERE id = ?', [body.text, rows[0].id])
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })
}
