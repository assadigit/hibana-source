import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../auth/middleware'
import { uuid } from '../../lib/ids'
import { markdownFromZip, parseMarkdownNote, ZipLimitError } from '../../lib/obsidian'
import { esc, requestOrigin } from '../../lib/http'
import { clientIp, hitRateLimit, RATE_RULES } from '../../services/ratelimit'
import { createResetToken } from '../../services/reset'
import { sendTelegramMessage, answerCallbackQuery, editMessageText, type ReplyMarkup } from '../../services/telegram'
import { sendPlanBBackupToChat } from '../../services/backup-planb'
import { timingSafeEqualStr } from '../../lib/crypto'
import { trL } from '../../lib/i18n'
import { QUADRANTS, orderedQuadrants, parseQuadrantOrder, todayIn } from '../../services/sadhana'
import type { Config, ProjectRow, UserRow } from '../../types'
import type { Db } from '../../db/types'

import {
  tgApi,
  UPDATE_SCHEMA,
  TELEGRAM_BOT,
  LINK_CODE_TTL_MS,
  LIST_MAX_ITEMS,
  ITEM_MAX_CHARS,
  NOTE_MAX_CHARS,
  SADHANA_PAGE_SIZE,
  PROJECT_PAGE_SIZE,
  type Lang,
  type BotState,
  getSession,
  setSession,
  clearSession,
  noteSession,
  saveNoteSession,
  createQuickNote,
  createListNote,
  insertIdea,
  t,
  tr,
  truncate,
  kb,
  homeKeyboard,
  homeText,
  cancelKeyboard,
  helpText,
  helpKeyboard,
  langKeyboard,
  langText,
  settingsKeyboard,
  settingsText,
  quadrantKeyboard,
  quadrantGridText,
  taskListText,
  taskListKeyboard,
  connectListText,
  connectListKeyboard,
  render,
  renderQuadrant,
} from './telegram-helpers'

export function registerTelegram(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  // Spec §15: flood guard BEFORE the secret check (the limiter must count hostile traffic
  // too; 300 req/60s per IP — same value as the CF webhook rule).
  const webhookLimiter: MiddlewareHandler = async (c, next) => {
    if (await hitRateLimit(cfg.db, RATE_RULES.webhook, clientIp(c))) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }

  // Public webhook (secret-token header). Telegram calls this for every message (rule 11).
  // Timing-safe compare (hardening 2026-08-28): a plain !== leaks a (theoretical) early-exit
  // oracle on how many leading bytes match.
  app.post('/api/telegram/webhook', webhookLimiter, async (c) => {
    const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
    if (!secret || !cfg.telegramSecret || !timingSafeEqualStr(secret, cfg.telegramSecret)) return c.json({ error: 'forbidden' }, 403) // rule 11
    const token = cfg.telegramToken
    if (!token) return c.json({ error: 'telegram_not_configured' }, 503)

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

    // The one save path for Ideas (explicit /idea and the default plain-text capture).
    const captureIdeaReply = async (raw: string, withButtons: boolean): Promise<void> => {
      const id = await insertIdea(cfg.db, userId, raw, String(msg.from.id))
      const body = `📎 ${t(lang, 'Captured', 'ذخیره شد')}:\n\n<b>${esc(raw)}</b>\n\n<a href="${origin}/project.html?id=${id}">${t(lang, 'Open it in Hibana →', 'باز کردن در هیبانا →')}</a>`
      if (withButtons) {
        await sendTelegramMessage(token, chatId, body, 'HTML', kb([
          [{ text: t(lang, '💡 Another', '💡 ایده'), callback_data: 'idea' }],
          [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
        ]))
      } else {
        await sendTelegramMessage(token, chatId, body, 'HTML')
      }
    }

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
      await captureIdeaReply(content, false)
      return c.json({ ok: true })
    }

    // /append <project> <text> — append a note to an EXISTING project's latest_note (the
    // Phase 7-second item 2 ask the audit flagged as never built). The first arg is a
    // project id OR a fuzzy title prefix match (case-insensitive, first match wins,
    // user-scoped). The rest is the text to append. A project_history_log row records
    // the change so the project page's activity feed shows it. Replies with a deep link.
    const appendMatch = text.match(/^\/append\b\s+(?:(\S+)\s+)?([\s\S]+)/i)
    if (appendMatch) {
      const projectArg = (appendMatch[1] ?? '').trim()
      const appendText = appendMatch[2].trim()
      if (!projectArg) {
        await sendTelegramMessage(token, chatId, 'Usage: /append <project-title-or-id> <text> — e.g. /append star map research the competition')
        return c.json({ ok: true })
      }
      // Resolve the project: id first, then a LIKE prefix match on title (user-scoped,
      // not deleted). Spark + unreviewed + all active stages are eligible — appending to
      // an archived/halted project is allowed (the user knows what they're doing).
      let project: ProjectRow | null = null
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectArg)) {
        const rows = await cfg.db.query<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [projectArg, userId])
        project = rows[0] ?? null
      }
      if (!project) {
        const rows = await cfg.db.query<ProjectRow>(
          'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND LOWER(title) LIKE ? ORDER BY updated_at DESC LIMIT 1',
          [userId, projectArg.toLowerCase() + '%'],
        )
        project = rows[0] ?? null
      }
      if (!project) {
        await sendTelegramMessage(token, chatId, `No project found matching "${esc(projectArg)}". Use /idea to capture a new one, or check the title in Hibana.`)
        return c.json({ ok: true })
      }
      const now = new Date().toISOString()
      // Append to latest_note with a timestamp separator (or set it if empty).
      const sep = project.latest_note ? '\n\n— ' + now + ' (from Telegram):\n' : now + ' (from Telegram):\n'
      const newNote = (project.latest_note ?? '') + sep + appendText.slice(0, 5000)
      await cfg.db.execute('UPDATE projects SET latest_note = ?, updated_at = ? WHERE id = ? AND user_id = ?', [newNote, now, project.id, userId])
      // Mirror the web UI's project_history_log write so the activity feed shows the
      // append. The table schema (0002) is (id, project_id, note, created_at) — no kind.
      try {
        await cfg.db.execute(
          'INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)',
          [uuid(), project.id, appendText.slice(0, 5000), now],
        )
      } catch { /* history is best-effort — the latest_note write is the source of truth */ }
      const preview = appendText.length > 120 ? appendText.slice(0, 117) + '…' : appendText
      await sendTelegramMessage(token, chatId, `📎 Appended to <b>${esc(project.title)}</b>:\n\n${esc(preview)}\n\n<a href="${origin}/project.html?id=${project.id}">Open it in Hibana →</a>`, 'HTML')
      return c.json({ ok: true })
    }

    // /update <project> <stage> — move a project to a new stage from Telegram (Changelogs
    // §6 open item, Session 19 cron round 2). Same project resolution as /append (id OR
    // title-prefix, user-scoped, not deleted). The stage accepts: the stage key
    // (unreviewed/investigating/awaiting/doing/halted/operational — spark is excluded: a
    // spark is an idea, not a stage you move INTO from here), the EN label, or the FA
    // label. Case-insensitive. Stage labels can be multi-word (FA: «در حال انجام», EN:
    // "In Progress"), so we match a known stage label at the END of the input; the project
    // is everything before it. Logs to project_history_log so the activity feed shows it.
    const updateMatch = text.match(/^\/update\b\s+([\s\S]+)/i)
    if (updateMatch) {
      const rest = updateMatch[1].trim()
      // Build a (label → status) map. Multi-word labels first so they win over single-word
      // stage keys when both could match (e.g. "در حال انجام" before "doing").
      const STAGE_MAP: [string, ProjectRow['status']][] = [
        ['awaiting execution', 'awaiting'],
        ['in progress', 'doing'],
        ['development stopped', 'halted'],
        ['در حال انجام', 'doing'],
        ['در حال تحقیق', 'investigating'],
        ['در انتظار اقدام', 'awaiting'],
        ['توقف توسعه', 'halted'],
        ['بررسی نشده', 'unreviewed'],
        ['unreviewed', 'unreviewed'],
        ['investigating', 'investigating'],
        ['awaiting', 'awaiting'],
        ['doing', 'doing'],
        ['halted', 'halted'],
        ['operational', 'operational'],
        ['idea', 'spark'],
        ['spark', 'spark'],
        ['عملیاتی', 'operational'],
        ['ایده', 'spark'],
      ]
      let newStatus: ProjectRow['status'] | null = null
      let projectArg = ''
      for (const [label, status] of STAGE_MAP) {
        // Match the label at the END of the input (case-insensitive for ASCII; FA is
        // already the exact case). word-boundary-safe via the leading \s.
        const re = new RegExp(`\\s${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
        const m = rest.match(re)
        if (m) {
          newStatus = status
          projectArg = rest.slice(0, m.index).trim()
          break
        }
      }
      if (!newStatus) {
        // No recognized stage → either no stage at all, or an unknown one.
        if (rest.indexOf(' ') === -1) {
          await sendTelegramMessage(token, chatId, 'Usage: /update <project-title-or-id> <stage>\n\nStages: unreviewed, investigating, awaiting, doing, halted, operational\n(e.g. /update star map doing)')
        } else {
          await sendTelegramMessage(token, chatId, `Unknown stage. Valid stages:\n\nunreviewed · investigating · awaiting · doing · halted · operational\n\n(spark/idea can't be set from here — promote an idea from the Ideas page instead.)`)
        }
        return c.json({ ok: true })
      }
      if (newStatus === 'spark') {
        await sendTelegramMessage(token, chatId, "spark/idea can't be set from here — promote an idea from the Ideas page instead.")
        return c.json({ ok: true })
      }
      if (!projectArg) {
        await sendTelegramMessage(token, chatId, 'Usage: /update <project-title-or-id> <stage>\n\nStages: unreviewed, investigating, awaiting, doing, halted, operational\n(e.g. /update star map doing)')
        return c.json({ ok: true })
      }
      // Resolve the project (id first, then title prefix — same as /append).
      let project: ProjectRow | null = null
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectArg)) {
        const rows = await cfg.db.query<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [projectArg, userId])
        project = rows[0] ?? null
      }
      if (!project) {
        const rows = await cfg.db.query<ProjectRow>(
          'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND LOWER(title) LIKE ? ORDER BY updated_at DESC LIMIT 1',
          [userId, projectArg.toLowerCase() + '%'],
        )
        project = rows[0] ?? null
      }
      if (!project) {
        await sendTelegramMessage(token, chatId, `No project found matching "${esc(projectArg)}". Send /status to see your open tasks, or open Hibana → Projects.`)
        return c.json({ ok: true })
      }
      if (project.status === newStatus) {
        await sendTelegramMessage(token, chatId, `${esc(project.title)} is already at "${newStatus}".`)
        return c.json({ ok: true })
      }
      const now = new Date().toISOString()
      await cfg.db.execute('UPDATE projects SET status = ?, archived_state = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [newStatus, now, project.id, userId])
      try {
        await cfg.db.execute(
          'INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)',
          [uuid(), project.id, `Status → ${newStatus} (from Telegram)`, now],
        )
      } catch { /* history is best-effort — the status write is the source of truth */ }
      await sendTelegramMessage(token, chatId, `✅ ${t(lang, 'Stage updated', 'مرحله به‌روز شد')}: <b>${esc(project.title)}</b>\n\n${esc(project.status)} → <b>${esc(newStatus)}</b>\n\n<a href="${origin}/project.html?id=${project.id}">${t(lang, 'Open it in Hibana', 'در هیبانا باز کن')} →</a>`, 'HTML')
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
          await captureIdeaReply(text, true)
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
            'SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL AND LOWER(title) LIKE ? ORDER BY updated_at DESC LIMIT 10',
            [userId, text.toLowerCase() + '%'],
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
    await captureIdeaReply(text, false)
    return c.json({ ok: true })
  })

  // Any authenticated user can link their own Telegram chat (§4.10): Settings shows a
  // one-time code; the user sends /start <code> to the bot. Codes expire after 1h and
  // generating a new one invalidates any previous unused code for the same account.
  // M9 fix (2026-09-10): changed from GET to POST — this endpoint deletes + inserts in a
  // transaction (state-changing), so the CSRF middleware (which only checks POST/PUT/PATCH/
  // DELETE) must apply. A GET was exempt and could be triggered by <img src> or CSRF.
  app.post('/api/telegram/link-code', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    // 12 hex chars (48 bits, hardening 2026-08-28): the code links a chat to an account —
    // 8 hex chars was only ~4.3B guesses. Telegram's own flood limits make brute force
    // impractical either way, but doubling the entropy costs nothing.
    const code = uuid().replace(/-/g, '').slice(0, 12)
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM telegram_links WHERE created_at < ?', [new Date(Date.now() - LINK_CODE_TTL_MS).toISOString()]) // expired sweep
      tx.sql('DELETE FROM telegram_links WHERE user_id = ?', [user.id]) // one active code per account
      tx.sql('INSERT INTO telegram_links (code, user_id, created_at) VALUES (?, ?, ?)', [code, user.id, new Date().toISOString()])
    })
    return c.json({ ok: true, code })
  })

  // Authed status for Settings: is this account linked, and where is the bot?
  app.get('/api/telegram/status', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    return c.json({ ok: true, bot: TELEGRAM_BOT.handle, botUrl: TELEGRAM_BOT.url, linked: !!user.telegram_chat_id, chat_id: user.telegram_chat_id })
  })

  // Unlink: severs the chat mapping for this account. Captures already assigned stay —
  // they are account data now (rule 1); only the delivery channel is cut.
  app.delete('/api/telegram/link', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [user.id])
      tx.sql('DELETE FROM telegram_links WHERE user_id = ?', [user.id])
    })
    return c.json({ ok: true })
  })
}

// ---- callback_query dispatcher (inline keyboard taps) ---------------------------
// Every op-code is self-contained (≤ ~41 bytes, well under Telegram's 64-byte callback_data
// cap). The op-code always wins and REPLACES any active await_text intent (design §8.1).
async function handleCallback(
  token: string,
  chatId: number,
  messageId: number,
  user: Pick<UserRow, 'id' | 'username' | 'telegram_paused' | 'language_pref' | 'timezone' | 'sadhana_quadrant_order' | 'role'>,
  data: string,
  cfg: Config,
  origin: string,
): Promise<void> {
  const db = cfg.db
  const userId = user.id
  const lang = user.language_pref as Lang

  // 🏠 Home / ↩️ Cancel — clear any active intent and show the home keyboard.
  if (data === 'home') {
    await clearSession(db, userId)
    await render(token, chatId, messageId, homeText(lang), homeKeyboard(lang))
    return
  }

  // 💡 New Idea — enter await_text:idea.
  if (data === 'idea') {
    await setSession(db, userId, { kind: 'await_text', intent: 'idea' })
    await render(token, chatId, messageId, t(lang, '💡 Send me your idea — one message. I’ll capture it as a Spark.', '💡 ایده‌ات را بفرست — یک پیام. به‌عنوان ایده ذخیره می‌کنم.'), cancelKeyboard(lang))
    return
  }

  // 📝 Note — enter await_text:note.
  if (data === 'note') {
    await setSession(db, userId, { kind: 'await_text', intent: 'note' })
    await render(token, chatId, messageId, t(lang, '📝 Send me the note — I’ll add it to your dashboard.', '📝 یادداشت را بفرست — به داشبوردت اضافه می‌کنم.'), cancelKeyboard(lang))
    return
  }

  // 📋 To-do — show the user's quadrant grid (their names + order).
  if (data === 'todo') {
    const nameRows = await db.query<{ quadrant: number; name: string }>('SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = ?', [userId])
    const names = new Map(nameRows.map((r) => [r.quadrant, r.name]))
    await render(token, chatId, messageId, quadrantGridText(lang), quadrantKeyboard(lang, names, user.sadhana_quadrant_order))
    return
  }

  // Quadrant open: q{1-4} (page 0) or q{1-4}p{n} (page n).
  const qPageMatch = data.match(/^q([1-4])p(\d+)$/)
  const qOpenMatch = data.match(/^q([1-4])$/)
  if (qPageMatch || qOpenMatch) {
    const qid = Number((qPageMatch ?? qOpenMatch)![1])
    const page = qPageMatch ? Number(qPageMatch[2]) : 0
    await renderQuadrant(token, chatId, db, userId, lang, qid, page, messageId)
    return
  }

  // Add a task to a quadrant: q{1-4}add → await_text:sadhana_task.
  const qAddMatch = data.match(/^q([1-4])add$/)
  if (qAddMatch) {
    const qid = Number(qAddMatch[1])
    await setSession(db, userId, { kind: 'await_text', intent: 'sadhana_task', quadrant: qid })
    const meta = QUADRANTS.find((q) => q.id === qid)!
    const nameRows = await db.query<{ quadrant: number; name: string }>('SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?', [userId, qid])
    const name = nameRows[0]?.name ?? t(lang, meta.name.en, meta.name.fa)
    await render(token, chatId, messageId, t(lang, `➕ New task for <b>${esc(name)}</b> — send the title:`, `➕ کار جدید برای <b>${esc(name)}</b> — عنوان را بفرست:`), cancelKeyboard(lang))
    return
  }

  // ✅ Mark a task done: d:<uuid>. (Approved round 1, design §9 — reversible, non-losing.)
  const doneMatch = data.match(/^d:(.+)$/)
  if (doneMatch) {
    const taskId = doneMatch[1]
    const rows = await db.query<{ id: string; title: string; emoji: string; recurring: number }>(
      'SELECT id, title, emoji, recurring FROM sadhana_tasks WHERE id = ? AND user_id = ? AND done = 0 AND deleted_at IS NULL',
      [taskId, userId],
    )
    if (rows.length === 0) {
      await render(token, chatId, messageId, t(lang, 'Task not found (maybe already done).', 'کار پیدا نشد (شاید已完成 است).'), homeKeyboard(lang))
      return
    }
    const task = rows[0]
    const now = new Date().toISOString()
    const today = todayIn(user.timezone)
    // done=1; for recurring tasks set recur_last so resetDueRecurring can re-open on the next cycle (mirrors web app).
    await db.execute('UPDATE sadhana_tasks SET done = 1, updated_at = ?, recur_last = CASE WHEN recurring = 1 THEN ? ELSE recur_last END WHERE id = ? AND user_id = ?', [now, today, taskId, userId])
    await render(
      token,
      chatId,
      messageId,
      `✅ ${t(lang, 'Done', 'انجام شد')}: <b>${task.emoji || '📌'} ${esc(task.title)}</b>`,
      kb([
        [{ text: t(lang, '↩️ Undo', '↩️ برگردان'), callback_data: `u:${taskId}` }, { text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
      ]),
    )
    return
  }

  // ↩️ Undo a mark-done: u:<uuid>.
  const undoMatch = data.match(/^u:(.+)$/)
  if (undoMatch) {
    const taskId = undoMatch[1]
    const rows = await db.query<{ title: string; emoji: string }>('SELECT title, emoji FROM sadhana_tasks WHERE id = ? AND user_id = ? AND done = 1', [taskId, userId])
    if (rows.length === 0) {
      await render(token, chatId, messageId, t(lang, 'Nothing to undo.', 'چیزی برای برگردان نیست.'), homeKeyboard(lang))
      return
    }
    const task = rows[0]
    const now = new Date().toISOString()
    await db.execute('UPDATE sadhana_tasks SET done = 0, recur_last = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [now, taskId, userId])
    await render(
      token,
      chatId,
      messageId,
      `↩️ ${t(lang, 'Reopened', 'باز شد')}: <b>${task.emoji || '📌'} ${esc(task.title)}</b>`,
      kb([[{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }]]),
    )
    return
  }

  // 🌐 Language picker.
  if (data === 'lang') {
    await render(token, chatId, messageId, langText(lang), langKeyboard(lang))
    return
  }
  // lang:en / lang:fa → update users.language_pref (single source of truth — web locale changes too, round 2 Q1).
  if (data === 'lang:en' || data === 'lang:fa') {
    const newLang: Lang = data === 'lang:en' ? 'en' : 'fa'
    await db.execute('UPDATE users SET language_pref = ? WHERE id = ?', [newLang, userId])
    await render(token, chatId, messageId, t(newLang, '✅ Language saved.', '✅ زبان ذخیره شد.'), homeKeyboard(newLang))
    return
  }

  // ⚙️ Settings.
  if (data === 'set') {
    await render(
      token, chatId, messageId,
      settingsText(lang, user.telegram_paused === 1, user.role === 'owner'),
      settingsKeyboard(lang, user.telegram_paused === 1, user.role === 'owner'),
    )
    return
  }
  // 🗄 Send backup now (Plan B, 0044 → session 14) — owner-only ON-DEMAND action: one
  // tap sends one encrypted whole-DB snapshot document to THIS chat and confirms in
  // place. The old toggle (auto 4×/day sends) is gone — backups never message the chat
  // on their own anymore. A member's crafted 'bak' callback is a no-op (the snapshot
  // must never be deliverable to a member chat).
  if (data === 'bak') {
    if (user.role !== 'owner') {
      // The button is hidden for members, but a crafted callback must still be a no-op.
      await render(token, chatId, messageId, settingsText(lang, user.telegram_paused === 1, false), settingsKeyboard(lang, user.telegram_paused === 1, false))
      return
    }
    const r = await sendPlanBBackupToChat(cfg, userId, String(chatId))
    if (r.ok) {
      await render(
        token, chatId, messageId,
        t(
          lang,
          `🗄 <b>Backup sent</b> — ${new Date().toISOString().slice(11, 16)} UTC\nsha256 <code>${r.sha256.slice(0, 16)}…</code> · restore: docs/runbook.md §2b`,
          `🗄 <b>پشتیبان ارسال شد</b> — ${new Date().toISOString().slice(11, 16)} UTC\nsha256 <code>${r.sha256.slice(0, 16)}…</code> · بازیابی: docs/runbook.md §2b`,
        ),
        settingsKeyboard(lang, user.telegram_paused === 1, true),
      )
    } else {
      await render(
        token, chatId, messageId,
        t(
          lang,
          `⚠️ <b>Backup failed</b>\n${r.reason ?? 'unknown error'}\n\nTry again in a moment.`,
          `⚠️ <b>ارسال پشتیبان ناموفق بود</b>\n${r.reason ?? 'خطای ناشناخته'}\n\n کمی بعد دوباره امتحان کن.`,
        ),
        settingsKeyboard(lang, user.telegram_paused === 1, true),
      )
    }
    return
  }
  // ⏸ Pause / ▶️ Resume reminders (toggles users.telegram_paused).
  if (data === 'pause' || data === 'resume') {
    const pause = data === 'pause'
    await db.execute('UPDATE users SET telegram_paused = ? WHERE id = ?', [pause ? 1 : 0, userId])
    const newPaused = pause
    await render(
      token, chatId, messageId,
      settingsText(lang, newPaused, user.role === 'owner'),
      settingsKeyboard(lang, newPaused, user.role === 'owner'),
    )
    return
  }
  // 🔐 Reset password (issues a one-time reset token, delivered in-chat).
  if (data === 'reset') {
    const resetToken = await createResetToken(db, userId)
    const link = `${origin}/reset.html?token=${resetToken}`
    await render(
      token,
      chatId,
      messageId,
      t(lang, `🔐 Password reset for your Hibana account:\n\n<a href="${link}">Set a new password →</a>\n\nExpires in 1 hour.`, `🔐 بازنشانی رمز هیبانا:\n\n<a href="${link}">رمز جدید →</a>\n\nتا ۱ ساعت دیگر اعتبار دارد.`),
      kb([[{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }]]),
    )
    return
  }

  // ❓ Help.
  if (data === 'help') {
    await render(token, chatId, messageId, helpText(lang), helpKeyboard(lang), undefined)
    return
  }

  // 🔗 Connect (open the project list for the note pending in session.connect_list).
  if (data === 'connect') {
    const session = await getSession(db, userId)
    if (!session || session.kind !== 'connect_list') {
      await render(token, chatId, messageId, t(lang, 'No note to connect. Tap 📝 Note first.', 'یادداشتی برای اتصال نیست. اول 📝 یادداشت را بزن.'), homeKeyboard(lang))
      return
    }
    const offset = 0
    const projects = await db.query<{ id: string; title: string }>(
      'SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [userId, PROJECT_PAGE_SIZE, offset],
    )
    const countRows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL', [userId])
    const total = Math.max(1, Math.ceil((countRows[0]?.n ?? 0) / PROJECT_PAGE_SIZE))
    await render(token, chatId, messageId, connectListText(lang, 0, total), connectListKeyboard(lang, projects, 0, total))
    return
  }
  // Connect-list pagination: connectp{n}.
  const connectPageMatch = data.match(/^connectp(\d+)$/)
  if (connectPageMatch) {
    const page = Number(connectPageMatch[1])
    const session = await getSession(db, userId)
    if (!session || session.kind !== 'connect_list') {
      await render(token, chatId, messageId, homeText(lang), homeKeyboard(lang))
      return
    }
    const offset = page * PROJECT_PAGE_SIZE
    const projects = await db.query<{ id: string; title: string }>(
      'SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [userId, PROJECT_PAGE_SIZE, offset],
    )
    const countRows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL', [userId])
    const total = Math.max(1, Math.ceil((countRows[0]?.n ?? 0) / PROJECT_PAGE_SIZE))
    await render(token, chatId, messageId, connectListText(lang, page, total), connectListKeyboard(lang, projects, page, total))
    return
  }
  // cp:<projectId> — connect the pending note (session.connect_list.noteId) to this project.
  const connectMatch = data.match(/^cp:(.+)$/)
  if (connectMatch) {
    const projectId = connectMatch[1]
    const session = await getSession(db, userId)
    if (!session || session.kind !== 'connect_list') {
      await render(token, chatId, messageId, t(lang, 'No note to connect.', 'یادداشتی برای اتصال نیست.'), homeKeyboard(lang))
      return
    }
    const projRows = await db.query<{ id: string; title: string }>('SELECT id, title FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [projectId, userId])
    if (projRows.length === 0) {
      await render(token, chatId, messageId, t(lang, 'Project not found.', 'پروژه پیدا نشد.'), homeKeyboard(lang))
      return
    }
    // Attach the note to the project (quick_notes.project_id — migration 0017). rule 1: user_id filter.
    await db.execute('UPDATE quick_notes SET project_id = ? WHERE id = ? AND user_id = ?', [projectId, session.noteId, userId])
    await clearSession(db, userId)
    await render(
      token,
      chatId,
      messageId,
      `🔗 ${t(lang, 'Connected to', 'متصل شد به')} <b>${esc(projRows[0].title)}</b>\n\n<a href="${origin}/project.html?id=${projectId}">${t(lang, 'Open in Hibana →', 'باز کردن در هیبانا →')}</a>`,
      kb([[{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }]]),
    )
    return
  }
  // 🔍 Search → await_text:proj_search (carry the noteId).
  if (data === 'psearch') {
    const session = await getSession(db, userId)
    if (!session || session.kind !== 'connect_list') {
      await render(token, chatId, messageId, homeText(lang), homeKeyboard(lang))
      return
    }
    await setSession(db, userId, { kind: 'await_text', intent: 'proj_search', noteId: session.noteId })
    await render(token, chatId, messageId, t(lang, '🔍 Type a few letters of the project title:', '🔍 چند حرف از عنوان پروژه را بنویس:'), cancelKeyboard(lang))
    return
  }

  // Unknown callback — show home.
  await render(token, chatId, messageId, homeText(lang), homeKeyboard(lang))
}

// Obsidian bulk import (spec §9): exported .md files — or a .zip of the whole vault —
