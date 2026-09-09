-- 0003: tags + project_tags + hurdles + links (Phase 1)
-- Rule 1: tags is user-owned. Children scope through project_id (spec §4.0).

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f6d365',          -- pastel card accent (spec §7) — colors are per-tag
  usage_count INTEGER NOT NULL DEFAULT 0,          -- drives tag suggestions (§4.4)
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE INDEX idx_tags_user ON tags(user_id);

CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);
CREATE INDEX idx_project_tags_tag ON project_tags(tag_id);

-- The per-project blocker checklist. Drives the personal progress bar (§4.3).
CREATE TABLE hurdles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'solved')),
  sort_order INTEGER NOT NULL DEFAULT 0,           -- top of the list = tackle-next (manual drag)
  created_at TEXT NOT NULL,
  solved_at TEXT
);
CREATE INDEX idx_hurdles_project ON hurdles(project_id);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                             -- "Repo", "Live Site", "Docs" (§4.5)
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_links_project ON links(project_id);