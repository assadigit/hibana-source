-- 0038: quick_notes.done — mark a project-linked note done/undone (batch s). Only a
-- note attached to a project carries the flag (free notes ignore it — enforced in the
-- route, not here); done=1 renders the note struck through with a check mark on the
-- project page's Notes tab. Plain ADD COLUMN — the table's CHECK constraints are
-- untouched, so no rebuild is needed.

ALTER TABLE quick_notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
