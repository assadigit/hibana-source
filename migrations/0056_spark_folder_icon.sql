-- 0056: spark folder emoji icons (S41, 2026-09-13).
-- The owner asked that Idea folders carry a user-pickable emoji as their icon
-- (folder cards, bar chips, kanban column headers, the folder dialog). One nullable
-- column: NULL = the classic folder-plus glyph (legacy rows need no backfill).
-- Plain ADD COLUMN — spark_folders was last rebuilt in 0036; plain adds are the
-- established pattern (0049 angle, 0051 text search, 0055 text_align).

ALTER TABLE spark_folders ADD COLUMN icon TEXT DEFAULT NULL;
