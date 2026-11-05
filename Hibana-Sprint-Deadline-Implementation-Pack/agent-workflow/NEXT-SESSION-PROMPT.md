# Next Session Prompt — Phase 4: Sprint Management, Overview & Lifecycle (Sprints Page + Kanban Controls)

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S243** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ `da652d2`, Phase 3 = S242 @ **`a1e7d2d` on
`feat/sprint-deadline-deps`** — all final deliveries verified, all gates green; the Phase 3
round was the first with `public/` in scope: the sprint view filter on BOTH board surfaces,
the dropdown's emoji identity + completed-hidden-from-new-assignment, the ＋ New sprint
quick-create dialog, the card sprint identity row in both renderers, D2 closed).

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in the one-shot
push URL `git push https://<TOKEN>@github.com/assadigit/hibana-source.git <branch>`. All
other credentials (Cloudflare, Telegram bot, healthcheck.io, Workers AI, the test account)
are OUT OF SCOPE this phase: no deploy, no wrangler, no D1 workflow runs, no live probes, no
notifications. Do not use them; do not write them anywhere.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — esp. §4.2 emoji identity, §5 the lifecycle (§5.2 the one-active conflict modal, §5.3 finish + archive counts, §5.4 completed history non-deletable, §5.5 paused), §6 deletion with exact counts + the `Sprint: [name] (deleted)` snapshot, §7.3 the Sprints page = settings + tasks (keep the timeline), §7.4 the overview counts (five lanes + total only — no percentages), §8 assignment rules, §17 RTL/i18n)
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (**Screens E/F/G/H/I** — THIS phase's primary briefs: E the Sprints-page list/overview, F the sprint detail (Settings + Tasks tabs), G the Kanban compact overview, H the lifecycle confirmation modals (H1 the one-active conflict, H2 finish with archive counts, H3 pause), I the deletion confirmation with exact impact counts; Screens A/B/D are landed (Phase 3), C/J/K/L/M are Phases 5-7)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 4 scope)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (architecture map, D1–D9 register, assumptions 1-10 — assumption 7's S240 + assumption 9's S241 + assumption 10's S242 defaults are BINDING, esp. 10's quick-create due-parse and the embedded-board parity decision)
6. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12 on the feature branch — the COMPLETE Phase 1+2 API surface this UI consumes (esp. §12.1 the lifecycle endpoints + their exact error bodies, §12.5 the client-derived overview-counts decision)
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commits, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read it off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`.
If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the docs-only commit on top of `3bbf3c3`; if it moved,
   reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`a1e7d2d`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain. Branch pushes run CI only and
   can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca`) stays
   READ-ONLY until the Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **107 files / 855 tests green** (837 + 17 `sprint-ui-s242.test.ts` + 1
   kanban-parity extension). Fresh sandbox e2e note: `bunx playwright install
   chromium-headless-shell` (the pinned playwright build wants chromium_headless_shell-1248; the
   sandbox cache ships 1200).
5. Phase 4 needs ONLY the GitHub token, and ONLY for the one-shot authenticated push — never write
   it to disk, `.git/config`, files, commit bodies, or logs.

## Current phase: Phase 4 — Sprint management, overview, and lifecycle

Web repo, `public/` + `src/` in scope. **This phase adds NO deadline UI (Phase 5 — the sprint due
date stays the Phase 3 quick-create's minimal date input), NO dependency UI (Phase 7), NO new
endpoints or migrations (the whole surface landed in Phases 1-2).** The existing timeline
(sprint.html's draggable bands), the define popover, the sprint doc editor (S33/S34), the
quick-create dialog, the sprint view filter and the card identity from Phase 3 all stay
byte-compatible in behavior. Every new UI string ships EN + FA (`bun run check-i18n-parity`);
every touched `public/` file gets its `?v=` cache-bust bump (`bun run check-cache-bust`).

## The API surface this UI consumes (Phases 1+2, exact names — contract doc §12.1)

- **Lifecycle actions** (all POST, all `200 {ok}` on success):
  `POST /api/sprints/:id/start` (planned|paused → active; another sprint already active →
  **409 `{error:'sprint_active_exists', active_id}`** — NO auto-close; the H1 conflict modal
  resolves it); `POST /api/sprints/:id/pause` (active → paused ONLY, else 400 `invalid_input`);
  `POST /api/sprints/:id/resume` (paused → active, subject to the same one-active 409);
  `POST /api/sprints/:id/finish` (**200 `{ok, archived:n}`** — the additive archive count; archives
  ONLY this sprint's `status='done'` tasks; re-finish legal + archives newly-done);
  `POST /api/sprints/:id/reopen` (completed → active; isLatest guard → 400; one-active → 409).
- **DELETE `/api/sprints/:id`** — planned/paused only; active → **409 `{error:'sprint_active'}`**
  (pause/finish first); completed → **409 `{error:'sprint_completed'}`** (history is NOT
  deletable); tasks DETACH (`sprint_id=NULL`, never deleted); archived rows get
  `sprint_name_snapshot = "<name> (deleted)"` + `sprint_id=NULL` (AP-27 hygiene kept).
- **PATCH `/api/sprints/:id`** — `{name?, version?, description?, emoji?, due_at?, started_at?,
  ended_at?}`; rename uniqueness-checked (409 `duplicate`, self re-assert legal); `due_at` origin
  rules (null→value stamps `due_origin_at`, value→value preserves, explicit null clears both);
  every PATCH stamps `updated_at`.
- **The board payload** `GET /api/projects/:id/devboard` (seven keys) — sprints rows carry
  `status/emoji/due_at/due_origin_at/updated_at` + the legacy pair; tasks carry `sprint_id` +
  `status`. **Overview counts are CLIENT-DERIVED** (the S241 decision, contract §12.5:
  `count(tasks where sprint_id = S, group by status)` + total only — five lanes + total, NO
  percentages/analytics; NO `/sprints/:sid/overview` endpoint exists and none may be added
  without revisiting that recorded decision).
- **Client wrappers**: `window.HibanaBoard` (public/js/devboard.js) already exposes
  `startSprint/finishSprint/reopenSprint/deleteSprint/patchSprint/createSprint` — **`pause` and
  `resume` have NO client wrapper yet** (the endpoints are S240-new): add
  `pauseSprint`/`resumeSprint` wrappers beside the others. The shared `api()` helper now carries
  the `{error:'<code>'}` body on thrown errors as `err.code` (S242) — the 409 modals read
  `err.code === 'sprint_active_exists'` + `err.active_id` from it (extend the parse to carry the
  whole body if cheap).

## Where the UI lives today (verified line map at `a1e7d2d` — re-verify cheaply, it may drift)

- **Sprints page**: `public/sprint.html` + `public/js/sprint-page.js` (1486 lines). The TIMELINE
  (draggable day-grid bands, `renderTimeline`) + `renderDraft` (the draft card: Start `data-sp-draft-start`
  ~:533, Delete ~:556) + `renderFinishBtn` (~:604-622, the open sprint's Finish) +
  `renderSprintsList` (~:623+, `.sp-list-row` rows ~:659 — click opens the sprint DOC; the ⋯ row
  actions carry `data-sp-finish`/`data-sp-reopen` ~:922-955 + Delete ~:968) + the define popover
  (~:1117-1215, `sp-define-pop`: name/start/end dates + presets + the
  `db.sprintReplaceWarn` note when an active sibling exists). The page's Board link targets
  /kanban (:1467). **D5: this page gains the lifecycle-grouped list/overview + per-sprint
  settings/tasks — EXTEND it, keep the timeline (spec §7.3).**
- **Confirmations today**: `window.hibana.confirm(msg, {title, danger, confirmLabel})` — the S210
  design-system modal (plain text only). The H1/H2/I modals need RICHER content (counts, sprint
  identity, multiple actions) — build them as dedicated dialogs the S242 quick-create way
  (`.db-modal` overlay + `.db-modal-card`, `dir` follows locale, capture-phase Esc shield,
  z-layering above whatever is underneath).
- **Kanban toolbar**: `public/board.html` (`#db-sprint-link` → /sprint.html?project=) +
  `public/js/board-page.js` — the Phase 3 filter select (`data-db-filter-sprint`) is the natural
  anchor/neighbor for the compact overview entry (Screen G). The embedded board
  (`project-page.js`, `detail-helpers.ts` ~:443+ the `pd-board-head` with the «اسپرینت جدید» CTA
  `data-pd-new-sprint` + the Sprints link) is the second surface — decide its overview parity and
  record the decision (the Phase 3 precedent SHIPPED filter parity).
- **Counts sources**: the board payload (client fold) for lane counts + archive previews; the
  archives list `GET /api/projects/:id/archives` (lazy, existing) for the deleted-sprint preview's
  archived-with-sprint count. NO new endpoints.
- **i18n**: `public/js/i18n-en.js` / `i18n-fa.js` (existing sprint strings: `db.startSprint`,
  `db.finishSprint`, `db.reopenSprint`, `db.delSprintConfirm`, `db.sprintReplaceWarn`,
  `db.sprintName`, `db.sprintTotalTasks`, `db.sprintLog`… reuse where the copy fits; parity gate).
  RTL via `dir` + logical properties (the Phase 3 FA e2e is the pattern to extend).

## Tasks in required order (Phase 4)

1. **`pauseSprint`/`resumeSprint` client wrappers** in devboard.js (+ export on
   `window.HibanaBoard`), then the **lifecycle controls wiring**: Start/Resume/Pause/Finish/Reopen
   where they belong (the Sprints page rows/cards + the compact overview) — spec §7.2 keeps the
   day-to-day controls in the Kanban experience; the Sprints page owns settings + tasks. A paused
   sprint renders distinctly (spec §5.5; assumption 7: paused bands skip the sibling scan and
   don't block anything).
2. **The H1 one-active conflict modal** (spec §5.2 + Screen H1): start/resume hitting
   `409 sprint_active_exists` + `active_id` opens a modal titled "Another sprint is active"
   showing BOTH sprints' identity (emoji/glyph + name) with three explicit actions:
   **Pause <current> & Start <selected>**, **Finish <current> & Start <selected>**, **Cancel**.
   The finish arm shows the archive count BEFORE confirming (client-derived from the payload:
   the current sprint's `status='done'` task count). The transition is atomic from the user's
   perspective (pause → start; finish → start — sequential calls, and a lost race re-answers 409:
   surface it, never retry silently).
3. **The H2 finish confirmation** (spec §5.3 + Screen H2): "Finish sprint?" — sprint identity +
   the count of tasks in Implemented THAT WILL BE ARCHIVED (client-derived) + the count of
   unfinished tasks that stay put + "No tasks will be deleted." → confirm → `POST /finish` →
   toast with the server's additive `archived` count (the exact number, not the preview).
4. **The I delete confirmation** (spec §6 + Screen I): completed sprints are not deletable (the
   409 `sprint_completed` answers inline); active must pause/finish first (409 `sprint_active`
   surfaced); planned/paused delete through a modal with EXACT impact counts — total associated
   tasks, non-archived that become `No sprint`, archived that keep the
   `Sprint: <name> (deleted)` snapshot label (count from the archives list), and
   "No tasks will be deleted." Replace the current plain `db.delSprintConfirm` confirms on BOTH
   surfaces (the draft card + the row actions).
5. **The Sprints page extension (D5)** (Screens E/F): a lifecycle-grouped overview (Active,
   Planned, Paused, Completed history) of the project's sprints — each row/card: emoji/glyph +
   name, lifecycle badge, task count, due date when present (read-only this phase), an action to
   open **Settings** (name/version/description/emoji/due via PATCH — the S33/S34 sprint doc
   editor already owns the rich description; extend, don't duplicate) and **Tasks** (the sprint's
   tasks grouped by the five lanes + total — the §12.5 client fold). Completed history stays
   accessible and non-deletable. Keep the timeline; the list is an addition, not a replacement.
6. **The Kanban compact overview (Screen G)**: selecting/opening a sprint from the Kanban shows a
   compact panel — sprint identity + lifecycle state, the five lane counts + total (client fold),
   and the lifecycle actions the state permits (Start/Resume, Pause, Finish, Settings). Feeds
   from the loaded board payload — ZERO new fetches. Decide + record the embedded board's parity.
7. **i18n + RTL + cache-bust**: every new string in BOTH dictionaries (Persian copy written);
  RTL verified (extend the s242 FA e2e pattern); `?v=` bumps on every touched `public/` file +
  the sw.js SHELL ladder bump with the carrier note.
8. **Tests**: vitest (static source pins in the sprint-ui-* style + any server-twin changes in
   kanban-parity) and e2e: the lifecycle flows (start→active, pause→paused→resume, the H1
   conflict with both resolutions + cancel, finish with the archive-count toast + the
   unfinished-stay-put assertion, reopen, delete with the exact-count preview + the snapshot
   label check), the overview counts (a seeded sprint's five-lane fold + total), the completed
   history (non-deletable), FA/RTL. ALL existing tests stay green (baseline 107 files / 855;
   the s206/s242 quick-create + filter specs must not regress).

## Gate ladder (fix everything until green)

`bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries)
+ `bun run check-i18n-parity` + `bun run check-cache-bust` (both MATTER — public/ changes).
e2e: the sprint specs (`sprint-timeline`, `s206-sprint-fixes`, `sprint-ux`, `sprint-doc`,
`s209-kanban-parity`, `s242-sprint-ui`, `board-filters`) + your new specs (fresh sandbox:
`bunx playwright install chromium-headless-shell` first). Update `docs/autopilot/FN-ALLOWLIST.md`
pins if handlers move (the S237/S238/S242 tripwires pin the sw.js ladder — move them with you).

## Commit, push, deploy rules

One or two coherent commits on **`feat/sprint-deadline-deps` ONLY**, message style
`feat(ui): S243 <lowercase one-liner> — spec pack phase 4` with a body citing the discrepancy
items advanced (**D5 — closed by the Sprints page extension; D3's UI preview (the delete
modal's snapshot counts) — closed; D9 island re-pin deferred to Phase 9 by design**) + test
counts. Review the final diff for unrelated changes and secrets. Push: feature branch only,
one-shot token URL, never persist the token. A branch push runs CI only — it can NEVER deploy.
No merge to main, no PR yet, no `bun run deploy*`, no D1 workflow runs — deployment + D1 =
Phase 9. No desktop changes, no unrelated refactors, no new runtime deps. Keep new `hibanaFetch`
call sites minimal (prefer the shared `api()` wrapper — Phase 3 added ZERO) and list any you add
in the commit body for the Phase 9 re-pin inventory.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 4 checklist + session log with commit SHA + test results + new assumptions/decisions —
   esp. the overview mount-point + embedded-board parity decisions, the H1 modal's
   atomicity mechanics, the settings-editor integration with S33/S34, and any i18n/RTL judgment
   calls) and REPLACE this file's content with the fully populated **Phase 5 prompt** (Deadline
   engine and UI: the OFF-by-default `Due date (optional)` toggle in Add/Edit Task — spec §9.1,
   the personal-override semantics, the read-only `Using <sprint> sprint deadline · <date>` line
   while the toggle stays OFF; the shared Gregorian/Jalali date control (D6 — the segmented
   selector, the six presets Today/24h/48h/72h/This week/This month, `Add time (optional)`
   OFF by default, date-only = 23:59 LOCAL per spec §11.2 — supersedes the Phase 3 quick-create's
   interim UTC end-of-day parse, recorded in assumption 10; swap the control into the sprint
   quick-create + settings too); the card deadline row + the thin 4-6px progress bar under the
   description (Screen A order — the Phase 3 seam), elapsed-time semantics with the origin
   preservation (`effective_due_origin_at` from the payload — NEVER re-derive client-side), the
   Comfortable/Approaching/Urgent/Overdue thresholds (spec §12.3 — calendar-clock icon + wording,
   never color alone), completed-neutrality (spec §12.4 + §10.3 — gray + Done, no live countdown
   from completed sprints); the `effective_due_at`/`effective_due_source`/`effective_due_origin_at`
   triple is already server-computed on every task row — consume it, ship zero deadline logic
   client-side (spec §18); remember public/ changes need i18n EN+FA parity + `?v=` cache-bust
   bumps + the sw.js ladder + the S209 board-parity test).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to main (agent-workflow/*.md ONLY — `**.md` pushes are CI-skipped
   and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, UI delivered per task 1-8, exact test/gate results, commit SHAs,
   push state (only what commands confirmed), blockers, defaults/assumptions taken, Phase 5
   handoff location.
