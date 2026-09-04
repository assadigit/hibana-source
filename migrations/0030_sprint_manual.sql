-- 0030: manual sprint boundaries + task clip trimming (video-editor timeline, user 2026-08-30).
-- start_at/end_at override the automatic created_at→(done_at|today) bar so clips can be
-- trimmed/extended by dragging their edges; NULL keeps the automatic behavior
-- (bar grows to today until status=done stamps done_at).

ALTER TABLE dev_tasks ADD COLUMN start_at TEXT;
ALTER TABLE dev_tasks ADD COLUMN end_at TEXT;
