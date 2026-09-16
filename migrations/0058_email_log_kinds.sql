-- 0058: widen email_log's kind CHECK — 'backup_failed' and 'test' were silently rejected.
-- The scheduled backup's failure alert (admin.ts scheduledBackup catch) and the dev
-- test-email route (dev.ts) log kind='backup_failed' / kind='test', but the CHECK left
-- by 0041 only allowed verify/reset/custom/broadcast/reminder/invite. logEmail()'s
-- silent try/catch swallowed the constraint violation — the alert email WAS sent via
-- Resend but never logged. The 09-12→09-16 backup fail storm (9 ticks) therefore
-- produced ZERO email_log rows and the admin console + daily quota stayed blind, which
-- read as "the email alert path is dead" in the S59 forensics. Same bug class as 0041
-- (invite) — this migration widens the list to the COMPLETE vocabulary every sendAndLog
-- call site uses today (admin/registration/reset/reminders/dev).
--
-- SQLite can't ALTER a CHECK constraint, so the table is rebuilt (0041 pattern).
-- The rebuild is safe: email_log is a write-only log (no inbound REFERENCES), so
-- rename + copy + drop is clean. Runs inside the migration runner's own transaction.
--
-- ALSO restores idx_email_log_status_sent: 0041's rebuild renamed the OLD table (the
-- 0035-created index followed email_log_old to the DROP) and never recreated the index
-- on the new table — emailsSentToday's WHERE status/sent_at scan has been indexless
-- since 0041. Small tables made it invisible; fixed now while we're in here (rule 9).

ALTER TABLE email_log RENAME TO email_log_old;

CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset', 'custom', 'broadcast', 'reminder', 'invite', 'test', 'backup_failed')),
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_at TEXT NOT NULL
);

INSERT INTO email_log (id, to_email, kind, subject, status, error, sent_at)
  SELECT id, to_email, kind, subject, status, error, sent_at FROM email_log_old;

DROP TABLE email_log_old;

CREATE INDEX idx_email_log_status_sent ON email_log(status, sent_at);
