-- 0002: projects + project_history_log (Phase 1)
-- Rule 1: projects is user-owned — user_id on the table AND on every query against it.
-- Rule 3: timestamps UTC. deleted_at enables soft-delete + 7-day purge (Q2 decision).

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'client')),
  status TEXT NOT NULL DEFAULT 'spark' CHECK (status IN ('spark', 'pending', 'building', 'working', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,          -- manual drag-reorder within its status group (§5.3)
  latest_note TEXT NOT NULL DEFAULT '',           -- pinned "where I left off" (spec §4.1)
  progress_percent INTEGER,                       -- manual override; null = computed (spec §4.1)
  archived_state TEXT CHECK (archived_state IN ('online', 'offline')), -- set once archived (§4.1)
  client_name TEXT,                               -- client-type only, plain text (§4.15)
  due_date TEXT,                                  -- client-type only
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT                                 -- soft delete; purge cron clears after 7 days
);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_user_status ON projects(user_id, status);
CREATE INDEX idx_projects_user_updated ON projects(user_id, updated_at);
CREATE INDEX idx_projects_deleted ON projects(deleted_at); -- purge scan

-- The running "where I left off" log beneath the pinned note (§4.2).
CREATE TABLE project_history_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_history_project ON project_history_log(project_id);

-- One-time password-reset codes (token stored hashed, short-lived). Only used in the
-- Brevo email path (spec §8); kept server-side like sessions, never committed anywhere.
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_resets_user ON password_resets(user_id);