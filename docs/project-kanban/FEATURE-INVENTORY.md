# Hibana Project/Kanban — Feature Inventory

> **What this is:** every user-visible capability and option in the project/Kanban experience,
> traced to its implementation (frontend component/function + backend route + schema effect),
> with a **desktop parity classification** for the future Go port. Verified against
> **v0.4.1.35 / S209** (post Kanban-1:1 parity round; the working tree carries the uncommitted
> S209 changes — sw `hibana-v444`, devboard.js v28 / board-page.js v21 / sprint-page.js v20 /
> project-page.js v76 / chip-render.js v12 / devboard.css v34). Companion: `USER-FLOWS.md`
> (step-by-step), `DATA-MODEL.md`, `API-AND-SYNC-CONTRACT.md`.
>
> Parity legend: **[R]** required for desktop parity · **[O]** optional (nice, deliberate) ·
> **[N/A]** not applicable to a desktop shell · **[?]** undecided — owner input needed.
>
> Surfaces: **/kanban** (canonical entry — one board.html, auth-gated Worker route) ·
> **/board.html?project=** (the SAME file at runtime; only the Back link + rail mode differ —
> §13) · **embedded board** on `/project.html?id=` (server-rendered fragment) ·
> **sprint.html** (shares devboard.js for task editing).

## 1. Entry points & routing

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| Dedicated Kanban entry `/kanban` | URL bar / bookmark | S205: `src/app.ts:355-385` — auth-gated Worker route (`requireAuth(cfg, { loginNext: true })` `app.ts:370-372`, login bounce preserves `?next=/kanban?project=…`), serves board.html via the assets binding, `no-store` `:380`; `/kanban.html` 301s (`:355`); listed in `WORKER_PAGE_ROUTES` (`app.ts:264-266`) | **[R]** |
| Legacy `/board.html?project=<id>` | project page "Full screen board" link | assets binding — the SAME file/contracts as /kanban at runtime; the only deltas are the Back link + rail mode (§13) | **[R]** |
| Deep links `?project&task&add` | command palette / notifications | `board-page.js:6-10` reads at mount — `&task=` opens the editor, `&add=<status>` the composer (`:962-963`); palette task rows deep-link `/board.html?project&task` (`command-palette.js:595`) | **[R]** |
| Default project on bare `/kanban` | S205 | last-used (`hibana-kanban-last`, a 404 falls through) → most-recent accessible (`GET /api/projects?sort=recent`) → empty state; canonicalizes `?project=` via `replaceState` (`board-page.js:925-951`) | **[R]** |
| No-projects empty state + CTA | S205 | `renderNoProjects` (`board-page.js:457-468`) → `/projects.html` | **[R]** |
| Bare `/board.html` redirect | S205 | `location.replace('/kanban')` (`board-page.js:28-29`) — was `/projects.html` | **[R]** |
| Back link "← Back to project" | board toolbar | `/board.html` only — hidden on `/kanban` (S206: no back context on the entry; `board-page.js:30-38`, `board.html:71`); href set post-boot (`board-page.js:953`) | **[O]** entry-contextual (§13) |
| Rail "Kanban" button (desktop chrome) | rail | `public/partials/nav.html:67-70`; rail mode forks by entry: `/board.html` keeps the icons-rail (`RAIL_ICON_PAGES`, `nav.js:383`), `/kanban` gets the edge-auto hover rail (`RAIL_EDGE_PAGES`, `nav.js:388-391`, S206) | **[O]** desktop-specific chrome |
| Mobile More-sheet "Kanban" row | ≤1024px | `mobile-nav.js:33` (SHEET_LINKS) | **[O]** |
| `g k` go-to shortcut | keyboard | `go-to.js:18` (TARGETS `:13-19`) | **[O]** |
| Command palette (Ctrl+K / `/`) | global | `command-palette.js:741-750` — actions, Recent projects (`hibana-recent-projects`), FTS search deep-linking tasks | **[O]** |
| sprint.html Board link | sprint toolbar | S209: targets the CANONICAL `/kanban?project=` (was `/board.html`) — `sprint-page.js:1465-1467` | **[R]** |

## 2. Project selection & switching (S205 switcher)

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| **Project switcher in board toolbar** — title button + chevron | `#db-project-switch` | `board.html:69-87` + `board-page.js:247-431` | **[R]** |
| Searchable list of accessible projects | popover | `GET /api/projects?sort=recent` (`board-page.js:275-302`), 60s cache, client-side title filter (`renderSwitchRows` `:317`) | **[R]** |
| Stage badge per row | popover | `.badge .badge-<status>` reuse; labels via `cmdk.status*` i18n keys | **[O]** |
| Current project marked (aria-current + "Current") | popover | `renderSwitchRows` | **[O]** |
| In-place switch (no page reload) | popover row click / Enter | `switchProject` (`board-page.js:410-431`) — `B().load` + render + spinner, pushState `?project=` (`:420-424`) | **[R]** |
| Per-board filter reset on switch | switching | `filterPrios.clear()` etc. (`:414-415`) | **[O]** |
| URL/back/forward preservation | switching | `history.pushState({ hibanaKanban })` (`:424`); nav.js `popstate` soft-reloads | **[R]** |
| Keyboard: Enter/Space open, ↑/↓ navigate, Enter activate, Esc close + focus return | popover | `openSwitch` `:357-405`, search keydown `:376-385`, list keydown `:387-396`, Esc `:450-455` | **[R]** |
| Outside-click close | popover | `ctx.on('click')` | **[O]** |
| Direction-aware RTL anchoring + viewport clamping | popover | `positionSwitch` `:334` | **[R]** (RTL is a product language) |
| "All projects →" footer link | popover | `/projects.html` | **[O]** |
| Last-used memory | localStorage | `hibana-kanban-last` (`recordLastBoard` `:294-302`) + palette `hibana-recent-projects` | **[R]** |

## 3. Board frame & columns (fixed by design)

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| **Mother container `.db-frame` + hairline toolbar header row** | board pages | S207/S209: ONE `var(--card)` surface wraps toolbar + filter + columns — `board.html:69`, `devboard.css:29-53` (the toolbar's card chrome retires into a hairline header row); true full-bleed via `main.shell.board-shell { padding:0; max-inline-size:none }` (`devboard.css:28`) + the misc.css 'standard' 1366px cap exemption (`misc.css:888-898`); the 100dvh floor is scoped to `main.board-shell .db-frame` (`devboard.css:35-41`; mobile bottom-nav reserve `:57-63`) | **[R]** |
| **Embedded board frame** | project.html | S209: `#pd-board` wears `pd-board db-frame` + the `.db-toolbar` header row (`detail-helpers.ts:412-421`) — the card outline + reading-measure margin stay (`.pd-board.db-frame`, `devboard.css:64-82`); NO full-bleed, NO 100dvh floor (embedded under the project header — §13) | **[O]** embedded-context exception |
| 5 columns: idea / bug / planned / in_progress / done | both surfaces | `devboard.js:74` STATUSES; SQL CHECK `0029` (+0034 bug) | **[R]** — fixed enum, NOT configurable |
| Column counts badge | headers | server `data-pd-count` (`detail-helpers.ts:469`) / client `.detail-tab-count` | **[R]** |
| Column collapse/expand (embedded only) | chevron | `project-page.js:1326-1387` (localStorage `hibana-pd-cols-collapsed`, key `:1341`; global-by-status); folded box still a drop target | **[O]** |
| `+N more` list windowing (embedded only: max 5 cards) | column | server `detail-helpers.ts:455-456, 492` + client expand `project-page.js:3253-3299` (`dataset.expanded`) | **[O]** (the fullscreen board owns the viewport and shows all) |
| Per-column actions: Archive done / Clear done / Quick Copy / Export MD | column headers | board: `board-page.js:169-186` (archive `:178`, clear `:179`, copy `:186`) + handlers `:705-768`; embedded twin `detail-helpers.ts:470-473` + `project-page.js:5857-5877` (NO Clear done on this surface — S48j) — copy/export read SERVER state, not DOM | **[R]** |
| Column reorder / rename / create / delete | — | **Does not exist** (fixed schema) | **[N/A]** — do not invent |

## 4. Cards (dev tasks)

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| Create card (per-column "+ Add") | composer modal | embedded: server-rendered dialog `detail-helpers.ts:702-830` (Title input + contenteditable content → ONE `title` field `title\ncontent`, staged-shot upload); board/sprint: shared `HibanaBoard.openEditor(null,{defaults})` `devboard.js:769-791` — a single raw-textarea (`:885`) | **[R]** |
| Composer/editor fields: status seg, priority seg, category select (+inline quick-create, 16 curated swatches), sprint select (+inline "New sprint"), tags, Upload File | shared modal | `devboard.js:886-935` — S208 tags-on-create (`:913-918`) + the Upload File button/grid in BOTH modes (`:928-935`) | **[R]** |
| **FULL formatting toolbar (10 ops)** — bold/underline/strikethrough · bullet/ordered · align-left/center/right/justify · code block | both editors | S209: shared modal `devboard.js:862-876` + wiring `:966-1026` — writes RAW markdown into the textarea (`**bold**`, `__underline__`, `~~strike~~`, `- `/`1. ` prefixes, `{:align}` markers, ` ``` ` fences; line-spanning ops `:984-1006`, inline wraps `:1008-1024`); project twin `.pd-tb` `project-page.js:4397-4415` (WYSIWYG contenteditable). Both editors now emit the IDENTICAL markdown-lite vocabulary | **[R]** |
| **Fullscreen writing toggle** | both editors | S209: `[data-db-fullscreen]` toggles `.db-fullscreen` on `.db-modal-card` (`devboard.js:845, 1029-1035`; CSS `devboard.css:191-207` — grows the writing area, hides metadata rows); Esc/✕/Cancel/backdrop exit fullscreen FIRST, never the modal (`exitFullscreenOrClose` `devboard.js:793-804`, keydown `:757-765`, close family `:1036`); project twin `#pde-fullscreen` `project-page.js:4387` + `exitOrClose` `:4487-4494` | **[R]** |
| View card | click | embedded: detail slide-over (S149, read-only) `openPdTaskDetail` `project-page.js:4209`; board: editor modal directly (`board-page.js:695` — the exclusion family keeps badge/menu/chips/prio/read-more clicks) | **[R]** — deliberate delta (§13) |
| Edit card | ⋯ menu → Edit | board: shared modal; embedded: `#pd-task-edit-modal` WYSIWYG with title/content split (S48g `project-page.js:4422-4423`) — capability parity via the toolbar (§13) | **[R]** |
| Delete card | ⋯ menu → Delete | board: STYLED confirm dialog → `DELETE /api/devtasks/:id` → toast + reload (`showDeleteConfirm` `board-page.js:556-594`; the modal's own Delete button uses native confirm, `devboard.js:1196`); embedded: optimistic removal + 6s **Undo toast** re-POSTing the raw title (`pdDeleteTaskFlow` `project-page.js:4042-4077`) | **[R]** — the model difference is deliberate (§13) |
| Move card (cross-column) | drag-drop | DnD → `PATCH {status}` + reorder POST; same-column drop **adopts neighbor priority** (the "urgent zone" rule, `board-page.js:814-835`); embedded twin `pdCompleteDrop` `project-page.js:5402-5483` | **[R]** — the zone rule is a product behavior |
| Reorder within column | drag-drop | live insert preview; `POST …/devtasks/reorder` (`board-page.js:835`) — but columns **auto-sort by priority** after render (`pdSortWrap` `project-page.js:2541`) | **[R]** |
| Priority banner = cycle affordance | card top strip | click cycles low→medium→high→urgent, optimistic + PATCH (`board-page.js:636-659`; `project-page.js:1860-1885`) | **[R]** |
| Labels (tags) on cards | chips | chip click = **toggles that label's filter** (GitHub behavior); Label Manager (the shared dialog): rename (collision = merge), recolor (8-swatch), merge-into, delete-unused-only, live usage counts (`devboard.js:1264-1416`, `openLabels` `:1402`) — opened from /kanban's toolbar (`board.html:85`) AND the embedded board's head (S209: `detail-helpers.ts:433-437` → `project-page.js:3120-3144` via `window.HibanaBoard.openLabels`; devboard.js loads on project.html, `project.html:80`) | **[R]** |
| Category chip | above title | single-select from user-scoped library; inline quick-create; 16 curated fill+ink pairs (S152) | **[R]** |
| Sprint badge `◆ name` | card chips row | ALL surfaces (S209): board `board-page.js:218`; embedded server `sprintBadgeHtml` `detail-helpers.ts:262-264` + `:487`; embedded repaints `pdTruthWrap` `project-page.js:3174`; the shared row builder `tagChipsRow(list, extra)` `chip-render.js:164-171` | **[R]** |
| Pin badge (pinned pictures count) | card meta row | ALL surfaces, and it now SURVIVES client repaints (S209): payload `shot_count` (`devboard.ts:144-185` — COALESCE COUNT `:153`, pre-0054 fallback `:159-161`, ETag `:185`); board render `board-page.js:226-233` → `openTaskShots` pinned-pictures dialog (`:688`, `devboard.js:690`); embedded server `detail-helpers.ts:110-115, 488` + client truth builder `pdTruthWrap` `project-page.js:3170-3173` (pins counted from the payload's screenshots — the badge used to VANISH on the +N expand / pdRepaintColumns paths) | **[R]** |
| Card title rendering | markdown-lite | chip-render.js (client `:32-130`) + detail-helpers.ts (server twin `:303-359` — byte-parity pinned by tests): fenced ``` code (LTR islands), **bold**, __underline__, ~~strike~~, bullets, ordered lists, `{:align}` — first line = title, rest = preview; 150-char clamp + read-more; `data-raw-title` round-trip | **[R]** — the renderer is load-bearing |
| AI magic wand on titles | hover wand | Polish/Translate via `POST /api/ai/text` (Workers AI), save via PATCH (`magic-wand.js`; the custom-prompt textarea runs on Ctrl/Cmd+Enter `:308-313`) | **[?]** Workers-only dependency |
| Attachments (screenshots/files) | editor + media tab | S208 pipeline on every board surface: 11 mime types ≤5MB (S86 accept list `devboard.js:929`), ≤1600px WebP prepare, NEW tasks stage then pin via `PATCH {taskId}` on save (`devboard.js:1232-1249`), ESTABLISHED tasks pin live (`:1116-1180`), Cancel/✕/Esc/backdrop deletes staged shots (`:816-827`), inline pinned grid + zoom/note/delete (`renderPinnedGrid` `:673`, `openTaskShots` `:690`), lightbox, video tile zoom on dblclick/Enter (`:578-599`); the project page's own stack (`uploadShotXHR` etc. `project-page.js:157-318`, dialog `:836`) | **[R]** |
| **Absent by design:** due dates on cards, assignees, checklists-as-data, task comments, dependencies, subtasks, recurring rules, custom fields, card duplicate | — | verified absent (see DATA-MODEL §2.2) | **[N/A]** — document as absent, do not invent |

## 5. Filtering / search / sort on the board

| Feature | Implementation | Parity |
|---|---|---|
| Filter bar — the SHARED `.db-filter` bar on BOTH surfaces: priority toggles (OR) × label toggles (OR), ANDed across groups | board `board-page.js:94-116` (state `:46-49`) + embedded twin `pdFilterBuild/pdFilterApply/pdFilterMatches` `project-page.js:1699-1809` — same classes, same order (search → Priority → Labels); a deliberate twin (§11) | **[R]** |
| Debounced free-text search (150ms board / 120ms embedded) | matches the raw title, lowercased — `board-page.js:843-861` / `project-page.js:1893-1903`; Esc clears the embedded search input (`:1904-1910`) | **[R]** |
| Clear + "{n} of {m} shown" + zero-match empty state (S78) | honest miss state — `board-page.js:107-116, 618` | **[R]** |
| Label-chip click toggles filter | cards + filter bar stay in sync | **[R]** |
| Sort: **none user-facing** — priority-rank auto-sort is the contract | server `ORDER BY` (PRIO_ORDER_SQL) + client `pdSortWrap` | **[R]** |
| Progress line "{n} of {m} done" | `board-page.js:63` (+ the prio banner's cycle-hint tooltip `:206-208`) | **[O]** |
| Saved views / per-board view persistence | **absent** (filter state is per-visit; the projects PAGE has saved filters — different surface) | **[N/A]** |

## 6. Sprints (board-adjacent)

Sprint timeline page `/sprint.html?project=` — create-draft flow (409 draft_exists → edit mode,
and the shared editor reuses the existing draft instead of failing the save,
`devboard.js:1221-1231`), start/finish/reopen with server-enforced invariants (one open sprint,
day-granularity, non-overlap, latest-only reopen), full-screen **sprint doc editor** with live
markdown preview (headings, tables, click-to-toggle task lists, private `==anchor== %%note%%`
comments, images), debounced autosave (`project-page.js:1921-2540`, retry timer `:2246`).
Board head "Sprints" link + count badge (`board.html:83`; embedded head `detail-helpers.ts:439`).

sprint.html facts (S206 fixes, all verified): start/end parse at **UTC midnight** so the timeline
axis and the list agree (`sprint-page.js:1168-1189`); the all-sprints list renders **UTC** dates
(`fmtDate` `:641-648`); the **0-items phantom is fixed** — `renderSprintsList` (`:623-666`) counts
the TASK POOL (`itemCount = S.tasks.filter(t => t.sprint_id === s.id)` `:655`), not a sprint-row
`items` field the payload never carried; **DnD from the sidebar onto sprint strips / the draft
card** works (dragover fix `:1308-1323`, drop assignment `:1335-1399`); the **lane z-index fix** —
lane z-indexes retired so task dots/chips (z-5) stack above the z-4 boundary rails
(`devboard.css:458-474`). Task editing on sprint.html uses the SHARED editor in edit mode
(`openEditor` `sprint-page.js:1064` — the full S208 payload); its quick-add goes straight to
`createTask` (`:1097`), so the new-task editor mode is unreachable there (§11).

Parity: **[R]** core (CRUD + assignment); **[O]** the timeline visualization; **[?]** doc editor
richness.

## 7. Drag & drop (mouse + touch)

- Mouse HTML5 DnD, delegated on both surfaces (`board-page.js:771-841`; `project-page.js:5357-5483`
  via `pdCompleteDrop`); `.drag-over` cue; live in-column reorder preview; failure → toast + reload.
- Project page: dedicated long-press touch drag for `#pd-board` (S151): ~260ms arm, >12px cancel,
  `navigator.vibrate(12)` (`project-page.js:5596`), post-drag click suppression, Android
  contextmenu suppression (`:5630`) — `project-page.js:5558-5630`.
- Generic `touch-drag.js`: synthesizes dragstart/dragover/drop with a real DataTransfer for
  pointer events on `[draggable=true]` (250ms arm).
- Parity: **[R]** semantics; touch synthesis details are browser-specific **[O]**.

## 8. States, errors, recovery

| State | Behavior | Parity |
|---|---|---|
| Loading | `#db-loading` spinner; the S205 switch shows a spinner during the in-place switch (`board-page.js:425-431`) | **[R]** |
| Project gone (404) | "This project doesn't exist or was deleted" + Back-to-projects (`gone()`, `board-page.js:913-921`; both surfaces) | **[R]** |
| Load failure | retry button (`fail()` `board-page.js:906-912`) | **[R]** |
| Save failure | toast + full reload restore (server truth) — optimistic UI only for priority/DnD preview | **[R]** |
| 401 expired | htmx global handler + boot guard + SW navigate → `/login.html?next=<path+query>`; S205 `/kanban` does it server-side (`app.ts:370-372`) | **[R]** |
| Banned | 403 + HX-Redirect with ban notice | **[N/A]** (single-user desktop) |
| Empty board | zero-task columns render with Add buttons | **[R]** |
| Empty projects (S205) | no-projects empty state + CTA | **[R]** |
| Destructive confirms | Delete card: styled dialog on the board (`board-page.js:556-594`; native confirm inside the shared modal, `devboard.js:1196`); Clear done: confirm + "use Archive" warning (`board-page.js:752-768`); Archive done: native confirm with count on BOTH surfaces (`board-page.js:740`, `project-page.js:5864`) | **[R]** |
| Undo | delete-on-project-page toast undo (6s, re-POSTs the raw title `project-page.js:4060-4069`); archive → restore flow | **[O]** |

## 9. Preferences & client-side state (localStorage — not synced)

`hibana-kanban-last` (S205 last-used board) · `hibana-recent-projects` (palette Recent, ≤10) ·
`hibana-pd-cols-collapsed` · `hibana-projects-view` / `-sort` / `-saved-filters` (projects page) ·
`hibana-resume` (dashboard "Continue from where you left off", interaction-based per S105) ·
`hibana-lang` · `hibana-theme` · `hibana-rail-panel` / `-fold-v1` · `hibana-ov-tasks` ·
sessionStorage: `hibana-qa-draft` etc. Parity: **[O]** — desktop can map to native settings;
the last-used board is the one worth keeping.

## 10. i18n / RTL / a11y on the board

- Two languages only: `en` + `fa` (Jalali calendar, Persian digits ۰-۹, auto-digit conversion).
  Law: JS-built markup calls `t()` at render time (i18n.js never re-scans). S205 added 10 keys;
  S208 added 2 (`db.taskShotsHint` / `db.taskShotsBadge`, `i18n-en.js:758-759`); **S209 added
  ZERO** — the toolbar/fullscreen reuses the existing `pd.fmt*` / `pde.fullscreen` family.
  Parity **1584/1584** (`scripts/check-i18n-parity.mjs`).
- The EMBEDDED board's strings are baked SERVER-side via `trL(lang, en, fa)` off the user's
  `language_pref` (`detail-helpers.ts` — column titles, CTAs, badges, meta) — a different
  mechanism from the board pages' client `t()` (board.html carries `data-i18n`), behavior
  equivalent: a locale switch PATCHes `language_pref` then re-fetches the page in place
  (`hib-init.js:495-515` → nav reload), so the fragment re-renders in the new language.
- RTL: logical CSS properties + `rtl.css` overrides; the switcher is direction-aware; the
  editor's textarea dir follows the UI locale (`devboard.js:837, 885`).
- Keyboard: see §12. Touch floors: 44px minimum on interactive targets (S197 e2e pins).
- a11y gates: axe audit fns in e2e (`e2e/fixtures/audit-fn.js`), accent-ink contrast doctrine
  (S200/UX-3: `--accent` 3.10:1 for non-text; `--accent-ink` 5.74:1 for text — the S205
  switcher's "All projects" link uses the ink per the doctrine).

## 11. Known defects / gaps (honest list)

1. **Touch drag exists twice** (dedicated pd-board path `project-page.js:5558-5630` + generic
   touch-drag.js, both targeting `[draggable=true]`) — documented duplication.
2. **The board filter bar is implemented twice** (board-page.js `:94-116` / project-page.js
   `:1699-1809`) — deliberate twin (server-fragment page vs client page), kept in sync by tests.
3. **Offline**: board data is not cached (SW caches the shell only; `/api/*` is always network) —
   offline board = the shell + "You're offline" banner.
4. **No automated test for the mobile More-sheet Kanban row** (manual only — see TEST-MATRIX).
5. **sprint.html entry ergonomics lag /kanban**: no project switcher, no default-project
   resolution (`location.replace('/projects.html')` `sprint-page.js:16`), no `?task`/`?add` deep
   links, static tab title (`:1468`), capped width under the 'standard' page-width (the
   `board-shell` exemption `misc.css:898` doesn't cover `sp-shell`), and the quick-add bypasses
   the editor (`:1097` — no new-task mode / staged shots there).
6. **Two delete-confirms on the board itself**: the ⋯-menu path uses the styled dialog
   (`board-page.js:556-594`) while the shared editor's own Delete button uses native
   `confirm()` (`devboard.js:1196`) — minor inconsistency.

Fixed or reclassified in S209 (removed from this list): the pin badge vanishing on client
repaints (FIXED — `pdTruthWrap` renders it, `project-page.js:3170-3173`); archive-done doing a
`location.reload()` on the embedded board (now in-place `bodyRefresh`, `:5870-5873`); the
archive-done confirm mismatch (now the same native confirm on both surfaces); the delete-undo
difference between surfaces (now a DOCUMENTED deliberate delta — §13, not a defect).

## 12. Keyboard shortcuts (verified against the tree)

| Shortcut | Surface | Behavior | Ref |
|---|---|---|---|
| Enter / Space | board cards | opens the editor (the card itself is focused; `role="button"` + `tabindex="0"`; inner buttons keep their own keys) | `board-page.js:863-873` |
| Enter / Space | embedded cards | opens the S149 detail slide-over (the same recipe) | `project-page.js:2867-2876` |
| Esc | card ⋯ menus | closes every open board card menu | `board-page.js:551` |
| Esc | label manager | closes the shared dialog | `devboard.js:1412` |
| Esc | task editor (shared modal) | exits FULLSCREEN first, never the modal (and never while a lightbox is open) | `devboard.js:757-765` + `exitFullscreenOrClose` `:793-804` |
| Esc | project-page editor | the same exit-or-close contract | `project-page.js:4487-4494` |
| Esc | project switcher | closes + returns focus to the switcher button | `board-page.js:450-455` |
| Esc | lightbox (over the editor) | closes ONLY the lightbox — its older document listener `stopImmediatePropagation`-shields the modal under it | `devboard.js:566-577` |
| Esc | embedded search input | clears the query (input-level; stops bubbling into dialog-close handlers) | `project-page.js:1904-1910` |
| Esc | go-to armed state | disarms the `g…` hint | `go-to.js:74` |
| Esc | sprint pointer drag | cancels the active drag | `sprint-page.js:867` |
| `f` | **projects PAGE only** | focuses the projects search box — there is NO single-key search focus on any board surface (honest gap) | `projects-page.js:118` |
| `g` + letter | global | vim-style go-to (1s window, hint pill, blocked in inputs/dialogs/modifiers); `g k` → `/kanban` | `go-to.js:13-19, 55-78` |
| Ctrl+K / Cmd+K | global | opens the command palette | `command-palette.js:741-746` |
| `/` | global | opens the palette (when not typing) | `command-palette.js:748-750` |
| `?` | global | opens the shortcuts overlay | `command-palette.js:753-754` |
| Enter | board editor title | saves; Shift+Enter = a real newline | `devboard.js:1258-1261` |
| Enter | composer title/content inputs | submits the form (the contenteditable `#pde-input` is excluded; code-block gestures win first) | `project-page.js:3905-3914` + `pdCodeKeydown` `:3816` |
| Enter | editor tag inputs | stages (new task) / adds (existing task) the tag | `devboard.js:1067-1082, 1093-1115` |
| Ctrl/Cmd+Enter | magic wand custom prompt | runs the instruction | `magic-wand.js:308-313` |
| Enter / dblclick | video shot tile | zooms into the lightbox (S118/S119; Space stays the video's play/pause) | `devboard.js:578-599` |
| Enter / ↑ / ↓ / Esc | switcher popover | open / navigate / activate / close + focus return | `board-page.js:376-396, 450-455` |
| Enter | sprint chip / category popovers | saves the inline rename / edit | `sprint-page.js:866-875` |
| ← / → | lightbox | steps prev/next, RTL-aware | `devboard.js:574-576` |

Parity: **[R]** for the card-open / Esc-family / editor-Enter contracts (they carry the modal
precedence rules); **[O]** for `g`+letter, the palette and `?` (desktop chrome can supersede).

## 13. 1:1 parity decisions (S209)

Owner ask (2026-10-20): *"the kanban in the hibana is 1:1 the same as the kanban at
projects.hibana.ir/kanban."* What the round CLOSED (all verified in the working tree):

| # | Closed gap | Pinned where |
|---|---|---|
| 1 | The embedded board wears the mother container — `.db-frame` + the `.db-toolbar` hairline header row (card outline + reading measure stay; the 100dvh floor stays scoped to the page-owning board) | `detail-helpers.ts:412-421`; `devboard.css:35-41, 64-82`; s209 e2e `:252`, unit `:56` |
| 2 | The LABEL MANAGER joins the embedded board's head — the same shared devboard.js dialog as /kanban's toolbar; devboard.js now loads on project.html | `detail-helpers.ts:433-437`; `project-page.js:3120-3144`; `project.html:80` (v28) |
| 3 | The shared task editor modal gains the FULL 10-op formatting toolbar (raw markdown) + the FULLSCREEN WRITING toggle (Esc/✕/Cancel/backdrop exit focus mode FIRST) | `devboard.js:845, 862-876, 966-1036`; `devboard.css:191-207`; s209 e2e `:169, :212` |
| 4 | The ◆ sprint badge renders on the embedded board's cards (server fragment + client truth builder + the shared chip-row builder) | `detail-helpers.ts:262-264, 487`; `project-page.js:3174`; `chip-render.js:164-171`; unit `:88`; s209 e2e `:297` |
| 5 | The pin badge SURVIVES client-side repaints on the embedded board (+N expand / pdRepaintColumns) | `project-page.js:3170-3173, 3178-3189, 3218-3235`; unit `:115`; s209 e2e `:297` |
| 6 | Archive-done on the embedded board refreshes IN PLACE (the board's POST → toast → reload contract, via `bodyRefresh`) | `project-page.js:5870-5873`; s209 e2e `:348` |
| 7 | sprint.html's Board link targets the canonical `/kanban?project=` | `sprint-page.js:1465-1467`; s209 e2e `:371` |
| 8 | `chip-render.js tagChipsRow(list, extra)` — the optional trailing badge (the shared row builder) | `chip-render.js:164-171` |

DELIBERATE exceptions — kept as documented entry-contextual deltas; do NOT "fix" them in the Go
port without owner input:

| Delta | Rationale | Pinned where |
|---|---|---|
| `/board.html?project=` keeps the Back link + classic icons-rail (`RAIL_ICON_PAGES`) vs /kanban's edge-hover rail (`RAIL_EDGE_PAGES`) + no Back link | entry context — /board.html is reached FROM a project; /kanban is a destination | `board-page.js:28-38`; `nav.js:383, 388-391`; s209 e2e `:115` |
| The embedded board keeps the reading-measure width + card outline (no full-bleed, no 100dvh floor) | it sits under the project header; the floor only means "a short board fills the first screen" when the board IS the page | `devboard.css:35-41, 64-82`; s209 e2e `:252` |
| The title/content SPLIT + contenteditable WYSIWYG editor stays project-page-only; the board's single raw-textarea model (its Session-22/23 contract) reaches CAPABILITY parity via the full toolbar — both editors produce the identical markdown-lite vocabulary | two editing models, one output language; banked follow-up: extract the editor stack into the shared lib | `project-page.js:4376-4494`; `devboard.js:885`; s209 e2e `:169` |
| The read-only detail slide-over (S149) stays project-page-only; the board opens the editor directly | different reading contexts (inline skim vs full-screen work) | `project-page.js:4209`; `board-page.js:695` |
| "+N more" windowing (MAX_VISIBLE=5) + column collapse stay embedded-only | the fullscreen board owns the viewport and shows all | `detail-helpers.ts:455-456, 468`; `project-page.js:1326-1387, 3253-3299` |
| Delete models differ by design: board = styled confirm dialog then delete; project page = optimistic removal + 6s Undo toast | two reversibility models, both intentional | `board-page.js:556-594`; `project-page.js:4042-4077` |
| The embedded board's server strings are baked via `trL()` server-side i18n (EN+FA render correctly; a locale switch re-fetches the fragment) vs the board pages' client-side `t()` | mechanism differs, behavior equivalent | `detail-helpers.ts`; `hib-init.js:495-515` |

Test pinning for the whole parity lens: `e2e/s205-kanban-entry.spec.ts` (entry, switcher,
default resolution) · `e2e/s206-kanban-edge.spec.ts` (edge rail, Back-link contract, the sprint
fixes) · `e2e/s207-kanban-frame.spec.ts` (mother container + full-width geometry) ·
`e2e/s208-kanban-shots.spec.ts` + `src/tests/devboard-shots.test.ts` (upload/stage/pin,
tags-on-create, lightbox-Esc precedence) · `e2e/s209-kanban-parity.spec.ts` (tests at `:115,
:169, :212, :252, :297, :348, :371`) + `src/tests/kanban-parity.test.ts` (tests at `:56, :88,
:115`).
