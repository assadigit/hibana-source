// Dev-board + sprint roadmap API (user design 2026-08-29, "untitled scribbles").
//
// One task pool per project, viewed two ways: the progress board (idea → planned →
// in_progress → done, plus 'bug' reports) and the sprint timeline (categories × dates,
// open-ended sprints). 0034: a sprint is born a DRAFT (is_draft=1) that the timeline
// plans on; POST /start promotes it (closing the previous open sprint) — sprints are
// no longer auto-started at creation.
//
// Dates are AUTOMATIC by default — the core of the user's model: a task's timeline bar
// is created_at → done_at (done) or created_at → today (growing). done_at is stamped the
// moment status becomes 'done' and cleared when it leaves; nothing is date-picked.
// 0030 adds OPTIONAL manual overrides: dev_tasks.start_at/end_at trim or extend a clip's
// edges by dragging them (NULL = keep the automatic bar above), and sprint boundaries
// (started_at/ended_at) became draggable — always kept non-overlapping at day granularity,
// with at most ONE open sprint per project at any moment.
//
// Scoping: every route resolves through the owning project first (rule 1) — a foreign
// project id (or task/category/sprint id from another user) is simply not found.

import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { jsonBody, etag } from '../lib/http'
import { getOwnedProject, toastHtml } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { uuid } from '../lib/ids'
import { executeIn } from '../lib/inchunk'
import type { Config, UserRow, DevTaskRow, SprintRow, TagRow } from '../types'
import { categoriesUserScoped, isValidCatPair, normCatName, type CategoryRow } from '../lib/categories'
import { errJson, ErrorCode } from '../lib/errors'
import { hexColorSchema, EMOJI_TOKEN_RE } from '../validation/schemas'

const taskStatusSchema = z.enum(['idea', 'planned', 'in_progress', 'done', 'bug'])
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const hexColor = hexColorSchema
// 0030: any parseable date string — full ISO timestamps, matching every other *_at column
// (the timeline drags edges by the day but stores instants).
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'bad_date')

// A manually trimmed clip needs end strictly AFTER start. Only checked when BOTH edges
// are given in the same body (zod leaves absent keys absent, so a one-edge PATCH that
// keeps the stored other edge never trips this — the server can't judge a half-trim).
const clipRangeOk = (b: { start_at?: string | null; end_at?: string | null }) =>
  !(typeof b.start_at === 'string' && typeof b.end_at === 'string') || Date.parse(b.end_at!) > Date.parse(b.start_at!)

const createDevTaskSchema = z.object({
  // Session 22 (user request: "the limitation of 300 characters must be halted. it
  // must be unlimited"): was 2000 (Session 19's "effectively unlimited"). Now a pure
  // sanity guard at 100k — beyond any conceivable task title (and far under the
  // Workers body limit); the card display clamps at 150 chars + read-more, so long
  // titles stay sane in the UI. Zod stays on every endpoint (rule 10).
  title: z.string().trim().min(1).max(100_000),
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  category_id: z.string().max(64).nullable().optional(),
  sprint_id: z.string().max(64).nullable().optional(),
  start_at: isoDate.nullable().optional(),
  end_at: isoDate.nullable().optional(),
  // S240 (0065 — spec pack §9): the optional personal deadline (ISO-8601 instant;
  // date-only resolves to local 23:59 client-side). due_origin_at is SERVER-derived
  // (first assignment stamps it) and never accepted from a body.
  due_at: isoDate.nullable().optional(),
  // S29 follow-up (user request 2026-09-12): labels like "UI/UX", "Security" on the
  // task itself — find-or-create per user (0029's dev_task_tags), palette-colored.
  tags: z.array(z.string().trim().min(1).max(48)).max(12).optional(),
}).refine(clipRangeOk, { message: 'bad_range' })
const updateDevTaskSchema = z.object({
  title: z.string().trim().min(1).max(100_000).optional(), // Session 22: lifted 2000 → 100k sanity guard (matches createDevTaskSchema).
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  category_id: z.string().max(64).nullable().optional(),
  sprint_id: z.string().max(64).nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
  start_at: isoDate.nullable().optional(),
  end_at: isoDate.nullable().optional(),
  // S240 (0065 — spec pack §12.2/§13): PATCH semantics for the personal deadline:
  // null→value stamps due_origin_at (first assignment), value→different value keeps
  // the origin (an extension is NOT a re-assignment), value→null clears both (a later
  // re-add starts a fresh timeline). The rules run in the handler (they need the
  // stored row), not in zod.
  due_at: isoDate.nullable().optional(),
  // Replace-set semantics: an array makes the link set EXACTLY these names ([] clears);
  // omitted leaves tags untouched. Never a dev_tasks column — special-cased below.
  tags: z.array(z.string().trim().min(1).max(48)).max(12).optional(),
}).refine(clipRangeOk, { message: 'bad_range' })
const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color_fill: z.string().max(7),
  color_text: z.string().max(7),
})
// S152: rename/recolor/archive moved to routes/categories.ts (the global library is
// the ONE system after 0062 — the devboard's per-project CRUD retired).
// 0052 (Session 33 — user request: «اسپرینت جدید» CTA → name/version/description modal →
// full-screen rich editor): a sprint carries a version label + a rich markdown doc.
// The description IS the editor's subject — seeded by the modal box, edited in the
// full-screen editor, autosaved via PATCH. 100k matches the task-title sanity guard.
// S235 (the sprint audit): the sprint-range sanity guard — mirrors clipRangeOk
// but for the sprint's started_at/ended_at fields. Without this, a POST create
// with started_at > ended_at succeeds at INSERT (the timeline then renders a
// negative-width strip). The PATCH branch already checks this inline (L655);
// the POST branch did not — the audit's §4.3 gap.
const sprintRangeOk = (b: { started_at?: string | null; ended_at?: string | null }) =>
  !(typeof b.started_at === 'string' && typeof b.ended_at === 'string') || Date.parse(b.ended_at!) > Date.parse(b.started_at!)
// S240 (0065 — spec pack §4.2): the sprint's optional emoji identity — one picker
// glyph (the SAME token contract as spark folders/vault icons), never markup.
const sprintEmoji = z.string().trim().max(16).regex(EMOJI_TOKEN_RE).nullish()
const createSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  version: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(100_000).optional(),
  emoji: sprintEmoji,
  // S240 (0065 — spec pack §9): the optional sprint-level deadline. due_origin_at
  // is SERVER-derived (stamped on first assignment) and never accepted from a body.
  due_at: isoDate.nullable().optional(),
  // S48n: optional start/end dates. If both provided, the sprint is created
  // as STARTED (is_draft=0) with these dates — skips the draft step. The
  // presets (24h/48h/72h/1w/2w/1m) compute end = start + duration.
  started_at: isoDate.optional(),
  ended_at: isoDate.nullable().optional(),
}).refine(sprintRangeOk, { message: 'bad_range' }) // S235: reject end <= start at create time
const updateSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  version: z.string().trim().min(1).max(40).nullable().optional(), // explicit null clears the label
  description: z.string().max(100_000).optional(),
  emoji: sprintEmoji, // S240: explicit null clears the emoji back to the default glyph
  due_at: isoDate.nullable().optional(), // S240: null→value stamps the origin; value→value keeps it; null clears both
  started_at: isoDate.optional(),
  ended_at: isoDate.nullable().optional(), // explicit null = reopen this sprint's end
})
const reorderSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(500) })
const tagBodySchema = z.object({ name: z.string().trim().min(1).max(60), color: hexColor.optional() })
// S240 (0065 — spec pack §14): one Blocked-by edge. The blocker is a task id in the
// SAME project (cross-project is rejected in the handler via ownedTask on both ends —
// a foreign id is a 400, never a 500). Self-edges and cycles are handler-guarded too.
const createTaskDepSchema = z.object({ blocker_id: z.string().max(64) })
// 0033 — backlog «برنامه آتی» plan docs: long-form planning entries per project, each
// save appending a revision row (backlog_doc_revisions) that feeds the history list.
const createBacklogDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(50_000),
})
const updateBacklogDocSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(50_000).optional(),
})

// S235: dayIdx moved to devboard-helpers.ts (assertSprintWindowOk uses it).
// The inline overlap check that used it here was lifted into the shared helper.


import {
  logHistory,
  ownedTask,
  categoryEnabledOnProject,
  ownedSprint,
  ownedBacklogDoc,
  loadBacklog,
  setTaskTags,
  taskTagsForProject,
  tagColorFor,
  refreshTagUsage,
  syncTaskSearchTags,
  PRIO_ORDER_SQL,
  assertSprintWindowOk, // S235: the shared overlap check (audit §4.2)
  sprintStatusOf, // S240 (0065): lifecycle coalescing (lagging-D1 belt included)
  findActiveSprint, // S240 (0065): the one-active lookup (spec §5.1)
  sprintNameTaken, // S240 (0065): case-insensitive project-scoped name uniqueness (§4.3)
  taskDepsForProject, // S241 (0065 read surface): the flat per-project dep edge join (§15)
  boardTaskRows, // S241: task rows + the server-computed effective deadline (§10/§18)
} from './devboard-helpers'

export function devboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // ---- one payload for every surface (board page, sprint page, detail preview) ----
  app.get('/api/projects/:projectId/devboard', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const [tasks, sprints, tags, taskTags, categories, taskDeps] = await Promise.all([
      cfg.db.query<DevTaskRow & { tags: string; shot_count: number }>(
        // S29 follow-up: PRIORITY-FIRST ordering — tasks auto-sort urgent → high →
        // medium → low inside every column (sort_order = manual drag still orders
        // within the same priority tier).
        // S208 (kanban task-option parity): every task row carries its PIN COUNT —
        // the screenshots pinned via screenshots.task_id (0054). The board cards
        // render the same .pd-task-shots badge the project page's cards do; a
        // pre-0054 D1 (no task_id column) degrades to 0 via the COALESCE belt.
        `SELECT t.*, COALESCE((SELECT GROUP_CONCAT(tt.tag_id) FROM dev_task_tags tt WHERE tt.task_id = t.id), '') AS tags,
           COALESCE((SELECT COUNT(*) FROM screenshots sc WHERE sc.task_id = t.id), 0) AS shot_count
         FROM dev_tasks t WHERE t.project_id = ? ORDER BY ${PRIO_ORDER_SQL}, t.sort_order, t.created_at`,
        [p.id],
      ).catch(async () =>
        // 0054 belt: a D1 that pre-dates the screenshots.task_id column serves the
        // payload WITHOUT the badge field rather than 500ing the whole board.
        cfg.db.query<DevTaskRow & { tags: string; shot_count: number }>(
          `SELECT t.*, COALESCE((SELECT GROUP_CONCAT(tt.tag_id) FROM dev_task_tags tt WHERE tt.task_id = t.id), '') AS tags,
             0 AS shot_count
           FROM dev_tasks t WHERE t.project_id = ? ORDER BY ${PRIO_ORDER_SQL}, t.sort_order, t.created_at`,
          [p.id],
        ),
      ),
      cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? ORDER BY started_at', [p.id]),
      cfg.db.query<TagRow>('SELECT t.* FROM tags t WHERE t.user_id = ? ORDER BY t.name', [user.id]),
      taskTagsForProject(cfg, p.id),
      // S152: the GLOBAL library's rows this project can see — every ENABLED
      // category (the picker/toggle set) UNION every category its tasks already
      // reference (disabled later → the chip still resolves; history intact).
      // `enabled` lets the client split the picker set from the chip set.
      cfg.db.query<CategoryRow & { enabled: number }>(
        `SELECT c.*, CASE WHEN c.is_archived = 1 THEN 0 ELSE COALESCE((SELECT 1 FROM project_categories pc WHERE pc.category_id = c.id AND pc.project_id = ?), 0) END AS enabled
         FROM categories c
         -- S152/block 8: archived rows STAY in the payload when a task still references
         -- them (the chip keeps rendering — history visible); they carry enabled = 0
         -- so the pickers and toggles exclude them from NEW selections.
         WHERE c.id IN (SELECT category_id FROM dev_tasks WHERE project_id = ? AND category_id IS NOT NULL)
            OR (c.is_archived = 0 AND c.id IN (SELECT category_id FROM project_categories WHERE project_id = ?))
         ORDER BY c.name COLLATE NOCASE, c.created_at`,
        [p.id, p.id, p.id],
      ).catch(() => []), // 0062 belt: a D1 pre-migration has no categories table — chip-less, not broken
      // S241 (spec §15 — D8): the 7th additive payload key — the flat per-project
      // blocker→blocked edge join (own lagging-D1 [] belt inside the helper).
      taskDepsForProject(cfg, p.id),
    ])
    return await etag(c, c.json({
      project: { id: p.id, title: p.title, status: p.status, type: p.type },
      // S241 (spec §10/§18): task rows carry the server-computed effective deadline
      // (personal > sprint-inherited-while-not-completed > none) — additive fields,
      // every legacy key intact (pinned by the S241 island-shape test).
      tasks: boardTaskRows(tasks, sprints),
      categories,
      sprints,
      tags,
      // Flat per-task label join ({task_id, id, name, color}) — one query, joined
      // client-side by whoever renders cards.
      task_tags: taskTags,
      // S241: flat dep edges ({blocker_task_id, blocked_task_id}) — the client folds
      // Blocked-by and the reverse Blocks-N counts by task (spec §15).
      task_deps: taskDeps,
    }))
  })

  // ---- dev tasks --------------------------------------------------------------

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
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    await logHistory(cfg, p.id, t('Task added: {title}', 'کار جدید: {title}', { title: body.title }))
    return c.json({ ok: true, id, tags: linked }, 201)
  })

  app.post('/api/projects/:projectId/devtasks/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE dev_tasks SET sort_order = ? WHERE id = ? AND project_id = ?', [i, id, p.id])
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
    // origin column is server-derived, never body-driven).
    const { tags: tagNames, due_at: dueAt, ...columns } = body
    const sets: string[] = []
    const params: unknown[] = []
    // start_at/end_at (0030 clip trims) ride this same generic path as category_id/
    // sprint_id: a string sets the manual edge, an explicit null clears it (back to the
    // automatic created_at→done_at|today bar).
    for (const [k, v] of Object.entries(columns)) {
      if (v === undefined) continue
      sets.push(`${k} = ?`)
      params.push(v)
    }
    // THE date rule (user model): entering 'done' stamps done_at = now (the timeline bar
    // freezes there); leaving 'done' clears it (the bar grows again). created_at never moves.
    if (body.status && body.status !== task.status) {
      if (body.status === 'done' && !task.done_at) {
        sets.push('done_at = ?')
        params.push(now)
        await logHistory(cfg, task.project_id, t('Done: {title}', 'تمام‌شده: {title}', { title: task.title }))
      } else if (body.status !== 'done' && task.done_at) {
        sets.push('done_at = ?')
        params.push(null)
      }
    }
    // S240 (0065 — spec §12.2/§13, the deadline-origin rules): null→value stamps
    // due_origin_at = now (FIRST assignment — the progress bar's start point);
    // value→different value PRESERVES the origin (an extension is not a re-assignment);
    // value→null CLEARS both (a later re-add starts a fresh timeline). value→same value
    // falls through the same branch as an edit — origin untouched.
    if (dueAt !== undefined) {
      sets.push('due_at = ?')
      params.push(dueAt)
      if (dueAt === null) {
        sets.push('due_origin_at = ?')
        params.push(null)
      } else if (task.due_at == null) {
        sets.push('due_origin_at = ?')
        params.push(now)
      }
    }
    if (!sets.length && tagNames === undefined) return c.json({ ok: true })
    if (sets.length) {
      // 0061 (S126): every column edit stamps the task's own updated_at — the
      // overview's "recent = last-updated" sort reads this (the PROJECT stamp below
      // is project-level and can't tell two tasks in one project apart).
      sets.push('updated_at = ?')
      params.push(now)
      params.push(task.id)
      // SEC-11 (S198/S199): re-scope the write by owner (belt-and-suspenders with
      // ownedTask — the UPDATE itself can never touch a foreign row).
      params.push(user.id)
      await cfg.db.execute(`UPDATE dev_tasks SET ${sets.join(', ')} WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`, params)
    }
    // Labels ride the PATCH (replace-set): the response carries the task's FINAL tag
    // set (with server-assigned palette colors) so the client repaints chips truthfully.
    const appliedTags = tagNames !== undefined ? await setTaskTags(cfg, user.id, task.id, tagNames) : undefined
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, task.project_id])
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
    const links = await taskTagsForProject(cfg, p.id)
    const tagsByTask = new Map<string, { name: string; color: string }[]>()
    for (const row of links) {
      const onlyDone = tasks.find((tk) => tk.id === row.task_id)
      if (!onlyDone) continue // only the tasks being archived carry links
      const list = tagsByTask.get(row.task_id) ?? []
      list.push({ name: row.name, color: row.color })
      tagsByTask.set(row.task_id, list)
    }
    const now = new Date().toISOString()
    // Insert into project_archives, then delete from dev_tasks (the dev_task_tags rows
    // cascade via ON DELETE CASCADE — the snapshot above is what preserves the labels).
    const touchedTagIds = links.filter((l) => tagsByTask.has(l.task_id)).map((l) => l.id)
    for (const task of tasks) {
      const snapshot = tagsByTask.get(task.id) ?? []
      await cfg.db.execute(
        `INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?)`,
        [task.id, p.id, task.title, task.priority, task.category_id, task.sprint_id, task.done_at, task.created_at, now, JSON.stringify(snapshot)],
      )
    }
    const ids = tasks.map((t) => t.id)
    // AP-20: chunked — archiving a done-task backlog can exceed 99 rows (D1 param cap).
    await executeIn(cfg.db, 'DELETE FROM dev_tasks WHERE id IN {{IN}}', [], ids)
    // S30 (B2): the cascade just removed the link rows — recompute those tags' usage.
    await refreshTagUsage(cfg, touchedTagIds)
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    await logHistory(cfg, p.id, t('{n} done tasks archived', '{n} کار انجام‌شده بایگانی شد', { n: String(tasks.length) }))
    return c.json({ ok: true, archived: tasks.length })
  })

  // GET the archives for a project — the permanent record of archived done tasks.
  // S30 (B1): the rows carry their label snapshots (names + colors) so the archive UI
  // can render the chips exactly as they were the day the task was archived.
  app.get('/api/projects/:projectId/archives', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const rows = await cfg.db.query<{
      id: string; title: string; priority: string; done_at: string | null
      original_created_at: string; archived_at: string; tags: string
    }>(`SELECT id, title, priority, done_at, original_created_at, archived_at, tags FROM project_archives WHERE project_id = ? ORDER BY archived_at DESC`, [p.id])
    let parsed: { name: string; color: string }[][] = rows.map(() => [])
    try {
      parsed = rows.map((r) => {
        const arr = JSON.parse(r.tags || '[]')
        return Array.isArray(arr) ? arr.filter((x) => x && typeof x.name === 'string') : []
      })
    } catch {
      // pre-0051 rows carry '[]' or garbage — parse failures degrade to no labels
    }
    return c.json({ archives: rows.map((r, i) => ({ id: r.id, title: r.title, priority: r.priority, done_at: r.done_at, original_created_at: r.original_created_at, archived_at: r.archived_at, tags: parsed[i] })) })
  })

  // Restore an archived task back to the dev_tasks table (as 'done' status). The task
  // reappears on the board's Done column. Removes it from project_archives.
  // S30 (B1): the label snapshot rides along — find-or-create by name (setTaskTags),
  // so restore comes back LABELED. Colors: an existing tag keeps its CURRENT color; a
  // name that no longer exists re-creates with the snapshot's color.
  app.post('/api/projects/:projectId/archives/:aid/restore', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const aid = c.req.param('aid')
    const rows = await cfg.db.query<{
      id: string; title: string; priority: string; category_id: string | null
      sprint_id: string | null; done_at: string | null; original_created_at: string; tags: string
    }>(`SELECT id, title, priority, category_id, sprint_id, done_at, original_created_at, tags FROM project_archives WHERE id = ? AND project_id = ?`, [aid, p.id])
    if (rows.length === 0) return errJson(c, ErrorCode.not_found)
    const a = rows[0]
    const now = new Date().toISOString()
    // Re-insert into dev_tasks (status='done'). sort_order = max+1 to put it at the end.
    // AP-27 belt-and-suspenders: LEGACY archive rows (written before the delete-flow
    // fix) can still carry dangling category/sprint ids — re-inserting those would hit
    // the dev_tasks FKs and 500 forever. Keep only ids that still exist.
    if (a.category_id) {
      const cat = await cfg.db.query('SELECT 1 AS ok FROM categories WHERE id = ?', [a.category_id])
      if (cat.length === 0) a.category_id = null
    }
    if (a.sprint_id) {
      const spr = await cfg.db.query('SELECT 1 AS ok FROM sprints WHERE id = ?', [a.sprint_id])
      if (spr.length === 0) a.sprint_id = null
    }
    const maxOrder = await cfg.db.query<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM dev_tasks WHERE project_id = ?`, [p.id])
    const nextOrder = (maxOrder[0]?.m ?? -1) + 1
    await cfg.db.execute(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, p.id, a.title, a.priority, a.category_id, a.sprint_id, nextOrder, a.original_created_at, a.done_at ?? now, now],
    )
    // B1 relink: parse the snapshot (tolerating pre-0051 '[]') and set the link set —
    // setTaskTags also refreshes usage + search_tags for the restored task.
    let names: string[] = []
    try {
      const arr = JSON.parse(a.tags || '[]')
      if (Array.isArray(arr)) names = arr.filter((x) => x && typeof x.name === 'string').map((x) => String(x.name).slice(0, 48))
    } catch { /* degraded snapshot — restore without labels */ }
    if (names.length) await setTaskTags(cfg, user.id, a.id, names)
    await cfg.db.execute('DELETE FROM project_archives WHERE id = ? AND project_id = ?', [aid, p.id])
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    return c.json({ ok: true, tags: names })
  })

  // Permanently delete an archived task (no restore). The "delete from archive" action.
  app.delete('/api/projects/:projectId/archives/:aid', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM project_archives WHERE id = ? AND project_id = ?', [c.req.param('aid'), p.id])
    return c.json({ ok: true })
  })

  // ---- task tags (labels like "UI/UX" — find-or-create per user, then link) ----

  app.post('/api/devtasks/:id/tags', async (c) => {
    const body = await jsonBody<z.infer<typeof tagBodySchema>>(c, tagBodySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    const found = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE user_id = ? AND name = ?', [user.id, body.name])
    const tagId = found[0]?.id ?? uuid()
    if (!found.length) {
      await cfg.db.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', [
        tagId, user.id, body.name, body.color ?? (await tagColorFor(cfg, user.id)), now,
      ])
    }
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

  // ---- categories (S152: the library — create + enable in one beat) ----
  // The inline quick-add path (block 4): creates the category in the caller's
  // library (16-tile pair validated) AND enables it on this project in the same
  // request, so the composer never detours to Settings. A live case/trim-
  // insensitive name match IN THE CALLER'S OWN library (S181: user-scoped —
  // another user's same-named row must NOT be attached to this project) is
  // REUSED (enabled on this project + returned) instead of forking a duplicate.
  app.post('/api/projects/:projectId/categories', async (c) => {
    const body = await jsonBody<z.infer<typeof createCategorySchema>>(c, createCategorySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    if (!isValidCatPair(body.color_fill, body.color_text)) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const name = body.name.trim()
    if (!name) return errJson(c, ErrorCode.invalid_input)
    const scoped = await categoriesUserScoped(cfg.db)
    const existing = scoped
      ? await cfg.db.query<{ id: string }>(
          'SELECT id FROM categories WHERE user_id = ? AND lower(trim(name)) = ? AND is_archived = 0 LIMIT 1',
          [user.id, normCatName(name)],
        )
      : await cfg.db.query<{ id: string }>(
          'SELECT id FROM categories WHERE lower(trim(name)) = ? AND is_archived = 0 LIMIT 1',
          [normCatName(name)],
        )
    if (existing[0]) {
      await cfg.db.execute('INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)', [p.id, existing[0].id])
      return c.json({ ok: true, id: existing[0].id, existing: true }, 200)
    }
    const id = uuid()
    if (scoped) {
      await cfg.db.execute(
        'INSERT INTO categories (id, user_id, name, color_fill, color_text, is_archived, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [id, user.id, name, body.color_fill.toUpperCase(), body.color_text.toUpperCase(), new Date().toISOString()],
      )
    } else {
      await cfg.db.execute(
        'INSERT INTO categories (id, name, color_fill, color_text, is_archived, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        [id, name, body.color_fill.toUpperCase(), body.color_text.toUpperCase(), new Date().toISOString()],
      )
    }
    await cfg.db.execute('INSERT INTO project_categories (project_id, category_id) VALUES (?, ?)', [p.id, id])
    return c.json({ ok: true, id }, 201)
  })

  // S152: PATCH/DELETE /api/categories/:id + POST /api/projects/:projectId/categories/reorder
  // are RETIRED from this module — the global library serves rename/recolor/archive
  // (routes/categories.ts) and the library reads name-ordered (no reorder). The
  // legacy per-project rows folded into the library in 0062; two systems writing one
  // dev_tasks.category_id column would corrupt each other's UX.

  // ---- sprints (open-ended: start = creation day, end = whenever the user says) --

  app.post('/api/projects/:projectId/sprints', async (c) => {
    const body = await jsonBody<z.infer<typeof createSprintSchema>>(c, createSprintSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const id = uuid()
    const now = new Date().toISOString()
    const count = await cfg.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM sprints WHERE project_id = ?', [p.id])
    let name = body.name ?? `Sprint ${(count[0]?.n ?? 0) + 1}`
    // S240 (0065 — spec §4.3): the auto-generated name must ALSO clear the NEW
    // case-insensitive uniqueness rule — bump past any collision instead of 409ing a
    // nameless create (the legacy timeline creates drafts with no name; old clients
    // must keep getting 201s). Bounded: 50 tries, then the duplicate answer wins.
    if (body.name === undefined) {
      for (let bump = 1; bump <= 50 && (await sprintNameTaken(cfg, p.id, name)); bump++) {
        name = `Sprint ${(count[0]?.n ?? 0) + 1 + bump}`
      }
    }
    // 0034: sprints are created as DRAFTS (is_draft=1) — the timeline plans on the draft
    // and /start promotes it. One draft at a time per project; starting it is a separate,
    // explicit step (no more auto-starting on create).
    const draft = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sprints WHERE project_id = ? AND is_draft = 1',
      [p.id],
    )
    if (draft.length) return c.json({ error: ErrorCode.draft_exists, draft_id: draft[0].id }, 409)
    // S240 (0065 — spec §4.3): case-insensitive name uniqueness within the project
    // across ALL lifecycle states (a finished sprint still holds its name — history).
    // Legacy case-twins are never reconciled by the migration; this write-time gate
    // is the rule (pack D1/IMPLEMENTATION-STATUS assumption 6e).
    if (await sprintNameTaken(cfg, p.id, name)) return errJson(c, ErrorCode.duplicate)
    // S48n: if started_at is provided, create the sprint as STARTED (is_draft=0) with
    // the chosen dates + close any currently open sprint first. Otherwise, create as
    // a DRAFT (is_draft=1, started_at=now, ended_at=NULL — the user starts it later).
    const hasDates = body.started_at != null
    if (hasDates) {
      // Close any open sprint first (same logic as /start). S240 (0065): only the
      // ACTIVE open sprint is auto-closed (stamped ended_at + status='completed' —
      // the legacy timeline mechanic, kept byte-compatible for old clients; the
      // explicit POST /finish is the archiving path, this auto-close archives
      // NOTHING). A PAUSED sibling keeps its open window and does NOT block the
      // new sprint (the D1 resolution — assertSprintWindowOk skips paused bands).
      const activeSprint = await findActiveSprint(cfg, p.id)
      if (activeSprint) {
        const startMs = Date.parse(body.started_at!)
        const dayBefore = startMs - 86400000
        const closeMs = Math.max(dayBefore, Date.parse(activeSprint.started_at))
        await cfg.db.execute("UPDATE sprints SET ended_at = ?, status = 'completed', updated_at = ? WHERE id = ?", [
          new Date(closeMs).toISOString(), now, activeSprint.id,
        ])
      }
      const startedAt = body.started_at!
      const endedAt = body.ended_at ?? null
      // S235 (audit §4.2): the overlap check — was MISSING on the POST-create-
      // with-dates path (only PATCH had it). A user could create a sprint that
      // overlaps an existing closed sprint's date range. Now the shared helper
      // catches it (sprintId=null — new sprint, don't exclude self).
      const windowOk = await assertSprintWindowOk(cfg, p.id, null, startedAt, endedAt)
      if (!windowOk) return errJson(c, ErrorCode.invalid_input)
      // S240: a created-with-both-dates sprint is a CLOSED window = completed (the
      // backfill's mapping, kept true by every writer); started-only = active.
      await cfg.db.execute(
        `INSERT INTO sprints (id, project_id, name, version, description, started_at, ended_at, is_draft, created_at, status, emoji, due_at, due_origin_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [id, p.id, name, body.version ?? null, body.description ?? '', startedAt, endedAt, now, endedAt != null ? 'completed' : 'active', body.emoji ?? null, body.due_at ?? null, body.due_at != null ? now : null, now],
      )
      await logHistory(cfg, p.id, t('{name} started', '{name} شروع شد', { name }))
      return c.json({ ok: true, id, name, version: body.version ?? null, draft: false }, 201)
    }
    await cfg.db.execute(
      `INSERT INTO sprints (id, project_id, name, version, description, started_at, ended_at, is_draft, created_at, status, emoji, due_at, due_origin_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, 'planned', ?, ?, ?, ?)`,
      [id, p.id, name, body.version ?? null, body.description ?? '', now, now, body.emoji ?? null, body.due_at ?? null, body.due_at != null ? now : null, now],
    )
    await logHistory(cfg, p.id, t('{name} defined', '{name} تعریف شد', { name }))
    return c.json({ ok: true, id, name, version: body.version ?? null, draft: true }, 201)
  })

  app.post('/api/sprints/:id/start', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    const status = sprintStatusOf(s)
    // S240 (0065 — spec §5.2): start promotes planned → active, and accepts a PAUSED
    // sprint as a resume (the window survives — only the lifecycle flips). The legacy
    // 0034 guard stays: an already-started sprint (active OR completed — old clients
    // byte-identically got already_started for both) can't start again.
    if (status !== 'planned' && status !== 'paused') return errJson(c, ErrorCode.already_started)
    const now = new Date().toISOString()
    // S240 (0065 — spec §5.1/§5.2 — one-active, the pack's D1): starting while ANOTHER
    // sprint is active is a 409 carrying the active sprint's id, NEVER a silent
    // auto-close (the old /start closed the open sibling; the Phase 4 UI resolves the
    // conflict with the finish-or-pause modal). The partial unique index
    // idx_sprints_one_active is the belt if two writes race this check on D1.
    const active = await findActiveSprint(cfg, s.project_id)
    if (active && active.id !== s.id) return c.json({ error: ErrorCode.sprint_active_exists, active_id: active.id }, 409)
    if (status === 'paused') {
      // Resume semantics (POST /api/sprints/:id/resume performs the same move): the
      // started_at/ended_at window is history and stays put — spec §5.5 (pausing never
      // touches the window; resuming doesn't re-stamp the start).
      await cfg.db.execute("UPDATE sprints SET status = 'active', updated_at = ? WHERE id = ?", [now, s.id])
      await logHistory(cfg, s.project_id, t('{name} resumed', '{name} از سر گرفته شد', { name: s.name }))
      return c.json({ ok: true })
    }
    // S235 (audit §4.2): the overlap check — was MISSING on /start. Starting a
    // sprint "now" with no end (open) could land "now" INSIDE an existing closed
    // sprint's [started_at, ended_at] range. The shared helper catches this
    // (newEnd=null → treated as +∞; the overlap fires if any closed sibling's
    // range includes "now"). sprintId=s.id — exclude self from the sibling scan.
    const startWindowOk = await assertSprintWindowOk(cfg, s.project_id, s.id, now, null)
    if (!startWindowOk) return errJson(c, ErrorCode.invalid_input)
    await cfg.db.execute("UPDATE sprints SET started_at = ?, ended_at = NULL, is_draft = 0, status = 'active', updated_at = ? WHERE id = ?", [now, now, s.id])
    await logHistory(cfg, s.project_id, t('{name} started', '{name} شروع شد', { name: s.name }))
    return c.json({ ok: true })
  })

  // S240 (0065 — spec §5.5): pause an ACTIVE sprint. The window (ended_at stays
  // NULL — the timeline band survives), the task associations and every task's Kanban
  // status are untouched; the due date + origin stay defined while paused.
  app.post('/api/sprints/:id/pause', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    if (sprintStatusOf(s) !== 'active') return errJson(c, ErrorCode.invalid_input)
    const now = new Date().toISOString()
    await cfg.db.execute("UPDATE sprints SET status = 'paused', updated_at = ? WHERE id = ?", [now, s.id])
    await logHistory(cfg, s.project_id, t('{name} paused', '{name} متوقف شد', { name: s.name }))
    return c.json({ ok: true })
  })

  // S240 (0065 — spec §5.2/§5.5): resume a PAUSED sprint, subject to the one-active
  // rule (a 409 with the active sprint's id — never a silent replacement).
  app.post('/api/sprints/:id/resume', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    if (sprintStatusOf(s) !== 'paused') return errJson(c, ErrorCode.invalid_input)
    const now = new Date().toISOString()
    const active = await findActiveSprint(cfg, s.project_id)
    if (active && active.id !== s.id) return c.json({ error: ErrorCode.sprint_active_exists, active_id: active.id }, 409)
    await cfg.db.execute("UPDATE sprints SET status = 'active', updated_at = ? WHERE id = ?", [now, s.id])
    await logHistory(cfg, s.project_id, t('{name} resumed', '{name} از سر گرفته شد', { name: s.name }))
    return c.json({ ok: true })
  })

  app.patch('/api/sprints/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateSprintSchema>>(c, updateSprintSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    // S240 (0065 — spec §4.3): the case-insensitive name gate on RENAME. A sprint
    // may re-assert its OWN name (the old flows resend fields verbatim); every other
    // project sibling — in ANY lifecycle state — holds it.
    if (body.name !== undefined && (await sprintNameTaken(cfg, s.project_id, body.name, s.id))) return errJson(c, ErrorCode.duplicate)
    // The deadline-origin rules (§12.2/§13 — same shape the task PATCH carries):
    // null→value stamps due_origin_at; value→value PRESERVES it (an extension is not
    // a re-assignment); null CLEARS both (a re-add starts a fresh timeline).
    const dueOriginSet = (push: (col: string, val: unknown) => void) => {
      if (body.due_at === undefined) return
      push('due_at', body.due_at)
      if (body.due_at === null) push('due_origin_at', null)
      else if (s.due_at == null) push('due_origin_at', now)
    }
    // A draft carries name + version + its doc (0034 + 0052) — its dates are set by
    // /start, never by PATCH. description (the full-screen editor's subject) is ALWAYS
    // writable; an empty string is a legal empty doc (the modal seeds an empty one).
    if (s.is_draft) {
      if (body.started_at !== undefined || body.ended_at !== undefined) return errJson(c, ErrorCode.invalid_input)
      const sets: string[] = []
      const params: unknown[] = []
      const push = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val) }
      if (body.name !== undefined) push('name', body.name)
      if (body.version !== undefined) push('version', body.version)
      if (body.description !== undefined) push('description', body.description)
      if (body.emoji !== undefined) push('emoji', body.emoji)
      dueOriginSet(push)
      if (!sets.length) return c.json({ ok: true })
      push('updated_at', now) // S240 (D8): every sprint PATCH stamps updated_at
      params.push(s.id)
      await cfg.db.execute(`UPDATE sprints SET ${sets.join(', ')} WHERE id = ?`, params)
      return c.json({ ok: true })
    }
    const siblings = await cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? AND is_draft = 0 ORDER BY started_at', [s.project_id])
    const newStart = body.started_at ?? s.started_at
    const newEnd = body.ended_at === undefined ? s.ended_at : body.ended_at
    // A set end must be strictly after the start — a zero/negative sprint is invalid.
    if (typeof newEnd === 'string' && Date.parse(newEnd) <= Date.parse(newStart)) {
      return errJson(c, ErrorCode.invalid_input)
    }
    // Reopening (a SET end → null — re-asserting an already-open end no longer runs
    // the guards, and never flips a paused sprint active): only the LATEST sprint by
    // started_at may be open, and only while no OTHER sprint is ACTIVE — S240 (0065)
    // turned the one-open-window rule into the one-ACTIVE rule (a paused sibling's
    // open window no longer blocks a reopen; the D1 resolution).
    if (newEnd === null && s.ended_at !== null) {
      const others = siblings.filter((x) => x.id !== s.id)
      const isLatest = others.every((x) => Date.parse(x.started_at) <= Date.parse(newStart))
      if (!isLatest) return errJson(c, ErrorCode.invalid_input)
      const active = await findActiveSprint(cfg, s.project_id)
      if (active && active.id !== s.id) return c.json({ error: ErrorCode.sprint_active_exists, active_id: active.id }, 409)
    }
    // S235: the overlap check — now calls the SHARED assertSprintWindowOk helper
    // (lifted to devboard-helpers.ts so POST-create-with-dates + POST-start use
    // the SAME validation). The zero-day touching exception + the open-end =
    // +∞ semantics are preserved verbatim in the helper.
    const windowOk = await assertSprintWindowOk(cfg, s.project_id, s.id, newStart, newEnd)
    if (!windowOk) return errJson(c, ErrorCode.invalid_input)
    // One UPDATE touching only the fields the body provided (explicit null reopens).
    // version/description ride along on started sprints too (0052) — the doc stays
    // editable for the whole sprint lifetime, not just while drafting.
    const sets: string[] = []
    const params: unknown[] = []
    const push = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val) }
    if (body.name !== undefined) push('name', body.name)
    if (body.version !== undefined) push('version', body.version)
    if (body.description !== undefined) push('description', body.description)
    if (body.emoji !== undefined) push('emoji', body.emoji)
    dueOriginSet(push)
    if (body.started_at !== undefined) push('started_at', body.started_at)
    if (body.ended_at !== undefined) {
      push('ended_at', body.ended_at)
      // S240 (0065): an ended_at transition IS a lifecycle transition — every writer
      // keeps the representations in lock-step (a set end = a completed window; a
      // cleared end = an active sprint, guarded above). A no-op re-assert on an
      // already-open end leaves the status (active OR paused) exactly where it was.
      // The timeline drag path NEVER archives — the explicit POST /finish is the
      // archiving path (the pack's D4 scoping).
      if (body.ended_at !== null || s.ended_at !== null) {
        push('status', body.ended_at === null ? 'active' : 'completed')
      }
    }
    if (!sets.length) return c.json({ ok: true })
    push('updated_at', now) // S240 (D8): every sprint PATCH stamps updated_at
    params.push(s.id)
    await cfg.db.execute(`UPDATE sprints SET ${sets.join(', ')} WHERE id = ?`, params)
    return c.json({ ok: true })
  })

  app.post('/api/sprints/:id/finish', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    // A draft was never started — the old is_draft 400 answer, kept byte-identical.
    // Finishing an already-COMPLETED sprint stays legal like today's re-finish (the
    // ended_at re-stamp): any done tasks that appeared since the first finish ride
    // along into the archive (idempotent for the ones already there — archived rows
    // left dev_tasks and cannot double-insert).
    if (sprintStatusOf(s) === 'planned') return errJson(c, ErrorCode.invalid_input)
    const now = new Date().toISOString()
    // D4 (spec §5.3 — the pack's resolution): finishing archives ONLY this sprint's
    // Implemented ('done') tasks — the SAME snapshot INSERT the archive-done bulk
    // action uses (0046/0051: sprint_id kept, tags JSON snapshotted BEFORE the
    // cascade, priority carried), plus the S240 sprint_name_snapshot = sprint.name.
    // Unfinished tasks keep their Kanban status AND their sprint association
    // (history); nothing is deleted; nothing moves columns.
    const tasks = await cfg.db.query<{ id: string; title: string; priority: string; category_id: string | null; done_at: string | null; created_at: string }>(
      "SELECT id, title, priority, category_id, done_at, created_at FROM dev_tasks WHERE project_id = ? AND sprint_id = ? AND status = 'done'",
      [s.project_id, s.id],
    )
    const links = await taskTagsForProject(cfg, s.project_id)
    const taskIds = new Set(tasks.map((tk) => tk.id))
    const tagsByTask = new Map<string, { name: string; color: string }[]>()
    for (const row of links) {
      if (!taskIds.has(row.task_id)) continue // only the tasks being archived carry links
      const list = tagsByTask.get(row.task_id) ?? []
      list.push({ name: row.name, color: row.color })
      tagsByTask.set(row.task_id, list)
    }
    const touchedTagIds = links.filter((l) => taskIds.has(l.task_id)).map((l) => l.id)
    await cfg.db.transaction(async (tx) => {
      tx.sql("UPDATE sprints SET ended_at = ?, status = 'completed', updated_at = ? WHERE id = ?", [now, now, s.id])
      for (const task of tasks) {
        const snapshot = tagsByTask.get(task.id) ?? []
        tx.sql(
          `INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags, sprint_name_snapshot) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [task.id, s.project_id, task.title, task.priority, task.category_id, s.id, task.done_at, task.created_at, now, JSON.stringify(snapshot), s.name],
        )
      }
      // No IN-list chunking needed: a single sprint-scoped predicate takes no parameter cap.
      tx.sql("DELETE FROM dev_tasks WHERE sprint_id = ? AND status = 'done'", [s.id])
    })
    // S30 (B2): the cascaded dev_task_tags rows dropped with the tasks — usage follows.
    await refreshTagUsage(cfg, touchedTagIds)
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, s.project_id])
    await logHistory(cfg, s.project_id, t('{name} finished', '{name} تمام شد', { name: s.name }))
    // `archived` rides additively for the Phase 4 finish-confirmation counts.
    return c.json({ ok: true, archived: tasks.length })
  })

  app.post('/api/sprints/:id/reopen', async (c) => {
    const user = c.get('user')
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    if (s.is_draft) return errJson(c, ErrorCode.invalid_input)
    const now = new Date().toISOString()
    const status = sprintStatusOf(s)
    // Already open: the legacy no-op reopen answer (a 200 with nothing to do).
    if (status === 'active') return c.json({ ok: true })
    // S240 (0065): reopen = completed → ACTIVE (spec §5.4 + the pack's prompt); a
    // paused sprint resumes via /resume (or /start), never by reopen.
    if (status !== 'completed') return errJson(c, ErrorCode.invalid_input)
    // Same guard as PATCH's null-end rule: only the LATEST sprint by started_at may
    // reopen — the timeline's trailing-open-band ordering (S235's contract).
    const others = await cfg.db.query<{ started_at: string }>(
      'SELECT started_at FROM sprints WHERE project_id = ? AND id != ? AND is_draft = 0',
      [s.project_id, s.id],
    )
    const startedAt = s.started_at
    const isLatest = others.every((x) => Date.parse(x.started_at) <= Date.parse(startedAt))
    if (!isLatest) return errJson(c, ErrorCode.invalid_input)
    // S240 (0065): the one-ACTIVE rule replaces the one-open-window rule (a paused
    // sibling's open window no longer blocks) — subject to one-active like start/resume.
    const active = await findActiveSprint(cfg, s.project_id)
    if (active && active.id !== s.id) return c.json({ error: ErrorCode.sprint_active_exists, active_id: active.id }, 409)
    await cfg.db.execute("UPDATE sprints SET ended_at = NULL, status = 'active', updated_at = ? WHERE id = ?", [now, s.id])
    return c.json({ ok: true })
  })

  app.delete('/api/sprints/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    const status = sprintStatusOf(s)
    // S240 (0065 — spec §6 + Part VI assumptions 4/5): ACTIVE sprints must be Paused
    // or Finished first; COMPLETED sprints are history and can never be deleted.
    // Planned + Paused delete (with confirmation) — the deletable set.
    if (status === 'active') return errJson(c, ErrorCode.sprint_active)
    if (status === 'completed') return errJson(c, ErrorCode.sprint_completed)
    await cfg.db.transaction(async (tx) => {
      // Non-archived tasks stay on the board, UNASSIGNED (No sprint) — priority,
      // Kanban status, deadlines and dependencies all untouched (spec §6: a sprint
      // deletion never cascades to task deletion).
      tx.sql('UPDATE dev_tasks SET sprint_id = NULL WHERE sprint_id = ?', [s.id])
      // D3 (spec §6 — the pack's resolution): archived snapshots keep the sprint's
      // IDENTITY as the historical label ("<name> (deleted)") instead of silently
      // losing it; AP-27's dangling-FK hygiene is preserved (sprint_id still NULLed,
      // restore can never hit a dead FK).
      tx.sql('UPDATE project_archives SET sprint_name_snapshot = ?, sprint_id = NULL WHERE sprint_id = ?', [`${s.name} (deleted)`, s.id])
      tx.sql('DELETE FROM sprints WHERE id = ?', [s.id])
    })
    await logHistory(cfg, s.project_id, t('{name} deleted', '{name} حذف شد', { name: s.name }))
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

  // ---- backlog plan docs (0033, «برنامه آتی» tab) --------------------------------

  app.get('/api/projects/:projectId/backlog', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    return c.json(await loadBacklog(cfg, p.id))
  })

  app.post('/api/projects/:projectId/backlog/docs', async (c) => {
    const body = await jsonBody<z.infer<typeof createBacklogDocSchema>>(c, createBacklogDocSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const id = uuid()
    const now = new Date().toISOString()
    await cfg.db.transaction(async (tx) => {
      tx.sql('INSERT INTO backlog_docs (id, project_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id, p.id, body.title, body.content, now, now,
      ])
      tx.sql("INSERT INTO backlog_doc_revisions (id, doc_id, kind, title, content, created_at) VALUES (?, ?, 'create', ?, ?, ?)", [
        uuid(), id, body.title, body.content, now,
      ])
    })
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    await logHistory(cfg, p.id, t('Plan doc created: {title}', 'سند برنامه «{title}» ایجاد شد', { title: body.title }))
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/backlog/docs/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateBacklogDocSchema>>(c, updateBacklogDocSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const doc = await ownedBacklogDoc(cfg, user.id, c.req.param('id'))
    if (!doc) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    const title = body.title ?? doc.title
    const content = body.content ?? doc.content
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE backlog_docs SET title = ?, content = ?, updated_at = ? WHERE id = ?', [title, content, now, doc.id])
      tx.sql("INSERT INTO backlog_doc_revisions (id, doc_id, kind, title, content, created_at) VALUES (?, ?, 'update', ?, ?, ?)", [
        uuid(), doc.id, title, content, now,
      ])
    })
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, doc.project_id])
    await logHistory(cfg, doc.project_id, t('Plan doc updated: {title}', 'سند برنامه «{title}» به‌روزرسانی شد', { title }))
    return c.json({ ok: true })
  })

  app.delete('/api/backlog/docs/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const doc = await ownedBacklogDoc(cfg, user.id, c.req.param('id'))
    if (!doc) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM backlog_docs WHERE id = ?', [doc.id])
    await logHistory(cfg, doc.project_id, t('Plan doc deleted: {title}', 'سند برنامه «{title}» حذف شد', { title: doc.title }))
    return c.json({ ok: true })
  })

  // ---- project tags attach/detach (the redesigned detail header's tag chips) ----

  app.post('/api/projects/:projectId/tags', async (c) => {
    const body = await jsonBody<z.infer<typeof tagBodySchema>>(c, tagBodySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const found = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE user_id = ? AND name = ?', [user.id, body.name])
    const tagId = found[0]?.id ?? uuid()
    if (!found.length) {
      await cfg.db.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', [
        tagId, user.id, body.name, body.color ?? (await tagColorFor(cfg, user.id)), new Date().toISOString(),
      ])
    }
    await cfg.db.execute('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [p.id, tagId])
    // S30 (B2): project chips count toward usage too — the label manager totals both.
    await refreshTagUsage(cfg, [tagId])
    // S161 (spec #3): a tag add is a field edit — the idea's updated_at bumps.
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [new Date().toISOString(), p.id])
    return c.json({ ok: true, id: tagId }, 201)
  })

  app.delete('/api/projects/:projectId/tags/:tagId', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM project_tags WHERE project_id = ? AND tag_id = ?', [p.id, c.req.param('tagId')])
    await refreshTagUsage(cfg, [c.req.param('tagId')])
    // S161 (spec #3): a tag remove bumps the idea's updated_at too.
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [new Date().toISOString(), p.id])
    return c.json({ ok: true })
  })

  app.all('/api/devboard/ping', (c) => {
    const t = trFor(c)
    return c.html(toastHtml(t('Saved', 'ذخیره شد'), localeOf(c), undefined, 'ok'))
  })

  return app
}
