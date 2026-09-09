-- 0042: Add status indexes (rule #9 compliance). hurdles, payments, and dev_tasks all
-- carry a status column that the UI filters on ("show open hurdles", "show pending
-- payments", "show in-progress dev-tasks"). The project_id index narrows first, but a
-- status index on top lets SQLite skip the full scan within a project's rows.
-- tasks uses `done` (0/1) instead of status — a done index covers the same query pattern
-- ("show incomplete tasks"). Solo-scale today, but rule #9 says index from the first
-- migration — these were missed. CREATE INDEX IF NOT EXISTS so re-runs are safe.

CREATE INDEX IF NOT EXISTS idx_hurdles_status ON hurdles(status);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_dev_tasks_status ON dev_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
