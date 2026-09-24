-- 0061 (S126): dev_tasks.updated_at — the owner's overview contract is "recent =
-- last-updated, NOT last-born": an old item that was just edited must outrank a
-- newer untouched one in the Plans / Problems / In Progress cards. No per-task
-- stamp existed (task edits only bumped the owning PROJECT's updated_at), so the
-- dashboard could not sort truthfully. This is the minimal additive change that
-- implements exactly what the owner asked for (explicit written instruction,
-- 2026-09-24 round) — flagged in Changelogs §1 per the Agents.md schema rule.
--
-- ADDITIVE + nullable, so it is safe in BOTH deploy orders:
--   • new column + old code: the pre-S126 queries never reference it.
--   • old column + new code: loadOverviewData / the ov-tasks route carry the S57
--     deploy-ahead-of-D1 belt (fallback to the born-order query on "no such column").
ALTER TABLE dev_tasks ADD COLUMN updated_at TEXT;

-- Backfill: done_at is the last meaningful transition a DONE task ever had; every
-- other task was born at created_at and (no stamp existing) never moved since.
UPDATE dev_tasks SET updated_at = COALESCE(done_at, created_at);

-- Rule 9 (index the hot filter/sort): the overview sorts by updated_at within a
-- status scan, and the new ov-tasks page does the same across all projects.
CREATE INDEX idx_dev_tasks_updated ON dev_tasks(updated_at);
