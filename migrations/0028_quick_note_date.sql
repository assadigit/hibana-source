-- 0028: quick_notes.note_date + sticky — calendar day binding (user request 2026-08-30).
-- A quick note can be pinned to a calendar day ('YYYY-MM-DD' Gregorian display date, the
-- same storage convention as projects.due_date / sadhana_tasks.due_date):
--   sticky=1 → a colored sticky note for that day (rendered as a sticky chip on the
--              calendar + the notebook's sticky view)
--   sticky=0 → a plain day note (a normal notebook note that also surfaces on the day)
-- NULL note_date = an ordinary undated note (all previous rows).

ALTER TABLE quick_notes ADD COLUMN note_date TEXT;
ALTER TABLE quick_notes ADD COLUMN sticky INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_quick_notes_date ON quick_notes(user_id, note_date);
