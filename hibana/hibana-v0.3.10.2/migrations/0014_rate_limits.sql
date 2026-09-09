-- 0014 — in-code rate limiting (spec §15).
-- The Cloudflare free-tier rate-limiting rules remain the preferred edge defense, but
-- the wrangler OAuth token cannot edit zone WAF config, so the app itself guards the
-- internet-facing endpoints (login, password reset, Telegram webhook) as well.
-- One row per "<endpoint>:<client-ip>" per fixed window; windows are 60s buckets.

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,          -- e.g. "login:203.0.113.7"
  window_start INTEGER NOT NULL,          -- unix seconds of the bucket start
  count        INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);