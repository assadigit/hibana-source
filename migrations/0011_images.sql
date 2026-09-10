-- 0011: allow 'image' elements on canvas_elements (user request: paste a URL → the
-- canvas / notebook shows the picture, rounded like the app). SQLite cannot alter a CHECK
-- constraint, so the table is rebuilt with the widened CHECK — same columns as 0005 plus
-- the board column added in 0009 — and existing rows copied across untouched.
-- This file runs inside the migration runner's own transaction: no BEGIN/COMMIT (rule 4).

ALTER TABLE canvas_elements RENAME TO canvas_elements_old;

CREATE TABLE canvas_elements (
  id TEXT PRIMARY KEY,                              -- client-generated UUID (rule 2)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'stroke', 'image')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL,
  height REAL,
  color TEXT NOT NULL DEFAULT '#fef08a',
  content TEXT NOT NULL DEFAULT '',
  promoted_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  z_index INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  board TEXT NOT NULL DEFAULT 'canvas'               -- 0009: 'canvas' | 'notebook'
);

INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, promoted_project_id, z_index, deleted, created_at, updated_at, board)
  SELECT id, user_id, type, x, y, width, height, color, content, promoted_project_id, z_index, deleted, created_at, updated_at, board FROM canvas_elements_old;

DROP TABLE canvas_elements_old; -- drops its indexes; names below are free again

CREATE INDEX idx_canvas_user ON canvas_elements(user_id);
CREATE INDEX idx_canvas_updated ON canvas_elements(user_id, updated_at);
CREATE INDEX idx_canvas_x ON canvas_elements(user_id, x);
CREATE INDEX idx_canvas_y ON canvas_elements(user_id, y);
CREATE INDEX idx_canvas_board ON canvas_elements(user_id, board);
