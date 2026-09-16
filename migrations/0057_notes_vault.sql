-- 0057 — Notes Vault (S53, owner request): a standalone long-form knowledge base with
-- an Obsidian-inspired UX (/notes). For things that must be SAVED as a note — curated
-- lists (movies to watch, games to play), knowledge, reference material — as opposed to
-- Sparks (quick idea capture) and Quick Notes (sticky throwaway captures).
--
-- STRICTLY ADDITIVE (owner constraint: "no information must be missed" — existing tables
-- are never touched). Two new tables:
--   note_folders — user-owned folders, arbitrary nesting via parent_id self-reference.
--   vault_notes  — one long-form note; folder_id SET NULL on folder delete (a deleted
--                  folder never deletes notes — they become "unfiled"), soft delete via
--                  deleted_at from day 1 (Trash view + restore + explicit purge).
-- Manual tags live in vault_notes.tags as a CSV string (single TEXT column — the same
-- no-list-primitive discipline as quick_notes' content JSON). Inline #tags are parsed
-- from content client-side; the tag FILTER matches both the tags column and '#tag'
-- occurrences in content.
--
-- FK behavior (foreign_keys=ON on both the Node sqlite path and D1):
--   folder delete → child folders cascade, notes in ANY affected folder → folder_id NULL.
--   (The route also performs the note-unfiling explicitly so the behavior is identical
--   even where the pragma is off.)

CREATE TABLE note_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES note_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_note_folders_user ON note_folders(user_id, parent_id);

CREATE TABLE vault_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES note_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  starred INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_vault_notes_user ON vault_notes(user_id, deleted_at, updated_at DESC);
CREATE INDEX idx_vault_notes_folder ON vault_notes(folder_id, deleted_at);
CREATE INDEX idx_vault_notes_starred ON vault_notes(user_id, starred, deleted_at);
