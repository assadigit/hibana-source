-- 0019: Telegram pause flag (spec §5.17/§6.22 — user can suspend bot reminders
-- without unlinking; /start <code> clears it again). Column only, no new table.
ALTER TABLE users ADD COLUMN telegram_paused INTEGER NOT NULL DEFAULT 0;