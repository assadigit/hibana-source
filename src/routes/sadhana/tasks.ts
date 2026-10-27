// Sadhana board — task routes (Phase 4 split from routes/sadhana.ts).
//
// Purpose: the task lifecycle — create (board + focus add forms), the inline
// editor fragment, PATCH (field-diff UPDATE), complete/uncomplete (immediate
// archive; recurring tasks loop), move, manual reorder, soft-delete → 7-day
// undo window, hard delete (satellite rows in one tx), restore, and the
// recurring completion-log clear.
//
// Public API: registerSadhanaTasks(app, cfg) — registered by sadhana/index.ts.
import { z } from 'zod'
import { jsonBody } from '../../lib/http'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Context } from 'hono'
import type { Config, UserRow } from '../../types'
import { createTaskSchema, patchTaskSchema, moveSchema, reorderSchema } from '../sadhana-helpers'
import { loadAll, ownedTask } from './data'
import { ctxOf, zone, isHx, boardZoneHtml } from './render'
import { editFormHtml, focusZone } from './fragments'

export function registerSadhanaTasks(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.post('/tasks', async (c) => {
    const ctx = ctxOf(c)
    const body = await jsonBody<z.infer<typeof createTaskSchema>>(c, createTaskSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const id = uuid()
    const now = new Date().toISOString()
    const recurring = body.recurring === true
    await cfg.db.transaction(async (tx) => {
      tx.sql(
        `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, note, fuzzy, due_date, due_time, recurring, recur_type, recur_config, recur_last, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, ctx.user.id, body.quadrant, body.title.trim(), body.emoji || '', body.note,
          body.fuzzy ?? null, body.due_date ?? null, body.due_time ?? null,
          recurring ? 1 : 0, body.recur_type ?? null, body.recur_config ?? '', recurring ? ctx.today : null,
          now, now,
        ],
      )
      for (const tg of body.tags ?? []) tx.sql('INSERT INTO sadhana_tags (task_id, tag) VALUES (?, ?)', [id, tg])
    })
    const data = await loadAll(cfg.db, ctx.user.id)
    if (isHx(c)) {
      // The focus view adds through the same route — keep the overlay in place with a
      // freshly rendered focus zone instead of swapping in the whole board (§5.10).
      if (body.focus === true) return c.html(focusZone(body.quadrant, data, ctx))
      return c.html(boardZoneHtml(data, ctx))
    }
    return c.json({ ok: true, id }, 201)
  })

  app.get('/tasks/:id/edit', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    return c.html(zone(editFormHtml(task, ctx)))
  })
  app.patch('/tasks/:id', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const body = await jsonBody<z.infer<typeof patchTaskSchema>>(c, patchTaskSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title.trim()) }
    if (body.emoji !== undefined) { sets.push('emoji = ?'); params.push(body.emoji) }
    if (body.note !== undefined) { sets.push('note = ?'); params.push(body.note) }
    if (body.fuzzy !== undefined) { sets.push('fuzzy = ?'); params.push(body.fuzzy) }
    if (body.due_date !== undefined) {
      sets.push('due_date = ?'); params.push(body.due_date)
      if (!body.due_date && body.due_time === undefined) { sets.push('due_time = ?'); params.push(null) }
    }
    if (body.due_time !== undefined) { sets.push('due_time = ?'); params.push(body.due_time) }
    if (body.pinned !== undefined) { sets.push('pinned = ?'); params.push(body.pinned ? 1 : 0) }
    if (body.progress !== undefined) { sets.push('progress = ?'); params.push(body.progress) }
    if (body.recurring !== undefined) {
      const recurring = body.recurring === true
      sets.push('recurring = ?'); params.push(recurring ? 1 : 0)
      if (recurring) {
        sets.push('recur_type = ?'); params.push(body.recur_type ?? 'daily')
        sets.push('recur_config = ?'); params.push(body.recur_config ?? '')
        if (task.recur_last === null) { sets.push('recur_last = ?'); params.push(ctx.today) }
      } else {
        sets.push('recur_type = ?'); params.push(null)
        sets.push('recur_config = ?'); params.push('')
        sets.push('recur_last = ?'); params.push(null)
      }
    } else if (body.recur_type !== undefined) { sets.push('recur_type = ?'); params.push(body.recur_type) }
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(new Date().toISOString())
      await cfg.db.execute(`UPDATE sadhana_tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, task.id, ctx.user.id])
    }
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  const completeTask = async (c: Context<{ Variables: { user: UserRow } }>, id: string, done: number) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, id)
    if (!task) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    if (done === 1) {
      // Immediate archive (user request 2026-08-29): completing a task moves it to the
      // Archive right away — no more waiting for the Monday sweep to see the change.
      // Recurring tasks still loop on the board (spec §8 Q1): completion is logged,
      // the clock restamps, and they reopen on schedule.
      await cfg.db.transaction(async (tx) => {
        if (task.recurring === 1) {
          tx.sql('UPDATE sadhana_tasks SET done = 1, updated_at = ? WHERE id = ? AND user_id = ?', [now, task.id, ctx.user.id])
          tx.sql('INSERT INTO sadhana_recur_history (id, task_id, completed_on, created_at) VALUES (?, ?, ?, ?)', [uuid(), task.id, ctx.today, now])
          tx.sql('UPDATE sadhana_tasks SET recur_last = ? WHERE id = ? AND user_id = ?', [ctx.today, task.id, ctx.user.id])
        } else {
          tx.sql('UPDATE sadhana_tasks SET done = 1, cleared_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [ctx.today, now, task.id, ctx.user.id])
        }
      })
    } else {
      // Un-completing also revives an archived task (the Archive's ↩ button lands here):
      // done=0 AND cleared_at=NULL puts it back on the board.
      await cfg.db.execute('UPDATE sadhana_tasks SET done = 0, cleared_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [now, task.id, ctx.user.id])
    }
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  }
  app.post('/tasks/:id/complete', async (c) => completeTask(c, c.req.param('id'), 1))
  app.post('/tasks/:id/uncomplete', async (c) => completeTask(c, c.req.param('id'), 0))

  app.post('/tasks/:id/move', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const body = await jsonBody<z.infer<typeof moveSchema>>(c, moveSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    await cfg.db.execute('UPDATE sadhana_tasks SET quadrant = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      body.quadrant, new Date().toISOString(), task.id, ctx.user.id,
    ])
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  app.post('/tasks/reorder', async (c) => {
    const ctx = ctxOf(c)
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    // Only the user's own OPEN, non-deleted cards in the stated quadrant get new positions;
    // stray ids are ignored (spec §6.16).
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE user_id = ? AND quadrant = ? AND done = 0 AND deleted_at IS NULL',
      [ctx.user.id, body.quadrant],
    )
    const ownedIds = new Set(rows.map((r) => r.id))
    const now = new Date().toISOString()
    let position = 0
    for (const id of body.ids) {
      if (!ownedIds.has(id)) continue
      await cfg.db.execute('UPDATE sadhana_tasks SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
        position++, now, id, ctx.user.id,
      ])
    }
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  app.delete('/tasks/:id', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE sadhana_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      now, now, task.id, ctx.user.id,
    ])
    return c.json({ ok: true, id: task.id, soft: true })
  })

  // Hard delete (0039): purge the task AND its satellite rows (tags, updates journal,
  // recurrence history) in one transaction — the soft-delete trail stays for the 7-day
  // undo window; this is the explicit "erase it for real" path.
  app.delete('/tasks/:id/hard', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(cfg.db, ctx.user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM sadhana_tags WHERE task_id = ?', [task.id])
      tx.sql('DELETE FROM sadhana_updates WHERE task_id = ?', [task.id])
      tx.sql('DELETE FROM sadhana_recur_history WHERE task_id = ?', [task.id])
      tx.sql('DELETE FROM sadhana_tasks WHERE id = ? AND user_id = ?', [task.id, ctx.user.id])
    })
    return c.json({ ok: true, id: task.id })
  })

  app.post('/tasks/:id/restore', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [c.req.param('id'), ctx.user.id],
    )
    if (!rows.length) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('UPDATE sadhana_tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      new Date().toISOString(), rows[0].id, ctx.user.id,
    ])
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // Clear a recurring task's completion log (0039) — resets the {n}× counter; the task
  // itself is untouched. NOTE: the deployed read out.meta?.changes, which is always
  // undefined on this Db abstraction ({changes, lastRowId}) — we report the real count.
  app.delete('/recur-history/:taskId', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      `SELECT st.id FROM sadhana_tasks st WHERE st.id = ? AND st.user_id = ?`,
      [c.req.param('taskId'), ctx.user.id],
    )
    if (!rows.length) return errJson(c, ErrorCode.not_found)
    const out = await cfg.db.execute('DELETE FROM sadhana_recur_history WHERE task_id = ?', [rows[0].id])
    return c.json({ ok: true, id: rows[0].id, removed: Number(out.changes ?? 0) })
  })
}
