-- 0035: admin user management (batch e admin console, 2026-08-31). Suspension +
-- presence + the email delivery log that backs the console's send quota.
-- banned_until: ISO timestamp or the 'forever' sentinel (a ban is active while the
-- timestamp is in the future); ban_reason: optional plain text shown on the banned
-- login notice. last_seen_at: presence stamp written by the auth middleware, read for
-- the users list's online dot.
-- email_log rows are written by sendAndLog whether the send succeeded or failed, so
-- the daily quota (COUNT of status='sent' with sent_at since UTC midnight) and the
-- last-50 admin history come from the same table.

ALTER TABLE users ADD COLUMN banned_until TEXT;
ALTER TABLE users ADD COLUMN ban_reason TEXT;
ALTER TABLE users ADD COLUMN last_seen_at TEXT;

CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset', 'custom', 'broadcast', 'reminder')),
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_at TEXT NOT NULL
);
-- Rule 9: the quota count filters status + sent_at; the history list orders by sent_at.
CREATE INDEX idx_email_log_status_sent ON email_log(status, sent_at);
