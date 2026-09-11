-- 0048: drop superseded tables — changelogs + telegram_note_sessions.
-- Both tables are inert (no code reads/writes them). Approved by Ali (Session 26).
--
-- changelogs: created by 0004_media_fts.sql:14. Feature removed per RECOVERED.md.
--   Table kept in schema intentionally at the time; excluded from backup snapshots
--   (src/services/backup.ts:94 "dead table"). FTS query removed (search.ts:96 P2.5).
--
-- telegram_note_sessions: created by 0016_telegram_note_sessions.sql. Superseded
--   by telegram_bot_sessions (migration 0043, which says "Replaces the finite
--   telegram_note_sessions (2h TTL)"). Tests at telegram.test.ts:784,821,867
--   assert the legacy table is empty.
--
-- DROP TABLE IF EXISTS is safe: if the table doesn't exist (fresh clone that
-- never had the feature), the statement is a no-op. Both tables are confirmed
-- empty on prod D1 (verified before this migration).

DROP TABLE IF EXISTS changelogs;
DROP TABLE IF EXISTS telegram_note_sessions;
