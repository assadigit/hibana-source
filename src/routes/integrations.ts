import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { uuid } from '../lib/ids'
import { markdownFromZip, parseMarkdownNote, ZipLimitError } from '../lib/obsidian'
import { esc, requestOrigin } from '../lib/http'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import { createResetToken } from '../services/reset'
import { sendTelegramMessage, answerCallbackQuery, editMessageText, type ReplyMarkup } from '../services/telegram'
import { timingSafeEqualStr } from '../lib/crypto'
import { trL } from '../lib/i18n'
import { QUADRANTS, orderedQuadrants, parseQuadrantOrder, todayIn } from '../services/sadhana'
import type { Config, ProjectRow, UserRow } from '../types'
import type { Db } from '../db/types'

// Telegram bot (spec §9 + §4.10) + Obsidian import (spec §9).
//
// Inline-keyboard redesign (design: docs/telegram-bot-flow.md, approved rounds 1+2).
// The webhook now dispatches in this order (§8.1): callback_query → slash command →
// active await_text intent → await_list_item → default idea capture. A single
// `telegram_bot_sessions` row per user (migration 0043, no TTL) backs every
// await_text intent + the /list flow — "not finite" by design.

// timingSafeEqualStr moved to src/lib/crypto.ts (P2.2 / F-L28).
// register*() functions add routes directly to the ROOT Hono app, before any sub-app at
// '/' — this is deliberate: coreRoutes has a global requireAuth middleware that would
// otherwise intercept the (public) Telegram webhook. Root-level routes are matched first
// and are not subject to the mounted apps' wildcard middleware.

const tgApi = (token: string, method: string, body: Record<string, unknown>) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const UPDATE_SCHEMA = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      from: z.object({ id: z.number() }),
      text: z.string().optional().default(''),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: z.object({ id: z.number() }),
      message: z.object({ message_id: z.number(), chat: z.object({ id: z.number() }), text: z.string().optional() }),
      data: z.string(),
    })
    .optional(),
  text: z.string().optional(),
})

// The bot's public identity — Settings shows it so users know what to open, and the
// webhook's unlinked-chat replies point back here. Tokens come from secrets; the handle
// is not secret, so a module constant is fine (it keeps Settings and replies in sync).
const TELEGRAM_BOT = { handle: '@Hibana_PM_bot', url: 'https://t.me/Hibana_PM_bot' }
const LINK_CODE_TTL_MS = 60 * 60 * 1000 // link codes expire after 1h, like password resets

// ---- Bot note/list helpers (/note + /list flows) --------------------------------
const LIST_MAX_ITEMS = 50
const ITEM_MAX_CHARS = 300 // mirrors the web UI's per-item cap (quicknotes.ts)
const NOTE_MAX_CHARS = 20_000
const SADHANA_PAGE_SIZE = 8
const PROJECT_PAGE_SIZE = 10

type Lang = 'en' | 'fa'
type BotState =
  | { kind: 'home' }
  | { kind: 'await_text'; intent: 'idea' }
  | { kind: 'await_text'; intent: 'note' }
  | { kind: 'await_text'; intent: 'sadhana_task'; quadrant: number }
  | { kind: 'await_text'; intent: 'proj_search'; noteId: string }
  | { kind: 'await_list_item'; items: string[] }
  | { kind: 'connect_list'; noteId: string }

/** One row per linked user, JSON state, no TTL (design §7.3 — "not finite"). */
async function getSession(db: Db, userId: string): Promise<BotState | null> {
  const rows = await db.query<{ state: string }>('SELECT state FROM telegram_bot_sessions WHERE user_id = ?', [userId])
  if (rows.length === 0) return null
  try {
    const s = JSON.parse(rows[0].state)
    return s && typeof s === 'object' && typeof s.kind === 'string' ? (s as BotState) : null
  } catch {
    return null
  }
}
async function setSession(db: Db, userId: string, state: BotState): Promise<void> {
  await db.execute(
    'INSERT INTO telegram_bot_sessions (user_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at',
    [userId, JSON.stringify(state), new Date().toISOString()],
  )
}
async function clearSession(db: Db, userId: string): Promise<void> {
  await db.execute('DELETE FROM telegram_bot_sessions WHERE user_id = ?', [userId])
}

/** Pending items for a user's /list session; null when none exists. (No TTL — design §7.4.) */
async function noteSession(db: Db, userId: string): Promise<string[] | null> {
  const s = await getSession(db, userId)
  return s && s.kind === 'await_list_item' ? s.items : null
}
async function saveNoteSession(db: Db, userId: string, items: string[]): Promise<void> {
  await setSession(db, userId, { kind: 'await_list_item', items })
}

/** A plain Quick Note card on the dashboard notebook (project_id optional for the connect step). */
async function createQuickNote(db: Db, userId: string, content: string, projectId: string | null = null): Promise<string> {
  const id = uuid()
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, 'note', '', content.trim().slice(0, NOTE_MAX_CHARS), projectId, now, now],
  )
  return id
}

/** A checklist card on the dashboard notebook — same JSON items shape as the web UI. */
async function createListNote(db: Db, userId: string, items: string[]): Promise<number> {
  const tasks = items.map((t) => ({ id: uuid(), t: t.slice(0, ITEM_MAX_CHARS), d: 0 as const }))
  const id = uuid()
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, 'list', '', JSON.stringify(tasks), now, now],
  )
  await clearSession(db, userId) // consumed by the save
  return tasks.length
}

/** Insert a Spark-status idea (telegram_captures + projects). Returns the new project id. */
async function insertIdea(db: Db, userId: string, raw: string, telegramUserId: string): Promise<string> {
  const id = uuid()
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO telegram_captures (id, user_id, raw_text, telegram_user_id, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, raw, telegramUserId, now, now],
  )
  await db.execute(
    "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'personal', 'spark', 0, 'Captured from Telegram', 0, ?, ?)",
    [id, userId, raw.slice(0, 120), raw, now, now],
  )
  return id
}

// ---- i18n + keyboard helpers (bilingual, emoji-anchored; FA keyboards render LTR) --
const t = (lang: Lang, en: string, fa: string): string => (lang === 'fa' ? fa : en)
const tr = (lang: Lang, en: string, fa: string, vars?: Record<string, string | number>): string => trL(lang, en, fa, vars)
const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function kb(rows: NonNullable<ReplyMarkup['inline_keyboard']>): ReplyMarkup {
  return { inline_keyboard: rows }
}

function homeKeyboard(lang: Lang): ReplyMarkup {
  return kb([
    [{ text: t(lang, '💡 New Idea', '💡 ایده'), callback_data: 'idea' }],
    [
      { text: t(lang, '📋 To-do', '📋 کارها'), callback_data: 'todo' },
      { text: t(lang, '📝 Note', '📝 یادداشت'), callback_data: 'note' },
    ],
    [
      { text: t(lang, '⚙️ Settings', '⚙️ تنظیمات'), callback_data: 'set' },
      { text: t(lang, '❓ Help', '❓ راهنما'), callback_data: 'help' },
    ],
  ])
}
function homeText(lang: Lang): string {
  return t(lang, 'Hibana — what’s next?', 'هیبانا — بعدی چی؟')
}

function cancelKeyboard(lang: Lang): ReplyMarkup {
  return kb([[{ text: t(lang, '↩️ Cancel', '↩️ لغو'), callback_data: 'home' }]])
}

function helpText(lang: Lang): string {
  return t(
    lang,
    '🤖 Hibana bot — tap a button or send:\n\n/idea <text> — save a new Idea\n/note <text> — add a Quick Note\n/list — collect a list (/done saves, /cancel stops)\n/append <project> <text> — append to a project\n/status — open tasks + deadlines\n/pause · /resume — reminders\n/reset — password reset link\n/language — change language\n/menu — home',
    '🤖 ربات هیبانا — دکمه بزن یا بفرست:\n\n/idea <متن> — ذخیرهٔ ایده\n/note <متن> — یادداشت سریع\n/list — جمع‌آوری فهرست (/done ذخیره، /cancel لغو)\n/append <پروژه> <متن> — افزودن به پروژه\n/status — کارها و مهلت‌ها\n/pause · /resume — یادآوری‌ها\n/reset — بازنشانی رمز\n/language — تغییر زبان\n/menu — خانه',
  )
}
function helpKeyboard(lang: Lang): ReplyMarkup {
  return kb([
    [{ text: t(lang, '💡 New Idea', '💡 ایده'), callback_data: 'idea' }],
    [
      { text: t(lang, '📋 To-do', '📋 کارها'), callback_data: 'todo' },
      { text: t(lang, '📝 Note', '📝 یادداشت'), callback_data: 'note' },
    ],
    [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
  ])
}

function langKeyboard(lang: Lang): ReplyMarkup {
  return kb([
    [{ text: '🇬🇧 English', callback_data: 'lang:en' }, { text: '🇮🇷 فارسی', callback_data: 'lang:fa' }],
    [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
  ])
}
function langText(lang: Lang): string {
  return t(lang, 'Pick a language for the bot (this also changes your web app language):', 'زبان ربات را انتخاب کن (این زبان برنامهٔ تحت وب هم تغییر می‌کند):')
}

function settingsKeyboard(lang: Lang, paused: boolean): ReplyMarkup {
  return kb([
    [{ text: t(lang, '🌐 Language', '🌐 زبان'), callback_data: 'lang' }],
    [
      paused
        ? { text: t(lang, '▶️ Resume reminders', '▶️ ازسرگیری یادآوری'), callback_data: 'resume' }
        : { text: t(lang, '⏸ Pause reminders', '⏸ توقف یادآوری'), callback_data: 'pause' },
    ],
    [{ text: t(lang, '🔐 Reset password', '🔐 بازنشانی رمز'), callback_data: 'reset' }],
    [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
  ])
}
function settingsText(lang: Lang, paused: boolean): string {
  return t(
    lang,
    `⚙️ <b>Settings</b>\n\nReminders: ${paused ? '⏸ paused' : '✅ on'}`,
    `⚙️ <b>تنظیمات</b>\n\nیادآوری‌ها: ${paused ? '⏸ متوقف' : '✅ روشن'}`,
  )
}

function quadrantKeyboard(lang: Lang, names: Map<number, string>, orderRaw: string | null): ReplyMarkup {
  const order = orderedQuadrants(QUADRANTS, orderRaw)
  const rows: NonNullable<ReplyMarkup['inline_keyboard']> = []
  for (let i = 0; i < order.length; i += 2) {
    rows.push(
      order.slice(i, i + 2).map((q) => {
        const name = names.get(q.id) ?? t(lang, q.name.en, q.name.fa)
        return { text: truncate(`${q.icon} ${name}`, 20), callback_data: `q${q.id}` }
      }),
    )
  }
  rows.push([{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }])
  return kb(rows)
}
function quadrantGridText(lang: Lang): string {
  return t(lang, '📋 <b>To-do</b> — pick a quadrant:', '📋 <b>کارها</b> — یک بخش انتخاب کن:')
}

function taskListText(lang: Lang, qid: number, names: Map<number, string>, tasks: { id: string; title: string; emoji: string }[], page: number, total: number): string {
  const meta = QUADRANTS.find((q) => q.id === qid)!
  const name = names.get(qid) ?? t(lang, meta.name.en, meta.name.fa)
  const header = `${meta.icon} <b>${esc(name)}</b> — ${tasks.length} open (page ${page + 1}/${total})\n\n`
  const body = tasks.map((task, i) => `${i + 1}. ${task.emoji || '📌'} ${esc(task.title)}`).join('\n')
  return header + body
}
function taskListKeyboard(lang: Lang, qid: number, page: number, total: number, tasks: { id: string }[]): ReplyMarkup {
  const rows: NonNullable<ReplyMarkup['inline_keyboard']> = []
  for (let i = 0; i < tasks.length; i += 4) {
    rows.push(tasks.slice(i, i + 4).map((task, idx) => ({ text: `✅ ${i + idx + 1}`, callback_data: `d:${task.id}` })))
  }
  const nav: { text: string; callback_data: string }[] = []
  if (page > 0) nav.push({ text: t(lang, '‹ Prev', '‹ قبلی'), callback_data: `q${qid}p${page - 1}` })
  if (page < total - 1) nav.push({ text: t(lang, 'Next ›', 'بعدی ›'), callback_data: `q${qid}p${page + 1}` })
  if (nav.length) rows.push(nav)
  rows.push([
    { text: t(lang, '➕ Add task', '➕ افزودن'), callback_data: `q${qid}add` },
    { text: t(lang, '↩️ Back', '↩️ بازگشت'), callback_data: 'todo' },
  ])
  rows.push([{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }])
  return kb(rows)
}

function connectListText(lang: Lang, page: number, total: number): string {
  return t(lang, `🔗 Connect to a project (page ${page + 1}/${total}):`, `🔗 اتصال به پروژه (صفحه ${page + 1}/${total}):`)
}
function connectListKeyboard(lang: Lang, projects: { id: string; title: string }[], page: number, total: number): ReplyMarkup {
  const rows: NonNullable<ReplyMarkup['inline_keyboard']> = projects.map((p) => [
    { text: `📁 ${truncate(p.title, 28)}`, callback_data: `cp:${p.id}` },
  ])
  const nav: { text: string; callback_data: string }[] = []
  if (page > 0) nav.push({ text: t(lang, '‹ Prev', '‹ قبلی'), callback_data: `connectp${page - 1}` })
  if (page < total - 1) nav.push({ text: t(lang, 'Next ›', 'بعدی ›'), callback_data: `connectp${page + 1}` })
  if (nav.length) rows.push(nav)
  rows.push([
    { text: t(lang, '🔍 Search', '🔍 جستجو'), callback_data: 'psearch' },
    { text: t(lang, '↩️ Skip', '↩️ رد شدن'), callback_data: 'home' },
  ])
  rows.push([{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }])
  return kb(rows)
}

/** Edit the tapped message in place; fall back to a new message if the edit is rejected (too old / unchanged). */
async function render(token: string, chatId: number, messageId: number, text: string, keyboard: ReplyMarkup, parseMode: 'HTML' | undefined = 'HTML'): Promise<void> {
  const r = await editMessageText(token, chatId, messageId, text, parseMode, keyboard)
  if (!r.ok) {
    // edit failed (message unchanged / too old) — send a fresh message
    await sendTelegramMessage(token, chatId, text, parseMode, keyboard)
  }
}

/** Render a quadrant's task-list page (used by callbacks and after add-task). */
async function renderQuadrant(token: string, chatId: number, db: Db, userId: string, lang: Lang, qid: number, page: number, editMessageId?: number) {
  const nameRows = await db.query<{ quadrant: number; name: string }>('SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = ?', [userId])
  const names = new Map(nameRows.map((r) => [r.quadrant, r.name]))
  const offset = page * SADHANA_PAGE_SIZE
  const tasks = await db.query<{ id: string; title: string; emoji: string }>(
    'SELECT id, title, emoji FROM sadhana_tasks WHERE user_id = ? AND quadrant = ? AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL ORDER BY pinned DESC, position ASC, created_at DESC LIMIT ? OFFSET ?',
    [userId, qid, SADHANA_PAGE_SIZE, offset],
  )
  const countRows = await db.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sadhana_tasks WHERE user_id = ? AND quadrant = ? AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL',
    [userId, qid],
  )
  const total = Math.max(1, Math.ceil((countRows[0]?.n ?? 0) / SADHANA_PAGE_SIZE))
  const text = taskListText(lang, qid, names, tasks, page, total)
  const keyboard = taskListKeyboard(lang, qid, page, total, tasks)
  if (editMessageId) await render(token, chatId, editMessageId, text, keyboard)
  else await sendTelegramMessage(token, chatId, text, 'HTML', keyboard)
}

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
      const owned = await cfg.db.query<Pick<UserRow, 'id' | 'username' | 'telegram_paused' | 'language_pref' | 'timezone' | 'sadhana_quadrant_order'>>(
        'SELECT id, username, telegram_paused, language_pref, timezone, sadhana_quadrant_order FROM users WHERE telegram_chat_id = ?',
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
    const owned = await cfg.db.query<Pick<UserRow, 'id' | 'username' | 'telegram_paused' | 'language_pref' | 'timezone' | 'sadhana_quadrant_order'>>(
      'SELECT id, username, telegram_paused, language_pref, timezone, sadhana_quadrant_order FROM users WHERE telegram_chat_id = ?',
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
  user: Pick<UserRow, 'id' | 'username' | 'telegram_paused' | 'language_pref' | 'timezone' | 'sadhana_quadrant_order'>,
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
    await render(token, chatId, messageId, settingsText(lang, user.telegram_paused === 1), settingsKeyboard(lang, user.telegram_paused === 1))
    return
  }
  // ⏸ Pause / ▶️ Resume reminders (toggles users.telegram_paused).
  if (data === 'pause' || data === 'resume') {
    const pause = data === 'pause'
    await db.execute('UPDATE users SET telegram_paused = ? WHERE id = ?', [pause ? 1 : 0, userId])
    const newPaused = pause
    await render(token, chatId, messageId, settingsText(lang, newPaused), settingsKeyboard(lang, newPaused))
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
// become Ideas (H1 or filename as the title, tagged “Imported”). Re-importing the same
// notes is a no-op: a title that already exists (case-insensitive, per user) is skipped.
export function registerImport(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.post('/api/import/obsidian', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    // Heavy-endpoint metering (hardening 2026-08-28): import inflates archives and writes
    // unbounded rows — 5 per minute per IP is generous for a real vault import.
    if (await hitRateLimit(cfg.db, RATE_RULES.import, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many imports — wait a minute and try again.' }, 429)
    }
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'invalid_input' }, 400)

    const allFiles = (form.getAll('files') as File[]).filter((f) => f && typeof f.arrayBuffer === 'function')
    const mdFiles = allFiles.filter((f) => /\.md$/i.test(f.name ?? ''))
    const zipFiles = allFiles.filter((f) => /\.zip$/i.test(f.name ?? ''))
    if (mdFiles.length === 0 && zipFiles.length === 0) {
      return c.json({ error: 'no_markdown_files', message: 'Attach .md files or a .zip of your exported notes.' }, 400)
    }
    // Request-shape caps (hardening 2026-08-28): bounded file count + total upload bytes,
    // enforced before anything is read into memory. 100MB matches Cloudflare's body cap.
    const MAX_FILES = 200
    const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
    if (allFiles.length > MAX_FILES) {
      return c.json({ error: 'too_many', message: `Attach at most ${MAX_FILES} files per import.` }, 400)
    }
    const totalBytes = allFiles.reduce((n, f) => n + (f.size ?? 0), 0)
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return c.json({ error: 'too_many', message: 'Import is limited to 100MB of uploads per request.' }, 413)
    }

    // rule 1: titles are scoped to this user; collect existing ones once for dedupe.
    const existing = await cfg.db.query<{ title: string }>("SELECT LOWER(title) AS title FROM projects WHERE user_id = ?", [user.id])
    const knownTitles = new Set(existing.map((r) => String(r.title).toLowerCase()))

    const notes: Array<{ fileName: string; content: string }> = []
    for (const file of mdFiles) notes.push({ fileName: file.name, content: await file.text() })
    for (const file of zipFiles) {
      try {
        notes.push(...markdownFromZip(new Uint8Array(await file.arrayBuffer())))
      } catch (err) {
        if (err instanceof ZipLimitError) {
          return c.json({ error: 'too_many', message: err.message }, 413)
        }
        return c.json({ error: 'invalid_zip', message: 'Could not read that .zip file — is it a valid archive?' }, 400)
      }
    }

    let count = 0
    let duplicates = 0
    // H1 fix (2026-09-10): resolve the 'Imported' tag id atomically BEFORE the transaction
    // loop. The old pattern queried inside the loop on every iteration — pre-batch reads see
    // stale state, so every iteration after the first tried to INSERT a duplicate 'Imported'
    // tag, hitting UNIQUE(user_id, name) and rolling back the ENTIRE import. A fresh-user
    // multi-note import was guaranteed to fail.
    const importedTagRows = await cfg.db.query<{ id: string }>(
      `INSERT INTO tags (id, user_id, name, color, usage_count, created_at)
       VALUES (?, ?, 'Imported', '#94a3b8', 0, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
       RETURNING id`,
      [uuid(), user.id, new Date().toISOString()],
    )
    const importedTagId = importedTagRows[0]?.id
    // P3.2 (F-M3): wrap the whole import loop in ONE transaction. Was ~200 sequential
    // iterations each doing an INSERT + a sub-transaction (3-4 round trips each). Now
    // batched: all INSERTs + tag links land atomically; a failure rolls back the whole
    // import (no half-imported state).
    await cfg.db.transaction(async (tx) => {
      for (const note of notes) {
        const parsed = parseMarkdownNote(note.fileName, note.content)
        if (!parsed) continue
        const key = parsed.title.toLowerCase()
        if (knownTitles.has(key)) {
          duplicates++
          continue
        }
        knownTitles.add(key)

        const id = uuid()
        const now = new Date().toISOString()
        tx.sql(
          "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'personal', 'spark', 0, '', 0, ?, ?)",
          [id, user.id, parsed.title, parsed.description, now, now],
        )
        if (importedTagId) tx.sql('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [id, importedTagId])
        count++
      }
    })
    return c.json({ ok: true, imported: count, duplicates })
  })
}
