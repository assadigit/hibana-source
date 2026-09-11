import { sendTelegramMessage } from './telegram'
import { esc } from '../lib/http'
import type { Config } from '../types'
import type { Db } from '../db/types'

// Sadhana — standalone quadrant task board logic (spec 2026-08-25).
// Pure helpers here (dates, recurrence, sweep, reminders); HTTP lives in routes/sadhana.ts.
// Calendar dates are 'YYYY-MM-DD' strings resolved in the user's timezone (rule 3: UTC in
// storage, conversion only at the edge — recurrence math keys off the user's "today").

export type SadhanaTask = {
  id: string
  user_id: string
  quadrant: number
  title: string
  emoji: string
  fuzzy: string | null
  due_date: string | null
  due_time: string | null
  done: number
  deleted_at: string | null
  pinned: number
  cleared_at: string | null
  position: number
  progress: 'untouched' | 'in_progress' | 'on_hold'
  note: string
  recurring: number
  recur_type: 'daily' | 'weekly' | 'ndays' | 'monthly' | null
  recur_config: string
  recur_last: string | null
  created_at: string
  updated_at: string
}

export const TAGS = {
  w: { en: 'Work', fa: 'کار', icon: '💼' },
  p: { en: 'Personal', fa: 'شخصی', icon: '🏠' },
  sg: { en: 'Self-Growth', fa: 'رشد فردی', icon: '📈' },
  so: { en: 'Social', fa: 'اجتماعی', icon: '🤝' },
  h: { en: 'Health', fa: 'سلامت', icon: '💪' },
} as const
export type TagId = keyof typeof TAGS

// The four fixed quadrants — identity (id/icon/color/subtitle) never changes even when a
// user renames the bucket (spec §2.9, §5.19). Names are the built-in defaults (roast
// 2026-08-25: display numbers removed from the default names; the id stays the data key).
// Array order = board grid + dialog picker + archive group order. Spec §3 lays the grid
// out Q1 | Q3 on top, Q2 | Q4 below (daily + urgent above strategic + personal).
// `icon` is the emoji (dialog picker / JSON — native <select> can't render SVG);
// `glyph` is the outline icon from the shared SVG set used on the board.
// `color` maps 1:1 to a semantic token (CSS class q-<color>): Q1→success, Q2→info,
// Q3→error, Q4→warning — one real semantic hue each, not ad hoc pastels.
const DEFAULT_QUADRANT_ORDER = [1, 3, 2, 4] as const

export function parseQuadrantOrder(raw: string | null | undefined): number[] {
  const ids = String(raw ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((id, index, values) => [1, 2, 3, 4].includes(id) && values.indexOf(id) === index)
  return ids.length === 4 ? ids : [...DEFAULT_QUADRANT_ORDER]
}

export function orderedQuadrants<T extends { id: number }>(quadrants: T[], raw: string | null | undefined): T[] {
  const byId = new Map(quadrants.map((quadrant) => [quadrant.id, quadrant]))
  return parseQuadrantOrder(raw).map((id) => byId.get(id)).filter((quadrant): quadrant is T => quadrant !== undefined)
}

export const QUADRANTS: {
  id: number
  icon: string
  glyph: string
  color: string
  subtitle: { en: string; fa: string }
  name: { en: string; fa: string }
}[] = [
  { id: 1, icon: '⚙️', glyph: 'gear', color: 'success', subtitle: { en: 'Must-do daily necessities', fa: 'کارهای روزانهٔ ضروری' }, name: { en: 'Today', fa: 'امروز' } },
  { id: 3, icon: '🚨', glyph: 'bell', color: 'error', subtitle: { en: 'Strategic with tight deadlines', fa: 'استراتژیک با مهلت نزدیک' }, name: { en: 'Urgent & High Value', fa: 'فوری و باارزش' } },
  { id: 2, icon: '🏔️', glyph: 'mountain', color: 'info', subtitle: { en: 'High value, open horizon', fa: 'باارزش، افق باز' }, name: { en: 'Strategic', fa: 'استراتژیک' } },
  { id: 4, icon: '🍃', glyph: 'leaf', color: 'warning', subtitle: { en: 'Personal, heart matters', fa: 'شخصی، دغدغهٔ دل' } , name: { en: 'Personal & Sentimental', fa: 'شخصی و احساسی' } },
]

// 'YYYY-MM-DD' parses/compares as UTC so calendar arithmetic is pure string math.
const DAY = 24 * 60 * 60 * 1000
const parseDate = (s: string): number => Date.parse(s + 'T00:00:00Z')
const addDays = (date: string, n: number): string => new Date(parseDate(date) + n * DAY).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string): number => Math.round((parseDate(to) - parseDate(from)) / DAY)

/** Today's 'YYYY-MM-DD' in the given IANA timezone (fallback UTC). */
export function todayIn(tz: string | undefined): string {
  const tzName = tz && /^[A-Za-z_+-]+\/[A-Za-z_+-]+$/.test(tz) ? tz : 'UTC'
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** js weekday (Sun=0…Sat=6) of a 'YYYY-MM-DD'. Spec weekdays are Mon=0…Sun=6. */
const jsWeekday = (date: string): number => new Date(parseDate(date)).getUTCDay()
const specWeekday = (date: string): number => (jsWeekday(date) + 6) % 7

/** Recurrence reset (spec §5.12/§6.9 + §7.1): has the next cycle arrived? */
export function recurringDue(
  t: { recur_type: SadhanaTask['recur_type']; recur_config: string; recur_last: string | null },
  today: string,
): boolean {
  if (!t.recur_type || !t.recur_last) return false
  if (t.recur_last >= today) return false
  switch (t.recur_type) {
    case 'daily':
      return true // a new calendar day has passed
    case 'weekly': {
      const days = t.recur_config.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      if (days.length === 0) return false // none selected = never resets, by design (§6.9)
      return days.includes(specWeekday(today))
    }
    case 'ndays': {
      const n = Number(t.recur_config)
      return Number.isInteger(n) && n >= 1 && n <= 365 && daysBetween(t.recur_last, today) >= n
    }
    case 'monthly': {
      const day = Number(t.recur_config)
      if (!Number.isInteger(day) || day < 1 || day > 31) return false // malformed = never resets
      const hit = Number(today.slice(8, 10)) === day
      const monthPassed = today.slice(0, 7) > t.recur_last.slice(0, 7)
      return hit && monthPassed // at most once per month (§6.9)
    }
  }
}

/** Board-load pass (spec §7.1: the reset also runs per-user whenever the board loads). */
export async function resetDueRecurring(db: Db, userId: string, tz: string | undefined, onDate?: string): Promise<number> {
  const today = onDate ?? todayIn(tz)
  const tasks = await db.query<SadhanaTask>(
    'SELECT * FROM sadhana_tasks WHERE user_id = ? AND done = 1 AND deleted_at IS NULL AND recurring = 1',
    [userId],
  )
  let reset = 0
  const now = new Date().toISOString()
  for (const t of tasks) {
    if (recurringDue(t, today)) {
      await db.execute('UPDATE sadhana_tasks SET done = 0, recur_last = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
        today, now, t.id, userId,
      ])
      reset++
    }
  }
  return reset
}

/** Monday 00:10 Asia/Tehran weekly sweep (spec §7.2). Recurring tasks are excluded — they
 *  loop on the board instead of flickering into Archive (spec §8 Q1, resolved). */
export async function sweepCompletedTasks(db: Db, onDate?: string): Promise<number> {
  const today = onDate ?? todayIn('Asia/Tehran')
  if (specWeekday(today) !== 0) return 0 // Mondays only (Mon=0 in spec terms)
  const now = new Date().toISOString()
  const res = await db.execute(
    `UPDATE sadhana_tasks SET cleared_at = ?, updated_at = ?
     WHERE done = 1 AND deleted_at IS NULL AND cleared_at IS NULL AND recurring = 0`,
    [today, now],
  )
  return Number(res.changes ?? 0)
}

const REMINDER_KINDS = ['7d', '3d', '1d', '0d'] as const

/** Daily reminder pass (spec §7.3, §6.18-19). Runs on the existing 03:17 UTC cron; a tighter
 *  cadence would need a second cron trigger — documented simplification. Each kind fires at
 *  most once per task ever (reminder_logs PK). Channel: the linked Telegram chat (§2.6 maps
 *  to users.telegram_chat_id in this build). */
export async function runSadhanaReminders(cfg: Config, onDate?: string, nowUtcMin?: number): Promise<number> {
  if (!cfg.telegramToken) return 0
  const now = new Date()
  const today = onDate ?? todayIn('Asia/Tehran')
  const nowMin = nowUtcMin ?? now.getUTCHours() * 60 + now.getUTCMinutes() // UTC minutes (2h window, best effort)
  // JOIN users up front (Phase 2, 2026-08-28): the old shape ran one users lookup per task
  // (N+1) on every 30-min tick — this pass is the hottest cron. One query, same behavior.
  const tasks = await cfg.db.query<SadhanaTask & { telegram_chat_id: string | null; telegram_paused: 0 | 1 }>(
    `SELECT t.*, u.telegram_chat_id, u.telegram_paused FROM sadhana_tasks t
     JOIN users u ON u.id = t.user_id
     WHERE t.done = 0 AND t.deleted_at IS NULL AND t.cleared_at IS NULL AND t.due_date IS NOT NULL`,
  )
  let sent = 0
  for (const t of tasks) {
    const chatId = t.telegram_chat_id
    if (!chatId || t.telegram_paused === 1) continue // spec §6.22: pause suspends the channel
    const kinds: string[] = []
    for (const kind of REMINDER_KINDS) {
      if (addDays(t.due_date!, -Number(kind[0])) === today) kinds.push(kind)
    }
    if (t.due_time && t.due_date === today) {
      const [hh, mm] = t.due_time.split(':').map(Number)
      const dueMin = hh * 60 + (mm || 0)
      if (nowMin >= dueMin - 120 && nowMin < dueMin) kinds.push('2h')
    }
    if (kinds.length === 0) continue
    const logged = await cfg.db.query<{ kind: string }>(
      `SELECT kind FROM sadhana_reminder_logs WHERE task_id = ? AND kind IN (${kinds.map(() => '?').join(',')})`,
      [t.id, ...kinds],
    )
    const fresh = kinds.filter((k) => !logged.some((l) => l.kind === k))
    if (fresh.length === 0) continue
    const label = t.due_time ? `${t.due_date} ${t.due_time}` : t.due_date
    try {
      // HTML parse mode: task emoji + title are user content — an unescaped "<" would make
      // Telegram reject the whole send (400) and silently lose that reminder forever.
      await sendTelegramMessage(
        cfg.telegramToken,
        chatId,
        `⏰ <b>${esc(`${t.emoji} ${t.title}`)}</b>\n\nDeadline: ${esc(label ?? '')}\n\n<a href="https://hibana.ir/sadhana.html">Open Sadhana →</a>`,
        'HTML',
      )
      for (const kind of fresh) {
        await cfg.db.execute('INSERT INTO sadhana_reminder_logs (task_id, kind, sent_at) VALUES (?, ?, ?)', [
          t.id, kind, new Date().toISOString(),
        ])
      }
      sent++
    } catch (err) {
      console.error(`sadhana reminder failed for ${t.id}:`, err)
    }
  }
  return sent
}