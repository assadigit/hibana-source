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

## Session S253 (verification pass) — the re-sent prompt, closed clean (2026-11-08)

The owner's S253 prompt arrived a second time AFTER the phase was already executed and
closed at `68e9ea06` (spec §14 DONE row, released v0.4.1.46). Correct behavior: RE-VERIFY,
never re-execute — 0067 is live on both D1s and a re-run of destructive-adjacent steps
against an already-migrated DB is exactly what the D1 discipline forbids. The re-check,
all green: both repos clean + pushed (local == origin/main); live health probes dev+prod
both ok / db up / `schema_version 66`; the automated lane fresh (snapshot
`2026-11-08T03-23-21Z` + the cron's dead-man ping 3 s later); 0067's file, the worklog
entry, Changelogs row 253, and all five §9 bookmarks present and consistent.

This pass then COMPLETED the §12.4 close-out remainder the first run never recorded:
the per-version zip (`hibana.0.4.1.46.zip` → the sandbox download folder; wired-HTML
build, 783 entries, integrity OK, tree restored byte-clean), the healthcheck ping (NOTE:
the credentials block's `…/hibana` ping URL **404s** — the check slugs are randomized
per the §4 doctrine; the correct target is the per-check ping URL from the
healthchecks.io dashboard/management API. Owner: refresh that credentials line), and
the Telegram notify to the owner-role chat (the app's own routing: role=owner user's
linked chat).

**Operational finding (pre-existing, NOT Phase 2):** the "Hibana errors" healthcheck
went red on two `/fail` pings — Nov-6: "D1 query unreachable after 3 attempts" (a
CF-API blip on the GitHub runner, not an app error), Nov-7: **25 × 5xx on
`/api/projects/467a7fd6…/devtasks`, all `D1_ERROR: table dev_tasks has no column named
due_at`** — the S249 deploy-order window (code referencing `due_at` was live ~2 h 15 m
before 0065's prod apply at `2026-11-06T19:12:42Z`; one client's 15-second burst
16:56:55–16:57:10). Zero error_log rows since `2026-11-07T04:23Z`, so the daily
monitor's next success ping clears the red on its own. No action needed; the lesson
(code-before-migration windows hurt) is what 0067's header already engineers around
("safe in BOTH deploy orders").

## Session S254 — Phase 3: Interaction performance (2026-11-08)

**The owner's ask, verbatim:** the §13 next-session prompt for Phase 3 (S254) of the
owner-approved AUDIT-REMEDIATION-SPEC — "make the board/sprint FEEL fast — kill the
jank, the scroll-block, the boot waterfall, and the full-reload reflex. Markup-stable
changes only."

**The recovery context (honest):** the session that executed the code round was
interrupted AFTER pushing all eleven commits (`ad663a0a`→`448d553e`: FE-3, FE-12+15,
FE-14+15, FE-19, FE-8, FE-2, FE-1+10, FE-20, the cache-bust choreography, the two e2e
re-pin rounds) but BEFORE the ladder/deploy-probe/close-out. This continuation session
re-cloned both repos, verified local==origin (nothing lost), found CD had already
deployed the round to dev+prod (CI green on `448d553e`, live SW = `hibana-v461` on
both), then ran the whole §12.2 ladder ITSELF (never claim untested), built + ran the
live feel probe, and closed the phase. No S254 code was re-written; every fix commit
below is the interrupted session's, re-verified.

**The round that shipped (all markup-stable, zero API/payload change):**
- **FE-2** (`1976e521`): rAF-batched dragover placement + cached target rects on ALL
  THREE DnD surfaces (board columns, project progress boxes, sprint sidebar+cats) —
  one frame does the work with the latest sample, hover-in-place costs zero layout
  reads, inserts only on real position change; drop/dragend/touchend FLUSH the pending
  sample first (e2e's synchronous dragover→drop pairs preserved); scroll invalidates
  the cache.
- **FE-3** (`ad663a0a`): `touch-action:none` now set ONLY when the 250 ms long-press
  arm fires — quick swipes from draggable cards scroll the page again.
- **FE-8** (`6ddb4e15`): parallel boot on /kanban + /sprint.html — `B().load()` rides
  out immediately, first render awaits data + i18n TOGETHER; no English flash for FA
  users; error paths await i18n so failures stay translated.
- **FE-1 + FE-10** (`ba6640e7`): event-delegated card ⋯ menus (zero per-card listeners;
  document-level branches serve the board lanes AND the sheet's cloned menus) +
  single-column repaint on task mutations (drop/quick-add/priority-cycle/delete/
  editor-save) via devboard.js's new state-merge layer (mergeTaskPatch/
  mergeCreatedTask/applyReorder — the client twins of devboard.ts's write semantics
  incl. done_at stamping, due-origin rules, PRIO_ORDER sort, quick-add sprint
  auto-assign); sprint page renders patchTask/createTask/reorder from merged state,
  NO board GET; chip toggles restore keyboard focus.
- **FE-12** (`58af9aa9`): GET first-deadline 3 s → 8 s (signal wrapper + one retry
  kept) + devboard.js `t()` adopts the `s !== k` i18n guard.
- **FE-14 + FE-15** (`eb2626cd`): dead `TITLE_CLAMP` removed; chip-render.js +
  due-control.js adopt the i18n guard (raw keys can no longer leak on dict-load
  failure).
- **FE-19** (`aed75c7b`): `ensureLib` self-injects IMMEDIATELY on a head script's
  error event (capture-phase resource listener) instead of waiting out the 1.2 s poll;
  9 s ceiling + no-loop flag kept; both board + sprint twins.
- **FE-20** (`f7e4e7e0`): check-cache-bust.mjs gains the injector-literal cross-check
  — every public/js injector literal's `?v=` must match the HTML-referenced `?v=` of
  the same file, checked ALWAYS (not just modified files); it PROVED itself by
  catching the devboard v38/chip-render v14 literals sitting ahead of this round's
  HTML bumps.
- **Cache-bust choreography** (`e85d1a2a`): touch-drag.js v2 (23 pages), devboard.js
  v38 (3 pages + 4 injector literals incl. project-page's lazy belt), board-page.js
  v35, sprint-page.js v29, project-page.js v86, chip-render.js v14, due-control.js
  v2; **SW v460→v461** + the one SHELL re-fetch; cache-bust + precache (+12 KB
  headroom) + bundle checks green.
- **e2e re-pins** (`6fb89863`, `448d553e`): sw v461 pins across the 7 history-pinned
  suites, the injector-literal pins (v38/v14/v2/v35), the s238 Edit-door pin
  re-pointed at `openEditorRepaint`, and the s206 sprint quick-add no-store witness
  now counts ONE call (the merge layer renders the sidebar from state; the old second
  board GET reload is retired).

**The honest ladder record (this session, fresh sandbox):** `npm run verify` in
stages — tsc strict 0 errors, eslint 0 warnings, **vitest 990/990**, prod build,
portability, fn-shape, import-boundaries all PASS; cache-bust PASS (with the FE-20
cross-check), i18n **1707/1707**, precache PASS (+12 KB headroom), bundle PASS;
`node --check` on all 7 touched JS. e2e **510/510** as four sequential quarter-shards
(130+127+129+124, each on its own port+DB — the sandbox's process reaper kills
background servers between tool calls): **one flake, honestly recorded** —
`s182-todo-panel S183-5` (the fade-edge/scrollbar geometry test, a surface this round
never touched) failed 2 of 4 full-shard runs locally, passed isolated 3/3, passed the
final full run, and CI's own 2-shard e2e is green on this exact commit. Verdict:
environment-sensitive scrollbar assertion under load, not a regression — same class
the e2e history already records for that suite.

**The live feel probe** (`scripts/live-s254-probe.mjs`, `77456857` — 40 checks):
carriers (SW v461 + every wired /dist asset the 3 pages reference resolves 200 +
the FE-19 belt's wired devboard literal inside the deployed board-page bundle +
due-control.js?v=2), then the browser feel test through the REAL login page (a
`__Host-` session cookie cannot be injected — addCookies rejects it; the faithful
path is the real login): boot = ONE board GET; FE-3 touch-action at rest = auto;
drag idea→planned (dragover prevented, per-column repaint, ZERO refetch); drag
planned→done (done_at stamped server-side — polled past the optimistic repaint, ZERO
refetch); sprint quick-add = ONE POST + ZERO board GET + the task renders from merged
state; zero page errors. **Local rehearsal 38/38** (scratch server + seeded user —
three honest iterations: the body-consumed-twice api() bug, the __Host- cookie
lesson, and the fixed-sleep race), **dev 40/40** (seeded probe user
`probe-s254-dev@hibana.local`, purged after: probe_users 0, orphan_archives 0 — the
DB-3 sweep rides the purger), **prod 40/40** (the test account; the probe project
soft-deleted — trash, the 7-day cron purges). Probe lessons recorded: deployed trees
serve WIRED HTML (content-hashed /dist/ URLs; the `?v=` is consumed by the hash —
only the un-hashed due-control carries a visible `?v=`), and the deploy-time wiring
rewrites the injector literals INSIDE the dist bundles too (the belt check proves
that survived).

**Live:** CD deployed dev+prod on push (SW v461 live on both, health ok, schema 66);
prod error_log **0 rows** in the session window. The tidy-root PR (#18, the AGENTS.md
§13 procedure) merged mid-session — pure file moves, rebased cleanly around.

**Desktop (§12.3):** the full re-pin — PIN_REF/PIN_PACKAGE_VERSION to the S254 web
SHA + v0.4.1.47, anchor re-records per sync-island's loud failures, desktop.yml
WEB_REF + WEB_VERSION together, ALL 14 probes, push → autorelease v0.1.45 → verify.

**Version:** 0.4.1.46 → **0.4.1.47**. Commits: `ad663a0a…77456857` (the interrupted
session's eleven + this session's probe).

**Next:** Phase 4 (S255) — Payload & network diet (BE-3, BE-25, FE-4, FE-7, FE-16),
the island round WITH the full desktop re-pin.

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
