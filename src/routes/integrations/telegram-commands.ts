// Telegram heavy command modules (Phase 4 split from routes/integrations/telegram.ts).
//
// Purpose: the two project-mutating bot commands — /append <project> <text> and
// /update <project> <stage> — plus the shared project resolver (id OR escaped
// title-prefix, user-scoped) and the idea-capture reply builder they and the
// webhook's default capture path share.
//
// Public API: resolveProject, captureIdeaReply, handleAppendCommand, handleUpdateCommand.
import { uuid } from '../../lib/ids'
import { esc } from '../../lib/http'
import { sendTelegramMessage } from '../../services/telegram'
import { insertIdea, t, kb, escapeLikePrefix, type Lang } from './telegram-helpers'
import type { Db } from '../../db/types'
import type { Config, ProjectRow } from '../../types'

/** Resolve a project by id OR a fuzzy title prefix (case-insensitive, first match
 *  wins, user-scoped) — shared verbatim by /append and /update (the two call sites
 *  carried identical copies before the Phase 4 split). */
export async function resolveProject(db: Db, userId: string, arg: string): Promise<ProjectRow | null> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
    const rows = await db.query<ProjectRow>('SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [arg, userId])
    return rows[0] ?? null
  }
  // AP-33: escape LIKE wildcards — '%'/'_' in the typed title acted as wildcards
  // and the recency-ranked LIMIT 1 could resolve the WRONG project.
  const rows = await db.query<ProjectRow>(
    "SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 1",
    [userId, escapeLikePrefix(arg.toLowerCase())],
  )
  return rows[0] ?? null
}

/** The one save path for Ideas (explicit /idea and the default plain-text capture):
 * insert + reply with a deep link (and optional Another/Home buttons). */
export async function captureIdeaReply(
  db: Db,
  token: string,
  chatId: number,
  userId: string,
  lang: Lang,
  origin: string,
  telegramUserId: string,
  raw: string,
  withButtons: boolean,
): Promise<void> {
  const id = await insertIdea(db, userId, raw, telegramUserId)
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

/** /append <project> <text> — append a note to an EXISTING project's latest_note (the
 *  Phase 7-second item 2 ask the audit flagged as never built). The first arg is a
 *  project id OR a fuzzy title prefix match. The rest is the text to append. A
 *  project_history_log row records the change so the project page's activity feed
 *  shows it. Replies with a deep link. */
export async function handleAppendCommand(
  cfg: Config,
  token: string,
  chatId: number,
  userId: string,
  origin: string,
  text: string,
): Promise<void> {
  const appendMatch = text.match(/^\/append\b\s+(?:(\S+)\s+)?([\s\S]+)/i)
  if (appendMatch) {
    const projectArg = (appendMatch[1] ?? '').trim()
    const appendText = appendMatch[2].trim()
    if (!projectArg) {
      await sendTelegramMessage(token, chatId, 'Usage: /append <project-title-or-id> <text> — e.g. /append star map research the competition')
      return
    }
    // Resolve the project: id first, then a LIKE prefix match on title (user-scoped,
    // not deleted). Spark + all active stages are eligible — appending to
    // an archived/awaiting_dev project is allowed (the user knows what they're doing).
    const project = await resolveProject(cfg.db, userId, projectArg)
    if (!project) {
      await sendTelegramMessage(token, chatId, `No project found matching "${esc(projectArg)}". Use /idea to capture a new one, or check the title in Hibana.`)
      return
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
    return
  }
}


// (label → status) map for /update. Multi-word labels first so they win over single-word
// stage keys when both could match (e.g. "در حال توسعه" before "developing").
const STAGE_MAP: [string, ProjectRow['status']][] = [
  ['awaiting development', 'awaiting_dev'],
  ['awaiting execution', 'queued'],
  ['in progress', 'developing'],
  ['development stopped', 'awaiting_dev'],
  ['در حال توسعه', 'developing'],
  ['در حال برنامه‌ریزی', 'planning'],
  ['در انتظار توسعه', 'awaiting_dev'],
  ['در حال انجام', 'developing'],
  ['در حال تحقیق', 'planning'],
  ['در انتظار اجرا', 'queued'],
  ['در انتظار اقدام', 'queued'],
  ['توقف توسعه', 'awaiting_dev'],
  ['بررسی نشده', 'planning'],
  ['در صف', 'queued'],
  ['planning', 'planning'],
  ['queued', 'queued'],
  ['developing', 'developing'],
  ['awaiting_dev', 'awaiting_dev'],
  ['unreviewed', 'planning'],
  ['investigating', 'planning'],
  ['awaiting', 'queued'],
  ['doing', 'developing'],
  ['halted', 'awaiting_dev'],
  ['operational', 'operational'],
  ['idea', 'spark'],
  ['spark', 'spark'],
  // S137 renames — the new display labels parse like the old ones did (the old
  // labels stay accepted above: a stage someone typed last week keeps working).
  ['up next', 'queued'],
  ['on hold', 'awaiting_dev'],
  ['بعدی', 'queued'],
  ['متوقف', 'awaiting_dev'],
  ['عملیاتی', 'operational'],
  ['ایده', 'spark'],
]

/** Match a known stage label at the END of the /update rest-arg (table order wins).
 * Returns the matched status + the project arg prefix, or null when nothing matched. */
function matchStageLabel(rest: string): { status: ProjectRow['status']; projectArg: string } | null {
  for (const [label, status] of STAGE_MAP) {
    // Match the label at the END of the input (case-insensitive for ASCII; FA is
    // already the exact case). word-boundary-safe via the leading \s.
    const re = new RegExp(`\\s${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
    const m = rest.match(re)
    if (m) return { status, projectArg: rest.slice(0, m.index).trim() }
  }
  return null
}

/** /update <project> <stage> — move a project to a new stage from Telegram (Changelogs
 *  §6 open item, Session 19 cron round 2). The stage accepts the stage key, the EN
 *  label, or the FA label (incl. the retired pre-0060 aliases — a stage someone typed
 *  last week must keep working). Multi-word labels match at the END of the input.
 *  Logs to project_history_log so the activity feed shows it. */
export async function handleUpdateCommand(
  cfg: Config,
  token: string,
  chatId: number,
  userId: string,
  lang: Lang,
  origin: string,
  text: string,
): Promise<void> {
  const updateMatch = text.match(/^\/update\b\s+([\s\S]+)/i)
  if (updateMatch) {
    const rest = updateMatch[1].trim()
    const matched = matchStageLabel(rest)
    const newStatus = matched?.status ?? null
    const projectArg = matched?.projectArg ?? ''
    if (!newStatus) {
      // No recognized stage → either no stage at all, or an unknown one.
      if (rest.indexOf(' ') === -1) {
        await sendTelegramMessage(token, chatId, 'Usage: /update <project-title-or-id> <stage>\n\nStages: planning, queued, developing, awaiting_dev, operational\n(e.g. /update star map developing)')
      } else {
        await sendTelegramMessage(token, chatId, `Unknown stage. Valid stages:\n\nplanning · queued · developing · awaiting_dev · operational\n\n(spark/idea can't be set from here — promote an idea from the Ideas page instead.)`)
      }
      return
    }
    if (newStatus === 'spark') {
      await sendTelegramMessage(token, chatId, "spark/idea can't be set from here — promote an idea from the Ideas page instead.")
      return
    }
    if (!projectArg) {
      await sendTelegramMessage(token, chatId, 'Usage: /update <project-title-or-id> <stage>\n\nStages: planning, queued, developing, awaiting_dev, operational\n(e.g. /update star map developing)')
      return
    }
    // Resolve the project (id first, then title prefix — same as /append).
    const project = await resolveProject(cfg.db, userId, projectArg)
    if (!project) {
      await sendTelegramMessage(token, chatId, `No project found matching "${esc(projectArg)}". Send /status to see your open tasks, or open Hibana → Projects.`)
      return
    }
    if (project.status === newStatus) {
      await sendTelegramMessage(token, chatId, `${esc(project.title)} is already at "${newStatus}".`)
      return
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
    return
  }
}
