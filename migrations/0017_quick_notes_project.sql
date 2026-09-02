-- 0017: quick notes can be attached to an Idea/project (user request 2026-08-25).
-- A note/list becomes *related* to a project: the notebook shows an attached chip that
-- links to the project page, and the project page lists its attached notes. Detach = NULL.
-- No REFERENCES clause on purpose: a project hard-delete (spark/pending purge) must never
-- cascade-delete the user's notes — orphans just render as unattached (app-level rule 1
-- scoping keeps the join honest).

ALTER TABLE quick_notes ADD COLUMN project_id TEXT;
CREATE INDEX idx_notes_project ON quick_notes(project_id);