import { sendAndLog } from './email'
import { sendTelegramMessage } from './telegram'
import { clientProgress, isBehindPace, elapsedFraction } from './progress'
import { esc } from '../lib/http'
import type { Config, ProjectRow, TaskRow, UserRow } from '../types'

// Progress-based reminders (spec §6.3): fires only when ACTUAL progress falls behind the
// expected pace for the time elapsed — being on pace never nags, regardless of the date.
// Used by the daily cron. Channels: the owner's email (Resend) + Telegram, when the
// account has a linked chat (Phase 5 bot — spec §6.3 names Telegram as the second channel).

// The single-owner cron has no request to derive an origin from, so the deep link URL is
// the real prod domain (this is what the email path already hardcoded — fixing the stale
// pm.sedanama.com value that predates the hibana.ir cutover).
const APP_URL = 'https://hibana.ir'

export interface ReminderCandidate {
  project: ProjectRow
  progress: number
  elapsed: number
}

export async function findBehindProjects(cfg: Config): Promise<ReminderCandidate[]> {
  const now = new Date()
  // batch (s): the in-progress pool is 'doing'/'operational' under the 7-stage taxonomy
  // (LEGACY_STATUS maps building→doing, working→operational) — legacy rows never match.
  const projects = await cfg.db.query<ProjectRow>(
    `SELECT * FROM projects
     WHERE type = 'client' AND reminders_enabled = 1 AND due_date IS NOT NULL
       AND status IN ('doing', 'operational') AND deleted_at IS NULL`,
  )
  if (projects.length === 0) return []
  // P11 (Focus 2): batch-fetch all tasks for all projects in one query (was N+1 — one
  // SELECT per project). Daily cron, <50 projects typical, but D1 subrequest budgets matter.
  const ids = projects.map((p) => p.id)
  const placeholders = ids.map(() => '?').join(',')
  const allTasks = await cfg.db.query<TaskRow>(
    `SELECT * FROM tasks WHERE project_id IN (${placeholders})`,
    ids,
  )
  const tasksByProject = new Map<string, TaskRow[]>()
  for (const t of allTasks) {
    const arr = tasksByProject.get(t.project_id)
    if (arr) arr.push(t)
    else tasksByProject.set(t.project_id, [t])
  }
  const out: ReminderCandidate[] = []
  for (const p of projects) {
    const tasks = tasksByProject.get(p.id) ?? []
    if (tasks.length === 0) continue // no tasks → nothing to measure yet; don't nag before the work starts
    const progress = p.progress_percent ?? clientProgress({ total: tasks.length, done: tasks.filter((t) => t.done === 1).length })
    const elapsed = elapsedFraction(p.due_date!, now)
    if (isBehindPace(progress, elapsed)) {
      out.push({ project: p, progress, elapsed })
    }
  }
  return out
}

/** Returns how many pushes were sent (email + Telegram). Each channel is best-effort. */
export async function runReminders(cfg: Config, ownerEmail: string): Promise<number> {
  const behind = await findBehindProjects(cfg)
  let sent = 0
  for (const c of behind) {
    const { id, title, due_date: due } = c.project
    // rule 1: the chat is looked up by the project's owner (single-owner app in practice).
    // spec §6.22: a paused link keeps the profile but suspends the Telegram leg (email still goes).
    const users = await cfg.db.query<UserRow>('SELECT telegram_chat_id, telegram_paused FROM users WHERE id = ?', [c.project.user_id])
    const chatId = users[0]?.telegram_chat_id ?? null
    const paused = users[0]?.telegram_paused === 1

    if (cfg.emailKey) {
      try {
        // Project titles are user content — escape them in the HTML email body. The
        // "Hibana —" subject prefix and the branded wrapper now come from sendAndLog,
        // and every send lands in email_log for the owner's quota console.
        await sendAndLog(cfg, {
          origin: APP_URL,
          to: ownerEmail,
          subject: `"${title}" is behind pace (${c.progress}% of tasks done)`,
          kind: 'reminder',
          title: 'Project pace reminder — یادآوری پیشرفت',
          bodyHtml: `<p>You have <b>${c.progress}%</b> of tasks done on <b>${esc(title)}</b> with a due date of <b>${esc(due ?? '')}</b>.</p>
           <p>This is behind the pace the remaining time window expects. Open it here:
           <a href="${APP_URL}/project.html?id=${id}">${esc(title)}</a>.</p>`,
        })
        sent++
      } catch (err) {
        console.error(`reminder email failed for ${title}:`, err)
      }
    }

    if (chatId && cfg.telegramToken && !paused) {
      try {
        // HTML parse mode: an unescaped "<" in a title makes Telegram reject the whole send.
        await sendTelegramMessage(
          cfg.telegramToken,
          chatId,
          `🔔 <b>${esc(title)}</b> is behind pace — ${c.progress}% of tasks done, due ${esc(due ?? '')}.\n\n` +
            `<a href="${APP_URL}/project.html?id=${id}">Open in Hibana →</a>`,
          'HTML',
        )
        sent++
      } catch (err) {
        console.error(`reminder telegram failed for ${title}:`, err)
      }
    }
  }
  return sent
}