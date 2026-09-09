-- 0010: quick_notes — the dashboard quick-notebook (user request, capsuled 2026-08-20).
-- Two capture modes on the dashboard: free typing ('note') or a task list ('list').
-- Soft delete via deleted_at (Q2 convention), purged by the existing 7-day cron.
-- content: raw text for notes; JSON [{id, t, d}] for lists. updated_at drives ordering.

CREATE TABLE quick_notes (
  id TEXT PRIMARY KEY,                              -- server-generated UUID (rule 2)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'list')),
  title TEXT NOT NULL DEFAULT '',                   -- optional short label (lists use it)
  content TEXT NOT NULL DEFAULT '',                 -- note text | JSON task list
  deleted_at TEXT,                                  -- soft delete; NULL = live
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_user ON quick_notes(user_id);
CREATE INDEX idx_notes_user_updated ON quick_notes(user_id, updated_at);