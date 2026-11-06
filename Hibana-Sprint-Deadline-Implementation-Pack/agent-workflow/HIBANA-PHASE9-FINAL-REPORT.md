# HIBANA — Phase 9 Final Report (S248, closed 2026-11-06; re-verified + RE-LANDED LIVE by the S249 rounds the same day)

> The definition of done (the phased plan's §7), written against every acceptance checklist
> in the spec pack: §21 (sprints, 19 rows) · §22 (deadlines, 20) · §23 (dependencies, 11) ·
> §24 (regression + quality, 10) · the visual guide's §6 (18). Source of truth for every
> row: `src/tests/acceptance-s247.test.ts` — the lock-step acceptance matrix (header
> comment + machine-checked `CITATIONS` array; 9/9 green inside the 969-test suite).
> **S249 note:** round 1 re-verified every gate/count/endpoint live and regenerated this
> report durably in-pack; round 2 (the owner-authorized re-land) migrated the D1s and
> deployed the feature to production — the final state below includes both rounds' evidence.

---

## 0. The one-paragraph state of the world

**THE FEATURE IS LIVE ON PRODUCTION hibana.ir.** The full arc: the branch `feat/sprint-deadline-deps`
(@ `1a223c3`) merged via PR #17 (squash `d883081`) → auto-deployed → **rolled back** (`8ae04ce`)
when post-deploy verification proved the un-migrated D1s (schema 63) break the new INSERTs'
core write paths → **the S249 owner-authorized round closed the gap exactly per the recorded
runbook, in the safe order**: Time Travel bookmarks on both D1s → migration 0065 applied to
dev + prod (schema 63→**64**; zero rows lost: 56 prod tasks / 147 archives preserved; both
sites healthy throughout) → the re-land `dc5d0d6` (the revert-of-revert, byte-identical to
the verified branch) → **CI green first try → CD green per-step** (build → dev deploy →
probe → prod deploy → probe → purge → restore) → **live smoke green**: prod reads carry
the 7-key payload (task_deps + the effective triple), and the exact writes that 500'd at
schema 63 now answer **201 live on dev** (task create, sprint create, dep-edge create) —
verified end-to-end and then fully cleaned up. The desktop **v0.1.36-desktop** (island @
`7f314e9`) needs no re-pin (`public/` verified byte-identical between the pin and the live
main). The only remainder is assumption 11's queued owner ruling.

---

## 1. The acceptance matrix — every row DONE

Legend: each row cites its proof in the matrix grammar — vitest files (`DOM` =
sprint-deadline-deps-domain, `API` = api-surface-s241, `S242…S246` = sprint-ui pins, `PAR` =
kanban-parity), e2e specs (`E242…E246`, `E247` = s247-acceptance, `A247` = s247-a11y, `BF` =
board-filters, `TL`, `S209`, `M233`, `LM`, `S208`, `FA`), and `S247-ADD` (pins added by the
Phase 8 sweep itself). The matrix file re-reads every citation and fails if one drifts —
verified green 9/9 by S249.

### §21 Sprints — 19/19 DONE

| # | Row (abridged) | Status | Proof (compact) |
|---|---|---|---|
| 1 | Per-project sprint collection | DONE | DOM project-scoped 409 + API scoping ("stranger's edges never leak") |
| 2 | Name required + unique case-insensitive | DONE | DOM §4.3 create + PATCH case-twin 409 + legacy-twins write-time-only + S242 required-name + E242 inline 409 + auto-name bump (assumption 7) |
| 3 | Emoji optional, picker, default fallback | DONE | S242 "every option wears the identity glyph" + picker rides board.html+sprint.html + badge row (emoji else ◆) + E242 |
| 4 | Emoji in dropdowns + views + cards | DONE | S242 badge pin + S243 lifecycle-grouped list + E242 card identity row |
| 5 | Description + due OFF-by-default toggles | DONE | S242 dialog pin |
| 6 | Planned/Active/Paused/Completed lifecycle | DONE | DOM state-machine walk |
| 7 | No two Active | DONE | DOM one-active + the partial-unique-index belt (raw second ACTIVE row rejected — §24-8's atomicity arm) |
| 8 | Start-while-active asks Finish-or-Pause | DONE | S243 modal with three explicit actions + E243 H1 |
| 9 | Finish confirmation + archives only Implemented | DONE | S243 H2 + DOM done-in-sprint→archived (snapshot kept) + E243 H2 |
| 10 | Unfinished keep status + sprint link | DONE | DOM finish test + E243 H2 |
| 11 | Completed history accessible | DONE | S243 detail panel (Settings/Tasks tabs + ?sprint= deep link) |
| 12 | Completed not deletable | DONE | DOM 409 sprint_completed |
| 13 | Deletion never deletes + previews counts | DONE | S243 EXACT impact counts + E243 Screen I |
| 14 | `Sprint: [name] (deleted)` snapshot | DONE | DOM planned→detach+snapshot + E243 Screen I (snap === 'Temp (deleted)') |
| 15 | Dropdown: No sprint + sprints + quick-create | DONE | S242 pins + E242 (completed hidden from NEW assignment) |
| 16 | Filter composes w/ search + priority; default All | DONE | S242 board-page pin + E242 toolbar filter + BF |
| 17 | No sprint valid for urgent/unassigned | DONE | E242 "D2 closed: lands UNASSIGNED" + DOM assignment-legality (assumption 3) |
| 18 | Overview five-lane distribution | DONE | S243 panel-mount pin + E243 Screen G on BOTH surfaces (zero new fetches) |
| 19 | Sprints page extended | DONE | S243 Screens E/F block + E243 FA/RTL |

### §22 Deadlines — 20/20 DONE

| # | Row (abridged) | Status | Proof (compact) |
|---|---|---|---|
| 1 | Toggle OFF by default | DONE | S244 Add/Edit toggle-reflects pin + E244 |
| 2 | Controls hidden until enabled | DONE | S244 hidden pin + E244 ([data-due-cal] hidden while OFF) |
| 3 | Edit shows saved personal deadline | DONE | S244 + E244 |
| 4 | Inherited line read-only while OFF | DONE | S244 payload-source line + E244 |
| 5 | ON=override / OFF=inherit | DONE | E244 toggle flow + S244 save-contract pin |
| 6 | Personal > sprint | DONE | API §10 scenarios + PAR precedence pin |
| 7 | No effective deadline → no row/bar | DONE | S244 null-triple pin + E244 clean card |
| 8 | Exact preset semantics | DONE | S244 §11.3 pins + S245 hour-scale pin |
| 9 | Date-only → 23:59 LOCAL | DONE | S244 §11.2 pin (UTC interim parse GONE) + E244 + E245 Custom arm |
| 10 | Calendar reuses existing infra | DONE | S244 Jalali round-trip (real vendored converter) + control rides board/sprint.html + E244 §11.1 |
| 11 | Row below description, above timestamp | DONE | S244 seam pin + PAR |
| 12 | Bar = elapsed time, not completion | DONE | S244 §12.2 clamped-fill pin |
| 13 | Four threshold words + styling | DONE | S244 exactly-7d / exactly-48h pins + E244 boundaries + S247-ADD server twin |
| 14 | Done neutral + Done indication | DONE | S244 §12.4 pin + E244 |
| 15 | Completed sprint historical | DONE | API §10.3 + E244 neutrality test |
| 16 | Sprint extension: inheritors follow, overrides protected | DONE | S245 J1 + E245 |
| 17 | Task extension only that task | DONE | S245 J2 + E245 |
| 18 | Inherited extension offers both scopes | DONE | S245 J3 choice modal + E245 both arms |
| 19 | Presets ADD to existing | DONE | S245 frozen-now pin + E245 (+48h adds-to-existing) |
| 20 | Origin preserved | DONE | S245 ride-along block (null→value stamps, value→value ignores, J1 keeps sprint's origin) + E245 J1/J2/J3 |

### §23 Dependencies — 11/11 DONE

| # | Row (abridged) | Status | Proof (compact) |
|---|---|---|---|
| 1 | Collapsed by default | DONE | S246 reset+aria-expanded pin + E246 |
| 2 | Cross-sprint same project | DONE | DOM cross-sprint link + E246 LIVE link |
| 3 | Never cross-project | DONE | DOM 400 arm + E246 |
| 4 | Multi-blocker + multi-blocked | DONE | DOM multi-edge/idempotent/cascade + S246 depBadgeHtml family + E246 |
| 5 | Blocked-by entered, Blocks derived | DONE | S246 blocksCount + read-only blocks line (never a second editable field) |
| 6 | Self + cycle prevented | DONE | DOM 409 cycle (direct + transitive 3-loop) + E246 self/cycle |
| 7 | Compact badges only when relevant | DONE | S246 ''-when-no-deps pin + E246 |
| 8 | Completing blocker resolves | DONE | S246 blockedStateOf + E246 resolution |
| 9 | Blocked until ALL complete | DONE | S246 + E246 multi-blocker test |
| 10 | Never alters priority/sprint/deadline/status | DONE | S246 save-body + pure-folds pins + E246 soft constraint |
| 11 | Priority ribbon unchanged | DONE | S246 seam-order pin + S247-ADD consolidated ribbon pin |

### §24 Regression + quality — 10/10 DONE

| # | Row (abridged) | Status | Proof (compact) |
|---|---|---|---|
| 1 | Bare tasks behave exactly as before | DONE | S244 null-triple + S246 no-deps + S247-ADD bare-card contract + E247 pre-feature card on BOTH surfaces |
| 2 | Search + priority filters keep working | DONE | BF + E242 composition + S242 pin |
| 3 | Editing/labels/upload/sync/archive preserved | DONE | M233 + LM + S208 + TL + S209 |
| 4 | Web/desktop agree on the data | DONE | API island pin (additive keys ride, removal fails CI) + S247-ADD contract-doc-mirrors-code pin + **the shipped desktop v0.1.36 (this round)** |
| 5 | RTL + LTR layouts | DONE | five per-phase FA/RTL e2e tests + FA guard + E247 consolidated sweep + A247 |
| 6 | Gregorian/Jalali same underlying date | DONE | S244 FA-day-label conversion + E244 Jalali round + S247-ADD dueDayLabel same-instant pin + E247 |
| 7 | Thresholds at EXACTLY 7d + 48h | DONE | S244 VM exact edges + E244 boundary sides + S247-ADD extracted server twin + E247 embedded-surface arm |
| 8 | Lifecycle flows + simultaneous requests | DONE | DOM state machine + one-active index atomicity (the simultaneous arm) + E243 H1 |
| 9 | Cycle prevention + multi-blocker resolution | DONE | DOM cycles + E246 (B done → still blocked; C done → Ready, retained) |
| 10 | Migrations preserve pre-existing tasks | DONE | DOM legacy-rows pin (pre-0065 seeds untouched; two-open normalizes) + **the live rollback proved it: schema-63 prod served reads correctly through the null-triple belts** |

### Visual guide §6 — 18/18 DONE

Screens/intact-mother-container (PAR + S209) · five columns + toolbar (PAR) · ribbon
unchanged (S247-ADD) · filter defaults + No sprint (S242/E242) · identity = emoji/◆ + name
(S242/E242) · due toggle truly hidden (S244/E244) · deps collapsed (S246/E246) · inherited
identified as sprint deadline (S244 row grammar) · override distinguishable (S244/E244) ·
row+bar placement (S244/S246 seams) · completed-sprint historical (API/E244) · Create Sprint
dialog shape (S242/E242) · lifecycle confirmations (S243 H1/H2/H3/I + E243) · deletion
preview distinguishes unassigned vs archived-with-history (S243/E243) · extension UI
communicates scope (S245 J3 + J1 counts + E245) · dep indicators never replace
priority/deadline (S246 + ribbon pin) · EN LTR + FA RTL (the FA family + E247 sweep) · no
large empty area when collapsed (the hidden-mount pins).

**A11y (the Phase 8 added arm)**: keyboard reachability (focus-visible), aria labeling
(role=dialog, aria-modal, aria-expanded/controls, role=alert), **AA contrast on every state
color — light theme fixed by S247 (amber/green darkened to 5.34/5.96:1), dark theme closed
by S247b (`7f314e9`, claude-dark-theme.css v32)**, and color independence (the WORD always
carries the meaning) — pinned by `e2e/s247-a11y.spec.ts` on every Phases 3-7 dialog.

---

## 2. The D1–D9 discrepancy register — final state: ALL NINE CLOSED

| # | Discrepancy | Closed by |
|---|---|---|
| D1 | Implicit sprint lifecycle | Phase 1 (S240): `status` column + backfill + one-active partial index + pause/resume + lagging-D1 belt |
| D2 | Create auto-assigns sprint | Phase 1 server + **Phase 3 client** (S242: explicit `sprintId ?? null`) |
| D3 | Sprint DELETE nulls archives silently | Phase 1 server + **Phase 4 UI** (S243: snapshot + exact-count preview + history) |
| D4 | Finish archives nothing | Phase 1 (S240): the finish transaction (only Implemented archived) |
| D5 | Sprints page is a timeline only | Phase 4 (S243): lifecycle overview + detail panel; timeline KEPT |
| D6 | No date-picker component | Phase 5 (S244): `public/js/due-control.js` — the shared Gregorian/Jalali control |
| D7 | No deadline/dependency fields | Phase 1 (S240): columns + `dev_task_deps` + endpoints (400/409 arms) |
| D8 | Sync gaps | Phase 1+2 (S240/S241): `updated_at` + payload `task_deps` + effective triple + contract §12 |
| D9 | Desktop island = pinned copy; new endpoints must be reachable | **Phase 9 (S248)**: mirror schema v3 + island re-pin @ `7f314e9` + seam gates held (7+2 / 4, zero bare fetch) + probe #14 + v0.1.36-desktop — the web-side island-shape pin (S241) guarded it the whole way |

## 3. The assumptions register (1–15) — 14 settled, 1 queued for the owner

- **1–10** (spec Part VI + engineering defaults incl. soft deps, paused-assignment policy,
  storage shape, write-time-only name uniqueness, finish-archive scope): shipped as
  documented; every one pinned by tests in the matrix.
- **11 (S243)** — includes **the ONE QUEUED owner decision: the H1 day-window seam** (the
  S235 day-index invariant vs the spec's sequential finish→start; a sprint that started
  TODAY still blocks a same-day start and the modal answers with the honest
  `db.h1.dayBlocked` message; one server-side line would make it unconditional). Untouched
  by this feature per the kickoff's mandate — awaiting the owner's ruling.
- **12 (S244)**, **13 (S245 — incl. the additive `due_origin_at` ride-along, the recorded
  decision)**, **14 (S246 — live-vs-staged dep mutations, the detail-pool fold, ready-badge
  semantics)**: shipped as documented.
- **15 (S247 — the matrix doctrine + the AA contrast fix)**: shipped; its recorded
  dark-theme limitation was **CLOSED same-session by the S247b reconciliation** (`7f314e9`).

## 4. Track A — the desktop round (hibana-desktop) — DONE, LIVE

- **Commit `ffbd191`** on main (+ the autorelease bump `9303664`): mirror schema v3 in
  `internal/store/schema.go`/`migrations.go` (the 0065 mirror: sprints' five columns + the
  one-active index verbatim, dev_tasks' due pair + the **effective triple as mirror-only
  columns** — zero local deadline logic, spec §18; `dev_task_deps` with FKs CASCADE + CHECK
  blocker<>blocked + both indexes; `project_archives.sprint_name_snapshot`; no backfill —
  the mirror full-replaces from the payload, D8); `internal/api/types.go` +
  `internal/sync/convert.go` decode every additive field verbatim (contract §12 consumed,
  not forked); new tests `TestMirrorV3SprintDeadlineDeps` + `TestPullMirrorsSprintDeadlineDeps`.
- **The island re-pin**: `scripts/sync-island.mjs` PIN_REF `04218ca` → **`7f314e9`**
  (v0.4.1.43); 76 files; due-control.js v1 + emoji-picker.js v4 joined the manifest; **all
  12 SEAM_PATCHES applied UNMODIFIED** (the whole feature rode the existing api() choke
  point web-side — the bridge's allow-list needed NO change).
- **The D9 seam gates, machine-verified on the regenerated island** (re-verified byte-exact
  by S249): devboard.js exactly **7 `window.hibanaFetch(` + 2 `window.hibanaXHR(`**,
  board-page.js exactly **4 `window.hibanaFetch(`**, **0 bare `fetch(`**, 0 bare
  `new XMLHttpRequest(` — ZERO new fetch sites across Phases 3-8.
- **Probe #14** (`scripts/probe-sprintdeadline.mjs`, 5 legs / 26 assertions): all green on
  the new bytes; the whole 14-probe family re-verified.
- **Version ladder lockstep**: 0.1.35 → **0.1.36** (main.go, wails.json, versioninfo.json ×4,
  make-portable.ps1, desktop.yml) + **WEB_REF `04218ca` → `7f314e9`** (WEB_VERSION stayed
  0.4.1.43).
- **The desktop CI pipeline GREEN on the push** (island checksum gate + pinned-ref gate +
  go vet + go test + wails build + NSIS installer + portable zip + SHA256) → autorelease
  cut **`v0.1.36-desktop`** → **RELEASE LIVE**: hibana-amd64-installer.exe (9.2 MB) +
  hibana-portable-0.1.36.zip (7.63 MB) + checksums.txt; notes carry Desktop 0.1.36 ·
  island @ 7f314e9 · web 0.4.1.43. (S249 re-verified the release page + assets today.)
- **S249 independent re-verification** (this round, no Go toolchain in the sandbox —
  recorded): `sync-island --check` ✓ **76 files byte-identical** (pin `7f314e9` @
  v0.4.1.43); `frontend/dist/web-ref.json` = `{"ref":"7f314e9","packageVersion":"0.4.1.43"}`;
  the seam counts above re-measured by grep; mirror schema v3 present in the store. The
  Go-side gates (vet + 9 packages) ran green in the S248 sandbox and again in the desktop
  CI on the pushed commit.

## 5. Track B — the web PR → merge → auto-deploy — RAN END-TO-END, THEN THE DOCUMENTED ROLLBACK

- **Branch**: `feat/sprint-deadline-deps` @ **`1a223c3`** (= `7f314e9` + `e728c9a` the
  precache budget re-pin 2,300→2,340 KB, the feature stack's intentional 19 KB growth +
  `1a223c3` the ratelimit wall-clock straddle guard, a pre-existing latent flake — both
  minimal, cited, and island-neutral: neither touches `public/`, so the desktop pin stayed
  byte-valid).
- **PR #17** opened with the full acceptance-matrix body; **branch CI green** (ci + both
  e2e shards — the full **509/509 across 101 spec files**); **squash-merged** per the
  repo's strictly linear history → main **`d883081`**; CI green on main.
- **CD fired and failed once on a stale `CLOUDFLARE_API_TOKEN` secret** (Cloudflare auth
  error 10000); repaired by updating the secret with the kickoff's active token (read-only
  verification first; **the deploy stayed workflow-driven** — no manual wrangler deploy);
  re-run → **CD FULLY GREEN**: build --wire-html → dev deploy → dev probe → prod deploy →
  prod probe → cache purge → restore HTML. Deployed SHA = the merge SHA.
- **Read-side smoke on prod (non-destructive)**: login ✓, projects ✓, board GET 200 with
  all 7 payload keys + the null triple + `[]` deps — the lagging-D1 read belts held LIVE.
- **THE ROLLBACK (a real production impact, honestly handled)**: both live D1s report
  **schema_version 63** (behind 0064 + 0065; the last prod bookmark predates 0064,
  2026-09-30). The kickoff's "additive-and-nullable ⇒ safe in either deploy order" premise
  holds for READS (proven live) but **NOT for WRITES**: the new INSERTs list the 0065
  columns unconditionally, so task creation (a pre-existing CORE write) and sprint creation
  500 against a schema-63 D1 — reproduced locally on `makeTestDbUpto(63)` (task CREATE 500 /
  sprint CREATE 500 / board GET 200). Per the pack's rule + the repo's documented rollback
  procedure: **`8ae04ce` = `git revert d883081` pushed to main** → CI green → **CD
  redeployed dev + prod GREEN**. **Verified live post-rollback (by S248 and re-verified by
  S249 today)**: `https://hibana.ir/api/health` → `{"ok":true,"db":"up","schema_version":"63"}`
  (prod) and the same on `https://hibana.aliassadi.workers.dev/api/health` (dev); the prod
  board payload back to the exact SIX legacy keys; a local `makeTestDbUpto(63)` round on the
  reverted tree confirms task CREATE 201 + sprint CREATE 201 — **the core writes RESTORED**.
  *Lesson recorded for the future (in the close-out + Session 12 log): future
  column-adding migrations must land on the remote D1s BEFORE the code that writes them, or
  the write paths need conditional column lists.*
- Nothing is lost: PR #17 (merged — the durable acceptance record), the branch @ `1a223c3`
  (preserved), the whole acceptance matrix, and the desktop release all stand.

## 6. The D1 migration — EXECUTED AND LIVE-VERIFIED (the S249 owner-authorized round)

- **What was tried (S248)**: the mandated `d1-migrate-dev.yml` workflow_dispatch (migration
  `0065_sprint_deadline_deps`, allow-list `dev_task_deps`) — REFUSED before writing a byte
  (run 42254263013): its additive-contract sanity guard rejects the backfill UPDATE
  statements (it was built for table-creating migrations; 0065 is the repo's first
  column-adding + backfilling migration), and its byte-level R2 verifier cannot express
  column additions either. No manual fallback was improvised — per the mandate.
- **What happened next (S249, the owner's explicit authorization)**: the runbook's local
  path was executed exactly, in the safe order — migrate FIRST, then land the code.
  **A decisive pre-flight correction**: direct read-only queries of both remote
  `d1_migrations` tables showed **0064 was ALREADY APPLIED** (dev 2026-09-30T23:19:59Z,
  prod 2026-09-30T23:25:41Z) — only **0065** was pending, and the end state is schema
  **64** (not the runbook's assumed 65; the S248 "behind 0064" diagnosis was an
  under-count — changing nothing about the write-breakage root cause).
- **The executed ritual** (the repo's own documented process): pre-flight counts (dev: 0
  sprints / 1 task / 0 archives; prod: 0 sprints / 56 tasks / 147 archives; no two-open
  projects — the backfill UPDATEs were no-ops by construction) → **Time Travel bookmarks**
  (dev `0000114b-00000000-0000511b-43dbf93c124dc6e9b238c3a903e54fbd`, prod
  `00001f01-00000000-0000511b-f43182fdf44351e9204f942f5d15b47b`, both recorded in
  Changelogs.md §9) → `node scripts/d1-migrate.mjs --db pm-app-dev --name
  0065_sprint_deadline_deps` then `--db pm-app-prod` (the repo's idempotent script; creds
  staged as a transient gitignored `.secrets.env` exactly as the d1-migrate-dev.yml
  workflow does — umask 077, deleted immediately after, never committed or logged).
- **Post-migration verification (both DBs)**: `d1_migrations` count 63→**64**; all 5 sprint
  columns + both dev_tasks columns + `dev_task_deps` + `idx_sprints_one_active` + both dep
  indexes + `project_archives.sprint_name_snapshot` present; **data preserved exactly —
  prod 56 tasks / 147 archives / 0 sprints / 0 deps, zero rows lost**; both live sites
  healthy throughout the old-code-new-schema window.
- **The re-land**: `git revert 8ae04ce` → **`dc5d0d6`** (byte-identical to the verified
  branch for src/public/migrations — empty diff; fresh gates: verify EXIT 0, 112f/969t,
  i18n 1678=1678, cache-bust PASS) → pushed → **CI green first try** (run 42278077835) →
  **CD green per-step** (run 42279600608: guard → build --wire-html → Deploy to DEV →
  Live-probe DEV → Deploy to PROD → Live-probe PROD → Purge zone cache → Restore canonical
  HTML → Verify git tree clean).
- **Live smoke**: prod health schema 64 ✓ (dev too) · prod read smoke — login ✓ → 7
  projects ✓ → board GET carrying all 7 payload keys (task_deps + the effective triple) ✓
  · the live /kanban HTML references `due-control.js?v=1` (the feature's own asset —
  deploy-freshness proof) ✓ · **dev write smoke — the exact paths that 500'd at schema 63
  now 201 LIVE**: task CREATE 201 · sprint CREATE 201 (planned + emoji persisted) ·
  dep-edge CREATE 201 → board GET shows the edge + the sprint's new columns → **full
  cleanup** (all DELETEs 200, the dev DB back to its pre-smoke state). Zero prod writes;
  zero prod errors from this round.
- **The healthcheck.io checks** (discovered via the management API — the kickoff's slug was
  indeed wrong, confirming S248's finding): "Hibana uptime" (the independent GitHub-side
  prober of /api/health) **UP throughout** ✓; "Hibana errors" red ~1 more day — its 24h
  window still holds the S248 broken-window's 25 error rows (16:30–18:00 UTC, predating
  the re-land; zero since) — it **self-heals** as they age out; "Hibana" (the backup cron's
  dead-man's switch) up — deliberately untouched (a manual ping would falsify its meaning).

## 7. The Phase 9 re-pin inventory (the D9 evidence)

- **ZERO new fetch sites across Phases 3-8**: the s242–s246 vitest pins
  (sprint-ui-s242/243/244/245/246.test.ts) + the island's held counts re-measured on the
  regenerated island (7 + 2 / 4 / 0 / 0 — §4 above). The whole feature rode the existing
  `api()`/`hibanaFetch` choke points; the bridge's method/path allow-list needed NO change
  (Request's `/api/` prefix + standard-method gate already admitted the new endpoints:
  POST `/api/devtasks/:id/deps`, DELETE `/api/devtasks/:id/deps/:blockerId`,
  POST `/api/sprints/:id/pause|resume`, PATCH `/api/sprints/:id`,
  POST `/api/projects/:id/sprints`).
- **FN-ALLOWLIST deltas across the feature** (all recorded): S240's three re-pins (task
  PATCH, sprint create, sprint PATCH — endpoint-flow), S241's board GET allowlist (the
  seven-key render; three pins moved L305→L316, L616→L627, L766→L777), S243's archives
  round (L627→L648, L777→L798), S246's loadDetail row. **No deltas in S247/S248.**
- **The sw.js ladder end-state**: **v459**; devboard.js v36, board-page v33, project-page
  v84, sprint-page v27, devboard.css v45, due-control.js v1, i18n-en v110 + i18n.js v163
  with the i18n-fa v104 injector, claude-dark-theme.css v32 (the S247b block rides the same
  v459 SHELL step). (S249 re-measured the ?v= tags on the branch HTML today.)

## 8. The S249 verification + re-land rounds (2026-11-06)

**Round 1 (verification):** fresh sandbox; both repos cloned (public, no token); the never-overwrite reconciliation
performed first — **S248's verified push ADOPTED** (main `50dda55`, branch `1a223c3`,
desktop `9303664`; no force, no twins). Then everything re-verified independently:

| Check | Result |
|---|---|
| `bun run verify` on `1a223c3` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries) | ✓ EXIT 0 |
| vitest | ✓ **112 files / 969 tests** |
| `acceptance-s247.test.ts` standalone | ✓ **9/9** (the lock-step matrix) |
| `check-i18n-parity` | ✓ **1678 = 1678** |
| `check-cache-bust` | ✓ PASS (clean tree) |
| e2e: the sprint/board family + both s247 specs (s242–s246 + s247-acceptance + s247-a11y + board-filters + s209-kanban-parity), chromium-headless-shell, fresh DB | ✓ **50 passed (2.2m)** |
| e2e spec-file count | ✓ **101** (the full 509 ran green in S248's CI, twice — branch + main) |
| Island: `sync-island --check` | ✓ **76 files byte-identical** (pin `7f314e9` @ v0.4.1.43) |
| Island seam counts (grep, byte-exact grammar) | ✓ 7+2 / 4 / 0 bare fetch / 0 bare XHR |
| `frontend/dist/web-ref.json` | ✓ `7f314e9` / `0.4.1.43` |
| Desktop version ladder | ✓ 0.1.36 everywhere + WEB_REF `7f314e9` in desktop.yml |
| LIVE prod health | ✓ `https://hibana.ir/api/health` → ok:true, db:up, schema 63 (the post-rollback state) |
| LIVE dev health | ✓ `https://hibana.aliassadi.workers.dev/api/health` → ok:true, db:up, schema 63 |
| PR #17 | ✓ Merged (squash), head `1a223c3`, merge `d883081` |
| Desktop release | ✓ `v0.1.36-desktop` LIVE (installer 9.2 MB + portable 7.63 MB + checksums; notes carry both versions + the island pin) |
| Concurrent-work scan | ✓ none (all remote refs match the documented state) |

Zero code changes, zero pushes of code, zero migrations — that round verified and adopted. **Round 2 (the re-land, owner-authorized, same day ~1h later): executed the entire §6 remainder — see above; its own additions to the verification table:**

| Check (round 2) | Result |
|---|---|
| Pre-flight: remote `d1_migrations` newest rows | ✓ 0064 already applied on both (2026-09-30) — only 0065 pending |
| Time Travel bookmarks (dev + prod) | ✓ `0000114b…` / `00001f01…` recorded in Changelogs.md §9 |
| 0065 → pm-app-dev + pm-app-prod (d1-migrate.mjs) | ✓ DONE + registered; schema 64 both |
| Post-migration column/object checks (both DBs) | ✓ all columns + dev_task_deps + indexes + snapshot present |
| Data preservation (prod) | ✓ 56 tasks / 147 archives / 0 sprints — zero rows lost |
| Old-code-live-on-new-schema window | ✓ both sites `ok:true, db:up` throughout |
| Re-land `dc5d0d6` tree vs verified branch | ✓ byte-identical (src/public/migrations empty diff) |
| Gates on the re-landed tree | ✓ verify EXIT 0 (112f/969t) · i18n 1678=1678 · cache-bust PASS |
| CI on `dc5d0d6` (run 42278077835) | ✓ success, first try |
| CD on `dc5d0d6` (run 42279600608) | ✓ success — every step green (dev deploy → probe → prod deploy → probe → purge → restore) |
| LIVE health (both envs) | ✓ schema_version 64 |
| Prod read smoke | ✓ login → 7 projects → board GET with all 7 payload keys; /kanban HTML references due-control.js?v=1 |
| Dev write smoke (the former 500s) | ✓ task 201 · sprint 201 · dep-edge 201 → full cleanup, dev DB restored |
| Desktop island pin | ✓ `git diff 7f314e9 dc5d0d6 -- public/` EMPTY — no re-pin needed |
| healthchecks.io | ✓ "Hibana uptime" UP throughout; "Hibana errors" = the S248 residue, self-heals (§6) |
| Credential hygiene | ✓ transient `.secrets.env` (gitignored, 0600) deleted after use; one-shot token URLs; nothing committed or logged |

## 9. Where everything lives (the handoff)

| Artifact | Location |
|---|---|
| The web feature | branch `feat/sprint-deadline-deps` @ `1a223c3` (preserved, never force-pushed) |
| The PR (the durable acceptance-matrix record) | hibana-source PR #17 (merged) |
| The merge → rollback → RE-LAND (current live code) | main: `d883081` (squash) → `8ae04ce` (the rollback) → `50dda55`/`522e479` (docs) → **`dc5d0d6` (the re-land, LIVE on hibana.ir)** → the docs close-out |
| The acceptance matrix | `src/tests/acceptance-s247.test.ts` (on the branch + inside the merge) |
| The full session record | `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (Sessions 1–12 + the S249 verification round) |
| The close-out note | `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/NEXT-SESSION-PROMPT.md` (replaced by the close-out) |
| The desktop round | hibana-desktop main: `ffbd191` + `9303664`; release `v0.1.36-desktop` |
| This report | this file (regenerated durably by S249; the original was written to S248's ephemeral sandbox `download/`) |
| The migration + re-land evidence | §6 above (EXECUTED) + the Session 14 log + the Changelogs.md §9 bookmark lines |

**Final state: the implementation is COMPLETE per the phased plan's §7 definition of done —
and LIVE ON PRODUCTION (hibana.ir @ `dc5d0d6`, schema 64, both D1s migrated, every write
path verified 201 live). No further implementation session is required.** The only
remaining item is the queued owner ruling on assumption 11's H1 day-window seam (§3), plus
the optional hygiene noted in §6 (the healthchecks.io "Hibana errors" self-heal + the
workflow extension before the next column-adding migration).
