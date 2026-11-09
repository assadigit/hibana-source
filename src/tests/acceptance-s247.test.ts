import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

// src/tests/acceptance-s247.test.ts — S247 (spec pack PHASE 8 — the RELEASE
// GATE). Every acceptance-checklist row in the spec's §21 (sprints, 19 rows),
// §22 (deadlines, 20 rows), §23 (dependencies, 11 rows) and §24 (regression +
// quality, 10 rows) PLUS the visual guide's §6 checklist (18 rows) is mapped
// below to a test that EXISTS (file + title — machine-verified in lock-step by
// the CITATIONS table) or to a pin ADDED by this round (the S247-ADD blocks at
// the bottom of this file + the two new e2e specs).
//
// ┌────────────────────────────────────────────────────────────────────────────┐
// │ THE ACCEPTANCE MATRIX — spec §21/§22/§23/§24 + visual guide §6 → tests      │
// ├────────────────────────────────────────────────────────────────────────────┤
// │ Vitest files:                                                              │
// │   DOM  = src/tests/sprint-deadline-deps-domain.test.ts      (S240, 24)    │
// │   API  = src/tests/api-surface-s241.test.ts                  (S241, 7)    │
// │   S242 = src/tests/sprint-ui-s242.test.ts                    (17)         │
// │   S243 = src/tests/sprint-ui-s243.test.ts                    (23)         │
// │   S244 = src/tests/sprint-ui-s244.test.ts                    (28)         │
// │   S245 = src/tests/sprint-ui-s245.test.ts                    (26)         │
// │   S246 = src/tests/sprint-ui-s246.test.ts                    (25)         │
// │   PAR  = src/tests/kanban-parity.test.ts                     (the seam)    │
// │ E2E specs (chromium, the seeded-board harness):                            │
// │   E242 = e2e/s242-sprint-ui.spec.ts · E243 = e2e/s243-sprint-lifecycle     │
// │   E244 = e2e/s244-deadline-ui.spec.ts · E245 = e2e/s245-extend-flows       │
// │   E246 = e2e/s246-deps-ui.spec.ts · BF = e2e/board-filters.spec.ts         │
// │   TL = e2e/sprint-timeline.spec.ts · S209 = e2e/s209-kanban-parity         │
// │   M233 = e2e/s233-modal-close.spec.ts · LM = e2e/label-manager.spec.ts     │
// │   S208 = e2e/s208-kanban-shots.spec.ts · FA = e2e/fa-locale-guard.spec.ts  │
// │   A11Y = e2e/a11y.spec.ts (login+dashboard baselines — S199/S200)          │
// │   E247 = e2e/s247-acceptance.spec.ts · A247 = e2e/s247-a11y.spec.ts (NEW)  │
// ├────────────────────────────────────────────────────────────────────────────┤
// │ §21 SPRINTS — 19 rows                                                      │
// │  1 per-project sprint collection ........ DOM 'create: Security vs SECURITY│
// │    vs " security " … another project → 201' (project-scoped 409) + API     │
// │    'rule 1 scoping — a stranger's … edges never leak'                      │
// │  2 name required + unique case-insensitive  DOM §4.3 create + 'PATCH       │
// │    rename: onto a sibling case-twin → 409' + 'case-twin names: the 0067     │
// │    belt refuses them at the DB layer' (S253 re-pin) + S242 quick-create     │
// │    required-name + E242 duplicate 409 INLINE (server auto-names nameless    │
// │    creates — assumption 7, DOM 'the auto-generated name bumps past          │
// │    collisions')                                                             │
// │  3 emoji optional + picker + default fallback  S242 'every option wears    │
// │    the identity glyph' + 'the emoji picker rides board.html + sprint.html' │
// │    + 'the badge renders as its own row (emoji else ◆ + name)' + E242       │
// │    'the quick-create dialog: name + emoji picker …'                        │
// │  4 emoji in dropdowns + sprint views + cards  S242 badge pin + S243        │
// │    'the lifecycle-grouped list: Active / Planned / Paused / Completed      │
// │    history' + E242 'the card SPRINT IDENTITY row: emoji (or ◆) + name'     │
// │  5 description + due date OFF-by-default toggles  S242 'the dialog:        │
// │    required name, emoji picker, OFF-by-default description + due toggles'  │
// │  6 four lifecycle states  DOM 'start/pause/resume/finish/reopen walk the   │
// │    state machine with one-active at every step'                            │
// │  7 no two Active  DOM one-active + 'the partial unique index is the belt:  │
// │    a raw second ACTIVE row in one project is rejected' (the atomic belt —  │
// │    §24-8's simultaneous-request arm)                                       │
// │  8 start-while-active asks Finish-or-Pause  S243 'the modal exists with    │
// │    BOTH identities + the three explicit actions' + E243 'H1 (Screen H1):   │
// │    start-while-active opens the conflict modal'                            │
// │  9 finish confirmation + archives only Implemented  S243 H2 pin + DOM      │
// │    'done-in-sprint → archived (snapshot + sprint_id kept); every other     │
// │    task untouched' + E243 H2 test                                          │
// │ 10 unfinished keep status + sprint link  DOM finish test + E243 'H2 …      │
// │    unfinished tasks stay put + archived history shows'                     │
// │ 11 completed history accessible  S243 'the detail panel: Settings + Tasks  │
// │    tabs, the settings PATCH, the archived history, the ?sprint= deep link'  │
// │ 12 completed not deletable  DOM 'active → 409 sprint_active; completed →   │
// │    409 sprint_completed; planned → detach + snapshot'                      │
// │ 13 deletion never deletes + previews counts  S243 'EXACT impact counts:    │
// │    total, non-archived-unassigned, archived-with-snapshot, no-deletes' +   │
// │    E243 Screen I                                                            │
// │ 14 'Sprint: [name] (deleted)' snapshot  DOM planned→detach+snapshot +      │
// │    E243 'Screen I: … the paused sprint deletes through the EXACT-counts    │
// │    modal with the snapshot label' (asserts snap === 'Temp (deleted)')      │
// │ 15 dropdown No sprint + sprints + quick-create  S242 dropdown pins + E242  │
// │    'the sprint dropdown: completed sprints are hidden from NEW assignment' │
// │    + E242 quick-create test                                                 │
// │ 16 filter composes with search + priority; default All  S242 'board-       │
// │    page.js: All tasks default, No sprint option, every sprint with its     │
// │    glyph, composing with search + priority' + E242 'the toolbar sprint     │
// │    VIEW FILTER … composes with search + priority; never mutates' + BF      │
// │ 17 No sprint valid  E242 'D2 closed: Add Task with "No sprint" lands the   │
// │    task UNASSIGNED' + S242 create-body pin + DOM 'assignment into          │
// │    planned/active/paused sprints all stays legal (assumption 3)'           │
// │ 18 overview five-lane distribution  S243 'board-page.js: the panel mounts  │
// │    from the LOADED payload — identity + state + five lanes + total' +      │
// │    E243 'Screen G: the compact overview folds the five lanes + total on    │
// │    BOTH board surfaces (zero new fetches)'                                 │
// │ 19 Sprints page extended  S243 Screens E/F block (4 tests) + E243 FA/RTL   │
// ├────────────────────────────────────────────────────────────────────────────┤
// │ §22 DEADLINES — 20 rows                                                    │
// │  1 toggle OFF by default  S244 'OFF by default in Add; in Edit the toggle  │
// │    reflects the PERSONAL deadline only (never the computed triple)' +      │
// │    E244 toggle-flow test                                                   │
// │  2 controls hidden until enabled  S244 same pin ('(modalCtx.draft.dueOn    │
// │    ? '' : ' hidden')') + E244 'the toggle flow' (asserts [data-due-cal]    │
// │    hidden while OFF)                                                       │
// │  3 Edit shows saved personal deadline  S244 toggle-reflects pin + E244     │
// │  4 inherited line read-only while OFF  S244 'the read-only inherited line   │
// │    reads the payload row's server-computed source (§10.1 …)' + E244        │
// │  5 ON=override / OFF=inherit  E244 toggle flow (end-to-end) + S244 save-   │
// │    contract pin ('due_at ON-or-removal, absent otherwise')                 │
// │  6 personal > sprint  API 'the four §10 scenarios, then §10.3 …' + PAR     │
// │    'S244: personal > sprint precedence in the server-computed triple …'    │
// │  7 no effective deadline → no row/bar  S244 '§10.3: the null triple …      │
// │    reads null → no row, no bar' + E244 'the no-deadline card stays clean'  │
// │  8 exact preset semantics  S244 'the presets' EXACT semantics (§11.3):     │
// │    Today = LOCAL 23:59; 24/48/72h = now + N hours …' + S245 'the source    │
// │    pins the hour scale' (the extension presets)                            │
// │  9 date-only → 23:59 LOCAL  S244 '§11.2 — date-only resolves to LOCAL      │
// │    23:59 (assumption 10's UTC interim parse is GONE everywhere)' + E244    │
// │    toggle flow (LOCAL 23:59) + E245 Custom arm                              │
// │ 10 calendar selector reuses existing infra  S244 'the Jalali round-trip    │
// │    (the real vendored converter + the render stack in fa)' + 'the control  │
// │    rides board.html + sprint.html' + E244 '§11.1 — the Jalali selector     │
// │    round: the Jalali text input stores the SAME day'                       │
// │ 11 row below description + above timestamp  S244 'board-page.js: the row   │
// │    + bar slot between the sprint row and the tags/meta area (Screen A      │
// │    order)' + PAR seam pins                                                 │
// │ 12 bar below row = elapsed time  S244 '§12.2: the elapsed-time fill from   │
// │    effective_due_origin_at — clamped 0-100, full when passed, never        │
// │    completion'                                                             │
// │ 13 four threshold words + styling  S244 'exactly 7 days → approaching …' + │
// │    'exactly 48 hours → urgent …' + E244 boundary sides + S247-ADD the      │
// │    server-twin exact edges (§24-7)                                         │
// │ 14 done neutral + Done indication  S244 '§12.4: a done task reads DONE     │
// │    (neutral) regardless of how close the deadline is — no live countdown'  │
// │    + E244 done-neutrality test                                             │
// │ 15 completed sprint historical  API §10.3 pin + E244 '§12.4 + §10.3 +      │
// │    §5.5 — the done-task neutrality, the completed-sprint neutrality …'     │
// │ 16 sprint extension: inheritors follow, overrides protected  S245 'J1      │
// │    (§13.2): the sprint dialog PATCHes {due_at} ONLY …' + E245 J1 test      │
// │    ('inheritors follow, overrides stay')                                   │
// │ 17 task extension only that task  S245 'J2 (§13.3): the personal picker    │
// │    PATCHes {due_at} ONLY …' + E245 J2 test                                 │
// │ 18 inherited extension offers both  S245 'J3's choice modal: two clearly   │
// │    distinct arms with the scope visible …' + E245 both J3 tests            │
// │ 19 presets ADD to existing  S245 'a preset ADDS TO THE EXISTING deadline — │
// │    never to the current moment (frozen now proves it)' + E245 (+48h        │
// │    adds-to-existing assertion)                                             │
// │ 20 origin preserved  S245 ride-along block ('null→value WITH the           │
// │    ride-along stamps the CLIENT origin …', 'value→value IGNORES the        │
// │    ride-along …', 'the sprint-wide arm (J1) preserves the sprint's own     │
// │    origin …') + E245 J1/J2/J3 origin assertions                            │
// ├────────────────────────────────────────────────────────────────────────────┤
// │ §23 DEPENDENCIES — 11 rows                                                 │
// │  1 collapsed by default  S246 'COLLAPSED by default (spec §15): every      │
// │    openEditor resets depsOpen=false; the mount renders hidden + the toggle │
// │    aria-expanded="false"' + E246                                           │
// │  2 cross-sprint same project  DOM 'self and cross-project (and cross-user) │
// │    blockers are rejected; same-project cross-sprint links work' + E246     │
// │    'the LIVE cross-sprint link'                                            │
// │  3 no cross-project  DOM same test (the 400 arm)                           │
// │  4 multi-blocker + multi-blocked  DOM 'multi-blocker edges, idempotent     │
// │    re-add, delete, and task-delete cascade' + S246 'depBadgeHtml (Screen   │
// │    L): '' when no deps; single Blocked; Blocked · N; Ready; Blocks N; and  │
// │    BOTH badges …' + E246                                                   │
// │  5 Blocked-by entered / Blocks derived  S246 'blocksCount: the DERIVED     │
// │    reverse count …' + 'the derived-reverse note + the read-only blocks     │
// │    line (spec §15: no second EDITABLE Blocks field, ever)'                 │
// │  6 self + cycle prevented  DOM 'cycles are rejected (direct reverse edge   │
// │    AND transitive 3-loop) with 409 cycle' + E246 cycle + self tests        │
// │  7 compact badges only when relevant  S246 depBadgeHtml pin ('' when no    │
// │    deps) + E246                                                             │
// │  8 completing a blocker resolves  S246 'blockedStateOf (§16.1): no         │
// │    blockers → null; ANY incomplete blocker → blocked; ALL complete →       │
// │    ready …' + E246 resolution test                                         │
// │  9 blocked until ALL complete  S246 same + E246 'multi-blocker stays       │
// │    BLOCKED until ALL complete'                                             │
// │ 10 never alters priority/sprint/deadline/status  S246 'the save body NEVER │
// │    carries dep-derived fields …' + 'the folds are PURE …' + E246 soft-     │
// │    constraint test                                                         │
// │ 11 priority ribbon unchanged  S246 'the seam order: the dep row slots      │
// │    AFTER the deadline row (Screen M variants 6/7) in all three renderers'  │
// │    + S247-ADD the consolidated ribbon pin (below)                          │
// ├────────────────────────────────────────────────────────────────────────────┤
// │ §24 REGRESSION + QUALITY — 10 rows                                         │
// │  1 no-sprint/no-deadline/no-deps tasks as before  S244 null-triple pin +   │
// │    S246 no-deps pin + S247-ADD the bare-card contract (below) + E247       │
// │    '§24-1 — the bare task … renders the PRE-FEATURE card shape on BOTH     │
// │    board surfaces'                                                         │
// │  2 search + priority filters keep working  BF 'board: filter bar (priority │
// │    × label), dot cycles priority, exports carry both' + E242 filter-       │
// │    composition test + S242 composing pin                                   │
// │  3 editing/labels/upload/sync/archive preserved  M233 'board modals: every │
// │    modal carries a top-right close …' + LM 'label manager: usage list,     │
// │    rename-merge, recolor, delete-unused' + S208 'staged shots: pick →      │
// │    grid → SAVE pins to the created task …' + TL 'archive: park an idea →   │
// │    off the lists, on the Archive shelf → restore' + S209 'parity: ARCHIVE- │
// │    DONE on the embedded board refreshes IN PLACE …'                        │
// │  4 web/desktop agree on the data  API 'every pre-S240 key stays in place   │
// │    per section; additive keys ride along (a removal/rename fails here)'    │
// │    (the island pin) + S247-ADD the contract-doc-mirrors-code pin (below —  │
// │    the desktop round consumes §12 as its contract; the desktop CODE is     │
// │    Phase 9)                                                                │
// │  5 RTL + LTR layouts  E242/E243/E244/E245/E246 FA/RTL tests + FA locale    │
// │    guard + S247-ADD the consolidated FA sweep (E247) + A247 (FA surfaces)  │
// │  6 Gregorian/Jalali same underlying date  S244 'the FA day label converts  │
// │    through the vendored jalaali …' + E244 Jalali round + S247-ADD the      │
// │    dueDayLabel same-instant pin (below) + E247 same-instant test           │
// │  7 thresholds at EXACTLY 7d + 48h  S244 exact-edge VM pins + E244 boundary │
// │    sides (/kanban) + S247-ADD the detail-helpers server-twin exact edges   │
// │    (below) + E247 embedded-surface boundary test                           │
// │  8 lifecycle flows + conflicts  DOM state machine + one-active belt (the   │
// │    partial-unique-index atomicity = the simultaneous-request arm) + S243   │
// │    conflict pins + E243 H1                                                 │
// │  9 cycle prevention + multi-blocker resolution  DOM cycles test + E246     │
// │    resolution test (B done → still blocked; C done → Ready, retained)      │
// │ 10 migrations preserve pre-existing tasks  DOM 'legacy rows map to the     │
// │    CASE backfill; new columns arrive NULL; the one-active index enforces'  │
// │    (seeds a pre-0065 dev_tasks row + archive row; asserts untouched) +     │
// │    'legacy data with TWO open windows in one project normalizes …'         │
// ├────────────────────────────────────────────────────────────────────────────┤
// │ VISUAL GUIDE §6 — 18 rows                                                  │
// │  1 original screenshots guided  PAR 'the #pd-board section wears the       │
// │    mother container (.pd-board.db-frame + the .db-toolbar header row) …' + │
// │    S209 parity spec (the byte-identical card contracts)                    │
// │  2 five columns + toolbar + card design intact  PAR mother-container +     │
// │    'a sprinted task carries the ◆ sprint badge + data-pd-sprint …' +       │
// │    S209 'parity: /board.html?project= ≡ /kanban — same contracts …'        │
// │  3 priority ribbon unchanged  S247-ADD the ribbon pin (below)              │
// │  4 sprint filter defaults All + includes No sprint  S242 + E242            │
// │  5 sprint identity = emoji/◆ + name  S242 + E242                            │
// │  6 due toggle OFF + truly hidden  S244 + E244                               │
// │  7 dependencies collapsed by default  S246 + E246                           │
// │  8 inherited identified as sprint deadline  S244 inherited-line + row-     │
// │    grammar pins ('Sprint deadline · 7 days left')                          │
// │  9 override distinguishable from inherited  S244 toggle pins + E244        │
// │ 10 row + bar below description, above timestamp  S244 seam + S246 seam-    │
// │    order pins                                                              │
// │ 11 completed sprint deadline historical  API §10.3 + E244                  │
// │ 12 Create Sprint: name/emoji/desc-toggle/due-toggle  S242 quick-create     │
// │    block + E242                                                            │
// │ 13 lifecycle confirmations  S243 H1/H2/H3/I + E243                          │
// │ 14 deletion preview distinguishes unassigned vs archived-with-history      │
// │    S243 'EXACT impact counts …' + E243 Screen I                             │
// │ 15 extension UI communicates task-only vs sprint-wide  S245 J3 arms + J1   │
// │    counts-before-confirm pins + E245                                        │
// │ 16 dep indicators never replace priority/deadline  S246 purity pins +      │
// │    S247-ADD ribbon pin                                                     │
// │ 17 EN LTR + FA RTL checked  the five FA/RTL e2e tests + E247 FA sweep      │
// │ 18 no large empty area when collapsed  S246 '(open ? '' : ' hidden')'      │
// │    mount pin + S244 due-mount hidden pin + S242 quick-create hidden mounts │
// └────────────────────────────────────────────────────────────────────────────┘
//
// The A11Y PASS (the kickoff's new arm — A247 = e2e/s247-a11y.spec.ts): every
// Phases 3-7 dialog/badge gets keyboard reachability (focus-visible), aria
// labeling (role=dialog + aria-modal + aria-expanded/controls + role=alert),
// AA contrast on the state colors (the S247 fix: the amber/green text pair
// darkened to clear 4.5:1 — see devboard.css), and color-independent
// communication (the WORD always carries the meaning).
//
// Doctrine: the s242-s246 source-pin style. Nothing imports public/js or the
// docs; the real files are read byte-for-byte and (where behavior matters)
// EXECUTED in a VM sandbox. The lock-step test below re-reads every cited
// file and fails if a cited test title disappears or is renamed — the matrix
// cannot silently drift out of sync with the suite that proves it.

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const readPublic = (rel: string) => readFileSync(join(process.cwd(), 'public', rel), 'utf8')

/** Backslashes are stripped from BOTH sides so `\'` in cited titles matches the
 * raw source text (`'` after normalization) — titles citing sources that use
 * unicode escapes (`\u2019`) are written as prefixes that stop before them. */
const norm = (s: string) => s.replace(/\\/g, '')

// ---------------------------------------------------------------------------
// THE LOCK-STEP MATRIX — every citation below is machine-verified
// ---------------------------------------------------------------------------

const CITATIONS: { row: string; file: string; title: string }[] = [
  // ---- §21 sprints ----------------------------------------------------------
  { row: '§21-1 per-project collection', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'create: Security vs SECURITY vs " security " in one project' },
  { row: '§21-1 per-project collection (scoping)', file: 'src/tests/api-surface-s241.test.ts', title: "rule 1 scoping — a stranger's (or another project's) edges never leak into this payload" },
  { row: '§21-2 name required + case-insensitive unique', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: "PATCH rename: onto a sibling case-twin" },
  { row: '§21-2 legacy case-twins readable', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'case-twin names: the 0067 belt refuses them at the DB layer' },
  { row: '§21-2 nameless auto-name', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'the auto-generated name bumps past collisions' },
  { row: '§21-2 quick-create required name', file: 'src/tests/sprint-ui-s242.test.ts', title: 'the dialog: required name, emoji picker, OFF-by-default description + due toggles' },
  { row: '§21-2/§21-15 duplicate 409 INLINE', file: 'e2e/s242-sprint-ui.spec.ts', title: 'the quick-create dialog: name + emoji picker + duplicate 409 INLINE + auto-select on success' },
  { row: '§21-3 emoji optional + glyph fallback', file: 'src/tests/sprint-ui-s242.test.ts', title: 'devboard.js: every option wears the identity glyph; completed sprints are not NEW-assignment options' },
  { row: '§21-3 the shared emoji picker', file: 'src/tests/sprint-ui-s242.test.ts', title: 'the emoji picker rides board.html + sprint.html (the task modal serves both surfaces)' },
  { row: '§21-4 identity row (client twin)', file: 'src/tests/sprint-ui-s242.test.ts', title: 'board-page.js: the badge renders as its own row (emoji else ◆ + name), after the preview, before tags/meta' },
  { row: '§21-4 sprints-page identity', file: 'src/tests/sprint-ui-s243.test.ts', title: 'the lifecycle-grouped list: Active / Planned / Paused / Completed history, rows open the detail panel' },
  { row: '§21-4 card identity e2e', file: 'e2e/s242-sprint-ui.spec.ts', title: 'the card SPRINT IDENTITY row: emoji (or ◆) + name under the description — absent for unassigned' },
  { row: '§21-5 OFF-by-default toggles', file: 'src/tests/sprint-ui-s242.test.ts', title: 'the dialog: required name, emoji picker, OFF-by-default description + due toggles, cancel/create actions' },
  { row: '§21-6 four lifecycle states', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'start/pause/resume/finish/reopen walk the state machine with one-active at every step' },
  { row: '§21-7 one-active (sequential)', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'reopen = completed → active, subject to one-active; the not-latest sprint still 400s' },
  { row: '§21-7/§24-8 one-active (atomic belt)', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'the partial unique index is the belt: a raw second ACTIVE row in one project is rejected' },
  { row: '§21-8 conflict modal', file: 'src/tests/sprint-ui-s243.test.ts', title: 'devboard.js: the modal exists with BOTH identities + the three explicit actions' },
  { row: '§21-8 conflict modal e2e', file: 'e2e/s243-sprint-lifecycle.spec.ts', title: 'H1 (Screen H1): start-while-active opens the conflict modal' },
  { row: '§21-9 finish confirmation', file: 'src/tests/sprint-ui-s243.test.ts', title: 'devboard.js: identity + the client-fold Implemented count + unfinished-stay-put + no-deletes' },
  { row: '§21-9/§21-10 finish archives only Implemented', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: "done-in-sprint → archived (snapshot + sprint_id kept); every other task untouched" },
  { row: '§21-10 unfinished stay put (e2e)', file: 'e2e/s243-sprint-lifecycle.spec.ts', title: 'H2 (Screen H2): the finish confirmation previews the counts, toasts the SERVER count, and unfinished tasks stay put + archived history shows' },
  { row: '§21-11 completed history', file: 'src/tests/sprint-ui-s243.test.ts', title: 'the detail panel: Settings + Tasks tabs, the settings PATCH, the archived history, the ?sprint= deep link' },
  { row: '§21-12 completed not deletable', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'active → 409 sprint_active; completed → 409 sprint_completed; planned → detach + snapshot' },
  { row: '§21-13 deletion preview counts', file: 'src/tests/sprint-ui-s243.test.ts', title: 'EXACT impact counts: total, non-archived-unassigned, archived-with-snapshot, no-deletes' },
  { row: '§21-14 (deleted) snapshot label e2e', file: 'e2e/s243-sprint-lifecycle.spec.ts', title: 'Screen I: completed history answers inline; the paused sprint deletes through the EXACT-counts modal with the snapshot label' },
  { row: '§21-15 dropdown + completed hidden', file: 'e2e/s242-sprint-ui.spec.ts', title: 'the sprint dropdown: completed sprints are hidden from NEW assignment — but a task already in one keeps it selected' },
  { row: '§21-15 quick-create at selection time', file: 'src/tests/sprint-ui-s242.test.ts', title: 'devboard.js: the quick-create owns __new at SELECTION time — draft.sprint_id never becomes __new' },
  { row: '§21-16 filter composes', file: 'src/tests/sprint-ui-s242.test.ts', title: 'board-page.js: All tasks default, No sprint option, every sprint with its glyph, composing with search + priority' },
  { row: '§21-16 filter e2e', file: 'e2e/s242-sprint-ui.spec.ts', title: 'the toolbar sprint VIEW FILTER: All tasks default → No sprint → a named sprint → composes with search + priority; never mutates' },
  { row: '§21-17 No sprint valid (e2e)', file: 'e2e/s242-sprint-ui.spec.ts', title: 'D2 closed: Add Task with "No sprint" lands the task UNASSIGNED' },
  { row: '§21-17 No sprint valid (create body)', file: 'src/tests/sprint-ui-s242.test.ts', title: 'devboard.js: the create body sends sprint_id: sprintId ?? null' },
  { row: '§21-17 paused assignment legal', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'assignment into planned/active/paused sprints all stays legal (assumption 3)' },
  { row: '§21-18 overview fold (client)', file: 'src/tests/sprint-ui-s243.test.ts', title: 'board-page.js: the panel mounts from the LOADED payload — identity + state + five lanes + total + actions' },
  { row: '§21-18 overview e2e', file: 'e2e/s243-sprint-lifecycle.spec.ts', title: 'Screen G: the compact overview folds the five lanes + total on BOTH board surfaces (zero new fetches)' },
  { row: '§21-19 Sprints page extension', file: 'src/tests/sprint-ui-s243.test.ts', title: 'the wiring: the draft Start is conflict-aware, Delete is the exact-counts modal, the toolbar Finish opens H2' },
  // ---- §22 deadlines --------------------------------------------------------
  { row: '§22-1 toggle OFF by default (Add)', file: 'src/tests/sprint-ui-s244.test.ts', title: 'OFF by default in Add; in Edit the toggle reflects the PERSONAL deadline only (never the computed triple)' },
  { row: '§22-2 controls hidden until enabled', file: 'src/tests/sprint-ui-s244.test.ts', title: 'OFF by default in Add; in Edit the toggle reflects the PERSONAL deadline only (never the computed triple)' },
  { row: '§22-3 Edit shows the saved personal deadline', file: 'src/tests/sprint-ui-s244.test.ts', title: 'OFF by default in Add; in Edit the toggle reflects the PERSONAL deadline only (never the computed triple)' },
  { row: '§22-1 toggle flow e2e', file: 'e2e/s244-deadline-ui.spec.ts', title: '§9.1/§10.1/§10.2/§11.2 — the toggle flow: OFF by default + the inherited line → ON sets the override (LOCAL 23:59)' },
  { row: '§22-4 inherited line reads the server source', file: 'src/tests/sprint-ui-s244.test.ts', title: 'the read-only inherited line reads the payload row' },
  { row: '§22-5 save contract (ON-or-removal)', file: 'src/tests/sprint-ui-s244.test.ts', title: 'the save contract: create always carries the explicit key; edit sends due_at ON-or-removal, absent otherwise' },
  { row: '§22-6 personal > sprint (payload)', file: 'src/tests/api-surface-s241.test.ts', title: 'the four §10 scenarios, then §10.3 completed-sprint neutrality (history kept, countdown dropped)' },
  { row: '§22-6 personal > sprint (parity)', file: 'src/tests/kanban-parity.test.ts', title: 'S244: personal > sprint precedence in the server-computed triple + the JSON pool carries the triple for the repaint twin' },
  { row: '§22-7 null triple → no row/bar', file: 'src/tests/sprint-ui-s244.test.ts', title: '§10.3: the null triple (no deadline — the completed-sprint neutrality nulled it server-side) reads null → no row, no bar' },
  { row: '§22-7 no-deadline card clean (e2e)', file: 'e2e/s244-deadline-ui.spec.ts', title: '§12.3/§24 — the thresholds at the boundary sides + Overdue; §10/§12.1 — the no-deadline card stays clean' },
  { row: '§22-8 preset semantics', file: 'src/tests/sprint-ui-s244.test.ts', title: "EXACT semantics (§11.3): Today = LOCAL 23:59; 24/48/72h = now + N hours" },
  { row: '§22-9 date-only LOCAL 23:59', file: 'src/tests/sprint-ui-s244.test.ts', title: "§11.2 — date-only resolves to LOCAL 23:59 (assumption 10's UTC interim parse is GONE everywhere)" },
  { row: '§22-10 vendored converter round-trip', file: 'src/tests/sprint-ui-s244.test.ts', title: 'the FA day label converts through the vendored jalaali (storage Gregorian UTC, conversion at the render edge' },
  { row: '§22-10 control rides both pages', file: 'src/tests/sprint-ui-s244.test.ts', title: 'the control rides board.html + sprint.html (the two modal-serving pages)' },
  { row: '§22-10 Jalali selector e2e', file: 'e2e/s244-deadline-ui.spec.ts', title: '§11.1 — the Jalali selector round: the Jalali text input stores the SAME day (the vendored converter is the truth)' },
  { row: '§22-11 row placement', file: 'src/tests/sprint-ui-s244.test.ts', title: 'board-page.js: the row + bar slot between the sprint row and the tags/meta area (Screen A order)' },
  { row: '§22-12 elapsed-time fill', file: 'src/tests/sprint-ui-s244.test.ts', title: '§12.2: the elapsed-time fill from effective_due_origin_at — clamped 0-100, full when passed, never completion' },
  { row: '§22-13 exactly 7 days', file: 'src/tests/sprint-ui-s244.test.ts', title: 'exactly 7 days → approaching; a hair over 7 days → comfortable' },
  { row: '§22-13 exactly 48 hours', file: 'src/tests/sprint-ui-s244.test.ts', title: 'exactly 48 hours → urgent; a hair over 48 hours → approaching' },
  { row: '§22-14 done neutrality', file: 'src/tests/sprint-ui-s244.test.ts', title: '§12.4: a done task reads DONE (neutral) regardless of how close the deadline is — no live countdown' },
  { row: '§22-14/§22-15 neutrality e2e', file: 'e2e/s244-deadline-ui.spec.ts', title: '§12.4 + §10.3 + §5.5 — the done-task neutrality, the completed-sprint neutrality, and the PAUSED sprint keeps inheriting' },
  { row: '§22-15 paused keeps inheriting', file: 'src/tests/api-surface-s241.test.ts', title: "a PAUSED sprint's deadline keeps inheriting (§5.5 — pausing preserves deadline info)" },
  { row: '§22-16 J1 sprint-wide PATCH', file: 'src/tests/sprint-ui-s245.test.ts', title: 'J1 (§13.2): the sprint dialog PATCHes {due_at} ONLY' },
  { row: '§22-16 J1 e2e', file: 'e2e/s245-extend-flows.spec.ts', title: '§13.1/§13.2 + Screen J1 — the sprint extension from the overview: the counts show BEFORE, +48h adds to the EXISTING deadline' },
  { row: '§22-17 J2 only-this-task', file: 'src/tests/sprint-ui-s245.test.ts', title: 'J2 (§13.3): the personal picker PATCHes {due_at} ONLY' },
  { row: '§22-17 J2 e2e', file: 'e2e/s245-extend-flows.spec.ts', title: '§13.3 + Screen J2 — the personal extension from the card row: only this task changes, the origin survives' },
  { row: '§22-18 J3 two arms', file: 'src/tests/sprint-ui-s245.test.ts', title: "J3's choice modal: two clearly distinct arms with the scope visible (the counts in the sprint arm's sub-line)" },
  { row: '§22-18 J3 task-only e2e', file: 'e2e/s245-extend-flows.spec.ts', title: '§13.4 + Screen J3 — the inherited row opens the CHOICE modal; the TASK-ONLY arm creates the override riding the SPRINT' },
  { row: '§22-18 J3 sprint-wide e2e', file: 'e2e/s245-extend-flows.spec.ts', title: '§13.4 + Screen J3 — the SPRINT-WIDE arm reuses J1: the choice opens the counted dialog' },
  { row: '§22-19 presets add to existing', file: 'src/tests/sprint-ui-s245.test.ts', title: 'a preset ADDS TO THE EXISTING deadline — never to the current moment (frozen now proves it)' },
  { row: '§22-20 ride-along stamps the client origin', file: 'src/tests/sprint-ui-s245.test.ts', title: 'null→value WITH the ride-along stamps the CLIENT origin (the J3 task-only arm' },
  { row: '§22-20 value→value preserves', file: 'src/tests/sprint-ui-s245.test.ts', title: 'value→value IGNORES the ride-along (an extension is not a re-assignment — the stored origin wins)' },
  { row: '§22-20 sprint origin survives', file: 'src/tests/sprint-ui-s245.test.ts', title: "the sprint-wide arm (J1) preserves the sprint's own origin across a value→value PATCH" },
  // ---- §23 dependencies -----------------------------------------------------
  { row: '§23-1 collapsed by default', file: 'src/tests/sprint-ui-s246.test.ts', title: 'COLLAPSED by default (spec §15): every openEditor resets depsOpen=false' },
  { row: '§23-3/§23-2 cross-project 400 + cross-sprint legal', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'self and cross-project (and cross-user) blockers are rejected; same-project cross-sprint links work' },
  { row: '§23-2 cross-sprint e2e', file: 'e2e/s246-deps-ui.spec.ts', title: 'Screen K + §14.1 + §15 — the collapsed section, the searchable multi-select, the LIVE cross-sprint link' },
  { row: '§23-4 multi-blocker + cascade', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'multi-blocker edges, idempotent re-add, delete, and task-delete cascade' },
  { row: '§23-7/§23-4 badge grammar (only when relevant)', file: 'src/tests/sprint-ui-s246.test.ts', title: 'depBadgeHtml (Screen L)' },
  { row: '§23-5 derived reverse', file: 'src/tests/sprint-ui-s246.test.ts', title: 'blocksCount: the DERIVED reverse count — the SAME edges' },
  { row: '§23-5 read-only blocks line', file: 'src/tests/sprint-ui-s246.test.ts', title: 'the derived-reverse note + the read-only blocks line (spec §15: no second EDITABLE Blocks field, ever)' },
  { row: '§23-6 cycles 409', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'cycles are rejected (direct reverse edge AND transitive 3-loop) with 409 cycle' },
  { row: '§23-6 cycle inline e2e', file: 'e2e/s246-deps-ui.spec.ts', title: '§14.2 — the CYCLE rejection inline: picking a task this one already blocks answers the 409 with the pick named' },
  { row: '§23-6 self inline e2e', file: 'e2e/s246-deps-ui.spec.ts', title: '§14.2 — the SELF rejection inline: picking the task itself answers the 400' },
  { row: '§23-8/§23-9 completion resolution', file: 'src/tests/sprint-ui-s246.test.ts', title: 'blockedStateOf (§16.1): no blockers → null; ANY incomplete blocker → blocked; ALL complete → ready' },
  { row: '§23-9 multi-blocker e2e', file: 'e2e/s246-deps-ui.spec.ts', title: '§16.1 — multi-blocker stays BLOCKED until ALL complete; the resolution flips to Ready and RETAINS the relationship' },
  { row: '§23-10 save body clean', file: 'src/tests/sprint-ui-s246.test.ts', title: 'the save body NEVER carries dep-derived fields (§15: dependencies do not alter priority, sprint, deadline, or status)' },
  { row: '§23-10 folds pure', file: 'src/tests/sprint-ui-s246.test.ts', title: 'the folds are PURE — the soft-constraint pin (assumption 2)' },
  { row: '§23-10 soft constraint e2e', file: 'e2e/s246-deps-ui.spec.ts', title: '§16.1 + assumption 2 — the SOFT constraint: a BLOCKED task still moves to done through the editor' },
  { row: '§23-11 seam order after the deadline row', file: 'src/tests/sprint-ui-s246.test.ts', title: 'the seam order: the dep row slots AFTER the deadline row (Screen M variants 6/7) in all three renderers' },
  // ---- §24 regression + quality ---------------------------------------------
  { row: '§24-1 the bare task behaves as before', file: 'src/tests/sprint-ui-s244.test.ts', title: '§10.3: the null triple (no deadline — the completed-sprint neutrality nulled it server-side) reads null → no row, no bar' },
  { row: '§24-1 no-deps badge answers empty', file: 'src/tests/sprint-ui-s246.test.ts', title: 'depBadgeHtml (Screen L)' },
  { row: '§24-6 Gregorian/Jalali same underlying date', file: 'src/tests/sprint-ui-s244.test.ts', title: 'the FA day label converts through the vendored jalaali (storage Gregorian UTC, conversion at the render edge' },
  { row: '§24-7 thresholds at EXACTLY 7d and 48h', file: 'src/tests/sprint-ui-s244.test.ts', title: 'exactly 7 days → approaching; a hair over 7 days → comfortable' },
  { row: '§24-7 thresholds at exactly 48h', file: 'src/tests/sprint-ui-s244.test.ts', title: 'exactly 48 hours → urgent; a hair over 48 hours → approaching' },
  { row: '§24-9 cycle prevention', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'cycles are rejected (direct reverse edge AND transitive 3-loop) with 409 cycle' },
  { row: '§24-9 multi-blocker resolution', file: 'e2e/s246-deps-ui.spec.ts', title: '§16.1 — multi-blocker stays BLOCKED until ALL complete; the resolution flips to Ready and RETAINS the relationship' },
  { row: '§24-2 filter bar e2e', file: 'e2e/board-filters.spec.ts', title: 'board: filter bar (priority × label), dot cycles priority, exports carry both' },
  { row: '§24-3 modals close control', file: 'e2e/s233-modal-close.spec.ts', title: 'board modals: every modal carries a top-right close' },
  { row: '§24-3 label manager', file: 'e2e/label-manager.spec.ts', title: 'label manager: usage list, rename-merge, recolor, delete-unused' },
  { row: '§24-3 staged shots', file: 'e2e/s208-kanban-shots.spec.ts', title: 'staged shots: pick → grid → SAVE pins to the created task' },
  { row: '§24-3 archive behavior', file: 'e2e/sprint-timeline.spec.ts', title: 'archive: park an idea → off the lists, on the Archive shelf → restore' },
  { row: '§24-3 embedded archive-done', file: 'e2e/s209-kanban-parity.spec.ts', title: 'parity: ARCHIVE-DONE on the embedded board refreshes IN PLACE' },
  { row: '§24-4 island shape pin', file: 'src/tests/api-surface-s241.test.ts', title: 'every pre-S240 key stays in place per section; additive keys ride along (a removal/rename fails here)' },
  { row: '§24-5 FA sprint filter/dropdown/quick-create', file: 'e2e/s242-sprint-ui.spec.ts', title: 'FA/RTL: the sprint filter, the dropdown and the quick-create dialog localize + mirror (spec §17)' },
  { row: '§24-5 FA overview + lifecycle', file: 'e2e/s243-sprint-lifecycle.spec.ts', title: 'FA/RTL: the overview + the grouped list + the finish dialog localize and mirror (spec §17)' },
  { row: '§24-5 FA deadline rows + LTR bar', file: 'e2e/s244-deadline-ui.spec.ts', title: '§17 — FA/RTL: the rows localize + the card mirrors, and the BAR stays direction-locked LTR (the explicit exception)' },
  { row: '§24-5 FA extend dialogs', file: 'e2e/s245-extend-flows.spec.ts', title: '§17 — FA/RTL: the dialogs localize, the choice arms mirror, the row affordance rides the mirrored row' },
  { row: '§24-5 FA deps section + badges', file: 'e2e/s246-deps-ui.spec.ts', title: '§17 — FA/RTL: the section + the badges localize; the mirrored layout renders' },
  { row: '§24-8 pause/resume guards', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'pause only accepts ACTIVE; resume only accepts PAUSED' },
  { row: '§24-8 conflict surfacing (never retried)', file: 'src/tests/sprint-ui-s243.test.ts', title: 'the arms run sequentially (pause→start / finish→start) and a lost race is SURFACED, never retried' },
  { row: '§24-10 migration backfill + pre-existing tasks', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'legacy rows map to the CASE backfill; new columns arrive NULL; the one-active index enforces' },
  { row: '§24-10 two-open normalization', file: 'src/tests/sprint-deadline-deps-domain.test.ts', title: 'legacy data with TWO open windows in one project normalizes: latest stays active, older is paused' },
  // ---- visual guide §6 ------------------------------------------------------
  { row: 'V§6-1/2 mother container parity', file: 'src/tests/kanban-parity.test.ts', title: 'the #pd-board section wears the mother container (.pd-board.db-frame + the .db-toolbar header row) + the Labels button' },
  { row: 'V§6-2 board parity e2e', file: 'e2e/s209-kanban-parity.spec.ts', title: 'parity: /board.html?project= ≡ /kanban — same contracts; ONLY the Back link + rail mode differ' },
  { row: 'V§6-2 sprint badge parity', file: 'src/tests/kanban-parity.test.ts', title: 'a sprinted task carries the ◆ sprint badge + data-pd-sprint (the /kanban card contract)' },
  { row: 'V§6-18 deps mount hidden until open', file: 'src/tests/sprint-ui-s246.test.ts', title: "the SEARCHABLE multi-select: the search input filters by title; each option carries the title + sprint identity (glyph grammar) + status" },
  // ---- S247 additions (this round) ------------------------------------------
  { row: 'S247-ADD bare-card contract (§24-1)', file: 'src/tests/acceptance-s247.test.ts', title: 'the BARE CARD contract (§24-1): a task with no sprint, no deadline, no deps renders ZERO feature rows in all three renderers' },
  { row: 'S247-ADD server-twin exact edges (§24-7)', file: 'src/tests/acceptance-s247.test.ts', title: 'the SERVER TWIN exact edges (§24-7 — every display surface): detail-helpers.ts dueStateOf at exactly 48h / exactly 7d' },
  { row: 'S247-ADD contract mirrors code (§24-4)', file: 'src/tests/acceptance-s247.test.ts', title: 'the CONTRACT DOC mirrors the code (§24-4 — the desktop consumes §12 in Phase 9): every §12 endpoint/body/error is the real route' },
  { row: 'S247-ADD ribbon unchanged (§23-11/V§6-3)', file: 'src/tests/acceptance-s247.test.ts', title: 'the PRIORITY RIBBON unchanged (§23-11 + visual §6-3): the banner stays the card' },
  { row: 'S247-ADD dueDayLabel same-instant (§24-6)', file: 'src/tests/acceptance-s247.test.ts', title: 'the SAME INSTANT both ways (§24-6 — the dueDayLabel seam): the EN label and the FA label name the SAME day' },
  { row: 'S247-ADD bare-card e2e (§24-1)', file: 'e2e/s247-acceptance.spec.ts', title: '§24-1 — the bare task (no sprint, no deadline, no deps) renders the PRE-FEATURE card shape on BOTH board surfaces' },
  { row: 'S247-ADD embedded boundary e2e (§24-7)', file: 'e2e/s247-acceptance.spec.ts', title: '§24-7 — the threshold boundary SIDES render on the EMBEDDED board surface too (the server twin' },
  { row: 'S247-ADD same-instant e2e (§24-6)', file: 'e2e/s247-acceptance.spec.ts', title: '§24-6 — the SAME instant displays both ways: the EN card row and the FA card row agree on the day (the dueDayLabel seam)' },
  { row: 'S247-ADD the FA sweep (§24-5)', file: 'e2e/s247-acceptance.spec.ts', title: 'the localization sweep — ONE FA pass over every Phases 3-7 surface: the sprint dropdown + quick-create, the H2 lifecycle dialog' },
  { row: 'S247-ADD a11y dialogs', file: 'e2e/s247-a11y.spec.ts', title: 'a11y — the Phases 3-7 dialogs: role=dialog + aria-modal + keyboard-reachable actions + focus lands on the primary field' },
  { row: 'S247-ADD a11y toggles', file: 'e2e/s247-a11y.spec.ts', title: 'a11y — the due control + the deps section: toggle semantics (aria-expanded/aria-controls), the segmented calendar' },
  { row: 'S247-ADD a11y contrast', file: 'e2e/s247-a11y.spec.ts', title: 'a11y — AA contrast on the state colors: the four threshold words + the dep badges clear 4.5:1 on the rendered board' },
  { row: 'S247-ADD a11y color independence', file: 'e2e/s247-a11y.spec.ts', title: 'a11y — color independence: the WORD always carries the meaning (threshold words + badge words in the text, never color alone)' },
]

describe('S247 — the acceptance matrix in lock-step (§21/§22/§23/§24 + visual §6)', () => {
  it('every cited test EXISTS in its cited file — the matrix cannot drift from the suite that proves it', () => {
    const missing: string[] = []
    const cache = new Map<string, string>()
    for (const c of CITATIONS) {
      let src = cache.get(c.file)
      if (src === undefined) {
        src = norm(readRepo(c.file))
        cache.set(c.file, src)
      }
      const title = norm(c.title)
      if (!src.includes(title)) missing.push(`${c.row} → ${c.file}: '${c.title.slice(0, 72)}…'`)
    }
    expect(missing, `the matrix cites tests that no longer exist (rename or removal breaks the release gate):\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('the matrix covers EVERY row of §21 (19) + §22 (20) + §23 (11) + §24 (10) — the row counts are pinned', () => {
    // §21 has 19 checkbox rows in the spec (the kickoff's "18" undercounts the
    // written checklist — the spec file is the authority and it has 19).
    expect(CITATIONS.filter((c) => c.row.startsWith('§21-')).length).toBeGreaterThanOrEqual(19)
    for (let r = 1; r <= 19; r++) expect(CITATIONS.some((c) => c.row.startsWith(`§21-${r}`)), `§21 row ${r} has no citation`).toBe(true)
    for (let r = 1; r <= 20; r++) expect(CITATIONS.some((c) => c.row.startsWith(`§22-${r}`)), `§22 row ${r} has no citation`).toBe(true)
    for (let r = 1; r <= 11; r++) expect(CITATIONS.some((c) => c.row.startsWith(`§23-${r}`)), `§23 row ${r} has no citation`).toBe(true)
    for (let r = 1; r <= 10; r++) expect(CITATIONS.some((c) => c.row.startsWith(`§24-${r}`)), `§24 row ${r} has no citation`).toBe(true)
    // the visual guide's §6 checklist rows this matrix tracks by header pins
    for (const v of ['V§6-1/2', 'V§6-2', 'V§6-18']) expect(CITATIONS.some((c) => c.row.startsWith(v))).toBe(true)
    // the S247 additions this round closes (5 vitest pins + 4 e2e acceptance + 4 a11y)
    expect(CITATIONS.filter((c) => c.row.startsWith('S247-ADD')).length).toBe(13)
  })
})

// ---------------------------------------------------------------------------
// S247-ADD 1 — §24-1: the BARE CARD contract. A task with no sprint, no
// deadline and no dependencies must render EXACTLY as it did before the
// feature: every new row is conditional in ALL THREE renderers (the /kanban
// client twin, the embedded board's server twin, the embedded repaint twin),
// and the shared render helpers answer '' for the bare shape.
// ---------------------------------------------------------------------------
describe('S247 — §24-1/§24-10 the bare card + migration-preserved tasks', () => {
  it('the BARE CARD contract (§24-1): a task with no sprint, no deadline, no deps renders ZERO feature rows in all three renderers', () => {
    // renderer 1 — board-page.js (/kanban): every feature row is a conditional
    const bp = readPublic('js/board-page.js')
    // the sprint row: `const sprintRowHtml = sprint ? '<span class="db-sprint-badge">…' : ''`
    expect(bp).toContain("const sprintRowHtml = sprint")
    expect(bp).toContain(": ''")
    // the deadline + dep rows delegate to the shared stack (which answers '' on
    // the null triple / empty edges — pinned behaviorally below)
    expect(bp).toContain("const deadlineHtml = B().deadlineRowHtml ? B().deadlineRowHtml(task, lang) : ''")
    expect(bp).toContain("const depHtml = B().depBadgeHtml ? B().depBadgeHtml(task, null, null, lang) : ''")
    // renderer 2 — detail-helpers.ts (the server twin): the badge row is
    // conditional, the twin renders '' on the null triple
    const dh = readRepo('src/routes/projects/detail-helpers.ts')
    expect(dh).toContain("if (!sp) return ''")
    // renderer 3 — project-page.js (the repaint twin): the same shared-stack
    // delegation (pinned in sprint-ui-s244/s246 — cited here for the one-row
    // contract)
    const pp = readPublic('js/project-page.js')
    expect(pp).toContain("window.HibanaBoard.deadlineRowHtml ? window.HibanaBoard.deadlineRowHtml(t, pdLang) : ''")
  })

  it('the bare shape is pinned BEHAVIORALLY (the VM round): the shared stack answers empty strings for a pre-feature task', () => {
    const sandbox: Record<string, unknown> = {
      window: {},
      document: { addEventListener() {} },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      console,
    }
    const win = sandbox.window as Record<string, unknown>
    runInNewContext(readPublic('vendor/jalaali.min.js'), sandbox, { filename: 'jalaali.min.js' })
    runInNewContext(readPublic('js/devboard.js'), sandbox, { filename: 'devboard.js' })
    const B = win.HibanaBoard as Record<string, (...a: unknown[]) => unknown>
    // the pre-feature shape: a task row exactly as the pre-0065 payload served
    // it (no effective_* keys at all — the lagging-D1 belt), no dep edges
    const bareTask = { id: 't1', title: 'T', status: 'planned', priority: 'medium' }
    const emptyDeps: never[] = []
    expect(B.deadlineRowHtml(bareTask, 'en')).toBe('')
    expect(B.deadlineViewHtml(bareTask, 'en')).toBe('')
    expect(B.deadlineStateOf(bareTask)).toBe(null)
    expect(B.depBadgeHtml(bareTask, emptyDeps, [], 'en')).toBe('')
    expect(B.depViewHtml(bareTask, emptyDeps, [], 'en')).toBe('')
    // a null triple (post-0065 payload, no deadline anywhere) is equally bare
    const nullTriple = { ...bareTask, effective_due_at: null, effective_due_source: null, effective_due_origin_at: null }
    expect(B.deadlineRowHtml(nullTriple, 'en')).toBe('')
    expect(B.depBadgeHtml(nullTriple, emptyDeps, [], 'en')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// S247-ADD 2 — §24-7: the SERVER TWIN exact edges. The s244 VM pins prove
// devboard.js's deadlineStateOf at exactly-48h/exactly-7d; the embedded
// project-page board renders through detail-helpers.ts's own dueStateOf (a
// render-time twin, Date.now()-bound). This round extends the exact-equality
// proofs to that surface by extracting the twin's real source and executing it
// with a frozen clock.
// ---------------------------------------------------------------------------
describe('S247 — §24-7 the server twin at the exact boundaries', () => {
  it('the SERVER TWIN exact edges (§24-7 — every display surface): detail-helpers.ts dueStateOf at exactly 48h / exactly 7d', () => {
    const ts = readRepo('src/routes/projects/detail-helpers.ts')
    // extract the twin's classification verbatim (the H48/D7 constants + the
    // dueStateOf closure), strip ONLY the TS type annotations, and run it with
    // a frozen Date — the source under test is the file's own bytes.
    const start = ts.indexOf('const H48 = 48 * 3600000')
    const end = ts.indexOf('const dueDayLabel')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    let twin = ts.slice(start, end)
    // the elapsed twin rides along (same extraction window)
    expect(twin).toContain('const dueStateOf')
    expect(twin).toContain('const dueElapsedPct')
    twin = twin
      .replace("const dueStateOf = (t: { status: string; effective_due_at: string | null }): string | null =>", 'const dueStateOf = (t) =>')
      .replace('const dueElapsedPct = (t: { effective_due_at: string | null; effective_due_origin_at: string | null }): number =>', 'const dueElapsedPct = (t) =>')
    const NOW = Date.UTC(2026, 10, 6, 12, 0, 0) // the s244 pin's fixed instant
    const DATE_PARSE = Date.parse
    // runInNewContext returns the script's completion value — the extracted
    // twin's closures come out live with the frozen Date injected
    const closures = runInNewContext(`${twin}\n;[dueStateOf, dueElapsedPct]`, { Date: { now: () => NOW, parse: DATE_PARSE } }, { filename: 'detail-helpers-twin.js' }) as [(t: unknown) => string | null, (t: unknown) => number]
    const dueStateOf = closures[0]
    const dueElapsedPct = closures[1]
    const iso = (ms: number) => new Date(ms).toISOString()
    const DAY = 86400000
    const H = 3600000
    const task = (dueMs: number, extra: Record<string, unknown> = {}) => ({ status: 'in_progress', effective_due_at: iso(dueMs), effective_due_origin_at: iso(NOW - DAY), ...extra })
    // the §12.3 exact edges — the SAME equalities the devboard.js VM pins prove
    expect(dueStateOf(task(NOW + 7 * DAY))).toBe('approaching') // exactly 7d → approaching
    expect(dueStateOf(task(NOW + 7 * DAY + 1))).toBe('comfortable') // a hair over → comfortable
    expect(dueStateOf(task(NOW + 48 * H))).toBe('urgent') // exactly 48h → urgent
    expect(dueStateOf(task(NOW + 48 * H + 1))).toBe('approaching') // a hair over → approaching
    expect(dueStateOf(task(NOW))).toBe('overdue') // passed → overdue
    expect(dueStateOf(task(NOW + 1))).toBe('urgent')
    // §12.4 done-neutrality + the null triple, on the twin
    expect(dueStateOf(task(NOW + H, { status: 'done' }))).toBe('done')
    expect(dueStateOf({ status: 'in_progress', effective_due_at: null })).toBe(null)
    // §12.2 the elapsed fill — the same math as the client twin
    expect(dueElapsedPct(task(NOW - 1))).toBe(100)
    expect(dueElapsedPct(task(NOW + 4 * DAY))).toBe(20) // origin NOW-1d, due NOW+4d → 20%
    expect(dueElapsedPct({ effective_due_at: null, effective_due_origin_at: null })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// S247-ADD 3 — §24-4: the CONTRACT DOC mirrors the code. The desktop round
// (Phase 9) consumes docs/project-kanban/API-AND-SYNC-CONTRACT.md §12 as its
// contract; this pin asserts every §12 endpoint, body key, additive payload
// key and error code the doc documents is the REAL route/helper in the code —
// the doc cannot drift from the implementation between now and the re-pin.
// ---------------------------------------------------------------------------
describe('S247 — §24-4 the contract doc mirrors the code', () => {
  it('the CONTRACT DOC mirrors the code (§24-4 — the desktop consumes §12 in Phase 9): every §12 endpoint/body/error is the real route', () => {
    const doc = readRepo('docs/project-kanban/API-AND-SYNC-CONTRACT.md')
    // S257 (the Phase 6 devboard split): devboard.ts is now src/routes/devboard/
    // {index,board,tasks,sprints,strategies,archives,misc}.ts — the read targets move
    // to the modules that carry the routes today (the assertions themselves are the
    // S247 pins, unchanged; this is one of the two documented read-target updates).
    const board = readRepo('src/routes/devboard/board.ts')
    const tasks = readRepo('src/routes/devboard/tasks.ts')
    const sprints = readRepo('src/routes/devboard/sprints.ts')
    const helpers = readRepo('src/routes/devboard-helpers.ts')
    const detail = readRepo('src/routes/projects/detail-helpers.ts')

    // §12.1 the five lifecycle endpoints + create/PATCH/DELETE are real routes
    for (const route of [
      "app.post('/api/projects/:projectId/sprints'",
      "app.post('/api/sprints/:id/start'",
      "app.post('/api/sprints/:id/pause'",
      "app.post('/api/sprints/:id/resume'",
      "app.post('/api/sprints/:id/finish'",
      "app.post('/api/sprints/:id/reopen'",
      "app.patch('/api/sprints/:id'",
      "app.delete('/api/sprints/:id'",
    ]) {
      expect(sprints, `the doc's §12.1 route ${route} must exist in src/routes/devboard/sprints.ts`).toContain(route)
    }
    // §12.2 the effective triple is ONE shared helper consumed by both pools
    // (the board GET renders through boardTaskRows — the helper's own export site)
    expect(helpers).toContain('export function effectiveDeadlineOf')
    expect(board).toContain('boardTaskRows, // S241: task rows + the server-computed effective deadline')
    expect(helpers).toContain('export function boardTaskRows')
    expect(detail).toContain('effectiveDeadlineOf')
    // the S245 ride-along body key the doc documents (the task PATCH grammar lives
    // in tasks.ts's import of updateDevTaskSchema + the schema itself)
    expect(readRepo('src/routes/devboard/schemas.ts')).toContain('due_origin_at')
    expect(tasks).toContain('dueOriginAt')
    // §12.3 the deps endpoints + the 409 cycle / 400 invalid_input family (the
    // cycle code lives in the shared error registry; the deps route answers 409)
    expect(tasks).toContain("app.post('/api/devtasks/:id/deps'")
    expect(tasks).toContain("app.delete('/api/devtasks/:id/deps/:blockerId'")
    expect(tasks).toContain('ErrorCode.cycle, 409')
    expect(readRepo('src/lib/errors.ts')).toContain('cycle:')
    // the payload's 7th key + the detail pool's twin (§12.3's embedded-fold decision)
    expect(helpers).toContain('taskDepsForProject')
    expect(board).toContain('task_deps')
    expect(detail).toContain('taskDeps')
    // §12.4 the completed-sprint assignment guards + the one-active family (the
    // task-assignment guards live in tasks.ts; the one-active 409s live in sprints.ts
    // + the S257 assertNoActiveSibling helper in devboard-helpers.ts)
    expect(tasks).toContain('ErrorCode.sprint_completed, 400')
    expect(sprints).toContain('ErrorCode.sprint_active_exists')
    expect(helpers).toContain('ErrorCode.sprint_active_exists')
    expect(readRepo('src/lib/errors.ts')).toContain('sprint_completed:')
    // the doc itself carries the sections the desktop will read
    for (const section of ['### 12.1 Sprint model + endpoints', '### 12.2 Task deadlines', '### 12.3 Task dependencies', '### 12.4 Task endpoints', '### 12.5 Sprint overview counts', '### 12.6 Sync implications']) {
      expect(doc, `the contract doc must carry ${section}`).toContain(section)
    }
    // the doc's §12 error codes are the codes the code throws (the codes live across
    // the devboard modules + helpers after the S257 split)
    for (const code of ['sprint_active_exists', 'sprint_active', 'sprint_completed', 'duplicate', 'draft_exists', 'invalid_input', 'cycle']) {
      expect(doc).toContain(code)
      expect(`${sprints}\n${tasks}\n${helpers}`).toContain(code)
    }
  })
})

// ---------------------------------------------------------------------------
// S247-ADD 4 — §23-11 + visual §6-3: the priority ribbon unchanged. The S144
// banner (prio-banner prio-<p> + the long label) stays the card's first child
// in BOTH renderers; the deadline/dep rows join later in the body; no feature
// row carries a prio-* class (the three concerns never merge).
// ---------------------------------------------------------------------------
describe('S247 — §23-11/visual §6-3 the priority ribbon unchanged', () => {
  it('the PRIORITY RIBBON unchanged (§23-11 + visual §6-3): the banner stays the card', () => {
    const bp = readPublic('js/board-page.js')
    // the /kanban card: the wrap carries data-priority + the banner is the
    // FIRST child (S144's grammar, untouched by Phases 3-7)
    expect(bp).toContain(`'<div class="pd-task-wrap" data-task-card="' + task.id + '" data-priority="' + (task.priority || 'medium') + '">' + prioBanner +`)
    expect(bp).toContain("'<button type=\"button\" class=\"prio-banner prio-' + (task.priority || 'medium') + '\" data-db-cycle-prio=")
    // the server twin: the same banner, the same first-child slot
    const dh = readRepo('src/routes/projects/detail-helpers.ts')
    expect(dh).toContain('class="prio-banner prio-${t.priority || \'medium\'}" data-pd-cycle-prio')
    // independence: the new rows carry their OWN class families — no prio-*
    // class ever rides a due/dep element (§2's four-concept separation)
    const css = readPublic('css/devboard.css')
    for (const line of css.split('\n')) {
      if (line.includes('.db-due-row') || line.includes('.db-dep-badge') || line.includes('.db-sprint-badge')) {
        expect(line.match(/prio-/)?.length ?? 0, `a feature row must not carry a priority class: ${line.trim()}`).toBe(0)
      }
    }
    // the dep badge + deadline row render AFTER the ribbon's banner in the card
    // body (the seam: sprint row → deadline row → dep row — pinned in
    // sprint-ui-s246; cited here as the ribbon-side of the contract)
    expect(bp).toContain('sprintRowHtml +')
    expect(bp).toContain('deadlineHtml +')
    expect(bp).toContain('depHtml +')
  })
})

// ---------------------------------------------------------------------------
// S247-ADD 5 — §24-6: the SAME INSTANT both ways. Gregorian and Jalali are two
// displays of one underlying instant (§17). The dueDayLabel seam renders the
// EN month form and the FA Jalali form from the SAME millisecond — this pin
// proves both names agree on that day through the real vendored converter.
// ---------------------------------------------------------------------------
describe('S247 — §24-6 the same instant both ways (dueDayLabel)', () => {
  it('the SAME INSTANT both ways (§24-6 — the dueDayLabel seam): the EN label and the FA label name the SAME day', () => {
    const sandbox: Record<string, unknown> = {
      window: {},
      document: { addEventListener() {} },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      console,
    }
    const win = sandbox.window as Record<string, unknown>
    runInNewContext(readPublic('vendor/jalaali.min.js'), sandbox, { filename: 'jalaali.min.js' })
    runInNewContext(readPublic('js/devboard.js'), sandbox, { filename: 'devboard.js' })
    // the REAL FA dictionary (the i18n-parity loader's pattern) drives t() so the
    // FA render is the shipped Persian copy, not the EN fallbacks
    const dictSandbox: Record<string, unknown> = { window: {} }
    runInNewContext(readPublic('js/i18n-fa.js'), dictSandbox, { filename: 'i18n-fa.js', timeout: 5000 })
    const faDict = (dictSandbox.window as Record<string, Record<string, string>>).__hibanaDictFA
    expect(faDict && typeof faDict === 'object').toBe(true)
    const B = win.HibanaBoard as Record<string, (...a: unknown[]) => unknown>
    // dueDayLabel is the internal seam — reached through the row render: the
    // EN row and the FA row of ONE task must both carry the SAME day number
    // (the Gregorian date and its Jalali conversion of the identical instant).
    const NOW = Date.UTC(2026, 10, 6, 12, 0, 0)
    const dueMs = NOW + 15 * 86400000 // Nov 21, 2026 → 1405/08/30
    const task = { id: 't1', title: 'T', status: 'in_progress', effective_due_at: new Date(dueMs).toISOString(), effective_due_source: 'task', effective_due_origin_at: new Date(NOW).toISOString() }
    // the EN render FIRST (no i18n stub — the EN fallbacks), then the FA render
    // with the real dictionary driving t() (the t() seam reads the global stub,
    // the lang argument only steers the calendar — so the stub installs between)
    const en = B.deadlineRowHtml(task, 'en', NOW) as string
    win.hibanaI18n = { t: (k: string) => faDict[k], lang: () => 'fa' }
    const fa = B.deadlineRowHtml(task, 'fa', NOW) as string
    expect(en).toContain('Nov 21')
    expect(en).toContain('15 days left')
    // the FA row names the SAME day in the Jalali calendar through the SAME
    // vendored converter the calendar page uses (1405/08/30 → '۳۰ آبان')
    expect(fa).toContain('مهلت ۳۰ آبان') // 'Due {d}' → 'مهلت {d}' — one instant, both calendars
    expect(fa).toContain('۱۵ روز مانده')
    // the vendored converter is the single truth for both spellings
    const j = (win.jalaali as { toJalaali: (y: number, m: number, d: number) => { jy: number; jm: number; jd: number } }).toJalaali(2026, 11, 21)
    expect([j.jy, j.jm, j.jd]).toEqual([1405, 8, 30])
  })
})

// ---------------------------------------------------------------------------
// S247 — the public/ hygiene block: this round touched ONE public file
// (devboard.css — the WCAG-AA state-text fix). The ?v= bumps + the sw.js
// ladder + the tripwire pins moved with it (the s237/s238/s242/s243/s244/
// s245/s246 pins re-pinned in place with citations).
// ---------------------------------------------------------------------------
describe('S247 — the public/ hygiene (the cache-bust ladder moved with the fix)', () => {
  it('devboard.css is at v47 on all 19 carrier pages (the S256 FE-5 head swap moved board/sprint/projects/project onto the per-page bundles; S258 bumped the sheet for the FE-9 strip + the FE-18 submenu) and sw.js is at hibana-v465 with the S260 carrier note', () => {
    const sw = readPublic('sw.js')
    expect(sw.includes('const VERSION = "hibana-v465"')).toBe(true)
    expect(sw.includes('// v465 (S260)')).toBe(true)
    // the AA fix values are the shipped ones (the a11y e2e pins the rendered ratios)
    const css = readPublic('css/devboard.css')
    expect(css).toContain('.db-due-row.st-comfortable { color: #4d6b4d; }')
    expect(css).toContain('.db-due-row.st-approaching { color: #8a6428; }')
    expect(css).toContain('.db-dep-badge.st-blocked { color: #8a6428;')
    expect(css).toContain('.db-dep-badge.st-ready { color: #4d6b4d;')
    // S256 (FE-5): the individual-sheet carriers are the pages OUTSIDE the Projects
    // section's bundle set — 19 pages carry devboard.css?v=47 (23 before the swap; S258
    // moved it v46→v47); the four bundle pages carry it INSIDE board-bundle/
    // projects-bundle (guarded by check-css-bundles).
    const dir = join(process.cwd(), 'public')
    const pages = readdirSync(dir).filter((f) => f.endsWith('.html') && !['board.html', 'sprint.html', 'projects.html', 'project.html'].includes(f))
    const carriers = pages.filter((p) => readFileSync(join(dir, p), 'utf8').includes('/css/devboard.css?v=47'))
    expect(carriers.length).toBe(19)
  })
})
