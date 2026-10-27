// Telegram webhook module (Phase 4 split from routes/integrations/telegram.ts).
//
// Purpose: the POST /api/telegram/webhook handler — secret-token verification, update
// parsing, and the message/ command dispatch (lightweight commands live here; the heavy
// project commands /append and /update live in telegram-commands.ts; inline-keyboard
// callback taps are dispatched in telegram-callback.ts).
//
// Public API: telegramWebhookHandler(cfg) — the Hono route handler (registered by
// registerTelegram in telegram.ts behind the flood-guard limiter).
import type { MiddlewareHandler } from 'hono'
import { uuid } from '../../lib/ids'
import { esc, requestOrigin } from '../../lib/http'
import { timingSafeEqualStr } from '../../lib/crypto'
import { createResetToken } from '../../services/reset'
import { sendTelegramMessage, answerCallbackQuery } from '../../services/telegram'
import { errJson, ErrorCode } from '../../lib/errors'
import { handleCallback } from './telegram-callback'
import { captureIdeaReply, handleAppendCommand, handleUpdateCommand } from './telegram-commands'
import {
  UPDATE_SCHEMA,
  LINK_CODE_TTL_MS,
  LIST_MAX_ITEMS,
  ITEM_MAX_CHARS,
  type Lang,
  getSession,
  setSession,
  clearSession,
  noteSession,
  saveNoteSession,
  createQuickNote,
  createListNote,
  t,
  kb,
  homeKeyboard,
  homeText,
  helpText,
  helpKeyboard,
  langKeyboard,
  langText,
  quadrantKeyboard,
  quadrantGridText,
  connectListText,
  connectListKeyboard,
  renderQuadrant,
  escapeLikePrefix,
} from './telegram-helpers'
import type { Config, UserRow } from '../../types'

// Public webhook (secret-token header). Telegram calls this for every message (rule 11).
// Timing-safe compare (hardening 2026-08-28): a plain !== leaks a (theoretical) early-exit
// oracle on how many leading bytes match.
export function telegramWebhookHandler(cfg: Config): MiddlewareHandler {
  return async (c) => {
    const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
    if (!secret || !cfg.telegramSecret || !timingSafeEqualStr(secret, cfg.telegramSecret)) return errJson(c, ErrorCode.forbidden) // rule 11
    const token = cfg.telegramToken
    if (!token) return errJson(c, ErrorCode.telegram_not_configured)

    const parsed = UPDATE_SCHEMA.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ ok: true }) // ignore non-message updates

    const data = parsed.data

    // ---- callback_query branch (inline keyboard taps) ---------------------------
    // Buttons always win and REPLACE any active await_text intent (design §8.1).
    if (data.callback_query) {
      const cq = data.callback_query
      const chatId = cq.message.chat.id
      // telegram_backup is retired (session 14: backups are on-demand, not opted-in) — the
      // column stays in the schema for rollback safety but no code reads it anymore.
      const owned = await cfg.db.query<Pick<UserRow, 'id' | 'username' | 'telegram_paused' | 'language_pref' | 'timezone' | 'sadhana_quadrant_order' | 'role'>>(
        'SELECT id, username, telegram_paused, language_pref, timezone, sadhana_quadrant_order, role FROM users WHERE telegram_chat_id = ?',
        [String(chatId)],
      )
      await answerCallbackQuery(token, cq.id)
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 Link your account first: Hibana Settings → Telegram → Generate link code, then send /start <code> here.')
        return c.json({ ok: true })
      }
      await handleCallback(token, chatId, cq.message.message_id, owned[0], cq.data, cfg, requestOrigin(c))
      return c.json({ ok: true })
    }

    // ---- message branch ---------------------------------------------------------
    const msg = data.message ?? { chat: { id: 0 }, from: { id: 0 }, text: data.text ?? '' }
    const chatId = msg.chat.id
    const text = (msg.text ?? '').trim()

    // The chat's account (if linked) drives every command below — rule 1: all bot data is
    // scoped to this user. Unlinked chats get a capture-now/link-later flow (§4.10).
    const owned = await cfg.db.query<Pick<UserRow, 'id' | 'username' | 'telegram_paused' | 'language_pref' | 'timezone' | 'sadhana_quadrant_order' | 'role'>>(
      'SELECT id, username, telegram_paused, language_pref, timezone, sadhana_quadrant_order, role FROM users WHERE telegram_chat_id = ?',
      [String(chatId)],
    )

    // /start <code> links the chat to the account (one-time code from Settings).
    // Codes expire after 1h and are single-use, so an expired row is as invalid as a
    // missing one (created_at is stored as UTC ISO strings — lexicographically comparable).
    const start = text.match(/^\/start\s+(\S+)/i)
    if (start) {
      const expiredBefore = new Date(Date.now() - LINK_CODE_TTL_MS).toISOString()
      const links = await cfg.db.query<{ user_id: string }>(
        'SELECT user_id FROM telegram_links WHERE code = ? AND created_at >= ?',
        [start[1], expiredBefore],
      )
      if (links.length === 0) {
        await sendTelegramMessage(token, chatId, 'That link code is invalid or already used.')
        return c.json({ ok: true })
      }
      await cfg.db.transaction(async (tx) => {
        // H5 fix (2026-09-10): clear any PRIOR user who held this chat_id. Without this,
        // linking chat X to user B leaves user A's telegram_chat_id pointing at the same
        // chat — the `owned` query (WHERE telegram_chat_id = ?) then returns both A and B,
        // and owned[0] is used non-deterministically for captures, /reset, and /status.
        tx.sql('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ? AND id != ?', [String(chatId), links[0].user_id])
        tx.sql('UPDATE users SET telegram_chat_id = ?, telegram_paused = 0 WHERE id = ?', [String(chatId), links[0].user_id]) // re-linking also resumes reminders (spec §6.22)
        tx.sql('DELETE FROM telegram_links WHERE code = ?', [start[1]]) // single-use
        tx.sql('UPDATE telegram_captures SET user_id = ? WHERE telegram_user_id = ? AND user_id IS NULL', [links[0].user_id, String(msg.from.id)])
      })
      // Greet in the user's web locale and show the home inline keyboard (design §6.1, §2.2).
      const linkedUser = await cfg.db.query<Pick<UserRow, 'language_pref'>>('SELECT language_pref FROM users WHERE id = ?', [links[0].user_id])
      const lang = (linkedUser[0]?.language_pref ?? 'en') as Lang
      await sendTelegramMessage(
        token,
        chatId,
        t(lang, '✅ Linked to your Hibana account. Tap a button below — or just text me an idea.', '✅ به حساب هیبانا متصل شدی. دکمه پایین را بزن — یا ایده‌ات را بنویس.'),
        'HTML',
        homeKeyboard(lang),
      )
      return c.json({ ok: true })
    }

    // /start alone: greet + show the home keyboard (linked) or link instructions (unlinked).
    if (/^\/start$/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🤖 Hibana bot — link your account first so your notes and ideas land safely:\n\nOpen Hibana Settings → Telegram → Generate link code, then send:\n/start <code>\n\nThen you can use: /idea, /note, /list, /help')
      } else {
        const lang = owned[0].language_pref as Lang
        await sendTelegramMessage(token, chatId, homeText(lang), 'HTML', homeKeyboard(lang))
      }
      return c.json({ ok: true })
    }

    // /help: help screen (inline keyboard) for linked, link instructions for unlinked.
    if (/^\/help\b/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🤖 Hibana bot — link your account first:\n\nOpen Hibana Settings → Telegram → Generate link code, then send /start <code> here.')
      } else {
        const lang = owned[0].language_pref as Lang
        await sendTelegramMessage(token, chatId, helpText(lang), undefined, helpKeyboard(lang))
      }
      return c.json({ ok: true })
    }

    // /menu — render the home inline keyboard from anywhere.
    if (/^\/menu$/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 Link your account first: send /start <code>.')
      } else {
        const lang = owned[0].language_pref as Lang
        await sendTelegramMessage(token, chatId, homeText(lang), 'HTML', homeKeyboard(lang))
      }
      return c.json({ ok: true })
    }

    // /language — open the language picker (updates language_pref — single source of truth, round 2 Q1).
    if (/^\/language$/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 Link your account first: send /start <code>.')
      } else {
        const lang = owned[0].language_pref as Lang
        await sendTelegramMessage(token, chatId, langText(lang), 'HTML', langKeyboard(lang))
      }
      return c.json({ ok: true })
    }

    // /todo — jump straight to the quadrant grid.
    if (/^\/todo$/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 Link your account first: send /start <code>.')
      } else {
        const lang = owned[0].language_pref as Lang
        const nameRows = await cfg.db.query<{ quadrant: number; name: string }>('SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = ?', [owned[0].id])
        const names = new Map(nameRows.map((r) => [r.quadrant, r.name]))
        await sendTelegramMessage(token, chatId, quadrantGridText(lang), 'HTML', quadrantKeyboard(lang, names, owned[0].sadhana_quadrant_order))
      }
      return c.json({ ok: true })
    }

    // /status — linked account + how many open tasks have deadlines (spec §5.17).
    if (/^\/status\b/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 You are not linked to a Hibana account yet. Link it first: Hibana Settings → Telegram → generate a code, then send /start <code> here.')
      } else {
        const rows = await cfg.db.query<{ n: number }>(
          'SELECT COUNT(*) AS n FROM sadhana_tasks WHERE user_id = ? AND done = 0 AND deleted_at IS NULL AND due_date IS NOT NULL',
          [owned[0].id],
        )
        const paused = owned[0].telegram_paused === 1
        await sendTelegramMessage(
          token,
          chatId,
          `📊 <b>${esc(owned[0].username ?? 'Hibana user')}</b> — open tasks with deadlines: <b>${rows[0]?.n ?? 0}</b>.\nReminders: ${paused ? '⏸ paused (send /resume)' : '✅ on'}.`,
          'HTML',
        )
      }
      return c.json({ ok: true })
    }

    // /pause & /resume — suspend/resume bot reminders without unlinking (spec §5.17/§6.22;
    // §8 Q6 resolved: re-linking via /start <code> also resumes, and so does /resume).
    if (/^\/pause\b/i.test(text) || /^\/resume\b/i.test(text)) {
      const pause = /^\/pause\b/i.test(text)
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 You are not linked to a Hibana account yet. Link it first: Hibana Settings → Telegram → generate a code, then send /start <code> here.')
      } else {
        await cfg.db.execute('UPDATE users SET telegram_paused = ? WHERE id = ?', [pause ? 1 : 0, owned[0].id])
        await sendTelegramMessage(
          token,
          chatId,
          pause
            ? '⏸ Reminders paused — no deadline or progress alerts will arrive here. Send /resume to turn them back on (or generate a fresh code in Hibana Settings and /start it).'
            : '▶️ Reminders resumed — deadline and progress alerts will arrive here again.',
        )
      }
      return c.json({ ok: true })
    }

    // /reset — secondary password reset through the linked chat (spec §9). The chat being
    // LINKED is the authentication: only the account owner's linked chat can ever trigger it.
    // Issues the same one-time hashed token as the email path; delivery is via the bot.
    if (/^\/reset\b/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔐 Your Telegram is not linked to a Hibana account yet. Link it first: Hibana Settings → Telegram → generate a code, then send /start <code> here.')
      } else {
        const resetToken = await createResetToken(cfg.db, owned[0].id)
        const link = `${requestOrigin(c)}/reset.html?token=${resetToken}`
        await sendTelegramMessage(token, chatId, `🔐 Password reset for your Hibana account:\n\n<a href="${link}">Set a new password →</a>\n\nThis link expires in 1 hour.`, 'HTML')
      }
      return c.json({ ok: true })
    }

    // Unlinked chat: nothing can be saved yet. Commands get the link-first instructions
    // (no junk captures); free text is captured for assignment once the account links (§4.10).
    if (owned.length === 0) {
      if (/^\//.test(text)) {
        await sendTelegramMessage(token, chatId, '🔗 Link your account first: Hibana Settings → Telegram → Generate link code, then send /start <code> here.')
        return c.json({ ok: true })
      }
      await cfg.db.execute(
        'INSERT INTO telegram_captures (id, user_id, raw_text, telegram_user_id, received_at, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
        [uuid(), text, String(msg.from.id), new Date().toISOString(), new Date().toISOString()],
      )
      await sendTelegramMessage(token, chatId, '📩 Idea captured. Link your account in Hibana Settings → Telegram: generate a code, then send /start <code> here.')
      return c.json({ ok: true })
    }

    const userId = owned[0].id
    const lang = owned[0].language_pref as Lang
    const origin = requestOrigin(c)

    if (!text) {
      await sendTelegramMessage(token, chatId, homeText(lang), 'HTML', homeKeyboard(lang))
      return c.json({ ok: true })
    }

    // /note <text> — a Quick Note on the dashboard notebook.
    const note = text.match(/^\/note\b([\s\S]*)/i)
    if (note) {
      const content = note[1].trim()
      if (!content) {
        await sendTelegramMessage(token, chatId, 'Usage: /note <text> — e.g. /note call mom')
        return c.json({ ok: true })
      }
      const id = await createQuickNote(cfg.db, userId, content)
      await setSession(cfg.db, userId, { kind: 'connect_list', noteId: id }) // so 🔗 Connect below knows the note
      await sendTelegramMessage(
        token,
        chatId,
        `✅ ${t(lang, 'Note added to your dashboard', 'یادداشت به داشبورد اضافه شد')}:\n\n<b>${esc(content.length > 120 ? content.slice(0, 117) + '…' : content)}</b>`,
        'HTML',
        kb([
          [{ text: t(lang, '🔗 Connect to a project', '🔗 اتصال به پروژه'), callback_data: 'connect' }, { text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
        ]),
      )
      return c.json({ ok: true })
    }

    // /idea <text> — explicit alias of the default capture.
    const idea = text.match(/^\/idea\b([\s\S]*)/i)
    if (idea) {
      const content = idea[1].trim()
      if (!content) {
        await sendTelegramMessage(token, chatId, 'Usage: /idea <text> — e.g. /idea redesign the landing page')
        return c.json({ ok: true })
      }
      await captureIdeaReply(cfg.db, token, chatId, userId, lang, origin, String(msg.from.id), content, false)
      return c.json({ ok: true })
    }

    // /append <project> <text> — append a note to an EXISTING project's latest_note.
    // Heavy command — implemented in telegram-commands.ts (Phase 4 module split).
    const appendMatch = text.match(/^\/append\b\s+(?:(\S+)\s+)?([\s\S]+)/i)
    if (appendMatch) {
      await handleAppendCommand(cfg, token, chatId, userId, origin, text)
      return c.json({ ok: true })
    }

    // /update <project> <stage> — move a project to a new stage from Telegram.
    // Heavy command — implemented in telegram-commands.ts (Phase 4 module split).
    const updateMatch = text.match(/^\/update\b\s+([\s\S]+)/i)
    if (updateMatch) {
      await handleUpdateCommand(cfg, token, chatId, userId, lang, origin, text)
      return c.json({ ok: true })
    }

    // /list — start (or join) a list session: items arrive one per message, /done saves.
    if (/^\/list$/.test(text)) {
      const items = await noteSession(cfg.db, userId)
      if (items) {
        await sendTelegramMessage(token, chatId, `List already collecting — ${items.length} item${items.length === 1 ? '' : 's'} so far. Send /done to save or /cancel to stop.`)
      } else {
        await saveNoteSession(cfg.db, userId, [])
        await sendTelegramMessage(token, chatId, '📋 List mode on — send the items, one per message. Send /done to save the list to your dashboard, or /cancel to stop.')
      }
      return c.json({ ok: true })
    }

    // /done — finalize the pending list into a dashboard list note.
    if (/^\/done$/.test(text)) {
      const items = await noteSession(cfg.db, userId)
      if (!items || items.length === 0) {
        await sendTelegramMessage(token, chatId, 'No active list — send /list first, then your items, then /done.')
        return c.json({ ok: true })
      }
      const count = await createListNote(cfg.db, userId, items)
      await sendTelegramMessage(token, chatId, `✅ List saved (${count} item${count === 1 ? '' : 's'}) — it is on your dashboard Quick Notebook.`)
      return c.json({ ok: true })
    }

    // /cancel — abandon the list session (or any active await).
    if (/^\/cancel$/i.test(text)) {
      const session = await getSession(cfg.db, userId)
      await clearSession(cfg.db, userId)
      if (session?.kind === 'await_list_item' && session.items.length) {
        await sendTelegramMessage(token, chatId, `List discarded (${session.items.length} item${session.items.length === 1 ? '' : 's'}).`)
      } else if (session?.kind === 'await_list_item') {
        await sendTelegramMessage(token, chatId, 'No active list.')
      } else if (session) {
        await sendTelegramMessage(token, chatId, t(lang, '↩️ Cancelled.', '↩️ لغو شد.'))
      } else {
        await sendTelegramMessage(token, chatId, 'No active list.')
      }
      return c.json({ ok: true })
    }

    // Plain text (no leading /): consume the active intent, else append to a list, else default-capture as an Idea.
    if (!/^\//.test(text)) {
      const session = await getSession(cfg.db, userId)

      // (3) await_text intent — consume per intent (design §8.1).
      if (session?.kind === 'await_text') {
        const intent = session.intent
        if (intent === 'idea') {
          await clearSession(cfg.db, userId)
          await captureIdeaReply(cfg.db, token, chatId, userId, lang, origin, String(msg.from.id), text, true)
          return c.json({ ok: true })
        }
        if (intent === 'note') {
          await clearSession(cfg.db, userId)
          const id = await createQuickNote(cfg.db, userId, text)
          await setSession(cfg.db, userId, { kind: 'connect_list', noteId: id })
          const preview = text.length > 120 ? text.slice(0, 117) + '…' : text
          await sendTelegramMessage(
            token,
            chatId,
            `✅ ${t(lang, 'Note added to your dashboard', 'یادداشت به داشبورد اضافه شد')}:\n\n<b>${esc(preview)}</b>`,
            'HTML',
            kb([
              [{ text: t(lang, '🔗 Connect to a project', '🔗 اتصال به پروژه'), callback_data: 'connect' }, { text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
            ]),
          )
          return c.json({ ok: true })
        }
        if (intent === 'sadhana_task') {
          const qid = session.quadrant
          await clearSession(cfg.db, userId)
          const id = uuid()
          const now = new Date().toISOString()
          await cfg.db.execute(
            "INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, done, pinned, position, progress, note, recurring, recur_config, created_at, updated_at) VALUES (?, ?, ?, ?, '📌', 0, 0, 0, 'untouched', '', 0, '', ?, ?)",
            [id, userId, qid, text.slice(0, 255), now, now],
          )
          await renderQuadrant(token, chatId, cfg.db, userId, lang, qid, 0) // re-render page 0 (new task at top)
          return c.json({ ok: true })
        }
        if (intent === 'proj_search') {
          const noteId = session.noteId
          const rows = await cfg.db.query<{ id: string; title: string }>(
            "SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 10",
            [userId, escapeLikePrefix(text.toLowerCase())],
          )
          await setSession(cfg.db, userId, { kind: 'connect_list', noteId }) // restore connect_list so cp:<id> resolves
          if (rows.length === 0) {
            await sendTelegramMessage(
              token,
              chatId,
              t(lang, `No project matches "${esc(text)}". Try again, or tap Skip.`, `پروژه‌ای برای «${esc(text)}» پیدا نشد. دوباره بنویس یا رد شو.`),
              'HTML',
              kb([
                [{ text: t(lang, '🔍 Search', '🔍 جستجو'), callback_data: 'psearch' }, { text: t(lang, '↩️ Skip', '↩️ رد شدن'), callback_data: 'home' }],
                [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
              ]),
            )
          } else {
            await sendTelegramMessage(token, chatId, connectListText(lang, 0, 1), 'HTML', connectListKeyboard(lang, rows, 0, 1))
          }
          return c.json({ ok: true })
        }
      }

      // (4) await_list_item — append the message's lines to the open list.
      if (session?.kind === 'await_list_item') {
        const lines = text.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean)
        if (lines.length) {
          const total = session.items.length + lines.length
          if (total > LIST_MAX_ITEMS) {
            await sendTelegramMessage(token, chatId, `List is full (${LIST_MAX_ITEMS} items max) — send /done to save it.`)
            return c.json({ ok: true })
          }
          await setSession(cfg.db, userId, { kind: 'await_list_item', items: [...session.items, ...lines.map((l) => l.slice(0, ITEM_MAX_CHARS))] })
          await sendTelegramMessage(token, chatId, `✓ ${total} item${total === 1 ? '' : 's'} so far — send more, or /done to save.`)
        }
        return c.json({ ok: true })
      }
    }

    // Unknown command → help pointer; anything else is an Idea (default capture, frictionless).
    if (/^\//.test(text)) {
      await sendTelegramMessage(token, chatId, 'Unknown command — try /help to see what I can do.')
      return c.json({ ok: true })
    }
    await captureIdeaReply(cfg.db, token, chatId, userId, lang, origin, String(msg.from.id), text, false)
    return c.json({ ok: true })
  }
}
