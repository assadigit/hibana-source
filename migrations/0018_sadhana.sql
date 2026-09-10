-- 0018: Sadhana — standalone quadrant task board (user spec 2026-08-25).
-- A personal 2×2 task board: four behaviorally identical quadrants (Q1 Today,
-- Q2 Strategic, Q3 Urgent & High Value, Q4 Personal & Sentimental) with manual
-- assignment only. Rule 1: every table is user-scoped. Rule 3: timestamps UTC ISO;
-- calendar dates ('YYYY-MM-DD') are display dates resolved in the user's timezone.

CREATE TABLE sadhana_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quadrant INTEGER NOT NULL CHECK (quadrant IN (1, 2, 3, 4)),
  title TEXT NOT NULL,                              -- cap 255 (schema rule; UI never warns)
  emoji TEXT NOT NULL DEFAULT '📌',
  fuzzy TEXT CHECK (fuzzy IN ('tom', '48h', 'week', 'mon', '3mo', '6mo', 'ny') OR fuzzy IS NULL),
  due_date TEXT,                                    -- exact deadline, 'YYYY-MM-DD' (display date)
  due_time TEXT,                                    -- optional 'HH:MM' alongside due_date
  done INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,                                  -- soft delete; undo window + no purge (spec §7)
  pinned INTEGER NOT NULL DEFAULT 0,
  cleared_at TEXT,                                  -- Monday sweep stamp; cleared = archive only
  position INTEGER NOT NULL DEFAULT 0,              -- manual order inside the quadrant
  progress TEXT NOT NULL DEFAULT 'untouched' CHECK (progress IN ('untouched', 'in_progress', 'on_hold')),
  note TEXT NOT NULL DEFAULT '',
  recurring INTEGER NOT NULL DEFAULT 0,
  recur_type TEXT CHECK (recur_type IN ('daily', 'weekly', 'ndays', 'monthly') OR recur_type IS NULL),
  recur_config TEXT NOT NULL DEFAULT '',            -- weekly '0,2,4' (Mon=0) | ndays '7' | monthly '1'
  recur_last TEXT,                                  -- last completion/reset 'YYYY-MM-DD'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sadhana_quad ON sadhana_tasks(user_id, quadrant, position);
CREATE INDEX idx_sadhana_board ON sadhana_tasks(user_id, done, deleted_at);

CREATE TABLE sadhana_tags (
  task_id TEXT NOT NULL REFERENCES sadhana_tasks(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag IN ('w', 'p', 'sg', 'so', 'h')),
  PRIMARY KEY (task_id, tag)
);

CREATE TABLE sadhana_updates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES sadhana_tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,                               -- cap 500
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sadhana_updates ON sadhana_updates(task_id);

CREATE TABLE sadhana_recur_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES sadhana_tasks(id) ON DELETE CASCADE,
  completed_on TEXT NOT NULL,                       -- 'YYYY-MM-DD' of the check-off
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sadhana_recur_hist ON sadhana_recur_history(task_id);

CREATE TABLE sadhana_reminder_logs (
  task_id TEXT NOT NULL REFERENCES sadhana_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('7d', '3d', '1d', '0d', '2h')),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (task_id, kind)                       -- each reminder fires at most once per task
);

CREATE TABLE sadhana_quadrant_names (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quadrant INTEGER NOT NULL CHECK (quadrant IN (1, 2, 3, 4)),
  name TEXT NOT NULL,                               -- 1..60 chars, stored trimmed, shown as-is
  PRIMARY KEY (user_id, quadrant)
);