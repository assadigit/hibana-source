-- 0005: canvas_elements — the boundless brain-dump space (spec §3 + §4.11)
-- Client-generated UUIDs (rule 2) so notes/strokes are addressable before they ever hit
-- the server. updated_at drives last-write-wins sync (Q4). deleted is a tombstone so an
-- offline delete survives a reconnect that also replays the element (no resurrection).

CREATE TABLE canvas_elements (
  id TEXT PRIMARY KEY,                              -- client-generated UUID (rule 2)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'stroke')),
  x REAL NOT NULL,                                  -- canvas-space top-left; bbox queries need these
  y REAL NOT NULL,
  width REAL,
  height REAL,                                      -- nullable for strokes
  color TEXT NOT NULL DEFAULT '#fef08a',            -- fixed sticky-note palette (spec §3.1)
  content TEXT NOT NULL DEFAULT '',                 -- text for notes, point-path JSON for strokes
  promoted_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, -- stays on canvas, marked (§3.1)
  z_index INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,               -- tombstone for sync (never silently resurrects)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL                          -- LWW comparison key (Q4)
);
CREATE INDEX idx_canvas_user ON canvas_elements(user_id);
CREATE INDEX idx_canvas_updated ON canvas_elements(user_id, updated_at);
CREATE INDEX idx_canvas_x ON canvas_elements(user_id, x);
CREATE INDEX idx_canvas_y ON canvas_elements(user_id, y);