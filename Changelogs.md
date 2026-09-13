# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.12.29 — Session 30 batch 3: Tier-2 analytics — the data becomes visible)
- **(a) Reports task analytics (owner request)**: /api/reports/summary gained
  tasks.priority (per-tier {total, done} across every live task — "how much of my
  backlog is urgent?"), labels (top 12 by task usage with done + fresh-30d counts — the
  label-trends ask, counts-only per the vision), and sprints (the last 10 real sprints
  with DONE counts per priority tier). The reports page grew the Task analytics card:
  the 4-tier stat strip, the backlog SHARE BAR (urgent-first segments reusing the
  prio-* pastels; the aria-label carries the per-tier counts), label distribution chips
  (dot + name + n + ✓done + +fresh), and the sprint-velocity table (prio-dot column
  heads, per-tier done counts, deep links to each sprint). copyDigest/downloadCsv
  carry the new sections (MD per-tier open/done + top-8 labels; CSV tasks/labels rows).
- **(b) Dashboard "urgent across projects" — the fire strip**: cross-project urgent +
  high non-done tasks (up to 12 rows, urgent first, each deep-linking to
  board.html?project&task with the editor open; the project name links to the project
  page; the header carries the total). Renders right under the resume card ONLY when
  something is burning — an alert layer like the overdue chips, not a pref-gated
  section, so quiet means invisible. JSON branch carries urgent + urgentTotal; new
  'flame' icon case; faNum() keeps FA digits on the reports card.
- 14 i18n keys EN+FA (reports.tasks*/labelDist/labelHint/velocity/vel* + dash.urgent*;
  977→991). Bumps: i18n-en v10→11 + i18n-fa v10→11 (dynamic ref in i18n.js v67→68),
  reports-page.js v3→4, calendar.css v2→3 (rep-tasks styles), dashboard.css v2→3
  (dash-urgent styles). Tests: +4 vitest (priority mix + labels + velocity; rule-1
  isolation; JSON urgent payload; HTML strip only-when-burning) + 2 E2E
  (analytics.spec.ts — the reports card end-to-end + the fire strip deep-links), 42
  e2e total. Ladder: typecheck 0 · vitest 344/344 · Playwright 42/42 · smoke ALL PASS ·
  i18n 991/991 · cache-bust PASS.

## 1. Current state (v0.3.12.28 — Session 30 batch 2: board UX — filters, translations, truthful exports, dot-cycling)
- **(a) The FILTER BAR (owner request)**: "a filter bar on board.html + project page (e.g.
  show only 🔴 urgent × #Security)". board.html renders a priority × label toggle row
  above the columns (each group OR within itself, AND across groups; empty selection =
  show all; clear chip + "{n} of {m} shown" hint; column counts follow the filter); the
  project page's board preview gets the TWIN — client-built into the server-mounted
  [data-pd-filter] div from the /api/projects/:id truth payload (the DOM renders only
  5/column so the label list can't come from markup), built on htmx:afterSwap (the page
  boots with an empty #project-body), filtering hides .pd-task-wrap in place so the
  server markup survives; insertTaskChip + the more-link expansion respect the active
  filter. Clicking a CARD's label chip toggles that label's filter (GitHub behavior) on
  both surfaces.
- **(b) Translated priority labels**: board cards' prio-dot title was the raw "urgent"
  string — now B().prioLabel (db.pr.* keys) + the cycle hint; the sprint circles' dot
  gained its own title/aria-label, and the parent dot title appends " · prioLabel".
- **(c) MD export/copy carries priority + labels**: "- [URGENT] Fix auth leak #UI/UX
  #Security" (the owner's own format) via mdTaskLine (devboard.js, shared by both
  surfaces): title whitespace collapses to one space (multi-line titles stay one
  bullet), label spaces hyphenate GitHub-style. The board's export also stopped reading
  the DOM (which the filter now filters!) — it reads the loaded state; the project
  page's pdColItems went rich ({title, priority, tagNames} via the devTaskTags join).
- **(d) Click the dot = cycle priority**: the prio-dot became a TRANSPARENT 24px
  hit-area button (.prio-dot-btn, devboard.css) wrapping the unchanged 9px .prio-dot
  span — zero specificity fights with the !important .pd-task/.db-card color rules.
  low → medium → high → urgent → low; optimistic DOM update (dataset + dot + meta +
  re-sort via pdSortWrap) + PATCH; the card-open handlers guard on the dot + label
  chips so the editor never opens from them.
- **(e) Problems-box composer priority picker**: the bulk bug-add flow (Problems tab,
  one line = one task) defaulted everything to medium — now a class-coded <select>
  (Urgent/High/Medium/Low, trL'd) rides the whole batch.
- 9 i18n keys EN+FA (db.filter*/db.cyclePrio; 969→977). Bumps: devboard.js v11→12,
  board-page.js v1→2, sprint-page.js v1→2, project-page.js v4→5, i18n-en v9→10 +
  i18n-fa v9→10 (dynamic ref in i18n.js v66→67), devboard.css v2→3 (filter bar +
  .prio-dot-btn + click affordances). Tests: +2 E2E (board-filters.spec.ts — filter
  matrix + dot cycle + persistence + clipboard-carried MD line + problems picker),
  40 e2e total. Ladder: typecheck 0 · vitest 340/340 · Playwright 40/40 · smoke ALL
  PASS · i18n 977/977 · cache-bust PASS. Browser-verified live (FA + EN): filter
  toggles, chip-click filter, dot-cycle with server persistence, MD line format,
  problems picker options فوری/اولویت بالا/…

## 1. Current state (v0.3.12.27 — Session 30: manual progress box REMOVED + the B-fixes (B1–B4))
- **(a) Removal (owner request, verbatim)**: "Remove the whole thing and its function,
  i dont want this: `<div class="pd-progress" …slider/milestone chips/Auto/note…>`".
  Migration **0051** nulls every projects.progress_percent override (progress is ALWAYS
  the computed dev-tasks→hurdles number), drops project_progress_log (0050 — one day
  old); PATCH progress_percent/progress_note now 400 (fields stripped from
  updateProjectSchema — a stale client is rejected cleanly), GET /api/projects/:id/progress
  is 404 (route deleted with its only caller); the detail page's Activity tab lost the
  "Progress history" timeline; project-page.js lost ~7k of wiring — only the read-only
  computed bar + its sr-only % label remain, repainted by the (now unconditional)
  __pdPaintAutoProgress. SNAPSHOT_TABLES dropped the dead table (old snapshots carrying
  the key restore harmlessly — restore.mjs skips dead/missing tables with a warning).
- **(b) B1 — labels survive archive→restore**: project_archives.tags (JSON name+color
  snapshot, 0051) written BEFORE the dev_task_tags CASCADE delete in archive-done;
  GET /archives returns the snapshot; restore relinks by name through setTaskTags
  (existing tag keeps its CURRENT color; a vanished name re-creates with the snapshot
  color). Priority always survived; labels now do too.
- **(c) B2 — tags.usage_count finally maintained** (was written 0 at insert, never
  touched): refreshTagUsage recomputes dev-task links + project chips for the touched
  ids on EVERY mutation — setTaskTags (replace-set), POST/DELETE /api/devtasks/:id/tags,
  task delete (cascade), archive-done (cascade), restore, project-tag attach/detach.
  The label manager (Tier 3, next) can now show an honest "used 12×".
- **(d) B3 — dev_tasks enter the FTS index**: dev_tasks.search_tags (0051, denormalized
  space-joined label names) + external-content dev_tasks_fts + ai/ad/au triggers;
  syncTaskSearchTags rewrites the column after every link change (the UPDATE trigger
  re-indexes). /api/search returns a tasks group (title hits AND label hits — searching
  "Security" finds every task labeled Security); the command palette renders it with
  the priority dot + project sublabel, deep-linking to board.html?project=X&task=ID.
  **Found + fixed an FTS5 landmine**: the 0040-style delete-then-insert backfill dance
  errors SQLITE_CORRUPT_VTAB ("database disk image is malformed") on modern SQLite
  when the index is empty but the content table has rows — 0051 uses the canonical
  `INSERT INTO dev_tasks_fts(dev_tasks_fts) VALUES('rebuild')` instead (idempotent,
  cannot fail; 0040's own dance only ever ran against empty tables, which is why it
  worked).
- **(e) B4 — palette collision fix**: new tags pick the LEAST-USED palette color
  (tagColorFor — counts the user's tags per color, ties break toward fixed palette
  order) instead of the name hash that gave "Refactor" and "Tech-Debt" the same
  #E59AA5. tagPaletteColor stays as the hash fallback.
- Tests: project-progress.test.ts rewritten (2 removal pins: 400/404/no-table, legacy
  override nulling), +5 devtask-archive-search.test.ts (B1 snapshot+relink+usage,
  B2 lifecycle incl. project chips, B3 title+label+isolation+re-index, B4 8 distinct
  colors). E2E: the slider spec replaced by the removal pin (no box, PATCH rejected,
  computed bar at 100%). Bumps: project-page.js v3→4, project-header.css v3→4,
  command-palette.js v1→2, i18n-en v8→9 + i18n-fa v8→9 (cmdk.tasks + the 3 progress
  keys dropped; dynamic ref in i18n.js v65→66), sw v325→326. Ladder: typecheck 0 ·
  vitest 340/340 · Playwright 38/38 · smoke ALL PASS · i18n 969/969 · cache-bust PASS.

## 1. Current state (v0.3.12.26.1 — Session 29 follow-up: task priorities + labels in the progress box)
- **O1 part 2 (owner request 2026-09-12, verbatim)**: "when user opens modal I want a
  drop down menu for Priority of it: Urgent - High Priority - Medium Priority - Low
  Priority (with different color coding). They must be auto-sorted in their boxes
  based on their priority. ALSO each task in project progress can have label or meta
  tag, for example UI/UX, Security." No migration — dev_tasks.priority (CHECK
  low/medium/high/urgent, 0029) + dev_task_tags (0029, user-scoped tags) already
  existed; the entire feature is wiring. Shipped:
  **(a) the modals**: the add composer (#pd-taskadd-modal) gained the Priority
  dropdown (urgent→low, class-coded options + a LIVE color preview chip — plain
  <option> styling varies by engine, the chip is the guaranteed signal) and a Labels
  input (comma-separated, Latin/Persian/Arabic separators; placeholder "e.g. UI/UX,
  Security"); the inline editor's plain select was upgraded the same way + a labels
  row. **(b) AUTO-SORT everywhere a task lists**: PRIO_ORDER_SQL (CASE urgent→0
  high→1 medium→2 low→3, then manual sort_order, then age) now orders GET /devboard
  (board.html + sprint page), the detail loader (project page server render), and the
  JSON GET /:id payload; the client's insertTaskChip/drop/move/edit paths all snap
  cards into their PRIORITY slot (manual drag re-orders within a tier only — what a
  reload renders); a full column shows an outranking newcomer by displacing the last
  visible card (reload-equivalent). **(c) labels end-to-end**: POST /devtasks accepts
  tags (find-or-create per user, COLLATE NOCASE so "UI/UX"=="ui/ux", palette color =
  name hash — one of the 8 app pastels), PATCH tags = REPLACE-SET semantics (array =
  exactly these, [] clears, omitted untouched) with the response carrying the final
  set; the devboard GET + detail payload carry a flat task_tags join; cards render
  chips (data-pd-tags mirrors for the editor prefill); the standalone POST
  /devtasks/:id/tags default color is now the palette hash too. **(d) two latent bugs
  fixed on the way**: the inline editor ALWAYS pre-filled priority 'medium' ("card
  doesn't show priority") — SAVING silently reset an urgent task's priority (the card
  now carries data-pd-priority/pd-tags and the editor pre-fills the REAL values);
  pdMoveChip/pdRemoveChip used the Session-22-known stale selector
  `.pd-task[data-pd-task]` (matches nothing — data-pd-task lives on the wrap) so the
  problems-box optimistic move never fired.
- Cards now show: prio-dot (tinted) + leading priority LABEL in the meta line
  (var(--err)/--badge-awaiting-fg/--muted, bold) + label chips under the title.
  i18n: 7 new keys EN+FA (pd.pr.*, pd.labels*) — parity 971/971. Tests: vitest 338
  (+4: create-carries-priority+tags/listing-priority-first, PATCH replace-set, tag
  reuse + priority persist, isolation) · Playwright 38 (+1: composer dropdown + live
  chip, labels, auto-sort, reload round-trip, editor real-priority prefill + live
  re-sort) · cache-bust PASS (4 files: project-page.js, project-header.css,
  i18n-en/fa) · bundle-size PASS. Browser-verified live on :3000 (EN+FA surfaces,
  mobile 390px wrap, zero console errors).

## 1. Current state (v0.3.12.26 — Session 29: SWOT batch + board data integrity + monitoring + responsive + backup health + the richer progress box)
- **Session 29 summary** — the owner-directed 5-agenda session, executed against a fresh
  re-clone after a context-loss recovery (the previous conversation's identical work was
  never pushed; it was reconstructed 1:1 from the worklog and re-verified end-to-end —
  the only permanent loss was two gitignored tmp-debug audit scripts). Shipped:
  **(a) a P0 fix discovered in-session**: the sadhana/To-do board had been DEAD since
  v0.3.10.2 (jalali.js top-level functions collided with sadhana-page.js's const
  destructuring → SyntaxError at parse → "Loading…" forever; jalali.js is now
  IIFE-wrapped with window.__hibJalali as the sole global, and e2e/sadhana.spec.ts —
  the page's FIRST E2E coverage — pins the boot + task round-trip). **(b) SWOT
  highest-leverage batch — board DATA INTEGRITY**: migration 0049 (canvas_elements.angle
  REAL DEFAULT 0) + angle in every objectToData branch on both boards + rotate() on the
  makeObject + async image load paths (the mtr rotation handle now round-trips; arrows
  stay rotation-locked by design); W2 — sticky resize durable (canvas.js note branch
  bakes width×scale, min 80); W3 — notebook moves/resizes/rotations undoable
  (object:modified now mirrors persistActive: snapshot → save → history.commit).
  **(c) O1 — external uptime monitoring**: healthchecks.io check "hibana-uptime" +
  .github/workflows/uptime.yml (GitHub Actions prober every 30 min, jq-validated,
  /fail pings — independent failure domain from Cloudflare) + GitHub repo secrets set
  via API (the CD workflow is actually deployable now) + bun.lock regenerated (CI had
  been red for 181 runs on frozen-lockfile drift). **(d) Responsive audit**: the ONE
  real page-level bug (calendar.html 69px h-scroll @768 — .cal-controls wrap was gated
  ≤640px) fixed + cal-head wraps ≤1024 + cal-sys 40px floor + ::after hit rings on
  dash-collapse-btn/dash-todo-pen/pw-toggle + e2e/viewport.spec.ts (10 tests: 7 pages ×
  4 widths + the calendar regression pin + cal-sys height + shell-fills-viewport).
  **(e) Agenda 4 — backup-health visibility (W8)**: GET /api/admin/backup/status
  extended with health (fresh ≤6h | late ≤12h | stale >12h | never | unknown, parsed
  from the newest snapshot filename), planb {count, lastSentAt} on EVERY branch, and
  encrypted (boolean only); the admin Backup tab renders a health line (+ error tint
  on stale/never/plaintext) and a Plan B card with a ONE-CLICK trigger — planb_backups
  being empty since birth is now a visible warning next to a button instead of a hidden
  runbook step. **(f) Agenda 5 — the richer project progress box**: migration
  0050_project_progress_log (pct nullable 0-100 + note ≤200 + created_at, user_id rule
  1, indexed) + the project header's read-only bar became an interactive box (range
  slider 0-100 step 5, milestone chips 0/25/50/75/100, Auto ⇄ Manual toggle, optional
  milestone note; PATCH logs only CHANGED values, progress_note is a timeline rider
  never a SET column) + GET /api/projects/:id/progress (entries + current {pct, auto,
  autoPct}; ?format=html htmx fragment) + the Activity-tab Progress-history timeline
  (bucket-tinted badges) + kanban color weights (projects.html cards carry a bottom
  progress strip tinted by the same buckets; loadProjectProgress = batched dev-task +
  hurdle aggregates) + the detail page now honors the manual override even when dev
  tasks exist (the one surface where it was dead) + project_progress_log joined
  SNAPSHOT_TABLES (the drift guard caught it — milestone notes are user content).
- **E2E hardening found + fixed in-session**: the first-visit SW-claim race — the SW
  registered on /login.html activates + clients.claim()s /app, boot.js's
  controllerchange listener reloads /app once, and that reload SUPERSEDES a goto issued
  in the same instant (observed: /calendar.html and soft-nav /settings.html landings
  dragged back to /app, navType "reload", ~1-in-8). All authed specs' login() helpers
  now wait for controller + load + settle.
- **OWNER ACTIONS still standing (surfaced in-app now)**: trigger a Plan B backup on
  PROD (admin console → Backup tab → "Send Plan B backup now" — planb_backups is still
  empty) and run the full decrypt drills (scripts/drill + drill:planb) from the
  owner's machine. The health line will show fresh/stale + encryption status for the
  GitHub channel once the deployed worker's own token lists the repo.
- Tests: 334 vitest (+1 angle round-trip, +5 backup-status, +5 project-progress) · 37
  E2E (+2 sadhana, +1 canvas scale/rotation, +1 notebook move-undo, +10 viewport, +1
  progress box) · build 71 entries 23/23 wired · cache-bust PASS (14 modified files) ·
  i18n parity 964/964 (21 new keys EN+FA) · bundle-size PASS · smoke ALL PASS ·
  workers 5/5. Schema 47→49 (0049 + 0050). SW v324/v325 (v325 carries the agenda-4+5
  shell changes; bump trail: canvas.js v27, whiteboard.js v23, jalali v2, admin.js v5,
  misc.css v5, project-page.js v3, project-header.css v3, canvas.css v4, i18n-en/fa
  v8, i18n.js v65, polish-batch v5, dashboard-todo v5, base.css v3).

## 1. Current state (v0.3.12.25 — Session 28 R4: release close-out + Session-29 handover)
- **Session 28 R4 summary** — docs-only close-out release. No application code changed;
  the entire Session 28 release train was re-verified end-to-end on a fresh sandbox and
  packaged: environment restore (Hibana Node server on :3000, schema 47), typecheck 0 ·
  vitest 323/323 · cache-bust PASS (canonical form) · build --prod --wire-html (71
  manifest entries, 23/23 pages wired) · check-dist-wiring PASS · Playwright 22/22 ·
  smoke ALL PASS. Released as v0.3.12.25 (commit + push to assadigit/hibana-source main),
  deployed to BOTH the dev and prod Workers, and archived as
  `download/hibana.0.3.12.25.zip` (git-archive of the release commit — secret-scan clean).
- **Session 28 complete (what shipped this session):** R1 — the Alpine hard-load P0
  (reports/settings components dead since v0.3.12.3; script-order fix 5550991) + the
  soft-nav MutationObserver twin + 5-test regression spec; main round — canvas-page E2E
  safety net, sticky-factory consolidation (public/js/sticky.js), notebook PNG export
  (pixel-verified canonical light view), clipboard PNG copy on both boards, notebook
  recolor palette with the first undoable modify, a11y/polish batch (v0.3.12.22);
  R2 — the owner's 6 filed bugs incl. the fabric-v7 CENTER-origin P0 (topLeftOriginCompat
  shim), notebook auto-growing scrollable sheet, sparks folder=all + folder-scoped
  capture, Jalali weekday note-meta, compact note buttons, repaired kanban stat-card
  selectors (v0.3.12.23); R3 — width-driven text-box resize with live reflow on both
  boards (v0.3.12.24).
- **Session 29 agenda (owner-directed):** (1) SWOT analysis of the project;
  (2) performance optimization; (3) responsive-flawless audit; (4) backup/restore
  flawless-ness (incl. the standing OWNER ACTION: trigger a Plan B backup on prod —
  planb_backups still empty — and run the full decrypt drills); (5) feature additions
  and tweaks, starting with richer project-progress-box options.
- Standing caveats carried forward: clipboard-write needs a real-browser spot check
  (headless denies the permission; code path verified to the browser boundary);
  sticky notes still resize by SCALE (group semantics; width-driven sticky resize is a
  candidate sticky.js surgery); text-box mtr rotation doesn't persist (no angle field in
  the record schema); notebook object:modified has no history commit for moves/resizes;
  canvas.js (~3,040 lines) + app.js modularization backlog.

## 1. Current state (v0.3.12.24 — Session 28 R3: width-driven text-box resize, live reflow)
- **Session 28 R3 summary** — the owner reported the text-box resize handles looked
  decorative: dragging them never changed the line wrapping. Root cause was TWO bugs
  stacked: fabric v7's Textbox defaults give the four corner handles `scalingEqually`
  (letters stretch, wrap frozen) and only ml/mr a width action — AND our own
  `initDimensions` override re-pinned `obj.width = __fixedWidth`, which clobbered any
  width a resize set (fabric's `Text.set('width')` synchronously re-measures, so the
  stale pin made `changeObjectWidth` see "unchanged" and the whole resize no-op'd).
- **The fix (both boards — canvas.js + whiteboard.js):** `wireTextBoxResize(obj)` is
  called from each board's `makeTextBox` and (1) rebinds EVERY horizontal handle
  (tl/tr/bl/br/ml/mr) to fabric's own width action (the stock `mr` actionHandler:
  pointer→width, opposite edge pinned via wrapWithFixedAnchor, fires object:resizing)
  with honest per-handle cursors; (2) hides the vertical mt/mb handles (height is
  content-driven, never hand-set); (3) on every `resizing` tick mirrors the live width
  into `__fixedWidth` and refreshes the control coords. The `initDimensions` override
  became WIDTH-TRANSPARENT (it never writes `obj.width` — the wrap measures at the live
  width; height auto-fits, clipPath re-syncs), and `objectToData`'s multi-select scale
  bake now applies the baked width explicitly (`obj.width = obj.__fixedWidth`) since
  nothing re-pins it anymore.
- **Result:** dragging any corner/edge handle updates the CONTAINER WIDTH and the text
  re-wraps LIVE (fewer lines as the box widens, taller as it narrows), scale stays 1
  forever (no stretched letterforms), the opposite edge stays anchored, the height
  auto-fits with the top fixed, and the width round-trips through the record (undo
  restores the pre-resize width; reload rebuilds at the resized wrap width — verified:
  160→560 drag, server record width 560, reload renders 1 line at 560). Locked notes
  stay gated (hasControls=false hides the handles); the stock single-click-enters-editing
  behavior is untouched (resize works right after leaving the editor — the note stays
  active with handles live).
- Assets: SW hibana-v323. canvas.js v25→26, whiteboard.js v21→22. package.json
  0.3.12.23→0.3.12.24. No i18n changes.
- Verified: typecheck 0 · vitest 323/323 · build+wiring PASS (71 entries) · cache-bust
  PASS (canonical form) · Playwright 22/22 (+2: canvas-board mr-handle reflow with
  persistence + undo, notebook tr-corner reflow with persistence) · smoke ALL PASS ·
  live-verified on the dev board (instrumented resize events, exact drag-delta width,
  left-edge anchoring) and on hibana.ir.
- Debugging notes for future sessions: (a) fabric v7's `Text.set('width'|'fontSize')`
  runs `initDimensions()` + `setCoords()` synchronously — ANY override that writes
  width inside initDimensions will fight width-driven resize handlers; (b) a click on
  an already-selected fabric IText re-enters EDITING (stock mouseUpHandler) — E2E
  must drag handles directly after exiting the editor, not "select then resize"; (c)
  the E2E canvas-board probe math must use the FULL affine vpt mapping
  (x'=a·x+c·y+e, y'=b·x+d·y+f) — a partial mapping silently lands clicks ~200px off;
  (d) the VLM misreads small upscaled canvas text (it "read" words that don't exist) —
  geometric assertions via page.evaluate are the reliable verification.

## 1. Current state (v0.3.12.23 — Session 28 R2: 6 user-reported bugs + the fabric-v7 origin P0)
- **Session 28 R2 summary** — the owner filed 6 concrete bug reports (2 with screenshots);
  investigation found ONE of them was the deepest bug since the fabric migration, four were
  quick CSS/server fixes, one was a feature gap. All fixed, ladder-verified, deployed.
- **THE P0 — fabric v7 anchors objects by CENTER (v5 used TOP-LEFT):** both boards persist
  getBoundingRect().top-left and re-create with left/top, so after the v5→v7 migration every
  text note, stroke and shape reloaded HALF ITS SIZE up-and-left — and drifted further on
  every save cycle. Combined with the pinned-width Textbox clipPath (loaded at the SAVED
  height, never re-measured), this is exactly the reported "notebook notes are cropped /
  the container only shows a portion of them" (screenshot 444: notes scattered at drifted
  offsets, mid-crop). Fix at the SHIM level (src/vendor/fabric-shim.ts topLeftOriginCompat):
  every exported shape class gets wrapped so `new C({left, top, …})` re-anchors to
  top-left unless the call passes an explicit origin (the comment pins/guides keep their
  center math). Empirically verified end-to-end: sticky renders at saved (400,200) 1:1,
  × hit-region click deletes, body click doesn't, dblclick edit-twin opens + types + saves
  (paper grows 200→201), sticky tool creates at the drag origin, E2E 20/20.
- **Notebook text auto-fit + sheet growth (the rest of the crop report):** makeTextBox now
  calls its initDimensions override once at construction (height = max(saved, measured) —
  never crops saved content), and a post-load reflowTextMetrics() pass covers the cached-
  fonts case (fonts.ready can resolve BEFORE load() adds elements). Then the sheet itself:
  fitSheetToContent() stretches #nb-page's min-height to the content bottom + 96px and the
  notebook body scrolls (canvas-page notebook-scroll; toolbar sticky) — a 1100px note is
  fully reachable (verified: page 393→1208px, scrolled to the tail, VLM "last line fully
  visible"). The Canvas board keeps its no-scroll pan page.
- **Sparks «نمایش همهٔ ایده‌ها» + folder capture (report 5):** folder=all fell into the
  folder_id='all' SQL filter (matches nothing — ids are UUIDs) → empty list → the folder
  grid rendered AGAIN ("the ideas don't appear"). Now 'all' skips the filter (ideas list +
  breadcrumb bar). And the second half of the report — "cannot go to any folder to create
  their idea there" — quick-add now files into the OPEN folder: folder_id accepted on POST
  /api/projects (ownership re-validated like PATCH; dropped for non-spark creates), the
  sparks-page stamps the folder name on the hidden input, and the modal shows
  «ثبت در پوشه: …». Verified live: 6 ideas under folder=all, capture lands in the folder.
- **Sticky palette on top (report 3):** the recolor palette (the "menu for edit/etc")
  floats ABOVE the selected sticky on BOTH boards — top - paletteH - 8, flipping below
  only when the note hugs the sheet top. (The screenshot's "⋮ dots at top-left" was the
  palette's color dots at thumbnail scale.)
- **Note meta weekday + date (report 2):** «شنبه ۲۱ شهریور ۰۱:۲۳» — new formatNoteDay
  (weekday + Jalali day + month, fa digits; 'Sunday 21 Sep' EN) + fa-IR/en-GB 24h clock.
  Verified live on the owner's real notes.
- **Compact note buttons (report 1):** the delete × was a 2.75rem min square PLUS
  0.5/0.6rem padding (~60px around a 14px glyph). Now a 1.75rem visual circle on all
  note-card icon buttons; tap targets stay ≥44px via the base.css ::after ring trick
  (the danger ring existed; non-danger buttons got their own). Sticky headbar strip
  2.75rem→1.9rem.
- **Kanban stat cards transparent (report 4):** notifications.css had a BROKEN SELECTOR
  LIST — the flat-fill block (`.kanban-card, .stat-kanban-card, .card.kanban-card.stat-
  kanban-card,` + the six status selectors) never closed and merged into the first
  :hover rule's declaration block, so EVERY kanban card (dashboard stat cards included)
  painted the unreviewed hover pastel. The list is repaired: stat cards transparent +
  border only (the ::before status bar stays the sole color signal), .kanban-col cards
  keep their per-status fills (now as proper standalone rules).
- Assets: SW hibana-v322. canvas.js v25, whiteboard.js v21, app.js v173, sparks-page.js
  v2, i18n-en v7, i18n-fa v7 (dynamic ref in i18n.js v64), quicknotes.css v5,
  notifications.css v3, canvas.css v4, fabric.min.js →?v=2. package.json
  0.3.12.22→0.3.12.23. i18n 942→943 (+1 key qa.filesInto).
- Verified: typecheck 0 · vitest 323/323 (+5: sparks folder views ×4, formatNoteDay) ·
  build+wiring PASS (71 entries) · Playwright 20/20 · smoke ALL PASS · deployed
  hibana-prod fa086760 · LIVE: /api/health ok, sparks folder=all lists 6 ideas, note-meta
  «شنبه ۲۱ شهریور ۰۱:۲۳» on real notes, notebook sheet 733px/scrollable with the owner's
  data, zero page errors. Pushed assadigit/hibana-source@550d293.
- Notes on the debugging: (a) the Bash tool's output rendering EATS `[h` sequences — the
  `.sticky-palette[hidden]` selector LOOKED typo'd (`.sticky-paletteidden]`) in grep/sed
  output but od -c proved the bytes correct — a false P0 that almost shipped; (b)
  agent-browser's low-level mouse does NOT set detail=2 on double clicks, so fabric's
  dblclick (which requires e.detail===2) never fired from raw mouse pairs — dispatch a
  synthetic MouseEvent with detail:2 to test editing; (c) the E2E suite needs
  `npx playwright install chromium` in a fresh sandbox.

## 1. Current state (v0.3.12.22 — Session 28: sticky-factory consolidation + board export v2 + notebook recolor)
- **Session 28 summary** — status assessment + agent-browser QA sweep first (11 pages, zero
  page errors AND zero console warnings — the RR-2 lesson: Alpine bug-classes log warnings),
  functional probes on both boards (pen, sticky, undo, dark mode, FA/RTL), then the top
  code-side priority from every handover since S27.
- **Safety net first (e2e/canvas-board.spec.ts, 3 tests):** the canvas-page E2E the
  handovers asked for — render+0-errors, pen-stroke→server sync, sticky drag-create →
  double-click edit-twin → type → save round-trip → undo×2/redo×2. Taught the per-test-user
  pattern (server-persisted board data leaks across tests in one file) and the
  scene→viewport coordinate offset (the toolbar sits above the board). 17→20 Playwright.
- **Refactor — the ONE sticky factory (public/js/sticky.js):** makeStickyNote lived as two
  ~140-line verbatim copies (canvas.js + whiteboard.js) that had already drifted (the
  notebook added dark-mode refs; the canvas kept resizable controls). Extracted to a shared
  module with per-board injection (hasControls, requestRender thunk, wireTextDir callback);
  each board keeps a ~12-line wrapper. canvas.js 3069→2986, whiteboard.js 1396→1600 (with
  new features added). Behavior-preserving: verified by the new canvas spec + the notebook
  spec + live round-trips (create → type → save → undo; saved notes render through the
  shared factory on both boards). sticky.js joins the build manifest (content-hashed).
- **Feature — notebook PNG export (parity gap):** the Canvas board had whole-board /
  selection / frame PNG export since the squig batch; the notebook had nothing. New export
  toolbar button + popover (whole page / selection downloads, 2× resolution). THE DARK-MODE
  DESIGN: this sheet's dark look is a CSS invert (--nb-ink) which a PNG bitmap cannot
  carry — the export renders the CANONICAL LIGHT view (image counter-filters cleared,
  stickies re-themed to __lightColor, light paper #fdfdfb) — verified at the PIXEL level
  (decoded the exported PNG: paper 253,253,251 + note 255,245,157 in dark mode). The
  popover hint says so in dark mode (new key canvas.exportHintLight).
- **Feature — clipboard PNG copy (both boards):** "Copy PNG to clipboard" row in both
  export popovers — regionDataUrl → blob → navigator.clipboard.write; graceful
  unsupported-browser + permission-denied toasts; taint errors surface the __noCors count
  (the notebook's image loader now propagates __noCors to the fabric object). Targets the
  selection when one exists, else the whole board/page. canvas.js's exportRegionPng
  refactored into regionDataUrl + exportTaintError + copyRegionPng (zero duplication of
  the normalization block).
- **Feature — notebook sticky recolor palette (parity gap):** the Canvas shows 7 pastel
  swatches under a selected sticky; notebook stickies could only be default yellow. Same
  palette language, adapted to the fixed sheet (no vpt math) and CSS-invert dark mode
  (recolor sets the CANONICAL pastel on __lightColor, then applyStickyTheme re-derives the
  dark paper/ink/× — verified live: pink recolor in dark mode saves #fbcfe8, renders
  #6B6450 live). The recolor is the notebook's first UNDOABLE MODIFY: undo/redo grew a
  symmetric 'modify' branch (revert-to-carried-record + swap) — verified live through
  save/undo/redo with server persistence at every step.
- **Polish (shared CSS, both boards):** palette swatches 22px→24px hit areas + hover lift
  + FOCUS-VISIBLE RINGS (keyboard users previously got NO visible focus on the swatches —
  on BOTH boards); pop-in entrance animation (0.14s fade+drop) for board popovers + the
  palette, prefers-reduced-motion guarded; export rows get leading icons (download vs
  clipboard — reads at a glance), focus ring, active press, icon tint-on-hover; the
  notebook export button carries .pop-open while its popover is open (same affordance as
  the Canvas popovers); one-board-popover-at-a-time (export ↔ image).
- **Process notes:** (a) build --restore-html must run BEFORE check-cache-bust locally —
  the gate reads canonical ?v= refs (CI sees the committed canonical form); (b) a
  mid-session git-stash + rebuild poisoned .build-backup with a pre-edit canonical HTML —
  the restore ate the source edits (re-applied; lesson: never build while stashed).
- Assets: SW hibana-v321. canvas.js v24, whiteboard.js v19, sticky.js NEW v1,
  canvas.css v3, misc.css v4 (20 pages), i18n-en v6, i18n-fa v6 (dynamic ref in
  i18n.js), i18n.js v63. package.json 0.3.12.21→0.3.12.22. i18n 936→942 (+6 keys).
- Verified: typecheck 0 · vitest 318/318 · build+wiring PASS (71 entries) · cache-bust
  PASS (7 files) · i18n 942/942 · Playwright 20/20 (one flake re-run: soft-nav timeout
  under full-suite load, green alone + green on the full re-run) · smoke 20/20 ·
  workers-smoke 5/5 (zero leaked workerd) · live: export popover EN+FA light+dark,
  download produces a real 2× PNG, recolor→save→undo→redo with server persistence,
  palette positioning + active swatch, pop-open affordance, zero console errors
  throughout.

## History: v0.3.12.21 — Session 27 R3 (smoke-tooling fix + admin Usage analytics + tour polish)
- **Review-round 3 summary** — status assessment + full QA sweep first (13 pages × light/dark
  × EN/FA, zero page errors, zero Alpine warnings), then a programmatic WCAG-AA contrast
  audit across every page (all clean — the RR-1 "tooltip contrast" VLM concern does not
  reproduce under real alpha-composited math), then the last §6 open item shipped.
- **DevEx fix (commit 7f8e272):** `npm run smoke` was 403-dead at the login step since the
  T6 CSRF tighten (b2649a5, 2026-09-11) updated the 15 vitest files but missed the
  in-process smoke script — every POST/PUT/PATCH/DELETE now carries `Origin: 'http://local'`
  (20/20 checks pass again). Found while re-running the baseline ladder.
- **Feature — admin Usage analytics tab (commit 912df83):** the LAST §6 open item
  ("feature-usage analytics + top-10 activity ranking"). One owner-scoped read endpoint
  `GET /api/admin/usage` returning (a) 17 feature surfaces with non-deleted totals +
  last-activity recency (project-scoped tables JOIN through projects; project_archives
  uses archived_at), (b) a weighted top-10 user ranking (projects ×3, tasks/backlog/
  Telegram/AI ×2, notes/strokes ×1) with unweighted per-surface breakdowns, (c) a 14-day
  zero-filled creation histogram (UNION ALL over 10 content tables). Frontend: a lazy-loaded
  Usage tab in the admin console (bars scaled to the busiest surface, rank medals with a
  first-place highlight, CSS histogram with native title tooltips), subgrid responsive
  collapse at 720px, fully i18n'd (34 new keys, 901→936, FA verified live). 6 new vitest
  tests (owner-only 403, shape, soft-delete respect, project-scoped attribution, weighted
  ranking + 10-cap, histogram windowing) → 317 total.
- **UX polish (commit 0b2fc89):** tour progress dots are now step-jump BUTTONS — 24px hit
  areas (8px visual via padding + background-clip: content-box; box-sizing: content-box
  overrides the app-wide border-box), hover states, focus-visible accent rings,
  aria-current="step", i18n'd aria-labels (new key tour.step). Plus the settings-page.js
  invites-component dedup: ONE factory registered on BOTH alpine:init (hard load) AND
  mount() (soft nav) — the naive "remove the duplicate" first attempt broke soft-nav
  invites and was caught IN-FLIGHT by e2e/alpine-hard-load.spec.ts #6 (the spec written
  in RR-2 earning its keep); 559→515 lines.
- **D1 runtime fix (follow-up commit):** the histogram's original single 10-term UNION ALL
  500'd ONLY on the deployed Workers runtime ("D1_ERROR: too many terms in compound
  SELECT" — node:sqlite accepted it; found via the dev-worker live probe + error_log 0045).
  Restructured as TWO 5-term compound SELECTs merged in JS. Two new guards: (a) a
  vitest source-level pin that every compound SELECT in admin.ts stays ≤5 terms, (b)
  workers-smoke Test 4 — the usage endpoint now runs on the real Workers runtime in the
  smoke (plus an owner seed + fetchApi headers). Tests 317→318.
- Assets: SW hibana-v320. admin.js v4, misc.css v3 (20 pages), tour.js v3,
  polish-batch.css v4 (19 pages), settings-page.js v4, i18n-en v5, i18n-fa v5 (dynamic
  ref in i18n.js), i18n.js v62. package.json 0.3.12.20→0.3.12.21. i18n 936/936.
- Verified: typecheck 0 · vitest 318/318 · build+wiring PASS · cache-bust PASS (6 files)
  · i18n 936/936 · Playwright 17/17 · smoke 20/20 · workers-smoke 5/5 · live: Usage tab
  renders on the dev worker with real data (17 features / top-10 / 14-day chart) as a
  seeded owner, member-deny gate verified on prod, EN+FA light+dark 390px no-overflow,
  contrast audit CLEAN, tour dot-jump verified live (step 1→3 via dot click).

- **v0.3.12.20 = Session 27 R2 (Alpine hard-load P0 fix + digest export + dark-mode polish):**
- **Review-round 2 summary** — the QA sweep (agent-browser + VLM screenshot audit) found
  a P0 as severe as Session 27's fabric bug: every Alpine component on Reports and
  Settings was DEAD on hard load since v0.3.12.3 (2026-09-10, the 317724e inline-script
  extraction). Plus a styling batch from the VLM audit and a new client-side digest
  export feature. SW v316→v318.
- **P0 — Alpine components dead on hard load (commit 5550991):** the inline-script
  extraction moved page scripts that register `Alpine.data` components to end-of-<body>
  with `defer` — but deferred scripts run in document order, so alpine.min.js (in <head>)
  had already walked the tree. On EVERY hard load: reports lost Snapshot/heatmap/activity
  chart ("report is not defined"; only the plain-JS feed lived), settings lost ALL 8
  components (~80 expression errors — prefs/views/account/avatar/theme/telegram/invites:
  language/calendar/timezone selects, password change, avatar, Telegram link, invites).
  The settings-page's own `alpine:init` "invites backup" never fired either (the event
  had already passed — dead listener since the extraction). Invisible to error-only
  trackers because Alpine logs *warnings*, not errors — two review rounds missed it.
  Fix: script tags moved before alpine.min.js (the mechanism boot.js's alpine:init queue
  drain was designed for). SOFT-NAV TWIN also fixed: Alpine's own MutationObserver
  auto-initialized the swapped <main> before nav.js finished injecting the page script
  (x-if/x-show effects error once and never re-render) — nav.js now pauses the observer
  (depth-counted) across the swap → script-load → initTree window.
  Regression net: e2e/alpine-hard-load.spec.ts (5 tests, verified to fail 4/4 on the
  unfixed tree — tracks the "Alpine Expression Error" console-warning class).
- **Feature — reports digest export (commit 1a5c62e):** "Copy as Markdown" + "Download
  CSV" on the reports page, purely client-side from the already-loaded Alpine scope (no
  new API). MD digest: snapshot counts + active-days tally + top activity periods,
  i18n'd (FA verified live on hibana.ir with real data). CSV: hibana-report-YYYY-MM-DD.csv
  with BOM (Excel + Farsi) and quoted cells. 13 new i18n keys (888→901).
- **Styling (VLM audit findings):** theme-aware select chevron (`--select-chevron` in
  variables/themes — explicit-light, explicit-dark AND auto-dark paths; RTL flip; no
  chevron on disabled selects), heatmap weekday labels 0.62rem/weight 500/no stacked
  opacity (was 8.8px + double-dimmed), two EMPTY `prefers-color-scheme` stubs removed
  (dead since written — app themes via data-theme, the working rules were already in
  themes.css).
- **Tooling:** check-cache-bust.mjs now scans JS string literals for the
  dynamically-injected asset class (i18n-fa.js lives in a JS literal, not HTML — the
  gate never covered it).
- Assets: SW hibana-v318. nav.js v2, reports-page.js v3, settings-page.js v3, i18n-en v3,
  i18n-fa v3 (dynamic), i18n.js v60, base.css v2, variables.css v5, themes.css v2,
  polish-ui.css v3, polish-batch.css v3. package.json 0.3.12.19→0.3.12.20. i18n 901/901.
- Verified: typecheck 0 · vitest 311/311 · build+wiring PASS · cache-bust PASS (9 files)
  · i18n 901/901 · Playwright 17/17 (12 + 5 new alpine/export tests) · live dev+prod:
  reports 4 sections + export buttons + 0 Alpine warnings, settings all 8 components
  live, digest verified with real prod data.

- **v0.3.12.19 = Session 27 (fabric compat P0 + modularization + backup/restore hardening
  + 54-test coverage)**:
- **Session 27 summary** — started as the modularization session, found a P0 on the way: the
  Session 26 fabric v5→6→7 security upgrades had silently broken EVERY pointer-driven
  interaction on both boards (canvas + notebook). Fixed via a completed v5 compat layer in
  the shim. Then: history.js extraction (both boards single-source undo/redo), the
  backup/restore audit (found + fixed a DEAD restore path), and 16 new tests taking the
  backup/restore system from 38 to 54 tests. Deployed dev + prod throughout.
- **P0 — fabric v6/v7 compat layer (commit ef8f9bc):** the v6 migration verified "all 14
  exports present" but missed method-level removals. Broken at HEAD since d46b159:
  `canvas.getPointer` (→ getScenePoint; 28 call sites — note/text/eraser/arrow/shape/
  sticky-close handlers all threw), canvas-level z-order API (→ bringObjectToFront etc.;
  frames-under-content on load + moveZ), auto-created freeDrawingBrush (pen drew nothing,
  setTool threw on undefined), textarea blur no longer exits editing (stuck editing twin
  when clicking DOM elements mid-edit), + whiteboard serializePath read c.x/c.y from
  command arrays (strokes would save [[null,null]]). All fixed in src/vendor/fabric-shim.ts
  (+ lazy PencilBrush in both setTools, command-array serializer). Found by writing the
  new e2e/notebook.spec.ts FIRST — the safety net caught what Session 26's "fabric loads,
  Canvas constructor available" check could not.
- **Modularization (Focus 1):** `public/js/history.js` — shared two-stack undo/redo
  (window.hibanaHistory.History: commit/log/commitAdd/dropLastAdd/clearRedo/undo(apply)/
  redo(apply)). whiteboard.js adopts it (?v=17, commit 85984fa), canvas.js adopts it
  (?v=23, keeping its pushHistory alias — 29 call sites untouched, commit 95be9ce).
  Behavior-preserving down to the eraser-path quirk (log() without redo-clear). Verdicts
  documented for the rest: canvas.js stays cohesive (state-object migration = ~1,000-line
  churn with no canvas E2E; only narrow-interface extractions are worth it), sticky-note
  factory duplication between boards has diverged (unification = consolidation project,
  not mechanical extraction), app.js/project-page.js/sadhana-page.js by-concern splits
  add the exact namespace fragility that caused the Phase 3a ReferenceError with no
  user-facing payoff, @media→responsive.css rejected on principle (feature-local media
  queries beat breakpoint-grouped files; screenshot-diff covers only 4/23 pages).
- **Tidy (Focus 2):** audit-results/{audit,contrast}-fn.js → e2e/fixtures/ (they are
  E2E test fixtures, not audit data; folder deleted; README/Agents doc lines updated).
- **Backup/restore hardening (Focus 3, commit a3a8bc5):** running the drills found real rot:
  (1) CRITICAL — restore.mjs was DEAD against schema 47 (hardcoded tableOrder emitted
  DELETE FROM changelogs; 0048 dropped it — every restore crashed "no such table"). Fixed
  by deriving the table list from the snapshot's own data keys (FK-safe ordered, dropped
  tables skipped with warnings, sqlite_master guard on the local path) — also permanently
  fixes the mirror-drift class (future SNAPSHOT_TABLES additions restore automatically).
  (2) The drill's own synthetic data used pre-0031 statuses (CHECK violation). (3) Both
  drills hard-failed without the owner-held BACKUP_ENCRYPTION_KEY — now Part A/channel-
  integrity runs with a LOUD skip, the synthetic round-trip still proves the mechanics.
  Audit results: SNAPSHOT_TABLES = complete + FK-safe (33/33 edges verified against the
  real FK graph; every non-snapshotted table is FTS/bookkeeping/transient —
  telegram_bot_sessions = bot navigation state, correctly excluded). OPS FINDING:
  planb_backups on prod is EMPTY — the Plan B Telegram channel has NEVER carried a real
  backup (owner action: trigger one via bot ⚙ Settings 🗄 or POST /api/admin/backup/planb,
  then re-run npm run drill:planb).
- **Test coverage (Focus 4, commit fbb42b1):** 311 total (was 295). New
  src/tests/restore.test.ts (11 — E2E through the REAL scripts/restore.mjs: FK-check
  clean, encrypted round-trips both shapes, wrong-key rejection, legacy plaintext,
  partial/cross-schema/forward-compat restores, 1,100-row large snapshots, concurrent
  restores) + src/tests/backup-audit.test.ts (5 — THE schema-change drift guard [a new
  user table missing from SNAPSHOT_TABLES fails CI], personal-export isolation with a
  generic ownership verifier, retention exactness, Plan B receive-side round-trip).
  The backup/restore system: 54 tests (was 38).
- Assets: SW hibana-v315 (v313 fabric fix, v314 history.js+whiteboard, v315 canvas
  adoption). whiteboard.js ?v=17, canvas.js ?v=23, new history.js ?v=1, manifest 70
  entries. package.json 0.3.12.18→0.3.12.19. i18n 888/888 unchanged.
- Verified: typecheck 0 · vitest 311/311 · build+wiring PASS · cache-bust PASS ·
  Playwright 12/12 (9 + 3 new notebook tests) · Workers-smoke 3/3 · drill PASS ·
  live-prod E2E: whiteboard note create→type→save→undo→tombstone round-trip on
  hibana.ir, Ali's 12 real notebook objects intact, zero console errors.
- v0.3.12.18 = **Security hardening + CI/CD + Lighthouse + UI/UX + image optimization** (patch):
- **Session 26 summary** — the most comprehensive session in Hibana's history. 40+ commits across
  SWOT audit, HTML canonical recovery, security/CI hygiene, performance optimization, dead-code
  removal, modularization, auth fixes, CI/CD infrastructure, security hardening, and UI/UX polish.
  295/295 vitest + 9/9 Playwright + 3/3 Workers-runtime tests green. 0 npm audit vulnerabilities.
  Deployed to dev + prod throughout.
- v0.3.12.18 = **Security hardening + CI/CD + Lighthouse + UI/UX + image optimization** (patch):
  - **Security (0 CVEs):** fabric 6→7 (SVG XSS), tar override (CRITICAL), CSRF headerless-caller
    tightened (T6), CSP audit (CORP + HSTS preload added), AI Magic Button rate-limited.
  - **CI/CD infrastructure:** npm audit gate, eslint (0 errors), bundle-size tracking, Playwright
    E2E + screenshot-diff + a11y (9/9 tests), Workers-runtime smoke test (3/3 — catches PBKDF2-type
    bugs), CD workflow (auto-deploy on merge), Lighthouse CI, Dependabot.
  - **Auth fixes:** case-insensitive email lookup (Nilooofar login bug), PBKDF2 600k→100k (Workers
    platform cap — registration was broken for a week). Nilooofar user added.
  - **Performance:** client-side image resize + WebP (3.5MB→~100KB), per-page CSS on public pages,
    lazy-load i18n-fa.js, font preload, Login.jpg media attr, morph swap (notebook), SW precache
    audit, etag on 3 endpoints, N+1 fix, build parallelization.
  - **Dead code (~130 items removed):** 10 dead scripts, 14 stale audit files, 40 dead exports,
    47 dead CSS classes, 65 dead i18n keys, migration 0048 (drop 2 superseded tables).
  - **Modularization:** sadhana-page.js TAGS+FUZZY extraction, projects/helpers.ts detail extraction.
  - **UI/UX (8 fixes):** neutral note borders, tap targets (44px), semantic color system, RTL arrow,
    active nav indicator, badge icon/label audit, Persian font verification.
  - **Cleanup:** d1_migrations backfill (46+47), unused imports removal, esbuild warnings fixed
    (3 dup i18n keys + navHTML const + --st-none CSS), branch protection documented.
  - **Assets:** SW hibana-v299→v312 (13 bumps). i18n keys 953→888. Schema 47 (migration 0048).
    package.json 0.3.12.14→0.3.12.18.
- v0.3.12.16 = **Session 26 Focus 2 performance batch — P1 through P12** (patch):
  - Per-page CSS on public pages, lazy-load i18n-fa.js, morph swap, font preload, Login.jpg
    media attr, logo Content-Type fix, etag on 3 endpoints, N+1 fix, build parallelization,
    SW precache audit. SW v299→v306. (Full details in the commit history.)
- v0.3.12.15 = **Session 26 hygiene batch — SWOT W1/T4/T2/T1/W8/W12** (patch):
  - **W1 (commit 5c449bc) — recover HTML canonical invariant:** commit c016fa4 (repo flatten)
    committed `public/*.html` in the WIRED state (referencing `/dist/<hash>`) with no
    `.build-backup/` canonical source — `--restore-html` was a false-positive no-op,
    `--wire-html` refused (safety guard). The next CSS/JS change could not deploy.
    Restored all 24 canonical HTML files from `c016fa4~1` (when they lived at
    `hibana/hibana-v0.3.10.2/public/`). Verified build-cycle idempotency (wire→restore =
    byte-identical), 295/295 tests, browser E2E renders with canonical CSS (VLM-confirmed).
    No SW/?v= bump (source CSS/JS unchanged — only HTML refs went /dist/ → /css/?v=).
  - **T4 (commit e3dae9f) — bump hono 4.13.3 → 4.13.7:** non-breaking patch. Fixes 3 CVEs:
    GHSA-g6gw-c38x-mqfc (parseBody dot-notation memory exhaustion — Hibana uses parseBody
    in auth.ts login), GHSA-gqvv-2mrq-wpjv (toSSG path-traversal, fix-incomplete),
    GHSA-crvj-82cr-hjcx (query parser post-fragment params → cache-key/proxy differential).
  - **T2 (commit 35594d0) — rate-limit logo upload route:** added `hitRateLimit(RATE_RULES.upload,
    clientIp(c))` to `PUT /api/projects/:id/logo` (projects/index.ts:395). Was the only upload
    route without a limiter — avatar (settings.ts:110) and screenshots (core.ts:279) both had
    it. 30 req/60s per IP. Closes a 3.5MB-upload-×-unlimited-requests DoS vector.
  - **T1 (commit de0e332) — hard-fail GitHub backup encryption in prod:** added prod guards at
    both `backupToGitHub` call sites in admin.ts (manual route POST /backup line 320,
    `scheduledBackup(cfg)` line 471). `cfg.isProd && !cfg.backupEncryptionKey` → refuse with a
    clear error. Matches `backup-planb.ts:80-84`'s refuse-plaintext pattern. Dev/test path
    unchanged (key still optional). Previously, a forgotten prod env var silently wrote
    plaintext snapshots to the GitHub assets repo with no alert.
  - **W8 (commit 697fc8c) — restore i18n parity check + wire into CI:** the old
    `audit-consistency.mjs` parity check broke in Phase 3c (commit 145a1aa) — it regex-parsed
    `i18n.js` for dict literals that had moved to `i18n-en.js`/`i18n-fa.js`. Created new
    `scripts/check-i18n-parity.mjs` that reads the split dict files directly, loads each in a
    `node:vm` sandbox (`window.__hibanaDictEN/__hibanaDictFA`), flattens keys recursively,
    compares. Wired into `package.json` (`check:i18n-parity`) + `.github/workflows/ci.yml`
    (new step between cache-bust and unit tests). 953/953 parity confirmed. Future EN/FA key
    drift will now fail CI instead of silently falling back to English strings for FA users.
    `audit-consistency.mjs` left as-is — its other 2 checks are superseded by CI gates (will
    be removed in a future W13 dead-code sweep).
  - **W12 (commit 13d842d) — doc-drift sweep:** Agents.md + README.md + Changelogs.md. Fixed:
    schema 44→46, tests (244)→(295), keys 871/871→953/953, SW v301→v299 (actual code value),
    migrations 0001–0045→0001–0047. Historical changelog entries (v0.3.5–v0.3.9.1 test counts)
    left as-is — accurate for their era.
  - **Verification:** typecheck 0 errors · i18n parity 953/953 PASS · vitest 295/295 · build
    PASS · check-dist-wiring PASS · build cycle idempotent. Browser E2E on local Node server:
    login → /app dashboard, zero console/page errors.
  - **Assets:** no CSS/JS asset changes — no `?v=` bumps, no SW version bump (the SW stays at
    `hibana-v299`; only the SW *logic* would trigger a bump, not a backend/doc/CI change).
    package.json 0.3.12.14→0.3.12.15.
- v0.3.12.14 = **Session 25: comprehensive CSS + JS + TS architecture refactor — ~31,000 lines modularized across ~61 new files**
- **Session 25 summary** — pure refactoring session (zero behavior change). A comprehensive
  architecture refactor across CSS, JS, TS, and HTML — ~31,000 lines of monolithic code
  modularized into ~61 new files. No schema changes, no new i18n keys, no behavior
  changes. 295/295 tests green throughout. Every change VLM-verified "IDENTICAL" or
  "RENDERED CORRECTLY" via screenshot comparison. Deployed to dev + prod at every step.
  Repo flattened (Hibana moved from `hibana/hibana-v0.3.10.2/` to repo root).
- v0.3.12.4 = **Session 25 final — sadhana.ts + quicknotes.ts split + notifications.html
  inline JS extraction + repo flatten** (patch):
  - **sadhana.ts (1,029 → 932 + 137):** extracted 17 helpers (schemas, constants, types)
    → `sadhana-helpers.ts`.
  - **quicknotes.ts (591 → 323 + 311):** extracted 20 helpers (HTML renderers, schemas,
    types) → `quicknotes-helpers.ts`. Added re-exports for backward compat (dashboard.ts,
    projects/helpers.ts, ics-export.ts import QuickNote/notebookHtml from quicknotes).
  - **notifications.html:** 23-line inline JS → `js/notifications-page.js`. Completes
    Phase 2 — ALL 23 HTML files now have 0 inline `<script>` blocks >5 lines.
  - **Repo flatten:** moved Hibana from `hibana/hibana-v0.3.10.2/` to repo root. Deleted
    sandbox wrapper files (Next.js/Prisma/shadcn template — not part of Hibana). CI
    workflow now visible to GitHub Actions.
- v0.3.12.3 = **Session 25 Category 1-6 — extract remaining inline CSS/JS + split TS
  helpers + Jalali extraction** (patch):
  - **sadhana.html inline `<style>` (827 lines) → `css/sadhana-board.css`:** the biggest
    single inline block — should have been in Phase 1.
  - **clip.html inline `<style>` (22 lines) → `css/clip.css`.**
  - **11 HTML inline JS extractions:** calendar(891) + settings(571) + sparks(516) +
    projects(510) + board(467) + reports(125) + signup(148) + clients(79) + clip(100) +
    confirm(68) + 404(31) = 3,520 lines → 11 external `.js` files.
  - **telegram.ts helpers (333 lines) → `integrations/telegram-helpers.ts`:** 40 exports
    (session mgmt, createQuickNote, keyboard builders, render, etc.).
  - **devboard.ts helpers (66 lines) → `devboard-helpers.ts`:** 6 exports (logHistory,
    ownedTask, ownedCategory, ownedSprint, ownedBacklogDoc, loadBacklog).
  - **sadhana-page.js Jalali calendar (67 lines) → `js/jalali.js`:** g2j, j2g, jalaliLeap,
    jMonthDays2, nowJalali, jalaliWeekNum, J_MONTHS, etc. + toFa digit converter. Exposed
    via `window.__hibJalali`. sadhana-page.js: 1,913→1,846 lines.
  - Total: ~4,821 lines → 15 new modular files.
- v0.3.12.2 = **Session 25 Phase 3 — JS file modularization** (patch — continuation):
  - **Phase 3c (i18n.js — COMPLETE):** clean data/logic split. 1,451 lines → 3 files:
    `i18n.js` (150 lines logic) + `i18n-en.js` (656 lines EN dictionary) +
    `i18n-fa.js` (653 lines FA dictionary). Dictionaries exposed as
    `window.__hibanaDictEN`/`window.__hibanaDictFA`, loaded before i18n.js. Key parity
    maintained (586/586 matching keys). VLM-confirmed TRANSLATIONS CORRECT for EN+FA.
  - **Phase 3a (app.js — COMPLETE):** extracted DOMContentLoaded handlers using shared-
    namespace pattern. Created `window.__hib` namespace inside IIFE, exposed 70 internal
    functions via `Object.assign`. Extracted 328 lines of init handlers → `hib-init.js`
    (336 lines). `app.js`: 3,094 → 2,768 lines (−10%). `hib-init.js` destructures shared
    helpers from `window.__hib`. Bug found + fixed: `Object.assign` initially referenced
    5 functions defined inside the DOMContentLoaded handlers (now in hib-init.js), not in
    app.js IIFE scope → ReferenceError → IIFE crashed → `window.hibana` undefined. Fixed
    by removing them from Object.assign. VLM-confirmed RENDERED CORRECTLY, theme toggle
    works, zero console errors.
  - **Phase 3b (canvas.js — DEFERRED):** structural analysis shows canvas.js CANNOT be
    safely split without major risk. 3,061 lines, 126 function declarations, ALL sharing
    IIFE closure scope. 64 `let` mutable state variables (canvas instance, tool mode,
    element map, undo stack, clipboard, etc.). 340 references to `canvas` variable, 30 to
    `elems`, 38 to `mode` — pervasive shared state. Unlike app.js (which had extractable
    DOMContentLoaded handlers), canvas.js has NO separation between init code and function
    definitions. Splitting would require exposing 64+ mutable variables to a
    `window.__hibCanvas` namespace — high risk of subtle timing bugs with no clear benefit.
    DECISION: canvas.js remains as one cohesive stateful module.
  - **Build pipeline:** `ENTRY_POINTS` grew 23→25 (added i18n-en.js, i18n-fa.js, hib-init.js).
    Manifest 49→52 entries.
  - **Verification:** typecheck 0 err, 295/295 tests, build PASS, check-dist-wiring PASS.
    VLM-confirmed all changes correct. Deployed dev+prod.
  - **Assets:** i18n.js ?v=55→56, new i18n-en.js/i18n-fa.js at ?v=1, app.js ?v=171→172,
    hib-init.js ?v=1, SW v296→v297→v298, manifest 49→52 entries, package.json 0.3.12.1→0.3.12.2.
- v0.3.12.1 = **Session 25 Phase 1.5 + Phase 2 — by-concern CSS extraction + inline JS
  externalization** (patch — continuation of v0.3.12.0 refactor):
  - **Phase 1.5a (themes.css):** extracted 75 dark-theme rules from 10 modular CSS files
    into `themes.css` (302 lines). SAFE by specificity: `html[data-theme='dark']`
    selectors (0,2,1) > base `.x` (0,1,0) — they win by specificity, not source order.
    Sources: variables(2), layout(2), dashboard-todo(1), canvas(8), quicknotes(28),
    to-do-list(5), notifications(11), polish-batch(8), project-header(5), devboard(5).
    Loads LAST among feature files. VLM-confirmed dark mode IDENTICAL.
  - **Phase 1.5b (rtl.css):** extracted 21 RTL directional-override rules from 12 files
    into `rtl.css` (64 lines). SAFE by specificity: `[dir='rtl']` prefix (0,1,0) beats
    base. Sources: layout(1), dashboard(2), dashboard-todo(1), components(2),
    quicknotes(1), to-do-list(1), calendar(1), notifications(1), polish-batch(16),
    project-header(1), devboard(5), misc(4). Loads after themes.css. VLM-confirmed
    FA/RTL light + dark IDENTICAL.
  - **Phase 1.5c (@media extraction DEFERRED):** 93 @media blocks NOT extracted to
    `responsive.css`. Risk: @media rules have SAME specificity as base rules, so source
    order is load-bearing. Unlike dark/RTL (higher specificity, always win), @media
    extraction requires exhaustive per-rule analysis. Value (one more file) doesn't
    justify risk in this session.
  - **Phase 2 (inline JS extraction):** extracted 5,064 lines of inline JS from 3 HTML
    files into 3 external .js files:
    1. `js/project-page.js` (2,060 lines) ← project.html lines 61-2120.
       project.html: 2,122→61 lines. Uses `window.__hibanaPage({mount(ctx){...}})`
       registration pattern — queue buffers until app.js ready. `defer` safe.
    2. `js/sadhana-page.js` (1,913 lines) ← sadhana.html block 2 (lines 1029-2941).
       sadhana.html: 2,944→1,030 lines. Block 1 (3-line theme pre-paint) KEPT INLINE —
       load-bearing for FOUC prevention (must run synchronously in <head> before paint).
    3. `js/sprint-page.js` (1,091 lines) ← sprint.html lines 89-1179.
       sprint.html: 1,182→90 lines. Same __hibanaPage pattern as project.html.
  - All 3 HTML files are STATIC (no server-side template variables). The `${}` in inline
    JS were JS template literals (`/api/projects/${id}`), not server templates. Hono
    routes render HTML fragments for htmx swaps, not the static pages.
  - **Build pipeline:** `ENTRY_POINTS` in build.mjs grew 20→23 (added project-page.js,
    sadhana-page.js, sprint-page.js). `CSS_ENTRY_POINTS` grew 17→18 (Phase 1.5a) →19
    (Phase 1.5b). Manifest 44→49 entries. Each new file → own content-hashed /dist/
    artifact → independent cache invalidation.
  - **Verification:** typecheck 0 err, 295/295 tests, build PASS, check-dist-wiring
    PASS at every step. VLM-confirmed all 3 HTML pages "RENDERED CORRECTLY" with zero
    console errors. Prod live probe: sadhana page works in FA mode ("لیست کارها —
    هیبانا"), zero console errors.
  - **Assets:** 3 new JS at ?v=1, themes.css ?v=1, rtl.css ?v=1, SW v293→v294→v295→v296,
    manifest 44→49 entries, package.json 0.3.12.0→0.3.12.1.
- v0.3.12.0 = **Session 25 Phase 1 — app.css → 16 modular CSS files** (Option A: contiguous
  chunks). Minor version bump signals architecture change; `.0` patch signals zero
  behavior change.
  - **Why:** app.css had grown to 8,822 lines — unmaintainable. Single file contained
    EVERYTHING: reset, variables, layout, components, pages, themes, RTL, responsive.
    Every CSS edit required scrolling a 8.8K-line file; cache-bust on any change busted
    the entire 224KB bundle for all 23 pages.
  - **Strategy choice (Option A over Option B):** the file was organized
    chronologically (by session/feature), NOT by concern. Dark-theme rules (73
    selectors), RTL rules (20 selectors), and @media queries (93 blocks) were
    SCATTERED throughout — not in contiguous blocks. Option A (split at section
    boundaries, keep concerns inline in their feature chunk) was chosen because it
    guarantees zero cascade change structurally (concatenation == original). Option B
    (extract by concern into themes.css/rtl.css/responsive.css) is deferred to
    Phase 1.5 — requires specificity analysis to prove safety.
  - **The 16 files** (line ranges from original app.css, in source order):
    1. `variables.css` (1–260, 260 lines) — `:root` custom properties + `html[data-theme]`
       variable blocks + `@media (prefers-color-scheme)`.
    2. `base.css` (261–604, 344) — reset (`*{box-sizing}`), body/html/typography/links,
       auth page, forms & buttons (global element styles).
    3. `layout.css` (605–1108, 504) — app shell, status/chips, loading/empty, project
       lists, wireframe card, hurdles/lists, media, dashboard stats.
    4. `dashboard.css` (1109–1535, 427) — dashboard projects strip (carousel), at-a-glance
       strip, idea folders, dash-resume.
    5. `dashboard-todo.css` (1536–2175, 640) — dashboard to-do quadrants, collapse sections,
       smart empty states, FAB. (Split from dashboard.css at the .dash-resume/@media
       boundary — natural break before to-do section.)
    6. `components.css` (2176–2453, 278) — FAB, native dialog modal, toast, ping/status,
       spinner, theme toggle button.
    7. `canvas.css` (2454–3128, 675) — canvas/whiteboard UI, squig batch, notebook page,
       sticky kanban, drag&drop, reports chart, misc.
    8. `quicknotes.css` (3129–4010, 882) — dashboard quick notebook, quick-note↔project
       attach, FAB modal, sparks shelf, profile menu, auth split-screen, responsive topbar.
    9. `to-do-list.css` (4011–4824, 814) — Sadhana standalone board: collapsed row, progress
       dots, state selector, checkbox, expandable section, actions/notes panels, inline
       title editor, emoji badges, legacy hover, to-do polish. (Renamed from internal
       codename "sadhana" — owner request: no internal codenames in filenames.)
    10. `polish-ui.css` (4825–5472, 648) — shadcn-style polish, command palette, skeleton
        shimmer, toast upgrade, dashboard today strip, project detail tabs, Sadhana
        focus-mode, settings tabs, reports heatmap.
    11. `calendar.css` (5473–5884, 412) — calendar view, day creators, right-click day menu,
        activity timeline, on-this-day, print stylesheet.
    12. `notifications.css` (5885–6240, 356) — notification center, saved filters, search
        upgrades, avatar skeleton, command palette tag swatch.
    13. `polish-batch.css` (6241–6835, 595) — R4.3–R9.3 polish batch: styling polish,
        onboarding tour, counter animation, voice quick-add, sticky table header, reports
        dark-mode, settings help, go-to hint, tooltip wiring, done chip, reports bar-chart,
        weekend/holiday, calendar legend, Shamsi today, Task 24 month-heading.
    14. `project-header.css` (6836–7488, 653) — project logo (0047), redesigned project
        header, inline board preview, Session 23 code blocks, composer formatting toolbar,
        upcoming plan tab.
    15. `devboard.css` (7489–8081, 593) — board page (board.html), task editor modal, sprint
        page (sprint.html), sprint timeline circles.
    16. `misc.css` (8082–8822, 741) — 404 stage + embers, misc items (Latin runs in notes,
        DONE state, pglance boxes, view dropdown, grey labels, progress track, sprint
        lifecycle, emoji picker, quick notes clamp, page width).
  - **Build pipeline:** `CSS_ENTRY_POINTS` in `scripts/build.mjs` expanded from
    `['app.css', 'task-controls.css']` (2) to 17 entries. Each file → esbuild → own
    content-hashed `/dist/FILE.<hash>.css` → own manifest entry. Independent cache
    invalidation per file (a tweak to `components.css` no longer busts `variables.css`).
  - **HTML wiring:** all 23 HTML pages updated — single `<link href="/css/app.css?v=267">`
    replaced with 16 `<link href="/css/FILE.css?v=1">` tags in source order. Source order
    is load-bearing: the 16 files MUST load in the order listed above to reproduce
    app.css's original cascade (documented in build.mjs comment).
  - **Verification (3 levels of zero-behavior-change proof):**
    1. Structural — `cat variables.css base.css … misc.css | diff -q app.css` →
       BYTE-IDENTICAL (concatenation == original).
    2. Rendering — light mode screenshots (EN/LTR + FA/RTL) MD5-identical to baseline.
    3. Visual — VLM (vision model) confirmed dark mode screenshots: "IDENTICAL — zero
       visual difference."
  - **Cache-bust:** SW `hibana-v292`→`v293` (manifest grew 29→44 entries; existing PWA
    clients re-fetch manifest + precache new /dist/ files). All 16 new CSS files ship at
    `?v=1` (fresh version namespace — independent from the old app.css ?v=267 lineage).
  - **Pre-existing esbuild warnings:** 2 CSS-syntax warnings on a one-line `--st-none`
    custom property declaration (was `app.css:1695`, now correctly located in
    `dashboard-todo.css:160`). Pre-existing, not introduced by this refactor.
  - **Assets:** app.css ?v=267 (deleted) → 16 files at ?v=1 each, SW v292→v293, manifest
    29→44 entries, package.json 0.3.11.14→0.3.12.0.
  - **Follow-up (Phase 1.5):** Option B — extract dark-theme → `themes.css`, RTL →
    `rtl.css`, @media → `responsive.css` for true by-concern modularity. Requires
    specificity analysis to prove cascade safety before moving any rules.
- v0.3.11.14 = **Session 24h — project card redesign** (app.css + projects.ts):
  - Removed the hatched diagonal corner decoration (`.pc-corner` element) — looked like an
    unfinished placeholder, added visual clutter.
  - Left-aligned title + description (was centered) — conventional dashboard reading flow,
    auto-mirrors for RTL via logical `start` properties.
  - Title: 1.3rem→1.15rem, explicit `font-weight: 600` — clearer focal point.
  - Hover: flat bg swap → `translateY(-2px)` + soft warm shadow + stronger border (0.15s
    transition) — cards feel alive, not flat/static.
  - Gap: 0.6rem→0.5rem — tighter, more consistent vertical rhythm.
  - Assets: app.css ?v=266→267, SW v291→v292.
- v0.3.11.13 = **Session 24g — stage badge after title** (projects.ts + app.css):
  - Swapped header order: was `[logo][badge][title]`, now `[logo][title][badge]`.
  - `#pd-title` flex:1→flex:0 1 auto so the badge sits right next to the title, not pushed
    to the far end.
  - Assets: app.css ?v=265→266, SW v290→v291.
- v0.3.11.12 = **Session 24f — compact project header** (projects.ts + app.css):
  - Merged the old 2-row layout (logo+actions row AND badge+title row) into ONE main row.
  - Description: rows=2→1, tighter padding, smaller min-height.
  - Tags + meta merged into one spread row (tags left, meta+progress right).
  - Logo: min 64px→40px, max 128px→56px, radius 16px→12px.
  - Grid gap: 0.7rem→0.4rem. Progress boxes now appear ~210px higher on the page.
  - Assets: app.css ?v=264→265, SW v289→v290.
- v0.3.11.11 = **Session 24e — magic-wand dialog-mount + pastel purple** (magic-wand.js + magic-wand.css):
  - Root cause: wand was `position:fixed; z-index:60` on `document.body`. When a `<dialog>`
    modal opened (`showModal()`), the dialog rendered in the browser's top layer — above ALL
    z-indexes — trapping the wand under the modal backdrop → invisible.
  - Fix: `showWand(el)` now moves wand + backdrop + popover into the nearest open `<dialog>`
    (inherits top-layer positioning). Consistent appearance on page + inside modals.
  - Theme: `--mw-accent` brown `#6b4f3a` → pastel purple `#8B7AB8` (light) / `#C4B5E0`
    (dark). Popover bg → `#F5F0FA` (light) / `#2A2440` (dark).
  - Assets: magic-wand.css ?v=2→3, magic-wand.js ?v=9→10, SW v288→v289.
- v0.3.11.10 = **Session 24d — delete button class fix** (project.html):
  - `#pde-delete` was `class="ghost danger"` → CSS rule `.ghost.danger:not(.btn):not(.small)`
    forces 1.75rem (28px) square = looked like a pink circle.
  - Changed to `class="btn danger"` → proper padded text button with danger palette.
  - Assets: SW v287→v288.
- v0.3.11.9 = **Session 24c2 — line-by-line digit conversion** (canvas.js + whiteboard.js):
  - v0.3.11.8's script-detection checked the entire text element — mixed-script text
    (Farsi line + English line) converted ALL digits to Persian.
  - Fix: process LINE BY LINE. Each line independently checks for Farsi letters.
    `سلام 123\nHello 123` → `سلام ۱۲۳\nHello 123`.
  - Assets: canvas.js ?v=20→21, whiteboard.js ?v=14→15, SW v286→v287.
- v0.3.11.8 = **Session 24c — digit conversion restored with script-detection** (canvas.js + whiteboard.js):
  - v0.3.11.7 overcorrected (removed auto-conversion entirely → everything Latin).
  - Fix: digits match the SCRIPT of the text. Farsi letters → Persian digits; Latin-only →
    Latin digits. Same first-strong-character heuristic editors use for RTL/LTR.
  - Assets: canvas.js ?v=19→20, whiteboard.js ?v=13→14, SW v285→v286.
- v0.3.11.7 = **Session 24b hotfix release** — 4 fixes from Ali's live feedback on v0.3.11.6
  (project.html inline JS + app.css + projects.ts + canvas.js + whiteboard.js; no schema
  changes, no new i18n keys):
  - **Copy-all still truncated at "read more" (root cause, revised)**: the v0.3.11.6 fix
    had a DOM fast-path (read textContent when column expanded) + a DOM fallback (on fetch
    failure). textContent SHOULD include the hidden .pd-title-rest span, but Ali still saw
    truncation at the 150-char "read more" boundary. Now `pdColItems` ALWAYS fetches from
    `/api/projects/:id` and uses `t.title` (the FULL untruncated title from the database) —
    no DOM paths at all, bulletproof. If the fetch fails, returns empty (no silent DOM
    fallback that could truncate).
  - **Delete button "looks like a circle" (user report)**: the #pde-delete button had an
    SVG trash icon + text, but the icon was taking the button's space and the text was
    pushed out of view — rendering as an icon-only circle. Removed the SVG; the button is
    now text-only ("Delete" / "حذف"), matching Cancel and Save (which are also text-only).
  - **Logo radius too large + renders row-by-row (user report)**: 64px border-radius on a
    64px-square logo = 50% = perfect circle (not "soft rounded" as intended). Revised to
    16px — soft, modern, rounded corners that never circularize any logo size (64px or
    128px). Also fixed the performance issue ("renders row by row"): the logo endpoint had
    `Cache-Control: private, no-cache` → the browser re-fetched the logo from the GitHub
    assets repo (via the Worker) on EVERY page load. Changed to
    `public, max-age=3600, stale-while-revalidate=604800` (1h fresh, 1 week stale) — logos
    rarely change, and the browser now caches them. Added `loading="lazy"` +
    `decoding="async"` to the `<img>` tag for non-blocking decode.
  - **Canvas/whiteboard always Persian numerals (root cause)**: canvas.js:2363 +
    whiteboard.js:982 had a `text:changed` handler that auto-converted ALL Latin digits to
    Persian when the UI was FA — regardless of the user's active keyboard layout. So if
    Ali alt-shifted to English and typed numbers, they were force-converted to Persian.
    Ali's desired behavior: "ENGLISH → LATIN NUMERALS, FARSI → FARSI NUMERALS — if user
    alt-shift and changed language numerals will have to change as well." Fix: removed the
    auto-conversion entirely. Now the numerals match the KEYBOARD: English keyboard →
    Latin (0-9), Farsi keyboard → whatever the layout produces. The UI language no longer
    overrides the user's active keyboard layout.
  - Verified locally: typecheck green, 295/295 tests, node --check on sw.js + canvas.js +
    whiteboard.js OK, cache-bust PASS (3 files: app.css, canvas.js, whiteboard.js).
  - Assets: `app.css` ?v=263→264 (23 pages), `canvas.js` ?v=18→19, `whiteboard.js`
    ?v=12→13, SW `hibana-v284`→`v285`, `package.json` 0.3.11.6→0.3.11.7.
- v0.3.11.6 = **Session 24 hotfix release** — 4 fixes from Ali's live feedback (project.html
  inline JS + app.css; no schema changes, no new i18n keys):
  - **Progress-box copy truncates at 5 items (root cause)**: the server renders only
    MAX_VISIBLE=5 items per column into the DOM (Session 19). `pdColItems` read `.pd-task`
    from the DOM → copy/export only ever saw the first 5. Now `pdColItems` is async and
    fetches the full task list from `/api/projects/:id` (same endpoint the "more" button
    uses) when the column isn't fully expanded, so copy/export always see EVERY item.
    Fast path: if the column is expanded (`data-expanded="1"`), reads from the DOM directly.
  - **Magic wand only appears on first 5 items (root cause)**: `injectPdTaskMenus()` sets
    `data-magic` on `.pd-task-title` elements. It runs on page load + htmx swaps, but the
    "more" expand handler inserted new `.pd-task-wrap` elements WITHOUT calling
    `injectPdTaskMenus()` afterward → expanded items 6+ never got `data-magic` → wand
    never appeared. Fixed: `injectPdTaskMenus()` is now called after the expand loop
    inserts hidden items. Idempotent (`:not([data-menu-ok])` guard) — safe to re-run.
  - **Delete from inside the edit modal (user request)**: the inline task editor modal
    (`#pde-form`) had Title + toolbar + Status + Priority + Cancel + Save but NO delete.
    Delete only existed in the card's ⋯ hover menu. Now a red ghost Delete button sits on
    the left of the modal's button row (Cancel + Save stay on the right). Handler reuses
    the exact card-menu delete recipe: optimistic remove + decrement count + keep
    `data-pd-total` in sync + Undo toast → `DELETE /api/devtasks/:id`. No confirm dialog —
    matches the existing card-delete UX (Undo is the safety net).
  - **Project logo radius (user request: "need 64px radius… soft, modern, rounded")**:
    `.pd-logo` had `border-radius: 0` (hard square corners). Now `border-radius: 64px` —
    soft, modern, rounded edges on any uploaded logo (square logos become circular;
    rectangular logos get fully-rounded short edges). The placeholder keeps its
    `--radius-sm` (it's a dashed-border upload prompt, not a logo image).
  - Verified locally: typecheck green, 295/295 tests, `node --check sw.js` OK, cache-bust
    PASS. HTTP-based E2E on the local Node server (PORT=3001): login OK, htmx fragment
    renders 5 task cards + "+3 more" button (confirms MAX_VISIBLE root cause), API returns
    all 8 tasks (confirms copy-all fetches full list), inline JS serves all 3 fixes
    (`injectPdTaskMenus()` after expand, `#pde-delete` in modal, `pdColItems` async +
    fetch), `border-radius: 64px` on `.pd-logo`, SW `hibana-v284`, `app.css ?v=263` on 23
    HTML pages. Playwright browser E2E attempted but sandbox process-reaping prevented
    multi-step browser tests within a single bash call; static + HTTP verification covers
    all code paths.
  - Assets: `app.css` ?v=262→263 (23 pages), SW `hibana-v283`→`v284`, `package.json`
    0.3.11.5→0.3.11.6.
- v0.3.11.5 = **Session 23 hotfix release** — 5 fixes from Ali's live feedback (CSS + JS +
  i18n keys + one TS renderer; no schema changes):
  - **English dropdown items in FA locale (root cause)**: the inline task editor's
    Status/Priority selects used `_t('status.idea'|'prio.low'|…)` — those keys NEVER
    existed (the dicts only carry the 7-stage project taxonomy), so FA fell back to raw
    English "idea/planned/in_progress/done/bug" + "low/medium/high/urgent". Now the
    selects reuse the BOARD's translated keys (db.st.idea/planned/inprog/done/bug +
    db.pr.*) — the dropdown matches the column names the owner already sees
    (ایده‌های جدید / برنامه آتی / در حال انجام / انجام‌شده / مشکلات / کم / متوسط /
    زیاد / فوری). EN unchanged (New Ideas/Upcoming Plan/In Progress/Implemented/Problems).
  - **RTL text editors in FA (root cause)**: all three task editors hardcoded
    dir="auto" — the first-strong-char heuristic keeps the editor LTR whenever the
    first typed character is Latin/numeric, so Farsi writing read misaligned. All now
    follow the UI locale (fa → rtl, else auto — the recipe the description/note
    editors already used): #pd-taskadd-textarea, #pde-input, the board editor's
    textarea + modal card, plus the backlog composer + full-screen plan editor.
    Rendered CODE blocks stay LTR islands regardless (see below).
  - **Editor options + dedicated CODE container (owner: "many times my tasks have Codes
    in them, mostly html css")**: task titles now carry fenced ``` code blocks, **bold**
    and manual line breaks. A formatting toolbar (Code / Bold / Bullet — کد/پررنگ/بولت
    in FA, 6 new i18n keys) sits above the textarea in all three composers (add modal,
    inline edit dialog, board editor); Code wraps the selection in fences or drops an
    empty block at the caret. Newlines are PRESERVED on save everywhere (was collapsed
    to spaces; only \r\n normalized + outer trim; the problems-box line-splitting
    composer keeps its per-line behavior by design). Rendering — ONE renderer ported
    to three sites (routes/projects.ts renderTitle, project.html pdRenderTitle,
    board.html renderTitle): escape-first line-walk; fence lines open/close
    `<code class="t-code" dir="ltr">` — monospace, soft inset surface, pre + horizontal
    scroll, an optional data-lang label (```css → "CSS"), an LTR island inside RTL
    cards; prose lines get **pair** → <strong>; titles render multi-line
    (white-space: pre-line). The ``` fence LINES live in `<span hidden class="t-fence">`
    markers INSIDE the <code>, so the title's textContent still reads the RAW title
    EXACTLY — every textContent consumer (editors' prefill, magic wand, quick-copy,
    Markdown export, delete-undo) round-trips with zero changes; unclosed fences render
    as code till end (self-healing); the Session-22 150-char clamp + read-more work
    unchanged (both halves rendered through the same renderer). A specificity twin
    `html[lang='fa'] .t-code` keeps the container monospace against the
    `html[lang=fa] body *` Vazir rule (Vazir sits last in the stack so Farsi comments
    inside code still render).
  - **ذخیره green (owner: "must be green like other buttons of the system")**: the
    inline editor's #pde-save and the board editor's data-db-save carried class="btn"
    (the neutral card-bg style) while every primary action in the system is a plain
    <button> (the --cta green fill + white text). Both dropped the class → #2E7B7F +
    white, matching افزودن/Add and every other CTA.
  - **Vanished + FAB (root cause, verified live on hibana.ir before fixing)**: the
    onboarding tour (shipped v0.3.11.2) highlights the FAB at step 1 — but the FAB's
    z-index:81 was trapped inside .fab-stack's stacking context (z-index 40), BELOW
    the tour overlay (z-index 80, 62% black + blur): during the tour the FAB rendered
    INVISIBLE + unclickable under the veil (elementsFromPoint proved the overlay on
    top). Fresh browsers / cleared storage / a second device re-trigger the tour →
    "the + cta button … is vanished". Fixed with `.fab-stack:has(.tour-target)` and
    `.topbar:has(.tour-target)` → z-index 82 (same trap hit step 2's theme toggle in
    the z-30 sticky topbar). Verified: fresh browser now shows the FAB above the dim,
    ring + pulse visible, clickable; skip/end restores normally.
  - **Hover bug (owner: "in hover, buttons turn green, text becomes light — fix hover
    bug")**: `button:hover` (0,1,1) sets green bg + white text globally; any
    single-class button rule whose :hover only overrides color/border LEAKED the green
    fill under dark/brand text — mixed green+dark pills everywhere. 12 rules now carry
    the FULL green+light recipe explicitly (.fab-item, .db-seg button, .db-add,
    .pd-read-more, .pd-more-link, .stat-arrow, .zen-exit, .sp-sprint-chip, .sf-chip,
    .sf-more, .pd-tag-add, .spark-folder-new) and 2 content-surfaces got their intended
    neutral bg reset on hover (.spark-folder-card, .dash-collapse-btn). Verified with
    real mouse hovers: #276A6D + #fff on db-add, db-seg buttons, fab-item (transition
    mid-frames initially misread as muted — final states re-verified).
  - Verified locally: typecheck green, 295/295 tests, smoke ALL PASS, cache-bust PASS;
    browser E2E on the local Node server (PORT=3001) — FA + EN × light + dark ×
    1280/390: FA dropdown labels, RTL editors, toolbar flows (Code button inserts
    fences at the caret; caret lands inside the block), CSS+HTML code tasks round-trip
    add→card→edit-prefill→save→card on BOTH surfaces, textContent exact, mono font in
    FA, dark container colors, 0 hscroll at 390px (long code scrolls inside the block),
    0 console/page errors across projects/sparks/board/sprint/project. Local fixture
    project deleted after the run.
  - Assets: app.css ?v=261→262 (23 pages), i18n.js ?v=54→55 (all pages), devboard.js
    ?v=10→11 (board + sprint ×2), SW hibana-v282→v283 (precached HTML shells rotate —
    project/board markup changed), package.json 0.3.11.4→0.3.11.5.
- v0.3.11.4 = **Session 22 hotfix release** — 3 fixes from Ali's live feedback (CSS + JS +
  two Zod caps lifted; no schema changes):
  - **Task-composer modals actually open big now (root-cause fix)**: the v0.3.11.1 "50%
    larger taskadd modal" NEVER rendered — `.pd-taskadd-modal` (0,1,0) lost the cascade to
    `dialog.dialog`'s `max-inline-size: min(26rem, 92vw)` (0,1,1), so the composer (and the
    "full screen" pd-editor-modal, intended 60rem) were stuck at 416px. Fixed with
    `dialog.`-prefixed rules + an explicit `inline-size` (a native <dialog> is
    fit-content; a max only caps). New sizes: taskadd + inline task-edit dialogs
    min(78rem, 96vw) (≥50% over the 52rem Session 19 intended; ~3× what actually
    rendered), pd-editor-modal 60rem, board db-modal 34→52rem. Textareas: taskadd
    12→18rem min + `resize: vertical`, rows 4→8 (add) / 3→8 (edit); board editor title
    converted from a single-line `<input maxlength=300>` to a 9rem-min textarea.
  - **300-char limit halted — titles unlimited, cards clamp at 150 chars**: every FE cap
    removed (taskadd "۰ / ۳۰۰" counter element + taskAddCounter JS, edit-dialog
    maxlength=300, board-editor input maxlength=300, problems-tab inline-edit
    input.maxLength=300 — the last three silently truncated data despite the server
    accepting 2000 since v0.3.11.1). Server: devboard.ts title caps 2000 → 100k sanity
    guard (Zod stays, rule 10; 100k is beyond any real title + under the Workers body
    limit). Display: progress boxes + board show the first 150 CHARS — the rest lives in
    a hidden `.pd-title-rest` span INSIDE the title element, so `textContent` (magic
    wand, inline editors, copy/export, delete-undo, delete-confirm) keeps reading the
    FULL title; a real `[data-task-read-more]` button toggles it (was the 3-line CSS
    line-clamp + ::after hint, project page only). Wand writes re-clamp via a
    `hibana:title-written` event.
  - **Board↔progress-box color consistency (owner: "project page shows labels with
    different color codings, the full-screen board shows all of them orange")**: root
    cause — `.db-card:has(.prio-medium)` still hard-coded an ORANGE left border (the
    Session-19 column-color fix was only applied to the pd side; the "Same for db-card"
    comment was false) and most tasks are prio-medium, so every board column read
    orange. The board now uses the exact pd recipe: card left border = column color via
    `--db-c`, only low/high/urgent flag their own color, medium keeps the column color;
    urgent keeps the tint + bold title. Also fixed while unifying: board prio-dots were
    INVISIBLE (`background: inherit` at 0,2,0 beat the .prio-* classes at 0,1,0 →
    transparent, and the referenced `--prio-color` token was defined nowhere) — now the
    pd !important priority recipe; db-col light inks were pre-Session-20 values → AA set
    (in_progress #7d5a34, done #43704f, bug #87555f); db-col dark set was the
    pre-Session-19 bright values → pd muted set; column dot 0.95/0.6rem → 0.72/0.55rem;
    card padding + title size unified with .pd-task (fs-sm).
  - Also fixed (found during verification): client-rendered task cards (freshly added +
    "more"-expanded) were `<a href="/board.html">` while server cards were
    click-to-edit divs — now all divs with role=button (click opens the inline editor
    everywhere); the edit-dialog in-place update queried
    `.pd-task[data-pd-task=…]` which matched NOTHING (data-pd-task lives on the wrap)
    — cards silently stayed stale after edits, now updated + re-clamped; same
    wrap-selector fix in the problems-tab sync.
  - Verified locally: typecheck green, 295/295 tests, smoke ALL PASS, cache-bust PASS;
    browser E2E on the local Node server — modal 1229px@1280/374px@390 (was 416),
    textarea 288px, 223-char task via Enter → 201 + 150+72 clamp split + read-more
    toggle (project AND board), edit modal prefills the FULL 310-char title, medium
    cards carry the column color on both surfaces (planned grey rgba(209,212,216,.55),
    in_progress rgba(240,197,155,.55)), prio-dots visible, dark = muted set,
    5000-char POST → 201 / 100001-char → 400, FA/RTL strings (بیشتر بخوان، بدون
    محدودیت طول), 390px no hscroll, 0 console/page errors. One VLM claim (strikethrough
    "crossing" the read-more button) disproven by DOM geometry (5px gap, no overlap) —
    discarded as a screenshot-scale misread. Assets: app.css ?v=260→261, devboard.js
    ?v=9→10, magic-wand.js ?v=8→9, SW hibana-v281→v282 (precached HTML shells rotate —
    project.html/board.html markup changed).
- v0.3.11.3 = **Session 21 hotfix release** — 3 visual fixes from Ali's live feedback on
  the dashboard/projects pages (all CSS/markup-only, no backend or schema changes):
  - **Bug-bubble pastel + shadowless**: the red open-bugs badge next to project titles
    (dashboard stat cards, projects cards/list, kanban) was solid #dc2626 with a red drop
    shadow — read as too harsh. Now the sig-chip recipe: light 12% red tint + #b91c1c ink
    (≥5.1:1 everywhere it renders), dark 16% red tint + #f2a3a3 ink (≥6.2:1), box-shadow
    removed in all three theme rules.
  - **Pastel stage bars**: the whole `--stage-bar-*` set (the slim per-card status label
    on dashboard stat-kanban-cards) softened to one pastel register: spark #E9BC5F→#E8CFA0,
    unreviewed #A9BFD8→#C2CFDD, investigating #9DC7FF→#BCD5EF, awaiting #FFD658→#EFDEA5,
    doing #6FE983→#AEE0B8, halted #F2A08C→#EFC2B5, operational #8FD694→#B7DFBC. Same
    register both themes (unchanged design decision); bar is 45%-saturation pastel — on
    dark it reads luminous purely from light-on-dark contrast, not saturation.
  - **Skip-to-main-content link removed** (owner request: the focus pill covered the header
    avatar in RTL): `<a.skip-link>` deleted from all 17 pages, `.skip-link` CSS block +
    `main:focus` outline rule deleted, `a11y.skipToMain` FA key removed from boot.js
    CRITICAL_FA (i18n.js never carried it — no parity impact). `main id="main"` stays so
    bookmarked #main anchors keep working. A11y note: keyboard users lose the jump-to-
    content shortcut; Tab order still reaches main content normally. Owner's explicit call.
  - Verified: FA/EN × light/dark × 1440/390 — bubble+bar computed styles pastel+shadowless
    on dashboard AND projects Cards view, 0 skip-link anchors on every checked page, 0
    horizontal scroll, 0 console/page errors. typecheck green, 295/295 tests, smoke ALL
    PASS. Assets: app.css ?v=260 (was 259), SW hibana-v281 (was 280 — precached HTML shell
    rotates so every client drops the skip-link anchor).
- v0.3.11.2 = **Session 20 polish release** — systematic UI audit (129 sweep rows: 20
  pages × EN/FA × light/dark × desktop/390px; 0 console errors) + fixes:
  - **AA contrast (22 unique offenders fixed)**: every white-text-on-#4A9FA3 fill moved to
    `--cta` per the design system's own rule (avatar, skip-link, sadhana add/save/undo/
    step/pick/recur buttons, calendar toggle, detail-tab count); every teal-as-text use
    moved to `--link` (resume-card label, pd-task-add, adm-self, selected/today day
    numbers incl. the RTL rule, 14 sadhana text rules); pd-col-title light inks darkened
    to ≥5.7:1 (in_progress/done/bug); dark sticky-note metadata → #EDE8DE (was #B0A79C at
    2.5:1); dark bug-bubble #ef4444→#c81e1e; zen Add button quadrant-tint + theme-flipping
    ink (was white-on-quadrant, all 4 failed); note-meta 0.48→0.6rem (was ~7.7px).
  - **Mobile overflows fixed (390px)**: project.html stage-action cluster (inner row now
    wraps ≤480px); clients.html payment form (wraps + shrinkable inputs).
  - **Backup coverage (CRITICAL, silent-data-loss)**: `project_archives` (0046) +
    `dev_task_tags` (0029) were missing from SNAPSHOT_TABLES — restores dropped archived
    tasks + tag links; restore.mjs tableOrder was frozen 2026-08-28 (missing the whole
    Phase-5 spark/dev cluster); restore-safe.mjs ordered tables alphabetically (FK-unsafe);
    personal JSON export lacked the dev-board cluster + archives. All fixed FK-safe,
    snapshot + export schema_version → 20260920, +4 regression tests, local
    snapshot→restore drill PASS. +2 SW-navigation auth tests (total 289→295).
  - **Smoke test fixed**: stale htmx ?status=spark expectation (pre-session-20 failure at
    HEAD) updated for the session-18 ideas-folder-grid — smoke ALL PASS.
  - **SW-navigation 401 fix (pre-existing at HEAD)**: a service worker's navigate-mode
    re-fetch loses Sec-Fetch-Dest: document at the origin, so an expired/absent session
    on an /app reload rendered the raw JSON 401 body (a JSON-viewer page — no JS, no
    login bounce). Fixed both layers: middleware treats Accept: text/html as a document
    request (redirect to /login.html; JSON clients unaffected — pinned by 2 tests) +
    sw.js v280 turns a 401 on any navigation into a login redirect (belt+ suspenders).
  - Verified by design (no change): reports bar-chart scroll strip, stat-strip carousel,
    sadhana subbar chip carousel, closed ⋯ menu pops, theme-floater ::after hit area.
  - Perf/SW review (no changes warranted, honest): D1 EXPLAIN all-indexed at busy-solo
    scale (worst interactive 31.85ms canvas bbox @40k elements — under threshold);
    SW class split sound; sw.js unversioned-URL risk covered by updateViaCache=imports
    default + boot.js reg.update() polling.
  - Assets: app.css ?v=259 (was 258), SW hibana-v279 → v280 (navigation-401 redirect
    logic).
- v0.3.11.1 = **Session 19 hotfix release** — all v0.3.11.0 features + fixes from Ali's
  direct feedback: stat-carousel arrows flank the strip (HTML restructure), sticky-note
  shadow spread reduced, dark mode flat card fills (no gradient), muted dark-mode kanban/
  pd-col/sticky-note colors, button hover text white (primary) / dark (ghost/btn), board
  shows 5 items per column (was 3), "بیشتر" expands inline (no board.html redirect), task
  cards click-to-edit inline (no navigation), project logo delete, note-clear persistence
  fix, unlimited task titles (300→2000) with read-more, Farsi numerals on typing (all text
  fields + Fabric canvas/whiteboard text:changed), text width resize now reflows.
- v0.3.11.0 = **Session 19 release** — 3 of 4 Changelogs §6 open items shipped (ICS calendar
  export, Telegram /update, web-clipper bookmarklet). Plus: "Resume work" dashboard card
  (Mission #2), segmented 4-digit OTP input on email-confirm, password visibility toggle on
  all auth pages, Farsi numerals on typing, canvas empty-state affordance, board "Add" button
  redesign, project logo delete, per-column colored task borders, 50% larger taskadd modal,
  unlimited task titles (300→2000) with read-more clamp, and a comprehensive UI polish pass
  across every surface (tour, cmdk, calendar, settings, dashboard, project-detail, board,
  sadhana, clients, admin, canvas, whiteboard, notifications, reports, archive, clip). Bug
  fixed: note-clear didn't persist (noteSchema.min(1) rejected empty strings). Bug fixed:
  github.deleteFile silent failure on logo replace/remove (auto SHA lookup). Cache-bust
  unified (app.css 215/234→249, i18n.js 45→52, app.js 165→168, canvas.js 16→17, admin.js 2→3).
- v0.3.10.2 = **Mistral Small 3.1 24B Instruct as default** (was qwen3-30b). Pure instruct
  (no reasoning pass) → fast (~1-2s) + cheap (~3-5 neurons/call vs qwen3's ~10-32). Good FA
  polish quality verified live. qwen3-30b kept as an option for complex rewrites. Also fixes
  3 bugs found by testing the real CF API: response_format:{type:'text'} rejected by qwen3
  (removed), "Polish" in prompt made Llama translate to Polish the language (reworded),
  reasoning models need 2048 max_tokens + both response shapes parsed.
- v0.3.10.1 = model picker (Settings): GET /api/ai/models, POST /api/ai/text accepts model,
  resolveModel whitelist (paid-only → default).
- v0.3.10.0 = **Magic Button (idea §1, green-lit)** — on-demand AI wand (polish/rewrite/
  translate) next to editable text. Cloudflare Workers AI binding ([ai] → env.AI), model
  @cf/mistralai/mistral-small-3.1-24b-instruct (default), temperature 0.2, non-streaming.
  Free-tier only; no paid overage. Route POST /api/ai/text (auth + CSRF + 4000-char guard).
  Original never modified until Apply; Discard/Esc/error = zero writes (Mission #1). Node
  self-host path degrades to a 503 "Workers-only" notice. No schema change, no cron, no KV.
  Also: experimental auto-polish (off by default, save-first safety) + custom AI system
  prompt (Settings textarea, max 2000 chars, COMMON_RULES always appended).
- **Session 18 (2026-09) — 45 commits, deployed dev+prod:**
  - Magic Button: hover-triggered wand on project titles, task titles, note textareas.
  - Free-tier model picker (Settings): Mistral Small 3.1 24B Instruct (default), Qwen3 30B
    (reasoning), Llama 3.1 8B Fast. resolveModel whitelist.
  - Experimental auto-polish: capture-first, polish-after, Undo toast. Off by default.
  - Custom AI system prompt (Settings textarea, max 2000 chars).
  - Hover ⋯ menus on cards: .pd-task (project) + .db-card (board) + .note-card (dashboard).
    Edit opens inline modal. Delete shows confirm dialog. .pd-task-wrap wrapper.
  - Note modal editor + Sadhana (to-do) task edit as modal.
  - Project archives: migration 0046 (project_archives table). Archive/restore/delete.
  - Project logos: migration 0047 (projects.logo_path). Upload/serve/display.
  - Priority color coding: prio-dot shows priority color. Left-border accent. Urgent: red.
  - Sprint timeline redesign: circles instead of text bars (in_progress + done only).
  - VazirFA: unicode-range @font-face for all FA text everywhere.
  - Dark mode fixes: --muted #B0A79C (6.26:1), --line rgba(126,116,98,.45) (3.22:1).
  - i18n flash fix: boot.js critical FA dict before paint.
  - Sync badge fix: FTS5 rebuild + queue retry cap (MAX_RETRIES=5).
  - Dashboard audit (Phase 1-3): scrollbar, equal cards, nav active, note hover, icons,
    View All hide, FAB tooltip, collapsible sections, empty states.
  - Ideas folder grid: file-manager view. Telegram deep link connect.
  - Settings UI fixes: tab underline, label alignment, helper text, input styling.
- Tests **289/289** (was 265; +11 ICS export, +7 Telegram /update, +3 dashboard resume-card, +6 other); typecheck green.
- Schema **46** — migrations 0001–0047 (46 files; 0007 never existed).
- Assets: SW hibana-v278 (SHELL list + clip.html); app.css ?v=249, app.js ?v=168, i18n.js ?v=52, magic-wand.js ?v=8,
  canvas.js ?v=17, whiteboard.js ?v=11, admin.js ?v=3; content-hashed bundles in public/dist/.
- Repos: source assadigit/hibana-source; encrypted backups assadigit/hibana-safe.
- D1: pm-app-dev 80e02ce2..., pm-app-prod d842fcb5...; CF account 6ff25b58...
- Deployed: dev (hibana.aliassadi.workers.dev) + prod (hibana.ir); env.AI live on both.


## 2. Session index
| Session | Date | Outcome |
|---|---|---|
| 7 | 2026-08-28→09-05 | Audit hardening, Sadhana replica, mobile/i18n, dev-board+sprints (0029), sprint/calendar v2 (0030); ended `ddb3aa4` |
| 8 | 09-07→08 | = session 7 file + Tasks 28–32: v0.3.1–v0.3.4 ops era (file is a byte-identical superset; counted once) |
| 9 | 09-14 | v0.3.5 — 23-page UI/UX audit + critical screenshot-upload fix |
| 10 | 09-14 | v0.3.6 — 4 owner-report fixes |
| 11 | — | v0.3.7 — `#dash` duplicate-id root cause, notebook gear |
| 15 | 09-18 | v0.3.9 candidate — Obsidian export + neutral stage cards |
| 16 | 09-18 | v0.3.9 release — push `2a8a83c`, deploy dev+prod |
| 17 | 09-18 | v0.3.9.1 — the ONE sticky style, deploy `d98adea` |
| 18 | 2026-09 | v0.3.10.0–v0.3.10.2 — Magic Button + model picker + auto-polish + custom prompt + hover menus + archives + logos + priority colors + sprint redesign + VazirFA + dark mode fixes + i18n flash fix + sync badge fix + dashboard audit + ideas folder grid + Telegram deep link. 45 commits, 265/265 tests, schema 46 |
| 18 | 2026-09 | v0.3.10.0 — Magic Button (idea §1): Workers AI `[ai]` binding, `POST /api/ai/text`, `magic-wand.js` focus-triggered wand (polish/rewrite/translate, preview+Apply/Discard). 259/259 tests, typecheck green |
| 19 | 2026-09 | v0.3.10.1 — free-tier model picker (Settings): `GET /api/ai/models`, `POST /api/ai/text` accepts `model`, `resolveModel` whitelist (paid-only → default). 265/265 tests |
| 19 | 2026-09 | v0.3.11.0 — Session 19: ICS calendar export (`/api/export/calendar.ics`), Telegram `/update <project> <stage>`, web-clipper bookmarklet (`clip.html`), "Resume work" dashboard card (Mission #2), segmented OTP input, password visibility toggle, Farsi numerals on typing, canvas empty-state, board Add-button redesign, logo delete, per-column colored task borders, 50% larger taskadd modal, unlimited task titles (read-more clamp), github.deleteFile SHA auto-lookup, note-clear bug fix, comprehensive UI polish pass. 289/289 tests, typecheck green, SW v278 |
| 20 | 2026-09 | v0.3.11.2 — Session 20: systematic UI/UX audit (129-row sweep, 0 console errors), 22 AA-contrast offenders fixed (white-on-accent fills → --cta; teal-as-text → --link; pd-col inks darkened; dark sticky metadata + bug-bubble), 2 mobile overflows fixed (project header, clients payments form), CRITICAL backup coverage gaps fixed (project_archives + dev_task_tags in snapshot; restore.mjs stale tableOrder; restore-safe FK-safe ordering; personal export cluster), stale smoke expectation fixed, SW-navigation 401→login redirect fix (middleware Accept:text/html + sw.js). 295/295 tests, typecheck green, smoke ALL PASS, local restore drill PASS, app.css v259, SW v280 |
| 21 | 2026-09 | v0.3.11.3 — Session 21: live-feedback visual fixes — bug-bubble pastel red + shadow removed (sig-chip recipe, AA-checked both themes), whole --stage-bar-* set softened to pastel (7 tokens), skip-to-main-content anchor removed from all 17 pages (+CSS +i18n key; owner: covered the header avatar). 295/295 tests, typecheck green, smoke ALL PASS, app.css v260, SW v281 |
| 22 | 2026-09 | v0.3.11.4 — Session 22: live-feedback fixes — dialog.modal specificity bug fixed (taskadd/taskedit actually open at min(78rem,96vw); pd-editor 60rem; db-modal 52rem; textareas 18rem/9rem + resizable), 300-char limit halted everywhere (FE caps removed, devboard.ts 2000→100k guard; 150-char hidden-rest clamp + read-more button on project + board, textContent stays full), board color system unified with pd recipes (medium keeps column color — board no longer all-orange; prio-dots un-hidden; AA inks; muted dark set), client-rendered cards click-to-edit like server cards, stale-card edit-update selector fixed. 295/295 tests, typecheck green, smoke ALL PASS, app.css v261, SW v282 |
| 23 | 2026-09 | v0.3.11.5 — Session 23: live-feedback fixes — task editor CODE support (``` fenced blocks rendered as monospace LTR `<code class="t-code">` islands with data-lang labels + hidden fence markers so textContent round-trips the raw title exactly; **bold**; multi-line titles with preserved newlines; Code/Bold/Bullet toolbar in all 3 composers; one renderer ported to projects.ts/project.html/board.html), FA dropdown root cause (pde selects used never-existing status.*/prio.* keys → now the board's db.st.*/db.pr.* translations), FA editors now dir=rtl (was auto→LTR on Latin first char; recipe applied to 5 textareas incl. backlog), ذخیره buttons green (#pde-save + data-db-save plain-button CTA), vanished FAB root cause (tour overlay z-80 buried the z-81 target trapped in .fab-stack's z-40 context → :has(.tour-target) lifts fab-stack/topbar to z-82; verified live pre-fix), 14 hover-leak fixes (button:hover's green bg leaked under dark/brand text — full green+light recipe on 12 action buttons, neutral reset on 2 content surfaces), FA mono-font specificity twin for .t-code. 295/295 tests, typecheck green, smoke ALL PASS, app.css v262, i18n.js v55, devboard.js v11, SW v283 |

## 3. Timeline by era
### Foundation — 2026-08-21→25 (migrations 0014–0018; tests 75→163)
- Telegram webhook live (@Hibana_PM_bot): `/note` `/list` capture (0016), quick-note↔project
  attach (0017, no FK cascade by design), `/reset` hashed one-time token.
- Signup saga: registration + Turnstile + emailed codes (0015); fixed in series — malformed
  `--/>` comment swallowed register.html body; Turnstile render races; `cf-turnstile-response`
  vs `captcha` field name; Resend shared-sender 403 → verified domain `noreply@hibana.ir`.
  Login CAPTCHA then removed deliberately (rate limiter is the real guard).
- In-app D1 rate limiting (0014) — wrangler token can't edit WAF.
- Sadhana quadrant board (0018): renamable quadrants, fuzzy+exact Jalali deadlines, recurrence
  + Monday sweep, archive, zen, 7d/3d/1d/0d/2h Telegram reminders; roast P1–P7 design pass.
- Root-cause lessons: GitHub raw reads corrupted every image (text decoding → `readBinary()`);
  canvas batch sync dedupes by newest `updated_at` (LWW vs pre-batch state = data loss);
  deleted canvas objects resurrected (tombstone debounce race → skip `deleted` +
  flush-on-delete); htmx swaps only 2xx/3xx → silent JSON errors; CSRF Origin/Referer guard
  on all mutations.

### UI/UX overhaul + recovery — 2026-08-28→09-01 (SW v132→v178; 181→189 tests)
- Overhaul: typed HTML builder, ApiError registry, SQL table whitelist, ETags, command palette
  (Ctrl+K), skeletons/toasts/empty states, mobile bottom tabs, calendar (Jalali⇄Gregorian +
  Iranian holidays), timeline, notifications, heatmap, CSV export, zen/tour/Vim-go-to.
  CSS 2537→4501 lines; 16 prod deploys.
- Security: Quick-Find XSS (DocumentFragment); offline queue keeps items on 401/403; export
  user-scoping leak; security-headers middleware must clone immutable ASSETS responses.
- `/to-do-list` rebuilt as faithful Sadhana replica; whole app restyled to its design system.
- **Recovery (RECOVERED.md)**: ~50–60 hotfixes (2026-08-31→09-01) were lost from source; tree
  reconstructed from the live deployment (Worker bundle via CF API + frontend mirror + D1
  dumps), machine-verified (rebuild ≡ deployed bundle, 52/52 modules). Recovery carried:
  7-stage taxonomy (0031), spark folders (0037), «برنامه آتی» backlog docs (0033), problems
  tab (0034), changelog feature removed (table intentionally left in DB — do not drop),
  Turnstile → self-hosted HMAC math captcha, admin console (0035), email pipeline +
  `email_log`, ban gate, quick-note `done` (0038), sprint drafts (0039), dashboard redesign,
  canvas types (0032/0036), backup cron 4×/day, CSP `img-src https:`.
- Era lessons: duplicate `<main id>` (second id dropped at parse → all `#dash` selectors dead);
  jalaali port `_d2g` off-by-one-YEAR (Mar/Apr grids wrong years; 976 mismatches over
  2024–2031 sweep); sprint timeline needs one shared px/day scale; fabric group-child editing
  impossible → top-level "editing twin"; probe prod D1 before coding ("board broken" =
  soft-deleted project).

### v0.1.x audit + task wave — 2026-09-02→09-10 (191 tests; 0040)
- 39-finding audit backlog (37 shipped): screenshot cap 140→5 MB (Worker OOM);
  newest-note-first; sequential cron; captcha operand leak → HMAC question; timing-safe
  compares; `/app` 404 root cause `not_found_handling="404-page"` starved Worker routes →
  `"none"`; structured logging + reqId; perf caps (dashboard LIMIT 48, notebook LIMIT 100).
- Sprint board v2 (0030, video-editor timeline) + calendar v2 (exact-day jumps, شمسی/میلادی
  switch, drag-to-plan legend). v0.1.7 (09-09): FTS5 depth (0040: quick_notes, backlog_docs,
  sadhana_tasks, canvas text; prod backfilled).
- **2026-09-10 security arc (CRITICAL)**: backups AES-GCM `HIBENC1`; hibana-safe history
  rewritten, 61 plaintext snapshots purged; PBKDF2 → 600k; invite link GET→POST; fabric v5→v6
  plan; CI workflow; canary restore; Telegram inline-keyboard redesign (0043
  `telegram_bot_sessions`, JSON state, no TTL).

### v0.2.0 — 2026-09-11 (0044; tests 203)
- Plan B Telegram backup: encrypted snapshot to owner chats, retention 60, sha256 in caption,
  D1-independent manual restore (`drill:planb`).
- **Fixed: GitHub restore path broken for every encrypted backup since 09-10** — Contents API
  stores raw-binary; restore knew only base64. `lib-backup.mjs` 3-shape detection (test-pinned).
- SW strategy split (cache-first versioned assets, SWR vendor); D1 EXPLAIN: worst interactive
  4.91 ms — no new indexes needed.

### v0.3.0–v0.3.4 ops era — 2026-09-07→08 (0045; tests 224→233)
- v0.3.0: healthchecks.io dead-man's switch + D1 Time Travel restore channel + pre-migration
  bookmark ritual (§5) + `error_log` (0045) + admin Errors tab + HTML→`/dist/` wiring + deploy
  gate. **Day-one real catch:** transient D1 `SQLITE_CORRUPT_VTAB` killed the cron backup
  while BOTH in-band alerts (email+Telegram, both query D1) failed silently — the out-of-band
  healthcheck was the only surviving signal.
- v0.3.1: healthchecks wired to owner (6h/6h); hibana.ir NS incident — IRNIC delegation
  silently moved to ArvanCloud (~08-31, DKIM dead); owner restored CF nameservers; zero data
  impact.
- v0.3.2: jitter-proof cron classification (keyed on `controller.cron`, not wall clock — a :31
  tick was misread as backup tick, masking the watchdog); `MIRROR_ORIGIN` CSRF allow-list.
- v0.3.3/0.3.4: mirror moved to sadhana.ir, then DEFERRED — Arvan API keys live in a different
  account than the zone. Frozen safely (resume = correct key + ~4 calls).

### v0.3.5–v0.3.9.1 — 2026-09-14→18 (tests 233→244)
- **v0.3.5**: CRITICAL — screenshot uploads had NEVER worked (leading-slash `assetPath()` →
  Contents API 422; prod screenshots table 0 rows ever); offline boot stays on-page (guard
  misread SW 503 as logged-out); AA contrast pass (--cta #3D8D91→#2E7B7F); 77 unversioned refs
  versioned; quadrant carousel ≤740px; calendar "today" in profile TZ; dead to-do-list.html
  deleted. Lesson: Playwright set-offline doesn't block SW fetches — honest offline test =
  stop the server.
- **v0.3.6**: owner-report fixes — view controls always visible, board gap 12→20px, prog-track
  :focus-within, status-box counts neutral.
- **v0.3.7**: all 3 reports traced to duplicate `id` on `<main>` → `shell-dash` + 4 selector
  fixes; notebook gear + toggle-state persistence (capture-phase — toggle doesn't bubble).
  Lesson: "rule never applies" → computed-style probe, not stylesheet grep.
- **v0.3.8**: flat kanban cards + phase chroma (~90% L, AA), phone 2-up sticky grid, native
  `<dialog>` task composer (300-char Zod).
- **v0.3.9** (`2a8a83c`): Obsidian vault export `GET /api/export/obsidian.zip` (fflate, YAML
  frontmatter, round-trip dedup by title); neutral stage cards (status color only in
  inline-start pill, sr-only labels); Plan B Telegram on-demand only (cron +
  `telegram_backup` toggle removed; column retired but kept in schema for rollback safety).
- **v0.3.9.1** (`d98adea`, dot-release): the ONE sticky-note style — true square, 2px corners,
  layered shadow `1px 3px 4px rgba(0,0,0,.10)` + `4px 12px 20px rgba(0,0,0,.12)` across
  quick-notes, fabric stickies, corkboard, calendar chips. Fabric twin-rect shadow
  (`__shadowPaper` — fabric holds ONE Shadow per object; never shadow the group); `fitPaper`
  square growth via binary search (linear growth overshot ~8×); deliberately reverses
  Phase-7 auto-height caps.

### v0.3.10.0 — 2026-09 (Magic Button / Workers AI; tests 244→259)
- **Green-lit scope (idea §1) only.** One on-demand AI wand (inline SVG) next to editable
  text — notes (`.note-text`), the quick-note composer (`#quicknote-text`), the project
  description (`#pd-desc`), plus a `data-magic` opt-in for any future textarea/
  contenteditable. Never background, never auto-run, never blocks capture (whiteboard rule).
- Actions: **Polish** (grammar/spelling/clarity, same language, similar length) · **Rewrite**
  (clean technical/developer register, same language) · **Translate** (auto-detect, EN↔FA).
  System prompt enforces output-discipline: ONLY the transformed text, no preamble/quotes/
  fences, names/numbers/dates/URLs/code identifiers verbatim, never add or drop meaning.
- Backend: `wrangler.toml` `[ai]` binding → `AI: Ai` in `Env` → `cfg.ai` (a structural slice
  of the binding). Route `POST /api/ai/text` (`src/routes/ai.ts`) under `requireAuth` + the
  global CSRF gate; Zod `{text:1..4000, action:polish|rewrite|translate}`; model
  `@cf/qwen/qwen3-30b-a3b-fp8`, temperature 0.2, non-streaming, `response_format:text`.
  Pure service `src/services/ai.ts` (buildMessages / runAiTransform / withinCharBudget /
  stripAccidentalWrappers) — testable with a mock binding, no network. Char guard counts
  code points (FA combining marks not double-counted). Node self-host path: `cfg.ai`
  undefined → 503 `unavailable` with a localized “Workers-only” notice (portability contract).
- UX (`public/js/magic-wand.js` + `magic-wand.css?v=1`): focus-triggered floating wand (zero
  DOM restructuring → no risk to htmx swap targets); popover with the 3 actions; on success a
  side-by-side Original vs Suggestion preview with **Apply / Discard**. Apply sets the field
  value and dispatches `input`+`change` so the surface’s OWN autosave persists (the wand never
  writes). Discard / Esc / outside-click / error / timeout / daily-cap = toast, original
  byte-for-byte intact (Mission #1). Spinner on the wand while running; repeated clicks
  disabled during a run. RTL-aware (wand anchors to the end corner; popover flips on-screen);
  EN/FA localized; `prefers-reduced-motion` honored. Re-arms on `htmx:afterSwap`.
- Cost: ~5–8 neurons/call → thousands/day inside the 10k/day free budget; no paid overage
  possible on Workers Free. **No schema change, no migration, no cron, no KV, no secret.**
- Acceptance: `npm run typecheck` green · `npm test` 259/259 (15 new in `src/tests/ai.test.ts`)
  · `node --check` on `magic-wand.js`/`i18n.js` green · i18n parity +15 EN/+15 FA. FA-quality
  review (Ali, 5 real FA notes) + idea §6 model spike deferred to deploy-time per the idea doc.
- Wired onto `dashboard.html`, `project.html`, `sparks.html`; `i18n.js` cache-bust 36→37 on
  all 21 pages (SW `hibana-v238` unchanged — SW logic untouched, new files runtime-SWR cached).

## 4. Ops & DR state (condensed runbook)
- **Backups**: 4×/day cron `17 3,9,15,21 * * *` → AES-256-GCM `HIBENC1` (~100 KB) →
  `assadigit/hibana-safe` `backups/`; retention 120 (~15 days). `*/30` cron = Sadhana
  reminders; daily-only jobs (purge, weekly sweep, client reminders) gated to the 03:17 slot;
  sequential (subrequest budget).
- **Restore (recommended)**: `BACKUP_ENCRYPTION_KEY=<key> npm run restore:safe -- --file
  snapshot.json [--dry-run]` → sacrificial `pm-app-dev`, Check A (vs backup) + Check B (vs
  prod), typed "yes" for prod. Direct: `node scripts/restore.mjs --file <snap> --d1
  pm-app-prod` (wipes, unverified). Restores never include `password_hash`/`sessions`; lost
  admin → `npm run seed:admin:prod`. Drills quarterly: `npm run drill`, `npm run drill:planb`;
  decrypt failure = P1.
- **Pre-migration ritual (mandatory)**: `npm run bookmark:prod` (appends one row to §9
  below) → `npx wrangler d1 migrations apply pm-app-prod --remote`. Undo: `npx wrangler d1
  time-travel restore pm-app-prod --bookmark <id>` (in-place, destructive, 30-day window,
  minute granularity). Post-restore: verify `/api/health` schema_version, fresh bookmark,
  `curl -X POST https://hibana.ir/api/admin/backup`.
- **Monitoring**: healthchecks.io check `Hibana` / slug `hibana`, 6h period + 6h grace (alert
  = 12h silence), email channel independent of CF/Resend/Telegram/GitHub. Ping URL in
  `HEALTHCHECK_PING_URL`: success → GET, backup fail/skip → append `/fail`. Manual backups +
  dev worker never ping (anti-masking). Ticks classified by trigger (`src/lib/cron.ts`).
- **Plan B**: on-demand only — bot Settings 🗄 (owner-only) or `POST /api/admin/backup/planb`;
  files `hibana-backup-<UTC>.bin`, caption = schema/time/rows/sha256; failure →
  `planb_failed` + Resend email (deliberately not Telegram).
- **Key custody**: `BACKUP_ENCRYPTION_KEY` — two independent offline copies (print + password
  manager, non-repo device). **NEVER rotate** (orphans all encrypted backups; keep old key
  until 15-day retention ages out). Lost-key path: Worker alive → app export + new key (old
  backups forfeited). Key-custody drill not yet run (agent never sees the key by design).
- **Telegram bot**: commands `/start <code>` (1h TTL) `/help /idea /note /list /done /cancel
  /append <project> <text> /status /pause /resume /reset` (+proposed `/menu /language
  /todo`). Webhook `https://hibana.ir/api/telegram/webhook`, secret-token validated. State:
  `telegram_bot_sessions` (JSON, no TTL). **Add-only by design** — edit/delete → "Open in
  Hibana →" deep link; sole exception to-do mark-done+Undo. `telegram_paused` mutes reminders
  only, never Plan B.
- **Edge mirror (Iran) — DEFERRED**: frozen at sadhana.ir; needs zone-account Arvan key + ~4
  calls (origin `hibana.ir:443`, host_header, free SSL, `/api/*` BYPASS). Invariants:
  hibana.ir NS stay Cloudflare (isabel/patryk); sadhana.ir apex-only; `MIRROR_ORIGIN`
  allow-list. Rollback: remove NS at IRNIC.
- **Fabric v6**: plan = esbuild shim `src/vendor/fabric-shim.ts` → `window.fabric`
  (canvas.js / whiteboard.js unchanged); v6 ESM-only, `charWidthsCache` removed,
  `Image.fromURL` Promise-based. Currently deferred (v5.3.0 UMD in use, no known CVEs).
- **Perf**: no new indexes (rule-9 composites + 0042 cover hot paths; D1 RTT dominates).
  Re-run `npm run perf:explain` after schema/query changes; thresholds: `sadhana_updates`
  >~100k rows → index `(created_at)`; canvas >~50k elements → partial bbox index. Rejected:
  KV/DO hot reads, htmx fragment caching, HTML s-maxage. Caching contract: HTML + `/api/*`
  no-store; `?v=` 1h+SWR; vendor 1d; `/dist/*` immutable 1y; SW bumps only on sw.js logic
  changes.
- **Deploy**: `npm run deploy[:prod]` = build `--prod --wire-html` → `check-dist-wiring`
  gate → `wrangler deploy [--env prod]` → `--restore-html`. Committed HTML keeps human `?v=`
  refs; `.build-backup/` canonical-only invariant. Rollback: `git checkout <good> && npm run
  deploy:prod`. Node self-host: Node 24+ (`node:sqlite`; better-sqlite3 REMOVED), PORT 3000,
  `DB_PATH=data/hibana.db`; trusted-proxy requirement on Node (X-Forwarded-For spoofing
  dodges rate limits; Workers unaffected — CF-Connecting-IP authoritative).

## 5. Migrations — live-DB warning
Live D1s run 0001–0047 (schema 46). The reconstructed 0031–0039 exist for fresh environments;
their `d1_migrations` bookkeeping rows were never backfilled — **never blindly `wrangler d1
migrations apply` against live DBs** (it would re-run table rebuilds). Backfill once to make
future applies a clean no-op:
```sql
INSERT INTO d1_migrations (name, applied_at) VALUES
  ('0031_project_status_stages.sql', datetime('now')),
  ('0032_canvas_squig_types.sql',    datetime('now')),
  ('0033_backlog_docs.sql',          datetime('now')),
  ('0034_dev_task_bug.sql',          datetime('now')),
  ('0035_admin_user_mgmt.sql',       datetime('now')),
  ('0036_canvas_sticky.sql',         datetime('now')),
  ('0037_spark_folders.sql',         datetime('now')),
  ('0038_quick_note_done.sql',       datetime('now')),
  ('0039_sprint_drafts.sql',         datetime('now'));
```

## 6. Open items (verified against the v0.3.11.2 tree)
**Code — verified absent:** admin feature-usage analytics + top-10 activity ranking · ~~Telegram
`/update <project> <stage>`~~ ✅ shipped v0.3.11.0 · ~~one-way ICS calendar export (High)~~ ✅ shipped
v0.3.11.0 · ~~web-clipper bookmarklet / extension~~ ✅ shipped v0.3.11.0 · `dev_tasks` note
column · email-in (Email Workers) · Google Calendar 2-way sync · canvas auto-routing
connectors · multi-canvas. Deferred by design: incremental notebook swap.
**Owner-held:** rotate GitHub token (classic, `repo` scope — chat-exposed) · close
`OPEN_REGISTRATION` · CF "Always Use HTTPS" toggle · PWA installability re-check ·
key-custody drill · Resend delivery confirmation.
**Watch:** one non-repro vitest failure seen once (149/150, then 3× 150/150) · deep links
hardcode hibana.ir · mirror rate-limit keys share Arvan POP IPs. Session 20 note: the
smoke test's htmx spark-fragment expectation was stale (failed at v0.3.11.1 HEAD) —
fixed to match the ideas-folder-grid; if a future smoke failure appears, check whether
the expectation or the product changed first.

**Shipped this session (v0.3.11.0):** ICS calendar export (`/api/export/calendar.ics`),
Telegram `/update <project> <stage>`, web-clipper bookmarklet (`clip.html`), "Resume work"
dashboard card, segmented OTP input, password visibility toggle, Farsi numerals on typing,
canvas empty-state, board Add-button redesign, logo delete, per-column colored task borders,
50% larger taskadd modal, unlimited task titles (read-more clamp), github.deleteFile SHA
auto-lookup, note-clear bug fix, comprehensive UI polish pass (tour, cmdk, calendar,
settings, dashboard, project-detail, board, sadhana, clients, admin, canvas, whiteboard,
notifications, reports, archive, clip). 289/289 tests, typecheck green, SW v278. The idea
doc's Tier-1 deferred items (Telegram voice→spark, back-to-work recap, semantic find
stages 1–2) remain not built. FA-output quality review (Ali, 5 real FA notes) is a deploy-
time gate.

## 7. Consciously rejected (do NOT propose — vision.md)
Subtasks/rigid hierarchy · nagging reminders/push/overdue toasts · milestones/OKRs/maturity
scores · cross-project Gantt/dependencies · backlinks/wiki-graph · daily-notes/diary ·
mood/energy tracking · tag nesting · templates · team features (@mentions, shared boards,
assignments) · native app (Capacitor path reserved) · time tracking. Scoped: Gantt →
per-project sprint timeline; canvas images via URL; journaling → per-task sadhana_updates;
fixed 4-color sticky palette; recurrence sadhana-only.

## 8. Verified-implemented digest (backlog audits, ~98 items; pm-app-spec is fully implemented)
Parts 1–3 + Phases 4–7 (both blocks): all ✅ (tab order/backlog docs/renames · 7-stage
pipeline · admin console · stat carousel · spark folders · canvas circle/rect · notebook
stickies · sprint overhaul · notebook save hardening · emoji library · rename-pop ·
canvas→note · FAB modal · skeletons). Crown surfaces: 7-stage pipeline · 4 task surfaces
(hurdles/dev_tasks/sadhana/client) · 6-channel idea capture · manual promotion · spark
folders · two boundless canvases + LWW offline sync · 8 canvas element types · non-nagging
client reminders · Telegram bot · Obsidian import + JSON/MD/CSV export · PWA bottom-tab nav.
Roadmap DONE: prod rollout, P1/P2 all, roast P1–P7, signup+verification, Telegram linking,
rate limiting, HTTPS 301, CSRF, backup retention, `/api/health`, PWA icons, zero CDN deps,
Node self-host.
**Stale "open" items since fixed (do NOT carry):** quick-note newest-first ✅ · Telegram
`/append` ✅ · notebook photo inversion ✅ (counter-filter) · FTS depth ✅ (0040) · on-hold
violet = deliberate owner decision · sparks bulb ✅ · `#shots` auto-refresh ✅.

## 9. D1 Time-Travel bookmark log (operational — newest last; KEEP THIS SECTION LAST)
Created by `npm run bookmark:prod` before each prod migration (`scripts/
pre-migrate-bookmark.mjs` appends rows at the end of this file — that is why this section
must stay last). Restore is in-place and destructive: `npx wrangler d1 time-travel restore
<db> --bookmark <id>`.

| UTC timestamp | database | schema | bookmark id | reason |
|---|---|---|---|---|
| 2026-09-07T02:17:02.947Z | pm-app-prod | 43 | 000005ff-00000000-000050df-1931618c922f41a76b7c7562ca95765e | pre-migration bookmark (prod) |
| 2026-09-07T03:39:19.075Z | pm-app-prod | 44 | 00000607-00000002-000050df-b85cfafbd13f7bfecd16248d882d092b | post-0045 healthy state, after transient D1 SQLITE_CORRUPT_VTAB incident |
| 2026-09-12T22:24:32.712Z | pm-app-prod | 47 | 00000822-00000000-000050e4-a61be4b43323dca9f3fc24fc16465e42 | pre-0049+0050 migration bookmark (prod) — canvas angle + project progress log |
