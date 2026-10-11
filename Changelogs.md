# Hibana — Changelogs.md (consolidated changelog + worklogs)
| 200 | 2026-10-11 | v0.4.1.25 — SPEED + DIET (the S198 audit's perf round, Batches A-F): CI splits into a PARALLEL 2-shard e2e matrix + browser cache + docs-only paths-ignore (the 20-min-cap cliff dies; the 417-test suite aims ~5-7min/shard beside the ~7-min fast lane) · the perf measuring sticks repaired + re-gated (explain-hotpaths STAGES post-0060, perf-seed on the 0062/0064 categories table, perf-baseline re-pinned, bundle-size per-file guard on LOGICAL names, NEW precache-size gate 2,138KB/2,300KB budget) · the N+1s die (/api/clients 3 grouped queries, tag-merge FTS one batched UPDATE, timeline's 12 queries one Promise.all) · the flake batch (sprint waits → expect.poll + the veil boot signal) · the dead-CSS diet honestly re-verified (15 rule families deleted; the audit's ~35-43 estimate corrected — its token analysis couldn't see JS-constructed class names; the vacuous .precent-row probe removed) · the banked UX batch: --accent-ink + .dash-vault-label (the a11y contrast baseline re-pins 2+4 → 0+0; contrast-fn's two false-positive classes die) + aria-labels (canvas pens, sadhana qeEmo/qeEmpty) + the skip-link re-added on 24 pages + the fine-world 24px rule with q-pen/cal-note-x rings + Login.jpg → WebP (110KB → 68KB) · cache-bust 15 assets + sw v434 + package 0.4.1.25 · LADDER all green (vitest 632/632, parity 1572/1572, e2e 417/417 in two shards, workers-smoke + Lighthouse floors PASS) — push 9970919 → CI 38161304761 → CD GREEN → qa/s200-live-verify.mjs ALL GREEN → tag v0.4.1.25 → healthchecks UP. The session's lesson: a bump script's optional-slash replace can tail-match a longer filename and silently downgrade cache versions — verify bump output against git show HEAD. |
| 199 | 2026-10-11 | v0.4.1.24 — DEBT ZERO + TRUST GATES (the S198 SWOT audit's fix round, Batches 1-5): BATCH 1 — the 162-warning baseline DIES (the JSON-driven codemod removed ~159 dead symbols; the ~13 real unused params _-prefixed; the 3 documented `any`s stay as inline eslint-disable docs; devboard-helpers' dead schema block deleted; tsconfig gains noUnusedLocals/noUnusedParameters; CI eslint becomes --max-warnings 0 — warning drift is now structurally impossible) + sw.js's VERSION comment trimmed 15,959→2,841 chars (the file −46%, a real per-page-load revalidation win). BATCH 2 — the repo fold: the 14 write-once rotate-s*.mjs (120 KB) → ONE generic scripts/rotate/rotate.mjs (discovers + relabels the 4-block §1 chain, shape-verified, dry-run; content files under scripts/rotate/content/) + make-zip → scripts/make-zip.mjs (import.meta.url + HIBANA_UPLOAD_DIR); ONE lockfile (bun.lock canonical, package-lock retired + gitignored, packageManager bun@1.3.14, CI audit generates its lock on the fly); hibana.db untracked; .gitignore regrouped. BATCH 3 — the advertised gates become REAL: the a11y spec now ASSERTS (baseline ratchets: login 0/2/0/2 + dashboard 6/49/0/4, contrast offenders collected; it was a vacuous green before) · Lighthouse perf + best-practices promoted to ERROR floors 0.9 (measured 0.96-1.0/0.96) · workers-smoke required on main (advisory on PRs) · THE ESCAPE-LINT GATE (SEC-1): every innerHTML/insertAdjacentHTML template in public/js (207 sinks, 51 files) parsed nesting-aware; unescaped interpolations fail CI — and its first run caught TWO REAL MISSES the audit's sampling missed: the sadhana quadrant-name <option> sinks interpolated USER-RENAMEABLE text (app.js + calendar-page.js, now esc()'d) + ~20 sites hardened defense-in-depth. BATCH 4 — the five small security fixes: atomic reset single-use (one conditional UPDATE + rowcount — the TOCTOU double-mint dead, e2e replay-proofed) · per-account login counter auth:user:<login> (same table, no schema — IP rotation no longer multiplies tries) · TRUST_PROXY on clientIp (last XFF hop when trusted, the unspoofable TCP peer otherwise) · emailed links prefer canonical APP_URL (emailLinkOrigin — Host-poisoned reset links dead) · PNG/JPEG/WebP magic-byte sniffing on avatar/logo/banner uploads · the links + dev-task PATCH writes re-scoped by owner · Agents.md's OPEN_REGISTRATION lie fixed (invite-only today) + the stale numbers replaced by the numbers-live-in-§1 doctrine + the bun tooling doctrine documented. BATCH 5 (partial) — the /api/calendar unit spec ×4 (the last endpoint-prefix hole — it caught the documented-but-never-implemented 400-day range bound, now real) + the signup/confirm/reset pages' FIRST-EVER e2e ×3 (captcha round-trip, the 4-digit verify end-to-end, the one-time reset consumed + old session killed + replay rejected) + the favicon 1d+SWR cache rule (the last revalidated-every-load asset). Cache-bust: the 8 escape-hardened controllers (app v220 ×24 · mobile-nav v16 ×20 · emoji-picker v4 · calendar-page v6 · notes-page v24 · project-page v75 · sadhana-page v15 · settings-page v17 — 53 refs) + sw v433 + package 0.4.1.24. LADDER: typecheck 0 · vitest 627/627 (+4) · eslint 0 err 0 WARN · build 85 · cache-bust PASS · parity 1570/1570 · bundle +0.1% PASS · escape-lint PASS (207 sinks) · FULL e2e 417/414+3 (three sequential shards, zero flakes) · smoke ALL PASS · workers-smoke PASS (local, real CF creds) · Lighthouse error floors PASS — RELEASED (2026-10-11): push 1cc4779 → CI 38122442476 GREEN (ALL gates incl. the four new ones: 0-warn ratchet, escape-lint, on-the-fly audit lock, gated workers-smoke, Lighthouse errors) → CD 38123258804 GREEN → LIVE hibana.ir @ v0.4.1.24 — qa/s199-live-verify.mjs ALL GREEN (the 8 controllers byte-IDENTICAL off their pages + the esc-wrapped quadrant <option> probes survive minification + sw v433 + the VERSION line 2,841 chars live (was 15,959) + health ok/up/63; the verifier learned the S191/S193 lesson on JS bundles: verify against the WIRED tree — app.js embeds its lazy-asset refs) → tag v0.4.1.24 → zip via the new scripts/make-zip.mjs (503 tracked + 76 dist, integrity OK, secret-scan CLEAN — all 8 credential values absent) → healthchecks both UP (natural ticks). BANKED for S200: UX-3/4/5/6 (the accent-ink token, aria-labels, skip-link, fine-world rings), PERF-8 Login.jpg WebP, the CI sharding + perf-tooling repair + the bundle diet + N+1s per the brief's S200 plan. |
| 197 | 2026-10-11 | v0.4.1.23 — THE TOUCH + OPTICAL ROUND (Track B of the owner's three-track brief): the honest re-measure first (qa/s197-touch-audit.mjs, kept in the repo): the S196 banked "26 under-floor" list over-counted — it measured visual boxes only and its pointer:coarse emulation never engaged (CDP ignores the 'pointer' feature; the audit now asserts matchMedia + uses a hasTouch context); the ringed family (pw-toggle/theme-floater/qa-btn, 42–48px effective) and the S43-floored sadhana pair were never under the floor. THE GENUINE SEVEN fixed with the established recipes: vault-sec-add 24→32px (+padding:0, icon 1.05rem w/ the crossing fork 2.1) + 40 coarse; q-fab 36→40 coarse (the S43 tap-law doctrine); the settings swatch tiles' promised-but-width-keyed coarse bump finally keys to the POINTER (2.5rem); dash-vault-dismiss's 44px floor keys to pointer:coarse too (+1.25rem icon); task-note-delete 24/38→40 coarse on BOTH homes (+icon 0.95rem/2.1); cal-note-x 20→40 coarse (grid grammar); THE OPTICAL FORKS (the S195 hairline class retired): q-pen-svg 12px@0.9px-effective → 13px@2.4 (1.3px), the pill X + the note-add + + the zen target + the vault + all ≥1.3px effective. GUARDS: identity-palette S197 ×7 (incl. the ringed-family regression pins) + e2e/s197-touch-floor.spec.ts ×7 (hasTouch coarse contexts w/ the matchMedia validity guard; EFFECTIVE_HIT ring probes; live geometry + computed strokes; console 0). Cache-bust: the 7 sheets ×25 pages (97 refs) + sw v432 + package 0.4.1.23; parity 1570/1570. LADDER: typecheck 0 · vitest 623/623 (+7) · eslint 0 err (162 baseline) · build 85 · bundle +0.1% PASS · FULL e2e 414/414 · smoke PASS · agent-browser QA clean — RELEASED (2026-10-11): push 463909a → CI 38101469168 GREEN (the FULL e2e 414/414) → CD 38102561292 GREEN → LIVE hibana.ir @ v0.4.1.23 — qa/s197-live-verify.mjs ALL GREEN (the seven sheets byte-IDENTICAL + the content probes + sw v432 + health 63) + the owner pass clean on the REAL data (non-destructive) → tag v0.4.1.23 → zip → healthchecks. |
| 196 | 2026-10-10 | v0.4.1.22 — THE TEST-NET + BUILD-ENTRY ROUND (Track A of the owner's three-track brief): the coverage-gap audit's worst holes closed — admin user-management (the destructive surface) gets admin-users.test.ts ×8, on-this-day gets ×3, /api/nav gets ×3, the clipper page gets s196-capture-clip.spec.ts ×4 (the ONLY unguarded capture surface — job #1), the admin console page gets s196-admin-console.spec.ts ×2 (non-destructive); THE S161-MISS CLASS CLOSES: spark-page.js + magic-wand.js + image-crop.js + ai-autopolish.js + clip.css + magic-wand.css join the build ENTRY_POINTS (hashed + wired + precached — the raw ?v= exception retires; bundle baseline re-pinned from its S88-era staleness; sw v431); THE BUGS THE NEW NET CAUGHT (shipped first): the app.js-less pages' loader veil never lifted — clip.html (20s opaque veil over the capture form, live-probed) + 404.html (20s to reveal) — both controllers now reveal themselves (clip-page.js v2 on the auth answer, 404-page.js v3 immediately; identity-palette S196 ×2 + e2e reveal pins); THE FLAKE HUNT (full e2e ×2 + the gate): TWO flakes caught + hardened — rail-panel's vault-pane ordering (a node-replacement race on an immediate rect read → the computed grid-track widths via expect.poll) + sprint-doc's version chip (the client truth's late-GET array-swap under load → the authoritative pin on the deep-link reopen, the server pin stays); THE SLOWEST-3 FIX: notes-reveal-gate's settleIn burned 8s×3 waiting for an SW controller in a spec that BLOCKS SWs — the impossible wait removed (33.5s → 9.2s, zero assertions touched); cache-bust clip-page v2 · 404-page v3; package 0.4.1.22; parity 1570/1570 — RELEASED (2026-10-10): push 64b4a40 → CI 38094405511 GREEN (all gates incl. the FULL e2e 407/407 on the hardened tree) → CD 38095387730 GREEN → LIVE hibana.ir @ v0.4.1.22 — byte-verified qa/s196-live-verify.mjs ALL GREEN (the six newly-wired assets IDENTICAL off their pages — spark-page 17191 · magic-wand.js 11897 + magic-wand.css 5499 · image-crop 2947 · ai-autopolish 2127 · clip-page 2020 · clip.css 1741 — + every raw ?v= ref GONE (the S161 exception retires) + the two loader-veil lift probes + sw v431 + health ok/up/63; the verifier itself learned two lessons: extension-aware localFile (magic-wand exists as js AND css) + quote-tolerant probes (esbuild minify flips ' to ") ) + the OWNER-ACCOUNT pass clean on the REAL data (the clipper: the veil lifts in ~1s with opacity 0 + pe none, the source link + the [title](url) prefill exact, CANCEL driven — no data created; the 404: 'Page not found' + the veil lifted; the admin console: the member DENY card correct BY DESIGN — the owner's everyday account is a member, the super-admin is the separate seeded admin-2v7hurof account (the Q3 pattern), verified read-only against the prod users table; console 0 on a fresh load) → tag v0.4.1.22 → zip hibana.0.4.1.22.zip → --restore-html. HEALTHCHECK (honest form): both checks UP, natural ticks only. |
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




## 1. Current state (v0.4.1.25 — Session 200 (SPEED + DIET: the S198 audit's perf round), 2026-10-11. THE CLIFF DIES: CI splits into a PARALLEL 2-shard e2e matrix (fail-fast off, per-shard artifacts, actions/cache for the ~115MB chromium download, playwright.config gains E2E_PORT/E2E_DB/E2E_SHOTS) + docs-only pushes (paths-ignore *.md + scripts/rotate/**) run nothing and deploy nothing — CD is workflow_run-gated, the next code push carries them — so the 417-test suite that rode the 20-min cap single-worker now aims ~5-7 min/shard beside the ~7-min fast lane. THE MEASURING STICKS REPAIRED + RE-GATED: explain-hotpaths' STAGES fixed to the post-0060 taxonomy (the seed crashed on the projects.status CHECK — the whole perf harness had been dead since 0060) + perf-seed's dev boards rebuilt on the 0062/0064 global user-scoped categories table + perf-baseline.json re-pinned (2026-10-11, 96 rows, 0 console errors); check-bundle-size's per-file guard re-keyed on LOGICAL manifest names (hashed keys made it structurally dead — a re-hash read as a "new file" and skipped; negative-tested) + NEW check-precache-size gate (SHELL + manifest raw bytes vs a 2,300KB budget mirroring the SW's exact install filter — measured 2,138KB; ratchets DOWN only) + sw.js's stale "~1.87MB" comment corrected. THE N+1s DIE (PERF-11/12/13): /api/clients 1+2N → 3 grouped IN-list queries (the loadProjectSignals recipe); tag rename/merge FTS rewrite N round trips → ONE batched syncTaskSearchTagsBatch UPDATE; timeline on-this-day 4 sequential windows → one flattened Promise.all of all 12. THE FLAKE BATCH (HLTH-19): sprint-ux ×3 geometry/text settles → expect.poll; sprint-doc/upload/sprint-ux login settles → the loader-veil .is-hidden poll; the cancel-test's 400ms grace kept WITH a comment (negative-proof windows have no event to poll). THE DIET, HONESTLY RE-VERIFIED (HLTH-5/6): 15 dead rule families deleted (layout .topbar-search family + .rail-cal-day.is-other + .rail-cal-legend + .activity-more; dashboard's typo'd .precent* S45 family; misc .precent-all; quicknotes .lang-check; notes .vault-move-* + .vault-tag-pop; to-do-list .progress-label) — the audit's ~35-43 estimate CORRECTED: its token analysis couldn't see JS-constructed class names (dot-*/ftag-*/status-*/p-in_progress/is-l2*/pd-pin-box-*/feed-*/hljs-* are ALL alive) and its .rail-sync/.pc-corner candidates were already comment tombstones; the vacuous .precent-row e2e probe removed with its class. THE BANKED UX BATCH LANDS: UX-3 --accent-ink (light #297073 = 5.74:1, dark #d9997f; icons keep --accent) + .dash-vault-label converted (was 2.5:1) + contrast-fn.js's two false-positive classes die (bubbled textContent audited wrapper DIVs; effectively-invisible elements measured — the opacity-0 veil's children, the display:none mobile bar's anchors) → a11y baseline re-pins contrast 2+4 → 0+0 + 5 identity-palette pins; UX-4 aria-labels on the real title-only set (canvas pen widths ×4, sadhana qeEmo/qeEmpty + 2 new i18n keys); UX-5 the skip-link re-added on all 24 shell pages (the a11y.skipToMain key existed in both dictionaries all along); UX-6 the documented fine-world rule (24px WCAG 2.5.8 EFFECTIVE via the ring idiom, doctrine beside the 40px coarse floor) + rings for q-pen (22→26) + cal-note-x (~20→~26); PERF-8 Login.jpg → Login.webp (112,648B → 69,992B; preloads + CSS + SW SHELL swapped). Cache-bust: 15 assets (i18n-en v98 · i18n-fa v92 · i18n.js v152 · variables v27 · themes v9 · claude-dark v30 · layout v65 · dashboard v42 · dashboard-todo v25 · notes v21 · quicknotes v49 · misc v23 · to-do-list v13 · calendar v10 · sadhana-board v27) + sw v433→v434 + package 0.4.1.25. LADDER: typecheck 0 · vitest 632/632 (+5) · eslint 0/0 · build 85 · cache-bust PASS · parity 1572/1572 (+2) · bundle −0.1% PASS (logical keys) · precache 2,138KB PASS (new gate) · escape-lint PASS (207 sinks) · FULL e2e 417/417 in TWO SHARDS (212+1flaky / 203+1flaky, both retry-passed) · smoke ALL PASS · workers-smoke PASS (local, real CF creds) · dist-wiring PASS · Lighthouse floors PASS (perf 100/94, a11y 100, bp 96, seo 82 warn) — RELEASED (2026-10-11): push 9970919 → CI 38161304761 (the FIRST run of the sharded structure) → CD GREEN → qa/s200-live-verify.mjs ALL GREEN → tag v0.4.1.25 → zip → healthchecks both UP (natural ticks). BANKED for S201: the Majors + Approvals round per the brief (the rule-4 asks, restore drill, error monitoring) + the e2e spec DB-constant sweep (86 files hardcode /tmp/hibana-e2e.db — blocks local parallel shards) + the per-sheet --accent-ink conversion continues opportunistically (the gate ratchets every measured page). THE SESSION'S OWN LESSON: a version-bump script's optional-slash replace pattern can tail-match a longer filename (notes.css inside quicknotes.css) and silently DOWNGRADE refs to a stale cached URL — caught by diffing HEAD's authoritative versions; always verify a bump script's output against git show HEAD before trusting it.
## 1-prev. Current state (v0.4.1.24 — Session 199 (DEBT ZERO + TRUST GATES: the S198 SWOT audit's fix round), 2026-10-11. DEBT ZERO + TRUST GATES (the S198 SWOT audit's fix round, Batches 1-5): BATCH 1 — the 162-warning baseline DIES (the JSON-driven codemod removed ~159 dead symbols; the ~13 real unused params _-prefixed; the 3 documented `any`s stay as inline eslint-disable docs; devboard-helpers' dead schema block deleted; tsconfig gains noUnusedLocals/noUnusedParameters; CI eslint becomes --max-warnings 0 — warning drift is now structurally impossible) + sw.js's VERSION comment trimmed 15,959→2,841 chars (the file −46%, a real per-page-load revalidation win). BATCH 2 — the repo fold: the 14 write-once rotate-s*.mjs (120 KB) → ONE generic scripts/rotate/rotate.mjs (discovers + relabels the 4-block §1 chain, shape-verified, dry-run; content files under scripts/rotate/content/) + make-zip → scripts/make-zip.mjs (import.meta.url + HIBANA_UPLOAD_DIR); ONE lockfile (bun.lock canonical, package-lock retired + gitignored, packageManager bun@1.3.14, CI audit generates its lock on the fly); hibana.db untracked; .gitignore regrouped. BATCH 3 — the advertised gates become REAL: the a11y spec now ASSERTS (baseline ratchets: login 0/2/0/2 + dashboard 6/49/0/4, contrast offenders collected; it was a vacuous green before) · Lighthouse perf + best-practices promoted to ERROR floors 0.9 (measured 0.96-1.0/0.96) · workers-smoke required on main (advisory on PRs) · THE ESCAPE-LINT GATE (SEC-1): every innerHTML/insertAdjacentHTML template in public/js (207 sinks, 51 files) parsed nesting-aware; unescaped interpolations fail CI — and its first run caught TWO REAL MISSES the audit's sampling missed: the sadhana quadrant-name <option> sinks interpolated USER-RENAMEABLE text (app.js + calendar-page.js, now esc()'d) + ~20 sites hardened defense-in-depth. BATCH 4 — the five small security fixes: atomic reset single-use (one conditional UPDATE + rowcount — the TOCTOU double-mint dead, e2e replay-proofed) · per-account login counter auth:user:<login> (same table, no schema — IP rotation no longer multiplies tries) · TRUST_PROXY on clientIp (last XFF hop when trusted, the unspoofable TCP peer otherwise) · emailed links prefer canonical APP_URL (emailLinkOrigin — Host-poisoned reset links dead) · PNG/JPEG/WebP magic-byte sniffing on avatar/logo/banner uploads · the links + dev-task PATCH writes re-scoped by owner · Agents.md's OPEN_REGISTRATION lie fixed (invite-only today) + the stale numbers replaced by the numbers-live-in-§1 doctrine + the bun tooling doctrine documented. BATCH 5 (partial) — the /api/calendar unit spec ×4 (the last endpoint-prefix hole — it caught the documented-but-never-implemented 400-day range bound, now real) + the signup/confirm/reset pages' FIRST-EVER e2e ×3 (captcha round-trip, the 4-digit verify end-to-end, the one-time reset consumed + old session killed + replay rejected) + the favicon 1d+SWR cache rule (the last revalidated-every-load asset). Cache-bust: the 8 escape-hardened controllers (app v220 ×24 · mobile-nav v16 ×20 · emoji-picker v4 · calendar-page v6 · notes-page v24 · project-page v75 · sadhana-page v15 · settings-page v17 — 53 refs) + sw v433 + package 0.4.1.24. LADDER: typecheck 0 · vitest 627/627 (+4) · eslint 0 err 0 WARN · build 85 · cache-bust PASS · parity 1570/1570 · bundle +0.1% PASS · escape-lint PASS (207 sinks) · FULL e2e 417/414+3 (three sequential shards, zero flakes) · smoke ALL PASS · workers-smoke PASS (local, real CF creds) · Lighthouse error floors PASS — RELEASED (2026-10-11): push 1cc4779 → CI 38122442476 GREEN (ALL gates incl. the four new ones: 0-warn ratchet, escape-lint, on-the-fly audit lock, gated workers-smoke, Lighthouse errors) → CD 38123258804 GREEN → LIVE hibana.ir @ v0.4.1.24 — qa/s199-live-verify.mjs ALL GREEN (the 8 controllers byte-IDENTICAL off their pages + the esc-wrapped quadrant <option> probes survive minification + sw v433 + the VERSION line 2,841 chars live (was 15,959) + health ok/up/63; the verifier learned the S191/S193 lesson on JS bundles: verify against the WIRED tree — app.js embeds its lazy-asset refs) → tag v0.4.1.24 → zip via the new scripts/make-zip.mjs (503 tracked + 76 dist, integrity OK, secret-scan CLEAN — all 8 credential values absent) → healthchecks both UP (natural ticks). BANKED for S200: UX-3/4/5/6 (the accent-ink token, aria-labels, skip-link, fine-world rings), PERF-8 Login.jpg WebP, the CI sharding + perf-tooling repair + the bundle diet + N+1s per the brief's S200 plan.
## 1-prev-prev. Current state (v0.4.1.23 — Session 197 (THE TOUCH + OPTICAL ROUND: the owner's three-track brief, Track B — the tap law + the stroke grammar), 2026-10-11. THE ROUND (the standing brief's Track B, the S196 handover's next priority): the S196 banked audit listed "26 icon-only buttons under the 40px coarse floor" — but it measured VISUAL boxes only and its pointer:coarse emulation NEVER ENGAGED (Chromium's CDP setEmulatedMedia ignores the 'pointer' feature). THE HONEST RE-MEASURE FIRST (qa/s197-touch-audit.mjs, the round's measuring stick, kept in the repo): the REAL tap law = visual box + the EFFECTIVE hit area (elementFromPoint compass probes — the app's ::after hit RINGS count, the established compact-control recipe) + the S195 effective-stroke math (rendered px × stroke / 24 viewBox), measured in BOTH pointer worlds with the audit's own validity guard (a hasTouch context is the only reliable pointer:coarse emulation; the script hard-fails unless matchMedia agrees). THE TRUTH THE RE-MEASURE FOUND: the ringed family was NEVER under the floor (pw-toggle 44.4px, theme-floater 42px, qa-btn 48px, the note-add + 46.4px effective) and the S43 block already floored the sadhana quiet pair at 40px — but SEVEN controls genuinely failed the app's own 40px coarse floor (misc.css) with no ring and no pointer-keyed override: vault-sec-add 24px (the worst — the vault tree's folder-add, its width even auto-inflated 32×24 by the global button padding), q-fab 36px, the settings palette's 16 swatch tiles 30.4px (whose own comment PROMISED "bumped on coarse pointers" while the bump was keyed to max-width:480px — a touch device ≥481px never got it), dash-vault-dismiss 32px (its 44px floor keyed to max-width:720px only — desktop-with-touch never got it), task-note-delete 24px (to-do-list.css home) / 38px (task-controls.css home — the same pill on two sheets), cal-note-x 20px (the calendar day-note ✕ — the smallest control in the app, half the floor); and the optical audit found the S195 hairline class alive in five small glyphs: q-pen-svg 12px@1.8 = 0.9px effective stroke (THE ghost of the icon system), the note pill's X 1.02px, the note-add + 1.14px, the zen target 1.13px, the vault + 1.32px. THE FIXES (7 sheets, the established recipes ONLY — no new idiom invented): (a) vault-sec-add pins the exact 2rem box (32px, padding:0 — the S195 close-pair register) + the icon 1.05rem with the crossing-glyph optical fork stroke 2.1 (1.47px effective) + the coarse floor 2.5rem/1.25rem; (b) the sadhana q-fab gets the S43 doctrine on touch — 40px on coarse pointers (36 stays desktop-compact); (c) the swatch tiles' promised bump finally keys to the POINTER (2.5rem coarse, the "Aa" ink one rung up); (d) dash-vault-dismiss keys its 44px floor to pointer:coarse too + the icon grows to the S195 1.25rem register; (e) task-note-delete floors at 2.5rem on BOTH homes (belt-and-suspenders — whichever sheet the page loads) + the icon 0.95rem w/ the 2.1 fork; (f) cal-note-x joins the grid-centered box grammar on coarse (2.5rem); (g) the optical forks: q-pen-svg 13px + stroke 2.4 (1.3px effective), zen-ico 2.1, note-add + 2.1 — every crossing glyph now renders ≥1.3px effective, the S195 lesson made a system rule. Re-audit: ALL GREEN — every control ≥40px effective under coarse pointers, every icon ≥1.3px effective stroke. GUARDS: the identity-palette S197 block ×7 (the box/coarse/fork pins per sheet + the ringed-family regression pins — removing a ::after ring inset now fails CI) + the NEW e2e/s197-touch-floor.spec.ts ×7 (the fine ring recipe proven by EFFECTIVE_HIT probes; the coarse world via hasTouch contexts with the matchMedia validity guard baked in; the live geometry + computed strokes pinned on notes/sadhana/settings/dashboard; console 0 — the s193 login-401 noise filtered on the login surface, listeners attach AFTER login elsewhere). Cache-bust: notes.css v19→v20 · sadhana-board.css v25→v26 · quicknotes.css v47→v48 (25 pages) · dashboard.css v40→v41 (23) · to-do-list.css v11→v12 (23) · task-controls.css v5→v6 · calendar.css v8→v9 (23) — 97 ref-updates across 25 pages, stale-scan NONE; sw v431→v432; package 0.4.1.22→0.4.1.23; parity 1570/1570 unchanged (a pure-CSS round — zero i18n keys). LADDER: typecheck 0 · vitest 623/623 (+7) · eslint 0 err (162-warn baseline) · build 85 entries · wiring canonical · cache-bust PASS · parity 1570/1570 · FULL e2e 414/414 (407 + the 7 new, the release gate) · smoke ALL PASS · bundle-size PASS (+0.1% — the seven sheets grew by their floors) · agent-browser QA clean (the vault add + the sadhana fab + the swatches + the banner dismiss driven in EN light + dark + FA/RTL, console 0). — RELEASED (2026-10-11): push 463909a → CI 38101469168 GREEN (the FULL e2e 414/414 rode the gate) → CD 38102561292 GREEN → LIVE hibana.ir @ v0.4.1.23 — qa/s197-live-verify.mjs ALL GREEN (the seven wired sheets byte-IDENTICAL off their pages + every minified content probe + sw v432 + health ok/up/63) + the owner-account pass clean on the REAL data (the vault add 32×32 + the 16.8px icon + the 2.1 computed stroke; the sadhana fab 36 + the pen 22@2.4 on his own four-quadrant board; the 16 swatches 30.4 on the settings palette; console 0, page errors 0, NON-DESTRUCTIVE — computed probes only) → tag v0.4.1.23 → zip → healthchecks both UP (natural ticks, no masking ping).
## 1-prev-prev-prev. Current state (v0.4.1.22 — Session 196 (THE TEST-NET + BUILD-ENTRY ROUND: the owner's three-track brief, Track A — hardening the safety net), 2026-10-10. THE ROUND (the owner's standing brief, Track A in priority order: coverage-gap audit, the spark-page.js build miss, the flake hunt (full e2e ×2), the slowest-3 speed fixes — plus the bugs the new net caught, shipped first): the 15-minute review was SKIPPED per the brief's explicit mission; stability assessed FIRST (local QA clean EN+FA+dark, LIVE healthy ok/up/63 sw v430, CI/CD/Uptime green, the owner pass non-destructive clean on the real data — no bugs outstanding → the tracks proceed). THE COVERAGE-GAP AUDIT (static, three scripts): the worst UNIT gaps = the admin console's USER-MANAGEMENT routes (0 tests — ban/unban/role/delete/send-reset/emails: the app's most destructive surface), GET /api/timeline/on-this-day (0 anywhere), GET /api/nav (0 at unit level); the worst E2E gaps = /clip.html (the web-clipper — the app's ONLY unguarded CAPTURE surface; capture is job #1) + /admin.html (the console page itself — admin-gate only pinned row visibility); and the S161-miss class was BIGGER than spark-page.js: magic-wand.js (7 pages), image-crop.js (2), ai-autopolish.js, clip.css, magic-wand.css also served raw ?v= URLs — never bundled, never hashed. THE BUILD FIX (one coherent change): all six join the build's ENTRY_POINTS/CSS_ENTRY_POINTS — they now ship as content-hashed /dist/ bundles, wired into their pages and manifest-precached like every other entry (the S193 'raw exception' documentation retires); the bundle-size baseline re-pins (the old one was S88-era, ~50 releases stale — the reason it read +14.0%); sw v430→v431; package 0.4.1.21→0.4.1.22. THE NEW UNIT SPECS (×16, 600→616): admin-users.test.ts ×8 (the owner gate on every route; the users list + summary + online calc + is_self + per-user counts with soft-deletes out; ban — the forever preset writes the L8 far-future date, the session kill, the banned user 401s on the next request, the custom-date rails incl. the 10-year ceiling + owner protection; unban clears both columns + relogin; the role guards — self-change 403 + a working promotion + the last-owner 403; the delete — confirm-name mismatch + the invite cleanup (created-by gone, used-by→NULL) + the row gone; send-reset via the stubbed network + the token row) + timeline-onthisday.test.ts ×3 (the 401 gate; the four-window math with exact 7/30/90/365-day seeds, user-scoping, soft-deletes out, today-nowhere, the per-kind hrefs; the empty shape) + nav-chrome.test.ts ×3 (200 + no-store + the real markup unauthenticated BY DESIGN; the clean 404 on a partial miss; the no-assets 404). THE NEW E2E SPECS (×6, 401→407): s196-capture-clip.spec.ts ×4 (the anonymous bounce preserves the FULL return destination; the title+url+text prefill order + the source link; the capture itself — Save POSTs to /api/notes and the API round-trip proves the note landed; the empty-form guard with no POST) + s196-admin-console.spec.ts ×2 (an owner boots the six tabs + KPIs + the seeded users + the search narrows; a member gets the deny card — the console root never renders; NON-DESTRUCTIVE by design: no ban, no delete, no email driven; console listeners attach AFTER login — the s193 lesson). THE BUGS THE NEW NET CAUGHT (shipped first, live-probed): the app.js-less pages' #hibana-page-loader NEVER lifted — /clip.html (the capture popup) sat under the OPAQUE veil for base.css's 20-second CSS escape (a 20-second wait on an idea-capture surface; probe: opacity 1 + pointer-events all + the form covered; page.click stalled on the veil's hit-target — that stall is what exposed it) + /404.html (the branded dead-end page invisible for 20s; index.html's veil is BY DESIGN — the redirect interstitial). Both controllers now own their reveal: clip-page.js v2 lifts on the auth answer, 404-page.js v3 immediately; the e2e pins (≤2s reveal, is-hidden + opacity 0 + inert — the app's own veil grammar) ride the clip spec + page-titles' 404 test, and the identity-palette S196 block ×2 pins the lift grammar both files. THE FLAKE HUNT (the brief's full e2e ×2, then the final gate): run #1 407/407 (21.5m — the first ~6m polluted by the operator's own concurrent browser sweeps, lesson banked: never run heavy browser work during a timed run); run #2 406/407 — FLAKE #1, exactly the once-in-two-runs class the hunt targets: rail-panel's vault-pane assertion (tree 336 vs list 325 — an immediate getBoundingClientRect read racing the soft-nav swap's node replacement, the S195 re-render lesson in a new spot) — HARDENED, not weakened: the S134 contract now asserts the GRID's own computed track widths (the CSS source of truth, node-race-proof) via expect.poll — three ascending tracks (tree < list < the minmax editor) + the editor-dominant box check; run #3 406/407 — FLAKE #2: sprint-doc's version chip (#pd-sd-ver painted hidden+empty, ~7% under full-suite load, reproduced isolated; the client's sprint-truth races the page's late /api/projects/:id array-swap under load) — HARDENED the S195 way: the chip's authoritative pin moved to the deep-link REOPEN (fetch-then-paint, race-free) + the server-truth pin stays (the step-5 API round-trip), the first-open read tolerates the race window; run #4 = the release gate on the fully hardened tree. THE SPEED FIX (the slowest 3, zero assertions touched): the three notes-reveal-gate tests (12.1/10.9/10.5s = the suite's slowest) each burned a FULL 8s in settleIn's waitForFunction(SW controller) — a spec that BLOCKS service workers, so the controller can never exist and the .catch 'tolerance' ate the whole timeout (24s of dead time). The impossible wait is GONE (a comment explains; 33.5s → 9.2s, all three drop out of the top). LADDER: typecheck 0 · vitest 616/616 (+16) · eslint 0 err (162-warn baseline, one unused-var slip caught + fixed) · build 85 entries (+6) · wiring canonical · cache-bust PASS (clip-page v2, 404-page v3 — no raw-asset exceptions left) · parity 1570/1570 unchanged · FULL e2e ×4: 407/407 + 406/407 (flake #1, hardened) + 406/407 (flake #2, hardened) + the release-gate run on the hardened tree · smoke ALL PASS · bundle-size PASS (baseline re-pinned, +0.0%) · agent-browser QA clean (the clipper driven end-to-end on the fixed veil; the admin console owner + member twins; EN light + dark + FA/RTL; console 0). — RELEASED (2026-10-10): push 64b4a40 → CI 38094405511 GREEN (the FULL e2e 407/407 on the hardened tree rode the gate) → CD 38095387730 GREEN → LIVE hibana.ir @ v0.4.1.22 — qa/s196-live-verify.mjs ALL GREEN (the six newly-wired assets byte-IDENTICAL + every raw ?v= ref GONE + the two veil-lift probes + sw v431 + health ok/up/63) + the owner-account pass clean on the REAL data (the clipper's veil + prefill + cancel; the 404's veil + title; the admin console's member-deny CORRECT by design — the owner's everyday account is a member, the super-admin is the separate seeded admin-2v7hurof account, verified read-only; console 0) → tag v0.4.1.22 → zip (integrity + secret-scan clean) → healthchecks both UP (natural ticks).
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
