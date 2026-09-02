-- 0037: spark folders — named shelves sparks can be filed into (batch s, 2026-08-31).
-- A folder is a labeled bucket on the Ideas shelf; sparks keep their user scoping
-- (rule 1) and unfiled sparks simply have folder_id NULL. Deleting a folder files its
-- sparks back to the shelf (ON DELETE SET NULL) — no spark is ever lost with its
-- folder. Plain ADD COLUMN: the projects table (rebuilt in 0031) keeps its CHECK
-- constraints, so no rebuild is needed.

CREATE TABLE spark_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_spark_folders_user ON spark_folders(user_id);

ALTER TABLE projects ADD COLUMN folder_id TEXT REFERENCES spark_folders(id) ON DELETE SET NULL;
-- Rule 9: the Ideas shelf filters by folder (folder_id IS NULL / folder_id = ?).
CREATE INDEX idx_projects_folder ON projects(folder_id);
