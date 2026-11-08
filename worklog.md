# Hibana — Session Worklog (durable handover)

> Purpose: the sandbox-local session journal, **committed to git** so a fresh clone
> inherits the handover (S156 was lost to a sandbox reset once — never again).
> Append per session; never overwrite. NEVER put credentials/tokens in this file —
> the owner supplies them per-session; `credentials.md` is gitignored.
> The durable per-release record lives in `Changelogs.md` (§1 = the 4-block chain,
> §2 = the full session index). This file is the working memory between sessions.

---

> **Rotation (HLTH-27):** sessions older than the newest 4 live in
> `worklog-archive.md` (and verbatim in git history) — this file is the ACTIVE
> tail only. Rotate with `node scripts/rotate/rotate.mjs --worklog`.

## Session S255 — Phase 4: Payload & network diet (2026-11-08)

**The owner's ask, verbatim:** the recovery ask — "I lost previous session of Hibana
source and desktop. We need to catch up and continue it from where it's left … we were
in middle of optimization of things based on audit." The §13 next-session prompt for
Phase 4 (S255) of the owner-approved AUDIT-REMEDIATION-SPEC — "stop shipping bytes
nobody renders; make repeat loads 304."

**The recovery (this session started COLD):** re-cloned both repos, verified
local == origin on both (nothing lost — the interrupted-session risk did not
materialize; S254 had closed clean at `c556e3a1`), re-read AGENTS.md + the whole
spec top to bottom, re-verified the Phase 4 anchors against HEAD, ran the baseline
`npm run verify` (990/990, all gates PASS) BEFORE touching anything.

**The round that shipped (all additive; the DEFAULT board payload byte-identical):**
- **BE-3** (`010bd405`): the additive `GET /api/sprints/:id/doc` (the full sprint row,
  owner-gated through ownedSprint — a foreign id 404s) + the board GET's opt-in
  `?lean=1`: `sprints[].description` omitted, the derived `sprints[].doc_checked`
  rides in its place (the EXACT `- [x] ` line grammar the sprint chip's ☑ stat has
  always folded client-side — one server seam, `sprintDocCheckedCount`, so lean and
  default consumers agree forever). 4 regression pins (lean shape, doc endpoint
  ownership/404, the distinct-ETag no-cross-304 contract).
- **BE-25** (`d2d54981`): the board GET's **version-stamp weak ETag** — ONE
  pre-assembly probe (`boardVersionStamp`, devboard-helpers.ts: COUNT+MAX(updated_at)
  per stamped table + CONTENT fingerprints for the no-stamp tables: the user's whole
  tag library (no updated_at column — renames/recolors/usage moves are caught by
  content), the payload-visible categories set (incl. enabled + sort_order), the
  per-project screenshots (id, task_id — pin/unpin/re-pin), the dep/link COUNTs, and
  the project row the route already holds) → a matching If-None-Match answers **304
  with ZERO assembly**. The tag carries the lean marker (`W/"b…"` vs `W/"l…"`) so the
  variants never cross-304. The 200s carry the stamp tag (the desktop poll's
  `client.go get()` stores it; `getFresh`/RequestFresh never sends a validator and
  never sees a 304 — pinned). **The stamp-coverage fix:** the reorder path now stamps
  `updated_at` (the ONE sort_order writer the 0061 doctrine never covered — without
  it a drag-reorder could 304 past the new order). 4 pins incl. the per-mutation
  stamp-move table (task PATCH / tag link / sprint PATCH / **reorder** / sprint
  start) + the tag-RENAME fingerprint case.
- **The island half** (`69284ee6`): `B().load(pid, { lean: true })` — the /kanban +
  /sprint boots, every reload, and the project-switch preload all ride `?lean=1`
  through the api() choke point (**the seam count STAYED 7** — both new fetch needs
  ride api(); the spec's anticipated 7→8 proved unnecessary, a strictly smaller
  desktop surface). `sprintDocChecked` reads BOTH payload shapes (variant-blind ☑
  stat); `sprintDoc(id)` is the doc-fetch affordance riding the same choke point.
  **FE-4**: `pdRepaintColumns` re-renders from the LEAN BOARD payload — the old flow
  refetched the WHOLE 13-query `/api/projects/:id` detail (hurdles, links, ALL
  screenshots, history, notes, canvas backlinks, backlog) to repaint ≤2 kanban
  columns; the board rows fold through the SAME server helpers (boardTaskRows /
  taskTagsForProject / taskDepsForProject), so field parity is by construction —
  `shot_count` IS the pin count. **FE-7**: the sprint timeline's hidden duplicate
  `.sp-bar` copies of every task RETIRED (opacity:0 + pointer-events:none +
  height:0 — provably inert: no JS query reads .sp-bar, the dots carry the
  data-bar/data-task drag affordances, the [data-trim] grips stopped existing
  renders ago) — pure dead DOM, one node per task per render. **The v462 cache-bust
  choreography**: devboard.js v38→v39 (3 pages + 3 injector literals), board-page.js
  v35→v36, sprint-page.js v29→v30, project-page.js v86→v87; SW v461→v462 + the one
  SHELL re-fetch.
- **FE-16** (rode `69284ee6`): API-AND-SYNC-CONTRACT.md — `task_tags` documented as
  DESKTOP-LOAD-BEARING (never remove: the Go mirror's BoardPayload decodes it;
  unknown-to-web ≠ removable) + the ?lean=1 / doc-endpoint / ETag-304 contracts
  recorded in §3.2.
- **The carrier re-pins** (`e244f8b9`): sw v462 + devboard v39 + board-page v36 +
  the injector literals across the 7 history-pinned suites (s237/s238/s242/s243/
  s244/s245/s246/s247), and the **s246 embedded-fold pin re-recorded to FE-4's new
  doctrine** (the boot + expand folds keep the detail pool; the MUTATION repaint
  rides the lean board payload — one board pull, never the 13-query detail refetch).

**The honest ladder record:** `npm run verify` exit 0 — tsc strict 0 errors, eslint
0 warnings, **vitest 998/998** (990 + 8 new), prod build, portability, fn-shape
(after the per-round allowlist re-pins: the board GET grew 79→113 lines with the
stamp block — one endpoint flow, one screen; the four drifted pins re-lined),
import-boundaries all PASS; cache-bust PASS (with the FE-20 cross-check); i18n
**1707/1707** (no new UI strings — the round is data-path only); precache PASS
(+12 KB headroom); bundle PASS; `node --check` on all 4 touched JS. e2e **515/515**
as four sequential quarter-shards (123+106+162+124, each on its own port+DB) — ZERO
failures, zero flakes this round.

**The live probe** (`scripts/live-s255-probe.mjs`, `69187e8b` — 46 checks): the
carriers (SW v462 + every wired /dist asset resolving), the lean/default payload
shapes (description absent ONLY under lean; doc_checked = the planted 40), **the
diet measurement** (the doc-heavy probe project: default 13,661B vs lean 1,915B —
**86% saved** on prod; 91% on dev/local), the ETag family (both variants 304 on
their own validator, never cross, fresh-never-304s, the mutation-moves-the-stamp
round-trip), the doc endpoint (full row + 404), and the browser legs (/kanban +
/sprint: exactly ONE board GET each and it carries ?lean=1; the sprint chip's ☑ 40
renders from doc_checked with NO description shipped; /project.html: the synthetic
cross-box drop fires the repaint's ONE `devboard?lean=1` GET with ZERO second
`/api/projects/:id` detail refetch, the card lands; zero page errors). **Local
rehearsal 46/46** (scratch server + seeded user — the honest iterations: the
syntax slip in the probe's carrier loop, the draft-sprint-not-on-the-timeline
lesson, and the dragstart-on-the-inner-.pd-task contract), **dev 46/46** (seeded
probe user `probe-s255-dev@hibana.local`, purged after: probe_users 0,
orphan_archives 0 — the DB-3 sweep rides the purger), **prod 46/46** (the test
account; the probe project soft-deleted — trash). Prod error_log: **0 rows** in
the session window.

**Desktop (§12.3):** the full re-pin — PIN_REF/PIN_PACKAGE_VERSION to the S255 web
SHA + v0.4.1.48, anchor re-records per sync-island's loud failures, desktop.yml
WEB_REF + WEB_VERSION together, ALL 14 probes, push → autorelease → verify. The Go
sync stays on the DEFAULT payload (the spec's "keep desktop on the default payload"
— its conditional `get()` poll is the 304 cheap path's beneficiary; adopting lean
client-side in the mirror is a later optional round, noted).

**Version:** 0.4.1.47 → **0.4.1.48**. Commits: `010bd405…69187e8b` + this close.

**Next:** Phase 5 (S256) — CSS/asset diet (FE-5 per-page bundles, FE-13 the
byte-equal twins), the heaviest re-pin (HTML link sets) — the ratchet only goes
DOWN after it.

## Session S256 — Phase 5: CSS/asset diet (2026-11-09)

**The owner's ask, verbatim:** the §13 next-session prompt for Phase 5 (S256) of
the owner-approved AUDIT-REMEDIATION-SPEC — "cut ~950 KB/page of render-blocking,
mostly-irrelevant CSS; buy precache headroom back… the ratchet only goes DOWN
after this." Executed EXACTLY per §8; no red line was hit.

**The round that shipped (zero API/schema/payload change; markup-stable):**
- **FE-5** (`836cc18e`): the four Projects-section pages' heads collapse 19-20
  individual `<link>`s into ONE per-page bundle — board.html + sprint.html →
  `/css/board-bundle.css?v=1`, projects.html + project.html →
  `/css/projects-bundle.css?v=1` (projects' own order keeps magic-wand AFTER
  rtl, preserved verbatim). The bundles are GENERATED by `scripts/build.mjs` on
  EVERY build (deterministic concatenation in the EXACT current `<link>` order —
  the spec's "safe transform"; rtl.css LAST inside board-bundle, the desktop
  island contract), committed as tracked files, then minified + hashed into
  `/dist/` like every entry (436.7 KB + 442.1 KB). The SW deliberately does NOT
  network-precache them — their bytes are the union of the individually
  precached sheets (every other page still links the sheets; the offline union
  is the install floor — precaching the bundles too would double-bill ~880 KB
  per install). Instead the SW SYNTHESIZES each bundle at install time from the
  already-cached parts (the new `dist/bundles.json` carries the ordered part
  lists), so a fresh install that goes offline before ever visiting the Projects
  section still renders all four pages styled — **offline shell parity at zero
  extra install bytes, PROVEN on the real wired tree by the new
  `scripts/probe-sw-synthesis.mjs` (all four pages offline: bundleRules
  4048/4098, zero page errors; the honest debugging on the way: the
  query-carrying navigation only enters the offline cache on its second,
  controlled load — the PRE-EXISTING SW contract, now documented in the probe).**
- **The FE-5 gates**: NEW `scripts/check-css-bundles.mjs` (committed-bundle
  freshness vs deterministic regeneration + each bundle page links its bundle
  exactly once + no individual sheet links remain + board-bundle's LAST part is
  rtl.css + every part keeps a carrier page OUTSIDE the bundle set — the SW
  synthesis reads the precached sheets) wired into CI + both deploy chains;
  `check-dist-wiring` allowlists `dist/bundles.json`; CI's post-wire
  `git diff --exit-code -- public/` doubles as the stale-bundle tripwire (the
  build regenerates them). **precache re-baselined DOWN 2,360→2,350 KB**
  (measured 2,342; the honest correction of the spec's "expect a large drop":
  the offline CSS union — 533 KB the sheets already cost once — is the floor;
  bundling adds REQUESTS-saved, not install bytes; the drop = the four pages'
  HTML shrink + FE-13's dedup). **bundle-size re-baselined +64% with reason**
  (the two bundles are new dist entries by design; the re-baseline also revives
  the per-file LOGICAL-key guard — dead since S200 because the old baseline
  stored hashed keys). sw v462→v463 (the synthesis is sw.js LOGIC — the version
  bump is required by the discipline, not just the carriers).
- **FE-13 partial** (`2912580c`): the byte-equal twins consolidate into
  chip-render.js through the EXISTING `window.HibanaChips ? … : fallback`
  gating — project-page.js loses pdEsc + pdDig + PD_PRIO_LABEL + PD_G_MONTHS +
  pdMetaLine + 2 inner esc copies (its meta now calls the same
  `HibanaChips.metaDateHtml` board-page.js:272 always used — **the s110
  meta-parity pin holds by CONSTRUCTION**), board-page.js loses escS,
  due-control.js loses its esc. devboard.js stays the fallback root UNTOUCHED —
  its esc/G_MONTHS serve sprint.html (no chip-render tag there) and its
  faDig/prioLabel are NOT byte-equal twins (lang-gated faDig; SHORT priority
  labels — different contracts, deliberately left alone). Carriers:
  board-page v37, due-control v3, project-page v88.

**The honest measurement record (spec §8 step 3):**
- `perf-pages.mjs` grew the kanban + sprint rows + an LCP observer + the
  cssN/cssKB lens (BEFORE/AFTER on the same harness, medians of 3, cold):
  **cssN 22-23 → 4 stylesheet requests per page (−18/−19, the render-blocking
  chain); cssKB 298-301 → 275-277 KB transferred (−8%, gzip amortizes across
  the joined sheets); FCP consistently down (kanban EN 192→164ms, projects EN
  240→164ms); LCP noisy (±60-80ms between runs — recorded, not cherry-picked).**
- Lighthouse (`lighthouserc.json` + mobile, before/after): desktop login
  100→100 / login?next 96→94; mobile login 98/89/91→90/98/98 and the
  SW-active login?next variant 65/60/66→61/63/62 — the SAME band (login +
  dashboard are untouched pages; these runs are the CI floors, the
  Projects-page deltas live in the perf harness above). All floors hold.

**The honest ladder record:** `npm run verify` exit 0 (tsc strict 0, eslint 0
warnings, **vitest 998/998** — 10 carrier pins re-pinned across
s237/s238/s242/s243/s244/s245/s246/s247: sw v463 everywhere, devboard.css?v=46
carriers 23→19 pages (the four ride the bundles), board-page v37 + due-control
v3 tokens; the s247 acceptance-matrix citation lesson — s244's test TITLE is
cited verbatim, titles stay, the version moves inside), prod build,
portability, fn-shape, import-boundaries; cache-bust PASS (3 modified files);
i18n 1707/1707; precache PASS (+8 KB headroom at the new 2,350 budget);
bundle-size PASS at the re-baselined numbers; check-css-bundles PASS (negative
tested: a hand-drifted bundle fails it, the build heals it); **e2e 510/510**
(four sequential quarter-shards 130+127+129+124, zero flakes — the full FA/RTL
+ EN/LTR, light + dark, desktop + 390px matrix inside the specs).

**Live:** CD deployed dev+prod on `2912580c` (CI 644 green incl. the new
gate + LHCI floors). `scripts/live-s256-probe.mjs` — **local rehearsal 66/66**
(the full 2 langs × 2 themes × 4 pages visual matrix on the wired artifact:
bundle parses 4048/4098 rules, light/dark tokens paint per page (project.html's
own #F5F4F1 paper pinned separately), dir=rtl on FA, lanes/columns render,
zero page errors), **dev 16/16 + prod 16/16 carriers live** (both bundles
serving 200 immutable, the live order proof — every constituent sheet present
+ rtl at board-bundle's tail + magic-wand after rtl in projects-bundle —
health ok schema 66). **The honest credential gap:** this session's Cloudflare
token belongs to a DIFFERENT account than the one hosting the Hibana D1s (the
devseed's `wrangler d1 execute` 404s; the CD deploys ride the repo secrets),
and the block carries no prod test account — so the live AUTHED visual matrix
could not run on dev/prod this round; it rode the local 66/66 on the
byte-identical deployed artifact + the 510/510 e2e instead. No probe user was
created, so none needed purging.

**Desktop (§12.3):** the heaviest re-pin, executed after this close (see the
desktop repo's own record): the island manifest's CSS set collapses 19 sheets →
`css/board-bundle.css` (the whole point — the island mirrors board.html's one
link), verifyDist's expectedLinks + rtl-last checks re-recorded for the bundle
world, the probe needles re-pinned (board-page v37, due-control v3, the sheet
fetches → the bundle fetch), DT-5 closed (the stale KNOWN-REMAINS items 1/3/4
pruned — __hibanaMe lives in the shim since the login round, MediaMiddleware
shipped v0.1.15, KanbanIndexMiddleware shipped v0.1.2 — + the v104/v105
comment drift fixed), desktop.yml WEB_REF+WEB_VERSION twins moved together.

**Version:** 0.4.1.48 → **0.4.1.49**. Commits: `836cc18e`, `2912580c`,
`49bd13fc` + this close.

**Next:** Phase 6 (S257) — Backend modularization (the devboard split,
BE-11/13/14/15/16/17, FN-ALLOWLIST re-pins) — zero route-path changes, desktop
no-op by design.

---

## Session S256 (supplement) — the re-sent prompt's round: the authed live visual pass + the close ritual's credential-dependent halves (2026-11-08)

**The situation:** the owner re-sent the Phase 5 §13 prompt with a FRESH credential
block (the prod test account + the D1-correct Cloudflare account + the healthchecks
management/read keys + the Telegram bot token). By the time this session cloned, a
parallel S256 run had ALREADY shipped and closed the phase (836cc18e→6db3ae9,
v0.4.1.49 live; desktop v0.1.50 re-pinned + released, all 14 probes green) — its
honest gap: its own credential block carried a Cloudflare token for the WRONG
account (the devseed's `d1 execute` 404s) and NO prod test account, so the authed
live visual matrix + the zip + the healthcheck ping + the Telegram notify never ran.
This session detected the duplication at push time (rejected, non-fast-forward — no
history rewrite per §0.2), reset to origin/main, and closed EXACTLY those gaps:

- **THE AUTHED LIVE VISUAL PASS (§8 step 5, the phase's missing leg):** the probe's
  PART B unlocked on prod (explicit PROBE_LOGIN/PROBE_PASS — `scripts/live-s256-probe.mjs`
  now runs the visual matrix on prod when the test account is provided, and RESTORES
  the account's language_pref after: the loop ends on 'fa' and prod is the owner's
  real account). **PROD 67/67** (the test account: 16 legs = {en,fa}×{light,claude-dark}×
  {board,sprint,projects,project} — the bundles parse 4048/4098 rules, the theme
  tokens paint, FA flips dir=rtl, content renders, ZERO page errors; the probe
  project soft-deleted; the language restored) and **DEV 67/67** (the seeded probe
  user — the devseed ran with THIS block's `6ff25b…`-account token, the exact
  credential the parallel session lacked; the probe user + archive orphans purged
  after: 0 users / 0 orphans).
- **THE ZIP:** `hibana.0.4.1.49.zip` → the sandbox download folder (wired-HTML
  build, 681 tracked + 80 dist files, integrity OK, **secret-scan CLEAN** — every
  credential value from the block scans zero; the ghp_/cfut_ grep hits are the ops
  scripts' own regex literals + redacted history prose, verified by inspection).
- **THE HEALTHCHECK PING:** via the **REAL per-check URL from the management API**
  (the "Hibana" check, slug e24cc4eb…, its API-served ping_url pinged → HTTP 200 →
  last-ping moved to 20:18:37Z — NOT the credentials block's guessed
  `…/<pingkey>/hibana` slug path; the S253 doctrine re-confirmed: the block's
  slug-path URL is not the check's real ping URL).
- **THE TELEGRAM NOTIFY:** delivered to the owner-role chat (the app's own routing —
  the linked chat resolved from prod's telegram_captures; sendMessage HTTP 200).

**The parallel-implementation note (honest):** this session had independently built
and fully verified a parallel FE-5/FE-13 round before the fetch revealed the closed
phase (998/998 vitest + 510/510 e2e + a mobile Lighthouse before/after + a 114-check
local visual rehearsal). It was NOT pushed — the phase was closed and §0.2 forbids
rewriting published history — and is preserved locally on branch
`s256-parallel-superseded` for reference. The shipped design stands.

**Next:** unchanged — Phase 6 (S257), Backend modularization.

## Session S256 (verification pass) — the prompt's third send, re-verified (2026-11-08)

The owner's Phase 5 §13 prompt arrived a THIRD time, after the phase was already
executed and closed (`836cc18e`→`6db3ae94`, v0.4.1.49 live), supplemented
(`b2bfea2c` — the authed live visual matrix dev 67/67 + prod 67/67, the zip, the
healthcheck ping via the real management-API URL, the Telegram notify), and
desktop-re-pinned (v0.1.50, ALL 14 probes; v0.1.51 rode the worklog push — the
same island). Correct behavior per the S253 precedent: **RE-VERIFY, never
re-execute** — the bundles are live on both workers and re-running a closed round
would churn settled budgets, carriers, and releases for nothing. The re-check,
all green in this session:

- **Repos:** fresh clones, local == origin/main on both (web `b2bfea2c`, desktop
  `d024400`), clean trees; docs complete and consistent (worklog S256 +
  supplement, Changelogs row 256, spec §14 DONE row).
- **Live carriers, BOTH workers (fresh, unauthed):** health ok / db up /
  `schema_version 66`; sw.js `hibana-v463`; `dist/bundles.json` serving both
  ordered part lists; each of the four Projects pages carries exactly ONE bundle
  link (board+sprint → `board-bundle.41b1eacb.css`, projects+project →
  `projects-bundle.253b3917.css`); both bundles 200 immutable with IDENTICAL
  hashes across dev+prod; the concatenation order proofs hold on the live bytes
  (rtl's rules at board-bundle's tail — its last `dir=rtl` at 99.99% of the
  file; magic-wand after rtl in projects-bundle).
- **Desktop:** PIN_REF `6db3ae94` / PIN_PACKAGE_VERSION `0.4.1.49`; desktop.yml
  WEB_REF+WEB_VERSION twins together; releases v0.1.50 + v0.1.51 both carry
  "island @ 6db3ae94" with the full asset chain (checksums.txt + installer +
  portable zip).
- **The lanes:** automated backup lane fresh (latest snapshot
  `2026-11-08T15-23-25Z`, ~5 h old — the 21:23 UTC tick had not fired yet);
  healthchecks.io: all three checks UP ("Hibana" last ping = the supplement's
  20:18:37Z); dev D1 residue: 0 probe users, 0 orphan archives (the supplement's
  purge held).

This pass then re-delivered the close ritual's artifacts for THIS sandbox (the
previous sandbox's copies are not reachable from here): the per-version zip
(`hibana.0.4.1.49.zip` → the sandbox download folder, wired-HTML build,
integrity OK), a fresh healthcheck ping (the real per-check URL from the
management API), and the Telegram notify to the owner chat.

**Next:** unchanged — Phase 6 (S257), Backend modularization (the devboard
split, BE-11/13/14/15/16/17, FN-ALLOWLIST re-pins) — zero route-path changes,
desktop no-op by design.
