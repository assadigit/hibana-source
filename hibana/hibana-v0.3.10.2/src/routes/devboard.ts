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
import { jsonBody } from '../lib/http'
import { getOwnedProject, toastHtml } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { uuid } from '../lib/ids'
import type { Config, UserRow, DevTaskRow, DevTaskStatus, TaskCategory, SprintRow, TagRow, BacklogDocRow } from '../types'

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
  title: z.string().trim().min(1).max(2000), // Session 19 (user request): was max(300) — "unlimited". 2000 is effectively unlimited for a task title; the rendered title truncates with a "read more" (CSS line-clamp + a toggle). The textarea maxlength on the modal was also lifted.
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  category_id: z.string().max(64).nullable().optional(),
  sprint_id: z.string().max(64).nullable().optional(),
  start_at: isoDate.nullable().optional(),
  end_at: isoDate.nullable().optional(),
}).refine(clipRangeOk, { message: 'bad_range' })
const updateDevTaskSchema = z.object({
  title: z.string().trim().min(1).max(2000).optional(), // Session 19: lifted from 300 to 2000 (matches createDevTaskSchema).
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  category_id: z.string().max(64).nullable().optional(),
  sprint_id: z.string().max(64).nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
  start_at: isoDate.nullable().optional(),
  end_at: isoDate.nullable().optional(),
}).refine(clipRangeOk, { message: 'bad_range' })
const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: hexColor.optional(),
})
const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: hexColor.optional(),
})
const createSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
})
const updateSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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

async function logHistory(cfg: Config, projectId: string, note: string) {
  await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
    uuid(), projectId, note, new Date().toISOString(),
  ])
}

async function ownedTask(cfg: Config, userId: string, id: string): Promise<DevTaskRow | null> {
  const rows = await cfg.db.query<DevTaskRow>(
    'SELECT t.* FROM dev_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

async function ownedCategory(cfg: Config, userId: string, id: string): Promise<TaskCategory | null> {
  const rows = await cfg.db.query<TaskCategory>(
    'SELECT c.* FROM task_categories c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

async function ownedSprint(cfg: Config, userId: string, id: string): Promise<SprintRow | null> {
  const rows = await cfg.db.query<SprintRow>(
    'SELECT s.* FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

async function ownedBacklogDoc(cfg: Config, userId: string, id: string): Promise<BacklogDocRow | null> {
  const rows = await cfg.db.query<BacklogDocRow>(
    'SELECT d.* FROM backlog_docs d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

export type BacklogEvent = { at: string; kind: 'doc_created' | 'doc_updated' | 'item_added'; label: string }

/** The whole backlog payload (0033): docs + the merged change history (revisions and
 *  quick planned items, newest first, top 10) + the latest change timestamp. Shared by
 *  the projects route's «برنامه آتی» tab and this module's JSON route. */
export async function loadBacklog(cfg: Config, projectId: string): Promise<{ docs: BacklogDocRow[]; history: BacklogEvent[]; latestAt: string | null }> {
  const [docs, revisions, planned] = await Promise.all([
    cfg.db.query<BacklogDocRow>('SELECT * FROM backlog_docs WHERE project_id = ? ORDER BY updated_at DESC', [projectId]),
    cfg.db.query<{ title: string; kind: string; created_at: string }>(
      `SELECT r.title, r.kind, r.created_at FROM backlog_doc_revisions r
       JOIN backlog_docs d ON d.id = r.doc_id WHERE d.project_id = ?
       ORDER BY r.created_at DESC LIMIT 10`,
      [projectId],
    ),
    // Quick items (mode A) are planned dev_tasks — their creation is a backlog change.
    cfg.db.query<{ title: string; created_at: string }>(
      `SELECT title, created_at FROM dev_tasks WHERE project_id = ? AND status = 'planned' ORDER BY created_at DESC LIMIT 10`,
      [projectId],
    ),
  ])
  const events: BacklogEvent[] = [
    ...revisions.map((r) => ({ at: r.created_at, kind: r.kind === 'create' ? ('doc_created' as const) : ('doc_updated' as const), label: r.title })),
    ...planned.map((t) => ({ at: t.created_at, kind: 'item_added' as const, label: t.title })),
  ]
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return { docs, history: events.slice(0, 10), latestAt: events[0]?.at ?? null }
}

export function devboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // ---- one payload for every surface (board page, sprint page, detail preview) ----
  app.get('/api/projects/:projectId/devboard', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const [tasks, categories, sprints, tags] = await Promise.all([
      cfg.db.query<DevTaskRow & { tags: string }>(
        `SELECT t.*, COALESCE((SELECT GROUP_CONCAT(tt.tag_id) FROM dev_task_tags tt WHERE tt.task_id = t.id), '') AS tags
         FROM dev_tasks t WHERE t.project_id = ? ORDER BY t.sort_order, t.created_at`,
        [p.id],
      ),
      cfg.db.query<TaskCategory>('SELECT * FROM task_categories WHERE project_id = ? ORDER BY sort_order, created_at', [p.id]),
      cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? ORDER BY started_at', [p.id]),
      cfg.db.query<TagRow>('SELECT t.* FROM tags t WHERE t.user_id = ? ORDER BY t.name', [user.id]),
    ])
    return c.json({
      project: { id: p.id, title: p.title, status: p.status, type: p.type },
      tasks: tasks.map((t) => ({ ...t, tags: t.tags ? t.tags.split(',') : [] })),
      categories,
      sprints,
      tags,
    })
  })

  // ---- dev tasks --------------------------------------------------------------

  app.post('/api/projects/:projectId/devtasks', async (c) => {
    const body = await jsonBody<z.infer<typeof createDevTaskSchema>>(c, createDevTaskSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    // category/sprint ids must belong to THIS project — a foreign id is ignored, not 500.
    const categoryOk = body.category_id ? await ownedCategory(cfg, user.id, body.category_id) : true
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
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [id, p.id, body.title, status, body.priority ?? 'medium', body.category_id ?? null, sprintId, now, status === 'done' ? now : null, body.start_at ?? null, body.end_at ?? null],
    )
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    await logHistory(cfg, p.id, t('Task added: {title}', 'کار جدید: {title}', { title: body.title }))
    return c.json({ ok: true, id }, 201)
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
    if (body.category_id && !(await ownedCategory(cfg, user.id, body.category_id))) return c.json({ error: 'invalid_input' }, 400)
    if (body.sprint_id && !(await ownedSprint(cfg, user.id, body.sprint_id))) return c.json({ error: 'invalid_input' }, 400)
    const now = new Date().toISOString()
    const sets: string[] = []
    const params: unknown[] = []
    // start_at/end_at (0030 clip trims) ride this same generic path as category_id/
    // sprint_id: a string sets the manual edge, an explicit null clears it (back to the
    // automatic created_at→done_at|today bar).
    for (const [k, v] of Object.entries(body)) {
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
    if (!sets.length) return c.json({ ok: true })
    params.push(task.id)
    await cfg.db.execute(`UPDATE dev_tasks SET ${sets.join(', ')} WHERE id = ?`, params)
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, task.project_id])
    return c.json({ ok: true })
  })

  app.delete('/api/devtasks/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM dev_tasks WHERE id = ?', [task.id])
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
    const now = new Date().toISOString()
    // Insert into project_archives, then delete from dev_tasks (the dev_task_tags rows
    // cascade via ON DELETE SET NULL — tags stay on the project, not the archived task).
    for (const task of tasks) {
      await cfg.db.execute(
        `INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?)`,
        [task.id, p.id, task.title, task.priority, task.category_id, task.sprint_id, task.done_at, task.created_at, now],
      )
    }
    const ids = tasks.map((t) => t.id)
    const placeholders = ids.map(() => '?').join(',')
    await cfg.db.execute(`DELETE FROM dev_tasks WHERE id IN (${placeholders})`, ids)
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    await logHistory(cfg, p.id, t('{n} done tasks archived', '{n} کار انجام‌شده بایگانی شد', { n: String(tasks.length) }))
    return c.json({ ok: true, archived: tasks.length })
  })

  // GET the archives for a project — the permanent record of archived done tasks.
  app.get('/api/projects/:projectId/archives', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const rows = await cfg.db.query<{
      id: string; title: string; priority: string; done_at: string | null
      original_created_at: string; archived_at: string
    }>(`SELECT id, title, priority, done_at, original_created_at, archived_at FROM project_archives WHERE project_id = ? ORDER BY archived_at DESC`, [p.id])
    return c.json({ archives: rows })
  })

  // Restore an archived task back to the dev_tasks table (as 'done' status). The task
  // reappears on the board's Done column. Removes it from project_archives.
  app.post('/api/projects/:projectId/archives/:aid/restore', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const aid = c.req.param('aid')
    const rows = await cfg.db.query<{
      id: string; title: string; priority: string; category_id: string | null
      sprint_id: string | null; done_at: string | null; original_created_at: string
    }>(`SELECT id, title, priority, category_id, sprint_id, done_at, original_created_at FROM project_archives WHERE id = ? AND project_id = ?`, [aid, p.id])
    if (rows.length === 0) return c.json({ error: 'not_found' }, 404)
    const a = rows[0]
    const now = new Date().toISOString()
    // Re-insert into dev_tasks (status='done'). sort_order = max+1 to put it at the end.
    const maxOrder = await cfg.db.query<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM dev_tasks WHERE project_id = ?`, [p.id])
    const nextOrder = (maxOrder[0]?.m ?? -1) + 1
    await cfg.db.execute(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?)`,
      [a.id, p.id, a.title, a.priority, a.category_id, a.sprint_id, nextOrder, a.original_created_at, a.done_at ?? now],
    )
    await cfg.db.execute('DELETE FROM project_archives WHERE id = ? AND project_id = ?', [aid, p.id])
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    return c.json({ ok: true })
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
        tagId, user.id, body.name, body.color ?? '#8AB8F0', now,
      ])
    }
    await cfg.db.execute('INSERT OR IGNORE INTO dev_task_tags (task_id, tag_id) VALUES (?, ?)', [task.id, tagId])
    return c.json({ ok: true, id: tagId }, 201)
  })

  app.delete('/api/devtasks/:id/tags/:tagId', async (c) => {
    const user = c.get('user')
    const task = await ownedTask(cfg, user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM dev_task_tags WHERE task_id = ? AND tag_id = ?', [task.id, c.req.param('tagId')])
    return c.json({ ok: true })
  })

  // ---- categories (sidebar rows on the sprint page) ----------------------------

  app.post('/api/projects/:projectId/categories', async (c) => {
    const body = await jsonBody<z.infer<typeof createCategorySchema>>(c, createCategorySchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const id = uuid()
    const max = await cfg.db.query<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM task_categories WHERE project_id = ?', [p.id])
    await cfg.db.execute('INSERT INTO task_categories (id, project_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id, p.id, body.name, body.color ?? '#8AB8F0', (max[0]?.m ?? -1) + 1, new Date().toISOString(),
    ])
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/categories/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateCategorySchema>>(c, updateCategorySchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const cat = await ownedCategory(cfg, user.id, c.req.param('id'))
    if (!cat) return c.json({ error: 'not_found' }, 404)
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue
      sets.push(`${k} = ?`)
      params.push(v)
    }
    if (!sets.length) return c.json({ ok: true })
    params.push(cat.id)
    await cfg.db.execute(`UPDATE task_categories SET ${sets.join(', ')} WHERE id = ?`, params)
    return c.json({ ok: true })
  })

  app.delete('/api/categories/:id', async (c) => {
    const user = c.get('user')
    const cat = await ownedCategory(cfg, user.id, c.req.param('id'))
    if (!cat) return c.json({ error: 'not_found' }, 404)
    // ON DELETE SET NULL moves the tasks to Uncategorized; the tag rows go with the tasks.
    await cfg.db.execute('DELETE FROM task_categories WHERE id = ?', [cat.id])
    return c.json({ ok: true })
  })

  // Sidebar row order on the sprint page (same contract as the devtasks reorder above).
  app.post('/api/projects/:projectId/categories/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    // Every id must be one of THIS project's categories — a foreign/unknown id is a 400,
    // not a silently half-applied order.
    const rows = await cfg.db.query<{ id: string }>('SELECT id FROM task_categories WHERE project_id = ?', [p.id])
    const known = new Set(rows.map((r) => r.id))
    if (!body.ids.every((id) => known.has(id))) return c.json({ error: 'invalid_input' }, 400)
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE task_categories SET sort_order = ? WHERE id = ? AND project_id = ?', [i, id, p.id])
      })
    })
    return c.json({ ok: true })
  })

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
    await cfg.db.execute('INSERT INTO sprints (id, project_id, name, started_at, ended_at, is_draft, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)', [
      id, p.id, name, now, now,
    ])
    await logHistory(cfg, p.id, t('{name} defined', '{name} تعریف شد', { name }))
    return c.json({ ok: true, id, name, draft: true }, 201)
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
    // A draft only carries a name (0034) — its dates are set by /start, never by PATCH.
    if (s.is_draft) {
      if (body.started_at !== undefined || body.ended_at !== undefined) return c.json({ error: 'invalid_input' }, 400)
      if (body.name === undefined) return c.json({ ok: true })
      await cfg.db.execute('UPDATE sprints SET name = ? WHERE id = ?', [body.name, s.id])
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
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      sets.push('name = ?')
      params.push(body.name)
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
        tagId, user.id, body.name, body.color ?? '#f6d365', new Date().toISOString(),
      ])
    }
    await cfg.db.execute('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [p.id, tagId])
    return c.json({ ok: true, id: tagId }, 201)
  })

  app.delete('/api/projects/:projectId/tags/:tagId', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM project_tags WHERE project_id = ? AND tag_id = ?', [p.id, c.req.param('tagId')])
    return c.json({ ok: true })
  })

  // HX toast helper kept for any future htmx surface
  app.all('/api/devboard/ping', (c) => {
    const t = trFor(c)
    return c.html(toastHtml(t('Saved', 'ذخیره شد'), localeOf(c)))
  })

  return app
}
