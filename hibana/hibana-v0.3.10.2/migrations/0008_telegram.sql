-- 0008: telegram_captures + telegram link codes (spec §4.10 + §9).
-- Captures are user-owned — but a message can arrive before the user links Telegram,
-- so user_id is nullable until the account is linked (§4.0 rule 1 still applies:
-- every query filters on user_id; NULL-user rows are only visible to the owner flow).

CREATE TABLE telegram_captures (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,   -- assigned once the account links Telegram
  raw_text TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL,                        -- Telegram's own user id (echoed in replies)
  received_at TEXT NOT NULL,                             -- UTC (rule 3)
  promoted INTEGER NOT NULL DEFAULT 0,                   -- reviewed/promoted flag; New badge until set
  created_at TEXT NOT NULL
);
CREATE INDEX idx_telegram_user ON telegram_captures(user_id);
CREATE INDEX idx_telegram_received ON telegram_captures(user_id, received_at);

CREATE TABLE telegram_links (
  code TEXT PRIMARY KEY,                                 -- one-time code shown in Settings → /start <code> in Telegram
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_telegram_links_user ON telegram_links(user_id);