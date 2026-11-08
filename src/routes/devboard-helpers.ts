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
import { executeIn, queryIn } from '../lib/inchunk' // queryIn: S253 (BE-1) — setTaskTags' batched finds
import { errJson, ErrorCode } from '../lib/errors'
import type { Context } from 'hono'
import type { Config, DevTaskRow, SprintRow, SprintStatus, BacklogDocRow, StrategyRow, StrategyStatus } from '../types'

export async function logHistory(cfg: Config, projectId: string, note: string) {
  await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
    uuid(), projectId, note, new Date().toISOString(),
  ])
}

/** S257 (audit BE-16 — the Phase 6 devboard split): the ONE "the project changed"
 *  stamp — `UPDATE projects SET updated_at` was written ×18 across the route tree
 *  (devboard ×9, core/media ×3, core/hurdles, core/links, module). Sites inside a
 *  cfg.db.transaction (hurdles' queued tx.sql) and the two user-scoped module.ts
 *  variants keep their own statement — only the byte-identical cfg.db.execute shape
 *  rides here. `ts` lets a caller reuse a handler-scoped `now` so multi-statement
 *  flows keep stamping ONE instant (omit it for a fresh stamp). */
export async function touchProject(cfg: Config, projectId: string, ts?: string): Promise<void> {
  await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [ts ?? new Date().toISOString(), projectId])
}

/** S257 (audit BE-14): the ONE SET-builder — the `push` closure + entries loop was
 *  written ×4 (devtasks PATCH's column loop, sprints PATCH's two branch arms,
 *  projects PATCH's body loop). Returns the mutable {sets, params, push} so callers
 *  keep stamping special-case columns (done_at / due_origin_at / updated_at) after
 *  the generic entries. Entries semantics: `undefined` values are SKIPPED (the
 *  devboard grammar); projects PATCH's undefined→null belt keeps its own loop shape.
 */
export function buildUpdate(entries: [string, unknown][] = []): {
  sets: string[]
  params: unknown[]
  push: (col: string, val: unknown) => void
} {
  const sets: string[] = []
  const params: unknown[] = []
  for (const [k, v] of entries) {
    if (v === undefined) continue
    sets.push(`${k} = ?`)
    params.push(v)
  }
  const push = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val) }
  return { sets, params, push }
}

/** S257 (audit BE-15): the ONE one-active 409 guard — the verbatim 2-liner lived ×4
 *  (start, resume, PATCH's reopen branch, POST /reopen). Returns the 409 Response
 *  when ANOTHER sprint is active on the project, else null (the caller returns it
 *  as-is: the body + status are byte-identical to the inlined form). */
export async function assertNoActiveSibling(c: Context, cfg: Config, projectId: string, selfId: string): Promise<Response | null> {
  const active = await findActiveSprint(cfg, projectId)
  if (active && active.id !== selfId) return c.json({ error: ErrorCode.sprint_active_exists, active_id: active.id }, 409)
  return null
}

/** S257 (audit BE-15): the ONE latest-sprint reopen guard — the verbatim fold lived
 *  ×2 (PATCH's null-end branch + POST /reopen): only the LATEST sprint by started_at
 *  may reopen (the timeline's trailing-open-band ordering, S235's contract). Returns
 *  the 400 Response when any non-draft sibling starts after `selfStart`, else null.
 *  `others` — optional pre-fetched sibling rows (PATCH already holds the sibling
 *  set); omitted → the canonical started_at query. */
export async function assertLatestSprint(
  c: Context,
  cfg: Config,
  projectId: string,
  selfId: string,
  selfStart: string,
  others?: { started_at: string }[],
): Promise<Response | null> {
  const rows = others ?? (await cfg.db.query<{ started_at: string }>(
    'SELECT started_at FROM sprints WHERE project_id = ? AND id != ? AND is_draft = 0',
    [projectId, selfId],
  ))
  const isLatest = rows.every((x) => Date.parse(x.started_at) <= Date.parse(selfStart))
  return isLatest ? null : errJson(c, ErrorCode.invalid_input)
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

/** S253 (0067 — the BE-8 catch-and-map half of the TOCTOU belt): recognize a UNIQUE
 * violation thrown by one of the migration's indexes so the write sites can answer the
 * SAME 409 their pre-check would have returned instead of a raw 500. Both runtimes
 * surface the SQLite core message (D1 prefixes "D1_ERROR: ", node:sqlite doesn't);
 * expression indexes report their NAME ("UNIQUE constraint failed: index
 * 'idx_sprints_project_name'") while plain/partial column uniques report the COLUMN
 * ("UNIQUE constraint failed: sprints.project_id" — the one-draft AND one-active
 * partials share this text; the call site's context decides which index fired, which
 * is why each catch names only the indexes its statement can actually hit). */
export function uniqueViolationOn(err: unknown, ...needles: string[]): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (!msg.includes('UNIQUE constraint failed')) return false
  return needles.some((n) => msg.includes(n))
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
//
// S252 (BE-9): `siblings` — optional pre-fetched sibling rows (the SAME shape the
// scan query returns: non-draft rows of the project). Callers that already hold
// the set (PATCH fetched it for the reopen-latest guard) pass it and save the
// duplicate round trip; POST-create-with-dates (BE-7) passes a POST-CLOSE VIEW
// of the set (the active sprint's end pre-stamped to its auto-close point) so
// the window can be validated BEFORE the close writes. Omitted → the canonical
// scan runs, exactly as before.
export async function assertSprintWindowOk(
  cfg: Config,
  projectId: string,
  sprintId: string | null,
  newStart: string,
  newEnd: string | null,
  siblings?: SprintRow[],
): Promise<boolean> {
  const rows = siblings ?? (await cfg.db.query<SprintRow>(
    'SELECT * FROM sprints WHERE project_id = ? AND is_draft = 0 ORDER BY started_at',
    [projectId],
  ))
  const dayIdx = (x: string) => Math.floor(Date.parse(x) / 86400000)
  const zeroDay = (start: string, end: string) => dayIdx(start) === dayIdx(end)
  const sameMs = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b)
  const aZero = newEnd !== null && zeroDay(newStart, newEnd)
  for (const x of rows) {
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

// ---- S241 (0065 read surface — the Sprint/Deadline/Dependency pack, Phase 2) ----------
// Spec pack references: §10/§10.3/§12.2 effective deadlines, §15 dependency read model,
// §18 cross-platform consistency (one resolution, computed server-side, so web and
// desktop never fork deadline logic).

/** S241 (spec §15 — the dependency read surface): the flat per-project edge join —
 * one row per blocker→blocked pair, shaped like taskTagsForProject's flat join so the
 * client groups by task: Blocked-by = edges where blocked_task_id = X; the reverse
 * "Blocks N" counts are the same fold's other half (derived, never stored — spec §14).
 * Same-project is a write-time invariant (the deps POST rejects cross-project edges),
 * so scoping through the BLOCKED task's project is exact; ON DELETE CASCADE keeps the
 * join dangling-free. Belt: a lagging pre-0065 D1 (no dev_task_deps table yet) serves
 * [] rather than 500ing the whole board — the categories/tagColorFor precedent. */
export interface TaskDepEdge {
  blocker_task_id: string
  blocked_task_id: string
}
export async function taskDepsForProject(cfg: Config, projectId: string): Promise<TaskDepEdge[]> {
  try {
    return await cfg.db.query<TaskDepEdge>(
      `SELECT d.blocker_task_id, d.blocked_task_id FROM dev_task_deps d
       JOIN dev_tasks t ON t.id = d.blocked_task_id
       WHERE t.project_id = ? ORDER BY d.created_at, d.blocker_task_id, d.blocked_task_id`,
      [projectId],
    )
  } catch {
    return [] // lagging-D1 belt (the deploy-ahead-of-migration race — S57 doctrine)
  }
}

/** S241 (spec §10 — the effective-deadline resolution): personal > sprint-inherited-
 * while-not-completed > none. Computed ONCE, server-side, as additive fields on the
 * board payload's task rows — the recommended Phase 2 default (spec §18: do not fork
 * deadline logic between platforms; the desktop then needs zero deadline logic).
 *
 * §10.3 completed-sprint neutrality: a completed sprint's due date stays in the
 * sprints section for history, but never serves as an ACTIVE deadline for tasks
 * relying only on it. Paused sprints keep theirs (§5.5 — pausing preserves deadlines).
 *
 * §12.2 progress origin: the personal deadline's start = the task's due_origin_at;
 * an inherited deadline's start = the SPRINT's due_origin_at (the shared start point
 * for every task inheriting it). Origins coalesce to the due_at itself when a legacy
 * row carries a deadline without a stamp (NULL ⇔ due_at NULL per types.ts; readers
 * may coalesce). A lagging pre-0065 row (no due columns at all → undefined keys)
 * falls through every `!= null` arm to the null triple. */
export interface EffectiveDeadline {
  effective_due_at: string | null
  effective_due_source: 'task' | 'sprint' | null
  effective_due_origin_at: string | null
}
export function effectiveDeadlineOf(
  task: Pick<DevTaskRow, 'due_at' | 'due_origin_at'>,
  sprint: Pick<SprintRow, 'due_at' | 'due_origin_at' | 'status' | 'is_draft' | 'ended_at'> | null | undefined,
): EffectiveDeadline {
  // §10 precedence 1 — the personal deadline always wins while set (the override).
  if (task.due_at != null) {
    return { effective_due_at: task.due_at, effective_due_source: 'task', effective_due_origin_at: task.due_origin_at ?? task.due_at }
  }
  // §10 precedence 2 — inherit the sprint's deadline while the sprint is NOT
  // completed. sprintStatusOf coalesces a lagging pre-0065 row (whose due_at is
  // absent anyway, so the arm is unreachable there — defense in depth).
  if (sprint && sprint.due_at != null && sprintStatusOf(sprint) !== 'completed') {
    return { effective_due_at: sprint.due_at, effective_due_source: 'sprint', effective_due_origin_at: sprint.due_origin_at ?? sprint.due_at }
  }
  // §10 precedence 3 — no active deadline (completed-sprint neutrality included).
  return { effective_due_at: null, effective_due_source: null, effective_due_origin_at: null }
}

/** S241: the board payload's task rows — the legacy tags split (pre-S241 behavior,
 * byte-identical) plus the additive server-computed effective-deadline fields. One
 * seam so every payload consumer (board page, sprint page, desktop mirror) sees
 * identical rows; the sprint lookup is scoped to THIS project's sprints, so a
 * stray cross-project sprint_id (a pre-existing API-only edge) inherits nothing. */
export function boardTaskRows(
  tasks: (DevTaskRow & { tags: string; shot_count: number })[],
  sprints: SprintRow[],
): (DevTaskRow & { tags: string[]; shot_count: number } & EffectiveDeadline)[] {
  const sprintById = new Map(sprints.map((s) => [s.id, s] as const))
  return tasks.map((t) => ({
    ...t,
    tags: t.tags ? t.tags.split(',') : [],
    ...effectiveDeadlineOf(t, t.sprint_id != null ? sprintById.get(t.sprint_id) : null),
  }))
}

export async function ownedBacklogDoc(cfg: Config, userId: string, id: string): Promise<BacklogDocRow | null> {
  const rows = await cfg.db.query<BacklogDocRow>(
    'SELECT d.* FROM backlog_docs d JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

// ---- S255 (BE-3 — AUDIT-REMEDIATION-SPEC §7 step 1): the lean sprint rows ----------
// The board payload ships every sprint's FULL description (up to 100k chars each —
// the audit's BE-3: bytes no board/sprint surface renders). ?lean=1 opts into a
// diet variant: description is OMITTED and a tiny derived field rides instead —
// doc_checked, the count of "- [x] " checked plan lines (the EXACT grammar the
// sprint page's chip stat has always read off s.description client-side; computed
// server-side here so the lean consumer never needs the heavy field). The DEFAULT
// payload is byte-identical (desktop + the s241 contract untouched).

/** The ☑ grammar: lines starting "- [x] " — byte-identical to the island's
 * sprint-page.js `match(/^- \[x\] /gm)` fold (the chip's "doc checkboxes done"
 * stat). One seam, so the lean field and any client-side fold agree forever. */
export function sprintDocCheckedCount(description: string | null | undefined): number {
  return (String(description ?? '').match(/^- \[x\] /gm) || []).length
}

/** BE-3's lean transform: strip `description`, add `doc_checked`. Every other
 * column rides verbatim (the desktop's Go BoardPayload ignores unknown keys, and
 * the web island reads name/emoji/status/dates/due fields it always had). */
export function leanSprintRows(sprints: SprintRow[]): (Omit<SprintRow, 'description'> & { doc_checked: number })[] {
  return sprints.map(({ description, ...rest }) => ({ ...rest, doc_checked: sprintDocCheckedCount(description) }))
}

// ---- S255 (BE-25 — AUDIT-REMEDIATION-SPEC §7 step 2): the board GET's version stamp ----
// The old etag() hashed the FULL assembled body per request — the DB cost was the
// same and the hash itself walked every byte. This probe is ONE round trip that
// fingerprints everything the payload derives from, checked BEFORE the seven-query
// assembly: a matching If-None-Match answers 304 without assembling anything.
//
// COVERAGE (the correctness contract — a mutation the stamp cannot see would serve
// a stale 304, so every payload-affecting write MUST move at least one component):
//   - dev_tasks:  COUNT + MAX(updated_at). Every column edit stamps updated_at
//     (0061); INSERT stamps it; DELETE/archive moves COUNT. The one writer that
//     did NOT stamp — reorder (sort_order only) — stamps it since S255 (BE-25).
//   - sprints:    COUNT + MAX(updated_at). Every lifecycle write stamps it
//     (POST/PATCH/start/pause/resume/finish/reopen all do); create/delete move COUNT.
//   - strategies: COUNT + MAX(updated_at) (the D8 doctrine stamps every write).
//   - tags:       the user's FULL library fingerprint (id+name+color+usage_count) —
//     the table has no updated_at, so renames/recolors/usage shifts are caught by
//     content, and the payload ships the whole library.
//   - dev_task_tags links: COUNT for this project (link add/remove).
//   - dev_task_deps: COUNT for this project (edges are add/remove-only).
//   - categories: fingerprint of the payload-visible set (id+name+colors+archived+
//     sort_order+enabled) — the exact WHERE the payload query uses, so global
//     renames, recolors, archives and per-project toggles all move it.
//   - screenshots: per-project fingerprint of (id, task_id) — upload/delete/pin/
//     unpin/re-pin all move it (shot_count is the only payload consumer).
//   - the project row itself (title/status/type/updated_at) rides from the row the
//     route already fetched — no extra probe.
// The probe is belt-wrapped: ANY failure (a lagging pre-0066 D1 without the
// strategies table, for instance) returns '' and the route falls back to the old
// body-hash etag — correct, just slower.

/** FNV-1a 32-bit (the etag() recipe in lib/http.ts) — one spelling so the stamp
 * and the legacy body hash share a validator grammar. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export async function boardVersionStamp(cfg: Config, userId: string, p: { id: string; title: string; status: string; type: string | null; updated_at: string }): Promise<string> {
  try {
    const rows = await cfg.db.query<Record<string, string | number>>(
      `SELECT
        (SELECT COUNT(*) || '/' || COALESCE(MAX(updated_at), '') FROM dev_tasks WHERE project_id = ?1) AS tasks_v,
        (SELECT COUNT(*) || '/' || COALESCE(MAX(updated_at), '') FROM sprints WHERE project_id = ?1) AS sprints_v,
        (SELECT COUNT(*) || '/' || COALESCE(MAX(updated_at), '') FROM strategies WHERE project_id = ?1) AS strategies_v,
        (SELECT COALESCE(GROUP_CONCAT(id || CHAR(31) || name || CHAR(31) || color || CHAR(31) || usage_count, CHAR(30)), '') FROM (SELECT id, name, color, usage_count FROM tags WHERE user_id = ?2 ORDER BY id)) AS tags_v,
        (SELECT COUNT(*) FROM dev_task_tags tt JOIN dev_tasks t ON t.id = tt.task_id WHERE t.project_id = ?1) AS links_v,
        (SELECT COUNT(*) FROM dev_task_deps dd JOIN dev_tasks t ON t.id = dd.blocked_task_id WHERE t.project_id = ?1) AS deps_v,
        (SELECT COALESCE(GROUP_CONCAT(c.id || CHAR(31) || c.name || CHAR(31) || c.color_fill || CHAR(31) || c.color_text || CHAR(31) || c.is_archived || CHAR(31) || c.sort_order || CHAR(31) || COALESCE((SELECT COUNT(*) FROM project_categories pc WHERE pc.category_id = c.id AND pc.project_id = ?1), 0), CHAR(30)), '')
           FROM (SELECT c.id, c.name, c.color_fill, c.color_text, c.is_archived, c.sort_order FROM categories c
                 WHERE c.id IN (SELECT category_id FROM dev_tasks WHERE project_id = ?1 AND category_id IS NOT NULL)
                    OR (c.is_archived = 0 AND c.id IN (SELECT category_id FROM project_categories WHERE project_id = ?1))
                 ORDER BY c.id)) AS cats_v,
        (SELECT COALESCE(GROUP_CONCAT(id || CHAR(31) || COALESCE(task_id, '-'), CHAR(30)), '') FROM (SELECT id, task_id FROM screenshots WHERE project_id = ?1 ORDER BY id)) AS shots_v`,
      [p.id, userId],
    )
    const r = rows[0]
    if (!r) return ''
    const parts = [
      String(r.tasks_v), String(r.sprints_v), String(r.strategies_v), String(r.tags_v),
      String(r.links_v), String(r.deps_v), String(r.cats_v), String(r.shots_v),
      `${p.updated_at}/${p.title}/${p.status}/${p.type ?? ''}`,
    ]
    return fnv1a(parts.join('\u001e'))
  } catch {
    return '' // belt: any probe failure → the caller falls back to the body-hash etag
  }
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
 * empty tag table).
 * S253 (BE-1): the counting core is shared with setTaskTags' batched create arm —
 * ONE palette read assigns EVERY missing name (the per-name sequential pick mirrors
 * what N back-to-back tagColorFor calls produced, without N round trips). */
export async function tagColorCounts(cfg: Config, userId: string): Promise<Map<string, number> | null> {
  try {
    const counts = await cfg.db.query<{ color: string; n: number }>(
      'SELECT color, COUNT(*) AS n FROM tags WHERE user_id = ? GROUP BY color',
      [userId],
    )
    return new Map(counts.map((r) => [r.color.toLowerCase(), r.n]))
  } catch {
    return null // defensive: table not migrated yet — tagColorFor keeps its legacy fallback
  }
}

/** The pure pick over a color-count map (tagColorCounts' shape): least-used wins,
 * ties break toward the palette's fixed order, an untouched color wins immediately. */
export function leastUsedPaletteColor(used: Map<string, number>): string {
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
}

export async function tagColorFor(cfg: Config, userId: string): Promise<string> {
  const used = await tagColorCounts(cfg, userId)
  return used ? leastUsedPaletteColor(used) : tagPaletteColor('fallback')
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

/** S252 (audit BE-6 + BE-12): the ONE shared tag find-or-create — race-safe AND
 *  case-consistent. Every tag-attaching site (task tags add, project tags add,
 *  setTaskTags' create arm) resolves ids through here; the three private copies
 *  (two exact-match in devboard.ts, one NOCASE in setTaskTags) are gone.
 *
 *  Layer 1 (BE-12 — case twins): a COLLATE NOCASE find-first reuses the row the
 *  first spelling created ("UI/UX" and "ui/ux" are the SAME label — the
 *  normalizeTagNames grammar); ORDER BY created_at LIMIT 1 picks the OLDEST row
 *  deterministically if legacy exact-case twins already exist (the
 *  UNIQUE(user_id, name) index of 0003 is case-sensitive, so twins are possible
 *  in old data and are never reconciled — write-time reuse is the rule).
 *
 *  Layer 2 (BE-6 — the race): the insert is the H1 recipe already proven at
 *  projects/index.ts (2026-09-10) — INSERT ... ON CONFLICT(user_id, name) DO
 *  UPDATE SET usage_count = tags.usage_count RETURNING id — so a double-click /
 *  offline-queue replay where both requests miss the find still resolve to ONE
 *  id instead of racing the UNIQUE constraint into a 500 (the DO UPDATE is a
 *  values-identical no-op; refreshTagUsage, which every caller runs after, is
 *  the honest keeper of the count). */
export async function findOrCreateTag(cfg: Config, userId: string, name: string, color?: string): Promise<string> {
  const found = await cfg.db.query<{ id: string }>(
    'SELECT id FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE ORDER BY created_at LIMIT 1',
    [userId, name],
  )
  if (found[0]) return found[0].id
  const rows = await cfg.db.query<{ id: string }>(
    `INSERT INTO tags (id, user_id, name, color, usage_count, created_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
     RETURNING id`,
    [uuid(), userId, name, color ?? (await tagColorFor(cfg, userId)), new Date().toISOString()],
  )
  return rows[0].id
}

// Find-or-create each tag by name (user-scoped), then make the task's link set EXACTLY
// these names: add missing links, drop links not in the set. [] clears all tags;
// the caller only invokes this when the body carried a tags array.
// S30: after the link sync this also (a) refreshes usage_count for every touched tag
// (B2) and (b) rewrites the task's search_tags so the FTS index follows (B3/0051).
// S252 (BE-6/BE-12): the create arm resolves through the shared findOrCreateTag —
// same NOCASE semantics this helper always had, now with the ON CONFLICT race belt.
// S253 (BE-1 — the audit's N+1 kill): the whole resolve+sync is BATCHED — a 12-tag
// save used to cost up to ~30 sequential D1 round trips (per-name find, per-missing-
// name palette+insert, per-link delete/insert); it is now a fixed ~6-9 regardless of
// tag count, all under the D1 param cap via queryIn/executeIn chunking:
//   1. ONE find (NOCASE IN, oldest-row-wins on legacy case twins — findOrCreateTag's
//      grammar, verified: COLLATE NOCASE applies to IN-list comparison);
//   2. missing names → ONE palette read (tagColorCounts) + ONE chunked multi-row
//      INSERT … ON CONFLICT(user_id, name) DO UPDATE … RETURNING (the H1 race recipe
//      findOrCreateTag uses, one statement for ALL names — a concurrent same-name
//      write still resolves to the existing id, never a 500);
//   3. ONE existing-links read, then executeIn-chunked DELETE (dropped) + INSERT OR
//      IGNORE … SELECT (added). Response shape unchanged: TaskTagJoin[] ordered by
//      name (sorted in JS so chunk-merging can never reorder).
export async function setTaskTags(cfg: Config, userId: string, taskId: string, names: string[]): Promise<TaskTagJoin[]> {
  const wanted = normalizeTagNames(names)
  const key = (n: string) => n.toLowerCase()
  // 1. ONE find: every wanted name against the library, case-insensitively.
  const found = wanted.length
    ? await queryIn<{ id: string; name: string }>(
        cfg.db,
        'SELECT id, name FROM tags WHERE user_id = ? AND name COLLATE NOCASE IN {{IN}} ORDER BY created_at',
        [userId],
        wanted,
      )
    : []
  const idByName = new Map<string, string>()
  for (const row of found) if (!idByName.has(key(row.name))) idByName.set(key(row.name), row.id) // oldest wins
  // 2. Missing names → ONE palette read + ONE chunked multi-row create.
  const missing = wanted.filter((n) => !idByName.has(key(n)))
  if (missing.length) {
    const now = new Date().toISOString()
    const used = (await tagColorCounts(cfg, userId)) ?? new Map<string, number>()
    const rows: { id: string; name: string; color: string }[] = missing.map((name) => {
      const color = leastUsedPaletteColor(used)
      used.set(color.toLowerCase(), (used.get(color.toLowerCase()) ?? 0) + 1) // the next pick sees this one
      return { id: uuid(), name, color }
    })
    // 6 bound params/row → 16 rows/chunk under D1's 100-param cap.
    for (let i = 0; i < rows.length; i += 16) {
      const part = rows.slice(i, i + 16)
      const values = part.map(() => '(?, ?, ?, ?, 0, ?)').join(', ')
      const params = part.flatMap((r) => [r.id, userId, r.name, r.color, now])
      const inserted = await cfg.db.query<{ id: string; name: string }>(
        `INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ${values}
         ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
         RETURNING id, name`,
        params,
      )
      for (const r of inserted) idByName.set(key(r.name), r.id)
    }
    // Belt (unreachable in practice — every RETURNING row maps a sent name): any name
    // the batch still didn't resolve rides the single-name shared resolver.
    for (const name of missing) {
      if (!idByName.has(key(name))) idByName.set(key(name), await findOrCreateTag(cfg, userId, name))
    }
  }
  const keepIds = wanted.map((n) => idByName.get(key(n))!).filter(Boolean)
  // 3. ONE existing-links read + chunked link sync (add missing, drop unkept).
  const existing = await cfg.db.query<{ tag_id: string }>('SELECT tag_id FROM dev_task_tags WHERE task_id = ?', [taskId])
  const keep = new Set(keepIds)
  const dropped = existing.map((r) => r.tag_id).filter((id) => !keep.has(id))
  if (dropped.length) {
    await executeIn(cfg.db, 'DELETE FROM dev_task_tags WHERE task_id = ? AND tag_id IN {{IN}}', [taskId], dropped)
  }
  if (keepIds.length) {
    await executeIn(
      cfg.db,
      'INSERT OR IGNORE INTO dev_task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE id IN {{IN}}',
      [taskId],
      keepIds,
    )
  }
  // S30 (B2 + B3): usage_count follows the link delta (dropped links included), and
  // the task's searchable label text is rewritten so FTS sees the new set.
  await refreshTagUsage(cfg, [...keepIds, ...existing.map((r) => r.tag_id)])
  await syncTaskSearchTags(cfg, taskId)
  if (!keepIds.length) return [] // cleared — nothing to paint
  const joined = await queryIn<TaskTagJoin>(
    cfg.db,
    'SELECT ? AS task_id, id, name, color FROM tags WHERE id IN {{IN}}',
    [taskId],
    keepIds,
  )
  return joined.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
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


// ---- S250 (0066 — the Strategies layer, STRATEGIES-SPEC.md §4) ----------------------

/** S250: user-scoped strategy resolution (rule 1 — the ownedSprint grammar): a foreign
 *  strategy id (or one on a deleted project) is simply not found. */
export async function ownedStrategy(cfg: Config, userId: string, id: string): Promise<StrategyRow | null> {
  const rows = await cfg.db.query<StrategyRow>(
    'SELECT st.* FROM strategies st JOIN projects p ON p.id = st.project_id WHERE st.id = ? AND p.user_id = ? AND p.deleted_at IS NULL',
    [id, userId],
  )
  return rows[0] ?? null
}

/** S250 (spec §4 — the sprint-name grammar, reused): case-insensitive name uniqueness
 *  within ONE project across ALL lifecycle states (a completed strategy still holds its
 *  name — history). `excludeId` lets a strategy re-assert its own name on PATCH. */
export async function strategyNameTaken(cfg: Config, projectId: string, name: string, excludeId?: string): Promise<boolean> {
  const rows = await cfg.db.query<{ id: string }>(
    'SELECT id FROM strategies WHERE project_id = ? AND lower(trim(name)) = lower(trim(?))',
    [projectId, name],
  )
  return rows.some((r) => r.id !== excludeId)
}

/** S250 (spec §4 — the assignment guard): validates a strategy_id being attached to a
 *  sprint of `projectId`. Returns 'ok' | 'not_found' | 'completed' — the caller maps
 *  each verdict to its HTTP answer. Assignable = active + paused ONLY (owner decision
 *  #11: a completed strategy is a finished direction — it keeps its existing sprint
 *  history visible but takes no new/edited assignments). */
export async function strategyAssignable(
  cfg: Config,
  projectId: string,
  strategyId: string,
): Promise<'ok' | 'not_found' | 'completed'> {
  const rows = await cfg.db.query<{ status: StrategyStatus }>(
    'SELECT status FROM strategies WHERE id = ? AND project_id = ?',
    [strategyId, projectId],
  )
  if (!rows.length) return 'not_found'
  return rows[0].status === 'completed' ? 'completed' : 'ok'
}

/** S250 (spec §4 — the priority-first board order, the task-column rule): urgent →
 *  high → medium → low, oldest first within a tier. Shared by the payload SELECT. */
export const STRATEGY_PRIO_ORDER_SQL = `CASE st.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, st.created_at`
