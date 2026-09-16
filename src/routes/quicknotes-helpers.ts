import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody } from '../lib/http'
import { icon } from '../lib/html'
import { localeOf, trL, type Locale } from '../lib/i18n'
import { renderMarkdown } from '../lib/markdown'
import { calendarFor, formatDate, formatNoteDay } from '../lib/jalali'
import { uuid } from '../lib/ids'
import type { Config, UserRow } from '../types'
import type { Db } from '../db/types'

// Dashboard quick-notebook (user request): a capture widget in two modes — free typing
// ('note') or a task list ('list'). Everything routes through /api/notes; the same handlers
// serve JSON to fetch() and the re-rendered widget body to htmx (single-origin, Q1-A).
// Lists store their items as JSON in content: [{id, t, d}] with t = text, d = done (0|1).

export type QuickNote = {
  id: string
  kind: 'note' | 'list'
  title: string
  content: string
  project_id: string | null
  deleted_at: string | null
  sort_order: number
  color: string
  note_date: string | null // calendar day binding ('YYYY-MM-DD' Gregorian), 0028
  sticky: 0 | 1 // 1 = colored sticky note pinned to note_date (calendar day panel)
  done: 0 | 1 // 0038 — project-linked note done flag (1 = done; free notes stay 0)
  created_at: string
  updated_at: string
}

// Sticky-note palette (2026-08-25): pastels that keep the dark ink legible; stored by name.
export const NOTE_COLORS = ['yellow', 'green', 'pink', 'blue'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]
export const NOTE_COLOR_HEX: Record<NoteColor, string> = {
  yellow: '#FFF59D',
  green: '#BBF7D0',
  pink: '#FBCFE8',
  blue: '#BFDBFE',
}

export const createNoteSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['note', 'list']).default('note'),
  title: z.string().max(120).optional(),
  content: z.string().max(20_000).optional().default(''),
  project_id: z.string().uuid().optional(), // attach the note to an Idea/project (user request)
  color: z.enum(NOTE_COLORS).optional(), // sticky-note palette (defaults to yellow)
  // Calendar day binding (0028): pin the note to a Gregorian display date. sticky=1 marks
  // a colored sticky note for that day (vs a plain day note).
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sticky: z.boolean().optional().default(false),
})
export const patchNoteSchema = z.object({
  title: z.string().max(120).optional(),
  content: z.string().max(20_000).optional(),
  // Attach/detach: omitted = untouched; null = detach; uuid = attach (ownership checked).
  project_id: z.string().uuid().nullable().optional(),
  color: z.enum(NOTE_COLORS).optional(), // sticky-note palette (2026-08-25)
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), // day binding (0028)
  sticky: z.boolean().optional(),
  done: z.boolean().optional()
  // 0038 — mark a project-linked note done/undone
})
export const addItemSchema = z.object({ text: z.string().min(1).max(20_000) })
// htmx submits form-encoded strings unless hx-vals JSON is used — accept both for the toggle.
export const toggleItemSchema = z.object({
  done: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.union([z.literal(0), z.literal(1)])),
})
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).max(200) })

export type TaskItem = { id: string; t: string; d: 0 | 1 }

export function parseItems(content: string): TaskItem[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (x): x is TaskItem => !!x && typeof x.id === 'string' && typeof x.t === 'string' && (x.d === 0 || x.d === 1),
      )
    }
  } catch {
    /* malformed — treat as empty list */
  }
  return []
}

export function itemsHtml(items: TaskItem[], lang: Locale): string {
  if (!items.length) return `<li class="muted small">${trL(lang, 'No tasks yet — add one below.', 'هنوز وظیفهای نیست — یکی از پایین اضافه کن.')}</li>`
  return items
    .map(
      (it) => `<li class="hurdle ${it.d ? 'done' : ''}" id="item-${it.id}">
        <button class="ghost toggle icon-btn" hx-patch="/api/notes/list/${it.id}" hx-vals='{"done":${it.d ? 0 : 1}}' hx-target="#notebook" hx-swap="morph" aria-label="${trL(lang, 'toggle', 'تغییر وضعیت')}">${icon(it.d ? 'check' : 'unchecked')}</button>
        <span>${esc(it.t)}</span>
        <button class="ghost danger icon-btn" hx-delete="/api/notes/list/${it.id}" hx-target="#notebook" hx-swap="morph" aria-label="${trL(lang, 'remove', 'حذف')}">${icon('x')}</button>
      </li>`,
    )
    .join('')
}

/** Sticky-note hover palette (2026-08-25): four dots (yellow/green/pink/blue), hidden until
 *  the card is hovered (always on touch); PATCHes the note color and re-renders the widget. */
export function colorPickerHtml(n: QuickNote, lang: Locale): string {
  const t = (en: string, fa?: string) => trL(lang, en, fa)
  return `<span class="note-color-picker" role="group" aria-label="${t('Note color', 'رنگ یادداشت')}">
    ${NOTE_COLORS.map((c) => {
      const label = c.charAt(0).toUpperCase() + c.slice(1)
      // Fix 2026-09-09 (unify tap targets): the inline width/height/padding is gone — the
      // CSS class .color-dot now controls size (1rem) so all footer buttons (dots + delete
      // + done) share a consistent ~16px visual target. The inline background + border
      // stay (a stale cached stylesheet can't render the dots as black defaults).
      return `<button type="button" class="color-dot dot-${c} ${n.color === c ? 'active' : ''}" hx-patch="/api/notes/${n.id}" hx-vals='{"color":"${c}"}' hx-target="#notebook" hx-swap="morph" aria-label="${t(label, c)}" title="${t(label, c)}" style="background:${NOTE_COLOR_HEX[c]};border:1px solid rgb(0 0 0 / 0.18)"></button>`
    }).join('')}
  </span>`
}

/** Day-binding chip (0028): a note pinned to a calendar day shows its date — Jalali
 *  digits for Farsi, Gregorian for English (the calendar always follows the language). */
export function dateChipHtml(n: QuickNote, lang: Locale): string {
  if (!n.note_date) return ''
  const t = (en: string, fa: string) => trL(lang, en, fa)
  return `<span class="note-date-chip" title="${t('Pinned to a day — see it on the calendar', 'سنجاق‌شده به یک روز — در تقویم ببینید')}">🗓 ${esc(formatDate(n.note_date, calendarFor(lang), lang))}</span>`
}

// Defensively un-escape stored note content (some legacy rows were saved escaped) so the
// textarea, the markdown render and the Phase 6 note-reader modal all see the raw text.
export function decodeEntities(s: string | null | undefined): string {
  return String(s ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// Phase 5 item 13: wrap each Latin run (≥2 chars) in a .lat-run span — app.css renders them
// 2px smaller so Latin words (API, UX…) don't visually dominate the Persian note text.
//
// Fix 2026-09-09 (user report): the old regex `>([^<]+)<` + `wrap(txt)` ran the Latin-run
// matcher on text BETWEEN tags — but that text includes HTML entities like `&quot;`,
// `&amp;`, `&#39;`. The matcher wrapped the letters inside the entity (`quot`, `amp`),
// turning `&quot;` into `&<span class="lat-run">quot</span>;` — a bare `&` + a broken
// entity that the browser then re-escaped to `&amp;quot;` on screen (literal text instead
// of a real quote mark). The fix: split each captured text node on entity boundaries
// (`&...;`), wrap Latin runs only in the non-entity chunks, and pass entities through
// untouched. Markdown HTML escaping stays in place (this is the markup path — safe).
export function latinRuns(html: string): string {
  const wrapChunk = (chunk: string): string =>
    chunk.replace(
      /([A-Za-z][A-Za-z0-9'’._\-/]*[A-Za-z0-9]|[A-Za-z]{2,})/g,
      (m) => (m.length >= 2 ? `<span class="lat-run">${m}</span>` : m),
    )
  const wrap = (text: string): string =>
    text
      .split(/(&[#a-zA-Z0-9]+;)/g) // split on entities — keep them as separate chunks
      .map((chunk) => (/^&[#a-zA-Z0-9]+;$/.test(chunk) ? chunk : wrapChunk(chunk)))
      .join('')
  return html.replace(/>([^<]+)</g, (_m, txt) => `>${wrap(String(txt))}<`)
}

/** One note card: free-text notes get an inline textarea; lists get a title line + checkable items.
 *  Every card carries an attach widget (paperclip) linking it to an Idea/project (user request). */
export function noteCard(n: QuickNote, lang: Locale, titles: Map<string, string>): string {
  const t = (en: string, fa?: string) => trL(lang, en, fa)
  const attach = attachWidget(n, titles, lang)
  const color = `--note-color:${esc(NOTE_COLOR_HEX[n.color as NoteColor] ?? NOTE_COLOR_HEX.yellow)}`
  const colorAttr = `data-note-color="${esc(n.color ?? 'yellow')}"`
  const doneBtn = (pid: string | null) =>
    pid && titles.has(pid)
      ? `<button class="ghost icon-btn note-done-btn" data-note-done="${n.id}" aria-pressed="${n.done === 1}" aria-label="${t('Mark done', 'انجام‌شده علامت بزن')}" title="${t('Mark done — stays on the project record', 'انجام‌شده — در پروژه می‌ماند')}">${icon(n.done === 1 ? 'check' : 'unchecked')}</button>`
      : ''
  const headbar = (pid: string | null) => `<div class="note-headbar">
      ${doneBtn(pid)}
      <button class="ghost danger icon-btn" data-note-delete="${n.id}" aria-label="${t('Delete', 'حذف')}">${icon('x')}</button>
    </div>`
  const doneCls = n.done === 1 ? ' is-note-done' : ''
  if (n.kind === 'note') {
    const content = decodeEntities(n.content)
    return `<div class="note-card${doneCls}" id="note-${n.id}" data-kind="note" ${colorAttr} style="${color}">
      ${headbar(n.project_id)}
      <textarea class="note-text" name="content" rows="1" maxlength="20000" dir="auto"
        hx-patch="/api/notes/${n.id}" hx-trigger="change" hx-target="#notebook" hx-swap="morph">${esc(content)}</textarea>
      <!-- Phase 6 item 6: the card clamps to 3 lines (app.css); data-note-open hands the
           full-note reader modal to app.js (long notes only — short ones keep click-to-edit).
           Phase 7 item 11: the «بیشتر…» chip is revealed by app.js (.has-more) exactly when
           the clamp actually truncates — a visible control at the cut point, not a dead ellipsis. -->
      <div class="note-render markdown-body" dir="auto" data-note-open="${n.id}" title="${t('Read the full note', 'خواندن کامل یادداشت')}" role="button" tabindex="0">${latinRuns(renderMarkdown(content))}</div>
      <button type="button" class="note-more" data-note-more="${n.id}" hidden>${t('More…', 'بیشتر…')}</button>
      <div class="row spread note-footer">
        <!-- Session 28 (user request): the meta chip carries the weekday + Jalali day +
             month next to the clock — «یکشنبه ۲۱ شهریور ۰۱:۲۳» — so a glance says which
             DAY the note was touched, not just the time. fa keeps fa-IR 24h Persian
             digits; en uses a 24h clock to match (was '01:23 AM'). -->
        <span class="small muted note-meta">${dateChipHtml(n, lang)}${formatNoteDay(n.updated_at, calendarFor(lang), lang)} ${new Date(n.updated_at).toLocaleTimeString(lang === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
        <span class="row note-footer-right">${colorPickerHtml(n, lang)}${doneBtn(n.project_id)}
        <button class="ghost danger icon-btn" data-note-delete="${n.id}" aria-label="${t('Delete', 'حذف')}">${icon('x')}</button></span>
      </div>
      <div class="note-attach" id="attach-${n.id}">${attach}</div>
    </div>`
  }
  const items = parseItems(n.content)
  return `<div class="note-card${doneCls}" id="note-${n.id}" data-kind="list" ${colorAttr} style="${color}">
    ${headbar(n.project_id)}
    <div class="row spread note-head">
      <span class="row note-head-main">
        <input class="note-title" name="title" value="${esc(n.title)}" maxlength="120" dir="auto"
          hx-patch="/api/notes/${n.id}" hx-trigger="change" hx-target="#notebook" hx-swap="morph">
        ${dateChipHtml(n, lang)}
      </span>
      <span class="row note-head-right">${colorPickerHtml(n, lang)}${doneBtn(n.project_id)}
      <button class="ghost danger icon-btn" data-note-delete="${n.id}" aria-label="${t('Delete', 'حذف')}">${icon('x')}</button></span>
    </div>
    <ul class="hurdles note-items">${itemsHtml(items, lang)}</ul>
    <form class="row note-add" hx-post="/api/notes/list/${n.id}" hx-target="#notebook" hx-swap="morph">
      <input name="text" placeholder="${t('Add a task…', 'وظیفه جدید…')}" maxlength="300" required autocomplete="off">
      <button class="qa-btn" aria-label="${t('Add', 'افزودن')}" title="${t('Add', 'افزودن')}">${icon('plus')}</button>
    </form>
    <div class="note-attach" id="attach-${n.id}">${attach}</div>
  </div>`
}

/** Attach widget: a paperclip button when free, a chip (linking to the project) when attached. */
export function attachWidget(n: QuickNote, titles: Map<string, string>, lang: Locale): string {
  const t = (en: string, fa: string) => trL(lang, en, fa)
  const pid = n.project_id
  if (pid && titles.has(pid)) {
    return `<div class="row attach-row">
      <a dir="auto" class="chip attach-chip" href="/project.html?id=${pid}">${icon('link')}${esc(titles.get(pid)!)}</a>
      <button class="ghost danger icon-btn" hx-patch="/api/notes/${n.id}" hx-vals='{"project_id":null}' hx-target="#notebook" hx-swap="morph" aria-label="${t('Detach', 'جدا کردن')}" title="${t('Detach', 'جدا کردن')}">${icon('x')}</button>
    </div>`
  }
  return `<button class="ghost small attach-btn" hx-get="/api/notes/attach-picker?note_id=${n.id}" hx-target="#attach-${n.id}" hx-swap="innerHTML" aria-label="${t('Attach to a project', 'اتصال به پروژه')}" title="${t('Attach to a project', 'اتصال به پروژه')}">${icon('link')} <span class="small">${t('Attach', 'اتصال')}</span></button>`
}

/** Project titles for attached chips — scoped to the user (rule 1); orphans render as unattached. */
export async function attachedTitles(db: Db, userId: string, notes: QuickNote[]): Promise<Map<string, string>> {
  const ids = [...new Set(notes.map((n) => n.project_id).filter((x): x is string => !!x))]
  if (!ids.length) return new Map()
  const rows = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    [userId, ...ids],
  )
  return new Map(rows.map((r) => [r.id, r.title]))
}

/** The whole notebook widget (card + composer + note list). htmx swaps this on every action.
 *  The view (list / sticky) is a client preference applied via CSS — the server renders both
 *  note layouts from the same cards; sticky adds a carousel nav when there are more than 4. */
export function notebookHtml(notes: QuickNote[], lang: Locale, composerMode: 'note' | 'list' = 'note', titles: Map<string, string> = new Map(), dashboard = false): string {
  const t = (en: string, fa?: string) => trL(lang, en, fa)
  const stickyNav =
    notes.length > 4
      ? `<div class="note-sticky-nav">
        <button type="button" class="ghost icon-btn" data-note-sticky-prev aria-label="${t('Previous', 'قبلی')}" title="${t('Previous', 'قبلی')}">${icon('arrow-right', 'icon arrow opposite')}</button>
        <button type="button" class="ghost icon-btn" data-note-sticky-next aria-label="${t('Next', 'بعدی')}" title="${t('Next', 'بعدی')}">${icon('arrow-right', 'icon arrow')}</button>
      </div>`
      : ''
  // Session-11 (user decision 2026-09-14, follow-up to the session-10 revert): the
  // view/size controls go back behind the ⚙ <details> toggle — but this time the
  // PREFERENCE story is closed end-to-end: the picked view + size persist in
  // localStorage (app.js, re-applied after every htmx swap since 2026-08-26), and
  // the toggle's own open state persists too (app.js session-11). So the widget
  // renders in the owner's chosen view on every load — the controls only need
  // visiting when that choice changes. The `dashboard` flag still echoes through
  // hx-vals so htmx re-renders preserve the compact composer.
  const controlsHtml = `<details class="note-controls-toggle">
      <summary aria-label="${t('View options', 'گزینه‌های نمایش')}" title="${t('View options', 'گزینه‌های نمایش')}">${icon('settings', 'icon')}</summary>
      <span class="note-head-controls">
        <span class="note-ctrl-group">
          <span class="note-ctrl-cap">${t('View', 'نما')}</span>
          <span class="note-view-seg" role="radiogroup" aria-label="${t('View', 'نما')}">
            <label for="nv-list"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg> ${t('List', 'فهرست')}</label>
            <label for="nv-sticky"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14h-16z"/><path d="M4 9h16"/></svg> ${t('Sticky', 'چسبان')}</label>
            <label for="nv-grid"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> ${t('Grid', 'شبکه')}</label>
          </span>
        </span>
        <span class="note-ctrl-group">
          <span class="note-ctrl-cap">${t('Note size', 'اندازه')}</span>
          <span class="note-size-seg" role="radiogroup" aria-label="${t('Note size', 'اندازه')}">
            <label for="ns-s">${t('Small', 'کوچک')}</label>
            <label for="ns-m">${t('Medium', 'متوسط')}</label>
            <label for="ns-l">${t('Large', 'بزرگ')}</label>
          </span>
        </span>
      </span>
    </details>`
  const composeRows = dashboard ? 1 : 2
  const dashboardVal = dashboard ? '<input type="hidden" name="dashboard" value="1">' : ''
  return `<section class="card notebook${dashboard ? ' notebook-dashboard' : ''}" id="notebook">
    <!-- View toggle is PURE CSS (radios + sibling selectors, 2026-08-25): works even if the
         cached app.js predates the feature — no JS needed to switch list ⇄ carousel ⇄ grid.
         a11y (S51-A): the radios are visually hidden and their <label for> twins live inside
         the CLOSED <details> toggle — the accessible-name computation finds nothing
         perceivable there (axe: "form elements must have labels"), so each radio carries its
         own localized aria-label. The labels stay for the mouse path (:checked CSS). -->
    <input type="radio" class="note-view-radio" name="note-view" id="nv-list" value="list" aria-label="${t('List', 'فهرست')}" checked>
    <input type="radio" class="note-view-radio" name="note-view" id="nv-sticky" value="sticky" aria-label="${t('Sticky', 'چسبان')}">
    <input type="radio" class="note-view-radio" name="note-view" id="nv-grid" value="grid" aria-label="${t('Grid', 'شبکه')}">
    <input type="radio" class="note-size-radio" name="note-size" id="ns-s" value="s" aria-label="${t('Small', 'کوچک')}">
    <input type="radio" class="note-size-radio" name="note-size" id="ns-m" value="m" aria-label="${t('Medium', 'متوسط')}" checked>
    <input type="radio" class="note-size-radio" name="note-size" id="ns-l" value="l" aria-label="${t('Large', 'بزرگ')}">
    <div class="row note-head">
      ${controlsHtml}
      <h3 class="note-heading">${t('Quick Notebook', 'یادداشت سریع')}</h3>
    </div>
    <form class="row note-compose" hx-post="/api/notes${dashboard ? '?dashboard=1' : ''}" hx-target="#notebook" hx-swap="morph" data-note-compose>
      <label class="note-compose-label" for="note-compose-box">${t('Quick note', 'یادداشت جدید')}</label>
      <!-- a11y (S51-A): role=group, not tablist — these buttons use the toggle-button
           pattern (aria-pressed) and a tablist REQUIRES role="tab" children (axe
           aria-required-children). A labelled group is the correct container. -->
      <div class="seg" role="group" aria-label="${t('Note mode', 'حالت یادداشت')}">
        <button type="button" class="seg-btn ${composerMode === 'note' ? 'active' : ''}" data-note-mode="note" aria-pressed="${composerMode === 'note'}">${t('Note', 'یادداشت')}</button>
        <button type="button" class="seg-btn ${composerMode === 'list' ? 'active' : ''}" data-note-mode="list" aria-pressed="${composerMode === 'list'}">${t('List', 'فهرست')}</button>
      </div>
      <input type="hidden" name="kind" value="${composerMode}">
      ${dashboardVal}
      <!-- dir: FA UI pins RTL so the Farsi placeholder (and FA typing) lays out right-to-left
           (dir=auto falls back to LTR on the empty value in several engines — user report
           2026-09-02); EN keeps auto so mixed-language typing still works. -->
      <textarea class="note-compose-text" id="note-compose-box" name="content" rows="${composeRows}" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${t(composerMode === 'note' ? 'Type a note and press Enter…' : 'Type a task and press Enter…', composerMode === 'note' ? 'یادداشت را تایپ کن و اینتر را بزن' : 'وظیفه را تایپ کن و اینتر را بزن')}" maxlength="20000" autocomplete="off"></textarea>
      <button type="submit" class="qa-btn" aria-label="${t('Add', 'افزودن')}" title="${t('Add', 'افزودن')}">${icon('plus')}</button>
      <ul class="note-draft" hidden></ul>
    </form>
    <div class="note-list">
      ${notes.map((n) => noteCard(n, lang, titles)).join('')}
    </div>
    ${stickyNav}
  </section>`
}

