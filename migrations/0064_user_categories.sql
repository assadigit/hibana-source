-- 0064 (S181): the categories library becomes USER-SCOPED (the owner's written
-- approval, delivered in the round's message after S172 flagged the install-global
-- design as a future migration candidate: "the categories-table user_id migration
-- (needs your written approval). I approve this.").
--
-- BEFORE: `categories` had no owner column — every account on a shared install
-- saw and could mutate the SAME library (the S152 design treated the install as
-- one person's). The routes even carried `void user` placeholders where scoping
-- was deliberately skipped.
-- AFTER: every category row belongs to exactly one user (user_id NOT NULL →
-- users(id) ON DELETE CASCADE, the 0010/0057 recipe), name uniqueness is
-- per-user, and every route filters on the caller.
--
-- BACKFILL (zero data loss — the standing migration law):
--   1. A category's OWNERS = the distinct owners of every project that has it
--      ENABLED (project_categories) or references it from a task
--      (dev_tasks.category_id) — the same visibility set the old install-global
--      design actually served.
--   2. The FIRST owner (whose oldest touching project is oldest; ties broken by
--      user id for determinism) KEEPS the original row, id unchanged — every
--      dev_tasks.category_id reference on that owner's projects keeps resolving.
--   3. Every ADDITIONAL owner gets a COPY (id suffixed '-u<ordinal>'), and their
--      project_categories + dev_tasks references are remapped onto the copy —
--      a shared-install category forks into per-owner libraries with intact
--      history on every side.
--   4. A category NO project ever touched (created, never enabled/referenced)
--      falls to the INSTALL'S OLDEST user — on the owner's real install that is
--      their own account.
--
-- The per-user name-uniqueness index replaces the global one (same partial shape:
-- live rows only, lower(trim(name)) folded). project_categories keeps its shape —
-- the pair (project, category) now always links same-owner rows by construction.

PRAGMA foreign_keys = OFF;

-- stash + rebuild (the 0031/0062 recipe: SQLite cannot re-shape a table in place)
CREATE TABLE categories_mig AS SELECT * FROM categories;
DROP TABLE categories;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color_fill TEXT NOT NULL,
  color_text TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- ---- owner resolution ---------------------------------------------------------
-- every (category, owner) pair with the owner's oldest touching project
CREATE TABLE cat_owners AS
SELECT cid, uid, MIN(first_touch) AS first_touch FROM (
  SELECT c.id AS cid, p.user_id AS uid, MIN(p.created_at) AS first_touch
  FROM categories_mig c
  JOIN project_categories pc ON pc.category_id = c.id
  JOIN projects p ON p.id = pc.project_id
  GROUP BY c.id, p.user_id
  UNION ALL
  SELECT c.id, p.user_id, MIN(p.created_at)
  FROM categories_mig c
  JOIN dev_tasks t ON t.category_id = c.id
  JOIN projects p ON p.id = t.project_id
  GROUP BY c.id, p.user_id
) GROUP BY cid, uid;

-- the FIRST owner per category = smallest first_touch (ties → smallest uid)
CREATE TABLE cat_first_owner AS
SELECT cid, MIN(uid) AS uid FROM (
  SELECT co.cid, co.uid
  FROM cat_owners co
  WHERE co.first_touch = (SELECT MIN(x.first_touch) FROM cat_owners x WHERE x.cid = co.cid)
) GROUP BY cid;

-- the copy map for secondary owners (ordered by uid → stable '-u<n>' ids)
CREATE TABLE cat_copy_map AS
SELECT co.cid AS old_id, co.cid || '-u' || ROW_NUMBER() OVER (PARTITION BY co.cid ORDER BY co.uid) AS new_id, co.uid
FROM cat_owners co
JOIN cat_first_owner fo ON fo.cid = co.cid AND fo.uid <> co.uid;

-- ---- the rows -----------------------------------------------------------------
-- originals keep their ids, owned by their first owner (or the install's oldest
-- user when nothing ever touched them)
INSERT INTO categories (id, user_id, name, color_fill, color_text, is_archived, created_at)
SELECT c.id,
       COALESCE(fo.uid, (SELECT id FROM users ORDER BY created_at, id LIMIT 1)),
       c.name, c.color_fill, c.color_text, c.is_archived, c.created_at
FROM categories_mig c
LEFT JOIN cat_first_owner fo ON fo.cid = c.id;

-- copies for every secondary owner (id + '-u<ordinal>', same name/colors/archive)
INSERT INTO categories (id, user_id, name, color_fill, color_text, is_archived, created_at)
SELECT m.new_id, m.uid, c.name, c.color_fill, c.color_text, c.is_archived, c.created_at
FROM cat_copy_map m
JOIN categories_mig c ON c.id = m.old_id;

-- ---- reference remaps -----------------------------------------------------------
-- secondary owners' enables → their copy
UPDATE project_categories SET category_id = (
  SELECT m.new_id FROM cat_copy_map m
  WHERE m.old_id = project_categories.category_id
    AND m.uid = (SELECT p.user_id FROM projects p WHERE p.id = project_categories.project_id)
) WHERE EXISTS (
  SELECT 1 FROM cat_copy_map m
  WHERE m.old_id = project_categories.category_id
    AND m.uid = (SELECT p.user_id FROM projects p WHERE p.id = project_categories.project_id)
);

-- secondary owners' task references → their copy
UPDATE dev_tasks SET category_id = (
  SELECT m.new_id FROM cat_copy_map m
  WHERE m.old_id = dev_tasks.category_id
    AND m.uid = (SELECT p.user_id FROM projects p WHERE p.id = dev_tasks.project_id)
) WHERE category_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM cat_copy_map m
  WHERE m.old_id = dev_tasks.category_id
    AND m.uid = (SELECT p.user_id FROM projects p WHERE p.id = dev_tasks.project_id)
);

-- ---- indexes ---------------------------------------------------------------------
CREATE INDEX idx_categories_user ON categories(user_id);
-- per-user live-name uniqueness (was: global idx_categories_name_live, dropped with
-- the old table) — same fold (lower+trim), same partial (live rows only)
CREATE UNIQUE INDEX idx_categories_user_name_live ON categories(user_id, lower(trim(name))) WHERE is_archived = 0;

-- ---- teardown ----------------------------------------------------------------------
DROP TABLE cat_copy_map;
DROP TABLE cat_first_owner;
DROP TABLE cat_owners;
DROP TABLE categories_mig;

PRAGMA foreign_keys = ON;
