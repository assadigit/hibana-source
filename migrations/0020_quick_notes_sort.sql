-- 0020: quick_notes sort_order — sticky-note view needs a user-defined order (2026-08-25).
-- New notes append at the end; reorder sets explicit positions. Existing rows default to 0
-- and fall back to updated_at DESC (the previous behavior).
ALTER TABLE quick_notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_quick_notes_sort ON quick_notes(user_id, sort_order);