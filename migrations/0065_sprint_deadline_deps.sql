-- 0065 (S240 — the Sprint/Deadline/Dependency feature pack, Phase 1:
-- Hibana-Sprint-Deadline-Implementation-Pack, specs/Hibana-Sprint-and-Deadline-System-Spec.md
-- §4-8 sprints, §9-13 deadlines, §14-16 dependencies, §19 data integrity).
--
-- BEFORE: the sprint lifecycle was IMPLICIT (is_draft + ended_at — the timeline-window
-- model; D1 in the pack's discrepancy register): draft/running/finished were derived,
-- there was no Paused state, no emoji identity, no per-sprint due date, no updated_at
-- (the sync gap the API contract flagged — D8), tasks carried NO deadline columns (D7),
-- there was NO dependency table at all (D7), and archived rows lost their sprint
-- identity the moment the sprint was deleted (D3 — AP-27 nulled the FK silently).
-- Finishing a sprint stamped ended_at but archived nothing (D4).
-- AFTER: sprints carry an explicit status (planned|active|paused|completed — backfilled
-- from the legacy pair exactly as the pack's D1 resolution pins it), optional emoji,
-- optional due date + due-origin (the progress-start stamp — spec §12.2/Part VI
-- assumption 1), and updated_at. dev_tasks gain the same optional personal-deadline
-- pair (personal-over-inherited precedence is resolved at read time; storage is one
-- ISO-8601 instant per level). dev_task_deps links tasks blocker→blocked within one
-- project (cycle prevention is a service-layer DFS/CTE — the table only forbids the
-- trivial self edge). project_archives gains a sprint-name snapshot so a deleted
-- sprint's history survives as "Sprint: <name> (deleted)" instead of dangling.
--
-- ADDITIVE ONLY (the standing migration law — safe in BOTH deploy orders):
--   • new columns + old code: every pre-S240 query selects specific columns or * —
--     appended nullable columns change nothing for old readers/writers.
--   • old columns + new code: the service layer stamps status/updated_at on every
--     write and coalesces NULL statuses via the legacy derivation (a lagging D1
--     behaves exactly like a migrated one — no paused rows can pre-exist).
-- No NOT NULL on the backfilled `status` column (SQLite cannot ADD COLUMN with a
-- non-constant default; the one-active/valid-state rules are enforced in the service
-- layer + the partial unique index below — never via the column definition).
-- `started_at`/`ended_at` STAY the timeline's band edges (history rendering);
-- `status` is the lifecycle truth and every writer keeps the two representations in
-- lock-step (ended_at NOT NULL ⇔ completed).

-- ---- sprints: explicit lifecycle (D1) ----------------------------------------------

ALTER TABLE sprints ADD COLUMN status TEXT;

-- The D1 backfill (verbatim from the pack's resolution): finished windows → completed,
-- drafts → planned, open windows → active. Paused does not exist yet — only the new
-- pause endpoint (S240 service layer) can produce it.
UPDATE sprints SET status = CASE WHEN ended_at IS NOT NULL THEN 'completed' WHEN is_draft = 1 THEN 'planned' ELSE 'active' END;

-- Defensive one-active normalization BEFORE the partial index: legacy data that
-- somehow carries TWO open windows in one project (direct DB edits — the service layer
-- has enforced one-open since 0030) would make the CREATE UNIQUE INDEX below fail and
-- roll the whole migration back. Keep the LATEST open window as 'active', park the
-- older ones as 'paused' (windows stay open — resumable). No rows are deleted; on
-- healthy data this is a no-op.
UPDATE sprints SET status = 'paused' WHERE status = 'active' AND EXISTS (
  SELECT 1 FROM sprints x
  WHERE x.project_id = sprints.project_id AND x.status = 'active'
    AND (x.started_at > sprints.started_at OR (x.started_at = sprints.started_at AND x.id > sprints.id))
);

-- The one-active invariant at the persistence layer (spec §5.1): a partial unique
-- index — SQLite and D1 both support it. The service layer checks first (to answer
-- 409 with the active sprint's id); this index is the belt if two writes race the
-- check (a D1 batch can't wrap read-modify-write atomically).
CREATE UNIQUE INDEX idx_sprints_one_active ON sprints(project_id) WHERE status = 'active';

ALTER TABLE sprints ADD COLUMN emoji TEXT;          -- optional identity (§4.2; NULL = default sprint glyph)
ALTER TABLE sprints ADD COLUMN due_at TEXT;         -- optional sprint-level deadline (§9; ISO-8601 instant)
ALTER TABLE sprints ADD COLUMN due_origin_at TEXT; -- progress START stamp (§12.2) — first assignment; edits preserve, clear+re-add resets
ALTER TABLE sprints ADD COLUMN updated_at TEXT;    -- every write stamps it (D8 — the sync gap; NULL on legacy rows, readers coalesce)

-- ---- dev_tasks: personal deadlines (D7) --------------------------------------------

ALTER TABLE dev_tasks ADD COLUMN due_at TEXT;         -- optional personal deadline (§9; ISO-8601 instant)
ALTER TABLE dev_tasks ADD COLUMN due_origin_at TEXT; -- progress START stamp (§12.2) — same set/edit/clear/reset rules

-- ---- dev_task_deps: task dependencies (D7) ------------------------------------------

-- One row = "blocker_task_id blocks blocked_task_id" (spec §14: the user enters
-- Blocked-by; the reverse Blocks view is derived). Project-wide within ONE Kanban
-- project (same-project is enforced in the service layer via ownedTask on both ends —
-- there is no project_id column to constrain here, by design); cycles are prevented
-- in the service layer (recursive-CTE reachability); the table-level CHECK only
-- forbids the trivial self edge. ON DELETE CASCADE: a deleted task takes its links
-- (a dangling half-edge is worse than no edge — spec §16 keeps relationships as
-- history, not as ghosts).
CREATE TABLE dev_task_deps (
  blocker_task_id TEXT NOT NULL REFERENCES dev_tasks(id) ON DELETE CASCADE,
  blocked_task_id TEXT NOT NULL REFERENCES dev_tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_task_id, blocked_task_id),
  CHECK (blocker_task_id <> blocked_task_id)
);
CREATE INDEX idx_dev_task_deps_blocker ON dev_task_deps(blocker_task_id);
CREATE INDEX idx_dev_task_deps_blocked ON dev_task_deps(blocked_task_id);

-- ---- project_archives: the historical sprint label (D3) -----------------------------

ALTER TABLE project_archives ADD COLUMN sprint_name_snapshot TEXT;
