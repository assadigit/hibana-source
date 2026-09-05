-- 0041: add 'invite' to the email_log kind CHECK constraint.
-- The email-invite feature (Item 6, 2026-09-09) logs emails with kind='invite', but the
-- original CHECK (migration 0014) only allowed 'verify', 'reset', 'custom', 'broadcast',
-- 'reminder'. logEmail() has a silent try/catch, so the INSERT failed silently — the email
-- WAS sent via Resend but never logged, leaving the admin console blind to invite sends.
--
-- SQLite can't ALTER a CHECK constraint, so the table is rebuilt with the widened CHECK.
-- The rebuild is safe: email_log is a write-only log (no inbound REFERENCES), so renaming
-- + copying + dropping is clean. Runs inside the migration runner's own transaction.

ALTER TABLE email_log RENAME TO email_log_old;

CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset', 'custom', 'broadcast', 'reminder', 'invite')),
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_at TEXT NOT NULL
);

INSERT INTO email_log (id, to_email, kind, subject, status, error, sent_at)
  SELECT id, to_email, kind, subject, status, error, sent_at FROM email_log_old;

DROP TABLE email_log_old;
