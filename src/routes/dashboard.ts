import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { html, raw, toString, type SafeHtml } from '../lib/htmlx'
import { etag } from '../lib/http'
import { localeOf, trFor } from '../lib/i18n'
import { calendarFor, faDigits, formatDateLong } from '../lib/jalali'
import { QUADRANT_GLYPHS, STATUS_BADGE, STATUS_ICON, icon, quadrantGlyph, statusLabel, timeAgo } from '../lib/html'
import { legacyTaskNote, type SadhanaTaskNote } from '../lib/sadhana-task-controls'
import { QUADRANTS, orderedQuadrants, todayIn, type SadhanaTask } from '../services/sadhana'
import { PROJECT_STAGES } from '../types'
import type { Config, ProjectRow, ProjectStatus, UserRow } from '../types'
import { attachedTitles, notebookHtml, type QuickNote } from './quicknotes'

// Phase 0: this route is the proof-of-concept for the typed htmlx builder. Every user value
// (title, tag name, quadrant name) is now auto-escaped; helper HTML (icon/STATUS_BADGE/
// notebookHtml) is wrapped in raw(). The output is byte-identical to the previous template-
// literal version — same classes, same attributes, same structure — but a missed interpolation
// can no longer become an XSS hole.

// Dashboard (spec §5.1): one box per project stage — the full project list per stage,
// draggable between boxes. Phase 5 (2026-09-08): the boxes ride a horizontal stage
// carousel (stat-carousel + chevrons + dots) instead of the old 3-column strip; labels
// come from statusLabel (lib/html) so this page speaks the same 7-stage vocabulary as
// projects/reports. Creation moved to the single FAB (2026-08-25).

// The carousel's stage order (Phase 5): work stages first (investigating → awaiting →
// doing), then the backlog-ish trio (unreviewed, halted, operational). 'spark' stays a
// projects-page concept only.
const CAROUSEL: ProjectStatus[] = ['investigating', 'awaiting', 'doing', 'unreviewed', 'halted', 'operational']

export function dashboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    // P5.1 (F-M1): resetDueRecurring moved to the daily cron (index.ts) — was a write on
    // every dashboard GET, making the read path non-idempotent. The cron already runs daily
    // at the 03:17 tick; resetDueRecurring is idempotent (only resets tasks past their
    // due date), so daily is frequent enough.

    const [byStatus, recent, activeProjects, solvedThisWeek, notes, todoTasks, todoNameRows, todoNoteRows] = await Promise.all([
      cfg.db.query<{ status: string; n: number }>(
        'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL GROUP BY status',
        [user.id],
      ),
      cfg.db.query<ProjectRow>(
        'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10',
        [user.id],
      ),
      // P5.1 (F-M1): cap the stage-box over-fetch. Was unbounded SELECT * of every project
      // across every stage; now capped to 8 per stage (latest by updated_at). The "View all"
      // link in each stat box already links to projects.html?status=X for the full list.
      cfg.db.query<ProjectRow>(
        `SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status IN (${PROJECT_STAGES.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 48`,
        [user.id, ...PROJECT_STAGES],
      ),

      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM hurdles WHERE solved_at IS NOT NULL AND solved_at >= ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
        [new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), user.id],
      ),
      // P5.1 (F-M1): cap the notebook widget to 20 notes (was unbounded SELECT *). The full
      // notebook lives at /whiteboard.html. ORDER BY sort_order DESC matches P1.2 (newest
      // at top); was ASC (inconsistent with the notebook page after P1.2).
      cfg.db.query<QuickNote>(
        'SELECT * FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order DESC, updated_at DESC LIMIT 20',
        [user.id],
      ),
      cfg.db.query<SadhanaTask>(
        `SELECT * FROM sadhana_tasks
         WHERE user_id = ? AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL
         ORDER BY pinned DESC, position ASC, updated_at DESC, created_at DESC`,
        [user.id],
      ),
      cfg.db.query<{ quadrant: number; name: string; subtitle: string | null; icon_id: string | null; accent_color: string | null }>(
        'SELECT quadrant, name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ?',
        [user.id],
      ),
      cfg.db.query<SadhanaTaskNote>(
        `SELECT u.id, u.task_id, u.text, u.created_at FROM sadhana_updates u
         JOIN sadhana_tasks t ON t.id = u.task_id
         WHERE t.user_id = ? AND t.deleted_at IS NULL
         ORDER BY u.created_at DESC`,
        [user.id],
      ),
    ])

    // Project titles for the notebook's attach chips (0038 done buttons key off these too).
    const noteTitles = await attachedTitles(cfg.db, user.id, notes)
    const counts = { spark: 0, unreviewed: 0, investigating: 0, awaiting: 0, doing: 0, halted: 0, operational: 0 }
    for (const row of byStatus) if (row.status in counts) counts[row.status as keyof typeof counts] = row.n

    // P-signals: batch-load per-project signal counts for the dashboard kanban cards.
    const signalIds = activeProjects.map((p) => p.id)
    const sigDevRows = await cfg.db.query<{ project_id: string; status: string; n: number }>(
      `SELECT project_id, status, COUNT(*) AS n FROM dev_tasks
       WHERE project_id IN (${signalIds.map(() => '?').join(',')}) AND status IN ('bug', 'idea')
       GROUP BY project_id, status`,
      signalIds,
    ).catch(() => [] as { project_id: string; status: string; n: number }[])
    const sigBlRows = await cfg.db.query<{ project_id: string; n: number; latest: string | null }>(
      `SELECT project_id, COUNT(*) AS n, MAX(updated_at) AS latest FROM backlog_docs WHERE project_id IN (${signalIds.map(() => '?').join(',')}) GROUP BY project_id`,
      signalIds,
    ).catch(() => [] as { project_id: string; n: number; latest: string | null }[])
    const sigHRows = await cfg.db.query<{ project_id: string; n: number }>(
      `SELECT project_id, COUNT(*) AS n FROM hurdles WHERE project_id IN (${signalIds.map(() => '?').join(',')}) AND status = 'open' GROUP BY project_id`,
      signalIds,
    ).catch(() => [] as { project_id: string; n: number }[])
    interface DSig { bugs: number; ideas: number; backlog: number; hurdles: number; backlogUpdated: string | null }
    const sigMap = new Map<string, DSig>()
    for (const id of signalIds) sigMap.set(id, { bugs: 0, ideas: 0, backlog: 0, hurdles: 0, backlogUpdated: null })
    // Session-9 extra fix: sigDevRows is GROUP BY (project, status) — ONE row carrying
    // the count in r.n. The old `s.bugs++`/`s.ideas++` incremented by 1 per GROUP, so
    // the dashboard's bug bubble read "1 باگ باز" no matter how many bugs existed
    // (user report: "always stays 1"). Assign r.n like projects.ts loadProjectSignals.
    for (const r of sigDevRows) { const s = sigMap.get(r.project_id); if (s) (r.status === 'bug' ? (s.bugs = r.n) : r.status === 'idea' ? (s.ideas = r.n) : null) }
    for (const r of sigBlRows) { const s = sigMap.get(r.project_id); if (s) { s.backlog = r.n; s.backlogUpdated = r.latest } }
    for (const r of sigHRows) { const s = sigMap.get(r.project_id); if (s) s.hurdles = r.n }

    // Columns list ALL their projects (user request 2026-08-25 — the dashboard is the
    // kanban of projects, not a "3 recent" teaser); drag between columns moves status.
    const byStatusList = new Map<ProjectStatus, ProjectRow[]>()
    for (const p of activeProjects) {
      const list = byStatusList.get(p.status) ?? []
      list.push(p)
      byStatusList.set(p.status, list)
    }
    const recentBox = (s: ProjectStatus): ProjectRow[] => (byStatusList.get(s) ?? []).slice(0, 8) // P5.1 (F-M1): cap to 8 per stage box

    // Keep the JSON field for API compatibility; the dashboard no longer renders the metric.
    const data = { counts, recent, recents: activeProjects, solvedThisWeek: solvedThisWeek[0]?.n ?? 0, notes }

    if (c.req.header('HX-Request')) {
      const t = trFor(c)
      const lang = localeOf(c)
      const num = (v: number | string): string => (lang === 'fa' ? faDigits(String(v)) : String(v))

      // P-signals: bug bubble (solid red, next to title) + lighter chips (ideas/backlog/hurdles).
      const bugBubbleD = (id: string): SafeHtml => {
        const s = sigMap.get(id)
        if (!s || s.bugs === 0) return html``
        return html`<span class="bug-bubble" title="${t(`${s.bugs} open ${s.bugs === 1 ? 'bug' : 'bugs'}`, `${s.bugs} باگ باز`)}">${num(s.bugs)}</span>`
      }
      const sigHtml = (id: string): SafeHtml => {
        const s = sigMap.get(id)
        if (!s || (s.ideas === 0 && s.backlog === 0 && s.hurdles === 0)) return html``
        const chips: SafeHtml[] = []
        if (s.ideas > 0) chips.push(html`<span class="sig-chip sig-ideas" title="${t(`${s.ideas} ${s.ideas === 1 ? 'idea' : 'ideas'}`, `${s.ideas} ایده`)}">${raw(icon('idea', 'icon'))}${num(s.ideas)}</span>`)
        if (s.backlog > 0) chips.push(html`<span class="sig-chip sig-backlog" title="${t('Has upcoming plan', 'برنامه آتی دارد')}">${raw(icon('list-check', 'icon'))}${num(s.backlog)}</span>`)
        if (s.hurdles > 0) chips.push(html`<span class="sig-chip sig-hurdles" title="${t(`${s.hurdles} open ${s.hurdles === 1 ? 'hurdle' : 'hurdles'}`, `${s.hurdles} مانده باز`)}">${raw(icon('alert', 'icon'))}${num(s.hurdles)}</span>`)
        return html`<span class="project-signals">${chips}</span>`
      }
      const backlogMetaD = (id: string): SafeHtml => {
        const s = sigMap.get(id)
        if (!s || !s.backlogUpdated) return html``
        return html`<span class="backlog-meta muted small" title="${s.backlogUpdated}">${t('Backlog', 'برنامه')}: ${timeAgo(s.backlogUpdated, lang)}</span>`
      }

      const activityItemHtml = (p: ProjectRow): SafeHtml => html`<li class="activity-item">
        <span class="activity-main">
          <a href="/project.html?id=${p.id}">${p.title}</a>
          ${raw(STATUS_BADGE(p.status, lang))}
        </span>
        <span class="muted small activity-sub">${p.latest_note ? p.latest_note.slice(0, 60) : ''} · ${timeAgo(p.updated_at, lang)}</span>
      </li>`
      const activityItems = recent.map(activityItemHtml)
      const activity: SafeHtml = activityItems.length ? html`${activityItems}` : html`<li class="muted">${t('Nothing here yet — tap the floating ＋ button to capture your first idea.', 'هنوز چیزی نیست — برای ثبت اولین ایده‌ات، دکمهٔ شناور ＋ را بزن.')}</li>`

      // One box per stage: icon + count + stage label, "view all" (cards view), then every
      // project as a draggable kanban card. Phase 5: the card is a compact skc-row (open
      // arrow + title) with timeAgo only — the tag chip and latest-note preview are gone.
      const statBox = (s: ProjectStatus): SafeHtml => {
        const list = recentBox(s)
        const label = statusLabel(s, lang)
        const cards = list.map((p) => {
          return html`<div class="card kanban-card stat-kanban-card" draggable="true" data-project-id="${p.id}" data-status="${p.status}" data-nav-url="/project.html?id=${p.id}" title="${t('Drag to another box to change its status', 'برای تغییر وضعیت به جعبهٔ دیگر بکش')}">
            <div class="row skc-row">
              <a class="skc-open" href="/project.html?id=${p.id}" aria-label="${t('Open project', 'باز کردن پروژه')} — ${p.title}" title="${t('Open project', 'باز کردن پروژه')}">${raw(icon('arrow-right', 'icon arrow'))}</a>
              <strong class="skc-title">${p.title}</strong>
              ${bugBubbleD(p.id)}
            </div>
            ${sigHtml(p.id) ? html`<div class="skc-signals">${sigHtml(p.id)}</div>` : html``}
            <div class="muted small skc-updated">${timeAgo(p.updated_at, lang)}${backlogMetaD(p.id) ? html` · ${backlogMetaD(p.id)}` : ''}</div>
          </div>`
        })
        return html`<div class="stat stat-box" data-status="${s}">
          <div class="row spread">
            <span class="row"><span class="icon-chip" title="${label}">${raw(icon(STATUS_ICON[s]))}</span> <b class="stat-count" title="${t('{n} projects', '{n} پروژه', { n: num(counts[s]) })}">${num(counts[s])}</b> <span class="stat-label">${label}</span></span>
            <span class="row">
              <a class="small" href="/projects.html?status=${s}&view=cards">${t('View all', 'مشاهده همه')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
            </span>
          </div>
          <div class="stat-kanban">
            ${cards.length ? cards : html`<div class="kanban-empty muted">${t('Nothing here yet', 'هنوز چیزی نیست')}</div>`}
          </div>
        </div>`
      }

      const todoNames = new Map(todoNameRows.map((row) => [row.quadrant, row.name]))
      // Quadrant subheadings (0025 column; 2026-09 user request "edit the subtitle, not
      // just the title"): custom subtitle wins (a stored blank = pinned empty line),
      // otherwise the localized default — same precedence as the board page's q-sub.
      const todoSubs = new Map(todoNameRows.map((row) => [row.quadrant, row.subtitle]))
      const todoStyles = new Map(todoNameRows.map((row) => [row.quadrant, { icon: row.icon_id, accent: row.accent_color }]))
      const todoNum = (value: number): string => (lang === 'fa' ? faDigits(String(value)) : String(value))
      const todoTasksByQuadrant = (quadrant: number): SadhanaTask[] => todoTasks.filter((task) => task.quadrant === quadrant)
      const todoNotesByTask = new Map<string, SadhanaTaskNote[]>()
      for (const note of todoNoteRows) {
        const list = todoNotesByTask.get(note.task_id) ?? []
        list.push(note)
        todoNotesByTask.set(note.task_id, list)
      }
      for (const task of todoTasks) {
        const legacy = legacyTaskNote(task)
        if (legacy) todoNotesByTask.set(task.id, [...(todoNotesByTask.get(task.id) ?? []), legacy])
      }
      // Phase 5: the latest task note rides the row as a chip (data-note/count) — the
      // client's note panel opens from it without another fetch.
      const todoLatestNote = (task: SadhanaTask): { text: string; count: number } | null => {
        const notes = todoNotesByTask.get(task.id) ?? []
        if (!notes.length) return null
        const latest = notes.reduce((a, b) => (a.created_at >= b.created_at ? a : b))
        return { text: latest.text, count: notes.length }
      }
      const PROG_LABEL: Record<'untouched' | 'in_progress' | 'on_hold', { en: string; fa: string }> = {
        untouched: { en: 'Not started', fa: 'شروع نشده' },
        in_progress: { en: 'In progress', fa: 'در حال انجام' },
        on_hold: { en: 'On hold', fa: 'معلق' },
      }
      const PROG_CLS: Record<'untouched' | 'in_progress' | 'on_hold', string> = {
        untouched: 'p-untouched',
        in_progress: 'p-inprog',
        on_hold: 'p-hold',
      }
      const todoTaskHtml = (task: SadhanaTask, index: number): SafeHtml => {
        // Task progress-state coloring (2026-09 user request — same palette as the board
        // page): untouched = muted grey · in progress = pastel orange · on hold = pastel
        // yellow. Quadrant boxes themselves stay neutral. The 3-dot prog-track (Phase 5)
        // is the same control as the board page's, one tap per state.
        const stateClass = task.progress === 'in_progress' ? 'st-inprog' : task.progress === 'on_hold' ? 'st-hold' : 'st-untouched'
        const note = todoLatestNote(task)
        const progDots = (['untouched', 'in_progress', 'on_hold'] as const).map((p) => html`<button type="button" class="prog-dot ${PROG_CLS[p]}${task.progress === p ? ' p-active' : ''}" data-prog-state="${p}" title="${t(PROG_LABEL[p].en, PROG_LABEL[p].fa)}" aria-label="${t(PROG_LABEL[p].en, PROG_LABEL[p].fa)}" aria-pressed="${task.progress === p}"></button>`)
        return html`<li class="dash-todo-task ${task.pinned === 1 ? 'is-pinned' : ''} ${stateClass}" data-dash-task-id="${task.id}" draggable="true" ${index >= 5 ? 'hidden' : ''}>
        <label class="dash-todo-check" data-task-complete="${task.id}">
          <input type="checkbox" ${task.done === 1 ? 'checked' : ''} aria-label="${t('Complete task', 'انجام کار')}">
          <span data-task-title="${task.id}">${task.title}</span>
        </label>
        <div class="prog-track ${stateClass}" data-dash-prog="${task.id}">${progDots}<span class="prog-lbl">${t(PROG_LABEL[task.progress].en, PROG_LABEL[task.progress].fa)}</span></div>
        ${note ? html`<button type="button" class="dash-note-chip" data-dash-note-chip="${task.id}" data-note="${note.text}" data-note-count="${note.count}" aria-label="${t('Task note', 'یادداشت کار')}" title="${t('Task note', 'یادداشت کار')}">${raw(icon('clipboard'))}</button>` : ''}
        <details class="dash-todo-menu">
          <summary aria-label="${t('Task settings', 'تنظیمات کار')}" title="${t('Task settings', 'تنظیمات کار')}">${raw(icon('more-h'))}</summary>
          <div class="dash-todo-menu-pop">
            <button type="button" class="dash-todo-menu-item" data-dash-edit-open="${task.id}">${raw(icon('pencil'))}<span>${t('Edit', 'ویرایش')}</span></button>
            <button type="button" class="dash-todo-menu-item" data-dash-note-panel="${task.id}">${raw(icon('clipboard'))}<span>${t('Notes', 'یادداشت‌ها')}</span></button>
            <button type="button" class="dash-todo-menu-item danger" data-dash-delete="${task.id}">${raw(icon('trash'))}<span>${t('Delete', 'حذف')}</span></button>
          </div>
        </details>
        <form class="dash-todo-edit" data-dash-edit-form="${task.id}" hidden>
          <input type="text" name="title" value="${task.title}" maxlength="255" required aria-label="${t('Task title', 'عنوان کار')}">
          <button type="submit" aria-label="${t('Save task', 'ذخیره کار')}" title="${t('Save task', 'ذخیره کار')}">${raw(icon('check'))}</button>
          <button type="button" data-dash-edit-cancel aria-label="${t('Cancel editing', 'لغو ویرایش')}" title="${t('Cancel editing', 'لغو ویرایش')}">${raw(icon('x'))}</button>
          <span class="dash-todo-edit-error" role="alert" hidden>${t('Title cannot be empty', 'عنوان نمی‌تواند خالی باشد')}</span>
        </form>
      </li>`
      }
      const todoCard = (q: (typeof QUADRANTS)[number]): SafeHtml => {
        const tasks = todoTasksByQuadrant(q.id)
        const customName = todoNames.get(q.id)
        const name = customName ?? (lang === 'fa' ? q.name.fa : q.name.en)
        const subtitle = todoSubs.has(q.id) ? todoSubs.get(q.id) ?? '' : lang === 'fa' ? q.subtitle.fa : q.subtitle.en
        const style = todoStyles.get(q.id)
        const iconId = style?.icon ?? q.glyph
        // The symbol shown in the picker button: the custom value when it's an emoji
        // (outside the SVG glyph set), else the quadrant's default emoji.
        const currentSymbol = iconId && !QUADRANT_GLYPHS.has(iconId) ? iconId : q.icon
        const taskRows = tasks.map(todoTaskHtml)
        // 2026-09 user request — quadrants are MINIMAL/neutral: no per-quadrant accent is
        // applied by default (the old q-success/q-info/q-error/q-warning accent vars are
        // gone). A user-PICKED accent (accent_color, still settable via the rename API)
        // renders so the saved personalization isn't lost.
        const accentAttr = style?.accent ? raw(` style="--dash-q-accent: var(--${style.accent})"`) : ''
        return html`<article class="dash-todo-quadrant" data-dash-quadrant="${q.id}" data-dash-name="${name}" draggable="true"${accentAttr}>
          <header class="dash-todo-qhead">
            <div class="dash-todo-qtitle">
              <button type="button" class="dash-todo-style" data-dash-style="${q.id}" aria-label="${t('Customize quadrant', 'شخصی‌سازی بخش')}" title="${t('Customize quadrant', 'شخصی‌سازی بخش')}">${raw(quadrantGlyph(style?.icon ?? null, q.icon))}</button>
              <span class="dash-todo-qcol">
                <strong data-dash-quadrant-name="${q.id}">${name}</strong>
                ${subtitle ? html`<span class="dash-todo-qsub" data-dash-quadrant-sub="${q.id}">${subtitle}</span>` : ''}
              </span>
              <!-- Pen (user request 2026-09-02): appears on hover over the quadrant name,
                   opens the same customize popover (rename + subtitle + icon) as the icon button. -->
              <button type="button" class="dash-todo-pen" data-dash-style="${q.id}" aria-label="${t('Rename quadrant', 'تغییر نام بخش')}" title="${t('Rename quadrant', 'تغییر نام بخش')}">${raw(icon('pencil'))}</button>
              <!-- Phase 7 item 1 — the popover redesigned per Ali's sketch: نام بخش /
                   زیر عنوان / نماد rows, then ذخیره + لغو as full buttons at the bottom
                   (the old tiny ✓-in-the-input save button is gone). Softer shadow. -->
              <div class="dash-todo-style-pop" data-dash-style-pop="${q.id}" hidden>
                <form class="dash-todo-rename-form" data-dash-rename-form="${q.id}">
                  <label>${t('Section name', 'نام بخش')}<input name="name" value="${name}" maxlength="60" required aria-label="${t('Quadrant name', 'نام بخش')}"></label>
                  <label>${t('Subtitle', 'زیر عنوان')}<input name="subtitle" value="${subtitle}" maxlength="120" aria-label="${t('Quadrant subtitle', 'زیرعنوان بخش')}"></label>
                  <div class="dash-style-emoji-row">
                    <span class="dash-style-lbl">${t('Symbol', 'نماد')}</span>
                    <div class="dash-style-icons" role="group" aria-label="${t('Choose symbol', 'انتخاب نماد')}"><button type="button" class="dash-style-emoji is-selected dash-icon-open" data-dash-icon-open="${q.id}" data-current="${currentSymbol}" aria-label="${t('Choose symbol — full emoji library', 'انتخاب نماد — کتابخانهٔ کامل ایموجی')}" title="${t('Choose symbol — full emoji library', 'انتخاب نماد — کتابخانهٔ کامل ایموجی')}">${currentSymbol}</button></div>
                    <div class="dash-style-actions">
                      <button type="button" class="dash-style-cancel" data-dash-style-cancel="${q.id}">${t('Cancel', 'لغو')}</button>
                      <button type="submit" class="dash-style-save-btn">${t('Save', 'ذخیره')}</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
            <span class="row dash-todo-qactions"><span class="dash-todo-counter" title="${t('Active count', 'تعداد فعال')}">${t('Active {n}', 'تعداد فعال {n}', { n: todoNum(tasks.length) })}</span></span>
          </header>
          <ul class="dash-todo-list">
            ${taskRows}
          </ul>
          ${tasks.length > 5 ? html`<button type="button" class="dash-todo-more" data-dash-see-more="${q.id}">${t('See More', 'مشاهده بیشتر')}</button>` : ''}
          <!-- 2026-09-06 (k) user request: the quick-add moved OUT of the customize
               popover (that button was dead — its form was removed with the old preview
               UI) into a circular + button pinned to the quadrant's bottom corner —
               inline-end: LEFT in RTL, RIGHT in LTR (logical property, flips with the
               language automatically). The revealed row is the input alone; Enter adds
               (submit handler posts to the sadhana quadrant API + refreshes #dash). -->
          <button type="button" class="dash-todo-fab" data-dash-quickadd-fab="${q.id}" aria-label="${t('Add task', 'افزودن کار')}" title="${t('Add task', 'افزودن کار')}">${raw(icon('plus'))}</button>
          <form class="dash-quickadd" data-dash-quickadd-form="${q.id}" hidden>
            <label class="sr-only" for="dash-qa-${q.id}">${t('Add task…', 'افزودن کار…')}</label>
            <input id="dash-qa-${q.id}" name="title" required maxlength="255" autocomplete="off" placeholder="${t('Add task…', 'افزودن کار…')}">
          </form>
        </article>`
      }
      const todoSection = (): SafeHtml => {
        // "Today" chips — derived from the existing todoTasks query (zero DB cost).
        // Overdue = open tasks with a due_date before today (user tz). The on-time ring
        // and the "N active" chip were removed on user request (2026-08-29) — only the
        // actionable outliers render, and the strip disappears entirely when quiet.
        const todayIso = todayIn(user.timezone)
        const dateLabel = formatDateLong(todayIso, calendarFor(lang), lang)
        const today = new Date().toISOString().slice(0, 10)
        const overdue = todoTasks.filter((task) => task.due_date && task.due_date < today).length
        const pinned = todoTasks.filter((task) => task.pinned === 1).length
        const num2 = (v: number): string => (lang === 'fa' ? faDigits(String(v)) : String(v))
        const solvedWeek = solvedThisWeek[0]?.n ?? 0
        const chips: SafeHtml[] = []
        if (overdue > 0) chips.push(html`<span class="dash-today-chip dash-today-overdue" title="${t('Overdue', 'گذشته')}">${raw(icon('alert'))} ${num2(overdue)} ${t('overdue', 'گذشته')}</span>`)
        if (pinned > 0) chips.push(html`<span class="dash-today-chip" title="${t('Pinned', 'سنجاق‌شده')}">${raw(icon('pin'))} ${num2(pinned)}</span>`)
        if (solvedWeek > 0) chips.push(html`<span class="dash-today-chip dash-today-done" title="${t('Solved this week', 'حل‌شده این هفته')}">${raw(icon('check'))} ${num2(solvedWeek)} ${t('this week', 'این هفته')}</span>`)
        return html`<section class="dash-todo-section" id="dashboard-todo">
        <header class="dash-todo-head">
          <h2>${t('To-Do List', 'لیست کارها')} <time class="dash-todo-date" datetime="${todayIso}">${dateLabel}</time></h2>
          ${chips.length ? html`<div class="dash-today-strip" role="status">${chips}</div>` : ''}
          <a class="small" href="/to-do-list">${t('Go to to-do list', 'رفتن به لیست کارها')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
        </header>
        <div class="dash-todo-grid" data-dash-quadrants>
          ${orderedQuadrants(QUADRANTS, user.sadhana_quadrant_order).map(todoCard)}
        </div>
      </section>`
      }

      // Dashboard section order + visibility (user request 2026-08-26). dash_order is a
      // CSV of section ids; only the ones with dash_show_* = 1 render. Unknown/missing ids
      // are dropped; any shown section not listed is appended so a bad order can't lose it.
      const sections: Record<string, () => SafeHtml> = {
        todo: todoSection,

        projects: (): SafeHtml => html`<section class="dash-projects-section">
          <!-- Phase 5 items 1+2 (2026-09-08): the old heading is now plain «پروژه‌ها»
               (the user's wording) and carries the same go-to link pattern as
               «لیست کارها» above — «رفتن به بخش پروژه‌ها» → projects.html. -->
          <div class="row spread dash-projects-head">
            <h2>${t('Projects', 'پروژه‌ها')}</h2>
            <a class="small" href="/projects.html">${t('Go to projects', 'رفتن به بخش پروژه‌ها')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
          </div>
          <div class="stat-carousel" data-stat-carousel>
            <div class="stat-strip stat-boxes" data-stat-track role="group" aria-label="${t('Projects by stage', 'پروژه‌ها بر اساس مرحله')}">
            ${CAROUSEL.map(statBox)}
            </div>
            <div class="stat-carousel-nav">
              <button type="button" class="stat-arrow" data-stat-prev aria-label="${t('Previous stages', 'مراحل قبلی')}">${raw(icon('chevron-left'))}</button>
              <div class="stat-dots" data-stat-dots aria-hidden="true"></div>
              <button type="button" class="stat-arrow" data-stat-next aria-label="${t('Next stages', 'مراحل بعدی')}">${raw(icon('chevron-right'))}</button>
            </div>
          </div>
        </section>`,
        notebook: (): SafeHtml => raw(notebookHtml(notes, lang, 'note', noteTitles, true)),
        activity: (): SafeHtml => html`<section class="activity-section">
          <h3>${t('Recent activity', 'فعالیت‌های اخیر')}</h3>
          <ul class="activity">${activity}</ul>
          <a class="small activity-more" href="/projects.html">${t('View all', 'مشاهده همه')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
        </section>`,
      }
      const ALL = ['todo', 'projects', 'notebook', 'activity']
      const visible = ALL.filter((id) => user[`dash_show_${id}` as keyof UserRow] !== 0)
      const ordered = (user.dash_order ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s, i, arr) => ALL.includes(s) && arr.indexOf(s) === i) // allowlist + dedupe
      const renderOrder = [...ordered.filter((id) => visible.includes(id)), ...visible.filter((id) => !ordered.includes(id))]
      const todoIndex = renderOrder.indexOf('todo')
      const projectsIndex = renderOrder.indexOf('projects')
      if (todoIndex >= 0 && projectsIndex >= 0 && todoIndex > projectsIndex) {
        renderOrder.splice(todoIndex, 1)
        renderOrder.splice(renderOrder.indexOf('projects'), 0, 'todo')
      }
      const sectionHtmls = renderOrder.map((id) => sections[id]())
      const out: SafeHtml = sectionHtmls.length ? html`${sectionHtmls}` : html`<div class="dash-empty">${t('Nothing on your dashboard — enable a section in Settings → View options.', 'پیشخوان خالی است — یک بخش را در تنظیمات ← گزینه‌های نمایش روشن کن.')} <a href="/settings.html">${t('Open settings', 'باز کردن تنظیمات')}</a></div>`

      return await etag(c, c.html(toString(out)))
    }

    return await etag(c, c.json(data))
  })

  return app
}