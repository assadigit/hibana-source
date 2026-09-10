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

export const tgApi = (token: string, method: string, body: Record<string, unknown>) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const UPDATE_SCHEMA = z.object({
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
export const TELEGRAM_BOT = { handle: '@Hibana_PM_bot', url: 'https://t.me/Hibana_PM_bot' }
export const LINK_CODE_TTL_MS = 60 * 60 * 1000 // link codes expire after 1h, like password resets

// ---- Bot note/list helpers (/note + /list flows) --------------------------------
export const LIST_MAX_ITEMS = 50
export const ITEM_MAX_CHARS = 300 // mirrors the web UI's per-item cap (quicknotes.ts)
export const NOTE_MAX_CHARS = 20_000
export const SADHANA_PAGE_SIZE = 8
export const PROJECT_PAGE_SIZE = 10

export type Lang = 'en' | 'fa'
export type BotState =
  | { kind: 'home' }
  | { kind: 'await_text'; intent: 'idea' }
  | { kind: 'await_text'; intent: 'note' }
  | { kind: 'await_text'; intent: 'sadhana_task'; quadrant: number }
  | { kind: 'await_text'; intent: 'proj_search'; noteId: string }
  | { kind: 'await_list_item'; items: string[] }
  | { kind: 'connect_list'; noteId: string }

/** One row per linked user, JSON state, no TTL (design §7.3 — "not finite"). */
export async function getSession(db: Db, userId: string): Promise<BotState | null> {
  const rows = await db.query<{ state: string }>('SELECT state FROM telegram_bot_sessions WHERE user_id = ?', [userId])
  if (rows.length === 0) return null
  try {
    const s = JSON.parse(rows[0].state)
    return s && typeof s === 'object' && typeof s.kind === 'string' ? (s as BotState) : null
  } catch {
    return null
  }
}
export async function setSession(db: Db, userId: string, state: BotState): Promise<void> {
  await db.execute(
    'INSERT INTO telegram_bot_sessions (user_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at',
    [userId, JSON.stringify(state), new Date().toISOString()],
  )
}
export async function clearSession(db: Db, userId: string): Promise<void> {
  await db.execute('DELETE FROM telegram_bot_sessions WHERE user_id = ?', [userId])
}

/** Pending items for a user's /list session; null when none exists. (No TTL — design §7.4.) */
export async function noteSession(db: Db, userId: string): Promise<string[] | null> {
  const s = await getSession(db, userId)
  return s && s.kind === 'await_list_item' ? s.items : null
}
export async function saveNoteSession(db: Db, userId: string, items: string[]): Promise<void> {
  await setSession(db, userId, { kind: 'await_list_item', items })
}

/** A plain Quick Note card on the dashboard notebook (project_id optional for the connect step). */
export async function createQuickNote(db: Db, userId: string, content: string, projectId: string | null = null): Promise<string> {
  const id = uuid()
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, 'note', '', content.trim().slice(0, NOTE_MAX_CHARS), projectId, now, now],
  )
  return id
}

/** A checklist card on the dashboard notebook — same JSON items shape as the web UI. */
export async function createListNote(db: Db, userId: string, items: string[]): Promise<number> {
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
export async function insertIdea(db: Db, userId: string, raw: string, telegramUserId: string): Promise<string> {
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
export const t = (lang: Lang, en: string, fa: string): string => (lang === 'fa' ? fa : en)
export const tr = (lang: Lang, en: string, fa: string, vars?: Record<string, string | number>): string => trL(lang, en, fa, vars)
export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function kb(rows: NonNullable<ReplyMarkup['inline_keyboard']>): ReplyMarkup {
  return { inline_keyboard: rows }
}

export function homeKeyboard(lang: Lang): ReplyMarkup {
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
export function homeText(lang: Lang): string {
  return t(lang, 'Hibana — what’s next?', 'هیبانا — بعدی چی؟')
}

export function cancelKeyboard(lang: Lang): ReplyMarkup {
  return kb([[{ text: t(lang, '↩️ Cancel', '↩️ لغو'), callback_data: 'home' }]])
}

export function helpText(lang: Lang): string {
  return t(
    lang,
    '🤖 Hibana bot — tap a button or send:\n\n/idea <text> — save a new Idea\n/note <text> — add a Quick Note\n/list — collect a list (/done saves, /cancel stops)\n/append <project> <text> — append to a project\n/update <project> <stage> — move a project to a new stage\n/status — open tasks + deadlines\n/pause · /resume — reminders\n/reset — password reset link\n/language — change language\n/menu — home',
    '🤖 ربات هیبانا — دکمه بزن یا بفرست:\n\n/idea <متن> — ذخیرهٔ ایده\n/note <متن> — یادداشت سریع\n/list — جمع‌آوری فهرست (/done ذخیره، /cancel لغو)\n/append <پروژه> <متن> — افزودن به پروژه\n/update <پروژه> <مرحله> — انتقال پروژه به مرحلهٔ جدید\n/status — کارها و مهلت‌ها\n/pause · /resume — یادآوری‌ها\n/reset — بازنشانی رمز\n/language — تغییر زبان\n/menu — خانه',
  )
}
export function helpKeyboard(lang: Lang): ReplyMarkup {
  return kb([
    [{ text: t(lang, '💡 New Idea', '💡 ایده'), callback_data: 'idea' }],
    [
      { text: t(lang, '📋 To-do', '📋 کارها'), callback_data: 'todo' },
      { text: t(lang, '📝 Note', '📝 یادداشت'), callback_data: 'note' },
    ],
    [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
  ])
}

export function langKeyboard(lang: Lang): ReplyMarkup {
  return kb([
    [{ text: '🇬🇧 English', callback_data: 'lang:en' }, { text: '🇮🇷 فارسی', callback_data: 'lang:fa' }],
    [{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }],
  ])
}
export function langText(lang: Lang): string {
  return t(lang, 'Pick a language for the bot (this also changes your web app language):', 'زبان ربات را انتخاب کن (این زبان برنامهٔ تحت وب هم تغییر می‌کند):')
}

export function settingsKeyboard(lang: Lang, paused: boolean, isOwner: boolean): ReplyMarkup {
  const rows: NonNullable<ReplyMarkup['inline_keyboard']> = [
    [{ text: t(lang, '🌐 Language', '🌐 زبان'), callback_data: 'lang' }],
    [
      paused
        ? { text: t(lang, '▶️ Resume reminders', '▶️ ازسرگیری یادآوری'), callback_data: 'resume' }
        : { text: t(lang, '⏸ Pause reminders', '⏸ توقف یادآوری'), callback_data: 'pause' },
    ],
  ]
  // Plan B backups (0044 → session 14): owner-only, ON-DEMAND — one tap sends one
  // encrypted snapshot right away. There is no automatic sending anymore (the 4×/day
  // cron push was removed per user request), so this is an action button, not a toggle.
  // Members never see it (the whole-DB snapshot may only reach an owner's chat).
  if (isOwner) {
    rows.push([
      { text: t(lang, '🗄 Send backup now', '🗄 ارسال پشتیبان الان'), callback_data: 'bak' },
    ])
  }
  rows.push([{ text: t(lang, '🔐 Reset password', '🔐 بازنشانی رمز'), callback_data: 'reset' }])
  rows.push([{ text: t(lang, '🏠 Home', '🏠 خانه'), callback_data: 'home' }])
  return kb(rows)
}
export function settingsText(lang: Lang, paused: boolean, isOwner: boolean): string {
  const backupLine = isOwner
    ? t(
        lang,
        'Backup: on-demand — the button sends one encrypted snapshot to this chat. No automatic messages.',
        'پشتیبان: درخواستی — دکمه یک Snapshot رمزگذاری‌شده به این چت می‌فرستد. پیام خودکار ندارد.',
      )
    : ''
  return t(
    lang,
    `⚙️ <b>Settings</b>\n\nReminders: ${paused ? '⏸ paused' : '✅ on'}${backupLine ? `\n${backupLine}` : ''}`,
    `⚙️ <b>تنظیمات</b>\n\nیادآوری‌ها: ${paused ? '⏸ متوقف' : '✅ روشن'}${backupLine ? `\n${backupLine}` : ''}`,
  )
}

export function quadrantKeyboard(lang: Lang, names: Map<number, string>, orderRaw: string | null): ReplyMarkup {
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
export function quadrantGridText(lang: Lang): string {
  return t(lang, '📋 <b>To-do</b> — pick a quadrant:', '📋 <b>کارها</b> — یک بخش انتخاب کن:')
}

export function taskListText(lang: Lang, qid: number, names: Map<number, string>, tasks: { id: string; title: string; emoji: string }[], page: number, total: number): string {
  const meta = QUADRANTS.find((q) => q.id === qid)!
  const name = names.get(qid) ?? t(lang, meta.name.en, meta.name.fa)
  const header = `${meta.icon} <b>${esc(name)}</b> — ${tasks.length} open (page ${page + 1}/${total})\n\n`
  const body = tasks.map((task, i) => `${i + 1}. ${task.emoji || '📌'} ${esc(task.title)}`).join('\n')
  return header + body
}
export function taskListKeyboard(lang: Lang, qid: number, page: number, total: number, tasks: { id: string }[]): ReplyMarkup {
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

export function connectListText(lang: Lang, page: number, total: number): string {
  return t(lang, `🔗 Connect to a project (page ${page + 1}/${total}):`, `🔗 اتصال به پروژه (صفحه ${page + 1}/${total}):`)
}
export function connectListKeyboard(lang: Lang, projects: { id: string; title: string }[], page: number, total: number): ReplyMarkup {
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
export async function render(token: string, chatId: number, messageId: number, text: string, keyboard: ReplyMarkup, parseMode: 'HTML' | undefined = 'HTML'): Promise<void> {
  const r = await editMessageText(token, chatId, messageId, text, parseMode, keyboard)
  if (!r.ok) {
    // edit failed (message unchanged / too old) — send a fresh message
    await sendTelegramMessage(token, chatId, text, parseMode, keyboard)
  }
}

/** Render a quadrant's task-list page (used by callbacks and after add-task). */
export async function renderQuadrant(token: string, chatId: number, db: Db, userId: string, lang: Lang, qid: number, page: number, editMessageId?: number) {
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

