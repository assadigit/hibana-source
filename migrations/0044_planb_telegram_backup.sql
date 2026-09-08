-- 0044: Plan B backup channel (Telegram) — data-safety session, docs/perf-and-data-safety.md §1.
--
-- Two additions:
--   1. users.telegram_backup — per-owner opt-in flag for the Plan B push (the 4×/day
--      cron sends the encrypted whole-DB snapshot as a Telegram document to opted-in
--      owners' linked chats). Owner-scoped by design: the whole-DB snapshot contains
--      every user's rows, so only role='owner' can ever receive it (the bot Settings
--      toggle is hidden for members and the callback refuses non-owners).
--   2. planb_backups — one row per sent document (message_id, file_id, sha256, size,
--      schema_version). Powers the automated drill (npm run drill:planb) and retention
--      (keep newest 60 per owner). Rule 1: user-scoped. Rule 3: UTC ISO timestamps.
--      The log dying with D1 is acceptable BY DESIGN — the documents themselves are the
--      disaster artifact, and each document's Telegram caption carries the sha256 so
--      the manual restore path needs no D1 (see runbook §2b).
--
-- Rule 9: index the filter columns (user_id + sent_at for retention pruning).

ALTER TABLE users ADD COLUMN telegram_backup INTEGER NOT NULL DEFAULT 0;

CREATE TABLE planb_backups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,                            -- Telegram chat that received the document
  message_id INTEGER NOT NULL,                      -- for deleteMessage retention + pin management
  file_id TEXT NOT NULL,                            -- Bot API file handle for getFile (drill)
  file_size INTEGER NOT NULL,                       -- bytes of the encrypted blob
  sha256 TEXT NOT NULL,                             -- of the encrypted blob (caption-carried too)
  schema_version INTEGER NOT NULL,                  -- snapshot.schema_version at send time
  sent_at TEXT NOT NULL                             -- UTC ISO (rule 3)
);
CREATE INDEX idx_planb_user ON planb_backups(user_id, sent_at);
