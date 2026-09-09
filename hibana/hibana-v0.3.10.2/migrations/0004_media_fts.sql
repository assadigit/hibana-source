-- 0004: screenshots + changelogs + FTS5 search (Phase 1)
-- Files live in the GitHub assets repo; D1 stores only paths (spec §8).

CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_path TEXT NOT NULL,                       -- /{user_id}/{project_id}/screenshots/... (§15)
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_screenshots_project ON screenshots(project_id);

CREATE TABLE changelogs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',           -- plain-text mirror so FTS5 can index it (§4.7)
  uploaded_at TEXT NOT NULL
);
CREATE INDEX idx_changelogs_project ON changelogs(project_id);

-- Full-text search (spec §5.3, exact-match). FTS5 is SQLite-only — this is the *one*
-- SQL feature that does not port to Postgres, which is why it lives in its own module
-- and nowhere else (search is reached through the Db interface's raw query).
CREATE VIRTUAL TABLE projects_fts USING fts5(title, description, latest_note, content='projects', content_rowid='rowid');
CREATE VIRTUAL TABLE changelogs_fts USING fts5(content_text, content='changelogs', content_rowid='rowid');

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

CREATE TRIGGER changelogs_fts_ai AFTER INSERT ON changelogs BEGIN
  INSERT INTO changelogs_fts(rowid, content_text) VALUES (NEW.rowid, NEW.content_text);
END;
CREATE TRIGGER changelogs_fts_ad AFTER DELETE ON changelogs BEGIN
  INSERT INTO changelogs_fts(changelogs_fts, rowid, content_text) VALUES ('delete', OLD.rowid, OLD.content_text);
END;
CREATE TRIGGER changelogs_fts_au AFTER UPDATE ON changelogs BEGIN
  INSERT INTO changelogs_fts(changelogs_fts, rowid, content_text) VALUES ('delete', OLD.rowid, OLD.content_text);
  INSERT INTO changelogs_fts(rowid, content_text) VALUES (NEW.rowid, NEW.content_text);
END;