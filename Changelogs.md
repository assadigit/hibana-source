# Hibana — Changelogs.md (consolidated changelog + worklogs)
| 195 | 2026-10-10 | v0.4.1.21 — THE PANEL CLOSE-BUTTON FIX (the owner's report): the rail panel head's close button + its fold twin (the shared S97 recipe) step out of the hairline era — the pixel probe: the .icon stroke-width 1.8 lives in the 24-unit viewBox but rendered at 17.6px → an effective 1.32px stroke → 1px anti-aliased runs (the crossing X reads lighter than the chevron's vertex at equal stroke; three VLM audits concurred, worst in dark), and the 32px box sat under the app's own 40px coarse-pointer floor; the fix: 36px boxes (40px coarse), 20px icons (the .rail-btn .icon size), and the X's path carries its own optical stroke-width 2 (the one deliberate fork of the 1.8 system — an own-declaration attribute beats the inherited value; the pair reads matched at 20px), the quiet grammar unchanged (transparent rest, bg-soft hover, the separate 2px brand ring); guards: identity-palette S195 ×3 + the NEW e2e/s195-panel-close.spec.ts ×7 (incl. the hover-recalc settle + the tree-data re-render wait + the light --brand #4A9FA3 token pin); cache-bust layout.css v64 ×26 · nav.js v43 ×18; sw v430; package 0.4.1.21; parity 1570/1570 — RELEASED (2026-10-10): push 94b91de → CI 545 GREEN (all gates incl. the FULL e2e 401/401) → CD 398 GREEN → LIVE hibana.ir @ v0.4.1.21 — byte-verified qa/s195-live-verify.mjs ALL GREEN (layout + nav wired IDENTICAL off projects.html AND notes.html + the 3 content probes — the 36px box rule, the 40px coarse floor, the 20px icon rule, the X stroke-width 2 — + sw v430 + health ok/up/63 — no migration) + the OWNER-ACCOUNT pass clean on the REAL data (36px box · 20px icon · X 2px/chevron 1.8px · 59px head · 12px edge gap; the tree twin toggles Collapse all ↔ Expand all; the close closes; console 0 on a fresh load; VLM live audit: PASS — solid X, matched weights, aligned pair) → tag v0.4.1.21 on 94b91de → zip hibana.0.4.1.21.zip (598 files, integrity OK, secret-scan clean — all 8 credential values ABSENT; the account id only in the 4 pre-existing S93 public-surface scripts) in /home/z/upload + the sandbox download folder → --restore-html. HEALTHCHECK (honest form): both checks UP, natural ticks only — no masking ping. |
| 193 | 2026-10-06 | v0.4.1.20 — THE REVIEW FLOW: the deliberate review decision + the place-keeper reach the lean idea page — (a) #spark-promote on spark.html (the board's dialog grammar, the dirty fields folded into the ONE PATCH, the queue-aware landing: next idea → the new project's page → the caught-up close); (b) the review queue bar ('Review queue · i of n' + Prev/Next, oldest-first, the dirty-save-and-continue, contextual only — renders on an in-set idea's page with siblings, a lone idea carries none, a fresh idea never fetches); (c) delete joins the queue; (d) the bar on the --nav-active-* tint family with the label-ink position line; guards: identity-palette S193 ×4 + e2e/s193-review-flow.spec.ts ×9 (per-test DB re-arms; the CSRF-origin 403 + the inert-modal + the state-chain + the console-after-login lessons banked); cache-bust spark-page v6 · dashboard.css v40 ×23 · i18n-en v97 · i18n.js v151 + i18n-fa v91; sw v429; package 0.4.1.20; parity 1570/1570 (+5); FULL e2e 394/394 — RELEASED (2026-10-06): push 67e7feb → CI 37401814193 + 37401955313 GREEN (99b6466) → CD 37403267025 + 37403371841 GREEN → LIVE hibana.ir @ v0.4.1.20 — byte-verified ALL GREEN (the 4 wired assets + the i18n-fa lazy literal + the raw spark-page v=6 + sw v429 + health 63) + the owner pass clean on the REAL data ('Review queue · 1 of 15' → next '2 of 15'; the promote dialog + cancel; console 0; VLM clean) → tag v0.4.1.20 → zip in /home/z/upload + the sandbox download folder. |
| 192 | 2026-10-06 | v0.4.1.19 — THE ATTENTION PATH (round 2): the path from the glance to the action gets shorter — (a) the unreviewed-spark notifications link DIRECT to /spark.html?id= (the LEAN page, S161-consistent; the old /project.html hop flashed an empty heavy shell + wasted a round trip), the project kinds keep the heavy page; (b) the chrome rows (account menu + mobile More sheet) + the palette destination are SMART deep-links — the LEADING severity's filter (#urgent > #warning > #info, reset to plain on 0), with the stable data-notif-row hook + normPath dropping the hash so aria-current stays route-true; (c) the palette's Notifications row carries the live-count sublabel ('N needing attention', the shared __hibNotifCounts memo — no second fetch, FA digits, 99+ cap); (d) the badge ring tracks the chip's hover/focus surface (the white-halo-on-gray-hover mismatch fixed); guards: identity-palette S192 ×4 + notifications.test.ts href pins + the NEW e2e/s192-attention-path.spec.ts ×8 + the s191 mobile spec re-pinned to the stable hook; cache-bust command-palette v19 ×19 · hib-init v13 ×24 · mobile-nav v15 ×20 · quicknotes v47 ×25; sw v428; package 0.4.1.19; parity 1565/1565 unchanged; FULL e2e 384/385 first pass (the one = the s191 selector drift this change caused, re-pinned + re-proven 17/17) — RELEASED (2026-10-06): push bdd1c2f → CI 37393568845 GREEN → docs push 32a5d94 → CI 37393710752 GREEN → CD 37394906506 + 37395206776 GREEN (the normal chain) → LIVE hibana.ir @ v0.4.1.19 — byte-verified qa/s192-live-verify.mjs ALL GREEN (command-palette + hib-init + mobile-nav + quicknotes wired IDENTICAL off notifications.html AND projects.html, both pages in the WIRED form, sw v428, health ok/up/63 — no migration) + the OWNER-ACCOUNT pass clean on the REAL data (the badge '15'/info; the account-menu row's smart deep-link /notifications.html#info; the spark rows linking DIRECT to /spark.html?id=<uuid>; the palette row 'Notifications · 15 needing attention'; the ring under hover rgb(222,222,222) — the halo fix live; the mobile 390 More sheet row /notifications.html#info + the 15 pill + aria-current=page; the one console 503 = a STALE retained message from an earlier page-load moment (transient edge hiccup — the fresh console after --clear + reload is EMPTY, the direct /api/dashboard probe 200) — 0 real errors; VLM live audits 2/2) → tag v0.4.1.19 on 32a5d94 → zip hibana.0.4.1.19.zip (675 files, integrity OK, secret-scan clean — all 8 credential values ONLY in credentials.md; the 4 account-id hits = the pre-existing S93 public surface) in /home/z/upload + the sandbox download folder → --restore-html. |
| 191 | 2026-10-06 | v0.4.1.18 — THE ATTENTION SURFACE: the notifications count reaches the chrome + the page gains severity groups + filter chips (the S190-named candidate, serving both jobs; PASSIVE by design — nothing §7-rejected: no animation, no toasts, no interruption); THE BUG FIXED FIRST: --badge-pending-bg/-fg was referenced since R2.1 (the notifications Soon chips/icons/accents + --status-warning-soft → the task status dots) but NEVER DEFINED — every warning surface silently rendered unstyled; now defined light #FBF0D4/#7A580C 5.73:1 + dark #332C17/#DCC078 7.83:1 (qa/s191-attention-surface.mjs 16/16); THE CHROME: ?counts=1 (the NEW lightweight mode) paints the severity-tinted count pill on the rail's user chip (soft fills + AA inks, the 2px --card ring, 99+ cap, FA digits) + the account-menu row pill + the mobile More sheet's row pill (hibana:notif-count; refresh at the moment of decision, throttled 1/min, fail-silent); the chip's aria-label carries the state (nav.accountHint localizes the base at last); THE PAGE: severity GROUPS (sticky --bg-cover heads + count pills + FA digits, non-empty groups only) + the summary chips promoted to FILTER TOGGLES (aria-pressed, pressed = the family fill, own focus rings; the old static fills retire) + hash deep-links #urgent|#warning|#info; guards: notifications.test.ts ×7 + identity-palette S191 ×5 + e2e/s191-notifications.spec.ts ×9; cache-bust notifications v12 ×23 · quicknotes v46 ×25 · variables v26 ×27 · claude-dark v29 ×26 · notifications-page v2 · hib-init v12 ×24 · mobile-nav v14 ×20 · i18n-en v96 ×26 · i18n v150 ×26 + the i18n-fa v90 literal; sw v427; package 0.4.1.18; parity 1565/1565 (+4); FULL e2e 377/377; vitest 589/589 — RELEASED (2026-10-06): push 251bf2e → CI 37384455116 GREEN → docs push 7d535e0 → CI 37384906270 GREEN → CD 37386103453 + 37386226838 GREEN (the normal chain, no runner starvation this round) → LIVE hibana.ir @ v0.4.1.18 — byte-verified qa/s191-live-verify.mjs ALL GREEN (9 wired assets IDENTICAL off notifications.html + the shared chrome set IDENTICAL off projects.html + the lazily-injected i18n-fa twin IDENTICAL via the live i18n.js literal — the script fix during the pass: the literal rides the minifier's DOUBLE quotes — + sw v427 + health ok/up/63, no migration) + the OWNER-ACCOUNT pass clean on the REAL data (the chrome badge '15' in the info family with the aria '15 needing attention — Account menu' after the SW's one-cycle update reload — the S69 settle behavior, honest; the page: ONE Heads up group, 15 items, the count pill 15, the sticky head, the chips All 15/Heads up 15 with the #info hash + aria-pressed on click; the mobile 390 More sheet's Notifications row carrying the 15 pill; the dark twin's head cover rgb(20,20,19) + the badge ring rgb(31,30,28); 0 console messages + 0 page errors; VLM live audits 2/2) → tag v0.4.1.18 on 7d535e0 → zip hibana.0.4.1.18.zip (584 files, integrity OK, secret-scan clean — all 8 credential values ONLY in credentials.md, the owner's intentional PC copy; the 4 account-id hits = the pre-existing S93 public surface) in /home/z/upload + the sandbox download folder → --restore-html. |
| 190 | 2026-10-06 | v0.4.1.17 — ONE ACTIVE GRAMMAR, MOBILE: the bottom bar's tabs + the More sheet's rows join the S189 rail shape (the same --nav-active-* family reaches the last two navigation surfaces — the active tab paints the soft filled teal at 14% light / 20% dark on its own 14px tile, icon at the full teal, label one rung further at weight 600; the bar's block padding 0.3→0.375rem sits the shape ~6px off the edges, the body's under-bar reserve 3.75→3.9rem); the translucent 92%-card bar's contrast BOUNDED worst-case both themes (light icon 3.49:1 / label 5.55:1, dark 4.73:1 / 5.16:1 — qa/s190-mobile-active.mjs); the inactive press joins the one hue family (--accent-soft retires for --nav-hover-bg), the active press deepens (--nav-active-bg-hover); the More tab carries the same shape on secondary pages + the sheet's current row joins (--accent-soft/--link retire); the More-EXPANDED teal ink retires on primary pages (one active pattern — the open sheet is the indicator); the bar tabs gain their OWN 2px keyboard focus rings (the S61 gap); THE FEATURE: activating the CURRENT tab re-orients — nav.js's byte-identical go() branch smooth-scrolls to the head, no re-mount (reduced-motion snaps); guards: identity-palette S190 ×6 + the NEW e2e/s190-mobile-active-shape.spec.ts ×7; cache-bust polish-ui v39 ×23 · quicknotes v45 ×25 · nav v42 ×18; sw v426; package 0.4.1.17; parity 1561/1561 — RELEASED (2026-10-06): push c8bfd37 → CI 37362926900 GREEN → CD runner-starved ×2 (queued 15 min, runner:none, auto-cancelled; the docs chain's guard 40+ min) → deployed via npm run deploy:prod off the CI-verified 85dd65a (hibana-prod 2daa6252) → LIVE byte-verify ALL GREEN (3 wired assets IDENTICAL ×2 pages + sw v426 + health ok/up/63) → owner-account pass clean on the REAL data (the shape exact + route-following + the More twin + the sheet row; 0 console/page errors) → tag v0.4.1.17 on 85dd65a → zip 591 files integrity+secret-scan clean (the 4 account-id hits = the S93 public surface) → --restore-html. |
| 189 | 2026-10-06 | v0.4.1.16 — THE RAIL'S ACTIVE SHAPE (the owner's CHANGE 7): the active rail item paints a soft FILLED rounded shape — the teal #2F7B7F at 14% light / the lighter #8FCCCF at 20% dark (alpha on the background COLOR only, never the opacity property), covering the icon AND label as ONE unit, 12px corners, ~8px inset off each rail edge (the hit column widens 68→72px labeled / 44→48px icon-only; the 1px hairline's 7.5/8.5 split mirrors under RTL); the icon at the full teal (4.12:1 on its tint) + the label one rung further (#1F5A5D light 6.56:1 / #9AD4D7 dark 6.45:1 — 4.5:1+ ON the tint, both themes); the S179/S184 start-edge accent bar RETIRES (the shape is the only active indicator — still ONE pattern per S188's CHANGE 5); inactive hover = the same teal at 7%/10%, active:hover deepens to 18%/25%; the keyboard ring stays its own separate 2px outline outside the shape; all tokenized (--nav-active-bg/-bg-hover/-icon/-label + --nav-hover-bg, variables.css + the claude-dark twins); guards: identity-palette S189 ×4 + the NEW e2e/s189-rail-active.spec.ts ×8 + rail-panel's active pins re-authored; cache-bust layout v63 ×26 · variables v25 ×27 · claude-dark v28 ×26; sw v425; package 0.4.1.16; parity 1561/1561. — RELEASED (2026-10-06): push a9e796c (feature) + 2cc4a1e (docs rotation) → CI 37352216916 + 37352372849 GREEN → CD 37354292109 + 37354357506 GREEN (dev → probe → prod, the stale-CI guard serializing both chains onto the newest sha) → LIVE hibana.ir @ v0.4.1.16 — byte-verified qa/s189-live-verify.mjs ALL GREEN (layout + variables + claude-dark-theme wired IDENTICAL off projects.html AND sadhana.html, both pages serving the WIRED form, sw v425, health ok/db up/schema 63 — no migration) + the OWNER-ACCOUNT functional pass clean on the REAL data (/app: the Dashboard shape exact — bg rgba(47,123,127,.14), icon rgb(47,123,127), label rgb(31,90,93), 12px radius, 72px wide, 7.5/8.5px shoulders, ::before none; /projects.html: the shape follows the route with the panel OPEN — exactly ONE aria-current, the one-pattern contract; the dark twin exact — rgba(143,204,207,.2) + the lighter teals; 0 console messages + 0 page errors; the VLM live audit 4/4 — the filled one-unit shape, no bar, plain inactives) → tag v0.4.1.16 on 2cc4a1e → zip hibana.0.4.1.16.zip (587 files = 493 tracked-minus-e2e/.github + 70 dist, integrity OK, secret-scan clean — all 9 real credential values ABSENT, the account-id hits = the pre-existing S93 public ops-script surface) → /home/z/upload + the sandbox download folder → --restore-html. HEALTHCHECK, the honest form: both the "Hibana" backup-cron watchdog and the "Hibana uptime" prober read UP with fresh ticks (15:23Z / 15:54Z); NO manual masking ping sent (the S186 lesson). |
| 188 | 2026-10-05 | v0.4.1.15 — THE PROJECTS SIDEBAR PANEL ROUND (the owner's six-change spec): CHANGE 1 — the idea rows speak TITLE ONLY on ONE line (nowrap + ellipsis; the old 2-line clamp made each idea read as a title+description text blob), EVERY row at the SAME compact 32px height (project rows, section heads, leaves — one rhythm; ≥40px coarse-pointer floor kept), and ALL items list with NO cap (the /api/rail projectTasks LIMIT 200 RETIRED — a 300-idea section lists all 300; the projects window 40→400); CHANGE 2 — the panel body scrolls INTERNALLY with STICKY top-level group headers (both head shapes; solid --card cover, z-3; the panel head stays fixed; the body's block-start padding → 0 so the stuck head pins flush — a padded scroller insets Chrome's sticky rect), every group/project/section still toggles, and the open/closed state of EVERY node persists to localStorage (stable data-fold-key identity per node — stage status key / project id / project+box / folder / quadrant — applied after every render, surviving reloads; the S116 in-document harvest/restore retires in its favor); CHANGE 3 — the GUIDE LINES return for the NESTED levels only (1px --line vertical guide on the project + section bodies, one rounded elbow span per child meeting the guide at the row's leading edge — real elements, never pseudo-elements, so the selected-row accent bar can't collide; the top-level groups stay plain text + chevron; logical properties — RTL mirrors); CHANGE 4 — COUNT BADGES at every row's INLINE-END edge in ONE column (circle at one digit, pill at two+ — same height; neutral --bg-soft tint + --muted ink, never the accent; hidden at zero; absent on EXPANDED project rows; aria-labeled "N projects/sections/items/ideas/notes/tasks" via 6 new i18n keys ×2 langs, {n} replaced with FA digits under fa; the goto chips go absolute + card-bg so the badge column stays one line and the reveal covers cleanly); CHANGE 5 — ONE active rail pattern (the aria-current bar, keyed to the current ROUTE by markNav/hib-init): the .is-panel-open brand-icon accent RETIRES entirely (aria-expanded keeps the semantics; the visible panel is the indicator — the owner's "Dashboard and Projects both look active" report); CHANGE 6 — the panel becomes a ROUNDED FLOATING surface on the tinted canvas (10px --rail-panel-gap block+outer insets, 16px radius, thin --line border + soft shadow — the edge never rides the tint alone, 8px inner padding, overflow:hidden clipping the internal scroll to the corners; the icon rail UNCHANGED; the body gutter widens by the two gaps; RTL mirrors). Server: rail.ts uncapped (no schema change — schema stays 63). GUARDS: rail.test.ts +1 UNCAPPED pin (205 tasks + 45 projects all ride); the NEW e2e/s188-sidebar-tree.spec.ts ×8 (single-line/equal-height/no-cap + the truncated long title; sticky pinned at the scrollport top + the panel head immovable + reload-persisted folds incl. the bulk button; the elbow MEETS the guide ±0px + no line on collapsed branches or top-level bodies; the badge column/circle/pill/zero-hidden/expanded-hidden/aria-labels; the one-pattern rail ink proof (current+panel-open == current ink; not-current+panel-open == plain muted); the floating geometry (x98/y10/h700-20/r16/border1/overflow hidden/rail 88×720 untouched/gutter 388); the FA/RTL twin (x902, badges at the left edge with ۱/۳۰ digits + ۱ پروژه label, mirrored guide meet, fold persistence)); re-pinned: s177 (badge at the far edge + sticky --card cover + 32px children + connectors present on nested levels), s106 (connectors re-pinned present/bare split), rail-panel (x 88→98 + the zero-count badge hidden), identity-palette (the retired is-panel-open::before selector drops). Cache-bust: nav.js v40→v41 ×18 · layout.css v61→v62 ×26 · i18n-en.js v94→v95 ×26 · i18n.js v148→v149 ×26 + the i18n-fa v88→v89 lazy literal ×3; sw v423→v424; package 0.4.1.15; parity 1561/1561 (+6 keys). LADDER: typecheck 0 · vitest 567/567 (+1) · eslint 0 err (162-warn baseline) · build 79 · wiring canonical · cache-bust PASS · parity PASS · FULL e2e 353/353 in 6 file-batches, zero flakes · agent-browser QA clean (EN light/dark + FA/RTL screenshots; VLM EN/dark audits clean — the FA VLM badge/guide claim disproven by the computed-geometry probes, its documented hallucination class). — RELEASED (2026-10-05, the owner's work order "after done, push and commit and update changelogs, and deploy"): push ac98065 → CI 37316196342 + CD (deploy) GREEN → LIVE hibana.ir @ v0.4.1.15 — byte-verified qa/s188-live-verify.mjs (nav + layout + i18n-en + i18n wired IDENTICAL off projects.html AND sadhana.html + the lazily-injected i18n-fa twin IDENTICAL out of the live i18n.js literal; sw v424; health ok/db up/schema 63 — no migration) + the OWNER-ACCOUNT functional pass clean on the REAL data (the panel floats x=98 beside the untouched 88px rail at full viewport — and x=74 beside the 64px icon-rail on short viewports, the token chain scaling; sticky stage head PINNED at the scrollport top through a 200px live scroll; the real tree carries 43 elbows + 17 nested guide bodies + 32 single-line nowrap/ellipsis leaves; real badges [1,1,1,1,3,2,1,1…] with the EXPANDED branch's badge display:none; exactly ONE aria-current icon (Projects, the current route); the fold store persisted the owner's REAL project UUIDs and the reload restored the panel + the expanded branch; 0 console messages + 0 page errors; VLM visual audit of the live screenshot clean on all five points; the account's fold/panel keys cleared after the pass) → tag v0.4.1.15 on ac98065 → zip hibana.0.4.1.15.zip (565 files = 495 tracked-minus-e2e/.github + 70 dist, integrity OK, secret-scan clean — all 9 real credential values ABSENT) → /home/z/upload + the sandbox download folder → --restore-html. HEALTHCHECK, the honest form: the "Hibana" backup-cron watchdog read GREEN with fresh :23 ticks (09:23:23Z — the S187 token re-arm proven in production); the "Hibana uptime" GitHub-Actions prober sat inside its DOCUMENTED 6h+1h grace window (GitHub cron throttling, per the check's own desc); NO manual masking ping sent (the S186 lesson). |
| 187 | 2026-10-02 | v0.4.1.14 — THE TO-DO EMPTY-STATE ROUND (the owner's Hick's-law + Fitts instructions): the dashboard quadrant's "Add a task" text link RETIRES from the DOM on all four boxes (the header ＋ is the one add path, now named "Add task to {quadrant}" as aria-label + tooltip — custom names included); each empty quadrant speaks its OWN centered muted status line (r2, keyed against the owner's LIVE Eisenhower board — their Q4 "Urgent & Important/Do" → "Nothing urgent right now." (the owner's pick) · Q3 "Not Urgent & Important/Schedule" → "Nothing scheduled ahead." · Q2 "Urgent & Not Important/Delegate" → "Nothing pressing right now." · Q1 "Not Urgent & Not Important" → "Nothing waiting here."; still honest on default boards; SSR + app.js share the map, i18n twins quadrantEmptyQ1..Q4, parity 1555/1555); the strip centers in the fixed-height window (align-content center + flex centering + logical padding); the QA-found .card ul 20px one-sided inset (live since S182 — the generic content-list indent outranked the todo list's padding:0) fixed with .card .dash-todo-list { padding: 0 } (rows align flush, the line hits the true center); the board page's dashed bulb block centers in the card body (margin-block:auto, safe in the scroller, footer stays pinned) + the hint "Add one below each card" → "Tap + to add one" (it pointed at the in-card ＋) + the board footer ＋ carries the same quadrant-named label; dashboard.test pins re-authored + the NEW e2e/s187-todo-empty.spec.ts ×5 (EN + FA/RTL both surfaces + the ＋ add round-trip); cache-bust r1+r2 (dashboard-todo v24 · dashboard v39 · app v219 · i18n-en v94 · i18n v148 + fa v88 · sadhana-page v14 · sadhana-board v25); sw v423; package 0.4.1.14 — RELEASED (the owner's work order): TWO deploys (r1 5c2c274 + the r2 line re-map f393d9a after the owner-account pass caught that the owner's live board is the EISENHOWER matrix — their "Urgent & Important" is Q4; the re-map landed their pick on THEIR box), CI+CD green both (37070532394/37071952306 · 37073519066/37074904049), LIVE @ v0.4.1.14 byte-verified (13 wired assets + the i18n-fa lazy twin IDENTICAL, sw v423, schema 63) + the owner pass clean on real data (Q4 shows exactly "Nothing urgent right now." centered; the board's dashed block centered + "Tap + to add one"; the named ＋ on both surfaces; 0 console errors; VLM audits confirm) → tag v0.4.1.14 → zip 583 files secret-scan clean. The same round ALSO completed the held S186 release (push fdaf275 + tag v0.4.1.13 with the fresh token) + re-armed the prod backup cron's GITHUB_TOKEN secret on both workers (the watchdog's proof = the next :17/:23 UTC ticks). |

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.




## 1. Current state (v0.4.1.21 — Session 195 (THE PANEL CLOSE-BUTTON FIX: the head's quiet pair steps out of the hairline era — the owner's report), 2026-10-10. THE ROUND (the owner's instruction, verbatim scope — "Fix this close button" + push/commit/deploy): the rail panel head's close button (and its fold twin, the shared S97 recipe) rendered as a fragile hairline and sat under the app's own touch floor. THE PROBE THAT DROVE IT (pixel-level, not vibes): the .icon stroke-width 1.8 lives in the 24-unit viewBox, but the icon RENDERED at 1.1em = 17.6px — the effective stroke was 1.8 × 17.6/24 = 1.32px, which anti-aliases into 1px runs (pixel-scanned: the X's center row measured 3 dark pixels, the arms 1px each at y=44); the crossing X has no vertex mass to lean on (the chevron's point concentrates ink, the X's crossing reads lighter at equal stroke) — three VLM audits concurred, both themes, worst in dark where light-on-dark strokes render thinner still; and the 32px box sat UNDER the app's own 40px coarse-pointer floor (misc.css) and far under its 44px .icon-btn recipe. THE FIX (one coherent change, the pair kept in lockstep — the shared recipe): (a) the box steps 2rem→2.25rem (32→36px; coarse pointers get the full 40px via @media (pointer: coarse) — the app's own documented floor); (b) the icon grows with the box, 1.1em→1.25rem (17.6→20px — the .rail-btn .icon size, one icon grammar across the rail surfaces); (c) the X's path carries its own OPTICAL stroke-width 2 (the ONE deliberate fork of the 1.8 system: an own-declaration presentation attribute beats the inherited .icon value — computed 2px vs the svg's 1.8px, live-probed; at 20px the effective stroke is 1.67px vs the chevron's 1.5px, and the pair finally reads MATCHED — the X solid and clickable, no longer a placeholder hairline). The head grows 55→59px with the box (the 12/11px shoulders stay balanced); the quiet grammar rides UNCHANGED — transparent rest, --muted ink, bg-soft hover + --text ink, the 2px --brand focus ring its own separate outline; the tree twin (Collapse all ↔ Expand all) rides the same recipe and the same growth. THE GOTO CHIP (S98) keeps its own 2rem — it fits the 32px group rows it lives in (the comment now says so precisely). GUARDS: the identity-palette S195 block ×3 (the box 2.25rem + the 40px coarse floor + the quiet grammar rules; the icon 1.25rem; the X's stroke-width 2 attribute pin + the no-bare-X-in-the-head check) + the NEW e2e/s195-panel-close.spec.ts ×7 (geometry 36/36/20px + centered pair + transparent rest; the optical stroke X=2px/chevron=1.8px — the scoped fork not a drift; function — close closes + reopen + the tree twin still toggles; the hover grammar via a REAL pointer with expect.poll settle — CSS :hover recalc can trail the mouse move by a frame, and the panel's async data re-render replaces the pre-data node, so the helper waits for the tree DATA before hovering; the brand ring rgb(74,159,163) = the LIGHT --brand #4A9FA3 — NOT the S189 teal #2F7B7F, a token mixup caught in the first pass; the dark twin — same geometry + stroke, the hairline was worst there; the FA/RTL twin — 36px at the inline-END + the Persian aria-label بستن پنل; 0 console/page errors). Cache-bust: layout.css v63→v64 ×26 pages · nav.js v42→v43 ×18; sw v429→v430; package 0.4.1.20→0.4.1.21; parity 1570/1570 unchanged (the fix carries no copy). LADDER: typecheck 0 · vitest 600/600 (+3) · eslint 0 err (162-warn baseline) · build 79 · wiring canonical · cache-bust PASS · FULL e2e (the 401 = 394 + the 7 new) · agent-browser QA clean (EN light + dark + FA/RTL; computed probes EXACT — 36px box, 20px icon, 2px path stroke, 59px head, 12/11 shoulders; the close + tree functions driven; VLM audits: the fixed pair EXCELLENT both themes — solid X, matched weights, no defects) — RELEASED (2026-10-10): push 94b91de → CI 545 GREEN (the FULL e2e 401/401 rode the gate) → CD 398 GREEN → LIVE hibana.ir @ v0.4.1.21 — qa/s195-live-verify.mjs ALL GREEN (the 2 wired assets IDENTICAL off projects.html AND notes.html + the 3 CSS content probes + the nav stroke probe + sw v430 + health ok/up/63) + the owner-account pass clean on the REAL data (the computed geometry EXACT: 36px box, 20px icon, X 2px / chevron 1.8px, 59px head, 12px edge gap; the tree twin + the close both driven; console 0; VLM live PASS) → tag v0.4.1.21 → zip (598 files, integrity OK, secret-scan clean) → healthchecks both UP (natural ticks).
## 1-prev. Current state (v0.4.1.20 — Session 193 (THE REVIEW FLOW: the deliberate review decision + the place-keeper reach the lean idea page), 2026-10-06. THE ROUND (the independently-chosen S192 follow-through — the 15-minute review found the app STABLE at v0.4.1.19: ladder green 593/593, live healthy sw v428 schema 63, the owner-account pass clean; the probe-confirmed gap: the Promote action lived ONLY on the sparks board's ⋯ menu — from a notification row (S192 lands you on spark.html, where you actually READ the idea) the path was read → back → board → find the card → ⋯ → Promote → stage → Save (~8 steps per idea, ×15 on the owner's real data), and reviewing several ideas lost your place every hop — no next affordance, the oldest-first order existed in the data but not in the flow; the round serves both jobs — never lose an idea, never lose your place). (a) PROMOTE WHERE YOU READ: spark.html gains the Promote to project action (the save-row's trailing end, a ghost secondary per the ONE-primary rule — Save stays the row's primary) — the board's EXACT dialog grammar (the 5-stage select, the shared modal classes), the dirty title/description folded into the ONE PATCH (the words are never lost to the promotion), rail refresh + the S119 project-kind resume record + the promoted toast, then the QUEUE-AWARE LANDING: the next unreviewed idea when a queue rides the page, the new project's page without one, the caught-up notifications page when the queue empties (the loop closes where it began). (b) THE REVIEW QUEUE BAR: while the current idea is itself in the unreviewed set (created >7d, still a spark — the notifications' exact boundary) AND siblings exist, a slim bar under the meta line carries your place — 'Review queue · i of n' + Prev/Next (data = the /api/notifications JSON's unreviewed-spark rows re-sorted oldest-first; the aria labels carry the destination idea's name; the .icon.arrow chevrons flip under RTL via the rtl.css pattern); queueGo()'s dirty-confirm SAVES FIRST then leaves (save() now returns success — the S120 draft store can't cover cross-idea hops, it restores only the SAME idea's fields); CONTEXTUAL by construction: no timers, no toasts, no badge churn — the bar renders ONLY on an in-set idea's page, a LONE unreviewed idea carries none, a fresh idea never fetches the set at all (§7: never a nag — the queue is where you already are, not a reminder to go somewhere). (c) DELETE JOINS THE QUEUE: the delete's landing is queue-aware too (next idea → the caught-up page → the shelf without a queue). (d) STYLING: the bar rides the --nav-active-* teal tint family (the S189/S190 grammar — background --nav-active-bg at 14%/20%, a 1px --nav-active-bg-hover hairline, --radius-sm; alpha on the background COLOR only, never the CSS opacity property), the position line in the --nav-active-label ink (6.56:1 light / 6.45:1 dark on this exact tint — the S189 floors) with tabular-nums + Persian digits under fa, the flex row mirroring under RTL (prev rides the inline-start end) — plus the promote button's ghost secondary with the up-arrow glyph. GUARDS: the identity-palette S193 block ×4 (the bar's token family + the no-opacity pin; the contextual fetch/render guards incl. the >7d gate + the in-set + n≥2 rule + the FA digits; the promote grammar — the dialog + the folded dirty PATCH + the project-kind resume record + the reused toast key; the queue-aware landings + the save-first confirm) + the NEW e2e/s193-review-flow.spec.ts ×9 with PER-TEST DB STATE RE-ARMS (the position + both hops + the aria; the fresh/lone no-bar guards + promote staying available; the promote dialog + the mid-review edit folded in + the landing + the API proof; the caught-up close on the last one; delete → next; the FA/RTL twin — صفِ بررسی · ۲ از ۳ + the computed scaleX(-1) arrow proof + dir=rtl + the FA promote label; the dark twin — rgba(143,204,207,.2) + rgb(154,212,215) exact; the dirty-save proof via the API; 0 console/page errors). E2E LESSONS (banked, the round's own scars): (1) page.request mutations on the API = 403 — the CSRF ORIGIN GATE rejects out-of-page request contexts (GETs pass) — specs mutate via raw DatabaseSync, the established pattern; (2) a native <dialog> showModal() makes the page behind it INERT — fill fields BEFORE opening the dialog (the earlier fill silently no-oped → dirty never set → the promote PATCH dropped the mid-review edit); (3) cross-test state chains are fragile — a mid-test failure leaves the tail state wrong for the next test; the per-test arm() helper re-seeds each test's own world; (4) console listeners attach AFTER login (the logged-out /api/auth/me 401 is login-page noise, the s192 pattern). Cache-bust: spark-page.js v5→v6 (spark.html) · dashboard.css v39→v40 ×23 pages · i18n-en.js v96→v97 ×26 · i18n.js v150→v151 ×26 + the i18n-fa v90→v91 lazy literal ×3; sw v428→v429; package 0.4.1.19→0.4.1.20; parity 1565→1570 (+5 keys: spark.reviewQueue/queuePos/nextIdea/prevIdea/queueUnsaved). LADDER: typecheck 0 · vitest 597/597 (+4) · eslint 0 err (162-warn baseline) · build 79 · wiring canonical · cache-bust PASS · FULL e2e 394/394 (385 + the 9 new, 17.7m, zero flakes) · smoke ALL PASS · bundle-size PASS (+14.0%) · agent-browser QA clean (the full flow driven by hand: the queue 'Review queue · 2 of 3' → next/prev → promote 'queued' → lands the next idea → delete → next → the single-remaining no-bar; EN light + FA/RTL + dark + mobile 390; computed-token probes EXACT — bg rgba(47,123,127,.14), hairline .18, ink rgb(31,90,93); VLM audits: the FA dark bar mirrored + readable + no overlap, the mobile 390 fit, no defects). RELEASED (2026-10-06): pushes 67e7feb (feature) + 99b6466 (docs rotation) → CI 37401814193 + 37401955313 GREEN (all gates incl. the full e2e 394/394) → CD 37403267025 + 37403371841 GREEN on 99b6466 (the normal chain, no runner starvation) → LIVE hibana.ir @ v0.4.1.20 — byte-verified qa/s193-live-verify.mjs ALL GREEN (dashboard.css + i18n-en + i18n.js wired IDENTICAL off spark.html AND projects.html + the i18n-fa lazy-literal twin IDENTICAL + spark-page.js raw v=6 IDENTICAL — the S161 exception, see the script note + sw v429 + health ok/up/63 — no migration) + the OWNER-ACCOUNT pass clean on the REAL data (the queue bar 'Review queue · 1 of 15' on the first unreviewed idea → the next hop lands '2 of 15'; the tokens EXACT — bg rgba(47,123,127,.14), hairline .18, ink rgb(31,90,93); the promote dialog opens with the 5 stages + cancels cleanly — non-destructive; 0 console errors; VLM live audit clean — the bar balanced + the tint subtle + no defects) → tag v0.4.1.20 → zip hibana.0.4.1.20.zip (integrity OK, secret-scan clean) → --restore-html. HEALTHCHECK (honest form): checked after release below. The release-record commit also carries the identity-palette S193 block (missed by the feature commit's git add) + the s193-live-verify script's raw-asset handling fix (spark-page.js is NOT in the build's ENTRY_POINTS — an S161 miss, every other *-page.js is bundled; it verifies RAW against the canonical file; the i18n.js byte-parity needs the local tree in WIRED form — the canonical build's lazy FA literal differs by the rewrite, the S191 lesson).

## 1-prev-prev. Current state (v0.4.1.19 — Session 192 (THE ATTENTION PATH, round 2: the path from the glance to the action gets shorter), 2026-10-06. THE ROUND (the independently-chosen S191 follow-through — the 15-minute review found the app STABLE at v0.4.1.18: ladder green 589/589, live healthy sw v427 schema 63, the owner-account pass clean; the probe-confirmed gaps: the unreviewed-spark rows linked the HEAVY /project.html (the htmx HX-Redirect landed on spark.html eventually, but only after an empty-shell flash + a wasted round trip — every other spark surface links direct), the chrome rows linked the UNFILTERED page even when the badge said urgent, the palette's Notifications row carried no count (Trash has one — the established pattern), and the badge's separation ring stayed WHITE under the chip's gray hover tint (the halo mismatch, probe-confirmed rgb(255,255,255) on rgb(222,222,222))). (a) THE SPARK HOP RETIRES: the unreviewed-spark href is now /spark.html?id= DIRECT (the project kinds keep the heavy page — pinned); (b) THE SMART DEEP-LINKS: the account-menu row (hib-init.js v13) + the mobile More sheet's row (mobile-nav.js v15) + the palette's destination all link to the LEADING severity's filter (#urgent > #warning > #info, reset to the plain page at count 0) — two clicks from the badge to exactly the list that needs attention; the sheet row gained the STABLE data-notif-row hook (the lookup survives the href rewrite) and normPath now DROPS THE HASH so mark()'s aria-current stays route-true (the regression caught + e2e-guarded: on /notifications at 390px the sheet row still carries aria-current=page); (c) THE PALETTE CARRIES THE COUNT: the Notifications row gains the Trash command's live-count sublabel grammar — 'N needing attention' (the S191 notif.needsAttention key reused, ZERO new i18n keys), sourced from hib-init's SHARED __hibNotifCounts memo (no second fetch — readNotifCounts() on open + the hibana:notif-count event for live repaints), FA digits, the 99+ cap; the empty user sees no sublabel and the plain page; (d) THE HALO FIX: the ring tracks the chip's surface on hover AND :focus-visible (var(--bg-soft)) so the pill always reads as cut from the surface beneath it. GUARDS: the identity-palette S192 block ×4 + the notifications.test.ts href pins + the NEW e2e/s192-attention-path.spec.ts ×8 (the spark direct click lands on spark.html with the title in #spark-title; the menu row deep-links #urgent — the hover-opened pop needs the pointer first; the palette sublabel + the smart destination; the mobile sheet + the aria-current guard; the ring-under-hover computed proof — CSS :hover needs a REAL pointer, locator.hover() not dispatched events; the FA twin with ۴; the caught-up resets; 0 console/page errors) + the s191 mobile spec re-pinned to the stable hook (its href-qualified selector was the ONE full-suite failure — the drift this round's own change caused, exactly the case the hook was built for). Cache-bust: command-palette.js v18→v19 ×19 · hib-init.js v12→v13 ×24 · mobile-nav.js v14→v15 ×20 · quicknotes.css v46→v47 ×25; sw v427→v428; package 0.4.1.18→0.4.1.19; parity 1565/1565 unchanged. LADDER: typecheck 0 · vitest 593/593 (+4) · eslint 0 err (162-warn baseline) · build 79 · wiring canonical · cache-bust PASS · FULL e2e 384/385 in the first full pass (the one = the s191 selector drift, re-pinned + re-proven with both specs 17/17) · smoke ALL PASS · bundle-size PASS (+13.9%) · agent-browser QA clean (the smart row href + badge + pill; the spark direct link; the palette row 'Notifications · 4 needing attention' → the click lands #urgent with the info group hidden; the ring under hover rgb(222,222,222); the mobile sheet #urgent + pill + aria-current; console 0; VLM: the palette 3/3 — the row + the muted sublabel + clean alignment). OPS LESSON (the round's own scar, banked): a manual QA server booted with the same command line as the Playwright webServer shares the pkill pattern — killing mine mid-run killed BOTH (333 ERR_CONNECTION_REFUSED, all environmental; the clean re-run passed); scope the kill by PORT (fuser -k <port>/tcp) or never run the two concurrently. RELEASED (2026-10-06): pushes bdd1c2f (feature) + 32a5d94 (docs rotation) → CI 37393568845 + 37393710752 GREEN → CD 37394906506 + 37395206776 GREEN (the normal chain) → LIVE hibana.ir @ v0.4.1.19 — byte-verified qa/s192-live-verify.mjs ALL GREEN (the 4 wired assets IDENTICAL off notifications.html AND projects.html + sw v428 + health ok/up/63 — no migration) + the OWNER-ACCOUNT pass clean on the REAL data (the badge '15'/info + the smart deep-link /notifications.html#info on the menu row; the spark rows DIRECT to /spark.html?id=; the palette row 'Notifications · 15 needing attention'; the ring under hover rgb(222,222,222); the mobile sheet row #info + 15 + aria-current; the one console 503 = a stale retained message, the fresh console EMPTY + the direct probe 200 — 0 real errors; VLM 2/2) → tag v0.4.1.19 on 32a5d94 → zip hibana.0.4.1.19.zip (675 files, integrity OK, secret-scan clean — the 8 credential values ONLY in credentials.md; the 4 account-id hits = the pre-existing S93 public surface) in /home/z/upload + the sandbox download folder → --restore-html. HEALTHCHECK (honest form): both checks UP; the backup watchdog's next natural tick (03:23Z) is the post-deploy proof — NO masking ping.

## 1-prev-prev-prev. Current state (v0.4.1.18 — Session 191 (THE ATTENTION SURFACE: the notifications count reaches the chrome + the page gains severity groups + filter chips), 2026-10-06. THE ROUND (the independently-chosen S190-named candidate — the 15-minute review found the app STABLE at v0.4.1.17: ladder green 577/577, live healthy sw v426 schema 63, agent-browser QA clean, the owner-account pass clean; the chosen gap: the notifications surface was the app's ONLY major unguarded page — ZERO tests, its count reached NO chrome surface (the owner's real data: 15 unreviewed ideas, visible only after two clicks), and its list rendered FLAT despite the subtitle promising "overdue, upcoming, and stale"; the round serves both jobs — unreviewed ideas = never lose an idea, overdue/stale = never lose your place — and both mandatory round directives: styling detail + features). THE BUG FOUND + FIXED FIRST (pre-existing, real, latent): --badge-pending-bg/-fg was REFERENCED since R2.1 — the notifications "Soon" chips/icons/accent bars (notifications.css ×3) AND variables.css --status-warning-soft → the task-controls status dots — but NEVER DEFINED in any sheet: every warning surface silently rendered unstyled (transparent chips, inherited inks, NO accent bar; an invalid var() makes the whole declaration IACV at computed-value time). The pair is now defined — light #FBF0D4/#7A580C at 5.73:1, dark #332C17/#DCC078 at 7.83:1 (amber = "waiting/due soon", the --warn/--color-warning family) — and qa/s191-attention-surface.mjs proves 16 floors ALL PASS (the pair, the chrome pills, the group head labels, the count pills, both themes). THE CHROME (hib-init.js v12, wireNotifBadge — painted after the user chip render, fail-silent): a memoized throttled GET /api/notifications?counts=1 (the NEW lightweight mode — {count,urgent,warning,info}, the same indexed queries, no HTML) paints (1) a severity-tinted COUNT PILL on the rail's user chip (urgent>0 → the danger family / warning>0 → the amber pending pair / else the spark family — soft fills + AA inks, a 2px --card separation ring so it reads off the avatar, pointer-events:none (the chip stays the hit target), 99+ cap, FA digits under fa) + (2) the same pill on the account-menu Notifications row (margin-inline-start:auto — the S188 badge-column pattern) + (3) a hibana:notif-count event that mobile-nav.js v14 paints onto the More sheet's row; the sheet's open ALSO refreshes the counts (the moment of decision) as does pointerenter on the desktop account cluster, at most once a minute; the chip's aria-label carries the state ("N needing attention — Account menu" — the new nav.accountHint key finally localizes the base label, data-i18n-aria-label wired in the partial). THE PAGE (the server's grouped notifListHtml + notifications.css v12 + notifications-page.js v2): the flat list becomes severity GROUPS — section.notif-group[data-sev] in the route's sort order (urgent → warning → info), each with a STICKY head (solid --bg cover + z-index 3, the S188 sidebar pattern; severity-hued label + hairline + an aria-hidden count pill with FA digits via lib/jalali faDigits), non-empty groups only, the XSS escaping untouched (the security pin stays green); the summary chips are promoted from static readout to FILTER TOGGLES — real buttons, aria-pressed, the quiet outline baseline unpressed + the severity family's soft fill pressed, their OWN 2px focus rings (the S61 doctrine), the old static severity fills RETIRE; hash deep-links (#urgent|#warning|#info) arrive pre-filtered (history.replaceState — no entry per click; hashchange keeps back/forward working); the counts derive from the DOM after the htmx swap (one source of truth — the old parallel JSON fetch retires); without JS every group renders in severity order, fully readable (progressive enhancement honest). GUARDS: the NEW src/tests/notifications.test.ts ×7 (401 gate, the counts payload, the JSON shape, the grouped fragment order/heads/pills/sections=lists, non-empty groups only, the caught-up empty state, user-scoping) + the identity-palette S191 block ×5 (the pending pair defined + AA both themes, the chip badge geometry/ring/severity map, the row pills' badge-column pattern, the sticky heads + chips-as-buttons + the retired static fills, the numeric floors on the real token values) + the NEW e2e/s191-notifications.spec.ts ×9 (the groups + the sticky proof; the filter chips narrow + the URL hash + the focus ring under keyboard modality; the #warning deep-link; the chrome badge + menu pill + the CSSOM auto-margin rule + the geometric end-edge proof; the mobile 390 sheet pill; the FA/RTL twin — فوری/به‌زودی/توجه + ۲/۴ Persian digits + the FA aria; the dark twin; the caught-up user with NO badge; 0 console/page errors). Cache-bust: notifications.css v11→v12 ×23 · quicknotes.css v45→v46 ×25 · variables.css v25→v26 ×27 · claude-dark-theme.css v28→v29 ×26 · notifications-page.js v1→v2 · hib-init.js v11→v12 ×24 · mobile-nav.js v13→v14 ×20 · i18n-en.js v95→v96 ×26 · i18n.js v149→v150 ×26 + the i18n-fa v89→v90 lazy literal; sw v426→v427; package 0.4.1.17→0.4.1.18; parity 1565/1565 (+4 keys: notif.filterAll/filterHint/needsAttention + nav.accountHint). LADDER: typecheck 0 · vitest 589/589 (+12) · eslint 0 err (162-warn baseline) · build 79 · wiring canonical · cache-bust PASS · FULL e2e 377/377 (368 + the 9 new) across all 79 spec files, zero flakes (17.3m) · smoke ALL PASS · bundle-size PASS (+13.8%) · agent-browser QA clean (EN light + dark + FA/RTL + mobile 390; 0 console/page errors; VLM audits 4/4 — the three groups + count pills + the chips row + the chip badge with its ring on every theme, the Persian digits + mirroring, the mobile sheet pill; the VLM's 'no blue accent on Heads-up items' = the ORIGINAL design — info is the quiet family, the icon tint carries it — and its Soon-amber observation is the fixed pair finally painting). RELEASED (2026-10-06): pushes 251bf2e (feature) + 7d535e0 (docs rotation) → CI 37384455116 + 37384906270 GREEN → CD 37386103453 + 37386226838 GREEN (the normal chain — no runner starvation this round) → LIVE hibana.ir @ v0.4.1.18 — byte-verified qa/s191-live-verify.mjs ALL GREEN (the 9 wired assets IDENTICAL off notifications.html + the shared chrome set off projects.html + the lazy i18n-fa twin via the live i18n.js literal — the script fix during the pass: the literal rides the minifier's DOUBLE quotes; sw v427; health ok/up/63 — no migration) + the OWNER-ACCOUNT pass clean on the REAL data (the badge '15'/info family + the aria '15 needing attention — Account menu' after the SW's one-cycle update reload — the S69 settle behavior, honest, NOT a defect; the ONE Heads up group with 15 items + the sticky head + the chips row; the #info filter hash + aria-pressed; the mobile 390 More sheet's 15 pill; the dark twin exact; 0 console/page errors; VLM live audits 2/2) → tag v0.4.1.18 on 7d535e0 → zip hibana.0.4.1.18.zip (584 files, integrity OK, secret-scan clean — the 8 credential values ONLY in credentials.md, the owner's intentional PC copy; the 4 account-id hits = the pre-existing S93 public surface) in /home/z/upload + the sandbox download folder → --restore-html. HEALTHCHECK (honest form): checked after release below.

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
