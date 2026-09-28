-- 0063 (S161 rebuild, spec hibana-ideas-section-spec.md): the Ideas section becomes
-- its own lean surface. Schema additions:
--   projects.pinned_at    — spec #5: pinned ideas float to the top of their folder
--                           (server-stamped toggle; NULL = unpinned).
--   projects.cover_shot_id — spec #4: the manually-marked cover image (NULL = use the
--                           most recent upload as the card thumb). Ownership is checked
--                           app-level (404 shot_not_found); no hard FK — a purged
--                           screenshot must not cascade-delete anything, the cover
--                           cleanup is handled where shots are deleted.
--   spark_folders.color_fill / color_text — spec #3: the folder's pastel pair (one of
--                           the 16 curated CAT_PAIRS tiles; whole-tile validated
--                           app-level via isValidCatPair). NULL = the hash-of-id
--                           default (helpers.folderPair).
--   spark_folders.banner_path — spec #1/#2: the folder banner's object-store key
--                           (NULL = the pastel placeholder + upload prompt).
--   idx_projects_folder   — recreated: 0060's table rebuild dropped it (0037 declared
--                           it; the folder-scoped lists + the folder DELETE sweep are
--                           hot on it).
--
-- ALTERs only (no table rebuilds): the projects rebuild recipe (0060) is reserved for
-- CHECK-constraint changes; new nullable columns + a new index are additive.

ALTER TABLE projects ADD COLUMN pinned_at TEXT;
ALTER TABLE projects ADD COLUMN cover_shot_id TEXT;
ALTER TABLE spark_folders ADD COLUMN color_fill TEXT;
ALTER TABLE spark_folders ADD COLUMN color_text TEXT;
ALTER TABLE spark_folders ADD COLUMN banner_path TEXT;

CREATE INDEX idx_projects_folder ON projects(folder_id);
