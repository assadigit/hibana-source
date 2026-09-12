-- 0050 (2026-09-12, S29 agenda 5): richer project progress box.
-- projects.progress_percent (0002) already exists as the manual override; this adds the
-- HISTORY the override never had — every manual change lands in a queryable timeline
-- (pct + optional note + timestamp). pct NULL = "returned to Auto (computed)".
-- Rule 1: user_id on the table and on every query; rule 3: UTC timestamps.
CREATE TABLE project_progress_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pct INTEGER CHECK (pct IS NULL OR (pct >= 0 AND pct <= 100)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_progress_log_project ON project_progress_log(project_id, created_at);
CREATE INDEX idx_progress_log_user ON project_progress_log(user_id);
