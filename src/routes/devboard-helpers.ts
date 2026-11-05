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

import { uuid } from '../lib/ids'
import { executeIn } from '../lib/inchunk'
import type { Config, DevTaskRow, SprintRow, SprintStatus, BacklogDocRow } from '../types'

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

// S152: the task-create/edit validation — a category_id must reference a LIVE
// global category that is ENABLED on the task's project (the picker set is the
// single-select source; block 3 + block 7).
export async function categoryEnabledOnProject(cfg: Config, projectId: string, id: string): Promise<boolean> {
  const rows = await cfg.db.query<{ id: string }>(
    'SELECT c.id FROM categories c JOIN project_categories pc ON pc.category_id = c.id WHERE c.id = ? AND pc.project_id = ? AND c.is_archived = 0',
    [id, projectId],
  )
  return Boolean(rows[0])
}

export async function ownedSprint(cfg: Config, userId: string, id: string): Promise<SprintRow | null> {
  const rows = await cfg.db.query<SprintRow>(
    'SELECT s.* FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

// ---- S240 (0065 — the Sprint/Deadline/Dependency feature pack, Phase 1) ---------------
// Spec pack references: §4-8 sprints, §5 lifecycle, §19 data integrity.

/** S240: the sprint's lifecycle status, coalesced. Post-0065 the status column is the
 * truth (every service-layer write stamps it; the migration backfilled every legacy
 * row). On a LAGGING pre-0065 D1 (the deploy-ahead-of-migration race — the S57
 * doctrine) the row arrives without the key, and the legacy is_draft/ended_at pair
 * re-derives the identical value (exactly the backfill's CASE — no paused row can
 * pre-exist the pause endpoint), so lifecycle guards keep working through the race. */
export function sprintStatusOf(s: Pick<SprintRow, 'status' | 'is_draft' | 'ended_at'>): SprintStatus {
  return s.status ?? (s.ended_at != null ? 'completed' : s.is_draft ? 'planned' : 'active')
}

/** S240 (spec §5.1 — one active sprint per project): scans the project's small
 * open-window set (is_draft=0 AND ended_at IS NULL — active + paused post-0065) and
 * keeps only the ACTIVE one. The legacy-compatible query runs unchanged on a
 * pre-0065 D1 (there, open ≡ active — the derivation is exact); the partial unique
 * index idx_sprints_one_active (0065) is the belt if two writes race the check. */
export async function findActiveSprint(cfg: Config, projectId: string): Promise<SprintRow | null> {
  const open = await cfg.db.query<SprintRow>(
    'SELECT * FROM sprints WHERE project_id = ? AND is_draft = 0 AND ended_at IS NULL',
    [projectId],
  )
  return open.find((s) => sprintStatusOf(s) === 'active') ?? null
}

/** S240 (spec §4.3 — duplicate names): case-insensitive name uniqueness within ONE
 * project across ALL lifecycle states (a completed sprint still holds its name —
 * history). The lower(trim()) fold matches the categories precedent
 * (idx_categories_user_name_live, 0064). `excludeId` lets PATCH rename-in-place scan
 * everyone EXCEPT the sprint being renamed (re-asserting one's own name stays legal —
 * the old Edit modal resends fields verbatim). Pre-existing legacy case-twins are NOT
 * reconciled by the migration; this write-time gate is the rule. */
export async function sprintNameTaken(cfg: Config, projectId: string, name: string, excludeId?: string): Promise<boolean> {
  const rows = await cfg.db.query<{ id: string }>(
    'SELECT id FROM sprints WHERE project_id = ? AND lower(trim(name)) = lower(trim(?))',
    [projectId, name],
  )
  return rows.some((r) => r.id !== excludeId)
}

// S235 (the sprint audit — §4.2 overlap gap): the shared sprint-window overlap
// check, lifted out of the PATCH handler (devboard.ts:666-686) so POST-create-
// with-dates + POST-start can call the SAME validation. Without this, a user
// could create "Sprint 5 (Mar 1 → Mar 30)" while "Sprint 4 (Mar 15 → Mar 20)"
// exists — they'd overlap on the timeline (the PATCH branch caught this, the
// POST branches did not).
//
// Returns ErrorCode.invalid_input if the new [newStart, newEnd] window overlaps
// any non-draft sibling (excluding `sprintId` itself — null for a new sprint),
// or null if the window is clean. The zero-day touching exception (a range
// spanning ZERO days that TOUCHES a sibling at the exact same instant) is
// allowed — the "closed sprint ends precisely where the new one starts" case.
//
// `newEnd = null` means the new sprint is OPEN (ended_at IS NULL) — treated as
// +∞ for the overlap comparison (an open sprint overlaps anything that starts
// on or after its start day).
//
// S240 (0065, the pack's D1 resolution): a PAUSED sprint keeps its open window
// (ended_at stays NULL — the timeline's band survives) but is NOT active, so it
// no longer blocks sibling windows — it is filtered out of this scan and a
// later sprint may legally open alongside it. The Phase 4 timeline round
// renders paused bands distinctly. The scan query itself stays legacy-compatible
// (no status column reference — a pre-0065 D1 runs it unchanged; the JS filter
// is a no-op there because paused rows cannot pre-exist the pause endpoint).
export async function assertSprintWindowOk(
  cfg: Config,
  projectId: string,
  sprintId: string | null,
  newStart: string,
  newEnd: string | null,
): Promise<boolean> {
  const siblings = await cfg.db.query<SprintRow>(
    'SELECT * FROM sprints WHERE project_id = ? AND is_draft = 0 ORDER BY started_at',
    [projectId],
  )
  const dayIdx = (x: string) => Math.floor(Date.parse(x) / 86400000)
  const zeroDay = (start: string, end: string) => dayIdx(start) === dayIdx(end)
  const sameMs = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b)
  const aZero = newEnd !== null && zeroDay(newStart, newEnd)
  for (const x of siblings) {
    if (sprintId !== null && x.id === sprintId) continue
    if (sprintStatusOf(x) === 'paused') continue // S240: paused keeps its window, blocks nobody
    const bZero = x.ended_at !== null && zeroDay(x.started_at, x.ended_at)
    if (
      (bZero || aZero) &&
      (sameMs(newStart, x.started_at) || sameMs(newStart, x.ended_at) || sameMs(newEnd, x.started_at) || sameMs(newEnd, x.ended_at))
    ) continue
    const aS = dayIdx(newStart)
    const aE = newEnd === null ? Infinity : dayIdx(newEnd)
    const bS = dayIdx(x.started_at)
    const bE = x.ended_at === null ? Infinity : dayIdx(x.ended_at)
    if (aS <= bE && bS <= aE) return false // overlap
  }
  return true // ok
}

export async function ownedBacklogDoc(cfg: Config, userId: string, id: string): Promise<BacklogDocRow | null> {
  const rows = await cfg.db.query<BacklogDocRow>(
    'SELECT d.* FROM backlog_docs d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

// ---- task labels (S29 agenda 5 follow-up — user request 2026-09-12) -----------------------
// "each task can have label or meta tag, for example UI/UX, Security". dev_task_tags (0029)
// links tasks to the user-scoped tags table; these helpers normalize + find-or-create +
// sync the link set. New tags get a palette color picked LEAST-USED-FIRST (B4, 2026-09-12:
// the old name-hash collided — "Refactor" and "Tech-Debt" both hashed to #E59AA5), so
// fresh labels spread across the palette before ever doubling up.
export const TAG_PALETTE = ['#8AB8F0', '#E8B27D', '#E59AA5', '#8FD3A9', '#B3A5D6', '#7CC7C1', '#F2D58A', '#C9CDD2']
export function tagPaletteColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return TAG_PALETTE[h % TAG_PALETTE.length]
}

/** B4: pick the palette color least-used by this user's existing tags — collisions
 * ("Refactor" vs "Tech-Debt" both #E59AA5) become structurally rare instead of
 * hash-inevitable. Ties break toward the palette's fixed order (deterministic for an
 * empty tag table). */
export async function tagColorFor(cfg: Config, userId: string): Promise<string> {
  try {
    const counts = await cfg.db.query<{ color: string; n: number }>(
      'SELECT color, COUNT(*) AS n FROM tags WHERE user_id = ? GROUP BY color',
      [userId],
    )
    const used = new Map(counts.map((r) => [r.color.toLowerCase(), r.n]))
    let best = TAG_PALETTE[0]
    let bestN = Infinity
    for (const c of TAG_PALETTE) {
      const n = used.get(c.toLowerCase()) ?? 0
      if (n < bestN) {
        best = c
        bestN = n
        if (n === 0) break // untouched color — take it, stop scanning
      }
    }
    return best
  } catch {
    return tagPaletteColor('fallback') // defensive: table not migrated yet
  }
}

/** B2 (2026-09-12): tags.usage_count was dead — written 0 at insert, never maintained.
 * Recompute the real usage (dev-task links + project links) for the given tag ids after
 * ANY link mutation. Cheap (two COUNT subqueries per id), and it is what makes the
 * label manager's "used 12×" honest. */
export async function refreshTagUsage(cfg: Config, tagIds: string[]): Promise<void> {
  const ids = [...new Set(tagIds.filter(Boolean))]
  if (!ids.length) return
  // AP-20: chunked — a 500-task rename can touch more than 99 tags.
  await executeIn(
    cfg.db,
    `UPDATE tags SET usage_count =
       (SELECT COUNT(*) FROM dev_task_tags WHERE tag_id = tags.id) +
       (SELECT COUNT(*) FROM project_tags WHERE tag_id = tags.id)
     WHERE tags.id IN {{IN}}`,
    [],
    ids,
  )
}

/** B3 (2026-09-12): dev_tasks.search_tags (0051) is the denormalized space-joined
 * label-name column the FTS5 external-content table reads. The app rewrites it after
 * every link mutation; the generic dev_tasks_fts_au trigger then re-indexes the row.
 * Never index tag IDs here — the searchable text is the NAME the user typed. */
export async function syncTaskSearchTags(cfg: Config, taskId: string): Promise<void> {
  await cfg.db.execute(
    `UPDATE dev_tasks SET search_tags = COALESCE(
       (SELECT group_concat(tg.name, ' ') FROM dev_task_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.task_id = ?), '') WHERE id = ?`,
    [taskId, taskId],
  )
}

/** S200 (PERF-12): the BATCHED syncTaskSearchTags — one UPDATE for N tasks instead
 * of N round trips (a 500-task tag rename used to cost 500 sequential D1 queries;
 * each ~10-40 ms RTT on Workers). Semantics identical to the per-task version:
 * recompute every listed task's space-joined tag-name string from the CURRENT
 * dev_task_tags rows; the FTS trigger re-indexes each updated row. Same IN-list
 * recipe as refreshTagUsage / loadProjectSignals. */
export async function syncTaskSearchTagsBatch(cfg: Config, taskIds: string[]): Promise<void> {
  const ids = [...new Set(taskIds.filter(Boolean))]
  if (!ids.length) return
  // AP-20: chunked — this exact helper is sized for 500-task renames (S200 comment),
  // which exceeds D1's 100-param cap in one statement.
  await executeIn(
    cfg.db,
    `UPDATE dev_tasks SET search_tags = COALESCE(
       (SELECT group_concat(tg.name, ' ') FROM dev_task_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.task_id = dev_tasks.id), '')
     WHERE dev_tasks.id IN {{IN}}`,
    [],
    ids,
  )
}

// One flat row shape for every task-tag join (detail page render + devboard GET).
export interface TaskTagJoin {
  task_id: string
  id: string
  name: string
  color: string
}
export async function taskTagsForProject(cfg: Config, projectId: string): Promise<TaskTagJoin[]> {
  return cfg.db.query<TaskTagJoin>(
    `SELECT tt.task_id, tg.id, tg.name, tg.color FROM dev_task_tags tt
     JOIN dev_tasks t ON t.id = tt.task_id JOIN tags tg ON tg.id = tt.tag_id
     WHERE t.project_id = ? ORDER BY tg.name`,
    [projectId],
  )
}

// Normalize a raw names list (trim, clamp, case-insensitive dedupe — "UI/UX" and
// "ui/ux" are the SAME label; the find-or-create lookup below is exact-match, so
// dedupe keeps the link set from drifting into case twins).
export function normalizeTagNames(names: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const n = raw.trim().slice(0, 48)
    if (!n) continue
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

// Find-or-create each tag by name (user-scoped), then make the task's link set EXACTLY
// these names: add missing links, drop links not in the set. [] clears all tags;
// the caller only invokes this when the body carried a tags array.
// S30: after the link sync this also (a) refreshes usage_count for every touched tag
// (B2) and (b) rewrites the task's search_tags so the FTS index follows (B3/0051).
export async function setTaskTags(cfg: Config, userId: string, taskId: string, names: string[]): Promise<TaskTagJoin[]> {
  const wanted = normalizeTagNames(names)
  const keepIds: string[] = []
  for (const name of wanted) {
    // COLLATE NOCASE: "UI/UX" and "ui/ux" are the SAME label — the lookup reuses the
    // row the first spelling created instead of forking a case twin.
    const found = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE', [userId, name])
    if (found[0]) {
      keepIds.push(found[0].id)
      continue
    }
    const id = uuid()
    await cfg.db.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', [
      id, userId, name, await tagColorFor(cfg, userId), new Date().toISOString(),
    ])
    keepIds.push(id)
  }
  const existing = await cfg.db.query<{ tag_id: string }>('SELECT tag_id FROM dev_task_tags WHERE task_id = ?', [taskId])
  const keep = new Set(keepIds)
  for (const row of existing) {
    if (!keep.has(row.tag_id)) await cfg.db.execute('DELETE FROM dev_task_tags WHERE task_id = ? AND tag_id = ?', [taskId, row.tag_id])
  }
  for (const id of keepIds) {
    await cfg.db.execute('INSERT OR IGNORE INTO dev_task_tags (task_id, tag_id) VALUES (?, ?)', [taskId, id])
  }
  // S30 (B2 + B3): usage_count follows the link delta (dropped links included), and
  // the task's searchable label text is rewritten so FTS sees the new set.
  await refreshTagUsage(cfg, [...keepIds, ...existing.map((r) => r.tag_id)])
  await syncTaskSearchTags(cfg, taskId)
  if (!keepIds.length) return [] // cleared — an empty IN () is not valid SQL
  return cfg.db.query<TaskTagJoin>(
    'SELECT ? AS task_id, id, name, color FROM tags WHERE id IN (' + keepIds.map(() => '?').join(',') + ') ORDER BY name',
    [taskId, ...keepIds],
  )
}

// Priority-first column ordering (user request 2026-09-12: "they must be auto-sorted in
// their boxes based on their priority") — urgent → high → medium → low, then the manual
// drag order (sort_order) and age. Every task listing shares this ORDER BY so the
// project page, board.html and the sprint page agree.
export const PRIO_ORDER_SQL =
  "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END"

export type BacklogEvent = { at: string; kind: 'doc_created' | 'doc_updated' | 'item_added'; label: string }

/** The whole backlog payload (0033): docs + the merged change history (revisions and
 *  quick planned items, newest first, top 10) + the latest change timestamp. Shared by
 *  the projects route's «برنامه آتی» tab and this module's JSON route. */
export async function loadBacklog(cfg: Config, projectId: string): Promise<{
  docs: BacklogDocRow[]
  history: BacklogEvent[]
  latestAt: string | null
  /** S105: the plan ITEMS (planned dev_tasks) — the Plans tab renders them live. */
  plans: { id: string; title: string; priority: string | null; created_at: string }[]
}> {
  const [docs, revisions, planned, planRows] = await Promise.all([
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
    // S105: the full planned list for the Plans tab's live re-render (client blRefresh).
    cfg.db.query<{ id: string; title: string; priority: string | null; created_at: string }>(
      `SELECT id, title, priority, created_at FROM dev_tasks WHERE project_id = ? AND status = 'planned' ORDER BY created_at DESC`,
      [projectId],
    ),
  ])
  const events: BacklogEvent[] = [
    ...revisions.map((r) => ({ at: r.created_at, kind: r.kind === 'create' ? ('doc_created' as const) : ('doc_updated' as const), label: r.title })),
    ...planned.map((t) => ({ at: t.created_at, kind: 'item_added' as const, label: t.title })),
  ]
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return { docs, history: events.slice(0, 10), latestAt: events[0]?.at ?? null, plans: planRows }
}

