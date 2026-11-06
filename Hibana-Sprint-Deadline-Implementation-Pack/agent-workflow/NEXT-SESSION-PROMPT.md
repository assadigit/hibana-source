# Next Session Prompt — Phase 8: Cross-Platform QA, Regression, Localization + Accessibility (the Full-Spec Sweep — Every Acceptance Row in §21/§22/§23/§24 Turned Into a Test or a Verified Pin)

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S247** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ `da652d2`, Phase 3 = S242 @ `a1e7d2d`, Phase 4 =
S243 @ `b770258` + the S243b reconciliation @ `3ae6ae9`, Phase 5 = S244 @ `7a6bd4a`,
Phase 6 = S245 @ `f1ca773`, Phase 7 = **S246 @ `a820253`** — all final deliveries
verified, all gates green; the Phase 7 round delivered the task DEPENDENCIES UI: Screen K
the collapsed Dependencies section in the task modal (the searchable same-project
Blocked-by multi-select with title + sprint glyph + status per option; LIVE POST/DELETE in
edit mode through the `addTaskDep`/`removeTaskDep` api()-riders — ZERO new fetch sites —
with the inline 400 self / 409 cycle surfaces naming the offending pick; STAGED links in
add mode POSTed right after the create ack), Screen L the compact Blocked / Blocked · N /
Blocks N / Ready card badges in ALL THREE renderers (board-page.js + the detail-helpers.ts
server twin + project-page.js's pdTruthWrap repaint twin, byte-identical — their own row
after the deadline row, independent of the priority ribbon AND the deadline), §16.1's
completion resolution (Blocked while ANY blocker is incomplete; Ready when ALL complete;
the relationship RETAINED — a persistent derived state, never a transition event; status
doc assumption 14), the S238 task view's names row, the soft constraints pinned
end-to-end (a blocked task still moves — nothing gates Kanban movement), the embedded
board's dep fold fed by the DETAIL POOL (loadDetail's additive `taskDeps` key — never a
second board pull; contract doc §12.3), and the embedded done-transition FULL-lane
repaint). If ANOTHER session appears mid-work: reconcile per the never-overwrite rule —
adopt the verified push, never force-push, never stack a conflicting twin.

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in the one-shot
push URL `git push https://<TOKEN>@github.com/assadigit/hibana-source.git <branch>`. All
other credentials (Cloudflare, Telegram bot, healthcheck.io, Workers AI, the test account)
are OUT OF SCOPE this phase: no deploy, no wrangler, no D1 workflow runs, no live probes, no
notifications. Do not use them; do not write them anywhere.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — **THIS phase is the RELEASE GATE over the WHOLE spec**: re-read ALL of §21 (the sprint acceptance checklist — 18 rows), §22 (the deadline acceptance checklist — 20 rows), §23 (the dependency acceptance checklist — 11 rows), §24 (the regression + quality checks — 10 rows), plus §17 RTL/multilingual, §11.3's exact preset semantics, §12.3's threshold boundaries, §13's extension rules, §14–§16's dependency model, and Part VI's five explicit assumptions)
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (§6's visual implementation review checklist — every row; Screens A–N are ALL landed now, Phases 3–7)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 8 scope — the P0 release gate)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (architecture map, D1–D9 register, assumptions 1-14 — **assumption 2 (dependencies are SOFT), assumption 13 (S245's ride-along), and assumption 14 (S246's live-vs-staged mutation, the detail-pool fold, the Ready semantics) are BINDING**; assumption 11's H1 day-window seam stays queued — do not touch /start's semantics without an owner ruling)
6. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12 (the complete Phase 1-7 surface — endpoints, bodies, the error family, the effective-deadline contract, §12.3's dep write/read + the S246 detail-pool addition, §12.5's client-fold doctrine) on the feature branch
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commits, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read it off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`.
If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the latest docs-only commit (the S246 close-out on top of
   `a063405`); if it moved, reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`a820253`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain. Branch pushes run CI only and
   can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca`) stays
   READ-ONLY until the Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **111 files / 960 tests green** (935 + 25 `sprint-ui-s246.test.ts`).
   Fresh sandbox e2e note: `bunx playwright install chromium-headless-shell` (the pinned playwright
   build wants chromium_headless_shell-1248; the sandbox cache ships 1200).
5. Phase 8 needs ONLY the GitHub token, and ONLY for the one-shot authenticated push — never write
   it to disk, `.git/config`, files, commit bodies, or logs.

## Current phase: Phase 8 — Cross-platform QA, regression, localization, accessibility

Web repo, tests + docs in scope (code fixes ONLY where a sweep row FAILS — this is a QA gate
round, not a feature round). The deliverable is a **traceable release matrix**: every acceptance
checklist row in spec §21/§22/§23/§24 + the visual guide's §6 checklist mapped to a test that
EXISTS (name it — file + case) or a pin you ADD this round. Build the matrix as
`src/tests/acceptance-s247.test.ts` (the vitest side) + extend the e2e family — every row either
cites an existing green test or gains one:

- **§21 sprints (18 rows)**: the per-project scoping, the case-insensitive uniqueness, the
  emoji-or-default identity everywhere, the OFF-by-default description/due toggles, the four
  lifecycle states, the one-active invariant (incl. the conflict modal), the finish-archives-
  only-Implemented flow, the completed history + non-deletability, the deletion preview counts +
  never-deletes-tasks, the `Sprint: [name] (deleted)` snapshot, the dropdown (No sprint +
  sprints + quick-create), the filter composing with search/priority, the overview's five-lane
  counts, the Sprints page extension.
- **§22 deadlines (20 rows)**: the OFF-by-default toggle, the hidden-while-off controls, the
  saved personal deadline in Edit, the read-only inherited line, the ON=override / OFF=inherit
  toggle contract, the personal-over-sprint precedence, the no-deadline-no-row rule, the exact
  preset semantics, the 23:59 date-only default, the calendar selector reuse, the row/bar
  placement, the four threshold WORDS, the done-neutrality, the completed-sprint historical
  treatment, the extension scope rules (sprint vs task-only vs inherited choice), the presets
  ADD to the existing deadline, the origin preservation.
- **§23 dependencies (11 rows)**: the collapsed-by-default controls, the cross-sprint links,
  the no-cross-project rule, the multi-blocker + multi-blocked relationships, the user-entered
  Blocked-by + DERIVED reverse, the self/cycle prevention, the compact badges only when
  relevant, the completion resolution, the all-blockers-complete rule, the never-alter-
  priority/sprint/deadline/status rule, the unchanged priority ribbon.
- **§24 regression (10 rows)**: the no-sprint/no-deadline/no-deps tasks behave exactly as
  before, the search + priority filters, the editing/labels/upload/sync/archive behavior, the
  web/desktop data agreement (verify the CONTRACT DOC mirrors the code — the desktop side is
  Phase 9), the RTL + LTR layouts, the Gregorian/Jalali same-instant checks, the threshold
  boundaries at EXACTLY 7d and EXACTLY 48h (the s244 VM pins exist — extend to every display
  surface), the lifecycle flow tests, the cycle/multi-blocker resolution tests, the
  migration-preserved-pre-existing-tasks guarantee.
- **The a11y pass** (new — `e2e/a11y.spec.ts` exists; extend it or add `e2e/s247-a11y.spec.ts`):
  every NEW dialog/badge from Phases 3-7 — the quick-create, the lifecycle dialogs (H1/H2/H3/I),
  the due control, the extend dialogs (J1/J2/J3), the dep section + badges — gets keyboard
  reachability (focus-visible), aria labeling (the roles/labels/expanded states), contrast on
  the state colors, and color-independent communication (the WORD always carries the meaning).
- **The full e2e suite run**: the WHOLE `e2e/` directory (~90 specs — 2.2m+ under one worker;
  fresh sandbox: install the headless shell first). Record the exact count. Any failure: fix the
  ROOT CAUSE (a real regression) or, if it is a pre-existing flake under load, re-run isolated +
  document it in the session log (the S246 sprint-doc load-flake precedent).
- **The localization sweep**: `bun run check-i18n-parity` + spot-check the FA rendering of every
  Phases 3-7 surface in one FA e2e pass (the sprint dropdown + quick-create, the lifecycle
  dialogs, the due control + presets, the extend dialogs, the dep section + badges); the
  Gregorian/Jalali consistency (the SAME instant displays both ways — the dueDayLabel seam).
- **public/ hygiene**: if ANY public/ file changes, the `?v=` bumps + the sw.js ladder + the
  parity tests move with it (the s237/s238/s242/s243/s244/s245/s246 tripwire pins — move them
  with citations).

## Tasks in required order (Phase 8)

1. **Build the acceptance matrix**: read §21/§22/§23/§24 row by row; for each row record
   EXISTS (file + test name) or MISSING. Land the matrix as the header table of the new
   `acceptance-s247.test.ts` (a source-pin table the suite asserts stays in lock-step).
2. **Close the MISSING rows**: vitest source/domain pins first (cheap, deterministic); e2e
   for behavioral rows. Threshold boundary rows extend the s244 VM pins (exactly-48h /
   exactly-7d edges — every renderer). The a11y rows extend the a11y spec.
3. **The full e2e suite run** + the flake triage.
4. **The localization + RTL sweep** (the FA pass + the calendar consistency).
5. **Fix everything the sweep surfaces** — minimal, cited, intent-preserving; re-run the gates.

## Gate ladder (fix everything until green)

`bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries)
+ `bun run check-i18n-parity` + `bun run check-cache-bust` (both MATTER if public/ moved).
e2e: the FULL suite (fresh sandbox: `bunx playwright install chromium-headless-shell` first)
including the sprint/board family (`sprint-timeline`, `s206-sprint-fixes`, `sprint-ux`,
`sprint-doc`, `s209-kanban-parity`, `s242-sprint-ui`, `s243-sprint-lifecycle`,
`s244-deadline-ui`, `s245-extend-flows`, `s246-deps-ui`, `board-filters`) + the new s247
specs. Update `docs/autopilot/FN-ALLOWLIST.md` pins if handlers move (the tripwires pin the
sw.js ladder — move them with you).

## Commit, push, deploy rules

One or two coherent commits on **`feat/sprint-deadline-deps` ONLY**, message style
`test(qa): S247 <lowercase one-liner> — spec pack phase 8` (or `fix(ui):` if a real defect
was fixed — cite it) with a body carrying the acceptance-matrix summary (rows covered /
added / pre-existing-failing) + the full e2e count + any fixes. Review the final diff for
unrelated changes and secrets. Push: feature branch only, one-shot token URL, never persist
the token. A branch push runs CI only — it can NEVER deploy. No merge to main, no PR yet, no
`bun run deploy*`, no D1 workflow runs — deployment + D1 = Phase 9. No desktop changes, no
unrelated refactors, no new runtime deps, ZERO new fetch sites.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 8 checklist + session log with commit SHA + the acceptance-matrix results + the
   full e2e count + any new assumptions/decisions) and REPLACE this file's content with the
   fully populated **Phase 9 prompt** (Integration, merge, deployment, and handoff: the
   desktop round — `assadigit/hibana-desktop` @ `9d53e64` comes out of READ-ONLY; the mirror
   schema v3 (`dev_task_deps` + the new columns), the island re-pin from the post-Phase-8
   web ref (the seam gates: devboard's 7+2 / board-page's 4 counts + the SEAM_PATCHES), the
   version ladder lockstep, the desktop CI probe #14; the web PR → merge → CI→CD auto-deploy
   with SHA + health + smoke verification; the D1 dev migration via `d1-migrate-dev.yml`
   (confirm the PROD D1 process first — never improvise); the final report against every
   acceptance checklist; the Phase 9 re-pin inventory: ZERO new fetch sites across
   Phases 3-8, the FN-ALLOWLIST deltas, the sw.js ladder end-state).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to main (agent-workflow/*.md ONLY — `**.md` pushes are CI-skipped
   and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, the acceptance matrix (rows covered/added), exact
   test/gate results (incl. the full e2e count), commit SHAs, push state (only what commands
   confirmed), blockers, defaults/assumptions taken, Phase 9 handoff location.
