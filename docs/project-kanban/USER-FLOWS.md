# Hibana Project/Kanban — User Flows

> Step-by-step workflows with UI states, error paths, and recovery — verified against
> **v0.4.1.35 / S209** (the kanban 1:1 parity round). Each flow names its surface and
> the API calls it makes. Companion: `FEATURE-INVENTORY.md` (per-control detail),
> `API-AND-SYNC-CONTRACT.md`.

## 1. Entering the Kanban (the S209 entry contract)

### 1.1 Fresh visit to `https://projects.hibana.ir/kanban` (or `/kanban` on hibana.ir)

1. Browser GETs `/kanban` → the Worker route (`src/app.ts:370-385`, auth-gated,
   `no-store`; `/kanban.html` 301s to it at `src/app.ts:355`) — both hosts serve the
   same route, one underlying `board.html`. **No session** → 302
   `/login.html?next=%2Fkanban` (the `loginNext` contract); after sign-in the
   validated `next` returns the user to `/kanban` (hib-init.js `safeNext`).
2. **Session valid** → `board.html` renders full-bleed: the `.db-frame` mother container
   wraps the hairline toolbar + filter + columns (`public/board.html:62-89`). The
   **edge-hover rail** is active on `/kanban` (`public/js/nav.js:388` `RAIL_EDGE_PAGES`)
   — the sidebar is off-canvas; screen-edge hover or keyboard focus reveals it.
3. board-page.js boot: `?project=` present? → load that board; absent → default
   resolution (§1.3). The data loads: `GET /api/projects/:id/devboard` (ONE request;
   `public/js/devboard.js:157-166` — the S206 hardened dispatch: abort-signal + 3s
   deadline + one retry, `devboard.js:10-64`). i18n resolves before first render — FA
   users get RTL + the FA dictionary (`public/js/board-page.js:969-970`); five columns
   render; the filter bar appears when tasks exist (`board-page.js:94-108`).

**States:** loading spinner → board; 401 mid-flight → login bounce with `next`;
network/5xx → retry button (`board-page.js:906-912`); 404 → gone state (§1.2).

### 1.2 Deep links

- `/kanban?project=<id>` — direct board; `&task=<taskId>` — board + that task's editor
  opens automatically (`board-page.js:962`); `&add=<status>` — board + composer preset
  to that column (`board-page.js:963`). Unknown/deleted project id → "This project
  doesn't exist or was deleted" + Back-to-projects link (`board-page.js:915-921` — no
  retry offered because it can never succeed). `/kanban.html` → 301 → `/kanban`
  (`src/app.ts:355`); bare `/board.html` (no `?project=`) → client redirect → `/kanban`
  (`board-page.js:28-29`).

### 1.3 Default project resolution (no `?project=`)

1. `localStorage.hibana-kanban-last` — if set, `B().load(last)`; the load doubles as
   validation: 404 (deleted) falls through silently (`board-page.js:930-938`). Else
   `GET /api/projects?sort=recent` → first row (`board-page.js:939-943`); none → the
   no-projects empty state + "Go to projects" CTA (`457-468`). The resolved id is
   written into the URL via `history.replaceState` (no history entry — Back still
   leaves the app) so refresh/share keeps the exact board (`944-948`).

### 1.4 The `/board.html` entry (the in-app project context)

1. `/board.html?project=<id>` serves the SAME file, frame, and page JS with two
   **documented contextual deltas** (deliberate, entry-context exceptions):
   - **The Back link stays** — points at `/project.html?id=` (`board.html:71`, href
     `board-page.js:953`); on `/kanban` it is hidden (`board-page.js:35-38` — there is
     no "back" from the direct entry).
   - **The classic icons-only rail** (64px, always visible) instead of the edge-hover
     rail — `/board.html` + `/board` sit in `RAIL_ICON_PAGES` (`nav.js:383`) vs the
     kanban paths in `RAIL_EDGE_PAGES` (`nav.js:388`).
2. Everything else is byte-identical: switcher, editor, filter bar, DnD, pin/sprint
   badges, archive/clear/copy/export.

### 1.5 Auth expiry mid-session

Every board mutation and the boot `/api/auth/me` check can 401: the htmx global handler
/ boot guard / SW navigate handler bounce to `/login.html?next=<path+query>`; after
re-login the user lands back on the same board. The offline queue never drops items on
401/403.

## 2. Switching projects (the in-place switcher)

1. The board title (top-left) is a button (chevron hints it — `board.html:75-80`).
   Click / Enter / Space opens the popover: search input (focused) + project rows
   (stage badge, name, "Current" mark) + "All projects →" footer (`board-page.js:357-409`).
   The list = `GET /api/projects?sort=recent` (60s in-memory cache, `283-293`; spinner
   row while loading, "Couldn't load" row on failure); typing filters by title
   (case-insensitive; `317-333`).
2. **Activate a row** (click or ↑/↓ + Enter, `board-page.js:376-394`): the popover
   closes, filters reset (`415`), the URL pushState's `?project=` (Back returns to the
   previous board via nav.js's popstate soft-reload; `420-424`), a spinner replaces the
   board, `B().load(newId)` + render — **no page navigation** (shell, scripts, and
   scroll context stay; `board-page.js:410-437`). Failures: 404 → the gone state;
   network/5xx → the retry state (`433-436`); the previous board is already replaced —
   recovery is the retry (or Back).
3. `hibana-kanban-last` + the palette's Recent record the visit (`294-302`). Esc closes
   and refocuses the title button (`450-452`); outside click closes (`448`); RTL: the
   popover anchors direction-aware and clamps to the viewport (`positionSwitch`,
   `334-350`).

## 3. Working with cards

### 3.1 Create — two surfaces, one option set

**3.1a The board's shared modal** (`/kanban`, `/board.html`; edit-mode on `sprint.html`):

1. Column "＋ Add task" (or a deep link `&add=<status>`) → `B().openEditor(null,
   {defaults:{status}})` (`board-page.js:654-658`) → the shared modal
   (`devboard.js:830-944`). Fields, in card order:
   - **Title** — one multi-line TEXTAREA (`devboard.js:877-885`); Enter saves,
     Shift+Enter breaks the line (`1258-1261`).
   - **Formatting toolbar** — the FULL set (S209; `devboard.js:862-876`) writing RAW
     markdown into that single textarea (the board's single-field contract): bold
     `**x**` / underline `__x__` / strike `~~x~~` wrap the selection (`1008-1019`);
     bullet prefixes every touched line with `- ` and ordered numbers them `1. `, `2. `…
     sequentially (`992-996`); align sets `{:left}` / `{:center}` / `{:right}` /
     `{:justify}` at line start, REPLACING an existing marker (`997-1003`); code wraps
     the selection in ``` fences on their own lines (`1009-1012`).
   - **Status / Priority** segmented controls (`886-891`, wiring `1037-1043`);
     **Category** select + inline "New category…" (`893-900`) → name + the 16 curated
     fill+ink swatches (`907-912`, `946-965`), created on save via
     `POST /api/projects/:id/categories` (`1212-1220`); **Sprint** select + inline
     "New sprint" (`901-905`) — a 409 `draft_exists` is dodged by REUSING the existing
     draft (S206; `1221-1231`); **Tags** — staged chips with ✕ on create (Enter stages;
     `913-918`, `1093-1115`), riding the create body's `tags[]`.
   - **Upload File** (`924-935`, full S86 accept list) — uploads immediately
     (`POST /api/projects/:id/screenshots`) into the staged grid with per-file progress
     + cancel (`1116-1149`); **PIN on save** (PATCH `{taskId}` per shot, `1242-1249`),
     **DELETE on cancel** — Esc/✕/Cancel/backdrop all clean up (`821-827`).
2. Save → `POST /api/projects/:id/devtasks` (`devboard.js:1232-1241`) → toast → modal
   closes → `onSaved` → board reloads (`GET …/devboard`) → the card appears in its
   column, priority-sorted.
3. Validation: empty title → focus, no POST (`1209-1210`); a pending category without a
   name → focus (`1214-1215`). Network failure → toast, the modal stays open (input is
   never lost; `1256`).

**3.1b The project page's composer** (`/project.html?id=`):

1. Column "＋ Add" (`detail-helpers.ts:494`) → the server-rendered `#pd-taskadd-modal`
   dialog (`src/routes/projects/detail-helpers.ts:702-824`; opened/reset by
   `project-page.js:2759-2799`).
2. Fields: separate **Title input + Content contenteditable** (`detail-helpers.ts:738-739`)
   with the SAME toolbar vocabulary (`723-737`) applied WYSIWYG through `execCommand`
   (`project-page.js:3953-4024`; the mousedown focus-theft guard `3948-3952`), converted
   back to the same markdown by `htmlToMd` on save (`3935`, `3323-3326`). Status
   ("Lands in", defaults to the clicked column) + Priority + Labels + Sprint select
   (auto/active · none · id — `detail-helpers.ts:751-781`, read at
   `project-page.js:3345-3348`) + category combobox with inline create (`787-795`) +
   staged uploads (`803-812`).
3. Save → `POST /api/projects/:id/devtasks` with `title = title + '\n' + content`
   (`project-page.js:3323-3353`) → staged shots PIN (`3359-3365`) → the card lands in
   place (`insertTaskChip`, `3367`) or `bodyRefresh()` (`741`).

### 3.2 View / edit — two editors

**3.2a The board's shared editor modal:**

1. Click a card → the editor opens directly (`board-page.js:691-695`; the prio banner,
   label chips, ⋯ menu, read-more and pin badge are excluded actions). The modal
   round-trips the RAW title (`data-raw-title` — markdown-lite preserved byte-for-byte).
2. Same full toolbar + fields as create (§3.1a), plus: **tags add/remove LIVE** — Enter
   POSTs `POST /api/devtasks/:id/tags`, ✕ DELETEs `/api/devtasks/:id/tags/:tagId`
   (`devboard.js:1067-1092`); each change re-renders the card and `syncTitleToDraft`
   keeps the typed title through the repaint (`1058-1066`). **Upload File pins
   immediately** per file; the inline grid shows the task's pinned shots with zoom /
   edit-note (PATCH `{caption}`) / delete (`1140-1141`, `673-685`, `1150-1191`, `630-659`).
3. Save → `PATCH /api/devtasks/:id` (`1250-1254`) → toast → reload.
4. **Pinned-pictures dialog via the card badge**: the `.pd-task-shots` badge (fed by the
   payload's `shot_count`, `board-page.js:230-235`) opens `HibanaBoard.openTaskShots` —
   grid + zoom + unpin (`PATCH {taskId:null}`) → board reloads so the count stays true
   (`board-page.js:685-690`; `devboard.js:690-740`). **Copy** in the ⋯ menu copies the
   RAW title to the clipboard + toast (`board-page.js:497`, `518-528`).

**3.2b The project page's slide-over + split editor:**

1. Click a card → the READ-ONLY detail slide-over (S149; `project-page.js:2847-2866`
   → `openPdTaskDetail`, `4209-4365`) — renders the full title + content from
   `data-raw-title` with ZERO fetch (`4210-4214`); own Copy + ⋯ (Edit/Delete); Esc
   closes one layer per press (`4311-4318`). ⋯ → **Edit** (card menu `4150-4155` or
   the slide-over's `4290-4296`) → `openPdTaskEditor` (`4376-4805`): the
   **title/content split** (raw split on open, `4729-4740`), the same toolbar
   vocabulary through `execCommand` + `htmlToMd` on save (`3953-4024`, `4627-4631`),
   the **full-screen writing toggle** (§8), status/priority selects (`4424-4434`),
   comma-separated labels with replace-set semantics (`4435-4438`, `4635-4637`),
   category combobox (`4441-4447`), Upload File → immediate pin + inline grid
   (`4508-4531`, handlers `4533-4570`).
2. Save → `PATCH /api/devtasks/:id {title,status,priority,tags,category_id}`
   (`4647-4651`) → the card updates IN PLACE and auto-snaps into its priority slot
   (`4656-4714`). The pin badge opens the local pinned-pictures dialog (`[data-pd-shots]`
   → `taskShotsDialog`, `928-929`, `836-884`; unpin → `bodyRefresh()`); Copy in the ⋯
   menu copies the raw title+content (`4137-4149`).

### 3.3 Move (drag & drop)

1. Drag a card: the source dims; the hovered COLUMN gets the `drag-over` cue; the card
   live-previews its position in the target list (board `board-page.js:783-806`;
   project `pdCompleteDrop`, `project-page.js:5402-5538`).
2. Drop: cross-column → `PATCH {status}`; same-column → position captured; a
   same-column drop next to a different-priority card **adopts that priority** (the
   "urgent zone" rule) → extra `PATCH {priority}`; then `POST …/devtasks/reorder {ids}`
   (the full column order); the board reloads and re-sorts by priority (board
   `board-page.js:807-841`; project `5425-5465` + `5522-5533`). On the project page a
   drop onto a FOLDED column unfolds it first (`5403-5418`) and both boxes repaint
   from truth (`pdRepaintColumns`, `5533`).
3. Failure at any step → toast + full reload/refresh (server truth wins — no torn
   state; `board-page.js:837-840`, `project-page.js:5534-5537`).
4. Touch: touch-drag.js lifts `[draggable]` cards on both board surfaces
   (`board.html:36`, `project.html:37`); the project page adds the S151 pointer path —
   long-press (~260ms) arms the drag, a >12px early move cancels it (`5554-5563`).

### 3.4 Delete / archive

- Delete (board): the **styled confirm dialog** (native `<dialog>` with the task title
  + "This cannot be undone."; `board-page.js:556-594`) → `DELETE /api/devtasks/:id` →
  toast + reload — **hard delete, no undo on this surface** (the shared modal's Delete
  button uses a `window.confirm` variant, `devboard.js:1193-1203`). Project page:
  **optimistic removal + Undo toast** that re-POSTs the full raw title
  (`project-page.js:4042-4077`; the editor's Delete is the same recipe, `4573-4615`).
- "Archive done" (done column's header): confirm with count →
  `POST …/devtasks/archive-done` → toast → **in-place refresh on BOTH surfaces**
  (board `reload()` — `board-page.js:734-750`; project `bodyRefresh()`, no
  `location.reload()` — S209, `project-page.js:5858-5876`). Done tasks move to the
  project archives (restorable from the project page's Archives section).
- "Clear done": explicit double-warning confirm → per-task `DELETE`s → reload —
  **board only** (`board-page.js:752-768`; retired from the project page, S48j —
  `project-page.js:5878-5879`).

### 3.5 Quick actions

- Priority banner click → cycles low→medium→high→urgent (optimistic `PATCH`; failure
  → reload; board `board-page.js:639-652`; project `project-page.js:1860-1885` with
  the in-place `pdSyncBanner`, `1608-1618`). Label chip click → toggles that label's
  filter (board `board-page.js:628-635`; project `project-page.js:1850-1858`).
- ⋯ menu → Edit / Copy / Delete on both surfaces (§3.2). Per-column Quick Copy
  (clipboard `- [URGENT] title #Tags` bullets from SERVER state, `devboard.js:88-96`;
  board `board-page.js:697-714`, project `project-page.js:5843-5856`) and Export
  Markdown (blob download).

## 4. Filtering & search

1. The shared `.db-filter` bar (same classes, same order on both surfaces) appears when
   tasks exist: search input → priority toggles (OR) × label toggles (OR), ANDed;
   "Clear filter" + "{n} of {m} shown". Board: rendered with the board
   (`board-page.js:94-108`, toggles `604-635`); project page: client-built into the
   server's `[data-pd-filter]` mount (`detail-helpers.ts:445`; `pdFilterBuild`,
   `project-page.js:1745-1809`, toggles `1812-1846`).
2. Free-text search is debounced **150ms** on the board (`board-page.js:847-861`) and
   **120ms** on the project page (`project-page.js:1896-1903`; Esc clears it,
   `1904-1914`), matching the RAW markdown title (board `board-page.js:87-89`; project
   reads `data-raw-title`, `1705-1708`). Zero matches → the honest empty state with a
   clear-filters CTA (board `board-page.js:112-117`; project `1735-1743`, `1797-1805`).
3. Filters are per-visit state (reset on project switch — `board-page.js:415` — and
   reload) — never persisted.

## 5. Sprints

1. Entries: the board toolbar "Sprints" → `/sprint.html?project=` (`board-page.js:61`);
   the project head's "Sprints" link (`detail-helpers.ts:439`). Back from the timeline:
   sprint.html's **Board link → `/kanban?project=`** (the canonical entry, both hosts
   serve the route — S209, `sprint-page.js:1466`).
2. **New sprint** — three doorways, one 409 contract: the board task editor's inline
   "New sprint" REUSES the existing draft instead of dying on 409 `draft_exists` (S206;
   `devboard.js:1221-1231`); sprint.html's define popover (`openDefinePop`,
   `sprint-page.js:1114-1182` — name-only + Define = draft; a start date or preset
   (24h…1m) = started, dates parsed at **UTC midnight** `'T00:00:00Z'` so a picked day
   lands exactly on its timeline cell for non-UTC users, S206 presets `1173-1181` /
   commit `1189-1191`; a 409 toasts "already being defined" + scrolls the draft card
   into view, `1215-1218`); the project page's "New sprint" CTA opens
   `#pd-sprintnew-modal` (`detail-helpers.ts:428`, `833+`) — a draft already existing
   prefills the SAME form into edit-the-draft mode (409 → PATCH;
   `project-page.js:1918-1920`, `1996-1997`).
3. Start (closes the previous open sprint at day-before), finish, reopen (latest only),
   extend — all server-validated with 400s carrying codes; fired from the sprint chip
   popover (`sprint-page.js:880-974`) or the draft panel (`533-560`).
4. **DnD onto sprint/draft from the sidebar** (S206): a sidebar task dragged over the
   timeline (sprint strip, draft card, category lane) is accepted — the drop PATCHes
   `{sprint_id}` or `{category_id}` and reloads (`sprint-page.js:1270-1282` dragstart,
   `1308-1323` the accepting dragover, `1350-1371` the assignment drop).
5. Sprint doc editor (project page `#pd-sprintdoc-modal`): full-screen markdown with
   live preview; debounced autosave (`PATCH /api/sprints/:id {description}`,
   `project-page.js:2252`); `?sprint=<id>` deep-links in (`1766-1769`); task-list
   checkboxes toggle in the preview and write back into the markdown.

## 6. Project lifecycle around the board

- Create: projects page FAB / dashboard quick-add / command palette (title + optional
  client id; duplicate titles get a `duplicate-check` warning pre-submit). Stage
  changes: projects stage board drag (PATCH status) — the board itself never changes
  project stage.
- Archive/park: project page → park (archived_state offline; boards remain accessible
  via direct URL — the project is not deleted). Delete: soft (7-day trash, restorable);
  sparks can force-hard-delete. Permissions: single-owner; another account's project id
  → 404 gone state (no data leak).

## 7. The embedded board (project.html) flow

1. **Arriving**: `/project.html?id=<id>` → htmx `GET /api/projects/:id` fills
   `#project-body` with the server-rendered detail fragment (`public/project.html:63`;
   `detail-helpers.ts:86`) containing the board section `#pd-board`.
2. **The frame** (S209): the embedded board wears the SAME mother-container recipe as
   `/kanban` — `section.pd-board.db-frame` with the toolbar as the frame's hairline
   header row (`detail-helpers.ts:420-421`; `public/css/devboard.css:29-46`, `75-83`).
   Embedded context: the card outline + reading-measure margin stay, and the 100dvh
   floor is NOT applied (scoped to `main.board-shell`, the page-owning board —
   `devboard.css:41`).
3. **The head's affordances**: New sprint (→ `#pd-sprintnew-modal`, §5) · Categories
   (the per-project toggle dialog) · **Labels** — S209: the SAME shared
   `HibanaBoard.openLabels` dialog as /kanban's toolbar (`detail-helpers.ts:437`;
   devboard.js now loads on project.html — `public/project.html:78-82`; the
   `[data-pd-labels]` wiring + lazy-inject belt at `project-page.js:3128-3143`; every
   change → `bodyRefresh()`) · Full screen board → `/board.html?project=` (the in-app
   entry context — its Back link returns here) · Sprints (`detail-helpers.ts:438-439`).
4. **Slide-over → Edit**: a card click opens the read-only slide-over; ⋯ → Edit opens
   the split editor (§3.2b) — one hop deeper than /kanban's direct editor, by the
   documented split contract.
5. **+N expand**: the server renders 5 cards per column (`MAX_VISIBLE`,
   `detail-helpers.ts:455`); "+N more" fetches the payload and appends truth-built
   cards (`project-page.js:3253-3304`) — which since S209 carry the pin and sprint
   badges too. **Column collapse** (S175): each header's chevron folds the box,
   persisted per column key in `hibana-pd-cols-collapsed` (`detail-helpers.ts:468`;
   `project-page.js:1327-1367`); a drop onto a folded box unfolds it (`5403-5418`).
6. **Badges**: the pin badge `.pd-task-shots` is server-rendered with the exact pin
   count (`detail-helpers.ts:488`; `pinsByTask` `110-116`) and — S209 — SURVIVES every
   client-side repaint (+N expand, `pdRepaintColumns`): `pdTruthWrap` renders it from
   the payload's screenshots (`project-page.js:3158-3179` + `pdDetailMaps` `3181-3192`,
   callers `3235`, `3292` — it used to vanish). The ◆ sprint badge renders with the
   same markup as /kanban (`detail-helpers.ts:487` + `sprintBadgeHtml` `262-265`;
   `pdTruthWrap` at `3174`; board twin `board-page.js:218`).
7. **Documented deltas vs /kanban** (kept deliberately): reading-measure width + card
   outline (embedded context); the title/content split editor + detail slide-over +
   "+N more" windowing + column collapse are project-page-only; delete is
   optimistic+Undo here vs the board's styled confirm (§3.4); no project switcher /
   counts row / Clear done on this surface.

## 8. Full-screen writing focus mode

1. **The toggle**: the expand icon in the editor's header — the board's shared modal
   (`[data-db-fullscreen]`, `devboard.js:845`, wiring `1027-1035`) and the project
   editor (`#pde-fullscreen`, `project-page.js:4387`, `4499-4501`). One click toggles
   `.db-fullscreen` / `.pde-fullscreen`.
2. **What hides**: the card grows to a 78rem measure filling the viewport; the writing
   area claims the height; every metadata row — status, priority, category+sprint,
   tags, the shots section — hides until focus mode exits (`devboard.css:191-207`;
   the project twin `project-header.css:977-1000`).
3. **The exit-first contract**: Esc, ✕, Cancel and the backdrop exit FULLSCREEN FIRST —
   never the modal — so one keypress too many never discards the task definition
   (`devboard.js:799-804` `exitFullscreenOrClose`, wired to the Esc handler `757-765`,
   backdrop `754-756`, ✕/Cancel `1036`; `project-page.js:4487-4494` `exitOrClose`).
   `closeModal` also strips the class, so a re-open never starts in focus mode
   (`devboard.js:807-811`).
4. **Lightbox precedence still holds** (S208): with a shot lightbox open over the
   editor, the FIRST Esc closes only the lightbox — its document listener is older and
   `stopImmediatePropagation`-shields the modal, whose own `!shotLightbox` guard is
   the belt (`devboard.js:566-577`, `764`).

## 9. Failure & recovery summary

| Failure | User sees | Recovery |
|---|---|---|
| 401 (expired) | login bounce with `next` | sign in → exact board returns |
| 404 project | "doesn't exist or was deleted" | Back-to-projects link |
| 404 task (deleted elsewhere) | editor/refresh shows column without it | n/a (server truth) |
| Network offline | offline banner (shell cached by SW) | reconnect → retry |
| 5xx | toast + retry state | retry button / reload |
| 429 rate limit | toast (uploads, exports) | wait + retry |
| Esc in fullscreen editor | focus mode exits; the modal stays | press Esc again to close it |
| Esc with the lightbox open | ONLY the lightbox closes | the next Esc reaches the editor (or exits fullscreen first) |
| Save conflict (none exist — no optimistic concurrency) | last-writer-wins | n/a (single-user) |

## 10. RTL/FA specifics on these flows

- The rail, panels, popovers, dialogs, the switcher and both editors use logical
  properties; `rtl.css` flips what CSS can't. The switcher anchors direction-aware
  (`positionSwitch`, `board-page.js:334-350`); the shared modal's card and title
  textarea follow the UI locale (`dir`, `devboard.js:837`, `885`).
- Jalali dates + Persian digits render throughout (`faDig`, `devboard.js:112-153`;
  the sprint timeline's Jalali week numbers, `sprint-page.js:129-146`).
- Deep links and the entry URL are direction-neutral (`?project=` ids); the
  markdown-lite vocabulary (`{:left}` etc., ``` fences) renders as LTR islands via
  `.t-code` regardless of UI direction.
