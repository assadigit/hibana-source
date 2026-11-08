// src/routes/devboard/sprints.ts — S257 (the Phase 6 split of the former devboard.ts
// monolith): the sprint surface — CRUD + lifecycle (start/pause/resume/finish/reopen)
// + the additive doc read. Behavior-neutral move; the split's dedups ride here:
//   - BE-15: the one-active 409 guard (assertNoActiveSibling) and the latest-sprint
//     reopen guard (assertLatestSprint) — verbatim ×4/×2 in the monolith — now live
//     once in devboard-helpers.ts;
//   - BE-14: both PATCH arms' SET-builders ride the shared buildUpdate;
//   - BE-16: the project updated_at stamps ride touchProject;
//   - the PATCH handler's draft/started arms are extracted (patchDraftSprint /
//     patchStartedSprint / startedSprintSets) so the former 127-line FN-ALLOWLIST
//     pin dissolves under the 60-line bar — the spec's own ask.
//
// 0034: a sprint is born a DRAFT (is_draft=1) that the timeline plans on; POST /start
// promotes it (closing the previous open sprint) — sprints are no longer auto-started
// at creation. Sprint boundaries (started_at/ended_at) stay non-overlapping at day
// granularity, with at most ONE open/active sprint per project at any moment.
//
// Scoping: every route resolves through the owning project first (rule 1) — a foreign
// project id (or task/sprint id from another user) is simply not found.

import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { jsonBody } from '../../lib/http'
import { getOwnedProject } from '../../lib/html'
import { trFor } from '../../lib/i18n'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow, SprintRow } from '../../types'
import {
  logHistory,
  ownedSprint,
  taskTagsForProject,
  refreshTagUsage,
  assertSprintWindowOk, // S235: the shared overlap check (audit §4.2)
  sprintStatusOf, // S240 (0065): lifecycle coalescing (lagging-D1 belt included)
  findActiveSprint, // S240 (0065): the one-active lookup (spec §5.1)
  sprintNameTaken, // S240 (0065): case-insensitive project-scoped name uniqueness (§4.3)
  uniqueViolationOn, // S253 (0067): the BE-8 catch-and-map — TOCTOU belt verdicts → the existing 409s
  strategyAssignable, // S250: the assignment guard — active+paused only, completed never
  buildUpdate, // S257 (BE-14): the ONE SET-builder
  touchProject, // S257 (BE-16): the ONE project updated_at stamp
  assertNoActiveSibling, // S257 (BE-15): the ONE one-active 409 guard
  assertLatestSprint, // S257 (BE-15): the ONE latest-sprint reopen guard
} from '../devboard-helpers'
import { foldTagSnapshots } from './archives'
import { createSprintSchema, updateSprintSchema } from './schemas'

export function sprintRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

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
    // S257 (BE-15): the guard rides assertNoActiveSibling — byte-identical verdict.
    const clash = await assertNoActiveSibling(c, cfg, s.project_id, s.id)
    if (clash) return clash
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
    // S257 (BE-15): the guard rides assertNoActiveSibling — byte-identical verdict.
    const clash = await assertNoActiveSibling(c, cfg, s.project_id, s.id)
    if (clash) return clash
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
    // S257 (the split's carve): the draft/started arms are extracted module functions
    // — same statements, same order, same verdicts; the monolith's single handler
    // carried both arms inline (127 lines, the FN-ALLOWLIST pin this split dissolves).
    if (s.is_draft) return await patchDraftSprint(c, cfg, body, s, now)
    return await patchStartedSprint(c, cfg, body, s, now)
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
    // S257 (the split's carve): the fold rides archives.ts's foldTagSnapshots —
    // the SHARED snapshot builder archive-done uses too (one fold, both archive flows).
    const links = await taskTagsForProject(cfg, s.project_id)
    const taskIds = new Set(tasks.map((tk) => tk.id))
    const { tagsByTask, touchedTagIds } = foldTagSnapshots(links, taskIds)
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
    await touchProject(cfg, s.project_id, now) // S257 (BE-16): the one project-stamp helper
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
    // S257 (BE-15): the guard rides assertLatestSprint — byte-identical verdict.
    const notLatest = await assertLatestSprint(c, cfg, s.project_id, s.id, s.started_at)
    if (notLatest) return notLatest
    // S240 (0065): the one-ACTIVE rule replaces the one-open-window rule (a paused
    // sibling's open window no longer blocks) — subject to one-active like start/resume.
    // S257 (BE-15): the guard rides assertNoActiveSibling — byte-identical verdict.
    const clash = await assertNoActiveSibling(c, cfg, s.project_id, s.id)
    if (clash) return clash
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

  return app
}

// ---- S257 (the split's carve): the PATCH /api/sprints/:id arms -----------------------
// Module-level so each stays under the fn-shape bar; the handler above is the thin
// dispatcher (validate → authorize → the shared name/strategy gates → the arm).

type SprintPatchBody = z.infer<typeof updateSprintSchema>

/** The deadline-origin rules (§12.2/§13 — same shape the task PATCH carries):
 * null→value stamps due_origin_at; value→value PRESERVES it (an extension is not
 * a re-assignment); null CLEARS both (a re-add starts a fresh timeline). Shared
 * by the draft + started arms (was one closure in the monolith). */
function pushDueOrigin(body: SprintPatchBody, s: Pick<SprintRow, 'due_at'>, now: string, push: (col: string, val: unknown) => void) {
  if (body.due_at === undefined) return
  push('due_at', body.due_at)
  if (body.due_at === null) push('due_origin_at', null)
  else if (s.due_at == null) push('due_origin_at', now)
}

/** A draft carries name + version + its doc (0034 + 0052) — its dates are set by
 * /start, never by PATCH. description (the full-screen editor's subject) is ALWAYS
 * writable; an empty string is a legal empty doc (the modal seeds an empty one). */
async function patchDraftSprint(c: Context, cfg: Config, body: SprintPatchBody, s: SprintRow, now: string): Promise<Response> {
  if (body.started_at !== undefined || body.ended_at !== undefined) return errJson(c, ErrorCode.invalid_input)
  const { sets, params, push } = buildUpdate() // S257 (BE-14): the ONE SET-builder
  if (body.name !== undefined) push('name', body.name)
  if (body.version !== undefined) push('version', body.version)
  if (body.description !== undefined) push('description', body.description)
  if (body.emoji !== undefined) push('emoji', body.emoji)
  if (body.strategy_id !== undefined) push('strategy_id', body.strategy_id) // S250: re-assign/clear on drafts too
  pushDueOrigin(body, s, now, push)
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

/** The started sprint's SET construction (S257's carve of the monolith's second arm):
 * the editable columns + the ended_at⇔status lock-step. Pure — built in one pass so
 * the caller's `now` stamps one instant across the whole PATCH. */
function startedSprintSets(body: SprintPatchBody, s: SprintRow, now: string): ReturnType<typeof buildUpdate> {
  const u = buildUpdate() // S257 (BE-14): the ONE SET-builder
  if (body.name !== undefined) u.push('name', body.name)
  if (body.version !== undefined) u.push('version', body.version)
  if (body.description !== undefined) u.push('description', body.description)
  if (body.emoji !== undefined) u.push('emoji', body.emoji)
  if (body.strategy_id !== undefined) u.push('strategy_id', body.strategy_id) // S250: re-assign/clear anytime (owner decision #11)
  pushDueOrigin(body, s, now, u.push)
  if (body.started_at !== undefined) u.push('started_at', body.started_at)
  if (body.ended_at !== undefined) {
    u.push('ended_at', body.ended_at)
    // S240 (0065): an ended_at transition IS a lifecycle transition — every writer
    // keeps the representations in lock-step (a set end = a completed window; a
    // cleared end = an active sprint, guarded in the caller). A no-op re-assert on an
    // already-open end leaves the status (active OR paused) exactly where it was.
    // The timeline drag path NEVER archives — the explicit POST /finish is the
    // archiving path (the pack's D4 scoping).
    if (body.ended_at !== null || s.ended_at !== null) {
      u.push('status', body.ended_at === null ? 'active' : 'completed')
    }
  }
  return u
}

/** The started-sprint arm: window/reopen validation + the one UPDATE. */
async function patchStartedSprint(c: Context, cfg: Config, body: SprintPatchBody, s: SprintRow, now: string): Promise<Response> {
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
  // S257 (BE-15): both guards ride the shared assert helpers — byte-identical verdicts.
  if (newEnd === null && s.ended_at !== null) {
    const notLatest = await assertLatestSprint(c, cfg, s.project_id, s.id, newStart, siblings.filter((x) => x.id !== s.id))
    if (notLatest) return notLatest
    const clash = await assertNoActiveSibling(c, cfg, s.project_id, s.id)
    if (clash) return clash
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
  const { sets, params, push } = startedSprintSets(body, s, now)
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
}
