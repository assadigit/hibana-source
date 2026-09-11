import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody, etag } from '../lib/http'
import { icon, quadrantGlyph } from '../lib/html'
import { legacyTaskNote, sadhanaTaskControls, taskStatusTrack, type SadhanaTaskNote } from '../lib/sadhana-task-controls'
import { localeOf, trL, type Locale, type Vars } from '../lib/i18n'
import { calendarFor, faDigits, formatDate, formatDateLong } from '../lib/jalali'
import { uuid } from '../lib/ids'
import { QUADRANTS, TAGS, orderedQuadrants, parseQuadrantOrder, resetDueRecurring, todayIn, type SadhanaTask, type TagId } from '../services/sadhana'
import type { Config, UserRow } from '../types'

// Sadhana — standalone quadrant task board (spec 2026-08-25). Board + archive + focus
// render as htmx fragments swapping `closest .sadhana-zone` (the same zone serves the
// board, the focus overlay and the archive container); JSON for fetch() consumers.
// Rule 1: every query is user-scoped. Fuzzy deadlines are labels only — no date math,
// never overdue (spec §6.10). Exact deadlines are displayed via [data-date] so the
// client calendar layer converts them (calendar pref on the user record).


import {
  FUZZY_LABEL,
  quickAddSchema,
  toBool,
  deadlinishFields,
  recurshFields,
  createTaskSchema,
  patchTaskSchema,
  moveSchema,
  reorderSchema,
  quadrantOrderSchema,
  updateSchema,
  QUADRANT_ICONS,
  GLYPH_IDS,
  QUADRANT_ACCENTS,
  renameSchema,
  WEEKDAYS,
  type BoardCtx,
} from './sadhana-helpers'

export function sadhanaRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // ---- data loads ------------------------------------------------------------------
  const loadAll = async (userId: string) => {
    const tasks = await cfg.db.query<SadhanaTask>(
      `SELECT * FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NULL`,
      [userId],
    )
    const tagRows = await cfg.db.query<{ task_id: string; tag: TagId }>('SELECT * FROM sadhana_tags WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)', [userId])
    const nameRows = await cfg.db.query<{ quadrant: number; name: string; subtitle: string | null; icon_id: string | null; accent_color: string | null }>('SELECT quadrant, name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ?', [userId])
    const noteRows = await cfg.db.query<{ id: string; task_id: string; text: string; created_at: string }>(
      `SELECT u.id, u.task_id, u.text, u.created_at FROM sadhana_updates u
       JOIN sadhana_tasks t ON t.id = u.task_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL
       ORDER BY u.created_at DESC`,
      [userId],
    )
    const tags = new Map<string, TagId[]>()
    for (const r of tagRows) {
      const list = tags.get(r.task_id) ?? []
      list.push(r.tag)
      tags.set(r.task_id, list)
    }
    const names = new Map<number, string>(nameRows.map((r) => [r.quadrant, r.name]))
    const subtitles = new Map<number, string | null>(nameRows.map((r) => [r.quadrant, r.subtitle]))
    const styles = new Map<number, { icon: string | null; accent: string | null }>(nameRows.map((r) => [r.quadrant, { icon: r.icon_id, accent: r.accent_color }]))
    const notes = new Map<string, SadhanaTaskNote[]>()
    for (const note of noteRows) notes.set(note.task_id, [...(notes.get(note.task_id) ?? []), note])
    for (const task of tasks) {
      const legacy = legacyTaskNote(task)
      if (legacy) notes.set(task.id, [...(notes.get(task.id) ?? []), legacy])
    }
    return { tasks, tags, names, subtitles, styles, notes }
  }

  const ordered = (user: UserRow) => orderedQuadrants(QUADRANTS, user.sadhana_quadrant_order)

  const ownedTask = async (userId: string, id: string): Promise<SadhanaTask | null> => {
    const rows = await cfg.db.query<SadhanaTask>('SELECT * FROM sadhana_tasks WHERE id = ? AND user_id = ?', [id, userId])
    return rows.length ? rows[0] : null
  }

  const ctxOf = (c: Context<{ Variables: { user: UserRow } }>): BoardCtx => {
    const user = c.get('user')
    return { user, lang: localeOf(c), cal: calendarFor(localeOf(c)), tz: user.timezone, today: todayIn(user.timezone) }
  }
  const zone = (html: string, extraClass = '') => `<div class="sadhana-zone${extraClass ? ` ${extraClass}` : ''}" id="sadhana-zone">${html}</div>`
  const isHx = (c: Context) => c.req.header('HX-Request') !== undefined

  // ---- rendering helpers -----------------------------------------------------------
  const t = (lang: Locale, en: string, fa: string, vars?: Vars) => trL(lang, en, fa, vars)

  const qName = (q: number, names: Map<number, string>, lang: Locale): string => {
    const meta = QUADRANTS.find((x) => x.id === q)!
    return names.get(q) ?? t(lang, meta.name.en, meta.name.fa)
  }

  // Quadrant subheading (0025): a user-set subtitle wins; a BLANK custom subtitle renders
  // an empty line; only a quadrant the user has never renamed falls back to the built-in one.
  const qSubtitle = (q: number, subtitles: Map<number, string | null>, lang: Locale): string => {
    if (subtitles.has(q)) return subtitles.get(q) ?? ''
    return t(lang, QUADRANTS.find((x) => x.id === q)!.subtitle.en, QUADRANTS.find((x) => x.id === q)!.subtitle.fa)
  }

  const deadlineHtml = (task: SadhanaTask, lang: Locale, tz: string, cal: 'gregorian' | 'shamsi'): string => {
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

  const recurBadge = (task: SadhanaTask, lang: Locale): string => {
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

  const tagChips = (tags: TagId[] | undefined, lang: Locale): string =>
    (tags ?? []).map((tg) => `<span class="chip sadhana-tag" data-tag="${tg}">${TAGS[tg].icon} ${esc(t(lang, TAGS[tg].en, TAGS[tg].fa))}</span>`).join('')

  const progressTrack = (task: SadhanaTask, lang: Locale): string => {
    if (task.done === 1) return ''
    const states: { id: SadhanaTask['progress']; en: string; fa: string }[] = [
      { id: 'untouched', en: 'Not started', fa: 'شروع نشده' },
      { id: 'in_progress', en: 'In progress', fa: 'در حال انجام' },
      { id: 'on_hold', en: 'On hold', fa: 'متوقف' },
    ]
    const current = states.find((s) => s.id === task.progress) ?? states[0]
    // Plain buttons — page JS posts the PATCH. Spec §5.8: clicking the already-active
    // non-untouched dot resets the task to Not started (the JS computes the target).
    return `<span class="progress-track" title="${t(lang, 'Progress', 'پیشرفت')}">${states
      .map(
        (s) =>
          `<button type="button" class="progress-dot ${task.progress === s.id ? 'active' : ''}" data-progress="${s.id}" data-task-id="${task.id}" aria-label="${t(lang, s.en, s.fa)}" title="${t(lang, s.en, s.fa)}" aria-pressed="${task.progress === s.id}"></button>`,
      )
      .join('')}<span class="progress-label">${t(lang, current.en, current.fa)}</span></span>`
  }

  const taskCardHtml = (task: SadhanaTask, tags: TagId[], notes: SadhanaTaskNote[], lang: Locale, tz: string, cal: 'gregorian' | 'shamsi'): string => {
    // R10 redesign — the whole card (collapsed row + expand section) is produced by
    // sadhanaTaskControls. We pass the server-rendered deadline + tag chips as a
    // metaHtml string so the calendar conversion stays in this file (and the meta
    // line keeps living in the collapsed row). Pin + recurrence badges are also
    // passed in so the recurrence weekday labels match the user's language.
    const titleBadgesHtml = `${task.pinned === 1 ? ` <span class="pin-badge">${icon('pin', 'icon')}</span>` : ''}${recurBadge(task, lang)}`
    const metaHtml = `${deadlineHtml(task, lang, tz, cal)}${tagChips(tags, lang)}`
    return `<li class="sadhana-card ${task.done === 1 ? 'done' : ''} ${task.pinned === 1 ? 'pinned' : ''} p-${task.progress}" data-task-id="${task.id}" data-done="${task.done}" data-tags="${(tags ?? []).join(' ')}" ${task.done === 1 ? '' : 'draggable="true"'}>
      ${sadhanaTaskControls(task, notes, lang, tz, { metaHtml, titleBadgesHtml })}
    </li>`
  }

  const quadrantsHtml = (data: Awaited<ReturnType<typeof loadAll>>, lang: Locale, tz: string, cal: 'gregorian' | 'shamsi', ctxOrder: string): string => {
    const { tasks, tags, names, subtitles, styles, notes } = data
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
      const num = (v: number | string) => (lang === 'fa' ? faDigits(String(v)) : String(v))
      // 2026-09 user request — quadrants are MINIMAL/neutral: no per-quadrant accent class,
      // default --q-accent var, or swatch picker anymore (Phase 7 dropped the accent UI;
      // renameSchema still accepts accent_color). A user-PICKED accent still renders so
      // saved personalization isn't lost; consumers fall back to neutral tokens otherwise.
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
                <label>${t(lang, 'Name', 'نام')}<span class="row"><input name="name" value="${esc(name)}" maxlength="60" required aria-label="${t(lang, 'Quadrant name', 'نام بخش')}"><button type="submit" class="ghost" aria-label="${t(lang, 'Save name', 'ذخیره نام')}">${icon('check')}</button></span></label>
              </form>
              <div class="dash-style-icons" role="grid" aria-label="${t(lang, 'Choose icon', 'انتخاب نماد')}">${iconButtons}</div>
              <a class="q-style-focus" href="/api/sadhana/focus/${q.id}" hx-get="/api/sadhana/focus/${q.id}" hx-target="#sadhana-focus" hx-swap="innerHTML">${icon('target')} ${t(lang, 'Focus', 'تمرکز')}</a>
            </div>
          </div>
          <div class="row sadhana-qmeta">
            <span class="q-counter" data-counter="${q.id}" title="${t(lang, 'Open / total', 'باز / کل')}">${num(openList.length)} / ${num(openList.length + doneList.length)}</span>
          </div>
        </header>
        <ul class="sadhana-list" data-list="${q.id}">
          ${openList.map((task) => taskCardHtml(task, tags.get(task.id) ?? [], notes.get(task.id) ?? [], lang, tz, cal)).join('') || `<li class="sadhana-empty muted">${t(lang, 'Nothing here yet — add your first task.', 'هنوز چیزی نیست — اولین کار را اضافه کن.')}</li>`}
        </ul>
        <span class="sadhana-more" hidden>↓ ${t(lang, 'more', 'بیشتر')}</span>
        ${doneList.length ? `<details class="sadhana-done"><summary>${t(lang, '{n} completed', '{n} انجام شد', { n: lang === 'fa' ? faDigits(String(doneList.length)) : doneList.length })}</summary><ul class="sadhana-donelist">${doneList.map((task) => taskCardHtml(task, tags.get(task.id) ?? [], notes.get(task.id) ?? [], lang, tz, cal)).join('')}</ul></details>` : ''}
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

  const taskOrder = (a: SadhanaTask, b: SadhanaTask): number => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned // pinned first
    if (a.position !== b.position) return a.position - b.position
    return b.created_at.localeCompare(a.created_at) // newest first among same position (spec §8 Q2 resolved)
  }

  const boardZoneHtml = (data: Awaited<ReturnType<typeof loadAll>>, c: BoardCtx): string => {
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
        <div class="chip-row" role="tablist" aria-label="${t(lang, 'Filter', 'فیلتر')}">
          <button type="button" class="chip filter-chip active" data-filter="all">${t(lang, 'All tasks', 'همه کارها')}</button>
          ${chips}
        </div>
        <p class="muted small filter-count" hidden></p>
      </div>
      <div class="sadhana-grid">${quadrantsHtml(data, lang, c.tz, c.cal, c.user.sadhana_quadrant_order)}</div>`)
  }

  // Recurring completion log for the archive (spec §5.15).
  const recurLogHtml = async (ctx: BoardCtx): Promise<string> => {
    const lang = ctx.lang
    const rows = await cfg.db.query<{ task_id: string; title: string; emoji: string; cn: number; dates: string }>(
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

  // ---- routes ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const ctx = ctxOf(c)
    await resetDueRecurring(cfg.db, ctx.user.id, ctx.tz) // spec §7.1: resets run on board load too
    const data = await loadAll(ctx.user.id)
    if (isHx(c)) return await etag(c, c.html(boardZoneHtml(data, ctx)))
    // JSON consumers (the standalone Sadhana board page): everything one paint needs —
    // quadrant meta (names/subtitles/order), tags, and the full task set with journals.
    const lang = ctx.lang
    const tasksByQ: Record<string, unknown[]> = { '1': [], '2': [], '3': [], '4': [] }
    for (const task of data.tasks) {
      tasksByQ[String(task.quadrant)].push({
        id: task.id,
        emoji: task.emoji,
        title: task.title,
        fuzzy: task.fuzzy ?? '',
        date: task.due_date ?? '',
        time: task.due_time ?? '',
        tags: data.tags.get(task.id) ?? [],
        done: task.done === 1,
        pinned: task.pinned === 1,
        pos: task.position,
        progress: task.progress,
        note: task.note ?? '',
        recur: task.recurring === 1,
        recur_type: task.recur_type ?? '',
        recur_config: task.recur_config ?? '',
        updates: (data.notes.get(task.id) ?? []).map((u) => ({ id: u.id, text: u.text, ts: u.created_at })),
      })
    }
    return await etag(c, c.json({
      ok: true,
      today: ctx.today,
      lang,
      cal: ctx.cal,
      tz: ctx.tz,
      names: Object.fromEntries(data.names),
      subtitles: Object.fromEntries(ordered(ctx.user).map((q) => [q.id, data.subtitles.get(q.id) ?? (lang === 'fa' ? q.subtitle.fa : q.subtitle.en)])),
      order: ordered(ctx.user).map((q) => q.id),
      // icon = the quadrant's EFFECTIVE emoji (custom emoji > default); icon_id = the raw
      // custom value (SVG glyph id or emoji, null = default) so rich clients can render glyphs.
      quadrants: ordered(ctx.user).map((q) => {
        const custom = data.styles.get(q.id)?.icon ?? null
        const isEmoji = !!custom && !GLYPH_IDS.has(custom)
        return { id: q.id, icon: isEmoji ? custom : q.icon, name: qName(q.id, data.names, lang) }
      }),
      // Bilingual quadrant meta for the standalone board page (client-side lang switching
      // without a refetch): custom names/subtitles apply to both langs, defaults localize.
      quads: ordered(ctx.user).map((q) => ({
        id: q.id,
        icon: q.icon,
        icon_id: data.styles.get(q.id)?.icon ?? null,
        name_en: qName(q.id, data.names, 'en'),
        name_fa: qName(q.id, data.names, 'fa'),
        sub_en: data.subtitles.get(q.id) ?? q.subtitle.en,
        sub_fa: data.subtitles.get(q.id) ?? q.subtitle.fa,
      })),
      tags: Object.entries(TAGS).map(([id, tg]) => ({ id, icon: tg.icon, text: lang === 'fa' ? tg.fa : tg.en })),
      tasks: tasksByQ,
    }))
  })

  // Inline quadrant rename form (spec §5.19; subtitle added 0025): the card header swaps
  // into an edit row with the heading AND an optional subheading — both save together.
  app.get('/rename/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    if (![1, 2, 3, 4].includes(q)) return c.json({ error: 'invalid_input' }, 400)
    const rows = await cfg.db.query<{ name: string; subtitle: string | null; icon_id: string | null; accent_color: string | null }>('SELECT name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?', [ctx.user.id, q])
    const custom = rows.length ? rows[0].name : ''
    const customSub = rows.length ? rows[0].subtitle ?? '' : ''
    const meta = QUADRANTS.find((x) => x.id === q)!
    return c.html(zone(`<section class="sadhana-rename card" data-quadrant="${q}">
      <h3 class="row"><span class="sadhana-qicon">${icon(meta.glyph)}</span> ${t(ctx.lang, 'Rename this quadrant', 'تغییر نام این بخش')}</h3>
      <form class="column" hx-patch="/api/sadhana/quadrants/${q}" hx-target="closest .sadhana-zone" hx-swap="outerHTML">
        <input name="name" value="${esc(custom)}" maxlength="60" required placeholder="${esc(qName(q, new Map(), ctx.lang))}" aria-label="${t(ctx.lang, 'New name', 'نام جدید')}">
        <input name="subtitle" value="${esc(customSub)}" maxlength="120" placeholder="${t(ctx.lang, 'Subtitle (optional)', 'زیرعنوان (اختیاری)')}" aria-label="${t(ctx.lang, 'Subtitle (optional)', 'زیرعنوان (اختیاری)')}">
        <div class="row">
          <button>${t(ctx.lang, 'Save', 'ذخیره')}</button>
          ${custom ? `<button type="button" class="ghost" hx-patch="/api/sadhana/quadrants/${q}" hx-vals='{"name":null,"subtitle":null}' hx-target="closest .sadhana-zone" hx-swap="outerHTML">${t(ctx.lang, 'Restore default', 'بازنشانی نام')}</button>` : ''}
          <button type="button" class="ghost" hx-get="/api/sadhana" hx-target="closest .sadhana-zone" hx-swap="outerHTML">${t(ctx.lang, 'Cancel', 'انصراف')}</button>
        </div>
      </form>
    </section>`))
  })

  app.post('/quadrants/reorder', async (c) => {
    const ctx = ctxOf(c)
    const body = await jsonBody<z.infer<typeof quadrantOrderSchema>>(c, quadrantOrderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const order = body.ids.join(',')
    await cfg.db.execute('UPDATE users SET sadhana_quadrant_order = ? WHERE id = ?', [order, ctx.user.id])
    ctx.user.sadhana_quadrant_order = order
    const data = await loadAll(ctx.user.id)
    return isHx(c)
      ? c.html(boardZoneHtml(data, ctx))
      : c.json({ ok: true, order: parseQuadrantOrder(order) })
  })

  app.post('/quadrants/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    const body = await jsonBody<z.infer<typeof quickAddSchema>>(c, quickAddSchema)
    if (!body || ![1, 2, 3, 4].includes(q)) return c.json({ error: 'invalid_input' }, 400)
    const id = uuid()
    const now = new Date().toISOString()
    await cfg.db.execute(
      'INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, recur_last, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, ctx.user.id, q, body.title.trim(), body.emoji || '', ctx.today, now, now],
    )
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true, id }, 201)
  })

  app.post('/tasks', async (c) => {
    const ctx = ctxOf(c)
    const body = await jsonBody<z.infer<typeof createTaskSchema>>(c, createTaskSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const id = uuid()
    const now = new Date().toISOString()
    const recurring = body.recurring === true
    await cfg.db.transaction(async (tx) => {
      tx.sql(
        `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, note, fuzzy, due_date, due_time, recurring, recur_type, recur_config, recur_last, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, ctx.user.id, body.quadrant, body.title.trim(), body.emoji || '', body.note,
          body.fuzzy ?? null, body.due_date ?? null, body.due_time ?? null,
          recurring ? 1 : 0, body.recur_type ?? null, body.recur_config ?? '', recurring ? ctx.today : null,
          now, now,
        ],
      )
      for (const tg of body.tags ?? []) tx.sql('INSERT INTO sadhana_tags (task_id, tag) VALUES (?, ?)', [id, tg])
    })
    const data = await loadAll(ctx.user.id)
    if (isHx(c)) {
      // The focus view adds through the same route — keep the overlay in place with a
      // freshly rendered focus zone instead of swapping in the whole board (§5.10).
      if (body.focus === true) return c.html(focusZone(body.quadrant, data, ctx))
      return c.html(boardZoneHtml(data, ctx))
    }
    return c.json({ ok: true, id }, 201)
  })

  app.get('/tasks/:id/edit', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    return c.html(zone(editFormHtml(task, ctx)))
  })

  // The inline task editor — the one place title/note/deadline/recurrence are edited (§5.4).
  function editFormHtml(task: SadhanaTask, ctx: BoardCtx): string {
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
          <button type="submit">${t(lang, 'Save', 'ذخیره')}</button>
          <button type="button" class="ghost" hx-get="/api/sadhana" hx-target="closest .sadhana-zone" hx-swap="outerHTML">${t(lang, 'Cancel', 'انصراف')}</button>
        </div>
      </form>
    </section>`
  }

  app.patch('/tasks/:id', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const body = await jsonBody<z.infer<typeof patchTaskSchema>>(c, patchTaskSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title.trim()) }
    if (body.emoji !== undefined) { sets.push('emoji = ?'); params.push(body.emoji) }
    if (body.note !== undefined) { sets.push('note = ?'); params.push(body.note) }
    if (body.fuzzy !== undefined) { sets.push('fuzzy = ?'); params.push(body.fuzzy) }
    if (body.due_date !== undefined) {
      sets.push('due_date = ?'); params.push(body.due_date)
      if (!body.due_date && body.due_time === undefined) { sets.push('due_time = ?'); params.push(null) }
    }
    if (body.due_time !== undefined) { sets.push('due_time = ?'); params.push(body.due_time) }
    if (body.pinned !== undefined) { sets.push('pinned = ?'); params.push(body.pinned ? 1 : 0) }
    if (body.progress !== undefined) { sets.push('progress = ?'); params.push(body.progress) }
    if (body.recurring !== undefined) {
      const recurring = body.recurring === true
      sets.push('recurring = ?'); params.push(recurring ? 1 : 0)
      if (recurring) {
        sets.push('recur_type = ?'); params.push(body.recur_type ?? 'daily')
        sets.push('recur_config = ?'); params.push(body.recur_config ?? '')
        if (task.recur_last === null) { sets.push('recur_last = ?'); params.push(ctx.today) }
      } else {
        sets.push('recur_type = ?'); params.push(null)
        sets.push('recur_config = ?'); params.push('')
        sets.push('recur_last = ?'); params.push(null)
      }
    } else if (body.recur_type !== undefined) { sets.push('recur_type = ?'); params.push(body.recur_type) }
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(new Date().toISOString())
      await cfg.db.execute(`UPDATE sadhana_tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, task.id, ctx.user.id])
    }
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  const completeTask = async (c: Context<{ Variables: { user: UserRow } }>, id: string, done: number) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, id)
    if (!task) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    if (done === 1) {
      // Immediate archive (user request 2026-08-29): completing a task moves it to the
      // Archive right away — no more waiting for the Monday sweep to see the change.
      // Recurring tasks still loop on the board (spec §8 Q1): completion is logged,
      // the clock restamps, and they reopen on schedule.
      await cfg.db.transaction(async (tx) => {
        if (task.recurring === 1) {
          tx.sql('UPDATE sadhana_tasks SET done = 1, updated_at = ? WHERE id = ? AND user_id = ?', [now, task.id, ctx.user.id])
          tx.sql('INSERT INTO sadhana_recur_history (id, task_id, completed_on, created_at) VALUES (?, ?, ?, ?)', [uuid(), task.id, ctx.today, now])
          tx.sql('UPDATE sadhana_tasks SET recur_last = ? WHERE id = ? AND user_id = ?', [ctx.today, task.id, ctx.user.id])
        } else {
          tx.sql('UPDATE sadhana_tasks SET done = 1, cleared_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [ctx.today, now, task.id, ctx.user.id])
        }
      })
    } else {
      // Un-completing also revives an archived task (the Archive's ↩ button lands here):
      // done=0 AND cleared_at=NULL puts it back on the board.
      await cfg.db.execute('UPDATE sadhana_tasks SET done = 0, cleared_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [now, task.id, ctx.user.id])
    }
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  }
  app.post('/tasks/:id/complete', async (c) => completeTask(c, c.req.param('id'), 1))
  app.post('/tasks/:id/uncomplete', async (c) => completeTask(c, c.req.param('id'), 0))

  app.post('/tasks/:id/move', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const body = await jsonBody<z.infer<typeof moveSchema>>(c, moveSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    await cfg.db.execute('UPDATE sadhana_tasks SET quadrant = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      body.quadrant, new Date().toISOString(), task.id, ctx.user.id,
    ])
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  app.post('/tasks/reorder', async (c) => {
    const ctx = ctxOf(c)
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    // Only the user's own OPEN, non-deleted cards in the stated quadrant get new positions;
    // stray ids are ignored (spec §6.16).
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE user_id = ? AND quadrant = ? AND done = 0 AND deleted_at IS NULL',
      [ctx.user.id, body.quadrant],
    )
    const ownedIds = new Set(rows.map((r) => r.id))
    const now = new Date().toISOString()
    let position = 0
    for (const id of body.ids) {
      if (!ownedIds.has(id)) continue
      await cfg.db.execute('UPDATE sadhana_tasks SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
        position++, now, id, ctx.user.id,
      ])
    }
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  app.delete('/tasks/:id', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE sadhana_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      now, now, task.id, ctx.user.id,
    ])
    return c.json({ ok: true, id: task.id, soft: true })
  })

  // Hard delete (0039): purge the task AND its satellite rows (tags, updates journal,
  // recurrence history) in one transaction — the soft-delete trail stays for the 7-day
  // undo window; this is the explicit "erase it for real" path.
  app.delete('/tasks/:id/hard', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM sadhana_tags WHERE task_id = ?', [task.id])
      tx.sql('DELETE FROM sadhana_updates WHERE task_id = ?', [task.id])
      tx.sql('DELETE FROM sadhana_recur_history WHERE task_id = ?', [task.id])
      tx.sql('DELETE FROM sadhana_tasks WHERE id = ? AND user_id = ?', [task.id, ctx.user.id])
    })
    return c.json({ ok: true, id: task.id })
  })

  app.post('/tasks/:id/restore', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [c.req.param('id'), ctx.user.id],
    )
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('UPDATE sadhana_tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      new Date().toISOString(), rows[0].id, ctx.user.id,
    ])
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // Clear a recurring task's completion log (0039) — resets the {n}× counter; the task
  // itself is untouched. NOTE: the deployed read out.meta?.changes, which is always
  // undefined on this Db abstraction ({changes, lastRowId}) — we report the real count.
  app.delete('/recur-history/:taskId', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      `SELECT st.id FROM sadhana_tasks st WHERE st.id = ? AND st.user_id = ?`,
      [c.req.param('taskId'), ctx.user.id],
    )
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    const out = await cfg.db.execute('DELETE FROM sadhana_recur_history WHERE task_id = ?', [rows[0].id])
    return c.json({ ok: true, id: rows[0].id, removed: Number(out.changes ?? 0) })
  })

  // ---- inline task notes -------------------------------------------------------------
  // Notes reuse the existing updates journal table. `task.note` is retained as a legacy
  // single-note field and is rendered as a deletable note until the user removes it.
  app.get('/tasks/:id/notes', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const data = await loadAll(ctx.user.id)
    return c.json({ notes: data.notes.get(task.id) ?? [] })
  })

  app.post('/tasks/:id/notes', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const body = await jsonBody<z.infer<typeof updateSchema>>(c, updateSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const id = uuid()
    const text = body.text.trim()
    const ts = new Date().toISOString()
    await cfg.db.execute('INSERT INTO sadhana_updates (id, task_id, text, created_at) VALUES (?, ?, ?, ?)', [id, task.id, text, ts])
    // Echo text + ts (2026-09-02): the board page paints the fresh note row from the
    // response — the old {ok,id}-only payload made `u.ts.slice` throw, so a just-added
    // note never rendered until a full page refresh.
    return c.json({ ok: true, id, text, ts }, 201)
  })

  app.delete('/tasks/:id/notes/legacy', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('UPDATE sadhana_tasks SET note = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['', new Date().toISOString(), task.id, ctx.user.id])
    return c.json({ ok: true })
  })

  app.delete('/notes/:id', async (c) => {
    const ctx = ctxOf(c)
    const noteId = c.req.param('id')
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT u.id FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE u.id = ? AND t.user_id = ?',
      [noteId, ctx.user.id],
    )
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute(
      'DELETE FROM sadhana_updates WHERE id = ? AND task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)',
      [noteId, ctx.user.id],
    )
    return c.json({ ok: true })
  })

  // ---- updates journal (legacy route, spec §5.9) -----------------------------------
  app.get('/tasks/:id/updates', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const rows = await cfg.db.query<{ id: string; text: string; created_at: string }>(
      'SELECT id, text, created_at FROM sadhana_updates WHERE task_id = ? ORDER BY created_at',
      [task.id],
    )
    const entries = rows.map((r) => `<li class="row spread"><div class="column"><span class="muted small">${esc(r.created_at.slice(0, 16).replace('T', ' '))}</span>${esc(r.text)}</div><button type="button" class="ghost danger" hx-delete="/api/sadhana/updates/${r.id}" hx-target="closest .sadhana-zone" hx-swap="outerHTML" aria-label="${t(ctx.lang, 'Delete', 'حذف')}">${icon('x')}</button></li>`).join('')
    return c.html(zone(`<section class="card sadhana-updates">
      <h3>${t(ctx.lang, 'Updates — {title}', 'یادداشتها — {title}', { title: esc(task.title) })}</h3>
      <ul class="sadhana-updatelist">${entries || `<li class="muted">${t(ctx.lang, 'No updates yet', 'هنوز یادداشتی نیست')}</li>`}</ul>
      <form class="row" hx-post="/api/sadhana/tasks/${task.id}/updates" hx-target="closest .sadhana-zone" hx-swap="outerHTML">
        <input name="text" maxlength="500" required placeholder="${t(ctx.lang, 'Log an update…', 'ثبت یادداشت…')}" autocomplete="off">
        <button class="qa-btn" aria-label="${t(ctx.lang, 'Add', 'افزودن')}">${icon('plus')}</button>
      </form>
      <button type="button" class="ghost" hx-get="/api/sadhana" hx-target="closest .sadhana-zone" hx-swap="outerHTML">${icon('arrow-right', 'icon arrow')} ${t(ctx.lang, 'Back', 'بازگشت')}</button>
    </section>`))
  })

  app.post('/tasks/:id/updates', async (c) => {
    const ctx = ctxOf(c)
    const task = await ownedTask(ctx.user.id, c.req.param('id'))
    if (!task) return c.json({ error: 'not_found' }, 404)
    const body = await jsonBody<z.infer<typeof updateSchema>>(c, updateSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    await cfg.db.execute('INSERT INTO sadhana_updates (id, task_id, text, created_at) VALUES (?, ?, ?, ?)', [
      uuid(), task.id, body.text.trim(), new Date().toISOString(),
    ])
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  app.delete('/updates/:id', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT u.id FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE u.id = ? AND t.user_id = ?',
      [c.req.param('id'), ctx.user.id],
    )
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM sadhana_updates WHERE id = ?', [rows[0].id])
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // R10: PATCH a single note's text. Reuses the existing `updateSchema` (1..500 chars,
  // trimmed). User-scoped through the same join as DELETE so a forged id from another
  // user's task is a 404. No schema change — only `text` is updated (the table has no
  // updated_at column; created_at is preserved as the note's origin timestamp).
  app.patch('/updates/:id', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT u.id FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE u.id = ? AND t.user_id = ?',
      [c.req.param('id'), ctx.user.id],
    )
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    const body = await jsonBody<z.infer<typeof updateSchema>>(c, updateSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    await cfg.db.execute('UPDATE sadhana_updates SET text = ? WHERE id = ?', [body.text, rows[0].id])
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // ---- quadrant rename (requested change, §5.19) -------------------------------------
  app.patch('/quadrants/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    if (![1, 2, 3, 4].includes(q)) return c.json({ error: 'invalid_input' }, 400)
    const body = await jsonBody<z.infer<typeof renameSchema>>(c, renameSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    if (body.name === null && (body.subtitle === null || body.subtitle === undefined) && body.icon_id === undefined && body.accent_color === undefined) {
      // explicit restore → delete the whole row (built-in heading + subtitle)
      await cfg.db.execute('DELETE FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?', [ctx.user.id, q])
    } else {
      // heading and/or subtitle changed → upsert; preserve whichever field wasn't sent
      const name = body.name !== null && body.name !== undefined ? body.name.trim() : null
      if (name === '' || (name && name.length > 60)) return c.json({ error: 'invalid_name' }, 400) // empty heading rejected (§6.27)
      const current = await cfg.db.query<{ name: string | null; subtitle: string | null; icon_id: string | null; accent_color: string | null }>(
        'SELECT name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?',
        [ctx.user.id, q],
      )
      const prevName = current.length ? current[0].name : null
      const prevSub = current.length ? current[0].subtitle : null
      const nextName = name ?? prevName
      const nextSub = body.subtitle !== undefined ? body.subtitle : prevSub
      const currentStyle = current.length ? current[0] : null
      const nextIcon = body.icon_id ?? currentStyle?.icon_id ?? null
      const nextAccent = body.accent_color ?? currentStyle?.accent_color ?? null
      await cfg.db.execute(
        'INSERT INTO sadhana_quadrant_names (user_id, quadrant, name, subtitle, icon_id, accent_color) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, quadrant) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, icon_id = excluded.icon_id, accent_color = excluded.accent_color',
        [ctx.user.id, q, nextName, nextSub, nextIcon, nextAccent],
      )
    }
    const data = await loadAll(ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // ---- focus (zen) view (§5.10) -------------------------------------------------------
  app.get('/focus/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    if (![1, 2, 3, 4].includes(q)) return c.json({ error: 'invalid_input' }, 400)
    const data = await loadAll(ctx.user.id)
    return c.html(focusZone(q, data, ctx))
  })

  // The deadline component markup — one implementation for the dialog, the edit form and
  // the focus add form. Hidden inputs carry fuzzy/due_date/due_time (htmx submits them;
  // the dialog reads them on save). The popover logic lives in public/sadhana.html.
  const datePickerMarkup = (ctx: BoardCtx, v: { fuzzy: string | null; due_date: string | null; due_time: string | null }): string => {
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
  const focusZone = (q: number, data: Awaited<ReturnType<typeof loadAll>>, ctx: BoardCtx): string => {
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
        ${openList.map((task) => taskCardHtml(task, data.tags.get(task.id) ?? [], data.notes.get(task.id) ?? [], lang, tz, cal)).join('') || `<li class="sadhana-empty muted">${t(lang, 'No tasks yet', 'هنوز کاری نیست')}</li>`}
      </ul>
      ${doneList.length ? `<details class="sadhana-done"><summary>${t(lang, '{n} completed', '{n} انجام شد', { n: lang === 'fa' ? faDigits(String(doneList.length)) : doneList.length })}</summary><ul class="sadhana-donelist">${doneList.map((task) => taskCardHtml(task, data.tags.get(task.id) ?? [], data.notes.get(task.id) ?? [], lang, tz, cal)).join('')}</ul></details>` : ''}
    </section>`)
  }

  // ---- archive (§5.15) ----------------------------------------------------------------
  app.get('/archive', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<SadhanaTask>(
      'SELECT * FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL ORDER BY cleared_at DESC',
      [ctx.user.id],
    )
    const tagRows = await cfg.db.query<{ task_id: string; tag: TagId }>('SELECT * FROM sadhana_tags WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)', [ctx.user.id])
    const tags = new Map<string, TagId[]>()
    for (const r of tagRows) {
      const list = tags.get(r.task_id) ?? []
      list.push(r.tag)
      tags.set(r.task_id, list)
    }
    const total = rows.length
    const byQuadrant = ordered(ctx.user).map((q) => ({ ...q, count: rows.filter((r) => r.quadrant === q.id).length }))
    const nameRows = await cfg.db.query<{ quadrant: number; name: string }>('SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = ?', [ctx.user.id])
    const names = new Map<number, string>(nameRows.map((r) => [r.quadrant, r.name]))
    const groups = ordered(ctx.user).map(
      (q) => `<section class="card"><h3>${esc(qName(q.id, names, ctx.lang))} — ${rows.filter((r) => r.quadrant === q.id).length}</h3>
        <ul class="sadhana-archive-list">${rows
          .filter((r) => r.quadrant === q.id)
          .map(
            (r) => `<li class="sadhana-archive-item">${icon('check', 'icon')} ${esc(r.emoji)} <b>${esc(r.title)}</b> ${deadlineHtml(r, ctx.lang, ctx.tz, ctx.cal)}${tagChips(tags.get(r.id), ctx.lang)}${r.recurring ? ' ' + t(ctx.lang, 'Recurring', 'تکرارشونده') : ''}${r.note ? `<div class="muted small">${esc(r.note.split('\n')[0].slice(0, 80))}</div>` : ''}</li>`,
          )
          .join('') || `<li class="muted">${t(ctx.lang, 'No completed tasks yet', 'هنوز کار انجام‌شده‌ای نیست')}</li>`}</ul></section>`,
    ).join('')
    const log = await recurLogHtml(ctx)
    const html = zone(`<div class="sadhana-head row spread wrap">
        <h1>${t(ctx.lang, 'Archive', 'بایگانی')}</h1>
        <button type="button" class="ghost" data-view-board>← ${t(ctx.lang, 'Board', 'تابلو')}</button>
      </div>
      <div class="archive-stats row wrap">${byQuadrant.map((q) => `<span class="chip">${icon(q.glyph, 'icon')} ${esc(qName(q.id, names, ctx.lang))}: <b>${ctx.lang === 'fa' ? faDigits(String(q.count)) : q.count}</b></span>`).join('')}<span class="chip">${t(ctx.lang, 'Total', 'کل')}: <b>${ctx.lang === 'fa' ? faDigits(String(total)) : total}</b></span></div>
      ${groups}
      ${log}`)
    if (isHx(c)) return c.html(html)
    // JSON branch (standalone board page): archived tasks with tags + recurring history.
    const recurRows = await cfg.db.query<{ task_id: string; title: string; emoji: string; cn: number; dates: string }>(
      `SELECT rh.task_id, st.title, st.emoji, COUNT(rh.id) AS cn, GROUP_CONCAT(rh.completed_on, ',') AS dates
       FROM sadhana_recur_history rh JOIN sadhana_tasks st ON st.id = rh.task_id
       WHERE st.user_id = ? GROUP BY rh.task_id ORDER BY st.title`,
      [ctx.user.id],
    )
    return c.json({
      ok: true,
      total,
      byQuadrant: byQuadrant.map((q) => ({ id: q.id, name: qName(q.id, names, ctx.lang), count: q.count })),
      tasks: rows.map((r) => ({ id: r.id, quadrant: r.quadrant, emoji: r.emoji, title: r.title, tags: tags.get(r.id) ?? [], recurring: r.recurring === 1, note: r.note, cleared_at: r.cleared_at })),
      recurring: recurRows.map((r) => ({ id: r.task_id, emoji: r.emoji, title: r.title, count: r.cn, dates: (r.dates ?? '').split(',').filter(Boolean) })),
    })
  })

  return app
}