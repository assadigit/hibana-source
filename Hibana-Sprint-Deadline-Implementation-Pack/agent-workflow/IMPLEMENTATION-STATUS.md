# Hibana Feature Implementation Status

**Status:** Phase 0 COMPLETE — repository audit, architecture map, baselines, and phased technical plan delivered. No feature code yet.
**Last updated:** Session 1 (Phase 0), 5 November 2026.

## Repositories

| Target | Verified identity | Remote | Branch @ audit | Baseline |
|---|---|---|---|---|
| Web/source | `assadigit/hibana-source` (PUBLIC, "Mirror of the deployed hibana.ir app") | `https://github.com/assadigit/hibana-source.git` | `main` @ `dad52f5` (v0.4.1.43, after S238) | ALL GREEN (see below) |
| Windows Desktop | `assadigit/hibana-desktop` ("The Hibana Kanban Windows desktop port — Go + Wails v2 + WebView2 + modernc.org/sqlite") | `https://github.com/assadigit/hibana-desktop.git` | `main` @ `9d53e64` (v0.1.35, island pin `04218ca` = web v0.4.1.43) | ALL GREEN (see below) |

**Feature branch (Web):** `feature/sprint-deadline-system` (created from `main` @ `dad52f5` in Session 1; all feature work lands there; PR → merge at Phase 9 per repo policy). Rationale: pushes to `main` auto-deploy to prod via CI→CD chain (`ci.yml` → `cd.yml` workflow_run-gated); the phased plan doc mandates not deploying an incomplete feature.

**Desktop repo discovery evidence:** GitHub API repo list for `assadigit` (token-authenticated, 2026-11-05); repo description self-identifies as the Windows desktop port; `hibana-desktop/README.md:3-11` confirms "replicates the web kanban at hibana.ir/kanban … sharing the same cloud data over the same API … the spec pack lives in hibana-source docs/project-kanban/"; `frontend/dist/web-ref.json` pins `{"ref": "04218ca", "packageVersion": "0.4.1.43"}` matching hibana-source `main`.

## Baseline checks (Phase 0, exact commands + results)

### Web (`/home/z/hibana-source` @ `dad52f5`, clean tree)

| Command | Result |
|---|---|
| `bun install` (bun 1.3.14, Node v24.22.2) | ✓ 243 packages |
| `bun run typecheck` (tsc --noEmit) | ✓ clean |
| `bun run lint` (eslint src/ --max-warnings 0) | ✓ 0 warnings |
| `bun run test` (vitest run) | ✓ **104 files / 806 tests passed** (79.9s) |
| `bun run build` (prod, esbuild content-hash) | ✓ 86 manifest entries |
| `bunx playwright test e2e/sprint-doc.spec.ts` | ✓ 1/1 passed (after installing matching chromium-1248; initial failure was a sandbox browser-version mismatch, not a code issue) |

Full e2e suite (~90 specs, 2-shard in CI) not run locally in Phase 0 — CI is the gate on PR; local full run is optional per phase.

### Desktop (`/home/z/hibana-desktop` @ `9d53e64`, clean tree)

| Command | Result |
|---|---|
| `go mod download` (Go 1.25.0 installed to `/home/z/go` in sandbox; toolchain go1.27.2 auto-fetched) | ✓ |
| `go vet ./internal/...` | ✓ clean |
| `go test ./internal/...` | ✓ **8 packages pass** (api, auth, quickaccess, store, sync, tray, ui, update; winshell has no tests) |

Desktop unit tests are cgo/Wails-free by design and run on Linux. Island probes (13, Playwright vs. dist bytes) and the wails build/NSIS installer run in desktop CI (windows-latest); not runnable in this Linux sandbox — desktop CI is the gate.

## Phase tracker

- [x] Phase 0 — Repository audit and implementation map (this session)
- [ ] Phase 1 — Domain model, persistence, migrations, invariants
- [ ] Phase 2 — Backend/API, synchronization, cross-platform contract
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
- **Kanban = view over `dev_tasks.status`** — 5 lanes `['idea','bug','planned','in_progress','done']` = New Ideas, Problems, Plans, In Progress, Implemented (`public/js/devboard.js:74`, labels `:98-104`; server twin `src/routes/projects/detail-helpers.ts:187-192`). Column order (bug 2nd) is a deliberate owner decision (`devboard.js:69-73`).
- **Board surfaces (2, one engine)**: dedicated `/kanban` page (`public/board.html` + `public/js/board-page.js`, served auth-gated `src/app.ts:370-385`) and embedded project-page board (server-rendered `detail-helpers.ts:433-560`, hydrated by `public/js/project-page.js`). **S209 "1:1 parity" contract** — identical card markup, enforced by `src/tests/kanban-parity.test.ts`.
- **Cards render in 3 places**: `board-page.js:675-694` (client), `detail-helpers.ts:501-514` (server twin), shared helpers `public/js/chip-render.js` (`window.HibanaChips`). Priority ribbon = `.prio-banner` button (`board-page.js:637-638`, CSS `public/css/polish-batch.css:797-833`, click cycles priority). Timestamps via `chip-render.js metaDateHtml` (Jalali for fa).
- **Task modal (Add+Edit shared)**: `devboard.js openEditor :810-832`, `renderModal :871-1307` — title textarea + markdown toolbar, status chips, priority chips, category select + quick-add, **sprint select already exists** (`:942-946`: "No sprint" + sprints + "＋ New sprint" `__new`), tags, Upload File (staged shots), footer Delete(existing)/Synced/Cancel/Save. Draft-state closure object `modalCtx`.
- **Filters**: filter bar `board-page.js:473-487` — search input (150ms debounce), priority chips, label chips; predicate `taskMatches :461-470`. Server twin parity applies.

### Existing sprint system (CRITICAL — must be extended, not duplicated)

- **`sprints` table** (evolved via migrations `0029` → `0030` → `0039` → `0052`): `id, project_id→projects CASCADE, name, started_at (NOT NULL), ended_at NULL, created_at, is_draft 0/1, version, description`. TS type `src/types.ts:241-251`.
- **Lifecycle is IMPLICIT**: draft = `is_draft=1`; running = `is_draft=0 AND ended_at IS NULL`; finished = `ended_at NOT NULL`. **No paused, no emoji, no per-sprint due date, no `updated_at`** (sync gap, flagged in `docs/project-kanban/DATA-MODEL.md:145` + `API-AND-SYNC-CONTRACT.md` §5.3).
- **These sprints are TIMELINE windows** (Gantt-like): `sprint.html` + `sprint-page.js` (1487 lines) render draggable bands on a day-grid timeline; `started_at/ended_at` are band edges; tasks have `start_at/end_at` clip trims; `POST /api/sprints/:id/start` stamps started_at and closes the previous open sprint; presets in the define popover (24h/48h/72h/1w/2w/1m); UTC-midnight parse precedent `sprint-page.js:1188` (S206, pinned in `e2e/s206-sprint-fixes.spec.ts`).
- **Server invariants** `src/routes/devboard.ts`: one draft per project (409 `draft_exists` `:570-574`); one open sprint enforced via `assertSprintWindowOk` non-overlap check (`src/routes/devboard-helpers.ts:73-102`); start `:614-648`, finish `:723-732` (stamps `ended_at=now`, **tasks keep sprint_id**), reopen `:734-751` (latest-only), PATCH `:650-721`, DELETE `:753-767` (detaches tasks `sprint_id=NULL`, nulls `project_archives.sprint_id`).
- **Task create auto-assign** (`devboard.ts:222-240`): body with `sprint_id === undefined` → lands task in project's DRAFT sprint, else open sprint. **Explicit `null` already means "No sprint"** (code comment `:222-225`).
- **Sprint endpoints**: `POST /api/projects/:projectId/sprints`, `POST /api/sprints/:id/start|finish|reopen`, `PATCH /api/sprints/:id`, `DELETE /api/sprints/:id`.
- **Sprint doc** (0052/S33): `version` + rich-markdown `description`, full-screen editor on project page (`project-page.js:1917-1990+`), deep-link `?sprint=<id>`.
- **Sprint tests**: `src/tests/sprint-validation-s235.test.ts`, `sprint-doc.test.ts`; e2e `sprint-ux`, `sprint-timeline`, `sprint-doc`, `s206-sprint-fixes` specs.

### Task model & archive

- **`dev_tasks`** (final shape `migrations/0062_global_task_categories.sql:123-138` + FTS5 from 0051): `id, project_id, title, status CHECK(5), priority CHECK(low/medium/high/urgent), category_id→categories SET NULL, sprint_id→sprints SET NULL, sort_order, created_at, done_at, start_at, end_at (timeline clip trims — NOT deadlines), search_tags, updated_at` + FTS5(title, search_tags) with triggers. **No due/deadline column. No dependency table anywhere** (checked all 63 migrations).
- **Archive**: done tasks → `project_archives` snapshot table (`0046` + tags JSON `0051:20`): `id, project_id, title, status='done', priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags`. Bulk action `POST /api/projects/:id/devtasks/archive-done` (`devboard.ts:344-386`); list/restore/delete `:391-466`. **Restore guards dangling sprint FK (AP-27)**. Archive UI = lazy section on project page.
- Legacy `tasks.due_date` (0006) belongs to the client-work module (`/clients.html`), NOT the kanban — do not confuse.

### Calendar / Jalali / i18n / RTL

- Server: `src/lib/jalali.ts` (`toJalali/toGregorian/faDigits/calendarFor/formatDate/formatDateLong`); rule: Gregorian UTC storage, convert at render edge. Tests `jalali.test.ts`, `jalali-calendar.test.ts`.
- Client: `public/vendor/jalaali.min.js` + `public/js/jalali.js` (`window.__hibJalali`) + in-page port in `calendar-page.js`. **No shared date-picker component exists** — only `<input type="date">` in the sprint define popover.
- i18n: server `src/lib/i18n.ts` (`trL(lang, en, fa)`); client `public/js/i18n.js` + dictionaries `i18n-en.js` / `i18n-fa.js` (**parity gate**: `bun run check-i18n-parity`); injected DOM must call `t()` at render time.
- RTL: `document.documentElement.dir='rtl'` for fa; `public/css/rtl.css` loaded LAST; logical CSS properties; Persian digits `faDig`.
- Cache-bust gate: every touched `public/` file needs `?v=` bump (`bun run check-cache-bust`).

### Auth / APIs / validation / DB

- Cookie session `__Host-hibana_session` (SHA-256 in DB, 30-day rolling), `requireAuth` middleware; **global CSRF/Origin gate on writes** (`src/app.ts:172-194`) — any script/test client must send session cookie AND `Origin` header.
- Zod 4 validation everywhere (`src/validation/schemas.ts` + route-local); uniform `{error:'<code>'}` via `src/lib/errors.ts`; ETags on reads (`src/lib/http.ts:103-127`).
- One `Db` interface (`src/db/types.ts`: query/execute/transaction), two adapters: D1 (`d1.ts`, batch = transaction) and node:sqlite (`sqlite.ts`, WAL + FK + FIFO mutex). **Schema lives ONLY in migrations** (`migrations/NNNN_*.sql`, sequential; **latest = 0064**, feature starts at **0065**). Node runner `bun run migrate:node` (auto at boot); D1 via manual workflow `d1-migrate-dev.yml` (bookmark → dump → digest → apply → verify, dev DB only, one at a time).
- Big-table-change recipe when CHECK/FK must change: stash → DROP → recreate → copy → rebuild indexes + FTS (`0031/0034/0062/0064` precedent; `PRAGMA foreign_keys=OFF` around batch).

### Sync contract (web ⇄ desktop)

- Authoritative doc: `docs/project-kanban/API-AND-SYNC-CONTRACT.md` (v0.4.1.35/S209). Today: plain REST + cookie session; desktop pulls `GET /api/projects/:id/devboard` (six-key payload: tasks+tags+shot_count, categories, sprints, tags, task_tags) with ETag, full-board replace; writes are live through the Wails bridge; outbox engine exists but nothing enqueues from UI yet (M3, blocked on web M0 §7a-7c: tag-change `updated_at` bump, tombstones, idempotent task creates).
- Conflict policy: LWW per field (PATCH SET-builder). No `?since=` deltas yet.

### CI/CD (web)

- `ci.yml`: push/PR to main (docs-only `**.md` skipped) → `bun run verify` (typecheck + eslint-0 + vitest + prod build + portability + fn-lengths + import-boundaries) + dist-wiring + Workers-runtime smoke + Lighthouse (desktop+mobile) + **parallel e2e 2-shard matrix**.
- `cd.yml`: workflow_run-gated on CI green on main → build `--wire-html` → deploy dev → live probe → deploy prod (`hibana.ir`) → restore. **Pushing non-md to main = auto prod deploy.** Never push feature code to main.
- `release.yml`: GitHub Release per package.json version bump. `d1-migrate-dev.yml`: manual D1 migration dispatch.

### Windows Desktop — stack & shape

- **Go + Wails v2 + WebView2 + modernc.org/sqlite** (pure Go, cgo-free `internal/` packages). `main.go` (867 lines): embeds `frontend/dist` (the "island"), 1600×900 window, tray, single-instance, portable vs installed data-dir, 5-min sync loop.
- **The island = machine-generated, checksum-pinned snapshot of the web /kanban surface** via `scripts/sync-island.mjs` from hibana-source (`git show <ref>:public/<path>`, content-addressed). `frontend/dist/web-ref.json` pins the ref. **NEVER hand-edit**; re-pin after web changes. `frontend/dist` is COMMITTED; `.gitattributes` forces `* -text`.
- **Seam**: `desktop-shim.js` exposes `window.hibanaFetch` → Go `Request` (method/path allow-lists) and `window.hibanaXHR` → `Upload`. **Tripwire counts**: `devboard.js` exactly 7 `hibanaFetch(` + 2 `hibanaXHR(`; `board-page.js` exactly 4 `hibanaFetch(`; 0 bare `fetch(` (verified by `sync-island.mjs verifyDist :5793-5805`). New call sites ⇒ re-record gates + seam patches (`SEAM_PATCHES :1496-1586`), never hand-patch.
- **Mirror DB** (`internal/store/schema.go`): `mirrorSchemaV1` mirrors the cloud subset VERBATIM (projects, dev_tasks, sprints, categories, tags, dev_task_tags, project_categories, project_archives, screenshots); `localSchemaV2` = outbox/meta/local_grace_tasks. Migrations = append-only list `internal/store/migrations.go` (v1, v2 → **feature adds v3**). `ReplaceBoard` (`dao.go:413-608`) = atomic full-board swap; 7-day deletion grace shadow.
- **Sync** (`internal/sync/`): `SyncOnce` (list + every board, ETag) + outbox drain (FIFO, status table §10: 401 relogin-retry-once, 404 drop, 409 drop, 429 hold, 5xx ≤5 dead-letter). Writes stamp `Origin` Go-side (T6). Live island writes ride the bridge today.
- **Convert/api types**: `internal/sync/convert.go`, `internal/api/types.go` (`BoardPayload.Sprints`, `TaskPayload`…) must grow with the web payload.
- **Desktop CI** (`desktop.yml`): island checksum gate → pinned-ref gate (re-sync from hibana-source at pin, prove reproducible) → `go vet` + `go test ./internal/...` → wails build (exe + NSIS installer) → portable zip + SHA256. `autorelease.yml` cuts the next patch tag `vX.Y.Z-desktop` on every push to main (version ladder: wails.json + main.go + versioninfo.json ×4 + make-portable.ps1 + desktop.yml dev placeholder — lockstep, hard rule 9).
- **Island probes**: 13 Playwright probes vs dist bytes with a mock bridge (`scripts/probe-*.mjs`) — **each desktop round adds a probe** (feature round adds #14).
- **Conventions**: single `main` branch; `worklog.md` append-only session journal; conventional-ish commits (`feat(island+release): S23N … @ <webref> (vX.Y.Z) — bump to 0.1.N`); desktop never edits web UI bytes.

## Spec ⇄ repository discrepancy register (reconciliation plan)

> The spec says: extend what exists; record conflicts; do not duplicate. These are the conflicts found and the planned resolution. Each becomes explicit work in the mapped phase.

| # | Discrepancy | Existing behavior | Spec requires | Resolution (phase) |
|---|---|---|---|---|
| D1 | **Sprint lifecycle is implicit** (is_draft + ended_at) and timeline-window based | draft/running/finished implied; `started_at/ended_at` = Gantt band edges on the Sprints timeline page | explicit Planned/Active/Paused/Completed lifecycle + optional per-sprint due date + emoji | **Extend `sprints`** (migration 0065): add `status` column (backfilled: `ended_at NOT NULL`→`completed`; `is_draft=1`→`planned`; else→`active`), `emoji`, `due_at`, `due_origin_at`, `updated_at`. Keep `started_at/ended_at` stamping for timeline history (finish still stamps `ended_at=now` + sets `status='completed'`). Enforce one-active via partial unique index `ON sprints(project_id) WHERE status='active'` + service-layer atomic transitions. Reconcile `assertSprintWindowOk` (paused sprints keep an open window but are not active). (Phases 1-2) |
| D2 | **Task create auto-assigns sprint** when `sprint_id` undefined | no-sprint body → draft sprint → open sprint (`devboard.ts:222-240`) | `No sprint` is a normal valid state; dropdown default | Client change: Add-Task modal always sends **explicit** `sprint_id` (`null` = No sprint — server already honors explicit null). Keep server auto-assign for legacy/undefined bodies (back-compat, old clients/desktop island until re-pinned). (Phase 3) |
| D3 | **Sprint DELETE nulls archives' `sprint_id`** silently (`devboard.ts:753-767`, AP-27) | archived tasks lose sprint identity | archived tasks retain `Sprint: [name] (deleted)` historical label | Add `project_archives.sprint_name_snapshot` (0065); DELETE sets snapshot label for archived rows instead of silent null; non-archived tasks detached (`sprint_id=NULL`); impact counts preview in UI. (Phases 1-2, UI Phase 4) |
| D4 | **Finish sprint does NOT archive** (just stamps `ended_at`); archiving is a separate manual bulk action | finish keeps all tasks in place | Finish archives only tasks in Implemented; others keep status + sprint link | Extend `POST /api/sprints/:id/finish`: within one transaction set `status='completed'`+`ended_at=now` AND move the sprint's `done` tasks into `project_archives` (reuse 0046 snapshot path, keep `sprint_id` + tags JSON). (Phases 1-2) |
| D5 | **Sprints page is a timeline**, not a status list | draggable bands, define popover | Sprints page = list/overview grouped by lifecycle + settings/tasks per sprint; overview = counts per Kanban status + total | Extend `sprint.html`/`sprint-page.js`: keep the timeline (existing feature, preserved), add/extend the "All sprints" list section into the lifecycle-grouped list with settings/tasks access + counts; compact Kanban sprint overview panel. Do not remove timeline functionality. (Phase 4) |
| D6 | **No date-picker component exists** | only `<input type="date">` in sprint popover (UTC-midnight parse fix S206) | Gregorian/Jalali segmented selector, presets, optional time | Build one shared compact deadline control in `public/js/` reusing `window.jalaali` + the S206 UTC-parse precedent; storage = ISO instant (UTC); date-only resolves client-side to local 23:59. (Phase 5) |
| D7 | **No task deadline / dependency fields** anywhere | none | personal deadline + inheritance + deps table | Additive columns on `dev_tasks` (`due_at`, `due_origin_at`) + new `dev_task_deps` table (blocker/blocked, PK pair, same-project enforced in service, cycle check DFS). (Phase 1) |
| D8 | **Sync gaps**: sprints lack `updated_at`; tag-only edits don't bump task `updated_at`; no `?since=` deltas | documented in contract §5/§7 | feature data must sync consistently web⇄desktop | New sprint columns ride the full-board payload pull (no delta needed — desktop does full replace). Add `sprints.updated_at` (0065) for future deltas. Outbox entities for new ops only needed for offline writes (M3 scope — NOT this feature; live bridge writes suffice). (Phase 2) |
| D9 | **Desktop island = pinned copy**; new fetch call-sites trip CI gates | 7+2 / 4 counts, SEAM_PATCHES | new endpoints (deadline, deps, sprint lifecycle) must be reachable from island | Web-first; then re-pin round: bump PIN consts, re-record seam anchors/counts, update `desktop.yml` WEB_REF/WEB_VERSION, add probe #14, bump desktop ladder. (Phases 2/3-8 web, Phase 9 desktop round) |

## Phased technical plan (concrete)

- **Phase 1 (web repo)**: migration `0065_sprint_deadline_deps.sql` (all additive): `sprints` += `status` (backfill mapping), `emoji`, `due_at`, `due_origin_at`, `updated_at`; partial unique index one-active; `dev_tasks` += `due_at`, `due_origin_at`; new `dev_task_deps(blocker_task_id, blocked_task_id, created_at, PK(blocker,blocked))` + indexes; `project_archives` += `sprint_name_snapshot`. Update `src/types.ts`. Service-layer invariants in `src/routes/devboard.ts` + helpers (case-insensitive name uniqueness incl. existing sprints — note: current code has NO uniqueness on sprint name at all; add per spec, scoped to non-completed? No — spec: unique within project, all states); one-active atomic transitions (draft→active, pause, resume, finish-with-archive); deletion semantics (D3); finish-archives-done-only (D4); dependency cycle/self/same-project guards; deadline origin stamping rules. Vitest domain tests for every invariant (follow `sprint-validation-s235.test.ts` patterns: in-memory sqlite + session cookie + Origin header).
- **Phase 2 (web repo)**: API surface — extend board payload (`GET /api/projects/:id/devboard`) with new sprint fields + task deadline fields + `task_deps`; new endpoints: `POST /api/devtasks/:id/deps` + `DELETE /api/devtasks/:id/deps/:blockerId` (or set-semantics); sprint lifecycle transitions via existing endpoints (start/finish/PATCH/DELETE extended per D1/D3/D4) + `POST /api/sprints/:id/pause|resume`; deadline set/clear via existing PATCH `/api/devtasks/:id` (`due_at`); sprint deadline via PATCH `/api/sprints/:id` (`due_at`); extension operations (sprint-wide + task-only override) as explicit endpoints or PATCH semantics. Keep old clients working (island at old pin must still function: payload additions are additive; existing endpoints' response shapes stay backward-compatible).
- **Phase 3 (web)**: Kanban + modal UI — sprint filter (All tasks / sprints / No sprint) in filter bar (both surfaces + parity tests); sprint dropdown upgrade (emoji + status labels + hide completed from assignment + quick-create modal with name/emoji/desc-toggle/due-toggle); card sprint identity badge upgrade (emoji/icon + name); explicit `sprint_id` on create (D2); i18n keys EN+FA; `?v=` bumps.
- **Phase 4 (web)**: lifecycle UI — Sprints page list/overview extension (D5), sprint detail settings/tasks, Kanban compact overview, Start/Pause/Resume/Finish + conflict modal (Finish-or-Pause current), finish confirmation with counts, deletion confirmation with impact counts, completed history (non-deletable).
- **Phase 5 (web)**: deadline engine + UI — OFF-by-default Due date toggle in modal (between Tags and Upload File), expanded controls (Gregorian|Jalali segmented selector, shared date control, 6 presets, Add-time optional, 23:59 helper text), inherited read-only line `Using [Sprint] sprint deadline · [date]`, card deadline row + thin progress bar (below description, above timestamp) with thresholds (>7d sage / >48h-7d amber / ≤48h red / overdue red+text / done gray+Done), completed-sprint historical neutrality, progress origin preservation.
- **Phase 6 (web)**: Extend flows — sprint deadline extend (+24/48/72/Custom) with inheriting-vs-override impact preview; personal extend; inherited task extend offering sprint-wide vs task-only (override creation preserving origin).
- **Phase 7 (web)**: dependencies — collapsed Dependencies section in modal, searchable multi-select Blocked by (project-wide, cross-sprint, no cross-project, no self/cycles), derived Blocks badges, card Blocked/Blocks-N indicators, blocker-completion resolution, soft-constraint behavior.
- **Phase 8 (web)**: full QA — vitest + e2e additions for all flows (lifecycle, deletion, deadlines incl. threshold boundaries exactly-48h/7d, presets, Jalali/Gregorian same-instant, dependency cycles/multi-blockers, RTL), `bun run verify` + `check-i18n-parity` + `check-cache-bust` green; Lighthouse floors hold.
- **Phase 9 (both)**: desktop round — mirror schema v3 (`internal/store/schema.go` + migrations list), `api/types.go` + `convert.go` + `dao.go` ReplaceBoard inserts + `ResetAccount` table list, Go tests; island re-pin (PIN_REF/PIN_PACKAGE_VERSION, seam gates, probe #14, worklog entry, version ladder); PR merge to web main (CI→CD auto-deploy dev+prod — verify deployment SHA + health + smoke via `bun run smoke:remote`/`shotcheck`), desktop push to main (auto-release tag; verify release artifacts); D1 dev migration via `d1-migrate-dev.yml` workflow before/with deploy, prod migration per its established process (workflow supports dev; **prod D1 migration process must be confirmed** — likely same workflow with env selection; investigate in Phase 9, do NOT improvise).

## Current assumptions to track (spec Part VI + session decisions)

1. **Inherited progress origin** = sprint deadline first-assignment time (spec assumption 1). Task-only extension preserves the inherited origin.
2. **Dependencies are soft** — indicators only, never block Kanban movement or mutate priority/status.
3. **New assignment to Paused sprints**: allowed (sprint remains assignable) — follows the "Sprints page policy if one exists" rule; none exists, and the timeline model already lets tasks sit in any open-window sprint. Documented in UI via status label. *(Chosen default: allow. Deviation risk low; revisit if owner objects.)*
4. **New assignment to Completed sprints disallowed**; existing associations kept (historical).
5. **Active sprint deletion disallowed** (must Pause or Finish first).
6. **Session-added engineering defaults** (record for owner review): (a) `status` column is authoritative but `ended_at` continues to be stamped on finish so the existing timeline page keeps rendering history; (b) explicit-`null` `sprint_id` = No sprint forever, `undefined` keeps legacy auto-assign for old clients; (c) deadline storage = ISO-8601 UTC instant, date-only resolved client-side to local 23:59; (d) `dev_task_deps` chosen as table name (matches `dev_tasks` family); (e) sprint name uniqueness enforced for ALL lifecycle states (spec: "unique within the same Kanban project", no state carve-out).

## Session log

### Session 1 — Phase 0 (2026-11-05) — COMPLETE
- Cloned both repos (token auth verified; remotes cleaned of embedded tokens).
- Extracted `Hibana-Sprint-Deadline-Implementation-Pack.zip` → `Hibana-Sprint-Deadline-Implementation-Pack/`; SHA-256 spot-checks match `ASSET-MANIFEST.md`. No pre-existing extracted folder to reconcile.
- Read full package (README, consolidated spec, visual guide, original blueprint, phased plan, templates).
- Audited both repos exhaustively (subagent audits + direct verification of critical files: `devboard.ts` task-create/auto-assign/PATCH, sprint migrations 0029/0039, CI/CD workflows, package.json).
- Baselines: web `typecheck` ✓, `lint` ✓, `vitest` 806/806 ✓, `build` ✓, e2e sample ✓; desktop `go vet` ✓, `go test ./internal/...` ✓ (Go 1.25.0 installed into sandbox `/home/z/go`).
- Recorded 9 spec⇄repo discrepancies (D1-D9) with resolutions.
- Created feature branch `feature/sprint-deadline-system`; committed this pack extraction + status docs; pushed.
- **Blockers:** none for Phase 1. Environment notes: (a) Go was absent from sandbox — installed locally, desktop CI remains the authoritative gate for Windows builds; (b) full e2e suite not run locally (CI 2-shard is the gate); (c) D1 prod-migration process to confirm in Phase 9.
