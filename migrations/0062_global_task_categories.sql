-- 0062 (S152): the GLOBAL task-category system (the owner's 9-block spec, 2026-09-26
-- round: "new global task-category system, spanning all projects").
--
-- Block 1 (data model): a global `categories` library (id, name, color_fill,
-- color_text, is_archived, created_at), a `project_categories` join table (which
-- categories each project has ENABLED — one global category attaches to many
-- projects without duplicating its name or color), and dev_tasks.category_id as the
-- nullable single-select foreign key.
--
-- UNIFICATION (the crux): the legacy `task_categories` table was PROJECT-SCOPED
-- (id, project_id, name, color, sort_order) and dev_tasks.category_id carried a REAL
-- FK to it (0029/0031). Two id namespaces in one column would corrupt each other's
-- UX, so this migration FOLDS the legacy rows into the global library:
--   • every task_categories row becomes a global category (id PRESERVED →
--     dev_tasks.category_id references keep resolving);
--   • same-name rows across projects dedupe to the FIRST (oldest) row — later
--     tasks are remapped onto the canonical id;
--   • the legacy 8-color free palette maps to the owner's 16 fixed pastel
--     fill+ink pairs (nearest hue; unknown/NULL colors land on the slate pair);
--   • every project that had a row gets that category ENABLED (project_categories).
-- dev_tasks is then REBUILT (the 0031 recipe — SQLite cannot re-point an FK) so
-- category_id REFERENCES categories(id): the legacy table stops being a parent and
-- is no longer read or written (the TABLE stays — restore scripts reference it).
--
-- Block 8 (deletion behavior): archiving is a soft flag — rows stay, task
-- references stay; archived names are excluded from NEW selections only (the
-- partial unique index covers live rows, so an archived name may be re-created).
--
-- Block 5: the 16 owner-supplied pastel pairs (all pre-verified WCAG AA):
--   #F0CCCC/#682727 #F0D9CC/#683F27 #F0E7CC/#685727 #ECF0CC/#5F6827
--   #DEF0CC/#476827 #D0F0CC/#2F6827 #CCF0D5/#276837 #CCF0E2/#27684F
--   #CCF0F0/#276868 #CCE2F0/#274F68 #CCD5F0/#273768 #D0CCF0/#2F2768
--   #DECCF0/#472768 #ECCCF0/#5F2768 #F0CCE7/#682757 #F0CCD9/#68273F
-- (the hexes also live in variables.css as the --cat-sw-* tokens — the ONLY other
-- home, per the design-token law; a unit test pins the two lists together.)

PRAGMA foreign_keys = OFF;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color_fill TEXT NOT NULL,
  color_text TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Block 3 (why): case/whitespace-insensitive uniqueness among LIVE rows stops
-- near-duplicates ("ui/ux" vs "UI/UX") from silently forking into two categories.
CREATE UNIQUE INDEX idx_categories_name_live ON categories(lower(trim(name))) WHERE is_archived = 0;

CREATE TABLE project_categories (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)
);
CREATE INDEX idx_project_categories_cat ON project_categories(category_id);
CREATE INDEX idx_project_categories_proj ON project_categories(project_id);

-- ---- fold the legacy project-scoped rows into the global library -------------
-- Legacy palette → nearest-hue pair from the owner's 16 (fill, then ink):
--   #8AB8F0 blue 215° → #CCE2F0/#274F68 (200°)   #E8B27D orange 28° → #F0D9CC/#683F27
--   #E59AA5 rose 352° → #F0CCCC/#682727 (0°)     #8FD3A9 green 145° → #CCF0D5/#276837
--   #B3A5D6 violet 255° → #D0CCF0/#2F2768        #7CC7C1 teal 174° → #CCF0E2/#27684F
--   #F2D58A gold 45° → #F0E7CC/#685727           #C9CDD2 slate → #CCD5F0/#273768
INSERT INTO categories (id, name, color_fill, color_text, is_archived, created_at)
SELECT tc.id,
       tc.name,
       CASE UPPER(COALESCE(tc.color, ''))
         WHEN '#8AB8F0' THEN '#CCE2F0'
         WHEN '#E8B27D' THEN '#F0D9CC'
         WHEN '#E59AA5' THEN '#F0CCCC'
         WHEN '#8FD3A9' THEN '#CCF0D5'
         WHEN '#B3A5D6' THEN '#D0CCF0'
         WHEN '#7CC7C1' THEN '#CCF0E2'
         WHEN '#F2D58A' THEN '#F0E7CC'
         ELSE '#CCD5F0'
       END,
       CASE UPPER(COALESCE(tc.color, ''))
         WHEN '#8AB8F0' THEN '#274F68'
         WHEN '#E8B27D' THEN '#683F27'
         WHEN '#E59AA5' THEN '#682727'
         WHEN '#8FD3A9' THEN '#276837'
         WHEN '#B3A5D6' THEN '#2F2768'
         WHEN '#7CC7C1' THEN '#27684F'
         WHEN '#F2D58A' THEN '#685727'
         ELSE '#273768'
       END,
       0,
       tc.created_at
FROM task_categories tc
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE lower(trim(c.name)) = lower(trim(tc.name))
);

-- Same-name rows the INSERT skipped (deduped losers): remap their tasks onto the
-- canonical category, then ENABLE the canonical pair on every project that had any
-- of the name's rows.
UPDATE dev_tasks
SET category_id = (
  SELECT c.id FROM categories c
  WHERE lower(trim(c.name)) = lower(trim((SELECT tc.name FROM task_categories tc WHERE tc.id = dev_tasks.category_id)))
  ORDER BY c.created_at
  LIMIT 1
)
WHERE category_id IS NOT NULL
  AND category_id NOT IN (SELECT id FROM categories);

INSERT OR IGNORE INTO project_categories (project_id, category_id)
SELECT DISTINCT tc.project_id, c.id
FROM task_categories tc
JOIN categories c ON lower(trim(c.name)) = lower(trim(tc.name));

-- ---- rebuild dev_tasks: the category FK re-points to the GLOBAL library ------
-- The 0031 recipe verbatim: rows stashed aside, the table dropped and recreated
-- under its own name (projects is the parent here and is never touched, so no
-- rename-dance hazard), the stash copied back, indexes + the dev_tasks_fts
-- triggers recreated exactly as 0005/0051/0061 declared them, and the
-- external-content FTS index rebuilt from the content table afterwards.
CREATE TABLE dev_tasks_mig AS SELECT id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at, search_tags, updated_at FROM dev_tasks;

DROP TABLE dev_tasks;

CREATE TABLE dev_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','planned','in_progress','done','bug')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  done_at TEXT,
  start_at TEXT,
  end_at TEXT,
  search_tags TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);

INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at, search_tags, updated_at)
  SELECT id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, start_at, end_at, search_tags, updated_at
  FROM dev_tasks_mig;

DROP TABLE dev_tasks_mig;

CREATE INDEX idx_dev_tasks_project ON dev_tasks(project_id);
CREATE INDEX idx_dev_tasks_sprint ON dev_tasks(sprint_id);
CREATE INDEX idx_dev_tasks_status ON dev_tasks(status);
CREATE INDEX idx_dev_tasks_updated ON dev_tasks(updated_at);
CREATE INDEX idx_dev_tasks_cat ON dev_tasks(category_id); -- hot: the picker/toggle + export slice

CREATE TRIGGER dev_tasks_fts_ai AFTER INSERT ON dev_tasks BEGIN
  INSERT INTO dev_tasks_fts(rowid, title, search_tags) VALUES (NEW.rowid, NEW.title, NEW.search_tags);
END;
CREATE TRIGGER dev_tasks_fts_ad AFTER DELETE ON dev_tasks BEGIN
  INSERT INTO dev_tasks_fts(dev_tasks_fts, rowid, title, search_tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.search_tags);
END;
CREATE TRIGGER dev_tasks_fts_au AFTER UPDATE ON dev_tasks BEGIN
  INSERT INTO dev_tasks_fts(dev_tasks_fts, rowid, title, search_tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.search_tags);
  INSERT INTO dev_tasks_fts(rowid, title, search_tags) VALUES (NEW.rowid, NEW.title, NEW.search_tags);
END;

-- Repopulate the external-content FTS5 index from the rebuilt content table.
INSERT INTO dev_tasks_fts(dev_tasks_fts) VALUES('rebuild');

PRAGMA foreign_keys = ON;
