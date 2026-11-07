-- 0066 (S250 — the Strategies layer, docs/project-kanban/STRATEGIES-SPEC.md).
--
-- The owner's hierarchy: Strategy (broad direction) → Sprint (a push under it) → Task.
-- Before this: sprints sat in a FLAT per-project list; the "why this sprint" layer lived
-- only in the owner's head. The spec pack adds the missing tier with every decision
-- owner-approved in-session (2026-11-07 — the spec's §2 decision table is the written
-- approval Agents.md rule #4 requires).
--
-- BEFORE: no strategies table; sprints carry no strategy_id. AFTER: a per-project
-- strategy registry (name + optional description/emoji, the REUSED task priority
-- vocabulary, an explicit active|paused|completed lifecycle mirroring the sprint
-- grammar) and a nullable sprints.strategy_id FK.
--
-- ADDITIVE ONLY (the standing migration law — safe in BOTH deploy orders):
--   • new table + new column: every pre-S250 query selects specific columns or * —
--     an appended nullable column changes nothing for old readers/writers.
--   • the devboard payload's new 8th key `strategies` carries a catch→[] belt, so a
--     lagging pre-0066 D1 serves the board gracefully (the categories-belt pattern).
--
-- Design pins (spec §3):
--   • sprints.strategy_id is NULLABLE — an unassigned sprint stays valid (owner decision
--     #2: assignment is optional, capture stays fast); one strategy per sprint keeps the
--     roll-up math honest (done/total across ITS sprints' tasks).
--   • ON DELETE SET NULL: deleting a strategy never destroys sprint history (the "safe
--     for my ideas" rule — the category delete grammar, not the project one).
--   • NOT NULL DEFAULT on the new table's columns is LEGAL here (the ADD COLUMN
--     non-constant-default restriction only applies to ALTERs) — a fresh table can pin
--     its CHECKs at creation, unlike the 0065 backfilled sprints.status.
--   • ONE-ACTIVE-SPRINT STAYS PER-PROJECT (owner decision #7 — solo focus; strategies
--     never relax the 0065 invariant).
--   • sort_order exists for a future manual drag; v1 sorts priority-first then
--     oldest-first (the task-column rule).

CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  emoji TEXT,                                -- optional identity (the sprint emoji token grammar; NULL = the default ⚑ glyph)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT                            -- stamped on every write (the D8 sync doctrine)
);
CREATE INDEX idx_strategies_project ON strategies(project_id);

ALTER TABLE sprints ADD COLUMN strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL;
CREATE INDEX idx_sprints_strategy ON sprints(strategy_id);
