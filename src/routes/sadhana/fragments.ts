// Sadhana board — secondary fragments (Phase 4 split from routes/sadhana.ts).
//
// Purpose: the single-consumer render fragments — the inline task editor
// (editFormHtml), the shared deadline picker markup (datePickerMarkup), the
// full-screen focus view (focusZone), and the archive's recurring completion
// log (recurLogHtml, the one db-touching fragment).
//
// Public API: recurLogHtml, editFormHtml, datePickerMarkup, focusZone.
import { esc } from '../../lib/http'
import { icon } from '../../lib/html'
import { faDigits, formatDate } from '../../lib/jalali'
import { QUADRANTS, TAGS, type SadhanaTask, type TagId } from '../../services/sadhana'
import { FUZZY_LABEL, WEEKDAYS, type BoardCtx } from '../sadhana-helpers'
import { t, qName, taskOrder, taskCardHtml, zone } from './render'
import type { BoardData } from './data'
import type { Db } from '../../db/types'

// Recurring completion log for the archive (spec §5.15).
export const recurLogHtml = async (db: Db, ctx: BoardCtx): Promise<string> => {
  const lang = ctx.lang
  const rows = await db.query<{ task_id: string; title: string; emoji: string; cn: number; dates: string }>(
    `SELECT rh.task_id, st.title, st.emoji, COUNT(rh.id) AS cn, GROUP_CONCAT(rh.completed_on, ',') AS dates
     FROM sadhana_recur_history rh JOIN sadhana_tasks st ON st.id = rh.task_id
     WHERE st.user_id = ? GROUP BY rh.task_id ORDER BY st.title`,
    [ctx.user.id],
  )
  if (!rows.length) return ''
  return `<section class="card"><h3>${t(lang, 'Recurring — Completion Log', 'تکرارشونده — گزارش انجام')}</h3>
    <ul class="sadhana-recurlog">${rows
      .map(
        (r) => `<li><details><summary>${esc(r.emoji)} ${esc(r.title)} — ${icon('check', 'icon')} ${t(lang, '{n}×', '{n} بار', { n: lang === 'fa' ? faDigits(String(r.cn)) : r.cn })}</summary>
          <span class="pill-row">${(r.dates ?? '').split(',').filter(Boolean).map((d) => `<span class="pill" data-date="${esc(d)}">${esc(d)}</span>`).join('')}</span></details></li>`,
      )
      .join('')}</ul></section>`
}

// The inline task editor — the one place title/note/deadline/recurrence are edited (§5.4).
export function editFormHtml(task: SadhanaTask, ctx: BoardCtx): string {
  const lang = ctx.lang
  const recurOpts = [
    ['daily', 'Daily', 'روزانه'], ['weekly', 'Weekly (days 0–6, Mon=0)', 'هفتگی (روزها ۰–۶، دوشنبه=۰)'],
    ['ndays', 'Every N days', 'هر N روز'], ['monthly', 'Monthly', 'ماهانه'],
  ]
    .map(([v, en, fa]) => `<option value="${v}" ${task.recur_type === v ? 'selected' : ''}>${t(lang, en, fa)}</option>`)
  const activeDays = new Set((task.recur_config ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))
  const dayBtns = WEEKDAYS[lang]
    .map((d) => `<button type="button" class="chip ${activeDays.has(d.n) ? 'active' : ''}" data-day="${d.n}">${d.label}</button>`)
    .join('')
  return `<section class="card sadhana-edit">
    <h3>${t(lang, 'Edit task', 'ویرایش کار')}</h3>
    <form hx-patch="/api/sadhana/tasks/${task.id}" hx-target="closest .sadhana-zone" hx-swap="outerHTML" class="column">
      <label>${t(lang, 'Title', 'عنوان')}<input name="title" value="${esc(task.title)}" required maxlength="255"></label>
      <label>${t(lang, 'Emoji', 'ایموجی')}<input name="emoji" value="${esc(task.emoji)}" maxlength="4" data-emoji></label>
      <label>${t(lang, 'Note', 'یادداشت')}<textarea name="note" rows="3">${esc(task.note)}</textarea></label>
      <div class="deadline-fields">
        <span class="field-label">${t(lang, 'Deadline', 'مهلت')}</span>
        ${datePickerMarkup(ctx, { fuzzy: task.fuzzy, due_date: task.due_date, due_time: task.due_time })}
      </div>
      <fieldset class="recur-fields" data-recur-config>
        <legend>${t(lang, 'Recurring', 'تکرارشونده')}</legend>
        <label class="row"><input type="checkbox" data-recur-check ${task.recurring ? 'checked' : ''}> ${t(lang, 'Reopen automatically', 'خودکار باز شود')}</label>
        <input type="hidden" name="recurring" data-recur-hidden value="${task.recurring ? 'true' : 'false'}">
        <label>${t(lang, 'Type', 'نوع')}
          <select name="recur_type" data-recur-type>
            <option value="daily" ${!task.recurring || task.recur_type === 'daily' ? 'selected' : ''}>${t(lang, 'Daily', 'روزانه')}</option>
            ${recurOpts.slice(1).join('')}
          </select>
        </label>
        <p class="muted small" data-recur-panel="daily" ${task.recur_type !== 'daily' ? 'hidden' : ''}>${t(lang, 'Resets every day at midnight.', 'هر روز نیمه‌شب باز می‌شود.')}</p>
        <div class="recur-days row wrap" data-recur-panel="weekly" ${task.recur_type !== 'weekly' ? 'hidden' : ''}>${dayBtns}</div>
        <label data-recur-panel="ndays" ${task.recur_type !== 'ndays' ? 'hidden' : ''}>${t(lang, 'Every', 'هر')} <input type="number" data-recur-n min="1" max="365" value="${Number(task.recur_config) || 7}"> ${t(lang, 'days', 'روز')}</label>
        <label data-recur-panel="monthly" ${task.recur_type !== 'monthly' ? 'hidden' : ''}>${t(lang, 'On the', 'روز')} <input type="number" data-recur-m min="1" max="31" value="${Number(task.recur_config) || 1}"> ${t(lang, 'of each month', 'هر ماه')}</label>
        <input type="hidden" name="recur_config" data-recur-value value="${esc(task.recur_config ?? '')}">
      </fieldset>
      <div class="row">
        <button type="button" class="ghost" hx-get="/api/sadhana" hx-target="closest .sadhana-zone" hx-swap="outerHTML">${t(lang, 'Cancel', 'انصراف')}</button>
        <button type="submit">${t(lang, 'Save', 'ذخیره')}</button>
      </div>
    </form>
  </section>`
}

// The deadline component markup — one implementation for the dialog, the edit form and
// the focus add form. Hidden inputs carry fuzzy/due_date/due_time (htmx submits them;
// the dialog reads them on save). The popover logic lives in public/sadhana.html.
export const datePickerMarkup = (ctx: BoardCtx, v: { fuzzy: string | null; due_date: string | null; due_time: string | null }): string => {
  const { lang, cal } = ctx
  const presets = Object.entries(FUZZY_LABEL)
    .map(([k, l]) => `<label class="chip dp-preset ${v.fuzzy === k ? 'active' : ''}"><input type="radio" name="dp-preset" value="${k}" ${v.fuzzy === k ? 'checked' : ''} hidden>${t(lang, l.en, l.fa)}</label>`)
    .join('')
  let label = t(lang, 'Set deadline…', 'تعیین مهلت…')
  if (v.fuzzy) label = t(lang, FUZZY_LABEL[v.fuzzy].en, FUZZY_LABEL[v.fuzzy].fa)
  else if (v.due_date) label = `${icon('calendar', 'icon')} ${formatDate(v.due_date, cal, lang)}${v.due_time ? ` ${icon('clock', 'icon')}${esc(v.due_time)}` : ''}`
  return `<div class="dp" data-dp data-cal="${cal}" data-lang="${lang}">
    <input type="hidden" name="fuzzy" data-dp-fuzzy value="${esc(v.fuzzy ?? '')}">
    <input type="hidden" name="due_date" data-dp-date value="${esc(v.due_date ?? '')}">
    <input type="hidden" name="due_time" data-dp-time value="${esc(v.due_time ?? '')}">
    <button type="button" class="ghost dp-trigger" data-dp-open>${icon('calendar', 'icon')} <span data-dp-label>${esc(label)}</span></button>
    <div class="dp-pop" data-dp-pop hidden>
      <div class="row wrap dp-tabs">
        <button type="button" class="chip dp-tab active" data-dp-tab="presets">${t(lang, 'Quick pick', 'انتخاب سریع')}</button>
        <button type="button" class="chip dp-tab" data-dp-tab="exact">${t(lang, 'Pick date', 'انتخاب تاریخ')}</button>
      </div>
      <div class="dp-presets row wrap" data-dp-panel="presets">${presets}</div>
      <div class="dp-exact column" data-dp-panel="exact" hidden>
        <div class="row wrap">
          <select data-dp-year aria-label="${t(lang, 'Year', 'سال')}"></select>
          <select data-dp-month aria-label="${t(lang, 'Month', 'ماه')}"></select>
          <select data-dp-day aria-label="${t(lang, 'Day', 'روز')}"></select>
        </div>
        <div class="row wrap">
          <input type="time" data-dp-time-input aria-label="${t(lang, 'Time (optional)', 'ساعت (اختیاری)')}">
          <button type="button" class="ghost" data-dp-clear>✕ ${t(lang, 'Clear', 'پاک کردن')}</button>
          <button type="button" class="btn" data-dp-ok>${t(lang, 'Confirm', 'تأیید')}</button>
        </div>
      </div>
    </div>
  </div>`
}

// Full-screen view of one quadrant, plus its own add form (title + emoji + tags + deadline,
// §5.10). Shared by GET /focus/:q and the focus add-form POST (which must re-render the
// same fragment instead of the whole board).
export const focusZone = (q: number, data: Awaited<BoardData>, ctx: BoardCtx): string => {
  const { lang, cal, tz } = ctx
  const meta = QUADRANTS.find((x) => x.id === q)!
  const name = qName(q, data.names, lang)
  const openList = data.tasks.filter((x) => x.quadrant === q && x.done === 0).sort(taskOrder)
  const doneList = data.tasks.filter((x) => x.quadrant === q && x.done === 1).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const tagChipsAll = (['w', 'p', 'sg', 'so', 'h'] as TagId[])
    .map((tg) => `<label class="chip sadhana-tag focus-tag"><input type="checkbox" name="tags" value="${tg}" hidden>${TAGS[tg].icon} ${t(lang, TAGS[tg].en, TAGS[tg].fa)}</label>`)
    .join('')
  return zone(`<section class="sadhana-focus" data-quadrant="${q}">
    <header class="sadhana-qhead row spread">
      <div class="sadhana-qtitle"><span class="sadhana-qicon">${icon(meta.glyph)}</span><div><strong>${esc(name)}</strong><span class="muted small"> ${t(lang, meta.subtitle.en, meta.subtitle.fa)}</span></div></div>
      <button type="button" class="ghost" data-focus-close aria-label="${t(lang, 'Close', 'بستن')}">${icon('x')}</button>
    </header>
    <form class="sadhana-focusadd card" hx-post="/api/sadhana/tasks" hx-target="closest .sadhana-zone" hx-swap="outerHTML">
      <input type="hidden" name="quadrant" value="${q}">
      <input type="hidden" name="focus" value="true">
      <div class="row wrap">
        <input name="emoji" value="📌" maxlength="4" data-emoji aria-label="${t(lang, 'Emoji', 'ایموجی')}">
        <input name="title" required maxlength="255" placeholder="${t(lang, 'Add task…', 'افزودن کار…')}" autocomplete="off">
        <button class="qa-btn" aria-label="${t(lang, 'Add', 'افزودن')}">${icon('plus')}</button>
      </div>
      <div class="focus-tags row wrap">${tagChipsAll}</div>
      ${datePickerMarkup(ctx, { fuzzy: null, due_date: null, due_time: null })}
    </form>
    <ul class="sadhana-list">
      ${openList.map((task) => taskCardHtml(task, data.tags.get(task.id) ?? [], data.notes.get(task.id) ?? [], lang, tz, cal, data.noteTotals.get(task.id))).join('') || `<li class="sadhana-empty muted">${t(lang, 'No tasks yet', 'هنوز کاری نیست')}</li>`}
    </ul>
    ${doneList.length ? `<details class="sadhana-done"><summary>${t(lang, '{n} completed', '{n} انجام شد', { n: lang === 'fa' ? faDigits(String(doneList.length)) : doneList.length })}</summary><ul class="sadhana-donelist">${doneList.map((task) => taskCardHtml(task, data.tags.get(task.id) ?? [], data.notes.get(task.id) ?? [], lang, tz, cal, data.noteTotals.get(task.id))).join('')}</ul></details>` : ''}
  </section>`)
}
