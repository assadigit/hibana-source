-- 0015: email verification for new accounts — registration confirmation (spec §4.14).
-- New registrations land UNVERIFIED (email_verified_at NULL) and must confirm a 6-digit
-- email code before login; existing accounts predate verification and are trusted.

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,                       -- sha-256 of the 6-digit code (never raw)
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
-- Rule 9: index the filter column from the first migration.
CREATE INDEX idx_email_verifications_user_id ON email_verifications(user_id);

-- Accounts that existed before this feature are trusted; only NEW signups must verify.
UPDATE users SET email_verified_at = created_at;