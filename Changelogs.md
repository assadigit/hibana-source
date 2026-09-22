# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.41.1 — Session 108, 2026-09-22. THE STALE-HTML CLASS CLOSED — the [URGENT] "Note page first-load styling failure" is fixed at the serving layer. DIAGNOSIS (fresh-sandbox round — the environment was RECONSTRUCTED first: hibana-source cloned from the public repo, deps via bun, secrets.env rebuilt from the session prompt at /home/z/.hibana/secrets.env chmod 600, ci-watch.mjs + cd-jobs.mjs re-created; the monitoring tooling and worklog did not survive the sandbox reset). THE EVIDENCE CHAIN, all verified live: (1) the Workers assets layer serves the extensionless pretty URLs (/notes, /dashboard, /projects, /settings…) from an internal edge cache — cf-cache-status: HIT on every request, and the HIT PERSISTED across a zone purge_cache call (the S73/S74 post-deploy zone purge does not touch the assets layer, and the "re-keys on every deploy" claim is not true for every window); (2) those URLs answered `cache-control: public, max-age=0, must-revalidate` — the _headers /*.html no-store rule only matches .html REQUEST paths and never matched the pretty URLs (the /sadhana* + /to-do-list* splats were the only extensionless rules); (3) a wrong/stale dist hash 404s live (the build purges stale dist files on PROD builds), so any stale page served during a post-deploy window references purged hashes → 404 stylesheets → the "unloaded and messed up until 1–2 refreshes" paint; (4) this is the SAME class as three documented incidents: S72's nav.html stale for hours, the /register+/verify corrupted variants (2026-08-24), the /sadhana blank page (2026-08-25) — each previously routed around by changing URLs, never fixed at the layer. THE S105 GUARDIAN IS NOT THE PROBLEM — live-proven with injected failures: connection-reset on 2 dist stylesheets → twins heal in place, veil held, page reaches FULL styling (23 sheets / 3591 rules); a permanently-stalled stylesheet → the 5s stall guard fires, heals, styled (+12s); both with service workers blocked (the true first-visit shape). THE FIX, four layers: (a) wrangler.toml [assets] run_worker_first = [negation globs] — every path EXCEPT the hot static set (/dist, /css, /js, /vendor, sw.js, webmanifest, robots, favicon, icons, logos, Login.jpg) runs the Worker FIRST, so page HTML is served by the Worker through the binding and BYPASSES the assets edge cache entirely (the S72 /api/nav pattern — zero stale incidents since it shipped; Worker responses carry no cf-cache-status); (b) src/app.ts: the assets middleware stamps Cache-Control: no-store on every HTML response it returns (pinned by a new assets.test.ts test: html stamped, css untouched, pretty URL stamped); (c) public/_headers: no-store for EVERY extensionless page URL (login/signup/confirm/reset/dashboard/project/sparks/notes/board/sprint/canvas/whiteboard/gallery/reports/calendar/notifications/settings/clients/archive/admin/clip/404/index — belt-and-suspenders for any path variant the negation list could miss; rules verified cumulative: a page still carries the full security-header block); (d) public/sw.js v404: the navigate handler caches res.ok responses ONLY — a transient 5xx during a deploy window used to be put() verbatim and later served as the offline/stale navigation fallback (the failure page itself becoming the shell). Every leg now emits no-store for pages: edge can't hold a page the Worker stamps, browser won't store it, SW won't shell a failed page, and the guardian remains as the last-resort in-page healer. LADDER: typecheck 0 · vitest 514×2 (511 baseline + the new S108 stamp pin + 2 pre-existing) · eslint src/ 0 errors (163 baseline warnings) · node --check sw.js · wrangler deploy --dry-run both envs (run_worker_first schema-validated) · cache-bust PASS (no css/js content edits; sw.js bumped by discipline v403→v404) · parity 1440/1440 · bundle-size +3.8% PASS · smoke + workers-smoke PASS (the negation config boots clean on the Workers runtime) · dist wiring 25 pages / 725 refs / 69 dist files PASS · playwright 109 + 76 (+1 sprint-doc flake re-run green) — the ONLY net-new test is the stamp pin; no UI behavior changed. DEPLOYED 27f31c1: CI GREEN → CD FULL CHAIN GREEN (run 35776329278: guard → build wired → DEV deploy+probe → PROD deploy+probe → zone purge → restore HTML, prod Version ID 816b672f) → LIVE VERIFIED: /notes /login /dashboard all serve cache-control: no-store, /dist still immutable, /api/health ok schema 59, and the browser harness re-run against prod: clean + reset + stall ALL STYLED (SW-blocked first-visit shape). Tag v0.3.41.1; zip hibana.0.3.41.1.zip (522 files, 71 dist entries, no secrets — the S107 contract). CARRY-FORWARD: the [HIGH] branded loading indicator + [MEDIUM] fullscreen progress-box token parity + the visual re-verify of the v0.3.40.0 quadrant cap are UNSTARTED (the diagnosis consumed the round); magic-wand.css/js remain intentionally unwired (they ride the versioned ?v= class); the app.js hash mismatch mystery (live 0dd4203a vs a naive local build 77e22779) is EXPLAINED — the deploy-time --wire-html rewrite also rewrites in-JS asset literals (the image-resize lazy-loader), so only --prod --wire-html builds are byte-comparable to prod; the tooling note "branches: ain]" in earlier greps was an ANSI-escape display artifact of the terminal tooling (od -c shows the correct "branches: [main]").)

## 1-prev. (v0.3.39 — Session 105, 2026-09-21. THE OWNER'S AGENDA — a 12-item bug/UX round, each fixed root-cause-first with an e2e pin for its bug class. The headliner: [URGENT] "the note page appears unloaded and messed up for the first 1–2 loads" — ROOT-CAUSED with hard evidence: the S83/S84 watchdog installed its error listener at the END of <head>, AFTER the stylesheet links, and a reset arriving while the parser blocks on the synchronous boot.js fetch fires the LINK error BEFORE that listener exists (a playwright route.abort trace showed the error dispatching with retries still 0 — early failures were invisible, so no reload ever came and the broken paint sat until the user refreshed by hand). THE S105 GUARDIAN (notes.html) now runs FIRST in <head> — before any asset fetch can fail — and a dropped STYLESHEET no longer reloads the page at all: it re-fetches itself IN PLACE (a cache-busted &hibana-r=N twin href, up to 3 attempts, a 5s stall guard, the reveal veil HELD while healing so the user never sees the half-styled state, a 15s bounded hold), falling back to the old 2-per-session location.reload only when healing exhausts or a SCRIPT fails. Verified: abort notes.css twice → twin r=1 → twin r=2 lands → the 3-pane grid applies, ZERO navigations, budget untouched. [HIGH] dark sticky notes were near-black (#2E2818-family ≈10% lightness) — re-registered as MUTED VISIBLE colors scoped to the sticky/grid paper views (list view keeps its neutral dark card — light-mode parity): yellow #b3975b / green #5c9973 / pink #c48aab / blue #7a95bd with warm-dark ink #292520 + the picker dots mirroring them; light mode untouched (pastels still #FFF59D-family); pinned by exact computed rgb in BOTH directions. [HIGH] the screenshots grid "into each other and messed up": the pinned shot's long task title overflowed its card (the classic flex/grid min-width:auto chain — the ellipsis was present but could never act) and the .shot-body's auto grid column was sized by the note's max-content, so the whole body bled past the card edge; the full chain now yields (.shot-body gets minmax(0,1fr) + the pin line min-inline-size:0 top-to-bottom) and a hover title carries the full text. The owner's "turns the screenshot word to Files" — interpretation, flagged to him: no user-facing "Files" label exists anywhere (verified live + full-tree grep; the only Files wording was the S86 attach buttons); the task composer + task editor attach buttons are relabeled screenshot-first ("Upload screenshot" / «آپلود اسکرین‌شات», tooltips keep the full file-type list). [MED] the dashboard project boxes de-noised per a VLM audit: the redundant per-card STATUS WORD chip, the skc-open arrow circle (the whole card navigates via data-nav-url), the sig-chip pills (folded into the meta line as quiet plain text: "2 ideas · 1 plan · 1 hurdle"), the hover lift, the carousel arrows' blur+shadow chrome and the active dot's glow are all retired; the stage bar slims to 3px; the box icon-chips go neutral (the count pill stays the ONE color key). [MED] the vault tree (the "idea's sidebar") is now Obsidian-style: NOTES render under their folders (a light note index rides /api/vault/bootstrap), a folder with notes carries a working twisty even without subfolders, and the Folders/Tags SECTION HEADINGS collapse (persisted prefs); note rows open the editor, aria-current follows the open note, and every mutation keeps the index honest. [MED] the calendar rail icon carries data-rail-nav (the To-do/Projects pattern) — a click opens the panel AND lands on /calendar.html. [MED] "Continue where you left off" re-defined (the owner: "a view is not enough"): recording moved from view-hooks to MUTATION success points (project-page.js resumeTouch + an htmx afterRequest hook — task saves/adds/deletes/drags, note autosaves, uploads, doc saves; notes-page.js doSave/newNote/moveNote); the hint reads "Last edited" (EN+FA). [MED] the ⚙ quick-note view menu no longer paints under later sections: while open it lifts to <body> as position:fixed z-90 (the spark-menu precedent — #notebook's container-type stacking context cannot trap it), follows the gear on scroll/resize, and returns home on close. [MED] the fullscreen board now uses window.HibanaChips (chip-render.js — already loaded) instead of its own stale local renderer: real bullets/ordered lists/bold/underline/strike/fences, S48j first-line-only titles, the S86 preview line, data-raw-title round-trips; .db-card-title inherits the EXACT .pd-task-title register (0.75rem / 700). [MED] the Plans tab renders the planned kanban ITEMS its badge counts (the old panel showed only plan documents — "Plans 5" over an empty list), with the owner's two-concept ruling in the copy: a PLAN is always a box item; a PLAN DOCUMENT consolidates many tweaks; the list live-updates via an extended /api/projects/:id/backlog payload (blRefresh renders it; drags into/out of the Plans box refresh it). [MED] success toasts redesigned: kind 'ok' renders "✓ Saved" on pastel green (--badge-operational family, dark-lifted) with the × ANCHORED PHYSICALLY top-right; the client toast() and server toastHtml() both grew the variant; all save-path call sites use it. [LOW] the sticky-note × moved to top-right (the headbar packs at inline-end; the fabric sticky already lived there). LADDER: typecheck 0 · vitest 510/510 (the skc-open pin updated to the new clean card contract) · eslint src/ 0 errors (163 baseline) · build 77 · cache-bust PASS (23 files — one bump-script substring bug caught + fixed in-round: "notes.css" matched inside "quicknotes.css" and clobbered v27→v15 before the checker's consistency-only gate; now v28 everywhere) · parity 1439/1439 (2 new keys) · playwright 182/182 (172 baseline + 10 new: the 9-pin e2e/s105-owners-agenda.spec.ts — guardian heal, dark sticky exact rgb, pin clamp geometry, tree collapse, calendar nav, board bold+bullets, plans-list-matches-badge, menu lift, ok toast — plus the resume spec's view-records-nothing/edit-records pin; rail-panel/s86/resume pins updated to the new contracts). agent-browser QA on :3017, both themes × EN/FA × desktop/390px, zero console/page errors; VLM-verified the dark stickies ("clearly colored, muted, eye-comfortable"), the cleaned dashboard cards, the clamped pin line, and the FA RTL tree. e2e lessons: an active service worker BYPASSES playwright page routes (the guardian spec blocks SWs — which is also the truer first-visit shape), and a clipped element's scrollWidth still reports full content (pin the BOX geometry, not scrollWidth).

S105 r2+r3 (continuation session, 2026-09-21). r2 (a2ee031): the dashboard meta line's stray double separator — an EMPTY SafeHtml object is TRUTHY, so the absent Backlog segment still rendered its ' · '; backlogMetaD now returns null when absent (spotted live on prod during the golden-path QA). r3 (this round): (1) GOLDEN-PATH QA ON PROD (the owner's account, all 12 items, state RESTORED): the guardian is live first-in-head and a SW-free first visit paints fully styled with the veil released; dark stickies compute EXACTLY #b3975b/#5c9973/#c48aab + ink #292520 (VLM: 'clearly colored, muted'); the screenshots grid = 11 tiles, ZERO overlapping rects, 'Screenshots' wording everywhere (VLM-confirmed clean); dashboard cards carry no arrow/chips (status sr-only); the vault tree collapses (section head + folder twisty, notes in-tree); the calendar rail lands on /calendar.html; a view-heavy session recorded NOTHING into hibana-resume (the edit-gating e2e pins both directions); the gear menu lifts to <body> fixed z-90 (all 5 hit-points inside); the fullscreen board uses HibanaChips at 700/12px — the EXACT .pd-task-title register; the Plans tab lists its 6 real items + a separate Plan documents section (FA copy verified: «برنامه‌ها · قلم‌های جعبه ۶» / «اسناد برنامه»); the ok toast computes pastel green rgb(224,240,229)/rgb(39,115,52) light and the dark-lifted variant, ✓ + corner × (VLM-confirmed); the sticky × sits top-right (top-left in RTL — the mirrored convention); FA/RTL pass: dir=rtl, Shamsi dates + Persian digits, rtl.css live. ZERO console/page errors across the whole session. 9 QA probe tasks (5 left by the prior session's QA + 4 from the toast verification) DELETED via the app's own API; language_pref + theme restored to the owner's en/light. (2) THE CAUGHT DEPLOY GAP: r2 never reached prod — its CI run failed (one login-timeout) and the CD gate (workflow_run.conclusion == 'success') correctly SKIPPED the deploy job, so prod sat on r1 with the double separator still live (the QA re-probe caught it). (3) ROOT CAUSE of the recurring CI login-timeout class (S103 once, S105 twice in a row — different tests each time, retries failing too): the e2e suite logs in ~180× from ONE client IP and a burst of fast tests puts >30 logins inside a rolling 60s window — the auth rate limiter (30/60s/IP, spec §15) answers the 31st with a 429 (htmx path: a 200 error fragment), the shared login() helper's waitForURL('**/app') times out, and whichever test falls on the 31st+ login of the burst fails. PROVEN with a local probe: 40 rapid logins → #31–40 all 429. FIX: RATE_LIMIT_DISABLE=1 — a TEST-ONLY kill-switch read per-call in hitRateLimit (short-circuits before the DB write), set by playwright.config.ts's webServer command, pinned by a new vitest (60 logins → zero 429s, zero rate_limits rows, env restored; the limiter's REAL behavior stays covered by the existing pins, which run flag-unset). LADDER (r3): typecheck 0 · vitest 511/511 (the new pin) · full local e2e on the flag-enabled server (see worklog) · deploy chain re-armed: push → CI green → CD deploys r2+r3 together.

## 1-prev-prev. (v0.3.38.3 — Session 104, 2026-09-21. THE VISIBILITY CALIBRATION — the owner's verdict on S102's pale wash: "too pale — like 95% pale, no visual visibility, too low opacity; the code works but the colors are invisible." The 7% wash computed rgb(252,247,245) on a white card — indistinguishable from neutral to the eye). THE CALIBRATION (the wash's full history in one line: S94 12% → the S95-r2 restraint rule retired it entirely → S102 brought it back at 7% → too far): the wash is re-weighted to a VISIBLE pastel — LIGHT 20% fill + 48% edge (coral = exactly rgb(246,232,228) over the white card, border rgb(210,176,167)), title 48%, count 62%, icon/trigger 85%; CLAUDE-DARK keeps its additive lift: 25% fill + 52% edge (rgb(75,57,51) over #1F1E1C, border rgb(141,103,91) — 52% deliberately avoids the 50% mix's 138.5 rounding boundary), title 52%, count 66%, icon 88%; the board's q-big tile 22%/24% + 44%/48% borders, hover 26%, q-cnt 62%/66% + 42%/46% hairlines; the to-do-list server zone joins at the same weights (counter pill 62/42/16%, pin badge 72%, pinned edge 65%). The swatch chips STAY at their S102 50% pastel — they already preview a stronger tint than the new wash (complaint 1 still honored). Pure CSS again — 4 sheets, no JS/markup (bump: to-do-list v8→9, dashboard-todo v15→16, claude-dark-theme v11→12, sadhana-board v20→21); the 2 s102 e2e pins MOVED to the new exact rgb (BOTH failure directions now pinned: the retired 7% rgb(252,247,245) reads invisible, a heavier 30% rgb(241,220,214) reads saturated — neither may ever compute again). VERIFIED channel-by-channel on :3017 (agent-browser, both themes, zero console/page errors): every single value measured EXACT — light dashboard fill/border/title/badge/icon = rgb(246,232,228)/rgb(210,176,167)/rgb(120,83,70)/rgb(143,98,83)/rgb(183,122,105); dark = rgb(75,57,51)/rgb(141,103,91)/rgb(220,182,167)/rgb(216,169,153)/rgb(211,149,131); light board + q-big rgb(245,229,225) (22%) + q-cnt rgb(210,181,173) (42%); dark board + q-big rgb(73,56,50) (24%); the wash SURVIVES a reload; the ∅ clear returns pure rgb(255,255,255). LADDER: typecheck 0 · vitest 510/510 · eslint 0 errors (163 baseline) · build 77 · cache-bust PASS (4 files) · parity 1436/1436 · playwright 172/172 (9.5m, zero baseline drift — the rules stay attribute-gated). Committed + pushed; CI/CD/live verification in the round's worklog record.

## 2. Session index
| Session | Date | Outcome |
|---|---|---|
| 108 | 2026-09-22 | v0.3.41.1 — THE STALE-HTML CLASS CLOSED: the [URGENT] Note-page first-load styling failure fixed at the SERVING layer (the S105 in-page guardian was never the culprit — live-proven: injected connection-resets and stalls on dist stylesheets all heal to full styling). Verified live: the assets layer serves extensionless pretty URLs from an internal edge cache that revalidates lazily (cf-cache-status: HIT persists across a zone purge_cache), those URLs answered max-age=0 (the _headers /*.html rule never matched pretty-URL request paths), a stale page references dist hashes the new build purged → 404 stylesheets → "unloaded until 1–2 refreshes"; same class as S72 nav.html / register+verify corruption / sadhana blank page. FIX (4 layers): wrangler.toml run_worker_first negation globs (pages run the Worker first → bypass the assets cache, the S72 /api/nav pattern) · app.ts assets middleware stamps HTML no-store (test-pinned) · _headers no-store for every extensionless page URL · sw.js v404 navigate-handler caches res.ok only (a transient 5xx no longer becomes the offline shell). 514 vitest ×2, 185 e2e + 1 flake re-run, parity 1440/1440, wrangler dry-run both envs, workers smoke green; deployed 27f31c1 (CI→CD run 35776329278 green), live: /notes /login /dashboard = no-store, dist immutable, harness clean+reset+stall ALL STYLED. Tag v0.3.41.1, zip 522 files. Sandbox reset recovery: repo cloned from the public source, secrets.env rebuilt from the prompt, ci-watch/cd-jobs re-created. |
| 107 | 2026-09-22 | v0.3.41.0 — THE UPLOADED-FILES TAB: the media tab RENAMED "Screenshots" → "Uploaded Files" (فایل‌های آپلودشده) end-to-end (tab, heading, upload button, empty state, delete confirm/toast, gallery empty text — the surface hosts PDF/CSV/XLSX/DOCX/MD/TXT file tiles too, so "Screenshots" was a misnomer; i18n values only, parity 1440); and each tile's four inline action buttons (pin/note/toggle/delete) collapsed into the app's standard ⋯ .spark-menu popover (hover-reveal, touch floor, one-at-a-time, Esc + outside-click, danger Delete; the items keep the exact data-* attributes the delegated handler speaks). E2E-CAUGHT: the server pop needs the hidden attribute OUTRIGHT (without it every menu renders open at load and every post-mutation re-render ships them open — pinned by a raw-attribute check before any click can mask it). 511 vitest, 186 e2e (new S107 spec), parity 1440/1440; live-verified EN/FA-RTL/claude-dark + a live toggle-through-the-menu; deployed 0fcc334, byte-verified (6/6 hashes reproduced locally with --prod --wire-html), tagged v0.3.41.0. |
| 106 | 2026-09-22 | v0.3.40.0 — THE OWNER'S BACKLOG, FIRST SLICE (2 items): the shared 700 BOLD REGISTER for project names / Idea folders / group heads across six surfaces (dashboard stage columns, rail tree stage heads, projects-home rows, project cards, vault folder names, Ideas folder names — content stays 400) + the live-QA-caught vault SECTION-head `font: inherit` shorthand clobber (the heads rendered 16px/400/no-uppercase since S105 — the designed 11px/700/uppercase label never computed; fixed to font-family: inherit, pinned by weight+size+transform); and the dashboard quadrant glance: max 4 visible, rows 5–8 behind a FROST "+N more" pill (dashed 999px, translucent wash + blur(5px), aria-expanded), NEWEST-CREATED-first sort (pinned still rides top; manual position stays the board's own order), the latent S69 collapse no-op fixed + a client-side recount with Persian digits under FA; 511 vitest, 185 e2e (3-pin s106 spec), parity 1440/1440. r2 (v0.3.40.1): the sidebar's PROJECT rows join the register — .rail-project-row 700 (the six surfaces had covered the rail's STAGE heads only, so the owner read the sidebar as undeployed; the tree's weight ladder now stage 700 → project 700 → sub-head 500 → leaf 400, pinned level-by-level with a dev_task-seeded sub-group; nav.js v23 + layout.css v39). r3 (v0.3.40.2): HIERARCHICAL SPACE — the branches hang under their project row (margin 0.75rem + the '---' ELBOW connector off the stage guide, rounded, logical-properties RTL-safe; the leaf nest tightened) — pinned by geometry (head +12px, leaf deeper, elbow computing) in the same spec; layout.css v40. |
| 104 | 2026-09-21 | v0.3.38.3 — THE VISIBILITY CALIBRATION: the owner's verdict on S102's 7% wash ("too pale — like 95% pale, no visual visibility") — the wash re-weighted to a VISIBLE pastel (light 20%/48% + title 48/count 62/icon 85; claude-dark 25%/52% + 52/66/88 — 52% avoids the 50% 138.5 rounding boundary; q-big 22/24 + borders 44/48, hover 26, q-cnt 62/66 + 42/46 hairline; the server-zone pill 62/42/16 + pin 72/65), chips stay at the S102 50% pastel; pure CSS (4 sheets, to-do-list v9, dashboard-todo v16, claude-dark v12, sadhana-board v21), the 2 s102 e2e pins MOVED to the new exact rgb (both failure directions pinned: 7% = invisible, 30% = saturated); every value verified channel-by-channel on :3017 both themes + reload persistence + ∅ neutral; 510 vitest, 172 e2e, parity 1436/1436. |
| 105 | 2026-09-21 | v0.3.39 — THE OWNER'S AGENDA (12 items): the notes-page guardian (top-of-head + in-place stylesheet heal + veil hold — the S83/S84 blind spot root-caused), muted visible dark stickies (exact-rgb pinned), the screenshots pin-line + grid-column clamp, the Upload-screenshot relabel, dashboard box de-noise, Obsidian-style vault tree (notes in-tree + collapsible sections + a bootstrap note index), calendar rail navigation, last-EDITED resume recording (mutation-gated), the gear-menu fixed-lift, HibanaChips on the fullscreen board, the Plans tab lists its planned items (plan vs plan-document copy), the check pastel-green success toast with corner ×, sticky × top-right; r2: the meta-line stray separator (empty SafeHtml is truthy → backlogMetaD returns null); r3: golden-path QA on prod (12/12, state restored, VLM where visual) caught r2 never deploying (CI login-flake → CD gate skipped) and ROOT-CAUSED the CI login-timeout class — the suite's ~180 logins/IP burst past the 30/60s auth limiter (#31 → 429 → waitForURL timeout) — fixed with the TEST-ONLY RATE_LIMIT_DISABLE=1 kill-switch (playwright webServer sets it; a vitest pins it; the limiter's real pins stay flag-unset); 511 vitest, 182 e2e, parity 1439/1439. |
| 103 | 2026-09-21 | (ops, no bump) THE CREDENTIALED PUSH ROUND: f0e0a8c (v0.3.38.2 pale quadrants) PUSHED + verified end-to-end — CI green first-try (10.5m) → CD deployed → /api/health ok (schema 59) → 7/7 manifest assets BYTE-IDENTICAL (incl. the WIRED app.3c117635.js — the unwired build's hash differs, compare the wired form) → live golden-path QA on the owner's account (17 real swatches/quadrant, coral pick → the quadrant's OWN computed bg flips to EXACTLY rgb(252,247,245) + border rgb(211,190,184) → PATCH /api/sadhana/quadrants/4 200 → survives reload → accent-purple restored, zero errors); c34b0be's in-flight chain retro-verified green (the two red 15:27Z CI runs are dependabot PRs, not main); the 93-ops LEAKED PING-KEY exposure NEUTRALIZED API-only — the hc.io API can't rotate the account key but CAN rename slugs: both checks' slugs randomized to unguessable hex (old key+slug pairs 404-verified; the leaked key alone inert — the REST API key never leaked, checks can't be enumerated), hibana-prod's HEALTHCHECK_PING_URL (CF API) + the HIBANA_UPTIME_PING_URL repo secret (GH API, sealed box) rotated + verified END-TO-END (workflow_dispatch Uptime run green, ping landed via the new URL); the ANTI-MASKING near-miss caught + reverted in minutes (the dev worker's briefly-restored secret deleted — §4's "dev never pings" outranks the stale hc.io desc, now updated); uptime.yml comment + §4 runbook updated (ANY new check on this account MUST use a random slug). The rotated worker secret self-proves at the 21:23Z prod tick. |
| 102 | 2026-09-21 | v0.3.38.2 — THE PALE QUADRANT ROUND: the box wash back at 7%/30% light, 11%/32% dark (the S95-r2 restraint rule retired it); every small-element mix dropped; swatch chips pastel; 2 new exact-rgb e2e pins (both failure directions); pure CSS, 4 sheets. |
| 102 | 2026-09-21 | v0.3.38.2 — THE PALE QUADRANT ROUND: the owner's two instructions ("too saturated — more pastel" + "selecting a color MUST change the quadrant color") answered together — the S95-r2 restraint rule retired the BOX wash, so picks only re-inked small elements at saturated mixes; the wash is BACK pale (7%/30% light, 11%/32% claude-dark at 0-3-1 over the flat cap) with every small-element mix dropped (title 38/42%, count 50/54%, icon 74/78%, q-big 8/12%), the count pill + pin accents joined, the hover q-big tile keeps its tint, and BOTH popovers' swatch chips went pastel (50% over the card — the chips preview the pale quadrant); pure CSS (4 sheets, no JS/markup), the pick→PATCH→repaint flows verified sound. 2 new e2e pin the QUADRANT'S OWN computed background (exact pale rgb — paleness pinned, not just presence) on both surfaces; the expect.poll throw-abort lesson (mid-transition oklab + detached-node '' — computedRgb never throws). 510 vitest, 172 e2e, parity 1436/1436, both themes × EN/FA QA'd, QA account restored neutral. |
| 101 | 2026-09-21 | v0.3.38.1 — THE DEPLOY+VERIFY ROUND: 2c676e1 (S100-r) PUSHED + verified live (CI's one login-timeout failed twice on the runner, the failed-job re-run went green — a flake — and CD auto-redeployed; /api/health ok; 12/12 manifest assets byte-identical); the owner's S94 eleven-item agenda RE-VERIFIED live on the current build (11/11 pass — swatch picker, admin gate, shared well, glance, compact controls, the rail tree, teal notebook both themes, counter pill, empty placeholder, active pill); QA-caught the ESCAPED-SWATCH BUG — the dashboard popover's 16 pastel swatches rendered as escaped text since S93 (the plain-string map inside the html tag, escaped by htmlx design) — fixed with raw(), pinned with 68-real-button assertions + the scoped escape signature, the whole page+API surface audited clean of the class; the no-backticks-inside-template-comments lesson. 510 vitest, 170 e2e, parity 1436/1436. |
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
