-- 0016: telegram bot note-session state (bot /list flow: /list → items → /done).
-- The bot collects a quick-note list across several messages; Workers are stateless, so
-- the pending items live here (user-scoped, rule 1). Sessions expire after 2h of
-- inactivity — checked + purged lazily on use (no cron needed; rows are tiny).

CREATE TABLE telegram_note_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]',     -- JSON array of item texts (pending list)
  updated_at TEXT NOT NULL              -- UTC (rule 3)
);