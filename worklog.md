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
