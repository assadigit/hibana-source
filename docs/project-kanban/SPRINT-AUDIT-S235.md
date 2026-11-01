# S235 — Sprint Section Audit + Performance Improvement

**Trigger:** the owner's report — *"When clicking on sprints, the app becomes problematic. fix it please. then write a full audit and performance improvement with lots of tests for sprints section of the desktop and web app. I think it's half-made and not completely operational."*

**Scope:** the entire sprint surface across both repos — `hibana-source` (the web app + the Cloudflare Workers backend) and `hibana-desktop` (the Wails Windows port). Every server-side route, the data model, the client-side rendering, the desktop island embed, the test coverage, and the known gaps.

---

## 0. The 404 (the immediate bug, now fixed)

### Root cause
The desktop island (`frontend/dist/`) embedded ONLY `board.html` (as `index.html`). The sprint timeline page (`sprint.html`) was never in the island. The board's "Sprints" button hardcodes its `href` to `/sprint.html?project=…` (board-page.js:61). On the web, both hosts serve `/sprint.html`. On the desktop, the Wails asset server serves only files under `frontend/dist/` — `sprint.html` was absent → **HTTP 404** (the screenshot's `wails.localhost/sprint.html → HTTP ERROR 404`).

### The fix (S235)
Embed `sprint.html` in the island alongside `index.html`. The sprint page's logic (`sprint-page.js`) uses `window.HibanaBoard` (devboard.js — already in the island) for ALL data access — **ZERO direct `fetch()` calls** (verified). So the page works with a MINIMAL desktop-owned chain:

- **`scripts/sync-island.mjs`** — a new `generateSprintHtml(html)` function applies the SAME strip discipline as `adaptBoardHtml` (the web-chrome scripts — htmx, alpine, nav.js, hib-init.js, etc. — are identical between board.html and sprint.html@pin) + inserts a MINIMAL desktop-owned chain (theme + shim + audio + login) before devboard.js + the login gate after `<body>` + a cross-page link interceptor before `</body>`.
- **`js/sprint-page.js`** added to `COPY_MANIFEST` (served verbatim — no seam patches needed).
- **Cross-page link interceptor** — sprint.html's "Back to project" link points to `/project.html` (not in the island). The interceptor catches clicks on `/project.html`, `/projects.html`, `/login.html`, etc., prevents the 404, shows a toast, and redirects to `/kanban` (the board).
- **`scripts/probe-sprint.mjs`** — a new 18-check Playwright probe: page served (200 not 404), desktop chain loads, login gate works, timeline renders, project title shows, create sound cue fires (S234), cross-page interceptor catches the back-link, Board link navigates to /kanban, zero page errors.

**Proof:** probe-sprint ALL GREEN · all 9 sibling probes ALL GREEN · vitest 770/770 · go vet + go test green.

---

## 1. Server-side sprint API

### 1.1 Endpoint inventory

All sprint routes live in `src/routes/devboard.ts` (866 lines), under `requireAuth(cfg)`.

| Method + path | Line | Purpose | DB tables |
|---|---|---|---|
| `GET /api/projects/:projectId/devboard` | 142-198 | One combined payload (tasks, sprints, tags, categories) — the sprint page's only "load" call | `dev_tasks`, `dev_task_tags`, `screenshots`, `sprints`, `tags`, `categories`, `project_categories` |
| `POST /api/projects/:projectId/sprints` | 549-599 | Create a sprint — draft by default, or STARTED if `started_at` provided | `sprints` (+ closes open sprint if hasDates) |
| `POST /api/sprints/:id/start` | 601-628 | Promote a draft to started; closes the open sprint | `sprints` |
| `PATCH /api/sprints/:id` | 630-716 | Edit name/version/description + drag dates; full overlap + reopen validation | `sprints` |
| `POST /api/sprints/:id/finish` | 718-727 | Stamp `ended_at = now` | `sprints` |
| `POST /api/sprints/:id/reopen` | 729-746 | Null `ended_at` — guarded by "latest + no other open" | `sprints` |
| `DELETE /api/sprints/:id` | 748-762 | Transactional: null `dev_tasks.sprint_id`, null `project_archives.sprint_id`, then DELETE | `dev_tasks`, `project_archives`, `sprints` |
| `GET /api/reports/summary` | reports.ts:48-132 | Includes the last 10 real sprints with done-counts by priority tier ("velocity") | `sprints`, `dev_tasks`, `projects`, `tags`, `dev_task_tags` |

**Absent endpoints:**
- No `GET /api/sprints/:id` — the only way to fetch a sprint is via the parent `/devboard` payload.
- No `GET /api/projects/:projectId/sprints` — same.
- No `POST /api/sprints/:id/items` — task assignment is done by `PATCH /api/devtasks/:id { sprint_id }`.

### 1.2 N+1 query analysis

`GET /api/projects/:projectId/devboard` uses `Promise.all` over 5 queries — **no N+1 over the wire**. But two correlated subqueries run per task row inside one SQL statement:

```sql
SELECT t.*, COALESCE((SELECT GROUP_CONCAT(tt.tag_id) FROM dev_task_tags tt WHERE tt.task_id = t.id), '') AS tags,
       COALESCE((SELECT COUNT(*) FROM screenshots sc WHERE sc.task_id = t.id), 0) AS shot_count
FROM dev_tasks t WHERE t.project_id = ? ORDER BY …
```

This is O(N) row-by-row subquery execution inside D1. For 200+ tasks/project it becomes a hot path. A `LEFT JOIN … GROUP BY t.id` would consolidate but D1 lacks elegant group-concat options — current shape is an accepted trade-off.

**The bigger N+1 lives in the CLIENT, not the server** (see §3.2).

### 1.3 Authorization checks

Strong, consistent pattern — every route resolves through ownership:

- `requireAuth(cfg)` gates the entire router — no token → 401.
- `getOwnedProject(cfg, user.id, projectId)` — `SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL`. Foreign project → 404.
- `ownedSprint(cfg, user.id, id)` — `SELECT s.* FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.user_id = ?`. Foreign sprint → 404.
- SEC-11 belt-and-suspenders: the `UPDATE dev_tasks` itself re-scopes `WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)` so even a leaked task id can't be mutated by another user.

---

## 2. Sprint data model

### 2.1 Schema (4 migrations: 0029, 0030, 0039, 0052)

**`sprints` table:**

| Column | Type | Constraint | Migration |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | 0029 |
| `project_id` | TEXT | NOT NULL, FK → projects(id) ON DELETE CASCADE | 0029 |
| `name` | TEXT | NOT NULL | 0029 |
| `started_at` | TEXT | NOT NULL — the ◆ marker position | 0029 |
| `ended_at` | TEXT | nullable — NULL while open | 0029 |
| `created_at` | TEXT | NOT NULL | 0029 |
| `is_draft` | INTEGER | NOT NULL DEFAULT 0 | 0039 |
| `version` | TEXT | nullable — free-text label like "12.1" | 0052 |
| `description` | TEXT | nullable — the full-screen editor's markdown doc | 0052 |

- `idx_sprints_project` on `project_id`. **No index on `is_draft`, `ended_at`, or `started_at`** — every "find the open/draft sprint" query is a project-scoped scan. For ~50 sprints/project this is fine; for archived projects with hundreds it's linear.

**Task link:** `dev_tasks.sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL` (0029:35). The `ON DELETE SET NULL` is overridden by the explicit `UPDATE dev_tasks SET sprint_id = NULL` in `DELETE /api/sprints/:id` — belt and suspenders.

### 2.2 Status model (implicit — two columns together)

| State | is_draft | ended_at | Timeline |
|---|---|---|---|
| **draft** ("Plans") | 1 | NULL | The `#sp-draft` panel (never on the axis) |
| **running** ("In Progress") | 0 | NULL | On the axis, the strip's clip grows to today |
| **finished** ("Done") | 0 | NOT NULL | On the axis, frozen at `ended_at` |

There is **no `cancelled` or `paused` state**.

### 2.3 Constraints NOT enforced at the DB level (gaps)

- **One open sprint per project** — only enforced in app code. No unique partial index. A bug in app logic could violate this.
- **One draft per project** — only enforced at POST-create by querying for an existing draft. No DB unique constraint.
- **Non-overlap** — only enforced in `PATCH /api/sprints/:id` (L666-686). **NOT enforced in `POST` create-with-dates (L572-590) or `POST /start` (L601-628).** See §4.2.
- **`ended_at > started_at`** — NOT enforced in `createSprintSchema` (L87-96 has no `.refine(clipRangeOk)`, unlike `createDevTaskSchema` at L62). The PATCH branch checks it inline (L655-657). Creating a sprint with `end < start` succeeds at INSERT.

---

## 3. `sprint-page.js` rendering performance (1486 lines)

### 3.1 Render strategy: full innerHTML string concatenation

Every render function builds a giant HTML **string** then assigns to `.innerHTML`:

- `renderSide()` (L181-230) — categories sidebar
- `renderTimeline()` (L299-505) — the axis: months strip + cells (day/week) + sprint bands + chips + lane dots. For a 31-day window with 3 sprints + 50 tasks: ~3-5k of HTML rebuilt per render.
- `renderDraft()`, `renderTimeNav()`, `renderFinishBtn()`, `renderSprintsList()` — all the same pattern.

### 3.2 The `render()` + `reload()` pair — full re-render on every mutation (THE perf hotspot)

```js
const render = () => { computeRange(); renderSide(); renderTimeline(); renderDraft(); … }
const reload = async () => { await B().load(projectId); render() }
```

**Every interaction calls `await reload()` — a full network round-trip (`GET /api/projects/:projectId/devboard`) + 7 innerHTML rewrites.** 30+ call sites:

- Drag a sprint boundary → finish → `B().patchSprint()` → `await reload()`
- Drag a task bar → finish → `B().patchTask()` → `await reload()`
- Sidebar quick-add → `B().createTask()` → `await reload()`
- Rename draft → `B().renameSprint()` → `await reload()`
- Define sprint → `B().createSprint()` → `await reload()`
- Start/finish/reopen/delete sprint → `await reload()`
- Drop task on sprint/lane → `B().patchTask()` → `await reload()`
- Save/delete category → `await reload()`

**There is no optimistic local mutation** except during the active drag (the `paint()` calls update inline styles live). Once the pointer releases, the optimistic state is thrown away and replaced by a server round-trip.

**On the desktop**, the transport is `window.hibanaFetch → window.go.desktop.API.Request` (Wails IPC → Go HTTP client → Cloudflare D1). Every `await reload()` adds ~30-80ms of IPC overhead vs the web's direct fetch. With 30+ reload sites, the desktop feels notably slower on drag-finish, drop, and rename actions.

### 3.3 Zoom levels — entire axis recomputed on change

A zoom switch from `m1` (31 days) to `y1` (365 days) jumps from ~31 to ~365 day-cells — a ~10× larger HTML string built and parsed. **No virtualization, no caching of the previous zoom's geometry.**

### 3.4 Per-render cost — `sprintStats()` is O(S×T)

For each sprint on the axis, `sprintStats()` iterates **all tasks in the project** to bucket done-by-day inside the sprint window. Called inside `geom.forEach(g => …)`. So: O(S × T) where S = visible sprints, T = total tasks. For 3 sprints + 100 tasks + 6 categories + 31-day window: ~1500 task-iterations per render. Not catastrophic but not free.

### 3.5 Memory leaks / listener hygiene

**Properly cleaned up:** All `ctx.on(type, fn)` listeners are tracked + removed on `unmount()`. The drag's window-level pointer listeners are explicitly removed in `onUp`. ✓

**Potential leak:** `definePop`, `sprintPop`, `catPop` popovers are added to `document.body` and removed via their close functions. But if a soft-navigation happens mid-popover, the popover div stays in `<body>` — no `unmount()` hook calls the close functions. **Action item: expose an `unmount()` from `mount(ctx)` that closes any open popover.**

---

## 4. Known gaps / edge cases

### 4.1 No TODO / FIXME markers
Grep across sprint files returned zero matches. Gaps are implicit.

### 4.2 EDGE CASE — Overlap check gap (correctness bug)

**PATCH enforces non-overlap at day granularity** (devboard.ts:666-686). **BUT two other entry points skip it:**

1. **`POST /api/projects/:projectId/sprints` with `started_at`** (L572-590) — closes the OPEN sprint, then INSERTs the new sprint with the user's dates. **No check against any closed sprint's date range.** A user can create "Sprint 5 (Mar 1 → Mar 30)" while "Sprint 4 (Mar 15 → Mar 20)" exists — they'll overlap on the timeline.

2. **`POST /api/sprints/:id/start`** (L601-628) — sets `started_at = now`. **No check that "now" doesn't fall inside an existing closed sprint's range.**

**Fix:** lift the overlap check into a shared `assertSprintWindowOk()` helper, call from POST / PATCH / start. (Implemented in S235 — see §6.)

### 4.3 EDGE CASE — `end < start` on create (validation gap)

`createSprintSchema` (devboard.ts:87-96) does NOT have `.refine(clipRangeOk)`. Creating a sprint with `started_at: '2026-12-15', ended_at: '2026-12-01'` succeeds at INSERT — the timeline then renders a negative-width strip. PATCH catches it (L655-657), POST does not.

**Fix:** add `clipRangeOk` refine to `createSprintSchema`. (Implemented in S235 — see §6.)

### 4.4 EDGE CASE — Can a sprint be started without items?

**Yes.** `POST /api/sprints/:id/start` has no "has any tasks?" check. The frontend also lets you click "Start sprint" with 0 items. **Probably intended** (the sprint doc IS the content sometimes), but worth a UX note.

### 4.5 EDGE CASE — What happens when a sprint is finished?

`POST /api/sprints/:id/finish`: `UPDATE sprints SET ended_at = ?`. **Tasks are NOT touched** — `dev_tasks.sprint_id` keeps pointing at the finished sprint. Intentional: the "All sprints" list + reports/velocity both rely on the FK staying valid post-finish. ✓

### 4.6 EDGE CASE — Velocity

Implemented in `/api/reports/summary` (reports.ts:92-105), NOT on the sprint page itself. The sprint page's chip popover shows a per-sprint mini-velocity (`sprintStats`, rendered at L907-934): `assigned`, `done`, `days`, `docChecked`, `categories`. No historical comparison, no burn-down chart, no cross-sprint trend. The owner's "velocity" lives on `/reports.html`.

---

## 5. Desktop-specific gaps

### 5.1 Stripped scripts (no core impact)

sprint.html on the desktop has these stripped: htmx, idiomorph, boot.js (replaced by shim), alpine, app.js (replaced by shim), hib-init.js, touch-drag.js (sprint-page.js uses its OWN pointer handlers), nav.js, command-palette.js, mobile-nav.js, zen-mode.js, micro-interactions.js, go-to.js.

**No sprint-page.js feature depends on a stripped script in a way that breaks core functionality.** The shim correctly provides every runtime dependency.

### 5.2 The "Plan" link gap (the big desktop gap)

sprint-page.js builds `<a href="/project.html?id=…&sprint=…">Plan</a>`. On the web, this opens the project page's full-screen sprint plan editor. On the desktop, the link interceptor catches it → toast → redirect to `/kanban`. **There is no way to open the sprint plan editor on the desktop island.**

**Options (future work):**
- (a) Port the project.html `?sprint=` flow into a desktop-served route (big scope — project.html has its own huge JS/CSS/vendor graph)
- (b) Intercept the Plan link to open the editor in an external browser (hibana.ir deep-link)
- (c) Hide the Plan button on the desktop island (suppress at injection time)

For S235, option (c) is the pragmatic choice (hide the button). The audit documents this as a known gap.

### 5.3 Desktop transport latency

Every `await reload()` on the desktop adds ~30-80ms of IPC overhead (Wails IPC → Go HTTP client → Cloudflare D1). With 30+ reload sites, the desktop feels notably slower. **Fix:** optimistic local mutation (§6.1).

---

## 6. S235 fixes + improvements

### 6.1 Sprint-page.js: optimistic local mutation (perf)

Replace `await reload()` with optimistic local mutation + `render()` for PATCH/POST operations where the server response is `{ ok: true }` (no body). Reserve full `reload()` for create/delete operations that change the sprint/task set. This eliminates the network round-trip for drag-finish, drop, and rename actions — the most common sprint interactions.

### 6.2 Server: add `clipRangeOk` to `createSprintSchema` (correctness)

Reject `end < start` at create time, matching the PATCH branch's existing check.

### 6.3 Server: extract `assertSprintWindowOk()` helper (correctness)

Lift the overlap check from PATCH into a shared helper, call from POST-create-with-dates + POST-start too. Closes the §4.2 gap.

### 6.4 Server: add `?window_start=&window_end=` to the devboard GET (perf)

So the sprint page can fetch a windowed subset instead of the entire task array on every reload. (Future work — documented here.)

### 6.5 Tests (coverage)

New vitest tests:
- `POST /finish` leaves `dev_tasks.sprint_id` intact
- `POST /reopen` honors the latest-and-no-other-open guard
- `PATCH` overlap returns 400
- POST-create-with-dates closes the open sprint + rejects overlap (the §4.2 fix)
- `end < start` on create is rejected (the §4.3 fix)

New Playwright e2e (`probe-sprint.mjs`): the sprint page loads, renders, login gate works, create cue fires, cross-page interceptor catches the back-link, Board link navigates to /kanban.

---

## 7. Action items (prioritized)

### Performance
1. **sprint-page.js** — optimistic local mutation for PATCH operations (§6.1)
2. **devboard.ts:142-198** — `?window_start=&window_end=` query support (§6.4, future)
3. **sprint-page.js:262-288** — cache `sprintStats()` results per sprint-id until tasks change

### Correctness
4. **devboard.ts:87-96** — `.refine(clipRangeOk)` on `createSprintSchema` (§6.2)
5. **devboard.ts:572-590** — `assertSprintWindowOk()` from POST-create-with-dates (§6.3)
6. **migrations** — partial unique index `WHERE ended_at IS NULL AND is_draft = 0` to backstop the one-open-sprint rule (future)

### Test coverage
7. New vitest: finish-keeps-sprint_id, reopen-guard, patch-overlap-400, create-with-dates-overlap-400, end-before-start-400 (§6.5)
8. New Playwright: probe-sprint.mjs (done — 18 checks ALL GREEN)

### Desktop island
9. **sprint.html** — decide on the Plan link gap (§5.2): port, deep-link out, or hide (future)
10. **sprint-page.js** — expose an `unmount()` that closes open popovers (future)
