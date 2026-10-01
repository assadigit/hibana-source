import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { html, raw, toString, type SafeHtml } from '../lib/htmlx'
import { etag } from '../lib/http'
import { localeOf, trFor } from '../lib/i18n'
import { calendarFor, faDigits, formatDateLong } from '../lib/jalali'
import { QUADRANT_GLYPHS, STATUS_BADGE, STATUS_ICON, icon, quadrantGlyph, statusLabel, timeAgo } from '../lib/html'
import { legacyTaskNote, type SadhanaTaskNote } from '../lib/sadhana-task-controls'
import { QUADRANTS, orderedQuadrants, todayIn, type SadhanaTask } from '../services/sadhana'
import { QUADRANT_ACCENTS } from './sadhana-helpers'
import { PROJECT_STAGES } from '../types'
import type { Config, ProjectRow, ProjectStatus, UserRow } from '../types'
import { dashboardOverviewRowHtml, loadOverviewData } from './projects/helpers'
import { attachedTitles, notebookHtml, type QuickNote } from './quicknotes'

// Phase 0: this route is the proof-of-concept for the typed htmlx builder. Every user value
// (title, tag name, quadrant name) is now auto-escaped; helper HTML (icon/STATUS_BADGE/
// notebookHtml) is wrapped in raw(). The output is byte-identical to the previous template-
// literal version — same classes, same attributes, same structure — but a missed interpolation
// can no longer become an XSS hole.

// Dashboard (spec §5.1): one box per project stage — the full project list per stage,
// draggable between boxes. Phase 5 (2026-09-08): the boxes ride a horizontal stage
// carousel (stat-carousel + chevrons + dots) instead of the old 3-column strip; labels
// come from statusLabel (lib/html) so this page speaks the same stage vocabulary as
// projects/reports. Creation moved to the single FAB (2026-08-25).

// The carousel's stage order (0060 rename): work stages first (planning → queued →
// developing), then the paused/terminal pair (awaiting_dev, operational). 'spark' stays a
// projects-page concept only.
const CAROUSEL: ProjectStatus[] = ['planning', 'queued', 'developing', 'awaiting_dev', 'operational']

export function dashboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    // P5.1 (F-M1): resetDueRecurring moved to the daily cron (index.ts) — was a write on
    // every dashboard GET, making the read path non-idempotent. The cron already runs daily
    // at the 03:17 tick; resetDueRecurring is idempotent (only resets tasks past their
    // due date), so daily is frequent enough.

    const [byStatus, recent, activeProjects, solvedThisWeek, vaultNoteRows, notes, noteTotal, todoTasks, todoNameRows, todoNoteRows, urgentTasks, urgentCount, staleProjects, ovData] = await Promise.all([
      cfg.db.query<{ status: string; n: number }>(
        "SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND (archived_state IS NULL OR archived_state != 'offline') GROUP BY status",
        [user.id],
      ),
      cfg.db.query<ProjectRow>(
        "SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND (archived_state IS NULL OR archived_state != 'offline') ORDER BY updated_at DESC LIMIT 10",
        [user.id],
      ),
      // P5.1 (F-M1): cap the stage-box over-fetch. Was unbounded SELECT * of every project
      // across every stage; now capped to 8 per stage (latest by updated_at). The "View all"
      // link in each stat box already links to projects.html?status=X for the full list.
      cfg.db.query<ProjectRow>(
        `SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND (archived_state IS NULL OR archived_state != 'offline') AND status IN (${PROJECT_STAGES.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 48`,
        [user.id, ...PROJECT_STAGES],
      ),

      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM hurdles WHERE solved_at IS NOT NULL AND solved_at >= ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
        [new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), user.id],
      ),
      // S59: Notes Vault adoption signal for the onboarding banner — active notes only
      // (trashed-only users have seen the vault; a banner for them would be noise).
      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL',
        [user.id],
      ),
      // P5.1 (F-M1): cap the notebook widget to 20 notes (was unbounded SELECT *). The full
      // notebook lives at /whiteboard.html. ORDER BY sort_order DESC matches P1.2 (newest
      // at top); was ASC (inconsistent with the notebook page after P1.2).
      cfg.db.query<QuickNote>(
        'SELECT * FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order DESC, updated_at DESC LIMIT 20',
        [user.id],
      ),
      // S65: the true quick-note count — the widget's "Show all N notes" affordance says
      // how much lives beyond the 20-card cap (the archive dialog browses all of it).
      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL',
        [user.id],
      ),
      cfg.db.query<SadhanaTask>(
        `SELECT * FROM sadhana_tasks
         WHERE user_id = ? AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL
         /* S106 (owner: "this tasks must be sorted, the newest come on top"): the
            dashboard is the TIME view — pinned keeps its app-wide keep-on-top meaning,
            then NEWEST CREATED first. position (the manual drag order) drops out HERE
            ONLY: it remains the board page's own order, and the dashboard's drag
            handlers still PATCH it — the dashboard just no longer DISPLAYS it. */
         ORDER BY pinned DESC, created_at DESC, updated_at DESC`,
        [user.id],
      ),
      cfg.db.query<{ quadrant: number; name: string; subtitle: string | null; icon_id: string | null; accent_color: string | null }>(
        'SELECT quadrant, name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ?',
        [user.id],
      ),
      // S69 (perf §10-C/F2): the note-chip feed was UNBOUNDED — every sadhana_updates
      // row ever written (all journals, forever) fetched on every dashboard load just
      // to derive each task's LATEST note + count (16ms @ 10k rows synthetic, growing
      // linearly with use). One row per task now: the latest update (indexed MAX via
      // the correlated subquery on idx_sadhana_updates) plus COUNT(*) — result size is
      // O(tasks), flat as the journal grows. legacyTaskNote still merges below.
      cfg.db.query<SadhanaTaskNote & { cnt: number }>(
        `SELECT u.id, u.task_id, u.text, u.created_at,
                (SELECT COUNT(*) FROM sadhana_updates u2 WHERE u2.task_id = u.task_id) AS cnt
         FROM sadhana_updates u
         JOIN sadhana_tasks t ON t.id = u.task_id
         WHERE t.user_id = ? AND t.deleted_at IS NULL
           AND u.created_at = (SELECT MAX(u3.created_at) FROM sadhana_updates u3 WHERE u3.task_id = u.task_id)`,
        [user.id],
      ),
      // S30 batch 3 (user request 2026-09-12): "urgent across projects" — the cross-
      // project urgent + high tasks. S124 (owner wireframe): the HTML fire strip is
      // RETIRED (the unified projects container's Problems box took over the alert
      // role) — the query STAYS so the JSON payload's data.urgent / data.urgentTotal
      // contract survives for API consumers (the S30 unit tests pin it).
      cfg.db.query<{ id: string; title: string; priority: string; status: string; project_id: string; project_title: string }>(
        `SELECT t.id, t.title, t.priority, t.status, t.project_id, p.title AS project_title
         FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         WHERE p.user_id = ? AND p.deleted_at IS NULL AND t.status != 'done' AND t.priority IN ('urgent', 'high')
         ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, t.created_at DESC LIMIT 12`,
        [user.id],
      ),
      cfg.db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         WHERE p.user_id = ? AND p.deleted_at IS NULL AND t.status != 'done' AND t.priority IN ('urgent', 'high')`,
        [user.id],
      ),
      // S72: "needs attention" nudge — in-motion projects (NOT awaiting_dev = deliberately
      // paused, NOT operational = done, NOT spark = raw capture) untouched for 14+ days.
      // Serves job #2 ("never lose your place" includes "remember what you left hanging").
      // Renders only when something is actually stale, like the urgent strip; oldest 3.
      cfg.db.query<ProjectRow>(
        `SELECT id, title, status, updated_at FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND (archived_state IS NULL OR archived_state != 'offline')
           AND status IN ('planning','queued','developing')
           AND updated_at < ?
         ORDER BY updated_at ASC LIMIT 3`,
        [user.id, new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()],
      ),
      // S124 (owner wireframe): the dashboard's projects section gets the SAME overview
      // the projects home wears — the open-tasks donut + recent boxes ride the new
      // unified container's lower panel. One shared loader (projects/helpers), one
      // vocabulary: the dashboard and the projects home can never drift apart.
      loadOverviewData(cfg, user.id),
    ])

    // Project titles for the notebook's attach chips (0038 done buttons key off these too).
    const noteTitles = await attachedTitles(cfg.db, user.id, notes)
    // S30 batch 3: the urgent strip's totals (computed once, used by both the JSON
    // payload and the HTML branch).
    const urgentTotal = urgentCount[0]?.n ?? urgentTasks.length
    const counts = { spark: 0, planning: 0, queued: 0, developing: 0, awaiting_dev: 0, operational: 0 }
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
    const data = { counts, recent, recents: activeProjects, solvedThisWeek: solvedThisWeek[0]?.n ?? 0, notes, urgent: urgentTasks, urgentTotal }

    if (c.req.header('HX-Request')) {
      const t = trFor(c)
      const lang = localeOf(c)
      const num = (v: number | string): string => (lang === 'fa' ? faDigits(String(v)) : String(v))

      // P-signals: bug bubble (red rounded-square chip: glyph + count, next to title)
      // + lighter chips (ideas/backlog/hurdles). S126: the bug glyph NAMES the count
      // (the owner's badge-collision note) and aria-label mirrors the tooltip.
      const bugBubbleD = (id: string): SafeHtml => {
        const s = sigMap.get(id)
        if (!s || s.bugs === 0) return html``
        return html`<span class="bug-bubble" title="${t(`${s.bugs} open ${s.bugs === 1 ? 'bug' : 'bugs'}`, `${s.bugs} باگ باز`)}" aria-label="${t(`${s.bugs} open ${s.bugs === 1 ? 'bug' : 'bugs'}`, `${s.bugs} باگ باز`)}">${raw(icon('bug'))}${num(s.bugs)}</span>`
      }
      // S115: the S105 ideas/backlog/hurdles plain-text helpers (sigTextD/backlogMetaD)
      // are RETIRED with the meta line they fed — the card face is the title alone.
      // The signal counts still exist server-side (sigMap feeds the bug bubble).

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
      // project as a draggable kanban card. Phase 5: the card is a compact skc-row (title +
      // bug bubble) — S115 (owner, "still noisy — clean, professional"): the card face is
      // now the TITLE alone. The timeAgo · backlog · signals meta line is RETIRED from the
      // face (a column of projects reading "4m ago · 2 plans · 1 hurdle" on every row was
      // the remaining noise); the freshness rides the hover title beside the drag hint.
      // The S105 quiet-plain-text register, one step further: zero secondary lines.
      // Session 14 (user request): empty boxes carry .is-empty — app.css hides them on
      // phones (≤640px, where each box is a full-width carousel slide = a wasted swipe).
      // Only marked when some stage has projects, so a fresh account keeps its boxes.
      const anyStageHasProjects = (Object.keys(counts) as (keyof typeof counts)[]).some((k) => counts[k] > 0)
      const statBox = (s: ProjectStatus): SafeHtml => {
        const list = recentBox(s)
        const label = statusLabel(s, lang)
        const cards = list.map((p) => {
          return html`<div class="card kanban-card stat-kanban-card" draggable="true" data-project-id="${p.id}" data-status="${p.status}" data-nav-url="/project.html?id=${p.id}" title="${t('Drag to another box to change its status', 'برای تغییر وضعیت به جعبهٔ دیگر بکش')} · ${t('Updated', 'به‌روزرسانی')} ${timeAgo(p.updated_at, lang)}">
            <span class="sr-only">${statusLabel(p.status, lang)}</span>
            <div class="row skc-row">
              <strong class="skc-title" dir="auto">${p.title}</strong>
              ${bugBubbleD(p.id)}
            </div>
          </div>`
        })
        return html`<div class="stat stat-box${anyStageHasProjects && counts[s] === 0 ? ' is-empty' : ''}" data-status="${s}">
          <!-- S85 (owner redesign instruction #2): ONE shared board-column header pattern
               (icon-chip glyph + label + pill count badge) — the same convention the
               To-Do quadrant columns use, so both boards speak one header language
               (Consistency & Standards). The count moved AFTER the label and became a
               tinted pill (.board-count) keyed off the box's data-status role.
               S115: the repeated teal "View all →" arrow on EVERY box was its own noise —
               the link stays (it is the cards-view hop) but demoted to a quiet muted
               affordance; the eye reads icon → label → count again. -->
          <div class="row spread board-col-head">
            <span class="row board-col-title">
              <span class="icon-chip board-col-ico" title="${label}">${raw(icon(STATUS_ICON[s]))}</span>
              <span class="stat-label board-col-label">${label}</span>
              <b class="stat-count board-count" title="${t('{n} projects', '{n} پروژه', { n: num(counts[s]) })}">${num(counts[s])}</b>
            </span>
            <a class="muted small stat-viewall" href="/projects.html?status=${s}&view=cards">${t('View all', 'مشاهده همه')}</a>
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
      // S69: the query already returns ONE row per task (latest + cnt) — the map holds
      // the merged latest/count directly; the legacy task.note still joins the count and
      // wins recency when it is newer than the last journal entry.
      const todoNotesByTask = new Map<string, { text: string; count: number; created_at: string }>()
      for (const note of todoNoteRows) todoNotesByTask.set(note.task_id, { text: note.text, count: note.cnt, created_at: note.created_at })
      for (const task of todoTasks) {
        const legacy = legacyTaskNote(task)
        if (!legacy) continue
        const cur = todoNotesByTask.get(task.id)
        if (!cur) todoNotesByTask.set(task.id, { text: legacy.text, count: 1, created_at: legacy.created_at })
        else {
          cur.count += 1
          if (legacy.created_at >= cur.created_at) { cur.text = legacy.text; cur.created_at = legacy.created_at }
        }
      }
      // Phase 5: the latest task note rides the row as a chip (data-note/count) — the
      // client's note panel opens from it without another fetch.
      const todoLatestNote = (task: SadhanaTask): { text: string; count: number } | null => {
        const note = todoNotesByTask.get(task.id)
        return note ? { text: note.text, count: note.count } : null
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
      const todoTaskHtml = (task: SadhanaTask): SafeHtml => {
        // Task progress-state coloring (2026-09 user request — same palette as the board
        // page): untouched = muted grey · in progress = pastel orange · on hold = pastel
        // yellow. Quadrant boxes themselves stay neutral. The 3-dot prog-track (Phase 5)
        // is the same control as the board page's, one tap per state.
        const stateClass = task.progress === 'in_progress' ? 'st-inprog' : task.progress === 'on_hold' ? 'st-hold' : 'st-untouched'
        const note = todoLatestNote(task)
        const progDots = (['untouched', 'in_progress', 'on_hold'] as const).map((p) => html`<button type="button" class="prog-dot ${PROG_CLS[p]}${task.progress === p ? ' p-active' : ''}" data-prog-state="${p}" title="${t(PROG_LABEL[p].en, PROG_LABEL[p].fa)}" aria-label="${t(PROG_LABEL[p].en, PROG_LABEL[p].fa)}" aria-pressed="${task.progress === p}"></button>`)
        // S82 (owner: "a single click anywhere on the row marks the task finished —
        // miss-clicks lose the task"): this used to be a <label> wrapping checkbox +
        // title, so ANY click inside it toggled completion. It's now a plain div —
        // only the checkbox (its ≥40px ::before hit area) completes the task. The
        // completion id rides on the input itself; app.js's delegated handler keys
        // off [data-task-complete] and only the input can be its own click target.
        // S182 (owner: "same height… the rest gets scroll"): the S106 hidden-row
        // shipping retires — every rendered row ships VISIBLE in the DOM; the
        // quadrant card's fixed 3-row window + the list's overflow-y scroll own the
        // reveal (scroll replaces the frost-pill toggle).
        return html`<li class="dash-todo-task ${task.pinned === 1 ? 'is-pinned' : ''} ${stateClass}" data-dash-task-id="${task.id}" draggable="true">
        <div class="dash-todo-check" data-task-complete-row="${task.id}">
          <input type="checkbox" data-task-complete="${task.id}" ${task.done === 1 ? 'checked' : ''} aria-label="${t('Complete task', 'انجام کار')}">
          <span data-task-title="${task.id}">${task.title}</span>
        </div>
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
        const currentSymbol = iconId === 'none' ? '' : (iconId && !QUADRANT_GLYPHS.has(iconId) ? iconId : q.icon)
        // S69 (perf §10-F2): RENDER CAP. Every open task used to ship as HTML (~4KB a
        // row: inline SVGs + htmx attrs — #dashboard-todo was 491.5KB at 120 open tasks,
        // 115 of them hidden). The widget renders the first 8 per quadrant, and anything
        // beyond the cap becomes a link to the board page (the full surface, with its own
        // more-on-scroll) instead of shipped dead weight. Payload is flat no matter how
        // the board grows.
        // S106 (owner: "Quadrants maximum items in dashboard, must be 4") → S182 (owner:
        // "make them same height… the minimum height must be equivalent of 3 items,
        // whether filled or empty, the rest gets scroll"): of those 8, the FIRST ~3 sit
        // inside the quadrant card's FIXED 3-row window and the rest are reached by the
        // list's own scroll (the frost-pill reveal + the hidden-row shipping retire);
        // beyond the render cap the board link still rides — as the list's LAST row so
        // it scrolls into view exactly where the overflow is met.
        const TODO_RENDER_CAP = 8
        const renderTasks = tasks.slice(0, TODO_RENDER_CAP)
        const overflow = tasks.length - renderTasks.length
        const taskRows = renderTasks.map(todoTaskHtml)
        // S179 (advisor blocks 7+8) → S182 (owner: "whether filled or empty"): the empty
        // quadrant keeps its ONE quiet row ("No tasks yet." + the "Add a task" action
        // inline — app.js's delegated [data-dash-quickadd-fab] handler serves both
        // buttons), but the COLLAPSE retires: the card renders at the SAME fixed height
        // as every sibling, empty window included. The strip markup is EXACTLY what
        // app.js's updateDashTaskEmpty re-creates after htmx sweeps, so server and
        // client can never drift apart.
        if (taskRows.length === 0) {
          taskRows.push(html`<li class="dash-todo-empty"><span class="dash-todo-empty-text">${t('No tasks yet.', 'هنوز کاری نیست.')}</span><button type="button" class="dash-todo-add-text" data-dash-quickadd-fab="${q.id}">${t('Add a task', 'افزودن کار')}</button></li>`)
        }
        // The over-cap board link rides INSIDE the scrollable list as its last row
        // (S182) — reached by the same scroll that reveals rows 4–8, at the exact
        // spot where the render cap is met.
        if (overflow > 0) {
          taskRows.push(html`<li class="dash-todo-more-row"><a class="dash-todo-more dash-todo-more-link" href="/to-do-list#Q${q.id}" title="${t('Open this box on the board', 'این جعبه را در برد باز کن')}">${t('+{n} more on the board', '+{n} مورد دیگر در برد', { n: todoNum(overflow) })} ${raw(icon('arrow-up-right', 'icon'))}</a></li>`)
        }
        // 2026-09 user request — quadrants are MINIMAL/neutral: no per-quadrant accent is
        // applied by default (the old q-success/q-info/q-error/q-warning accent vars are
        // gone). A user-PICKED accent (accent_color, still settable via the rename API)
        // renders so the saved personalization isn't lost.
        const accentAttr = style?.accent ? raw(` style="--dash-q-accent: var(--${style.accent})"`) : ''
        // S182: the .is-quadrant-empty marker RETIRES with the S179 collapse rules —
        // every quadrant card renders at one fixed height, empty or full (the strip
        // above is the empty card's content, not a shorter card shape).
        return html`<article class="dash-todo-quadrant" data-dash-quadrant="${q.id}" data-dash-name="${name}" draggable="true"${accentAttr}>
          <header class="dash-todo-qhead board-col-head">
            <div class="dash-todo-qtitle board-col-title">
              <button type="button" class="dash-todo-style" data-dash-style="${q.id}" aria-label="${t('Customize quadrant', 'شخصی‌سازی بخش')}" title="${t('Customize quadrant', 'شخصی‌سازی بخش')}">${raw(quadrantGlyph(style?.icon ?? null, q.icon))}</button>
              <span class="dash-todo-qcol">
                <strong data-dash-quadrant-name="${q.id}" dir="auto">${name}</strong>
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
                    <div class="dash-style-icons" role="group" aria-label="${t('Choose symbol', 'انتخاب نماد')}"><button type="button" class="dash-style-emoji is-selected dash-icon-open" data-dash-icon-open="${q.id}" data-current="${currentSymbol}" aria-label="${t('Choose symbol — full emoji library', 'انتخاب نماد — کتابخانهٔ کامل ایموجی')}" title="${t('Choose symbol — full emoji library', 'انتخاب نماد — کتابخانهٔ کامل ایموجی')}">${currentSymbol || '—'}</button><button type="button" class="dash-style-emoji dash-style-empty${iconId === 'none' ? ' is-selected' : ''}" data-dash-icon-empty="${q.id}" aria-pressed="${iconId === 'none'}" aria-label="${t('No icon — minimalist', 'بدون نماد — مینیمال')}" title="${t('No icon — minimalist', 'بدون نماد — مینیمال')}">∅</button></div>
                    <!-- S93 (owner round, item 6 — the 16 pastel swatches): immediate PATCH
                         via app.js [data-dash-accent]; 'none' (∅) clears back to neutral.
                         S101 (QA-found, live since S93): the map once shipped UNwrapped —
                         the html tag escapes plain-string interpolations, so the popover
                         rendered a wall of &lt;button&gt; text instead of the 16 swatches
                         (64 escaped tags in /api/dashboard). raw() restores the real
                         buttons; the regression pin lives in dashboard.test.ts. -->
                    <span class="dash-style-lbl">${t('Pastel color', 'رنگ پاستلی')}</span>
                    <div class="dash-style-swatches" role="group" aria-label="${t('Pastel color', 'رنگ پاستلی')}">${raw(QUADRANT_ACCENTS.map((tok) => `<button type="button" class="dash-style-swatch${style?.accent === tok ? ' is-selected' : ''}" data-dash-accent="${tok}" style="--sw: var(--${tok})" aria-label="${tok}" title="${tok}"></button>`).join(''))}<button type="button" class="dash-style-swatch dash-style-swatch-none${!style?.accent ? ' is-selected' : ''}" data-dash-accent="none" aria-label="${t('No color — neutral', 'بدون رنگ — خنثی')}" title="${t('No color — neutral', 'بدون رنگ — خنثی')}">∅</button></div>
                    <div class="dash-style-actions">
                      <button type="button" class="dash-style-cancel" data-dash-style-cancel="${q.id}">${t('Cancel', 'لغو')}</button>
                      <button type="submit" class="dash-style-save-btn">${t('Save', 'ذخیره')}</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
            <!-- S85 (owner redesign instruction #2): the quadrant counter joins the shared
                 board-column header convention — icon + label + PILL COUNT (.board-count),
                 the exact pattern the projects stage columns use. The count keeps its
                 title/aria meaning; app.js's updateDashTaskCounter writes the bare digits
                 into this node after optimistic task changes. Neutral pill by default
                 (2026-09 owner decision: quadrants stay minimal); a user-picked accent
                 tints it via --dash-q-accent.
                 S179 (advisor block 7): the quick-add control MOVES INTO the header's
                 inline-end, beside the count — the corner circle FAB retires (the add
                 control rides where the list's context already sits; same wiring:
                 app.js's delegated [data-dash-quickadd-fab] finds the form via the
                 quadrant ancestor). -->
            <span class="row dash-todo-qactions"><span class="dash-todo-counter board-count" data-dash-quadrant-count="${q.id}" title="${t('Active count', 'تعداد فعال')}">${todoNum(tasks.length)}</span><button type="button" class="dash-todo-fab" data-dash-quickadd-fab="${q.id}" aria-label="${t('Add task', 'افزودن کار')}" title="${t('Add task', 'افزودن کار')}">${raw(icon('plus'))}</button></span>
          </header>
          <ul class="dash-todo-list">
            ${taskRows}
          </ul>
          <!-- 2026-09-06 (k) user request: the quick-add moved OUT of the customize
               popover into its own revealed row (S179: the trigger now lives in the
               card header — this form reveals under the header, Enter adds via the
               sadhana quadrant API + refreshes the dashboard main). -->
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
        // S85 (instruction #3): each Today chip now wears its fixed pastel role —
        // overdue = halted red, pinned = unreviewed blue, solved-this-week = the
        // working-green role (dash-today-done, polish-batch.css) — one palette.
        if (overdue > 0) chips.push(html`<span class="dash-today-chip dash-today-overdue" title="${t('Overdue', 'گذشته')}">${raw(icon('alert'))} ${num2(overdue)} ${t('overdue', 'گذشته')}</span>`)
        if (pinned > 0) chips.push(html`<span class="dash-today-chip dash-today-pinned" title="${t('Pinned', 'سنجاق‌شده')}">${raw(icon('pin'))} ${num2(pinned)}</span>`)
        if (solvedWeek > 0) chips.push(html`<span class="dash-today-chip dash-today-done" title="${t('Solved this week', 'حل‌شده این هفته')}">${raw(icon('check'))} ${num2(solvedWeek)} ${t('this week', 'این هفته')}</span>`)
        return html`<section class="dash-todo-section" id="dashboard-todo">
        <!-- S179 (advisor block 5 — ONE section pattern): every dashboard section head
             is the SAME row — the title (~18px/600) on the reading-start edge, the
             secondary actions ("View all"-style link + the collapse chevron) at the
             INLINE-END. The collapse button moved out of the h2 (it was the first
             glyph inside the title — a third placement pattern); app.js's
             initCollapseButtons wiring keys off [data-dash-collapse] + the section id,
             so the reposition rides the existing recipe untouched. -->
        <header class="dash-todo-head dash-sec-head">
          <h2 class="dash-sec-title">${t('To-Do List', 'لیست کارها')} <time class="dash-todo-date" datetime="${todayIso}">${dateLabel}</time></h2>
          ${chips.length ? html`<div class="dash-today-strip" role="status">${chips}</div>` : ''}
          <span class="dash-sec-actions">
            <a class="small" href="/to-do-list">${t('Go to to-do list', 'رفتن به لیست کارها')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
            <button type="button" class="dash-collapse-btn" data-dash-collapse="dashboard-todo" aria-label="${t('Collapse section', 'جمع کردن بخش')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
          </span>
        </header>
        <!-- Session-12 (2026-09-15, user request): ≤720px the grid is a SWIPE CAROUSEL —
             one full-width quadrant per slide. .dash-quad-wrap anchors the one-time swipe
             hint; the dot row below is built by app.js from the rendered quadrants
             (data-dash-name) and re-built after every htmx refresh of main.shell-dash.
             S182 (owner: "add a background for to-do list section, like the one quick
             note has"): the section body joins the Quick Notebook's card grammar — the
             head stays ABOVE (the one .dash-sec-head pattern, S179 block 5), the quadrant
             board rides INSIDE one .card panel (.dash-todo-panel, the .card.notebook-
             dashboard recipe: surface bg + hairline + --radius). The phone dots stay
             BELOW the panel (they index the carousel, they are not part of its surface). -->
        <div class="dash-todo-panel card">
          <div class="dash-quad-wrap">
            <div class="dash-todo-grid" data-dash-quadrants>
              ${orderedQuadrants(QUADRANTS, user.sadhana_quadrant_order).map(todoCard)}
            </div>
            <div class="dash-swipe-hint" data-dash-swipe-hint aria-hidden="true"><span>${t('Swipe for more sections', 'برای بخش‌های دیگر بکشید')}</span><span aria-hidden="true">${lang === 'fa' ? '‹' : '›'}</span></div>
          </div>
        </div>
        <div class="dash-quad-dots" data-dash-quad-dots role="tablist" aria-label="${t('To-do sections', 'بخش‌های کارها')}"></div>
      </section>`
      }

      // Dashboard section order + visibility (user request 2026-08-26). dash_order is a
      // CSV of section ids; only the ones with dash_show_* = 1 render. Unknown/missing ids
      // are dropped; any shown section not listed is appended so a bad order can't lose it.
      const sections: Record<string, () => SafeHtml> = {
        todo: todoSection,

        projects: (): SafeHtml => html`<section class="dash-projects-section">
          <!-- S179 (advisor block 5): the section head joins the ONE pattern (title +
               go-to link at the inline-end); the OUTER unified container around the
               Projects board RETIRES — the stage boxes and the overview cards sit
               directly in the section, grouped by spacing, not by a border card
               (each .stat-box paints its own card chrome now, dashboard.css). -->
          <div class="row spread dash-projects-head dash-sec-head">
            <h2 class="dash-sec-title">${t('Projects', 'پروژه‌ها')}</h2>
            <a class="small" href="/projects.html">${t('Go to projects', 'رفتن به بخش پروژه‌ها')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
          </div>
          <!-- S72: stale-projects nudge ("needs attention"). In-motion projects untouched
               for 14+ days, oldest first, max 3 — a quiet amber row, hidden when nothing
               is stale (like the urgent strip). Serves job #2: what you left hanging. -->
          ${staleProjects.length ? html`<div class="dash-stale-row" role="status">
            <span class="dash-stale-flag">${raw(icon('clock', 'icon'))} ${t('Untouched for 2+ weeks', 'دو هفته بدون تغییر')}</span>
            <span class="dash-stale-chips">
              ${staleProjects.map((p) => html`<a class="dash-stale-chip" href="/project.html?id=${p.id}" title="${t('Open project', 'باز کردن پروژه')} — ${p.title}">
                <strong class="dash-stale-name" dir="auto">${p.title}</strong>
                <span class="dash-stale-age">${timeAgo(p.updated_at, lang)}</span>
              </a>`)}
            </span>
            <!-- S75: the nudge caps at 3 chips — more than three stale projects had no
                 path to the rest. View all lands on the FULL stale view (S75). -->
            <a class="dash-stale-more small" href="/projects.html?stale=1">${t('View all', 'مشاهده همه')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
          </div>` : html``}
          <!-- S42: overlay handles — absolute inside .stat-stage, translucent; the
               driver's .at-start/.at-end flags fade the handle with nothing left
               to page. (S124's unified wrapper is gone; the carousel is a direct
               child of the section — its own cards group themselves.) -->
          <div class="stat-carousel" data-stat-carousel>
            <div class="stat-stage">
              <div class="stat-strip stat-boxes" data-stat-track role="group" aria-label="${t('Projects by stage', 'پروژه‌ها بر اساس مرحله')}">
              ${CAROUSEL.map(statBox)}
              </div>
              <button type="button" class="stat-arrow" data-stat-prev aria-label="${t('Previous stages', 'مراحل قبلی')}">${raw(icon('chevron-left'))}</button>
              <button type="button" class="stat-arrow" data-stat-next aria-label="${t('Next stages', 'مراحل بعدی')}">${raw(icon('chevron-right'))}</button>
            </div>
            <div class="stat-carousel-nav">
              <div class="stat-dots" data-stat-dots aria-hidden="true"></div>
            </div>
          </div>
          <!-- S179 (advisor blocks 5+12 — the NESTED "Overall project tasks" container
               retires): the overview is now a section-level block with the SAME head
               pattern every section speaks — the title, the TOTAL ("{n} open" — the
               donut's job, moved to text) beside it, the collapse chevron at the
               inline-end — and its four cards (Ideas · Problems · Plans · In Progress,
               ONE fixed order) directly below, separated by spacing (the
               border-top divider is gone). The .dash-ov class + ov-tasks id STAY
               (the shared collapse store + the Settings hide key off them); only the
               nested card chrome left. -->
          <section class="dash-ov ov" id="ov-tasks" aria-labelledby="ov-tasks-h">
            <div class="ov-head dash-sec-head">
              <h2 id="ov-tasks-h" class="dash-sec-title">${t('Overall project tasks', 'کارهای همهٔ پروژه‌ها')} <span class="ov-open-total">${t('{n} open', '{n} باز', { n: num(ovData.counts.idea + ovData.counts.planned + ovData.counts.in_progress + ovData.counts.bug) })}</span></h2>
              <span class="dash-sec-actions">
                <button type="button" class="dash-collapse-btn" data-dash-collapse="ov-tasks" aria-label="${t('Collapse section', 'جمع کردن بخش')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
              </span>
            </div>
            <div class="dash-proj-lower" role="group" aria-label="${t('Overall project tasks', 'کارهای همهٔ پروژه‌ها')}">
              ${raw(dashboardOverviewRowHtml(ovData.counts, ovData.recent, lang))}
            </div>
          </section>
        </section>`,
        notebook: (): SafeHtml => raw(notebookHtml(notes, lang, 'note', noteTitles, true, noteTotal[0]?.n)),
        activity: (): SafeHtml => html`<section class="activity-section">
          <!-- S179 (advisor block 5): the last holdout joins the ONE head pattern —
               the h3 (a second size register) becomes the shared section title, and
               the "View all" link moves from BELOW the list up into the heading row's
               inline-end where every other section keeps its secondary action. -->
          <div class="activity-head dash-sec-head">
            <h2 class="dash-sec-title">${t('Recent activity', 'فعالیت‌های اخیر')}</h2>
            <a class="small" href="/projects.html">${t('View all', 'مشاهده همه')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
          </div>
          <ul class="activity">${activity}</ul>
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

      // S85 (owner redesign instruction #1): the server "Resume work" card is GONE. It
      // and the client "Pick up where you left off" strip used to BOTH surface the same
      // project with two different timestamps (updated_at vs open-time) and no explanation
      // of the difference — a Recognition-Rather-Than-Recall break (Nielsen #6). They are
      // merged into ONE client-rendered "Continue where you left off" component
      // (js/resume.js — hero entry + chips) sourced from ONE shared "last touched"
      // timestamp. The single definition, used everywhere: last touched = last OPENED
      // (the hibana-resume localStorage store; covers projects AND notes, paints before
      // the htmx swap). Nothing server-side duplicates it anymore.

      // S59 first candidate (owner session list): Notes Vault onboarding banner for
      // existing users. The Vault is LIVE for everyone (schema 56 everywhere, S58) but
      // an account with zero notes has no surface pointing at it. Renders ONLY while
      // the user has zero active vault notes; the inline script honors a localStorage
      // dismissal ("seen it, not now"), and the server stops rendering the moment the
      // first note exists. Placed right under the resume card — adoption layer, quiet
      // once used. The dismiss key is namespaced and never expires: a user who said
      // not-now gets the banner again only via a new device/browser profile.
      const vaultCount = vaultNoteRows[0]?.n ?? 0
      const vaultBanner: SafeHtml = vaultCount > 0
        ? html``
        : html`<section class="dash-vault-banner card" data-vault-banner role="region" aria-label="${t('Notes Vault introduction', 'معرفی گاوصندوق یادداشت‌ها')}">
            <!-- S181 (opening block 3 — the nudges speak ONE quiet register): the
                 banner joins the stale-row grammar — a semantic 4px lead bar + a
                 light tint + a small bold flag + the quiet glyph language (the
                 resume chip icons' tinted tile, not a solid CTA badge). The solid
                 teal tile / the 30% accent border / the uppercase link label / the
                 fs-lg title / the .btn CTA all retire: an introduction nudge is the
                 same kind of thing as "Untouched for 2+ weeks", only in the accent
                 register instead of the warn one. -->
            <div class="dash-vault-glyph" aria-hidden="true">${raw(icon('pencil'))}</div>
            <div class="dash-vault-body">
              <span class="dash-vault-label">${t('New', 'تازه')}</span>
              <strong class="dash-vault-title">${t('The Notes Vault', 'گاوصندوق یادداشت‌ها')}</strong>
              <p class="dash-vault-copy">${t('A home for the notes you want to keep — knowledge, reference, curated lists. Folders, tags, star, and full-text search.', 'خانهٔ یادداشت‌هایی که می‌خواهی نگه داری — دانش، مراجع، فهرست‌های منتخب. پوشه‌ها، برچسب‌ها، ستاره و جست‌وجوی کامل متن.')}</p>
              <a class="dash-vault-cta small" href="/notes.html?new=1">${t('Create your first note', 'نخستین یادداشتت را بساز')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
            </div>
            <button type="button" class="dash-vault-dismiss" data-vault-dismiss aria-label="${t('Dismiss', 'بستن')}">${raw(icon('x'))}</button>
            <script>(function(){var K='hibana-vault-banner-dismissed',e=document.querySelector('[data-vault-banner]');if(!e)return;try{if(localStorage.getItem(K)==='1'){e.remove();return}}catch(x){}var b=e.querySelector('[data-vault-dismiss]');if(b)b.addEventListener('click',function(){try{localStorage.setItem(K,'1')}catch(x){}e.remove()})})()</${'script'}>
          </section>`

      // S124 (owner wireframe): the "Urgent across projects" fire strip is RETIRED —
      // the wireframe's unified projects container replaces it with the Problems box
      // (recent bug-status tasks across all projects) inside the lower overview row.
      // The urgentTasks/urgentCount queries STAY: the JSON payload keeps its
      // data.urgent / data.urgentTotal fields for API compatibility (the same contract
      // the S30 unit tests pin). If a priority-based alert layer is ever wanted back,
      // this is a one-render restore — the data is already fetched every load.
      const sectionHtmls = renderOrder.map((id) => sections[id]())
      const out: SafeHtml = sectionHtmls.length
        ? html`${[vaultBanner, ...sectionHtmls]}`
        : html`${vaultBanner}<section class="dash-empty" role="status">
            <!-- S181 (opening block 4 — the zero page joins the empty register): the
                 cold dashboard speaks the SAME quiet strip the empty quadrants speak
                 (S179 block 8) — a muted line + a text action, natural height, no
                 card chrome. The old form was an unstyled div whose bare inline link
                 read as body text. -->
            <p class="dash-empty-text">${t('Nothing on your dashboard — enable a section in Settings → View options.', 'پیشخوان خالی است — یک بخش را در تنظیمات ← گزینه‌های نمایش روشن کن.')}</p>
            <a class="dash-empty-action" href="/settings.html">${t('Open settings', 'باز کردن تنظیمات')} ${raw(icon('arrow-right', 'icon arrow'))}</a>
          </section>`

      // S51-A → S181 (opening block 1 — the page opens with its name): the h1 is
      // VISIBLE now, the same opening every page of the app speaks (Projects,
      // Settings, … all open with their name at the house h1 tokens — the app's home
      // diving straight into sections with an sr-only heading was the one holdout).
      // It still renders as the first node of every htmx response so the swap can
      // never orphan it; the static pre-swap copy in dashboard.html covers the
      // skeleton state.
      const pageH1: SafeHtml = html`<h1>${t('Dashboard', 'پیشخوان')}</h1>`
      return await etag(c, c.html(toString(html`${pageH1}${out}`)))
    }

    return await etag(c, c.json(data))
  })

  // S180 (owner block 7): the resume SEED — the "Continue where you left off"
  // strip's server fallback for a browser whose hibana-resume store is empty (a
  // new device, cleared storage, or a cleared history that never rebuilt — the
  // owner's own report: the section "was removed" because nothing rendered).
  // Returns the 4 most recently EDITED items — projects (sparks included, mapped
  // to k='spark') + vault notes, updated_at DESC — in the exact entry shape the
  // client store records, so resume.js can render the strip display-only. The
  // S105 recording rule stands: this seed is NEVER written to the store — only
  // real interactions record; the seed just answers "where did I stop?" until a
  // real edit lands in THIS browser.
  app.get('/resume-seed', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ k: string; id: string; t: string; b: string | null; ts: string }>(
      `SELECT 'project' AS k, id, title AS t, status AS b, updated_at AS ts FROM projects WHERE user_id = ? AND deleted_at IS NULL AND (archived_state IS NULL OR archived_state != 'offline')
       UNION ALL
       SELECT 'note' AS k, id, title, NULL, updated_at FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY ts DESC LIMIT 4`,
      [user.id, user.id],
    )
    const entries = rows.map((r) => ({
      k: r.k === 'project' && r.b === 'spark' ? 'spark' : r.k,
      id: r.id,
      t: r.t,
      ts: new Date(r.ts).getTime() || 0,
      b: r.k === 'project' ? (r.b ?? undefined) : undefined,
    }))
    // S181 (the owner's promised "where I left off" additions): every PROJECT-kind
    // entry carries its task progress (done vs all dev_tasks of that project) so the
    // strip can answer "how far along was it?" under the hero — the summary line +
    // the progress bar. One grouped query over the (≤4) ids; sparks ride the same
    // table so they report honestly if they ever carry tasks; notes never do.
    const projectIds = entries.filter((e) => e.k === 'project' || e.k === 'spark').map((e) => e.id)
    const progress: Record<string, { done: number; total: number }> = {}
    if (projectIds.length) {
      const progRows = await cfg.db
        .query<{ project_id: string; done: number; total: number }>(
          `SELECT project_id, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, COUNT(*) AS total
           FROM dev_tasks WHERE project_id IN (${projectIds.map(() => '?').join(',')})
           GROUP BY project_id`,
          projectIds,
        )
        .catch(() => [] as { project_id: string; done: number; total: number }[])
      for (const pr of progRows) progress[pr.project_id] = { done: pr.done, total: pr.total }
    }
    return c.json({ entries, progress })
  })

  return app
}