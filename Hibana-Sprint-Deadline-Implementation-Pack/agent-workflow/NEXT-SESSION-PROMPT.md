# Next Session Prompt — Phase 2: API Surface, Board Payload Extension, Cross-Platform Contract

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S241** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 = S240 —
final delivery @ **`81f2c05` on `feat/sprint-deadline-deps`**).

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — esp. §4-8 sprints, §9-13 deadlines, §14-16 dependencies, §17-18 cross-platform consistency, §19-20 data integrity, Part VI assumptions)
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (Phase 3+ context)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 2 scope, §6 cross-platform sequencing)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (the full status: architecture map, D1–D9 register, assumptions 1-8, session log — assumption 7's S240 engineering defaults are BINDING context)
6. this file

**Where these docs live:** the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commit, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read them off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`
(or extract the zip again — same content). If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the docs-only commit on top of `dad52f5`; if it moved,
   reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`81f2c05`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain (CI green → workflow_run-gated
   CD → prod deploy). Branch pushes run CI only and can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca` — discovered
   in Phase 0; re-verify the remote/HEAD cheaply, do not hunt further) stays **READ-ONLY** until the
   Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **105 files / 830 tests green** (the 806 legacy baseline + 24 S240 domain
   tests). Fresh sandbox e2e note: `bunx playwright install chromium-headless-shell` (the pinned
   playwright build wants chromium_headless_shell-1248; the sandbox cache ships 1200).
5. Phase 2 needs ONLY the GitHub token (the user pastes it in the kickoff). Use it ONLY for the
   one-shot authenticated push `git push https://<TOKEN>@github.com/assadigit/hibana-source.git
   feat/sprint-deadline-deps` — never write it to disk, .git/config, files, commit bodies, or logs.

**Current phase:** Phase 2 — Backend/API surface + the cross-platform data contract (web repo only;
still NO UI work, `public/` untouched; additive & backward-compatible ONLY so the desktop island
pinned @ `04218ca` keeps working).

## What Phase 1 (S240 @ `81f2c05`) already landed — the exact API surface to build on

Sprint endpoints (`src/routes/devboard.ts`), all backward-compatible in response shape:
- `POST /api/projects/:projectId/sprints` — body now ALSO accepts `emoji` (one emoji token,
  EMOJI_TOKEN_RE, ≤16 chars, nullish) + `due_at` (parseable ISO date, nullish; `due_origin_at`
  server-stamped on first assignment). Response `{ok,id,name,version,draft}` UNCHANGED.
  Auto-generated names bump past case-insensitive collisions (`Sprint N+1`…, ≤50 tries). Duplicate
  names (case/trim-folded, project-scoped, ALL lifecycle states) → 409 `duplicate`
  (write-time-only rule: legacy case-twins stay readable — pinned by test). Draft-per-project 409
  `draft_exists` kept. Create-with-dates: auto-closes only the ACTIVE sibling (stamps `ended_at` +
  `status='completed'`, archives NOTHING), new sprint's status = `ended_at ? 'completed' : 'active'`;
  draft create → `status='planned'`.
- `POST /api/sprints/:id/start` — planned|paused → active. 409 `{error:'sprint_active_exists',
  active_id}` when another sprint is active (NO auto-close anymore — spec §5.2). Paused source = pure
  resume (window untouched). active|completed → 400 `already_started` (legacy shape).
- `POST /api/sprints/:id/pause` (NEW) — active → paused only (else 400 invalid_input).
  `POST /api/sprints/:id/resume` (NEW) — paused → active, subject to one-active (same 409 shape).
- `POST /api/sprints/:id/finish` — → completed + `ended_at=now` + archives ONLY that sprint's
  `status='done'` dev_tasks into `project_archives` (snapshot INSERT: sprint_id KEPT, tags JSON,
  `sprint_name_snapshot = sprint.name`); unfinished tasks untouched. Response now
  `{ok, archived: <count>}` (additive). Planned/draft → 400 (legacy). Re-finish of a completed
  sprint legal (idempotent + archives any newly-done).
- `POST /api/sprints/:id/reopen` — completed → active (isLatest guard kept → 400; one-active → 409
  `sprint_active_exists`). Active → 200 no-op; paused → 400.
- `PATCH /api/sprints/:id` — body now ALSO accepts `emoji` + `due_at` (origin rules: null→value
  stamps `due_origin_at`, value→value preserves, null clears both). Name rename uniqueness-checked
  (409 `duplicate`; self re-assert legal). `ended_at` transitions move `status` in lock-step
  (set→completed, real clear→active after guards; no-op null re-assert leaves paused/active alone)
  and NEVER archive. Every PATCH stamps `updated_at`.
- `DELETE /api/sprints/:id` — planned/paused only; active → 409 `sprint_active`, completed → 409
  `sprint_completed`. Tasks detach (`sprint_id=NULL`, never deleted); archived rows get
  `sprint_name_snapshot = "<name> (deleted)"` + `sprint_id=NULL` (AP-27 hygiene kept).

Task endpoints:
- `POST /api/projects/:projectId/devtasks` — body now ALSO accepts `due_at` (origin stamped on
  create). NEW-assignment-to-completed-sprint guard → 400 `sprint_completed` (explicit
  `sprint_id:null` = No sprint always legal; `undefined` keeps the legacy draft/open auto-assign for
  old clients — D2's client fix is Phase 3).
- `PATCH /api/devtasks/:id` — body now ALSO accepts `due_at` (same origin rules, special-cased like
  `tags`); `sprint_id` guard: MOVING to a completed sprint → 400 `sprint_completed`, re-asserting the
  task's CURRENT sprint legal (old modal echo).
- `POST /api/devtasks/:id/deps` (NEW) — body `{blocker_id}`; self / cross-project / foreign-user
  blocker → 400 invalid_input; cycle (recursive CTE over `dev_task_deps`) → 409 `cycle`; new edge →
  201 `{ok:true}`, existing → 200 `{ok:true, existing:true}`.
- `DELETE /api/devtasks/:id/deps/:blockerId` (NEW) — 200 `{ok:true}` always (tag-link shape).

Board payload (`GET /api/projects/:projectId/devboard`): `sprints` rows already carry
`status`/`emoji`/`due_at`/`due_origin_at`/`updated_at` and `tasks` rows carry
`due_at`/`due_origin_at` (both via `SELECT *` — additive JSON keys; every legacy key the island
reads is intact, pinned by a Phase 1 test). Error codes in `src/lib/errors.ts`:
`sprint_active_exists`/`sprint_active`/`sprint_completed` (409 family; `sprint_completed` also 400
at the assignment guards — recorded divergence). Migration `0065` + types (`SprintStatus`,
`TaskDepRow`, `ProjectArchiveRow`) + backup coverage for `dev_task_deps` (SNAPSHOT_TABLES + personal
export, schema_version 20261105) all landed. Tests: `src/tests/sprint-deadline-deps-domain.test.ts`
(24 — incl. the migration-backfill-through-the-real-runner pair, the legacy case-twins read pin, and
the CSRF headerless-write rejection on the new endpoints) + the whole legacy suite adapted-green
(105 files / 830).

**Branch note:** an earlier session first landed this same Phase 1 content on
`feature/sprint-deadline-system` (@ `0d50b7a` + its own pack-docs commits). That branch is
SUPERSEDED but preserved in place (no deletes/force-pushes, ever). All Phase 2+ work continues on
**`feat/sprint-deadline-deps`**. Do not rebase onto or merge the old branch — build on `81f2c05`.

## Tasks in required order (Phase 2)

1. **Board payload extension — the dependency read surface**: `GET /api/projects/:id/devboard`
   gains a `task_deps` key: the flat per-project edge join
   (`SELECT blocker_task_id, blocked_task_id FROM dev_task_deps JOIN dev_tasks … WHERE
   project_id = ?`), shaped like the existing flat `task_tags` join the client groups by task.
   Additive key #7 on the six-key payload — the pinned island ignores unknown keys (Go struct
   decode); pin that with a compat test. Derived-reverse counts (Blocks-N) stay a client-side fold
   over the same edges (spec §15) — do NOT add a separate endpoint for them.
2. **Backward-compat verification against the pinned island contract**: a vitest test that pins
   the OLD payload shape — the exact legacy keys per section (`tasks` incl. `tags` array +
   `shot_count`, `categories` incl. `enabled`, `sprints` incl.
   `id/project_id/name/started_at/ended_at/created_at/is_draft/version/description`, `tags`,
   `task_tags`, `project`) — so any future field REMOVAL/RENAME fails CI, while the additive keys
   ride along. Cite `docs/project-kanban/API-AND-SYNC-CONTRACT.md` (v0.4.1.35/S209, six-key payload)
   as the contract the island @ `04218ca` consumes.
3. **Effective-deadline resolution decision (documented default, then implement)**: desktop + the
   Phase 5 UI both need the effective deadline (personal > sprint-inherited-while-not-completed >
   none — spec §10, incl. completed-sprint historical-neutrality §10.3). Decide and record:
   server-side computed additive fields on the payload (`effective_due_at` +
   `effective_due_source: 'task'|'sprint'|null` + `effective_due_origin_at` coalesced per §12.2
   inherited-origin) vs. raw-fields-only + client-side fold. Recommended default: SERVER-side
   computed additive fields on the task rows (one shared helper in `src/routes/devboard-helpers.ts`
   or `src/lib/`; the desktop then needs zero deadline logic — spec §18 "do not fork deadline
   logic between platforms"). Test the four §10 scenarios + the completed-sprint case.
4. **Sprint overview counts (Phase 4's data feed — land the API now)**: counts of the sprint's
   tasks across the five Kanban statuses + total ONLY (spec §7.4: no percentages/analytics) — either
   `GET /api/projects/:id/sprints/:sid/overview` or client-derived from the board payload. Additive;
   if you keep it client-derived, record that decision in the contract doc and skip the endpoint.
5. **Contract documentation**: update `docs/project-kanban/API-AND-SYNC-CONTRACT.md` with the
   complete Phase 1+2 surface — every new endpoint, field, error code (`sprint_active_exists` +
   `active_id`, `sprint_active`, `sprint_completed`, `cycle`, `duplicate` on sprints), the
   six-key→seven-key payload change, the effective-deadline resolution, the one-active 409 flow
   (the Phase 4 conflict modal), and the sync implications (full-board replace still suffices —
   NO `?since=` deltas needed this feature; `sprints.updated_at` exists for future deltas). The
   desktop round (Phase 9) consumes THIS doc.
6. **Vitest additions** for everything above (extend `sprint-deadline-deps-domain.test.ts` or a new
   `api-surface-s241.test.ts`): task_deps payload presence/scoping (rule 1 — a stranger's edges
   never leak), the legacy-shape pin test, effective-deadline scenarios, overview counts if
   endpoint'd. ALL existing tests stay green (baseline 105 files / 830).
7. **Gate ladder** (fix everything until green): `bun run verify` (= tsc → eslint-0 → vitest → prod
   build → portability → fn-shape → boundaries). Update `docs/autopilot/FN-ALLOWLIST.md` line pins
   if handlers move/grow (established practice). Optional e2e re-run of
   `e2e/sprint-timeline.spec.ts e2e/s206-sprint-fixes.spec.ts` (fresh sandbox:
   `bunx playwright install chromium-headless-shell` first).

## Commit, push, deploy rules

- **Commit boundary:** one or two coherent commits on `feat/sprint-deadline-deps` ONLY, message
  style `feat(api): S241 <lowercase one-liner (the detail)> — spec pack phase 2` with a body citing
  the discrepancy items advanced (D8 contract completion; D9 pre-work; D2 server-side verification)
  + test counts. Review the final diff for unrelated changes and secrets.
- **Push:** feature branch only, one-shot token URL, never persist the token. A branch push runs CI
  only — it can NEVER deploy. No merge to main, no PR yet, no `bun run deploy*`, no D1 workflow
  runs — deployment + D1 = Phase 9. No `public/` changes (no cache-bust concerns), no desktop
  changes, no unrelated refactors, no new runtime deps.
- If branch protection requires human review at PR time, that's Phase 9's problem — do not stop
  for it now.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md` (Phase 2
   checklist + session log with commit SHA + test results + new assumptions — especially the
   effective-deadline resolution and any payload-shape decisions) and REPLACE this file's content
   with the fully populated **Phase 3** prompt (Core Kanban + task-form UI: sprint filter defaulting
   All tasks + No sprint, sprint dropdown with emoji + hide-completed assignment, quick-create modal
   with OFF-by-default description/due toggles, card sprint identity, explicit `sprint_id` on create
   per D2 — carry the exact field/API names from Phases 1-2; remember `public/` changes need i18n
   EN+FA parity + `?v=` cache-bust bumps and the S209 board-parity test).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to **main** (`agent-workflow/*.md` ONLY — `**.md` pushes are
   CI-skipped and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, endpoints/fields added, exact test/gate results, commit SHAs,
   push state (only what commands confirmed), blockers, defaults/assumptions taken, Phase 3 handoff
   location.
