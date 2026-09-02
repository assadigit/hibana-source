-- 0001: users, sessions, invites — Phase 0 (walking skeleton)
-- Rule 9: indexes on every filter column from the very first migration.
-- Rule 3: all timestamps are UTC ISO-8601 strings.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,                             -- Q3 decision: super-admin logs in with admin-<random>
  email TEXT NOT NULL UNIQUE,                       -- login + Brevo password-reset target
  password_hash TEXT NOT NULL,                      -- pbkdf2$iterations$salt$hash (rule 6)
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  telegram_chat_id TEXT,                            -- linked in Phase 5
  language_pref TEXT NOT NULL DEFAULT 'en' CHECK (language_pref IN ('en', 'fa')),
  calendar_pref TEXT NOT NULL DEFAULT 'gregorian' CHECK (calendar_pref IN ('gregorian', 'shamsi')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                              -- SHA-256 hex of the cookie token (never the raw token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                        -- one-time registration codes (spec §4.14)
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_invites_created_by ON invites(created_by);