-- 0054 (S39, user request 2026-09-13): screenshots stick to PROGRESS-BOX ITEMS.
-- The user: "you must be able to stick that screenshot to progress box items — e.g. a
-- UI bug screenshot sticky to the Problems box (in project progress) so there is note +
-- picture proof, and how it's categorized in the project." The pin target is a dev_tasks
-- row (a card in one of the five Project Progress boxes; 'bug' = the Problems box).
-- task_id NULL = unpinned (a plain problem shot). ON DELETE SET NULL: deleting the task
-- detaches the shot — the PICTURE is never lost (the S38 never-lose rule).
-- bytes: the decoded binary size, recorded at upload (the S39 media gallery sums it to
-- show storage usage; legacy rows self-heal on first view via the media file route).
-- Rule 1 note: screenshots carry no user_id by design (0004) — ownership flows through
-- project_id; every query keeps joining projects.user_id.
ALTER TABLE screenshots ADD COLUMN task_id TEXT REFERENCES dev_tasks(id) ON DELETE SET NULL;
ALTER TABLE screenshots ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_screenshots_task ON screenshots(task_id);
