# Hibana — Session Worklog (durable handover)

> Purpose: the sandbox-local session journal, **committed to git** so a fresh clone
> inherits the handover (S156 was lost to a sandbox reset once — never again).
> Append per session; never overwrite. NEVER put credentials/tokens in this file —
> the owner supplies them per-session; `credentials.md` is gitignored.
> The durable per-release record lives in `Changelogs.md` (§1 = the 4-block chain,
> §2 = the full session index). This file is the working memory between sessions.

---

Task ID: wrap-up
Agent: Z.ai (closing session of the v0.3.8x line)
Task: wrap up the project — commit everything to GitHub, confirm the latest deploy to Cloudflare is live, leave the repo self-contained for a fresh-clone session.

Work Log:
- Verified the two outstanding owner reports were ALREADY shipped (the compaction summary was stale):
  - S156 / v0.3.88.0 — board-page overflow (`.clip-2` overflow-wrap:anywhere + min-inline-size:0 belt) + the "No tasks yet" empty state centered (`.pd-board-empty` justify-items:center + text-align:center).
  - S157 / v0.3.89.0 — headings dropped a weight: `--text-h1-weight`/`--text-h2-weight` 600→500, base h4 600→500, the dead `.precent-head h2` 700→token, markdown-reader h1/h2/h3 onto the tokens. S106 owner-approved bold labels deliberately untouched.
- Verified the full S157 chain was complete: feature 2c2c8e2 + docs 681a443 pushed; CI run 36328343741 + CD run 36329135572 green; tag v0.3.89.0 on remote; zip hibana.0.3.89.0.zip (536 entries) in /home/z/upload/; Changelogs §1 exactly 4 blocks (S157→S156→S155→S154); package.json 0.3.89.0.
- Live spot byte-verify on hibana.ir: variables.5befc2ab.css, dashboard.192ccc19.css, quicknotes.3a8eb154.css all sha-identical to local public/dist/; /api/health ok (prod, schema 60, kv).
- Committed the three untracked release helpers → **91408b1** ("chore: track the release-chain helpers — repo self-contained for a fresh clone"): make-zip.mjs (the per-version zip generator) + rotate-s156.mjs/rotate-s157.mjs (§1 rotation recipes). Secret-scanned (clean). CI run 36339304859 + CD run 36340121882 green on the push; CD redeployed the same bits to Cloudflare successfully.
- Wrote this worklog.md and committed it so the fresh clone starts with full context.

Stage Summary:
- Repo state: main @ worklog commit, working tree clean, everything on https://github.com/assadigit/hibana-source, tags through v0.3.89.0 on remote.
- Live: hibana.ir serves v0.3.89.0 (byte-verified). Deploy = push to main → GitHub Actions CD (Cloudflare Workers, KV storage, schema 60).
- Next session's owner directive: **fix UI/UX quirks + work on the ideas (sparks) pages.**
- Sparks pointers: `public/sparks.html` (page shell), `src/routes/projects/index.ts` + `src/routes/projects/helpers.ts` (server render + folder chips `data-sf`), `src/routes/projects/detail-helpers.ts`; e2e lessons from S156 in `e2e/s156-card-overflow.spec.ts` (the flat shelf = /sparks.html + click `[data-sf="all"]`; `/projects.html?status=spark` is NOT the ideas card surface; `?folder=all` is not honored on hard load). Sparks e2e precedent: `e2e/s120-draft-flush-sel.spec.ts`.
- Standing law: **Agents.md is non-negotiable** (verification ladder, `?v=` cache-bust on every touched CSS/JS, EN+FA i18n parity, design tokens only — hex/rgba only inside CSS custom properties, RTL logical properties, reduced-motion support, the §7 REJECTED list is never re-proposed). Typography: General Sans 400/500/600 (700 reserved), weights via `--text-*` tokens. Never leave a round half-shipped: commit → CI+CD green → byte-verify live → tag → make-zip.mjs → Changelogs §1 rotation (exactly 4 blocks) + §2 row → worklog.
- Ops creds (repo, CF, Telegram, healthcheck, Workers AI, test account) come from the owner's prompt each session — never commit them.

---

Task ID: S158
Agent: Z.ai (session 158 — the extensionless page-identity round)
Task: owner directive "fix UI/UX quirks; work on the ideas (sparks) pages" — live agent-browser sweep (light+dark, FA/RTL, 390px), then fix the worst find.

Work Log:
- Live sweep (hibana.ir, owner's test account): sparks views cards/list/sticky/kanban × light/dark × FA/RTL × 390px — structurally clean (no overflow, Persian digits correct). VLM-assisted screenshot review surfaced the rail-indicator observation that led to the root cause.
- ROOT CAUSE FOUND (one bug, seven dead behaviors on prod): Workers' assets binding (html_handling auto-trailing-slash) 307s every /page.html to /page — live always runs EXTENSIONLESS, but the client's page-identity checks compared the .html form only. Node serves both forms (S70), so e2e never saw it.
- Live-reproduced + cleaned: (1) S28 captures with a folder open filed UNFILED (folder_id:null via API); (2) post-capture bounce to /app (the 2026-08-25 request); (3) "Files into" hint hidden; (4) desktop rail aria-current never lit on ANY hard load (mobile-nav's normPath already stripped .html since S59 — the desktop twins never did); (5) RAIL_ICON_PAGES missed /board; (6) palette Trash re-navigated on /settings; (7) 401/loginBounce guards missed /login.
- FIX (4 client files): app.js pageIs() both-forms helper (sparks triple + 401 guard + canHostCards + PUBLIC_PATHS); hib-init norm() + nav.js railNorm() strip .html both sides (lockstep twins); nav.js markRailRows pageOf() at FUNCTION scope (first cut declared it inside the first forEach — the .is-here branch threw ReferenceError, caught by rail-panel e2e mid-round, hoisted); HARD_PAGES/RAIL_ICON_PAGES extensionless forms; command-palette settings both forms.
- CACHE-BUST: app v211→v212 (23 pages) + nav v35→v36 (17) + hib-init v10→v11 (23) + command-palette v16→v17 (18) — gate PASS; no sw.js change (SHELL never precaches app JS).
- LADDER: typecheck 0 · vitest 526/526 · eslint 0 errors (162-warn baseline; the new spec lints clean) · node --check all four files · wire 26/26 + canonical restored · i18n parity 1480/1480 (client-only, 0 new keys).
- TESTS: new e2e/s158-extensionless-pages.spec.ts 3/3 — the capture triple (hint SHOWS + folder_id FILES + page STAYS + shelf soft-refresh) pinned on BOTH /sparks and /sparks.html + rail markers on /sparks + /projects + the .html form. SPEC LESSON: seeded spark_folders ids MUST be dashed 36-char UUIDs (crypto.randomUUID) — the attach guard is /^[0-9a-f-]{36}$/i; bare 32-hex ids are (correctly) rejected and the first cut pinned a lie until a manual debug caught it. TEETH: stash-revert of app.js → the extensionless test fails exactly as live did; restored → passes.
- FULL regression: 266/266 across two shards (139 + 123 first-try + 2 real mid-run bugs fixed + 2 isolated-pass flakes: s120 video-seek + sprint modal, green on re-run); rail-panel 21/21 after the pageOf hoist.
- CHAIN: feature 2a37126 pushed → CI 36347130879 + CD 36347965145 ALL GREEN → live byte-verified 4/4 changed dist assets (app.eda7ebf1 + nav.5fbeeac8 + hib-init.4e3655c8 + command-palette.e8d32070 sha-identical; first attempt compared the CANONICAL build — the wired form is the deploy artifact, rebuilt --wire-html for the true compare) + /api/health ok (prod, schema 60, kv) → LIVE functional re-verify as the owner's account: rail marks Ideas at /sparks, hint shows "Files into: Content Creation", capture filed folder_id=4e3d… (correct), page stayed on /sparks; test idea deleted. → tag v0.3.90.0 → zip hibana.0.3.90.0.zip (540 files, wired form, integrity OK, no credentials) → §1 rotated (S154 dropped to git history; exactly 4 blocks) + §2 row 158. package.json 0.3.89.0→0.3.90.0.

Stage Summary:
- Live: hibana.ir serves v0.3.90.0 — the S28 folder-capture, the stay-on-page capture, the Files-into hint, and the desktop rail's current-page indicator all WORK on the extensionless live URLs now.
- Sweep residue catalogued but NOT fixed this round (candidates for S159+): the sparks KANBAN home view omits the sf-bar folder chips entirely (deliberate? code comment absent — worth an owner ask); FAB + "Capture an idea" dual CTA on sparks is S45-intentional; VLM noted folder-card border-style variance (all-card accent vs dashed new-folder is by design).
- Next session: continue the owner's sparks-pages directive — the kanban sf-bar question above; then the remaining sweep residue.

---

Task ID: S159
Agent: Z.ai (session 159 — the sparks folder-Kanban round, via the 15-min review loop)
Task: the loop's second round — QA the live sparks surfaces, then advance the owner's sparks-pages directive (S158 sweep residue item (a)).

Work Log:
- Live QA (agent-browser, hibana.ir): sparks clean post-v0.3.90.0 (0 console errors); confirmed the residue — kanban home renders .kanban WITHOUT the sf-bar (New-folder/rename/delete/filter/counts unreachable in that state; the bar only appeared once a folder was selected).
- FEATURE: index.ts kanban branch — sparkFolderBar now rides sparkKanbanHtml unconditionally; kanban home carries no active chip (honest: no filter applied).
- STYLING: sparkKanbanHtml's col head joins the S85/S137 shared board-column convention — h4.kanban-col-head + .spark-kb-glyph (1.45rem centered slot, BOTH faces: folder emoji + muted folder-plus fallback) + .kanban-col-label + .board-count pill with the NEUTRAL muted ink (no --badge-fg assignment — folders carry no status role). Was: bare h4 + .chip pill + plain muted count (the pre-S85 look; the LAST surface speaking it).
- CACHE-BUST: canvas.css v10→v11 (22 pages), gate PASS. 0 JS changes, 0 new i18n keys (parity 1480/1480).
- LADDER: typecheck 0 · vitest 526/526 · eslint 0 errors (touched TS + the new spec) · wire 26/26 + canonical restored.
- TESTS: new e2e/s159-sparks-kanban-bar.spec.ts 5/5 — bar affordances in kanban home ([data-sf-new], [data-sf-menu], no-active-chip), head recipe pins (class structure + both glyph faces + pill shape/ink/count + honest label), FA/RTL, 390px wrap+containment, folder-selected flow (is-active chip + #spark-folder UUID + filed present/unfiled filtered). SPEC BUG fixed: Node constants must ride page.evaluate ARGUMENTS. TEETH LESSON (banked): the first stash-revert check passed INVALIDLY — the shared :3017 server process held the NEW code in memory (node --import tsx does not hot-reload); the real teeth check killed+rebooted the server on the stashed code → fail → restored+rebooted → 5/5.
- FULL regression 268/268 (141 + 122, zero flakes first-try — sparks.spec's kanban section green with the bar present; no visual baseline re-shoot needed — the pinned pages don't carry the sparks board).
- QA: local computed probes exact (glyph ✒️/label/pill 999px rgb(92,92,92) light, rgb(156,156,155) dark); VLM light+dark review: clean, consistent, nothing cramped; console 0 errors.
- CHAIN: feature fa77f35 → CI 36351436737 + CD 36352165564 green → live byte-verify canvas.a4fc3923.css sha-identical + /api/health ok (prod, schema 60, kv) → live functional check (bar + recipe on prod) → tag v0.3.91.0 → zip hibana.0.3.91.0.zip (541 files, wired form, integrity OK) → §1 rotated (S155 dropped; exactly 4 blocks: S159→S158→S157→S156) + §2 row 159. package.json 0.3.90.0→0.3.91.0. Healthcheck pinged.

Stage Summary:
- Live: hibana.ir serves v0.3.91.0 — the sparks Kanban home is a complete folder workspace (create/rename/delete/filter/counts + the shared board-column header convention on all three boards now).
- Residue for next rounds: (b) soft-nav pushState pushes the .html form on live (cosmetic URL-bar inconsistency); sticky-notes have draggable=true with NO drop targets (dead affordance — either wire drag-to-file like kanban or drop the attribute); the folder-card icon→title rhythm (VLM's "top-heavy" note — marginal, likely fine).
- The 15-min review loop continues; the next round should pick from the residue or a fresh sweep.

---

Task ID: S168 (folding S160–S167)
Agent: Z.ai (session 168 — the Ideas-section redesign release: third rebuild, then the owner-authorized release chain)
Task: the owner's 16-item hibana-ideas-section-spec.md + "Commit and push and deploy" — rebuild the S160–S166 work lost to two sandbox resets (the S167 worklog section was the build manual), run the full gate ladder, ship v0.4.0.0.

Work Log:
- REBUILD (P1–P5, all landed): 0063 schema + spark routes (ordering pinned-first, cross-field LIKE+EXISTS search, HX hand-off, banner PUT/GET/DELETE, folder pastel CRUD + DELETE FK sweep, updated_at bumps) · helpers.ts renderers (folderPair, sparkCardHtml, list/sticky fragments, folder header + search empty) · the lean page (public/spark.html + spark-page.js + image-crop.js: field-set, draft store, Save+✓+Ctrl+S, pin, tags/folder/links, gallery + cover, lightbox inside main.shell, hibana:i18n repaints) · sparks-page.js rewrite (debounced search + count, unified DnD, pin toggle, ⋯ menu + promote, folder dialog 16 swatches, banner flow, mobile tap-to-expand) · dashboard.css v31 (+~350 lines, logical props + reduced-motion) + base.css v11 [hidden] reset · +44 i18n keys en+fa · sw.js SHELL +/spark.html (v406).
- GATES: typecheck 0 · vitest 539/539 (13 new S161 contracts) · eslint 0 errors (163-warn baseline) · build 78 · wiring (canonical restored) · cache-bust 9 files PASS · parity 1536/1536 · smoke ALL PASS · e2e s161 10/10 · FULL SUITE 281/281 (14.9m, zero flakes).
- D1 PRE-PUSH (the S126 ritual per the §5 runbook — d1-migrate.mjs per migration, NEVER wrangler migrations apply on live DBs): ground truth first — prod d1_migrations runs through 0061 (60 rows; 0007 skipped — the S166 "0061 pending" note was a miscount), so only 0062 + 0063 rode this round. Both applied to BOTH D1s with bookmark → dump → digest → apply → verify + row proofs: 0062's categories fold (prod: 38 dev_tasks rows byte-identical, legacy ids preserved → pastel-mapped global categories, both projects enabled; dev: row-identical) + 0063 (37 projects + 2 folders, only new NULL columns). The FTS shadow drift on dev_tasks' rebuild is derived re-index — classed advisory. Both DBs schema 60→62; 4 bookmarks in §9; dumps + digests + integrity reports archived to hibana-safe (backups/dumps/pre-0062 + v0.4.0.0-migration-evidence).
- CHAIN: feat f4bc4c1 (package.json 0.4.0.0) pushed → CI 36433529269 + CD 36435268857 ALL GREEN → live byte-verified (all 11 changed assets green: 10 byte-identical + i18n.js proven semantically — the live bundle embeds the new i18n-fa.8eae69d3 hash; the 4 untouched sources keep serving their long-deployed runner bytes; NOTE: this sandbox's esbuild skews 5 dist filenames vs the runner — a local-tooling condition, not a deploy defect, first seen after the reset-#2 reinstall) → live functional verify as the owner's account (login → Ideas shelf → cross-field search "2 matches" + ✕ clear → capture stays on /sparks → card opens the LEAN page /spark.html?id=… → Save " ✓ Saved" → Pin floats the idea to Unfiled's top → folder header (Upload a banner + name + "9 ideas · Updated 14d ago") → delete → back on /sparks, count restored, 0 console errors; test idea cleaned up) → tag v0.4.0.0 → zip hibana.0.4.0.0.zip → §1 rotated (S168 → S159 → S158 → S157; S156 dropped; exactly 4 blocks) + §2 row 168 → healthcheck pinged.
- TOOLING: rotate-s168.mjs's [hidden] literals were bracket-eater-corrupted at write time — python ground-truth caught it (3 spots fixed; full-tree sweep clean; the commit message written via python to keep the literal intact — git log's display still eats it, the bytes are provably healthy).

Stage Summary:
- Live: hibana.ir serves v0.4.0.0 — the Ideas section is its own lean surface (lean /spark.html, pins, folder headers + banners + 16 pastels, cross-field search, honest list icon column, cover thumbs, drag-to-file, promote dialog, mobile condensed cards) and the global categories system is finally ACTIVE on live.
- Ops lessons: (a) health schema_version counts rows incl. the skipped 0007 — always query d1_migrations for ground truth before deriving what's pending; (b) FTS shadow tables belong in the transient class for any table-rebuild migration; (c) the bracket-eater strikes tool-WRITTEN bytes — python reads/writes + assembled literals are the countermeasure, sweep before shipping; (d) chained wrangler rituals can exceed a 300s bash window — run the after-digest as its own command.
- Residue for next rounds: the S162–S166 polish not rebuilt (search highlight, match-reason badges, tag-click-to-search + ?q= deep-link, palette Ideas group + Folders quick-jump, lean-page meta lines, the a11y i18n sweep, avatar stale-cache) · the promote dialog keyboard test · folder-pref dead-id self-heal · lean-page unsaved-changes beforeunload · soft-nav pushes the .html form on live (S159 residue, cosmetic).

## S169 — THE WAND PATCH (v0.4.0.1, deployed)

- Owner's live report on the fresh v0.4.0.0 redesign: "The AI-assist icon doesnt
  appear for this new ideas page and each fields but it must." Root cause: THREE gaps
  the S161 lean-surface rebuild opened — (1) spark.html loaded magic-wand.css but
  NEVER magic-wand.js (no icon could ever appear on the lean idea page); (2) none of
  its fields carried [data-magic]; (3) the redesigned Ideas list lost the wand the
  old .pc-title cards had.
- FIX 1 (205454b): spark.html loads /js/magic-wand.js?v=17 + [data-magic] on the
  title input, description textarea, the client-rendered tag-add input, and the
  link-LABEL input (Apply rides the page's own save semantics: input dispatch feeds
  the S120 draft store + dirty state, then the explicit Save). The link-URL input
  and the folder select stay wand-free BY DESIGN (AI polish on a URL/select corrupts
  data). The list restored: data-magic + data-magic-save + data-magic-field on
  titles in ALL FOUR views (cards/list/sticky/kanban — the .pc-title PATCH
  contract). sw v407; spark-page v2→v3.
- FIX 2 (48265ed, the live-QA bonus catch): the S166 hibana:i18n repaint's
  unguarded renderPin threw "Cannot read properties of null (reading 'pinned_at')"
  as a REAL prod console error (i18n's async apply() can settle before the idea
  fetch resolves; the local QA timing never hit it). The repaint now guards its
  renders on a LOADED idea. spark-page v3→v4.
- Ladder: typecheck 0 · vitest 539/539 · eslint 0 errors (163-warn baseline) ·
  build 78 · wiring · cache-bust PASS · parity 1536/1536 (0 new keys) · targeted
  e2e 28/28 + 14/14 after fix 2 (s161/sparks/s119/s120 — no blast radius).
- QA: local (:3017) EN+FA/RTL — wand on hover for all four fields + list titles,
  popover, the full Polish→Apply→Unsaved→Save→reload-PERSISTED flow via a mocked
  /api/ai/text, Ask-AI panel, RTL inline-start anchoring, Persian popover. LIVE
  (hibana.ir, the owner's account): 19/19 real titles stamped; a TEST idea drove
  the REAL Workers AI Polish end-to-end (suggestion returned, applied, saved,
  persisted across reload) then was deleted; fresh-session error check on the
  guarded v4 build: 0 page errors.
- Chain: both fixes pushed → CI (double-delivered: ×2 each) + CD (×2 each) ALL
  GREEN → live verified → §1 rotated + row 169 → tag v0.4.0.1 → zip → ping.
  package.json 0.4.0.0→0.4.0.1.
- Ops notes: (a) the first post-deploy curl hit a pre-purge edge node serving the
  OLD page — re-fetch before declaring a deploy state; (b) agent-browser's
  `errors --clear` doesn't actually empty the JSON store — verify with a FRESH
  browser session, not a cleared list; (c) dependabot opened a dev-deps PR whose
  CI FAILS on its own branch — irrelevant to main, ignore; (d) GitHub
  double-delivered the push events (2×CI + 2×CD per commit) — both copies green.

## S170 — SESSION WRAP (v0.4.0.1 verified live; the review-loop agenda handed off)

Task ID: S170
Agent: main (Z.ai Code)
Task: Owner directive — "Wrap up this session, commit to github, deploy the
latest version in the cloudflare" + write the next-session prompt (a review
loop: UI/UX quirks, every function works, mobile responsive fixes — e.g.
unnecessarily large buttons in mobile view — and continuous review/testing of
the new Ideas page).

Work Log:
- Repo state verified: main @ c016d0e = origin/main, tree clean; tags v0.4.0.0
  (f05faab) + v0.4.0.1 (c016d0e) live on the remote; package.json 0.4.0.1. The
  S169 chain (wand fix + renderPin guard + rotation + tag + zip + healthcheck
  ping) was already complete at session start — nothing code-side left to ship.
- LIVE re-verified independently this session (not from S169's record alone):
  /api/health ok · prod · schema 62 · kv; /spark serves magic-wand.js?v=17 +
  spark-page.js?v=4 (the wand wiring + the guard); /js/magic-wand.js 200
  (28,491B); CI + CD on c016d0e both conclusion=success. v0.4.0.1 IS the
  deployed latest — confirmed, no redeploy needed.
- Session delta = the close-out only: this worklog entry (both copies), the
  next-session prompt at /home/z/next-session-prompt.md (the review-loop
  charter: 1. UI/UX quirks · 2. every function works · 3. mobile responsive
  problems — oversized buttons called out by the owner · 4. keep
  reviewing/testing the Ideas page), and ONE fresh 15-min webDevReview cron
  (the four stale/duplicate loop jobs — two exec-limit-disabled, one stopped,
  one carrying pre-v0.4.0.0 context — deleted first; NOTE: the two disabled
  ones hit "exec limits exceeded", so a 15-min cadence can outrun the agent
  quota — if the new job disables itself, that is why).
- Docs-only commit (no code, no version bump, no tag): worklog S170.

Stage Summary:
- LIVE: hibana.ir @ v0.4.0.1 — the AI-assist wand on every prose field of the
  lean idea page + idea titles in all four list views; the renderPin error
  gone; schema 62.
- Next rounds: the review-loop agenda — start from
  /home/z/next-session-prompt.md + the residue lists in S168/S169 (the
  S162–S166 polish rebuild backlog is the mine: search highlight,
  match-reason badges, tag-click-to-search + ?q= deep-link, palette Ideas
  group + Folders quick-jump, lean-page Created/Updated meta, a11y i18n
  sweep, avatar stale-cache, promote-dialog keyboard test, folder-pref
  dead-id self-heal, lean-page beforeunload guard, mobile oversized-button
  audit).

## S173 — THE REVIEW ROUND + BACKLOG SWEEP (v0.4.1.0, deployed)

Task ID: S173
Agent: main (Z.ai Code)
Task: Owner directive — "commit and push and deploy everything; empty your
backlog and finalize." A THIRD sandbox reset had eaten the S171+S172 local
(unpushed) commits, so this round rebuilt both from the worklog records and
folded the S162–S166 residue into the same release.

Work Log:
- Recovery: cloned main @ 511d448 (v0.4.0.1 live), restored the gitignored
  credential files, bun install frozen-lockfile.
- S172 REBUILT: the composer's block-7 «SET UP CATEGORIES» prompt retired
  (markup + JS + CSS — it interrupted the first task creation with a 639px
  block inside a 508px modal); setup = the board-header Categories dialog +
  the picker's auto-enabling inline Create; `.modal .pd-cat-toggle` specificity
  restore (the `.modal label{display:grid}` rule broke every row into a
  1.1kpx grid slab); in-place On/Off label sync + 'ok' toasts; 44px touch
  rows; the Settings `.pd-cat-row` wraps at 360px. POST-sweep catch: an orphan
  `pdRefreshSetupList()` call in the [data-pd-add] handler threw an async
  ReferenceError the e2e console-pins caught (2 full-suite failures on the
  stale in-memory server; fixed + both green on reboot).
- S171 REBUILT: the lean page's Created·Updated meta line (+8 i18n keys, FA
  digits, the server timeAgo units mirrored client-side); the beforeunload
  guard (dirty fields never silently vanish; disarms after Save + the
  confirmed delete hop); pin aria-label sync; mobile empty-thumb hiding at
  ≤640px; 44px coarse-pointer chips; eslint ignores aligned with the linted
  surface (a bare `eslint .` used to drag in 4.4k phantom errors).
- BACKLOG EMPTIED: search highlight (`mark.spark-hit`, token-built brand wash)
  + match-reason badges (Title/Description/Tag: x/Link: y/Folder: z — the
  server computes per-row reasons via the same LIKE over matched rows'
  children); ?q= + ?folder= deep-links (hard-load inline stamp + the soft-nav
  mount stamp — the S40 pattern); the 30s poll no longer wipes an active
  search (#sparks-q joins hx-include); dead folder-pref self-heal; the
  palette's Idea-folders quick-jump; the avatar stale-cache re-stamp; the
  promote-dialog keyboard path pinned.
- GATES: typecheck 0 · vitest 539/539 · eslint 0 errors (163-warn baseline;
  bare `eslint .` now equals src/'s truth) · build 78 · wiring (canonical
  restored) · cache-bust PASS (10 files, 126 bumps: quicknotes v38 ×25,
  dashboard v32 ×23, project-page v70, sparks-page v12, spark-page v5,
  settings-page v15, command-palette v18 ×19, i18n-en v86 ×26, i18n.js v140
  ×26 + fa loader v80) · parity 1546/1546 (+10 keys) · FULL SUITE 288+2
  (the 2 = the orphan-call console pins, green after the fix) · NEW
  e2e/s173-review-round.spec.ts 9/9 + s152's block-7 test REWRITTEN to the
  S172 contract (4/4) · blast radius 57/57.
- sw.js VERSION v407→v408 (spark.html + sparks.html + project.html +
  settings.html are SHELL-precached and changed).
- QA (agent-browser, :3017): EN + FA/RTL + dark + 390px on every touched
  surface; the tag-click→deep-link→badge flow driven end-to-end; fresh-session
  console + page errors 0. (VLM skipped this round — the S171 lesson stands:
  computed-style probes are the arbiter.)
- CHAIN: feature c90f82d pushed → CI 36573897854 + CD 36575255660 ALL GREEN →
  live byte-verified (all 10 changed assets IDENTICAL: 9 dist bundles +
  spark-page.js) + /api/health ok (prod, schema 62, kv) → live functional
  verify as the owner's account (login → lean meta line "Created 15d ago ·
  Updated 21h ago" on real data → search "YouTube": 9 matches + 9 marks +
  Title badges → the Categories dialog: flex rows, 44px, the On/Off flip
  in place, the PUT persisted, the owner's original state RESTORED) → tag
  v0.4.1.0 → zip hibana.0.4.1.0.zip (551 files, integrity OK, 0 real
  secrets) → §1 rotated (S158 dropped; exactly 4 blocks) + §2 row 173 →
  healthcheck pinged. package.json 0.4.0.1→0.4.1.0.

Stage Summary:
- LIVE: hibana.ir serves v0.4.1.0 — the categories setup is finally where it
  belongs, the lean idea page says WHEN, the search says WHY, and the
  S162–S166 residue list is EMPTY.
- Backlog status: search highlight ✓, match badges ✓, tag-click-to-search +
  ?q= deep-link ✓, palette Ideas group + Folders quick-jump ✓, lean-page
  Created/Updated ✓, avatar stale-cache ✓, folder-pref dead-id self-heal ✓,
  promote-dialog keyboard test ✓, beforeunload ✓. Remaining known items
  (documented, deliberately not this round): the a11y i18n sweep (a large
  surface audit, deserves its own round), the categories table remains
  install-global (no user_id — cross-account visibility on shared installs;
  a future migration candidate, needs the owner's written approval per rule 4).
- Ops lessons: (a) a deleted function's call sites must be swept BEFORE any
  suite run — an async .then() callback ReferenceError fails only the
  console-pinning specs and hides elsewhere; (b) a backgrounded full suite
  holds the OLD code in memory (node --import tsx, no hot reload — the S159
  lesson again): kill + reboot before re-verifying a mid-run fix; (c) the
  esbuild filename skew from S168 did NOT recur (all 9 dist hashes matched
  the runner's); (d) live probe timing: give the dialog's async paint a beat
  before declaring "no rows".

## S174 — THE CATEGORIES DELETE + THE CIRCLE PALETTE (v0.4.1.1)

Task ID: S174
Agent: main (Z.ai Code)
Task: Owner directive — "Add option to delete category in setting, currently
it's only 'archive mode'; also the color pallete to choose for that category
is too big, make them circles."

Work Log:
- Backend: DELETE /api/categories/:id added next to the archive POST in
  src/routes/categories.ts — ONE transaction (dev_tasks.category_id → NULL,
  project_categories rows dropped, the category row deleted), mirroring the
  0062 FK declarations (SET NULL + CASCADE) explicitly so the outcome never
  depends on the engine's foreign_keys mode; works on archived ids too.
- Frontend (settings-page.js): the row actions become Edit / Archive /
  Delete (danger ghost, title hint); the confirm spells out the difference
  ("tasks stay but lose their category chip — archive instead to keep it");
  toast "Category deleted"; the handler rides the existing delegated click
  listener (data-cat-delete), reload via the same load().
- Circles (quicknotes.css): .pd-cat-swatches becomes a wrapping flex row;
  .pd-cat-swatch-tile becomes a fixed 1.9rem circle (2.05rem ≤480px),
  border-radius 50%, "Aa" ink preview kept, the selection ring rebuilt as
  box-shadow (inset hairline + 2px var(--card) gap + 4px var(--text) ring —
  round on every engine, unlike outline). QA caught the global button
  padding (0.55rem 1rem) inflating the fixed-size flex item into a 32×30
  ellipse (min-width:auto floors at content+padding; the old 1fr grid masked
  it) → padding: 0 on the tile.
- project-page.js: pdSwatchGridHtml's buttons now carry the
  .pd-cat-swatch-tile class — the composer/editor quick-add swatches were
  UNSTYLED bare buttons since S152 (no class, no CSS match); one class now,
  circles everywhere.
- i18n: +3 keys ×2 (cat.deleteConfirm / cat.deleted / cat.deleteHint) —
  parity 1549/1549.
- Cache-bust: quicknotes v38→v40 ×25 (the padding fix landed under v39 and
  the QA browser served the STALE v39 from HTTP cache — the edit-after-bump
  re-bump rule caught live), settings-page v15→v16, project-page v70→v71,
  i18n-en v86→v87 ×26, i18n.js v140→v141 ×26 + fa loader v80→v81; sw.js
  VERSION v408→v409 (settings.html + project.html are SHELL-precached).
- package.json 0.4.1.0→0.4.1.1.
- GATES: typecheck 0 · vitest 539/539 · eslint 0 errors (163-warn baseline)
  · node --check on all touched JS · build 78 · wiring (canonical) ·
  cache-bust PASS (6 files) · parity 1549/1549 · FULL e2e 290/290 in 5
  sequential file-batches (the sandbox reaps detached processes between
  agent tool calls — a single 15-min playwright run cannot survive; each
  batch ran inside one call: 70 + 84 + 51 + 79 + 6).
- AGENT-BROWSER QA (:3017, fresh seeded owner via qa/seed-s174-qa.mjs):
  EN + FA/RTL + claude-dark + 390px; the delete flow driven END-TO-END in
  both languages (create → confirm copy verified verbatim EN+FA → row gone
  → toast); THE SEMANTIC PIN: a task wearing the deleted category SURVIVES
  chipless (DB checked: category_id NULL, enables 0, categories 0); circles
  verified by computed style on all three surfaces (add form, edit row,
  picker: 30.39×30.39, ratio 1.000, radius 50%, padding 0; ring shadow chain
  read in dark); recolor-via-circle PATCH round-trip; 44px action buttons at
  390px, zero h-overflow; 0 console errors.

Stage Summary:
- LIVE: hibana.ir @ v0.4.1.1 (after push + CI/CD) — Settings → Categories
  rows carry Delete; every swatch palette is 16 small circles.
- Ops lessons: (a) node -e inside double-quoted bash mangles `${…}` — the
  PBKDF2 seed hash got corrupted and the QA login failed until a real .mjs
  seed file ran (the D1-discipline rule generalizes to ALL node -e);
  (b) the sandbox reaper kills backgrounded processes when the agent's
  tool-call shell exits unless they ride a subshell+nohup — the QA server
  survived that way, the detached playwright run did not (5 foreground
  batches are the workaround); (c) the edit-after-bump re-bump discipline
  caught a REAL stale-cache serving mid-round (v39 served from HTTP cache
  after the file changed under the same URL).

---
Task ID: S175
Agent: main (Z.ai Code)
Task: Hibana (at /home/z/hibana) — owner round: "add this: ability to collapse the ideas section in project progress part (which has ideas, problems, plans etc) — when user collapse that part, there is more space for others to expands, also it must remain collapsed until the user de-collapse them. more over when items are in done box, their priority color label must be turned to a pale and lower opacity color (because they're done and no point showing the priority color coding)". Released as v0.4.1.2.

Work Log:
- (A) FOLD — every Project Progress box (New Ideas / Problems / Plans / In
  Progress / Done) gains a leading chevron button in its header strip
  (detail-helpers.ts: [data-pd-col-collapse], aria-expanded synced, aria-controls
  → the new #pd-tasks-<status> ids, inline ▼ svg like the dashboard's collapse
  button). Folding sets [data-collapsed] on the column: contents + Add + the
  action cluster hide (project-header.css) and the box shrinks to
  inline-size: fit-content.
- THE WIDTH MECHANIC: .pd-board-grid converted grid→flex (flex: 1 1 0 + grow
  keeps the all-open 5-equal-share layout pixel-identical at 204px/box; 2-up
  ≤900px via basis calc(50% - 0.3rem); stack ≤540px) — a folded box (flex: 0 1
  auto, fit-content) frees its share to the REMAINING boxes (measured: 240px
  per working box with Ideas+Done folded; the source-order rule keeps the
  folded box a narrow chip on phones too, where folding saves vertical scroll).
- PERSISTENCE (the owner's "must remain collapsed until de-collapse"): the
  folded set lives in the 'hibana-pd-cols-collapsed' localStorage store — the
  dashboard's collapse contract (app.js 'hibana-dash-collapsed'), GLOBAL by
  column key (the fold is a property of the board UI); re-applied on every
  #project-body htmx sweep beside the remembered tab (project-page.js joins
  pdApplyCollapsed to the afterSwap re-apply loop).
- NEVER A WALL: pdConsumeColHash auto-unfolds a #pd-col-<status> deep-link
  target; a card DROPPED onto a folded box unfolds it and lands (mouse: the
  drop event's pointer column rides as pdCompleteDrop's new hintCol param;
  touch: the tracked pdOver captured before pdTouchReset clears it; the
  dragover/touchmove placement preview SKIPS folded boxes so the card stays
  visible in its source list while the chip highlights).
- Declared the S175 helpers BEFORE pdConsumeColHash — a const in a TDZ would
  ReferenceError on the initial call if the board is already swept (soft-nav
  re-exec); caught at review time, never shipped.
- (B) DONE PALE — ONE container-scoped rule (polish-batch.css):
  .pd-tasks[data-pd-tasks='done'] .prio-banner { color-mix 18% of the medium
  token into card; muted ink; opacity .7 } + hover restores 1 (the banner is
  still the cycle button); specificity (0,3,0) beats the per-priority fills
  (0,2,0). Covers the project page AND board.html (same container attr) and
  FOLLOWS cards across boxes with zero per-card state (every move path
  re-parents the wrap). Both themes keep their own tokens.
- Cache-bust: project-header v46→v47 ×23 pages, polish-batch v28→v29 ×23,
  project-page v71→v72; sw.js VERSION v409→v410 (project.html is
  SHELL-precached and changed); package.json 0.4.1.1→0.4.1.2.
- GATES: typecheck 0 · vitest 539/539 · eslint 0 errors (163-warn baseline)
  · build 78 · wiring (canonical) · cache-bust PASS (3 files) · parity
  1549/1549 (0 new keys — the server strings are inline trL EN/FA pairs,
  paired by construction) · FULL e2e 294/294 in 5 foreground file-batches
  (45 + 76 + 44 + 57 + 47 + the 25 targeted first).
- NEW e2e/s175-board-fold.spec.ts (5 pins): fold/persist/freed-width (≥10px
  growth measured), the deep-link auto-unfold + q-arrived, pale on BOTH
  surfaces + follow-the-card (synthetic drag into done), the drop-onto-folded
  landing (box unfolds, card visible, store cleared), the 44px touch floor
  via a hasTouch context.
- AGENT-BROWSER QA (:3017, the e2e-s175 owner): EN + FA/RTL + claude-dark +
  390px — fold round-trips with the store verified at every step; RTL flow
  (the chip lands reading-start, 979-1138px on the right in FA); dark token
  flips; the phone stack with zero h-overflow (chip 159×60 at 390px); the
  fullscreen board pale; console + page errors 0. VLM hallucinated "all
  boxes expanded" on a screenshot of a folded board — the computed-style
  probes (the arbiter) prove the fold; a pixel-diff between the open/folded
  shots confirms the layout change.
- CHAIN: feature 3d33ed2 pushed → CI 36615608995 + CD 36617281336 ALL GREEN
  → live byte-verified (project-header.2493c243.css + polish-batch.dbd8387d.css
  + project-page.51cfea12.js IDENTICAL vs local dist; sw.js hibana-v410;
  health ok/prod/schema 62) → live functional pass as the owner's account
  (fold + freed width on the real Hibana board; the pale banner observed on a
  fully-reversible probe project — created, verified, soft-deleted; the
  owner's library + client prefs left exactly as found) → tag v0.4.1.2 → zip
  hibana.0.4.1.2.zip (568 entries, 0 real secrets, in upload/ + download/) →
  Changelogs §1 rotated (S168 dropped; exactly 4 blocks) + §2 row 175 →
  healthcheck pinged.

Stage Summary:
- LIVE: hibana.ir @ v0.4.1.2 — every progress box folds (chevron chip, freed
  width, persisted until unfolded) and done items wear the pale faded banner.
- Ops lessons: (a) the live project page route is /project (S158 extensionless
  form — /project.html 307s; live byte-verify reads the wired /dist/ hrefs
  from the FOLLOWED page); (b) an eval-stored window var does not survive
  agent-browser navigation — the live-cleanup DELETE silently hit
  /api/projects/undefined (404) until re-issued with the literal id; (c) a
  bare `ls dist/` misled the byte-verify — the build's DIST_DIR is
  public/dist; (d) dist/ vanished between rounds (reaped with the tool-call
  shells) — rebuild before byte-verify; (e) the TDZ-order hazard in page-JS
  closures: consts consumed by hoisted function declarations that run at
  mount must be declared ABOVE the first call site.

---
Task ID: S176
Agent: main (Z.ai Code)
Task: Hibana (at /home/z/hibana) — owner round, two items: (1) from the sketch — "it is collapsed, but it still takes a little too much space, use 50% of current space, and make the collapsed like this: [button to de-collapse] [Ideas written vertically to save space]"; (2) the five-request code-block spec for the "Create a new task" modal's Content field (single <pre><code> container, typography+contrast, header bar + copy button, plain-text paste + Tab + toolbar disable, syntax highlighting with a limited palette + auto-detect + plain-text storage). Released as v0.4.1.3.

Work Log:
- (A) THE RAIL — the folded box's CSS redesigned per the sketch (project-header.css,
  scoped @media min-width 541px): inline-size 2.5rem (~40px, under half the owner's
  "50% of current space" ask — the old fit-content chip was ~150-180px), the col
  becomes a flex column with padding 0, the tinted .pd-col-head fills the rail
  (flex 1 1 auto, column layout, full radius), the chevron docks at the top, the
  title gets writing-mode: vertical-rl + rotate(180deg) (bottom→top reading —
  direction-neutral, FA titles rotate identically; the rail lands at the
  reading-start edge in RTL — browser-verified), the count badge pins to the foot
  via the title's margin-block: auto, the stage dot HIDES (the sketch's minimal
  rail — the colored border edge carries the coding), min-block-size 9rem so short
  rows still read as rails. Coarse pointers widen the rail to 3.25rem (the 44px
  chevron law). ≤540px keeps the S175 compact horizontal chip (phones save VERTICAL
  space — a tall rail would waste it). ZERO JS/HTML changes: the data-collapsed
  mechanism, the store, the deep-link + drop auto-unfolds and every S175 pin are
  untouched (s175 spec 12/12 green, incl. the ≥10px width-growth + 44px touch pins).
- (B) THE CODE BLOCK — project-page.js gained the code-block runtime (~250 lines,
  inserted before pdCodeHost): pdCodeBlockHtml/pdCodeBuild (ONE <pre
  class="t-code-pre" dir=ltr data-lang> wrapping a non-editable .t-code-bar span —
  a <select data-code-lang> with the curated 21-language list + a <button
  data-code-copy> — and the editable <code class="t-code">), pdCodeText (plain-text
  extraction — spans transparent, <br>→\n, .t-fence/.t-code-bar skipped),
  pdCodeNormalize (upgrades BOTH the renderTitle-loaded bare .t-code islands —
  sibling runs merged — AND legacy pre>code shapes; wakes the highlighter — the
  first version FORGOT the schedule on the island branch, caught live in
  agent-browser QA), pdHljsLoad (LAZY /vendor/highlight.min.js — highlight.js
  11.11.1 common bundle, 127KB, progressive enhancement), pdCodeHighlight (explicit
  lang via hljs.highlight; else highlightAuto restricted to the curated ids with a
  relevance floor — CALIBRATED to ≥2: prose scores 0, real short code ≥2; the first
  draft's floor of 4 never fired on one-liners, caught by the e2e), caret
  save/restore by PLAIN-TEXT OFFSET across the innerHTML swap, pdCodeSchedule
  (300ms WeakMap debounce).
- THE KEYBOARD (pdCodeKeydown): Tab inserts 2 spaces (execCommand + Range
  fallback); Backspace at the block's start can never eat the contenteditable=false
  bar (an EMPTY block dies outright — Chromium deletes non-editable islands when
  backspacing into them); the S82 Enter/Arrow exits preserved — pdCodeBlockAt now
  anchors its line-geometry probes on the CODE element (the bar's own text would
  have broken the first/last-line tests).
- THE BEHAVIORS: paste inside a block = PLAIN TEXT ONLY — MEASURED: Chromium's
  execCommand('insertText') DROPS embedded \n ('A\nB' → 'AB'), so multi-line paste
  is inserted LINE BY LINE with insertLineBreak between (undo survives; the Range
  fallback inserts a raw '\n' text node — white-space:pre renders it); the copy
  button copies pdCodeText (never the span markup) with the clipboard API + the
  house textarea fallback, swaps the icon (i-copy → green i-check via .copied) and
  shows the ::after tooltip (data-tip = md.copied) ~2s; the language dropdown
  re-highlights immediately, '' = Auto (re-detect on the next input; a successful
  detection WRITES data-lang so the fence saves it); the format toolbar disables
  while the caret is inside (selectionchange-driven, '<>' stays active, reset on
  every dialog open).
- STORAGE — chip-render.js htmlToMd: the pre case reads data-lang into the fence
  (```python) + the codeText walker skips .t-code-bar; the hljs spans are
  transparent (recursion) so the saved markdown NEVER carries markup (e2e-pinned:
  data-raw-title contains ```javascript + the code, not hljs-/span).
- CSS (project-header.css): .t-code-pre = the ONE container (var(--code-panel-bg),
  1px --code-border, 8px radius, margin-block .85rem, overflow hidden, dir ltr);
  the bar (flex space-between, hairline bottom border, user-select none); the
  select (mono uppercase 0.62rem, transparent) + the copy button (2rem/44px
  coarse, ::after tooltip, i-check color var(--ok)); > code.t-code = typography
  ONLY (the house --font-mono, 0.8125rem, lh 1.5, white-space pre, overflow-x
  auto, tab-size 2, padding .75rem .9rem, --code-panel-fg) — the .pde-edit-area
  pre rule now scopes to :not(.t-code-pre) (rich-pasted bare <pre> fallback). The
  FA font override RESTATED for the new selector (html[lang='fa'] .t-code-pre >
  code.t-code — equal specificity with html[lang='fa'] .t-code, source order wins,
  Vazir stays last in the stack for Farsi comments).
- THE PALETTE — five .hljs-* groups mapped onto the S88 grammar (--md-kw keywords
  +built_in +doctag +type — +type so C-family const/static read keywordish;
  --md-str strings+regexp; --md-com comments (the most muted) — ALONE it sat at
  ~4.15:1 on the light panel / ~3.1:1 dark, UNDER the owner's 4.5:1 AA demand:
  color-mix 70/30 toward --code-panel-fg clears 5.4:1+ on BOTH panels while the
  notes surfaces keep their approved --md-com; --md-num numbers+literal; --md-fn
  titles/function names). One set of light inks works on both themes' dark panels;
  claude-dark flips its own --md-* values.
- i18n: +3 keys ×2 (pd.codeAuto/pd.codePlain/pd.codeLangLabel; md.copy/md.copied
  reused) — parity 1552/1552.
- Cache-bust: project-header v47→v48 ×2, chip-render v10→v11 ×2 + board-page.js's
  lazy literal (v10→v11 — the gate caught the stale lazy URL), project-page
  v72→v74 (the mid-round normalize fix re-bumped — the S171 stale-cache lesson),
  i18n-en v87→v88 ×26, i18n.js v141→v142 ×26 + the i18n-fa loader literals v81→v82;
  sw.js v410→v411 (EVERY shell page changed markup via the global ?v= busts);
  package.json 0.4.1.2→0.4.1.3; /vendor/highlight.min.js NEW (SWR runtime-cached,
  no ?v= — the house vendor pattern).
- LADDER: typecheck 0 · vitest 539/539 · eslint 0 err (163-warn baseline) ·
  build 79 (+the vendor bundle) · wiring canonical · cache-bust PASS (7 files) ·
  parity 1552/1552 · FULL e2e GREEN in 5 file-batches: 45+72+52+54+74 with ONE
  sprint-doc failure in batch 5 (the spec's OWN documented SW-race class — flaked
  only under full-suite load; solo green, pre-change-code batch green, then green
  in every re-run combination incl. the exact batch-5 prefix — 4 consecutive
  green runs; the version chip empties when pdFilterBuild's slow page-load fetch
  resolves late — a pre-existing race, not this round's diff).
- NEW SPEC e2e/s176-codeblock.spec.ts (2 tests): the code-block contract
  end-to-end (ONE container + the bar + the panel-vs-editor contrast + the code's
  transparent/no-border geometry + mono + white-space + ltr; Tab=2 spaces; the
  synthetic rich-clipboard paste landing plain with indentation; the toolbar
  disable set + the ArrowDown re-enable; the copy button's icon swap + tooltip
  + clipboard round-trip + the 2s restore; the dropdown change + data-lang; the
  save round-trip — data-raw-title carries ```python + the code, NEVER hljs-/span
  — and the edit re-open normalizing + re-highlighting) + the rail (40px inline
  size, ≥144px height, vertical-rl + the 180° matrix, contents hidden, count
  visible, ≥30px width growth for the others, the unfold restoring the exact flex
  share ±2px).
- AGENT-BROWSER QA (:3017): EN (the rail + the code block driven end-to-end —
  python auto-detect on typing, comment spans after Tab+#, dropdown flip to js,
  ArrowDown exit + paragraph + toolbar re-enable, save + reload + normalize);
  FA/RTL (the rail at the reading-start edge with the rotated Farsi title; the
  editor RTL while the code block stays ltr/left/horizontal-tb; ruby auto-detect
  on a def-snippet — the user overrides via the dropdown); claude-dark (the
  #1a1917 panel on the #141413 editor + the token flips); 390px (the folded box =
  the compact 157×60 chip, zero page h-overflow); touch emulation via a playwright
  iPhone context (the copy button 44×44 + opacity 1, the select 40px); 0 console
  errors on every pass.
- CHAIN: feature 69fa7c4 pushed → CI 36632958154 + CD 36634350608 ALL GREEN →
  live byte-verified (project-header.7c305c9c + project-page.7509eb05 +
  chip-render.3bd3e764 + i18n-en.85b27556 + i18n.de03e0fa all IDENTICAL +
  /vendor/highlight.min.js IDENTICAL, sw.js v411, /api/health ok prod schema 62)
  → live functional pass as the owner's account (login → probe project → the
  40px rail with 278px neighbors → the composer's code block with the live
  lazy-load over HTTPS + auto-detect + the copy icon swap → probe deleted; 0
  console errors) → tag v0.4.1.3 → zip hibana.0.4.1.3.zip (558 files, integrity
  OK, 0 real secrets) → Changelogs §1 rotated (S169 dropped; exactly 4 blocks) +
  §2 row 176 → healthcheck pinged.

Stage Summary:
- LIVE: hibana.ir @ v0.4.1.3 — the folded boxes are vertical rails (the owner's
  sketch honored: chevron on top, the title reading bottom→top, ~40px wide) and
  the composer's "<>" code block is ONE dark-panel container with a language
  dropdown, a plain-text copy button, plain-text paste, Tab indentation, disabled
  formatting inside, and highlight.js five-token coloring with auto-detect — the
  saved markdown stays plain text forever.
- Ops lessons: (a) Chromium's execCommand('insertText') DROPS embedded newlines —
  multi-line programmatic paste must insert line-by-line (insertLineBreak between);
  (b) highlightAuto relevance floors: prose 0, real short code ≥2 — a floor of 4
  silently never fires on one-liners (calibrate with REAL inputs before shipping
  thresholds); (c) a custom property may not re-define ITSELF with color-mix
  (cyclic → invalid) — mix directly in the consumer rule instead; (d) the
  e2e-spec beforeAll user DELETE cascades other sessions' QA projects — keep QA
  projects on a separate user from the spec users; (e) the sprint-doc version-chip
  flake is the spec's own documented SW-race class — it fires under full-suite
  load on this sandbox (2×), never deterministically, and every re-run
  combination went green.
- Deliberate scope notes: the read-only card/board .t-code rendering is UNCHANGED
  (the five requests were editor-scoped — card-side highlighting is a follow-up
  round if the owner wants it); the notes surfaces keep their original --md-com
  (the AA mix is scoped to the editor block's own rule).
