import { esc } from './http'
import { trL, type Locale } from './i18n'
import { faDigits } from './jalali'
import type { Config, ProjectRow, ProjectStatus } from '../types'

// Tiny HTML-fragment kit for htmx responses (single-origin design, Q1-A).
// No templating engine — string templates keep the "no build step" promise.

// English record stays the canonical export/backward-compat lookup (spec §5.3 status
// history notes are stored data and keep English); fragments translate via statusLabel().
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  spark: 'Idea',
  unreviewed: 'Unreviewed',
  investigating: 'Investigating',
  awaiting: 'Awaiting Execution',
  doing: 'In Progress',
  halted: 'Development Stopped',
  operational: 'Operational',
}

export const STATUS_LABEL_FA: Record<ProjectStatus, string> = {
  spark: 'ایده',
  unreviewed: 'بررسی نشده',
  investigating: 'در حال تحقیق',
  awaiting: 'در انتظار اقدام',
  // Phase 6 item 16 — «اقدام» («execution») read like an old label; the user asked for this wording
  doing: 'در حال انجام',
  halted: 'توقف توسعه',
  operational: 'عملیاتی',
}

export const statusLabel = (s: ProjectStatus, lang: Locale = 'en'): string =>
  lang === 'fa' ? STATUS_LABEL_FA[s] : STATUS_LABEL[s]

export const STATUS_BADGE = (s: ProjectStatus, lang: Locale = 'en'): string =>
  `<span class="badge badge-${s}">${icon(STATUS_ICON[s], 'icon')}${statusLabel(s, lang)}</span>`

// One recognizable glyph per stage, same stroke system as the rest of the UI (design rule 4/6).
// Fix 2026-09-09 (user report): the `doing` stage used 'gear' which can read as a sun-burst
// at small sizes (the gear's spokes mimic the sun's rays), colliding with the theme-toggle's
// explicit 'sun' icon. Changed to 'play' — a triangle-in-circle, the universal "in progress"
// / "now playing" metaphor. The sun stays reserved for the theme toggle only.
export const STATUS_ICON: Record<ProjectStatus, string> = {
  spark: 'idea',
  unreviewed: 'clock',
  investigating: 'search',
  awaiting: 'calendar',
  doing: 'play',
  halted: 'pause',
  operational: 'rocket',
}

/** Inline SVG icon set (24×24, stroke = currentColor) — replaces every UI emoji.
    One consistent stroke weight so icons read as one system (design rule 4/6). */
export function icon(name: string, cls = 'icon'): string {
  const body = (() => {
    switch (name) {
      case 'check': return '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M7.4 12.4l3 3 6.2-6.2"/>'
      case 'unchecked': return '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>'
      case 'x': return '<path d="M6 6l12 12M18 6L6 18"/>'
      case 'plus': return '<path d="M12 5v14M5 12h14"/>'
      case 'sun': return '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
      case 'download': return '<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>'
      case 'cloud': return '<path d="M17.5 18.5a4 4 0 0 0-.3-7.99A5.5 5.5 0 0 0 6.9 9.6 3.5 3.5 0 0 0 7 18.5Z"/>'
      case 'link': return '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.2-1.2"/>'
      case 'search': return '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'
      case 'pause': return '<path d="M9 5.5v13M15 5.5v13"/>'
      case 'play': return '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none"/>'
      case 'idea': return '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/>'
      case 'clock': return '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
      case 'gear': return '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"/>'
      // S46 (user request 2026-09-14): a REAL cog with teeth — the existing 'gear'
      // case reads as a sun-burst (html.ts:39 already documented that confusion for the
      // 'doing' stage). Used by the note-controls-toggle summary so users know it opens
      // view/size options. The 'doing' stage keeps 'gear' (owner-held decision).
      case 'settings': return '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
      case 'rocket': return '<path d="M12 2.5s4.5 3 4.5 8c0 2.6-1.6 4.6-1.6 6.5h-5.8c0-1.9-1.6-3.9-1.6-6.5 0-5 4.5-8 4.5-8Z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9.5 20.5h5"/>'
      case 'archive': return '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M10 9.5v3h4v-3"/>'
      case 'calendar': return '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'
      case 'alert': return '<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.5M12 17.4v.3"/>'
      // S30 batch 3: the dashboard urgent strip's glyph.
      case 'flame': return '<path d="M12 2.5s5.5 4.2 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2 1-3.8 2.2-5.4.4 1.5 1.3 2.4 2.3 2.9-.4-2.5.2-5 1-7Z"/>'
      case 'pencil': return '<path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/>'
      case 'trash': return '<path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/><path d="M10 11v6M14 11v6"/>'
      case 'clipboard': return '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3.5A.5.5 0 0 1 9.5 3h5a.5.5 0 0 1 .5.5V4M9 9.5h6M9 13.5h6M9 17.5h4"/>'
      case 'bug': return '<path d="M8 7a4 4 0 1 1 8 0v6a4 4 0 0 1-8 0V7Z"/><path d="M8 10H4.5M8 14H4.5M8 18H4.5M16 10h3.5M16 14h3.5M16 18h3.5M12 7v12"/>'
      case 'list-check': return '<path d="M3.5 6h2M3.5 12h2M3.5 18h2"/><path d="M9 6h11M9 12h11M9 18h7"/>'
      case 'pin': return '<path d="M12 17v4M8.5 3.5h7l-.8 7.2 2.8 2.8v1.5H6.5v-1.5l2.8-2.8-.8-7.2Z"/>'
      case 'target': return '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="1"/>'
      case 'folder-plus': return '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/>'
      case 'repeat': return '<path d="M17 2.5 21 6.5l-4 4M3.5 11V9a4 4 0 0 1 4-4h13.5M7 21.5 3 17.5l4-4M20.5 13v2a4 4 0 0 1-4 4H3"/>'
      case 'arrow-right': return '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>'
      case 'chevron-left': return '<path d="M14.5 5.5 8 12l6.5 6.5"/>'
      case 'chevron-right': return '<path d="M9.5 5.5 16 12l-6.5 6.5"/>'
      case 'image': return '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/>'
      case 'bell': return '<path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 7.8-2.5 9h17c0-1.2-2.5-2.5-2.5-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'
      case 'mountain': return '<path d="M3.5 20h17L14 5.5l-3.5 6L8.2 8.3 3.5 20Z"/>'
      case 'leaf': return '<path d="M4.5 19.5C4.5 10 10 4.5 19.5 4.5c0 9.5-5.5 15-15 15Z"/><path d="M4.5 19.5c4.5-7.5 9-12 13.5-13.5"/>'
      case 'more-h': return '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
      case 'flag': return '<path d="M6 21V4"/><path d="M6 4h12l-2.6 4 2.6 4H6"/>'
      case 'star': return '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>'
      case 'heart': return '<path d="M20.5 8.8c0 5-8.5 11-8.5 11s-8.5-6-8.5-11A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.8Z"/>'
      case 'book': return '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>'
      case 'expand': return '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13 11M4.5 19.5 11 13"/>'
      case 'kanban': return '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.2 8v8M14.8 8v5"/>'
      case 'diamond': return '<path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z"/>'
      // S34 (user request 2026-09-13): the sprint editor's private-comment toolbar
      // button (speech bubble) + the preview's comments show/hide toggle (eye).
      case 'message': return '<path d="M4 6a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6v7a2.5 2.5 0 0 1-2.5 2.5H9.2L5 19v-3.5h1.5A2.5 2.5 0 0 1 4 13V6Z"/>'
      case 'eye': return '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'
      default: return '<circle cx="12" cy="12" r="8.2"/>'
    }
  })()
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
}

/** The SVG glyph ids a quadrant icon can hold (QUADRANT_ICONS in routes/sadhana.ts).
    icon_id also accepts a plain emoji (sadhana.html picker) — anything outside this set
    renders as text, so the emoji path needs its own element (not an empty <svg>). */
export const QUADRANT_GLYPHS = new Set(['gear', 'target', 'star', 'heart', 'flag', 'folder-plus', 'calendar', 'book', 'idea', 'bell', 'mountain', 'leaf'])

/** Quadrant symbol: the SVG stroke glyph when the stored icon_id is a known glyph id,
    otherwise the value itself (an emoji chosen in the board's picker) as a text span. */
export function quadrantGlyph(iconId: string | null | undefined, fallbackEmoji: string, cls = 'icon'): string {
  const id = iconId ?? ''
  if (id && QUADRANT_GLYPHS.has(id)) return icon(id, cls)
  return `<span class="quadrant-emoji">${esc(id || fallbackEmoji)}</span>`
}

/** Relative time in words — pure display, UTC in storage (rule 3). */
export function timeAgo(iso: string, lang: Locale = 'en'): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return lang === 'fa' ? 'همین حالا' : 'just now'
  const unit = m < 60 ? 'm' : m < 1440 ? 'h' : m < 43200 ? 'd' : m < 525600 ? 'mo' : 'y'
  const n = unit === 'm' ? m : unit === 'h' ? Math.floor(m / 60) : unit === 'd' ? Math.floor(m / 1440) : unit === 'mo' ? Math.floor(m / 43200) : Math.floor(m / 525600)
  const fmt =
    lang === 'fa'
      ? { m: '{n} دقیقه پیش', h: '{n} ساعت پیش', d: '{n} روز پیش', mo: '{n} ماه پیش', y: '{n} سال پیش' }
      : { m: '{n}m ago', h: '{n}h ago', d: '{n}d ago', mo: '{n}mo ago', y: '{n}y ago' }
  return fmt[unit as keyof typeof fmt].split('{n}').join(lang === 'fa' ? faDigits(String(n)) : String(n))
}

export const progressBar = (pct: number): string =>
  `<div class="progress"><span style="inline-size:${Math.max(0, Math.min(100, pct))}%"></span></div>`

export const toastHtml = (message: string, lang: Locale = 'en', undoPath?: string): string =>
  `<div id="toast" class="toast" role="status">${esc(message)}` +
  (undoPath ? ` <button class="ghost" hx-post="${undoPath}" hx-swap="none">${trL(lang, 'Undo', 'واگرد')}</button>` : '') +
  `<button class="ghost danger" onclick="this.parentElement.remove()" aria-label="${trL(lang, 'Dismiss', 'بستن')}">${icon('x')}</button></div>`

/** Look up a project scoped to the authenticated user — rule 1 enforced at the join level. */
export async function getOwnedProject(cfg: Config, userId: string, id: string): Promise<ProjectRow | null> {
  const rows = await cfg.db.query<ProjectRow>(
    'SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    [id, userId],
  )
  return rows.length ? rows[0] : null
}

// L3 fix (2026-09-10): deleted the unused ownedProject() export — it interpolated
// `${table}` with no allowlist (the live ownedProjectId in core.ts:46 gates through
// assertChildTable). Dead code since getOwnedProject + ownedProjectId cover every call site.