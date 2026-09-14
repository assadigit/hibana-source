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
// v341 (2026-09): S39 — the media gallery page joins the offline shell.
// v339 (2026-09-13, S40): sparks.html (inline folder-restore script), canvas.html +
// whiteboard.html (align buttons), app.js v174 (soft shelf refresh), sparks-page.js v3,
// canvas.js v29, whiteboard.js v25, i18n-en/fa v18 (+3 align keys).
// v340 (2026-09-13, S41 — owner mobile report): sparks.html changes (emoji-picker.js
// script tag + sparks-head class), so the SHELL entry must rotate; sparks-page.js v4
// (folder-dialog emoji picker + icon prefill), dashboard.css v6 (two-up folder grid
// ≤480px, touch-visible ⋯ menus, 40px chips, header stack ≤640px, emoji styles),
// i18n-en/fa v19 (+2 folder-icon keys), i18n.js v75 (injects i18n-fa.js?v=19).
// v341 (2026-09-13, S42 — owner: "this part is too compacted because of right left
// handles. expand this section. make handles over them."): the dashboard's projects-
// by-stage carousel strip now spans the FULL section width; the prev/next handles are
// absolute overlays (.stat-stage anchor + translucent/blur style) instead of flanking
// flex columns that stole ~5rem of card width on phones; at-start/at-end auto-hide.
// dashboard.css v6→v7 (20 shells); the dashboard main is a SERVER fragment (no shell
// rotate needed beyond the css link).
const VERSION = "hibana-v354" // S46.2 (owner's 4 follow-up reports): (1) desktop urgent rows RTL/LTR split — root cause was the FA page's RTL flex shrink-wrapped .dash-urgent-main to content width, so short Latin titles sat further right than long ones; fix = direction:ltr on .dash-urgent-row (main left-aligned consistently; Farsi text still flows RTL via the S31b plaintext on .dash-urgent-main — analytics Farsi-dot-right e2e pin still green). (2) the main CTA (+) was dead-wrong — the S46 idea-only + on projects replaced; now EVERY main surface (dashboard/projects/sparks/sadhana) carries the unified .fab-stack[data-fab] chooser with 3 items: new idea (data-quickadd-open) / new project (data-projectquickadd) / new quick note (data-notequickadd) — the dashboard's "New Task" item swapped for "New idea" so all 4 surfaces match. (3) item 12 wand — confirmed working (repro: wandVisible=true on hover of a freshly-added task); the owner's "needs refresh" was stale SW (pre-S46 project-page.js). Defensive fix: magic-wand.js's injectDevTaskMagic now ALSO stamps .pd-task-wrap .pd-task-title (single source of truth). (4) item 13 bundle: (13b) shrunk the 3 project-progress head buttons (برد تمام‌صفحه/اسپرینت جدید/اسپرینت‌ها) via a high-specificity .pd-board-head .row > .btn/.pd-new-sprint rule (fs-sm, 2rem min-block); (13c) #pde-form task editor now has a screenshot row — «افزودن اسکرین‌شات» file input (upload + pin via 0054) + «تصاویر سنجاق‌شده» view button (opens taskShotsDialog) + a live count badge; (13d) #pde-form modal anchored near the top (margin-block-start: clamp(1rem,4vh,3rem)) — was UA-centered mid-viewport, far from the project heading; «ویرایش» label shrunk (fs-md). No schema change. Bumps: dashboard.css v10→v11, project-header.css v12→v13, project-page.js v15→v16, magic-wand.js v10→v11, i18n-en.js v23→v24, i18n-fa.js v23→v24 (ref in i18n.js), i18n.js v79→v80; + 4 HTML pages got the FAB chooser markup (dashboard/projects/sparks/sadhana). // S46 (owner: 13 UI/UX refinements on top of S45's shipped crown work): (1) dashboard urgent rows dir=auto — Latin titles finally read LTR (was split LTR/RTL); (2) urgent box moved UNDER پروژه‌ها (was above all sections; falls back to under resume-card if projects hidden); (3) note-controls-toggle icon → a real gear (new 'settings' icon case in html.ts; 'gear' sun-burst stays for the doing stage); (4) sadhana filter-tags hidden behind a <details> toggle so the subbar doesn't crowd (#filterCount still announces the active filter); (5) projects FAB unified to a single + (header «New project» button covers project creation); (6) smaller project list titles (.pc-title 1.15→1rem); (7) canvas pen-widths + colors grouped behind <details> popovers (summary shows the active pick; list expands inline); (8) softer/smaller tag chips (bg 12%→7%, border 50%-softened, text 62%→55%); (9) screenshot empty-state spans the .shot-grid (grid-column 1/-1 — was squeezed into one 9rem cell, read "compacted on the right"); (10) screenshot note → MODAL (reuses makeDialog) + compact Save/Cancel + «create bug/idea from this screenshot» (note becomes a dev_task title, shot pinned via 0054); (11) smaller آخرین تغییرات tab (.detail-tab fs-lg→fs-sm) + history (fs-lg→fs-sm); (12) magic-wand + ⋯ menu now inject on freshly-added tasks (injectPdTaskMenus() in insertTaskChip — was swap-only, needed a refresh); (13) attach screenshots when defining a progress-box task (#pd-taskadd-shots; upload + pin via 0054 after the task POST). No schema change. Bumps: layout.css v8→v9, polish-ui.css v3→v4, misc.css v7→v8, project-header.css v11→v12, canvas.css v4→v5, sadhana-board.css v3→v4, project-page.js v14→v15, canvas.js v30→v31, i18n-en.js v22→v23, i18n-fa.js v22→v23 (ref in i18n.js), i18n.js v78→v79, dashboard.css v9→v10 (urgent-title plaintext for the Latin-LTR fix). // S45 (owner directive: "improving UI/UX of sprints and projects page and functionality"): SPRINT BATCH — (S1) RENDER-TIME i18n: the sprint page's INJECTED DOM (the categories side-head, the chip popover's Save/Finish/Reopen/Delete, the new-category form's Add/Cancel) rendered ENGLISH on the FA page forever — i18n.js's apply() only scans the static DOM and injected data-i18n attrs are never re-scanned; every injected string now translates AT RENDER via _t() (boot already awaited hibanaI18n.ready, so the FA dictionary has landed), and the law is documented in i18n.js's header so it can't bite a third time. (S2) MOBILE HIERARCHY FLIP: ≤760px the TIMELINE renders FIRST and the categories panel drops BELOW it (the side used to stack ~580px of chrome — wrapped toolbar rows + a 326px side panel — above the page's whole purpose); ≤640px the toolbar compacts (the title ellipsizes into the back-link row, the desktop flex-gap spacer stops burning a row). (S3) FINISH reads as a control, not an error banner: outlined danger (was a 264px solid-red block, full-width on phones), the running sprint's NAME rides its own ellipsized span (#sp-finish-name), full context on the tooltip + aria-label. (S4) the STRIP is finally visible: clip 9→20px tall, chip 22→28px, dots re-anchored on the taller strip, lane 3.1→4.4rem (the S35 anatomy is untouched: startdot/clip/clip-fill/ticks/live-edge/enddot + chip stats all stay e2e-pinned). (S5) TOUCH FLOOR: the sprint chip (74×22 / 198×22 — the mobile audit's last standing TAP flag) + the popover buttons + the side panel's cat-tools clear 40px on (pointer:coarse), and the lane grows WITH the chip so the strip geometry never collides. (S7) the no-sprints lane speaks the app's empty-state language: a dashed card with a ◆ tile, a one-line hint, and a CTA that opens the SAME define popover as the toolbar's ◆ button (was a bare muted span — which was also permanently English: its `lang === 'fa'` ternary compared the lang FUNCTION to a string, always false). Bumps: sprint-page.js v6→v7, devboard.css v9→v10 (20 shells), i18n-en/fa v21→v22 (+sp.emptyHint), i18n.js v77→v78 (injects fa v22). // S45 (owner directive: "improving UI/UX of sprints and projects page and functionality"): PROJECTS BATCH — (1) the stages home is no longer six big count-boxes and nothing else: the glance boxes became a COMPACT INLINE RAIL ([icon · count · label] one line, ~44px, same click-to-filter / is-active / is-empty semantics, S44 in-place contract intact) and the home gains «فعالیت اخیر / Recently active» under it — six most-recently-touched projects as flat hairline rows (badge + title + ago) + the «همهٔ پروژه‌ها» link; zero-projects home renders the capture empty state (listFragment) instead of a hollow rail; grid+status (no-JS fallback) now renders the stage CARDS below the rail (was a dead end); (2) SORT: ?sort= stage|recent|title on GET /api/projects (zod-validated ORDER BY switch — default unchanged) + a select in the filter form (i18n sort.*, remembered in localStorage like the view pref, rides every htmx request); (3) 390px filter reflow: search full-width own line, the three selects share the row below (search used to collapse to 48px); (4) FAB clearance: body:has(.fab-stack) main.shell earns bottom padding ≤1140/1024px so the last content row scrolls clear of the fixed stack (it sat ON the glance boxes); + precent-list minmax(0,1fr) — the S43 ghost-track law caught live by my own probe (an implicit auto track sized the row to the nowrap title max-content, 476px in a 363px phone). Bumps: dashboard.css v8→v9 (20), misc.css v6→v7 (21), layout.css v7→v8 (23), components.css v2→v3 (23), i18n-en/fa v20→v21 (+sort.*), i18n.js v76→v77 (injects fa v21), projects-page.js v2→v3. // S44 (owner: three asks): (1) sparks "there must be a way to delete/edit the folder ideas, for example clicking on this [⋯] on folders" — every spark VIEW now carries the ⋯ (list rows, kanban cards, sticky notes used to render ideas with NO edit/delete; the injected host carries data-nav-local so nav.js's [data-nav-url] interceptor lets the ⋯ open instead of navigating) + open menus survive the 30s shelf poll (beforeSwap capture / afterSwap re-open — the ⋯ used to vanish mid-read, reading as "clicking does nothing") + the folder-grid ⋯ reveals on focus-within; (2) projects glance strip "nothing happens" — nav.js's capture-phase link interceptor swallowed the [data-pglance] click then no-op'd on the same URL (stopPropagation killed the page's in-place filter handler); the boxes carry data-nav-local so the page filters IN PLACE via the form's own change machinery (grid flips to cards first), and nav.js now re-executes *-page.js on SAME-PAGE re-entry (projects.html→projects.html?status=… used to land unmounted: default grid, dead listeners); (3) sprint timeline "space and offset to today so you can see the actual point" — the home axis LEADS with ~10% pad days before today (part of the px fit, zero-scroll preserved) + a «امروز/Today» flag chip rides the line top. Bumps: nav.js v2→v3 (17 shells), sparks-page.js v4→v5, projects-page.js v1→v2, sprint-page.js v5→v6, quicknotes.css v5→v6 (22), devboard.css v8→v9 (20), dashboard.css v7→v8, i18n-en/fa v19→v20 (+db.today), i18n.js v75→v76. // S42 (owner: "this part is too compacted because of right left handles. expand this section. make handles over them."): the dashboard's projects-by-stage CAROUSEL was squeezed by its own controls — the prev/next circular handles flanked the strip as flex columns (2rem + gap each side ≈ 80px of a 342px section on a 390px phone, so every stage card rendered ~262px wide with ellipsized titles). The strip now spans the FULL section width (2-row grid: .stat-stage anchor + dots row); the handles float OVER the strip's edges (absolute, vertically centered, 40px, translucent fill + 3px backdrop blur, slight gutter overhang) and step aside ENTIRELY when there is nothing left to page (at-start/at-end auto-hide — :focus-visible still reveals them for keyboard users). HTML order now [stage[track,prev,next]][nav(dots)]; data-stat-* hooks unchanged, so app.js's syncStatCarousel pages/dots/ends logic is untouched. Bumps: dashboard.css v6→v7 (20 shells), sw v340→v341.
// S39 (user request 2026-09-13, two asks): (1) "an archive gallery of pics, similar to wordpress, so the user can delete the unneeded files to make up more space" → /gallery.html + /api/media (every picture across projects, project + pin chips, space meter on the 0054 bytes column, delete = the only removal path, the S38 never-expire law) + the Gallery nav/mobile-sheet entries; (2) "you can't add note card on that screenshot; you must be able to stick that screenshot to progress box items (e.g. a UI bug screenshot sticky to Problems box)" → migration 0054 (screenshots.task_id FK dev_tasks ON DELETE SET NULL + bytes + idx): the shot NOTE is now click-to-edit (the whole note area — the tiny pencil alone read as "can't add a note"), each shot carries a pin button → a grouped task picker (five boxes, search, current ✓), the pin line on the card says WHICH box + item (note + picture proof + how it's categorized), the task cards + Problems-tab rows carry 📌 N badges → a pinned-pictures dialog (zoom/unpin), and project hard-delete + the 7-day purge now clean the remote KV/S3/GitHub bytes through services/shotstore.ts (same precedence kv→r2→github) so no orphaned objects. Bumps: project-page.js v12→14, layout.css v3→7, project-header.css v8→10, i18n-en/fa v16→17, i18n.js v73→74, mobile-nav.js v4→5, gallery.html+gallery-page.js new, SHELL += /gallery.html (layout/project-page re-bumped mid-verify: the browser SW caught stale same-URL edits — the cache-bust rule exists for exactly this).
// S36 (user: "for now i can't buy R2 from cloudflare. what are free alternatives"): R2's free tier is CARD-GATED (payment method required before the service can be enabled) — the verified no-card alternative is Backblaze B2 (10 GB free, S3 API, signup "no credit card required"), plus Supabase Storage (1 GB, REST) / Cloudinary (~25 credits/mo, image CDN) as non-S3 options. The S3/SigV4 adapter (src/services/r2.ts) is now provider-generic: R2Config.region joins the config (env R2_REGION or S3_REGION, else derived from the endpoint host — *.r2.cloudflarestorage.com → auto, s3.<region>.backblazeb2.com → that region, else us-east-1) and flows into the SigV4 credential scope, so B2/Wasabi/MinIO work through R2_ENDPOINT unchanged. Backend-only; R2_* unset = GitHub path exactly as before. Also fixed here (caught by check-cache-bust under the sandbox's mode-bit noise): board-page.js dynamically injected chip-render.js?v=1 while the HTML tags carry v=2 — aligned to v=2 + bumped board-page.js v7→8 (the build rewrite takes any ?v=N spelling, prod dist wiring unaffected). Pre-existing test-file type errors fixed (Db re-export, DOM.Iterable lib, openRows rename) — typecheck back to 0. +3 vitest (r2-storage region derivation/override/scope).
// S35 (user request 2026-09, three asks): (1) SPRINT STRIPS — the sprint board (sprint.html, the one with the timeline) now renders sprints like a VIDEO-EDITING TIMELINE: a start-dot at started_at, a teal strip that drags to TODAY while the sprint runs (a pulsing live-edge dot at the today line) and FREEZES at ended_at when finished (end-dot); the chip carries name + N days/Day N + done/assigned + doc-checked stats, the strip carries the WORK: a fill sized by assigned-tasks-done + a tick for every day that closed at least one task (dev tasks done in the sprint window — the «انجام شده» truth); the chip popover shows dates + duration + done + active days + doc-checked + a «برنامه» deep link into the plan editor; computeRange extends the home axis BACK to the earliest sprint still overlapping the last ~6 months so finished strips stay visible (older sprints drop off; the ‹ pager reaches them). (2) THE ARCHIVE — archived_state='offline' (the 0031 column, finally earning its keep) parks ideas/projects: POST /api/projects/:id/archive + /unarchive (history-logged, rule-1 scoped), excluded from the projects list + glance counts + ideas shelf + dashboard queries, rendered on /archive.html as a RESTORE-able shelf (archived=1 lists parked rows incl. sparks — the spark-exclusion is waived there); the project head swaps the Archive button for an amber banner + Restore; NOT trash (no purge), NOT halted (paused mid-work). (3) SCREENSHOTS AS UI/UX PROBLEM REPORTS + CLOUD STORAGE — migration 0053 (screenshots.resolved 0/1): each shot is a card (image zoom lightbox + inline note editing + open/fixed toggle + delete w/ remote cleanup); upload drops the caption prompt (the note lives on the card); NEW STORAGE ADAPTER src/services/r2.ts — Cloudflare R2 (the chosen free-cloud-storage-by-API: 10GB-month free, 1M+10M ops, ZERO egress, same CF account) via S3 REST + AWS SigV4 in pure Web Crypto (Workers + Node), env R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET(+R2_ACCOUNT_ID or R2_ENDPOINT for any S3-compatible); unset = GitHub Contents API exactly as before (screenshots only — avatars/logos/backups stay on GitHub). Bumps: sprint-page.js v4→5, devboard.css v6→7, project-page.js v11→12, layout.css v2→3, project-header.css v7→8, i18n-en/fa v14→16 + i18n.js v71→73 (keys 1025→1039 + archive.hint rewrite), sw SHELL re-fetch (archive/sprint/project/projects html changed). Tests: +13 vitest (r2-storage, screenshot-problems, project-archive — incl. the R2 routing pin + the spark-exclusion-waived fix the archive test caught), +3 e2e sprint-timeline.spec.ts. Carries forward v335.

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
  '/gallery.html', // S39: the media library — offline-safe like every shell page
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
