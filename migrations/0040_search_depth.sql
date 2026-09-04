-- 0040: search depth — FTS5 across quick_notes, backlog_docs, sadhana_tasks, canvas_elements.
-- Gap-matrix Phase B (2026-09-09): the single highest-leverage gap. Ali is keyword-driven
-- ("a keyword or short phrase is enough" — vision.md), so every text surface must be
-- searchable, not just projects. This migration creates 4 external-content FTS5 tables
-- (content='...' + content_rowid='rowid' so SQLite maintains them via triggers, exactly
-- like the existing projects_fts in 0004) and the ai/ad/au triggers for each.
--
-- Scope rules (CLAUDE.md rule 1): every table is user-owned, so search joins the base
-- table on rowid AND filters on user_id + the soft-delete tombstone where one exists.
-- FTS5 itself has no row-level security; the user_id filter lives in the query, not
-- the index — same pattern as projects_fts (search.ts:26).
--
-- quick_notes:        title + content (note text | JSON task-list text). soft-delete via deleted_at.
-- backlog_docs:       title + content. owned through project_id → join projects for user_id.
--                     (no user_id on backlog_docs — rule 1 is satisfied transitively via the project.)
-- sadhana_tasks:      title + note (the per-task journal field). soft-delete via deleted_at.
-- canvas_elements:    content (text for notes/comments/blocks; NOT strokes — point-path JSON
--                     is not text). tombstone is `deleted` (integer 0/1), not deleted_at.
--
-- Why contentless external tables: the base tables already hold the text. content='...' makes
-- FTS5 read from the base row, so there's no data duplication and edits stay in sync via
-- triggers. This is the same pattern 0004 uses for projects_fts.

-- quick_notes ---------------------------------------------------------------
CREATE VIRTUAL TABLE quick_notes_fts USING fts5(
  title, content,
  content='quick_notes', content_rowid='rowid'
);
CREATE TRIGGER quick_notes_fts_ai AFTER INSERT ON quick_notes BEGIN
  INSERT INTO quick_notes_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
END;
CREATE TRIGGER quick_notes_fts_ad AFTER DELETE ON quick_notes BEGIN
  INSERT INTO quick_notes_fts(quick_notes_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
END;
CREATE TRIGGER quick_notes_fts_au AFTER UPDATE ON quick_notes BEGIN
  INSERT INTO quick_notes_fts(quick_notes_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
  INSERT INTO quick_notes_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
END;

-- backlog_docs (user_id resolved through the project join at query time) -----
CREATE VIRTUAL TABLE backlog_docs_fts USING fts5(
  title, content,
  content='backlog_docs', content_rowid='rowid'
);
CREATE TRIGGER backlog_docs_fts_ai AFTER INSERT ON backlog_docs BEGIN
  INSERT INTO backlog_docs_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
END;
CREATE TRIGGER backlog_docs_fts_ad AFTER DELETE ON backlog_docs BEGIN
  INSERT INTO backlog_docs_fts(backlog_docs_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
END;
CREATE TRIGGER backlog_docs_fts_au AFTER UPDATE ON backlog_docs BEGIN
  INSERT INTO backlog_docs_fts(backlog_docs_fts, rowid, title, content) VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
  INSERT INTO backlog_docs_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
END;

-- sadhana_tasks -------------------------------------------------------------
CREATE VIRTUAL TABLE sadhana_tasks_fts USING fts5(
  title, note,
  content='sadhana_tasks', content_rowid='rowid'
);
CREATE TRIGGER sadhana_tasks_fts_ai AFTER INSERT ON sadhana_tasks BEGIN
  INSERT INTO sadhana_tasks_fts(rowid, title, note) VALUES (NEW.rowid, NEW.title, NEW.note);
END;
CREATE TRIGGER sadhana_tasks_fts_ad AFTER DELETE ON sadhana_tasks BEGIN
  INSERT INTO sadhana_tasks_fts(sadhana_tasks_fts, rowid, title, note) VALUES ('delete', OLD.rowid, OLD.title, OLD.note);
END;
CREATE TRIGGER sadhana_tasks_fts_au AFTER UPDATE ON sadhana_tasks BEGIN
  INSERT INTO sadhana_tasks_fts(sadhana_tasks_fts, rowid, title, note) VALUES ('delete', OLD.rowid, OLD.title, OLD.note);
  INSERT INTO sadhana_tasks_fts(rowid, title, note) VALUES (NEW.rowid, NEW.title, NEW.note);
END;

-- canvas_elements (only text-bearing types: note, comment, block. strokes/images/frames/shapes
-- carry point-path JSON or no prose, so indexing them would only add noise. The query filters
-- on type IN ('note','comment','block') so the FTS match never surfaces them even if a stray
-- token slipped through. tombstone is `deleted` integer.) -------------------
CREATE VIRTUAL TABLE canvas_elements_fts USING fts5(
  content,
  content='canvas_elements', content_rowid='rowid'
);
CREATE TRIGGER canvas_elements_fts_ai AFTER INSERT ON canvas_elements BEGIN
  INSERT INTO canvas_elements_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;
CREATE TRIGGER canvas_elements_fts_ad AFTER DELETE ON canvas_elements BEGIN
  INSERT INTO canvas_elements_fts(canvas_elements_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;
CREATE TRIGGER canvas_elements_fts_au AFTER UPDATE ON canvas_elements BEGIN
  INSERT INTO canvas_elements_fts(canvas_elements_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  INSERT INTO canvas_elements_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

-- Backfill existing rows (no-op on a fresh DB; required on the live D1 so pre-existing
-- notes/backlog docs/sadhana tasks/canvas text are searchable from day one). The
-- 'delete'-then-insert dance is FTS5's canonical "upsert into an external-content table"
-- pattern: it clears any stale index row for that rowid before re-inserting, so running
-- this twice is safe (idempotent). Only live rows are inserted — soft-deleted/tombstoned
-- rows are skipped so they never surface in search.
INSERT INTO quick_notes_fts(quick_notes_fts, rowid, title, content) SELECT 'delete', rowid, title, content FROM quick_notes WHERE deleted_at IS NULL;
INSERT INTO quick_notes_fts(rowid, title, content) SELECT rowid, title, content FROM quick_notes WHERE deleted_at IS NULL;

INSERT INTO backlog_docs_fts(backlog_docs_fts, rowid, title, content) SELECT 'delete', rowid, title, content FROM backlog_docs;
INSERT INTO backlog_docs_fts(rowid, title, content) SELECT rowid, title, content FROM backlog_docs;

INSERT INTO sadhana_tasks_fts(sadhana_tasks_fts, rowid, title, note) SELECT 'delete', rowid, title, note FROM sadhana_tasks WHERE deleted_at IS NULL;
INSERT INTO sadhana_tasks_fts(rowid, title, note) SELECT rowid, title, note FROM sadhana_tasks WHERE deleted_at IS NULL;

INSERT INTO canvas_elements_fts(canvas_elements_fts, rowid, content) SELECT 'delete', rowid, content FROM canvas_elements WHERE deleted = 0;
INSERT INTO canvas_elements_fts(rowid, content) SELECT rowid, content FROM canvas_elements WHERE deleted = 0;
