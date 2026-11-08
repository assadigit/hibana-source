// src/routes/devboard/tasks.ts — S257 (the Phase 6 split of the former devboard.ts
// monolith): the dev-task write surface — CRUD + reorder + archive-done + task tags
// + dependencies. Behavior-neutral move; the split's dedups ride here:
//   - BE-14: PATCH's SET-builder rides the shared buildUpdate (was a local closure);
//   - BE-16: the project updated_at stamps ride touchProject;
//   - the archive-done link fold rides archives.ts's foldTagSnapshots (the shared
//     snapshot builder /finish uses too — the pin's own carve, owned by this split).
//
// Dates are AUTOMATIC by default — the core of the user's model: a task's timeline bar
// is created_at → done_at (done) or created_at → today (growing). done_at is stamped the
// moment status becomes 'done' and cleared when it leaves; nothing is date-picked.
// 0030 adds OPTIONAL manual overrides: dev_tasks.start_at/end_at trim or extend a clip's
// edges by dragging them (NULL = keep the automatic bar above).
//
// Scoping: every route resolves through the owning project first (rule 1) — a foreign
// project id (or task/category/sprint id from another user) is simply not found.

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
  ownedTask,
  categoryEnabledOnProject,
  ownedSprint,
  setTaskTags,
  findOrCreateTag, // S252 (BE-6/BE-12): the ONE shared race-safe + case-consistent tag resolver
  refreshTagUsage,
  syncTaskSearchTags,
  sprintStatusOf, // S240 (0065): lifecycle coalescing (lagging-D1 belt included)
  buildUpdate, // S257 (BE-14): the ONE SET-builder
  touchProject, // S257 (BE-16): the ONE project updated_at stamp
  type TaskTagJoin, // S252 (BE-5a): the archive-done link fold's row shape
} from '../devboard-helpers'
import { foldTagSnapshots } from './archives'
import {
  createDevTaskSchema,
  updateDevTaskSchema,
  devtaskReorderSchema, // S257 (BE-13): the renamed devboard reorder grammar
  tagBodySchema,
  createTaskDepSchema,
} from './schemas'

export function taskRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

  app.post('/api/projects/:projectId/devtasks', async (c) => {
    const body = await jsonBody<z.infer<typeof createDevTaskSchema>>(c, createDevTaskSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // category/sprint ids must be valid — a foreign id is a 400, not a 500. The
    // category (S152) must be a LIVE global category ENABLED on this project (the
    // single-select source is the project's picker set, block 3).
    const categoryOk = body.category_id ? await categoryEnabledOnProject(cfg, p.id, body.category_id) : true
    // S240 (0065 — spec §8/assumption 4): sprint validity + the completed-sprint
    // guard — a NEW task may not be assigned to a COMPLETED sprint (history is not
    // assignable). planned/active/paused stay assignable (assumption 3: paused is
    // allowed — the timeline model already lets tasks sit in any open-window sprint).
    if (body.sprint_id) {
      const target = await ownedSprint(cfg, user.id, body.sprint_id)
      if (!target) return errJson(c, ErrorCode.invalid_input)
      if (sprintStatusOf(target) === 'completed') return errJson(c, ErrorCode.sprint_completed, 400)
    }
    if (body.category_id && !categoryOk) return errJson(c, ErrorCode.invalid_input)
    // "Everything happens inside the active sprint": with no sprint_id in the body
    // (undefined — an explicit null still means "no sprint"), land the task in the
    // project's DRAFT sprint (0034 — the one being planned), else its open started
    // sprint if one exists (at most one can be open).
    let sprintId = body.sprint_id ?? null
    if (body.sprint_id === undefined) {
      const preferred = await cfg.db.query<{ id: string }>(
        'SELECT id FROM sprints WHERE project_id = ? AND is_draft = 1 ORDER BY created_at DESC LIMIT 1',
        [p.id],
      )
      if (preferred[0]) sprintId = preferred[0].id
      else {
        const open = await cfg.db.query<{ id: string }>(
          'SELECT id FROM sprints WHERE project_id = ? AND ended_at IS NULL AND is_draft = 0 ORDER BY started_at DESC LIMIT 1',
          [p.id],
        )
        if (open[0]) sprintId = open[0].id
      }
    }
    const id = uuid()
    const now = new Date().toISOString()
    const status = body.status ?? 'idea'
    await cfg.db.execute(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at, updated_at, due_at, due_origin_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.id, body.title, status, body.priority ?? 'medium', body.category_id ?? null, sprintId, now, status === 'done' ? now : null, body.start_at ?? null, body.end_at ?? null, now, body.due_at ?? null, body.due_at != null ? now : null],
    )
    // Labels ride the create (user request 2026-09-12): find-or-create + link, so a
    // fresh "UI/UX, Security" task is fully labeled in ONE round-trip.
    const linked = body.tags?.length ? await setTaskTags(cfg, user.id, id, body.tags) : []
    await touchProject(cfg, p.id, now) // S257 (BE-16): the one project-stamp helper
    await logHistory(cfg, p.id, t('Task added: {title}', 'کار جدید: {title}', { title: body.title }))
    return c.json({ ok: true, id, tags: linked }, 201)
  })

  app.post('/api/projects/:projectId/devtasks/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof devtaskReorderSchema>>(c, devtaskReorderSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // S255 (BE-25 — the stamp-coverage fix): reorder stamps updated_at on every
    // moved row. sort_order IS a payload column (the board's ORDER BY reads it),
    // so a reorder that stamped nothing would leave the board GET's version stamp
    // unchanged — a conditional poll could 304 past the new order. The 0061
    // doctrine ("every column edit stamps the task's updated_at") extends to the
    // one writer it never covered. Rows the body omits keep their stamps (the
    // client sends the full affected list; an untouched row's order didn't move).
    const now = new Date().toISOString()
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE dev_tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?', [i, now, id, p.id])
      })
    })
    return c.json({ ok: true })
  })

  app.patch('/api/devtasks/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateDevTaskSchema>>(c, updateDevTaskSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    if (body.category_id && !(await categoryEnabledOnProject(cfg, task.project_id, body.category_id))) return errJson(c, ErrorCode.invalid_input)
    // S240 (0065 — spec §8/assumption 4): the completed-sprint guard on RE-ASSIGNMENT.
    // A PATCH that MOVES the task to a completed sprint is rejected; re-asserting the
    // task's CURRENT sprint (the old Edit modal resends every field verbatim — a task
    // sitting in a finished sprint must stay editable) stays legal, as does an
    // explicit null (No sprint) and any planned/active/paused target.
    if (body.sprint_id) {
      const target = await ownedSprint(cfg, user.id, body.sprint_id)
      if (!target) return errJson(c, ErrorCode.invalid_input)
      if (target.id !== task.sprint_id && sprintStatusOf(target) === 'completed') return errJson(c, ErrorCode.sprint_completed, 400)
    }
    const now = new Date().toISOString()
    // tags is NOT a dev_tasks column (replace-set semantics on dev_task_tags) — pull it
    // out BEFORE the generic SET builder, or the loop below would emit SET tags = ?
    // and 500 with "no such column". due_at rides the same special-case road (its
    // origin column is server-derived, never body-driven) and due_origin_at rides
    // WITH it (the S245 §13.4 ride-along — server-derived except the one sanctioned
    // null→value transition, below).
    const { tags: tagNames, due_at: dueAt, due_origin_at: dueOriginAt, ...columns } = body
    // S257 (BE-14): the shared SET-builder — same grammar the inline loop had
    // (undefined skipped), with the special-case columns pushed after.
    // start_at/end_at (0030 clip trims) ride this same generic path as category_id/
    // sprint_id: a string sets the manual edge, an explicit null clears it (back to the
    // automatic created_at→done_at|today bar).
    const { sets, params, push } = buildUpdate(Object.entries(columns))
    // THE date rule (user model): entering 'done' stamps done_at = now (the timeline bar
    // freezes there); leaving 'done' clears it (the bar grows again). created_at never moves.
    if (body.status && body.status !== task.status) {
      if (body.status === 'done' && !task.done_at) {
        push('done_at', now)
        await logHistory(cfg, task.project_id, t('Done: {title}', 'تمام‌شده: {title}', { title: task.title }))
      } else if (body.status !== 'done' && task.done_at) {
        push('done_at', null)
      }
    }
    // S240 (0065 — spec §12.2/§13, the deadline-origin rules): null→value stamps
    // due_origin_at = now (FIRST assignment — the progress bar's start point);
    // value→different value PRESERVES the origin (an extension is not a re-assignment);
    // value→null CLEARS both (a later re-add starts a fresh timeline). value→same value
    // falls through the same branch as an edit — origin untouched.
    // S245 (§13.4): the null→value arm honors the client's due_origin_at ride-along
    // when one is sent (the J3 task-only-from-inherited flow preserving the SPRINT's
    // origin); without one it stamps now, exactly as before.
    if (dueAt !== undefined) {
      push('due_at', dueAt)
      if (dueAt === null) push('due_origin_at', null)
      else if (task.due_at == null) push('due_origin_at', dueOriginAt ?? now)
    }
    if (!sets.length && tagNames === undefined) return c.json({ ok: true })
    if (sets.length) {
      // 0061 (S126): every column edit stamps the task's own updated_at — the
      // overview's "recent = last-updated" sort reads this (the PROJECT stamp below
      // is project-level and can't tell two tasks in one project apart).
      push('updated_at', now)
      params.push(task.id)
      // SEC-11 (S198/S199): re-scope the write by owner (belt-and-suspenders with
      // ownedTask — the UPDATE itself can never touch a foreign row).
      params.push(user.id)
      await cfg.db.execute(`UPDATE dev_tasks SET ${sets.join(', ')} WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`, params)
    }
    // Labels ride the PATCH (replace-set): the response carries the task's FINAL tag
    // set (with server-assigned palette colors) so the client repaints chips truthfully.
    const appliedTags = tagNames !== undefined ? await setTaskTags(cfg, user.id, task.id, tagNames) : undefined
    await touchProject(cfg, task.project_id, now) // S257 (BE-16): the one project-stamp helper
    return c.json({ ok: true, tags: appliedTags })
  })

  app.delete('/api/devtasks/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    // S30 (B2): the dev_task_tags rows CASCADE away with the task — their tags' usage
    // counts must follow, or the label manager shows ghosts ("used 3×" for a dead link).
    const linked = await cfg.db.query<{ tag_id: string }>('SELECT tag_id FROM dev_task_tags WHERE task_id = ?', [task.id])
    await cfg.db.execute('DELETE FROM dev_tasks WHERE id = ?', [task.id])
    await refreshTagUsage(cfg, linked.map((r) => r.tag_id))
    await logHistory(cfg, task.project_id, t('Task removed: {title}', 'کار حذف شد: {title}', { title: task.title }))
    return c.json({ ok: true })
  })

  // Archive all done tasks in a project (user request 2026-09). Done tasks MOVE to the
  // project_archives table (permanent storage, viewable + restorable) — they're not
  // hard-deleted. This is the "Archive" button. Returns the count archived.
  app.post('/api/projects/:projectId/devtasks/archive-done', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const tasks = await cfg.db.query<{
      id: string; title: string; priority: string; category_id: string | null
      sprint_id: string | null; done_at: string | null; created_at: string
    }>(`SELECT id, title, priority, category_id, sprint_id, done_at, created_at FROM dev_tasks WHERE project_id = ? AND status = 'done'`, [p.id])
    if (tasks.length === 0) return c.json({ ok: true, archived: 0 })
    // S30 (B1): snapshot each task's LABELS into the archive row (names + colors, JSON)
    // BEFORE the dev_task_tags rows cascade away — restore relinks them by name, so a
    // done task comes back labeled, not stripped. Priority already survived; labels now
    // do too (the flat join is task_id-keyed, so group once per task here).
    // S252 (BE-5a): the link fetch filters SQL-side by the SAME done-task predicate
    // (no id IN list → no D1 param cap, and no over-fetch of every link in the
    // project), and the fold is Set-keyed — the old per-row tasks.find scan was the
    // audit's O(n²).
    // S257 (the split's carve): the fold itself rides archives.ts's foldTagSnapshots —
    // the SHARED snapshot builder /finish uses too (one fold, both archive flows).
    const links = await cfg.db.query<TaskTagJoin>(
      `SELECT tt.task_id, tg.id, tg.name, tg.color FROM dev_task_tags tt
       JOIN dev_tasks t ON t.id = tt.task_id JOIN tags tg ON tg.id = tt.tag_id
       WHERE t.project_id = ? AND t.status = 'done' ORDER BY tg.name`,
      [p.id],
    )
    const taskIds = new Set(tasks.map((tk) => tk.id))
    const { tagsByTask, touchedTagIds } = foldTagSnapshots(links, taskIds)
    const now = new Date().toISOString()
    // S252 (BE-10): snapshot INSERTs + the delete run in ONE cfg.db.transaction,
    // mirroring /finish's pattern. The old insert-loop-then-delete shape left
    // partial archive rows behind whenever anything failed between them — and a
    // retry then hit the task-id PRIMARY KEY conflict forever. Atomic now: any
    // failure rolls the whole move back (tasks stay on the board, no archive rows).
    // Reads stay OUTSIDE the tx (the Db transaction convention — write-only batch).
    await cfg.db.transaction(async (tx) => {
      for (const task of tasks) {
        const snapshot = tagsByTask.get(task.id) ?? []
        tx.sql(
          `INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?)`,
          [task.id, p.id, task.title, task.priority, task.category_id, task.sprint_id, task.done_at, task.created_at, now, JSON.stringify(snapshot)],
        )
      }
      // AP-20: chunked — archiving a done-task backlog can exceed 99 rows (D1 param cap).
      // (tx is the queued-statement Tx, so executeIn's Db-shaped helper can't ride
      // inside; the identical 99-id chunking runs inline.)
      for (let i = 0; i < tasks.length; i += 99) {
        const part = tasks.slice(i, i + 99)
        tx.sql(`DELETE FROM dev_tasks WHERE id IN (${part.map(() => '?').join(',')})`, part.map((tk) => tk.id))
      }
    })
    // S30 (B2): the cascade just removed the link rows — recompute those tags' usage.
    await refreshTagUsage(cfg, touchedTagIds)
    await touchProject(cfg, p.id, now) // S257 (BE-16): the one project-stamp helper
    await logHistory(cfg, p.id, t('{n} done tasks archived', '{n} کار انجام‌شده بایگانی شد', { n: String(tasks.length) }))
    return c.json({ ok: true, archived: tasks.length })
  })

  // ---- task tags (labels like "UI/UX" — find-or-create per user, then link) ----

  app.post('/api/devtasks/:id/tags', async (c) => {
    const body = await jsonBody<z.infer<typeof tagBodySchema>>(c, tagBodySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    // S252 (BE-6/BE-12): the shared find-or-create replaces this route's private
    // exact-match copy — race-safe on UNIQUE(user_id, name) (the H1 ON CONFLICT
    // recipe) and NOCASE-consistent with setTaskTags (no more "ui/ux" next to
    // "UI/UX"). Response shape unchanged: {ok:true,id}, 201.
    const tagId = await findOrCreateTag(cfg, user.id, body.name, body.color)
    await cfg.db.execute('INSERT OR IGNORE INTO dev_task_tags (task_id, tag_id) VALUES (?, ?)', [task.id, tagId])
    // S30 (B2 + B3): keep usage honest + the FTS text in step with the new link.
    await refreshTagUsage(cfg, [tagId])
    await syncTaskSearchTags(cfg, task.id)
    return c.json({ ok: true, id: tagId }, 201)
  })

  app.delete('/api/devtasks/:id/tags/:tagId', async (c) => {
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM dev_task_tags WHERE task_id = ? AND tag_id = ?', [task.id, c.req.param('tagId')])
    // S30 (B2 + B3): the link went away — usage and the FTS text follow.
    await refreshTagUsage(cfg, [c.req.param('tagId')])
    await syncTaskSearchTags(cfg, task.id)
    return c.json({ ok: true })
  })

  // ---- task dependencies (S240/0065 — spec pack §14-16) --------------------------
  // The user enters Blocked-by; the reverse "Blocks N" view is derived. Dependencies
  // are project-wide (cross-sprint links legal, cross-project NEVER — spec §14.1),
  // soft/informational constraints (assumption 2): they never block Kanban movement
  // and never mutate priority/status/sprint/deadline. The board payload carries the
  // links for rendering (Phase 2); these two endpoints are the write surface.

  app.post('/api/devtasks/:id/deps', async (c) => {
    const body = await jsonBody<z.infer<typeof createTaskDepSchema>>(c, createTaskDepSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    // Spec §14.2: a task may not depend on itself.
    if (body.blocker_id === task.id) return errJson(c, ErrorCode.invalid_input)
    // Spec §14.1: both ends must be the caller's tasks in the SAME project (a foreign
    // or cross-project id is a 400, not a 500 — the task-create sprint guard's shape).
    const blocker = await ownedTask(cfg, user.id, body.blocker_id)
    if (!blocker || blocker.project_id !== task.project_id) return errJson(c, ErrorCode.invalid_input)
    // Spec §14.2 — no cycles: adding X→Y closes a loop iff Y already (transitively)
    // BLOCKS X. The recursive CTE walks blocker→blocked edges from the blocked task;
    // hitting the would-be blocker means the reverse path already exists. UNION
    // dedupes the working set (the graph is acyclic, but the guard must not loop on
    // working-set repetition either).
    const cyc = await cfg.db.query<{ n: number }>(
      `WITH RECURSIVE reach(blocked) AS (
         SELECT blocked_task_id FROM dev_task_deps WHERE blocker_task_id = ?
         UNION
         SELECT d.blocked_task_id FROM dev_task_deps d JOIN reach r ON d.blocker_task_id = r.blocked
       ) SELECT COUNT(*) AS n FROM reach WHERE blocked = ?`,
      [task.id, body.blocker_id],
    )
    if ((cyc[0]?.n ?? 0) > 0) return errJson(c, ErrorCode.cycle, 409) // deliberate 409 (registry default 400 — vault folders' shape)
    // Idempotent re-add: the edge either exists (200, nothing written) or appears (201).
    const existing = await cfg.db.query<{ blocker_task_id: string }>(
      'SELECT blocker_task_id FROM dev_task_deps WHERE blocker_task_id = ? AND blocked_task_id = ?',
      [body.blocker_id, task.id],
    )
    if (existing.length) return c.json({ ok: true, existing: true })
    await cfg.db.execute('INSERT INTO dev_task_deps (blocker_task_id, blocked_task_id, created_at) VALUES (?, ?, ?)', [
      body.blocker_id, task.id, new Date().toISOString(),
    ])
    return c.json({ ok: true }, 201)
  })

  app.delete('/api/devtasks/:id/deps/:blockerId', async (c) => {
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    // Same shape as the tag-link DELETE: removing an absent edge is still a 200.
    await cfg.db.execute('DELETE FROM dev_task_deps WHERE blocker_task_id = ? AND blocked_task_id = ?', [
      c.req.param('blockerId'), task.id,
    ])
    return c.json({ ok: true })
  })

  return app
}
