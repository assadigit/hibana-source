# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.14.13 — Session 65: THE QUICK-NOTE ARCHIVE — every note ever captured, browsable at last. The dashboard widget caps at 20 cards (P5.1 F-M1) and the API at 100; anything older was STORED but rendered NOWHERE — the S64 jump-to-note could only toast "older than the recent list" at a note the owner could not see anywhere. S65 finishes the story: (1) THE ARCHIVE FRAGMENT — GET /api/notes/archive (S65): Zod-bounded offset/limit pagination (max 100/page) + an optional anchor=uuid that centers the page on a target note (ROW_NUMBER window over the same sort as the list; a deleted/foreign anchor falls back to the top, never errors). Light rows (color dot, kind icon, first-line excerpt with the 🗓 day-chip + weekday + time + a pin glyph for attached projects) each carry a HIDDEN full render the note-reader opens without another fetch: notes → latinRuns(renderMarkdown), lists → a read-only title + checkbox item list (the raw items JSON must never read like garbage in a reader — caught by e2e). The wrapper carries data-total/next/prev-offset so the client can page both directions. (2) THE ARCHIVE DIALOG — window.hibanaArchive (app.js): a centered sheet on desktop / full-screen on ≤640px, sticky head (title, live count with Persian digits in FA, filter, close), body capped-height with custom scrollbar. "Show all N notes" affordance under the widget (server-rendered ONLY when total > rendered, Persian digits in FA, opens the dialog); "Load more" appends downward, "Newer notes" prepends EXACTLY the missing window (no overlap after an anchored open); the client-side filter narrows rendered rows with PERSIAN DIGIT NORMALIZATION on both sides (a query with ۷ matches content with 7 — the i18n rule, verified live in FA); the count reads "۱ / ۲۱" while filtering. (3) THE BEYOND-CAP JUMP LANDS — the S64 dead-end toast is now the LAST resort: app.js's jump arm resolves a missing #note-<id> the moment #notebook lands (the dashboard booted, the card didn't — deeper than the cap) and opens the archive CENTERED on the note: row scrolled into view, one accent pulse (.qa-row.note-jump, reduced-motion flattened), the excerpt hit wrapped in a temporary <mark class="note-jump">; the fail timer still backs up the hidden-notebook edge. (4) COPY AS MARKDOWN IN THE READER — the note-reader foot gains the vault's S62 clipboard twin for quick notes: notes copy the raw markdown verbatim, lists copy "# title" + checkbox lines (paste-ready anywhere); source is data-raw on archive rows / rebuilt from the live card for widget opens; Clipboard API + execCommand fallback, toast confirms. (5) KEYBOARD: the dialog lands focus in the filter on open; ArrowUp/Down walk the visible rows (roving focus, Home/End jump the edges, ArrowUp-from-outside enters at the bottom — the cmdk convention), Enter/Space activate. (6) READ-ONLY ARCHIVE: the reader's Edit path edits live widget cards, which archive rows are not — Edit hides for archive opens and every widget open restores it (no state leak); the S64 qn.jumpMissing toast stays as the anchor-gone fallback. BUGS FIXED: (a) PRE-EXISTING SINCE PHASE 6 — the note-reader's FOOT "Close" button was DEAD (buildNoteReader wired querySelector = head ✕ only; the most obvious control in the modal did nothing — caught by the new e2e, fixed with querySelectorAll); (b) the archive pagers' hidden attribute was defeated by the author display:flex (CSS specificity — [hidden]{display:none} guard added; the "last page" pager stayed visible); (c) .qa-pin rendered as an invisible empty span (attribute existed, style never did — now a muted pin glyph + title). Tests: vitest 454→460 (+6: archive pagination/attrs/JSON-total, anchor centering + single qa-anchored, isolation + soft-delete exclusion from rows AND total, Zod bounds incl. foreign-anchor fallback, kind/done/hidden-render + no-raw-JSON, notebookHtml affordance EN/FA), playwright 112→118 (+6 qn-archive: affordance→dialog→reader-read-only→filter→count→state-leak-check; pagination Load-more + anchored open + Newer-notes completing the window; list kind + no JSON + h1 render; FA/RTL wording + Persian digits + digit-normalizing filter; clipboard byte-exact for note + list checklist; filter autofocus + ArrowUp/Down/Home/End roving + Enter activation; palette-quicknotes beyond-cap test REWRITTEN to pin the new archive-landing behavior). Cache-busts (all unshipped-version single bumps — the in-flight tree never deployed): app.js v185→v186 (28p), quicknotes.css v15→v16 (23p), i18n-en v50→v51 (24p) + i18n.js v106→v107 (24p) + fa inject v44→v45. SW untouched — hibana-v399. i18n +5 keys (qn.archiveTitle, qn.filterNotes, qn.loadMore, qn.loadNewer, qn.archiveFailed) — parity 1287→1292/1292 (reader Copy reuses the vault's notes.copyMd/copiedMd/copyFail). LADDER: typecheck 0 · vitest 460/460 · smoke PASS · eslint 0 errors/164 baseline · build 75 entries · cache-bust PASS (5 files) · i18n 1292/1292 · playwright 118/118 · agent-browser 3-mode sweeps (EN/light/desktop, FA/dark/desktop, FA/dark/390px — zero console errors, zero page errors, zero h-scroll) + live feature verification EN (affordance "Show all 22 notes" → dialog 22 rows → filter 1/22 → reader Edit-hidden + Copy-present + foot-Close works → zero residue) and FA/RTL (نمایش همهٔ ۲۱ یادداشت → همهٔ یادداشت‌ها + ۲۱ + جست‌وجو… + RTL + شماره ۷ matching شماره 7). Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply migration 0058 (staged since S59b — remote D1s still schema 56).

### Session 64 changelog (v0.3.14.12 — Session 64: QUICK-NOTE JUMP-TO-MATCH + THE SAME-PAGE-HASH NAV BUG + TITLE I18N FIXES — the S63 find→open→SEE story now covers quick notes too, and two real bugs fell out of the QA sweep. (1) BUG: SAME-PAGE HASH NAVIGATIONS WERE SILENT NO-OPS — nav.js go() compared pathname+search only, so any palette deep link fired FROM the page it targets did NOTHING: the S63 vault jump when Ctrl+K opens on /notes.html, canvas anchors from the canvas page, and the new quick-note link from /app. The hash now joins the byte-identical check; a different fragment re-mounts the page whose boot reads it — the universal fix, no per-page hashchange listeners needed. (2) BUG: THE PALETTE QUICK-NOTE DEEP LINK WAS DEAD ON ARRIVAL — /whiteboard.html#note-<id> targets the Fabric notebook SHEET, which has never rendered a #note-<id> element (the cards live in the dashboard widget; a stale server comment claims the full notebook lives there — it does not). Retargeted to /app#note-<id>&q=<term>. (3) JUMP-TO-NOTE (dashboard): the S63 jump-to-match language extended to quick notes — the card scrolls into view with one accent pulse (.note-card.note-jump: brand ring + accent wash + 2px lift that settles, reduced-motion flattened), the first matching text node wears a temporary <mark class="note-jump"> that unwraps after 2.6s (form controls are skipped — a mark inside a textarea is invalid DOM), the hash is consumed via replaceState on BOTH the success and fail paths (a reload reopens clean), and a hit deeper than the widget 20-note cap toasts honestly (qn.jumpMissing: saved, just older than the recent list) instead of dead-scrolling. Armed via MutationObserver + belt-and-suspenders interval + htmx:afterSwap/hashchange/popstate (soft-nav pushState fires no event to hook); scoped to pages that can host cards (main.shell-dash / /app / /dashboard.html) so stray fragments never toast elsewhere. (4) QUICK-NOTE SEARCH SCENT: /api/search notes group gains snippet(quick_notes_fts, 1, '', '', '…', 12) — a ~12-token FTS5 window around the first content hit, so an untitled note palette row says WHERE the query landed (was a bare Untitled note); palette rows carry a kind chip (Note/List) + the snippet, query-highlighted, FA-localized (یادداشت/لیست). (5) TITLE I18N FIXES: the branded 404 serves /404.html bytes AT the miss URL so TITLE_PAGES[/404.html] never matched — EN users kept the hardcoded Persian <title>; detection now keys on the .nf-page body class and the static head title is EN (Page not found — Hibana) like every other page; /notes.html (S53 Vault) and /gallery.html (S39) join the title map (یادداشت‌ها / نگارخانه at last); /project.html now carries the project OWN name (language-neutral user content) instead of a generic Project. Tests: vitest 452→454 (quicknote-search: snippet content + isolation/soft-delete), playwright 106→112 (+2 palette-quicknotes incl. hash-consumption + zero-residue + beyond-cap toast; +4 page-titles: EN 404, FA 404, FA vault/gallery, project own-name), login.spec 404 regex updated for the EN default. One sprint-doc flake noted this session (passes solo and on the full re-run — load-timing under the 6-minute suite, not a product bug; watch it). Cache-busts: app.js v183→v185 (post-bump edit re-bumped per discipline), nav.js v4→v5 (16p), command-palette v11→v12 (17p), i18n.js v105→v106 (24p), i18n-en v49→v50 (24p) + fa inject v43→v44, project-page v37→v38, quicknotes.css v14→v15 (23p). SW untouched — hibana-v399. i18n +3 keys (qn.jumpMissing, cmdk.noteKind/listKind) — parity 1284→1287/1287. LADDER: typecheck 0 · vitest 454/454 · smoke PASS · eslint 0 errors/164 baseline · build 75 entries · cache-bust PASS (8 files) · i18n 1287/1287 · bundle +4.0% PASS · playwright 112/112 · agent-browser 3-mode sweeps (58 page-visits: EN/light/desktop, FA/dark/desktop, FA/dark/390px — zero console errors, zero page errors, zero h-scroll) + live feature verification EN (palette→dashboard→pulse+mark+hash consumed+zero residue) and FA/RTL (یادداشت بینام · یادداشت · snippet row, jump, zero residue, zero errors). Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply migration 0058 (staged since S59b — remote D1s still schema 56).

### Session 63 changelog (v0.3.14.11 — Session 63: JUMP-TO-MATCH + READING TIME + MENU KEYBOARD NAV + PRINT-THE-NOTE — S62's search story finished end-to-end. (1) JUMP-TO-MATCH: the palette's vault deep link now carries the query (#n=<id>&q=<term>) and the vault page jumps to WHERE it hit — split/read mode wraps the preview's first matching text node in a temporary <mark class="vault-jump"> (one accent pulse, unwraps itself after 2.6s, reduced-motion flattened); edit mode selects the match in the textarea (focus without preventScroll scrolls the caret into view — the selection IS the jump). A title-only match is a graceful no-op; openNote's replaceState strips &q once consumed so a reload reopens clean. Find → open → SEE the hit: "never lose your place" for long notes. (2) READING TIME: notes ≥200 words gain "~N min read" in the status row (~200 wpm, Persian digits in FA, hidden for short notes where the number is noise). (3) MENU KEYBOARD NAVIGATION: the vault's floating menus (role=menu) were Tab-only — ArrowUp/Down now cycle, Home/End jump, roving focus (focus IS the selection, nothing to desync); Escape keeps its global closer. (4) PRINT THE NOTE: Ctrl+P on an open note now prints the NOTE, not the app — @media print in notes.css (notes.html-scoped) drops the topbar, tree, list, toolbar, status row, actions, and outline; the printed form is always the rendered markdown (a textarea prints clamped to its box, so edit/split collapse to the preview); title prints as a clean 1.6rem heading, links underline, black-on-white. i18n +1 key (notes.readTime) — parity 1283→1284/1284. Cache-busts: command-palette v10→v11 (17p), notes-page v10→v11, notes.css v7→v8, i18n-en v48→v49 + i18n.js v104→v105 (24p) + fa inject v42→v43 (SW untouched — hibana-v399). LADDER: typecheck 0 · vitest 452/452 · smoke PASS · eslint 0 errors/164 baseline · build 75 entries · cache-bust PASS · i18n 1284/1284 · bundle PASS · playwright 102→105 (+4: jump-to-match incl. hash-consumption assertion, reading time, menu arrows, print-media emulation) · agent-browser live verification (palette→note→mark zanzibarneedle; 242 words · 1108 chars · ~1 min read; menu ArrowDown/End/Home walk; zero errors; zero residue). NOTE: mid-session the sandbox hit pthread exhaustion (accumulated agent-browser daemons from 4 sessions — killed them all; a known sandbox hygiene item, not an app bug). Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply migration 0058 (staged since S59b — remote D1s still schema 56).
### Session 62 changelog (v0.3.14.10 — Session 62: THE VAULT JOINS GLOBAL SEARCH + COPY AS MARKDOWN + PALETTE MATCH HIGHLIGHTS — the search-depth matrix is finally whole. (1) VAULT NOTES WERE UNSEARCHABLE: the 0040 matrix (projects, quick notes, backlog, sadhana, canvas, dev tasks) shipped BEFORE the Notes Vault existed (0057, S53) and was never revisited — Ctrl+K could find every text surface EXCEPT the one built for long-form knowledge. /api/search now carries a `vault` group: a LIKE scan over title+content (no FTS — an FTS migration would be owner-gated under rule 4; at personal scale LIKE is instant, and unlike the FTS groups' exact-phrase semantics it gives the palette substring matching, which suits type-ahead), rule 1 via user_id, soft-deleted notes stay hidden, LIKE wildcards in the query are escaped with ESCAPE '\\' (a stray % can't match everything), folder name joined for the sublabel, and a ~64-char snippet window centers the first content match so a body hit is distinguishable from a title hit. The palette renders it as a seventh group — خزانه/Vault with a padlock icon, amber ★ chip for starred notes (same #e0a92e as the vault list), deep link via the editor's own #n=<id> format. Pinned by 3 vitest tests (title+content+snippet+starred+folder, isolation+soft-delete exclusion, wildcard escaping) + 3 e2e tests (deep-link open with highlighted match, FA/خزانه + Persian-digit word count, clipboard). (2) COPY AS MARKDOWN: the vault kebab's clipboard twin of Export as .md — same body byte-for-byte (trimmed title as H1 + content), flushSave() first so an unsaved keystroke lands in the copy, async Clipboard API with an execCommand fallback for non-secure contexts, works on trashed notes too (the data is already client-side); toast کپی شد/Copied as Markdown. (3) PALETTE MATCH HIGHLIGHTS (styling batch): every search-result label now wraps the matched substring in <mark class="cmdk-mark"> — a soft accent-tinted underlay that keeps AA contrast on both themes AND on selected rows (deepened there so the highlight survives the selection wash); case-insensitive, HTML-escaped halves so entities never split, code-point exact for Persian (no lowercasing tricks needed); applied to all seven groups' labels and sublabels. (4) PERSIAN DIGITS IN THE VAULT WORD COUNT — the lone Latin-digit holdout in the vault UI localized (۱۱ واژه · ۵۰ نویسه, matching the counter and lightboxes). i18n +4 keys (cmdk.vault, notes.copyMd/copiedMd/copyFailed) — parity 1279→1283/1283. Cache-busts: command-palette v9→v10 (17p), notes-page v9→v10, polish-ui v15→v16 (21p), i18n-en v47→v48 + i18n.js v103→v104 (24p) + fa inject v41→v42 (SW untouched — hibana-v399). LADDER: typecheck 0 · vitest 449→452 · smoke PASS · eslint 0 errors/164 baseline · build 75 entries · cache-bust PASS · i18n 1283/1283 · bundle +3.5% PASS · playwright 99→102 · agent-browser 3-mode sweeps clean + FA/RTL feature verification (خزانه group, خزانه mark, deep link opens the note, ۱۱ واژه · ۵۰ نویسه, kebab کپی به مارک‌داون → کپی شد) + zero-residue cleanup. BACKUP-STAGGER VERIFICATION (S59 fix, the 09-17 03:17/03:23 ticks): PASS — dev snapshot 26,869B @ 03:17:23Z + prod snapshot 643,172B @ 03:23:23Z, exactly 6:00 apart, ping #46 SUCCESS @ 03:23:24.89Z empty body, watchdog up; the race fix is confirmed live (worklog Task ID 9). Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply migration 0058 (staged since S59b — remote D1s still schema 56).
### Session 61 changelog (v0.3.14.9 — Session 61: COMMAND PALETTE FOR TOUCH + REAL UPLOAD PROGRESS + LOCAL DISK SHOT STORE — two long-standing reachability gaps closed. (1) THE PALETTE WAS KEYBOARD-ONLY: Ctrl+K and "/" were the only ways in — touch users (phones have no keyboard shortcuts) had ZERO access to search + commands, and desktop users had no visible affordance to discover any of it. TWO visible entries now: a search-style pill in the topbar (nav partial: magnifier + label + a Ctrl K kbd chip that collapses to icon-only under 1280px, focus ring, 38px visual + padded hit area) and a "Search & commands" ACTION row at the top of the mobile More sheet (accent-tinted, 46px, auto-hidden on the few pages without command-palette.js). command-palette.js binds [data-cmdk-open] clicks via document-level delegation so the binding survives nav-partial re-injection; the sheet row closes the sheet THEN opens the palette. i18n +2 keys (nav.search, nav.searchCmd). (2) REAL UPLOAD PROGRESS: both shot-upload surfaces (media grid + task composer staged shots) used fetch() with base64 JSON — no upload-progress events exist on fetch, so mobile users stared at NOTHING (grid) or a bare text line (composer) for seconds. Both now share an XHR helper (upload.onprogress) + a per-file progress strip: rows go queued → active (live bar + Persian-digit % in FA, fill hugs the inline-start edge so RTL mirrors free) → done (full bar, fade, drop) / error (red row + ✕, lingers 6s); aria-live=polite; the old «در حال اپلود تصویر …» composer text is gone (server template cleaned); filename rendered via textContent only. (3) LOCAL DISK SHOT STORE (HIBANA_SHOTS_DIR, Node-only, src/services/disk-shots.ts — imported solely by src/server.ts, the sqlite.ts isolation pattern): local dev + e2e had NO working shot storage off-Workers (no KV binding, no R2 env, dummy GITHUB_TOKEN in the playwright env) — EVERY screenshot upload 500'd locally, so the whole upload→serve→gallery→delete pipeline was untestable. New precedence: explicit objectStore (disk) → kv → r2 → github; Config.objectStore is optional and the Workers entry never sets it; traversal-refusing key sanitizer (defense in depth); ObjectStore contract pinned by 5 vitest tests; playwright webServer now runs with HIBANA_SHOTS_DIR so the e2e uploads REAL bytes. STYLING PASS: resume-card tactile layer (hover lift + warm border + rocket micro-hop + CTA arrow nudge, RTL-aware, reduced-motion flattened) + keyboard focus rings on the mobile More sheet rows and the topbar user-menu items (both were hover-tint only — the sheet is a focus-trapped dialog where Tab users LIVE). e2e 92→99 (palette entries ×4 incl. FA/RTL + soft-nav persistence; upload progress ×3 incl. held-response mid-upload state + 413 error row + composer surface). LADDER: typecheck 0 · vitest 444→449 · smoke PASS · eslint 0 errors/164 baseline · build 75 entries · cache-bust PASS · i18n 1276→1279/1279 · bundle +3.3% PASS · playwright 99/99 · agent-browser 3-mode sweeps clean + feature verification EN/LTR + FA/RTL + 390px (palette open+focus, sheet close-then-open, pill 149×38, error row lingers 6s, done row drops at 650ms). Cache-busts: mobile-nav v8→v9 (18p), command-palette v8→v9 (17p), project-page v36→v37, i18n-en v46→v47 + i18n.js v102→v103 (24p) + fa inject v40→v41, layout v13→v14 (24p), dashboard v12→v13 (22p), quicknotes v13→v14 (24p), project-header v25→v26 (22p), nav partial internal v158→v159 (Class 3 network-first — no SW bump needed, sw.js untouched, SW stays hibana-v399). PENDING VERIFICATION: the backup-cron stagger's first new-schedule night (03:17 dev / 03:23 prod UTC 09-17 — background capture running in-session; read /tmp/s61-backup-ticks.log). Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply migration 0058 (staged since S59b — remote D1s still schema 56).
### Session 60 changelog (v0.3.14.8 — Session 60: PROJECT LIGHTBOX BROWSER + RESOLVED-STATE CHIPS + ZOOM AFFORDANCE — the owner's PRIMARY screenshot surface (the project page) had the same close-scroll-open-repeat loop the gallery had before S59b: ALL FOUR zoom entry points (main shots grid, pinned-shots dialog, staged grid, task-edit dialog grid) now open the BROWSER lightbox — prev/next walk the sibling figures of the SAME grid (wrap-around), live counter (Persian digits in FA) + caption, reading-direction arrows (RTL: ArrowLeft=forward), Esc closes AND focus returns to the trigger, close button takes initial focus; the browse scope derives generically from the figure's parent (the grid in all four surfaces — no per-surface wiring); a zoom from a non-grid source degrades to single-picture mode; the document-level click-outside check now ignores all clicks inside the lightbox (nav buttons were getting killed by the old img-only check). The scoping attribute generalizes [data-gal-lb]→[data-lb] (CSS + both pages + e2e renamed); a bare .shot-lightbox without it stays click-to-close single mode. RESOLVED-STATE CHIPS: the cards show fixed/open, browsing used to lose it — both browsers now carry a state chip beside the counter (amber 'open problem' / green '✓ fixed', brightened for the dark backdrop, flipping live as you walk the set; e2e-pinned on both pages). ZOOM AFFORDANCE: shot image buttons now say they zoom BEFORE the click — hover grows the image 4% (clipped inside the button, hover-devices only), focus gets a real ring (keyboard users had nothing on a bare borderless button), reduced-motion flattened. GALLERY EMPTY-STATE CTA: 'Open your projects' (the .empty-state-cta pattern) — the text told you where pictures come from, now it takes you there. i18n +1 key (gallery.emptyCta) — parity 1276/1276. Cache-busts: project-page v34→v36, gallery-page v3→v5, layout.css v11→v13, i18n-en v45→v46, i18n.js v101→v102 (24 pages), fa inject v39→v40 (the re-bump discipline applied — batch 2 edited after batch 1's bumps). LADDER (both batches): typecheck 0 · vitest 444/444 · smoke PASS · eslint 0 errors/164 baseline · build PASS · cache-bust PASS · i18n 1276/1276 · bundle PASS · playwright e2e 91→92 (project lightbox browse + wrap + arrows + Esc/focus-restore; state-chip assertions on both lightbox tests) · agent-browser live verification EN/LTR + FA/RTL (۱ / ۳, ArrowLeft=forward, '✓ درست شد' family labels) + wrap-around + focus restore + chip flip. PENDING VERIFICATION: the S59 backup-cron stagger's first full night (03:17 dev / 03:23 prod UTC 09-17 — both should commit to hibana-safe + success-ping with empty body; the watchdog's 6h period + 6h grace safely covers the 21:17→03:23 transition gap, verified against the check config). Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply migration 0058 (staged since S59b — remote D1s still schema 56).

### Session 59b changelog (v0.3.14.7 — Session 59b: EMAIL-LOG FORENSICS + CD GATE + GALLERY/LIGHTBOX/OUTLINE FEATURES — the S59 "alert path is dead" mystery SOLVED: email_log's kind CHECK constraint (left by 0041) allowed only verify/reset/custom/broadcast/reminder/invite — 'backup_failed' (scheduledBackup's failure alert) and 'test' (dev route) were REJECTED on insert and logEmail's bare catch{} swallowed the violation silently. The 09-12→09-16 storm's alert emails were SENT via Resend but left ZERO email_log rows; the admin console + daily quota were blind to them. MIGRATION 0058 (STAGED — written, tested, committed; remote D1s UNTOUCHED at schema 56, awaiting Ali's written approval per rule 4): widens the CHECK to the full 8-kind vocabulary (0041 rebuild pattern), restores idx_email_log_status_sent (0041's rename-follow drop silently lost the index — emailsSentToday scanned indexless since 09-09), 5 new vitest pins incl. the makeTestDbUpto(57) rejection proof; logEmail now log.warn's write failures (still never throws). APPLY via: dev first (d1-migrate-dev.yml — its pre-flight now accepts the 0041/0058 rebuild signature: DROP TABLE x_old allowed ONLY with an in-file 'ALTER TABLE x RENAME TO x_old'; 0048-style real drops stay refused), then prod with the bookmark ritual. CD GATE IMPLEMENTED FOR REAL: the old cd.yml comment claimed an unimplemented CI-status check while the push trigger raced CI to prod (deploys landed minutes before CI's verdict — a red CI deployed anyway). Now workflow_run-chained off CI completion on main: checkout pins workflow_run.head_sha (deploys EXACTLY what CI verified), job gated on conclusion=='success', deploys queue via concurrency (never killed mid-step); VERIFIED LIVE TWICE (7f35657 → CD success 23:51:11 UTC, 9328c65 → 00:15:08, both event=workflow_run; Dependabot PR CI runs correctly never chained). Trade-off documented: a broken ci.yml pauses deploys — the safe direction. FEATURES — (1) GALLERY DEEP-LINKABLE FILTERS: ?project=<id> + ?gs=open|fixed|pinned preselect the filters; changes replaceState the URL (defaults drop their param, history never grows — pinned by an e2e history.length assertion); a stale project id validates against real rows and falls back to All with the param cleaned ('never lose your place' for the media library). gallery-page.js v1→v3. (2) THE LIGHTBOX IS A BROWSER: prev/next walk the FILTERED set with wrap-around, live counter (Persian digits in FA) + caption in the dialog, arrows follow the reading direction (RTL: ArrowLeft=forward, matching the logically-positioned buttons), Esc closes AND focus returns to the trigger, close button takes initial focus; 44px touch floor, focus-visible rings, reduced-motion flattened, phone layout drops nav to thumb corners; scoped [data-gal-lb] — the project page's lightbox shares .shot-lightbox and stays click-to-close (scoping pinned by e2e). (3) VAULT OUTLINE MOBILE DROPDOWN VARIANT: no-pref default on ≤940px (the tree-drawer breakpoint) is COLLAPSED — an open 38vh list over a 390px pane is space the note needs; the collapsed head carries a LIVE current-section label (dropdown 'current value' — the scroll tracker updates it; hidden while open); explicit toggle pref wins on every viewport. notes-page.js v8→v9, notes.css v6→v7. PWA INSTALLABILITY AUDIT (standing item): PASS — manifest.webmanifest 200 + correct MIME, icons SVG/192/512-maskable all resolve, SW fetch handler live, manifest link injected on every page by hib-init.js (sadhana.html's static link is belt-and-suspenders); item CLOSED. i18n +3 keys (gallery.lbPrev/lbNext/lbClose) — parity 1275/1275. Cache-busts: gallery-page v1→v3, layout.css v10→v11, i18n-en v44→v45, i18n.js v100→v101 (24 pages) + fa inject v38→v39. LADDER: typecheck 0 · vitest 439→444 · smoke PASS · eslint 0 errors/164 baseline · build 75 entries · cache-bust PASS · i18n 1275/1275 · e2e 87→91 (vault-outline ×2, gallery URL-params, lightbox) · agent-browser live verification of every feature (EN + FA/RTL + wrap-around + focus restore) · both deploys healthy schema 56. PENDING VERIFICATION: the S59 backup-cron stagger's first :23 prod tick (03:23 UTC 09-17) + dev's :17 — both should commit to hibana-safe + success-ping; watch the healthchecks.io ping log. Owner standing items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, approve+apply 0058 (dev → prod).

### Session 59 changelog (v0.3.14.6 — Session 59: SWOT + BUG HUNT + UI/UX POLISH — two live bugs found and fixed: (A) THE BACKUP WATCHDOG FAIL STORM (prod, ~40% of ticks): the healthchecks.io "Hibana" dead-man's switch was DOWN (last /fail 09-17 UTC); ping-log forensics showed 9 fail pings over 09-12→09-16, and hibana-safe repo forensics showed the smoking gun — EVERY fail tick had exactly ONE commit landed (dev's 27KB snapshot) with prod's ~600KB snapshot MISSING, every success tick had BOTH commits. Both workers share the hibana-safe repo + GITHUB_TOKEN and fired the SAME cron at the SAME second ("17 3,9,15,21") — their concurrent Contents-API commits raced on the branch ref and the bigger prod PUT intermittently lost. A live wrangler tail at the 15:17 UTC tick captured a success run (backup_committed, wallTime 15.3s, outcome ok) confirming the pipeline works when unraced. FIX (three layers): (1) [env.prod.triggers] cron stagger :17→:23 (dev keeps :17) — six minutes apart closes the race window entirely; BACKUP_CRONS Set in src/lib/cron.ts recognizes BOTH expressions so old+new deploys classify correctly (03:23 keys the daily jobs via scheduledTime hour — unchanged logic); (2) pushFile single retry on 409/5xx/secondary-rate-limit after 2.5s backoff (snapshot paths unique per attempt — a retry can never clobber another run's file; stale-SHA overwrites re-probe fresh); (3) the /fail ping now POSTs the skip-reason/error text as its body — healthchecks.io stores ping bodies, so the NEXT failure is self-diagnosing from the ping log (the 09-12→09-16 storm carried its error text NOWHERE: empty ping bodies, email_log had zero backup_failed rows despite RESEND_KEY+OWNER_EMAIL secrets existing, console logs evaporate with the isolate — the email-path silence stays an open item). (B) THE MOBILE BOTTOM-NAV ACTIVE STATE (UI): built once at page load, never re-marked — stale after every soft navigation (notes → projects kept "Notes" lit; nav.js's markNav only refreshed the desktop topbar), and secondary pages (reports/calendar/gallery/settings/canvas/whiteboard/notifications/admin) showed NO active tab at all while the More button never lit even when the current page lives inside its sheet. FIX: mark() in mobile-nav.js is the single source of truth (normPath maps /app→dashboard, strips .html for prod's pretty URLs, /timeline→reports), nav.js markNav calls window.hibanaMobileNav.mark on every soft navigation, the More tab lights on sheet destinations, and the current page's row carries aria-current=page inside the open sheet (soft teal tint recipe). Pinned by e2e/mobile-nav-active.spec.ts (3 tests: hard-load marking, the soft-nav stale regression, More+sheet-row on secondary pages). MICRO-INTERACTION BATCH: tactile :active press feedback (3% squeeze on buttons/ghost/vault-quick/mobile-more-row, half that on vault-cards, guarded by prefers-reduced-motion: no-preference, FAB family keeps its own 0.92 recipe). Cache-bust bumps: mobile-nav.js v8, nav.js v4, polish-ui.css v15, quicknotes.css v13 (the re-bump discipline applied — polish-ui was edited after its first bump). VERIFICATION (full ladder, all green): typecheck ✓ · vitest 439/439 (+5 new: 3 healthcheck POST-body, 2 cron-set classification) · smoke ALL PASS · eslint 0 errors (164 pre-existing warnings) · build 75 entries · cache-bust PASS · i18n 1272/1272 · playwright e2e 84/84 (+3 mobile-nav pins) · agent-browser sweep: 16 pages × EN/FA × light/dark × desktop/390px = zero console/page errors, zero h-scroll · live probes: both deploys clean (login/signup/404/health, schema 56) · VLM-assisted visual audit (11 findings, 10 disproven as hallucinations — RTL arrow claims, placeholder contrast, phantom teal highlight; the ONE real finding was the mobile-nav bug). SWOT delivered to owner (strengths: verification discipline, DR culture, portability; weaknesses: watchdog false-fails, monolith JS, alert-path silence; opportunities: vault adoption surface, PWA re-check; threats: chat-exposed PAT rotation overdue). FIRST CANDIDATE SHIPPED — NOTES VAULT ONBOARDING BANNER (for vault-empty users; the Vault is live for everyone since S58 but an empty account had no surface pointing at it): server-renders in the /api/dashboard fragment ONLY while the user has zero active vault_notes (deleted_at IS NULL — trash-only users have seen the vault already), placed under the resume card; inline fragment script honors a localStorage dismissal (hibana-vault-banner-dismissed, never expires — new device = one more chance to adopt); the server stops rendering the moment the first note exists. CTA deep-links /notes.html?new=1; EN/FA via t() pairs; dismiss hits the 44px touch floor at ≤720px; dashboard.css v12; pinned by e2e/vault-banner.spec.ts (3 tests: visible+CTA+dismiss, dismissal persists across reloads while the server keeps rendering, no banner once a note exists — with zero-residue purge); the dashboard visual-regression baseline regenerated per the documented --update-snapshots procedure and VLM-verified (the 201px height delta IS the banner). Remaining candidates (mobile TOC dropdown variant, gallery URL params, vault outline e2e assertions) queued. Standing owner items: rotate GitHub PAT + CF token (chat-exposed), key-custody drill, PWA installability re-check, healthchecks.io check description updated for the :23 schedule.

### Session 57 changelog (v0.3.14.4 — Session 57: BACKUP-BUTTON RESILIENCE + DEV-D1 MIGRATION PIPELINE — owner report: "why can't I download an Obsidian backup?" ROOT CAUSE (read-only investigation): the live Worker code (schema 56, shipped S53–S56) ran against BOTH remote D1s still on schema 55 — GET /api/export/obsidian.zip SELECTs note_folders/vault_notes, threw "no such table", and died with a 500 + NO file (the settings backup button dead at the exact moment the owner wanted a pre-migration safety copy; the whole-DB cron snapshot already had the S53 missing_tables guard, but the Obsidian export and the personal JSON export did not). FIX 1 — buildObsidianVault (obsidian-export.ts) now wraps the two vault SELECTs in the same schema-race guard as buildSnapshot: only "no such table" is swallowed (everything else propagates), the export degrades to a valid zip WITHOUT the Notes section, and the route sets X-Hibana-Vault-Missing-Tables so the gap is loud, never silent. FIX 2 — buildUserSnapshot (personal JSON export, backup.ts) gains the Notes Vault it was MISSING entirely: note_folders + vault_notes join USER_SCOPED_EXPORT_TABLES (folders before notes for FK-safe restore order; NO deleted_at filter — a personal backup carries the Trash, same as the whole-DB snapshot; schema_version 20260920→20260921), AND every scope loop now rides the same missing-table guard (a lagging D1 yields a PARTIAL export with missing_tables, not a 500). Tests: makeTestDbUpto(56) helper (real migrations ≤0056 copied to a temp dir — a byte-identical lagging DB, not a lookalike) + 3 regression tests (obsidian 200-with-missing-header on schema 55, personal export carries vault+trash, personal export survives the race) — vitest 431→434. OPS — the dev-D1 migration pipeline the owner asked for ("test the migration on the second deploy, prove not even 1 byte is harmed"): new GitHub Actions workflow d1-migrate-dev.yml (workflow_dispatch, DB HARD-LOCKED to pm-app-dev — the second deploy at hibana.aliassadi.workers.dev; prod/pm-app-prod refused by three independent guards) runs the full ritual on a runner with the repo's existing CD credentials: Time Travel BOOKMARK (recovery point) → full SQL dump → per-table sha256 digest (scripts/d1-table-digest.mjs, canonical order-independent fingerprints via read-only wrangler d1 execute) → apply the migration via the SAME idempotent d1-migrate.mjs the owner uses → dump + digest again → PROVE (scripts/d1-verify-migration.mjs: every pre-existing table must keep its exact count AND sha256; only the declared new tables may appear; the bookkeeping may gain exactly the one registration row; any violation fails the run) → health probe → every evidence file uploaded as a 30-day artifact. Pre-flight refuses migrations with destructive statements (statement-position grep, comments stripped — 0048 would be refused, 0057 passes). The verifier is unit-proven locally: synthetic digests PASS clean, and a one-byte Persian-title mutation is caught (exit 1). Version ladder: sw.js v398→v399 (ship discipline), package.json v0.3.14.4; server-only batch — no public/ asset changes, no i18n keys, cache-bust N/A. vitest 434/434, i18n parity 1272/1272, eslint 0 errors/164 warnings (baseline), smoke ALL PASS.

### Session 56 changelog (v0.3.14.3 — Session 56: VAULT HEADING OUTLINE + HEATMAP TOUCH + A11Y LABEL SWEEP + ADMIN SKELETONS — autonomous QA round: baseline green (typecheck 0, vitest 431/431, smoke PASS), agent-browser error sweep across 13 pages (dashboard, calendar, gallery, notifications, archive, clients, whiteboard, projects, sparks, settings, project, notes, reports) found ZERO real errors (the one console 404 on project.html is the documented no-id placeholder bounce) and confirmed the calendar day-click quick-add panel already exists (backlog item retired). Product STABLE — no bug fixes needed this round; the batch is all features + polish. FEATURE — vault heading OUTLINE ("On this page", Obsidian-style): the preview pane gains a collapsible nav listing every h1–h3 parsed OUTSIDE fenced code blocks (a # inside ``` is code); shows at ≥2 headings (a single heading is just a title); clicking an item smooth-scrolls the preview pane to its heading; the pane's scroll position highlights the section being read (last heading above the fold line — and at the pane's bottom, the last VISIBLE heading wins, so a clicked late heading in a short note still highlights); the outline list itself scrolls (max 38vh, quiet scrollbar) with the ACTIVE item auto-kept in view; collapsed state persists in the vault prefs; lives INSIDE the preview pane so edit-mode hides it for free; read-mode stretches full-bleed to match the pane's clamp() padding; i18n «در این صفحه». Two real bugs caught by agent-browser while building it: (1) attribute collision — the click resolver [data-vh=N] matched the outline BUTTON first (sticky at pane top) instead of the rendered heading, so the click scrolled nowhere; buttons now ride data-vault-goto and only preview-body h1–h3 carry data-vh; (2) the created nav had data-vault-outline but NOT the .vault-outline class, so every style rule silently missed (unstyled list + collapse rule dead) — createElement now sets the class. FEATURE — heatmap tooltip TOUCH support (completes S55 on mobile): a tap focuses the cell (:focus already showed the card); a touchstart anywhere else now blurs it (touch has no blur-on-tap-elsewhere for non-focusable targets) and Escape dismisses too — both via one passive listener + one keydown in reports-page.js. A11Y — icon-only-button aria-label sweep (the long-standing residual): every icon-only <button> with a title but no accessible name across canvas (20), whiteboard (14), projects (1) now carries aria-label + data-i18n-aria-label (i18n.js already applies that attribute family — labels localize with the language switch); audit re-run: 0 remaining. STYLING — admin boot skeletons (the last surface booting blank): the overview's 8 KPI cards boot as ghost cards (number-height + label-width shimmers), recent-signups boots as 5 line pairs, the users tab boots as 3 ghost user cards; a FAILED fetch now CLEARS the skeletons (admin.js renderOverview early-return empties instead of leaving a stale shimmer); misc.css gains the ghost sizing (skeleton-kpi-num 1.35rem, w-20). Outline polish: sticky nav with backdrop-blur + dashed rule, level-2/3 indentation, accent rail tick + tint on the active item, caret rotation, reduced-motion flattened. Version ladder: notes-page v3→8 (v4 outline + v6 attr fix + v7 class fix + v8 list-scroll — three post-bump re-bumps, each a browser-verified catch), notes.css v4→6, reports-page v8→9, admin.js v5→v6, misc.css v9→v10 (22 pages), i18n-en v43→v44 + i18n.js v99→v100 w/ fa inject v37→v38 (all 24 pages), sw.js v397→v398, package.json v0.3.14.3. i18n 1271→1272 (+1 key: notes.outline). vitest 431/431 (no server changes — client-only batch, agent-browser-verified), e2e 81/81 (the notes-vault preview assertion updated to match headings-with-attrs via regex — the exact-string form broke on data-vh), i18n parity 1272/1272, cache-bust PASS (7 files), bundle +1.8% (PASS, ≤15% gate).

### Session 55 changelog (v0.3.14.2 — QUICK-NOTES IMPORT + HEATMAP TOOLTIPS + STREAK MILESTONES + VAULT TREE COUNTS — autonomous QA round: baseline green (typecheck 0, vitest 430/430, smoke ALL PASS), agent-browser sweep found the product STABLE (0 console/page errors across the vault + reports in EN/FA × light/dark × desktop/390px) with ONE real UX wart: parent folders showed DIRECT-only note counts, so a collapsed "Movies" read 0 while its subfolders held 3 notes — tree counts are now CUMULATIVE (own + descendants, cycle-safe by server-side move guards), matching Obsidian's convention. FEATURE — Quick-Notes → Vault import (the sparks twin, owner-approved in the S53 Q&A): POST /api/vault/import/quicknotes one-way-COPIES live quick notes into a find-or-create "Notebook" folder — kind 'note' derives its title from the first non-empty line (≤80 chars, markdown heading markers stripped), kind 'list' uses the list's own title (or first item) and renders items as plain markdown bullets with DONE items struck through (~~x~~ — the renderer's own subset; NO task-list syntax per the S53 rule); tag "quicknote" rides every import, empty quick notes are skipped-not-imported, title-dedupe keeps re-runs idempotent, quick_notes rows untouched (copy, never move); bootstrap.counts.has_quicknotes powers the empty-state «Import your quick notes» CTA alongside the sparks one; vitest pins copy-not-move, list rendering (bullets + strikethrough + no [ ] syntax), empty-skip, idempotency, rule-1 isolation (430→431). FEATURE — heatmap cell tooltips with the 4-SOURCE BREAKDOWN (S52 backlog): every real cell carries hurdles/projects/todos/notes (the API already sent them — the client used to keep only the total), and a styled card tooltip shows the localized date (Gregorian short for EN; FULL Jalali weekday+day+month+year in Persian digits for FA via the shared /js/jalali.js, now loaded by reports.html) + one row per source with an icon and tabular count (zero rows dimmed) + the accent total; keyboard-reachable (tabindex + :focus-visible), anchored above the cell with edge-column clamping and a below-flip for the first two rows, reduced-motion flattens the transition; the old raw-ISO title attr is replaced by a proper aria-label (role="img"). FEATURE — GitHub-style MONTH LABELS above the heatmap grid: a week whose first real day falls in the 1st–7th carries its month's name (EN 'Jul/Aug/Sept'; FA Jalali 'تیر/مرداد/شهریور'), positioned above the column, i18nTick-reactive. FEATURE — STREAK MILESTONE micro-celebration (S52 backlog): 3/7/14/30/60/100/365-day streaks light up the flame card — warm radial halo, flickering flame (3-step keyframe), and a spring-pop chip («first steps!»/«one week!»/…/«یک هفته!»), reduced-motion flattened. STYLING POLISH (notes.css + polish-ui.css): count pills became bordered chips that warm toward the accent on row hover, editor caret + selection get the accent tint (source AND preview agree), the sticky list-head's hard rule became a two-stop fade so cards dissolve under it, card stars get a drop-shadow + hover warmth, word-count chips get a separator dot, tree twisties now ROTATE with the open state (RTL-aware: collapsed points left via scaleX flip, open points down in both directions), empty-state icon circles get a faint inner ring, import CTAs lift on hover. i18n 1257→1271 (+14 keys EN/FA: reports.hmHurdles/hmProjects/hmTodos/hmNotes, reports.streakM3..M365, notes.importQuick/Done/None). Version ladder: notes-page v2→3, notes.css v3→4, reports-page v6→8 (post-bump re-bump — a cached v7 burned a QA cycle), polish-ui v12→13, i18n-en v42→43, i18n.js v98→99 (fa inject v36→37), reports.html + jalali.js?v=1; SW v396→v397, package.json v0.3.14.2. vitest 430→431, e2e 81/81 (unchanged — the import flow is unit-pinned + agent-browser-verified; a new e2e was consciously skipped to keep CI time flat), i18n parity 1271/1271, cache-bust PASS (7 files), bundle baseline holds. Conscious non-e2e note: the heatmap tooltip/milestone are client-only rendering verified via agent-browser + the i18n parity gate.

### Session 54 changelog (v0.3.14.1 — VAULT CAPTURE + SPARKS IMPORT + POLISH — agent-browser QA round found and fixed 3 real bugs: (1) a FILED note's breadcrumb read "Movies › Sci-fi › Unfiled" (the trailing Unfiled implied the note was unfiled — now the folder path IS the crumb chain, every segment clickable, unfiled notes show the Unfiled leaf as a button); (2) a TRASHED note's kebab offered Move/Duplicate/Re-trash which all 404 server-side (frozen rows) — now offers exactly Restore (which unfreezes the open editor IN PLACE via refetch) + Export; (3) tag ×-buttons rendered on trashed notes (PATCH 404 toast) — pills now render plain when trashed. FEATURE — first-class capture: the dashboard/projects/sadhana/sparks FAB gains «New note» (fab.vault) landing on /notes?new=1, which boots a fresh note with the title focused and strips the param (reload reopens the list); the command palette gains "New note" (cmdk.newNote) → same entry. FEATURE — Sparks→Vault import (owner-approved in the S53 spec Q&A): POST /api/vault/import/sparks one-way-COPIES every live spark into an "Ideas" folder (find-or-create, case-insensitive) as tagged vault notes (description + "where I left off" as a markdown quote — no new syntax per the S53 rule), idempotent by title-dedupe (re-runs skip), sparks themselves untouched; bootstrap.counts.has_sparks powers an empty-state «Import your ideas» CTA shown only when the vault is empty AND sparks exist; vitest pins copy-not-move, idempotency, rule-1 isolation (13 vault tests). STYLING POLISH (notes.css v3): card hover lift + hairline tint + focus ring, star-pop bounce keyframe (toggle + card), editor title focus underline grows from center, save chip reworked as a state dot (pulsing while saving, green settle, hidden when idle — .vault-save:empty), breadcrumb chevrons properly sized/dimmed, preview typography earns "Reading" (accent-bordered tinted italic blockquotes, code islands with surfaces + LTR fences, calmer heading rhythm with scroll-margin, accent list markers, styled links/hr), empty-state icons in soft accent circles, tag pill fills, toolbar/menu focus-visible rings, reduced-motion flattens the movement animations. i18n 1250→1257 (+7 keys EN/FA: fab.vault+hint, cmdk.newNote, notes.import*). SW v395→v396 (precached HTML changed). Version ladder: notes-page v1→2, notes.css v2→v3, command-palette v7→v8, i18n-en v41→42, i18n.js v97→98 (fa inject v35→36); package.json v0.3.14.1. vitest 428→430, e2e 80→81 (FAB→?new=1 golden path), bundle +0.5% (PASS, baseline holds).

### Session 53 changelog (v0.3.14.0 — NOTES VAULT — a standalone Obsidian-style long-form knowledge base at /notes (owner request, 3 reference screenshots: sidebar+reading view, 3-column cards+toolbar, nested tree+status bar). Migration 0057 (STRICTLY ADDITIVE — owner constraint "no information must be missed": note_folders (self-nesting parent_id) + vault_notes (folder_id SET NULL on folder delete, starred, deleted_at soft-delete from day 1, manual tags as CSV, 200KB content cap), 3 indexes, schema 55→56; the backup-audit drift guard caught the new tables instantly — SNAPSHOT_TABLES + restore.mjs FK-safe order now carry note_folders/vault_notes so user backups and the restore drill include the vault. API: /api/vault/* (quick_notes owns /api/notes since 0010) — bootstrap (folders + per-folder note counts + tag index counting manual pills AND inline #tags one-vote-per-note + all/starred/unfiled/trash counts), notes CRUD + duplicate + soft-delete/restore/purge (purge = the ONLY information-destroying endpoint, trash-only), folders CRUD with cycle-safe moves + delete-that-unfiles, LIKE search (q over title+content, escaped), tag filter (pills + '#tag' in content), 3 sorts, .md export (slugified filename, no-header-injection). Frontend: notes.html + notes-page.js (fetch-driven, __hibanaPage mount) + notes.css — 3-pane layout (folder tree w/ twisties + kebab menus | rich cards w/ date/title/2-line excerpt/tag pills/word count/active accent bar | editor), Edit/Split/Reading modes with a live markdown preview (renderMarkdown ported VERBATIM to the client — keep in lockstep with src/lib/markdown.ts), markdown toolbar (B/I/S/code/H1-3/lists/quote/link/hr — selection-aware wrapping), debounced autosave + save-state chip + retry-on-error, star, tag editor pills, move-to-folder dialog, breadcrumbs, word/char status bar, #n=<id> deep links, remembered view/sort/mode/expanded prefs; mobile = tree drawer + full-screen editor slide-over (RTL-corrected: the drawer anchors at the reading-start edge and only the slide direction flips — first cut had it anchored left in RTL and sliding right, landing ON the viewport). MARKDOWN FIXES (found by the new renderer tests, server + client twin): unordered lists were double-wrapped as <ul><ol><li> (bullets rendered as numbers with double indent) — typed markers (\x01U/\x01O) now wrap each run once; fenced code blocks are pulled into placeholders and restored last so inline passes (bold/links) can't corrupt their bodies. Obsidian export: Notes/<folder path>/<title>.md per note (cycle-guarded path builder, per-folder dedupe sets, starred/tags/hibana-id frontmatter, Home.md MOC row + links). Integrations: topbar Notes link, mobile-nav tab, g o shortcut (n = notebook), palette qa-notes + go-to hints, i18n 1150→1250 (+96 notes.* + nav.notes + common.back keys, EN+FA with proper ZWNJ), SW v395 + /notes.html in the shell, build entries notes-page.js/notes.css (75 manifest). Tests: vault.test.ts (12: tree/cycle/unfile-on-delete, tag index votes, search/tag/sort, soft-delete/restore/purge wall, duplicate/export, rule-1 isolation, 401 wall, excerpt/wordCount/safePathSegment), markdown.test.ts (7: the two fixes pinned), obsidian-export notes test — vitest 408→428, e2e 79→80 (notes-vault.spec.ts golden path w/ the SW-controller settle). QA via agent-browser: EN light desktop, FA dark, 390px mobile (drawer/editor/back), soft-nav from dashboard, palette, g o — 0 console errors. Version ladder: notes.html v1 (notes-page v1, notes.css v1→2 post-RTL-fix), i18n-en v40→41, i18n.js v96→97 (fa inject v34→35), go-to v1→2, command-palette v6→7, mobile-nav v5→6, nav.html v158, SW v394→v395, package.json v0.3.14.0. Bundle-size baseline refreshed per the documented procedure (the 09-13 baseline predated S50–S52: their +117KB had each passed the ≤15% cumulative gate; S53's intentional +68KB — notes-page.js 38K + notes.css 19K + i18n dicts — crossed it at +16.8%, so the baseline now records 1,288,049 bytes). Deferred by owner decision: no markdown syntax extensions this phase, no backlinks/graph/tabs/templates/daily-notes; Sparks→Vault import tool approved for a later batch; true inline WYSIWYG (CodeMirror-class editor) parked pending owner appetite.

### Session 52 changelog (v0.3.13.9 — ACTIVITY STREAKS + TRASH DISCOVERABILITY + WHITEBOARD SKELETON — batch A: /api/reports/heatmap widened from 2 activity sources to 4 (hurdles solved, projects created, to-dos completed — one-shot via cleared_at + recurring via sadhana_recur_history.completed_on — notes captured via quick_notes.created_at; read-only, user-scoped, no schema change); streak trio on the Reports heatmap card (Current 🔥 / Longest 🏆 / Active days n/91, computed client-side from the same rows — "current" stays alive through today-or-yesterday so an unfinished today doesn't read as a break; the flame card tints amber only while alive; the trio also rides the Markdown digest + CSV export); reports-heatmap.test.ts pins per-bucket arithmetic, the 91-day window, the done=1 guard (a stale cleared_at on an un-completed task must not count), and rule-1 isolation (vitest 404→408). BUG FIX: .trash-meta.is-urgent referenced var(--warn), which is defined NOWHERE in any stylesheet — the S50 amber urgency tint silently never rendered; now uses the orange semantic token --badge-awaiting-fg (AA in both themes). Batch B: Trash palette command — "Trash — recover deleted items" with the live recoverable count as the sublabel ("2 recoverable", fetched once per session like the tag cache, Persian digits «۲» in FA), soft-navigates then smooth-scrolls to Settings → #settings-trash (polls for the async swap; in-page clicks scroll directly). Batch C: whiteboard boot state — the last spinner+text pill became 4 ghost sticky-note skeletons (varied widths + subtle rotations, the shared .skeleton shimmer base; data-board-loading kept verbatim so whiteboard.js's removal and the notebook e2e's detach wait are untouched). i18n 1143→1150 (+5 streak keys, +2 cmdk trash keys). SW v394.

Session 49 was a no-schema-change hygiene session on top of the stable S48p ship. Audit → fix → verify → deploy batches, each run through the full ladder. **CI is green for the first time since 2026-09-13** (ESLint red since S41; the e2e step had also been failing on a stale 404 visual baseline).

### Session 49 changelog (7 batches):

- **S49-b1 — CI-red + sprint draft-flow + 404 dedup**: (1) ESLint: `EMOJI_TOKEN_RE` (S41) tripped `no-misleading-character-class` ×3 — every CI run since S41 failed at the ESLint step (CD deployed anyway); scoped disable + rationale comment. (2) S48n REGRESSION (e2e-pinned by sprint-ux S7): the sprint define popover PRE-FILLED the start date, making the "no start date → create as DRAFT" branch unreachable — every Define created a STARTED sprint; the start input now opens EMPTY (name-only Define = draft, the S33/S45 contract), presets fill BOTH start+end. (3) 404.html loaded 404-page.js TWICE (head + body-end) — the double run added the #nf-back listener twice so Back skipped two history entries; removed the body-end copy. sw.js's 27KB single-line VERSION comment replaced with a pointer (v384→v385).
- **S49-b2 — dead-code removal**: 5 never-called functions in sadhana-page.js (doLogout, gregWeek, toggleAdvanced, toggleUserMenu, updateDate — 53 lines), 3 dead CSS rules (.shot-note-form ×2, .sadhana-quadrant.drop-target, .skeleton-line.w-30), scripts/tmp-b4-helpers.py (one-shot S30b4 codemod) deleted. Bumps: sadhana-page.js v3→4, to-do-list.css v2→3, layout.css v9→10, polish-ui.css v4→5; SW v385→v386.
- **S49-b2.5 — 404 visual baseline refresh**: the S43-era 404.png snapshot failed on BOTH current CI runners and a fresh sandbox with an identical 3.0% noise-texture diff (Chrome's feTurbulence rendering drifted); regenerated via the documented --update-snapshots procedure; the other 3 baselines still pass untouched. Last red CI step — green after this.
- **S49-b3 — modularize**: pdeHtmlToMd (68-line pure HTML→markdown converter) moved VERBATIM from project-page.js to chip-render.js as `HibanaChips.htmlToMd` — its md→HTML inverse renderTitle already lives there; one module now owns both directions of the WYSIWYG round-trip. The cache-bust gate ALSO caught board-page.js's dynamic fallback still injecting chip-render.js?v=4 (stale since the S48-era) — aligned to v6. Bumps: chip-render.js v5→6, project-page.js v33→34, board-page.js v11→12; SW v386→v387.
- **S49-b4 — debt + ancient parts**: sw.js header 146 lines of session narrative → 13-line pointer (file 53KB→10.8KB; recover via `git show 7283678:public/sw.js`); Changelogs.md pre-S40 session details (S7→S35, ~1,560 lines) removed with a git-recovery note + the three duplicate "## 1. Current state" headers deduped (keep newest, demote S44/S45 to context subheaders) — file 2,550→~1,000 lines; README/Agents/package.json stale numbers refreshed (v0.3.12.14-era); audit verdict recorded: monolith splits are NO-GO (closure-bound IIFEs), the audit found the tree otherwise clean (no dead files, no version drift, no debug logs).
- **S49-b5 (2026-09-16, owner instruction) — CSP allows the CF Web-Analytics beacon**: executing the S49 live-probe owner decision — Cloudflare auto-injects `static.cloudflareinsights.com/beacon.min.js` on every page (verified: module + SRI + token, `spa:2`) and the `'self'`-only policy killed it (one console error per page, analytics never ran). The CSP (src/app.ts + public/_headers, kept in lockstep) now grants exactly two external https origins: `script-src … https://static.cloudflareinsights.com` (beacon) and `connect-src … https://cloudflareinsights.com` (telemetry) — no wildcards, everything else unchanged; security.test.ts pins BOTH origins + the absence of wildcards so a future CSP rewrite cannot silently re-block or widen it. No asset content changed → no ?v=/SW bumps. v0.3.13.0→0.3.13.1.
- **S49-b6 (2026-09-16, owner instruction) — deep-link domain de-hardcoded (APP_URL)**: "domain must not be hardcoded, domain might change" — the audit's Watch item, executed. New single source of truth: `APP_URL` env var → `cfg.appUrl` → `appUrlOf()` (src/lib/app-url.ts); default stays `https://hibana.ir` byte-for-byte, so nothing changes until the owner sets it (wrangler.toml [env.prod.vars] carries `APP_URL = "https://hibana.ir"` as the one line to edit on a domain change). Replaced all 7 runtime hardcodes: reminders email/Telegram links (was module const APP_URL), Sadhana Telegram reminder link, backup-failure email origin, ICS feed URLs + UID hosts (`loadIcsEvents` gained an `appUrl` param; UIDs derive their host from it — a domain change intentionally starts a fresh ICS identity since the old feed's URLs are dead), the invite-email signup link (`inviteEmailHtml` gained an origin param, request-scoped), and dev.ts Telegram-webhook defaultBase (honors the override, keeps the workers.dev dev fallback — Telegram needs a reachable origin). Request-scoped paths (reset/verify/Telegram-command links) already used `requestOrigin()` and are untouched. DELIBERATELY still domain-tied: the Resend sender `noreply@hibana.ir` (a Resend-VERIFIED address — deriving it from APP_URL would break every send if verification lags a domain change; documented on the function + §6 runbook). Tests: app-url.test.ts pins the default; reminders + ICS tests pin that a set `appUrl` flows into every link/UID. No public/ asset changed → no ?v=/SW bumps. v0.3.13.1→0.3.13.2.

No schema change, no DB touch, no migration. Ladder per batch: eslint 0 errors · typecheck 0 · vitest 399/399 (394 through b5; +5 APP_URL/reminders/ICS tests in b6) · node --check · cache-bust PASS · i18n 1124/1124 · build + dist-wiring PASS · playwright (full suite once after b1: 78/79 → the 1 failure was the 404 baseline, fixed in b2.5; targeted specs per batch all green).

### Pre-S49 state (v0.3.12.84 — Session 48p: 6 fixes — AI translate content loss, copy icon, color coding, sprint extend, sprint log. SW v384.)

Session 48 was a massive UI/UX refinement session (S48 → S48p, 16 commits) on top of the S46 ship. Key themes: the WYSIWYG contenteditable editor (S48d–S48f), the IIFE-trapping dist build bug (S48), sprint board + timeline fixes (S48b, S48m, S48o), + a loading animation (S48i). All changes are CSS/JS only — no schema changes.

### Session 48 changelog (commits S48 → S48p):

- **S48** — ROOT CAUSE: the esbuild dist build used `format:'iife'` which wrapped every page JS file in `(()=>{...})()`, trapping ALL top-level function declarations inside the IIFE closure. Inline HTML handlers (`onclick="scrollMore()"`, `onscroll="checkMore()"` — 59 handlers in sadhana-page.js alone) couldn't find the function in the global scope → ReferenceError → "nothing happens" on the deployed dist build. The e2e tests (Node server, serves source directly, no IIFE) never caught it. Fix: removed `format:'iife'` from scripts/build.mjs. Also: sadhana subbar alignment (`.hdr-date` physical margin → logical; `.subbar-inner > *` gets `min-block-size:32px`). SW v366→v367.

- **S48b** — Priority dot follows title direction (`dir="auto"` on `.pd-task-title-row`) + subbar alignment v2 (CSS variable `--subbar-item-h` tracks `.btn` height at each breakpoint). SW v367→v370.

- **S48c** — Compact project tag chips (remove button 28→16px, chip 31→26px). SW v370→v371.

- **S48d** — Fullscreen editor toolbar (Bold/Underline/Strikethrough/Numbered list/Align×4/Code block). Renderer extended (chip-render.js + detail-helpers.ts: `__underline__`→`<u>`, `~~strike~~`→`<s>`, `1. text`→`<ol>`, `{:align}`→`<div style="text-align">`). SW v371→v372.

- **S48e** — Toolbar moved above the textarea (was below). SW v372→v373.

- **S48f** — WYSIWYG contenteditable editor (textarea → contenteditable + `document.execCommand`). `pdeHtmlToMd()` converts HTML→markdown on save. SW v373→v374.

- **S48g** — Separate Title field above the Content field (stored as `title\ncontent` in the DB — no migration). SW v374→v375.

- **S48h** — Hotfix: `ta.value=''` → `ta.innerHTML=''` (contenteditable has no `.value`); invalid `<label>` wrapping contenteditable → `<div class="pde-field">`. SW v375→v376.

- **S48i** — Loading animation: full-page overlay (`#hibana-page-loader` with spinner, painted in HTML, hidden on DOMContentLoaded) + top progress bar for htmx swaps. SW v376→v377.

- **S48j** — 5 fixes: card shows only Title (first line, full content in `data-raw-title`); removed clear-done button; shrunk note buttons; filter clear visibility (`[hidden]` CSS specificity fix); priority dot alignment (`align-items:start`). SW v377→v378.

- **S48k** — 7 fixes: backup 409 (GitHub SHA probe); AI translation prompt (stronger "MUST output OPPOSITE language"); placeholder RTL; sprint today line (center of cell); sprint dots (3D radial gradient, no shadow); all tasks on sprint board; sprint popover→modal. SW v378→v379.

- **S48l** — Toolbar focus theft fix (`mousedown preventDefault` on `.pd-tb-btn` stops the button from stealing focus → contenteditable keeps its selection → bold/underline/strike all work). Code block: no nesting check, `insertHTML` instead of `insertNode`, trailing `<p><br></p>` for cursor escape. SW v379→v380.

- **S48m** — Sprint dot position: center the dot on its day cell (`pctOf + half_cell` + `transform: translateX(-50%)`). Was: LEFT edge → dot appeared past the today line. SW v380→v381.

- **S48n** — Sprint dates + presets (24h/48h/72h/1w/2w/1m) + task→sprint selector in the composer. `createSprintSchema` accepts `started_at`/`ended_at`. SW v381→v382.

- **S48o** — Sprint active warning: "only 1 sprint active" rule confirmed (already enforced). Added UI warning in define popover. SW v382→v383.

- **S48p** — 6 fixes: (1) AI translate content loss (magic-wand preserves `data-raw-title` content after `\n` when PATCHing); (2) Copy icon in ⋯ menu (copies full title+content); (3+4) Color coding: BLUE=idea, RED=bug, YELLOW=planned, ORANGE=in_progress, GREEN=done (both sprint + project); (5) Sprint extend button (PATCH `ended_at` + days); (6) Sprint log (total tasks, done count, category breakdown). SW v383→v384.

### Pre-S48 state (v0.3.12.49 — Session 46.2)
- **(S46.2) THE 4 FOLLOW-UP FIXES (owner, 2026-09-14, reported after testing the S46 ship):**
  - **(1) Desktop urgent RTL/LTR split**: the owner reported the urgent strip shows "one Latin item RTL, one LTR" on PC (mobile was fine). Root cause (reproduced via DOM geometry): the FA page's `direction: rtl` made the `.dash-urgent-row` flex reverse, so `.dash-urgent-main` (shrink-wrapped to content width via `flex: 0 1 auto`) sat at the RIGHT edge — short titles stayed narrow (right side), long titles extended left. The S46 `text-align: start` fix only helped wrapped (mobile) titles; on desktop (single-line), text-align is a no-op. Fix: `direction: ltr` on `.dash-urgent-row` — main now sits at the LEFT consistently (both titles start at the same x — verified: `titleLeft: 131` for both rows, was 370 vs 522). Farsi text still flows RTL via the S31b `unicode-bidi: plaintext` on `.dash-urgent-main` (plaintext overrides `direction` for bidi resolution); the analytics e2e Farsi-dot-right pin still passes.
  - **(2) Unified + chooser**: the owner called the S46 idea-only `+` on projects "dead-wrong" — wants "a (+) Button on every page, when clicked gives 3 options: new note, new idea, new project." The dashboard already had the `.fab-stack[data-fab]` chooser pattern (3 fab-items). Standardized: swapped the dashboard's "New Task" item for "New idea" (so the set is idea/project/note everywhere) + added the SAME chooser markup to projects (replaced the idea-only +), sparks (added), sadhana (added). The handlers in `app.js` are document-delegated (`data-quickadd-open` / `data-projectquickadd` / `data-notequickadd`), so dropping the markup on any page that loads `app.js` Just Works. Verified: projects FAB opens 3 items (ایده جدید / پروژه جدید / یادداشت سریع جدید).
  - **(3) Magic-wand on new tasks**: the owner reported "wand still doesn't appear on a newly-added task without refresh." Reproduced locally: the S46 `injectPdTaskMenus()` call at the end of `insertTaskChip` IS shipping + working — `hasDataMagic: true` on the new title, `wandVisible: true` on hover. The owner's report was a stale service worker (pre-S46 project-page.js v14 without the call). Defensive fix: `magic-wand.js`'s `injectDevTaskMagic` now ALSO stamps `.pd-task-wrap:not([data-magic-ok]) .pd-task-title:not([data-magic])` — the wand is now the single source of truth for `[data-magic]` discovery (idempotent), robust to any future change in project-page.js.
  - **(4) Item 13 bundle** (the project-progress head + the task editor): (13b) shrunk the 3 head buttons via a high-specificity `.pd-board-head .row > .btn, .pd-board-head .row > .pd-new-sprint` rule (fs-sm, 2rem min-block, 0.32rem 0.6rem padding); (13c) `#pde-form` task editor now has a screenshot row — «افزودن اسکرین‌شات» file input (upload each + pin to the task via the 0054 `screenshots.task_id` link) + «تصاویر سنجاق‌شده» view button (opens the existing `taskShotsDialog(tid)`) + a live count badge (`pdeRefreshShotsCount` fetches the count on every open); (13d) `#pde-form` modal anchored near the top (`margin-block-start: clamp(1rem, 4vh, 3rem); margin-block-end: auto`) — was UA-centered (`margin: auto` in the top layer) so on a tall viewport it floated mid-screen, far from the project heading; «ویرایش» label shrunk (`#pde-title { font-size: var(--fs-md) }`).
  - **Cache-bust**: SW `hibana-v346`→`v347`; ?v= bumped on every referencing HTML page for the 6 touched CSS/JS files (dashboard.css 10→11, project-header.css 12→13, project-page.js 15→16, magic-wand.js 10→11, i18n-en.js 23→24, i18n-fa.js 23→24 ref in i18n.js, i18n.js 79→80); + 4 HTML pages got the FAB chooser markup (dashboard/projects/sparks/sadhana).
  - **Ladder**: typecheck 0 · vitest 394/394 · node --check on all touched JS · i18n parity 1094/1094 (+4 `pde.shots*` keys) · cache-bust 6 files PASS · playwright e2e 79/79 (incl. analytics urgent-strip Farsi-dot-right pin still green — the `direction: ltr` row fix doesn't break the S31b Farsi dot).
  - **No schema change.** Item 13c reuses the existing 0054 `screenshots.task_id` FK (S39) — POST `/api/projects/:id/screenshots` returns `{ ok, id }`, PATCH pins `taskId`; client-only, no server route or migration touched.

- **(S46) THE 13-ITEM REFINEMENT BATCH (owner, 2026-09-14: 13 UI/UX fixes observed while
  using the just-shipped S45 crown work).** All 13 are small, surgical, no schema change
  (items 10 & 13 reuse the 0054 `screenshots.task_id → dev_tasks` pin). Grouped by area:
  - **Dashboard (`src/routes/dashboard.ts` + `dashboard.css`)**: (1) the urgent fire strip's
    Latin titles finally align LEFT when they wrap — `text-align: start` on
    `.dash-urgent-main` follows the S31b plaintext paragraph direction (LTR for Latin,
    RTL for Farsi). The earlier `dir="auto"` / `unicode-bidi: plaintext`-on-anchor
    attempts broke the Farsi dot-position e2e pin (the dot is a flex sibling of the
    anchor, so isolating the anchor removed the parent's first-strong-char signal);
    `text-align: start` is the safe fix — the dot position is untouched. (2) the strip
    renders right AFTER the projects section (was above all pref-ordered sections); if
    projects is hidden it falls back to right after the resume card so the alert still
    surfaces when something is burning.
  - **Notebook (`quicknotes-helpers.ts` + `html.ts`)**: (3) the note-controls-toggle
    summary now renders a real cog (new `'settings'` icon case — the old `'gear'`
    sun-burst read as a sun/eye and hid the "view options" affordance; the doing-stage
    `'gear'` is untouched per owner-held decision).
  - **Sadhana / to-do-list (`sadhana.html` + `sadhana-board.css`)**: (4) the filter-tags
    row is hidden behind a `<details>` toggle (summary = 🏷 Tags chip; chevrotates 180°
    when open). The `#filterCount` span stays outside the toggle so the active filter
    is still announced when closed. `buildFilterBar`/`setFilter` unchanged.
  - **Projects list (`projects.html`)**: (5) the FAB is a SINGLE `+` (matches every
    sibling page). The header «New project» primary button covers project creation;
    was two split fab-rows (+ idea + + project) — inconsistent.
  - **Project detail (`project-page.js` + `project-header.css` + `devboard.css` +
    `layout.css` + `polish-ui.css` + `polish-batch.css` + `misc.css`)**: (6) project
    list titles down a step (`.pc-title` 1.15→1rem). (8) tag chips softer/smaller (bg
    12%→7%, border 50%-softened, text 62%→55%, padding tightened). (11) «آخرین تغییرات»
    tab + history list both down a size (fs-lg→fs-sm). (12) `insertTaskChip` now calls
    `injectPdTaskMenus()` at the end — freshly-added tasks get the ⋯ menu + the
    `[data-magic]` wand attrs without a page refresh (was swap-only). (10) the
    screenshot note editor is a MODAL (reuses `makeDialog`) with a 6-row autosize
    textarea + compact Save/Cancel (`.pd-shot-note-ta` etc.); a «create bug/idea from
    this screenshot» row turns the note into a new dev_task (status bug|idea, priority
    high|medium) and pins the shot to it via the 0054 link — so it lands in the
    Problems/Ideas box with a 📌 badge. (13) the task composer carries an
    «افزودن اسکرین‌شات» file picker (`#pd-taskadd-shots`); on submit, each file uploads
    + pins to the new task, then `bodyRefresh` re-renders the board with the pin badges.
  - **Canvas (`canvas.html` + `canvas.css` + `canvas.js`)**: (7) pen-widths + colors
    each collapse behind a `<details class="tb-popover">` — the summary shows the
    active dot/swatch; the list expands inline when open. The width/color click
    handlers now sync the summary + close the popover on pick (and `applyThemeInk`
    keeps the swatch in sync on theme flip).
  - **Screenshots (`core.ts` empty-state + `polish-ui.css`)**: (9) `.empty-state` gets
    `grid-column: 1 / -1` — was squeezed into one 9rem cell of the `.shot-grid`
    (`repeat(auto-fill, minmax(9rem,1fr))`) and read "compacted on the right" in Farsi.
  - **i18n**: 11 new keys (FA+EN parity): `project.shotNoteTitle/CreateHint/CreateBug/
    CreateIdea/NeedText/shotBugCreated/shotIdeaCreated/shotsAttached`, `tags.label`,
    `canvas.penWidth/penColor`. i18n-en/fa v22→v23; i18n.js v78→v79 (injects fa v23).
  - **Cache-bust**: SW `hibana-v345`→`v346`; ?v= bumped on EVERY referencing HTML page
    for the 12 touched CSS/JS files (layout.css 8→9, polish-ui.css 3→4, misc.css 7→8,
    project-header.css 11→12, canvas.css 4→5, sadhana-board.css 3→4, dashboard.css 9→10,
    project-page.js 14→15, canvas.js 30→31, i18n-en.js 22→23, i18n-fa.js 22→23,
    i18n.js 78→79). check-cache-bust CI gate PASS.
  - **Specs updated for the intentional behavior change**: `e2e/media-gallery.spec.ts`
    + `e2e/sprint-timeline.spec.ts` — the screenshot-note editor selectors moved from
    the old inline `.shot-note-form` to the new modal (`dialog:has(#pd-shotnote-title)`
    + `.pd-shot-note-ta` + `[data-shot-note-save]`).
  - **Ladder**: typecheck 0 · vitest 394/394 · node --check on all touched JS ·
    i18n parity 1090/1090 (+11) · cache-bust 12 files PASS · playwright e2e 79/79
    (incl. viewport.spec 360/390/768/1024/1440 no-h-scroll on every page; analytics
    urgent-strip Farsi-dot-right pin still green; screenshot-note modal flow pinned).
  - **No schema change.** Items 10 & 13 reuse the existing 0054 `screenshots.task_id`
    FK (S39) — the upload POST returns `{ ok, id }` (core.ts:407), the PATCH pins
    `taskId`; both client-only, no server route or migration touched.

- **(S45) CROWN SURFACES — BATCH B: THE SPRINT PAGE (owner: "Do batch B and C now.")**
  — grounded in the same fresh-clone audit; the S35 strip anatomy (startdot / clip /
  clip-fill / ticks / live-edge / enddot / chip stats) and every S44 contract (today
  pad + «امروز» flag) preserved and re-pinned:
  1. **RENDER-TIME i18n — THE THIRD-BITE GUARD (S1)**: the sprint page's INJECTED DOM
     rendered English on the FA page forever — the categories side-head
     ("Categories"), the chip popover's Save/Finish/Reopen/Delete, the
     new-category form's Add/Cancel. Root cause: i18n.js's apply() scans the STATIC
     DOM only; data-i18n attrs on dynamically injected markup are never re-scanned
     (the same bug class bit in Session 23 and S30). Fix: every injected string now
     translates AT RENDER via _t() — race-free because boot() already awaited
     hibanaI18n.ready (S30 batch 5). The law is now documented in i18n.js's header
     so it can't bite a third time: "JS that builds DOM must translate at RENDER
     time via t()". e2e-pinned by a dedicated FA spec (sprint-ux.spec.ts).
  2. **MOBILE HIERARCHY FLIP (S2)**: ≤760px the TIMELINE now renders FIRST and the
     categories panel drops BELOW it — the side panel used to stack ~580px of chrome
     (wrapped toolbar rows + a 326px side) above the page's whole purpose. ≤640px the
     toolbar compacts too: the project title ellipsizes into the back-link row and
     the desktop flex-gap spacer stops burning a row (~6 rows ≈250px → ~4). DOM
     untouched (flex order flip — the aside stays first for no-JS/SEO).
  3. **FINISH READS AS A CONTROL, NOT AN ERROR BANNER (S3)**: the running sprint's
     Finish button was a 264px solid-danger block (full-width on phones; a lone
     second row on desktop) that read as an alarm, not a control. Now: outlined
     ghost-danger, max 15rem, the action label stays SHORT and the sprint's NAME
     rides its own ellipsized span (#sp-finish-name); the full context (what
     finishing means + which sprint) lives on the tooltip + aria-label.
  4. **THE STRIP IS FINALLY VISIBLE (S4)**: the crown visualization was 9px tall —
     nearly invisible. Clip 9→20px, chip 22→28px (fs-sm), dots re-anchored on the
     taller strip (startdot 42 / enddot 43 / live-edge centered), lane 3.1→4.4rem.
     All S35 anatomy classes preserved — the sprint-timeline.spec.ts pins pass
     unchanged.
  5. **THE 40px TOUCH FLOOR (S5)**: the sprint chip (74×22, 198×22 — the mobile
     audit's last standing page-specific TAP flag) + the popover buttons + the side
     panel's cat-tools + the toolbar's own buttons (the back link measured 99×37)
     now clear 40px on (pointer:coarse); the lane grows WITH the chip so the strip
     geometry never collides. Desktop visuals untouched. Sprint TAP 3→1 — the one
     remaining flag is the shared nav-logo anchor present on EVERY page (the
     accepted cross-page baseline, identical to projects).
  6. **A RICH NO-SPRINTS EMPTY STATE (S7)**: the sprint lane's empty state was a
     bare muted span — which was also permanently ENGLISH (its `lang === 'fa'`
     ternary compared the lang FUNCTION to a string: always false). Now a dashed
     card in the app's empty-state language: ◆ tile + title + one-line hint
     (sp.emptyHint, FA+EN) + a CTA that opens the SAME define popover as the
     toolbar's ◆ button (one code path — the 409 draft-exists handling included;
     openDefinePop is a named fn so the outside-click guard can't eat the CTA's
     opening tick).
  - Bumps: sprint-page.js v6→v7, devboard.css v9→v10 (20 shells), i18n-en/fa
    v21→v22 (+sp.emptyHint), i18n.js v77→v78 (injects fa v22), sw v344→v345,
    package 0.3.12.47.
  - Ladder: typecheck 0 · vitest 394/394 · NEW e2e sprint-ux.spec.ts 4/4 (FA
    render-time i18n on side-head + popover + form; finish compact/ghost/name-span/
    aria; strip ≥19px + chip ≥27px + no chip/clip overlap; empty state → CTA →
    define popover → draft panel round-trip; @390 timeline-above-side + no
    h-scroll) · full e2e 79/79 · mobile-audit (fa light+dark, 390, coarse): sprint
    docHScroll 0, TAP 3→1 (the shared baseline anchor), console errors 0 · live
    24-point browser probe FA/EN × light/dark × 1440/390 × coarse: all pass ·
    smoke ALL PASS · i18n 1079/1079 · cache-bust PASS · bundle +0.7% PASS ·
    node --check PASS.
  - S45 is COMPLETE (both crown surfaces overhauled). The storage/screenshots
    workstream stays owner-held-paused (B2 activation) per Agents.md.

### Context: Session 45 (v0.3.12.46 — THE CROWN-SURFACES OVERHAUL, batch A (projects) shipped: the stages home is a COMPACT RAIL + «فعالیت اخیر/Recently active» — the home finally shows real work; user-facing SORT (stage/recent/title); 390px filter reflow; FAB clearance; S44: the owner's three bug reports fixed at the root — (1) sparks: EVERY view gets the ⋯ edit/delete; (2) projects glance strip: the dead-click bug fixed — boxes filter IN PLACE; (3) sprint timeline: today's line gets ~10% leading pad + a «امروز/Today» flag chip; S43: FULL MOBILE RESPONSIVITY AUDIT + 200-control 40px touch floor; S42: dashboard stage-carousel handles OVER the strip; S41: Sparks MOBILE pass + folder EMOJI icons (0056); S40: Sparks page FULL AUDIT + TEXT ALIGNMENT (0055); S39: media GALLERY + screenshot pinning; S38: KV storage — never expires; S37: English-always chat rule)
- **(S45) CROWN SURFACES (owner, 2026-09-14: "improving UI/UX of sprints and projects
  page and functionality, as the most important aspect of hibana for me") — BATCH A:
  THE PROJECTS PAGE (owner: "Do batch A first.")** — grounded in a fresh-clone audit
  (live DOM geometry probes, not impressions; the S43 mobile-audit harness + 40px touch
  floor = the floor, not the ceiling; S44's in-place glance filter + today flag kept):
  1. **THE STAGES HOME FINALLY SHOWS WORK**: the home used to render six 169px-tall
     count-boxes (410×169 desktop; 537px of a 390px phone) and NOTHING else — zero
     actual projects on the projects page's home. The glance boxes are now a COMPACT
     INLINE RAIL everywhere — [icon · count · label] on one line, 44px tall (6-across
     desktop / 3 / 2-across phone; the strip above filtered lists and the home share
     ONE geometry now; click-to-filter, is-active/is-empty semantics, data-nav-local,
     per-stage tints ALL preserved — the S44 contract is pinned by tests). Under the
     rail: **«فعالیت اخیر / Recently active»** — the six most recently touched projects
     as flat hairline rows (stage badge + bidi-plaintext title + updated-ago), one tap
     → the project; derived from the already-fetched rows (zero extra queries). A
     zero-project home renders the capture empty state (listFragment) instead of a
     hollow rail; a grid+status load (the no-JS fallback) now renders that stage's
     CARDS below the rail — it used to be a rail-only dead end with no way to see the
     stage's projects.
  2. **SORT (the "never lose your place" job)**: `?sort=stage|recent|title` on
     GET /api/projects (zod enum; ORDER BY switch — recent = updated_at DESC, title =
     COLLATE NOCASE, absent/default = the historical order untouched) + a sort select
     in the filter form (i18n sort.*; ?sort= deep link wins, else the
     `hibana-projects-sort` localStorage pref rides — same pattern as the view pref;
     rides every htmx request; a sort change on the home flips to cards via the
     existing flipOutOfGrid so the control never reads dead). Saved filters keep
     status/tag/q/view semantics (sort is arrangement, not criterion).
  3. **390px FILTER REFLOW**: the search input used to collapse to a **48px sliver**
     beside two 44px selects. ≤640px the form is a grid: search gets its own
     full-width line; the three selects (status/tag/sort) share the row below.
  4. **FAB CLEARANCE**: the fixed FAB stack (projects + dashboard) sat ON the last row
     of content — `body:has(.fab-stack) main.shell` earns bottom padding ≤1140px (and
     a taller calc past the bottom-tab lift ≤1024px) so the final row scrolls clear.
  5. **CAUGHT LIVE BY MY OWN PROBE (the S43 ghost-track law, again)**:
     `.precent-list`'s implicit auto grid track sized rows to the nowrap title's
     max-content — 476px inside a 363px phone. `minmax(0,1fr)` fixes it; e2e-pinned.
     + the audit flagged the «همهٔ پروژه‌ها» row link at 21px (flex-blockified — the
     inline-link exemption can't save it) → 40px in the (pointer:coarse) layer.
  - Bumps: dashboard.css v8→v9 (20 shells), misc.css v6→v7 (21), layout.css v7→v8
    (23), components.css v2→v3 (23), i18n-en/fa v20→v21 (+4 sort.* keys each),
    i18n.js v76→v77 (injects fa v21), projects-page.js v2→v3, sw v343→v344,
    package 0.3.12.46.
  - Ladder: typecheck 0 · vitest 394/394 · NEW e2e projects-home.spec.ts 4/4 (rail
    ≤80px + recent-row navigation + recency-first; sort deep-link/select/persist/
    stage-default; @390 search full-width + no h-scroll + FAB clearance + contained
    rows; empty-account capture state) · full e2e 75/75 (projects.png visual baseline
    re-generated after the redesign) · mobile-audit: projects back to the pre-S45
    baseline class, doc h-scroll 0 in all sweeps · smoke ALL PASS · i18n 1078/1078 ·
    cache-bust PASS · bundle-size +0.7% PASS · node --check PASS · browser-verified
    6-sweep FA/EN × light/dark × 1440/390: console 0/page errors 0, glance in-place
    filter + toggle intact, sort round-trips, recent rows navigate.
  - NEXT (S45 batch B, not yet started): sprint.html — the timeline becomes the hero
    (strip 9px→~20px tall, mobile hierarchy flip: timeline first/categories below,
    finish-button redesign, Categories i18n root-fix, chips ≥40px touch, rich
    no-sprints empty state).

### Context: Session 44 (v0.3.12.45 — the owner's three bug reports fixed at the root — (1) sparks: EVERY view gets the ⋯ edit/delete (list rows / kanban cards / sticky notes used to render ideas with NO affordance) + open menus survive the 30s shelf poll; (2) projects glance strip: the dead-click bug (nav.js's capture-phase interceptor swallowed [data-pglance] clicks then same-URL no-op'd) — boxes now filter IN PLACE, + nav.js re-mounts pages on SAME-PAGE re-entry (language toggle / popstate kept landing unmounted on the default grid); (3) sprint timeline: today's line gets ~10% leading pad + a «امروز/Today» flag chip so the actual point is visible; S43: FULL MOBILE RESPONSIVITY AUDIT + 200-control 40px touch floor; S42: dashboard stage-carousel handles OVER the strip; S41: Sparks MOBILE pass + folder EMOJI icons (0056); S40: Sparks page FULL AUDIT + TEXT ALIGNMENT (0055); S39: media GALLERY + screenshot pinning; S38: KV storage — never expires; S37: English-always chat rule)
- **(S44) THREE OWNER BUG REPORTS, ROOT-CAUSED (user: sparks "there must be a way to
  delete/edit the folder ideas, for example clicking on this [⋯] on folders" /
  projects "when you click [the در حال انجام glance box] nothing happens, but it is
  supposed to show در حال انجام projects" / sprints "there must be some space and
  offset to todays timeline so you can see the actual point")** —
  1. **SPARKS — delete/edit in EVERY view**: the ⋯ menu injected into CARDS only;
     the list/kanban/sticky views of the SAME ideas had no edit/delete at all (the
     owner's "folder ideas" are browsed there). `injectSparksMenus()` now builds
     every view's host (table rows, `.kanban-card`, `.sticky-note`) with the SAME
     delegated menu (Move/Edit/Delete); kanban + sticky hosts carry `data-nav-local`
     because those cards are `[data-nav-url]` navigable — nav.js's capture
     interceptor now checks `data-nav-local` FIRST so the ⋯ opens the menu instead
     of dragging the card into navigation (the card body still opens the project).
  2. **SPARKS — menus that vanish mid-read**: the shelf's every-30s htmx poll
     innerHTML-swaps the whole shelf, DESTROYING any open ⋯ menu (or folder menu) —
     on a phone, tap → menu flashes → gone reads exactly as "clicking does nothing".
     `htmx:beforeSwap` now captures the open menu's id (spark card or folder), and
     the afterSwap reinjection re-OPENS it on the fresh DOM. The folder-grid ⋯ also
     reveals on `:focus-within` (keyboard parity with the hover/touch reveals).
  3. **PROJECTS — the glance-strip dead click**: nav.js's CAPTURE-phase link
     interceptor `stopPropagation()`'d the `[data-pglance]` click before the page's
     in-place filter handler could run, then `go()` same-SKIPPED on the byte-identical
     URL — a swallowed click, dead in both directions. The boxes now carry
     `data-nav-local` (navigator stands down; href stays as the no-JS fallback) and
     the handler dispatches a real bubbling `change` on the status select so the
     EXISTING filter machinery fires (flipOutOfGrid: grid → cards, the form's own
     hx-trigger request, saved-filter serialization). Verified against the owner's
     exact URL: on `?status=doing&view=cards`, clicking the doing box now clears
     the filter in place; from the stages grid it flips to cards + filters.
  4. **NAV.JS — same-page re-entry re-mounts (the structural find)**: navigating
     projects.html → projects.html?status=… (glance strip pre-fix, language toggle's
     `hibanaNav.reload()`, popstate) swapped the fresh shell but NEVER re-ran the
     page's own `-page.js` (it was "already present" in the document, and pages
     carry no inline defs) — the new shell sat UNMOUNTED: default grid, dead
     listeners, lost URL params. `load()` now re-EXECUTES the fetched page's
     `-page.js` scripts even when present (fresh <script> elements always run; regex
     matches both source `/js/x-page.js` and dist `/dist/x-page.<hash>.js` shapes;
     shared scripts stay missing-only — re-running alpine/nav.js would be
     catastrophic). `go()` no longer skips ?-only changes (a query change IS a
     navigation now); only byte-identical URLs no-op.
  5. **SPRINTS — today's point**: a sprint starting today (or any today-forward
     axis) rendered the today line FLUSH at the leading edge — clipped, unreadable
     as a point. The home axis now LEADS with `max(2, ~10% of the zoom window)` pad
     days (floor, not cap — sprint history still wins); the pad rides the px fit
     (`avail/(win+pad)`), so a data-free board still fills the port with ZERO
     horizontal scroll, and the future span keeps its full `win` days. The line
     carries a small `«امروز/Today»` flag chip (`db.today`, i18n 1073→1074) at its
     top — direction-blind centering via physical `left:0` + `translateX(-50%)`.
  - Bumps: nav.js v2→v3 (17 shells), sparks-page.js v4→v5, projects-page.js v1→v2,
    sprint-page.js v5→v6, quicknotes.css v5→v6 (22 shells), devboard.css v8→v9
    (20 shells), dashboard.css v7→v8, i18n-en.js v19→v20 + i18n-fa.js v19→v20
    (injected ref in i18n.js) + i18n.js v75→v76, sw v342→v343, package 0.3.12.45.
  - Ladder: typecheck 0 · vitest 394/394 · e2e 71/71 (4 new pins: projects-glance
    spec — in-place filter + toggle + the owner's exact ?status URL + same-page
    re-mount; sparks — every-view ⋯ + list-row delete + kanban menu-vs-navigate +
    poll survival; sprint — today-pad + flag + zero-scroll) · i18n 1074/1074 ·
    cache-bust PASS (10 files) · mobile-audit re-run: docHScroll NONE on every page,
    projects/sparks fully clean, sprint axis flags unchanged in class (intentional
    scroll strip) · browser-verified interactive FA/RTL desktop + 390px (glance
    filter 3 scenarios, folder rename + delete, list/kanban/sticky menus, today
    flag; console clean; VLM approval on the timeline renders).

- **(S43) FULL MOBILE RESPONSIVITY AUDIT (user: "there are lots of responsive
  problems in mobile. like button sizes. container out of box etc. audit the
  responsivity.")** — built `scripts/mobile-audit.mjs` (reusable): boots the Node
  server on a RICHLY seeded fresh DB (folders, sparks in every stage, dev tasks in
  all 5 boxes, sprints, sadhana quadrants, canvas + notebook elements, overdue
  tasks — empty pages hide layout bugs), then sweeps every page at 390px mobile in
  FA-RTL + EN-LTR, light + dark, measuring: document h-scroll, viewport overflows,
  container spills (children escaping card ancestors), touch targets < 40px,
  clipped controls, micro fonts. Findings → fixes, each root-caused live:
  1. **SETTINGS +107/+144px sideways (the "container out of box" on its worst day)**:
     `app.route('/', devboardRoutes)` registered devboard's JSON-only `GET /api/tags`
     BEFORE `app.route('/api/tags', tagsRoutes)` — Hono first-match SHADOWED the
     HX-aware handler, so settings.html's `hx-get` (expects chip HTML) received RAW
     JSON, and that unbreakable ~497px string dumped into `#taglist` overflowed the
     page (mobile Chrome then expanded the layout viewport → the whole page renders
     zoomed-out/shifted — caught by tracing `innerWidth` 390→497 between DCL and
     load). CONSOLIDATED: all tag CRUD now lives ONLY in tags.ts (the S30-batch-4
     label-manager semantics ported: rename-collision-merge, search_tags FTS
     rewrite, delete-unused-only 409), GET serves chips for HX + JSON for fetch with
     `Vary: HX-Request`, the chips carry delete buttons only on UNUSED tags, HX
     delete returns the refreshed chip row. `#taglist` also gains
     `overflow-wrap: anywhere` as a belt against any future unbreakable token.
     +2 vitest (tags-hx.test.ts: HX/JSON/Vary/delete-refresh/409) + an honest e2e
     (the old settings/reports pins passed VACUOUSLY on the empty seed — the seed now
     carries tags + long titles + history rows).
  2. **REPORTS +286/+272px**: `.feed`'s implicit grid track sized to the items'
     min-content = the nowrap `.feed-title` (a long project title measured 547px →
     li 625 → shell 676). `grid-template-columns: minmax(0, 1fr)` lets the li shrink
     and the title's own ellipsis work. Same ghost-track fix on
     **notifications** (+9, `.notif-list`).
  3. **PROJECT-DETAIL +37/+48px — the S35-documented "board bleed", finally dead**:
     the `pd-board-head` CTA row (اسپرینت جدید · برد تمام‌صفحه · اسپرینت‌ها) is a
     nowrap flex row whose ~396px min-content overflowed the 363px card. The row
     wraps ≤640px (buttons flex to share the line).
  4. **404 +87px**: the `.nf-stage::before` halo's `-8% -22%` inset extended ~87px
     past the viewport. `overflow: clip` on the stage (visual snapshot re-approved).
  5. **CANVAS +810px (the biggest, and the sneakiest)**: Fabric sizes its wrapper
     from the host's width/height ATTRIBUTES — the markup ships `<canvas width=1200
     height=800>` — while the CSS box is inset:0/100% of #canvas-wrap. On a 390px
     phone the wrapper was born 1200px, the document overflowed, and mobile Chrome's
     auto-fit EXPANDED the layout viewport — which poisons `window.innerWidth` (it
     reported 1200), so the resize listener then BAKED the poison in (1200×2501
     zoomed-out board, unfixable by reload). canvas.js now syncs the host attributes
     to the real layout box BEFORE construction and resizes via `sizeToWrap()` (the
     wrap's client box — the whiteboard's proven pattern; never `window.innerWidth`).
  6. **SPRINT chip spill** (stats text overflowing the chip by 87px): flex ellipsis
     needs min-width:0 + overflow:hidden on the ITEM (`.sp-sprint-chip > span`), not
     the container. **SADHANA subbar** buttons were flex-shrunk below their content
     (Archive label clipped) → `flex: none` (the strip already scrolls).
  7. **THE TOUCH FLOOR ("button sizes")**: a `(pointer: coarse)` layer in misc.css
     (loads after every page's own bundle) + a sadhana-board.css block (it loads
     last on its page): 200+ controls lifted to ≥40px min tap boxes on touch —
     prio-dot buttons (24), task ⋯ menus (28), filter chips (26 — S32's compact
     visual stays on desktop; the tap law wins on touch), db-add/pd-task-add (35),
     db-mini-chips (19), pd-tag-add, detail-tabs (35), selects/inputs/textareas,
     dashboard todo pens/styles/FABs/collapse (22-36), sadhana t-act/q-pen/zen/
     upd-toggle (20-24), settings ghost icon-btns (32), gallery state chips (27),
     canvas tb-more rows (26), theme-floater (28). Controls that already carry
     pseudo-element hit expanders (palette swatches, pw-toggle, skc-open, .ghost)
     were verified compliant and left untouched.
  - Audit output now: **every page clean of document h-scroll** in all 6 sweeps
    (fa/en × light/dark × 390); remaining flags are triaged-accepted (intentional
    in-page scroll strips, wide text links, design-language micro fonts).
  - Bumps: calendar.css v3→4, notifications.css v3→4, misc.css v5→6,
    project-header.css v10→11, devboard.css v7→8, sadhana-board.css v2→3,
    canvas.js v29→30 (all shells sed'd), sw v341→v342, package 0.3.12.44,
    `audit:mobile` + `probe:tags[:prod]` scripts (live-tags-probe 10/10 PASS on
    BOTH workers).
  - Ladder: typecheck 0 · vitest 394/394 (392+2) · e2e 67/67 (15 viewport pins —
    4 new: project-detail board, notifications+404, canvas viewport-born, settings
    chips-not-JSON; 404 visual snapshot re-baselined after the halo clip) · smoke
    ALL PASS · i18n 1073/1073 · cache-bust PASS · bundle-size +0.1% PASS ·
    node --check ×2 · browser-verified interactive FA 390px golden paths (settings
    tag delete refresh, prio-dot cycling at 40px, canvas wrap-sized board + 40px
    zoom rows, reports feed ellipsized, board chips 40px; console clean; VLM
    screenshot approval).

- **(S42) DASHBOARD STAGE-CAROUSEL: FULL-WIDTH STRIP + OVERLAY HANDLES (user: "this part
  is too compacted because of right left handles. expand this section. make handles over
  them." + a 390px phone screenshot of the projects-by-stage section)** — the owner's
  screenshot showed the dashboard's «پروژه‌ها بر اساس مرحله» carousel: the prev/next
  circular handles flanked the strip as FLEX COLUMNS (2rem + gap per side ≈ 80px of a
  342px section on a 390px phone), so every stage card rendered ~262px wide with
  ellipsized titles. The fix (CSS + a markup re-arrangement; app.js's paging driver is
  UNTOUCHED — all `data-stat-*` hooks preserved):
  1. **The strip spans the FULL section width** (was ~77%): the carousel is now a 2-row
     grid — `.stat-stage` (the position:relative anchor) carries the track at 100% of
     the section, the dots row sits below. **Gotcha caught live**: `.stat-stage` as a
     grid item needs `min-inline-size: 0` — with the auto minimum, the track's
     content-based max-content (~591px) sized the stage and overflowed the section
     sideways (document h-scroll 617px on a 390px viewport).
  2. **The handles float OVER the strip's edges** (the owner's literal ask): absolute,
     vertically centered on the track, 40px (coarse-pointer tap law; was 32px),
     translucent fill (`color-mix(var(--card) 78%)`) + 3px backdrop blur + soft shadow,
     slight gutter overhang (`inset-inline: -0.35rem`) so most of their footprint covers
     page padding, not card content. `inset-inline-*` keeps RTL/LTR placement right, and
     the existing `[dir='rtl'] .stat-arrow svg` flip still rides along.
  3. **Auto-hide at the ends**: the driver's `.at-start`/`.at-end` flags (toggled by
     syncStatCarousel on every scroll/swap) now fade the useless handle out entirely
     (`opacity: 0` + `pointer-events: none`) — a card edge is only covered while the
     handle is actually usable; `:focus-visible` still reveals it for keyboard users.
     A 1-page carousel renders with NO handles (quiet means invisible). The old
     `:disabled { opacity: .35 }` dim became redundant and was dropped.
  4. **Interaction safety**: the whole `.stat-kanban-card` is clickable (`data-nav-url`)
     so a handle covering the small `skc-open` edge button never blocks opening the
     project; native touch/wheel paging still works everywhere (the track is unchanged
     as a scroll-snap rail).
  - Bumps: `dashboard.css` v6→v7 (20 shells), `sw` v340→v341, package 0.3.12.43,
    `probe:carousel[:dev]` script (S41's D1 probe-user pattern; 9/9 PASS on both workers).
  - Tests: dashboard vitest structure pin updated (stat-stage + the overlay order
    track < prev < next) + NEW e2e in viewport.spec.ts (`dashboard @390: strip is
    full-width; handles overlay + auto-hide` — pins track ≥94% of the section, 40px
    absolute handles centered ±8px, at-start prev fade → returns after one page, at-end
    next fade; idempotent seeding + tour dismissal + direct-scroll end-paging to dodge
    hidden-handle actionability). Ladder: typecheck 0 · vitest 392/392 · e2e 63 (62+1
    contention flake per run, each passes isolated) · smoke ALL PASS · i18n 1073/1073 ·
    cache-bust PASS · bundle-size PASS (+0.0%) · browser-verified FA RTL 390px + dark +
    EN desktop 1440px (geometry probes + VLM screenshots; console clean).

- **(S41) SPARKS MOBILE + FOLDER EMOJI ICONS (user: "the ui need modification. not good in
  mobile. also doesnt show already made folders or adding a new folder, also users must be
  able to choose emojies for their folder ideas icon" + a 390px phone screenshot)** —
  diagnosed with the screenshot (VLM) + live geometry probes at 390px:
  1. **Mobile layout**: the folder grid rendered ONE full-width 363×125 card per row
     (auto-fill/minmax(11rem) misses the second column by ~2px — six full-width cards of
     scroll before the first idea) → **two-up at ≤480px**; the folder cards' ⋯ menu was
     hover-only (`opacity: 0` — invisible AND unreachable on touch; the S40 fix solved only
     the click-delegation half) → **always visible under `@media (hover: none)`**; folder
     chips were 29px tall (44px tap-target law) → **≥40px on coarse pointers**; the header
     row now **stacks at ≤640px** (h1 / capture-button flex-1 + compact view select
     side-by-side, «نمایش:» label goes sr-only). Kanban columns stack vertically at 390px
     (pre-existing, kept); no horizontal scroll anywhere (geometry-probed + e2e-pinned).
  2. **"Doesn't show already made folders"**: TWO real causes fixed. (a) The
     0-folders-0-ideas boot state (exactly the screenshot's account state) offered ONLY
     "capture an idea" — **no way to create the first folder at all**: the empty state now
     carries a second CTA (New folder → the folder dialog, riding the existing `data-sf-new`
     delegation). (b) Once a session entered ANY folder, **the folder grid was unreachable
     in-session** («همه» = the flat all-ideas list, where folder cards vanish): the bar now
     leads with a **«پوشه‌ها» home chip** (`data-sf=""` rides the existing delegation —
     clears the hidden input + the localStorage pref + refetches folder-less = the grid
     home). The owner's screenshot itself was a fresh/secondary account or a stale shell
     (verified: prod renders the folder grid for his 3-folder account — S40's live probe);
     if his phone still shows the old page, one hard refresh (the SW rotated to v340).
  3. **Folder EMOJI icons (the feature ask)** — migration **0056** (`spark_folders.icon TEXT
     NULL`, schema 54→55; the owner's message is the explicit written approval per rule 4):
     folders carry a user-picked emoji on **grid cards, bar chips, kanban column headers,
     the folder-empty state, and the move-to-folder dialog**; the create/rename dialog gets
     an emoji preview button → the **shared `/js/emoji-picker.js`** (1100+ emojis, search,
     recents — docks as a bottom sheet under 640px) + a **clear (✕)** action. PATCH
     semantics: `icon` undefined = unchanged, `null` = cleared, emoji = set — a rename that
     never opens the picker never touches the emoji. **Zod emoji-only regex**
     (Extended_Pictographic / flags / skin tones / subdivision tags / ZWJ / VS16 — plain
     text like `<script>` 400s; everything renders through `esc()` regardless).
  4. **THE TOP-LAYER BUG (e2e-caught, fixed in emoji-picker.js v3)**: a picker opened from
     inside a native `<dialog>` (showModal = the top layer) rendered BEHIND it — **no
     z-index can ever beat the top layer**, so the sheet was visible-but-unclickable (real
     pointer clicks landed on the dialog; my first manual pass used JS `.click()` which
     bypasses hit-testing and masked it — Playwright's actionability check exposed it).
     Fix: the picker **re-parents itself into the open dialog** (children ride its
     top-layer slot; `position: fixed` still resolves to the viewport — `dialog.dialog`
     has no transform/filter containing block; no dialog open → body, dashboard/sadhana
     unchanged) + Escape now `preventDefault()`s so the sheet closes ALONE (the dialog's
     cancel no longer double-fires) + a detached-root rebuild guard (sparks-page tears its
     dialogs down on unmount, taking re-parented nodes with them).
  - Bumps: sparks-page.js v3→4, emoji-picker.js v2→v3 (3 pages), dashboard.css v5→v6 (2
    pages), i18n-en/fa v18→19 (23 pages) + i18n.js v74→75 (injects i18n-fa.js?v=19), sw
    v339→**v340** (sparks.html SHELL rotate), package.json 0.3.12.42. +4 vitest (392),
    +3 e2e (62). Bundle baseline updated (intentional S39→S41 growth, was tripping the
    15% total gate).
- **(S40) THE SPARKS AUDIT (user: "do a full audit of the sparks page — I can't enter a folder
  which I made and add an idea there; also نمایش همه ایده‌ها shows nothing")** — diagnosed
  against the LIVE prod D1 first (the owner's real state: 3 folders, ALL EMPTY; 7 sparks, ALL
  unfiled — every folder click hit the dead branch). Four confirmed bugs, all fixed:
  1. **Empty folders were un-enterable (the P0)**: a folder view matching ZERO sparks fell
     into `projects.length === 0 → sparkFolderGrid` — the click re-rendered the file-manager
     grid, so a fresh folder "did nothing" and no capture context ever opened. Now ANY
     deliberate folder param (uuid / 'none' / 'all') always answers with the folder BAR + the
     scoped empty state (`sparkFolderEmptyHtml`: «این پوشه خالی است» / "This folder is empty"
     + the capture CTA that files into the open folder); only the no-param boot keeps the grid
     as home. Live-verified on prod via a D1 probe user replicating the owner's exact state.
  2. **«همهٔ ایده‌ها» "shows nothing"**: server + assets byte-verified identical to local and
     the folder=all fragment CORRECT on live — the report was the compounding of #1 (dead
     clicks) + #3/#4 (context loss). Fixed by making every click visibly land somewhere, and
     pinned by e2e (All = flat list, never silently back to the grid, zero-spark case
     included).
  3. **The grid ⋯ folder menu was unreachable — TWO layers**: the menu button sits INSIDE the
     `[data-sf]` card so `closest('[data-sf]')` shadowed it (every menu click = folder entry),
     AND `toggleSfMenu` only built menus for the BAR's `.sf-item` (grid cards never got one).
     Fixed: the delegated click checks `data-sf-new/menu/rename/delete` BEFORE `data-sf`, and
     the menu hosts both shapes (`.sf-item, .spark-folder-card` — the card was already
     `position: relative`).
  4. **Capture wiped the folder context**: every quick-add hard-reloaded `/sparks.html`
     (losing the open folder + scroll); the folder selection also died on any reload. Now:
     sparks-page installs `window.__hibanaShelfReload` (app.js calls it → soft shelf refresh,
     fallback = the old reload), the folder persists in localStorage
     (`hibana-sparks-folder` {id, name}), and sparks.html restores it SYNCHRONOUSLY via an
     inline stamp before htmx's first fetch (no grid→folder flash; mount re-applies as
     belt-and-suspenders). Deleting the open folder clears the pref (no ghost selection).
  5. **Kanban drops the folder bar**: an active folder filter was invisible in kanban view
     (cards "vanished" when dragged out of the filtered folder) — the bar now rides above the
     kanban whenever a folder param is present.
  Test debt paid: the page had ZERO functional e2e — new **e2e/sparks.spec.ts** (6 tests:
  grid render, empty-folder entry, grid ⋯ menu, capture-into-folder soft refresh + server
  truth, All-ideas, reload persistence) + 4 vitest regressions in sparks-folders.test.ts.
- **(S40) TEXT ALIGNMENT ON BOTH BOARDS (user: "add text alignment option to editor options in
  both whiteboard and canvas")** — migration **0055** (`canvas_elements.text_align TEXT`
  NULL; 'left' stores as NULL — legacy rows byte-identical; plain ADD COLUMN, both D1s
  applied + registered, bookmarks dev 000004c7 / prod 00000879, schema 53→54): three toolbar
  buttons (چپ‌چین/وسط‌چین/راست‌چین) in the canvas text-props cluster and the notebook toolbar —
  the default for NEW text boxes (localStorage per board), applied LIVE to the selected text
  object, persisted through objectToData → /api/canvas/sync (`text_align` in elementSchema,
  enum left/center/right) → makeObject loads it back. The notebook's align click mirrors the
  W3 save pattern (snapshot → save → undoable 'modify' commit); canvas uses persistActive.
  +1 vitest (sync round-trip incl. off-enum 400 + LWW clear-to-NULL) + 2 e2e (canvas: live
  realign + persist + reload + born-aligned new box; notebook: realign + persist + reload).
- Assets: sw hibana-v338→**v339**; app.js v173→174 (21 pages — the soft shelf-refresh),
  sparks-page.js v2→v3, canvas.js v28→29, whiteboard.js v24→25, i18n-en/fa v17→18 (+3 keys
  canvas.alignLeft/Center/Right, 1068→1071). sparks.html (inline restore script), canvas.html
  + whiteboard.html (align buttons) — SHELL re-fetch rides the SW bump. package.json
  0.3.12.40→0.3.12.41.
- Verified: typecheck 0 · vitest 388/388 · Playwright 59/59 (+8: 6 sparks + 2 alignment) ·
  smoke ALL PASS · i18n 1071/1071 · cache-bust PASS (44 files) · node --check × 4 ·
  browser-verified FA/RTL on the local server (empty-folder entry + inline-stamp boot + All
  list + grid ⋯ menu + live realign round-trips on BOTH boards incl. the server record) ·
  deployed dev 04a101db + prod 7f4a1ae4, 0055 on both D1s, live probes: health ok schema 54
  storage kv, the empty-folder fragment carries data-spark-empty="folder" + sf-bar on PROD,
  sw v339 + the hashed sparks-page grep-verified live. Probe user purged (parity users 5).

- **(S39) THE MEDIA GALLERY (user: "an archive gallery of pics, similar to wordpress, so the
  user can delete the unneeded files to make up more space")** — `/gallery.html` (nav: user
  menu + mobile sheet, «نگارخانه»/Gallery) + `GET /api/media`: EVERY picture the user owns
  across projects in one grid — thumbnail + note + project chip (deep-link) + pin chip (which
  box + which item) + open/fixed state + date + exact size; filters (All / Open problems /
  Fixed / Pinned + per-project dropdown); a space meter (`{n} pictures · ≈{m}`, summing the
  0054 `bytes` column — legacy rows self-heal their size on first view via the media-file
  route); zoom lightbox; delete (confirm) = the ONLY removal path, the S38 never-expire law.
- **(S39) NOTE CARDS + PINNING (user: "you can't add note card on that screenshot; you must
  be able to stick that screenshot to progress box items — a UI bug screenshot sticky to
  Problems box, so there is note + picture proof, and how it's categorized in the
  project")** — migration **0054** (`screenshots.task_id` FK dev_tasks ON DELETE SET NULL +
  `screenshots.bytes` + `idx_screenshots_task`): the note is now **CLICK-TO-EDIT** (the
  whole note area is a `role=button` — the tiny pencil alone read as "can't add a note");
  every shot carries a pin button → a grouped task picker (the five boxes in board order,
  search box, current pin ✓, unpin row) → PATCH `{taskId}`; the shot card grows the **pin
  line** («Problems · task title» — note + picture proof + categorization); the board task
  cards AND the Problems-tab rows grow a **📌 N badge** → a pinned-pictures dialog (zoom +
  unpin); unpin detaches, never deletes. Deleting the TASK detaches the shot (SET NULL) —
  the picture survives. Project hard-delete + the 7-day purge now clean the remote KV/S3/
  GitHub bytes through the shared `services/shotstore.ts` (same kv→r2→github precedence)
  — before S39 those paths orphaned the bytes forever (invisible space leaks).
- **(S39) verification**: typecheck 0 · vitest 383/383 (+4 media-gallery: pin/unpin/foreign
  task rejection/scoping/bytes/self-heal) · e2e 51/51 (+2 media-gallery.spec.ts: the full
  note→pin→badge→dialog→unpin flow + the gallery filters/meter/delete) · smoke · i18n
  1068/1068 · cache-bust · bundle-size · prod-errors · shotcheck 9/9 × local+dev+prod.
  Browser-verified (local, real KV): upload through the file picker → byte-identical
  round-trip + canvas pixel read → note click-to-edit (FA+EN) → pin picker (FA labels,
  Persian-digit badge «۱») → pin line + badges → dialog zoom (e2e-caught bubbling bug:
  the zoom click bubbled to the document handler which closed the lightbox in the same
  event — fixed with stopPropagation + close-dialog-first; the modal <dialog> sits in the
  top layer ABOVE any z-index, so the lightbox must open after the dialog closes) →
  unpin (picture survives) → gallery stats/pin chip/filters/delete → 390px FA dark RTL
  (two e2e/browser-caught CSS bugs: the actions row bled the delete button ~32px into the
  neighbor card — now wraps; the gal-chips row refused to shrink under max-content —
  min-inline-size 0) + VLM-confirmed layouts. Deployed: dev 2ba2b530 + prod 1f0501f4,
  0054 applied + registered on both D1s (bookmarks dev 000004c3 / prod 00000873),
  sw hibana-v337→v338, schema 52→53, live probes + gallery + new JS grep-verified on both.
- **(S38) THE PICK + THE IMPLEMENTATION (user: "which free alternative to R2 do you suggest —
  implement it, test it: upload in hibana, check they're really uploaded and shown, and make
  sure pictures never expire unless the user deletes them")** — **Cloudflare Workers KV**.
  Why not B2 (the S36 pick): B2 stays the best 10 GB option but needs the owner's signup
  (email verification an agent can't do) — it failed "implement AND test it today". KV was
  provisioned in ONE command on the existing account (`wrangler kv namespace create
  HIBANA_SHOTS`, dev `7c6eb81b…` + prod `1a64052f…`) — **zero signup, zero card** (R2 is
  card-gated; KV is not). Free tier: 1 GB storage (≈5,000+ shots at the 5 MB upload cap),
  100k reads / 1k writes / day, values ≤ 25 MB. **The never-expire guarantee**: KV keys
  written WITHOUT `expirationTtl` have NO expiry — the adapter (`src/services/kv.ts`)
  never passes one (unit-pinned: `puts[0].options` must be undefined), so the ONLY removal
  path is the app's own DELETE. One `ObjectStore` contract, two transports: the Worker uses
  the `HIBANA_SHOTS` **binding** (no credential lives inside the Worker at all); the Node
  self-host / scripts use the **KV REST API** (env `KV_ACCOUNT_ID` / `KV_NAMESPACE_ID` /
  `KV_API_TOKEN`, in .secrets.env for local dev). Storage precedence: **kv → r2 → github**
  (`routes/core.ts`); `/api/health` now reports `"storage":"kv|s3|github"` so any probe can
  see the wiring. wrangler.toml binds both envs (separate namespaces — prod bytes never mix
  with dev probes). The B2/S3 upgrade path is untouched: set R2_* and it wins only if KV is
  unbound.
- **(S38) THE TEST SERIES (all green — the user's exact requested flow)**
  1. `src/tests/kv-storage.test.ts` (10 tests): binding-mode put/get/delete + **the
     no-options assertion (never-expire pin)**; REST-mode request shape (bearer, percent-
     encoded key with slashes, raw bytes, 404-idempotent delete); env parsing.
  2. `scripts/live-shot-check.mjs` (`npm run shotcheck:local|:dev|:prod`) — a REUSABLE
     live round-trip: probe user + session via the D1-discipline-compliant write path
     (wrangler `--file` for writes, `--command` for reads — wrangler's `--json` with
     `--file` returns execution SUMMARIES, not rows; gotcha hit live and handled), then
     health(storage=kv) → create project → upload PNG through the app's own route →
     media GET (same bytes, image/png) → **direct Cloudflare KV REST read of the same key
     (byte-identical — "really uploaded", bypassing the app)** → DELETE via the app →
     media 404 + KV 404 → probe purge + users row-count parity. **9/9 PASS on all three
     targets: local Node (REST path), live dev worker, live PROD worker (binding path).**
  3. Browser-level (agent-browser, real UI on local 8788 AND on the live dev worker):
     upload via the actual file picker → card renders → canvas pixel read = **[124,58,237]
     exactly** (the purple test PNG's bytes served from KV through the media route) →
     lightbox open/close → note edit (EN+FA mixed, `dir="auto"`) → resolved toggle
     ("✓ fixed") → delete with confirm → 0 cards. VLM confirmed the purple image renders
     on both; console clean. Restart proof: upload → full server kill + reboot → same
     bytes served (persistence ≠ process; KV + SQLite only).
  4. Gotchas hit: (a) Node fetch resolves `localhost` → ::1 while the node-server binds
     IPv4 — script uses 127.0.0.1; (b) sandbox reaps plain background children — the
     local server must be double-forked `( setsid … & )` to reparent to init; (c) a
     hand-rolled test PNG had 1-pixel rows (decoded IHDR fine, painted nothing) — the
     pipeline was byte-exact all along, the test image was broken; fixed.
  5. Ladder: typecheck 0 · vitest 379/379 (+10 kv-storage; health key-set test updated for
     `storage`) · e2e 49/49 · smoke ALL PASS · i18n 1039/1039 · cache-bust PASS ·
     bundle-size PASS. Deployed dev `ea468579` + prod `c1e512d4`; live probes: health ok,
     `storage:kv` on BOTH. No frontend files touched → no cache-bust bump, SW stays v337.

- **(S37 · doc-only · 2026-09-13) "ENGLISH ALWAYS" RULE IN AGENTS.MD** — Ali asked: "Always
  speak english with me, add this to agents.md so you never forget." Codified in TWO places
  in `Agents.md`: (1) a bold callout in the file header: "Agent↔owner language: English,
  always. All chat, summaries, and explanations to Ali are in English — even if his message
  is Persian. App UI copy stays FA+EN per the i18n rules below. (Added at Ali's request,
  2026-09-13 — never revert.)"; (2) the FIRST bullet of Workflow rules: "Language: English
  with Ali. Always. Regardless of the app's FA UI or the language he writes in, the agent's
  replies are English. FA/EN applies to in-app copy only." No app code, no bundle, no
  deploy, no cache-bust, no version bump (markdown isn't shipped) — commit only.
- **(a) THE QUESTION (user, 2026-09-13: "for now i can't buy R2 from cloudflare. what are
  free alternatives")** — research-verified (web-search, sources below): **R2's free tier
  itself is card-gated** — Cloudflare requires a valid payment method on the account
  before R2 can be enabled at all (community.cloudflare.com + stackoverflow corroborate;
  the marketing "no credit card required" refers to Cloudflare signup, not R2 activation).
  The no-card alternatives: **Backblaze B2** — 10 GB free FOREVER, S3-compatible API,
  signup page literally says "No credit card required" (backblaze.com/sign-up/cloud-storage
  + their own blog) — THE pick, it speaks the same S3 REST+SigV4 dialect the S35 adapter
  already implements; **Supabase Storage** — 1 GB / 5 GB egress free, no card, but REST
  not S3 (needs its own adapter — offered, not built); **Cloudinary** — ~25 credits/month
  (1 credit ≈ 1 GB storage OR bandwidth), no card, image CDN with transformations (also
  needs its own adapter). DEPRECATED ADVICE: Storj's old 25 GB free tier was discontinued
  Feb 2024 (forum announcement) — don't trust old posts recommending it. Imgur is free but
  PUBLIC (no private uploads — wrong for unreleased-UI bug shots). Oracle Cloud 20 GB free
  S3 needs a card for signup verification. **Meanwhile: screenshots ALREADY run free with
  zero signup** — R2_* unset keeps the GitHub Contents API path (the private
  assadigit/hibana-safe repo; 100 MB/file, 5 k req/h — ample for bug shots).
- **(b) THE GENERALIZATION (B2 works through the existing adapter — 4 env vars, no code)** —
  `src/services/r2.ts`: `R2Config.region` joins the config and flows into the **SigV4
  credential scope** (the one R2-specific assumption left — R2 answers to region 'auto',
  B2 validates the scope against its endpoint `s3.<region>.backblazeb2.com`, generic S3
  wants e.g. 'us-east-1'). Source: env `R2_REGION` (or `S3_REGION` alias) → else
  **auto-derived from the endpoint host** (`*.r2.cloudflarestorage.com` → 'auto';
  `s3.<region>.backblazeb2.com` → that region; anything else → 'us-east-1') → else 'auto'
  for backward compat with hand-built `R2Config`s. Env type + `r2ConfigFromEnv` extended;
  `Env.R2_REGION` documented in types.ts. Switching prod to B2 = create the bucket + app
  key, then `wrangler secret put` R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET /
  R2_ENDPOINT (the s3.<region>.backblazeb2.com URL) — **nothing else changes** (the
  github_path column stays the storage key; unset = GitHub path exactly as before).
- **(c) CACHE-BUST GATE CAUGHT A LATENT INCONSISTENCY (fixed)** — the sandbox's file-mode
  noise makes git report all public/js as "modified", which flipped check-cache-bust from
  its usual skip to a real scan — and it found `board-page.js` line 550 dynamically
  injecting `chip-render.js?v=1` while board.html/project.html carry `?v=2` (two cache
  entries for one file; the v=1 URL could serve stale bytes on the local-dev path — prod
  dist wiring rewrites the literal to a content-hashed URL so prod was never exposed).
  Fixed: literal aligned to v=2 + board-page.js bumped v7→8 (board.html) + sw v336→v337.
- **(d) PRE-EXISTING TEST-FILE TYPE ERRORS FIXED (typecheck honestly 0 again)** — the S35
  tree carried 4 tsc errors (verified pre-existing by swapping in the HEAD test file):
  `Db` imported from types.ts but not re-exported (now `export type { Db }`), `Headers.entries()`
  missing (tsconfig lib + `DOM.Iterable`), a re-typed `rows` reassignment in
  screenshot-problems (own variable now). S35's "typecheck 0" ladder line was optimistic.
- Bumps: board-page.js v7→8 (board.html), sw hibana-v336→v337, package.json 0.3.12.38.
  No i18n keys touched (1039/1039 parity holds).
- Tests: +3 vitest (r2-storage: region derivation from endpoint host / explicit override /
  region flows into the SigV4 scope) — 369 total. Ladder: typecheck 0 · 369 vitest · 49
  e2e (full re-run after `npx playwright install chromium` — fresh-sandbox browser cache
  was empty) · smoke ALL PASS · i18n 1039/1039 · cache-bust PASS (now robust to the
  mode-noise) · live SigV4 round-trip vs mini-services/shot-store with a B2-style region
  override (PUT/GET 70 B/DELETE/GET-404).
- Not built (offered): a Supabase-Storage or Cloudinary adapter — both need non-S3 code;
  say the word and it's a session's work. Neither is needed while GitHub carries the
  shots for free.


<!-- S49 consolidation: session details for S7–S35 (v0.3.12.21–.37, ~1,560 lines)
     were removed here — recover verbatim via `git show 2af4c27e:Changelogs.md`.
     Kept: S44→S48p as recent context (§1), the compact session index + era
     timeline (§2/§3), and the operational sections (§4–§9). -->

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
