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
import type { Config, UserRow, DevTaskRow, SprintRow, TagRow, StrategyRow } from '../types'
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
  // S245 (spec pack Phase 6 — §13.4, the inherited-extension ORIGIN RIDE-ALONG):
  // the task-only extension of an INHERITED deadline creates a personal override
  // (null→value), which by the rule above would stamp due_origin_at = now and make
  // the bar look newly assigned — §13.4 instead demands the SPRINT's original
  // progress origin ride along ("preserve the inherited deadline's original
  // progress origin"). This ADDITIVE optional field is honored ONLY when it
  // accompanies a null→value transition; every other case (value→value, value→null,
  // or sent alone) ignores it — the origin rules above stay the single truth.
  // Island-transparent (the desktop Go decode ignores unknown keys); the kickoff's
  // recorded decision over a server special-case (contract §12.2/§12.4 document it).
  due_origin_at: isoDate.optional(),
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
  // S250 (0066): assign the strategy TOGETHER with the define (owner decision #11 —
  // "assign strategy and sprint together"). Handler-guarded: same project, active+paused.
  strategy_id: z.string().max(64).nullable().optional(),
}).refine(sprintRangeOk, { message: 'bad_range' }) // S235: reject end <= start at create time
const updateSprintSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  version: z.string().trim().min(1).max(40).nullable().optional(), // explicit null clears the label
  description: z.string().max(100_000).optional(),
  emoji: sprintEmoji, // S240: explicit null clears the emoji back to the default glyph
  due_at: isoDate.nullable().optional(), // S240: null→value stamps the origin; value→value keeps it; null clears both
  started_at: isoDate.optional(),
  ended_at: isoDate.nullable().optional(), // explicit null = reopen this sprint's end
  // S250 (0066 — STRATEGIES-SPEC §4): re-assign or clear the strategy this sprint
  // serves. Explicit null clears; undefined = untouched. Assignability (same project,
  // active+paused only) is handler-guarded via strategyAssignable.
  strategy_id: z.string().max(64).nullable().optional(),
})
const reorderSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(500) })
// S250 (0066 — STRATEGIES-SPEC §4): the strategy tier above sprints. Name grammar is
// the sprint one (1-80, case-insensitive unique per project); description is a plain
// light note (NOT the sprint's 100k rich doc — it renders as text in the editor +
// tooltips); priority REUSES the task vocabulary (owner decision #3); emoji rides the
// same single-token contract (decision #8).
const strategyEmoji = z.string().trim().max(16).regex(EMOJI_TOKEN_RE).nullish()
const createStrategySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  emoji: strategyEmoji,
  priority: prioritySchema.optional(),
})
const updateStrategySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).nullable().optional(), // explicit null clears the note
  emoji: strategyEmoji,
  priority: prioritySchema.optional(),
  // S250 (owner decision #4/#9): the explicit lifecycle. Transitions are free EXCEPT
  // →completed, which the handler guards (an ACTIVE sprint still serving this strategy
  // blocks it — "Finish or pause its active sprint first").
  status: z.enum(['active', 'paused', 'completed']).optional(),
})
const tagBodySchema = z.object({ name: z.string().trim().min(1).max(60), color: hexColor.optional() })
// S240 (0065 — spec pack §14): one Blocked-by edge. The blocker is a task id in the
// SAME project (cross-project is rejected in the handler via ownedTask on both ends —
// a foreign id is a 400, never a 500). Self-edges and cycles are handler-guarded too.
const createTaskDepSchema = z.object({ blocker_id: z.string().max(64) })
// S253 (BE-5b — the audit's unbounded-read cap): the archives shelf's ADDITIVE paging
// param — the quicknotes archiveQuerySchema grammar (coerced int, hard bounds), so
// absence = page 0 and every pre-S253 client stays byte-identically served.
const archiveOffsetSchema = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0) })
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
  findOrCreateTag, // S252 (BE-6/BE-12): the ONE shared race-safe + case-consistent tag resolver
  type TaskTagJoin, // S252 (BE-5a): the archive-done link fold's row shape
  refreshTagUsage,
  syncTaskSearchTags,
  PRIO_ORDER_SQL,
  assertSprintWindowOk, // S235: the shared overlap check (audit §4.2)
  sprintStatusOf, // S240 (0065): lifecycle coalescing (lagging-D1 belt included)
  findActiveSprint, // S240 (0065): the one-active lookup (spec §5.1)
  sprintNameTaken, // S240 (0065): case-insensitive project-scoped name uniqueness (§4.3)
  uniqueViolationOn, // S253 (0067): the BE-8 catch-and-map — TOCTOU belt verdicts → the existing 409s
  taskDepsForProject, // S241 (0065 read surface): the flat per-project dep edge join (§15)
  boardTaskRows, // S241: task rows + the server-computed effective deadline (§10/§18)
  ownedStrategy, // S250 (0066): user-scoped strategy resolution (STRATEGIES-SPEC §4)
  strategyNameTaken, // S250: case-insensitive project-scoped name uniqueness (the sprint grammar)
  strategyAssignable, // S250: the assignment guard — active+paused only, completed never
  STRATEGY_PRIO_ORDER_SQL, // S250: priority-first board order (the task-column rule)
  leanSprintRows, // S255 (BE-3): the ?lean=1 board payload's sprint-row transform
  boardVersionStamp, // S255 (BE-25): the one-round-trip version stamp behind the board GET's 304s
} from './devboard-helpers'

export function devboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // ---- one payload for every surface (board page, sprint page, detail preview) ----
  app.get('/api/projects/:projectId/devboard', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // S255 (BE-3 — AUDIT-REMEDIATION-SPEC §7 step 1): the OPT-IN payload diet.
    // ?lean=1 omits sprints[].description (up to 100k chars each that no board or
    // sprint surface renders) and adds the tiny derived doc_checked in its place;
    // the DEFAULT payload is byte-identical — the desktop mirror + the s241
    // island-shape contract ride the default and are untouched by design.
    const lean = c.req.query('lean') === '1'
    // S255 (BE-25 — AUDIT-REMEDIATION-SPEC §7 step 2): the version-stamp weak ETag,
    // checked BEFORE the seven-query assembly. ONE cheap probe fingerprints every
    // table the payload derives from (see boardVersionStamp's coverage contract);
    // a matching If-None-Match answers 304 with zero assembly — the desktop sync
    // round's conditional poll (client.go's get() sends the stored validator) skips
    // the whole load on unchanged boards. The tag carries the lean marker so the
    // two payload variants never cross-304. A NON-conditional request never 304s
    // (exact-match against the sent header), so the desktop's RequestFresh path
    // and the web island's no-store GETs are untouched. Stamp probe failure (a
    // lagging D1) falls through to the legacy body-hash etag below — belt, not break.
    const stamp = await boardVersionStamp(cfg, user.id, p)
    const tag = stamp ? `W/"${lean ? 'l' : 'b'}${stamp}"` : ''
    if (tag && c.req.header('If-None-Match') === tag) {
      return new Response(null, { status: 304, headers: { ETag: tag, 'Cache-Control': 'private, no-cache' } })
    }
    const [tasks, sprints, tags, taskTags, categories, taskDeps, strategies] = await Promise.all([
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
      // S250 (0066 — STRATEGIES-SPEC §4): the 8th additive payload key — the project's
      // strategy registry, priority-first then oldest-first (the task-column rule; the
      // client's roll-ups derive from tasks+sprints it already holds). The catch→[]
      // belt (the categories grammar) keeps a lagging pre-0066 D1 serving the board
      // gracefully instead of 500ing it.
      cfg.db.query<StrategyRow>(
        `SELECT st.* FROM strategies st WHERE st.project_id = ? ORDER BY ${STRATEGY_PRIO_ORDER_SQL}`,
        [p.id],
      ).catch(() => [] as StrategyRow[]),
    ])
    const boardRes = c.json({
      project: { id: p.id, title: p.title, status: p.status, type: p.type },
      // S241 (spec §10/§18): task rows carry the server-computed effective deadline
      // (personal > sprint-inherited-while-not-completed > none) — additive fields,
      // every legacy key intact (pinned by the S241 island-shape test).
      tasks: boardTaskRows(tasks, sprints),
      categories,
      // S255 (BE-3): the lean variant strips description + adds doc_checked; the
      // default rows ride verbatim (the effective-deadline fold above always sees
      // the FULL rows — description plays no part in it, but the fold runs before
      // the transform so both payload variants share one code path).
      sprints: lean ? leanSprintRows(sprints) : sprints,
      tags,
      // S250: the 8th additive key — the strategy registry (spec §4). Every pre-S250
      // client (the desktop island pre-re-pin included) ignores unknown keys; the
      // S241 payload pin test moves to the eight-key set.
      strategies,
      // Flat per-task label join ({task_id, id, name, color}) — one query, joined
      // client-side by whoever renders cards.
      task_tags: taskTags,
      // S241: flat dep edges ({blocker_task_id, blocked_task_id}) — the client folds
      // Blocked-by and the reverse Blocks-N counts by task (spec §15).
      task_deps: taskDeps,
    })
    // S255 (BE-25): the stamp ETag rides the 200s too — it is the validator the
    // NEXT conditional request compares against (the desktop poll stores it
    // client-side; client.go's absorb). Same headers the legacy etag() stamped.
    if (tag) {
      boardRes.headers.set('ETag', tag)
      boardRes.headers.set('Cache-Control', 'private, no-cache')
      return boardRes
    }
    return await etag(c, boardRes) // belt: the stamp probe failed — the old body-hash path
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
    // S245 (§13.4): the null→value arm honors the client's due_origin_at ride-along
    // when one is sent (the J3 task-only-from-inherited flow preserving the SPRINT's
    // origin); without one it stamps now, exactly as before.
    if (dueAt !== undefined) {
      sets.push('due_at = ?')
      params.push(dueAt)
      if (dueAt === null) {
        sets.push('due_origin_at = ?')
        params.push(null)
      } else if (task.due_at == null) {
        sets.push('due_origin_at = ?')
        params.push(dueOriginAt ?? now)
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
    // S252 (BE-5a): the link fetch filters SQL-side by the SAME done-task predicate
    // (no id IN list → no D1 param cap, and no over-fetch of every link in the
    // project), and the fold is Set-keyed — the old per-row tasks.find scan was the
    // audit's O(n²). The Set check stays as a belt for a status flip racing the two
    // reads (snapshot set and delete set must agree).
    const links = await cfg.db.query<TaskTagJoin>(
      `SELECT tt.task_id, tg.id, tg.name, tg.color FROM dev_task_tags tt
       JOIN dev_tasks t ON t.id = tt.task_id JOIN tags tg ON tg.id = tt.tag_id
       WHERE t.project_id = ? AND t.status = 'done' ORDER BY tg.name`,
      [p.id],
    )
    const taskIds = new Set(tasks.map((tk) => tk.id))
    const tagsByTask = new Map<string, { name: string; color: string }[]>()
    for (const row of links) {
      if (!taskIds.has(row.task_id)) continue // only the tasks being archived carry links
      const list = tagsByTask.get(row.task_id) ?? []
      list.push({ name: row.name, color: row.color })
      tagsByTask.set(row.task_id, list)
    }
    const now = new Date().toISOString()
    const touchedTagIds = links.filter((l) => taskIds.has(l.task_id)).map((l) => l.id)
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
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, p.id])
    await logHistory(cfg, p.id, t('{n} done tasks archived', '{n} کار انجام‌شده بایگانی شد', { n: String(tasks.length) }))
    return c.json({ ok: true, archived: tasks.length })
  })

  // GET the archives for a project — the permanent record of archived done tasks.
  // S30 (B1): the rows carry their label snapshots (names + colors) so the archive UI
  // can render the chips exactly as they were the day the task was archived.
  // S243 (spec pack §6 + Screen I): the rows additionally carry their sprint identity —
  // sprint_id + sprint_name_snapshot — so the delete-confirmation modal can count the
  // archived tasks that will keep the "Sprint: <name> (deleted)" snapshot label, and
  // the Sprints page's completed-history Tasks tab can list the tasks archived at
  // finish. Additive fields: old clients (the island included) ignore them.
  app.get('/api/projects/:projectId/archives', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // S253 (BE-5b — the audit's "archives GET unbounded"): the shelf is now CAPPED at
    // 200 rows per page (prod's biggest project holds 149 — no user impact today) with
    // an ADDITIVE ?offset= for paging deeper history (the quicknotes archive grammar:
    // coerced int, 0 ≤ offset ≤ 100_000; absence = page 0, so every existing client —
    // the island, the desktop mirror — is byte-identically served as before).
    const offsetParsed = archiveOffsetSchema.safeParse(c.req.query())
    if (!offsetParsed.success) return errJson(c, ErrorCode.invalid_input)
    const offset = offsetParsed.data.offset
    type ArchRow = {
      id: string; title: string; priority: string; done_at: string | null
      original_created_at: string; archived_at: string; tags: string
      sprint_id: string | null; sprint_name_snapshot: string | null
    }
    // Lagging-D1 belt (the taskDepsForProject precedent): a pre-0065 database has
    // project_archives without sprint_name_snapshot — the read degrades to the
    // legacy shape (both sprint fields null) instead of 500ing the archive shelf.
    let rows: ArchRow[]
    try {
      rows = await cfg.db.query<ArchRow>(
        `SELECT id, title, priority, done_at, original_created_at, archived_at, tags, sprint_id, sprint_name_snapshot FROM project_archives WHERE project_id = ? ORDER BY archived_at DESC LIMIT 200 OFFSET ?`,
        [p.id, offset],
      )
    } catch {
      rows = (await cfg.db.query<Omit<ArchRow, 'sprint_name_snapshot'>>(
        `SELECT id, title, priority, done_at, original_created_at, archived_at, tags, sprint_id FROM project_archives WHERE project_id = ? ORDER BY archived_at DESC LIMIT 200 OFFSET ?`,
        [p.id, offset],
      )).map((r) => ({ ...r, sprint_name_snapshot: null }))
    }
    let parsed: { name: string; color: string }[][] = rows.map(() => [])
    try {
      parsed = rows.map((r) => {
        const arr = JSON.parse(r.tags || '[]')
        return Array.isArray(arr) ? arr.filter((x) => x && typeof x.name === 'string') : []
      })
    } catch {
      // pre-0051 rows carry '[]' or garbage — parse failures degrade to no labels
    }
    return c.json({ archives: rows.map((r, i) => ({ id: r.id, title: r.title, priority: r.priority, done_at: r.done_at, original_created_at: r.original_created_at, archived_at: r.archived_at, tags: parsed[i], sprint_id: r.sprint_id, sprint_name_snapshot: r.sprint_name_snapshot })) })
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
    // S240 (0065 — spec §4.3): the auto-generated name must ALSO clear the NEW
    // case-insensitive uniqueness rule — bump past any collision instead of 409ing a
    // nameless create (the legacy timeline creates drafts with no name; old clients
    // must keep getting 201s). Bounded: 50 tries, then the duplicate answer wins.
    // S252 (BE-2): ONE sibling-names query + a JS bump replaces the old loop of up
    // to 51 sequential sprintNameTaken round trips — same lower(trim(name))
    // comparison grammar on both sides, same bound, same fallback to the 409 gate
    // below. The row count doubles as the old COUNT(*) base number (identical
    // predicate, so rows.length === the count the separate query used to return).
    let name: string
    if (body.name === undefined) {
      const rows = await cfg.db.query<{ name: string }>('SELECT name FROM sprints WHERE project_id = ?', [p.id])
      const taken = new Set(rows.map((r) => r.name.trim().toLowerCase()))
      const base = rows.length + 1
      name = `Sprint ${base}`
      for (let bump = 1; bump <= 50 && taken.has(name.trim().toLowerCase()); bump++) {
        name = `Sprint ${base + bump}`
      }
    } else {
      name = body.name
    }
    // 0034: sprints are created as DRAFTS (is_draft=1) — the timeline plans on the draft
    // and /start promotes it. One draft at a time per project; starting it is a separate,
    // explicit step (no more auto-starting on create).
    const draft = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sprints WHERE project_id = ? AND is_draft = 1',
      [p.id],
    )
    if (draft.length) return c.json({ error: ErrorCode.draft_exists, draft_id: draft[0].id }, 409)
    // S250 (0066 — STRATEGIES-SPEC §4): the together-assignment guard — a strategy_id
    // on create must resolve in THIS project and be assignable (active + paused; a
    // completed strategy is a finished direction and takes no new sprints). Foreign /
    // missing ids are simply not found; a completed one answers 409 with its own code
    // so the define dialog can name the reason.
    if (body.strategy_id != null) {
      const verdict = await strategyAssignable(cfg, p.id, body.strategy_id)
      if (verdict === 'not_found') return errJson(c, ErrorCode.not_found)
      if (verdict === 'completed') return errJson(c, ErrorCode.strategy_completed)
    }
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
      const startedAt = body.started_at!
      const endedAt = body.ended_at ?? null
      // S252 (BE-7 — the audit's P1): validate the window BEFORE closing the active
      // sprint. The old order (close, then assert) left the active sprint PERMANENTLY
      // closed whenever the new window failed validation — a 400 that mutates state.
      // The assert runs against the sibling set AS IT WILL BE after the auto-close
      // below (the active sprint's ended_at pre-stamped to its close point), so the
      // verdicts are byte-identical to the old post-close check: the success path is
      // unchanged, only the failure path stops writing. One sibling fetch now serves
      // both the window view and the close (findActiveSprint's own query is folded
      // in — same predicate, same row choice).
      const siblings = await cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? AND is_draft = 0 ORDER BY started_at', [p.id])
      const activeSprint = siblings.find((s) => s.ended_at == null && sprintStatusOf(s) === 'active') ?? null
      // The close point the auto-close stamps: the day before the new start, or the
      // active sprint's own start if it began later (the zero-day clamp).
      const closeMs = activeSprint ? Math.max(Date.parse(startedAt) - 86400000, Date.parse(activeSprint.started_at)) : null
      const windowSiblings = activeSprint && closeMs !== null
        ? siblings.map((x) => (x.id === activeSprint.id ? { ...x, ended_at: new Date(closeMs).toISOString() } : x))
        : siblings
      // S235 (audit §4.2): the overlap check — was MISSING on the POST-create-
      // with-dates path (only PATCH had it). A user could create a sprint that
      // overlaps an existing closed sprint's date range. Now the shared helper
      // catches it (sprintId=null — new sprint, don't exclude self).
      const windowOk = await assertSprintWindowOk(cfg, p.id, null, startedAt, endedAt, windowSiblings)
      if (!windowOk) return errJson(c, ErrorCode.invalid_input)
      // Close any open sprint (same logic as /start). S240 (0065): only the
      // ACTIVE open sprint is auto-closed (stamped ended_at + status='completed' —
      // the legacy timeline mechanic, kept byte-compatible for old clients; the
      // explicit POST /finish is the archiving path, this auto-close archives
      // NOTHING). A PAUSED sibling keeps its open window and does NOT block the
      // new sprint (the D1 resolution — assertSprintWindowOk skips paused bands).
      if (activeSprint && closeMs !== null) {
        await cfg.db.execute("UPDATE sprints SET ended_at = ?, status = 'completed', updated_at = ? WHERE id = ?", [
          new Date(closeMs).toISOString(), now, activeSprint.id,
        ])
      }
      // S240: a created-with-both-dates sprint is a CLOSED window = completed (the
      // backfill's mapping, kept true by every writer); started-only = active.
      //
      // S253 (0067 — BE-8 catch-and-map): the sprintNameTaken / auto-close pre-checks
      // above can race a concurrent write (a D1 batch cannot wrap read-modify-write);
      // the new idx_sprints_project_name + the 0065 idx_sprints_one_active are the
      // belt. A verdict maps to the SAME 409 the pre-check would have answered —
      // never a raw 500. (The one-active catch rides the same block: a started-only
      // create is an ACTIVATION, so this INSERT can hit either partial — project_id
      // text alone is ambiguous between them, but only one-active is reachable from
      // THIS is_draft=0 statement: the draft belt fires on the is_draft=1 branch.)
      try {
        await cfg.db.execute(
          `INSERT INTO sprints (id, project_id, name, version, description, started_at, ended_at, is_draft, created_at, status, emoji, due_at, due_origin_at, updated_at, strategy_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          [id, p.id, name, body.version ?? null, body.description ?? '', startedAt, endedAt, now, endedAt != null ? 'completed' : 'active', body.emoji ?? null, body.due_at ?? null, body.due_at != null ? now : null, now, body.strategy_id ?? null],
        )
      } catch (err) {
        if (uniqueViolationOn(err, 'idx_sprints_project_name')) return errJson(c, ErrorCode.duplicate)
        if (uniqueViolationOn(err, 'sprints.project_id')) {
          const winner = await findActiveSprint(cfg, p.id)
          return c.json({ error: ErrorCode.sprint_active_exists, active_id: winner?.id ?? null }, 409)
        }
        throw err
      }
      await logHistory(cfg, p.id, t('{name} started', '{name} شروع شد', { name }))
      return c.json({ ok: true, id, name, version: body.version ?? null, draft: false }, 201)
    }
    // S253 (0067 — BE-8 catch-and-map): the draft_exists pre-check above can race a
    // concurrent create; idx_sprints_one_draft (this is_draft=1 INSERT is its only
    // reachable belt) and idx_sprints_project_name map to the existing 409s — the
    // winner's draft id rides the draft_exists body exactly like the pre-check's.
    try {
      await cfg.db.execute(
        `INSERT INTO sprints (id, project_id, name, version, description, started_at, ended_at, is_draft, created_at, status, emoji, due_at, due_origin_at, updated_at, strategy_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, 'planned', ?, ?, ?, ?, ?)`,
        [id, p.id, name, body.version ?? null, body.description ?? '', now, now, body.emoji ?? null, body.due_at ?? null, body.due_at != null ? now : null, now, body.strategy_id ?? null],
      )
    } catch (err) {
      if (uniqueViolationOn(err, 'idx_sprints_project_name')) return errJson(c, ErrorCode.duplicate)
      if (uniqueViolationOn(err, 'sprints.project_id')) {
        const winner = await cfg.db.query<{ id: string }>('SELECT id FROM sprints WHERE project_id = ? AND is_draft = 1', [p.id])
        return c.json({ error: ErrorCode.draft_exists, draft_id: winner[0]?.id ?? null }, 409)
      }
      throw err
    }
    await logHistory(cfg, p.id, t('{name} defined', '{name} تعریف شد', { name }))
    return c.json({ ok: true, id, name, version: body.version ?? null, draft: true }, 201)
  })

  // S255 (BE-3 — AUDIT-REMEDIATION-SPEC §7 step 1): the additive DOC read surface —
  // the full sprint row (description included), owner-gated through ownedSprint's
  // user-scoped join exactly like every other /api/sprints/:id route. The lean
  // payload's consumers fetch this ON OPEN when they need the heavy field; the
  // default payload (desktop mirror included) never needs it — it already carries
  // the doc. Additive-only: a new endpoint, zero existing surface touched.
  app.get('/api/sprints/:id/doc', async (c) => {
    const user = c.get('user')
    const s = await ownedSprint(cfg, user.id, c.req.param('id'))
    if (!s) return errJson(c, ErrorCode.not_found)
    return c.json(s)
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
    // S250 (0066 — STRATEGIES-SPEC §4, the delegated read guard): starting a sprint
    // whose strategy is COMPLETED is refused — a completed strategy is a finished
    // direction; re-assign the sprint to an active one first. A PAUSED strategy does
    // NOT block (pause is a soft state — the owner may deliberately keep pushing).
    // Belt: on a pre-0066 D1 the sprints table has no strategy_id column, so the row
    // reads undefined — `!= null` skips the guard and old data starts exactly as before.
    if (s.strategy_id != null) {
      const verdict = await strategyAssignable(cfg, s.project_id, s.strategy_id)
      if (verdict === 'completed') return errJson(c, ErrorCode.strategy_completed)
    }
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
    // S250 (0066): resume is an ACTIVATION (startSprintWithConflict treats the two
    // identically) — the completed-strategy guard applies here too.
    if (s.strategy_id != null) {
      const verdict = await strategyAssignable(cfg, s.project_id, s.strategy_id)
      if (verdict === 'completed') return errJson(c, ErrorCode.strategy_completed)
    }
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
    // S250 (0066 — STRATEGIES-SPEC §4): re-assignment guard, shared by BOTH branches
    // below (draft + started). Explicit null clears (always legal); a value must
    // resolve in this project and be assignable (active + paused — completed never).
    if (body.strategy_id != null) {
      const verdict = await strategyAssignable(cfg, s.project_id, body.strategy_id)
      if (verdict === 'not_found') return errJson(c, ErrorCode.not_found)
      if (verdict === 'completed') return errJson(c, ErrorCode.strategy_completed)
    }
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
      if (body.strategy_id !== undefined) push('strategy_id', body.strategy_id) // S250: re-assign/clear on drafts too
      dueOriginSet(push)
      if (!sets.length) return c.json({ ok: true })
      push('updated_at', now) // S240 (D8): every sprint PATCH stamps updated_at
      params.push(s.id)
      // S253 (0067 — BE-8 catch-and-map): the draft-rename pre-check raced a concurrent
      // write; the belt answers the pre-check's own 409 (never a raw 500).
      try {
        await cfg.db.execute(`UPDATE sprints SET ${sets.join(', ')} WHERE id = ?`, params)
      } catch (err) {
        if (uniqueViolationOn(err, 'idx_sprints_project_name')) return errJson(c, ErrorCode.duplicate)
        throw err
      }
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
    // S252 (BE-9): the sibling set fetched above (the reopen-latest guard) is
    // passed through — the helper's private re-query of the SAME rows was the
    // audit's duplicate round trip. No writes happen between fetch and assert,
    // so the set is current.
    const windowOk = await assertSprintWindowOk(cfg, s.project_id, s.id, newStart, newEnd, siblings)
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
    if (body.strategy_id !== undefined) push('strategy_id', body.strategy_id) // S250: re-assign/clear anytime (owner decision #11)
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
    // S253 (0067 — BE-8 catch-and-map): the rename pre-check raced a concurrent write
    // (name belt), or the reopen's status='active' raced the one-active pre-check
    // (the 0065 belt, same statement) — each answers its own existing 409 shape.
    try {
      await cfg.db.execute(`UPDATE sprints SET ${sets.join(', ')} WHERE id = ?`, params)
    } catch (err) {
      if (uniqueViolationOn(err, 'idx_sprints_project_name')) return errJson(c, ErrorCode.duplicate)
      if (uniqueViolationOn(err, 'sprints.project_id')) {
        const winner = await findActiveSprint(cfg, s.project_id)
        return c.json({ error: ErrorCode.sprint_active_exists, active_id: winner?.id ?? null }, 409)
      }
      throw err
    }
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
    // S250 (0066): reopen is an ACTIVATION like start/resume — the completed-strategy
    // guard applies (a finished direction takes no re-opened running sprints either).
    if (s.strategy_id != null) {
      const verdict = await strategyAssignable(cfg, s.project_id, s.strategy_id)
      if (verdict === 'completed') return errJson(c, ErrorCode.strategy_completed)
    }
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

  // ---- strategies (S250/0066 — STRATEGIES-SPEC.md §4) -----------------------------
  // The tier ABOVE sprints: Strategy (broad) → Sprint (a push) → Task. Every decision
  // in the spec's §2 table is owner-approved. Assignment is optional, one-per-sprint,
  // and sprints survive a strategy delete (the FK is ON DELETE SET NULL — the category
  // delete grammar, not the project one).

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
    const sets: string[] = []
    const params: unknown[] = []
    const push = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val) }
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
    // S252 (BE-6/BE-12): the shared find-or-create replaces this route's private
    // exact-match copy — same shape as the task-tags route above. {ok:true,id}, 201.
    const tagId = await findOrCreateTag(cfg, user.id, body.name, body.color)
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
