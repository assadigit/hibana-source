# Next Session Prompt — Phase 7: Task Dependencies UI (Screens K + L — the Collapsed Section, the Searchable Blocked-by Multi-Select, the Derived Blocks Badges, the Soft Constraints)

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S246** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ `da652d2`, Phase 3 = S242 @ `a1e7d2d`, Phase 4 =
S243 @ `b770258` + the S243b reconciliation @ `3ae6ae9`, Phase 5 = S244 @ `7a6bd4a`,
Phase 6 = **S245 @ `f1ca773`** — all final deliveries verified, all gates green; the
Phase 6 round delivered the deadline EXTENSION flows: J1 the sprint-wide dialog (the
+24/+48/+72 presets ADD TO THE EXISTING deadline, the before-confirmation impact
counts, the origin preserved), J2 the personal picker, J3 the inherited CHOICE modal
with the §13.4 origin preservation through the ADDITIVE `due_origin_at` ride-along on
the task PATCH (honored server-side ONLY on a null→value transition — status doc
assumption 13), the card-row/popover/overview/settings/modal anchors on every
surface, and the S48p window.prompt extend RETIRED). If ANOTHER session appears
mid-work: reconcile per the never-overwrite rule — adopt the verified push, never
force-push, never stack a conflicting twin.

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in the one-shot
push URL `git push https://<TOKEN>@github.com/assadigit/hibana-source.git <branch>`. All
other credentials (Cloudflare, Telegram bot, healthcheck.io, Workers AI, the test account)
are OUT OF SCOPE this phase: no deploy, no wrangler, no D1 workflow runs, no live probes, no
notifications. Do not use them; do not write them anywhere.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — **§14–§16 dependencies is THIS phase's core**: §14 the relationship model (14.1 same-project only; 14.2 many-to-many — a task can have multiple blockers AND block multiple tasks), §15 the dependency controls (the `Blocked by` input the USER enters; the reverse `Blocks` information DERIVED automatically — never a second input; self-links and cycles prevented), §16 the dependency indicators (compact Blocked / Blocks N card badges ONLY when relevant; 16.1 workflow enforcement — completing a blocker resolves its blocking effect; a task with multiple blockers stays blocked until ALL are complete; dependencies NEVER alter priority, sprint membership, deadline, or Kanban status — assumption 2's soft constraints); also re-read §22's dependency acceptance rows + §23's full checklist, §17 RTL/i18n, §18 no forking, §24's regression rows)
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (**Screens K + L are THIS phase's brief** — K the collapsed Dependencies section in Add/Edit Task (collapsed by default; expanded = the searchable multi-select listing same-project tasks with title + sprint + status; self/cycle prevention surfacing the 400/409 codes inline), L the task dependency card states (the compact Blocked / Blocks N badges — independent of priority ribbon AND deadline); Screens A–J are landed (Phases 3–6), M's variants 6/7 show how the badges read beside the deadline row, N is RTL)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 7 scope)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (architecture map, D1–D9 register, assumptions 1-13 — **assumption 2 (dependencies are SOFT — indicators only, never block Kanban movement or mutate priority/status) and assumption 13 (S245's ride-along + the extension stack's exports) are BINDING**; assumption 11's H1 day-window seam stays queued — do not touch /start's semantics without an owner ruling)
6. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12.3 (the deps WRITE surface — POST `/api/devtasks/:id/deps` `{blocker_id}` → 201/200-idempotent, self/cross-project → 400 `invalid_input`, cycle → 409 `cycle`; DELETE `/api/devtasks/:id/deps/:blockerId` → 200 always) + §12.3's READ surface (the payload's 7th key `task_deps` — the flat edge join `{blocker_task_id, blocked_task_id}`; *Blocked-by* = edges where `blocked_task_id = X`; the reverse *Blocks N* counts = the same fold's other half — **derived, NEVER a separate endpoint or stored column — spec §15**) + §12.5 (the client-fold doctrine) on the feature branch
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commits, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read it off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`.
If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the latest docs-only commit (the S245 close-out on top of
   `505c1e3`); if it moved, reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`f1ca773`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain. Branch pushes run CI only and
   can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca`) stays
   READ-ONLY until the Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **110 files / 935 tests green** (909 + 26 `sprint-ui-s245.test.ts`).
   Fresh sandbox e2e note: `bunx playwright install chromium-headless-shell` (the pinned playwright
   build wants chromium_headless_shell-1248; the sandbox cache ships 1200).
5. Phase 7 needs ONLY the GitHub token, and ONLY for the one-shot authenticated push — never write
   it to disk, `.git/config`, files, commit bodies, or logs.

## Current phase: Phase 7 — Task dependencies UI

Web repo, `public/` + `src/` in scope. **This phase adds NO new endpoints, NO migrations, NO new
write surface — the whole dependency mechanics already exist** (contract §12.3: the S240
`dev_task_deps` table + the deps endpoints with self/cross-project 400s + the recursive-CTE
cycle 409 + CASCADE deletes; the S241 payload's `task_deps` 7th key rides every board pull).
What Phase 7 BUILDS is the UI + the folds:

- **K — the Dependencies section in Add/Edit Task** (devboard.js's `renderModal`): a COLLAPSED
  section (Screen K — spec §15: "optional and collapsed by default" — the S244 due-toggle's
  grammar: a compact toggle/section header, hidden controls while collapsed). Expanded reveals
  the SEARCHABLE `Blocked by` multi-select of SAME-PROJECT tasks (the loaded payload's
  `state.tasks` — title + sprint identity + status per option; search filters by title; the
  current blockers pre-selected). Selecting/deselecting rides the EXISTING endpoints at Save
  (or immediately — decide + record: the modal's other fields batch at Save; the tag chips
  mutate live. RECOMMENDED: mutate LIVE through `api()` — POST on select, DELETE on deselect —
  so the 400/409 errors surface INLINE at the moment of the bad pick, and the modal never
  carries a dep-diff to reconcile; record the decision either way).
- **The inline error surface**: self-link → the 400 `invalid_input` answer inline ("a task
  cannot block itself"); cross-project is impossible by construction (the list is same-project);
  cycle → the 409 `cycle` answer inline with the offending pick named — never a generic toast.
- **L — the compact card badges**: `Blocked` (this task has ≥1 incomplete blocker), `Blocks N`
  (this task blocks N other tasks — the derived reverse fold), and `Ready` (had blockers, all
  now complete — 16.1's resolution surfacing; decide + record whether Ready shows while any
  blocker list exists vs only on the transition). Placement: the Phase 3 seam family — the
  sprint row + the deadline row already stack; the dep badges join as their own compact row
  (Screen M variants 6/7) in ALL THREE renderers (board-page.js + detail-helpers.ts server
  twin + project-page.js repaint twin — byte-identical, kanban-parity-pinned). Independent of
  the priority ribbon AND the deadline display (spec §23: "the priority ribbon remains
  unchanged"; dependencies never alter priority/status).
- **The completing-a-blocker resolution** (§16.1): when a blocker task moves to
  done/Implemented, every task it blocks re-renders its badge (Blocked → Ready/Blocks-count
  adjust). The folds are CLIENT-side over the payload (the §12.5 doctrine): *Blocked-by* =
  the `task_deps` edges where `blocked_task_id = X` joined against the task rows for their
  completion status; *Blocks N* = the other half of the same fold. NEVER a new endpoint
  (spec §15's derived-reverse rule + the S241 recorded decision).
- **The soft constraints** (assumption 2, spec §16.1): the badges are INDICATORS ONLY —
  they never block Kanban movement (a Blocked task can still drag to done), never mutate
  priority/status/sprint/deadline, never gate the editor.
- **The embedded board's twin** (project.html): `pdTaskTruth` gains the dep fold inputs it
  needs (the task_deps edges are in the `/api/projects/:id` detail pool? CHECK: §12.3 says
  the BOARD payload carries task_deps; the detail pool's shape is pinned by the S241 island
  test — if the detail pool lacks task_deps, the embedded badges fold from the board payload
  pull OR the server render folds server-side through the same helper — decide + record,
  additive-only, island-transparent).

## Tasks in required order (Phase 7)

1. **The shared dep-fold stack** (devboard.js — exported like the S244/S245 stacks):
   `depsOf(taskId, edges)` → the Blocked-by rows; `blocksCount(taskId, edges)` → the reverse
   count; `blockedStateOf(taskId, edges, taskRows)` → 'blocked' | 'ready' | null (ready =
   blockers existed and ALL are complete); `depBadgeHtml(task, edges, taskRows, lang)` → the
   compact badge row ('' when no deps). Both surfaces + the server twin consume THESE.
2. **K — the collapsed Dependencies section in the modal** (Screen K): collapsed by default,
   the searchable same-project multi-select (title + sprint + status per option), the live
   POST/DELETE through the existing endpoints (or the Save-batched diff — the recorded
   decision), the inline 400/409 surfaces.
3. **L — the card badges in all three renderers** + the task view's row-only twin.
4. **The resolution flow**: completing a blocker re-renders the badges (the reload/repaint
   paths already re-fold; verify + pin the done-transition case e2e).
5. **i18n + RTL + cache-bust**: every new string in BOTH dictionaries (written Persian);
   the FA e2e pattern extends (the badges + the modal section localize + mirror); `?v=`
   bumps + the sw.js ladder (move the s237/s238/s242/s243/s244/s245 tripwire pins with you).
6. **Tests**: vitest (the sprint-ui-s246 style — the fold correctness incl. the derived
   reverse; the cycle/self inline surfaces; the soft-constraint pin: a blocked task still
   moves; the parity extension for the badge row's three renderers; i18n parity; the seam
   tripwires — ZERO new fetch sites expected, the deps ride the existing endpoints through
   the shared `api()` wrapper) and e2e: the cross-sprint link case (two tasks in DIFFERENT
   sprints, same project — linkable), the multi-blocker case (A blocked by B+C; B done →
   still Blocked; C done → Ready), the resolution case, the cycle rejection inline (A→B→A),
   the self rejection inline, the FA/RTL round. ALL existing tests stay green (baseline
   110 files / 935; the s242/s243/s244/s245 specs must not regress — adapt with in-file
   citations if a pin moves, intent preserved).

## Gate ladder (fix everything until green)

`bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries)
+ `bun run check-i18n-parity` + `bun run check-cache-bust` (both MATTER — public/ changes).
e2e: the sprint specs (`sprint-timeline`, `s206-sprint-fixes`, `sprint-ux`, `sprint-doc`,
`s209-kanban-parity`, `s242-sprint-ui`, `s243-sprint-lifecycle`, `s244-deadline-ui`,
`s245-extend-flows`, `board-filters`) + your new specs (fresh sandbox: `bunx playwright install
chromium-headless-shell` first). Update `docs/autopilot/FN-ALLOWLIST.md` pins if handlers move
(the s237/s238/s242/s243/s244/s245 tripwires pin the sw.js ladder — move them with you).

## Commit, push, deploy rules

One or two coherent commits on **`feat/sprint-deadline-deps` ONLY**, message style
`feat(ui): S246 <lowercase one-liner> — spec pack phase 7` with a body citing the discrepancy
items advanced (**the K-section's live-vs-batched mutation decision + the embedded-board's
dep-fold source decision, whichever you landed; assumption 11's H1 day-window seam UNTOUCHED —
the queued owner decision stays open**) + test counts. Review the final diff for unrelated
changes and secrets. Push: feature branch only, one-shot token URL, never persist the token.
A branch push runs CI only — it can NEVER deploy. No merge to main, no PR yet, no
`bun run deploy*`, no D1 workflow runs — deployment + D1 = Phase 9. No desktop changes, no
unrelated refactors, no new runtime deps. Keep new `hibanaFetch` call sites minimal (prefer
the shared `api()` wrapper — Phases 3+4+5+6 added ZERO; the deps POST/DELETE should add ZERO
too — they ride `api()` directly or a `addTaskDep`/`removeTaskDep` wrapper pair like
`patchTask`) and list any you add in the commit body for the Phase 9 re-pin inventory.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 7 checklist + session log with commit SHA + test results + new assumptions/decisions —
   esp. the K-section mutation decision, the embedded fold source, the Ready-badge semantics)
   and REPLACE this file's content with the fully populated **Phase 8 prompt** (Cross-platform
   QA + regression + localization + accessibility: the full-spec sweep — every acceptance
   checklist row in §21/§22/§23/§24 turned into a test or a verified pin; threshold boundary
   tests at exactly 7d/48h; the RTL + Gregorian/Jalali consistency checks; the
   existing-tasks-with-no-sprint/deadline/deps regression; the a11y pass over every new
   dialog/badge; the full e2e suite run — remember public/ changes need i18n EN+FA parity +
   `?v=` cache-bust bumps + the sw.js ladder + the parity tests).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to main (agent-workflow/*.md ONLY — `**.md` pushes are CI-skipped
   and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, UI delivered per task 1-6, exact test/gate results, commit SHAs,
   push state (only what commands confirmed), blockers, defaults/assumptions taken, Phase 8
   handoff location.
