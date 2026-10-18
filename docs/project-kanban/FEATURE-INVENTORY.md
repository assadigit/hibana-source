# Hibana Project/Kanban — Feature Inventory

> **What this is:** every user-visible capability and option in the project/Kanban experience,
> traced to its implementation (frontend component/function + backend route + schema effect),
> with a **desktop parity classification** for the future Go port. Verified against
> **v0.4.1.28 / S205** (post Kanban-entry round). Companion: `USER-FLOWS.md` (step-by-step),
> `DATA-MODEL.md`, `API-AND-SYNC-CONTRACT.md`.
>
> Parity legend: **[R]** required for desktop parity · **[O]** optional (nice, deliberate) ·
> **[N/A]** not applicable to a desktop shell · **[?]** undecided — owner input needed.

## 1. Entry points & routing

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| Dedicated Kanban entry `/kanban` | URL bar / bookmark | S205: `src/app.ts:356-385` — auth-gated Worker route serving `board.html`, login bounce preserves `?next=`, `no-store`; `/kanban.html` 301s | **[R]** |
| Legacy `/board.html?project=<id>` | everywhere | assets binding (unchanged) | **[R]** |
| Deep links `?project&task&add` | command palette / notifications | `board-page.js` consumes at boot (`:909-910`) — `&task=` opens the editor, `&add=<status>` opens the composer | **[R]** |
| Default project on bare `/kanban` | S205 | last-used (`hibana-kanban-last`) → most-recent accessible (`GET /api/projects?sort=recent`) → empty state; canonicalizes `?project=` via `replaceState` (`board-page.js:872-899`) | **[R]** |
| No-projects empty state + CTA | S205 | `renderNoProjects` (`board-page.js:430-441`) → `/projects.html` | **[R]** |
| Bare `/board.html` redirect | S205 | `location.replace('/kanban')` (`board-page.js:29`) — was `/projects.html` | **[R]** |
| Rail "Kanban" button (desktop chrome) | rail | `public/partials/nav.html` (S205 block, pure navigation); `RAIL_ICON_PAGES` collapses rail to icons on `/kanban` (`nav.js:383`) | **[O]** desktop-specific chrome |
| Mobile More-sheet "Kanban" row | ≤1024px | `mobile-nav.js` SHEET_LINKS (S205) | **[O]** |
| `g k` go-to shortcut | keyboard | `go-to.js` TARGETS (S205) | **[O]** |
| Command palette (Ctrl+K / `/`) | global | `command-palette.js` — actions, Recent projects (`hibana-recent-projects`), FTS search deep-linking tasks → `/board.html?project&task` | **[O]** |

## 2. Project selection & switching (S205 switcher)

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| **Project switcher in board toolbar** — title button + chevron | `#db-project-switch` | `board.html:65-73` + `board-page.js:247-425` | **[R]** |
| Searchable list of accessible projects | popover | `GET /api/projects?sort=recent`, 60s cache, client-side title filter | **[R]** |
| Stage badge per row | popover | `.badge .badge-<status>` reuse; labels via `cmdk.status*` i18n keys | **[O]** |
| Current project marked (aria-current + "Current") | popover | `renderSwitchRows` | **[O]** |
| In-place switch (no page reload) | popover row click / Enter | `switchProject` → `B().load` + `render` + pushState `?project=` | **[R]** |
| Per-board filter reset on switch | switching | `filterPrios.clear()` etc. | **[O]** |
| URL/back/forward preservation | switching | `history.pushState`; nav.js `popstate` soft-reloads | **[R]** |
| Keyboard: Enter/Space open, ↑/↓ navigate, Enter activate, Esc close + focus return | popover | `openSwitch`/keydown handlers | **[R]** |
| Outside-click close | popover | `ctx.on('click')` | **[O]** |
| Direction-aware RTL anchoring + viewport clamping | popover | `positionSwitch` | **[R]** (RTL is a product language) |
| "All projects →" footer link | popover | `/projects.html` | **[O]** |
| Last-used memory | localStorage | `hibana-kanban-last` + palette `hibana-recent-projects` (`recordLastBoard`) | **[R]** |

## 3. Board columns (fixed by design)

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| 5 columns: idea / bug / planned / in_progress / done | both surfaces | `devboard.js:29` STATUSES; SQL CHECK `0029` (+0034 bug) | **[R]** — fixed enum, NOT configurable |
| Column counts badge | headers | server `data-pd-count` / client `.detail-tab-count` | **[R]** |
| Column collapse/expand (project page) | chevron | `project-page.js:1326-1387` (localStorage `hibana-pd-cols-collapsed`, global-by-status); folded box still a drop target | **[O]** |
| `+N more` list windowing (project page: max 5 cards) | column | server `detail-helpers.ts:452-470` + client expand `project-page.js:3196-3249` | **[O]** (board.html shows all) |
| Per-column actions: Archive done / Clear done / Quick Copy / Export MD | column headers | `board-page.js:151-161, 442-509`; project-page twin `:5732-5801` — copy/export read SERVER state, not DOM | **[R]** |
| Column reorder / rename / create / delete | — | **Does not exist** (fixed schema) | **[N/A]** — do not invent |

## 4. Cards (dev tasks)

| Feature | Where | Implementation | Parity |
|---|---|---|---|
| Create card (per-column "+ Add") | composer modal | project page: server-rendered dialog `detail-helpers.ts:678-769` (Title + contenteditable content → ONE `title` field `title\ncontent`); board: `HibanaBoard.openEditor(null,{defaults})` `devboard.js:199-295` | **[R]** |
| Composer fields: status ("Lands in"), priority, labels (comma), sprint select, category picker, staged file uploads | composer | same modals | **[R]** |
| View card | click | project page: detail slide-over (S149, read-only) `project-page.js:4123-4311`; board: editor modal | **[R]** |
| Edit card | ⋯ menu → Edit | `#pd-task-edit-modal` with formatting toolbar (Bold/Underline/Strike/Bullet/Ordered/Align×4/Code), fullscreen writing toggle, screenshot upload + pinned grid | **[R]** |
| Delete card | ⋯ menu → Delete | board: native dialog confirm → `DELETE /api/devtasks/:id` → reload (`board-page.js:303-344`); project page: optimistic + **Undo toast** re-POSTing the raw title (`:3987-4022`) | **[R]** |
| Move card (cross-column) | drag-drop | DnD → `PATCH {status}` + reorder POST; same-column drop **adopts neighbor priority** (the "urgent zone" rule, `board-page.js:555-574`) | **[R]** — the zone rule is a product behavior |
| Reorder within column | drag-drop | live preview insert; `POST …/devtasks/reorder {ids}` — but columns **auto-sort by priority** after render (`pdSortWrap`) | **[R]** |
| Priority banner = cycle affordance | card top strip | click cycles low→medium→high→urgent, optimistic + PATCH, failure → toast + reload (`board-page.js:386-403`) | **[R]** |
| Labels (tags) on cards | chips | click chip = **toggles that label's filter** (GitHub behavior); Label Manager: rename (collision = merge), recolor (8-swatch), merge-into, delete-unused-only, live usage counts (`devboard.js:450-600`) | **[R]** |
| Category chip | above title | single-select from user-scoped library; inline quick-create; 16 curated fill+ink pairs (S152) | **[R]** |
| Sprint badge | `◆ name` | assignment in composer/editor + inline "New sprint" | **[R]** |
| Card title rendering | markdown-lite | chip-render.js (client) + detail-helpers.ts (server twin — byte-parity pinned by tests): fenced ``` code (LTR islands), **bold**, __underline__, ~~strike~~, bullets, ordered lists, `{:align}` — first line = title, rest = preview; 150-char clamp + read-more; `data-raw-title` round-trip | **[R]** — the renderer is load-bearing |
| AI magic wand on titles | hover wand | Polish/Translate via `POST /api/ai/text` (Workers AI), save via PATCH (`magic-wand.js`) | **[?]** Workers-only dependency |
| Attachments (screenshots/files) | editor + media tab | 11 mime types, ≤5MB, thumb variant, pin-to-task (`PATCH taskId`), lightbox, caption, resolved flag, "stick to a progress-box item" (S39) | **[R]** |
| **Absent by design:** due dates on cards, assignees, checklists-as-data, task comments, dependencies, subtasks, recurring rules, custom fields, card duplicate | — | verified absent (see DATA-MODEL §2.2) | **[N/A]** — document as absent, do not invent |

## 5. Filtering / search / sort on the board

| Feature | Implementation | Parity |
|---|---|---|
| Filter bar: priority toggles (OR) × label toggles (OR), ANDed across groups | `board-page.js:41-91` + project-page twin — same classes/order | **[R]** |
| Debounced free-text search (150/120ms) | matches raw title, lowercased | **[R]** |
| Clear + "{n} of {m} shown" + zero-match empty state (S78) | honest miss state | **[R]** |
| Label-chip click toggles filter | cards + filter bar stay in sync | **[R]** |
| Sort: **none user-facing** — priority-rank auto-sort is the contract | server `ORDER BY` + client `pdSortWrap` | **[R]** |
| Progress line "{n} of {m} done" + per-tier header tooltip | `board-page.js:36-38` | **[O]** |
| Saved views / per-board view persistence | **absent** (filter state is per-visit; projects PAGE has saved filters — different surface) | **[N/A]** |

## 6. Sprints (board-adjacent)

Sprint timeline page `/sprint.html?project=`, create-draft flow (409 draft_exists → edit mode),
start/finish/reopen with server-enforced invariants (one open sprint, day-granularity, non-overlap,
latest-only reopen), full-screen **sprint doc editor** with live markdown preview (headings, tables,
click-to-toggle task lists, private `==anchor== %%note%%` comments, images), debounced autosave
(`project-page.js:1916-2537`). Board head "Sprints" link + count badge. Parity: **[R]** core
(CRUD + assignment); **[O]** the timeline visualization; **[?]** doc editor richness.

## 7. Drag & drop (mouse + touch)

- Mouse HTML5 DnD, delegated on both surfaces (`board-page.js:512-583`); `.pd-col.drag-over` cue;
  live in-column reorder preview; failure → toast + `reload()`.
- Project page: dedicated long-press touch drag for `#pd-board` (S151): ~260ms arm, >12px cancel,
  `navigator.vibrate(12)`, post-drag click suppression 450ms, Android contextmenu suppression
  (`project-page.js:5499-5579`).
- Generic `touch-drag.js`: synthesizes dragstart/dragover/drop with a real DataTransfer for
  pointer events on `[draggable=true]` (250ms arm).
- Parity: **[R]** semantics; touch synthesis details are browser-specific **[O]**.

## 8. States, errors, recovery

| State | Behavior | Parity |
|---|---|---|
| Loading | `#db-loading` spinner; S205 switch shows spinner during in-place switch | **[R]** |
| Project gone (404) | "This project doesn't exist or was deleted" + Back-to-projects (`gone()`, both surfaces) | **[R]** |
| Load failure | retry button (`fail()`) | **[R]** |
| Save failure | toast + full reload restore (server truth) — optimistic UI only for priority/DnD preview | **[R]** |
| 401 expired | htmx global handler + boot guard + SW navigate → `/login.html?next=<path+query>`; S205 `/kanban` does it server-side | **[R]** |
| Banned | 403 + HX-Redirect with ban notice | **[N/A]** (single-user desktop) |
| Empty board | zero-task columns render with Add buttons | **[R]** |
| Empty projects (S205) | no-projects empty state + CTA | **[R]** |
| Destructive confirms | Delete card (dialog), Clear done (confirm + "use Archive" warning), archive confirm with count | **[R]** |
| Undo | delete-on-project-page toast undo; archive → restore flow | **[O]** |

## 9. Preferences & client-side state (localStorage — not synced)

`hibana-kanban-last` (S205 last-used board) · `hibana-recent-projects` (palette Recent, ≤10) ·
`hibana-pd-cols-collapsed` · `hibana-projects-view` / `-sort` / `-saved-filters` (projects page) ·
`hibana-resume` (dashboard "Continue from where you left off", interaction-based per S105) ·
`hibana-lang` · `hibana-theme` · `hibana-rail-panel` / `-fold-v1` · `hibana-ov-tasks` ·
sessionStorage: `hibana-qa-draft` etc. Parity: **[O]** — desktop can map to native settings;
the last-used board is the one worth keeping.

## 10. i18n / RTL / a11y on the board

- Two languages only: `en` + `fa` (Jalali calendar, Persian digits ۰-۹, auto-digit conversion).
  Law: JS-built markup calls `t()` at render time (i18n.js never re-scans) — S205 added 10 keys
  (i18n parity 1582/1582). Parity **[R]** for FA support.
- RTL: logical CSS properties + `rtl.css` overrides; S205 switcher is direction-aware.
- Keyboard: Enter/Space card open; Esc closes menus/dialogs/switcher; `f` focuses search
  (projects page); `g`+letter navigation; `Ctrl+K` palette; `?` shortcuts overlay.
- Touch floors: 44px minimum on interactive targets (S197 e2e pins).
- a11y gates: axe audit fns in e2e (`e2e/fixtures/audit-fn.js`), accent-ink contrast doctrine
  (S200/UX-3: `--accent` 3.10:1 for non-text; `--accent-ink` 5.74:1 for text — the S205
  switcher's "All projects" link uses the ink per the doctrine).

## 11. Known defects / gaps (honest list)

1. **Touch drag exists twice** (dedicated pd-board path + generic touch-drag.js) — documented duplication.
2. **The board filter bar is implemented twice** (board-page.js / project-page.js) — deliberate
   twin (server-fragment page vs client page), kept in sync by tests.
3. **Delete-on-board lacks the Undo toast** the project page has (native confirm instead).
4. **Offline**: board data is not cached (SW caches the shell only; `/api/*` is always network) —
   offline board = the shell + "You're offline" banner.
5. **Archive-done on the board uses `window.confirm`** (native) vs styled dialogs elsewhere.
6. **No automated test for the mobile More-sheet Kanban row** (manual only — see TEST-MATRIX).
