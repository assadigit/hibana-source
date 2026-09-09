-- 0029: Dev-board + sprint roadmap (user design 2026-08-29, "untitled scribbles").
-- Per-project development tasks with a 4-stage flow (idea → planned → in_progress → done),
-- user-generated work categories ("Feature Development", "UI/UX"…), and open-ended sprints
-- (no fixed length — started when created, ended when the user says so).
-- Tasks are intentionally SEPARATE from hurdles/problems (user decision 2026-08-29:
-- hurdles are reminders of where one is stuck; dev tasks are the serious backlog).

CREATE TABLE sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,               -- stamped at creation (= today): ◆ marker position
  ended_at TEXT,                          -- NULL while the sprint is open (user finishes it manually)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sprints_project ON sprints(project_id);

CREATE TABLE task_categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8AB8F0',  -- pastel chip/bar color (user-picked from a palette)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_categories_project ON task_categories(project_id);

CREATE TABLE dev_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','planned','in_progress','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category_id TEXT REFERENCES task_categories(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,  -- board order within a status column (manual drag)
  created_at TEXT NOT NULL,               -- timeline bar start (date the task was born)
  done_at TEXT                            -- timeline bar end (stamped when status → done)
);
CREATE INDEX idx_dev_tasks_project ON dev_tasks(project_id);
CREATE INDEX idx_dev_tasks_sprint ON dev_tasks(sprint_id);

-- Free labels on dev tasks — reuses the existing user-scoped tags table so a tag like
-- "UI/UX" spans projects, tasks and the old project chips (user request 2026-08-29).
CREATE TABLE dev_task_tags (
  task_id TEXT NOT NULL REFERENCES dev_tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_dev_task_tags_tag ON dev_task_tags(tag_id);
