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
import type { Config, UserRow, DevTaskRow, DevTaskStatus, SprintRow, TagRow, BacklogDocRow } from '../types'
import { isValidCatPair, normCatName, type CategoryRow } from '../lib/categories'

const taskStatusSchema = z.enum(['idea', 'planned', 'in_progress', 'done', 'bug'])
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
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
const createSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  version: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(100_000).optional(),
  // S48n: optional start/end dates. If both provided, the sprint is created
  // as STARTED (is_draft=0) with these dates — skips the draft step. The
  // presets (24h/48h/72h/1w/2w/1m) compute end = start + duration.
  started_at: isoDate.optional(),
  ended_at: isoDate.nullable().optional(),
})
const updateSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  version: z.string().trim().min(1).max(40).nullable().optional(), // explicit null clears the label
  description: z.string().max(100_000).optional(),
  started_at: isoDate.optional(),
  ended_at: isoDate.nullable().optional(), // explicit null = reopen this sprint's end
})
const reorderSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(500) })
const tagBodySchema = z.object({ name: z.string().trim().min(1).max(60), color: hexColor.optional() })
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

// Whole-day index (UTC) — the timeline works in whole days and this is the same
// Math.floor(ms/86400000) day math the client uses in sprint.html.
const dayIdx = (x: string) => Math.floor(Date.parse(x) / 86400000)


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
} from './devboard-helpers'

export function devboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // ---- one payload for every surface (board page, sprint page, detail preview) ----
  app.get('/api/projects/:projectId/devboard', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const [tasks, sprints, tags, taskTags, categories] = await Promise.all([
      cfg.db.query<DevTaskRow & { tags: string }>(
        // S29 follow-up: PRIORITY-FIRST ordering — tasks auto-sort urgent → high →
        // medium → low inside every column (sort_order = manual drag still orders
        // within the same priority tier).
        `SELECT t.*, COALESCE((SELECT GROUP_CONCAT(tt.tag_id) FROM dev_task_tags tt WHERE tt.task_id = t.id), '') AS tags
         FROM dev_tasks t WHERE t.project_id = ? ORDER BY ${PRIO_ORDER_SQL}, t.sort_order, t.created_at`,
        [p.id],
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
    ])
    return await etag(c, c.json({
      project: { id: p.id, title: p.title, status: p.status, type: p.type },
      tasks: tasks.map((t) => ({ ...t, tags: t.tags ? t.tags.split(',') : [] })),
      categories,
      sprints,
      tags,
      // Flat per-task label join ({task_id, id, name, color}) — one query, joined
      // client-side by whoever renders cards.
      task_tags: taskTags,
    }))
  })

  // ---- dev tasks --------------------------------------------------------------

  app.post('/api/projects/:projectId/devtasks', async (c) => {
    const body = await jsonBody<z.infer<typeof createDevTaskSchema>>(c, createDevTaskSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    // category/sprint ids must be valid — a foreign id is a 400, not a 500. The
    // category (S152) must be a LIVE global category ENABLED on this project (the
    // single-select source is the project's picker set, block 3).
    const categoryOk = body.category_id ? await categoryEnabledOnProject(cfg, p.id, body.category_id) : true
    const sprintOk = body.sprint_id ? await ownedSprint(cfg, user.id, body.sprint_id) : true
    if ((body.category_id && !categoryOk) || (body.sprint_id && !sprintOk)) return c.json({ error: 'invalid_input' }, 400)
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
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [id, p.id, body.title, status, body.priority ?? 'medium', body.category_id ?? null, sprintId, now, status === 'done' ? now : null, body.start_at ?? null, body.end_at ?? null, now],
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
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE dev_tasks SET sort_order = ? WHERE id = ? AND project_id = ?', [i, id, p.id])
      })
    })
    return c.json({ ok: true })
  })

  app.patch('/api/devtasks/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateDevTaskSchema>>(c, updateDevTaskSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    if (body.category_id && !(await categoryEnabledOnProject(cfg, task.project_id, body.category_id))) return c.json({ error: 'invalid_input' }, 400)
    if (body.sprint_id && !(await ownedSprint(cfg, user.id, body.sprint_id))) return c.json({ error: 'invalid_input' }, 400)
    const now = new Date().toISOString()
    // tags is NOT a dev_tasks column (replace-set semantics on dev_task_tags) — pull it
    // out BEFORE the generic SET builder, or the loop below would emit SET tags = ?
    // and 500 with "no such column".
    const { tags: tagNames, ...columns } = body
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
    if (!sets.length && tagNames === undefined) return c.json({ ok: true })
    if (sets.length) {
      // 0061 (S126): every column edit stamps the task's own updated_at — the
      // overview's "recent = last-updated" sort reads this (the PROJECT stamp below
      // is project-level and can't tell two tasks in one project apart).
      sets.push('updated_at = ?')
      params.push(now)
      params.push(task.id)
      await cfg.db.execute(`UPDATE dev_tasks SET ${sets.join(', ')} WHERE id = ?`, params)
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
    if (!task) return c.json({ error: 'not_found' }, 404)
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
    if (!p) return c.json({ error: 'not_found' }, 404)
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
    const placeholders = ids.map(() => '?').join(',')
    await cfg.db.execute(`DELETE FROM dev_tasks WHERE id IN (${placeholders})`, ids)
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
    if (!p) return c.json({ error: 'not_found' }, 404)
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
    if (!p) return c.json({ error: 'not_found' }, 404)
    const aid = c.req.param('aid')
    const rows = await cfg.db.query<{
      id: string; title: string; priority: string; category_id: string | null
      sprint_id: string | null; done_at: string | null; original_created_at: string; tags: string
    }>(`SELECT id, title, priority, category_id, sprint_id, done_at, original_created_at, tags FROM project_archives WHERE id = ? AND project_id = ?`, [aid, p.id])
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404)
    const a = rows[0]
    const now = new Date().toISOString()
    // Re-insert into dev_tasks (status='done'). sort_order = max+1 to put it at the end.
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
    if (!p) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM project_archives WHERE id = ? AND project_id = ?', [c.req.param('aid'), p.id])
    return c.json({ ok: true })
  })

  // ---- task tags (labels like "UI/UX" — find-or-create per user, then link) ----

  app.post('/api/devtasks/:id/tags', async (c) => {
    const body = await jsonBody<z.infer<typeof tagBodySchema>>(c, tagBodySchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
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
    if (!task) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM dev_task_tags WHERE task_id = ? AND tag_id = ?', [task.id, c.req.param('tagId')])
    // S30 (B2 + B3): the link went away — usage and the FTS text follow.
    await refreshTagUsage(cfg, [c.req.param('tagId')])
    await syncTaskSearchTags(cfg, task.id)
    return c.json({ ok: true })
  })

  // ---- categories (S152: the GLOBAL library — create + enable in one beat) ----
  // The inline quick-add path (block 4): creates the category in the global library
  // (16-tile pair validated) AND enables it on this project in the same request, so
  // the composer never detours to Settings. A live case/trim-insensitive name match
  // is REUSED (enabled on this project + returned) instead of forking a duplicate.
  app.post('/api/projects/:projectId/categories', async (c) => {
    const body = await jsonBody<z.infer<typeof createCategorySchema>>(c, createCategorySchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    if (!isValidCatPair(body.color_fill, body.color_text)) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const name = body.name.trim()
    if (!name) return c.json({ error: 'invalid_input' }, 400)
    const existing = await cfg.db.query<{ id: string }>(
      'SELECT id FROM categories WHERE lower(trim(name)) = ? AND is_archived = 0 LIMIT 1',
      [normCatName(name)],
    )
    if (existing[0]) {
      await cfg.db.execute('INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)', [p.id, existing[0].id])
      return c.json({ ok: true, id: existing[0].id, existing: true }, 200)
    }
    const id = uuid()
    await cfg.db.execute(
      'INSERT INTO categories (id, name, color_fill, color_text, is_archived, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      [id, name, body.color_fill.toUpperCase(), body.color_text.toUpperCase(), new Date().toISOString()],
    )
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
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const id = uuid()
    const now = new Date().toISOString()
    const count = await cfg.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM sprints WHERE project_id = ?', [p.id])
    const name = body.name ?? `Sprint ${(count[0]?.n ?? 0) + 1}`
    // 0034: sprints are created as DRAFTS (is_draft=1) — the timeline plans on the draft
    // and /start promotes it. One draft at a time per project; starting it is a separate,
    // explicit step (no more auto-starting on create).
    const draft = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sprints WHERE project_id = ? AND is_draft = 1',
      [p.id],
    )
    if (draft.length) return c.json({ error: 'draft_exists', draft_id: draft[0].id }, 409)
    // S48n: if started_at is provided, create the sprint as STARTED (is_draft=0) with
    // the chosen dates + close any currently open sprint first. Otherwise, create as
    // a DRAFT (is_draft=1, started_at=now, ended_at=NULL — the user starts it later).
    const hasDates = body.started_at != null
    if (hasDates) {
      // Close any open sprint first (same logic as /start)
      const openSprint = await cfg.db.query<{ started_at: string }>(
        'SELECT started_at FROM sprints WHERE project_id = ? AND ended_at IS NULL AND is_draft = 0 ORDER BY started_at DESC LIMIT 1',
        [p.id],
      )
      if (openSprint[0]) {
        const startMs = Date.parse(body.started_at!)
        const dayBefore = startMs - 86400000
        const closeMs = Math.max(dayBefore, Date.parse(openSprint[0].started_at))
        await cfg.db.execute('UPDATE sprints SET ended_at = ? WHERE project_id = ? AND ended_at IS NULL AND is_draft = 0', [
          new Date(closeMs).toISOString(), p.id,
        ])
      }
      const startedAt = body.started_at!
      const endedAt = body.ended_at ?? null
      await cfg.db.execute('INSERT INTO sprints (id, project_id, name, version, description, started_at, ended_at, is_draft, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)', [
        id, p.id, name, body.version ?? null, body.description ?? '', startedAt, endedAt, now,
      ])
      await logHistory(cfg, p.id, t('{name} started', '{name} شروع شد', { name }))
      return c.json({ ok: true, id, name, version: body.version ?? null, draft: false }, 201)
    }
    await cfg.db.execute('INSERT INTO sprints (id, project_id, name, version, description, started_at, ended_at, is_draft, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)', [
      id, p.id, name, body.version ?? null, body.description ?? '', now, now,
    ])
    await logHistory(cfg, p.id, t('{name} defined', '{name} تعریف شد', { name }))
    return c.json({ ok: true, id, name, version: body.version ?? null, draft: true }, 201)
  })

  app.post('/api/sprints/:id/start', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return c.json({ error: 'not_found' }, 404)
    if (!s.is_draft) return c.json({ error: 'already_started' }, 400)
    const now = new Date().toISOString()
    // One open sprint at a time (user model): starting this one closes the current open
    // sprint the day BEFORE the new start (sprints never share a day). Edge: the open
    // sprint started today (start−1d would predate its own start) → close it AT its OWN
    // start instead (zero-length, never inverted — closing at the NEW start produced an
    // inverted range when the open sprint had been dragged to start in the FUTURE).
    const openSprint = await cfg.db.query<{ started_at: string }>(
      'SELECT started_at FROM sprints WHERE project_id = ? AND ended_at IS NULL AND is_draft = 0 ORDER BY started_at DESC LIMIT 1',
      [s.project_id],
    )
    if (openSprint[0]) {
      const startMs = Date.parse(now)
      const dayBefore = startMs - 86400000
      const closeMs = Math.max(dayBefore, Date.parse(openSprint[0].started_at))
      await cfg.db.execute('UPDATE sprints SET ended_at = ? WHERE project_id = ? AND ended_at IS NULL AND is_draft = 0', [
        new Date(closeMs).toISOString(), s.project_id,
      ])
    }
    await cfg.db.execute('UPDATE sprints SET started_at = ?, ended_at = NULL, is_draft = 0 WHERE id = ?', [now, s.id])
    await logHistory(cfg, s.project_id, t('{name} started', '{name} شروع شد', { name: s.name }))
    return c.json({ ok: true })
  })

  app.patch('/api/sprints/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateSprintSchema>>(c, updateSprintSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return c.json({ error: 'not_found' }, 404)
    // A draft carries name + version + its doc (0034 + 0052) — its dates are set by
    // /start, never by PATCH. description (the full-screen editor's subject) is ALWAYS
    // writable; an empty string is a legal empty doc (the modal seeds an empty one).
    if (s.is_draft) {
      if (body.started_at !== undefined || body.ended_at !== undefined) return c.json({ error: 'invalid_input' }, 400)
      const sets: string[] = []
      const params: unknown[] = []
      if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name) }
      if (body.version !== undefined) { sets.push('version = ?'); params.push(body.version) }
      if (body.description !== undefined) { sets.push('description = ?'); params.push(body.description) }
      if (!sets.length) return c.json({ ok: true })
      params.push(s.id)
      await cfg.db.execute(`UPDATE sprints SET ${sets.join(', ')} WHERE id = ?`, params)
      return c.json({ ok: true })
    }
    const siblings = await cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? AND is_draft = 0 ORDER BY started_at', [s.project_id])
    const newStart = body.started_at ?? s.started_at
    const newEnd = body.ended_at === undefined ? s.ended_at : body.ended_at
    // A set end must be strictly after the start — a zero/negative sprint is invalid.
    if (typeof newEnd === 'string' && Date.parse(newEnd) <= Date.parse(newStart)) {
      return c.json({ error: 'invalid_input' }, 400)
    }
    // Reopening (end = null): only the LATEST sprint by started_at may be open, and only
    // while no OTHER sprint is open — one open sprint at a time (user model).
    if (newEnd === null) {
      const others = siblings.filter((x) => x.id !== s.id)
      const isLatest = others.every((x) => Date.parse(x.started_at) <= Date.parse(newStart))
      const anyOtherOpen = others.some((x) => x.ended_at === null)
      if (!isLatest || anyOtherOpen) return c.json({ error: 'invalid_input' }, 400)
    }
    // Overlap check at DAY granularity (the timeline works in whole days; an open
    // sibling's end counts as +∞). The one allowed exception: a range spanning ZERO days
    // (dayIdx(start) === dayIdx(end)) that TOUCHES this sprint at the exact same instant
    // (parse-time equal boundary) — the same-day create edge above is exactly that shape
    // (the closed sprint ends precisely where the new one starts). Not a real overlap.
    const zeroDay = (start: string, end: string) => dayIdx(start) === dayIdx(end)
    const sameMs = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b)
    const aZero = newEnd !== null && zeroDay(newStart, newEnd)
    for (const x of siblings) {
      if (x.id === s.id) continue
      const bZero = x.ended_at !== null && zeroDay(x.started_at, x.ended_at)
      if (
        (bZero || aZero) &&
        (sameMs(newStart, x.started_at) || sameMs(newStart, x.ended_at) || sameMs(newEnd, x.started_at) || sameMs(newEnd, x.ended_at))
      ) continue
      const aS = dayIdx(newStart)
      const aE = newEnd === null ? Infinity : dayIdx(newEnd)
      const bS = dayIdx(x.started_at)
      const bE = x.ended_at === null ? Infinity : dayIdx(x.ended_at)
      if (aS <= bE && bS <= aE) return c.json({ error: 'invalid_input' }, 400)
    }
    // One UPDATE touching only the fields the body provided (explicit null reopens).
    // version/description ride along on started sprints too (0052) — the doc stays
    // editable for the whole sprint lifetime, not just while drafting.
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      sets.push('name = ?')
      params.push(body.name)
    }
    if (body.version !== undefined) {
      sets.push('version = ?')
      params.push(body.version)
    }
    if (body.description !== undefined) {
      sets.push('description = ?')
      params.push(body.description)
    }
    if (body.started_at !== undefined) {
      sets.push('started_at = ?')
      params.push(body.started_at)
    }
    if (body.ended_at !== undefined) {
      sets.push('ended_at = ?')
      params.push(body.ended_at)
    }
    if (!sets.length) return c.json({ ok: true })
    params.push(s.id)
    await cfg.db.execute(`UPDATE sprints SET ${sets.join(', ')} WHERE id = ?`, params)
    return c.json({ ok: true })
  })

  app.post('/api/sprints/:id/finish', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return c.json({ error: 'not_found' }, 404)
    if (s.is_draft) return c.json({ error: 'invalid_input' }, 400)
    await cfg.db.execute('UPDATE sprints SET ended_at = ? WHERE id = ?', [new Date().toISOString(), s.id])
    await logHistory(cfg, s.project_id, t('{name} finished', '{name} تمام شد', { name: s.name }))
    return c.json({ ok: true })
  })

  app.post('/api/sprints/:id/reopen', async (c) => {
    const user = c.get('user')
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return c.json({ error: 'not_found' }, 404)
    if (s.is_draft) return c.json({ error: 'invalid_input' }, 400)
    // Same guard as PATCH's null-end rule: only the LATEST sprint by started_at may
    // reopen, and only while no other sprint is open (one open sprint at a time).
    const others = await cfg.db.query<{ started_at: string; ended_at: string | null }>(
      'SELECT started_at, ended_at FROM sprints WHERE project_id = ? AND id != ? AND is_draft = 0',
      [s.project_id, s.id],
    )
    const startedAt = s.started_at
    const isLatest = others.every((x) => Date.parse(x.started_at) <= Date.parse(startedAt))
    const anyOtherOpen = others.some((x) => x.ended_at === null)
    if (!isLatest || anyOtherOpen) return c.json({ error: 'invalid_input' }, 400)
    await cfg.db.execute('UPDATE sprints SET ended_at = NULL WHERE id = ?', [s.id])
    return c.json({ ok: true })
  })

  app.delete('/api/sprints/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return c.json({ error: 'not_found' }, 404)
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE dev_tasks SET sprint_id = NULL WHERE sprint_id = ?', [s.id])
      tx.sql('DELETE FROM sprints WHERE id = ?', [s.id])
    })
    await logHistory(cfg, s.project_id, t('{name} deleted', '{name} حذف شد', { name: s.name }))
    return c.json({ ok: true })
  })

  // ---- backlog plan docs (0033, «برنامه آتی» tab) --------------------------------

  app.get('/api/projects/:projectId/backlog', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    return c.json(await loadBacklog(cfg, p.id))
  })

  app.post('/api/projects/:projectId/backlog/docs', async (c) => {
    const body = await jsonBody<z.infer<typeof createBacklogDocSchema>>(c, createBacklogDocSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
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
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const doc = await ownedBacklogDoc(cfg, user.id, c.req.param('id'))
    if (!doc) return c.json({ error: 'not_found' }, 404)
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
    if (!doc) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM backlog_docs WHERE id = ?', [doc.id])
    await logHistory(cfg, doc.project_id, t('Plan doc deleted: {title}', 'سند برنامه «{title}» حذف شد', { title: doc.title }))
    return c.json({ ok: true })
  })

  // ---- project tags attach/detach (the redesigned detail header's tag chips) ----

  app.post('/api/projects/:projectId/tags', async (c) => {
    const body = await jsonBody<z.infer<typeof tagBodySchema>>(c, tagBodySchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
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
    return c.json({ ok: true, id: tagId }, 201)
  })

  app.delete('/api/projects/:projectId/tags/:tagId', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM project_tags WHERE project_id = ? AND tag_id = ?', [p.id, c.req.param('tagId')])
    await refreshTagUsage(cfg, [c.req.param('tagId')])
    return c.json({ ok: true })
  })

  app.all('/api/devboard/ping', (c) => {
    const t = trFor(c)
    return c.html(toastHtml(t('Saved', 'ذخیره شد'), localeOf(c), undefined, 'ok'))
  })

  return app
}
