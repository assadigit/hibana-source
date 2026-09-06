-- 0034: dev_tasks gains the 'bug' status — problems-from-bugs. The project page's
-- Problems tab now lists bug dev-tasks where the hurdle checklist used to sit (hurdles
-- themselves stay untouched: they are reminders of where one is stuck; bugs are the
-- serious defect backlog — same tasks-vs-hurdles split as 0029). SQLite cannot alter a
-- CHECK constraint, so the table is rebuilt. dev_tasks is the FK parent of
-- dev_task_tags, so the 0011/0023 rename dance would rewrite that child's REFERENCES
-- clause to the quoted temp name in this SQLite — rows are stashed aside instead and
-- the table recreated under its own name (same approach as 0031). start_at/end_at
-- (0030, ALTER-appended) are written back inline.
-- M10 fix (2026-09-10): PRAGMA foreign_keys=OFF guards the DROP — same rationale as
-- 0031. Re-enabled at the end of this file.

PRAGMA foreign_keys = OFF;

CREATE TABLE dev_tasks_mig AS SELECT id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at FROM dev_tasks;

DROP TABLE dev_tasks;

CREATE TABLE dev_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','planned','in_progress','done','bug')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category_id TEXT REFERENCES task_categories(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  done_at TEXT,
  start_at TEXT,
  end_at TEXT
);

INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at)
  SELECT id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at FROM dev_tasks_mig;

DROP TABLE dev_tasks_mig;

CREATE INDEX idx_dev_tasks_project ON dev_tasks(project_id);
CREATE INDEX idx_dev_tasks_sprint ON dev_tasks(sprint_id);

PRAGMA foreign_keys = ON;
