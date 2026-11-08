// src/routes/devboard/schemas.ts — S257 (audit BE-17 + BE-13, the Phase 6 split):
// the devboard domain's request schemas, moved VERBATIM from the head of the former
// src/routes/devboard.ts monolith (they lived route-file-local since 0029). Module-
// local on purpose: every schema here is devboard-grammar (task/sprint/strategy/
// backlog bodies) — the cross-domain vocabulary stays in src/validation/schemas.ts.
// BE-13: the local `reorderSchema` is renamed `devtaskReorderSchema` — the audit's
// "two different reorderSchemas, different grammar, same name, two homes" trap
// (validation/schemas.ts's projects reorder is now `projectReorderSchema` there).

import { z } from 'zod'
import { hexColorSchema, EMOJI_TOKEN_RE } from '../../validation/schemas'

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

export const createDevTaskSchema = z.object({
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
export const updateDevTaskSchema = z.object({
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
export const createCategorySchema = z.object({
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
export const createSprintSchema = z.object({
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
export const updateSprintSchema = z.object({
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
// S257 (BE-13): was the module-local `reorderSchema` — renamed so the two same-named
// different-grammar reorder schemas (this one vs validation/schemas.ts's projects
// reorder, now `projectReorderSchema`) can never be confused again.
export const devtaskReorderSchema = z.object({ ids: z.array(z.string().max(64)).min(1).max(500) })
// S250 (0066 — STRATEGIES-SPEC §4): the strategy tier above sprints. Name grammar is
// the sprint one (1-80, case-insensitive unique per project); description is a plain
// light note (NOT the sprint's 100k rich doc — it renders as text in the editor +
// tooltips); priority REUSES the task vocabulary (owner decision #3); emoji rides the
// same single-token contract (decision #8).
const strategyEmoji = z.string().trim().max(16).regex(EMOJI_TOKEN_RE).nullish()
export const createStrategySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  emoji: strategyEmoji,
  priority: prioritySchema.optional(),
})
export const updateStrategySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(2000).nullable().optional(), // explicit null clears the note
  emoji: strategyEmoji,
  priority: prioritySchema.optional(),
  // S250 (owner decision #4/#9): the explicit lifecycle. Transitions are free EXCEPT
  // →completed, which the handler guards (an ACTIVE sprint still serving this strategy
  // blocks it — "Finish or pause its active sprint first").
  status: z.enum(['active', 'paused', 'completed']).optional(),
})
export const tagBodySchema = z.object({ name: z.string().trim().min(1).max(60), color: hexColor.optional() })
// S240 (0065 — spec pack §14): one Blocked-by edge. The blocker is a task id in the
// SAME project (cross-project is rejected in the handler via ownedTask on both ends —
// a foreign id is a 400, never a 500). Self-edges and cycles are handler-guarded too.
export const createTaskDepSchema = z.object({ blocker_id: z.string().max(64) })
// S253 (BE-5b — the audit's unbounded-read cap): the archives shelf's ADDITIVE paging
// param — the quicknotes archiveQuerySchema grammar (coerced int, hard bounds), so
// absence = page 0 and every pre-S253 client stays byte-identically served.
export const archiveOffsetSchema = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0) })
// 0033 — backlog «برنامه آتی» plan docs: long-form planning entries per project, each
// save appending a revision row (backlog_doc_revisions) that feeds the history list.
export const createBacklogDocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(50_000),
})
export const updateBacklogDocSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(50_000).optional(),
})
