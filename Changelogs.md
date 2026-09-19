# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.18.0 — Session 79, 2026-09-19. CRON webDevReview round, QA-first. INHERITED WIP: this round opened on an UNCOMMITTED, near-complete feature tree (29 files) left by an interrupted session — "the gallery graduates from viewer to MANAGER" — frontend JS + CSS + i18n + cache-busts all present, backend routes (PATCH/DELETE /api/screenshots/:id) already live since S39/S69. This session's job was verify-then-ship: QA SWEEP FIRST: 8 pages × EN/FA × light/dark × 1280+390px = 0 overflow, 0 console errors, 0 page errors (FA via the user-record language_pref DB flip + revert; dark via localStorage 'hibana-theme' — the raw html[data-theme] eval flip does NOT survive navigation, localStorage does). FEATURE (1a) NOTE EDITING IN THE GALLERY: every gallery card's caption is click-to-edit — a real modal (dialog.gal-note-modal, same shape as the project page's S46 editor: textarea + Save/Cancel + self-cleaning), the textarea carries [data-magic] so the AI wand rides it INSIDE the dialog (top-layer aware, focus-reveal path — verified live: focus → wand visible → popover with Polish/Translate), save is a surgical DOM update (row.caption + .shot-note textContent, no grid re-fetch flash), PATCH round-trip verified through the API + DB; the empty caption carries the affordance too ("No note" invites the first one); keyboard parity (role=button tabindex=0, Enter/Space open). FEATURE (1b) BULK SPACE MANAGEMENT (Select mode): the owner's original gallery ask was "delete the unneeded files to make up more space" — one-by-one confirms made a cleanup pass N-confirms deep. A Select toggle rides the filter row (chip family, aria-pressed, "Done selecting" when on); tapping a TILE (100% target, not the 30px check) or the check picks it; a sticky selection bar (fixed, safe-area aware, sits ABOVE the mobile nav — measured 13px clearance at 390px) counts picks + the bytes they hold (tabular numerals, Persian digits in FA: «۱ انتخاب‌شده · ≈۱ KB»); ONE confirm deletes them all (window.confirm carrying n + freed size), the bar unmounts BEFORE the first DELETE lands (a stale count reads as a lie), toast reports the outcome (full or partial-failure honest split), grid + space meter re-fetch; Esc exits, any filter change exits (a stale selection set would be a trap), soft-nav unmount removes the bar + lightbox + modal (no orphaned fixed elements); delete-disabled at 0 picks (a 0-delete is a misclick trap). STYLING (house rules throughout): glassy dark check discs readable on ANY image (backdrop-filter, brand-fill when picked + checkmark scale-in), brand ring on the picked tile's picture frame (visible from across the grid), picked-beats-fixed-dim opacity rule, 40px touch floor on coarse pointers (hover:none), reduced-motion + prefers-contrast guards, RTL-safe logical properties (check chip mirrored via inset-inline-end — DOM-math verified in FA), selbar wraps center-aligned ≤640px, dotted-underline hover affordance on editable notes. FLAKE FIXED (pre-existing, hit this round, failed on clean HEAD too): canvas-board.spec.ts:248 "mr handle drag → undo" — a 12-step drag slower than the 400ms persist debounce lets persistDebounced fire MID-DRAG, persisting the intermediate width AND pushing an intermediate 'modify' history entry; undo then walks one STEP not one GESTURE (observed: before=150, after=330, one undo → 270). Same family as the S75 notebook corner-drag flake; owner rule "fix the TEST, not the app" (the mid-drag crash-safe persist is defensible product behavior) — the test now poll-undoes (≤3 presses) until the width returns to the pre-drag value AND pins that the typed text survives (undo must never walk past the resize entries into the text-edit entry). 3/3 stability runs. i18n: 12 new dict keys × EN/FA — parity 1339/1339. E2E: 1 new spec (media-gallery.spec.ts "the gallery manager" — note modal + wand-in-dialog + select-mode + bulk delete + filter-exit + Esc-exit, all against the real PATCH/DELETE routes). LADDER (all green): typecheck 0 · vitest 483/483 · node --check · eslint 0 errors (164 pre-existing warnings, unchanged) · build manifest 76 · cache-bust PASS (5 files: gallery-page.js v7, layout.css v18 ×24 pages, i18n-en.js v60 ×24, i18n.js v118 ×24 + FA injector v54 inside, i18n-fa.js v54 via injector) · i18n parity 1339/1339 · playwright 128/128 (48+80 in two chunks — the sandbox reaps detached background processes, so the >10min full run must be chunked within tool timeouts). Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (remote D1s still schema 56); key-custody drill; Dependabot PRs awaiting owner review.
## 1-prev. (v0.3.17.0 — Session 78, 2026-09-19. CRON webDevReview round. QA SWEEP FIRST: 8 pages × EN/FA × light/dark × 1280+390px = 0 overflow, 0 console errors, 0 page errors (FA via the user-record language_pref PATCH + revert, per the S76 QA note; dark verified by the html[data-theme] attribute flip, not by screenshots). STABLE phase → two feature work items + the mandatory styling pass. (1) THE WAND, EVERYWHERE IT SHOULD BE — three silent gaps closed: (a) projects.html stamps data-magic on .pc-title server-side but never loaded magic-wand.js — hovering a project card title did NOTHING there; the script+css now ride the page (wand verified live on a card title); (b) notes.html loaded the wand CSS but not the JS, and the notes-vault markdown editor (textarea.vault-src — a PRIME polish/translate surface) wasn't even in the selector — the JS now rides the page + .vault-src joins SELECTOR (wand verified on the open editor); the wand now runs on FIVE pages (project, projects, sparks, notes, dashboard); (c) TOUCH/KEYBOARD REACH — the wand was hover-only, so on any device without hover (every phone/tablet) the feature was silently UNREACHABLE; a focusin/focusout path now reveals the wand when a qualifying surface gains focus (tapping into a textarea anchors the wand at its corner; tabbing there does the same for keyboard users), with the same cancellable hide-timer semantics as hover and relatedTarget-aware keeping (focus moving INTO the wand/popover never hides it); on coarse pointers the button grows 30→40px (hover:none media) per the touch-floor rule. (2) THE BOARD TASK SEARCH (project.html progress board) — the filter bar gained its third dimension: a free-text search over each card's FULL raw markdown (data-raw-title: title + content — a body-word match surfaces the card, verified live: 'auth' matched both the 'Implement auth flow' title AND the bug task whose CONTENT says 'the auth token expires too early'), composing AND with the existing priority × label chips (a search inside an active label filter narrows within it); 120ms debounce, Esc clears (input-scoped, stopPropagation so dialog-close handlers stay untouched), the bar's ✕ and the miss state's CTA both clear ALL three dimensions; the "{n} of {m} shown" hint now counts the query too; an HONEST miss state rides under the bar (same .pg-filter-empty structure + classes as the S76 projects-list miss — the scan-drift/hover-lift/double-ring polish rides along, compacted to a strip: 1.4rem padding-block + 2.4rem icon so a miss never pushes the board down). The search field itself: chip-scale (26px) but a real text field — placeholder, native ✕ (type=search), focus ring (border + 3px brand shadow), hover border lift, flexes to fill leftover bar space (cap 22rem, floor 7.5rem, own full row ≤640px), prefers-contrast border bump, RTL-safe via logical properties. i18n: 3 new dict keys × EN/FA (db.filterSearchPh / db.filterEmpty / db.filterEmptyText) — parity 1327/1327. LADDER (all green): typecheck 0 · vitest 483/483 (no new server code — the search is client-side) · node --check · eslint 0 errors · build ✓ manifest 76 · cache-bust ✓ (7 files: magic-wand.js v14 on 5 pages, magic-wand.css v4, project-page.js v44, devboard.css v19 on 21 pages, i18n-en.js v59 on 24, i18n.js v117 on 24 + the FA injector path v53 inside it, i18n-fa.js v53 via the injector) · i18n parity 1327/1327 · playwright 127/127 (the focus-reveal wand was the risk area — every textarea-focused spec still green; the wand's fixed corner never intercepts a test click) · agent-browser live: search filter + content-match + hint + miss + Esc + clear-all verified, wand on projects card title, wand on the vault editor via FOCUS (the touch path). Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (remote D1s still schema 56); key-custody drill; Dependabot PRs awaiting owner review. SHIP VERIFIED (S78, 2026-09-19 ~00:05 UTC): pushed 3be36ea → CI GREEN (typecheck + 483 vitest + full e2e) → CD run 35407457184 FULL deploy verified by STEP LIST (guard ✓ → Deploy to DEV ✓ → Live-probe DEV ✓ → Deploy to PROD ✓ → Live-probe PROD ✓ → Purge zone cache ✓ → Restore canonical HTML ✓ → tree clean ✓) — NOT an empty green. Post-deploy live probes: /api/health ok prod schema 56 kv · /api/nav 200 no-store · /login 200 · /app 401 · /nope 404. ALL FEATURES VERIFIED LIVE through the owner's account (preview-only, zero writes): (1) the board task search on اسپورت سیگنال — typing «login» narrowed 7 → 1 (the admin-management task), a garbage query showed the honest miss state, Esc restored all 7, the hint counted «1 of 7 shown» throughout; (2) the wand on the PROJECTS page — hovering GitCurator's card title revealed it (the page's data-magic surfaces were wand-less before); (3) the wand on the notes-vault editor via the FOCUS path (opened one of the owner's 2 vault notes, focused the markdown editor → wand appeared → popover opened with Polish/Translate → discarded). Zip: hibana.0.3.17.0.zip → download folder.
## 1-prev. (v0.3.16.0 — Session 77, 2026-09-18. OWNER BUG-REPORT ROUND: four live-reported bugs, all root-caused + fixed + verified. (1) CODE BLOCKS SILENTLY LOST ON SAVE (owner: "paste code inside <code> in the text editor, it shows, but when hitting save and come back they're lost") — root-caused live with agent-browser + a DB read: Chromium NEVER inserts a raw \n into a contenteditable; a multi-line paste inside the task editor's code block is split into SIBLING elements — <pre><code>line1</code><code>line2</code>…</pre> (toolbar path) or consecutive bare <code class="t-code"> islands (loaded-task path). htmlToMd's pre case read el.querySelector('code') — the FIRST sibling only — so every line after the first was DROPPED from the saved markdown (measured: 4-line paste → DB stored one line; permanent data loss), and the bare-island run produced one separate ``` fence per line. FIX (chip-render.js htmlToMd): pre collects ALL code children joined with \n; walk() merges a run of sibling .t-code islands into ONE fence (edge-newlines trimmed per piece, lang from the first, whitespace-only text nodes between them skipped); codeText() is the shared extractor (text nodes verbatim, <br> → newline, hidden .t-fence markers skipped). PLUS the third facet of the same report: applyTitle() now sets data-raw-title in lockstep with innerHTML — the task editor reopens from that attribute, so a stale value made the just-saved content vanish on reopen AND saving that stale view would permanently revert the edit in the DB. VERIFIED END-TO-END locally: toolbar code button + 5-line paste → all 5 lines in the DB → reopen shows them → edit-save keeps data-raw-title in sync. (2) PROJECT LOGO TOO SMALL ON PC (owner: "make it 100% bigger in PC view") — .pd-logo max 56→112px on desktop (the default), ≤768px keeps the compact 56px so phone headers stay one line; the empty-state placeholder scales to 72px desktop / 56px mobile to match the footprint. Verified: 1280px renders 112×112, 390px renders 56×56. (3) STICKY-NOTE ⋯ MENU CLIPPED (owner: "the setting menu opens into a portion of the sticky note's area — not readable") — the sparks/projects STICKY corkboard notes had overflow:hidden (the square's hard boundary), which clipped the spark-menu-pop to the small square. FIX: .sticky-note is now overflow:visible and the hard boundary moved onto the CONTENT (title + description each line-clamped at 3 with overflow-wrap:anywhere for unbroken URLs); the open menu's z bumped + the NOTE itself rises while its menu is open (:has([data-open])) so a later-DOM sibling note can't paint over the floating pop. Verified with a VLM screenshot read: all 3 items fully readable. (4) AI TRANSLATE DIRECTION UNRELIABLE (owner rule, verbatim: "WHEN TEXT IS FARSI > TRANSLATE > ENGLISH WHEN TEXT IS ENGLISH > TRANSLATE > FARSI") — REPRODUCED LIVE on hibana.ir through the owner's account: the task title "اضافه کردن توانایی پروسس سایت و دسته بندی آنها" → Translate → the suggestion came back as a FA PARAPHRASE ("افزودن قابلیت پردازش سایت…"), i.e. the model's self-detected direction FAILED (the EN→FA direction happened to work, making the failure intermittent and more confusing); the same report's "it refreshes the page" = the wand's change-event dispatch on note textareas triggering the htmx hx-patch → whole-#notebook morph re-render, which reads as a refresh — and with the direction broken the note visibly "stays farsi" through it. FIX (three layers): (a) CLIENT — magic-wand.js detects the input's script (Arabic/Persian block vs Latin letters; Farsi wins ties so mixed prose counts as FA) and sends target_lang ('fa' input → 'en', 'en' input → 'fa'); (b) SERVER — the route accepts target_lang and runAiTransform builds a ONE-WAY prompt ("translate INTO English/Persian… NEVER output <other> prose; English chars only inside code/URLs/identifiers") that survives even a customPrompt (the owner's rule is appended, non-negotiable); (c) VERIFICATION — the output script is checked (prose-letter counting; proper nouns/identifiers of the other script tolerated): a wrong-language answer gets ONE amplified retry (assistant-turn + "your previous answer was NOT in X"), then an honest wrong_language error (503 with EN+FA messages) instead of a same-language "translation". The wand's error path now PREFERS the server's localized ApiError message over the old status-code guesses (a 503 wrong_language used to show the misleading "Workers only" string). Verified locally: payload carries target_lang, retry/wrong-language/service logic green in vitest. LADDER (all green): typecheck 0 · vitest 483/483 (4 NEW S77 direction tests: one-way prompts per direction + direction rule survives customPrompt; same-language answer retried once then wrong_language with exactly 2 calls; directionOk/detectLang heuristics incl. code + proper-noun tolerance + vacuous no-letters) · node --check · eslint src/ 0 errors · build ✓ manifest 76 · cache-bust ✓ (chip-render.js v6→v7 on project+board+board-page inject, project-header.css v27→v28 on 21 pages, canvas.css v6→v7 on 21 pages, magic-wand.js v12→v13 on project+sparks+dashboard) · i18n parity 1324/1324 (zero new dict keys — server messages + existing keys only) · playwright 127/127 (3 upload-progress failures on first run were ENVIRONMENTAL, reproduced on clean HEAD: my server restart had dropped HIBANA_SHOTS_DIR so the disk shotstore was off and uploads 500'd — restarted with the full env, 5/5 green; the fix commit is untouched by that). Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (remote D1s still schema 56); key-custody drill; Dependabot PRs awaiting owner review. QA NOTE for future agents: the local dev server needs HIBANA_SHOTS_DIR=/tmp/hibana-e2e-shots (S61 disk store) or every screenshot upload 500s — a bare PORT+DB_PATH restart breaks the upload-progress e2e specs. SHIP VERIFIED (S77, 2026-09-18 ~22:45 UTC): pushed d6db14f → CI GREEN (typecheck + 483 vitest + full e2e) → CD run 35402644053 FULL deploy verified by STEP LIST (guard ✓ → Deploy to DEV ✓ → Live-probe DEV ✓ → Deploy to PROD ✓ → Live-probe PROD ✓ → Purge zone cache ✓ → Restore canonical HTML ✓ → tree clean ✓) — NOT an empty green. Post-deploy live probes: /api/health ok prod schema 56 kv · /api/nav 200 no-store no cf-cache-status · /login 200 · /app 401 · /nope 404. ALL FOUR FIXES VERIFIED LIVE through the owner's account: (1) the deployed converter round-trips the exact Chromium split structure (4 sibling <code> lines → ONE complete fence, evaluated in the live page context; the live page serves the hashed dist build /dist/chip-render.fb984358.js); (2) the اسپورت سیگنال logo renders 112px wide on desktop (natural 400×143, contain-scaled — was 56px, exactly +100%); (3) the sticky ⋯ menu on the Ideas corkboard is fully visible with all three items readable (VLM screenshot read: «انتقال به بورد / ویرایش یادداشت / حذف», overflow:visible confirmed); (4) BOTH directions of the owner's rule through the REAL model — FA→EN: «ساخت اپ اسپرت سیگنال WEB_WRAPPER?» → «Creating a sport signal app WEB_WRAPPER?» (the exact direction that failed live pre-fix with a FA paraphrase; identifiers stay verbatim by design) and EN→FA: «Cannot login in admin management page. it says password is wrong…» → «نمی‌توانم به صفحه مدیریت ادمین وارد شوم. می‌گوید که رمز عبور اشتباه است…» — both preview-only, zero writes to the owner's data (the one exploratory title translate during diagnosis was PATCHed back to its exact original). Zip: hibana.0.3.16.0.zip → download folder.
## 1-prev. (v0.3.15.1 — Session 76, 2026-09-18. CRON webDevReview round. QA SWEEP FIRST: 8 pages × EN/FA × light/dark × 1280+390px = 0 overflow, 0 console errors, 0 page errors (a false-positive in the sweep script's regression filter was diagnosed — agent-browser eval output is JSON-quoted, `"0px"` != `0px`; the sweep was actually clean). STABLE phase → two work items picked from the backlog. (1) PERF, §10-C's OTHER unbounded journal feed — the S69 fix covered the dashboard's note-chip feed, but the sadhana BOARD's loadAll still fetched EVERY sadhana_updates row ever written and rendered them all (measured on the perf seed: 1.43MB / 530 note items riding the /api/sadhana HX fragment; the growth axis is years-scale total journal volume). FIX: window-function cap (ROW_NUMBER OVER PARTITION BY task_id ORDER BY created_at DESC, id DESC <= 20, COUNT(*) OVER for the per-task total; the cleared_at filter now matches the task filter — cleared tasks' notes no longer fetch-and-discard) — the LATEST 20 notes per task ride every surface, with HONESTY everywhere: the server card badge shows the TRUE total, a "Showing the latest {k} of {n} notes" hint renders when truncated (.task-notes-truncated + .upd-truncated, both FA-localized with Persian digits), and the JSON carries updates_total so the CLIENT-rendered to-do list board (plain-JS sadhana-page.js — a different renderer from the server's sadhanaTaskControls, discovered live: /to-do-list renders .task-card markup client-side from the JSON, NOT the server fragment's .sadhana-card) shows the true count on its 📋 toggle and the hint in its updates panel; the client-side add-note path bumps updates_total in lockstep. Legacy task-note still merges and counts toward the total. MEASURED: no payload change at seed scale (3.3 notes/task avg — the cap is the YEARS-scale bound, honestly recorded in §10); the cap's mechanics verified with a synthetic 25-note task: exactly notes 6–25 rendered (latest 20), 1–5 truncated, badge 25, hint "Showing the latest 20 of 25 notes" / FA "آخرین ۲۰ یادداشت از ۲۵". (2) FEATURE/POLISH — honest filtered-miss empty states on the projects list: a search or tag filter that finds nothing used to fall through to the generic capture CTA ("No projects yet — capture your first idea"), wrong twice over when you HAVE projects (implies emptiness + nudges capture instead of recovery). listFragment now renders a dedicated miss state — search: "No matches … try another word, or clear the filters" / tag: "No projects with this label" — with a Clear-filters CTA (plain anchor to /projects.html: no-JS-safe, soft-nav handles it) and a styled .pg-filter-empty surface (dimmed search icon with a reduced-motion-guarded scan-drift hover, balanced title, hover-lift + double-ring focus CTA, prefers-contrast bumps, RTL twin keyframes). The tag NAME is looked up only on the empty path (one indexed row). A genuinely empty account still gets the capture CTA; the stale view's and halted/status empty states are untouched. STYLING: both new surfaces deepened per the round's mandatory styling pass. QA NOTES for future agents: (a) the to-do list board's language comes from the USER RECORD (not localStorage 'hibana-lang') — verify FA on it by PATCHing language_pref and reverting; (b) agent-browser eval outputs are JSON-quoted — compare with the quotes stripped; (c) this environment's tool output can eat "[h" sequences — byte-check with od before "fixing" a mangled-looking CSS selector (a whole family of perfectly normal [hidden] selectors looked broken through that lens; zero were). LADDER (all green): typecheck 0 · vitest 479/479 (8 NEW: sadhana-note-cap ×4 — cap+hint+badge, under-cap no-hint, exactly-20 inclusive, user isolation; projects-filter-empty ×4 — search miss, tag miss, genuine-empty keeps capture CTA, a HIT renders results) · node --check · eslint 0 errors · build ✓ manifest 76 · cache-bust ✓ (4 files: sadhana-page.js 5, sadhana-board.css 12, to-do-list.css 4, polish-batch.css 15) · i18n parity 1324/1324 (all new copy is server-side trL or client-inline bilingual — zero new dict keys) · playwright 127/127 · agent-browser live: board cap EN+FA both viewports (toggle 23 / 20 rows / hint / 0 overflow / 0 console errors), search-miss empty state live in dark theme + FA server-verified + Clear-filters recovery. Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (staged since S59b, remote D1s schema 56); key-custody drill; Dependabot PRs awaiting owner review. SHIP VERIFIED (S76, 2026-09-18 ~20:40 UTC): pushed cc1f6a5 → CI RED on ONE pre-existing test flake (ratelimit.test.ts "swappable fragment" — the limiter's FIXED 60s-aligned window straddled by the test's ~260ms request span on CI, ~0.4%/run, UNRELATED to the diff; root-caused from the logs, same class as the S73 notebook flake → TEST fixed: keep sending until the limiter trips, worst case one extra bucket, 75-cap) → CD for cc1f6a5 correctly SKIPPED the deploy job (an EMPTY green by design — the gate held) → pushed 26cc5cb (the test fix) → CI GREEN (479/479) → CD 35392364564 FULL deploy verified by STEP LIST (DEV → probes → PROD → purge → restore → tree clean, all green). Post-deploy live probes: /api/health ok prod schema 56 kv · /api/nav 200 no-store · /login 200 · /app 401 · /nope 404. Features verified LIVE through the owner's account (pure reads): the search-miss empty state renders ("No matches" + "Clear filters") and the sadhana JSON carries updates_total (7 live tasks, max 1 update — no truncation on real data, as expected; the cap is the years-scale bound). Zip: hibana.0.3.15.1.zip → download folder.

## 1-prev. (v0.3.15.0 — Session 75, 2026-09-18. OWNER ROUND — QA first, then build. QA SWEEP: 8 pages × EN/FA × light/dark × 1280+390px = 0 overflow, 0 page errors; ONE console error found (project.html bare — no ?id= — fired hx-get /api/projects/__ID__ → a real 404 network request + console noise on every visit; the designed graceful handler caught it visually, but the wasted request is polish debt). FIXED at the mount: strip the hx-* attributes before htmx's load trigger + render the honest empty state (NOTE: deliberately NOT htmx.remove() — that removes the ELEMENT from the DOM, verified live — a trap for future agents). MANDATORY FEATURES (both named candidates): (1) THE FULL STALE VIEW — projects.html?stale=1: the S72 dashboard nudge caps at 3 chips and had no path to the rest; the nudge's new "View all →" link lands on the full view. GET /api/projects?stale=1 filters in-motion projects (unreviewed/investigating/awaiting/doing — halted/operational/spark excluded BY DESIGN, same semantics as the dashboard query, both 14-day cutoffs duplicated verbatim = one source of truth, change together) untouched 14+ days, OLDEST first (what you left hanging longest); view=grid degrades to cards; composes with status/q/tag filters; server-rendered amber banner (the dashboard's .dash-stale-row language — waiting, not an alarm) + count + "Show all projects" exit hatch (data-stale-clear, document-delegated); honest "Nothing is hanging" empty state distinct from "No projects yet"; the hidden stale form input rides hx-include so the initial load carries it; ANY filter interaction exits stale mode (flag cleared + URL cleaned via replaceState so a refresh doesn't re-land in the special view). (2) THE SETTINGS API SHOTGUN CONSOLIDATION (§10-F4, the named perf offender): GET /api/settings/overview composes prefs/me/invites/ai-models/telegram-status/trash — each slice keeps its legacy endpoint's EXACT response shape so every old consumer keeps working; the page's 8 parallel JSON GETs (3 literal duplicates: /api/settings ×2, /api/auth/me ×2, /api/ai/models ×2 via the soft-nav safety re-run) collapse to ONE overview + tags fragment + nav = 13 API calls → 4 (measured live, authenticated). settings-page.js rides a module-scope overview cache (soft-nav re-mounts re-populate fresh DOM from cache, zero network); every consumer falls back to its legacy single-slice endpoint when overview is unavailable (offline/old shell — the 401 path verified live); post-mutation refreshes stay targeted on purpose. BONUS CROSS-PAGE WIN while measuring: FOUR identical /api/auth/me fetches fired on EVERY authenticated page load (i18n apply ×2 + hib-init nav user info + the auth guard) — now ONE via window.__hibanaMe (app.js, promise-memoized {ok,status,body} envelope — the guard needs raw status semantics); language toggles force-refresh the memo BEFORE apply() so the just-PATCHed language_pref is read (hib-init + mobile-nav + settings prefs-save all patched); pages without app.js (clip popup) fall back to direct fetch in i18n. BONUS PRE-EXISTING BUG (surfaced by the QA sweep's page-error check, verified reproducing on clean HEAD): nav.js's S44 same-page re-entry re-EXECUTES *-page.js scripts on soft nav (language toggle → nav.reload()), and settings-page.js's top-level lexical declarations collided — SyntaxError "Identifier has already been declared" killed the ENTIRE re-execution, so the fresh settings shell never mounted (dead components after a language toggle; the historical `const invitesComponent` had the same hazard all along). FIXED: the whole file IIFE-wrapped — every execution gets a fresh scope; toggle cycle now verified error-free with live components both directions. THE E2E FLAKE FIXED FOR REAL (notebook.spec.ts:203 corner-drag — the S73 "re-run green" landmine): root-caused by instrumenting fabric's own event stream — NOT a ±rounding razor's edge (S73's theory) but a STALE-COORDINATES race: exiting edit mode leaves the box selected with live handles, but its geometry re-settles +21.5625px down (exactly one text line — the post-edit save pipeline's re-measure) at an UNPREDICTABLE later moment; a probe taken before the settle yields stale corner coords, the mousedown there grabs NOTHING (fabric: no target), the resize silently no-ops — and the stray mousedown DISCARDS the selection, after which no handles exist at all. TEST FIX (owner rule: fix the TEST, not the app): (1) poll until two probes 200ms apart agree; (2) grab the corner handle VERIFIED (fabric's __corner === 'tr'/'mr') with re-selection on retry (single click on an INACTIVE IText selects without editing); (3) width-growth threshold +140 → +100 (40px slack on the observed +200 landing — the old STRICT boundary flaked when a partial grab landed near it). 8/8 consecutive green post-fix, 127/127 full suite. STYLING: the stale banner rides a deepened amber surface — RTL-flipped gradient hairline, breathing clock (2.4s ease, reduced-motion guarded), tabular-numeral count, quiet ghost-pill exit hatch (danger styling only on interaction, the S71 recipe), 44px touch floor + stacked layout ≤640px, double-ring keyboard focus, prefers-contrast bumps; the dashboard nudge's View-all link matches the stat-box/urgent-strip link language. LADDER (all green): typecheck 0 · vitest 471/471 (8 NEW: settings-overview ×3 — auth, legacy-shape parity per slice, user-scoped trash; stale-view ×5 — auth, filter+order+exclusions, status composition, stray-value degradation, HX banner + empty state) · node --check · eslint 0 errors · build ✓ manifest 76 · cache-bust ✓ (8 files: app.js 190, hib-init 6, i18n 116, mobile-nav 10, project-page 43, projects-page 4, settings-page 11, polish-batch 14 — every referencing page bumped) · i18n parity 1324/1324 (zero new client keys — all new copy is server-side trL) · playwright 127/127 · agent-browser live: stale view EN (banner + 33 cards + clear → grid home restored + URL cleaned), FA render, settings overview single-fetch, me-dedupe (1 per page), toggle cycle error-free with live components, bare project.html empty state + zero phantom requests. Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (staged since S59b, remote D1s schema 56); key-custody drill; Dependabot @hono/node-server 2.1.1 PR awaiting owner review. The 15-min webDevReview cron was missing at session start (cron list = 0 jobs) — RE-CREATED (fixed_rate 900s, job 396158).

## 1-prev-2. (v0.3.14.19 — Session 74, 2026-09-18. OPS CLOSEOUT, owner-directed: "try again, check if you have access now" — verify the Zone.Cache-Purge grant, then wrap up (changelogs → commit → deploy → handover prompt). THE GRANT IS LIVE: `npm run purge` returns "purge_everything accepted" + exit 0 — the S73 owner action was made in the dashboard, token value unchanged, GitHub secret untouched. The re-run immediately exposed a FALSE ALARM in S73's own verification design: the post-purge probes expected MISS/DYNAMIC on / and /login, and both served cf-cache-status: HIT. THE INVESTIGATION (this session's real work) root-caused the TWO-CACHE architecture on this Workers+assets stack: (a) every static path on hibana.ir is fronted by the Workers ASSETS content-addressed edge layer — cf-cache-status: HIT with NO age header is ITS signature; it re-keys on EVERY deploy (immutable objects) and is NOT the cache that zone purge_cache clears; (b) S74 BYTE-VERIFIED freshness: /login, /, and /partials/nav?v=3 (the exact S72 incident URL form, followed through its 307) all serve content byte-identical to a fresh local `build --prod --wire-html`, and every /dist bundle hash in the served HTML matches the fresh build — the "stale-looking" HITs are CURRENT, not stale; (c) extensionless URLs (/login, /partials/nav) MISS the `_headers` `/*.html` no-store rule (it matches request URLs, not mapped files) and carry the assets-layer default `public, max-age=0, must-revalidate` — the true origin of S73's "max-age=0 still HIT" observation; the .html forms 307-redirect (html_handling auto-trailing-slash) with no-store. FIX SHIPPED: scripts/purge-cache.mjs verification is now INFORMATIONAL — the probes still print cf-cache-status/age/cache-control for incident forensics, but never fail the run and never emit ::warning:: (S73's design would have false-alarmed EVERY deploy → warning fatigue → the real signal ignored); the API "purge_everything accepted" line is the zone-cache-clear signal; cd.yml's step comment gained the S74 architecture note (exit contract unchanged: 0 green · 1 permission-missing → warning+green · 2 → error+red). VERIFIED: node --check · cd.yml YAML valid · live run exit 0 with clean informational output · CI=true live run emits ZERO ::warning:: lines · --dry and --url --dry modes intact. PERMANENT LESSON (supersedes S73's probe expectation): TWO edge caches live in front of this app — the ZONE cache (S72's stale-nav layer: custom-domain-only, drops query strings, ignores origin max-age; what purge_cache clears) and the ASSETS content-addressed layer (deploy-fresh always, purge-immune, never needs purging); a cf-cache-status HIT alone proves NOTHING about staleness — only a byte-compare against the current build does (the method this session used). The S72 incident class is now closed at BOTH levels: /api/nav serves the chrome no-store (root fix) + every prod deploy auto-purges the zone cache (defense-in-depth). No app code touched → no version bump / zip (the S73 ops-only policy carries). Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (staged since S59b, remote D1s schema 56); key-custody drill; Dependabot @hono/node-server 2.1.1 PR awaiting owner review (its CI dies at checkout — dependabot-ref permission artifact, zero prod impact). SHIP VERIFIED (S74, 2026-09-18 ~13:05 UTC): pushed 127460f → CI GREEN (typecheck + 463 vitest + full e2e) → CD #155 FULL deploy (dev+prod @ 127460f, every step green — the S73 empty-green reading note applied: step list checked, Deploy to PROD executed) with the purge step's FIRST live run under the grant, behaving EXACTLY per the new design: \"purge_everything accepted\" → informational probes (/login even showed a genuine MISS right after the purge — direct evidence the zone-cache layer clears) → \"purge: ok\" → step green, ZERO ::warning:: annotations. Post-deploy live probes: /api/health ok (prod + dev, schema 56, kv) · /api/nav 200 no-store no cf-cache-status · /login 200 · /app unauth 401 · /nope 404. The stale-nav incident class is now closed at EVERY level: root fix (/api/nav no-store) + auto-purge on every prod deploy + the one-command manual hammer (`npm run purge`) + honest verification semantics.

## 1-prev-3. (v0.3.14.19 — Session 73, 2026-09-18. OPS SESSION, owner-directed: "deploy token Zone.Cache-Purge" — the S72 stale-nav follow-up. Probed the API first: the deploy token verifies 200/active and reads zones + zone settings (hibana.ir zone 084061b0…, cache level aggressive — and /login served cf-cache-status: HIT on a max-age=0 origin TODAY, so the stale-deploy window that bit S72 is still open for HTML), but purge_cache 401s (code 10000) and every self-service path is closed (user/tokens list, account tokens, permission_groups, rulesets — all 403; no wrangler OAuth on this box) — the GRANT itself is a dashboard-only owner action (CF's API cannot edit a token's own permission groups). WHAT SHIPPED so the grant lands as a one-command fix: (1) scripts/purge-cache.mjs + `npm run purge` — token from CLOUDFLARE_API_TOKEN env (the CI path) else credentials.md parsed in-process (never printed; path-robust via import.meta.url so any cwd works); zone auto-resolved by name (--zone / --zone-name / CLOUDFLARE_ZONE_ID overrides); modes: purge_everything default (the incident hammer — safe, cache refill only) · `--url` exact-URL purge (repeatable, chunked 30/request, free-plan safe) · `--file {"files":[…]}` · `--dry` · `--no-verify`; one retry on 429/5xx/network; post-purge verification probes /, /login, /api/nav printing cf-cache-status/age — the check S72 lacked (an immediate HIT after purge = loud warning, never silent trust). Exit contract: 0 purged · 1 permission-missing (prints the 60-second grant runbook with the exact dashboard clicks) · 2 real failure. (2) cd.yml "Purge zone cache (hibana.ir)" step after the PROD health probe — SAME CLOUDFLARE_API_TOKEN secret (zero new GitHub secrets once granted); the exit contract is spelled out in the step: 0 → green, 1 → ::warning:: + GREEN (the deploy is already live and /api/nav is root-fixed no-store — a red X would misread as "deploy failed"), 2 → ::error:: + RED (permission exists but the purge path broke mid-deploy = possible stale edge = want eyes). Post-grant, EVERY deploy purges automatically — the incident class dies. VERIFIED TODAY (pre-grant, the honest state): --dry resolves the zone; the real run exits 1 with the runbook (expected); --url mode same; CI=true emits exactly one ::warning:: annotation; the CD wrapper's exit-code handling simulated locally (1 → warning+green); typecheck 0 · vitest 463/463 · node --check · eslint clean (scripts/ sits outside CI's `npx eslint src/` scope — the file was made lint-clean anyway via a /* global */ pragma) · cd.yml YAML validated. No app code touched → no version bump / tag / zip (DECISION, labeled: version numbers track user-facing builds; the 0.3.14.19 zip already carries the tree — the next feature milestone's zip picks up the new files). OWNER ACTION — the whole point, 60 seconds one-time: dash.cloudflare.com → My Profile → API Tokens → the deploy token (CLOUDFLARE_API_TOKEN) → Edit → Permissions → Add more → Zone | Cache Purge | Purge → Zone Resources: Include → All zones → Save. Token VALUE unchanged → GitHub secret needs no update; verify after with `npm run purge` (expect "purge_everything accepted" + MISS/DYNAMIC probes). Alternatives documented, not taken: a dedicated least-privilege purge token (+1 rotation surface for solo ops — rejected) and a zone cache-rule bypass for /partials/* (the user explicitly chose the token route). The 15-min webDevReview cron is BACK (the 4-session unavailability streak broke): job alive on fixed_rate 900s, last execution succeeded. SHIP VERIFIED (S73, 2026-09-18 ~11:45 UTC): pushed 9aa271d → CI #283 first run RED on ONE flaky e2e (notebook.spec.ts:203 — the corner-drag asserts width growth > +140px and the drag landed exactly +140; UNTOUCHED code — the same suite flaked today on the docs-only run #282; re-run → GREEN) → CD #153 GREEN with the FULL deploy (dev+prod @ 9aa271d) and the new purge step exercised LIVE: zone resolved, PURGE DENIED 401 code 10000, the grant runbook in the deploy log, TWO ::warning:: annotations (script + CD wrapper), step/job/run green — the exact designed pre-grant behavior. Live probes after: /api/health ok (schema 56, kv) · /api/nav 200 no-store NO cf-cache-status · /login 200 · /app unauth 401 · /nope 404 · dev health 200. READING NOTE for future agents: a CD run that goes green while its CI FAILED is an EMPTY green (the gate skips the deploy job — happened twice today, CD #151/#152) — always check the deploy job's step list, not just the run conclusion. Also: Dependabot opened a PR for @hono/node-server 2.1.1 right after the push; its CI dies at checkout (~9s, no tests ran — branch-permission artifact on dependabot refs) — owner review when convenient, zero prod impact. Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (staged since S59b; remote D1s still schema 56); key-custody drill.

## 1-prev-4. (v0.3.14.19 — Session 72, 2026-09-18. QA round 4: 8 pages × EN/FA × light/dark × 1280+390px = 0 console/page errors, 0 overflow (VLM UNAVAILABLE this round — /etc/.z-ai-config's apiKey yields 401 "invalid X-Token" on both SDK endpoints; DOM-level checks substituted). ONE bug found: the S71 resume strip's HEADER (h2 + hint) stayed EN in FA — it relied on data-i18n attributes, but i18n.js apply() sweeps the STATIC DOM only (its own header note) and the strip is dynamically injected; the chips were fine because they render via _t(). Fixed on BOTH render paths (create + early-return re-render) with _t(); the class rule is now explicit: JS-injected markup NEVER relies on data-i18n — translate at render time. FEATURES (mandatory additions): (1) RESUME STRIP CLEAR button — completes the S71 feature (history was record-only, no reset): quiet ghost pill in the strip head, danger-red only on interaction (the S71 trash-purge recipe), wipes hibana-resume + removes the strip, no confirm (low-stakes, rebuilds itself). (2) STALE-PROJECTS NUDGE (dashboard) — job #2 extended: "never lose your place" includes "remember what you left hanging". In-motion projects (unreviewed/investigating/awaiting/doing — halted = deliberately paused and operational = done are EXCLUDED by design) untouched 14+ days render as a quiet amber chip row under the projects head: oldest 3, timeAgo + deep link, hidden when nothing is stale (the urgent-strip pattern, amber not red — waiting, not an alarm). One indexed query added to the dashboard Promise.all. (3) TOPBAR PENDING-SYNC BADGE — the offline queue's onCount listener existed since spec §3.4 with NO shell consumer: an offline quick-add gave one toast, then silence across pages (only canvas/whiteboard had their own save badge). New amber cloud-off chip in the nav partial (the topbar survives soft-navs — nav.js swaps only main.shell, one wire per hard load with a poll-wait for the async queue injection): '{n} pending' with Persian digits in FA, breathing icon (reduced-motion guarded), click = immediate flush + 'Synced' toast, re-localizes on hibana:i18n. Verified end-to-end EN+FA: offline quick-add → badge '1 pending' → online → click → drained + row confirmed in the DB. STYLING batch: keyboard double-ring focus on resume chips + clear (hover-lift alone was a weak focus indicator), scroll-edge fades on the horizontal chip rows via scroll-driven animations (@supports (animation-timeline: scroll()) guarded, RTL-flipped keyframes, .is-scrollable gated by JS so non-overflowing rows never fade), prefers-contrast bumps for all three new surfaces, text-wrap: balance on the new heads. THE SHIP-BLOCKER (found live, the session's real lesson): the S72 deploy went CI GREEN → CD GREEN → but hibana.ir served a STALE nav partial — the CF edge cached /partials/nav*.html under a zone Edge-TTL override that IGNORES the origin's max-age=0 (cf-cache-status: HIT), Standard cache level DROPS query strings (so ?v=3 busting never reached the cache key — verified: the versioned URL still HIT the old object), and the deploy token lacks zone-purge permission (purge API 403). Dev (workers.dev) was fresh — only the custom-domain zone cached. ROOT FIX: a public Worker route GET /api/nav (registered root-level before coreRoutes' auth wildcard, exactly like /api/health — the partial is static chrome with zero user data) serving the file no-store through cfg.assets (one code path: ASSETS binding upstream, serveFile locally). API paths carry no cacheable extension → the edge never caches → every nav change ships on deploy, deterministically. sw.js precaches /api/nav (offline boots keep the chrome; Class-3 network-first lands deploys), hib-init fetches it. NODE GOTCHA caught live: serveFile gzips per the CALLER's accept-encoding, and re-wrapping the body via new Response() without carrying Content-Encoding shipped RAW GZIP as HTML (the nav mount rendered \x1f\x8b mojibake) — fixed with a clean identity Request + CE header pass-through. LADDER (all green before each push): typecheck 0 · vitest 463/463 ×2 · node --check · eslint 0 errors · smoke ALL PASS · build ✓ manifest 76 · cache-bust ✓ · i18n parity 1324/1324 (+5 keys: resume.clear/clearAria, nav.syncPending/syncHint/syncSent) · playwright 127/127 (5 batches) + 37 nav-touching re-runs after the /api/nav swap · agent-browser live: all three features EN+FA both themes + 390px, offline queue end-to-end. SHIP VERIFIED (S72, 2026-09-18 ~08:40 UTC): 7616bdd + 4654b31 → CI GREEN → CD GREEN → live probes all green BUT the nav partial stale (see above) → fcd6fd0 (?v= attempt, insufficient) → b6c6318 (/api/nav) → CI GREEN (full e2e) → CD GREEN → final live probes: /api/nav 200 no-store NO cf-cache-status WITH the sync badge markup, /api/health ok (prod, schema 56 — 0058 still awaiting the owner), /login 200, /nope 404, /app unauth 401, purge unauth 403, dist/resume.4e8b909a.js + polish-ui.0b600f10.css immutable 1y. hibana.0.3.14.19.zip → owner's download folder. Owner standing items (UNCHANGED — remind Ali): rotate the GitHub PAT + CF deploy token + Workers AI token (chat-exposed); approve + apply migration 0058 (staged since S59b; remote D1s still schema 56); key-custody drill. NEW: consider granting the deploy token Zone.Cache Purge (this session's stale-nav incident would have been a one-command fix) or add a zone cache rule bypassing /partials/*. The 15-min webDevReview cron tool was unavailable for the 4th session running.

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
| 24–35 | 2026-09-12→14 | v0.3.12.x detail trimmed (S49) — recover via `git show 2af4c27e:Changelogs.md`: S24–S27 board/sprint/notebook/backup era (schema 47→48), S28–S29 sticky-factory + SWOT + progress box (0049/0050), S30 board analytics + chip module (0051), S31–S32 bidi law + compact chips, S33 sprint CTA + plan editor (0052), S34 private comments, S35 sprint strips + THE ARCHIVE + R2 storage (0053) |
| 36–43 | 2026-09-13→14 | v0.3.12.x detail trimmed (S49) — recover via `git show 2af4c27e:Changelogs.md` (or the sw.js header in that commit): S36 B2/S3-generic adapter, S38 KV storage (never expires), S39 media gallery + shot pinning (0054), S40 sparks audit + text align (0055), S41 sparks mobile + folder emoji (0056, schema 55), S42 carousel overlay handles, S43 full mobile audit + 40px touch floor |
| 44 | 2026-09-14 | v0.3.12.45 — three owner bug reports root-caused (sparks ⋯ everywhere, glance in-place filter, today-line pad + «امروز» flag) |
| 45 | 2026-09-14 | v0.3.12.46 — CROWN SURFACES overhaul (projects rail + sort + FAB clearance; sprint render-time i18n, mobile hierarchy flip, finish-as-control, visible strip) |
| 46–46.2 | 2026-09-14 | v0.3.12.49 — 13-item refinement batch + 4 follow-ups (urgent RTL, unified + chooser, wand robustness, task-editor shots row) |
| 47 | 2026-09-14 | v0.3.12.x — polish continuity (detail in §1 S46/S45 context blocks) |
| 70 | 2026-09-18 | v0.3.14.17 — QA round 2: RTL 390px notebook overflow (the S69 leftover) + orphaned-dialog soft-nav + extensionless URLs on Node + veteran tour gate + palette Ctrl+Enter folder chips + date-chip calendar deep link + fabric out of SW precache. 127 e2e, SW v400. (§1 mirror added retroactively by S71 — S70 only wrote the worklog) |
| 73 | 2026-09-18 | v0.3.14.19 (ops, no bump) — deploy-token Zone.Cache-Purge follow-up: `npm run purge` (scripts/purge-cache.mjs: purge_everything/--url/--file/--dry, post-purge cf-cache-status probes, exit contract 0/1/2) + cd.yml auto-purge after every prod deploy; the 60s dashboard grant is the owner action. vitest 463, cron tool back |
| 74 | 2026-09-18 | v0.3.14.19 (ops, no bump) — Zone.Cache-Purge grant verified LIVE (purge accepted, exit 0); S73's probe expectation root-caused (assets content-addressed layer vs zone cache — byte-verified fresh on /login, /, /partials/nav?v=3) and the false-alarm fixed: purge verification now informational-only; cd.yml comment updated. No app code, no bump |
| 72 | 2026-09-18 | v0.3.14.19 — QA round 4 (0 errors, 1 bug: resume header i18n on injected markup) + resume Clear button + dashboard stale-projects nudge + topbar pending-sync badge + S72 styling batch + THE EDGE-CACHE SHIP-BLOCKER (nav partial → /api/nav route). vitest 463, e2e 127/127 + 37 re-runs, parity 1324/1324, SW v401 |
| 71 | 2026-09-18 | v0.3.14.18 — QA round 3 (0 errors, 1 bug: extensionless FA titles) + RESUME STRIP (job #2 surfaced) + trash Delete-forever/Empty + loader brand + bnav 48px. vitest 463, e2e 127/127, parity 1319/1319 |
| 52 | 2026-09-16 | v0.3.13.9 — activity streaks (4-source heatmap), Trash palette command, whiteboard skeletons. 408 tests, SW v394 |
| 53 | 2026-09-16 | v0.3.14.0 — NOTES VAULT: /notes Obsidian-style knowledge base (migration 0057, schema 56), markdown renderer fixes (list double-wrap + fence corruption), backup/restore coverage, 428 tests, 80 e2e, SW v395 |
| 54 | 2026-09-16 | v0.3.14.1 — vault QA fixes (breadcrumb/trashed-menu/tags), FAB+palette capture, Sparks→Vault import, vault polish batch. 430 tests, 81 e2e, SW v396 |
| 55 | 2026-09-16 | v0.3.14.2 — Quick-Notes→Vault import, heatmap 4-source tooltips (Jalali dates), month labels, streak milestones, cumulative tree counts, polish batch. 431 tests, 81 e2e, SW v397 |
| 56 | 2026-09-16 | v0.3.14.3 — vault heading outline (Obsidian-style TOC), heatmap tooltip touch/Escape dismiss, icon-only-button aria-label sweep (35 buttons), admin boot skeletons, outline polish. 431 tests, 81 e2e, SW v398 |
| 57 | 2026-09-16 | v0.3.14.4 — backup-button resilience: obsidian.zip + personal JSON export survive a pre-0057 D1 (missing-table guard, X-Hibana-Vault-Missing-Tables header), personal export now CARRIES the Notes Vault (+trash); d1-migrate-dev.yml: dev-locked migration workflow with Time Travel bookmark + full dump + per-table sha256 proof. 434 tests, SW v399 |
| 58 | 2026-09-16 | v0.3.14.4 (ops) — PROD MIGRATION 0057 APPLIED with zero data loss: dev re-verified 68/68 tables byte-identical, prod backed up FIRST (bookmark 000009d8 + full dump 66 tables/1651 rows + sha256 digests), R1–R4 verifier PASS (65 tables/1596 rows byte-identical, only the 2 new empty vault tables + 1 registration), live E2E green (Obsidian zip 29 files, JSON export carries vault, /notes round-trip) — Notes Vault LIVE on hibana.ir, schema 55→56, 4-day blocker resolved. SW v399 |
| 59 | 2026-09-16 | v0.3.14.5 — SWOT + bug hunt: backup watchdog fail storm root-caused (dev/prod same-second commit race on hibana-safe — prod cron staggered :17→:23 + pushFile 409/5xx retry + fail-ping error body), mobile bottom-nav active state fixed (stale after soft-nav; More tab on secondary pages; sheet-row marking), press-feedback micro-interactions, Notes Vault onboarding banner (vault-empty users, localStorage dismissal, dashboard baseline regenerated), 5 vitest + 6 e2e pins, full ladder green (439/439, 87 e2e total, i18n 1272/1272). SW v399 |
| 48→48p | 2026-09-15 | v0.3.12.84 — 16 commits: WYSIWYG contenteditable editor (S48d–f,h), the IIFE-trapping dist bug (S48), sprint board fixes (b,m,o), loading animation (i), AI-translate content-loss fix (p). SW v384 |
| 49 | 2026-09-15→16 | v0.3.13.2 — CODEBASE HEALTH: CI red since S41 fixed (ESLint + stale 404 baseline), S48n sprint-draft regression fixed, 404 dedup, dead code removed (5 fns + 3 CSS rules + 1 script), htmlToMd → chip-render.js, sw.js 53KB→10.8KB, Changelogs 2,550→~1,000 lines; +b5: CSP allows the CF Web-Analytics beacon (owner decision); +b6: deep-link domain de-hardcoded (APP_URL, single source of truth). SW v387. CI green for the first time since 09-13 |
| 50 | 2026-09-16 | v0.3.13.4 — TRASH PANEL: Settings → Data shows the 7-day soft-delete window (notes/to-dos/projects, kind + purge countdown, one-click Restore via existing endpoints; GET /api/settings/trash read-only, no schema change); +skeleton boot states on sparks/sadhana/reports (menu #8); +docs: 4 stale numbers fixed (i18n 953→1124, migrations 0047→0056, PBKDF2 600k→100k). Vitest 399→404, i18n 1124→1136. SW v389 |
| 51 | 2026-09-16 | v0.3.13.6 — A11Y STRUCTURAL FIXES + SHORTCUTS HELP v2: batch A = axe-core audit residuals (role=tablist→group ×2, aria-labels on 6 hidden notebook radios, main landmarks on sadhana/canvas/whiteboard, sr-only h1s on dashboard/sadhana/board, skip-to-content reintroduced keyboard-only after the S21 visual removal — bottom-center clipped pill, app.js-injected, preventDefault+focus+pushState vs Chromium's fragment-nav focus blur); batch B = ?-overlay v2 grouped+complete+in-palette (qa-help '?'), lying Ctrl+N hint on New idea removed; BUG: palette Recent section resurrected (hibanaCmdK replacement had dropped recordRecent since S30 — Object.assign now). i18n 1136→1143, vitest 404/404, e2e 79/79. SW v391 |
| 52 | 2026-09-16 | v0.3.13.9 — ACTIVITY STREAKS + TRASH DISCOVERABILITY: heatmap sources 2→4 (to-dos completed + notes captured now count; reports-heatmap.test.ts → vitest 408/408), streak trio cards on Reports (current/longest/active-days — alive-through-yesterday rule, amber flame while alive, digest+CSV lines), trash urgency tint bug fixed (var(--warn) never existed → --badge-awaiting-fg), Trash palette command with live count sublabel (Persian digits in FA) + scroll-to-panel, whiteboard skeleton boot state (ghost sticky notes). i18n 1143→1150. SW v394 |

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
- **Zone cache purge (S73→S74)**: `npm run purge` — Cloudflare edge purge for hibana.ir (default
  purge_everything; `--url <u>` exact-URL; `--file {"files":[…]}`; `--dry` plan-only). The deploy
  token's Zone → Cache Purge grant is LIVE (S74-verified: purge accepted, exit 0, end-to-end from
  the dev box and inside cd.yml). Probe output is INFORMATIONAL (the S74 fix — S73's MISS/DYNAMIC
  expectation false-alarmed on every run): cf-cache-status: HIT on / or /login is the Workers
  ASSETS content-addressed layer, which re-keys on every deploy and is always fresh (S74
  byte-verified /login, / and /partials/nav?v=3 against the current build); the purge clears the
  ZONE cache — the S72 stale-nav layer. TWO edge caches front this stack; a HIT alone proves
  nothing about staleness — only a byte-compare against a fresh `build --prod --wire-html` does.
  cd.yml runs the purge after every prod deploy (exit 1 = permission lost → ::warning:: + green;
  exit 2 = red).
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

## 6. Open items (S49 refresh — verified against the v0.3.13.2 tree)
**S49 audit verdict (the session's deliverable):** the tree is CLEAN at the file level —
zero dead JS/CSS files (all 47 JS + 22 CSS referenced), zero debug console.logs, zero
?v= drift, SW SHELL covers every page. Fixed this session: CI red (ESLint S41 + stale
404 baseline), the S48n sprint-draft regression, the 404 double script tag, 5 dead
functions, 3 dead CSS rules, the stale tmp-b4 codemod. Recorded as NO-GO: splitting
project-page.js / app.js / canvas.js / whiteboard.js into modules — they are closure-
bound IIFE/page-mount monoliths (state via closures, not modules); the S48 IIFE bug is
the standing warning. The SAFE extraction pattern (pure function → chip-render.js-style
IIFE global, e.g. S49's HibanaChips.htmlToMd) is the way to shrink them incrementally.
**Code — verified absent:** `dev_tasks` note column · email-in (Email Workers) · Google
Calendar 2-way sync · canvas auto-routing connectors · multi-canvas. Deferred by design:
incremental notebook swap.
**Owner-held:** rotate GitHub token (classic, `repo` scope — chat-exposed) · close
`OPEN_REGISTRATION` · CF "Always Use HTTPS" toggle · PWA installability re-check ·
key-custody drill · Resend delivery confirmation.
**Watch:** mirror rate-limit keys share Arvan POP IPs ·
future smoke/e2e failures — check whether the expectation or the product changed first
(the 404-baseline lesson: environment rendering drift, not product change, can break
visual pins — regenerate via the documented --update-snapshots procedure and verify the
diff is background-noise-class before committing) · **RESOLVED 2026-09-16 (S49-b6): deep
links no longer hardcode hibana.ir** — request-scoped paths always derived the origin
from the request; the no-request contexts (cron reminder emails, Sadhana Telegram
pushes, backup-failure alert, ICS feed, invite email) now use `cfg.appUrl` (env APP_URL,
default the prod domain; the one line to change is wrangler.toml [env.prod.vars]).
**Domain-migration runbook (when the domain changes):** (1) DNS/custom domain on the
Worker (dashboard or scripts/custom-domain.mjs) — traffic flows, request-scoped paths
self-correct; (2) set APP_URL in wrangler.toml [env.prod.vars] to the new origin → all
cron/email/ICS links follow; (3) Resend: verify the new domain in the dashboard, THEN
change the `noreply@…` default in src/services/email.ts `resendEmail()` (deliberately
NOT derived from APP_URL — a send must never silently break on an unverified domain);
(4) ICS subscribers re-subscribe (UIDs change with the host — correct, the old feed is
dead); (5) CSP needs nothing ('self'-based) · **RESOLVED 2026-09-16 (owner instruction,
S49-b5):** the Cloudflare Web-Analytics beacon vs app CSP item — the CSP now grants
the two exact origins (`script-src … https://static.cloudflareinsights.com`, `connect-src …
https://cloudflareinsights.com`, src/app.ts + public/_headers in lockstep; pinned by
security.test.ts). History: Cloudflare auto-injects its Web-Analytics beacon
(static.cloudflareinsights.com) on every page and the app CSP (`script-src 'self' …`)
blocked it — one console error per page load, analytics never ran; pre-existing since the
CSP was added, surfaced by the S49 probe, decided by the owner on 2026-09-16.

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

## 10. Performance baselines (S69, 2026-09-17 — agenda #1 "measure first")

Harnesses (committed): `scripts/perf-seed.mjs` (deterministic local dataset: 90 projects,
160 quick notes, 7 folders/120 vault notes, 180 sadhana tasks/600 journal rows, 1200 canvas
elements, 70 real PNG screenshots ≈5.4MB), `scripts/perf-pages.mjs` (playwright, 8 pages ×
EN/FA × cold/warm × 3 cycles, medians; settle-wait survives the SW self-reload; counts
framenavigated → selfReloads; captures per-API count/ms/KB), `scripts/perf-baseline.json`
(raw rows). Run order: `perf-seed.mjs` → server on :3017 → `perf-pages.mjs`. Tour
suppressed (`hibana-tour-done`), no CPU throttle, headless desktop Chromium. Server TTFBs
are localhost — the transfer/KB and apiMs columns are the numbers that matter for prod.

### A. Page loads (medians of 3; ms / KB / calls)
| page | lang | cache | TTFB | load | FCP | KB | res | api | apiMs | dom |
|---|---|---|---|---|---|---|---|---|---|---|
| dashboard | en | cold | 8 | 346 | 300 | 1942 | 59 | 5 | 128 | 8043 |
| dashboard | en | warm | 6 | 66 | 160 | 1942 | 60 | 5 | 98 | 8043 |
| projects | en | cold | 7 | 309 | 224 | 1273 | 54 | 6 | 108 | 410 |
| projects | en | warm | 6 | 57 | 128 | 1273 | 55 | 6 | 50 | 410 |
| project-detail | en | cold | 8 | 325 | 212 | 1595 | 59 | 7 | 114 | 1410 |
| project-detail | en | warm | 5 | 56 | 168 | 1595 | 60 | 7 | 145 | 1410 |
| notes-vault | en | cold | 8 | 310 | 244 | 1378 | 55 | 6 | 180 | 1826 |
| notes-vault | en | warm | 5 | 55 | 160 | 1378 | 56 | 6 | 174 | 1826 |
| gallery | en | cold | 8 | 306 | 184 | **6576** | 123 | **75** | **13325** | 1197 |
| gallery | en | warm | 6 | 54 | 224 | 6576 | 124 | 75 | 110 | 1197 |
| calendar | en | cold | 7 | 343 | 208 | 1447 | 58 | 8 | 58 | 659 |
| calendar | en | warm | 5 | 51 | 156 | 1447 | 59 | 8 | 97 | 659 |
| whiteboard | en | cold | 2 | 346 | 244 | 1304 | 55 | 5 | 32 | 326 |
| whiteboard | en | warm | 5 | 378 | 320 | 3825 | 55 | 5 | 42 | 326 |
| settings | en | cold | 6 | 387 | 308 | 1296 | 64 | 14 | 995 | 595 |
| settings | en | warm | 5 | 109 | 176 | 1274 | 64 | 14 | 144 | 595 |
| dashboard | fa | cold | 8 | 407 | 320 | 2031 | 59 | 5 | 253 | 8045 |
| dashboard | fa | warm | 5 | 87 | 188 | 2009 | 59 | 5 | 184 | 8045 |
| projects | fa | cold | 8 | 322 | 224 | 1366 | 54 | 6 | 146 | 412 |
| projects | fa | warm | 5 | 80 | 152 | 1366 | 55 | 6 | 75 | 412 |
| project-detail | fa | cold | 7 | 374 | 220 | 1692 | 59 | 7 | 111 | 1412 |
| project-detail | fa | warm | 5 | 58 | 140 | 1692 | 60 | 7 | 77 | 1412 |
| notes-vault | fa | cold | 7 | 308 | 220 | 1512 | 56 | 6 | 172 | 1828 |
| notes-vault | fa | warm | 5 | 62 | 156 | 1512 | 57 | 6 | 126 | 1828 |
| gallery | fa | cold | 7 | 354 | 224 | **6365** | 118 | **71** | **11247** | 1199 |
| gallery | fa | warm | 5 | 59 | 88 | 6387 | 120 | 71 | 58 | 1199 |
| calendar | fa | cold | 6 | 296 | 220 | 1517 | 58 | 8 | 140 | 612 |
| calendar | fa | warm | 5 | 63 | 116 | 1517 | 59 | 8 | 97 | 612 |
| whiteboard | fa | cold | 3 | 334 | 236 | 1402 | 58 | 5 | 65 | 328 |
| whiteboard | fa | warm | 5 | 371 | 296 | 3965 | 57 | 5 | 95 | 328 |
| settings | fa | cold | 6 | 565 | 344 | 1388 | 64 | 14 | 1381 | 597 |
| settings | fa | warm | 5 | 126 | 204 | 1388 | 65 | 14 | 188 | 597 |

KB caveat: SW-mediated subresources report transferSize 0 (no Timing-Allow-Origin), so the
harness falls back to encodedBodySize — post-settle "cold" KB ≈ full content size, warm KB
≈ cached content size. Comparisons across pages hold; wire-bytes on a true cold first hit
are lower once the SW owns the cache. apiMs = SUM of per-request durations (parallel
requests overlap in wall-clock). FA adds ~7-10% bytes (i18n-fa bundle + Vazir font). Zero
console/page errors on all 32 cells.

### B. HTTP cache headers (audit 2026-09-17)
- HTML: `no-store` everywhere (Node + `_headers`) — correct.
- `/dist/*.js|css`: prod `_headers` = `public, max-age=31536000, immutable` (content-hashed — correct); **Node fallback serves 3600+SWR for /dist** (parity gap, local-only).
- `/api`: NO default Cache-Control on most GETs. `etag()` helper (private,no-cache + 304)
  covers dashboard, calendar, notifications, quicknotes, reports, devboard only.
- media files: `private, max-age=3600` ✓ (content-keyed by screenshot id).
- vendor: 86400+SWR 604800 ✓ (fabric.min.js is build-rewritten but rarely changes).
- `sw.js`: Node 3600+SWR; **no `_headers` rule on prod** (CF default applies — probe live
  to confirm; SW update detection can lag up to the max-age under `reg.update()`).
- Node `/js|css` source: 3600+SWR (local-only surface; deployed HTML is wired to /dist/).

### C. Query plans (EXPLAIN QUERY PLAN + timing, synthetic busy-solo scale)
All hot paths are indexed SEARCHes — no accidental SCANs: dashboard rollup sub-ms
(except todo board 4.98ms and journal feed **16.04ms @ 10k updates — UNBOUNDED, grows
forever**), calendar/notes/hurdles <1ms, FTS search (projects/notes/tasks) 0.08–1.65ms,
vault LIKE scans bounded by idx_vault_notes_user (0.13–0.45ms @ 2k notes), gallery join
0.86ms indexed. Heavy-but-expected: canvas viewport bbox 36ms @ 40k elements, backup
snapshot 113ms. `scripts/explain-hotpaths.mjs` extended (S69) with the search/vault/gallery
queries + seeded vault/screenshots at scale.

### D. Service worker precache
SHELL: 49 entries, 880.8KB (fabric.min.js 292KB + htmx 51KB + alpine 45KB + logos/icons/
fonts). Manifest dist: 67 content-hashed bundles, 1334.4KB (top: i18n-fa 150KB,
project-page 107KB, app 88KB, sadhana-page 71KB, emoji-data 70KB). **Total ≈ 2.16MB
fetched at first-visit install** (cache:'reload' — bypasses HTTP cache). Candidates
(documented, not done): fabric out of SHELL into runtime cache (the P9 Vazir precedent —
only 3 pages load it) would cut ~292KB.

### E. First-visit DOUBLE LOAD (measured on all 8 pages)
`boot.js` reloads the page on EVERY `controllerchange` — including the FIRST install's
`clients.claim()`. Every cold navigation does load#1 (full network) → SW install →
`location.reload()` → load#2. Measured selfReloads=1 on all 32 cells. First-visit cost ≈
2× full page load + visible flicker. Fix: skip the reload when no controller existed at
registration (update-swap reload stays).

### F. Payload heavyweights (the fix targets)
1. **Gallery: 6.4–6.6MB, 71–75 API calls, apiMs 11–13s per cold load.** Grid tiles fetch
   full-size originals (`/api/media/screenshots/:id/file`) — no thumbnails anywhere
   (image-resize.js covers logos/avatars only, screenshot uploads store originals up to
   the 5MB cap). Native `loading="lazy"` is ineffective: Chromium's lazy-prefetch margin
   (~4 viewports) covers the whole 70-tile grid.
2. **Dashboard htmx fragment: 628.6KB** (JSON path: 42.1KB). #dashboard-todo = 491.5KB:
   ALL open sadhana tasks rendered (~4KB/row: inline SVGs + htmx attrs), rows beyond 5
   shipped `hidden`. #notebook = 99.6KB (20 notes ≈ 5KB/row).
3. **BUG (found while measuring): the hidden-row cap is visually dead.**
   `.dash-todo-task { display: grid }` (dashboard-todo.css) overrides the UA `[hidden]`
   rule — hidden-attr rows compute display:grid (verified live). Every quadrant renders
   ALL its tasks visibly; "See More/See Less" toggles a dead attribute (label flips,
   nothing changes). The designed 5-row cap never visually worked since the board-style
   rows shipped.
4. Settings fires a 14-call API shotgun (trash/invites/telegram/ai-models/tags/…) —
   apiMs ~1s cold, parallel, low priority.
5. Whiteboard warm-KB anomaly (3.8MB vs 1.3MB cold) = SW encodedBodySize semantics on
   cached fabric + canvas payloads; wire cost is the cold number. Documented, not a bug.

### S69 fix list (measured offenders, in order)
1. boot.js first-install reload guard (E — every page, every first visit).
2. Gallery true lazy-loading + upload-time resize + thumb variant (F1 — the named
   candidate, confirmed).
3. Dashboard: [hidden] CSS fix + server-side render cap + journal GROUP BY (F2+F3).
4. /api default Cache-Control + Node /dist immutable parity (B).
5. Re-measure with the same harness; deltas go here — ALL SHIPPED THIS SESSION (below).

### S69 AFTER (same harness, same seed, post-fix — medians of 3)
| page | lang | cache | TTFB | load | FCP | KB | res | api | apiMs | dom |
|---|---|---|---|---|---|---|---|---|---|---|
| dashboard | en | cold | 4 | 351 | 348 | **861** | 57 | 4 | 277 | **4083** |
| dashboard | fa | cold | 2 | 349 | 460 | **867** | 56 | 4 | 77 | **4070** |
| projects | en | cold | 3 | 275 | 216 | **519** | 52 | 5 | 133 | 410 |
| project-detail | en | cold | 2 | 291 | 212 | **654** | 57 | 6 | 347 | 1410 |
| notes-vault | en | cold | 2 | 380 | 276 | **551** | 53 | 5 | 160 | 1826 |
| gallery | en | cold | 2 | 280 | 212 | **635** | 99 | **52** | **2656** | 1197 |
| gallery | fa | cold | 2 | 293 | 216 | **660** | 98 | **52** | **5046** | 1199 |
| calendar | en | cold | 2 | 372 | 256 | **560** | 56 | 7 | 279 | 659 |
| whiteboard | en | cold | 2 | 303 | 268 | **734** | 54 | 4 | 71 | 326 |
| settings | en | cold | 2 | 448 | 356 | **528** | 62 | 13 | 562 | 595 |

DELTAS vs §10-A (cold): gallery 6576→635KB (−90%), apiMs 13325→2656 (−80%), calls 75→52
(the 52 = in-viewport + 700px prefetch margin; legacy-shot self-heal tiles generated on
first view make later loads cheaper still). Dashboard 1942→861KB (−56%), DOM 8043→4083
nodes (−49%; the htmx fragment's #dashboard-todo 491→~130KB via the 8-row cap + board
link + the [hidden] CSS fix). Every other page −44…−61% KB. **selfReloads 48/48 cold
cells → 0/48** — the first-visit double-load is gone (the pre-fix "cold" column was
actually measuring the SECOND load, post-forced-reload; the honest first-visit cost is
now a single 241–465ms load). Steady warm state (3rd reload): DCL 71ms / load 74ms —
the transitional warm#1 (DCL ~350ms) is the SW runtime cache populating once per browser
profile, previously hidden inside the forced reload. Zero console/page errors across all
cells, before AND after. Raw rows: scripts/perf-after.json.

### S75 (2026-09-18) — the settings read shotgun + the cross-page /api/auth/me shotgun
Measured live on the local Node server (authenticated, e2e account, agent-browser
network log — call counts are the robust metric; local apiMs are sub-ms and not
prod-representative):
- **settings.html API calls: 13 → 4.** The 8 parallel JSON GETs (settings ×2,
  settings/trash, auth/invites, ai/models ×2, telegram/status + the chrome me-fetches)
  collapsed into `GET /api/settings/overview` (one composed response — every slice
  keeps its legacy endpoint's exact shape) + tags fragment + nav + the single shared
  me-fetch. The S69-A baseline row (settings en cold: 14 calls, apiMs 995) and the
  S69-AFTER row (13 calls, 562ms) both predate this — the read-path request count is
  now 4.
- **/api/auth/me per authenticated page load: 4 → 1** (every page, not just settings):
  i18n apply ×2 (DOMContentLoaded + the post-nav-mount re-apply), hib-init's nav user
  info, and the auth guard all rode separate identical fetches; they now share the
  `window.__hibanaMe` promise-memo (app.js), with force-refresh at the three
  language-toggle sites so the just-PATCHed language_pref is always read. On a cold
  authenticated load this removes 3 requests × every page — the single widest
  remaining per-page request win after S69.
- No payload-size change (the overview composes the same JSON the separate calls
  returned); the win is request count + duplicate elimination.

### S76 (2026-09-18) — the sadhana board's unbounded journal feed (§10-C, the other one)
S69 fixed the DASHBOARD's note-chip feed; the BOARD's loadAll still fetched every
sadhana_updates row ever written. Measured on the perf seed: the /api/sadhana HX
fragment carried 1.43MB / 530 note items (600 journal rows across ~180 tasks, avg
3.3/task — so the per-task cap changes nothing at seed scale; the bound is the
YEARS-scale growth the watch item named). Fix: latest-20-per-task window-function cap
+ per-task totals carried everywhere (server badge, JSON updates_total → client 📋
toggle, bilingual truncation hints on both renderer generations). Verified with a
synthetic 25-note task: notes 6–25 render, 1–5 truncate, badge 25, hint exact. The
board's growth is now bounded at 20 × live-tasks instead of all-rows-forever.

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
| 2026-09-13T02:00:42.420Z | pm-app-dev | 49 | 0000049b-00000000-000050e5-9a0f11d8d69fade96fa6f92fcd528bec | pre-migration bookmark (dev) |
| 2026-09-13T02:01:05.301Z | pm-app-prod | 49 | 00000835-00000002-000050e5-e7ccb2011a5843aabea78001f96f2912 | pre-migration bookmark (prod) |
| 2026-09-13T04:31:24.024Z | pm-app-dev | 50 | 000004a4-00000000-000050e5-27c0f30f9df3141725d8871beb81746a | pre-migration bookmark (dev) |
| 2026-09-13T04:31:27.403Z | pm-app-prod | 50 | 0000084a-00000000-000050e5-35264bba52c3717740e025b637786dc8 | pre-migration bookmark (prod) |
| 2026-09-13T06:24:36.874Z | pm-app-dev | 51 | 000004a9-00000000-000050e5-a2d8af5ee15a85733b704404667a6046 | pre-0053 bookmark (dev) |
| 2026-09-13T06:24:40.206Z | pm-app-prod | 51 | 00000855-00000000-000050e5-fb4b5a34d3e327cf06618fd8ceb93289 | pre-0053 bookmark (prod) |
| 2026-09-13T15:19:37.384Z | pm-app-dev | 52 | 000004c3-00000000-000050e5-dbd40158391cfaca44e2a30d62c66028 | pre-0054 bookmark (dev) — screenshot pin (task_id) + bytes |
| 2026-09-13T15:19:40.953Z | pm-app-prod | 52 | 00000873-00000016-000050e5-02e8748cc82810285274657a5e7a2bc6 | pre-0054 bookmark (prod) — screenshot pin (task_id) + bytes |
| 2026-09-13T16:26:48.557Z | pm-app-dev | 53 | 000004c7-00000000-000050e5-2fcbc2b70837fadc9961d40b621ec7ab | pre-0055 (S40 text alignment) bookmark |
| 2026-09-13T16:26:52.740Z | pm-app-prod | 53 | 00000879-00000000-000050e5-7e5d6f08b551b06d304312aeef49ee19 | pre-0055 (S40 text alignment) bookmark |
| 2026-09-13T17:17:08.393Z | pm-app-dev | 54 | 000004ca-00000000-000050e5-40331fcc0b2ba028bfad7efa9e5bc560 | pre-migration bookmark (dev) |
| 2026-09-13T17:17:14.111Z | pm-app-prod | 54 | 0000087e-00000000-000050e5-447a2880744a5e041a4ddaf3f11b9e3c | pre-migration bookmark (prod) |
| 2026-09-16T12:09:51.319Z | pm-app-prod | 55 | 000009d8-00000000-000050e8-3d61b19f3f1c0a73a55c47878d71a474 | pre-0057_notes_vault prod migration (owner-instructed S57 round) |
