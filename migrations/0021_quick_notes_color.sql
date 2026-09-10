-- 0021: quick_notes color — sticky-note view palette (yellow/green/pink/blue, 2026-08-25).
-- New notes default to yellow; the hover palette PATCHes this per note.
ALTER TABLE quick_notes ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow';
CREATE INDEX idx_quick_notes_color ON quick_notes(user_id, color);