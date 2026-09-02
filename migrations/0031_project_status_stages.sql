-- 0031: projects.status re-keyed to the 7-stage pipeline (user redesign 2026-08-31):
-- spark intake, then unreviewed / investigating / awaiting / doing / halted / operational.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt: rows are stashed
-- aside, the table is dropped and recreated under its own name, and the stash copied
-- back with every legacy status mapped to the stage it became — the same mapping the
-- app applies to legacy input (validation/schemas.ts LEGACY_STATUS): pending→unreviewed,
-- building→doing, working→operational, archived→halted ('spark' passes through).
-- The 0011/0023 rename dance does NOT work here: projects is the FK parent of a dozen
-- tables, and ALTER TABLE RENAME rewrites every child table's REFERENCES clause to the
-- quoted temp name in this SQLite (verified empirically on node:sqlite 3.46) — dropping
-- and recreating under the projects name never touches the children's clauses.
-- reminders_enabled (0006, ALTER-appended after deleted_at) returns to its logical slot
-- before created_at. Dropping projects also drops its indexes and the projects_fts
-- triggers (0004): all are recreated exactly as 0002/0004 declared them and the
-- external-content FTS index is rebuilt from the content table afterwards.
-- NOTE for re-runs on populated databases: with foreign_keys=ON the DROP performs an
-- implicit DELETE that fires the children's ON DELETE CASCADE. Fresh databases are
-- unaffected, and the live D1 databases already record this migration in d1_migrations,
-- so it never re-runs there. This file runs inside the migration runner's own
-- transaction: no BEGIN/COMMIT (rule 4).

CREATE TABLE projects_mig AS SELECT id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, created_at, updated_at, deleted_at FROM projects;

DROP TABLE projects;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'client')),
  status TEXT NOT NULL DEFAULT 'spark' CHECK (status IN ('spark','unreviewed','investigating','awaiting','doing','halted','operational')),
  sort_order INTEGER NOT NULL DEFAULT 0,          
  latest_note TEXT NOT NULL DEFAULT '',           
  progress_percent INTEGER,                       
  archived_state TEXT CHECK (archived_state IN ('online', 'offline')), 
  client_name TEXT,                               
  due_date TEXT,                                  
  reminders_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT                                 
);

INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, created_at, updated_at, deleted_at)
  SELECT id, user_id, title, description, type,
         CASE status WHEN 'pending' THEN 'unreviewed' WHEN 'building' THEN 'doing' WHEN 'working' THEN 'operational' WHEN 'archived' THEN 'halted' ELSE status END,
         sort_order, latest_note, progress_percent, archived_state, client_name, due_date, reminders_enabled, created_at, updated_at, deleted_at
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
