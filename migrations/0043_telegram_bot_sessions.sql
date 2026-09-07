-- 0043: telegram_bot_sessions — one row per linked user, JSON state, no TTL.
-- Backs all bot await_text intents (idea, note, sadhana_task, proj_search,
-- connect_list) and the /list flow (kind='await_list_item'). Replaces the
-- finite telegram_note_sessions (2h TTL) per design §7.4 ("not finite").
--
-- Design: docs/telegram-bot-flow.md. State shapes (JSON in `state`):
--   { kind: 'home' }
--   { kind: 'await_text', intent: 'idea' | 'note' | 'sadhana_task' | 'proj_search' }
--     (sadhana_task carries `quadrant: 1|2|3|4`)
--   { kind: 'await_list_item', items: string[] }   -- /list flow (no TTL)
--   { kind: 'connect_list', noteId: string }       -- connect-a-note step
--
-- Rule 1: user-scoped (PK is user_id). Rule 3: UTC ISO timestamps. No TTL —
-- idle rows are GC'd by a cron after 30 days of inactivity (no UX impact; a
-- cleared row just shows the home screen on next tap, never an error).

CREATE TABLE telegram_bot_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
