-- 0067 (S253 — Phase 2 of the Projects-section audit remediation, the owner-approved
-- docs/project-kanban/AUDIT-REMEDIATION-SPEC.md §5; owner approval = the spec's header
-- quote "Ok you have all approval of me to do this in phases." over the audit that
-- catalogued DB-1/DB-2 — Agents.md rule #4's written approval, cited here).
--
-- ADDITIVE ONLY, IF NOT EXISTS-guarded: four indexes, zero data changes, zero column
-- changes. Safe in BOTH deploy orders (code-first on a lagging D1: the pre-checks still
-- exist; D1-first with lagging code: the indexes only fire on a genuine check-then-insert
-- race, which previously produced a raw 500).
--
-- Belt-first verification (the §5 ritual, run 2026-11-08 against BOTH live D1s from the
-- fresh pre-0067 dumps, restore-verified): ZERO sprint name case-twins, ZERO multi-draft
-- projects, ZERO strategy name case-twins, ZERO tag case-twins — nothing to park, so this
-- migration creates indexes only (no normalization statements; the spec's " (2) suffix"
-- parking lane was not needed and is deliberately absent).
--
-- DB-1: idx_project_archives_sprint — the audit's ONLY EQP-verified full SCAN:
--   sprint delete re-points archives (UPDATE project_archives SET sprint_id = NULL
--   WHERE sprint_id = ?, devboard.ts) on the one monotonically-growing table (prod is
--   at 149 rows and it never shrinks). The table already carries project_id + archived_at
--   indexes (0046); sprint_id was the unindexed column.
--
-- DB-2 / BE-8: the TOCTOU belts — one-draft-per-project and the case-insensitive
-- project-scoped name uniqueness (sprints + strategies) were app-level check-then-insert
-- only; two racing writes could both pass the check and both insert (a D1 batch cannot
-- wrap read-modify-write atomically — the same gap 0065's idx_sprints_one_active closed
-- for the one-active invariant, that index is the precedent).
--   • idx_sprints_one_draft (partial): one DRAFT per project, exactly the 0034 rule the
--     POST /sprints handler checks (draft_exists 409).
--   • idx_sprints_project_name / idx_strategies_project_name (expression uniques on
--     lower(trim(name))): the SAME fold sprintNameTaken/strategyNameTaken apply at the
--     write-time gate (S240 §4.3 grammar, the idx_categories_user_name_live precedent of
--     0064) — pre-existing legacy case-twins would block creation, and the belt-first
--     probe above proves there are none.
--   The paired code change (S253) catches these violations at the INSERT/UPDATE sites
--   and maps them to the EXISTING 409 codes (duplicate / draft_exists) — never a raw 500.
--
-- Out of scope (spec §15, do not add here): composite (project_id,status) indexes, CHECK
-- on sprints.status, any timestamp type change.

-- DB-1: the only EQP-verified full scan (sprint delete re-points archives)
CREATE INDEX IF NOT EXISTS idx_project_archives_sprint ON project_archives(sprint_id);

-- DB-2 / BE-8: TOCTOU belts (data verified clean 2026-11-08: zero twins, zero multi-drafts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_one_draft ON sprints(project_id) WHERE is_draft = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_project_name ON sprints(project_id, lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategies_project_name ON strategies(project_id, lower(trim(name)));
