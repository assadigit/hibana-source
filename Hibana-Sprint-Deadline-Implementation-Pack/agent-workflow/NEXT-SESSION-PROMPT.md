# Next Session Prompt — Phase 5: Deadline Engine & UI (Task Deadline Toggle + Shared Date Control + Card Deadline Row/Bar)

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S244** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ `da652d2`, Phase 3 = S242 @ `a1e7d2d`, Phase 4 =
S243 @ **`b770258` on `feat/sprint-deadline-deps`** — all final deliveries verified, all
gates green; the Phase 4 round delivered the sprint lifecycle round: the pause/resume
wrappers + the H1/H2/H3/I confirmation dialogs, the Sprints-page lifecycle-grouped
extension with the Settings/Tasks detail panel (D5 closed), the compact Kanban overview
on BOTH board surfaces, the distinct paused render, and the archives list's additive
sprint identity).

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in the one-shot
push URL `git push https://<TOKEN>@github.com/assadigit/hibana-source.git <branch>`. All
other credentials (Cloudflare, Telegram bot, healthcheck.io, Workers AI, the test account)
are OUT OF SCOPE this phase: no deploy, no wrangler, no D1 workflow runs, no live probes, no
notifications. Do not use them; do not write them anywhere.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — esp. PART II the whole deadline system: §9 optional deadlines (§9.1 the task toggle), §10 inheritance + precedence (§10.1 the inherited read-only line, §10.2 personal overrides, §10.3 completed-sprint neutrality), §11 calendar/time/presets (§11.1 the Gregorian/Jalali selector, §11.2 date-only = 23:59 LOCAL, §11.3 the six presets, §11.4 timezone), §12 the progress indicator (§12.1 placement, §12.2 the elapsed-time calculation, §12.3 the Comfortable/Approaching/Urgent/Overdue thresholds, §12.4 completed-task neutrality), §13 extensions (Phase 6 — this phase only builds the §13.2 sprint-deadline + §13.3 personal-deadline setting paths extensions already exist as PATCH; the extension FLOWS are Phase 6), §17 RTL/i18n (the progress bar's time progression stays LTR even in RTL), §18 no forking, §24 the boundary tests (exactly 7 days, exactly 48h))
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (**Screens A/C/J** — THIS phase's primary briefs: A the main Kanban board's card states (the deadline row + the thin progress bar in the card order: below the description, above the timestamp — the Phase 3 seam documented in assumption 10), C the Add/Edit Task expanded personal-deadline state (the toggle + the revealed controls + the inherited read-only line), J the extension flows (J1/J2 are Phase 6 — read for the §13 semantics this phase must NOT pre-empt, esp. the origin preservation); Screens B/D/E/F/G/H/I are landed (Phases 3-4), K/L/M are Phases 6-7)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 5 scope)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (architecture map, D1–D9 register, assumptions 1-11 — assumption 9's S241 server-computed triple + assumption 10's S242 quick-create due-parse + assumption 11's S243 decisions are BINDING: esp. 10's "Phase 5 swaps in the shared Gregorian/Jalali control" which THIS phase executes, and 11's H1 day-window seam (the owner decision queued — do not touch /start's semantics without an owner ruling))
6. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12.2 + §12.4 on the feature branch — the effective-deadline triple's exact contract (§12.2: precedence, §10.3 neutrality, §5.5 paused inheritance, the origin coalescing) + the task endpoints' due_at origin rules (§12.4)
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commits, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read it off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`.
If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the docs-only commit on top of `153ed3f`; if it moved,
   reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`b770258`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain. Branch pushes run CI only and
   can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca`) stays
   READ-ONLY until the Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **108 files / 878 tests green** (855 + 23 `sprint-ui-s243.test.ts`).
   Fresh sandbox e2e note: `bunx playwright install chromium-headless-shell` (the pinned
   playwright build wants chromium_headless_shell-1248; the sandbox cache ships 1200).
5. Phase 5 needs ONLY the GitHub token, and ONLY for the one-shot authenticated push — never write
   it to disk, `.git/config`, files, commit bodies, or logs.

## Current phase: Phase 5 — Deadline engine and UI

Web repo, `public/` + `src/` in scope. **This phase adds NO extension FLOWS (Phase 6 — only the
§13 semantics that already exist as PATCH surface ride along), NO dependency UI (Phase 7), NO new
endpoints or migrations (the whole write surface landed in Phase 1: `dev_tasks.due_at` +
`due_origin_at` + the sprint pair with their origin rules; the effective triple is ALREADY
server-computed on every board-payload task row).** The Phase 3/4 UI all stays byte-compatible in
behavior: the quick-create + the sprint settings keep working (their due inputs get SWAPPED to the
new shared control this phase — the only sanctioned behavior change, superseding assumption 10's
interim UTC end-of-day parse), the lifecycle dialogs, the overview panels, the detail panel, the
timeline — all untouched except where the control swap reaches. Every new UI string ships EN + FA
(`bun run check-i18n-parity`); every touched `public/` file gets its `?v=` cache-bust bump
(`bun run check-cache-bust`).

## The data surface this UI consumes (Phases 1+2, exact names — contract doc §12.2)

- **Every task row in `GET /api/projects/:id/devboard` carries the computed triple**:
  `effective_due_at` (the resolved deadline instant, ISO or null), `effective_due_source`
  (`'task' | 'sprint' | null` — which level won), `effective_due_origin_at` (the progress START
  point for the WINNING level: task source → the task's `due_origin_at`; sprint source → the
  SPRINT's `due_origin_at`; coalesced to the winning `due_at` when a legacy row lacks its stamp).
  Precedence (spec §10): **personal > sprint-inherited-while-not-completed > none**; a completed
  sprint's due date is historically NEUTRAL (§10.3 — never an active countdown); a PAUSED sprint's
  deadline keeps inheriting (§5.5). **The client ships ZERO deadline-logic (spec §18): consume the
  triple, never re-derive.** The only client-side computation is RENDERING: classifying
  now-vs-`effective_due_at` per §12.3 for the threshold wording/color (the resolution itself is
  server-owned), and the elapsed-time bar from `effective_due_origin_at` (§12.2).
- **The write paths (already live, S240)**: `POST /api/projects/:id/devtasks` + `PATCH
  /api/devtasks/:id` accept `due_at` with the origin rules (null→value stamps `due_origin_at`,
  value→value PRESERVES it — an extension is not a re-assignment, null CLEARS both); a sprint's
  `due_at` rides `POST /api/projects/:id/sprints` + `PATCH /api/sprints/:id` with the same rules.
  Explicit `due_at: null` on the task PATCH = the toggle-off removal (back to inheritance);
  `undefined` = untouched. The modal's save body (S242's explicit-sprint_id pattern) carries
  `due_at` explicitly when the toggle is ON, and `null` when a personal deadline is being removed.
- **Sprint rows carry `due_at`/`due_origin_at`** (the quick-create + settings + the inherited
  line read them; the sprint payload rows land in `state.sprints` + `pdSprintTruth`).
- **The S242 quick-create precedent gets SUPERSEDED**: `new Date(val + 'T23:59:59Z')` (UTC
  end-of-day) becomes the shared control's LOCAL 23:59 resolution (spec §11.2) — the ~3.5h
  Tehran delta recorded in assumption 10 was the accepted interim; this phase closes it.
  Record the supersession in the status doc's session log.

## Where the UI lives today (verified line map at `b770258` — re-verify cheaply, it may drift)

- **The task modal** (devboard.js `renderModal` ~:871-1307 region; the S242 quick-create sits after
  it): the sprint select + the S242 quick-create dialog (`data-sq-due` — the interim `<input
  type="date">` to supersede) + the footer save (the create body's explicit `sprint_id` — the
  `due_at` key joins the same body shape). **The Due date (optional) toggle mounts with the
  status/priority/category/sprint field group (Screen C): OFF by default, revealing the shared
  control + the read-only inherited line when ON. In EDIT mode with a saved personal deadline the
  toggle is ON + the control carries the saved value; turning it OFF removes the override
  (explicit `due_at: null` — back to inheritance).**
- **The card renderers (the Phase 3 seam, documented in assumption 10)**: `board-page.js`
  `sprintRowHtml` (~:670 — `const sprintRowHtml = sprint ? '<span class="db-sprint-badge">…'`) and
  the server twin `detail-helpers.ts` `sprintBadgeHtml` (~:262-269) — the S209 byte-identical
  parity contract (enforced by `src/tests/kanban-parity.test.ts`). **The deadline row + the thin
  4-6px progress bar slot between the sprint row and the tags/meta area (Screen A's card order:
  description/preview → read-more → SPRINT ROW → DEADLINE ROW + BAR → tags → meta)** — extend
  BOTH renderers identically + the kanban-parity pins.
- **The shared date infrastructure**: `public/vendor/jalaali.min.js` + `public/js/jalali.js`
  (`window.__hibJalali`) + the in-page port in `calendar-page.js`; `src/lib/jalali.ts` is the
  server twin (storage is Gregorian UTC; conversion at the render edge). **NO shared date-picker
  component exists (D6) — this phase BUILDS it**: a compact control with the Gregorian/Jalali
  segmented selector, the six presets (Today / 24h / 48h / 72h / This week / This month), the
  `Add time (optional)` toggle OFF by default, date-only resolving to LOCAL 23:59 (§11.2).
  Build it ONCE in shared client code (devboard.js or a new module tagged on every consuming
  page), mount it in the task modal + the sprint quick-create + the sprint settings panel
  (the S243 `sp-detail-due` read-only line becomes the control when editing a sprint's due).
- **The read-only task view** (S238, board-page.js/focus-core.js): the view's meta rows join the
  deadline display (the same row grammar).
- **i18n**: `public/js/i18n-en.js` / `i18n-fa.js` (existing keys: `db.sq.setDue` reuse where the
  copy fits; the S243 block ends the db.* sprint section — add the deadline keys beside it;
  parity gate). RTL via `dir` + logical properties; **the progress bar's time progression stays
  left-to-right even in RTL (spec §17)** — a explicit exception, test it in the FA round.

## Tasks in required order (Phase 5)

1. **The shared Gregorian/Jalali date control (D6)**: the segmented calendar selector
   (Gregorian | Jalali — the user's `calendar_pref` picks the default), the six presets with the
   EXACT §11.3 semantics (Today = today LOCAL 23:59; 24h/48h/72h = now + N hours; This week =
   the calendar week's end LOCAL 23:59; This month = the calendar month's end LOCAL 23:59 —
   Jalali calendar when selected), `Add time (optional)` OFF by default (an HH:MM input; OFF
   with a date picked = LOCAL 23:59 per §11.2), the value contract = ISO-8601 UTC instant
   (storage unchanged). Swap it into the sprint quick-create (`data-sq-due`) + the sprint
   settings panel — superseding the S242/S206 UTC-parse interim (record it).
2. **The Add/Edit Task `Due date (optional)` toggle — OFF by default (spec §9.1)**: hidden
   controls until ON; the read-only inherited line `Using <sprint> sprint deadline · <date>`
   renders while the toggle is OFF AND the task's `effective_due_source === 'sprint'`
   (spec §10.1 — computed by the server; the modal reads the payload row it is editing);
   toggling ON = a personal override (the shared control + Save sends `due_at`); toggling OFF
   on an edited task with a personal deadline = removal (explicit `due_at: null` — the server's
   origin rules clear `due_at`+`due_origin_at` and inheritance resumes). The create body joins
   the S242 explicit-key contract.
3. **The card deadline row + the thin progress bar (Screen A order — the Phase 3 seam)**:
   the row = a calendar-clock icon + the formatted date (Gregorian/Jalali per locale) + the
   §12.3 threshold wording (Comfortable / Approaching / Urgent / Overdue — **the WORD carries
   the meaning, never color alone**); the bar = 4-6px thin, the ELAPSED-TIME fill from
   `effective_due_origin_at` → `effective_due_at` (§12.2 — the elapsed ratio, NOT completion),
   clamped 0-100%, LTR progression even in RTL (§17). **`effective_due_origin_at` comes from
   the payload — NEVER re-derive client-side** (no now-minus-X heuristics; a null origin with
   a present deadline coalesces server-side already). No row + no bar when the triple is null.
   Both renderers byte-identical (extend `kanban-parity.test.ts`).
4. **The threshold rendering (spec §12.3) + completed-neutrality (§12.4 + §10.3)**: the client
   classifies `now` vs `effective_due_at` for the four states (the exact boundaries in §12.3 —
   read them from the spec; test at the exact boundaries: exactly 7 days, exactly 48h per §24).
   **A completed TASK ('done') renders neutral gray + a Done indication — no live countdown,
   no urgency wording** (§12.4); **a task inheriting from a COMPLETED sprint never counts down**
   (the server's §10.3 already nulls the triple — the client just renders null; the read-only
   inherited line in the modal only shows for a NON-completed sprint's inheritance).
   The paused sprint's deadline keeps inheriting (§5.5 — server-side; pin it with a test).
5. **i18n + RTL + cache-bust**: every new string in BOTH dictionaries (written Persian — the
   threshold wordings, the toggle labels, the inherited line, the presets); RTL verified (extend
   the s243 FA e2e pattern — incl. the LTR bar exception); `?v=` bumps on every touched
   `public/` file + the sw.js SHELL ladder bump with the carrier note (move the s237/s238 +
   s243 ladder tripwire pins with you).
6. **Tests**: vitest (static source pins in the sprint-ui-* style — the toggle OFF-by-default,
   the explicit-null removal, the triple-consumption (NO re-derivation: assert the renderers read
   `effective_due_*` and the bar reads `effective_due_origin_at`), the LTR-bar-in-RTL rule, the
   parity extension) and e2e: the toggle flow (OFF default → ON sets an override → the row +
   bar render → OFF removes → back to inheritance), the inherited read-only line (a sprint due
   with the toggle OFF), the personal-over-sprint precedence (both set → the task's own wins),
   completed-neutrality (a done task renders gray/Done; a completed sprint's task renders no
   countdown), the paused-sprint inheritance, the thresholds at the exact boundaries (7d/48h),
   the quick-create + settings control swap (LOCAL 23:59 — assert the stored instant vs the
   picked LOCAL day), the Jalali selector round, FA/RTL. ALL existing tests stay green
   (baseline 108 files / 878; the s206/s242/s243 specs must not regress — the due-input swap
   touches the s242 quick-create spec: adapt with an in-file citation if the interim parse pin
   moves, intent preserved).

## Gate ladder (fix everything until green)

`bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries)
+ `bun run check-i18n-parity` + `bun run check-cache-bust` (both MATTER — public/ changes).
e2e: the sprint specs (`sprint-timeline`, `s206-sprint-fixes`, `sprint-ux`, `sprint-doc`,
`s209-kanban-parity`, `s242-sprint-ui`, `s243-sprint-lifecycle`, `board-filters`) + your new
specs (fresh sandbox: `bunx playwright install chromium-headless-shell` first). Update
`docs/autopilot/FN-ALLOWLIST.md` pins if handlers move (the s237/s238/s243 tripwires pin the
sw.js ladder — move them with you).

## Commit, push, deploy rules

One or two coherent commits on **`feat/sprint-deadline-deps` ONLY**, message style
`feat(ui): S244 <lowercase one-liner> — spec pack phase 5` with a body citing the discrepancy
items advanced (**D6 CLOSED by the shared date control; the assumption-10 interim parse
SUPERSEDED (the local-23:59 resolution); assumption 11's H1 day-window seam UNTOUCHED — the
queued owner decision stays open**) + test counts. Review the final diff for unrelated
changes and secrets. Push: feature branch only, one-shot token URL, never persist the
token. A branch push runs CI only — it can NEVER deploy. No merge to main, no PR yet, no
`bun run deploy*`, no D1 workflow runs — deployment + D1 = Phase 9. No desktop changes, no
unrelated refactors, no new runtime deps. Keep new `hibanaFetch` call sites minimal (prefer
the shared `api()` wrapper — Phases 3+4 added ZERO) and list any you add in the commit body
for the Phase 9 re-pin inventory.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 5 checklist + session log with commit SHA + test results + new assumptions/decisions —
   esp. the D6 control's architecture (where it lives, its value contract, the preset
   semantics), the toggle's explicit-null removal contract, the threshold-rendering decision
   (client-side classification of the server-resolved triple), the LTR-bar-in-RTL handling,
   and any i18n/Jalali judgment calls) and REPLACE this file's content with the fully
   populated **Phase 6 prompt** (Deadline extension flows: the §13 semantics — J1 the sprint
   deadline extension (sprint-wide: PATCH `due_at` with the value→value origin preservation —
   every inheriting task follows, personal overrides untouched), J2 the personal task
  deadline extension (task-only: the six add-time presets +24h/+48h/+72h/+1w/+custom from the
   EXISTING deadline, origin preserved), J3 the inherited-deadline extension choice
   (sprint-wide vs task-only when extending an inherited deadline — the modal that asks),
   the impact previews (how many tasks follow), the origin-preservation invariants across
   all three flows (spec §13.4 + assumption 1), the extension UI anchors (the card row's
   affordance, the task view, the sprint settings/overview), the Phase 6 tests incl. the
   origin-preservation pins; remember public/ changes need i18n EN+FA parity + `?v=`
   cache-bust bumps + the sw.js ladder + the parity test).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to main (agent-workflow/*.md ONLY — `**.md` pushes are CI-skipped
   and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, UI delivered per task 1-6, exact test/gate results, commit SHAs,
   push state (only what commands confirmed), blockers, defaults/assumptions taken, Phase 6
   handoff location.
