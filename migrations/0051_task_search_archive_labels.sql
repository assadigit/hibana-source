-- 0051 (2026-09-12, Session 30 — user request batch): three changes in one train.
--
-- (a) REMOVE the manual progress override (user request: "remove the whole thing and
--     its function"). The pd-progress slider/milestone-chips/Auto-toggle/note UI is
--     gone from every surface; progress is ALWAYS the computed formula (dev tasks
--     done/total, else hurdles solved/total — 0002's Auto). Existing overrides return
--     to Auto, and the 0050 timeline table is dropped with it (its only writer was
--     the removed UI). projects.progress_percent (0002) stays as a column — harmless,
--     now always NULL — so no wide table rewrite is needed.
-- (b) B1: archived done tasks keep their labels. dev_task_tags rows CASCADE away with
--     the task, so archive-done now snapshots the tag names into project_archives.tags
--     (JSON) and restore relinks them (find-or-create by name).
-- (c) B3: dev_tasks enter the FTS index — title + label names. search_tags is a
--     denormalized space-joined tag-name column on dev_tasks, maintained by the app
--     (setTaskTags / tag endpoints / restore) so the external-content FTS5 table +
--     triggers stay in sync exactly like 0040's tables.
UPDATE projects SET progress_percent = NULL WHERE progress_percent IS NOT NULL;
DROP TABLE IF EXISTS project_progress_log;

ALTER TABLE project_archives ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

ALTER TABLE dev_tasks ADD COLUMN search_tags TEXT NOT NULL DEFAULT '';

-- Backfill search_tags from existing links (correlated group_concat; no triggers
-- exist yet, so this pre-index pass is a plain column write).
UPDATE dev_tasks SET search_tags = COALESCE(
  (SELECT group_concat(tg.name, ' ') FROM dev_task_tags tt JOIN tags tg ON tg.id = tt.tag_id
   WHERE tt.task_id = dev_tasks.id), '');

CREATE VIRTUAL TABLE dev_tasks_fts USING fts5(
  title, search_tags,
  content='dev_tasks', content_rowid='rowid'
);
CREATE TRIGGER dev_tasks_fts_ai AFTER INSERT ON dev_tasks BEGIN
  INSERT INTO dev_tasks_fts(rowid, title, search_tags) VALUES (NEW.rowid, NEW.title, NEW.search_tags);
END;
CREATE TRIGGER dev_tasks_fts_ad AFTER DELETE ON dev_tasks BEGIN
  INSERT INTO dev_tasks_fts(dev_tasks_fts, rowid, title, search_tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.search_tags);
END;
CREATE TRIGGER dev_tasks_fts_au AFTER UPDATE ON dev_tasks BEGIN
  INSERT INTO dev_tasks_fts(dev_tasks_fts, rowid, title, search_tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.search_tags);
  INSERT INTO dev_tasks_fts(rowid, title, search_tags) VALUES (NEW.rowid, NEW.title, NEW.search_tags);
END;

-- Index backfill: FTS5's canonical 'rebuild' — re-reads every row from the content
-- table and rewrites the index whole. Idempotent, and (unlike the delete-then-insert
-- dance 0040 used) it CANNOT fail on a populated content table: the 'delete' command
-- against an index that doesn't yet hold a row errors with SQLITE_CORRUPT_VTAB
-- ("database disk image is malformed") on modern SQLite — the rebuild command exists
-- precisely for this first-indexing case.
INSERT INTO dev_tasks_fts(dev_tasks_fts) VALUES('rebuild');
