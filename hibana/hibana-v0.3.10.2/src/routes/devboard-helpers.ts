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

export async function logHistory(cfg: Config, projectId: string, note: string) {
  await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
    uuid(), projectId, note, new Date().toISOString(),
  ])
}

export async function ownedTask(cfg: Config, userId: string, id: string): Promise<DevTaskRow | null> {
  const rows = await cfg.db.query<DevTaskRow>(
    'SELECT t.* FROM dev_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

export async function ownedCategory(cfg: Config, userId: string, id: string): Promise<TaskCategory | null> {
  const rows = await cfg.db.query<TaskCategory>(
    'SELECT c.* FROM task_categories c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

export async function ownedSprint(cfg: Config, userId: string, id: string): Promise<SprintRow | null> {
  const rows = await cfg.db.query<SprintRow>(
    'SELECT s.* FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

export async function ownedBacklogDoc(cfg: Config, userId: string, id: string): Promise<BacklogDocRow | null> {
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

