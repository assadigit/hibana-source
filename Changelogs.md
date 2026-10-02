# Hibana — Changelogs.md (consolidated changelog + worklogs)
| 187 | 2026-10-02 | v0.4.1.14 — THE TO-DO EMPTY-STATE ROUND (the owner's Hick's-law + Fitts instructions): the dashboard quadrant's "Add a task" text link RETIRES from the DOM on all four boxes (the header ＋ is the one add path, now named "Add task to {quadrant}" as aria-label + tooltip — custom names included); each empty quadrant speaks its OWN centered muted status line (r2, keyed against the owner's LIVE Eisenhower board — their Q4 "Urgent & Important/Do" → "Nothing urgent right now." (the owner's pick) · Q3 "Not Urgent & Important/Schedule" → "Nothing scheduled ahead." · Q2 "Urgent & Not Important/Delegate" → "Nothing pressing right now." · Q1 "Not Urgent & Not Important" → "Nothing waiting here."; still honest on default boards; SSR + app.js share the map, i18n twins quadrantEmptyQ1..Q4, parity 1555/1555); the strip centers in the fixed-height window (align-content center + flex centering + logical padding); the QA-found .card ul 20px one-sided inset (live since S182 — the generic content-list indent outranked the todo list's padding:0) fixed with .card .dash-todo-list { padding: 0 } (rows align flush, the line hits the true center); the board page's dashed bulb block centers in the card body (margin-block:auto, safe in the scroller, footer stays pinned) + the hint "Add one below each card" → "Tap + to add one" (it pointed at the in-card ＋) + the board footer ＋ carries the same quadrant-named label; dashboard.test pins re-authored + the NEW e2e/s187-todo-empty.spec.ts ×5 (EN + FA/RTL both surfaces + the ＋ add round-trip); cache-bust r1+r2 (dashboard-todo v24 · dashboard v39 · app v219 · i18n-en v94 · i18n v148 + fa v88 · sadhana-page v14 · sadhana-board v25); sw v423; package 0.4.1.14 — RELEASED (the owner's work order): TWO deploys (r1 5c2c274 + the r2 line re-map f393d9a after the owner-account pass caught that the owner's live board is the EISENHOWER matrix — their "Urgent & Important" is Q4; the re-map landed their pick on THEIR box), CI+CD green both (37070532394/37071952306 · 37073519066/37074904049), LIVE @ v0.4.1.14 byte-verified (13 wired assets + the i18n-fa lazy twin IDENTICAL, sw v423, schema 63) + the owner pass clean on real data (Q4 shows exactly "Nothing urgent right now." centered; the board's dashed block centered + "Tap + to add one"; the named ＋ on both surfaces; 0 console errors; VLM audits confirm) → tag v0.4.1.14 → zip 583 files secret-scan clean. The same round ALSO completed the held S186 release (push fdaf275 + tag v0.4.1.13 with the fresh token) + re-armed the prod backup cron's GITHUB_TOKEN secret on both workers (the watchdog's proof = the next :17/:23 UTC ticks). |

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.




## 1. Current state (v0.4.1.14 — Session 187 (the to-do empty-state round: the owner's Hick's-law + Fitts instructions for the dashboard widget AND the dedicated board page), 2026-10-02. THE OWNER'S REPORT: the dashboard quadrant's empty state split one idea across the whole box — "No tasks yet." on the start edge + an "Add a task" text link floating on the end edge, duplicating the ＋ in the card header (two controls for one action — the exact Hick's-law case; the floating link "doesn't line up with anything"), and the copy implied the user was behind where an empty Urgent box is GOOD news. DIRECTION 1 (the owner's pick): DELETE the link, keep only the ＋, put a calm status line in the middle — "The empty state becomes information, not a second button." THE DASHBOARD WIDGET: (1) the "Add a task" text link is REMOVED FROM THE DOM on all four quadrants (.dash-todo-add-text + its CSS retire — not display:none, keyboard focus can never land on it); (2) each quadrant speaks its OWN centered muted line — neutral facts that ask nothing, states-the-situation (never "you haven't started") — SSR TODO_EMPTY_LINE (dashboard.ts) + app.js's updateDashTaskEmpty share the map (i18n twins dashboard.quadrantEmptyQ1..Q4; quadrantEmpty + addTask keys retire, parity 1553→1555); R2 (the owner-account pass caught the drift AFTER the first deploy): the map is keyed against the OWNER'S LIVE EISENHOWER BOARD — their quadrants are Q4 "Urgent & Important/Do" · Q3 "Not Urgent & Important/Schedule" · Q2 "Urgent & Not Important/Delegate" · Q1 "Not Urgent & Not Important" — so the owner's picked line "Nothing urgent right now." lands on THEIR Urgent & Important box (Q4), with Q3 "Nothing scheduled ahead." · Q2 "Nothing pressing right now." · Q1 "Nothing waiting here." (still honest on default boards: "waiting" fits a Today box, "scheduled ahead" fits tight-deadline strategy, "pressing" is urgency without the word on an open horizon); (3) the strip CENTERS in the empty card's free space — .dash-todo-list:has(> .dash-todo-empty) align-content start→center + the li's flex centering + text-align:center, padding-inline logical (RTL-true), the muted ink + fs-sm size kept; (4) the header ＋ — now the quadrant's ONLY add path — carries the quadrant's own name as its accessible name AND tooltip: aria-label/title "Add task to {name}" (custom names included, server-side t() interpolation + htmlx escaping). THE QA-FOUND BONUS FIX (live-confirmed via VLM on the S184 screenshot): layout.css's generic .card ul { padding-inline-start: 1.25rem } OUTRANKED the todo list's own padding:0 ((0,1,1) beats (0,1,0)) — ever since S182 put the quadrant board inside the .dash-todo-panel.card, every list sat 20px inset on its START edge only (one-sided; header + quick-add form align flush); the old start-aligned strip masked it, the centered line exposed it (10px off the card's optical center). .card .dash-todo-list { padding: 0 } restores both edges symmetric — the rows align flush with the header, the line lands on the TRUE center. THE BOARD PAGE (/to-do-list): (1) the empty quadrant's dashed bulb block CENTERS in the CARD BODY — margin-block:auto splits .q-body's column-flex free space (auto margins degrade to start-alignment on overflow — safe centering in the scroll container), the block keeps its size + stretch + dashed border, the ＋ footer stays pinned at the bottom; (2) the hint stops lying about the button's place — "Add one below each card" → "Tap + to add one" (the ＋ lives INSIDE each card's footer; this page has no second add link, so a hint pointing at the ＋ is useful); (3) the footer ＋ gains the same quadrant-named accessible name ("Add task to {name}" — buildGrid + the addTaskTo/tapPlusToAdd T entries, EN+FA). THE GUARD: the updated dashboard.test.ts pins (3 empty lines + the quadrant-named aria-label + NO dash-todo-add-text + the filled Q1 keeps no strip) + the NEW e2e/s187-todo-empty.spec.ts ×5 (the four lines + computed centering grammar + the symmetric padding pin + the ＋ round-trip through the header on an empty quadrant; the board block's ±6px body-center + dashed border + pinned footer + the pointed hint; the FA/RTL twins on BOTH surfaces — the board's boot syncs lang from the ACCOUNT pref, the seed user flips server-side). METRIC (the owner's): the share of tasks added from the dashboard widget vs the full board page — the ＋ round-trip pin guards it; nobody misses the removed link. Cache-bust (r1+r2): dashboard-todo.css v23→v24 ×23, dashboard.css v38→v39 ×23, sadhana-page.js v13→v14 + sadhana-board.css v24→v25 (sadhana.html), then the r2 line re-map re-busts app.js v218→v219 ×24, i18n-en.js v93→v94 ×26, i18n.js v147→v148 ×26 + the i18n-fa v87→v88 lazy literal ×3; sw v422 → v423 (the shell pages changed refs twice); package 0.4.1.14; parity 1555/1555 (+2 net: −quadrantEmpty −addTask +Q1..Q4). LADDER: typecheck 0 · vitest 566/566 · eslint 0 err (162-warn) · build 79 · wiring canonical · cache-bust PASS · parity PASS · FULL e2e 345/345 in 6 file-batches + screenshots, zero flakes (the new 5-test spec + the s182 strip pin re-authored). RELEASED (2026-10-02, the owner's work order — the to-do empty-state instructions + the fresh token hand-off that also unblocked the held S186 release): TWO deploys — r1 push 5c2c274 → CI 37070532394 + CD 37071952306 green → live byte-verified (13 wired assets IDENTICAL, sw v422) → THE OWNER-ACCOUNT PASS caught the line-map drift (the owner's live board is the EISENHOWER matrix — their "Urgent & Important" is Q4, not the default semantic's Q3; /api/sadhana probed the real labels: Q4 "Urgent & Important/Do" · Q3 "Not Urgent & Important/Schedule" · Q2 "Urgent & Not Important/Delegate" · Q1 "Not Urgent & Not Important") → r2 re-map push f393d9a → CI 37073519066 + CD 37074904049 green → LIVE hibana.ir @ v0.4.1.14 — byte-verified qa/s187-live-verify.mjs (13 wired assets + the lazy i18n-fa twin IDENTICAL, sw v423, health ok/prod/db up/schema 63, no migration) + the owner-account functional pass clean on the REAL data (their Q4 "Urgent & Important" shows EXACTLY the owner's pick "Nothing urgent right now.", centered, no add-link in the DOM, the ＋ named "Add task to Urgent & Important"; their Q2 "Urgent" shows "Nothing pressing right now."; the board page's dashed bulb block centered ±2.5px with "Tap + to add one" + the footer ＋ named; 0 console/page errors; VLM visual audits confirm both) → tag v0.4.1.14 on f393d9a → zip hibana.0.4.1.14.zip (583 files = 489 tracked + 70 dist, integrity OK, secret-scan clean — all 8 real credential values absent, the account-id hits = the pre-existing S93 public surface) → /home/z/upload + the sandbox download folder → --restore-html. THE HELD S186 RELEASE also completed this round: the fresh GitHub token (…STEnt) verified alive → the two held commits pushed (1451f81..fdaf275) → CI 37064191287 + CD 37065798694 green → tag v0.4.1.13 on 6a0a208. THE PROD BACKUP CRON: the revoked-token /fail run (since 03:23 UTC) fixed by re-running wrangler secret put GITHUB_TOKEN with the fresh token on BOTH workers (hibana-prod :23 + hibana dev :17) — the watchdog honestly stays down until the next ticks prove the chain (no masking ping; a manual admin-backup attempt 403'd — the test account's prod role is member).
## 1-prev. Current state (v0.4.1.13 — Session 186 (the CTA round: the development rule + the full-app button audit + the dropdown portal + the Notes-page consolidation), 2026-10-02. THE RULE (Block 1, app-wide): ONE primary call-to-action per view — the SOLID teal fill (--cta) with the on-teal label (--btn-text): the bare <button> IS the shared primary (the «Capture an idea» grammar; one block in base.css owns fill/ink/radius/hover/focus/pressed/disabled); every other button is a SECONDARY (.ghost outlined or the neutral .btn) reading NEUTRAL ink (the teal ghost text retires — the crop-modal incident: both Apply + Cancel were teal-texted ghosts, zero hierarchy); the primary rides the TRAILING end of its row (DOM [secondary…, primary] — flex mirrors under RTL); the FAB is an app-shell element, exempt from the one-per-view count but keeping the shared primary style. THE AUDIT (Block 2): every modal/footer/composer swept — the Crop-banner incident fixed (Apply solid teal trailing, Cancel neutral); 16 footers reordered app-wide (app.js qa/pa/taskadd/quicknote/ne + sparks sp/sf/sf-move + projects ce + clients + sprint cat + pd tag/taskadd/sprintnew/editor/note-actions + signup verify + sadhana rename/task SSR); the .btn-small mains (pd tag Add, bl Save document, sprint cat Add) + the sadhana edit dialog's locally-styled .btn.btn-primary/inline-styled trio + the task-note-add grey circle + the problems/backlog ghost + the sadhana inline save converge on the shared grammar; the vault-new local hexes → tokens. THE DROPDOWN (Block 3): ONE shared component — window.hibanaMenu (app.js): every ⋯ pop opens as a <body>-level fixed portal (z-90) anchored to the button's trailing edge (logical — RTL mirrors), clamped/shifted/flipped inside the viewport, closing on outside tap + Escape + scroll + resize; the sparks + projects card menus adopt it (the idea card's overflow:hidden can never clip again), the dashboard's S82 lift refactors onto it, the notes vault-pop gains scroll-close. THE NOTES PAGE (Block 1 revised): mobile ≤768px retires the header «New note» (the sort dropdown owns the row); the empty-state twin is the ONLY page primary while the vault is empty (hidden once notes exist — the global FAB is then the sole creation entry on phones); desktop keeps the header primary; the FAB (idea/project/note/quick-note trio) joins notes.html and stays visible everywhere. THE GUARD: src/tests/cta-grammar.test.ts (3 template-level invariants: no secondary-classed submits, the trailing-primary row order, the neutral ghost ink) + e2e/s186-cta-grammar.spec.ts (5 tests: the crop incident, the modal footer + 4.5:1 contrast, the lift/Escape/scroll, the notes mobile+desktop, the FAB). LADDER: typecheck 0 · vitest 566/566 (+3) · eslint 0 err (162-warn) · build 79 · wiring canonical · cache-bust PASS (base.css v13 + app.js v217 ×24-27 pages; to-do-list v11 + sadhana-page v13; notes.css v19 + notes-page v23 + the FAB markup; sparks-page v13; projects-page v8; image-crop v3; sprint v18; clients v4; signup verify row) · parity 1553/1553 · FULL e2e 340/340 (+5, six re-authored for the lifted-menu grammar + the mobile notes path) · agent-browser QA clean (EN/FA-RTL/dark/390; 0 console errors) · VLM audits clean. sw v421; package 0.4.1.13.
## 1-prev-prev. Current state (v0.4.1.12 — Session 185 (the COLOR batch-1 round: the owner's Project Detail palette — Blocks 1/2/3/5), 2026-10-02. THE TOKEN BLOCK (Block 1): variables.css gains the S185 :root palette — role-named values (--page-bg #F5F4F1 · --surface #FFF · --border-soft #D5D2CA · --text-muted #5C5C5C · --primary #4A9FA3 · five --col-*-bg/dot/ink/edge sets · four --prio-*-bg/text pairs), ONE block to swap or revert the whole palette; every hard-coded color in the page's styles resolves through it (project-header.css's five column rules + the prio select options tokenized; the dark twins ride claude-dark-theme.css — clay primary + low-alpha washes — so ONE rule set serves both themes). THE CANVAS + CARDS (Block 2): project.html's body gains .pd-page → the warm near-white canvas (light only; dark keeps #141413), every card (.card + .pd-task) wears the warm-gray hairline (1.51:1 vs card / 1.37:1 vs page — the old --line's separation, warm cast); the white rail reads unchanged. THE ONE FAMILY (Block 3): the five column tints + dots re-derived in OKLCH at ONE lightness + ONE softness (tints 0.962/0.018, dots 0.75/0.13 — hues preserved: idea azure · planned amber · progress gold · done green · bug red; qa/s185-palette.mjs derives + AA-checks — idea/planned inks darkened to #546F8E/#676E77, sub-AA on the S88 tints too). THE NOTES FIELD (Block 5): #pd-note-textarea = the card's own surface + a visible 1px warm hairline + the teal --primary focus border (the accent + halo grammar; placeholder 4.58:1). SCOPING: the tokens are defined app-wide but consumed ONLY by the project page this batch — the dashboard e2e pin proves nothing else moves (body #E7E7E7 + .card line #D4D4D4 unchanged). DIRECTION NOTE: the table's exact values for text/muted/primary/columns/prio were not in the hand-off — derived from the existing palette + the one given value (#F5F4F1), centralized so any single value (or the Direction A/B column strength) is a one-line edit in the token block. LADDER: typecheck 0 · vitest 563/563 · eslint 0 err (162-warn) · build 79 · wiring canonical · cache-bust PASS (variables v24 + claude-dark v27 ×27 pages; project-header v49 ×23) · parity 1553/1553 · FULL e2e 335/335 (+ the NEW s185-project-palette spec ×4) · agent-browser QA ×5 (EN / FA-RTL / claude-dark / 390 light+dark; 0 console errors) · VLM audits clean. sw v420; package 0.4.1.12.
## 1-prev-prev-prev. Current state (v0.4.1.11 — Session 184 (the LAYOUT-CONSISTENCY round: the owner's six-instruction audit of the v0.4.1.10 dashboard + the two sidebar flags), 2026-10-01. THE OWNER'S AUDIT (measured on the live release: section gaps ~80/~80/~50/~17px; the Continue card's tiles ~2px off the bottom edge + nearly touching the hero row; card insets drifting 12–18px + header heights 42–52px; the header links mixed "View all" / "Go to …" / a lone chevron; the Projects arrow overlapping the Elixir row's red badge + the Developing column reading cut off; the quick-note input "the same grey as the page background — it looks disabled"; + the teal rail bar colliding with the "Dashboard" label + the sidebar reading mid-page-ended). THE SIX INSTRUCTIONS, SHIPPED: (1) ONE RHYTHM (the owner's picked option 1 — "one shared gap, ~24px; cards that are equally related should be equally far apart"): main.shell-dash IS the parent container — a flex column with ONE 1.5rem gap; every direct child (the h1, the resume strip, the vault banner, each section wrapper, the empty state) sits the same 24px from its neighbors, the h1→first-card beat is the SAME value, and every child's own block margin RETIRES (the drift was exactly that mix: the 2.9rem section rhythm + the .card clamp margins + the 1.1rem h1 gap); the projects section's two sibling panels join the same 1.5rem beat; the skeleton mirrors the rhythm; MEASURED on the owner's real custom-ordered dashboard: gaps [24×4], margins all 0px. (2) THE CONTINUE CARD'S FOOT: the culprit was polish-ui.css's late .resume-row { padding-block-end: 0.15rem } clobbering the 0.9rem foot (the tiles truly sat 2.4px off the edge); now hero → 0.75rem (12px) → chips → 1rem (16px, equal to the side inset); no fixed heights (the audit's height:auto check — the card was already natural flow). (3) ONE INSET + ONE HEAD GEOMETRY: every head strip and body block pads 1rem (16px) inline on every panel (the title's start edge, the stale row, the carousel, the overview row, the activity list and the composer on ONE inset line); .card > .dash-sec-head gets ONE geometry (0.75rem block padding + a 3rem/48px min height + vertically centered title/link); the legacy per-head overrides retire (dashboard-todo.css's .dash-todo-head baseline/1rem duplicate + its link's 4px block padding + section-hover underline; misc.css's .ov-head baseline + the dead .dash-projects-head block; the ov-head's 0.55rem under-hairline margin inside the dashboard panel). (4) ONE HEADER LINK GRAMMAR: every card-level head link wears the new .dash-sec-link (one ink var(--link), one size fs-sm, one weight 500, one trailing arrow, "Go to [page]" wording). The overview head GAINS its link — /tasks.html (the S126 destination page built for exactly that surface; "add one only if it has a destination page" — it has one). The activity head's "View all" retires into "Go to projects" (its honest destination — the feed IS the recently-updated projects list). The Quick Notebook head gains "Go to notebook" onto /whiteboard.html — the page the app itself names "Notebook" (nav.whiteboard; the vault's /notes.html is a different feature, so the link names its ACTUAL destination). "View all" stays reserved for COLUMN-level links: the stat boxes' stat-viewall, the stale row, and the notebook's archive button — which MOVES from the head actions to the card's new .dash-note-foot. (5) THE CAROUSEL HANDLES: both reports (the badge overlap + the cut-off column) were the S42 overlay handle sitting ON the last visible column — the prev/next circles leave the stage overlay and ride the NAV ROW beside the dots (static siblings BELOW the stage, never covering a row, badge or column edge; MEASURED arrowOverlapKanban = 0 at 1440 and 390); the snap rail (x mandatory + start — already in place) stops every page on column edges; the driver + the at-start/at-end step-aside are untouched; the carousel-REMOVAL variant stays deferred per the owner's "tell me if you want that version written up". (6) THE COMPOSER AFFORDANCE: the S183 gray-well return is superseded IN LIGHT — the field speaks the card's own surface + a VISIBLE 1px --line-strong border (the Session-19 password register) + the app's input focus grammar re-armed by a scoped :focus-visible (accent border + the 3px halo; the (0,2,0) resting rule was out-ranking the global (0,1,1) focus border); placeholder ~5:1 on white at the 0.75 opacity (above the 4.5:1 floor, was ~4.35 on the gray well); DARK KEEPS THE RECESSED WELL (a new claude-dark twin): --bg #141413 sits a rung below the tinted card — on a dark canvas a lower, bordered well is the native input register; only light's gray-on-gray read as disabled. (7) THE SIDEBAR FLAGS: the teal active bar MEASURED colliding with the label (rail buttons CENTER their labels in the 68px hit column — the "Dashboard" label at 58px reaches 4.9px from the button's start edge and the bar at 4.8px sat ON its first glyphs: label.left 14.3 == bar.left 14.3, a 3px overlap); the bar now rides the RAIL's own start edge (inset-inline-start: -0.55rem) — the classic edge indicator, ~10.6px clear of every label, RTL-true. The "sidebar ends mid-page (~y 805)" report: the rail is position:fixed inset-block:0 — full viewport height in the live browser (MEASURED rail.height == innerHeight at every pass); the mid-page end is a full-page-screenshot artifact (fixed elements render once, at their capture-time viewport position) — verified, no change. Cache-bust: dashboard.css v37→v38, dashboard-todo.css v22→v23, quicknotes.css v43→v44, polish-ui.css v37→v38, misc.css v21→v22, claude-dark-theme.css v25→v26, layout.css v60→v61 (×23–26 pages each); sw v419; package 0.4.1.11; parity 1553/1553 (0 new keys — the link strings ride the SSR inline pairs; no JS changed this round). LADDER: typecheck 0 · vitest 563/563 · eslint 0 err (162-warn) · build 79 · wiring canonical · cache-bust PASS · parity PASS · FULL e2e 331/331 in 8 file-batches (the NEW 4-test s184-section-grammar spec: the one-rhythm gap matrix + zero child margins, the 48px head strips + the 16px inset line on all six panels, the five-link grammar + the column-level View-all reservation + the notebook foot, the composer's card-surface/border/focus-ring + the Continue card's 12px/16px foot + the dark well twin; the REWRITTEN viewport@390 handle test — static nav-row siblings, zero kanban intersections; three re-scoped dashboard.test pins + the quicknotes foot pins; the re-baselined dashboard screenshot). AGENT-BROWSER QA (:3017, one-shot): EN — cardGaps [24×5] exact + heads [53.6, 48.4×5] + arrowOverlap 0 + the five links; FA/RTL — dir rtl + «پیشخوان» + all five FA links + the bar mirrored; claude-dark — the composer well #141413 on the 13% tint + all six panels one tint; 390px light+dark — panels [342×6] + zero h-overflow + the phone carousel intact; the rail full-height at every pass; VLM visual audits of all five screenshots clean; 0 console/page errors everywhere. RELEASED (2026-10-01, the owner's work order "Instructions for your coding agent" + the fresh token hand-off, all six tokens byte-verified live before the pipeline): pushed b997cd5 → CI #514 (36929942472) + CD #370 (36931582660) green → LIVE hibana.ir @ v0.4.1.11 — byte-verified SEVEN wired assets IDENTICAL via the NEW qa/s184-live-verify.mjs (dashboard.18078cbf + dashboard-todo.8ee370e2 + quicknotes.2d2d165b + misc.a73a4f7d + polish-ui.5e0fb691 + claude-dark-theme.38cde1b4 + layout.2ec0a541; sw v419; health ok/prod/db up/schema 63 — NO migration, pure frontend) + the owner-account functional pass clean on the REAL data (the custom-ordered dashboard's gaps [24×4] + margins 0; the four visible card-level links — the owner's account hides the activity section; the composer white + #BFBFBF border; the rail bar 10.63px clear; FA/RTL + dark + 390px clean; the account's language + theme restored; 0 console/page errors) → tag v0.4.1.11 on remote → zip hibana.0.4.1.11.zip (575 files = 481 tracked + 70 dist, integrity OK, secret-scan clean — all 8 real credential values ABSENT; the slug/account-id/ping-key hits are the pre-existing S93 public surface, 0 added) → /home/z/upload + the sandbox download folder → --restore-html → healthcheck pinged via the live UUID URL (HTTP 200, check up, last ping 22:01:52Z).
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
- **Monitoring**: healthchecks.io check `Hibana` (slug RANDOMIZED 2026-09-21 to unguessable
  hex — the 93-ops leaked-pair mitigation; the old `hibana`/`hibana-uptime` slug URLs 404;
  the account ping key is public git history, so ANY NEW check on this account MUST use a
  random slug — only the slug keeps URLs unguessable), 6h period + 6h grace (alert = 12h
  silence), email channel independent of CF/Resend/Telegram/GitHub. Ping URL in
  `HEALTHCHECK_PING_URL` (hibana-PROD only): success → GET, backup fail/skip → append
  `/fail`. Manual backups + dev worker never ping (anti-masking). Ticks classified by
  trigger (`src/lib/cron.ts`). The GitHub-side `Hibana uptime` prober follows the same
  random-slug rule (secret `HIBANA_UPTIME_PING_URL`; GitHub cron throttling stretches its
  nominal 30-min schedule to ~1–7h gaps — the 6h+1h window is sized for that).
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
- **Credential rotation (2026-09-26)**: owner re-issued the automation set; every value
  verified BEFORE install — GitHub PAT (admin on `hibana-source` + `hibana-safe`), CF deploy
  token (Workers secrets read/write + Zone Cache Purge re-proven via the S74 runbook: purge
  accepted, exit 0), CF Workers-AI token (`/user/tokens/verify` active; the `[ai]` binding
  itself needs no token), Telegram bot token (`getMe` → @Hibana_PM_bot), healthchecks.io
  write + readonly API keys (both checks `up`). INSTALLED: repo secrets
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (sealed-box via the Actions API), Worker
  secrets `GITHUB_TOKEN` + `TELEGRAM_BOT_TOKEN` (dev `hibana` + prod `hibana-prod`,
  `wrangler secret put`), local `~/.hibana/secrets.env` (full set + the owner's prod test
  account; login verified via `POST /api/auth/login` — the T6 origin gate requires an
  explicit `Origin` header for server-side callers). DELIBERATELY UNCHANGED:
  `HEALTHCHECK_PING_URL` + `HIBANA_UPTIME_PING_URL` keep their randomized slugs (never
  re-point at a guessable slug — the owner's re-shared `/hibana` slug URL stays unused);
  `RESEND_KEY` / `TELEGRAM_SECRET` / `TURNSTILE_SECRET_KEY` untouched (not in scope);
  `BACKUP_ENCRYPTION_KEY` NEVER rotates.
- **Sandbox reset recovery (S150, 2026-09-26)**: the sandbox wiped `/home/z/hibana`, `/home/z/.hibana/*` and the zips mid-stream — ground truth lives on origin (tags + green CI/CD are the receipt). Recovery: re-clone via the token'd URL, verify `git ls-remote --tags` + `ci-status` on the last tagged SHAs, rebuild the tooling (`push.mjs` = plain `git push origin`, `ci-status/ci-watch.mjs` = Actions API polling on `head_sha`, `make-zip.mjs` = git-tracked MINUS e2e/.github/eslint.config.mjs/hibana.db/lighthouserc.json/playwright.config.ts PLUS public/dist/* PLUS directory entries → the 527-entry convention), regenerate any missing zip from the tag's tree. The e2e contract is the CANONICAL tree — the WIRED tree breaks the S105 route pattern (the S123 lesson, re-learned live).
- **Deploy**: `npm run deploy[:prod]` = build `--prod --wire-html` → `check-dist-wiring`
  gate → `wrangler deploy [--env prod]` → `--restore-html`. Committed HTML keeps human `?v=`
  refs; `.build-backup/` canonical-only invariant. Rollback: `git checkout <good> && npm run
  deploy:prod`. Node self-host: Node 24+ (`node:sqlite`; better-sqlite3 REMOVED), PORT 3000,
  `DB_PATH=data/hibana.db`; trusted-proxy requirement on Node (X-Forwarded-For spoofing
  dodges rate limits; Workers unaffected — CF-Connecting-IP authoritative).

## 5. Migrations — live-DB warning
Live D1s run 0001–0064 (both dev and prod; 0061 rode S172, 0062+0063 in the S180 chain, 0064 (the user-scoped categories library — the owner's written approval) in the S181 chain, each with the full §9 bookmark ritual — both DBs schema 63. 0064's backfill is MACHINE-PROVEN by qa/s181-verify-0064.mjs (R1–R4 + B1–B6): dev PASS (trivial — 0 categories); prod PASS — the install's 2 shared categories forked exactly as the contract prescribes (2 originals kept by their first owner + 2 '-u1' copies, all 4 enables + all 41 dev_tasks references remapped exactly, 66 untouched tables byte-identical, per-user live-name uniqueness, zero dangling/cross-owner refs); the §9 bookmarks + full pre-migration SQL dumps (data/, gitignored) are the recovery path). Historical note: 0001–0060 were live as of 2026-09-20 — 0060 applied in the S93 owner round
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
| 2026-09-24T04:59:45.335Z | pm-app-prod | 59 | 00000d65-00000000-000050f0-3df4de87f87c1c17e709b9f5501a56bc | pre-migration bookmark (prod) |
| 2026-09-24T04:59:54.302Z | pm-app-dev | 59 | 000007be-00000000-000050f0-e6731ac0f698fc7952af2f2941823d61 | pre-migration bookmark (dev) |
| 2026-09-28T13:32:50.964Z | pm-app-dev | 60 | 000008e5-00000000-000050f4-2c472008088bac8b884f1248fd27f27a | pre-migration bookmark (dev) |
| 2026-09-28T13:42:51.543Z | pm-app-prod | 60 | 00000f25-00000000-000050f4-11252d2c41fbf1cee584416cf46712d6 | pre-migration bookmark (prod) |
| 2026-09-28T13:49:02.510Z | pm-app-dev | 61 | 000008e6-00000000-000050f4-94802fddf10fba09e466ff7f6d74b8ca | pre-migration bookmark (dev) |
| 2026-09-28T13:53:52.600Z | pm-app-prod | 61 | 00000f26-00000000-000050f4-ea96e59d2e19b59fb760f6a6d85b7df1 | pre-migration bookmark (prod) |
| 2026-09-30T23:15:16.508Z | pm-app-dev | 62 | 00000979-00000000-000050f6-e6002da0ee031b2f2b8f4c7acb70572e | S181: pre-0064 user-scoped categories (dev) |
| 2026-09-30T23:22:33.536Z | pm-app-prod | 62 | 00001001-00000000-000050f6-1b8e06d1e8196b47e7176464a10727ff | S181: pre-0064 user-scoped categories (prod) |
