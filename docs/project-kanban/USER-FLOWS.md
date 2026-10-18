# Hibana Project/Kanban — User Flows

> Step-by-step workflows with UI states, error paths, and recovery — verified against
> **v0.4.1.28 / S205**. Each flow names its surface and the API calls it makes.
> Companion: `FEATURE-INVENTORY.md` (per-control detail), `API-AND-SYNC-CONTRACT.md`.

## 1. Entering the Kanban (the S205 entry contract)

### 1.1 Fresh visit to `https://projects.hibana.ir/kanban` (or `/kanban`)

1. Browser GETs `/kanban` → Worker route (`src/app.ts:356-385`).
2. **No session** → 302 `/login.html?next=%2Fkanban` (server-side; the `loginNext` contract).
   The login page shows; after a successful sign-in the validated `next` returns the user to
   `/kanban` (hib-init.js `safeNext` — same-origin, non-login paths only).
3. **Session valid** → `board.html` is served (`no-store`), the page shell renders
   (loader visible), and boot.js paints theme/language; i18n resolves (FA users get RTL +
   the FA dictionary before first paint).
4. board-page.js boot: `?project=` present? → load that board. Absent? → default resolution
   (§1.3). The board data loads: `GET /api/projects/:id/devboard` (ONE request).
5. Interactive: five columns render with cards; the filter bar appears when tasks exist.

**States:** loading spinner → board; on 401 mid-flight → login bounce with `next`;
on network failure → offline banner (stays, SW serves shell); on 5xx → retry button.

### 1.2 Deep links

- `/kanban?project=<id>` — direct board.
- `/kanban?project=<id>&task=<taskId>` — board + that task's editor opens automatically.
- `/kanban?project=<id>&add=<status>` — board + composer preset to that column.
- Unknown/deleted project id → "This project doesn't exist or was deleted" + Back-to-projects
  link (the `gone()` state — no retry offered because it can never succeed).
- `/kanban.html` → 301 → `/kanban`. Bare `/board.html` → client redirect → `/kanban`.

### 1.3 Default project resolution (no `?project=`)

1. `localStorage.hibana-kanban-last` — if set, `B().load(last)`; the load doubles as
   validation: 404 (deleted) falls through silently.
2. Else `GET /api/projects?sort=recent` → first row (most-recently-updated accessible project).
3. No accessible projects → the no-projects empty state + "Go to projects" CTA.
4. Resolved id is written into the URL via `history.replaceState` (no history entry — Back
   still leaves the app) so refresh/share keeps the exact board.

### 1.4 Auth expiry mid-session

Every board mutation and the boot `/api/auth/me` check can 401: the htmx global handler /
boot guard / SW navigate handler bounce to `/login.html?next=<path+query>`; after re-login
the user lands back on the same board. The offline queue never drops items on 401/403.

## 2. Switching projects (the S205 switcher)

1. The board title (top-left) is a button (chevron hints it). Click / Enter / Space opens
   the popover: search input (focused) + project rows (stage badge, name, "Current" mark)
   + "All projects →" footer.
2. The list = `GET /api/projects?sort=recent` (60s in-memory cache; spinner row while loading;
   "Couldn't load" row on failure). Typing filters by title (case-insensitive).
3. **Activate a row** (click or ↑/↓ + Enter): the popover closes, filters reset, the URL
   updates `?project=` (pushState — Back returns to the previous board via nav.js's popstate
   soft-reload), a loading spinner replaces the board, `B().load(newId)` + render — no page
   navigation (the shell, scripts, and scroll context stay).
4. Failures: 404 → the gone state; network/5xx → the retry state. The previous board is
   already replaced — recovery is the retry (or Back).
5. `hibana-kanban-last` + the palette's Recent (`hibana-recent-projects`) record the visit.
6. Keyboard: Esc anywhere closes and refocuses the title button; outside click closes.
   RTL: the popover anchors to the title's start edge and clamps to the viewport.

## 3. Working with cards

### 3.1 Create

1. Column "＋ Add task" (or a deep link `&add=<status>`) → composer modal.
2. Fields: Title input, rich content (contenteditable), Status ("Lands in"), Priority,
   comma-separated Labels, Sprint select (+ "New sprint" inline), Category picker
   (+ inline quick-create), staged file uploads.
3. Save → `POST /api/projects/:id/devtasks` (server mints the id; auto-lands in the open
   sprint if statuses match) → board reloads (`GET …/devboard`) → the card appears in its
   column, priority-sorted.
4. Validation errors surface inline in the dialog; network failure keeps the dialog open
   with the error (input is never lost). Duplicate submissions are prevented by the
   modal's save flow (button loading state).

### 3.2 View / edit

- Click a card (board) → editor modal; (project page) → read-only slide-over → ⋯ → Edit.
- The editor round-trips the RAW title (`data-raw-title` — the markdown-lite source is
  preserved byte-for-byte), formatting toolbar applies markdown syntax, screenshots upload
  immediately and pin via `PATCH {taskId}`.
- Save → `PATCH /api/devtasks/:id` → `done_at` stamped/cleared on status transitions →
  board reloads.

### 3.3 Move (drag & drop)

1. Drag a card: the source card dims; the hovered column gets the `drag-over` cue; the card
   live-previews its position in the target list.
2. Drop: cross-column → `PATCH {status}`; same-column → position captured; same-column
   drop next to a different-priority card **adopts that priority** (the "urgent zone"
   rule) → extra `PATCH {priority}`; then `POST …/devtasks/reorder {ids}` (the full column
   order); then the board reloads and re-sorts by priority.
3. Failure at any step → toast + full reload (server truth wins — no torn state).
4. Touch: long-press (~260ms) arms the drag (haptic tick); a >12px early move cancels it.

### 3.4 Delete / archive

- Delete (board): native confirm dialog → `DELETE /api/devtasks/:id` → toast + reload.
  **Hard delete — no undo on this surface.** (Project page: optimistic removal + Undo
  toast that re-POSTs the full raw title.)
- "Archive done" (column header): confirm with count → `POST …/devtasks/archive-done`
  → done tasks move to the project archives (restorable from the project page's Archives).
- "Clear done": explicit double-warning confirm → per-task `DELETE`s → reload.

### 3.5 Quick actions

- Priority banner click → cycles low→medium→high→urgent (optimistic; failure → reload).
- Label chip click → toggles that label's filter.
- ⋯ menu → Edit / Delete.
- Per-column Quick Copy (clipboard `- [URGENT] title #Tags` bullets from SERVER state) and
  Export Markdown (blob download).

## 4. Filtering & search

1. Filter bar (appears when tasks exist): priority toggles (OR) × label toggles (OR),
   ANDed; free-text search debounced 150ms; "Clear filter" + "{n} of {m} shown".
2. Zero matches → the honest empty state with a clear-filters CTA.
3. Filters are per-visit state (reset on project switch and reload) — never persisted.

## 5. Sprints

1. Board toolbar "Sprints" → `/sprint.html?project=` timeline.
2. "New sprint" → draft (name/version/description) — a second draft gets 409 `draft_exists`
   and flips the UI to editing the existing draft.
3. Start (closes the previous open sprint at day-before), finish, reopen (latest only) —
   all server-validated with 400s carrying codes.
4. Sprint doc editor: full-screen markdown with live preview; debounced autosave
   (`PATCH /api/sprints/:id {description}`) with retry; task-list checkboxes toggle in the
   preview and write back into the markdown.

## 6. Project lifecycle around the board

- Create: projects page FAB / dashboard quick-add / command palette (title + optional
  client id; duplicate titles get a `duplicate-check` warning pre-submit).
- Stage changes: projects stage board drag (PATCH status) — the board itself never changes
  project stage.
- Archive/park: project page → park (archived_state offline; boards remain accessible via
  direct URL — the project is not deleted).
- Delete: soft (7-day trash, restorable); sparks can force-hard-delete.
- Permissions: single-owner; another account's project id → 404 gone state (no data leak).

## 7. Failure & recovery summary

| Failure | User sees | Recovery |
|---|---|---|
| 401 (expired) | login bounce with `next` | sign in → exact board returns |
| 404 project | "doesn't exist or was deleted" | Back-to-projects link |
| 404 task (deleted elsewhere) | editor/refresh shows column without it | n/a (server truth) |
| Network offline | offline banner (shell cached by SW) | reconnect → retry |
| 5xx | toast + retry state | retry button / reload |
| 429 rate limit | toast (uploads, exports) | wait + retry |
| Save conflict (none exist — no optimistic concurrency) | last-writer-wins | n/a (single-user) |

## 8. RTL/FA specifics on these flows

- The rail, panels, popovers, dialogs, and the S205 switcher all use logical properties;
  `rtl.css` flips what CSS can't. The switcher anchors direction-aware (board-page.js
  `positionSwitch`). Jalali dates + Persian digits render throughout (`faDig`).
- Deep links and the entry URL are direction-neutral (`?project=` ids).
