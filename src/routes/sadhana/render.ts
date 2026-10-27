// Sadhana board — server-rendered fragments (Phase 4 split from routes/sadhana.ts).
//
// Purpose: the pure rendering layer — board context construction (ctxOf), the
// sadhana-zone wrapper, quadrant/task card HTML, the four-quadrant board, and
// the small text/i18n helpers they share. No db access (data.ts owns that).
//
// Public API: ctxOf, zone, isHx, t, qName, qSubtitle, deadlineHtml, recurBadge,
// tagChips, taskCardHtml, quadrantsHtml, taskOrder, boardZoneHtml.
import type { Context } from 'hono'
import { esc, isHtmx } from '../../lib/http'
import { icon, quadrantGlyph } from '../../lib/html'
import { localeOf, trL, type Locale, type Vars } from '../../lib/i18n'
import { calendarFor, faDigits, formatDate, formatDateLong } from '../../lib/jalali'
import { QUADRANTS, TAGS, orderedQuadrants, todayIn, type SadhanaTask, type TagId } from '../../services/sadhana'
import { sadhanaTaskControls, type SadhanaTaskNote } from '../../lib/sadhana-task-controls'
import { FUZZY_LABEL, QUADRANT_ICONS, QUADRANT_ACCENTS, type BoardCtx } from '../sadhana-helpers'
import type { BoardData } from './data'
import type { UserRow } from '../../types'

export const ctxOf = (c: Context<{ Variables: { user: UserRow } }>): BoardCtx => {
  const user = c.get('user')
  return { user, lang: localeOf(c), cal: calendarFor(localeOf(c)), tz: user.timezone, today: todayIn(user.timezone) }
}
export const zone = (html: string, extraClass = '') => `<div class="sadhana-zone${extraClass ? ` ${extraClass}` : ''}" id="sadhana-zone">${html}</div>`
export const isHx = (c: Context) => isHtmx(c)

// ---- rendering helpers -----------------------------------------------------------
export const t = (lang: Locale, en: string, fa: string, vars?: Vars) => trL(lang, en, fa, vars)

export const qName = (q: number, names: Map<number, string>, lang: Locale): string => {
  const meta = QUADRANTS.find((x) => x.id === q)!
  return names.get(q) ?? t(lang, meta.name.en, meta.name.fa)
}

// Quadrant subheading (0025): a user-set subtitle wins; a BLANK custom subtitle renders
// an empty line; only a quadrant the user has never renamed falls back to the built-in one.
export const qSubtitle = (q: number, subtitles: Map<number, string | null>, lang: Locale): string => {
  if (subtitles.has(q)) return subtitles.get(q) ?? ''
  const builtin = QUADRANTS.find((x) => x.id === q)?.subtitle
  return builtin ? t(lang, builtin.en, builtin.fa) : ''
}

export const deadlineHtml = (task: SadhanaTask, lang: Locale, tz: string, cal: 'gregorian' | 'shamsi'): string => {
  if (task.fuzzy) {
    const l = FUZZY_LABEL[task.fuzzy]
    return `<span class="deadline fuzzy">${t(lang, l.en, l.fa)}</span>`
  }
  if (!task.due_date) return ''
  const today = todayIn(tz)
  const overdue = task.done === 0 && task.due_date < today
  // Server-side calendar conversion (rule 3): stored Gregorian UTC, displayed in the
  // user's calendar + digits. data-date is deliberately NOT used here — the global
  // client pass would overwrite the rendered text and drop the time (spec §5.11).
  const date = formatDate(task.due_date, cal, lang)
  const time = task.due_time ? ` <span class="deadline-time">${icon('clock', 'icon')}${esc(task.due_time)}</span>` : ''
  return `<span class="deadline ${overdue ? 'overdue' : ''}">${icon('calendar', 'icon')} ${date}${time}</span>${overdue ? ` <span class="overdue-badge">${icon('alert', 'icon')} ` + t(lang, 'Overdue', 'دیر شده') + '</span>' : ''}`
}

export const recurBadge = (task: SadhanaTask, lang: Locale): string => {
  if (!task.recurring || !task.recur_type) return ''
  const cfg = task.recur_config
  const label =
    task.recur_type === 'daily'
      ? t(lang, 'Daily', 'روزانه')
      : task.recur_type === 'weekly'
        ? cfg
          ? t(
              lang,
              cfg
                .split(',')
                .map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Number(d)] ?? '')
                .filter(Boolean)
                .join('·') || '—',
              cfg
                .split(',')
                .map((d) => ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه', 'یکشنبه'][Number(d)] ?? '')
                .filter(Boolean)
                .join('·') || '—',
            )
          : t(lang, 'Never', 'هرگز')
        : task.recur_type === 'ndays'
          ? t(lang, 'Every {n}d', 'هر {n} روز', { n: lang === 'fa' ? faDigits(String(cfg || '7')) : String(cfg || '7') })
          : t(lang, 'On the {n}th', 'روز {n} هر ماه', { n: lang === 'fa' ? faDigits(String(cfg || '1')) : String(cfg || '1') })
  return ` <span class="recur-badge" title="${t(lang, 'Recurring', 'تکرارشونده')}">${icon('repeat', 'icon')} ${esc(label)}</span>`
}

export const tagChips = (tags: TagId[] | undefined, lang: Locale): string =>
  (tags ?? []).map((tg) => `<span class="chip sadhana-tag" data-tag="${tg}">${TAGS[tg].icon} ${esc(t(lang, TAGS[tg].en, TAGS[tg].fa))}</span>`).join('')

export const taskCardHtml = (task: SadhanaTask, tags: TagId[], notes: SadhanaTaskNote[], lang: Locale, tz: string, cal: 'gregorian' | 'shamsi', noteTotal?: number): string => {
  // R10 redesign — the whole card (collapsed row + expand section) is produced by
  // sadhanaTaskControls. We pass the server-rendered deadline + tag chips as a
  // metaHtml string so the calendar conversion stays in this file (and the meta
  // line keeps living in the collapsed row). Pin + recurrence badges are also
  // passed in so the recurrence weekday labels match the user's language.
  // S76: noteTotal (per-task TOTAL incl. truncated rows) rides along so the badge
  // and the "showing latest k of n" hint stay honest under the 20-note cap.
  const titleBadgesHtml = `${task.pinned === 1 ? ` <span class="pin-badge">${icon('pin', 'icon')}</span>` : ''}${recurBadge(task, lang)}`
  const metaHtml = `${deadlineHtml(task, lang, tz, cal)}${tagChips(tags, lang)}`
  return `<li class="sadhana-card ${task.done === 1 ? 'done' : ''} ${task.pinned === 1 ? 'pinned' : ''} p-${task.progress}" data-task-id="${task.id}" data-done="${task.done}" data-tags="${(tags ?? []).join(' ')}" ${task.done === 1 ? '' : 'draggable="true"'}>
    ${sadhanaTaskControls(task, notes, lang, tz, { metaHtml, titleBadgesHtml, noteTotal })}
  </li>`
}

export const quadrantsHtml = (data: Awaited<BoardData>, lang: Locale, tz: string, cal: 'gregorian' | 'shamsi', ctxOrder: string): string => {
  const { tasks, tags, names, styles, notes, noteTotals } = data
  const open = (q: number) => tasks.filter((x) => x.quadrant === q && x.done === 0).sort(taskOrder)
  const done = (q: number) => tasks.filter((x) => x.quadrant === q && x.done === 1).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return orderedQuadrants(QUADRANTS, ctxOrder).map((q) => {
    const openList = open(q.id)
    const doneList = done(q.id)
    const name = qName(q.id, names, lang)
    const subtitle = qSubtitle(q.id, data.subtitles, lang)
    const style = styles.get(q.id)
    const iconId = style?.icon ?? q.glyph
    // Emoji icon values (sadhana.html picker) render as text; glyph ids as SVG — quadrantGlyph handles both.
    const iconButtons = QUADRANT_ICONS.map((id) => `<button type="button" class="dash-style-icon ${id === iconId ? 'is-selected' : ''}" data-sadhana-icon="${id}" aria-label="${id}" title="${id}">${icon(id)}</button>`).join('')
      // S83 (owner request — the minimalist quadrant): EMPTY rides the same grid and
      // the same [data-sadhana-icon] PATCH path; icon_id 'none' renders nothing.
      + `<button type="button" class="dash-style-icon dash-style-empty${iconId === 'none' ? ' is-selected' : ''}" data-sadhana-icon="none" aria-label="${t(lang, 'No icon — minimalist', 'بدون نماد — مینیمال')}" title="${t(lang, 'No icon — minimalist', 'بدون نماد — مینیمال')}">∅</button>`
    // S93 (owner round, item 6 — 16 pastel swatches back in the popover): each button
    // PATCHes accent_color through the app.js [data-sadhana-accent] delegate; 'none'
    // clears back to the neutral quadrant.
    const accent = style?.accent ?? null
    const swatchButtons = QUADRANT_ACCENTS.map((tok) => `<button type="button" class="dash-style-swatch${accent === tok ? ' is-selected' : ''}" data-sadhana-accent="${tok}" style="--sw: var(--${tok})" aria-label="${tok}" title="${tok}"></button>`).join('')
      + `<button type="button" class="dash-style-swatch dash-style-swatch-none${!accent ? ' is-selected' : ''}" data-sadhana-accent="none" aria-label="${t(lang, 'No color — neutral', 'بدون رنگ — خنثی')}" title="${t(lang, 'No color — neutral', 'بدون رنگ — خنثی')}">∅</button>`
    const num = (v: number | string) => (lang === 'fa' ? faDigits(String(v)) : String(v))
    // 2026-09 user request — quadrants are MINIMAL/neutral: no per-quadrant accent class,
    // default --q-accent var, or swatch picker anymore (Phase 7 dropped the accent UI;
    // renameSchema still accepts accent_color). A user-PICKED accent still renders so
    // saved personalization isn't lost; consumers fall back to neutral tokens otherwise.
    // S93 (owner round, item 6): the picker is BACK as 16 pastel swatches (the washes
    // below stay low-opacity — a tint, never an ink).
    const accentAttr = style?.accent ? ` style="--q-accent: var(--${style.accent})"` : ''
    return `<section class="sadhana-quadrant" data-quadrant="${q.id}" data-sadhana-name="${esc(name)}"${accentAttr}>
      ${q.id === 3 ? `<span class="sadhana-ribbon" aria-hidden="true">${t(lang, 'Urgent', 'فوری')}</span>` : ''}
      <header class="sadhana-qhead">
        <div class="sadhana-qtitle">
          <button type="button" class="sadhana-qicon sadhana-style-trigger" data-sadhana-style="${q.id}" aria-label="${t(lang, 'Customize quadrant', 'شخصی‌سازی بخش')}" title="${t(lang, 'Customize quadrant', 'شخصی‌سازی بخش')}">${quadrantGlyph(style?.icon ?? null, q.icon)}</button>
          <div>
            <strong>${esc(name)}</strong>
            <span class="muted small">${subtitle ? esc(subtitle) : '&#8203;'}</span>
          </div>
          <div class="sadhana-style-pop" data-sadhana-style-pop="${q.id}" hidden>
            <form class="sadhana-rename-form" data-sadhana-rename="${q.id}">
              <label>${t(lang, 'Name', 'نام')}<span class="row"><input name="name" value="${esc(name)}" maxlength="60" required aria-label="${t(lang, 'Quadrant name', 'نام بخش')}"><button type="submit" aria-label="${t(lang, 'Save name', 'ذخیره نام')}">${icon('check')}</button></span></label>
            </form>
            <div class="dash-style-icons" role="grid" aria-label="${t(lang, 'Choose icon', 'انتخاب نماد')}">${iconButtons}</div>
            <div class="dash-style-swatches" role="group" aria-label="${t(lang, 'Pastel color', 'رنگ پاستلی')}">${swatchButtons}</div>
            <a class="q-style-focus" href="/api/sadhana/focus/${q.id}" hx-get="/api/sadhana/focus/${q.id}" hx-target="#sadhana-focus" hx-swap="innerHTML">${icon('target')} ${t(lang, 'Focus', 'تمرکز')}</a>
          </div>
        </div>
        <div class="row sadhana-qmeta">
          <span class="q-counter" data-counter="${q.id}" title="${t(lang, 'Open / total', 'باز / کل')}">${num(openList.length)} / ${num(openList.length + doneList.length)}</span>
        </div>
      </header>
      <ul class="sadhana-list" data-list="${q.id}">
        ${openList.map((task) => taskCardHtml(task, tags.get(task.id) ?? [], notes.get(task.id) ?? [], lang, tz, cal, noteTotals.get(task.id))).join('') || `<li class="sadhana-empty muted">${t(lang, 'Nothing here yet — add your first task.', 'هنوز چیزی نیست — اولین کار را اضافه کن.')}</li>`}
      </ul>
      <span class="sadhana-more" hidden>↓ ${t(lang, 'more', 'بیشتر')}</span>
      ${doneList.length ? `<details class="sadhana-done"><summary>${t(lang, '{n} completed', '{n} انجام شد', { n: lang === 'fa' ? faDigits(String(doneList.length)) : doneList.length })}</summary><ul class="sadhana-donelist">${doneList.map((task) => taskCardHtml(task, tags.get(task.id) ?? [], notes.get(task.id) ?? [], lang, tz, cal, noteTotals.get(task.id))).join('')}</ul></details>` : ''}
      <div class="qa-addrow">
        <button type="button" class="qa-btn qa-add-circle" data-qa-open aria-label="${t(lang, 'Add task', 'افزودن کار')}">${icon('plus')}</button>
        <!-- One circular "+" per card (the grey trigger above); the revealed row is just the
             input — Enter adds (the keydown handler requestSubmits the form). -->
        <form class="sadhana-quickadd" data-qa-form hidden hx-post="/api/sadhana/quadrants/${q.id}" hx-target="closest .sadhana-zone" hx-swap="outerHTML">
          <label class="qa-quickadd-label" for="qa-title-${q.id}">${t(lang, 'New Note', 'یادداشت جدید')}</label>
          <input id="qa-title-${q.id}" name="title" required maxlength="255" placeholder="${t(lang, 'Add task…', 'افزودن کار…')}" autocomplete="off">
        </form>
      </div>
    </section>`
  }).join('')
}

export const taskOrder = (a: SadhanaTask, b: SadhanaTask): number => {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned // pinned first
  if (a.position !== b.position) return a.position - b.position
  return b.created_at.localeCompare(a.created_at) // newest first among same position (spec §8 Q2 resolved)
}

export const boardZoneHtml = (data: Awaited<BoardData>, c: BoardCtx): string => {
  const { lang, today } = c
  const chips = (['w', 'p', 'sg', 'so', 'h'] as TagId[]).map((tg) => `<button type="button" class="chip filter-chip" data-filter="${tg}">${TAGS[tg].icon} ${t(lang, TAGS[tg].en, TAGS[tg].fa)}</button>`).join('')
  return zone(`<div class="sadhana-head">
      <div class="row spread wrap">
        <div class="row wrap">
          <h1>${t(lang, 'To-do list', 'لیست کارها')}</h1>
          <span class="date-pill">${formatDateLong(today, c.cal, lang)}</span>
        </div>
        <div class="row">
          <button type="button" data-sadhana-add aria-label="${t(lang, 'Add task', 'افزودن کار')}">${icon('plus')} <span>${t(lang, 'Add task', 'افزودن کار')}</span></button>
          <button type="button" class="ghost" data-view-archive aria-pressed="false">${icon('archive')} <span>${t(lang, 'Archive', 'بایگانی')}</span></button>
        </div>
      </div>
      <!-- a11y (S51-A): role=group, not tablist — the filter chips are plain toggle
           buttons (the JS toggles .active), and a tablist REQUIRES role="tab"
           children (axe aria-required-children). A labelled group is correct. -->
      <div class="chip-row" role="group" aria-label="${t(lang, 'Filter', 'فیلتر')}">
        <button type="button" class="chip filter-chip active" data-filter="all">${t(lang, 'All tasks', 'همه کارها')}</button>
        ${chips}
      </div>
      <p class="muted small filter-count" hidden></p>
    </div>
    <div class="sadhana-grid">${quadrantsHtml(data, lang, c.tz, c.cal, c.user.sadhana_quadrant_order)}</div>`)
}
