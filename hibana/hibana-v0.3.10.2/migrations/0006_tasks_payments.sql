-- 0006: tasks + payments — client-work only (spec §4.8 + §4.9)
-- Tasks drive the client progress formula (done ÷ total); payments model partial contracts.

ALTER TABLE projects ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 0; -- opt-in per project (§5.9)

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,               -- SQLite boolean (0/1)
  due_date TEXT,                                 -- per-task date (client only, spec §4.8)
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                           -- "Deposit", "Final payment" (§4.9)
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_payments_project ON payments(project_id);