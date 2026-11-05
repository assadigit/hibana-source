# Next Session Prompt — Phase 1: Domain Model, Persistence, Migrations, Invariants

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S240** in the repo's commit-numbering sequence (Phase 0 landed as S239 @ `d9aa2b8`).

First read (in this order):
- `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
- `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — esp. §4-8 sprints, §9-13 deadlines, §14-16 dependencies, §19-20 data integrity, Part VI assumptions)
- `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (Phase 1 is backend-only, but keep the card/modal anatomy in mind for field naming)
- `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md`
- `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (repository map, baseline results, discrepancy register D1-D9, assumptions)
- this file

Then: `cd /home/z/hibana-source && git status && git log --oneline -3 && git branch --show-current`. The working branch is `feature/sprint-deadline-system` (created from `main` @ `dad52f5`; Phase 0 pushed the extracted pack + workflow docs). **NEVER commit to `main`** — pushes to main auto-deploy to production hibana.ir via the CI→CD chain. Desktop repo (`/home/z/hibana-desktop`, `main` @ `9d53e64`) is READ-ONLY this phase (mirror schema v3 comes later, Phase 9 round; island re-pins only after web UI lands).

**Current phase:** Phase 1 — Domain model, persistence, migrations, invariants (web repo only).

**Exact goal for this session:** Land migration `0065` + typed domain changes + server-enforced invariants + vitest domain tests, all additive and backward-compatible, on `feature/sprint-deadline-system`. No UI changes yet (devboard.js/board-page.js/detail-helpers.ts stay untouched except `src/types.ts`). Old clients (the desktop island pinned at `04218ca`) must keep working against the unchanged API responses.

**Key architecture facts (verified in Phase 0 — do not re-derive):**

- Schema lives ONLY in `migrations/NNNN_*.sql` (latest `0064_user_categories.sql`; you write `0065_...sql`). Node runner auto-applies at boot; D1 applies via manual workflow `d1-migrate-dev.yml` (do NOT run D1 migration this phase — it happens at deploy time, Phase 9).
- DB interface: `src/db/types.ts` (`query/execute/transaction`); D1 transaction = batch AFTER fn returns — keep invariants single-statement or wrap in `cfg.db.transaction`.
- Sprint endpoints live in `src/routes/devboard.ts` (create `:556-612`, start `:614-648`, PATCH `:650-721`, finish `:723-732`, reopen `:734-751`, DELETE `:753-767`); task create `:209-255`, PATCH `:271-325`; archive-done `:344-386` (reuse its snapshot INSERT pattern for finish-archiving); helpers in `src/routes/devboard-helpers.ts` (`assertSprintWindowOk :73-102`, `ownedSprint`, `ownedTask`).
- Existing sprints = implicit lifecycle (is_draft + ended_at) + timeline windows. Discrepancies D1-D9 and resolutions are in IMPLEMENTATION-STATUS.md — follow them exactly.
- Test pattern: `src/tests/sprint-validation-s235.test.ts` (in-memory sqlite, session cookie + `Origin` header — the CSRF gate rejects headerless writes), harness `src/tests/helpers.ts` (`makeTestDb`, `makeUser`).
- TS row types: `src/types.ts` (`SprintRow :241-251`, task row `:210-239`, `ProjectArchive` nearby). Update them with the new columns.
- Baseline before you start (must be green): `bun install`, `bun run typecheck`, `bun run lint`, `bun run test` (104 files / 806 tests), `bun run build`.

**Tasks in required order:**

1. **Write `migrations/0065_sprint_deadline_deps.sql`** — additive only:
   - `sprints`: `ALTER TABLE sprints ADD COLUMN status TEXT`; then backfill `UPDATE sprints SET status = CASE WHEN ended_at IS NOT NULL THEN 'completed' WHEN is_draft = 1 THEN 'planned' ELSE 'active' END`; then `ALTER TABLE sprints ADD COLUMN emoji TEXT` (TEXT, nullable — SQLite ALTER can't add non-constant defaults, so do NOT add NOT NULL DEFAULT to a backfilled column; instead enforce non-null in service layer or add a CHECK after backfill if cheap); `ADD COLUMN due_at TEXT`; `ADD COLUMN due_origin_at TEXT`; `ADD COLUMN updated_at TEXT`.
   - One-active invariant at persistence layer: `CREATE UNIQUE INDEX idx_sprints_one_active ON sprints(project_id) WHERE status = 'active';` (partial index — supported by SQLite + D1).
   - `dev_tasks`: `ADD COLUMN due_at TEXT`; `ADD COLUMN due_origin_at TEXT`.
   - `dev_task_deps`: `CREATE TABLE dev_task_deps (blocker_task_id TEXT NOT NULL REFERENCES dev_tasks(id) ON DELETE CASCADE, blocked_task_id TEXT NOT NULL REFERENCES dev_tasks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (blocker_task_id, blocked_task_id))` + indexes on both columns + `CHECK (blocker_task_id <> blocked_task_id)`.
   - `project_archives`: `ADD COLUMN sprint_name_snapshot TEXT`.
   - Follow the repo's migration comment style (header block explaining user-facing rationale, referencing the spec pack).
2. **Update `src/types.ts`**: extend `SprintRow` (`status: 'planned'|'active'|'paused'|'completed'`, `emoji: string|null`, `due_at: string|null`, `due_origin_at: string|null`, `updated_at: string|null`), task row type (`due_at`, `due_origin_at`), archive type (`sprint_name_snapshot`), add `TaskDepRow`.
3. **Service-layer invariants in `src/routes/devboard.ts` + `devboard-helpers.ts`**:
   - Sprint create: case-insensitive name uniqueness within project across ALL states (reject 409 with clear error; note: NO uniqueness exists today — this is new; existing projects may already contain case-duplicate names — migration must NOT fail on them; enforce on write only, and consider a one-time reconciliation report. If case-duplicates exist in the seeded test DBs, tests will surface it).
   - Lifecycle transitions (atomic, transaction-wrapped): start (planned/paused → active; if another active exists, the ENDPOINT still performs only the direct transition — the conflict modal is Phase 4 UI; server returns 409 `sprint_active_exists` with the active sprint id so the UI can offer finish-or-pause; provide `POST /api/sprints/:id/pause` and `resume` endpoints now so Phase 2/4 wire them), pause (active → paused), finish (→ completed + `ended_at=now` + archive only that sprint's `status='done'` tasks into `project_archives` via the archive-done INSERT pattern, keeping `sprint_id`, tags JSON, and setting `sprint_name_snapshot = sprint.name`; unfinished tasks untouched), delete (planned/paused only — active returns 409 `sprint_active`; completed returns 409 `sprint_completed`; on delete: non-archived tasks `sprint_id=NULL`, archived rows with this sprint get `sprint_name_snapshot = name + ' (deleted)'` and `sprint_id=NULL`).
   - Keep `ended_at` semantics for the timeline (finish stamps it; reopen behavior: only allow reopen of completed → active subject to one-active; consult `sprint-validation-s235.test.ts` for the existing contract and EXTEND, don't break, those tests).
   - Task deadline rules on PATCH `/api/devtasks/:id`: `due_at` null→value stamps `due_origin_at = now` (first assignment); value→different value preserves origin; value→null clears both (new timeline on re-add). Sprint deadline same pattern on `sprints.due_at`/`due_origin_at` via PATCH `/api/sprints/:id`. Every sprint PATCH also stamps `updated_at`.
   - Dependency endpoints (new): `GET` rides the board payload (Phase 2); this phase add `POST /api/devtasks/:id/deps` (body `{blocker_id}` — validate same-project via `ownedTask` on both, reject self 400, cycle-check via recursive CTE or DFS over `dev_task_deps`, reject 409 `cycle`) and `DELETE /api/devtasks/:id/deps/:blockerId`. Zod schemas route-local, matching existing style.
   - `sprint_id` assignment guards on task create/PATCH: reject new assignment to `status='completed'` sprints (400 `sprint_completed`); allow planned/active/paused (assumption 3). Existing associations untouched.
4. **Vitest domain tests** — new file(s) `src/tests/sprint-deadline-deps-domain.test.ts` (+ split if cleaner), covering: name uniqueness case-insensitive (create + PATCH rename); one-active under sequential transitions; pause/resume; finish archives ONLY done tasks of that sprint (others keep status+sprint_id); finish keeps `sprint_id` on archived rows + sets snapshot; delete detaches active tasks / snapshots archived ones / refuses active+completed; deadline origin stamping rules (set/edit/clear/reset); dep create self/cross-project/cycle rejections + multi-blocker; migration backfill correctness (create rows with old shape pre-migration if the harness allows, else assert the backfill SQL directly on a fresh DB). ALL existing tests must stay green — especially `sprint-validation-s235.test.ts`, `sprint-doc.test.ts`, `kanban-route.test.ts`, `board.test.ts`, `project-archive.test.ts`.
5. **Run the full gate ladder**: `bun run typecheck && bun run lint && bun run test && bun run build && bun run check:portability && bun run check:fn-shape && bun run check:boundaries`. Fix everything. Optionally run a couple of sprint e2e specs (`bunx playwright test e2e/sprint-timeline.spec.ts e2e/s206-sprint-fixes.spec.ts`) to confirm the timeline page still works with backfilled status values.

**Required tests/builds:** see task 5 (the CI `verify` ladder). Exact commands listed there. Do not run `bun run deploy*` or the D1 migration workflow — deployment is Phase 9.

**Commit boundary:** one coherent commit (or two: migration+types, then invariants+tests) on `feature/sprint-deadline-system` only, message style `feat(domain): S240 sprint/deadline/dependency data model + invariants (0065) — spec pack phase 1` with a body citing the discrepancy register items resolved (D1, D3, D4, D7, D8-partial). Session numbering: Phase 0 = S239 (`d9aa2b8`); this session = **S240**; subsequent sessions continue S241, S242, … Push the branch (no PR yet — PR opens when Phase 3 UI lands, or earlier if the owner's flow prefers; the repo's convention is direct-to-main, but this feature is too large for that — keep the branch). No changes to `public/` (no cache-bust concerns), no desktop changes, no unrelated refactors.

**Push/merge/deploy requirements:** push branch only; no merge to main; no deploy. Follow `PHASED-MULTI-SESSION-IMPLEMENTATION.md` §4 safeguards. Never include tokens/.env in commits.

At the end, update `IMPLEMENTATION-STATUS.md` (Phase 1 checklist, session log with commit SHA + test results, any new discrepancies/assumptions), replace this file with the Phase 2 prompt (API surface + board payload extension + backward-compat verification against the pinned island contract — list exact endpoints/fields from this session's work), and report changes, tests, commit SHAs, push status, blockers, and next-phase handoff.
