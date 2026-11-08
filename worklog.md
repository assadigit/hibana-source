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

## Session S252 — Phase 1: the correctness & safety pack (2026-11-08)

**The owner's ask, verbatim:** the §13 next-session prompt for Phase 1 (S252) of the
owner-approved AUDIT-REMEDIATION-SPEC — "Execute Phase 1 EXACTLY (no schema change, no
payload change, no island change)".

**The five backend fixes, one commit each (the red-line ritual):**
- **BE-6 + BE-12** (`da005ee5`): the ONE shared `findOrCreateTag(cfg, userId, name, color?)`
  in devboard-helpers.ts — NOCASE find-first (oldest row wins on legacy exact-case twins) +
  the H1 `INSERT … ON CONFLICT(user_id, name) DO UPDATE … RETURNING id` recipe — replacing
  all three private copies (task-tags add, project-tags add, setTaskTags' create arm). The
  double-click/queue-replay 500 and the "ui/ux next to UI/UX" fork are both dead. Response
  shapes unchanged ({ok:true,id}, 201).
- **BE-9** (`d44ecee7`): `assertSprintWindowOk` accepts optional pre-fetched siblings;
  PATCH /api/sprints/:id passes the set it already fetched for the reopen-latest guard —
  the duplicate sibling round trip on every dated PATCH is gone.
- **BE-7** (`4130de38`, the P1): POST /sprints now validates the window BEFORE closing the
  active sprint. The assert runs on the POST-CLOSE VIEW of the sibling set (the active
  sprint's ended_at pre-stamped to its close point, one sibling fetch serving window+close,
  findActiveSprint folded in) — verdicts byte-identical to the old post-close check, so the
  success path is unchanged and only the failure path stops writing. A failed create no
  longer leaves the active sprint permanently closed.
- **BE-2** (`d1b7f83e`): the auto-name collision bump is ONE sibling-names query + a JS fold
  (same lower(trim()) grammar, same 50-try bound, same 409 fallback) instead of up to 51
  sequential sprintNameTaken round trips; the row count doubles as the old COUNT(*) base.
- **BE-10 + BE-5a** (`393dd754`): archive-done is ONE cfg.db.transaction mirroring /finish
  (snapshot INSERTs + the 99-id-chunked delete; reads stay outside per the Db convention) —
  a mid-flow failure rolls the whole move back, so no more partial archive rows that poison
  retries on the task-id PK. The link fetch filters SQL-side by the done-task predicate
  (no over-fetch, no IN-list cap, global ORDER BY preserved) and the fold is Set-keyed.

**Regression tests** (`65be8466`, `src/tests/s252-correctness-pack.test.ts`, 7 tests): (a)
same-name ×2 + case-twin + the ON CONFLICT race path (a db wrapper that makes the NOCASE
find miss — both requests take the INSERT path and still resolve to one id) across all
three attach sites; (b) the bad-window create leaves the active sprint OPEN + the success
path keeps the close-the-day-before geometry; (c) a poisoned archive row (the exact
partial-archive residue the old flow could leave) makes archive-done 500 with NOTHING
partial (tasks stay, no new archive rows) and a clean retry succeeds.

**The honest CI record:** my first six pushes ran RED — the fn-shape gate flagged the three
grown/moved devboard handlers (archive-done 63, POST /sprints 112, PATCH /sprints 108) —
fixed by the FN-ALLOWLIST re-pins in `69281ba4` (moves + growth recorded, the established
per-round doctrine; Phase 6's devboard split owns dissolving them). Both e2e shards were
green on those same commits, so the failures were gate-only. Because `**.md`-only pushes
skip CI by design, `69281ba4` itself never ran CI — the deploy chain rode the next non-md
push (`5a303426`).

**The e2e round:** full 510-test suite, four sequential foreground shards (the sandbox kills
backgrounded runs — learned twice). ONE failure: s247 §24-6 (the dueDayLabel seam) —
**proven pre-existing on 8118e608** (the pre-session worktree failed identically): the
test's days-left used raw ms-ceil while the app renders the local-calendar-day difference,
disagreeing by one day on any run between 00:00–12:00 UTC. De-flaked in `5a303426` by
mirroring the app's localDayIdx derivation (test-only; the test's own comment documents this
exact breakage class from S250). Final: 510/510 green.

**Ladder:** `npm run verify` exit 0 — tsc strict, eslint 0 warnings, vitest **976/976**
(969 + 7 new), prod build, portability, fn-shape (after the re-pins), import-boundaries;
check-cache-bust PASS (backend-only round — no JS/CSS touched); i18n parity 1707/1707;
precache within budget (+19 KB headroom); bundle-size PASS. No `node --check` targets
(only TS touched). FA/RTL + EN/LTR + light/dark + 390px ride the e2e suite's own specs
(viewport/fa-locale-guard/themes families all green).

**Desktop DT-1** (hibana-desktop `8561b84b`): desktop.yml WEB_VERSION "0.4.1.43" →
"0.4.1.44" (matching the 6dd40c0 pin / sync-island PIN_PACKAGE_VERSION) + the
WEB_REF/WEB_VERSION-are-twins comment. The autorelease lane cut **v0.1.41-desktop** and the
release notes now carry the RIGHT embedded web version ("hibana-source 6dd40c0
(v0.4.1.44)") — verified against the published release. No re-pin needed (zero island
change).

**Version:** 0.4.1.44 → **0.4.1.45** (the round is user-facing bug fixes; the bump is the
CI/CD/release carrier since the code commits' CI ran before the allowlist fix existed).

**Live verification:** `scripts/live-s252-probe.mjs` (dev + prod) — the three flows on the
test account inside a disposable probe project (soft-deleted after): tag add ×2 + case twin
→ one id; bad-window create → 400 with the active sprint still OPEN + the clean-window
geometry intact; archive-done → {archived:2} with the label snapshot riding along.

**Next:** Phase 2 (S253) — Database health, migration 0067 (backup ritual FIRST, no
exceptions).

## Session S253 — Phase 2: Database health, migration 0067 (2026-11-08)

**The owner's ask, verbatim:** the §13 next-session prompt for Phase 2 (S253) of the
owner-approved AUDIT-REMEDIATION-SPEC — "Step 0 — the backup ritual (§12.1), NO
exceptions … If any step cannot run, STOP and report."

**Step 0 — the backup ritual, all green:** fresh dumps of BOTH D1s
(`/home/z/hibana-backups/pre-0067-{dev,prod}-20261108.sql` + manifests), restore-verified
(PRAGMA foreign_keys=OFF, integrity_check ok, row counts recorded), `bookmark:prod` +
`bookmark:dev` (§9 rows, schema 65), the automated lane fresh (hibana-safe latest
snapshot 5.23 h old < 7 h). The belt-first probes rode the restore verification: ZERO
sprint/strategy/tag case-twins, ZERO multi-drafts on either DB — nothing to park, so
0067 carries indexes only. Found on the way: 1 orphan archive row in prod (the spec's
known one), 2 in dev (the s252 live probe's own residue — the probe-user purge cascaded
the project away but 0046's missing FK let the archives survive; DB-3's exact bug class).

**Migration 0067** (`3572a9ca`, additive-only, IF NOT EXISTS-guarded): the four audit
indexes — idx_project_archives_sprint (DB-1: the only EQP-verified full SCAN, now
`SEARCH … USING INDEX`, proven locally before touching remotes), idx_sprints_one_draft
(partial unique), idx_sprints_project_name + idx_strategies_project_name (expression
uniques on lower(trim(name))). Applied dev first (schema 65→66, row-count parity
byte-identical, four indexes present), then prod with a FRESH bookmark:prod first
(00002043…). Zero row loss on either side.

**The code round, one commit per finding:**
- **BE-8/DB-2 catch-and-map** (`00daad15`): `uniqueViolationOn(err, …needles)` in
  devboard-helpers + try/catch at all SIX sprint/strategy create+rename writes — the
  0067 belts map to the pre-checks' own 409s (duplicate / draft_exists / with the
  winner's id; the with-dates INSERT and PATCH-reopen arms also catch the 0065
  one-active belt → sprint_active_exists, same class, same sites). Never a raw 500.
- **DB-3** (`6613963d`): `DELETE FROM project_archives` added to all THREE purge sites
  (projects hard-delete, admin/cron 7-day purge, settings empty-trash — each BEFORE the
  projects DELETE, subquery-shaped). Purge-parity pins ×3 (one per site, row-count
  asserted). The live orphan sweep post-bookmark: prod 1 row, dev 2 rows, counts in §9
  (bookmarks 00002044…/0000119b…). **This is the plan's only destructive-semantics
  change** — flagged in the Changelogs row.
- **DB-4** (`5b553409`): DEBT.md entry for the 0060 folder_id FK loss (latent, app-level
  cleanup covers it; removal = a future owner-approved rebuild).
- **BE-1 + BE-5b** (`07b56233`): setTaskTags is BATCHED — one NOCASE-IN find
  (oldest-row-wins), one palette read (tagColorCounts/leastUsedPaletteColor extracted,
  sequential per-name color pick preserved), one chunked multi-row
  INSERT…ON CONFLICT…RETURNING create, executeIn-chunked link sync; a 12-tag save drops
  from ~30 sequential round trips to a fixed ~6-9. Response shape byte-identical.
  Archives GET capped LIMIT 200 + additive `?offset=` (the quicknotes grammar; absence
  = page 0 — the island + desktop mirror are served exactly as before).

**The honest test record:** 990/990 vitest (from 976: +11 s253 pins, +3 purge-parity,
plus one RE-PIN — the S240 "legacy case-twins stay readable" pin seeded a same-project
twin pair directly, a state 0067 makes structurally impossible BY DESIGN; the pin now
asserts the DB-layer refusal + the write-gate 409 + clean reads, and the s247
lock-step matrix citation follows it). fn-shape needed the per-round allowlist re-pin
(five devboard handlers moved/grown + the new setTaskTags@72 pin — the S252 doctrine).
The e2e round: the fresh sandbox lacked the Playwright browser (255 instant failures —
`npx playwright install chromium` fixed it, not a code issue), then 510/510 green
(shard 1: 257/257 in one run; shard 2: 249 ✓ when the tool timeout killed the process
at test 249/253, the remaining viewport file re-run 15/15 — every one of the 510
verified, zero failures). verify exit 0, cache-bust PASS (backend-only), i18n
1707/1707, precache +19 KB headroom, bundle PASS.

**Live:** CD deployed dev+prod on `c03d6dc9` (CI green). `scripts/live-s253-probe.mjs`
(24 checks — schema 66 in the health probe, the belt 409s create+rename both tiers,
BE-1 shape + NOCASE reuse, BE-5b paging, clean deletes): local rehearsal 24/24, dev
24/24 (seeded probe user, purged after — probe users 0, dev orphans 0, baseline counts
restored), prod 24/24 (the test account). Prod error_log: ZERO rows in the session
window. The dev probe-user purge now sweeps the archives the cascade can't reach (the
S252 seeder's gap — its own probe residue was today's dev orphans).

**Desktop: ZERO changes** (spec §5 step 8) — web-D1 indexes are invisible to the Go
mirror, no island byte changed, the archives default payload is unchanged (the cap
sits above prod's 149-row max; ?offset= is additive opt-in). No re-pin, no release.

**Version:** 0.4.1.45 → **0.4.1.46**. Commits: `3572a9ca…40eb971e` (0067 + five fix
commits + allowlist + probe + release bump).

**Next:** Phase 3 (S254) — Interaction performance (FE-2/3/8/1/10/12/14/15/19/20), the
island round WITH the full desktop re-pin.

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
