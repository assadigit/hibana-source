// src/routes/devboard/strategies.ts — S257 (the Phase 6 split of the former
// devboard.ts monolith): the strategy CRUD. Behavior-neutral move; the split's
// dedups ride here: BE-14 (PATCH's SET-builder rides the shared buildUpdate).
//
// ---- strategies (S250/0066 — STRATEGIES-SPEC.md §4) -----------------------------
// The tier ABOVE sprints: Strategy (broad) → Sprint (a push) → Task. Every decision
// in the spec's §2 table is owner-approved. Assignment is optional, one-per-sprint,
// and sprints survive a strategy delete (the FK is ON DELETE SET NULL — the category
// delete grammar, not the project one).

import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody } from '../../lib/http'
import { getOwnedProject } from '../../lib/html'
import { trFor } from '../../lib/i18n'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow } from '../../types'
import {
  logHistory,
  ownedStrategy, // S250 (0066): user-scoped strategy resolution (STRATEGIES-SPEC §4)
  strategyNameTaken, // S250: case-insensitive project-scoped name uniqueness (the sprint grammar)
  uniqueViolationOn, // S253 (0067): the BE-8 catch-and-map — TOCTOU belt verdicts → the existing 409s
  buildUpdate, // S257 (BE-14): the ONE SET-builder
} from '../devboard-helpers'
import { createStrategySchema, updateStrategySchema } from './schemas'

export function strategyRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

  app.post('/api/projects/:projectId/strategies', async (c) => {
    const body = await jsonBody<z.infer<typeof createStrategySchema>>(c, createStrategySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // The sprint-name grammar (spec §4): case-insensitive uniqueness within the
    // project across ALL lifecycle states — a completed strategy still holds its name.
    if (await strategyNameTaken(cfg, p.id, body.name)) return errJson(c, ErrorCode.duplicate)
    const id = uuid()
    const now = new Date().toISOString()
    // S253 (0067 — BE-8 catch-and-map): the strategyNameTaken pre-check raced a
    // concurrent define; the belt answers the pre-check's own 409 (never a raw 500).
    try {
      await cfg.db.execute(
        'INSERT INTO strategies (id, project_id, name, description, priority, status, emoji, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        [id, p.id, body.name, body.description ?? '', body.priority ?? 'medium', 'active', body.emoji ?? null, now, now],
      )
    } catch (err) {
      if (uniqueViolationOn(err, 'idx_strategies_project_name')) return errJson(c, ErrorCode.duplicate)
      throw err
    }
    await logHistory(cfg, p.id, t('{name} strategy defined', 'استراتژی {name} تعریف شد', { name: body.name }))
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/strategies/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateStrategySchema>>(c, updateStrategySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const st = await ownedStrategy(cfg, user.id, c.req.param('id'))
    if (!st) return errJson(c, ErrorCode.not_found)
    // S250 (owner decision #9 — the completion guard): completing a strategy that
    // still has an ACTIVE sprint is refused — "Finish or pause its active sprint
    // first". Planned/paused sprints do NOT block (they are not running); reopening
    // and pausing are always free (no one-active-strategy invariant exists).
    if (body.status === 'completed' && st.status !== 'completed') {
      const active = await cfg.db.query<{ id: string }>(
        `SELECT s.id FROM sprints s WHERE s.strategy_id = ? AND s.status = 'active'`,
        [st.id],
      ).catch(() => [] as { id: string }[]) // 0066 belt: a pre-migration D1 has no strategy_id column
      if (active.length) return errJson(c, ErrorCode.strategy_active_sprint)
    }
    // The name gate (self-excluded — a re-assert of one's own name stays legal).
    if (body.name !== undefined && (await strategyNameTaken(cfg, st.project_id, body.name, st.id))) return errJson(c, ErrorCode.duplicate)
    const now = new Date().toISOString()
    const { sets, params, push } = buildUpdate() // S257 (BE-14): the ONE SET-builder
    if (body.name !== undefined) push('name', body.name)
    if (body.description !== undefined) push('description', body.description)
    if (body.emoji !== undefined) push('emoji', body.emoji)
    if (body.priority !== undefined) push('priority', body.priority)
    if (body.status !== undefined) push('status', body.status)
    if (!sets.length) return c.json({ ok: true })
    push('updated_at', now) // the D8 sync doctrine — every write stamps it
    params.push(st.id)
    // S253 (0067 — BE-8 catch-and-map): the rename pre-check raced a concurrent write;
    // the belt answers the pre-check's own 409 (never a raw 500).
    try {
      await cfg.db.execute(`UPDATE strategies SET ${sets.join(', ')} WHERE id = ?`, params)
    } catch (err) {
      if (uniqueViolationOn(err, 'idx_strategies_project_name')) return errJson(c, ErrorCode.duplicate)
      throw err
    }
    return c.json({ ok: true })
  })

  app.delete('/api/strategies/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const st = await ownedStrategy(cfg, user.id, c.req.param('id'))
    if (!st) return errJson(c, ErrorCode.not_found)
    // Hard delete behind the UI confirm (spec §2 decision #10): assigned sprints
    // fall back to unassigned via the FK's ON DELETE SET NULL — history survives.
    // "Complete" is the graceful exit that keeps the roll-up visible; delete is cleanup.
    await cfg.db.execute('DELETE FROM strategies WHERE id = ?', [st.id])
    await logHistory(cfg, st.project_id, t('{name} strategy deleted', 'استراتژی {name} حذف شد', { name: st.name }))
    return c.json({ ok: true })
  })

  return app
}
