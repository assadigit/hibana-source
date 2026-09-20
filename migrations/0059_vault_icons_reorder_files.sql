-- 0059 — S86 (owner round, four asks):
-- (1) vault_notes.icon — an emoji the user picks for a note (cards + tree show it).
-- (2) vault_notes.sort_order — the manual drag-reorder rank (0 = legacy/unordered;
--     notes list sort=manual orders by sort_order ASC, updated_at DESC tiebreak).
-- (3) note_folders.icon — the same emoji treatment for folders (the sparks shelf
--     already has spark_folders.icon from 0056 — this is the vault twin).
-- (4) screenshots.filename — the ORIGINAL file name for non-image uploads (PDF/XLSX/
--     DOCX/MD/TXT/CSV ride the screenshots bucket from S86). Legacy image rows keep
--     NULL and the display falls back to parsing the github_path basename.
--
-- STRICTLY ADDITIVE (owner rule: existing tables are ALTERed, never rebuilt).

ALTER TABLE vault_notes ADD COLUMN icon TEXT;
ALTER TABLE vault_notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE note_folders ADD COLUMN icon TEXT;
ALTER TABLE screenshots ADD COLUMN filename TEXT;

CREATE INDEX idx_vault_notes_sort ON vault_notes(user_id, deleted_at, sort_order);
