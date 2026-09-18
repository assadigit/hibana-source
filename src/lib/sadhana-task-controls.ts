import { esc } from './http'
import { icon } from './html'
import { trL, type Locale, type Vars } from './i18n'
import type { SadhanaTask } from '../services/sadhana'

export type SadhanaTaskNote = {
  id: string
  task_id: string
  text: string
  created_at: string
  legacy?: boolean
}

type State = SadhanaTask['progress']

type StateCopy = { id: State; en: string; fa: string; tone: string; dotIcon: string }

const STATES: StateCopy[] = [
  { id: 'untouched', en: 'Not started', fa: 'شروع نشده', tone: 'info', dotIcon: 'circle' },
  { id: 'in_progress', en: 'In progress', fa: 'در حال انجام', tone: 'success', dotIcon: 'circle' },
  { id: 'on_hold', en: 'On hold', fa: 'معلق', tone: 'warning', dotIcon: 'circle' }, // P4.6 (F-M18): معلق (paused) not متوقف (halted) — halted is the project stage
]

const noteDate = (iso: string, lang: Locale, tz: string): string => {
  try {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: tz,
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

const label = (lang: Locale, en: string, fa: string, vars?: Vars): string => trL(lang, en, fa, vars)

const faDigits = (s: string): string => (s || '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])

/**
 * Sadhana task card — R10 redesign.
 *
 * The card is a single `<li>` with two regions:
 *   1. `.sadhana-card-row` (always visible): drag handle · emoji + title + badges ·
 *      three progress dots · current-state label · checkbox. Deadline + tags live on a
 *      small muted second line. The whole row is tap-to-expand (anything except a
 *      button / dot / checkbox toggles `.is-expanded` on the parent card).
 *   2. `.sadhana-card-expand` (hidden by default): left actions panel
 *      (Edit / Add Note / Change State / Delete) + right notes panel (numbered list +
 *      add textarea). The inline title-edit form renders in the row when Edit is
 *      clicked; the state selector dropdown anchors next to the state label.
 *
 * Every existing data attribute is preserved so the page-level handlers in
 * public/sadhana.html + public/js/app.js keep working unchanged.
 *
 * `metaHtml` is the server-rendered deadline + tag-chips row (kept in
 * sadhana.ts so the calendar-conversion stays there). `titleBadgesHtml` is the
 * optional pin / recurrence inline badges (also computed server-side so the
 * recurrence weekday labels match the user's language).
 */
export function sadhanaTaskControls(
  task: SadhanaTask,
  notes: SadhanaTaskNote[],
  lang: Locale,
  tz: string,
  opts: { metaHtml?: string; titleBadgesHtml?: string; noteTotal?: number } = {},
): string {
  const current = STATES.find((state) => state.id === task.progress) ?? STATES[0]
  const done = task.done === 1
  const count = notes.length
  // S76: the board caps the notes that ride it at the latest 20 per task (the
  // unbounded-journal fix). noteTotal is the TRUE per-task count (incl. truncated
  // rows); the badge shows it and the panel says "showing latest k of n" when the
  // cap actually bit. Absent noteTotal (older callers) → rendered count, as before.
  const total = typeof opts.noteTotal === 'number' ? opts.noteTotal : count
  const metaHtml = opts.metaHtml ?? ''
  const titleBadgesHtml = opts.titleBadgesHtml ?? ''

  // ---- progress dots (always visible, current filled) ---------------------------
  // Three small buttons. Each carries data-task-progress + data-task-id so the
  // existing app.js delegated handler posts the PATCH and refreshes the board.
  const dotsHtml = done
    ? ''
    : STATES.map((state) => {
        const isCurrent = current.id === state.id
        return `<button type="button" class="task-status-dot status-${state.tone} ${isCurrent ? 'is-current' : ''}" data-task-progress="${state.id}" data-task-id="${esc(task.id)}" aria-pressed="${isCurrent}" aria-label="${label(lang, state.en, state.fa)}" title="${label(lang, state.en, state.fa)}"><span aria-hidden="true"></span></button>`
      }).join('')

  // ---- state selector dropdown (shown when "Change State" / the label is clicked) -
  // The buttons reuse the same data-task-progress + data-task-id hook as the dots,
  // so the existing app.js handler posts the PATCH (and re-renders the board, which
  // closes the dropdown as a side effect).
  const stateOptionsHtml = STATES.map((state) => {
    const isCurrent = current.id === state.id
    return `<button type="button" class="sadhana-state-option ${isCurrent ? 'is-current' : ''} status-${state.tone}" data-task-progress="${state.id}" data-task-id="${esc(task.id)}" aria-pressed="${isCurrent}" title="${label(lang, state.en, state.fa)}"><span class="sadhana-state-dot" aria-hidden="true"></span><span>${label(lang, state.en, state.fa)}</span></button>`
  }).join('')

  // ---- notes list (numbered, click-to-edit) -------------------------------------
  // Each note text is wrapped in a button[data-task-note-edit] so the page JS can
  // swap it into a textarea; the existing data-task-note-delete button stays.
  // S76: numbering is positional over the RENDERED (latest-k) rows — the truncation
  // hint above the list is what makes the renumbering honest.
  const noteItems = notes.length
    ? notes
        .map((note, i) => `<li class="task-note-item">
          <span class="task-note-num" aria-hidden="true">${lang === 'fa' ? faDigits(String(i + 1)) : String(i + 1)}.</span>
          <div class="task-note-copy">
            <time datetime="${esc(note.created_at)}">${esc(noteDate(note.created_at, lang, tz))}</time>
            <button type="button" class="task-note-text" data-task-note-edit="${esc(note.id)}" title="${label(lang, 'Edit note', 'ویرایش یادداشت')}">${esc(note.text)}</button>
          </div>
          <button type="button" class="ghost task-note-delete" data-task-note-delete="${esc(note.id)}" ${note.legacy ? `data-note-legacy-task="${esc(task.id)}"` : ''} aria-label="${label(lang, 'Delete note', 'حذف یادداشت')}" title="${label(lang, 'Delete note', 'حذف یادداشت')}">${icon('x')}</button>
        </li>`)
        .join('')
    : `<li class="task-notes-empty muted">${label(lang, 'No notes yet', 'هنوز یادداشتی نیست')}</li>`
  const num10 = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const truncationHint = total > count
    ? `<p class="task-notes-truncated">${label(lang, 'Showing the latest {k} of {n} notes', 'آخرین {k} یادداشت از {n}', { k: num10(count), n: num10(total) })}</p>`
    : ''

  // ---- actions panel (left column of the expand section) -----------------------
  const editBtn = done ? '' : `<button type="button" class="sadhana-action" data-task-edit-open="${esc(task.id)}" aria-expanded="false" aria-controls="task-edit-${esc(task.id)}" aria-label="${label(lang, 'Edit', 'ویرایش')}" title="${label(lang, 'Edit', 'ویرایش')}">${icon('pencil')}<span>${label(lang, 'Edit', 'ویرایش')}</span></button>`
  const addNoteBtn = done ? '' : `<button type="button" class="sadhana-action" data-task-note-focus="${esc(task.id)}" aria-controls="task-notes-${esc(task.id)}" aria-label="${label(lang, 'Add note', 'افزودن یادداشت')}" title="${label(lang, 'Add note', 'افزودن یادداشت')}">${icon('plus')}<span>${label(lang, 'Add note', 'افزودن یادداشت')}</span></button>`
  const changeStateBtn = done ? '' : `<button type="button" class="sadhana-action" data-state-selector-open="${esc(task.id)}" aria-expanded="false" aria-controls="task-state-${esc(task.id)}" aria-label="${label(lang, 'Change state', 'تغییر وضعیت')}" title="${label(lang, 'Change state', 'تغییر وضعیت')}">${icon('flag')}<span>${label(lang, 'Change state', 'تغییر وضعیت')}</span></button>`
  const deleteBtn = `<button type="button" class="sadhana-action danger" data-sadhana-delete="${esc(task.id)}" aria-label="${label(lang, 'Delete', 'حذف')}" title="${label(lang, 'Delete', 'حذف')}">${icon('trash')}<span>${label(lang, 'Delete', 'حذف')}</span></button>`

  // The state-label button in the row mirrors the same dropdown — clicking the
  // label is the discoverable "what does this dot mean" affordance. Done tasks
  // show a neutral "Done" label, no dropdown.
  const stateLabelBtn = done
    ? `<span class="sadhana-state-label is-done"><span class="task-status-label">${label(lang, 'Done', 'انجام شد')}</span></span>`
    : `<button type="button" class="sadhana-state-label" data-state-selector-open="${esc(task.id)}" aria-expanded="false" aria-controls="task-state-${esc(task.id)}" aria-label="${label(lang, 'Change state', 'تغییر وضعیت')}" title="${label(lang, 'Change state', 'تغییر وضعیت')}"><span class="task-status-label">${label(lang, current.en, current.fa)}</span>${icon('more-h', 'icon')}</button>`

  // The emoji spacer keeps titles aligned whether or not the task has a chosen
  // emoji (the default 📌 counts as "none"); a fixed-width invisible spacer
  // keeps titles aligned across emoji / no-emoji rows.
  const emoji = task.emoji && task.emoji !== '📌'
    ? `<span class="sadhana-emoji">${esc(task.emoji)}</span>`
    : '<span class="sadhana-emoji is-none" aria-hidden="true"></span>'

  // The meta line stays in the collapsed row (visible in both collapsed + expanded
  // states). Empty meta hides the line entirely.
  const metaLine = metaHtml
    ? `<div class="sadhana-meta-line">${metaHtml}</div>`
    : ''

  return `<div class="sadhana-card-row" data-sadhana-toggle="${esc(task.id)}">
    <span class="sadhana-drag-handle" aria-hidden="true" title="${label(lang, 'Drag to reorder', 'برای جابه‌جایی بکشید')}">${icon('more-h', 'icon')}</span>
    <div class="sadhana-card-main">
      <div class="sadhana-title-wrap">
        <div class="sadhana-title">${emoji}<span data-task-title="${esc(task.id)}">${esc(task.title)}</span>${titleBadgesHtml}</div>
        <form class="task-inline-edit" id="task-edit-${esc(task.id)}" data-task-edit-form="${esc(task.id)}" hidden>
          <input type="text" name="title" value="${esc(task.title)}" maxlength="255" required aria-label="${label(lang, 'Task title', 'عنوان کار')}">
          <button type="submit" class="ghost" aria-label="${label(lang, 'Save task', 'ذخیره کار')}" title="${label(lang, 'Save task', 'ذخیره کار')}">${icon('check')}</button>
          <button type="button" class="ghost" data-task-edit-cancel="${esc(task.id)}" aria-label="${label(lang, 'Cancel editing', 'لغو ویرایش')}" title="${label(lang, 'Cancel editing', 'لغو ویرایش')}">${icon('x')}</button>
          <span class="task-edit-error" role="alert" hidden>${label(lang, 'Title cannot be empty', 'عنوان نمی‌تواند خالی باشد')}</span>
        </form>
        ${metaLine}
      </div>
    </div>
    <div class="sadhana-card-side">
      <span class="sadhana-progress-dots task-status-track" role="group" aria-label="${label(lang, 'Progress status', 'وضعیت پیشرفت')}">${dotsHtml}</span>
      ${stateLabelBtn}
      <button type="button" class="toggle" data-task-complete="${esc(task.id)}" data-task-done="${task.done}" aria-label="${done ? label(lang, 'Mark open', 'باز کردن') : label(lang, 'Complete', 'انجام شد')}" title="${done ? label(lang, 'Mark open', 'باز کردن') : label(lang, 'Complete', 'انجام شد')}">${icon(done ? 'check' : 'unchecked')}</button>
    </div>
    <div class="sadhana-state-selector" id="task-state-${esc(task.id)}" data-state-selector="${esc(task.id)}" hidden>${done ? '' : stateOptionsHtml}</div>
  </div>
  <div class="sadhana-card-expand" data-sadhana-expand="${esc(task.id)}" hidden>
    <div class="sadhana-actions-panel">
      ${editBtn}
      ${addNoteBtn}
      ${changeStateBtn}
      ${deleteBtn}
    </div>
    <section class="sadhana-notes-panel task-notes-panel" id="task-notes-${esc(task.id)}" data-task-notes-panel="${esc(task.id)}">
      <header class="sadhana-notes-head">
        <span class="sadhana-notes-title">${icon('clipboard', 'icon')}<span>${label(lang, 'Notes', 'یادداشت‌ها')}</span></span>
        <span class="task-note-badge" data-task-note-badge aria-hidden="true">${num10(total)}</span>
      </header>
      ${truncationHint}
      <ol class="task-notes-list">${noteItems}</ol>
      <form class="task-note-add-form" data-task-note-form="${esc(task.id)}">
        <textarea name="text" maxlength="500" rows="2" required placeholder="${label(lang, 'Add a note…', 'افزودن یادداشت…')}" aria-label="${label(lang, 'New note', 'یادداشت جدید')}"></textarea>
        <button type="submit" class="ghost" aria-label="${label(lang, 'Add note', 'افزودن یادداشت')}" title="${label(lang, 'Add note', 'افزودن یادداشت')}">${icon('plus')}</button>
      </form>
    </section>
  </div>`
}

/**
 * Standalone status-track: three small dots (one per state, current filled, others
 * outlined) with the state label inline. Kept for the dashboard preview's compact
 * affordance — the dashboard does NOT use the new expand/collapse card (it has its
 * own simpler row). Returns '' for done tasks (no progress on a completed card).
 */
export function taskStatusTrack(task: SadhanaTask, lang: Locale): string {
  if (task.done === 1) return ''
  const current = STATES.find((s) => s.id === task.progress) ?? STATES[0]
  const statuses = STATES.map(
    (state) => `<button type="button" class="task-status-dot status-${state.tone} ${current.id === state.id ? 'is-current' : ''}" data-task-progress="${state.id}" data-task-id="${esc(task.id)}" aria-pressed="${current.id === state.id}" aria-label="${label(lang, state.en, state.fa)}" title="${label(lang, state.en, state.fa)}"><span aria-hidden="true"></span></button>`,
  ).join('')
  return `<span class="task-status-track" role="group" data-task-id="${esc(task.id)}" aria-label="${label(lang, 'Progress status', 'وضعیت پیشرفت')}">${statuses}<span class="task-status-label">${label(lang, current.en, current.fa)}</span></span>`;
}

export function legacyTaskNote(task: SadhanaTask): SadhanaTaskNote | null {
  return task.note.trim()
    ? { id: `legacy:${task.id}`, task_id: task.id, text: task.note, created_at: task.updated_at, legacy: true }
    : null
}
