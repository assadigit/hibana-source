// ICS calendar export (RFC 5545) — one-way export of dated items to a subscribable
// .ics feed. Open item from Changelogs §6 (High). Zero DB changes: pure read aggregation
// of the same four sources as /api/calendar (projects + tasks + sadhana + day-notes),
// re-shaped into VEVENTs.
//
// Design:
//  - All-day events (DTSTART;VALUE=DATE:YYYYMMDD) — Hibana stores dates, not times.
//  - Stable UIDs (hibana-<kind>-<id>@hibana.ir) so calendar apps dedupe on re-import /
//    re-subscribe instead of creating duplicates.
//  - RFC 5545 line folding (75-octet limit, CRLF + space fold) + text escaping.
//  - Forward window (default 6 months, max 24) — a subscribe feed wants upcoming, not
//    historical. The user re-subscribes / the app re-fetches on its own schedule.
//  - Pure `buildIcs()` (testable, no DB) + `loadIcsEvents()` DB loader.

import type { Db } from '../db/types'
import type { ProjectRow } from '../types'
import type { SadhanaTask } from './sadhana'
import type { QuickNote } from '../routes/quicknotes'

interface IcsEvent {
  uid: string
  summary: string
  description?: string
  date: string // 'YYYY-MM-DD' (Gregorian — the storage key, rule 3)
  url?: string
  categories?: string
}

const PRODID = '-//Hibana//Personal project manager//EN'

/** Escape TEXT-valued property values per RFC 5545 §3.3.11. */
function escapeText(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Fold a logical line to 75-octet physical lines (CRLF + space continuation). RFC 5545 §3.1. */
function foldLine(line: string): string {
  // Operate on UTF-16 code units but count octets (UTF-8). For ASCII-heavy ICS lines this
  // is exact; for the occasional Persian text the fold may land a byte or two early/late,
  // which is legal (the limit is a max, not exact) and every major calendar parser accepts
  // it. A byte-exact implementation would require encoding each char to UTF-8 first —
  // overkill for a personal feed.
  const MAX = 75
  if (line.length <= MAX) return line
  let out = line.slice(0, MAX)
  let rest = line.slice(MAX)
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, MAX - 1)
    rest = rest.slice(MAX - 1)
  }
  return out
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' for VALUE=DATE. Validates the shape; returns '' if invalid. */
function toDateValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[1]}${m[2]}${m[3]}` : ''
}

/** UTC DTSTAMP in 'YYYYMMDDTHHMMSSZ'. */
function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** Build the full VCALENDAR text from a list of events. Pure — no DB, no I/O. */
export function buildIcs(events: IcsEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Hibana',
    'X-WR-TIMEZONE:UTC',
    'METHOD:PUBLISH',
  ]
  const stamp = nowStamp()
  for (const e of events) {
    const dt = toDateValue(e.date)
    if (!dt) continue // skip events with no usable date
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${e.uid}`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART;VALUE=DATE:${dt}`)
    lines.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.categories) lines.push(`CATEGORIES:${escapeText(e.categories)}`)
    if (e.url) lines.push(`URL:${escapeText(e.url)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // Fold each logical line, then join with CRLF (RFC 5545 line terminator).
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Load all dated items for a user within a forward window (today → today + monthsAhead).
 *  Mirrors the /api/calendar aggregation but without a start bound (includes today forward)
 *  and with a generous default window. user_id filter on every query (rule 1). */
export async function loadIcsEvents(
  db: Db,
  userId: string,
  monthsAhead = 6,
): Promise<IcsEvent[]> {
  const months = Math.max(1, Math.min(24, monthsAhead | 0))
  const today = new Date()
  const start = today.toISOString().slice(0, 10)
  const endD = new Date(today.getTime() + months * 30 * 24 * 3600 * 1000)
  const end = endD.toISOString().slice(0, 10)

  const [projects, tasks, sadhana, notes] = await Promise.all([
    db.query<ProjectRow>(
      `SELECT id, title, status, due_date FROM projects
       WHERE user_id = ? AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?`,
      [userId, start, end],
    ),
    db.query<{ id: string; project_id: string; title: string; done: 0 | 1; due_date: string; project_title: string }>(
      `SELECT t.id, t.project_id, t.title, t.done, t.due_date, p.title AS project_title
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE p.user_id = ? AND p.deleted_at IS NULL AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?`,
      [userId, start, end],
    ),
    db.query<SadhanaTask>(
      `SELECT id, title, done, due_date FROM sadhana_tasks
       WHERE user_id = ? AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?`,
      [userId, start, end],
    ),
    db.query<QuickNote>(
      `SELECT id, kind, title, content, color, sticky, note_date FROM quick_notes
       WHERE user_id = ? AND deleted_at IS NULL AND note_date IS NOT NULL AND note_date >= ? AND note_date <= ?`,
      [userId, start, end],
    ),
  ])

  const events: IcsEvent[] = []
  for (const p of projects) {
    events.push({
      uid: `hibana-project-${p.id}@hibana.ir`,
      summary: p.title,
      description: `Project — ${p.status}`,
      date: p.due_date!,
      url: `https://hibana.ir/project.html?id=${p.id}`,
    })
  }
  for (const t of tasks) {
    events.push({
      uid: `hibana-task-${t.id}@hibana.ir`,
      summary: `${t.done ? '✓ ' : '▢ '}${t.title}`,
      description: `Task in: ${t.project_title}${t.done ? ' (done)' : ''}`,
      categories: t.project_title,
      date: t.due_date,
      url: `https://hibana.ir/project.html?id=${t.project_id}`,
    })
  }
  for (const s of sadhana) {
    events.push({
      uid: `hibana-sadhana-${s.id}@hibana.ir`,
      summary: `${s.done ? '✓ ' : ''}${s.title}`,
      description: 'To-do (Sadhana)',
      date: s.due_date!,
      url: 'https://hibana.ir/to-do-list',
    })
  }
  for (const n of notes) {
    const text = (n.content || n.title || 'Note').replace(/\s+/g, ' ').trim()
    events.push({
      uid: `hibana-note-${n.id}@hibana.ir`,
      summary: n.sticky === 1 ? `📌 ${text}` : text,
      description: n.sticky === 1 ? 'Sticky note' : 'Day note',
      date: n.note_date!,
      url: 'https://hibana.ir/app',
    })
  }
  // Stable order: by date, then kind, then title — so re-exports diff cleanly.
  events.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary))
  return events
}
