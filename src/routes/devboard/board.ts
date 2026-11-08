// src/routes/devboard/board.ts — S257 (the Phase 6 split of the former devboard.ts
// monolith): the ONE board payload every surface renders from (board page, sprint
// page, detail preview). Behavior-neutral move: the endpoint, payload and semantics
// are byte-identical to the pre-split route; BE-11's dedup swaps the inline
// categories query for the shared categoriesForProject (one home, same SQL).
//
// Scoping: every route resolves through the owning project first (rule 1) — a foreign
// project id (or task/category/sprint id from another user) is simply not found.

import { Hono } from 'hono'
import { etag } from '../../lib/http'
import { getOwnedProject } from '../../lib/html'
import { categoriesForProject } from '../../lib/categories'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow, DevTaskRow, SprintRow, TagRow, StrategyRow } from '../../types'
import {
  taskTagsForProject,
  taskDepsForProject, // S241 (0065 read surface): the flat per-project dep edge join (§15)
  boardTaskRows, // S241: task rows + the server-computed effective deadline (§10/§18)
  PRIO_ORDER_SQL,
  STRATEGY_PRIO_ORDER_SQL, // S250: priority-first board order (the task-column rule)
  leanSprintRows, // S255 (BE-3): the ?lean=1 board payload's sprint-row transform
  boardVersionStamp, // S255 (BE-25): the one-round-trip version stamp behind the board GET's 304s
} from '../devboard-helpers'

export function boardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

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
      // S257 (BE-11): the categories pool rides the shared categoriesForProject
      // (lib/categories.ts) — the SQL was byte-identical here and in the project
      // detail pool; one home now, both surfaces agree forever.
      categoriesForProject(cfg.db, p.id),
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

  return app
}
