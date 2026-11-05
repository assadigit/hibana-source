# Hibana Feature Implementation Status

**Status:** Phase 1 COMPLETE (sessions S239–S240) — domain model, migration 0065, service-layer
invariants, and the domain test suite delivered on **`feat/sprint-deadline-deps` @ `81f2c05`**
(the branch the kickoff mandates), fresh-verified end to end. No UI yet (Phase 3+).
**Last updated:** Session 3 (Phase 1 reconciliation + re-delivery + verification), 5 November 2026.

## Repositories

| Target | Verified identity | Remote | Branch @ audit | Baseline |
|---|---|---|---|---|
| Web/source | `assadigit/hibana-source` (PUBLIC, "Mirror of the deployed hibana.ir app") | `https://github.com/assadigit/hibana-source.git` | `main` @ `dad52f5` (v0.4.1.43, after S238) — re-verified session 3 | ALL GREEN (re-run session 3) |
| Windows Desktop | `assadigit/hibana-desktop` ("The Hibana Kanban Windows desktop port — Go + Wails v2 + WebView2 + modernc.org/sqlite") | `https://github.com/assadigit/hibana-desktop.git` | `main` @ `9d53e64` (v0.1.35, island pin `04218ca` = web v0.4.1.43) — discovered session 1; NOT re-hunted session 3 (the kickoff scopes desktop out of this phase) | ALL GREEN (session 1's run) |

**Feature branch (Web) — CANONICAL:** `feat/sprint-deadline-deps` (cut from `main` @ `dad52f5`
in session 3, per the Phase 1 kickoff's branch mandate). All feature work lands there; PR → merge
at Phase 9 per repo policy. Rationale: pushes to `main` auto-deploy to prod via the CI→CD chain
(`ci.yml` → `cd.yml` workflow_run-gated); the phased plan forbids deploying an incomplete feature.

**Branch history (integration-owner note):** session 2 (S240) first landed Phase 1 on
`feature/sprint-deadline-system` @ `0d50b7a` (plus its own pack-docs commits `d9aa2b8`/`1b059d8`/
`c2c6dc5`). Session 3 re-delivered the same validated content onto the mandated branch
(`81f2c05`, content = `0d50b7a` + 2 additional tests + amended commit message), re-ran the entire
gate ladder fresh, and re-verified e2e. The old branch is left untouched in place (no deletes, no
force-push) but is **superseded**; `feat/sprint-deadline-deps` is the Phase 2 starting point.

**Desktop repo discovery evidence (session 1):** GitHub API repo list for `assadigit`
(token-authenticated, 2026-11-05); repo description self-identifies as the Windows desktop port;
`hibana-desktop/README.md:3-11` confirms "replicates the web kanban at hibana.ir/kanban … sharing
the same cloud data over the same API … the spec pack lives in hibana-source docs/project-kanban/";
`frontend/dist/web-ref.json` pins `{"ref": "04218ca", "packageVersion": "0.4.1.43"}` matching
hibana-source `main`.

## Baseline checks (exact commands + results)

### Web — pristine `main` @ `dad52f5` (re-run session 3, clean tree, fresh sandbox)

| Command | Result |
|---|---|
| `bun install` (bun 1.3.14, Node v24.22.2) | ✓ 243 packages |
| `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries) | ✓ all gates green |
| `bun run test` (vitest run, counted separately) | ✓ **104 files / 806 tests passed** (78.4s) |

### Web — `feat/sprint-deadline-deps` @ `81f2c05` (session 3, after Phase 1)

| Command | Result |
|---|---|
| `bun run verify` | ✓ all gates green (tsc, eslint 0 warnings, vitest, build, portability, fn-shape, boundaries) |
| `bun run test` | ✓ **105 files / 830 tests passed** (806 baseline + 24 domain tests) |
| `bunx playwright test e2e/sprint-timeline.spec.ts e2e/s206-sprint-fixes.spec.ts` | ✓ **11/11 passed** (after `bunx playwright install chromium-headless-shell` — chromium_headless_shell-1248; the sandbox cache ships 1200) |

Full e2e suite (~90 specs, 2-shard in CI) not run locally — CI is the gate on the branch push;
local full run is optional per phase (no UI changes this phase).

### Desktop (session 1's Phase 0 record — untouched since; desktop CI is the gate for Windows builds)

| Command | Result |
|---|---|
| `go mod download` (Go 1.25.0; toolchain go1.27.2) | ✓ |
| `go vet ./internal/...` | ✓ clean |
| `go test ./internal/...` | ✓ 8 packages pass |

## Phase tracker

- [x] Phase 0 — Repository audit and implementation map (session 1 / S239)
- [x] Phase 1 — Domain model, persistence, migrations, invariants (session 2 / S240 @ `0d50b7a`; re-delivered + extended session 3 @ `81f2c05` on `feat/sprint-deadline-deps`)
- [ ] Phase 2 — Backend/API, synchronization, cross-platform contract (prompt ready: `agent-workflow/NEXT-SESSION-PROMPT.md`)
- [ ] Phase 3 — Core Kanban and task-form UI (sprint integration)
- [ ] Phase 4 — Sprint management, overview, and lifecycle
- [ ] Phase 5 — Deadline engine and UI
- [ ] Phase 6 — Deadline extension flows
- [ ] Phase 7 — Task dependencies
- [ ] Phase 8 — Cross-platform QA, regression, localization, accessibility
- [ ] Phase 9 — Integration, merge, deployment, and handoff

## Architecture map (verified facts, with file evidence)

### Web/source — stack & shape

- **Hono 4 + TypeScript, dual runtime**: Cloudflare Workers + D1 (`src/index.ts`) / plain Node + `node:sqlite` (`src/server.ts`). Deployed: dev `hibana.aliassadi.workers.dev`, prod `hibana.ir` (custom domain + `projects.hibana.ir` route). `bun run deploy` / `deploy:prod`.
- **Zero-build frontend**: static `public/*.html` + IIFE JS modules (`public/js/*.js`) + modular CSS (`public/css/*.css`); htmx/idiomorph/Alpine vendored. esbuild only content-hashes assets at deploy (`scripts/build.mjs` → `public/dist/` + manifest; `--wire-html` rewrites HTML refs).
- **Kanban = view over `dev_tasks.status`** — 5 lanes `['idea','bug','planned','in_progress','done']` = New Ideas, Problems, Plans, In Progress, Implemented (`public/js/devboard.js:74`, labels `:98-104`; server twin `src/routes/projects/detail-helpers.ts:187-192`). Column order (bug 2nd) is a deliberate owner decision.
- **Board surfaces (2, one engine)**: dedicated `/kanban` page (`public/board.html` + `public/js/board-page.js`, served auth-gated `src/app.ts:370-385`) and embedded project-page board (server-rendered `detail-helpers.ts:433-560`, hydrated by `public/js/project-page.js`). **S209 "1:1 parity" contract** — identical card markup, enforced by `src/tests/kanban-parity.test.ts`.
- **Cards render in 3 places**: `board-page.js:675-694` (client), `detail-helpers.ts:501-514` (server twin), shared helpers `public/js/chip-render.js` (`window.HibanaChips`). Priority ribbon = `.prio-banner` button; click cycles priority.
- **Task modal (Add+Edit shared)**: `devboard.js openEditor :810-832`, `renderModal :871-1307` — title textarea + markdown toolbar, status chips, priority chips, category select + quick-add, **sprint select already exists** (`:942-946`: "No sprint" + sprints + "＋ New sprint" `__new`), tags, Upload File, footer Delete(existing)/Synced/Cancel/Save.

### Existing sprint system (extended by Phase 1 — never duplicated)

- **`sprints` table** (evolved 0029 → 0030 → 0039 → 0052 → **0065**): `id, project_id→projects CASCADE, name, started_at (NOT NULL), ended_at NULL, created_at, is_draft 0/1, version, description` **+ 0065: `status` (backfilled CASE), `emoji`, `due_at`, `due_origin_at`, `updated_at`**. TS type `src/types.ts` `SprintRow` + `SprintStatus`.
- **Lifecycle was IMPLICIT pre-0065** (draft = `is_draft=1`; running = `is_draft=0 AND ended_at IS NULL`; finished = `ended_at NOT NULL`) — D1. **Now explicit** (`planned|active|paused|completed`), kept in lock-step with the legacy pair by every writer (`ended_at NOT NULL ⇔ completed`, `is_draft=1 ⇔ planned`); `sprintStatusOf` coalesces a lagging pre-0065 D1 row back to the legacy derivation.
- **These sprints are TIMELINE windows** (Gantt-like): `sprint.html` + `sprint-page.js` render draggable bands on a day-grid timeline; `started_at/ended_at` are band edges; tasks have `start_at/end_at` clip trims; UTC-midnight parse precedent `sprint-page.js:1188` (S206).
- **Server invariants** `src/routes/devboard.ts` (post-S240 line map): one draft per project (409 `draft_exists`); **one-ACTIVE sprint per project** — partial unique index `idx_sprints_one_active` (0065) + service-layer 409 `sprint_active_exists` carrying `active_id` (start/resume/reopen); create ~`:601`, start ~`:698`, pause/resume ~`:746`/`:759`, PATCH ~`:773`, finish ~`:861` (archives only the sprint's done tasks), reopen ~`:913`, DELETE ~`:942`; task create ~`:243` (completed-sprint assignment guard), task PATCH ~`:305` (deadline-origin stamping + assignment guard); deps POST ~`:1005`, deps DELETE ~`:1030`. Helpers in `src/routes/devboard-helpers.ts` (`sprintStatusOf`, `findActiveSprint`, `sprintNameTaken`, `assertSprintWindowOk` — paused bands skip the sibling scan).
- **Task create auto-assign** (`devboard.ts`): body with `sprint_id === undefined` → lands task in project's DRAFT sprint, else open sprint. **Explicit `null` means "No sprint"** (kept for old clients; D2's client-side fix is Phase 3).
- **Sprint endpoints (post-S240)**: `POST /api/projects/:projectId/sprints` (+ `emoji`, `due_at`), `POST /api/sprints/:id/start|pause|resume|finish|reopen`, `PATCH /api/sprints/:id` (+ `emoji`, `due_at`; stamps `updated_at`), `DELETE /api/sprints/:id`, `POST /api/devtasks/:id/deps`, `DELETE /api/devtasks/:id/deps/:blockerId`.
- **Sprint doc** (0052/S33): `version` + rich-markdown `description`, full-screen editor on project page.
- **Sprint tests**: `src/tests/sprint-validation-s235.test.ts` (adapted-green, intent kept), `sprint-doc.test.ts`, **`src/tests/sprint-deadline-deps-domain.test.ts` (24 tests)**; e2e `sprint-ux`, `sprint-timeline`, `sprint-doc`, `s206-sprint-fixes` specs.

### Task model & archive

- **`dev_tasks`** (0062 shape + FTS5 from 0051) **+ 0065: `due_at`, `due_origin_at`**. No dependency columns; deps live in the new **`dev_task_deps`** table (0065: `blocker_task_id`, `blocked_task_id` both `→dev_tasks ON DELETE CASCADE`, `created_at NOT NULL`, `PK (blocker, blocked)`, `CHECK blocker<>blocked`, both-FK indexes).
- **Archive**: done tasks → `project_archives` snapshot table (0046 + tags JSON 0051 + **0065 `sprint_name_snapshot`**): `id, project_id, title, status='done', priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags, sprint_name_snapshot`. Bulk action `POST /api/projects/:id/devtasks/archive-done`; **finish now archives the sprint's done tasks via the same INSERT pattern** (D4). Restore guards dangling sprint FK (AP-27).
- Legacy `tasks.due_date` (0006) belongs to the client-work module (`/clients.html`), NOT the kanban — do not confuse.

### Calendar / Jalali / i18n / RTL

- Server: `src/lib/jalali.ts` (`toJalali/toGregorian/faDigits/calendarFor/formatDate/formatDateLong`); rule: Gregorian UTC storage, convert at render edge. Tests `jalali.test.ts`, `jalali-calendar.test.ts`.
- Client: `public/vendor/jalaali.min.js` + `public/js/jalali.js` (`window.__hibJalali`) + in-page port in `calendar-page.js`. **No shared date-picker component exists** — only `<input type="date">` in the sprint define popover (D6 → Phase 5).
- i18n: server `src/lib/i18n.ts`; client `public/js/i18n.js` + `i18n-en.js` / `i18n-fa.js` (**parity gate**: `bun run check-i18n-parity`). RTL: `document.documentElement.dir='rtl'` for fa; `public/css/rtl.css` loaded LAST.
- Cache-bust gate: every touched `public/` file needs `?v=` bump (`bun run check-cache-bust`) — not applicable to Phase 1/2 (no `public/` changes).

### Auth / APIs / validation / DB

- Cookie session `__Host-hibana_session` (SHA-256 in DB, 30-day rolling), `requireAuth` middleware; **global CSRF/Origin gate on writes** (`src/app.ts:156-194` — T6: a request with NEITHER Origin NOR Referer is rejected 403 `forbidden` before any route runs; pinned in the S240 domain suite).
- Zod 4 validation everywhere (`src/validation/schemas.ts` + route-local); uniform `{error:'<code>'}` via `src/lib/errors.ts` (+ S240 codes `sprint_active_exists`/`sprint_active`/`sprint_completed`, 409 family; `sprint_completed` deliberately 400 at the task-assignment guards; deps cycle → 409 `cycle` with explicit status); ETags on reads (`src/lib/http.ts`).
- One `Db` interface (`src/db/types.ts`: query/execute/transaction), two adapters: D1 (`d1.ts`, batch = transaction) and node:sqlite (`sqlite.ts`, WAL + FK + FIFO mutex). **Schema lives ONLY in migrations** (`migrations/NNNN_*.sql`, sequential; **latest = 0065** — the S240 migration). Node runner `bun run migrate:node` (auto at boot); D1 via manual workflow `d1-migrate-dev.yml` (bookmark → dump → digest → apply → verify, dev DB only, one at a time).
- `scripts/d1-verify-migration.mjs` enforces the standing migration law at migrate time: pre-existing tables stay additive-identical (no drops/renames/data rewrites beyond the documented backfills).

### Sync contract (web ⇄ desktop)

- Authoritative doc: `docs/project-kanban/API-AND-SYNC-CONTRACT.md` (v0.4.1.35/S209). Today: plain REST + cookie session; desktop pulls `GET /api/projects/:id/devboard` (six-key payload: tasks+tags+shot_count, categories, sprints, tags, task_tags) with ETag, full-board replace; writes are live through the Wails bridge; outbox engine exists but nothing enqueues from UI yet (M3).
- Conflict policy: LWW per field (PATCH SET-builder). No `?since=` deltas yet. **S240 note:** new sprint columns ride the full-board payload pull (no delta needed — desktop does full replace); `sprints.updated_at` (D8) exists for future deltas.
- Phase 2 must extend the payload with `task_deps` (the 7th additive key) + document the whole new surface in the contract doc — see NEXT-SESSION-PROMPT.md.

### CI/CD (web)

- `ci.yml`: push/PR to main (docs-only `**.md` skipped) → `bun run verify` + dist-wiring + Workers-runtime smoke + Lighthouse + parallel e2e 2-shard matrix. **Branch pushes run CI only; CD is main-only (workflow_run-gated).**
- `cd.yml`: workflow_run-gated on CI green on main → build `--wire-html` → deploy dev → live probe → deploy prod (`hibana.ir`) → restore. **Pushing non-md to main = auto prod deploy. Never push feature code to main.** Docs-only `.md` pushes are CI-skipped and cannot deploy.
- `release.yml`: GitHub Release per package.json version bump. `d1-migrate-dev.yml`: manual D1 migration dispatch (dev only today; prod D1 migration process must be confirmed in Phase 9 — never improvise).

### Windows Desktop — stack & shape

- **Go + Wails v2 + WebView2 + modernc.org/sqlite** (pure Go, cgo-free `internal/` packages). `main.go` embeds `frontend/dist` (the "island"), 1600×900 window, tray, single-instance, 5-min sync loop.
- **The island = machine-generated, checksum-pinned snapshot of the web /kanban surface** via `scripts/sync-island.mjs` from hibana-source (content-addressed). `frontend/dist/web-ref.json` pins the ref (`04218ca` today). **NEVER hand-edit**; re-pin after web changes. `frontend/dist` is COMMITTED.
- **Seam**: `desktop-shim.js` exposes `window.hibanaFetch` → Go `Request` (method/path allow-lists) and `window.hibanaXHR` → `Upload`. **Tripwire counts**: `devboard.js` exactly 7 `hibanaFetch(` + 2 `hibanaXHR(`; `board-page.js` exactly 4 `hibanaFetch(`; 0 bare `fetch(`. New call sites ⇒ re-record gates + seam patches, never hand-patch (D9).
- **Mirror DB** (`internal/store/schema.go`): `mirrorSchemaV1` mirrors the cloud subset VERBATIM (projects, dev_tasks, sprints, categories, tags, dev_task_tags, project_categories, project_archives, screenshots); `localSchemaV2` = outbox/meta/local_grace_tasks. Migrations = append-only list (`internal/store/migrations.go`) — **the feature adds v3 in the Phase 9 round**.
- **Desktop CI** (`desktop.yml`): island checksum gate → pinned-ref gate → `go vet` + `go test ./internal/...` → wails build (exe + NSIS installer) → portable zip + SHA256. Autorelease cuts `vX.Y.Z-desktop` per push to main (version ladder lockstep).

## Spec ⇄ repository discrepancy register (D1–D9, materialized from the Phase 0 audit; resolutions re-verified against code in session 3)

> The spec says: extend what exists; record conflicts; do not duplicate. Status marks: ✅ resolved in Phase 1 (S240/0065), 🔶 partially resolved, ⬜ pending (mapped phase).

| # | Discrepancy | Existing behavior (pre-S240) | Spec requires | Resolution | Status |
|---|---|---|---|---|---|
| D1 | **Sprint lifecycle is implicit** (is_draft + ended_at) and timeline-window based | draft/running/finished implied; `started_at/ended_at` = Gantt band edges | explicit Planned/Active/Paused/Completed + optional per-sprint due date + emoji | `sprints.status` (0065 backfill: ended→completed / draft→planned / open→active; two-open legacy data normalizes latest-active, older-paused), `emoji`, `due_at`, `due_origin_at`, `updated_at`; partial unique index one-active + service 409 `sprint_active_exists` (+`active_id`); pause/resume endpoints; `assertSprintWindowOk` skips paused bands; every writer keeps the pair in lock-step; `sprintStatusOf` lagging-D1 belt | ✅ Phase 1 |
| D2 | **Task create auto-assigns sprint** when `sprint_id` undefined | no-sprint body → draft sprint → open sprint | `No sprint` normal valid; dropdown default | Client change: modal always sends explicit `sprint_id` (`null` = No sprint — server honors it); server keeps legacy auto-assign for undefined bodies (old clients/desktop island until re-pinned) | ⬜ Phase 3 (server side stable since Phase 1) |
| D3 | **Sprint DELETE nulls archives' `sprint_id` silently** (AP-27) | archived tasks lose sprint identity | archived tasks retain `Sprint: [name] (deleted)` label | `project_archives.sprint_name_snapshot` (0065); DELETE stamps `"<name> (deleted)"` + nulls the FK (AP-27 hygiene kept); finish stamps the sprint's own name; impact-counts preview is Phase 4 UI | ✅ Phase 1 (UI preview Phase 4) |
| D4 | **Finish sprint archives nothing** (only stamps ended_at) | archiving was a separate manual bulk action | Finish archives only tasks in Implemented; others keep status + sprint link | `POST /finish` transaction: status=completed + ended_at=now + archive-done INSERT pattern scoped to the sprint's done tasks (sprint_id kept, tags JSON, snapshot name); unfinished untouched; additive `archived` count in response. Only the explicit finish archives (create-with-dates auto-close + PATCH drags complete without archiving — legacy timeline mechanics kept byte-compatible) | ✅ Phase 1 |
| D5 | **Sprints page is a timeline**, not a status list | draggable bands, define popover | lifecycle-grouped list/overview + settings/tasks per sprint | Extend `sprint.html`/`sprint-page.js` (keep the timeline); lifecycle list + detail views + counts | ⬜ Phase 4 |
| D6 | **No date-picker component exists** | only `<input type="date">` in sprint popover | Gregorian/Jalali segmented selector, presets, optional time | Build one shared compact deadline control reusing `window.jalaali` + the S206 UTC-parse precedent; storage = ISO instant (UTC); date-only resolves client-side to local 23:59 | ⬜ Phase 5 |
| D7 | **No task deadline / dependency fields anywhere** | none (checked all migrations) | personal deadline + inheritance + deps | `dev_tasks.due_at`/`due_origin_at` + `dev_task_deps` table (0065) + deps endpoints (self/cross-project 400, CTE cycle 409, cascade delete, soft constraints) + origin rules on both task and sprint PATCH/create | ✅ Phase 1 |
| D8 | **Sync gaps**: sprints lack `updated_at`; no `?since=` deltas | documented in contract §5/§7 | feature data must sync consistently web⇄desktop | `sprints.updated_at` (0065, stamped on every write) — enough for future deltas; new columns ride the full-board payload pull (no delta needed; desktop full-replaces). Payload `task_deps` key + contract-doc rewrite = Phase 2 | 🔶 Phase 1 (partial); Phase 2 completes the contract side |
| D9 | **Desktop island = pinned copy**; new fetch call-sites trip CI gates | 7+2 / 4 counts, SEAM_PATCHES | new endpoints must be reachable from the island | Web-first; desktop re-pin round at Phase 9 (mirror schema v3, seam gates, probe #14, version ladder, desktop.yml WEB_REF bump) | ⬜ Phase 9 |

## Phased technical plan (concrete; Phases 2-9 carry forward from Phase 0/1 planning)

- **Phase 2 (web repo)**: board payload `task_deps` additive key; legacy-shape pin test; effective-deadline resolution (server-side computed additive fields — recommended default, decide + record); sprint overview counts (endpoint vs client-derived — decide + record); API-AND-SYNC-CONTRACT.md rewrite; vitest additions. Full detail in `NEXT-SESSION-PROMPT.md`.
- **Phase 3 (web)**: Kanban + modal UI — sprint filter, sprint dropdown (emoji + hide-completed + quick-create with OFF-by-default toggles), card sprint identity, explicit `sprint_id` on create (D2), i18n EN+FA, `?v=` bumps.
- **Phase 4 (web)**: lifecycle UI — Sprints page extension (D5), conflict/finish/delete modals with exact counts, Kanban compact overview, completed history (non-deletable).
- **Phase 5 (web)**: deadline engine + UI — OFF-by-default toggle, shared date control (D6), inheritance + read-only line, card deadline row + progress bar + thresholds, completed-neutrality, origin preservation.
- **Phase 6 (web)**: Extend flows (+24/48/72/Custom, sprint-wide vs task-only, impact previews).
- **Phase 7 (web)**: dependencies UI — collapsed section, searchable multi-select, derived Blocks badges, blocker-completion resolution.
- **Phase 8 (web)**: full QA — vitest + e2e additions, thresholds at boundaries, RTL, i18n parity, cache-bust.
- **Phase 9 (both)**: desktop round (mirror schema v3 + island re-pin + seam gates + probe #14 + version ladder); web PR merge → CI→CD auto-deploy (verify SHA + health + smoke); D1 dev migration via `d1-migrate-dev.yml` (prod D1 process must be confirmed first — never improvise); final report against the spec's acceptance checklists.

## Current assumptions to track (spec Part VI + session decisions — do not silently convert into confirmed user decisions)

1. **Inherited progress origin** = sprint deadline first-assignment time (spec assumption 1). Task-only extension preserves the inherited origin.
2. **Dependencies are soft** — indicators only, never block Kanban movement or mutate priority/status (spec assumption 2).
3. **New assignment to Paused sprints**: ALLOWED (deviates from the spec Part VI #3 *proposed* default of planned/active-only) — rationale: no existing "Sprints page policy" exists to follow, the timeline model already lets tasks sit in any open-window sprint, and the current dropdown offers every sprint. Pinned by test (`assignment into planned/active/paused sprints all stays legal`). Documented in UI in Phase 3; revisit if the owner objects.
4. **New assignment to Completed sprints disallowed** (spec assumption 4); existing associations kept (historical); re-asserting the task's CURRENT completed sprint stays legal (the old Edit modal resends fields verbatim).
5. **Active sprint deletion disallowed** (spec assumption 5) — must Pause or Finish first; Planned and Paused deletable after confirmation.
6. **Phase 0/1 engineering defaults** (recorded for owner review): (a) `status` is authoritative but `ended_at` keeps stamping on finish (timeline history rendering preserved); (b) explicit-`null` `sprint_id` = No sprint forever, `undefined` keeps legacy auto-assign for old clients; (c) deadline storage = ISO-8601 UTC instant, date-only resolved client-side to local 23:59; (d) `dev_task_deps` table name (matches the `dev_tasks` family); (e) sprint name uniqueness enforced for ALL lifecycle states (spec §4.3 — "unique within the same Kanban project", no state carve-out), write-time only (legacy case-twins never reconciled, reads can't fail on them — pinned by test).
7. **S240 (Phase 1) session-added engineering defaults** (all documented in code comments too):
   - **Only the explicit `POST /finish` archives.** The legacy auto-close on create-with-dates and the PATCH window drags DO move `status` in lock-step with `ended_at` — but never archive. Rationale: those are timeline-window mechanics the old clients depend on; the spec's archive rule is scoped to the explicit finish action.
   - **Finish on an already-completed sprint stays legal** (the old re-finish re-stamp): idempotent for archived tasks (they left `dev_tasks`), and any done tasks that appeared since the first finish ride along into the archive.
   - **Paused sprints keep an OPEN window and don't block anything**: excluded from `assertSprintWindowOk`'s sibling scan, don't count for one-active, don't block reopen-via-PATCH. Phase 4 renders paused bands distinctly.
   - **`/start` no longer auto-closes the open sibling** — it 409s `sprint_active_exists` (spec §5.2; the Phase 4 conflict modal resolves it). The create-with-dates auto-close is kept byte-compatible for old timeline clients (closes only the ACTIVE sibling, stamps it completed, archives nothing).
   - **Reopen keeps the S235 isLatest guard**; under the timeline invariants an open band always carries the latest `started_at`, so reopen's one-active 409 arm is unreachable in practice (defense-in-depth; the 409 shape itself is pinned by the start/resume tests).
   - **Auto-generated sprint names bump past collisions** (`Sprint N`, `Sprint N+1`…) up to 50 tries instead of 409ing a nameless create — old timeline clients keep getting 201s.
   - **deps endpoints**: `POST /api/devtasks/:id/deps` → 201 new / 200 `{existing:true}` idempotent; cycle → **409 `cycle`** (registry default 400 — a recorded divergence, vault folders keep 400); self + cross-project/cross-user blocker → 400 `invalid_input`. `DELETE /api/devtasks/:id/deps/:blockerId` → 200 always (tag-link shape).
   - **`dev_task_deps` rides the backup system** (SNAPSHOT_TABLES after dev_tasks + personal export scoped by either endpoint; `schema_version` 20261105) — forced by the backup-audit drift guard ("never lose an idea").
   - **`SprintRow.status` is typed `SprintStatus | null`** (nullable-by-construction column; `sprintStatusOf` coalesces — the lagging-D1 belt re-derives from `is_draft`/`ended_at`).
   - **Two legacy test setups adapted (intent preserved, changes cited in-file)**: s235 test #4's sprint is created OPEN (a closed-with-dates sprint is completed post-0065 and no longer assignable — the test's finish-keeps-sprint_id assertion is unchanged); AP-27's raw sprint insert carries `is_draft=1` (the deletable planned state).
   - **FN-ALLOWLIST re-pinned** for the three grown devboard handlers (task PATCH, sprint create, sprint PATCH — endpoint-flow class, with recorded reasons).
8. **S240b (session 3) session-added notes**:
   - **Branch reconciliation**: Phase 1 content first landed on `feature/sprint-deadline-system` (`0d50b7a`, session 2); the kickoff's mandated branch is `feat/sprint-deadline-deps`, so session 3 re-delivered the identical validated content there (`81f2c05`) + 2 additional tests + re-ran every gate + e2e fresh. The old branch is superseded but preserved (no deletes/force-push). All future work continues on `feat/sprint-deadline-deps`.
   - **Two tests added over session 2's 22** (both pin the kickoff's letter): legacy pre-0065 name case-twins stay readable (write-time-only enforcement) + the CSRF gate fronts the new endpoints (headerless write → 403 `forbidden`).
   - **Desktop identity carried from session 1's discovery** (`assadigit/hibana-desktop`); session 3 did not re-verify per the kickoff's "desktop is not this phase — do not hunt for it" scope rule. Re-verify cheaply at Phase 9 kickoff.

## Session log

### Session 1 — Phase 0 (2026-11-05, S239) — COMPLETE
- Cloned both repos; extracted the pack (SHA-256 spot-checks match ASSET-MANIFEST.md); read the full package.
- Audited both repos exhaustively; baselines: web typecheck/lint/vitest 104f-806t/build ✓ + e2e sample ✓; desktop go vet/test ✓.
- Recorded the D1–D9 discrepancy register; created `feature/sprint-deadline-system`; committed the pack extraction + audit docs; pushed.
- Blockers: none for Phase 1. (Environment notes: Go absent from sandbox — installed locally; full e2e left to CI; D1 prod-migration process to confirm in Phase 9.)

### Session 2 — Phase 1 / S240 (2026-11-05) — COMPLETE (superseded pointer)
- Re-ran full baselines on `main` BEFORE any edit (243 packages; typecheck/lint/vitest 104f-806t/build all green).
- Landed migration 0065 + types + service invariants + domain suite (22 tests) + legacy adaptations + backup coverage + FN-ALLOWLIST re-pins.
- Full gate ladder green (105 files / 828 tests); e2e sprint specs 11/11.
- Committed `0d50b7a` on `feature/sprint-deadline-system`, pushed (token auth one-off). Wrote the Phase 2 prompt.
- Desktop repo untouched (READ-ONLY ✓). No `public/` changes ✓.

### Session 3 — Phase 1 reconciliation + re-delivery (2026-11-05, S240b) — COMPLETE
- Fresh sandbox; cloned; **reconciled**: found session 2's completed Phase 1 on `feature/sprint-deadline-system` (pushed, static, main untouched @ `dad52f5`). Per the pack's "reconcile, never blindly repeat / never overwrite" rule: adopted the validated content rather than duplicating it.
- Re-verified the Phase 0 code map against `main` (no drift); re-ran the **baseline on pristine main**: `bun install` ✓ 243, `bun run verify` ✓ all gates, `bun run test` ✓ **104 files / 806 tests** (78.4s).
- Cut **`feat/sprint-deadline-deps`** from `main` (the kickoff's mandated branch); carried session 2's Phase 1 commit onto it; **line-by-line reviewed** every changed file against the Phase 1 checklist + spec (migration DDL, types, helpers, devboard invariants, backup coverage, legacy-test adaptations, FN-ALLOWLIST).
- **Added 2 tests** over session 2's 22 (kickoff-letter gaps): legacy name case-twins tolerated on read (write-time-only rule) + CSRF gate headerless-write rejection on the new endpoints.
- **Full gate ladder green, fresh run**: `bun run verify` ✓ (tsc, eslint 0 warnings, vitest, prod build, portability, fn-shape, boundaries); `bun run test` ✓ **105 files / 830 tests**; `bunx playwright install chromium-headless-shell` + **e2e sprint-timeline + s206-sprint-fixes 11/11** ✓.
- Committed **`81f2c05`** on `feat/sprint-deadline-deps` (12 files, +1394/−90), pushed (token auth one-off, never persisted).
- **Docs close-out on main** (the only thing allowed there): this file + `NEXT-SESSION-PROMPT.md` (docs-only commit; `**.md` pushes are CI-skipped, cannot deploy).
- Blockers: none. Desktop untouched ✓. No `public/` changes ✓. No deploy, no D1 runs, no PR/merge ✓.
