# Next Session Prompt — Phase 3: Core Kanban + Task-Form UI (Sprint Integration)

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S242** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ **`da652d2` on `feat/sprint-deadline-deps`** — both final
deliveries verified, all gates green).

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in the one-shot
push URL `git push https://<TOKEN>@github.com/assadigit/hibana-source.git <branch>`. All
other credentials (Cloudflare, Telegram bot, healthcheck.io, Workers AI, the test account)
are OUT OF SCOPE this phase: no deploy, no wrangler, no D1 workflow runs, no live probes, no
notifications. Do not use them; do not write them anywhere.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — esp. §3 preserve the UI, §4.2 emoji identity, §7.1 create-sprint-from-modal, §7.5 sprint filtering, §8 assignment rules, §17 RTL/i18n)
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (**Screen A** board + card order, **Screen B** Add modal compact state, **Screen D** sprint dropdown + quick create — THIS phase's primary briefs; Screens C/E-J are Phases 4-7)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 3 scope)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (architecture map, D1–D9 register, assumptions 1-9 — assumption 7's S240 + assumption 9's S241 defaults are BINDING)
6. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12 on the feature branch — the COMPLETE Phase 1+2 API surface this UI consumes
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commits, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read it off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`.
If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the docs-only commit on top of `9dde797`; if it moved,
   reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`da652d2`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain. Branch pushes run CI only and
   can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca`) stays
   READ-ONLY until the Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **106 files / 837 tests green** (830 + the 7 S241 api-surface tests).
   Fresh sandbox e2e note: `bunx playwright install chromium-headless-shell` (the pinned
   playwright build wants chromium_headless_shell-1248; the sandbox cache ships 1200).
5. Phase 3 needs ONLY the GitHub token, and ONLY for the one-shot authenticated push — never write
   it to disk, `.git/config`, files, commit bodies, or logs.

## Current phase: Phase 3 — Core Kanban + task-form UI (sprint integration)

Web repo, `public/` is IN scope for the first time. **This phase adds NO lifecycle buttons
(start/pause/finish/reopen are Phase 4), NO deadline UI (Phase 5), NO dependency UI (Phase 7).**
The existing priority ribbon, card geometry, modal structure, and every unrelated control stay
byte-compatible in behavior. Every new UI string ships EN + FA (`bun run check-i18n-parity`);
every touched `public/` file gets its `?v=` cache-bust bump (`bun run check-cache-bust`).

## The API surface this UI consumes (Phases 1+2, exact names — contract doc §12)

- **Board payload** `GET /api/projects/:id/devboard` (seven keys): `tasks` rows carry
  `sprint_id`, raw `due_at`/`due_origin_at`, and the server-computed
  `effective_due_at`/`effective_due_source` (`'task'|'sprint'|null`)/`effective_due_origin_at`
  (Phase 5 reads these — do NOT re-derive client-side); `sprints` rows carry
  `status` (`planned|active|paused|completed`), `emoji` (nullable → default glyph), `due_at`,
  `due_origin_at`, `updated_at`; `task_deps` = flat `{blocker_task_id, blocked_task_id}` edges
  (Phase 7 reads these).
- **Sprint create** `POST /api/projects/:projectId/sprints` — body `{name?, emoji?, due_at?,
  version?, description?, started_at?, ended_at?}`; 201 `{ok,id,name,version,draft}`; a draft
  (no dates) is born `planned`; **409 `{error:'duplicate'}`** on a case-insensitive name clash
  (inline error — never silently rename); **409 `{error:'draft_exists'}`** when a draft already
  exists (one per project); `emoji` = one picker token ≤16 chars matching `EMOJI_TOKEN_RE`.
- **Sprint PATCH** `PATCH /api/sprints/:id` — `{name?, emoji?, due_at?, …}`; `due_at`
  null→value stamps `due_origin_at` server-side; explicit `null` clears.
- **Task create** `POST /api/projects/:projectId/devtasks` — `sprint_id: null` = No sprint
  (always legal); `sprint_id: <id>` must be a non-completed sprint (**400 `sprint_completed`**
  otherwise); `sprint_id` UNDEFINED = legacy draft/open auto-assign (old clients) — **the new
  modal must never send undefined (the D2 fix, below)**.
- **Task PATCH** `PATCH /api/devtasks/:id` — `sprint_id: null` detaches; moving to a completed
  sprint → 400 `sprint_completed`; re-asserting the task's CURRENT sprint is legal (old modal
  echo — keep the edit modal working for tasks in completed sprints).

## Where the UI lives today (verified line map — re-verify cheaply, it may drift)

- **Task modal** (Add+Edit shared): `public/js/devboard.js` `renderModal` ~:871-1307. The sprint
  select ALREADY EXISTS (~:942-946): `No sprint` + `state.sprints` options (with a `— draft` tag)
  + `＋ New sprint` (`__new`). The save path ~:1263-1300: `__new` currently reuses the project's
  existing draft or calls a nameless `createSprint()` (S206 fix — no prompt); **the create body at
  ~:1284 sends `sprint_id: sprintId || undefined` — THE D2 LINE**; the edit body at ~:1296 already
  sends `sprint_id: sprintId || null`.
- **Cards render in 3 places** (S209 "1:1 parity" contract, pinned by
  `src/tests/kanban-parity.test.ts`): client `public/js/board-page.js` ~:675-694, server twin
  `src/routes/projects/detail-helpers.ts` ~:501-514, shared helpers `public/js/chip-render.js`.
  Card markup changes must land in the client AND the server twin IDENTICALLY.
- **Toolbar** (search + priority filters): `public/board.html` + `board-page.js`; the embedded
  project-page board (`project-page.js`) is the second surface — check whether it carries the
  same toolbar before deciding its filter parity (record the decision).
- **i18n**: `public/js/i18n-en.js` / `i18n-fa.js` (parity gate); RTL via `document.dir='rtl'` +
  `public/css/rtl.css` loaded LAST. Default sprint glyph: check the existing SVG icon table
  (`src/lib/html.ts`) + the sprint page's icon usage — reuse, don't invent.

## Tasks in required order (Phase 3)

1. **D2 fix first (the one-line contract fix):** the modal's create path sends an EXPLICIT
   `sprint_id` — `sprintId ?? null` (never `undefined`). Edit mode already does. After this,
   "No sprint" really means No sprint for every new task from the new UI. Add a vitest pin if
   cheap (the server semantics are already pinned; this is a client change — an e2e assertion
   that a No-sprint create lands unassigned is the real pin).
2. **Sprint dropdown (Add/Edit Task):** `No sprint` at top; the project's sprints with
   emoji-or-default-glyph + name; **completed sprints are NOT new-assignment options** (spec §8,
   Screen D) — but a task ALREADY in a completed sprint keeps showing its current sprint as the
   selected value (historical association; PATCH re-assert stays legal). planned/active/paused all
   assignable (assumption 3). Keep the existing `＋ New sprint…` entry.
3. **Quick-create sprint modal** (replaces the silent nameless `__new` create): small dialog —
   required name; optional emoji picker (one token, the spark-folder/vault picker precedent);
   `Add description` toggle OFF by default (textarea only when on); `Set due date` toggle OFF by
   default (when on, a minimal date input for THIS phase — the sprint popover's `<input
   type="date">` precedent, sent as `due_at`; Phase 5 swaps in the shared Gregorian/Jalali
   control). POST on confirm; **409 `duplicate` → inline case-insensitive error, no silent
   rename**; 409 `draft_exists` → inline error (the existing draft is already in the dropdown);
   on success close + refresh dropdown + select the new sprint for the current task (spec §7.1).
4. **Sprint filter on the Kanban toolbar:** compact control, default **All tasks**; options =
   every project sprint (any lifecycle state — it's a VIEW filter: a completed sprint's
   unfinished tasks must stay findable) + **No sprint**; composes with the existing search +
   priority filters; filtering never mutates assignments or sprint state (spec §7.5, Screen A).
5. **Card sprint identity:** a compact row — sprint emoji (or the default glyph) + sprint name —
   ONLY when `sprint_id` is set; placed per Screen A's card order (after description, before the
   timestamp area — the deadline row that follows is Phase 5, leave the seam); land it in BOTH
   renderers (client + server twin) so `kanban-parity.test.ts` stays green. Lookup by id from the
   payload's `sprints` (a deleted sprint can't dangle — DELETE nulls task links server-side).
6. **i18n + RTL + cache-bust:** every new string in BOTH `i18n-en.js` and `i18n-fa.js` (Persian
   copy written, not machine-labeled); RTL layout verified for the filter + dropdown + modal
   (right-aligned FA labels, logical ordering); `?v=` bumps on every touched `public/` file.
7. **Tests:** extend/new vitest (parity + any server-twin changes) and add e2e coverage: the
   filter flow (All/No sprint/a named sprint × search+priority), the quick-create flow (name +
   emoji + duplicate 409 inline + auto-select), the D2 fix (create with No sprint → task lands
   unassigned), card sprint identity (emoji + name on cards, absent for unassigned), completed
   sprints hidden from new assignment but visible when already assigned. ALL existing tests stay
   green (baseline 106 files / 837).

## Gate ladder (fix everything until green)

`bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries)
+ `bun run check-i18n-parity` + `bun run check-cache-bust` (both now MATTER — public/ changed).
e2e: the sprint specs (`sprint-timeline`, `s206-sprint-fixes`, `sprint-ux`, `sprint-doc`) +
`s209-kanban-parity.spec.ts` + your new specs (fresh sandbox: `bunx playwright install
chromium-headless-shell` first). Update `docs/autopilot/FN-ALLOWLIST.md` pins if handlers move.

## Commit, push, deploy rules

One or two coherent commits on **`feat/sprint-deadline-deps` ONLY**, message style
`feat(ui): S242 <lowercase one-liner> — spec pack phase 3` with a body citing the discrepancy
items advanced (**D2 client fix — closed**; D9 island re-pin deferred to Phase 9 by design) +
test counts. Review the final diff for unrelated changes and secrets. Push: feature branch only,
one-shot token URL, never persist the token. A branch push runs CI only — it can NEVER deploy.
No merge to main, no PR yet, no `bun run deploy*`, no D1 workflow runs — deployment + D1 =
Phase 9. No desktop changes, no unrelated refactors, no new runtime deps. Note: web-side
`public/js` edits do NOT trip the desktop seam gates (the island is content-pinned at `04218ca`;
re-pin is Phase 9's round) — but keep new `hibanaFetch` call sites minimal and list any you add
in the commit body for the Phase 9 re-pin inventory.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 3 checklist + session log with commit SHA + test results + new assumptions/decisions —
   esp. the embedded-board filter parity decision, the quick-create due-control scope, and any
   i18n/RTL judgment calls) and REPLACE this file's content with the fully populated **Phase 4
   prompt** (Sprint management, overview, and lifecycle: Sprints page extension D5 — lifecycle-
   grouped list + settings/tasks + counts + completed history, Kanban compact overview fed by the
   client-derived counts [S241 decision, contract doc §12.5], start/resume/pause/finish/reopen
   controls, the one-active 409 `sprint_active_exists`+`active_id` conflict modal [finish/pause/
   cancel — spec §5.2], finish confirmation with exact archive counts from the additive `archived`
   response field, delete confirmation with the task-count preview + `"<name> (deleted)"`
   snapshot semantics — carry the exact endpoint/error names from Phases 1-2; remember public/
   changes need i18n EN+FA parity + `?v=` cache-bust bumps and the S209 board-parity test).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to main (agent-workflow/*.md ONLY — `**.md` pushes are CI-skipped
   and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, UI delivered per task 1-7, exact test/gate results, commit SHAs,
   push state (only what commands confirmed), blockers, defaults/assumptions taken, Phase 4
   handoff location.
