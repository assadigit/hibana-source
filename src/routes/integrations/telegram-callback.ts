// Telegram callback_query dispatcher (Phase 4 split from routes/integrations/telegram.ts).
//
// Purpose: every inline-keyboard tap op-code (home/idea/note/todo/quadrants q{1-4}p{n}/
// q{1-4}add, task done d:<uuid>/undo u:<uuid>, language, settings, Plan-B backup 'bak'
// (owner-only), pause/resume, password reset, help, connect-list connect/connectp{n}/
// cp:<projectId>/psearch). Op-codes always win and REPLACE any active await_text
// intent (design §8.1).
//
// Public API: handleCallback — invoked by the webhook's callback_query branch.
import { QUADRANTS, todayIn } from '../../services/sadhana'
import { createResetToken } from '../../services/reset'
import { sendPlanBBackupToChat } from '../../services/backup-planb'
import { esc } from '../../lib/http'
import {
  type Lang,
  PROJECT_PAGE_SIZE,
  getSession,
  setSession,
  clearSession,
  t,
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
  connectListText,
  connectListKeyboard,
  render,
  renderQuadrant,
} from './telegram-helpers'
import type { Config, UserRow } from '../../types'

// ---- callback_query dispatcher (inline keyboard taps) ---------------------------
// Every op-code is self-contained (≤ ~41 bytes, well under Telegram's 64-byte callback_data
// cap). The op-code always wins and REPLACES any active await_text intent (design §8.1).
export async function handleCallback(
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
