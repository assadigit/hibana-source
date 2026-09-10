-- 0012: users.avatar_path — profile picture (spec §5.8 Account).
-- File bytes live in the GitHub assets repo like screenshots/changelogs (§8); D1 stores
-- only the path string (rule: file bytes never in the DB — 2MB row cap). Nullable.
ALTER TABLE users ADD COLUMN avatar_path TEXT;
