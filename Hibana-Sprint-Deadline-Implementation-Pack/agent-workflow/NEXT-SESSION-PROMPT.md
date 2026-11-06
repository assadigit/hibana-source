# Next Session Prompt — Phase 6: Deadline Extension Flows (J1 Sprint-Wide + J2 Personal + J3 The Inherited Choice + Impact Previews + Origin Preservation)

Continue Hibana Sprint, Deadline & Dependency implementation.

**This session is S245** in the repo's commit-numbering sequence (Phase 0 = S239, Phase 1 =
S240 @ `81f2c05`, Phase 2 = S241 @ `da652d2`, Phase 3 = S242 @ `a1e7d2d`, Phase 4 =
S243 @ `b770258` + the S243b reconciliation @ `3ae6ae9`, Phase 5 = **S244 @
`7a6bd4a`** — all final deliveries verified, all gates green; the Phase 5 round
delivered the deadline engine + UI: the shared Gregorian/Jalali date control
(`public/js/due-control.js` — D6 CLOSED), the task-modal Due date (optional)
toggle with the inherited read-only line + the explicit-null removal, the card
deadline row + the thin LTR elapsed-time bar in three renderers (board-page.js +
the detail-helpers.ts server twin + the project-page.js repaint twin), and the
quick-create/sprint-settings control swap — assumption 10's UTC interim parse
SUPERSEDED by LOCAL 23:59, recorded in the status doc's assumption 12). If
ANOTHER session appears mid-work: reconcile per the never-overwrite rule — adopt
the verified push, never force-push, never stack a conflicting twin.

## Kickoff credentials (pasted by the user — never persist, never commit, never log)

GitHub classic token (push-only): pasted in the kickoff message. Use it ONLY in the one-shot
push URL `git push https://<TOKEN>@github.com/assadigit/hibana-source.git <branch>`. All
other credentials (Cloudflare, Telegram bot, healthcheck.io, Workers AI, the test account)
are OUT OF SCOPE this phase: no deploy, no wrangler, no D1 workflow runs, no live probes, no
notifications. Do not use them; do not write them anywhere.

## Read first (in this order)

1. `Hibana-Sprint-Deadline-Implementation-Pack/README.md`
2. `Hibana-Sprint-Deadline-Implementation-Pack/specs/Hibana-Sprint-and-Deadline-System-Spec.md` (the contract — **§13 extensions is THIS phase's core**: §13.1 the extension choices (+24h/+48h/+72h/Custom date — presets add to the EXISTING deadline, never to the current moment), §13.2 the sprint-deadline extension (sprint-wide: every inheriting task follows; personal overrides untouched; the affected/protected counts BEFORE confirmation; the origin NOT reset), §13.3 the personal task-deadline extension (task-only: other tasks unaffected; origin preserved), §13.4 the inherited-deadline extension choice (the modal that asks: Extend sprint deadline — sprint-wide — vs Extend this task only — a personal override based on the current inherited deadline + the extension, origin preserved); also re-read §12.2 (the origin semantics — "Extending or editing the deadline must not reset the original progress start point"; "Removing a deadline and later assigning a completely new deadline starts a new progress timeline"), §10 (the precedence the flows must respect), §17 RTL/i18n, §18 no forking, §22's extension acceptance rows)
3. `Hibana-Sprint-Deadline-Implementation-Pack/VISUAL-REFERENCE-GUIDE.md` (**Screen J is THIS phase's primary brief** — J1 the sprint deadline extension (sprint name/emoji, current deadline + remaining-time label, the four choices, the inheriting/protected counts BEFORE applying, origin not reset), J2 the personal task deadline extension (task title, current personal deadline, the same four options, "only this task changes"), J3 the inherited-task extension (the TWO clearly distinct paths with visible scope before confirmation — never a silent sprint change when the user intends task-only); Screens A/B/C/D/E/F/G/H/I are landed (Phases 3-5), K/L are Phase 7, M is Phases 6-7 — M's variants 3/4/8/9 show how the extended cards read)
4. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/PHASED-MULTI-SESSION-IMPLEMENTATION.md` (§5 Phase 6 scope)
5. `Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md` (architecture map, D1–D9 register, assumptions 1-12 — **assumption 1 (the inherited progress origin + task-only extension preserving it) and assumption 12 (S244's control architecture, the threshold rendering decision, the LTR bar, the modal's inherited-line reads, the detail-pool triple) are BINDING**; assumption 11's H1 day-window seam stays queued — do not touch /start's semantics without an owner ruling)
6. `docs/project-kanban/API-AND-SYNC-CONTRACT.md` §12.1 + §12.2 + §12.4 on the feature branch — the write surface this phase rides: PATCH `/api/sprints/:id` + PATCH `/api/devtasks/:id` both accept `due_at` with the SAME origin rules (null→value stamps `due_origin_at`, **value→value PRESERVES it — an extension is not a re-assignment**, value→null clears both) — the extension flows are pure PATCH orchestration over the existing surface; §12.2's S244 addition (the detail pool's additive triple)
7. this file

Where these docs live: the pack's `agent-workflow/*.md` docs are committed on **`origin/main`**
(docs-only commits, `**.md` pushes are CI-skipped so they cannot deploy). The feature branch
`feat/sprint-deadline-deps` does NOT carry the pack — read it off main, e.g.
`git show origin/main:Hibana-Sprint-Deadline-Implementation-Pack/agent-workflow/IMPLEMENTATION-STATUS.md`.
If the user re-pastes the pack, prefer the repo copy.

## Setup & re-verification (in order)

1. Clone the repo (public — no token for clone). `cd <repo> && git status && git log --oneline -5
   && git branch --show-current`. Confirm no other agent is mid-work; preserve unrelated/uncommitted
   changes. `origin/main` HEAD must be the latest docs-only commit (the S244 close-out on top of
   `599a70a`); if it moved, reconcile — never overwrite concurrent work.
2. Checkout the feature branch: `git checkout feat/sprint-deadline-deps && git pull` — HEAD must be
   **`7a6bd4a`** (or its descendant), clean tree. **NEVER commit non-docs code to `main`** — pushes
   to main auto-deploy to production hibana.ir via the CI→CD chain. Branch pushes run CI only and
   can NEVER deploy.
3. Desktop repo (`assadigit/hibana-desktop`, `main` @ `9d53e64`, island pin `04218ca`) stays
   READ-ONLY until the Phase 9 round. This phase touches the WEB repo only.
4. Baseline BEFORE any edit (record exact commands + results): `bun install` (bun 1.3.14, node ≥ 24),
   then `bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape →
   boundaries). Expected: **109 files / 909 tests green** (878 + 28 `sprint-ui-s244.test.ts` + 3
   kanban-parity extensions). Fresh sandbox e2e note: `bunx playwright install
   chromium-headless-shell` (the pinned playwright build wants chromium_headless_shell-1248; the
   sandbox cache ships 1200).
5. Phase 6 needs ONLY the GitHub token, and ONLY for the one-shot authenticated push — never write
   it to disk, `.git/config`, files, commit bodies, or logs.

## Current phase: Phase 6 — Deadline extension flows

Web repo, `public/` + `src/` in scope. **This phase adds NO new endpoints, NO migrations, NO new
write surface — the whole extension mechanics already exist as PATCH orchestration** (contract
§12.1/§12.4: PATCH `/api/sprints/:id` `{due_at: <new>}` = the sprint-wide extension — every
inheriting task follows automatically because the S241 server-computed triple re-resolves on the
next payload pull; PATCH `/api/devtasks/:id` `{due_at: <new>}` = the task-only extension/override;
both PRESERVE `due_origin_at` on value→value — the §13.4/assumption-1 invariant is already
server-enforced). What Phase 6 BUILDS is the FLOWS + the UI anchors:

- **J1 — the sprint-deadline extension**: opened from the sprint settings panel (sprint.html's
  detail Settings tab — the S244 control's seat) and/or the compact Kanban overview's Extend
  affordance (S243's popover already carries an `Extend` label hook — check
  `sprint-page.js`'s `data-sprint-menu` popover actions: active → Pause + Finish + **Extend**).
  The dialog: sprint identity (glyph + name), the current deadline + its remaining-time label
  (the S244 render stack's wording), the four choices (+24h / +48h / +72h / Custom date), the
  impact preview BEFORE applying (how many tasks INHERIT the deadline and follow — the §12.5-style
  client fold over tasks with `sprint_id === s.id && due_at == null`; how many are PROTECTED by
  personal overrides — `sprint_id === s.id && due_at != null`), then PATCH
  `/api/sprints/:id` `{due_at: now-existing-due + N}` (the presets ADD TO THE EXISTING DEADLINE,
  never to the current moment — spec §13.1) or the custom date through the SHARED control (D6 —
  `HibanaDueControl.create({value: <current due>})`, the user edits from the current value).
  Confirm → PATCH → reload (the origin PRESERVES — pin it: `due_origin_at` survives; only a
  null→re-add starts a fresh timeline).
- **J2 — the personal task-deadline extension**: opened from the task card row's affordance
  (S244's `.db-due-row` — an Extend affordance INSIDE the row or its hover menu; keep it compact —
  the row stays one line; a small ⋯/arrow button or the row's hover affordance) and the task view
  (S238's row-only variant) + the Edit modal's due field (an "Extend…" link beside the control —
  optional if the control already edits; J2's value is the PRESET shortcuts). The dialog: task
  title, current personal deadline + remaining label, the same four choices, "only this task
  changes" wording, PATCH `/api/devtasks/:id` `{due_at: existing + N}` (origin preserved).
- **J3 — the inherited-deadline extension choice**: when the task's row is SPRINT-sourced
  (`effective_due_source === 'sprint'`), the Extend affordance opens the CHOICE modal: two
  clearly distinct paths — "Extend sprint deadline" (sprint-wide — show the inheriting/protected
  counts, the J1 preview) vs "Extend this task only" (creates/updates a personal override based on
  the CURRENT INHERITED deadline + the selected extension; other sprint tasks unchanged; the
  origin stays the SPRINT's origin — §13.4's "preserve the inherited deadline's original progress
  origin rather than making the bar look newly assigned"; NOTE: the task PATCH's null→value rule
  would STAMP a new origin — the task's first personal assignment — so the task-only-from-inherited
  flow must send the value in a way that preserves the sprint's origin... CHECK THE SERVER: the
  PATCH stamps `due_origin_at = now` on `task.due_at == null` → value. The §13.4 invariant needs
  EITHER a client-sent `due_origin_at` ride-along (new body field — additive, zod-optional) OR a
  server special-case. Decide + record it in the status doc's assumption block; the kickoff
  suggests the additive optional body field `due_origin_at` on the task PATCH (validated ISO,
  only honored when it accompanies a null→value transition) — additive + island-transparent, and
  the desktop mirror consumes §12 as its contract so document it there).
- **The impact previews fold from the payload** (the S243 `pdOvRows` doctrine: the /kanban twin
  folds `state.tasks`, the embedded twin folds the fetched truth — never the 5-capped DOM).
- Every new UI string ships EN + FA (`bun run check-i18n-parity`); every touched `public/` file
  gets its `?v=` cache-bust bump (`bun run check-cache-bust`) + the sw.js SHELL ladder bump with
  the carrier note (move the s237/s238/s242/s243/s244 tripwire pins with you).

## Tasks in required order (Phase 6)

1. **The J1 sprint-deadline extension dialog** (devboard.js shared stack — exported like the H1/H2
   modals so sprint.html + board.html + project.html share ONE implementation): identity + current
   deadline + remaining label + the four choices + the inheriting/protected counts BEFORE
   confirmation → PATCH → reload. The presets add to the EXISTING deadline. Custom date = the
   shared control pre-loaded with the current value.
2. **The J2 personal extension flow**: the card row's Extend affordance (personal-source rows) +
   the task view + (optionally) the modal's due field link → the dialog → PATCH (origin
   preserved — pin with a test).
3. **The J3 inherited choice modal**: the two paths with visible scope, the J1 preview reused for
   the sprint-wide arm, the task-only arm's ORIGIN PRESERVATION (the §13.4/assumption-1 invariant —
   the additive `due_origin_at` ride-along decision, see above; document + test it).
4. **The anchors**: the S243 sprint popover's Extend label wires to J1; the compact overview's
   Extend affordance (both board surfaces); the card row's affordance routes by
   `effective_due_source` (personal → J2, sprint → J3, null → nothing — no deadline, no extend).
5. **i18n + RTL + cache-bust**: every new string in BOTH dictionaries (written Persian); the FA
   e2e pattern extends (the dialogs localize + mirror); `?v=` bumps + the sw.js ladder.
6. **Tests**: vitest (the sprint-ui-s245 style — the preset math adds to the EXISTING deadline
   not now; the origin-preservation pins on all three flows incl. the J3 task-only-from-inherited
   ride-along; the impact-preview fold reads the payload; the routing by effective_due_source; the
   parity extension if the row's affordance touches both renderers) and e2e: J1 (a sprint with
   inheritors + overrides → extend → the counts were shown, the inheritors moved, the overrides
   did NOT, the origin survived), J2 (personal extend → only that task changed, origin survived),
   J3 (both arms: sprint-wide = the J1 effects; task-only = the override landed with the SPRINT's
   origin preserved — the bar does not reset), the custom-date arm (the shared control), FA/RTL.
   ALL existing tests stay green (baseline 109 files / 909; the s242/s244 specs must not regress —
   adapt with in-file citations if a pin moves, intent preserved).

## Gate ladder (fix everything until green)

`bun run verify` (tsc → eslint-0 → vitest → prod build → portability → fn-shape → boundaries)
+ `bun run check-i18n-parity` + `bun run check-cache-bust` (both MATTER — public/ changes).
e2e: the sprint specs (`sprint-timeline`, `s206-sprint-fixes`, `sprint-ux`, `sprint-doc`,
`s209-kanban-parity`, `s242-sprint-ui`, `s243-sprint-lifecycle`, `s244-deadline-ui`,
`board-filters`) + your new specs (fresh sandbox: `bunx playwright install
chromium-headless-shell` first). Update `docs/autopilot/FN-ALLOWLIST.md` pins if handlers move
(the s237/s238/s243/s244 tripwires pin the sw.js ladder — move them with you).

## Commit, push, deploy rules

One or two coherent commits on **`feat/sprint-deadline-deps` ONLY**, message style
`feat(ui): S245 <lowercase one-liner> — spec pack phase 6` with a body citing the discrepancy
items advanced (**the J3 origin-preservation mechanism decision — the additive
`due_origin_at` ride-along or the server special-case, whichever you landed; assumption 11's H1
day-window seam UNTOUCHED — the queued owner decision stays open**) + test counts. Review the
final diff for unrelated changes and secrets. Push: feature branch only, one-shot token URL,
never persist the token. A branch push runs CI only — it can NEVER deploy. No merge to main, no
PR yet, no `bun run deploy*`, no D1 workflow runs — deployment + D1 = Phase 9. No desktop changes,
no unrelated refactors, no new runtime deps. Keep new `hibanaFetch` call sites minimal (prefer
the shared `api()` wrapper — Phases 3+4+5 added ZERO; the extension flows ride PATCH through
`patchSprint`/`patchTask` so they should add ZERO too) and list any you add in the commit body
for the Phase 9 re-pin inventory.

## End of session (mandatory)

1. Update the pack docs (read them off `origin/main` first): `IMPLEMENTATION-STATUS.md`
   (Phase 6 checklist + session log with commit SHA + test results + new assumptions/decisions —
   esp. the J3 origin-preservation mechanism, the preset math's add-to-existing-deadline
   implementation, the impact-preview fold source, the affordance routing) and REPLACE this
   file's content with the fully populated **Phase 7 prompt** (Task dependencies UI: spec §14-§16
   + Screens K/L — the collapsed Dependencies section in Add/Edit Task, the searchable
   `Blocked by` multi-select of same-project tasks (title + sprint + status), the derived reverse
   `Blocks N` counts (the client fold over the payload's `task_deps` — NEVER a new endpoint),
   self/cycle prevention surfacing the 400/409 codes inline, the compact card badges (Blocked /
   Blocks N / Ready when all blockers complete), the completing-a-blocker resolution, the soft
   constraints (never block Kanban movement — assumption 2), the e2e incl. the cross-sprint +
   multi-blocker + resolution cases; remember public/ changes need i18n EN+FA parity + `?v=`
   cache-bust bumps + the sw.js ladder + the parity test).
2. Push the feature branch (code) — token one-shot.
3. Push the docs-only commit to main (agent-workflow/*.md ONLY — `**.md` pushes are CI-skipped
   and cannot deploy; NEVER push non-md files to main).
4. Factual report: files changed, UI delivered per task 1-6, exact test/gate results, commit SHAs,
   push state (only what commands confirmed), blockers, defaults/assumptions taken, Phase 7
   handoff location.
