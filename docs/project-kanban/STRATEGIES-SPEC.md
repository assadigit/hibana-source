# Hibana Strategies — Spec (S250, 2026-11-07)

**Status: APPROVED by the owner (Ali) — all decision questions answered in-session, 2026-11-07.**
Owner approval covers migration 0066 per Agents.md rule #4 (schema changes need written
approval — the decision table below IS that approval).

## 1. The idea (owner's words)

> I have some strategies: like "Make website more to be seen". Then it becomes a sprint like
> "SEO". Then it becomes tasks of the SEO sprint: X Y Z. So every project has:
> 1. Strategy (broad) 2. Sprints 3. Tasks.
> In sprint page, I want a special section on top which shows the strategies, their priority etc.

The hierarchy today has a hole: **Strategy doesn't exist**. Sprints sit in a flat per-project
list. This pack adds the missing layer between project and sprint.

## 2. The owner's decision table (locked 2026-11-07)

| # | Question | Decision |
|---|---|---|
| 1 | Strategy field on task cards? | **NO** — strategies are visible on the sprint page only |
| 2 | Every sprint needs a strategy? | **No** — optional; unassigned sprints stay valid |
| 3 | Priority vocabulary | **Reuse** the task vocabulary (low/medium/high/urgent — same colors, same i18n) |
| 4 | Strategy lifecycle | **Active / Paused / Completed** (mirrors the sprint lifecycle grammar) |
| 5 | Progress roll-up | **Derived purely from its sprints' tasks** (done/total) |
| 6 | Strategy fields | **Title + optional description** (+ optional emoji) |
| 7 | One-active-sprint invariant | **Keep per-project** (solo focus; NOT per-strategy) |
| 8 | Strategy emoji | **Yes, optional** (the sprint emoji grammar: one picker token, `⚑` default) |
| 9 | Completing a strategy with an active sprint | **BLOCK** — "Finish or pause its active sprint first." |
| 10 | Deleting a strategy | Allowed behind a confirm; sprints survive unassigned (FK ON DELETE SET NULL) |
| 11 | Assignment | Sprint define dialog + detail Settings gain a **strategy dropdown**; assignable = **active + paused** (completed never assignable); re-assign or clear anytime via PATCH (`strategy_id: null` clears) |
| 12 | Later surfaces | Project page / dashboard / reports = **phase 2, NOT this pack** |

Implementation-owner decisions (delegated by the owner, "decide yourself"):
- **Sorting**: strategies sort priority-first (urgent → high → medium → low), then oldest
  first within a tier — the same rule as task columns. `sort_order` column exists for future
  manual drag but v1 has no drag reorder.
- **Starting a sprint whose strategy is completed** → blocked (409): a completed strategy
  is a finished direction; re-assign first. Paused strategies do NOT block.
- **Completing a strategy with planned/paused sprints assigned** → allowed (they are not
  running); the guard fires only on an ACTIVE sprint.
- **Reopening a completed strategy** (PATCH status → active/paused) → always allowed (no
  one-active-strategy invariant exists).
- **Zero-strategy projects** show a slim one-line strip ("⚑ Strategies ＋"), not nothing.

## 3. Data model — migration 0066 (ADDITIVE ONLY, the standing migration law)

```sql
CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX idx_strategies_project ON strategies(project_id);

ALTER TABLE sprints ADD COLUMN strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL;
CREATE INDEX idx_sprints_strategy ON sprints(strategy_id);
```

- New table → NOT NULL DEFAULT is legal (the ADD COLUMN restriction doesn't apply).
- `sprints.strategy_id` is a **nullable FK** — pre-0066 clients and every unassigned sprint
  stay valid; additive column appended = old readers/writers unaffected in BOTH deploy orders.
- `ON DELETE SET NULL`: deleting a strategy never destroys sprint history (the "safe for my
  ideas" rule). This mirrors the category delete grammar, not the project one.
- Every query filters `user_id` via the projects join (rule #1). `project_id` indexed.

## 4. API (additive; every route rides the existing owned-project auth)

**Payload** — GET `/api/projects/:id/devboard` gains the **8th additive key** `strategies`
(sorted priority-first, then created_at; rows are the raw columns). The belt:
`.catch(() => [])` — a lagging pre-0066 D1 serves the board without the key's data, exactly
like the categories belt. The S241 payload-shape test pin is updated to the eight-key set.

**CRUD:**
- `POST /api/projects/:projectId/strategies` — body `{ name, description?, emoji?, priority? }`;
  creates with `status='active'`. 409 `duplicate` on case-insensitive name collision within
  the project (the sprint name grammar, `strategyNameTaken`).
- `PATCH /api/strategies/:id` — any of `{ name?, description?, emoji?, priority?, status? }`.
  Name uniqueness gate (self-excluded). **Status guard**: transitioning to `completed` while
  any sprint with `strategy_id = this` is ACTIVE → 409 `strategy_active_sprint` (owner
  decision #9). Any other transition is free.
- `DELETE /api/strategies/:id` — hard delete behind the UI confirm; assigned sprints fall
  back to `strategy_id = NULL` (the FK does it).

**Sprint write paths** (all guarded the same way):
- `POST /api/projects/:id/sprints` body gains `strategy_id?: string | null`.
- `PATCH /api/sprints/:id` body gains `strategy_id?: string | null` (null clears).
- Guard on both: the referenced strategy must exist, belong to the SAME project, and be
  `active` or `paused` — a completed (or foreign/missing) strategy → 409/404 by case.
- `POST /api/sprints/:id/start` gains the read guard: starting a sprint whose strategy is
  `completed` → 409 `strategy_completed` ("re-assign to an active strategy first").

**Client wrappers** (devboard.js, riding the ONE `api()` choke point — zero new fetch
sites, so the desktop seam counts never move): `createStrategy`, `patchStrategy`,
`deleteStrategy`, `strategyGlyph`, `strategyById`; `createSprint`/`patchSprint` gain the
optional `strategy_id` pass-through. Exported on `window.HibanaBoard` (spec §18 — no forking).

## 5. UI — the sprint page (`/sprint.html?project=…`)

**Placement**: a new `#sp-strategies` section between the toolbar and the draft panel —
"on top", per the owner. Collapsible (chevron; collapsed state persists in localStorage,
the `spHideLanes` pattern).

**Card row** (flat-board grammar: hairline borders, pastel, zero shadows; horizontal wrap):
- Glyph: the strategy emoji or `⚑` default.
- Name (dir=auto) + priority badge (the task priority classes, reused) + status badge
  (active/paused/completed — the sprint badge grammar).
- Roll-up line: `N sprints · D/T tasks` + a progress bar (D/T across its sprints' tasks —
  tasks not in any sprint never count; unassigned sprints count toward nothing).
- If THIS strategy owns the project's current active sprint: a `▸ <sprint name>` line.
- `⋯` menu: Edit / Pause⇄Resume / Complete / Delete (completed cards: Reopen / Delete).
- `＋ New strategy` tile at the row's end opens the editor dialog (name, priority radio,
  emoji picker, description textarea).
- Card body click = **filter toggle**: the timeline + All-sprints list narrow to that
  strategy; the selected card gets the `is-on` look; a second click (or the All chip)
  resets. Draft panel: the filter also applies (a draft sprint carries strategy_id).

**Sprint↔strategy assignment surfaces:**
- The define-sprint dialog (◆) gains a strategy `<select>` (No strategy default; active +
  paused strategies only) — "assign strategy and sprint together", the owner's ask.
- The sprint detail panel's Settings tab gains the same select; Save PATCHes
  `strategy_id` alongside name/version/emoji/due.
- All-sprints list rows gain a small strategy chip (glyph + name) when assigned.
- The strategy card's `⋯` menu gains "New sprint for this strategy" — opens the define
  dialog with the select pre-set (the together-assignment ease path).

**NOT shown**: task cards carry no strategy (owner decision #1). Board page, project page
kanban, task modals — untouched this pack.

## 6. i18n

Every new string lands in BOTH `i18n-en.js` + `i18n-fa.js` (the parity script gates CI).
Keys namespaced `st.*` (strategy) + `db.stg.*` where it reads as board grammar. FA copy
is native Persian, RTL-safe. Numbers render through `faDig` on FA.

## 7. Desktop parity (the owner's standing rule)

1. **Mirror schema v4** (`internal/store/schema.go`): the `strategies` table +
   `sprints.strategy_id` column, same shapes as 0066; the sync engine full-replaces from
   the payload's 8th key (`internal/sync/convert.go` + `api/types.go` StrategyRow).
2. **Island re-pin**: sprint.html + sprint-page.js + devboard.js + devboard.css +
   i18n pair re-pinned to the new web ref; PIN_REF/PIN_PACKAGE_VERSION bumped; seam
   patches re-verified (the new calls all ride `api()` — the 12 fetch-site count holds).
3. Bridge: the Go `Request` allow-list already passes any `/api/…` path — zero transport
   work. Probes updated; version bump 0.1.37 → 0.1.38; worklog + README status row.

## 8. Deploy order (the S249 lesson)

Migration 0066 is additive-only → safe in both orders, but the runbook still applies it
FIRST: bookmark both D1s (`bookmark:dev` / `bookmark:prod`), apply 0066 to pm-app-dev +
pm-app-prod, verify schema 64 → 65, then push to main (CI green → CD auto-deploys). The
payload belt (`catch → []`) keeps a lagging D1 graceful anyway.

## 9. Verification

- Existing suite green (`bun run test`, `typecheck`, `lint`, `check-i18n-parity`) with the
  S241 payload pin updated to the eight-key set.
- Local node-server round: create project → strategies CRUD → assign/re-assign/clear on
  sprints → guards (complete-with-active-sprint 409, start-with-completed-strategy 409,
  completed not assignable) → delete cascade.
- Live: hibana.ir with the owner's test account after deploy.
- Desktop: `go vet` + `go test ./internal/...` + cross-build + island `--check` + probes.
