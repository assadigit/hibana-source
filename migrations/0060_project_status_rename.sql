-- 0060: the owner's 5-stage pipeline rename (owner round 2026-09-20, message item 11):
-- "Remove unreviewed item from projects types. The states I want:
--    Planning (formerly investigating) → Queued (formerly awaiting execution) →
--    Developing (formerly in progress) → Awaiting Development (formerly development
--    stopped) → Operational (untouched)."
-- 'unreviewed' is RETIRED — its rows fold into the FIRST stage (planning), which also
-- absorbs 'investigating'. 'spark' (the Ideas intake) and 'operational' are untouched.
-- New taxonomy: spark → planning → queued → developing → awaiting_dev → operational.
-- LEGACY mapping (also encoded in validation/schemas.ts LEGACY_STATUS so old clients and
-- legacy bookmark URLs keep working):
--   pending→planning  unreviewed→planning  investigating→planning
--   awaiting→queued   building→developing  doing→developing
--   working→operational  archived→awaiting_dev  halted→awaiting_dev
--
-- The status CHECK constraint can't be ALTERed in SQLite, so this is the 0031 rebuild
-- recipe verbatim: rows stashed aside, the table dropped and recreated under its own
-- name (children's REFERENCES clauses never see a temp name — the 0011/0023 rename dance
-- is unsafe here), the stash copied back with every legacy status mapped to its new
-- stage, indexes + projects_fts triggers recreated exactly as 0002/0004 declared them,
-- and the external-content FTS index rebuilt from the content table afterwards.
-- Column set = 0031's table + 0037 folder_id + 0047 logo_path (the current shape).
-- M10 guard: PRAGMA foreign_keys=OFF around the DROP (the implicit cascade would DELETE
-- child rows the stash doesn't preserve); the Node migration runner sets this OFF before
-- the batch anyway (PRAGMA is a no-op inside a transaction); D1 runs statements
-- separately so the PRAGMA here takes effect directly. Re-enabled at the end.

PRAGMA foreign_keys = OFF;

CREATE TABLE projects_mig AS SELECT id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, folder_id, logo_path, created_at, updated_at, deleted_at FROM projects;

DROP TABLE projects;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'client')),
  status TEXT NOT NULL DEFAULT 'spark' CHECK (status IN ('spark','planning','queued','developing','awaiting_dev','operational')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  latest_note TEXT NOT NULL DEFAULT '',
  progress_percent INTEGER,
  archived_state TEXT CHECK (archived_state IN ('online', 'offline')),
  client_name TEXT,
  due_date TEXT,
  reminders_enabled INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT,          -- 0037: spark folder (NULL = «All»)
  logo_path TEXT,          -- 0047: project logo path (GitHub assets repo; NULL = none)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, folder_id, logo_path, created_at, updated_at, deleted_at)
  SELECT id, user_id, title, description, type,
         CASE status
           WHEN 'pending' THEN 'planning'
           WHEN 'unreviewed' THEN 'planning'
           WHEN 'investigating' THEN 'planning'
           WHEN 'awaiting' THEN 'queued'
           WHEN 'building' THEN 'developing'
           WHEN 'doing' THEN 'developing'
           WHEN 'working' THEN 'operational'
           WHEN 'archived' THEN 'awaiting_dev'
           WHEN 'halted' THEN 'awaiting_dev'
           ELSE status
         END,
         sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, folder_id, logo_path, created_at, updated_at, deleted_at
  FROM projects_mig;

DROP TABLE projects_mig;

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_user_status ON projects(user_id, status);
CREATE INDEX idx_projects_user_updated ON projects(user_id, updated_at);
CREATE INDEX idx_projects_deleted ON projects(deleted_at); -- purge scan

CREATE TRIGGER projects_fts_ai AFTER INSERT ON projects BEGIN
  INSERT INTO projects_fts(rowid, title, description, latest_note)
  VALUES (NEW.rowid, NEW.title, NEW.description, NEW.latest_note);
END;
CREATE TRIGGER projects_fts_ad AFTER DELETE ON projects BEGIN
  INSERT INTO projects_fts(projects_fts, rowid, title, description, latest_note)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.latest_note);
END;
CREATE TRIGGER projects_fts_au AFTER UPDATE ON projects BEGIN
  INSERT INTO projects_fts(projects_fts, rowid, title, description, latest_note)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.latest_note);
  INSERT INTO projects_fts(rowid, title, description, latest_note)
  VALUES (NEW.rowid, NEW.title, NEW.description, NEW.latest_note);
END;

-- Repopulate the external-content FTS5 index from the rebuilt content table (0004).
INSERT INTO projects_fts(projects_fts) VALUES('rebuild');

PRAGMA foreign_keys = ON;
