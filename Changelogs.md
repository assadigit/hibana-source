# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.30.0 — Session 92, 2026-09-20. THE OWNER'S IDEA-ITEM NAVIGATION FIX — clicking an idea in the rail panel now opens THE IDEA ITSELF). (1) THE SPARKS-PANEL DEEP LINK (owner, screenshot fedf.png: "when clicking on idea items, it must show ideas themselves, currently it shows their folder"): renderRailSparks() in nav.js linked EVERY idea row to the bare /sparks.html — the Ideas shelf — so the row you tapped dissolved into the folder grid behind it (the screenshot's exact state: a CONTENT CREATION idea selected in the panel, the page behind showing the folder view instead of the idea). Every row — unfiled AND folder-filed — now deep-links to /project.html?id=<sparkId> (sparkHref(), encodeURIComponent), the spark's OWN page and the exact destination a spark-card click already uses on the Ideas page itself (the grid title's plain <a href> + the kanban/sticky cards' data-nav-url, helpers.ts) — mirroring the Notes panel's #n=<id> and the Projects panel's ?id= rows; the S88 panel-persistence contract survives the soft navigation (panel open, e2e-pinned). Hrefs are locale-independent — zero i18n churn; /api/rail already shipped sparks.id. LADDER: node --check nav.js · check-cache-bust PASS (nav v12→v13 across all 16 HTML pages) · vitest 506/506 · eslint src/ 0 errors (163 baseline warnings) · typecheck 0 · build 77 entries (nav.ec26eb81.js) · playwright FULL SUITE 159/159 — rail-panel.spec grows 10→11 with the S92 regression test (the Ideas-panel row's href matches ^/project\.html\?id=.+, the click lands on the idea's own #pd-title, the panel stays open). agent-browser QA on the seeded local :3017, ZERO console errors: the unfiled spark ('Rail project 2') AND the folder-filed spark ('e2e filed spark' under 'e2e filled folder' — the owner's exact scenario class) both open their own pages (h1 = the idea's title), VLM-verified on the captured screenshot. SHIPPED + VERIFIED: commit 676c455 pushed → CI green → CD 35528880392 FULL deploy STEP-LIST-VERIFIED (guard → build+wire → DEV → probe → PROD → probe → purge_everything → restore → tree clean). Live probes green (health prod schema 58 kv; the served bundle dist/nav.830b5ee5.js carries the minified sparkHref deep-link). OWNER-ACCOUNT preview-only (ZERO writes; storage cleared + logged out after): his LIVE Ideas panel (بی‌پوشه ۸ | Content Creation ۹ | AI ۱ — the screenshot's own folders and counts) deep-links every row; clicking a Content Creation idea opened the idea's OWN page (h1 «ایده پادکست: اتفاقی که باعث تغییر قوانین در دنیا شدند…», /project.html?id=fd05c278…), the panel persisted, zero console errors, VLM-verified on the captured screenshot.

## 1-prev. (v0.3.29.0 — Session 91, 2026-09-20. THE OWNER'S SIX-ITEM PANEL/RTL POLISH ROUND — low-key dots, the A/--B hierarchy indent, pale group heads, the RTL FAB flip, the account-menu dedup, Farsi digits). (1) LOW-KEY STATUS DOTS (owner: "the bullet point of items in sidebar are too saturated"): the rail-panel .rail-dot washes dropped the full-badge inks for 40% color-mix translucency — every status hue survives as a pale tint (pale amber spark, pale teal doing…) and the hover row bg is again the strongest signal on the row; works in claude-dark off the same tokens. (2) THE HIERARCHY INDENT (owner's "A / --B" sketch): .rail-group-body pulls in 0.8rem margin + 0.55rem padding from the head's edge with a 1px tree-guide rail (color-mix 26% --muted — theme-aware; a first draft used --line 65% which vanished on claude-dark's near-black) — items sit ~23px inside their group head, the folder/quadrant hierarchy reads at a glance, LOGICAL properties mirror in RTL (the first draft's physical padding shorthand silently halved the RTL indent — caught by agent-browser measurement, fixed with padding-block/padding-inline-start). (3) PALE GROUP HEADS (owner: "add a pale background for headings of sidebar, I mean this: rail group head"): .rail-group-head wears var(--bg-soft) at rest (#F2F0EA / #1f1e1c claude-dark) — the heading rows now read as section chips, hover steps to the accent-soft wash, and the inter-group rhythm opened 0.25→0.4rem. (4) THE RTL FAB FLIP (owner: "in RTL the + button collides for vertical navigation; the + circle should be on the opposite direction"): [dir='rtl'] .fab-stack now flips to the PHYSICAL bottom-left corner — the 2026-08-30 "physical bottom-right in both directions" rule predates S88's vertical rail, which mirrors to the RIGHT edge in RTL and sat exactly under the +; the menu anchoring rides the stack's default align-items:flex-end whose cross-end IS the left edge under dir=rtl (the old flex-start override that pinned the menu right is removed), LTR unchanged. (5) THE ACCOUNT-MENU DEDUP (owner: "remove settings from user profile sliding menu, because it has dedicated icon right now on navbar"): the Settings row left the avatar popover (partial v162) — the rail's dedicated Settings icon owns the destination; mobile's More sheet KEEPS its Settings row (≤1024px there is no rail, the sheet is the one place it stays reachable). (6) FARSI GROUP COUNTS (owner: "the rail head group numbers in rtl (farsi) must have farsi digits"): railFaDig() in nav.js renders the .rail-group-count through the ۰۱۲۳۴۵۶۷۸۹ map when hibanaI18n.lang()==='fa' (the same "digits match the script" rule as reports/whiteboard), evaluated per render so a language toggle re-renders honestly. LADDER: node --check nav.js · vitest 506/506 · eslint src/ 0 errors (163 baseline) · build --prod 77 entries · cache-bust 4 files (layout v27, rtl v4, components v4, nav v12 — check-cache-bust PASS) · i18n parity unchanged (no key churn) · playwright rail-panel 10/10 + screenshots 4/4 (visual baselines UNTOUCHED — the panel is closed in both baseline shots, zero pixel drift) + s86-round 5/5 (after recreating the stale /tmp e2e DB that predated 0059's filename column). agent-browser QA on the seeded local : the EN projects panel (pale heads rgb(242,240,234), items +22.6px indent, dot color-mix 40% alpha, count "20"), FA/RTL (counts ۲۰ ۱۵ ۵, rail right edge, FAB bottom-LEFT at x=24 with zero rail intersection, account menu without تنظیمات), claude-dark (head #1f1e1c, dot 40% wash) — the tree guide pixel-verified in BOTH themes (VLM cannot see 1px lines; column-scan found the guide at x=119 light / x=1194 dark with 61-72 hits), VLM-verified on 4 screenshots (EN panel, FA RTL, claude-dark, final EN).


## 2. Session index
| Session | Date | Outcome |
|---|---|---|
| 92 | 2026-09-20 | v0.3.30.0 — the owner's idea-item navigation fix (screenshot fedf.png): rail-panel idea rows deep-link to /project.html?id=<sparkId> (the idea's OWN page, the spark-card destination) instead of the bare /sparks.html folder shelf — unfiled AND folder-filed rows, both e2e-pinned (rail-panel.spec 11 tests) + agent-browser/VLM verified. Full suite 159/159. Shipped 676c455 → CD 35528880392 full deploy; live-verified on the owner's own folders (Content Creation idea → its own page) |
| 91 | 2026-09-20 | v0.3.29.0 — the owner's six-item panel/RTL polish: low-key 40% status dots + the A/--B hierarchy indent with a theme-aware tree guide + pale bg-soft group heads + the RTL FAB flipped to physical bottom-left (the rail owns the right) + Settings out of the account menu (the rail icon owns it; mobile's More sheet keeps it) + Farsi digits for group counts (railFaDig). 506 tests, 14 e2e, no baseline drift |
| 90 | 2026-09-20 | (ops, no bump) MIGRATION 0058 APPLIED to dev+prod (owner round; skipped during S86): email_log's kind CHECK widened to the full vocabulary (+test, +backup_failed) + idx_email_log_status_sent restored (lost since 0041's rebuild). Full safety ritual: Time-Travel bookmarks (§9), datetime-named SQL dumps of BOTH DBs archived to hibana-safe `backups/dumps/pre-0058/` (md5 round-trip-verified from GitHub — new tool scripts/d1-archive-dump.mjs), byte-level digests before/after, R1–R4 verifier. DEV: 67/67 tables byte-identical, 4 email_log rows IDENTICAL. PROD: 65/67 byte-identical; users digest delta = the owner's own live last_seen_at (row-level diff proven, same S86 pattern); 1 email_log row IDENTICAL. /api/health schema 58 both DBs, live probes green |
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
| 88 | 2026-09-20 | v0.3.27.0 — the owner's ten-item plan: vertical icon rail + VS Code side panel (GET /api/rail), live code chips/panels in the notes editor + tokenized .md-code copy buttons, 12px task headings + pastel column headers + tightened bullet gaps, editor left-rhythm ~15px, wand popover anchored to its trigger icon, EN→FA translate-slop guard. 506 tests, 154 e2e, i18n 1395/1395 |
| 87 | 2026-09-20 | v0.3.26.0 — theme consolidation: light + claude-dark ONLY (the old dark retired at every layer; deterministic + pre-painted; legacy 'dark' migrates) |
| 86 | 2026-09-20 | v0.3.25.0 — Ask-AI panel, claude-dark theme, 14px headings + previews, Upload files (PDF/CSV/XLSX/DOCX/MD/TXT), notes emoji + drag-reorder (0059 applied to both D1s with the bookmark/dump/digest ritual) |
| 85 | 2026-09-20 | v0.3.24.0 — owner redesign round: the resume merge ("Continue where you left off", one last-OPENED timestamp everywhere, hero + stage badge), the shared board-column header (icon+label+pill on BOTH boards), and the fixed pastel role palette across dashboard chips (sig/Today/hero badge/board pills) — v0.3.24.0 |
| 84 | 2026-09-19/20 | v0.3.23.0 — owner follow-up: the notes.html reveal gate (the veil waits for the vault's first REAL paint — data, not DOMContentLoaded; watchdog widened to dropped stylesheets; parse-time bootstrap preload; pure-CSS 20s never-trap escape) + the S84 live checkboxes IN the editing surface (mirror-measured pretty controls over the raw markers, caret-reveal, Enter continuation; the grid-cell stacking fix) + the widened task grammar (bare [ ] lines, + bullets) with excerpt stripping. 486 tests, 139 e2e, i18n 1355/1355 |
| 83 | 2026-09-19/20 | v0.3.22.0 — owner round #2: notes.html first-load ROOT CAUSE (inline boot watchdog + honest load-failed state), EMPTY minimalist quadrant, Note Editor checklist (interactive `- [ ]`), Notion-style code styling, project-screenshot lightbox (3 stacked bugs: top-layer mount, same-tick guard, Esc layering). 484 tests, 134 e2e, i18n 1355/1355 |

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
Live D1s run 0001–0059 (schema 58 — both dev and prod, 2026-09-20; 0058 was applied OUT OF
ORDER, after 0059, in the S90 owner round — `d1_migrations` on both DBs lists 0057 then 0059
then 0058 chronologically; ordering there is bookkeeping only, both schemas are complete).
The reconstructed 0031–0039 exist for fresh environments; their `d1_migrations` bookkeeping
rows were never backfilled — **never blindly `wrangler d1 migrations apply` against live DBs**
(it would re-run table rebuilds; wrangler's own lister also mismatches the tracker's
no-`.sql`-suffix names, so it shows already-applied migrations as pending). Apply ONE
migration at a time with `node scripts/d1-migrate.mjs --db <pm-app-dev|pm-app-prod> --name
<0058_email_log_kinds>` after the bookmark ritual (`npm run bookmark:dev` / `bookmark:prod`).
Backfill once to make future applies a clean no-op:
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
- S70 update: fabric.min.js (292KB raw) OUT of the SHELL precache — SHELL → ~1.87MB.
- S80 update (measured, the last named candidate of this class): **i18n-fa.js out of the
  install-time MANIFEST precache** (436.1KB raw / 74.2KB gz) — FA-only (ensureFaDict
  never fires for EN users). Measured on the current build (gzipSync per bundle; SHELL
  route entries fetched from the local server — those measure decompressed, so the
  SHELL gz slice is slightly overcounted; the dist delta is exact): manifest dist
  1449.7 → 1375.5KB gz, install total ≈1537 → ≈1463KB gz (−4.8%; raw −436.1KB).
  sw.js v402 filters the one manifest key; Class 1a caches it on the first FA page
  view (verified live in a fresh profile: 67 dist bundles at install, hasI18nFa=false;
  FA login → the dict lands in the runtime cache and the page renders FA). The offline
  EN→FA-before-any-online-FA-load degradation is the same accepted contract as the
  Vazir fonts (EN copy fallback via t()).
- §10-D candidates now EXHAUSTED; remaining install weight is the app's real surface
  (68-page bundles all reachable offline-first after first visit).

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
| 2026-09-20T02:21:44.427Z | pm-app-prod | 56 | 00000b5b-00000000-000050ec-df4b050c8419ce1f5451524e78ab744c | pre-0059 (S86 vault icons/reorder/files) — deployed code requires the columns |
| 2026-09-20T02:31:35.911Z | pm-app-dev | 56 | 000006a9-00000000-000050ec-da98214a7b04f06b10a384eb0e5fa548 | pre-0059 (S86 vault icons/reorder/files) |
| 2026-09-20T15:39:35.325Z | pm-app-dev | 57 | 000006ce-00000000-000050ec-621c61230ec7da7d7b7f6ae87bcad456 | pre-0058 email_log rebuild (dev) |
| 2026-09-20T15:39:43.024Z | pm-app-prod | 57 | 00000ba2-00000004-000050ec-ec7906295b93e0d89c29b5189e2930bc | pre-0058 email_log rebuild (prod) |
