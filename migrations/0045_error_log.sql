-- 0045: error_log — persistent runtime-error observability (dr-integrity session,
-- docs/dr-integrity-closeout.md §4).
--
-- Runbook §5's honest gap list said it plainly: "No error tracking — errors are only
-- visible in wrangler tail." A tail session is ephemeral and requires the operator to be
-- watching. This table gives unhandled errors and ApiErrors a persistent, queryable home
-- (7-day retention via the daily purge), surfaced in the admin console.
--
-- Operational table, same class as email_log / planb_backups:
--   - NOT user-owned (rule 1 applies to user data tables) — user_id is nullable context,
--     recorded only when a session was already authenticated.
--   - NOT in SNAPSHOT_TABLES (rule-8 spirit: backups carry user data, never operational
--     logs) — a restored database starts with a clean error log.
--   - UUID primary key + UTC ISO timestamps (rules 2 + 3).

CREATE TABLE error_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  req_id TEXT,
  user_id TEXT,
  path TEXT,
  status INTEGER NOT NULL,
  code TEXT,
  message TEXT,
  stack TEXT
);

CREATE INDEX idx_error_log_created ON error_log(created_at);
CREATE INDEX idx_error_log_status ON error_log(status);
