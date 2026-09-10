-- 0046_project_archives.sql
-- A permanent archive for done dev_tasks (user request 2026-09).
-- The Done column on the devboard can be "archived" — done tasks move here instead of
-- being hard-deleted. They're viewable in a project's Archives section + restorable.
-- This is distinct from the "Clear" action (which hard-deletes without archiving).
CREATE TABLE IF NOT EXISTS project_archives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  priority TEXT NOT NULL DEFAULT 'medium',
  category_id TEXT,
  sprint_id TEXT,
  done_at TEXT,
  original_created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_archives_project_id ON project_archives (project_id);
CREATE INDEX IF NOT EXISTS idx_project_archives_archived_at ON project_archives (archived_at);
