# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.38.0 — Sessions 97–100 RE-IMPLEMENTED after the second sandbox reset, 2026-09-21. THE FLAT-CARD SYSTEM + THE DEEP-LINK ARRIVAL LANGUAGE — depth reads from hairlines alone, and every navigation surface lands ON the work). PROVENANCE: sessions 97 (flat cards + RTL fixes + quadrant deep-links + tree fold, v0.3.35.0), 98 (quadrant goto chips + panel scrollbar, v0.3.36.0), 99 (Coming-up deep-links + the column arrival cue, v0.3.37.0) and 100 (client-task deep-links + tab flash + more-link chip, v0.3.38.0) each shipped as separate cron rounds with LOCAL-ONLY commits (6bb189a + c0a0002 + 06bd1fd + e2c561e) awaiting a credentialed push — the sandbox was RESET before one arrived and ALL FOUR DIED; this round re-implemented the full stack from the sandbox worklog record in ONE commit at the final state (the S97-r precedent, now proven twice). The live site served S96 throughout (schema 59, verified healthy). DIVERGENCES from the lost originals (all documented): one commit instead of four; the fold button additionally re-syncs on individual group toggles (the record pinned render + month-step syncs — the addition keeps the label honest when a manual toggle completes a full fold); the overflow-link tooltip wording was chosen fresh ("Open this box on the board"/«این جعبه را در برد باز کن» — the original string was unrecoverable, same as S97-r). (1) THE FLAT CARD SYSTEM (S97): notifications.css's global .card gradient retired to SOLID var(--card) (position:relative kept — the kanban ::before bars anchor to it); claude-dark's .dash-todo-quadrant + .reports/#report-body .card "one-step-elevated" gradient caps flattened to var(--card) (the line-strong top borders keep them one quiet step up). QA-verified: 0 background-image gradients on every .card surface, BOTH themes. (2) THE PRIORITY SURFACES (S97): the Notes-Vault banner + the resume hero wear a SOLID 8% accent veil + the 4px lead bar (gradients + elevation shadows retired); the resume strip is a PLAIN card (its old 5%-gradient was already cascade-dead in light — now honestly solid). THE CASCADE TRAPS, both caught + fixed in the original round and faithfully re-solved: (a) the banner carries class="card", so the fill lives on the compound .dash-vault-banner.card (0,2,0) — the flattened .card (0,1,0, later sheet) would otherwise swallow it (the notebook precedent); (b) the compound selector outranks main.shell-dash > section (0,1,1), which ACTIVATED the banner's long-dead margin-block-end:2rem and shrank the section gap from the shared 2.9rem rhythm to 2rem (−14.4px; the visual baseline caught it 1178→1164) — the margin is REMOVED (the section rhythm owns the spacing; doc height byte-restored, zero baseline drift this round). Dark: claude-dark's .card (0,2,1) would flatten the fill — the banner carries its own dark twin (13% over the near-black card, the notebook's one-notch-stronger lesson; QA: rgb(55,41,36) = exactly 13% #D97757 over #1F1E1D). (3) THE RTL BUGS (S97): the board's .overdue-dl + .is-pinned + .pin-badge spoke PHYSICAL edges — border-left/margin-left sat on the trailing side under dir=rtl, and the overdue to-right gradient leaned the wrong way. Now border-inline-start/margin-inline-start (mirror honestly) + a DIRECTION-FREE solid 8% red veil color-mixed into --surface2. QA-verified computed: rtl → the 3px pin bar renders on the RIGHT edge, background-image none. (4) THE QUADRANT DEEP-LINKS (S97): the dashboard to-do widget's over-cap "+N more" link lands ON THE QUADRANT it overflows (/to-do-list#Q<id>) instead of the board top; sadhana-page.js's init() consumes the hash — the phone carousel advances to the quadrant's slide (goToQuad), desktop scrolls it into view (.quadrant scroll-margin-block-start 4.5rem) — and the target wears .q-arrived: the accent border + a 1.6s qArrived ring flash (reduced-motion collapses to the frame alone). /to-do-list is a HARD page, so every arrival runs init fresh. (5) THE TREE FOLD (S97): the panel head gains a [data-rail-tree] button (the .rail-panel-close recipe — quiet 2rem icon, muted ink, bg-soft hover, brand focus ring) that collapses/expands EVERY .rail-group in one tap (incl. the nested stage → project → box sub-groups), every head's aria-expanded following; syncRailTreeBtn mirrors the tree's state — all-collapsed → "Expand all" + an UP chevron, anything open → "Collapse all" + a DOWN chevron — flipping label + title + data-i18n-aria-label + icon together; synced after every panel render + calendar month step (+ each group toggle, this round's addition). i18n rail.expandAll «باز کردن همه» / rail.collapseAll «بستن همه». (6) THE GOTO CHIPS (S98): every quadrant group head in the to-do panel carries an "Open on the board ↗" chip → /to-do-list#Q<id>, landing via the S97 arrival system. railGroup() grew opts.href: the head rides a .rail-group-headrow flex row (the toggle button flex:1, its contract untouched + the chip as its SIBLING <a> — an anchor can never nest in a button); href-less groups keep the exact FLAT markup (zero DOM churn for the other panels). layout.css's expanded-chevron rotation rule now covers BOTH paths (.rail-group > head AND .rail-group > headrow > head — the chip-carrying heads sit one level deeper). The chip speaks the .rail-panel-close recipe (32px, QA-verified) on the inline-END both directions (flex order — LEFT under rtl, QA-verified); i18n rail.openOnBoard "Open on the board"/«باز کردن در برد». STYLING: the panel body's thin quiet scrollbar (scrollbar-width:thin + muted-45% scrollbar-color, the project-header recipe — the projects TREE scrolls daily). (7) THE COMING-UP DEEP-LINKS (S99): the calendar rail panel's "Coming up" to-do rows land ON THEIR QUADRANT (/to-do-list#Q<id>) — a pure client-side join (quadrant rides the /api/rail todos payload, schema-CHECKed 1–4); project deadlines keep their project-page hrefs (the project top IS the work's home). (8) THE COLUMN ARRIVAL CUE (S99): #pd-col-<status> landings (the rail tree's leaf rows) get the SAME .q-arrived treatment — the accent frame + the 3px inline-start lead edge joining the accent + the shared pdArrived 1.6s ring flash (reduced-motion → the frame alone); project-page.js's pdConsumeColHash rides the S95 boot + first-afterSwap cadence, once per navigation, a hash naming no real column staying quietly pending. The scroll stays nav.js's S95 section-anchor system. (9) THE CLIENT-TASK DEEP-LINKS (S100 — a REAL FIX, upgraded from feature): the Coming-up CLIENT-CHECKLIST rows (the tasks table — its ONLY writer is the clients UI) linked to /project.html?id=, a page that NEVER renders those rows (the checklist lives on /clients.html only, module.ts) — a genuine never-lose-your-place violation. Now: rail.ts's tasks query scoped to p.type='client' (a non-client row would be a dead link the UI cannot even produce) + the same scope joined calendar.ts; the rows land /clients.html#task-<id>; clients-page.js grew the hash consumer (the pdConsumeHash recipe: pending-until-swept on the #client-body htmx afterSwap — the checklist ships inside a COLLAPSED <details> whose body arrives via the sweep — once per navigation): opens the details, marks the row .q-arrived (layout.css .hurdle.q-arrived: accent frame + hurdleArrived ring flash + the 4.5rem scroll-margin topbar contract), nudges the scroll. THE CALENDAR PAGE JOINED TOO: its task rows get the same hrefs + its sadhana rows land #Q<id> (quadrant joins the SELECT — the bare board-top href retired); every calendar-page row is a deep link now. (10) THE TAB ARRIVAL FLASH (S100): a #detail-<tab> landing also marks the TAB BUTTON .q-arrived after switchTab (project-header.css .detail-tab.q-arrived: inset 1px accent ring + accent-soft fill + the shared pdArrived flash) — the tab strip answers "which section is this?" the same way the column mark answers "which box?"; is-active styles untouched, once per navigation. (11) THE MORE-LINK CHIP (S100): the dashboard's "+N more" link carries the goto-chip's ↗ SVG inline (html.ts's new arrow-up-right glyph); the →/← text-arrow ::after PAIR retired (one direction-neutral cue instead of two — a latent RTL hover-direction nit retired with it); the icon rides at 0.85em and lifts ↗-diagonally on hover. LADDER: typecheck 0 · vitest 510/510 (508 + the S97 overflow pin — 10 quadrant-2 tasks → the exact #Q2 href + fresh tooltip + "+2 more on the board" + exactly-one-link + the ↗ path — and the S100 rail client-scope pin: personal-project / out-of-window / other-user rows never ride) · eslint src/ 0 errors (163 warnings baseline) · node --check ×7 · build --prod 77 entries · check-cache-bust PASS (15 files — the ladder: notifications v5→6, claude-dark v8→10, dashboard v18→21, polish-ui v27→28, sadhana-board v18→19, sadhana-page v9→10, nav v18→22, layout v32→35, i18n-en v72→74, i18n v127→129 + the i18n-fa v66→68 literal, project-page v56→58, project-header v35→37, dashboard-todo v13→14, clients-page v1→2) · i18n parity 1433→1436/1436 · playwright FULL SUITE 170/170 (165 + the tree-fold + goto-chip + deep-link-arrival + Coming-up + client-task tests; the BOX-TREE test grows the S99 column-mark pins [#pd-col-idea marked, planned not, border-divergence waitForFunction — the documented transition race] + the S100 tab-flash pins; the goto-chip test pins THREE chips on the grown seed [Q1/Q3/Q2]; the S93 to-do-panel test's one-shot allTextContents race — the documented "flaky-pass on retry" class — hardened to auto-retrying visibility assertions; seed grows the Q2 'Rail strategic task' due-tomorrow + Rail project 1 → type='client' with a dated 'Rail client task' in the tasks table; ZERO visual baseline drift — the dead-margin removal kept the dashboard byte-stable, no re-capture needed this round, unlike the original S97). agent-browser QA on :3017 (e2e-rail, fresh double-fork server, EN + FA, light + claude-dark, zero page errors): 3 chips (32px, #Q1/#Q3/#Q2, ↗ path) + the fold both directions (labels + icons + aria flipping), the chip landing flow end-to-end (.q-arrived on the exact quadrant only, in-viewport, qArrived running), the flat system (0 card gradients, both themes), the banner fill light color(srgb .943 .970 .971) = exactly 8% #4A9FA3 over white / dark rgb(55,41,36) = exactly 13% #D97757 over #1F1E1D, the hero solid + shadow-free + border-color-only transition, the strip plain var(--card), the RTL pin bar 3px on the RIGHT + the overdue tint solid, the FA panel («بستن همه», «باز کردن در برد», «پیشِ رو», Jalali dates + Farsi digits — «Rail client task · ۳۰ شهریور»), the client-task landing flow in dark FA (details OPENED, exactly one marked, in viewport, hurdleArrived, terracotta rgb(217,119,87) border), the tab flash (inset ring rgba(217,119,87,.14) fill, siblings clean), the column mark (accent border + lead edge joined, planned clean), the light quadrant mark teal rgb(74,159,163) — the one console warning was the documented S99 one-off class (the language-switch hard-nav race; the graceful fallback working as designed).

## 1-prev. (v0.3.34.0 — Session 96, 2026-09-21. THE OWNER'S REFERENCE-DRIVEN RESTRAINT ROUND — the neutral-gray canvas, the five-box tree with per-column deep-links, the icon rail, the one solid active pill, the Quick Notebook's true priority fill). A direct owner briefing (12 items) over the S95 tree. (1) THE FIVE-BOX TREE (owner item 1 — “it must show every box, that has at least one item”): /api/rail projectTasks widens from idea+bug to ALL FIVE board statuses (IN idea,bug,planned,in_progress,done, LIMIT 120→200 — a box with ≥1 item grows its branch, board column order); three new i18n keys (rail.g.plans «برنامه‌ها» / rail.g.inProgress «در حال انجام» / rail.g.done «انجام‌شده», EN+FA) — parity 1430→1433; EVERY board column now carries its own anchor (id="pd-col-<status>" on .pd-col in detail-helpers + .pd-col scroll-margin 4.5rem in project-header.css), so each box's leaves land on the EXACT column (#pd-col-idea/planned/in_progress/done); problems keep #detail-problems (the page's hash boot opens that tab — S95 r1). (2) THE CHEVRON DIRECTION (owner item 2 — the collapsed glyph “must point buttom”): the rail disclosure glyph is now a DOWN chevron (m6 9 6 6 6-6 — the old right-glyph + the collapsed rotate(-90deg) tipped every collapsed head toward the TOP); expanding flips it 180° upright (▴) — both states vertical, RTL mirrors honestly. The > child combinator in the rotation rule is LOAD-BEARING: a bare descendant selector also matched through the EXPANDED stage group a sub-tree nests inside, so every sub-chevron rode its ancestor's rotation (caught in live QA). (3) TO-DO = NAVIGATION (owner item 3): the To-do rail icon carries data-rail-nav (the Projects pattern) — a click lands on /to-do-list with its tickable panel riding along (the hard load restores it from localStorage); e2e-pinned. (4) THE NEUTRAL CANVAS (styling items 1+8 — “every other color pops against true gray, not against cream”): --bg #FAF9F6→#E7E7E7 and --bg-soft #F2F0EA→#DEDEDE (the “slightly deeper surface” was LIGHTER than the new canvas — rebalanced), --line→#D4D4D4 / --line-strong→#BFBFBF neutral hairlines at a uniform 1px (variables.css :root AND themes.css's explicit light block, kept in lockstep) — the warm cast retired from every surface; --muted still ≈6.2:1 on the new canvas (AA). (5) WHITE PANELS, COLOR ON SMALLS ONLY (item 2): the dashboard's four to-do category panels are PLAIN WHITE (border var(--line), radius var(--radius-lg)) — the S94 12% pastel wash is retired app-wide (dashboard .dash-todo-quadrant, the board's .quadrant + server .sadhana-quadrant, and the claude-dark twin rule); a picked accent speaks ONLY in the title ink + count badge now. (6) CALM ROWS (item 3): task rows sit on ONE neutral off-white (--statcard-bg on the dashboard, --surface2 on the board) with the uniform hairline and NO shadows — state speaks only through the 3px inline-start lead bars (st-inprog orange / st-hold violet); the state washes retired on both surfaces. (7) THE ONE ACTIVE PILL (item 4 — “two different active-state treatments at once” resolved): [aria-current='page'] = ONE solid accent rounded rectangle behind icon+label (background var(--cta), white ink — 4.93:1 light / 4.6:1 claude-dark, auto-adapting); the S94 trio (14% wash + 1.5px ring + the 3px lead bar ::before) RETIRED, and .is-panel-open quiets to brand ink with NO geometry (a panel can be open on any page — it must never read as a second active state); BOTH edge bars are gone (RTL note honored by removal). (8) THE RADIUS SCALE (item 5): --radius-lg 24px joins the ramp (big dashboard surfaces: category panels + Quick Notebook); rows stay --radius-sm 14px. (9) QUIET GROUP HEADS (item 6): the rail group heads lose the --ga pastel wash — every head wears the shared neutral pale well; a picked accent speaks ONLY in its leading dot + count badge (the count now accent-mixed 68% + 600 weight). (10) THE QUICKNOTE PRIORITY FILL (item 7 — the reference's confirmed priority pattern: “a full solid fill, not a colored stroke”): ONE flat 11% teal pastel fill (light) / 13% lightened-teal (dark — the S94 dark lesson) + the uniform neutral hairline; the old hybrid (paper gradient + 34% accent border + 3px lead rail + teal shadow) retired. ROOT CAUSE FOUND while verifying: notifications.css's GLOBAL .card depth gradient (later sheet, equal 0,1,0 specificity) had been SWALLOWING .notebook-dashboard's background since S93 — the identity only ever rendered through its BORDER, which is exactly why the owner kept reading it as an “outline treatment”; .card.notebook-dashboard (0,2,0) + the html[data-theme] claude-dark twin now outrank it, and the fill actually renders (computed color(srgb .91 .94 .94) light / rgb(41,48,46) dark, QA-verified). The composer + note cards ride WHITE content surfaces on the tint; the heading keeps its teal ink. (11) THE ICON RAIL (item 9 — the Notion/Obsidian/VS Code pattern: “only one sidebar shows full labels at a time”): a module with its own list-sidebar (Notes — the 3-pane vault) collapses the PRIMARY rail to icon-only (labels hidden, --rail-w 4rem, 2.75rem buttons — the short-viewport anatomy at ANY height), the module's own sidebar keeps full width + labels; nav.js toggles body.rail-icons-only from markNav on EVERY navigation + at boot, the rail panel NEVER mounts on module pages (openRailPanel guard + the boot-restore skip + auto-close on soft entry), and a nav icon clicked on the icon rail REMEMBERS its panel for the destination (pendingPanelOnNav opens it after the next load; the localStorage key covers hard destinations — Projects-from-Notes still arrives with its tree, e2e-pinned). (12) THE RAIL SURFACE: the rail + its panel read as ONE white sidebar (solid --card + the one hairline; the frosted 96%-bg translucency + blur retired), and the panel head wears the shared pale well (was --bg — a heavy gray band on the new canvas). LADDER: typecheck 0 · vitest 508/508 (the projectTasks pin grows the five-status expectations + parked/other-user exclusions) · eslint src/ 0 errors (163 warnings baseline) · node --check nav.js · build --prod 77 entries · check-cache-bust PASS (the ladder: variables v10→11, themes v4→5, layout v30→32 [re-bumped after the chevron combinator fix], dashboard-todo v12→13, quicknotes v25→27 [re-bumped after the specificity fix], sadhana-board v17→18, to-do-list v6→7, project-header v34→35, claude-dark v6→8 [re-bumped after the dark quicknote twin], nav v17→18, i18n-en v71→72, i18n v126→127 + the i18n-fa v65→66 literal) · i18n parity 1433/1433 · playwright FULL SUITE 165/165 (163 + the To-do-navigation + Notes-icon-rail tests; the BOX TREE test grows the three-box + chevron-path + #pd-col-* href + per-column landing pins; the toggle test moved to the Ideas icon; ALL FOUR visual baselines deleted + re-captured — the canvas/pill/panel changes touch every page — stable ×2, VLM-verified). agent-browser QA on :3017 (e2e-rail, FA + EN, light + claude-dark): every item verified computationally — canvas rgb(231,231,231), rail+panel white with one hairline, pill rgb(46,123,127)+white ink light / rgb(194,100,63) dark, quicknote fill rendering in BOTH themes, quadrant 24px radius + #D4D4D4 border, rows #F5F6F7 (no shadow), FA tree «ایده‌های جدید/مشکلات/برنامه‌ها» with down-chevrons collapsed + upright expanded, icon rail on Notes (labels display:none, body pad 64px, panel suppressed) — VLM on 4 screenshots (light dashboard 7/7 checks, dark dashboard, FA RTL tree, FA to-do board), zero console/page errors. MID-ROUND LESSONS: (a) a tool-pipeline glitch ate a “[h” sequence + injected a stray quote into the fresh e2e test — syntax-verify every generated file (esbuild/node parse) and never trust displayed selector text over bytes; (b) playwright's reuseExistingServer adopted MY manually-started QA server (which lacks HIBANA_SHOTS_DIR) mid-ladder — upload-progress “failed” on the reused server until it was killed; when hand-running :3017, export HIBANA_SHOTS_DIR=/tmp/hibana-e2e-shots or kill it before suite runs.

## 1-prev-prev. (v0.3.33.0 — Session 95, 2026-09-21. THE CRON-DRIVEN CONTINUATION ROUND — the rail tree comes ALIVE: deep-links land ON the work, the bug badge, the current-location marks). An autonomous webDevReview round (the 15-min cron), built on the S94 tree + the S95 candidates the S94 worklog queued. (1) THE TREE DEEP-LINKS TO THE SECTION (S95 candidate 3 — "the rail tree rows could deep-link to the project page's PROGRESS BOX anchor"): the S94 tree's leaf rows linked to the project page TOP; now "New ideas" items carry #pd-board (the progress board where idea tasks render) and "Problems" items #detail-problems (the exact problems panel). TWO mechanisms make the anchor land: nav.js's load() replaces the blind window.scrollTo(0) with a SECTION-anchor scroll — targets in the swapped shell scroll on the next rAF, htmx-swept targets (the whole #project-body arrives via its own hx-get) are watched for by a short-lived MutationObserver (4s, disconnects on first hit) that scrolls the moment the anchor exists AND is visible; hidden tab panels are skipped here (the page owns those). project-page.js: a #detail-<tab> hash OPENS that tab — pdConsumeHash, a pending-consume pattern that runs at boot AND at the first #project-body afterSwap (the panels only exist post-sweep), ONCE per navigation (the remembered-tab contract survives — a status save never yanks the view), a bogus fragment is ignored (never blanks the detail area). scroll-margin-block-start 4.5rem on .pd-board + .detail-panel (project-header.css) clears the sticky topbar — the notes.css/settings precedent. KNOWN CLAMP: #detail-problems sits near the page bottom on sparse projects — scrollIntoView stops at max scroll with the section fully in view (218px from the top in QA) — physics, not a bug. (2) THE BUG-COUNT BADGE (S95 candidate 2 — at-a-glance triage): a project carrying open bugs wears a small count pill ON its own rail row (scannable WITHOUT expanding the branch) — the awaiting_dev rust register on the S94 counter-pill recipe: 12% wash + ink mixed 68% toward the TEXT ink + a 45% hairline (6.63:1 light / 7.42:1 claude-dark, numerically checked), count through railFaDig (FA reads «۱»), aria-label composed from the existing rail.g.problems key (FA: «۱ مشکلات») — zero new i18n keys. (3) THE CURRENT-LOCATION ROW MARKS (the app's second job — "never lose your place"): markRailRows() runs from markNav on EVERY soft navigation + after each panel render; the row of the page you are ON lights with the S94 rail-icon active register in miniature — brand wash (accent-soft), text ink, and a 2px brand lead pill absolutely positioned on the rail-facing edge (inset-inline-start, ::before — zero layout shift, RTL-true: computed right:0 under fa) — hover keeps the wash. A row WITHOUT a hash (the identity row: project, spark, note-folder rows) lights while you are on that page; a row WITH a hash (a tree leaf) lights only when the current hash is exactly its section — landing via «Problems» lights the project row AND its problems leaf, landing at the page top lights only the project row. LADDER: typecheck 0 · vitest 508/508 · eslint src/ 0 errors (163 warnings baseline) · node --check ×2 (nav.js, project-page.js) · check-cache-bust PASS (4 files — nav v15→17, project-page v53→56, layout v29→30, project-header v33→34, ~470 ?v= refs across 25 pages) · i18n parity 1430/1430 (no new keys) · playwright FULL SUITE 163/163 (the S94 rail-tree e2e grows the S95 pins: the badge's text + aria-label, the #pd-board / #detail-problems href regexes, the board-landing waitForFunction (<220px), the problems-tab aria-selected + visible panel, the is-row-active marks on the project row + both leaves; visual baselines UNTOUCHED — the panel rides closed in every capture, zero screenshot drift). agent-browser QA on the local :3017 (e2e-rail account): the idea leaf lands #pd-board at 72px (scroll-margin working), the problems leaf auto-opens the tab + scrolls (clamped — section fully visible), FA/RTL renders «۱» + «۱ مشکلات» + the lead bar on the inline-start edge (verified by COMPUTED STYLE right:0 — the QA lesson: a viewport-rect vs containing-block coordinate mixup produced a false "wrong edge" verdict first; trust getComputedStyle, not eyeballed rect math), claude-dark badge bg rgba(217,138,111,.12) + active row rgba(217,119,87,.14) — VLM-verified on 2 full-page screenshots (FA light + claude-dark). MID-ROUND STALE-CACHE LESSON (the documented trap, hit AGAIN): editing nav.js/project-page.js AFTER their ?v= bump served the FIRST-edit bytes from cache (the observer code "never ran" — no debug logs) — re-bump after EVERY post-bump edit (nav v16→17, project-page v54→55→v56 after the rAF fix); Agents.md's cache-bust discipline is load-bearing in dev too, not just prod. NOTE: committed LOCALLY only — this sandbox carries no GitHub token (the briefing's token was lost to context summarization); the next credentialed session pushes (see the sandbox worklog).

## 2. Session index
| Session | Date | Outcome |
|---|---|---|
| 100-r | 2026-09-21 | v0.3.38.0 — RECOVERY ROUND: sessions 97–100 (four cron rounds, v0.3.35–38, local-only commits) were LOST with the second sandbox reset before the credentialed push arrived; the full stack re-implemented from the sandbox worklog record in one commit (the S97-r precedent, proven twice): the FLAT-CARD system (notifications .card + claude-dark caps flattened, both themes 0 gradients) · the priority surfaces (banner + resume-hero solid 8% accent + lead bar, the strip plain, the compound-selector cascade traps solved, the dead 2rem margin removed — zero baseline drift) · the RTL bug fixes (overdue/pin bars on inline-start + a direction-free solid tint) · the QUADRANT deep-links (dashboard "+N more" → #Q<id> + the .q-arrived arrival system + the phone-carousel landing) · the TREE FOLD (one button, every group, label/icon/aria flips, EN+FA) · the GOTO CHIPS (every quadrant head → the board ↗, headrow flex, the chevron rule extended, thin panel scrollbar) · the COMING-UP deep-links (dated to-dos land #Q<quadrant>) · the COLUMN arrival cue (#pd-col-* marked: accent frame + lead edge + ring flash) · the CLIENT-TASK deep-links (rail/calendar scoped to type='client', /clients.html#task-<id>, the details-opening hash consumer — a real never-lose-your-place fix) · the TAB arrival flash (#detail-<tab> pins the tab button) · the ↗ more-link chip (the →/← pair retired). 510 vitest, 170 e2e (5 new tests), parity 1436/1436, both themes + LTR/RTL QA'd. Committed locally; push pending credentials. |
| 99 | 2026-09-21 | v0.3.37.0 — (cron round, lost in the reset — re-implemented above) the calendar panel's Coming-up to-do rows land ON their quadrant; the project-board column landings get the app-wide .q-arrived arrival cue; a long-standing S93 e2e race hardened. 509 tests, 169 e2e, parity 1436/1436. Local-only commit 06bd1fd, died with the reset. |
| 98 | 2026-09-21 | v0.3.36.0 — (cron round, lost in the reset — re-implemented above) the to-do panel's quadrant groups join the deep-link system: every head carries an "open on the board ↗" goto chip landing via .q-arrived; the panel body's thin quiet scrollbar. 509 tests, 168 e2e, parity 1436/1436. Local-only commit c0a0002, died with the reset. |
| 97 | 2026-09-21 | v0.3.35.0 — (cron round, lost in the reset — re-implemented above; the ORIGINAL S97 itself died in the FIRST reset and was already once re-implemented as S97-r 6bb189a) the flat card system finished app-wide, the priority surfaces on the solid+lead recipe, two real RTL bugs fixed, the dashboard→board quadrant deep-links live, the rail tree foldable. 509 tests, 167 e2e, parity 1435/1435. |
| 96 | 2026-09-21 | v0.3.34.0 — the owner's reference-driven RESTRAINT round (12 items): the neutral-gray canvas (#E7E7E7 + neutral hairlines #D4D4D4, the warm cast retired) · the five-box rail tree (every board box with ≥1 item, per-column anchors #pd-col-*, 3 new i18n keys, parity 1433) · the down-pointing collapsed chevron (both states vertical, RTL-true; the > combinator lesson) · To-do = navigation (data-rail-nav, the Projects pattern) · white category panels + neutral rows + 3px lead bars only (the S94 pastel washes retired app-wide) · the ONE solid --cta active pill (the S94 wash+ring+lead-bar trio + is-panel-open strip retired) · --radius-lg 24px panel scale · quiet rail group heads (color on dot + count only) · the Quick Notebook's true SOLID pastel priority fill (the S93-era .card-gradient swallow root-caused + outranked, both themes) · the Notes ICON RAIL (one sidebar with labels at a time — body.rail-icons-only, panel suppressed on module pages, pendingPanelOnNav for icon-rail navigations). 508 vitest, 165 e2e (4 baselines re-captured), parity 1433/1433. Pushed → CI → CD → live. |
| 95-wrap | 2026-09-21 | (ops, no bump) Session-94 wrap continuation (context ran out mid-wrap): verified the S94 ship END-TO-END — remote HEAD 59af390 via the public API (the local "[ahead 2]" was a stale tracking ref from a credentialed-less fetch), CI + CD badges green, live /api/health ok (prod, schema 59, kv), byte-identity 12/12 login-page assets vs the local --prod --wire-html build of 59af390, all 77 manifest assets serving, every S94 marker present in the live bundles, healthchecks ping 200, tree clean after --restore-html. Could not push (the briefing's GitHub token was lost to context summarization) — this row rides the S96 push. |
| 95 | 2026-09-21 | v0.3.33.0 — (cron webDevReview round) the rail tree comes alive: leaf deep-links land ON the work (#pd-board / #detail-problems — nav.js section-anchor scroll w/ MutationObserver for htmx-swept targets + project-page.js #detail-<tab> hash→tab pending-consume + 4.5rem scroll-margin) · the bug-count badge on project rows (awaiting_dev rust, S94 counter-pill recipe, AA-checked, Farsi digits, aria from rail.g.problems) · the current-location row marks (brand wash + 2px lead pill on the rail-facing edge, identity-row vs exact-leaf rules, RTL-true). 508 tests, 163 e2e, parity 1430/1430, zero i18n churn. Committed locally then pushed in the S96 session (ffc0854). |
| 94 | 2026-09-21 | v0.3.32.0 — the owner's eleven-item refinement round: quadrant pastels made visible (12% wash + 55% borders + AA title mixes on all three surfaces + the latent claude-dark wash bug fixed) · the admin-link [hidden]-vs-display:flex leak (guard on both surfaces, member-role e2e) · the shared --well-bg pale well on rail heads + kanban columns · glance hidden under view=kanban · compact filter controls · the projects rail idea-group TREE (stage → project → New ideas/Problems → items, /api/rail projectTasks) · the Quick Notebook on the teal register in BOTH themes (khaki retired) · counter pill typography (fs-md digits, 10% wash) · the empty-quadrant placeholder (EN+FA, the dead :empty::before replaced) · the pronounced rail active state (wash + ring + lead bar). 508 tests, 163 e2e, parity 1430/1430 |
| 93-ops | 2026-09-20/21 | (ops, no bump) REPO MADE PUBLIC — the owner flipped assadigit/hibana-source to public (hibana-safe stays PRIVATE: it carries the D1 dumps = real user data). Effect: GitHub Actions minutes are unlimited again (the 606-runs/2,000-min exhaustion that darked CI/CD+Uptime since 21:46Z is moot for public repos; the local wrangler deploy ritual is now the fallback, not the primary). SECURITY SWEEP on the now-public tree+history: (1) no live tokens in the tracked tree (ghp_/cfut_/Telegram/password/healthchecks API keys — all zero; the .secrets.env is gitignored, credentials.md is local-only, all real secrets live in GitHub repo secrets + Worker secrets — both invisible to the public); (2) the CF account ID appears as an env-fallback in a few scripts (pre-migrate-bookmark/zone/custom-domain/restore-drill-planb) — an identifier, not a credential, accepted; (3) ONE HISTORY LEAK: the healthchecks.io PING KEY (fzlazarfuosqezmicvcgha) sits in 2 ancient commits (53cea32/ac56486, worklog-session16.md, removed from the tree long ago but immortal in public history) — exposure = anyone can ping/fail the checks (mask a real dead-man's-switch or page false alarms); the REST API key (hcw_) did NOT leak → the fix is a dashboard-side ping-key REGENERATION (owner action; then wrangler secret put HEALTHCHECK_PING_URL + the HIBANA_UPTIME_PING_URL repo secret) — ROTATION RECOMMENDED; (4) Changelogs.md itself is now public — detailed operational history (bookmark IDs, table names, incident forensics): no credentials inside (verified), an accepted open-source-style trade-off the owner should consciously keep or sanitize. The Uptime workflow self-heals on the next 7/37-past-hour tick (before the 6h+1h dead-man window lapses — no false page). Pipeline restoration verified: a docs push fired the full CI→CD chain green again (the dark-period commits b6338f5+5af028e carried through a green CI; CD auto-deployed the tip) |
| 93-wrap | 2026-09-20 | (ops, no bump) Session-wrap continuation (context ran out mid-S93): verified the ship END-TO-END after the fact — tree clean at d5c3a4c (all pushed), CI 35537682013 green on d5c3a4c, CD 35538397921 FULL deploy step-verified (guard → build+wire → DEV → probe → PROD → probe → purge_everything → restore → tree clean), /api/health prod ok (db up, schema 59, storage kv), v0.3.31.0 LIVE with all fifteen items. No code, no migration, no version bump. DEPLOY TAIL (b6338f5): the wrap's docs commit exposed an ACCOUNT-WIDE GitHub Actions quota exhaustion — 606 workflow runs in September on the PRIVATE hibana-source repo burned the free plan's 2,000 included minutes (signature: every job from 21:46Z on fails INSTANTLY, zero steps, empty log archives — CI green at 21:44 then hard stop; CD 35539687756 + re-runs all insta-fail). REMEDY: the exact CD ritual was replicated LOCALLY with wrangler (node scripts/build.mjs --prod --wire-html → 77 entries, 25/25 pages → wrangler deploy DEV 3701386e → dev probe ok:true → wrangler deploy --env prod 67e1639b → prod probe ok:true schema 59 → purge-cache.mjs purge_everything accepted exit 0 → --restore-html → git tree clean PASS) and byte-verified: live /login serves app.06d43dbe.js + base.15bdc988.css + claude-dark-theme.eca0dff7.css + components.7a8ff67a.css — IDENTICAL to the local b6338f5 build manifest (docs-only commit ⇒ same content-addressed hashes as d5c3a4c's artifact). OPERATIONAL NOTE: CI/CD (and the Uptime workflow) stay dark until the owner raises the Actions spending limit (Settings → Billing), goes public, or the minutes reset Oct 1 — until then deploy via the local ritual above; the Worker's own Cloudflare cron triggers are unaffected. QUEUED FOR S94: the owner's eleven-item refinement agenda — (1) pastel quadrant colors made MORE visible (S93 shipped 16 swatches but the 6% wash reads "almost monochrome" to the owner), (2) re-verify admin gating on the LIVE account sliding-menu (S93 verified already-true in code; owner still sees it), (3) rail-group-head background made paler + the EXACT same color/opacity on .kanban-col stage-column backgrounds, (4) hide .pglance when projects view=kanban (redundant with the columns), (5) shrink the gigantic filter select + "New project" button, (6) deeper projects-sidebar hierarchy (stage → project → idea-groups → items tree), (7) Quick Notebook khaki → teal/green (CTA register) in light mode, (8) same teal in claude-dark (no khaki), (9) .dash-todo-counter bigger digits + lower background opacity, (10) centered empty-quadrant placeholder copy ("You haven't added any note yet"-class), (11) more pronounced active/hover differentiation on the selected navbar rail icon |
| 93 | 2026-09-20 | v0.3.31.0 — the owner's fifteen-item round: MIGRATION 0060 (the 5-stage taxonomy: planning/queued/developing/awaiting_dev/operational, unreviewed retired, ~52 files) + the tickable to-do sidebar (quadrant checkbox rows POST /complete in place) + Dashboard/Projects rail icons navigate (projects also opens its stage-grouped panel) + the 14-day "Coming up" calendar panel (Jalali FA) + 16 pastel quadrant swatches on all three surfaces + horizontal task-card actions (the whitespace's true cause) + the SVG zen glyph + the amber Quick Notebook + no theme tooltip (+ the wiped-label fix) + 736px capture dialogs + dots breathing room. 506 tests, 160 e2e, dashboard baseline re-captured |
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
Live D1s run 0001–0060 (both dev and prod, 2026-09-20 — 0060 applied in the S93 owner round
with the full ritual: Time-Travel bookmarks §9 + datetime-named SQL dumps of BOTH DBs archived
to hibana-safe `backups/dumps/pre-0060/` with md5 round-trip verification, row-level diff
proof that the ONLY projects change is the intended status mapping — PROD: 31 rows, 10
mappings: unreviewed→planning ×5, investigating→planning ×1, awaiting→queued ×1,
doing→developing ×2, halted→awaiting_dev ×1; all 63 other tables byte-identical, 1574 rows;
DEV: 6 rows, unreviewed→planning ×1, byte-identical otherwise. 0058 was applied OUT OF
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
| 2026-09-20T20:29:11.613Z | pm-app-dev | 58 | 000006de-00000000-000050ec-fa80e64fd9a6775507fc0c16957be89d | pre-migration bookmark (dev) |
| 2026-09-20T20:29:20.998Z | pm-app-prod | 58 | 00000bc1-00000000-000050ec-45f304f2c297b9c3b7c5eef09042e025 | pre-migration bookmark (prod) |
