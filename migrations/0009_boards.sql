-- 0009: board scoping on canvas_elements — the notebook page (a separate blank page, spec §12
-- follow-up) shares the same durable LWW + tombstone sync machinery as the boundless Canvas
-- without mixing into it. board is client-sent ('canvas' | 'notebook'); existing rows default
-- to 'canvas' so the current board keeps working untouched.
ALTER TABLE canvas_elements ADD COLUMN board TEXT NOT NULL DEFAULT 'canvas';
CREATE INDEX idx_canvas_board ON canvas_elements(user_id, board);
