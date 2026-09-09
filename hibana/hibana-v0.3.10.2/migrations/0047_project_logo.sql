-- 0047: project logos (user request 2026-09). A project can have a logo image
-- (stored in the GitHub assets repo, same as user avatars). NULL = no logo.
ALTER TABLE projects ADD COLUMN logo_path TEXT;
