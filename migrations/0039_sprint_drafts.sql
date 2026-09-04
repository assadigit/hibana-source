-- 0039: sprint drafts (2026-08-31). A sprint is now born a DRAFT (is_draft=1): while
-- drafted it only carries a name — the timeline plans on it; POST /api/sprints/:id/start
-- stamps started_at, converts it to a real open sprint (is_draft=0) and closes the
-- previous open one. Every "open sprint" query filters is_draft=0, so pre-existing rows
-- (all real sprints) are unaffected. Plain ADD COLUMN — no constraint changes.

ALTER TABLE sprints ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;
