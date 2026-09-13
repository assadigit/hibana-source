// Hibana service worker — PWA packaging (Phase 5).
// Session 25 (2026-09-10, refactor): hibana-v292 → v293 — app.css (8,822 lines) split
// into 16 modular CSS files (variables, base, layout, dashboard, dashboard-todo,
// components, canvas, quicknotes, to-do-list, polish-ui, calendar, notifications,
// polish-batch, project-header, devboard, misc). Byte-identical concatenation — zero
// behavior change. Each file is now a separate CSS_ENTRY_POINT → own content-hashed
// /dist/ artifact → independent cache invalidation. SW bump: manifest now lists 17 CSS
// entries (was 2) so existing clients must re-fetch manifest + precache new files.
// Session-17 (2026-09-18, v0.3.9.1 release): hibana-v237 → v238 — app.css v214 + canvas.js
// v15 + whiteboard.js v10: the ONE sticky-note style app-wide (owner's reference
// mockup): every sticky paper is a TRUE SQUARE (aspect-ratio 1/1 on the quick-note /
// notebook sticky+grid views and the projects/sparks corkboard; square-normalized
// geometry + square auto-growth on the fabric boards), corners drop to near-sharp 2px
// (was 10-14px), and the flat symmetric halo is replaced by a layered DIRECTIONAL
// shadow — light from the top-left: box-shadow 1px 3px 4px rgba(0,0,0,.10) (contact) +
// 4px 12px 20px rgba(0,0,0,.12) (soft), neutral black on every pastel; the fabric
// boards replicate the two layers with a back shadow rect. The calendar's mini sticky
// chips carry the same recipe at chip scale. Full-tree bump per the cache rules.
//
// Session-15 (2026-09-18, v0.3.9 release: Obsidian vault export + neutral stage
// cards — rides the v0.3.9 deploy which carries BOTH undeployed batches,
// session-14 + session-15): hibana-v236 →
// v237 — app.css v213 (dashboard stage-box cards: ONE neutral surface #F5F6F7 light /
// #28241E dark regardless of status; the inline-start pill indicator bar is now the
// ONLY status color — awaiting #FFD658, investigating #9DC7FF, doing #6FE983, secondary
// stages in the same bright-pastel register; hover steps toward the text tone) and
// i18n.js v36 (settings.* keys for the new Obsidian export button + hint). Server-side:
// GET /api/export/obsidian.zip — the .md vault export (one folder per app part + Home
// MOC; mirrors the §9 import so titles round-trip and re-import dedups).
// Full-tree bump per the cache rules (drops every v236 copy so no stale page keeps
// referencing v212 CSS / v35 i18n).
//
// Session-14 (2026-09-17, Hibana UX follow-ups): hibana-v235 → v236 — app.css v212:
// quick-notes GRID view on phones now shows 2 sticky notes per row with slightly smaller
// papers (capped 9.5rem tracks, centered pair, 10.5rem height cap), and empty project
// boxes are hidden on mobile (dashboard .stat-box.is-empty ≤640px, projects-page
// .pglance-box.is-empty ≤560px — both marked server-side only when some stage has
// projects). Server-side: the Telegram Plan B backup channel is on-demand only now
// (bot ⚙ Settings 🗄 button / admin route; the automatic 4×/day chat push is gone).

// Network-first for navigations (fresh data always), cache-first for the app shell so the
// interface loads instantly and works offline. The offline *queue* is IndexedDB-based and
// independent of this file (spec §3.4).
// 2026-08-30 (k2): cross-origin subresources are NEVER intercepted. The canvas/notebook
// "image from a link" tools hotlink external pictures; this handler used to respondWith
// their loads, and the SW's re-fetch is blocked by the SW script's OWN CSP (connect-src
// 'self' is set on every response incl. /sw.js) — the catch-fallback then answered the
// <img> with the cached shell HTML, so every external picture "failed to load". Pass
// them through: the PAGE CSP (img-src https:) governs external loads directly.
//
// Perf session (2026-09-10, docs/perf-and-data-safety.md §2.2): the fetch handler
// splits strategies by URL class instead of network-first-for-everything.
//
// Session-13b (2026-09-16, v0.3.8 release): hibana-v234 → v235 — app.css v211 (shadow
// removed from the .pd-task-add button per owner request) riding the v0.3.8 deploy
// which carries BOTH undeployed batches: session-12 (flat kanban cards, pronounced
// phase colors, phone quadrant carousel — app.css v209) and session-13 (the
// #pd-taskadd-modal task composer replacing the narrow inline input — app.css v210,
// project.html + routes/projects.ts). NOTE: the v0.3.7 zip/deploy actually shipped
// hibana-v231 (the worklog's "v232" was wrong — the version was never bumped in the
// artifact); v235 clears that numbering confusion and drops every old cache on
// activate so no stale project.html/app.css pair survives the deploy.
//
// Session-13 (2026-09-15, modal task composer): hibana-v233 → v234 — app.css v210
// (#pd-taskadd-modal composer dialog styling; the dev-task columns' narrow inline
// quick-add input removed) plus project.html (modal open/submit/Enter wiring) and
// routes/projects.ts (dialog markup, server-rendered). Full-tree bump per the cache
// rules (drops every v233 copy so no stale project.html keeps referencing v209 CSS).
//
// Session-12 (2026-09-15, mobile flat-phase fixes): hibana-v232 → v233 — app.css
// v208 (flat kanban cards, pronounced phase colors, phone quadrant swipe carousel)
// and app.js v163 (dash-quad dot builder + slide restore + swipe-hint lifecycle) plus
// dashboard.ts/dashboard.html (quad-wrap + dots/hint markup). Full-tree bump per the
// cache rules (drops every v232 copy).
//
// Session-11 (2026-09-14, three owner follow-ups on v0.3.6): hibana-v231 → v232 —
// app.css v206 (dashboard section spacing finally applies via .shell-dash, restored ⚙
// note-controls-toggle, stat-kanban-card status LABEL instead of full tint) and app.js
// v162 (#dash → main.shell-dash selectors; note-controls-toggle open-state persistence)
// plus dashboard.html. Full-tree bump per the cache rules (drops every v231 copy).
//
// Session-10 (2026-09-14, four UI fixes): hibana-v230 → v231 — app.css v205
// (notebook view-mode controls always visible, dashboard prog-track hover-reveal,
// pglance subtle color + section spacing) and sadhana.html's unversioned full-tree
// content change (board section white space). Full-tree bump per the cache rules.
//
// dr-integrity session (2026-09-11, docs/dr-integrity-closeout.md §5): HTML → dist
// wiring. hibana-v227 → v228:
//   - PRECACHE IS MANIFEST-DRIVEN: install() fetches /dist/manifest.json (served
//     no-cache) and precaches its entries alongside the static shell. Deployed HTML
//     references content-hashed /dist/<name>.<hash>.js|css URLs, so asset changes need
//     no SW changes — new hashes are simply new URLs (fetched from network on first
//     request, precached on the next install/activate cycle).
//   - /dist/*.js|css joins the CACHE-FIRST class (they are content-addressed AND served
//     immutable by _headers — strictly safer than the ?v= URLs, which stay supported
//     for dev-mode pages and in-code injections).
//   - VERSION-BUMP RULE SIMPLIFIES: bump the hibana-vNNN version only when sw.js LOGIC
//     changes (this file). The old "bump on every public/ change" rule existed because
//     SHELL precache was hardcoded to ?v= URLs; that coupling is gone. Vendor/page
//     files still refresh via SWR / network-first exactly as before.

// Session 9 (2026-09-14): v228 → v229 — batch 1+2 (F1–F6, F14). Not a sw.js logic
// change, but a full-tree content change: app.js (F2 offline auth guard), i18n.js
// (offline.banner), app.css (F3–F6, F14 tokens), sadhana.html (F3/F14 — unversioned
// HTML rides exactly this bump, as do partials). The version bump drops the whole
// v228 cache on activate so no stale copy of any class survives the deploy.
// Session 9 batches 3+4 (F7–F13): v229 → v230 — app.js (F8 htmx error handler),
// i18n.js (new keys), app.css (F13 touch targets), sadhana.html (swipeable carousel
// + spacing), calendar/admin/canvas page changes (F9/F10/F12), to-do-list.html
// DELETED (F11). F7 also adds SHELL entries: /reset.html (public auth page was
// missing — offline boot impossible) and /to-do-list (the board's canonical URL —
// offline navigation used to fall through to the dashboard shell).
// v240 (2026-09): experimental auto-polish + custom AI prompt in Settings.
// v239 (2026-09): Magic Button (Mistral default) + hover ⋯ menu on notes + modal editor.
// Drops the v238 precache so every browser sees the new dashboard.html + dist bundles.
// Session-21 (2026-09-20, live owner feedback — 3 visual fixes): hibana-v280 → v281 —
// app.css v260 (bug-bubble pastel red, no shadow; pastel --stage-bar-* set) + the
// skip-to-main anchor removed from every page (owner: covered the header avatar), so
// the precached HTML shell must rotate.
// Session-22 (2026-09-21, live owner feedback — 3 fixes on the task composer/boards):
// hibana-v281 → v282 — app.css v261 (dialog.pd-taskadd-modal actually OPENS at 78rem —
// the v0.3.11.1 "50% larger" bump never rendered, .pd-taskadd-modal 0,1,0 lost the
// cascade to dialog.dialog's 26rem cap 0,1,1; same fix for dialog.pd-editor-modal +
// the new .pd-taskedit-modal; textarea 18rem min + resizable; db-modal 52rem; the
// 150-char title clamp + .pd-read-more button; the db-card/db-col color system unified
// with the pd recipes — column-colored card borders (no more all-orange medium cards),
// visible prio-dots, AA inks, muted dark set), project.html + board.html markup changes
// (clamp render + read-more delegation + counter removal), devboard.js v10 (title
// input → textarea), magic-wand.js v9 (title-written re-clamp event). The precached
// HTML shells must rotate so clients drop the old counter markup.
const VERSION = "hibana-v330" // S30 batch 5 (Tier 4 slice + the FA guard, user request 2026-09-12): (1) THE SHARED CHIP/TITLE MODULE — public/js/chip-render.js (window.HibanaChips): the title-clamp renderer (fenced ``` code blocks, **bold**, 150-char clamp + hidden .pd-title-rest + read-more), the tag chips (.pd-tag span / .db-mini-chip button), and applyTitle (the wand re-clamp) — byte-identical twins of this code lived in board-page.js AND project-page.js; both pages now delegate (local names kept, call-sites untouched, sticky.js's consolidation pattern). Added to build ENTRY_POINTS + the board's ensureLib self-heal. (2) THE FA-LOCALE E2E GUARD (e2e/fa-locale-guard.spec.ts) — seeds a language_pref='fa' account and pins the FARSI render of every S30 surface: the composer's priority options (فوری/اولویت بالا/اولویت متوسط/اولویت کم), the filter bars, the dot-cycle tooltip, the bar's tier tooltip, the problems picker, the board's filter row. THE GUARD CAUGHT A REAL P0-CLASS BUG FIRST RUN: board/sprint booted on `window.hibanaI18n.ready` — a PROMISE, always truthy — so FA users got an ENGLISH first render (the lazy FA dictionary lands after); both pages now await the promise (it resolves after ensureFaDict). Also fixed: the batch-4 version bumps for board-page/project-page never landed (a swallowed script error) — now v6/v8, honest. Bumps: board-page.js v5→6, sprint-page.js v2→3, chip-render.js NEW v1, project-page.js v8, build.mjs entry. Tests: 348 vitest · 45 e2e (the guard +1) · smoke PASS. Carries forward v329. // S30 batch 4 (Tier 3 — UX depth, user request 2026-09-12): (1) DRAG VERTICALLY = CHANGE PRIORITY TIER — a same-column drop ADOPTS the priority of the card it landed next to (the columns are priority-sorted, so the neighbor IS the tier zone: "drop into the urgent zone of the column"); the card below the drop point — or the one above at the end — defines it; both surfaces (board.html drop handler + the project preview's same-box path) PATCH {priority} with the move and re-sort optimistically. (2) PROGRESS-BAR TOOLTIP BREAKDOWN — hovering the project header strip shows the per-tier composition ("3 urgent · 2 high · 5 medium", FA: «۱ فوری · ۲ اولویت بالا…»): server-rendered from the dev-task pool + kept LIVE client-side (pdTaskTruth — the full task list the filter-bar fetch already loads; add/cycle/drag/delete update it and repaint [data-pd-bar]'s title). (3) THE LABEL MANAGER (rename/merge/recolor/delete-unused, "powered by fixing B2") — board toolbar → Labels opens a dialog listing every tag with its LIVE usage_count («۲ بار استفاده»); Enter renames (a colliding name MERGES onto the existing tag — links move, source dies), the 8-swatch palette recolors (cures B4's palette collisions: pick, don't hash), the merge-select folds one label into another, and the ✕ deletes UNUSED tags only (409 tag_in_use when linked). New API: GET /api/tags, PATCH /api/tags/:id (rename-merge OR recolor; renames rewrite every affected task's search_tags so FTS follows), POST /api/tags/:id/merge, DELETE /api/tags/:id — all user-scoped (rule 1), all refreshing usage. Two modal-race fixes found by the e2e hammer: onChanged is now close-proof (Esc racing an in-flight PATCH→refresh must not cancel the board reload — stale chips) and the recolor triggers refresh(). 12 i18n keys EN+FA (db.labels*/usedTimes; 991→1003). Bumps: devboard.js v13→16 (manager + race fixes), board-page.js v3→4, project-page.js v6→7 (also i18n.js v69→70 + i18n-en/fa v12→13 keys), devboard.css v4→5 (db-labels-* styles). Tests: +4 vitest devtask-label-manager (rename-FTS-follows, merge totals + single links, delete 409/200, rule 1) + 2 e2e label-manager.spec.ts (manager UI + drag-into-zone + tier tooltip), 44 e2e total. Also fixed a DATE-DEPENDENT flake in alpine-hard-load (heatmap .first() is the pad-to-Sunday cell when the 91-day window starts mid-week — nth(7) is always a real cell). Carries forward v328. // S30 batch 3 (Tier 2 — "make the data visible", user request 2026-09-12): (1) REPORTS task analytics — /api/reports/summary gained tasks.priority (per-tier {total, done} across every live task — "how much of my backlog is urgent?"), labels (top 12 by task usage with done + fresh-30d counts — the label-trends ask, counts-only per the vision), and sprints (the last 10 real sprints with DONE counts per priority tier). The reports page grew the Task analytics card: the 4-tier stat strip, the backlog SHARE BAR (urgent-first segments reusing the prio-* pastels, aria-label carries the counts), label distribution chips (dot + name + n + ✓done + +fresh), and the sprint-velocity table (prio-dot column heads, per-tier done counts, deep links to each sprint). copyDigest/downloadCsv carry the new sections (MD: per-tier open/done + top-8 labels; CSV: tasks/labels sections). (2) DASHBOARD "urgent across projects" — the FIRE STRIP: cross-project urgent+high non-done tasks (up to 12 rows, urgent first, deep-linking to board.html?project&task with the editor open; the project name links to the project page; total count in the header). Renders right under the resume card ONLY when something is burning (alert layer, not a pref-gated section — quiet means invisible, like the overdue chips); JSON branch carries urgent + urgentTotal; new 'flame' icon case. faNum() on the reports card keeps FA digits. 14 i18n keys EN+FA (reports.tasks*/labelDist/labelHint/velocity/vel* + dash.urgent*; 977→991). Bumps: i18n-en v10→11 + i18n-fa v10→11 (dynamic ref in i18n.js v67→68), reports-page.js v3→4, calendar.css v2→3 (rep-tasks styles), dashboard.css v2→3 (dash-urgent styles). Tests: +4 reports-tasks (priority mix + labels + velocity; rule-1 isolation; JSON urgent payload; HTML strip only-when-burning). Carries forward v327. // S30 batch 2 (board UX, user request 2026-09-12): (1) the FILTER BAR — board.html renders a priority×label toggle row above the columns (each group OR within itself, AND across; empty = show all; clear + a "{n} of {m} shown" hint), and the project page's board preview gets the twin (client-built into the server-mounted [data-pd-filter] div from the /api/projects/:id truth payload — the DOM renders only 5/column; filtering hides .pd-task-wrap in place so the htmx markup survives; insertTaskChip + the more-link expansion respect the active filter). Clicking a CARD's label chip toggles that label's filter (GitHub behavior) on both surfaces. (2) TRANSLATED priority labels — board cards' prio-dot title was the raw "urgent" string; now B().prioLabel (db.pr.* keys) + the cycle hint, and the sprint circles' dot gained its own title/aria-label (the parent dot title appends " · prioLabel"). (3) MD EXPORT/COPY CARRIES PRIORITY+LABELS — "- [URGENT] Fix auth leak #UI/UX #Security" (the owner's own format) via mdTaskLine (devboard.js, shared): title whitespace collapses to one space (multi-line titles stay one bullet), label spaces hyphenate; board export now reads from the LOADED STATE not the DOM (the DOM only showed what the filter let through — the project page had already fixed that class in Session 24); pdColItems went rich ({title, priority, tagNames} via the devTaskTags flat join). (4) CLICK THE DOT = CYCLE PRIORITY — the prio-dot became a TRANSPARENT 24px hit-area button (.prio-dot-btn in devboard.css) wrapping the unchanged 9px .prio-dot span (zero specificity fights with the !important .pd-task/.db-card color rules): low → medium → high → urgent → low, optimistic DOM update (dataset + dot + meta + re-sort via pdSortWrap) + PATCH; board re-renders, project page updates in place. The card-open handlers guard on the dot + label chips. (5) PROBLEMS-BOX COMPOSER PRIORITY PICKER — the bulk bug-add flow (Problems tab, one line = one task) defaulted everything to medium; now a class-coded <select> (Urgent/High/Medium/Low, trL'd) rides the whole batch. 9 i18n keys EN+FA (db.filter*/db.cyclePrio, 969→977). Bumps: devboard.js v11→12, board-page.js v1→2, sprint-page.js v1→2, project-page.js v4→5, i18n-en v9→10 + i18n-fa v9→10 (dynamic ref in i18n.js v66→67), devboard.css v2→3 (filter bar + .prio-dot-btn). Carries forward v326. // S30 batch 1 (user request 2026-09-12, "remove the whole thing" + the B-fixes): (1) the MANUAL PROGRESS BOX is REMOVED — slider/milestone-chips/Auto-Manual/note/timeline, UI and function: 0051 nulls every projects.progress_percent override (progress is ALWAYS the computed dev-tasks→hurdles number), drops project_progress_log (0050, one day old), PATCH progress_percent/progress_note now 400 (schema stripped) and GET /:id/progress is 404; the header keeps the read-only computed bar + sr-only % (repainted by __pdPaintAutoProgress — no Auto/Manual split left). (2) B1 — labels survive archive→restore: project_archives.tags (JSON name+color snapshot, 0051) written before the dev_task_tags CASCADE, relinked by name on restore (setTaskTags). (3) B2 — tags.usage_count finally MAINTAINED: refreshTagUsage recomputes dev-task links + project chips on every mutation (create/PATCH/tag add-remove/task delete/archive/restore). (4) B3 — dev_tasks enter FTS: dev_tasks.search_tags (space-joined label names, 0051) + external-content dev_tasks_fts + ai/ad/au triggers; /api/search returns a tasks group (title + LABEL hits, priority dot + project sublabel in the palette); syncTaskSearchTags re-indexes on every link change. (5) B4 — new tags pick the LEAST-USED palette color (tagColorFor), killing the Refactor/Tech-Debt #E59AA5 collision class. Bumps: project-page.js v3→4, project-header.css v3→4, command-palette.js v1→2 (23 pages), i18n-en v8→9 + i18n-fa v8→9 (Tasks key, progress keys dropped; dynamic ref in i18n.js v65→66). Tests: project-progress.test.ts rewritten (2 removal pins), +5 devtask-archive-search (B1/B2/B3/B4), 340 total. Carries forward v325. // S29 (agenda 4+5): backup-health visibility + the richer progress box. Agenda 4: /api/admin/backup/status extended with health (fresh ≤6h | late ≤12h | stale >12h | never | unknown — parsed from the newest snapshot filename, slice(9) — "snapshot-" is 9 chars), planb {count, lastSentAt} on EVERY branch (the Telegram channel is GitHub-independent), and encrypted (boolean only). The admin console Backup tab grew the health line (freshness verdict + encryption flag, .adm-health-bad tint on stale/never/plaintext) + a Plan B card with a ONE-CLICK trigger (POST /api/admin/backup/planb — empty-since-birth was a hidden standing owner action; now it is a warning next to a button). 18 i18n keys (backupFresh/…/planbChats). Agenda 5: 0050_project_progress_log (id, user_id, project_id, pct nullable CHECK 0-100, note ≤200, created_at + indexes) — the manual override finally has UI + HISTORY: the project header's read-only bar is now an interactive box (range slider 0-100 step 5, milestone chips 0/25/50/75/100 ≥40px, Auto ⇄ Manual toggle, optional milestone note). PATCH logs only CHANGED values (re-sends dedupe); progress_note is a timeline rider, never a SET column. GET /:id/progress answers entries + current {pct, auto, autoPct} (manual wins per 0002; dev tasks → hurdles); ?format=html renders the htmx-swappable timeline (Activity tab). The detail page now honors the override even when dev tasks exist (the one surface where it was dead). Kanban cards (projects.html) carry a bucket-tinted bottom progress strip (loadProjectProgress — batched dev+hurdle aggregates; same buckets as the timeline badges). project_progress_log joined SNAPSHOT_TABLES (the drift guard caught it — milestone notes are user content). Bumps: admin.js v4→5, admin.html (panel), misc.css v4→5 (adm-health-bad), project-page.js v2→3, project-header.css v2→3, canvas.css v3→4 (kanban strip), i18n-en v7→8, i18n-fa v7→8 (21 new keys, dynamic ref in i18n.js v64→65), sw v324→325 (admin.html precached shell changed). Tests: +5 backup-status (fetch-stubbed GitHub), +5 project-progress (dedupe/null/dev-task formula/html fragment/rule-1 isolation), +1 E2E project-progress.spec.ts. Carries forward v324. // Session 29 (SWOT highest-leverage batch — board DATA INTEGRITY + a dead-page P0): (1) P0 — the sadhana/To-do board had been DEAD since v0.3.10.2 (the Jalali extraction, commit 317724e): jalali.js declared top-level `function g2j` etc. → var-like globals, and sadhana-page.js's top-level `const { g2j, … } = window.__hibJalali` destructure collided → SyntaxError at parse → the script never ran → board stuck on "Loading…". Fix: jalali.js IIFE-wrapped (window.__hibJalali = sole global; verified in a VM probe — zero leaked globals). New e2e/sadhana.spec.ts (board boots with 0 page errors + task-card create→reload round-trip — E2E had NO sadhana coverage, which is how 4 release trains shipped a dead page). (2) 0049_canvas_angle: angle REAL DEFAULT 0 on canvas_elements + elementSchema.angle (-3600..3600) + INSERT/ON-CONFLICT — the mtr rotation handle now ROUND-TRIPS on both boards (canvas.js + whiteboard.js: angle in every objectToData branch + rotate()+setCoords on the makeObject load path AND the async image-load path; arrows stay rotation-locked by design; under rotation the notebook saves the ORIGIN (obj.left/top — the rotate pivot) instead of the AABB so reconstruction is exact). (3) W2 — sticky resize now DURABLE: canvas.js's default note branch bakes obj.width×scaleX (min 80) into the record like the image/shape branches (resize by scale was silently reverted on every reload). (4) W3 — notebook object:modified now mirrors canvas.js persistActive (snapshot before → save → history.commit('modify') on real change via snapshotOf/dataChanged) so moves/resizes/rotations are UNDOABLE. Bumps: canvas.js v26→27, whiteboard.js v22→23, jalali.js v1→2. New tests: sync.test.ts angle round-trip (default 0, LWW, out-of-range 400), canvas-board.spec.ts scale-resize+rotation persistence, notebook.spec.ts move durability + Ctrl+Z position restore, sadhana.spec.ts ×2. Also external uptime monitoring: GitHub Actions prober (30 min cron) → healthchecks.io "hibana-uptime" (independent failure domain), bun.lock regenerated (CI had been red for 181 runs on `bun install --frozen-lockfile`). Carries forward v323. Fabric v7's Textbox defaults give the four corner handles scalingEqually (letters stretch, wrap frozen) and only ml/mr a width action — and nothing re-measures the wrap on a width change anyway (v7 never calls initDimensions in the resize path; the lines cache is only rebuilt on text/style edits). wireTextBoxResize (canvas.js + whiteboard.js, called from each board's makeTextBox) rebinds EVERY horizontal handle (tl/tr/bl/br/ml/mr) to fabric's own changeWidth action (mr's actionHandler: pointer→width, opposite edge pinned via wrapWithFixedAnchor, fires object:resizing) with honest per-handle cursors, hides the vertical mt/mb handles (height is content-driven, never hand-set), and on every resizing tick re-pins __fixedWidth and re-runs initDimensions() — the text re-wraps live (fewer lines as the box widens, taller as it narrows), the height auto-fits, the clipPath re-syncs. Scale stays 1 forever → objectToData's fontSize/__fixedWidth bake is a no-op and the width round-trips through the record; undo ('modify') restores the pre-resize width. Locks stay gated (hasControls=false hides the handles). Bumps: canvas.js v25→26, whiteboard.js v21→22. New E2E: mr-handle reflow + persistence + undo on canvas-board.spec.ts, tr-corner reflow + persistence on notebook.spec.ts. Carries forward v322. // v322: Session 28 (user-report batch, 6 fixes): (1) fabric origin P0 — v7 anchored objects by CENTER (v5 used TOP-LEFT), so every saved note/stroke/shape reloaded half-size up-left and drifted on every save cycle; the shim (src/vendor/fabric-shim.ts topLeftOriginCompat) restores the v5 top-left contract for all shape classes unless a call passes an explicit origin. (2) Notebook/canvas text notes auto-fit their height on load (initDimensions at construction + a post-load reflow — fonts.ready can resolve before load()). (3) Sparks «نمایش همهٔ ایده‌ها» — folder=all used to filter folder_id='all' (matches nothing) and re-rendered the folder grid; now skips the filter. Quick-add on the Ideas page files into the OPEN folder (folder_id on POST /api/projects, ownership re-validated; «ثبت در پوشه: …» hint). (4) Sticky recolor palette floats ABOVE the note (was below). (5) Note-meta carries the weekday + Jalali day + month («شنبه ۲۱ شهریور ۱۲:۲۶», formatNoteDay). (6) Compact note-card action buttons (1.75rem visual, ≥44px hit via ::after rings) + repaired the broken kanban flat-fill selector list in notifications.css (the comma list had merged into the first :hover block and painted every stat card a pastel — now transparent + border only). Bumps: canvas.js v24→25, whiteboard.js v19→21 (v21: the notebook sheet auto-grows + scrolls — fitSheetToContent), app.js v172→173, sparks-page.js v1→2, i18n-en v6→7, i18n-fa v6→7 (dynamic ref in i18n.js v63→64), quicknotes.css v4→5, notifications.css v2→3, canvas.css v3→4 (notebook scroll sheet), fabric.min.js →?v=2. Tests: 323 vitest (5 new: sparks folder views + formatNoteDay), 20 E2E green. // Session 28: sticky-factory consolidation (public/js/sticky.js — the ONE makeStickyNote shared by both boards; canvas.js 3069→2986, whiteboard.js 1396→1600 w/ new features) + notebook PNG export (whole page/selection, canonical LIGHT view in dark mode — the CSS invert can't ride a bitmap) + clipboard-copy on both boards + notebook sticky recolor palette (first undoable 'modify' on the notebook — undo/redo grew a symmetric modify branch) + board polish (24px palette swatches w/ focus rings — was 22px/no outline on BOTH boards, pop-in animation for popovers/palette, export-row leading icons + focus ring + active press, dark-mode export hint). Bumps: canvas.js v23→24, whiteboard.js v18→19, sticky.js NEW v1, canvas.css v2→3, misc.css v3→v4, i18n-en v5→6, i18n-fa v5→6 (dynamic ref in i18n.js), i18n.js v62→63. New E2E: e2e/canvas-board.spec.ts (3 tests — the canvas-page safety net the handovers asked for since S27). // 2026-09-12 (review round 3, UX polish batch): tour progress dots are now step-jump buttons (24px hit areas via padding+background-clip, hover + focus-visible ring, aria-current="step", i18n aria-labels; new key tour.step) + settings-page.js invites-component dedup (the 47-line mount-time duplicate registration removed — single source at alpine:init, 559→510 lines). Bumps: tour.js v2→v3, polish-batch.css v3→v4 (19 pages), settings-page.js v3→v4, i18n-en.js v4→v5, i18n-fa.js v4→v5 (dynamic ref in i18n.js), i18n.js v61→v62. Carries forward v319 (admin Usage analytics tab). Also carried: 2026-09-12 (review round 3): admin Usage analytics tab — the last §6 open item (feature-usage totals + weighted top-10 activity ranking + 14-day creation histogram; GET /api/admin/usage, lazy-loaded panel, 34 new i18n keys 901→935). Bumps: admin.js v3→v4, misc.css v2→v3 (adm-usage styles, 20 pages), i18n-en.js v3→v4, i18n-fa.js v3→v4 (dynamic ref in i18n.js), i18n.js v60→61. Also carries the devex fix for scripts/smoke.mjs (403-dead since the T6 CSRF tighten — Origin headers added). Carries forward v318 (select affordance + heatmap readability + reports digest export). // carried forward below

// v319: 2026-09-12 (review round 3): admin Usage analytics tab — the last §6 open item (feature-usage totals + weighted top-10 activity ranking + 14-day creation histogram; GET /api/admin/usage, lazy-loaded panel, 34 new i18n keys 901→935). Bumps: admin.js v3→v4, misc.css v2→v3 (adm-usage styles, 20 pages), i18n-en.js v3→v4, i18n-fa.js v3→v4 (dynamic ref in i18n.js), i18n.js v60→61. Also carries the devex fix for scripts/smoke.mjs (403-dead since the T6 CSRF tighten — Origin headers added). Carries forward v318 (select affordance + heatmap readability + reports digest export).

// Static shell: unhashed pages/partials/icons/vendor/fonts (SWR or network-first at
// runtime; precached here for offline). The hashed app bundles come from the manifest
// at install time (below), NOT from this list.
const SHELL = [
  '/',
  '/login.html',
  '/signup.html',
  '/confirm.html',
  '/dashboard.html',
  '/projects.html',
  '/sparks.html',
  '/project.html',
  '/canvas.html',
  '/whiteboard.html',
  '/sadhana.html',
  '/to-do-list',
  '/reset.html',
  '/clients.html',
  '/archive.html',
  '/reports.html',
  '/calendar.html',
  '/notifications.html',
  '/settings.html',
  '/board.html',
  '/sprint.html',
  '/admin.html',
  '/404.html',
  '/clip.html', // Session 19 cron round 2: web-clipper popup (offline-safe)
  '/partials/nav.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-light.png',
  '/logo-dark.png',
  '/vendor/bebas-note/font-face.css',
  '/vendor/bebas-note/BebasNotes-Regular.woff2',
  '/vendor/bebas-note/BebasNotes-Bold.woff2',
  '/vendor/bebas-note/BebasNotes-Light.woff2',
  '/vendor/manrope/font-face.css',
  '/vendor/manrope/Manrope-400.woff2',
  '/vendor/manrope/Manrope-500.woff2',
  '/vendor/manrope/Manrope-600.woff2',
  '/vendor/manrope/Manrope-700.woff2',
  '/vendor/fabric.min.js',
  '/vendor/htmx.min.js',
  '/vendor/idiomorph-ext.min.js', // P4 (Focus 2): htmx morph swap extension for notebook
  '/vendor/alpine.min.js',
  '/vendor/jalaali.min.js',
  '/vendor/vazir/font-face.css',
  // P9 (Focus 2): Vazir woff2 files removed from SHELL precache — they're only needed
  // by FA users (~132KB for 3 weights). EN users never inject Vazir (i18n.js:ensureVazir
  // only fires when lang=fa). The runtime SWR cache (Class 3 below) caches them on
  // first FA page visit. Offline FA users who never visited a FA page online fall back
  // to system-ui (acceptable degradation). font-face.css stays in SHELL (tiny, and the
  // CSS is needed to trigger the woff2 fetch when Vazir activates).
  '/Login.jpg',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      // Static shell — with cache:'reload' (Session 27 fix, 2026-09-12): cache.addAll()
      // uses default fetch semantics, so the browser's HTTP cache (vendor files are served
      // max-age=86400) can hand back a STALE file during a new version's install — a
      // deploy that updated fabric.min.js would precache the OLD bytes under the NEW
      // cache version, and clients would keep running the stale vendor until the next
      // version bump (the v313 fabric-v7 compat rollout was exposed to exactly this).
      // 'reload' forces a fresh network fetch per shell file. Install still must survive
      // a missing manifest — but a shell file that cannot be fetched AT ALL fails install
      // (same atomic behavior as the previous addAll).
      await Promise.all(
        SHELL.map((url) =>
          fetch(url, { cache: 'reload' }).then((res) => {
            if (!res.ok) throw new Error(`shell precache failed: ${url} → ${res.status}`)
            return cache.put(url, res)
          }),
        ),
      )
      // Manifest-driven precache: the hashed app bundles (app.<hash>.js etc.). Best-effort
      // per file: one missing hash must not kill installation for the whole shell.
      try {
        const res = await fetch('/dist/manifest.json', { cache: 'no-store' })
        if (res.ok) {
          const manifest = await res.json()
          const hashed = Object.values(manifest || {}).filter(
            (v) => typeof v === 'string' && v.startsWith('dist/'),
          )
          await Promise.allSettled(
            hashed.map((rel) =>
              cache.add(`/${rel}`).catch(() => {
                /* keep going — the file will be fetched from network on first use */
              }),
            ),
          )
        }
      } catch {
        /* no manifest (dev tree, or offline at install) — static shell is enough */
      }
    })(),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith('http')) return
  // Cross-origin requests pass through untouched (see header note): only same-origin
  // assets/navigations/API get the strategy treatment below.
  try {
    if (new URL(req.url).origin !== self.location.origin) return
  } catch {
    return // unparseable URL — nothing sensible to do with it
  }

  // Soft-navigation page fetches (nav.js): always network, never the cached shell — so
  // shell HTML can't go stale between deploys.
  if (req.headers.get('x-hibana-nav')) {
    e.respondWith(fetch(req))
    return
  }

  // API calls: always network (fresh data); never serve stale from cache.
  if (req.url.includes('/api/') || req.url.includes('/api?')) {
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    return
  }

  // Navigations: network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Session 20 (v280): the navigate re-fetch above re-stamps the request as a
          // worker-initiated fetch — Sec-Fetch-Dest: document never reaches the origin —
          // so an expired/absent session on an authed shell (/app) came back as the raw
          // JSON 401 body, which the browser rendered as a JSON viewer page (no JS, no
          // login bounce). The Worker now also keys on Accept: text/html (middleware.ts),
          // and this redirect is the client-side belt-and-suspenders: a 401 on a real
          // navigation is never a renderable document — bounce to login.
          if (res.status === 401) return Response.redirect('/login.html', 302)
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
    )
    return
  }

  // Assets: strategy split by URL class (perf session 2026-09-10 — see header).
  const url = new URL(req.url)

  // Class 1a — content-hashed dist bundles (/dist/<name>.<hash>.js|css): cache-first.
  // These URLs are content-addressed AND served immutable by _headers — a cache hit is
  // byte-identical to origin by construction, forever. (dr-integrity session wiring.)
  // Class 1b — versioned app assets (/js/x.js?v=N, /css/x.css?v=N): cache-first. The ?v=
  // query is part of the cache key; dev-mode pages + in-code injections still use it.
  // Hard refresh (req.cache === 'reload') still goes to network in both.
  const hashedDist = url.pathname.startsWith('/dist/') && /\.(?:js|css)$/.test(url.pathname)
  const versioned = /^\/(js|css)\//.test(url.pathname) && /^\?v=\d+$/.test(url.search)
  if (hashedDist || versioned) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req)
        if (hit && req.cache !== 'reload') return hit
        const res = await fetch(req)
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })(),
    )
    return
  }

  // Class 2 — vendor libs, fonts, images, webmanifest: stale-while-revalidate. Serve
  // the cached copy instantly, refresh it in the background (names are unhashed, so
  // a deploy can change content under the same name — hence revalidation).
  const staticish =
    url.pathname.startsWith('/vendor/') || /\.(?:png|jpe?g|svg|webp|ico|woff2?|webmanifest)$/.test(url.pathname)
  if (staticish) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req)
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          })
          .catch(() => null)
        if (hit && req.cache !== 'reload') {
          refresh.catch(() => {}) // background refresh; the cached copy answers now
          return hit
        }
        const fresh = await refresh
        if (fresh) return fresh
        const fallback = await caches.match(req)
        return fallback || Response.error()
      })(),
    )
    return
  }

  // Class 3 — everything else same-origin (unversioned JS, partials, misc): network-
  // first with cache fallback (2026-08-26). Cache-first kept pinning old CSS/JS after
  // deploys — a hard refresh doesn't bypass the SW, so users stayed on stale styles.
  // Network-first lands every deploy on the next load; offline still gets the shell.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
  )
})
