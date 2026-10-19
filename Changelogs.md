# Hibana — Changelogs.md (consolidated changelog + worklogs)
| 209 | 2026-10-20 | v0.4.1.35 — THE KANBAN 1:1 PARITY ROUND + THE GO WINDOWS DESKTOP REPLICATION SPEC PACK (the owner: "the kanban in the hibana is 1:1 the same as the kanban at projects.hibana.ir/kanban" + "prepare the specs to replicate this kanban in GO for a Windows app (installable + exe)"; verified live 20/20 on BOTH hosts): the parity closes in SHARED code — the embedded board wears the SAME mother container (.pd-board.db-frame + the .db-toolbar hairline header; the 100dvh floor scoped to main.board-shell; the S185 palette re-anchored) + the LABEL MANAGER (the shared devboard.js dialog; devboard.js now loads on project.html) + the ◆ sprint badge; the shared modal gains the FULL 10-op toolbar (raw markdown into the single title textarea) + the FULLSCREEN toggle (Esc exits focus FIRST); the pin badge SURVIVES the embedded board's repaints (used to vanish on +N expand); archive-done in place; sprint.html's Board link → the canonical /kanban; a live bug fixed (devboard.js on project.html double-opened the video lightbox — its handlers now scope to their own surfaces). DELIBERATE EXCEPTIONS (tested + documented in FEATURE-INVENTORY §13): /board.html's Back + icons-rail; the embedded reading-measure width; the split editor stays project-page-only (capability parity via the toolbar); the slide-over/windowing/collapse/delete-models stay per-surface. THE SPEC PACK (docs only): the six port-PLAN docs expanded to COMPLETE replication specs + UI-UX-REPLICATION-SPEC (NEW), WINDOWS-PACKAGING-PLAN (NEW — NSIS installer AND portable .exe, Wails+modernc-sqlite, GitHub-Releases auto-update, CORRECTED the wrong /api/health-version claim), GO-DESKTOP-PORT-PLAN (the master) + README (the index). +3 unit + 7 e2e + the both-hosts live verifier; ladder all green (646/646 · 456/456 ZERO flakes · all gates PASS). CI 39184567278 → CD 39185572136 GREEN; sw v444; ghost sweep CLEAN. |
| 208 | 2026-10-20 | v0.4.1.34 — THE TASK-OPTION PARITY ROUND (the owner: "creating a task doesn't show the upload button — established tasks give you the option; make sure ALL the kanban options of the original hibana live on this board"; verified live 25/25): the screenshots/attachments pipeline comes to the board's task editor (devboard.js, ported from project-page.js's S35/S46/S61/S67/S69/S86 stack, shared by board.html + sprint.html) — the Upload File paperclip (full S86 accept list: images + video/webm + pdf/csv/xlsx/docx/md/txt) shows in BOTH the new-task and edit modals; NEW tasks stage (XHR upload with the ≤1600px WebP prepare pass — image-resize.js lazy-loads on the board pages — + per-file progress rows with cancel) and PIN on save (PATCH taskId), cancel/Esc DELETES the staged shots (nothing orphans); ESTABLISHED tasks pin live + the inline pinned grid (zoom lightbox / edit-note / delete — the pde-shots-grid contract); TAGS ON CREATE (staged chips ride the create body's tags[]) + a latent title-wipe fixed (a tag chip mid-edit used to rebuild the card and drop the typed title — syncTitleToDraft now rides every re-render); the card PIN BADGE (shot_count joins the devboard payload — LEFT-JOIN COUNT with a pre-0054 fallback belt) opens the pinned-pictures dialog (zoom + unpin, reloads the board); COPY joins the card ⋯ menu (the raw title via data-raw-title). 2 i18n keys EN+FA (parity 1584/1584); +1 unit + 6 e2e (s208-kanban-shots — the owner's exact complaint, staged→save→pin API-verified→badge, cancel-deletes, edit-modal button + pinned grid + lightbox-Esc-precedence, tags-on-create, badge dialog + unpin). LADDER all green (typecheck 0 · vitest 643/643 · eslint 0 · escape-lint 220 · cache-bust · bundle +2.1% · precache +127KB · FULL e2e 449/449 quarter-shards — one s207 geometry flake under load, green standalone + on re-run; CI's e2e shard 2 flaked the same test once, GREEN after the failed-job re-run). CI 39161116606 → CD 39163566793 GREEN; sw v443. |
| 207 | 2026-10-19 | v0.4.1.33 — THE MOTHER-CONTAINER + TRUE-FULL-WIDTH + GHOST-SWEEP ROUND (the owner's three-item follow-up; verified live on BOTH hosts): (1) the kanban gets its container — .db-frame (board.html) wraps toolbar + filter + columns in ONE var(--card) surface, full-bleed, with a min-block-size floor so a short board fills the first screen; the toolbar's .card chrome retires into the frame's header row (hairline below); (2) ROOT CAUSE of "still not full width": the misc.css item-12 page-width preference ('standard', every fresh user's default) capped main.shell.shell-flush at 1366px with (0,3,2) specificity — S206 removed the rail gutter but the shell stayed a 277px-margin centered island (live-measured 1366px on a 1920 viewport); main.board-shell is now EXEMPT (same-specificity rule appended after the item-12 block + shell padding 0) — the frame is EDGE-TO-EDGE (0→viewport, e2e-pinned under the standard choice; pixel-verified white at the viewport edges); the Notes vault keeps the cap; (3) the ghost projects in the switcher ("S206 repro5/9 (self-cleaning)" — the owner read "s209 repro 9") were leaked by the S206 hang-hunt probes whose cleanup DELETE only ran on success paths — qa/s207-ghost-sweep.mjs (env-only creds, narrow patterns) RUN LIVE: 2 ghosts deleted (200/200), 7 real projects remain, 0 after; future probes get try/finally guidance. 5 new e2e (s207-kanban-frame); LADDER all green (typecheck 0 · vitest 642/642 · escape-lint 214 · cache-bust · bundle +0.8% · precache · board/sprint/label e2e 34/34); CI 39151681090 + CD 39152680541 GREEN; sw v442. |
| 206 | 2026-10-18 | v0.4.1.32 — THE KANBAN FULL-BLEED + SPRINT-BUG ROUND (the owner's four-item follow-up; 3 commits; verified live on BOTH hosts — 20/20 + the hibana.ir in-page probe): (1+2) /kanban goes TRULY full-width — the new body.rail-edge mode drops the gutter to 0 AND slides the rail entirely off-canvas (even the S136 collapsed icon strip), revealed ONLY by start-edge hover (the #rail-edge-zone tripwire, overlay reveal, 300ms grace) or keyboard focus; the zone never renders on touch/mobile; /board.html keeps the icons contract; (3) the toolbar project name drops to the control register (fs-md+600, single-line ellipsis, flexes) and the Back link retires on the entry; (4) "the sprint system is buggy" — SIX probe-confirmed bugs fixed: the all-sprints "0 items" phantom (s.items never in the payload), the task-editor "＋ New sprint" 409 save-kill (draft reused from state), the local-midnight date parse landing a day early for non-UTC users (UTC-midnight parse, pinned under Asia/Tehran), the sidebar-task → sprint/draft drop the browser always refused (dragover never preventDefaulted), the boundary rails stacking above task dots/chips (dots under rails were UNCLICKABLE), and THE LIVE HANG — the post-mutation reload GET never reached the Worker (15 probe generations: requestWillBeSent fired, wrangler tail never saw it, both hosts, ± SW, ± cache modes) → every devboard GET now dispatches with an AbortController signal + 3s deadline + one retry (validated 4/4, retries=0) + no-store. FULL e2e 437/437 (11 new); LADDER all green ×3 pushes. sw v441. Known: dated-create can overlap an older closed sprint (no INSERT-path overlap validation — documented). |
| 205 | 2026-10-18 | v0.4.1.29 — THE KANBAN ENTRY-POINT ROUND (the spec'd dedicated /kanban experience + the project switcher + the Go-desktop-readiness docs): https://projects.hibana.ir/kanban is LIVE (the zone-level Workers ROUTE projects.hibana.ir/* → hibana-prod + proxied AAAA — the account-level custom-domains API rejected the token's auth scheme, the route API accepted it; one login per host: the __Host- cookie is host-only by SEC-10 design, documented) · /kanban is a real Worker route (auth-gated like /app with the NEW optional requireAuth {loginNext} — the bounce preserves ?next=/kanban?project=…, so a bookmarked board survives an expired session; registered BEFORE coreRoutes' wildcard so OUR gate owns the redirect; serves the SAME board.html stamped no-store; /kanban.html 301; bare /board.html → /kanban) · THE PROJECT SWITCHER (spec §3.2): the board TITLE becomes the switcher — searchable popover (GET /api/projects?sort=recent, 60s cache, stage badges, aria-current, keyboard ↑↓/Enter/Esc, direction-aware RTL anchoring), IN-PLACE switching (B().load + render, no page reload, pushState ?project=, per-board filter reset), last-used default resolution (hibana-kanban-last → most-recent → the no-projects empty state) · CHROME: rail Kanban button below Projects + the compact-rail media query (the 8th destination overflowed ≤780px viewports — the account chip 16px below the 720p fold of the FIXED rail, measured; 46px tiles ≥ the 44px floor, S189 ≥48 doctrine pinned at the default rhythm, its geometry test at 900p) + mobile More-sheet row + g k + 10 i18n keys (parity 1582/1582) · PERF (spec §5): qa/s205-kanban-perf.mjs — /kanban cold 142ms vs /board.html 164ms (parity), in-place switch 123ms vs hard-nav 160ms (−23%), payload 8.6KB/15ms, caveats stated (sandbox SQLite not prod D1) · DOCS (spec §6): docs/project-kanban/ BORN — FEATURE-INVENTORY/USER-FLOWS/DATA-MODEL/API-AND-SYNC-CONTRACT/GO-DESKTOP-PORT-PLAN/TEST-MATRIX, all source-referenced, recommendations separated from verified behavior; the Go port is PLANNED (Wails leading, milestones M0-M5) NOT STARTED · THE CD REPAIR: the repo's CLOUDFLARE_API_TOKEN secret had EXPIRED (CD failed auth-error-10000 at Deploy-to-DEV) — replaced via the GitHub secrets API (sealed-box) with the session's working user token, the failed CD re-run GREEN; domain attached + deployed + LIVE-VERIFIED: qa/s205-live-verify.mjs ALL GREEN 14/14 (health ok/prod/up/63; the 302+?next contract on both hosts; 401 JSON for non-doc callers; login round-trip back to /kanban; the board renders — SportSignal 5 columns, the owner's real account; switcher 7 rows; IN-PLACE switch SportSignal→Currena with the no-navigation marker; URL ?project=…; refresh keeps it; 0 console errors) · LADDER all green: typecheck 0 · vitest 642/642 (+7 kanban-route) · eslint 0/0 · escape-lint 214 · cache-bust PASS · build 85 · bundle + precache PASS · FULL e2e 426/426 (417+9, four quarter-shards 110+113+104+99 — the sandbox kills detached background processes, quarter-shards are the local workaround) · smoke PASS · CI 39093783469 ALL GREEN → CD 39094519965 (after the secret repair, re-run) GREEN · sw v438 (SHELL + /kanban) · cache-bust: layout v66 · devboard v31 · i18n-en v99 · i18n.js v153 · i18n-fa v93 · nav v44 · mobile-nav v17 · go-to v3 · board-page v18. Lessons: an expired CI/CD secret surfaces as auth-error-10000 at the deploy step (repair = GitHub secrets API + rerun-failed-jobs); live verifiers must match BOTH login spellings (the s158 lesson applied); a race-proof switcher probe waits for the TITLE swap, not the column count. |
| 204 | 2026-10-11 | v0.4.1.28 — THE DEPENDABOT ROUND + THE ACCENT-INK SWEEP + THE MOBILE LANE (the banked-leftovers closer): the CI-plumbing dependency round in-session (hono 4.13.13 · playwright+@playwright/test 1.64.0 synced · workers-types 5.20261011.1 · @types/node 26.6.4 with ONE documented double-cast · eslint 10.12 · tsx 4.23.15 · typescript 6.0.3 — TS 7.0.2 TRIED + HONESTLY WALLED (typescript-eslint #10940) · typescript-eslint 8.71.1 · vitest 5.0.3 · wrangler 4.148 · actions/checkout v7 ×5 + upload-artifact v7 ×2; PRs #1/#6/#13/#14 closed as superseded — they carried retired package-lock.json patches) · the opportunistic --accent-ink sweep (19 accent-as-TEXT sites across notes ×14/quicknotes/dashboard/devboard/base incl. the skip-link; every remaining color:var(--accent) verified icon/border/decorative and kept; cache-bust 5 sheets ~116 refs + sw v437) · UX-17 the mobile Lighthouse lane (lighthouserc.mobile.json, formFactor=mobile, 3 runs; HONEST floors: cold login 89-90 perf, the SW-active returning-user variant 46-49 consistently — Lantern's SW pessimism — floor 0.45 binds there to catch COLLAPSE; a11y 100/bp 96/seo 82 → 0.9/0.9/warn-0.8) · LADDER all green (635/635 · e2e 417/417 two parallel shards 213+204 ZERO flakes · workers-smoke on hono 4.13.13 · desktop+mobile Lighthouse) — RELEASED: push 3891c25 → CI 38183808774 ALL GREEN (the v7 actions' + the mobile lane's first run) → CD 38184241827 GREEN → qa/s204-live-verify.mjs ALL GREEN (27 probes incl. the wired-/dist/-hash byte-proof + the __Host- regression battery) → tag v0.4.1.28 → zip 592 files → healthchecks UP. Lessons: MultiEdit applies sequentially (a failed batch leaves earlier edits landed — audit, don't assume atomicity); the Bash tool kills & subshells (parallel shards = one foreground `… & … & wait`; an empty exit-0 log is not evidence); live HTML is deploy-WIRED — probe /dist/ hashes, not canonical ?v= refs. |
| 203 | 2026-10-11 | v0.4.1.27 — THE OWNER-ACCEPTED ROUND (SEC-10 ships + the scheduled node-server major + the bebas follow-up): the owner's reply ("Push commit, deploy, Then go to next step I accept.") accepted the S202 handover's next step. SEC-10 __Host- SHIPS: SESSION_COOKIE → '__Host-hibana_session' + attributes centralized in sessions.ts's two helpers (Secure/Path=/ required, Domain forbidden — browsers enforce the contract); Secure now UNCONDITIONAL (Workers prod+dev are HTTPS; localhost is trustworthy — proven by the FULL 417 e2e's browser logins); 110 literals codemodded across 62 files; the accepted cost = every user logs in once more. @hono/node-server 1.19.17→2.1.4 (UX-13 part 2): API verified before upgrade — serve() unchanged, env.incoming raw-socket binding still injected (probe-proven, peer ::1 — ratelimit's clientIp intact), FULL 417 e2e through the v2 server. BEBAS diet (the §6 follow-up): 6 legacy .otf/.ttf deleted (~281KB), font-face.css woff2-only, sw v435→v436, package 0.4.1.27. Ride-alongs: playwright.config stale header fixed; .lighthouseci (S202's accidental commit) untracked+gitignored; superseded dependabot PRs closed. LADDER all green (vitest 635/635, parity 1572/1572, escape-lint 207, FULL e2e 417/417 two parallel local shards 213+204 ZERO flakes, workers-smoke, Lighthouse 100/100/96 + 94/100/96) — push db0bae9 → CI 38176576229 → CD 38176995829 GREEN → qa/s203-live-verify.mjs ALL GREEN (25 probes incl. the LIVE __Host- contract + /me round-trip + zero-residue logout; bebas woff2 byte-identical, 6 formats 404) → tag v0.4.1.27 → zip 588 files → healthchecks 3 UP. Lessons: the display pipeline swallowed '[h' again (Read tool = byte-truth); __Host-+Secure works on localhost but was PROVEN not assumed; superseded dependabot majors get closed with the reason.
| 202 | 2026-10-11 | v0.4.1.26 — THE APPROVED ASKS (the S201 rule-4 round; the owner's written YES per item): the vazir font diet ships (PERF-9: 21 legacy files + the never-referenced Vazir-Variable.woff2 deleted, ~1.79MB off deploys+zip; font-face.css woff2-only — the first supported format was ALWAYS woff2, zero user-visible change; sw v435 re-caches the SHELL's font CSS) · zod 3.24→4.6.6 in ONE deliberate round (UX-13 part 1: one signature fix — jsonBody's ZodType<T,any,any> → ZodType<T,any>, v4's 3rd generic is Internals and broke T's inference; v4's RFC-strict .uuid() caught the e2e specs' randomBytes-hex UUID() helpers minting ids the app NEVER mints — the app is crypto.randomUUID() everywhere, zero product impact; node-server 1→2 scheduled next code session) · PERF-16 resolved HONESTLY with NO migration (the audit's 4th table telegram_note_sessions was DROPPED by 0048 — the CREATE INDEX would have failed on apply; the other 3 access paths are PK-covered, EQP-proven SEARCH-by-covering-autoindex — rule 9 now machine-enforced by src/tests/index-coverage.test.ts ×3; schema stays 63, no bookmark ritual needed) · the banked e2e DB-constant sweep lands (86 files → e2e/fixtures/e2e-db.ts: E2E_DB/E2E_SHOTS/E2E_PORT/E2E_ORIGIN — LOCAL PARALLEL SHARDS NOW REAL, the FULL 417 ran as two parallel shards on 3017/3018; the sweep exposed + fixed the s199 reset spec's hardcoded Origin:3017 — the T6 gate 403s cross-origin POSTs) · package 0.4.1.26 · LADDER all green (vitest 635/635 +3, parity 1572/1572, e2e 417/417 in two LOCAL parallel shards — 213 + 203 + 1 contention flake solo-proven, workers-smoke + Lighthouse floors 100/95/100/96 PASS) — push 2821bef → CI 38169968432 → CD 38170407608 GREEN → qa/s202-live-verify.mjs ALL GREEN → tag v0.4.1.26. The session's lessons: zod 4 enforces the RFC 9562 uuid grammar (version 1-8 + variant 8-b — v3 accepted any hex); a spec's hardcoded port in an explicit Origin header dies the moment non-default ports become runnable. |
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




## 1. Current state (v0.4.1.35 — Session 209 (THE KANBAN 1:1 PARITY ROUND + THE GO WINDOWS DESKTOP REPLICATION SPEC PACK), 2026-10-20. THE DISPATCH: the owner's two-item agenda — (1) "Making sure the kanban in the hibana is 1:1 the same as the kanban in projects.hibana.ir/kanban. Basically they're the same thing — this domain is just a direct, less-distracting way to reach the kanban."; (2) "Prepare all of the specs and documents to replicate this kanban and its features and sync ability using GO, for a Windows app (both installable and exe)." BOTH SHIPPED + VERIFIED LIVE (qa/s209-live-verify.mjs ALL GREEN 20/20 on https://projects.hibana.ir AND https://hibana.ir — the real browser round-trip inside self-cleaning throwaway projects; the ghost sweep after: 7 real projects, 0 artifacts).

THE AUDIT (before any change): every kanban surface mapped against the /kanban contract. /board.html?project= is ALREADY byte-identical to /kanban (one board.html; the ONLY runtime forks are the two documented entry-contextual contracts — the Back link + RAIL_ICON_PAGES' classic rail vs /kanban's RAIL_EDGE_PAGES edge-hover). The /project.html?id= embedded board (detail-helpers.ts fragments + project-page.js's twins) carried the real deltas; sprint.html shares devboard.js (edit-mode 1:1 since S208).

THE CLOSES (shared code, not forks): (1) the embedded board's MOTHER CONTAINER — section.card.pd-board became .pd-board.db-frame + the .db-toolbar hairline header (the 100dvh floor scoped to main.board-shell; the card outline + reading measure kept — embedded context; the S185 palette chain re-anchored at the SAME specificity so light AND dark borders stay pixel-identical); (2) the LABEL MANAGER on the embedded head ([data-pd-labels] → the shared openLabels dialog; devboard.js now loads on project.html; changes → bodyRefresh); (3) the shared editor's FULL 10-op toolbar (bold/underline/strike | bullet/ordered | align×4 | code — every op writes the RAW markdown the renderer parses into the single title textarea, the Session-22/23 contract kept) + the FULLSCREEN WRITING toggle (.db-fullscreen; Esc/✕/Cancel/backdrop exit focus mode FIRST); (4) the ◆ SPRINT BADGE on the embedded cards (fragment + pdTruthWrap + chip-render.tagChipsRow's trailing badge; data-pd-sprint on the wrap); (5) the PIN BADGE SURVIVES the embedded board's repaints (pdTruthWrap renders it from the payload's screenshots — it used to VANISH on +N expand/pdRepaintColumns); (6) archive-done IN PLACE (bodyRefresh, never location.reload); (7) sprint.html's Board link → the canonical /kanban; (8) a live bug fixed en route: devboard.js on project.html DOUBLE-OPENED the video lightbox beside project-page.js's twins — its document dblclick/Enter handlers now scope to its own surfaces (.db-modal/#db-taskshots/#db-shotnote).

THE DELIBERATE EXCEPTIONS (decided + tested + documented — FEATURE-INVENTORY §13 + the s209 e2e pins): the embedded board keeps the reading-measure width + card outline + no floor; the title/content SPLIT + contenteditable WYSIWYG editor stays project-page-only (capability parity via the toolbar — the editor-stack extraction is the banked follow-up); the read-only slide-over (S149), +N windowing, column collapse, and the two delete models (styled-confirm on the board vs optimistic+Undo on the project page) stay per-surface.

THE GO WINDOWS DESKTOP REPLICATION SPEC PACK (documents only, no Go code): docs/project-kanban/ expanded from port-PLAN level to the COMPLETE pack — FEATURE-INVENTORY.md (NEW §12 keyboard shortcuts, 21 verified rows; NEW §13 the 1:1 parity decisions); USER-FLOWS.md (369 lines, both surfaces); DATA-MODEL.md (NEW §6 the exact SQLite-mirror DDL — 9 cloud tables + local outbox/meta; NEW §7 idempotency/identity); API-AND-SYNC-CONTRACT.md (§7a-7e the banked M0 additions at implementation precision — setTaskTags updated_at, tombstones riding the purge cron, idempotent creates, ?since=, optional SSE; NEW §8 the exact ETag/no-store/cache rules; NEW §9 the SW offline behavior + its desktop equivalent; NEW §10 the desktop sync strategy — pull cadence, outbox drain, LWW-per-field + the changed-on-server notice, deletion propagation); UI-UX-REPLICATION-SPEC.md (NEW, 515 lines — tokens/anatomy/editor/interactions + MUST-reproduce vs MAY-replace + the Wails embedding model with the CORRECTED seam count: api() is ONE choke point serving 21 call sites + 11 raw fetch/XHR sites); WINDOWS-PACKAGING-PLAN.md (NEW, 426 lines — BOTH the NSIS installer AND the portable single .exe, Wails v2 + modernc.org/sqlite, honest code-signing, auto-update via GitHub Releases — CORRECTED the old plan's WRONG claim: /api/health carries schema_version NOT an app version; the desktop CI/CD recipe); GO-DESKTOP-PORT-PLAN.md (the refreshed strategic master); TEST-MATRIX.md (646/456); README.md (the pack index).

TESTS + LADDER: +3 unit (src/tests/kanban-parity.test.ts — the fragment's frame/labels-button/sprint-badge/pin-badge contracts); +7 e2e (e2e/s209-kanban-parity.spec.ts — the /board.html≡/kanban contracts with ONLY the two documented forks, the full toolbar + LIVE markdown ops, the fullscreen exit-first contract, the embedded frame + label manager, the badges with the expand-repaint survival, the in-place archive-done, the canonical Board link); + qa/s209-live-verify.mjs (the 20-probe both-hosts verifier, env-only creds). Ladder all green: typecheck 0 · vitest 646/646 · eslint 0 · escape-lint 220 · cache-bust (devboard v28, board-page v21, sprint-page v20, project-page v76, chip-render v12, devboard.css v34, project-header v50, claude-dark v31) · i18n 1584/1584 (NO new keys) · build 85 · bundle +2.5% · precache +120KB · smoke · FULL e2e 456/456 (four quarter-shards 115+117+111+113, ZERO flakes). — RELEASED (2026-10-20): push df3a8ee → CI 39184567278 ALL GREEN → CD 39185572136 GREEN → qa/s209-live-verify.mjs ALL GREEN 20/20 on BOTH hosts (health ok/prod/up/63, sw v444, the round's assets live, the login round-trip per host, the full toolbar + the underline op writing __raw markdown__ live, the fullscreen enter/exit-first/second-Esc contract, the embedded frame + label manager + badges + the expand survival, the canonical Board link, 0 page errors — one verifier probe fixed en route: a position:fixed element's offsetParent is ALWAYS null, so the modal-open probe reads .hidden — the S208 fix-the-probe lesson applied) → ghost sweep CLEAN → tag v0.4.1.35 → zip hibana.0.4.1.35.zip. sw v443→v444; package 0.4.1.34→0.4.1.35.

THE SESSION'S OWN LESSONS: (1) a parity audit must distinguish CAPABILITY deltas (must close — the toolbar vocabulary, the label manager, the badges) from MODEL deltas (decide deliberately — the split editor: close at the capability level, document the model difference, bank the extraction); (2) loading a shared module onto a page that TWINS it doubles the EVENT wiring — document-level handlers must scope to the module's OWN DOM (the double-lightbox bug the s118 spec caught immediately); (3) specificity archaeology pays: re-creating a cascade (the S185 palette's .card interplay) at the SAME specificity keeps light AND dark pixel-identical; (4) computed-style probes lie twice (a hidden subtree's child still computes display:flex; a position:fixed element's offsetParent is null) — measure the OWNER's state, not a neighbor's.
## 1-prev. Current state (v0.4.1.34 — Session 208 (THE TASK-OPTION PARITY ROUND — the owner's follow-up on the S207 kanban), 2026-10-20. THE DISPATCH: the owner's message — "When creating a new task, it doesn't let you (show the button) to upload a picture. But already established tasks give you the option. Make sure you've implemented ALL of the kanban options of the original hibana into this one." — decoded as a PARITY round: the kanban editor must carry the full original-hibana task option set, with the upload button as the visible gap. SHIPPED + VERIFIED LIVE (qa/s208-live-verify.mjs ALL GREEN 25/25 on projects.hibana.ir — the REAL upload pipeline end-to-end against prod storage, inside a self-cleaning throwaway project).

THE PORT (the screenshots/attachments pipeline, devboard.js): project-page.js's uploader stack — S35 (immediate upload, no caption prompt), S46.3 (staged shots: POST with no task_id, pin on submit, delete on cancel), S46.4 (the task editor's inline pinned grid with zoom / edit-note / delete), S61/S67 (real per-file progress rows with cancel — the XHR helper + the strip factory), S69 (the ≤1600px WebP prepare pass + the ≤320px tile), S86 (the doc bucket: pdf/csv/xlsx/docx/md/txt + video/webm) — moved into the shared board client, scoped to state.projectId so board.html AND sprint.html (both render B().openEditor) get it identically. image-resize.js is NOT linked by the board pages — it lazy-loads on the first editor open (the app.js ensureImageResize recipe; a failed load keeps the raw FileReader path).

THE BUTTON (the owner's exact complaint): the Upload File paperclip + the hidden multiple file input (the full accept list) render in BOTH the new-task and the edit modals — creating a task now offers the picture upload the same way established tasks do. NEW TASKS STAGE: each picked file uploads immediately (live progress + cancel), tiles in the staged grid under the button (thumb / video player / doc download-tile, each with note + delete), and SAVE creates the task then PATCHes {taskId} per shot (the project composer's exact contract — the pin lands between create and close; a failed pin stays best-effort, counted + toasted); CANCEL/✕/Esc/backdrop DELETEs every staged shot (closeModal's cleanup grabs+clears the list synchronously so a fast re-open can't double-delete). ESTABLISHED TASKS PIN LIVE (upload + PATCH per file) and the inline grid below the button shows the task's pinned shots — zoom / edit-note (a small PATCH-caption dialog) / delete — the pde-shots-grid contract.

TAGS ON CREATE (the same-class gap the audit found): the new-task modal gained the staged-tags field (chips with ✕, Enter stages; the names ride the create body's tags[] — the server find-or-creates them; the existing-task LIVE add/remove stays). A LATENT TITLE-WIPE fixed with it: renderModal() rebuilds the whole card and the title textarea is the one live-buffered field — a tag chip added mid-edit used to WIPE the typed title (the existing-task tag flow carried this since S30); syncTitleToDraft() now rides every re-rendering handler.

THE CARD PIN BADGE + THE DIALOG + COPY: every task row in GET /api/projects/:id/devboard carries shot_count (LEFT-JOIN COUNT on screenshots.task_id — devboard.ts, with a pre-0054 D1 catch-belt that serves 0 instead of 500ing the board); board-page.js renders the same .pd-task-shots badge the project page's cards carry (title/aria/count, FA digits), its click opens the PINNED-PICTURES dialog (HibanaBoard.openTaskShots — the taskShotsDialog port: grid + zoom + unpin; unpin reloads the board so the count stays true), and the card-click editor-open path excludes the badge (the prio/chips/menu/read-more exclusion family). COPY joins the card ⋯ menu (the project page's ⋯ Edit/Copy/Delete contract — the RAW title via data-raw-title, clipboard + toast). THE LIGHTBOX: openShotLightbox/lbShotStep ported with the S83 dialog-top-layer hosting (the note + pinned-pictures dialogs) and the z-200-over-db-modal body path; Esc precedence pinned TWO ways (the lightbox's document keydown is registered at module load — BEFORE buildModal's listener — and preventDefault + stopImmediatePropagation shields the modal; the modal's own Esc handler guards on !shotLightbox); video tiles zoom on dblclick/Enter (S118/S119).

TESTS + LADDER: +1 unit (src/tests/devboard-shots.test.ts — the payload's shot_count: explicit 0, counts pins, drops on unpin); +6 e2e (e2e/s208-kanban-shots.spec.ts — the button in the NEW modal + accept + tags field; staged→save→pin API-verified→badge; cancel-deletes; the edit-modal button + pinned grid + lightbox-Esc-only-closes-lightbox + the second Esc closes the editor; tags-on-create with chip ✕ + API truth + the card chip; the badge dialog + unpin reloads — storage: rows seeded directly + the upload POST/file-serve route-fulfilled so the pin/unpin PATCH+DELETE run against real DB state). Ladder all green: typecheck 0 · vitest 643/643 · eslint 0 · escape-lint 220 PASS · cache-bust PASS (devboard v27, board-page v20, i18n-en v100, i18n-fa v94, i18n v154 — refs bumped in all HTML consumers + the board/sprint injector literals) · build 85 · bundle +2.1% PASS · precache +127KB PASS · smoke ALL PASS · FULL e2e 449/449 (four quarter-shards 115+117+111+106). — RELEASED (2026-10-20): push 6f8089e → CI 39161116606 (ci + e2e shard 1 GREEN; e2e shard 2's s207 full-width geometry test flaked once under runner load — frame.left measured 6px mid-animation, the same test green standalone ×3 and in the CI-identical local shard; the failed-job re-run → GREEN) → CD 39163566793 GREEN → qa/s208-live-verify.mjs ALL GREEN 25/25 on https://projects.hibana.ir (health ok/prod/up/63, sw v443, devboard.js v27 + board-page.js v20 serving the new machinery, the login round-trip, the NEW-modal button + accept list + tags field, a REAL png staged → saved → pinned (API truth) → payload shot_count=1 + the tag → the card badge, the edit modal's button + inline grid, the lightbox + the Esc-precedence pair, the badge dialog + unpin + reload, 0 page errors; one verifier probe race fixed en route — measure the async pinned grid AFTER waitForSelector, not at modal-open) → both hosts on sw v443. sw v442→v443; package 0.4.1.33→0.4.1.34.

THE SESSION'S OWN LESSONS: (1) a template comma where a + belongs SILENTLY truncates innerHTML — `x = a + b, c + d` binds x = (a + b) then discards the rest; the symptom (the modal rendering half, its footer gone, handlers nulling) reads like a wiring bug, not a concat bug — node --check can't see it, a DOM dump can; (2) parity audits pay twice — chasing the owner's one visible gap (the upload button) surfaced a SECOND gap of the same class (tags hidden for new tasks) plus a latent data-loss bug (the mid-edit title wipe) that the new feature's own e2e exposed on day one; (3) when a live verifier "fails" but the very next probe (which auto-waits) passes, the verifier raced an async render — fix the WAIT, not the product; (4) geometry e2e under CI runner load can measure mid-animation (frame.left 6px with every other assertion green) — the discriminating evidence is standalone + CI-identical-shard local runs, then the failed-job re-run; pin the flake, don't ship around it.
## 1-prev-prev. Current state (v0.4.1.33 — Session 207 (THE MOTHER-CONTAINER + TRUE-FULL-WIDTH + GHOST-SWEEP ROUND — the owner's three-item follow-up), 2026-10-19. THE DISPATCH: three owner asks on the S206 kanban — (1) "put them into a mother container with relatively white color; the kanban needs a container", (2) "it's not still full width", (3) junk rows in the project switcher ("s209 repro 9" — actually "S206 repro9 (self-cleaning)"). ALL THREE SHIPPED, ALL VERIFIED LIVE ON BOTH HOSTS (DOM-measured + pixel-verified on projects.hibana.ir, DOM-measured on hibana.ir; the switcher re-listed live).

THE MOTHER CONTAINER (ask 1): the board stopped floating loose pieces on the gray desk (a white toolbar card, a dashed filter strip, five pastel columns) — .db-frame (board.html, wrapping #db-toolbar + #db-loading + #db-board) is ONE var(--card) surface (rgb(255,255,255) in light, the dark surface in dark themes — token-driven, no hardcoded white): full-bleed edge-to-edge, padding 0.9rem/1rem (phone rhythm 0.65rem), and a min-block-size floor (100dvh − 1.5rem desktop; 100dvh − 4.5rem − safe-area below 1025px, respecting the bottom mobile-nav reserve) so a short board fills the first screen and reads as THE board, not a card on a desk. The toolbar's .card chrome retires inside the frame — transparent, ring gone, one hairline underneath (specificity 0,2,0 beats .db-toolbar/.card from layout.css) — the frame's header row. devboard.css v33.

THE FULL-WIDTH ROOT CAUSE (ask 2 — why S206's full-bleed didn't read): S206 removed the RAIL gutter (body.rail-edge, --rail-w 0) but the board still sat a 277px-margin centered island on a 1920 viewport — live-measured shell 1366px, columns 1270px. The cager: misc.css's item-12 page-width preference — html[data-page-width="standard"] main.shell.shell-flush { max-inline-size: 85.375rem } (the DEFAULT for every fresh user; the settings page owns the choice; the rules deliberately outspecify every page-specific width). The board was born full-bleed (2026-09-06 shell-flush) and the owner asked twice. FIX: main.board-shell (board.html's main, both entries /kanban + /board.html?project=) is EXEMPT — html[data-page-width="standard"] main.shell.board-shell { max-inline-size: none } appended AFTER the item-12 block (same specificity (0,3,2), later source order wins) + main.shell.board-shell { padding: 0 } (devboard.css) so the frame is truly edge-to-edge: frame left=0, right=viewport width (e2e-pinned UNDER the standard choice — the exact condition that failed; pixel-verified white at x=0 and x=vw on the live screenshot). The Notes vault — the other shell-flush consumer — KEEPS the cap (a reading surface); 'full'-pref users unaffected as before. misc.css v24 (refs bumped in all 24 consumers; devboard.css in all 23).

THE GHOST PROJECTS (ask 3): the switcher's junk rows were NOT a data bug in the switcher — they were leaked rows in the prod D1: the S206 live-hang investigation drove 15+ repro generations against prod with disposable projects whose cleanup DELETE only ran on the SUCCESS path; two crashed probe runs (the hang hunt's own timeouts — repro5, repro9) leaked theirs, and the owner's hibana-kanban-last even pointed at one (the board opened ON the ghost). FIX (data): qa/s207-ghost-sweep.mjs — the reusable sweeper (env-only creds, deliberately-narrow patterns: ^S\d+ repro|live probe|final|sprint probe + the '(self-cleaning)' marker; runbook + try/finally guidance for future probes in the header) — RUN LIVE BEFORE DEPLOY: 9 projects before, 2 ghosts deleted (200/200), 7 real projects remain, 0 after; the deleted-last fallback resolved the board to SportSignal (the S205 gone-state path, working as designed). The switcher live-lists exactly the 7 real projects now.

TESTS + LADDER: 5 new e2e (e2e/s207-kanban-frame.spec.ts: the frame structure — toolbar/loading/board are .db-frame's children + the white bg + the retired card chrome longhands; TRUE full width under the standard page-width choice — shell cap none + padding 0 + frame left 0/right=vw + cols ≥ 90% vw; the height floor; /board.html carries the frame + exemption while keeping the classic icons-rail 64px + Back-link contract; mobile 390px full-bleed + slim inset). Ladder all green: typecheck 0 · vitest 642/642 · eslint 0 · escape-lint 214 PASS · cache-bust PASS · build 85 · bundle +0.8% PASS · precache PASS (+148KB headroom) · dist-wiring canonical · board/sprint/label e2e 34/34 (s207×5 + s206-kanban-edge×5 + s205-kanban-entry×9 + board-filters + s206-sprint-fixes + label-manager + sprint-ux×4). — RELEASED (2026-10-19): push fd42f56 → CI 39151681090 GREEN → CD 39152680541 GREEN → live verify on BOTH hosts: frame edge-to-edge 0→1920 @1920 viewport, white at the pixel edges, toolbar chrome retired, rail-edge intact (the keyboard focus reveal probe-open/close verified live; the hover tripwire is hidden in headless (hover:none) by design — CI's Playwright exercises it), the switcher 7 real rows, sw v442 serving, 0 page errors. sw v441→v442 (SHELL re-fetch: board.html markup changed); package 0.4.1.32→0.4.1.33.

THE SESSION'S OWN LESSONS: (1) a "full-bleed" surface is only as wide as its WIDEST surviving cage — S206 removed the rail gutter but never re-checked the item-12 page-width cap that had silently outspecific'd shell-flush since 2026-09-09; when an owner says "still not X" after a fix, enumerate EVERY rule that touches the property, not just the ones the fix added; (2) live probes that create data must clean up on the CRASH path too — a success-path DELETE is a leak waiting for the exact timeout you're hunting; the sweeper is now the standing remedy (run it after any live-probe round); (3) headless verification browsers report (hover: none) — the touch-device rules correctly hide hover-only affordances there; verify those contracts via CI's Playwright (hover:hover) or the keyboard path, and don't misread the artifact as a regression; (4) VLM screenshot review can hallucinate layout ("margins", "rounded corners") — DOM getBoundingClientRect + pixel-edge checks are the ground truth pair for geometry claims.
## 1-prev-prev-prev. Current state (v0.4.1.32 — Session 206 (THE KANBAN FULL-BLEED + SPRINT-BUG ROUND — the owner's four-item follow-up), 2026-10-18. THE DISPATCH: four owner asks on the S205 kanban — (1) full-width default, (2) hide the sidebar entirely + reveal on edge hover, (3) more room + smaller register for the project name, (4) "the sprint system is buggy". ALL FOUR SHIPPED, ALL VERIFIED LIVE ON BOTH HOSTS (qa/s206-live-verify.mjs 20/20 + qa/s206-final-inpage.mjs on hibana.ir).

THE KANBAN FULL-BLEED + EDGE RAIL (asks 1+2): /kanban carries a NEW body.rail-edge mode — the gutter drops to 0 AND the rail slides entirely off-canvas (translateX(-100%), RTL mirrored; the S136 icons-only strip retired for the entry — the owner asked for exactly that). The rail returns ONLY when the pointer approaches the start edge: nav.js mounts the invisible #rail-edge-zone tripwire (16px, z-39); its mouseenter reveals the compact icon rail as an OVERLAY (no body reflow mid-hover, 0.18s slide, 300ms leave-grace with relatedTarget guards; delegated rail hover/leave; focusin/focusout for keyboard); the zone never renders on touch pointers or below 1025px (mobile bottom-nav owns navigation); openRailPanel + the boot panel-restore + the collapse toggle stay suppressed; navigating away restores the labeled rail (pinned by e2e). /board.html?project= KEEPS the icons-only contract + its Back link (the project-page context — both pinned by test).

THE PROJECT NAME (ask 3): the toolbar title drops from fs-xl (18px, overflow-wrap — a long FA name wrapped the toolbar into a squeeze beside the Back link + counts + two buttons) to the CONTROL register (fs-md + 600, single line, ELLIPSIS, flex:1) — the full name rides the span's title attr; the "← Back to project" link RETIRES on /kanban (no back context on the dedicated entry; the edge rail/switcher/g k own navigation), kept on /board.html.

THE SPRINT SYSTEM (ask 4) — SIX bugs, each reproduced BEFORE the fix, pinned by e2e, verified live: (A) the all-sprints list read "0 items" FOREVER — renderSprintsList counted (s.items||[]).length but the payload's sprint rows never carry items (SELECT * FROM sprints); counts the task pool now + fmtDate renders UTC (the list disagreed with the axis by a day for +03:30 users); (B) the task editor's "＋ New sprint" with an existing draft 409'd and killed the WHOLE save ("Couldn't save", modal stuck) — reuses the draft from its own state.sprints; (C) the define dialog parsed picked dates at LOCAL midnight while the timeline axis is UTC-day based — a picked day landed one CELL EARLY and a day too wide for every non-UTC user (the owner is Asia/Tehran: "today → +3d" rendered as 5 days starting yesterday); UTC-midnight parse in both the pickers and the presets, pinned by a real Asia/Tehran browser context in e2e; (D) the sidebar-task → sprint/draft/lane drop the browser ALWAYS REFUSED — dragover never called preventDefault outside the sidebar lists (the draft card's "drag them here" hint advertised exactly the broken affordance); the dragover/drop pair now accepts the same targets the timeline bars accept with the assignment path; (E) the boundary rails (z-4) stacked ABOVE every positioned child inside the lanes (the .sp-lane/.sp-sprint-lane z-1 scope-capped dots z-5 + chips z-3) — a task dot under a rail (sprints start today, tasks are created today — the COMMON case) could not be CLICKED (elementFromPoint returned the rail, probe-measured) nor dragged, and the chip's leading edge was dead; the lane z-indexes are retired so dots + chips (z-3→z-5) beat the rails at crossings; (F) THE LIVE HANG — every post-mutation reload (create/start/finish/quick-add → reload → the same /devboard URL) hung FOREVER on prod: the fetch never settled, the timeline stayed stale until a manual refresh (the daily-user's core complaint; caught by the S206 live verifier as a "create works, render never updates" FAIL, then root-caused across 15 probe generations: CDP requestWillBeSent FIRED for the swallowed GET; wrangler tail (one foreground process — the sandbox kills detached tails) showed every other invocation of the session (boot GET, POST, DELETE — all ok, single-digit ms) but the hung GET NEVER reached the Worker; on BOTH hosts, with AND without the service worker (route-blocked sw.js), regardless of cache:'no-store' and regardless of a cache-busting unique URL) → every devboard client GET now dispatches with an AbortController SIGNAL + a 3s deadline + ONE retry (probe-validated 4/4 on prod, both hosts, retries=0 — the signal-wrapped dispatch shape avoids the swallow entirely; the deadline+retry is the belt-and-braces for any residual case; mutations keep the plain path — they never hung and retrying them would double-write) + cache:'no-store' on every call. The in-page-reload probe confirms the create→render round-trip on hibana.ir WITHOUT any manual refresh.

THE LADDER (all green, 3 commits): typecheck 0 · vitest 642/642 · eslint 0/0 · escape-lint 214 PASS · cache-bust PASS · i18n parity 1582/1582 · build 85 · bundle +0.8% PASS · precache PASS · FULL e2e 437/437 (426 + 11 new: e2e/s206-kanban-edge.spec.ts — full-bleed gutter, off-canvas rail, hover-reveal overlay, leave-hide, focus-reveal, navigation restores the labeled rail, the toolbar register + Back retirement, the /board classic contract, the mobile no-zone rule; e2e/s206-sprint-fixes.spec.ts — real item counts, the draft-reuse save, the Tehran geometry pin, the sidebar→sprint + sidebar→draft synthetic DnD, the dot-under-rail click, the no-store/retry dispatch contract — the full suite re-ran GREEN in CI on every push) · smoke ALL PASS · workers-smoke ALL PASS · LIVE 20/20 (projects.hibana.ir) + the hibana.ir in-page probe.

DEPLOY: 3 pushes (6532764 → CI 39140981712/CD 39141953343; 4272321 → CI 39143856484/CD 39144661126; f9273de → CI 39147019617/CD 39147999212) — all CI (incl. the full e2e shards) + CD (dev + prod + probes + purge) GREEN. sw v438→v441; cache-bust: layout v67 · devboard.css v32 · nav v45 · board-page v19 · sprint-page v19 · devboard v26; package 0.4.1.29→0.4.1.32.

KNOWN ISSUES (documented, not blocking): create-with-dates can still OVERLAP an older CLOSED sprint (the create INSERT path has no overlap validation — only the open-sprint close logic; the timeline's drag clamps keep manual edits clean; harmless unless the user picks past dates over old sprints). The browser/edge request-swallow (bug F) is WORKED AROUND at the client, not explained — if it resurfaces on other same-URL GET paths (project-page.js has its own fetch layer), the same signal+deadline+retry recipe applies. The sprint-page reload resets the sidebar's collapsed state (cosmetic).
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
- **Drill log** (UX-12; newest last — the quarterly policy's recorded runs):
  - 2026-10-11 (S201, FIRST EVER run — the scripts shipped 2026-09-11 and had zero runs):
    `npm run drill` PASS in ~2s — Part A loud-skip (newest backup snapshot-2026-10-11T15-23-26
    is AES-GCM; `BACKUP_ENCRYPTION_KEY` is owner-held, never in agent sandboxes) + Part B
    synthetic round-trip 9/9 (export→restore→FTS rebuild, users untouched, rule-8 clean).
    `npm run drill:planb` PARTIAL PASS in ~4s — steps 1–3 green on the 2026-09-08 document
    (D1 log row → Telegram getFile → sha256 match → HIBENC1 magic); steps 4–5 (decrypt +
    restore round-trip) loud-skip, same owner-key gate. The first run caught and fixed TWO
    latent drill bugs: Part B's seed still used pre-0060 status vocabulary (dead since
    0060, the same blindness that killed explain-hotpaths) and drill:planb's D1 parser read
    `.results.results` (would have reported every non-empty planb_backups as EMPTY).
    Owner-side residue: run both drills once on the owner machine (credentials.md has the
    key) for the full Part A / steps 4–5 verification; key-custody drill still open.
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
  nominal 30-min schedule to ~1–7h gaps — the 6h+1h window is sized for that). The
  GitHub-side `Hibana errors` monitor (S201, UX-11) completes the trio: a daily cron
  (`.github/workflows/errors.yml`, 04:23 UTC + dispatch) counts prod `error_log` rows from
  the last 24h via the D1 REST API — 5xx > 5 (real breakage) or total > 20 (incl. the 4xx
  auth-invalid bursts errorlog.ts deliberately keeps) → `/fail` with the top paths;
  otherwise a success tick. 24h period + 6h grace, same email channel, secret
  `HIBANA_ERRORS_PING_URL` (random slug). Baseline at birth: error_log routinely EMPTY.
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
**✅ THE S201 RULE-4 ASKS — FULLY RESOLVED (S202 + S203, 2026-10-11).** Ali's S201-round
chat reply ("1. ok do it. yes / 2. do it. / 3. do it. / 5. do it") approved asks 1-3 +
the banked work; item 4 waited one round and then shipped on his S203-round acceptance
("Push commit, deploy, Then go to next step I accept." — accepting the S202 handover's
defined next step: node-server 1→2 + the two pending owner-YES items):
1. **PERF-16 — RESOLVED HONESTLY, NO MIGRATION (S202)**: the approved prescription was
   DOA — `telegram_note_sessions` was DROPPED by migration 0048 (the CREATE INDEX would
   have failed on apply against both live D1s), and the other three access paths are
   ALREADY index-served by the PKs (EQP: SEARCH via sqlite_autoindex, mostly COVERING —
   adding the proposed indexes changes nothing). Rule 9 is now MACHINE-ENFORCED by
   `src/tests/index-coverage.test.ts` ×3 (dropped-table pin + PK leftmost-column pins +
   EQP SEARCH-never-SCAN on the real query shapes). Schema stays 63; no bookmark ritual
   (nothing to migrate). The owner's YES is banked — the literal indexes are a 5-minute
   migration if he still wants them after reading §1's evidence; the honest
   recommendation is not to (pure write overhead, zero read benefit).
2. **PERF-9 — SHIPPED (v0.4.1.26)**: the 21 legacy vazir files + the never-referenced
   `Vazir-Variable.woff2` (repo-wide zero refs — the honest 22nd file) deleted;
   `font-face.css` woff2-only; sw v435. **THE BEBAS FOLLOW-UP — SHIPPED (v0.4.1.27,
   S203)**: the 6 legacy `.otf`/`.ttf` files deleted (~281KB) + `font-face.css`
   woff2-only + sw v436 — the "one word" was the owner's S203 acceptance.
3. **UX-13 — zod 3→4 SHIPPED (v0.4.1.26)** in one deliberate round (4.6.6; one
   signature fix in `jsonBody`; 635/635 green; workers-smoke proven on the Workers
   runtime). **@hono/node-server 1→2 SHIPPED (v0.4.1.27, S203)** — 1.19.17→2.1.4,
   the one-round-each doctrine honored (zod round S202, node-server round S203);
   API-verified before upgrade (serve() unchanged; the `env.incoming` raw-socket
   binding still injected — probe-proven, so ratelimit's unspoofable clientIp is
   intact); the FULL 417 e2e ran through the v2 server.
4. **SEC-10 — SHIPPED (v0.4.1.27, S203)**: the `__Host-hibana_session` rename shipped
   on the owner's S203 acceptance of the next step (the one-time-logout cost was
   disclosed here since S201). The prefix contract is centralized in `sessions.ts`'s
   two helpers (Secure + Path=/ required, Domain forbidden — browsers enforce);
   Secure is now UNCONDITIONAL (Workers prod+dev are HTTPS; localhost is a trustworthy
   origin — proven by the FULL 417 e2e's browser logins + the live probe's 25/25).
Also owner-side (not rule-4, standing): run `npm run drill` + `drill:planb` once on the
owner machine (credentials.md has `BACKUP_ENCRYPTION_KEY`) for the full-key drill paths —
see the §4 drill log; key-custody drill still open.
**S201 banked — HLTH-24 vs the S49 NO-GO, reconciled:** the S198 audit's "split
project-page.js by concern" meets §6's standing NO-GO (closure-bound page-mount monolith;
the S48 IIFE bug is the warning). Resolution: NO big-bang split ever; the SAFE path is
the S49 incremental-extraction doctrine (pure function → IIFE global, HibanaChips-style)
applied WHEN THE FILE IS NEXT TOUCHED for real work. The worklog rotation (HLTH-27) now
keeps this doctrine visible in the active tail.
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
