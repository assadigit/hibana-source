import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, etag, jsonBody } from '../lib/http'
import { html } from '../lib/htmlx'
import {
  getOwnedProject,
  icon,
  progressBar,
  statusLabel,
  STATUS_BADGE,
  STATUS_ICON,
  STATUS_LABEL,
  timeAgo,
  toastHtml,
} from '../lib/html'
import { trFor, localeOf, trL, type Locale } from '../lib/i18n'
import { faDigits, toJalali } from '../lib/jalali'
import { personalProgress, clientProgress } from '../services/progress'
import { uuid } from '../lib/ids'
import {
  createProjectSchema,
  updateProjectSchema,
  reorderSchema,
  listProjectsSchema,
  noteSchema,
  sparkFolderSchema,
} from '../validation/schemas'
import { PROJECT_STAGES, STATUS_ORDER } from '../types'
import type {
  Config,
  ProjectRow,
  ProjectStatus,
  TagRow,
  LinkRow,
  ScreenshotRow,
  HurdleRow,
  UserRow,
  DevTaskRow,
  TaskCategory,
  SprintRow,
  SparkFolderRow,
} from '../types'
import type { QuickNote } from './quicknotes'
import { loadBacklog, type BacklogEvent } from './devboard'
import { shotsGridHtml } from './core'

async function loadTags(cfg: Config, userId: string): Promise<Map<string, TagRow[]>> {
  const rows = await cfg.db.query<TagRow & { project_id: string }>(
    `SELECT t.*, pt.project_id FROM tags t
     JOIN project_tags pt ON pt.tag_id = t.id
     WHERE t.user_id = ? ORDER BY t.name`,
    [userId],
  )
  const map = new Map<string, TagRow[]>()
  for (const r of rows) {
    const { project_id, ...tag } = r
    const list = map.get(project_id)
    if (list) list.push(tag as TagRow)
    else map.set(project_id, [tag as TagRow])
  }
  return map
}

/** Per-project signal counts for the project-row signals strip (user request 2026-09-02).
 *  Batched: one query per signal type across all visible project ids (not N queries).
 *  Signals shown: bugs (open dev_tasks status='bug'), ideas (dev_tasks status='idea'),
 *  backlog (backlog_docs count), hurdles (open hurdles). Zero-count signals are omitted
 *  from the strip (only show what's actionable). */
interface ProjectSignals {
  bugs: number
  ideas: number
  backlog: number
  hurdles: number
  backlogUpdated: string | null
}
async function loadProjectSignals(cfg: Config, userId: string, projectIds: string[]): Promise<Map<string, ProjectSignals>> {
  const map = new Map<string, ProjectSignals>()
  if (projectIds.length === 0) return map
  for (const id of projectIds) map.set(id, { bugs: 0, ideas: 0, backlog: 0, hurdles: 0, backlogUpdated: null })
  const placeholders = projectIds.map(() => '?').join(',')
  // dev_tasks: bugs + ideas in one query (group by status)
  const devRows = await cfg.db.query<{ project_id: string; status: string; n: number }>(
    `SELECT project_id, status, COUNT(*) AS n FROM dev_tasks
     WHERE project_id IN (${placeholders}) AND status IN ('bug', 'idea')
     GROUP BY project_id, status`,
    projectIds,
  )
  for (const r of devRows) {
    const s = map.get(r.project_id)
    if (!s) continue
    if (r.status === 'bug') s.bugs = r.n
    else if (r.status === 'idea') s.ideas = r.n
  }
  // backlog_docs: count + MAX(updated_at) per project (has upcoming plan + when last touched)
  const blRows = await cfg.db.query<{ project_id: string; n: number; latest: string | null }>(
    `SELECT project_id, COUNT(*) AS n, MAX(updated_at) AS latest FROM backlog_docs WHERE project_id IN (${placeholders}) GROUP BY project_id`,
    projectIds,
  )
  for (const r of blRows) {
    const s = map.get(r.project_id)
    if (s) { s.backlog = r.n; s.backlogUpdated = r.latest }
  }
  // hurdles: open (unsolved) count per project
  const hRows = await cfg.db.query<{ project_id: string; n: number }>(
    `SELECT project_id, COUNT(*) AS n FROM hurdles WHERE project_id IN (${placeholders}) AND status = 'open' GROUP BY project_id`,
    projectIds,
  )
  for (const r of hRows) {
    const s = map.get(r.project_id)
    if (s) s.hurdles = r.n
  }
  return map
}

/** The standalone BUG notification bubble — solid red circle with strong visual weight.
 *  Placed right next to the project name so the user gets an instant visual signal that
 *  [x] things are problematic. Only renders when bugs > 0. (User request 2026-09-02.) */
function bugBubbleHtml(signals: ProjectSignals | undefined, lang: Locale): string {
  if (!signals || signals.bugs === 0) return ''
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const title = trL(lang, `${signals.bugs} open ${signals.bugs === 1 ? 'bug' : 'bugs'}`, `${signals.bugs} باگ باز`)
  return `<span class="bug-bubble" title="${title}" aria-label="${title}">${dig(signals.bugs)}</span>`
}

/** Render the signals strip (lighter chips — ideas, backlog, hurdles). Bugs are NOT here;
 *  they get their own solid bubble via bugBubbleHtml. Only non-zero signals render. */
function signalsHtml(signals: ProjectSignals | undefined, lang: Locale): string {
  if (!signals) return ''
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const chips: string[] = []
  if (signals.ideas > 0) chips.push(`<span class="sig-chip sig-ideas" title="${trL(lang, `${signals.ideas} ${signals.ideas === 1 ? 'idea' : 'ideas'}`, `${signals.ideas} ایده`)}">${icon('idea', 'icon')}${dig(signals.ideas)}</span>`)
  if (signals.backlog > 0) chips.push(`<span class="sig-chip sig-backlog" title="${trL(lang, 'Has upcoming plan', 'برنامه آتی دارد')}">${icon('list-check', 'icon')}${dig(signals.backlog)}</span>`)
  if (signals.hurdles > 0) chips.push(`<span class="sig-chip sig-hurdles" title="${trL(lang, `${signals.hurdles} open ${signals.hurdles === 1 ? 'hurdle' : 'hurdles'}`, `${signals.hurdles} مانده باز`)}">${icon('alert', 'icon')}${dig(signals.hurdles)}</span>`)
  return chips.length ? `<span class="project-signals">${chips.join('')}</span>` : ''
}

/** Latest backlog update time — small muted metadata. Shows 'Backlog: 2h ago' or similar. */
function backlogMetaHtml(signals: ProjectSignals | undefined, lang: Locale): string {
  if (!signals || !signals.backlogUpdated) return ''
  const label = trL(lang, 'Backlog', 'برنامه')
  return `<span class="backlog-meta muted small" title="${signals.backlogUpdated}">${label}: ${timeAgo(signals.backlogUpdated, lang)}</span>`
}

async function loadDetail(cfg: Config, p: ProjectRow) {
  const [hurdles, links, screenshots, history, tags, notes, canvasPromos, devTasks, categories, sprints, backlog] = await Promise.all([
    cfg.db.query<HurdleRow>('SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order, created_at', [p.id]),
    cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [p.id]),
    cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE project_id = ? ORDER BY created_at DESC', [p.id]),
    // Batch (p) 2026-09-06: the file-upload «تغییرات» tab is REMOVED (user request) — the
    // changelogs table stays for legacy data/search, but the project page no longer
    // loads or renders it. The برنامه آتی tab's documents + history take its place.
    cfg.db.query<{ id: string; note: string; created_at: string }>(
      'SELECT * FROM project_history_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 20',
      [p.id],
    ),
    cfg.db.query<TagRow>(
      'SELECT t.* FROM tags t JOIN project_tags pt ON pt.tag_id = t.id WHERE pt.project_id = ? ORDER BY t.name',
      [p.id],
    ),
    // Related Quick Notebook notes (user request): every note attached to this project
    // shows here — rule 1 keeps the query scoped to the project (which is user-scoped).
    cfg.db.query<QuickNote>(
      'SELECT * FROM quick_notes WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
      [p.id],
    ),
    // B4.4: Backlinks — canvas elements that promoted this project (existing column).
    cfg.db.query<{ id: string; content: string; board: string }>(
      'SELECT id, content, board FROM canvas_elements WHERE promoted_project_id = ? AND deleted = 0 AND user_id = ?',
      [p.id, p.user_id],
    ),
    // Dev-board pool (0029): tasks + categories + sprints for the inline progress board.
    cfg.db.query<DevTaskRow>('SELECT * FROM dev_tasks WHERE project_id = ? ORDER BY sort_order, created_at', [p.id]),
    cfg.db.query<TaskCategory>('SELECT * FROM task_categories WHERE project_id = ? ORDER BY sort_order, created_at', [p.id]),
    cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? ORDER BY started_at', [p.id]),
    // برنامه آتی tab payload (0033): documents + merged history feed.
    loadBacklog(cfg, p.id),
  ])
  return { hurdles, links, screenshots, history, tags, notes, canvasPromos, devTasks, categories, sprints, backlog }
}

function projectProgress(p: ProjectRow, hurdles: HurdleRow[]): number {
  if (p.progress_percent !== null) return p.progress_percent
  if (p.type === 'client') return clientProgress({ total: 0, done: 0 }) // tasks land in Phase 4
  return personalProgress({
    total: hurdles.length,
    done: hurdles.filter((h) => h.status === 'solved').length,
  })
}

const tagsChips = (tags: TagRow[], lang: Locale): string =>
  // Phase 5 item 17 (2026-09-08): tag color CHOOSING is gone — every tag chip renders the
  // same neutral grey (stored colors stay in the DB untouched, they just don't drive the
  // UI anymore). One consistent system, like conventional label UIs.
  tags.map((t) => `<span class="chip pd-tag-chip">${esc(t.name)}</span>`).join('')

// Wireframe 2026-08-30 («untitled scribbles (1)»): minimal centered card —
//   [Updated 5m ago]           [stage pill]   ← head row (.title-meta keeps the ⋯ menu hook)
//              Title of project               ← centered, largest text
//         Description — smaller font          ← centered, muted, 2-line clamp
//   ▞ hatched neutral corner at the top inline-end corner (Phase 5: no more tag colors).
// The old top accent border / tag chips / progress bar / hurdles line are gone —
// progress still lives in list view, the dashboard kanban, and the project page.
function cardHtml(p: ProjectRow, tags: TagRow[], lang: Locale, signals?: ProjectSignals): string {
  const updated = trL(lang, 'Updated {t}', 'به‌روزرسانی {t}', { t: timeAgo(p.updated_at, lang) })
  const sigs = signalsHtml(signals, lang)
  const bugBubble = bugBubbleHtml(signals, lang)
  const blMeta = backlogMetaHtml(signals, lang)
  // Fix 2026-09-09 (user report, normalize card height): every card now renders the SAME
  // set of fields in the SAME order, regardless of whether a field has data. The
  // description line + the backlog-meta line are always present; an empty value renders
  // an invisible placeholder row (min-block-size: 1lh) so the card's height is consistent
  // across the grid. This fixes the layout symptom (inconsistent heights) by fixing the
  // content model (same fields, always) instead of patching heights individually.
  const descHtml = p.description
    ? `<p class="muted small clip-2 pc-desc">${esc(p.description)}</p>`
    : `<p class="muted small pc-desc pc-desc-empty" aria-hidden="true">&nbsp;</p>`
  const metaHtml = blMeta
    ? `<div class="pc-meta-row">${blMeta}</div>`
    : `<div class="pc-meta-row pc-meta-empty" aria-hidden="true">&nbsp;</div>`
  return `<article class="card project-card pc-wire pc-plain" id="project-${p.id}" draggable="true" data-project-id="${p.id}" data-status="${p.status}">
    <div class="row title-meta spread pc-head">
      <span class="muted small pc-updated">${updated}</span>
      ${STATUS_BADGE(p.status, lang)}
    </div>
    <div class="row spread pc-title-row">
      <span class="pc-title-wrap"><a href="/project.html?id=${p.id}" class="project-title pc-title">${esc(p.title)}</a>${bugBubble}</span>
      ${sigs}
    </div>
    ${descHtml}
    ${metaHtml}
    <i class="pc-corner" aria-hidden="true"></i>
  </article>`
}

function listFragment(projects: ProjectRow[], tagsMap: Map<string, TagRow[]>, view: string, lang: Locale, signalsMap?: Map<string, ProjectSignals>): string {
  if (projects.length === 0) {
    // B2.5: illustrated empty state — icon + headline + helper + CTA.
    return `<div class="empty-state empty">
      <span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/></svg></span>
      <p class="empty-state-title">${trL(lang, 'No projects yet', 'هنوز پروژه‌ای نیست')}</p>
      <p class="empty-state-text">${trL(lang, 'Capture your first idea with the ＋ button above — it stays safe here until you’re ready to build.', 'اولین ایده‌ات را با دکمه ＋ بالا ثبت کن — اینجا امن می‌ماند تا وقتی برای ساختن آماده باشی.')}</p>
      <button type="button" class="empty-state-cta btn" data-quickadd-open>${icon('idea', 'icon')} ${trL(lang, 'New idea', 'ایدهٔ جدید')}</button>
    </div>`
  }
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  if (view === 'list') {
    return `<table class="projects-table"><thead><tr><th>${trL(lang, 'Title', 'عنوان')}</th><th>${trL(lang, 'Status', 'وضعیت')}</th><th>${trL(lang, 'Tags', 'برچسب‌ها')}</th><th>${trL(lang, 'Updated', 'به‌روزرسانی')}</th><th>${trL(lang, 'Signals', 'سیگنال‌ها')}</th></tr></thead>
      <tbody>${projects
        .map((p) => {
          const tags = tagsMap.get(p.id) ?? []
          const sigs = signalsMap?.get(p.id)
          const sigChips = signalsHtml(sigs, lang)
          const bugBubble = bugBubbleHtml(sigs, lang)
          const blMeta = backlogMetaHtml(sigs, lang)
          return `<tr id="project-${p.id}" draggable="true" data-project-id="${p.id}" data-status="${p.status}">
            <td><a href="/project.html?id=${p.id}">${esc(p.title)}</a>${bugBubble}</td>
            <td>${STATUS_BADGE(p.status, lang)}</td>
            <td>${tagsChips(tags, lang)}</td>
            <td class="muted small">${timeAgo(p.updated_at, lang)}${blMeta ? `<br>${blMeta}` : ''}</td>
            <td class="signals-cell">${sigChips || '<span class="muted small">—</span>'}</td>
          </tr>`
        })
        .join('')}</tbody></table>`
  }
  if (view === 'sticky') {
    // Corkboard-style grid of notes — title + one-liner only (spec §5.3).
    return `<div class="sticky-board">${projects
      .map((p) => {
        return `<article class="sticky-note" draggable="true" data-project-id="${p.id}" data-nav-url="/project.html?id=${p.id}">
        <strong>${esc(p.title)}</strong>
        ${p.description ? `<span class="muted small">${esc(p.description.slice(0, 80))}…</span>` : ''}
      </article>`
      })
      .join('') || '<div class="empty">' + trL(lang, 'No projects here yet.', 'هنوز هیچ پروژه‌ای نیست.') + '</div>'}</div>`
  }
  if (view === 'kanban') {
    // Columns = the project stages; drag between columns to change status (AJAX).
    const cols = PROJECT_STAGES
    return `<div class="kanban">${cols.map((s) => {
      const inCol = projects.filter((p) => p.status === s)
      return `<div class="kanban-col" data-status="${s}">
        <h4><span class="badge badge-${s}">${statusLabel(s, lang)}</span> <span class="muted small">${dig(inCol.length)}</span></h4>
        ${inCol.map((p) => {
          const sigObj = signalsMap?.get(p.id)
          const sigs = signalsHtml(sigObj, lang)
          const bugBubble = bugBubbleHtml(sigObj, lang)
          const blMeta = backlogMetaHtml(sigObj, lang)
          return `<div class="card kanban-card" draggable="true" data-project-id="${p.id}" data-status="${s}" data-nav-url="/project.html?id=${p.id}">
          <div class="row spread"><strong>${esc(p.title)}</strong>${bugBubble}</div>
          ${sigs}
          <div class="muted small">${timeAgo(p.updated_at, lang)}${blMeta ? ` · ${blMeta}` : ''}</div>
        </div>`
        }).join('') || `<div class="kanban-empty">${trL(lang, 'Drop here', 'اینجا رها کن')}</div>`}
      </div>`
    }).join('')}</div>`
  }

  return `<div class="card-grid">${projects
    .map((p) => cardHtml(p, tagsMap.get(p.id) ?? [], lang, signalsMap?.get(p.id)))
    .join('')}</div>`
}

// Projects-at-a-glance (Phase 5): one tappable box per stage with its live count. It is
// the grid view's whole content (asMain) and gets prepended above a filtered list so the
// counts stay visible while browsing a stage.
function glanceStrip(counts: Map<string, number>, activeStatus: ProjectStatus | undefined, lang: Locale, asMain = false): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const boxes = PROJECT_STAGES.map((s) => {
    const isActive = activeStatus === s
    return `<a class="pglance-box${isActive ? ' is-active' : ''}" href="/projects.html?status=${s}&view=cards" data-pglance="${s}" title="${esc(statusLabel(s, lang))}">
      <span class="pglance-icon" aria-hidden="true">${icon(STATUS_ICON[s])}</span>
      <span class="pglance-count" title="${esc(trL(lang, '{n} projects', '{n} پروژه', { n: String(counts.get(s) ?? 0) }))}">${dig(counts.get(s) ?? 0)}</span>
      <span class="pglance-label">${statusLabel(s, lang)}</span>
    </a>`
  }).join('')
  return `<div class="pglance${asMain ? ' pglance-grid' : ''}" role="group" aria-label="${trL(lang, 'Projects by type', 'پروژه‌ها بر اساس نوع')}">${boxes}</div>`
}

function sparkEmptyHtml(lang: Locale): string {
  // Fix 2026-09-09 (Phase 6 deviation #6): the CTA now carries the bulb icon (the audit
  // flagged it as text-only). The icon rides inline-start of the label.
  return `<div class="empty-state empty">
    <span class="empty-state-icon" aria-hidden="true">${icon('idea')}</span>
    <p class="empty-state-title">${trL(lang, 'No ideas yet!', 'هنوز ایده ای رو ثبت نکردی!')}</p>
    <p class="empty-state-text">${trL(lang, 'Capture your first idea — it stays safe here until the moment is right to pursue it.', 'اولین ایده‌ات را ثبت کن، اینجا امن می‌ماند تا وقتی برای فرصت کنی به آن بپردازی.')}</p>
    <button type="button" class="empty-state-cta btn" data-quickadd-open>${icon('idea', 'icon')} ${trL(lang, 'Capture a new idea', 'ثبت ایده جدید')}</button>
  </div>`
}

function sparkKanbanHtml(projects: ProjectRow[], folders: (SparkFolderRow & { n: number })[], lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const col = (key: string, label: string, rows: ProjectRow[]) => `<div class="kanban-col" data-spark-folder="${key}">
    <h4><span class="chip">${icon('folder-plus', 'icon')}</span> <span>${esc(label)}</span> <span class="muted small">${dig(rows.length)}</span></h4>
    ${rows.map((p) => `<div class="card kanban-card" draggable="true" data-project-id="${p.id}" data-nav-url="/project.html?id=${p.id}">
      <strong>${esc(p.title)}</strong>
      <div class="muted small">${timeAgo(p.updated_at, lang)}</div>
    </div>`).join('') || `<div class="kanban-empty">${trL(lang, 'Drop here', 'اینجا رها کن')}</div>`}
  </div>`
  const byFolder = (fid: string | null) => projects.filter((p) => (p.folder_id ?? null) === fid)
  return `<div class="kanban">${folders.map((f) => col(f.id, f.name, byFolder(f.id))).join('')}${col('', trL(lang, 'No folder', 'بدون پوشه'), byFolder(null))}</div>`
}

function sparkFolderBar(folders: (SparkFolderRow & { n: number })[], unfiled: number, activeFolder: string | undefined, lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const chip = (key: string, label: string, count: number) => `<button type="button" class="sf-chip${activeFolder === key ? ' is-active' : ''}" data-sf="${key}"><span class="sf-label">${esc(label)}</span> <span class="sf-n">${dig(count)}</span></button>`
  const parts = [chip('', trL(lang, 'All', 'همه'), unfiled + folders.reduce((a, f) => a + f.n, 0))]
  for (const f of folders) {
    parts.push(
      `<span class="sf-item"><button type="button" class="sf-chip${activeFolder === f.id ? ' is-active' : ''}" data-sf="${f.id}" title="${esc(f.name)}"><span class="sf-label">${esc(f.name)}</span> <span class="sf-n">${dig(f.n)}</span></button><button type="button" class="sf-more" data-sf-menu="${f.id}" aria-label="${trL(lang, 'Folder actions', 'کارهای پوشه')}" title="${trL(lang, 'Folder actions', 'کارهای پوشه')}">${icon('more-h')}</button></span>`,
    )
  }
  if (folders.length > 0) parts.push(chip('none', trL(lang, 'No folder', 'بدون پوشه'), unfiled))
  parts.push(
    `<button type="button" class="sf-chip sf-new" data-sf-new title="${trL(lang, 'New folder', 'پوشه جدید')}" aria-label="${trL(lang, 'New folder', 'پوشه جدید')}">${icon('plus')}</button>`,
  )
  return `<div class="sf-bar" data-sf-bar role="group" aria-label="${trL(lang, 'Folders', 'پوشه‌ها')}">${parts.join('')}</div>`
}

function detailHtml(p: ProjectRow, d: Awaited<ReturnType<typeof loadDetail>>, lang: Locale): string {
  // Dev tasks drive progress once they exist (user model 2026-08-29); before that the
  // old hurdle/percent formulas keep the number meaningful.
  const doneTasks = d.devTasks.filter((t) => t.status === 'done').length
  const pct = d.devTasks.length
    ? Math.round((doneTasks / d.devTasks.length) * 100)
    : projectProgress(p, d.hurdles)
  const links =
    d.links
      .map(
        (l) => `<li class="row spread">
        <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>
        <button class="ghost danger" hx-delete="/api/links/${l.id}" hx-target="#links" hx-swap="innerHTML" aria-label="${trL(lang, 'Delete link', 'حذف پیوند')}">${icon('x')}</button>
      </li>`,
      )
      .join('') || '<li class="muted">' + trL(lang, 'No links yet.', 'هنوز پیوندی نیست.') + '</li>'

  const shots = shotsGridHtml(d.screenshots, lang)

  const history =
    d.history
      .map((h) => `<li><span class="muted small">${timeAgo(h.created_at, lang)}</span> — ${esc(h.note)}</li>`)
      .join('') || '<li class="muted">' + trL(lang, 'Nothing logged yet.', 'هنوز چیزی ثبت نشده.') + '</li>'

  // Related Quick Notebook notes (user request): notes attached from the dashboard show
  // here as tappable rows — they live in the notebook, this page is where they belong.
  const relatedNoteLabel = (n: QuickNote): string => {
    if (n.kind === 'list') return n.title || trL(lang, 'List', 'فهرست')
    const flat = n.content.replace(/\s+/g, ' ').trim()
    return flat.length > 80 ? flat.slice(0, 77) + '…' : flat
  }
  const relatedNotes =
    d.notes
      .map(
        (n) => `<li class="row spread${n.done === 1 ? ' related-note-done' : ''}">
        <a class="related-note" href="/dashboard.html">${icon(n.kind === 'list' ? 'check' : 'link', 'icon')}${esc(relatedNoteLabel(n))}</a>
        ${n.done === 1 ? `<span class="small muted related-note-check">${icon('check')}</span>` : `<span class="muted small">${timeAgo(n.updated_at, lang)}</span>`}
      </li>`,
      )
      .join('') || '<li class="muted">' + trL(lang, 'No related notes yet — attach one from the Quick Notebook.', 'هنوز یادداشت مرتبطی نیست — از یادداشت سریع وصلش کن.') + '</li>'

  // Problems tab (Phase 5): the board's «مشکلات» box mirrored here — bug dev-tasks, not
  // the old hurdles table. 'bug' is a dev-task status (devboard's taskStatusSchema); the
  // row union in types.ts is the board's four, so the comparison widens it locally.
  const bugTasks = d.devTasks.filter((t) => (t.status as DevTaskRow['status'] | 'bug') === 'bug')
  const problemsList =
    bugTasks
      .map(
        (t) => `<li class="hurdle" data-problem="${t.id}">
        <button type="button" class="ghost toggle" data-problem-solve="${t.id}" aria-label="${trL(lang, 'Mark solved', 'حل‌شده علامت بزن')}" title="${trL(lang, 'Solved — moves to Done', 'حل شد — می‌رود به انجام‌شده')}">${icon('check')}</button>
        <span class="hurdle-text">${esc(t.title)}</span>
        <button type="button" class="ghost hurdle-edit" data-problem-edit="${t.id}" aria-label="${trL(lang, 'Edit problem', 'ویرایش مشکل')}" title="${trL(lang, 'Edit problem', 'ویرایش مشکل')}">${icon('pencil')}</button>
        <button type="button" class="ghost danger" data-problem-del="${t.id}" aria-label="${trL(lang, 'Delete problem', 'حذف مشکل')}">${icon('x')}</button>
      </li>`,
      )
      .join('') || '<li class="muted">' + trL(lang, 'No open problems — add the first one below.', 'هیچ مشکل بازی نیست — اولین مورد را از پایین اضافه کن.') + '</li>'
  const blEventLabel = (ev: BacklogEvent): string =>
    ev.kind === 'doc_created'
      ? trL(lang, 'Document “{t}” created', 'سند «{t}» ایجاد شد', { t: ev.label })
      : ev.kind === 'doc_updated'
        ? trL(lang, 'Document “{t}” updated', 'سند «{t}» به‌روزرسانی شد', { t: ev.label })
        : trL(lang, 'New item: {t}', 'قلم جدید: {t}', { t: ev.label })
  const blDocs =
    d.backlog.docs
      .map(
        (doc) => `<article class="bl-doc" data-bl-doc="${doc.id}">
        <div class="row spread bl-doc-head">
          <strong class="bl-doc-title">${esc(doc.title)}</strong>
          <span class="muted small">${trL(lang, 'updated', 'ویرایش‌شده')} ${timeAgo(doc.updated_at, lang)}</span>
        </div>
        <div class="bl-doc-body">${esc(doc.content)}</div>
        <div class="row bl-doc-actions">
          <button type="button" class="ghost small" data-bl-edit="${doc.id}">${icon('pencil')} ${trL(lang, 'Edit', 'ویرایش')}</button>
          <button type="button" class="ghost danger small" data-bl-del="${doc.id}">${icon('trash')} ${trL(lang, 'Delete', 'حذف')}</button>
        </div>
      </article>`,
      )
      .join('') || `<p class="muted bl-docs-empty">${trL(lang, 'No plan documents yet — write the first full plan here.', 'هنوز سندی نیست — اولین برنامهٔ کامل را همین‌جا بنویس.')}</p>`
  const blHistory =
    d.backlog.history
      .map((ev) => `<li><span class="muted small">${timeAgo(ev.at, lang)}</span> — ${esc(blEventLabel(ev))}</li>`)
      .join('') || '<li class="muted">' + trL(lang, 'No backlog changes yet.', 'هنوز تغییری در برنامه آتی ثبت نشده.') + '</li>'
  const plannedCount = d.devTasks.filter((t) => t.status === 'planned').length
  const COLS: { key: DevTaskRow['status'] | 'bug'; en: string; fa: string }[] = [
    { key: 'idea', en: 'New Ideas', fa: 'ایده‌های جدید' },
    { key: 'bug', en: 'Problems', fa: 'مشکلات' },
    { key: 'planned', en: 'Upcoming Plan', fa: 'برنامه آتی' },
    { key: 'in_progress', en: 'In Progress', fa: 'در حال انجام' },
    { key: 'done', en: 'Done', fa: 'انجام‌شده' },
  ]
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))

  // Task meta line (user request 2026-09-03): date + CLOCK — Jalali + FA digits when fa,
  // Gregorian + 12h clock when en; UTC edge like the board page (rule 3). Done tasks
  // freeze on their done_at with a ✓, everything else shows created_at.
  const PD_J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
  const PD_G_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const taskMetaLabel = (t: DevTaskRow): string => {
    const done = t.status === 'done' && t.done_at
    const dt = new Date(done || t.created_at)
    const hh = dt.getUTCHours()
    const mm = String(dt.getUTCMinutes()).padStart(2, '0')
    if (lang === 'fa') {
      const j = toJalali(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
      return `${done ? '✓ ' : ''}${faDigits(String(j.jd))} ${PD_J_MONTHS[j.jm - 1]} ${faDigits(String(j.jy))} · ${faDigits(String(hh).padStart(2, '0'))}:${faDigits(mm)}`
    }
    const h12 = hh % 12 || 12
    return `${done ? '✓ ' : ''}${dt.getUTCDate()} ${PD_G_MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()} · ${h12}:${mm} ${hh < 12 ? 'AM' : 'PM'}`
  }
  // Inline "Project Progress" board preview (user sketch 2026-08-29): the five columns
  // with their top cards — adding happens RIGHT HERE through the per-column inline
  // composer (user request 2026-08-29: "add tasks directly in project's page into boxes");
  // the full drag & drop board stays one click away.
  const boardPreview = `
  <section class="card pd-board" id="pd-board" data-total="${d.devTasks.length}" data-done="${doneTasks}">
    <div class="row spread pd-board-head">
      <h3>${icon('kanban')} ${trL(lang, 'Project Progress', 'پیشرفت پروژه')}</h3>
      <div class="row">
        <a class="btn ghost small" href="/board.html?project=${p.id}">${icon('expand')} ${trL(lang, 'Full screen board', 'برد تمام‌صفحه')}</a>
        <a class="btn ghost small" href="/sprint.html?project=${p.id}">${icon('diamond')} ${trL(lang, 'Sprints', 'اسپرینت‌ها')}${d.sprints.length ? ` <span class="pd-sprint-count">${dig(d.sprints.length)}</span>` : ''}</a>
      </div>
    </div>
    ${d.devTasks.length === 0
      ? `<div class="pd-board-empty" data-pd-empty>
          <p class="muted">${trL(lang, 'Serious development tasks live here — from first idea to launched.', 'کارهای جدیِ توسعه اینجا زندگی می‌کنند — از اولین ایده تا عرضه.')}</p>
        </div>`
      : ''}
    <div class="pd-board-grid">${COLS.map((col) => {
          const items = d.devTasks.filter((t) => t.status === col.key)
          const top = items.slice(0, 3)
          return `<div class="pd-col" data-status="${col.key}">
            <div class="pd-col-head"><span class="pd-col-title">${trL(lang, col.en, col.fa)}</span><span class="detail-tab-count" data-pd-count="${col.key}" data-n="${items.length}">${dig(items.length)}</span>
              <span class="pd-col-actions">
                <button type="button" class="ghost small" data-pd-copy="${col.key}" title="${trL(lang, 'Copy items as bullet points', 'کپی موارد به صورت بولت')}" aria-label="${trL(lang, 'Quick copy', 'کپی سریع')}">${icon('clipboard')}</button>
                <button type="button" class="ghost small" data-pd-export="${col.key}" title="${trL(lang, 'Export as Markdown', 'خروجی مارک‌داون')}" aria-label="${trL(lang, 'Export Markdown', 'خروجی مارک‌داون')}">${icon('download')}</button>
              </span>
            </div>
            <div class="pd-tasks" data-pd-tasks="${col.key}">
              ${top.map((t) => `<a class="pd-task st-${t.status}" href="/board.html?project=${p.id}&task=${t.id}" draggable="true" data-pd-task="${t.id}" data-pd-status="${t.status}" data-pd-created="${t.created_at}"${t.done_at ? ` data-pd-done="${t.done_at}"` : ''}>
                <span class="prio-dot prio-${t.priority}" title="${t.priority}"></span>
                <span class="pd-task-body">
                  <span class="pd-task-title">${esc(t.title)}</span>
                  <span class="pd-task-meta">${taskMetaLabel(t)}</span>
                </span>
              </a>`).join('')}
              ${items.length > 3 ? `<a class="pd-more muted small" data-pd-more="${col.key}" href="/board.html?project=${p.id}">+${dig(items.length - 3)} ${trL(lang, 'more', 'بیشتر')}</a>` : ''}
            </div>
            <form class="pd-quick-add" data-pd-addform="${col.key}" hidden>
              <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="" aria-label="${trL(lang, 'Task title — press Enter to add', 'عنوان کار — Enter را بزن تا افزوده شود')}">
            </form>
            <button type="button" class="pd-task-add" data-pd-add="${col.key}">${icon('plus')} ${trL(lang, 'Add', 'افزودن')}</button>
          </div>`
        }).join('')}</div>
  </section>`

  const tagChips = d.tags
    .map((tg) => `<span class="chip pd-tag-chip" data-tag-chip="${tg.id}">${esc(tg.name)} <button type="button" class="ghost danger pd-tag-x" data-tag-remove="${tg.id}" aria-label="${trL(lang, 'Remove tag', 'حذف برچسب')}">${icon('x')}</button></span>`)
    .join('')

  return `
  <header class="card pd-head">
    <div class="row spread">
      <div class="row"><span id="pd-stage-badge">${STATUS_BADGE(p.status, lang)}</span>
        <label class="sr-only" for="pd-stage">${trL(lang, 'Stage', 'مرحله')}</label>
        <!-- Batch (q) 2026-09-07: the old hx-patch + js hx-vals NEVER worked — htmx 2.x
             evaluates js: hx-vals in GLOBAL scope, so "this" was the window and the PATCH
             shipped status=undefined → zod 400 → the stage silently never changed (the
             reported bug). It is a plain select now; project.html's delegated change
             handler PATCHes the value and swaps #pd-stage-badge in place, and the ذخیره
             button persists the current value before navigating back. -->
        <select id="pd-stage" class="pd-stage-select" data-project-id="${p.id}" title="${trL(lang, 'Stage — saved on change', 'مرحله — با تغییر ذخیره می‌شود')}">
          ${STATUS_ORDER.map((k) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${statusLabel(k, lang)}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <a class="btn small" id="pd-stage-save" href="/projects.html" data-project-id="${p.id}">${icon('check')} ${trL(lang, 'Save', 'ذخیره')}</a>
        <button class="btn danger small" hx-delete="/api/projects/${p.id}" hx-confirm="${trL(lang, 'Delete this project?', 'این پروژه حذف شود؟')}" hx-target="#project-body" hx-swap="innerHTML">${icon('trash')} ${trL(lang, 'Delete', 'حذف')}</button>
      </div>
    </div>
    <h1 id="pd-title" title="${trL(lang, 'Click to edit', 'برای ویرایش کلیک کن')}">${esc(p.title)}<button type="button" class="pd-title-pen" data-edit-title aria-label="${trL(lang, 'Edit title', 'ویرایش عنوان')}">${icon('pencil')}</button></h1>
    <textarea id="pd-desc" rows="2" maxlength="2000" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'Short description here…', 'توضیح کوتاه اینجا…')}">${esc(p.description)}</textarea>
    <div class="muted small" id="pd-desc-status" aria-live="polite"></div>
    <div class="row pd-tags" id="pd-tags">
      <span class="pd-tags-title muted small">${trL(lang, 'Project labels', 'لیبل‌های پروژه')}</span>
      ${tagChips}
      <button type="button" class="chip pd-tag-add" data-tag-add>${icon('plus')} ${trL(lang, 'tag', 'برچسب')}</button>
      <form class="pd-tag-pop" data-tag-pop hidden>
        <input name="name" maxlength="60" dir="auto" placeholder="${trL(lang, 'Tag name (UI/UX…)', 'نام برچسب (UI/UX…)')}" required>
        <div class="row">
          <button type="submit" class="btn small">${trL(lang, 'Add', 'افزودن')}</button>
          <button type="button" class="ghost small" data-tag-cancel>${trL(lang, 'Cancel', 'لغو')}</button>
        </div>
      </form>
    </div>
    <div class="row spread small muted pd-meta">
      <span data-pd-meta>${trL(lang, p.type, p.type === 'client' ? 'مشتری' : 'شخصی')} · ${trL(lang, 'created {x}', 'ساخت {x}', { x: timeAgo(p.created_at, lang) })}<span data-pd-tasks-line ${d.devTasks.length ? '' : 'hidden'}> · ${trL(lang, '{n} of {m} tasks done', '{n} از {m} کار انجام شد', { n: dig(doneTasks), m: dig(d.devTasks.length) })}</span></span>
      <span class="row">${progressBar(pct).replace('<span ', '<span data-pd-bar ')} <b data-pd-pct>${dig(pct)}%</b></span>
    </div>
  </header>

  ${boardPreview}

  <!-- Batch (p) 2026-09-06: tab priority reordered by the user — یادداشت‌ها › مشکل‌ها ›
       برنامه آتی › پیوندها › اسکرین‌شات › آخرین تغییرات. The «تغییرات» (changelog file
       upload) tab is GONE; the new برنامه آتی tab takes its slot. -->
  <div class="detail-tabs" role="tablist" aria-label="${trL(lang, 'Project sections', 'بخش‌های پروژه')}">
    <button type="button" class="detail-tab is-active" role="tab" aria-selected="true" aria-controls="detail-notes" data-detail-tab="notes" tabindex="0">${trL(lang, 'Notes', 'یادداشت‌ها')}</button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-problems" data-detail-tab="problems" tabindex="-1">${trL(lang, 'Problems', 'مشکل‌ها')} <span class="detail-tab-count" data-tab-count="problems" data-n="${bugTasks.length}">${dig(bugTasks.length)}</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-backlog" data-detail-tab="backlog" tabindex="-1">${trL(lang, 'Upcoming Plan', 'برنامه آتی')} <span class="detail-tab-count" data-tab-count="backlog" data-n="${plannedCount}">${dig(plannedCount)}</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-links" data-detail-tab="links" tabindex="-1">${trL(lang, 'Links', 'پیوندها')} <span class="detail-tab-count">${dig(d.links.length)}</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-media" data-detail-tab="media" tabindex="-1">${trL(lang, 'Screenshots', 'اسکرین‌شات')} <span class="detail-tab-count">${dig(d.screenshots.length)}</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-activity" data-detail-tab="activity" tabindex="-1">${trL(lang, 'Latest Activity', 'آخرین تغییرات')}</button>
  </div>

  <section class="card detail-panel is-active" id="detail-notes" role="tabpanel" data-detail-panel="notes">
    <!-- batch (s) 2026-09-08 (user request): the previous «where I left off» heading +
         its subtitle are GONE — the tab title (یادداشت‌ها) above already says what this
         is; the composer starts immediately. The placeholder is the user's own wording. -->
    <form hx-post="/api/projects/${p.id}/note" hx-target="body" hx-swap="beforeend" id="pd-note-form">
      <textarea name="note" id="pd-note-textarea" rows="3" maxlength="5000" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'Write a quick note to follow up later.', 'یک یادداشت سریع بنویس تا بعدا پیگیری کنی.')}">${esc(p.latest_note)}</textarea>
      <div class="row"><button type="submit">${trL(lang, 'Save note', 'ذخیره یادداشت')}</button><button type="button" class="ghost small" data-note-expand title="${trL(lang, 'Open a larger editor', 'باز کردن ویرایشگر بزرگ‌تر')}">${icon('expand')} ${trL(lang, 'Expand', 'بزرگ‌نمایی')}</button><span class="muted small" id="note-status" hidden></span></div>
    </form>
    <h3 style="margin-block-start:1.5rem">${trL(lang, 'Related notes ({n})', 'یادداشت‌های مرتبط ({n})', { n: dig(d.notes.length) })}</h3>
    <ul class="links related-notes">${relatedNotes}</ul>
    <p class="muted small">${trL(lang, 'From the dashboard Quick Notebook → Attach', 'از یادداشت سریع داشبورد → اتصال')}</p>
  </section>

  <section class="card detail-panel" id="detail-problems" role="tabpanel" data-detail-panel="problems" hidden>
    <h3>${trL(lang, 'Problems', 'مشکل‌ها')}</h3>
    <p class="muted small">${trL(lang, 'Bugs and blockers — the exact same items as the Problems box on the board. Solving one moves it to Done.', 'باگ و مانع — دقیقاً همان موارد جعبهٔ «مشکلات» روی برد. با حل‌شدن، به «انجام‌شده» می‌رود.')}</p>
    <ul class="hurdles" id="problems">${problemsList}</ul>
    <form class="row note-compose" data-problem-add>
      <textarea class="note-compose-text" name="text" rows="2" maxlength="5000" autocomplete="off" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'Type it and press Enter — each line becomes a problem in the board’s Problems box', 'بنویس و Enter بزن — هر خط یک مشکل می‌شود و خودکار در جعبهٔ «مشکلات» می‌نشیند')}"></textarea>
      <button type="submit" class="ghost" aria-label="${trL(lang, 'Add problem', 'افزودن مشکل')}">${icon('plus')}</button>
    </form>
  </section>

  <section class="card detail-panel" id="detail-backlog" role="tabpanel" data-detail-panel="backlog" hidden>
    <h3>${trL(lang, 'Upcoming Plan', 'برنامه آتی')}</h3>
    <p class="muted small">${trL(lang, 'Two ways to plan: quick items land in the Upcoming Plan box instantly; documents hold the full plan (title + content) with a change history.', 'دو راه برنامه‌ریزی: قلم‌های سریع بلافاصله در جعبهٔ «برنامه آتی» می‌نشینند؛ اسناد، برنامهٔ کامل (عنوان + متن) را با تاریخچهٔ تغییر نگه می‌دارند.')}</p>

    <form class="pd-quick-add bl-item-form" data-bl-item>
      <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="${trL(lang, '− Fix the dashboard CSS problems…', '− رفع مشکلات CSS داشبورد…')}" aria-label="${trL(lang, 'Upcoming plan item', 'قلم برنامه آتی')}">
      <button type="submit" class="ghost" aria-label="${trL(lang, 'Add item', 'افزودن قلم')}">${icon('plus')}</button>
    </form>
    <p class="muted small bl-hint">${trL(lang, 'Every item lands in the Upcoming Plan box above — ideas still need a review before they join the plan.', 'هر قلم بلافاصله در جعبهٔ «برنامه آتی» بالا می‌نشیند — ایده‌ها پیش از ورود به برنامه بازبینی و انتخاب می‌شوند.')}</p>

    <h4 class="bl-sub">${trL(lang, 'Plan documents', 'اسناد برنامه')}</h4>
    <div class="bl-docs" data-bl-docs>${blDocs}</div>

    <button type="button" class="pd-task-add" data-bl-newdoc>${icon('plus')} ${trL(lang, 'New plan document', 'سند جدید برنامه')}</button>

    <form class="bl-doc-form" data-bl-docform hidden>
      <input name="title" maxlength="200" dir="auto" autocomplete="off" placeholder="${trL(lang, 'Document title — e.g. Backlog of V 12.1', 'عنوان سند — مثلاً برنامهٔ نسخهٔ ۱۲٫۱')}" required>
      <textarea name="content" rows="8" maxlength="50000" dir="auto" placeholder="${trL(lang, 'The full plan — everything that has to be done…', 'برنامهٔ کامل — همهٔ کارهایی که باید انجام شود…')}"></textarea>
      <div class="row">
        <button type="submit" class="btn small">${trL(lang, 'Save document', 'ذخیرهٔ سند')}</button>
        <button type="button" class="ghost small" data-bl-fullscreen title="${trL(lang, 'Open in full-screen editor', 'باز کردن در ویرایشگر تمام‌صفحه')}">${icon('expand')} ${trL(lang, 'Full screen', 'تمام‌صفحه')}</button>
        <button type="button" class="ghost small" data-bl-cancel>${trL(lang, 'Cancel', 'لغو')}</button>
      </div>
    </form>

    <h4 class="bl-sub" data-bl-history-head>${trL(lang, 'Latest changes', 'آخرین تغییرات برنامه')}${d.backlog.latestAt ? ` <span class="muted small">· ${trL(lang, 'last change', 'آخرین تغییر')} ${timeAgo(d.backlog.latestAt, lang)}</span>` : ''}</h4>
    <ul class="bl-history" data-bl-history>${blHistory}</ul>
  </section>

  <section class="card detail-panel" id="detail-links" role="tabpanel" data-detail-panel="links" hidden>
    <h3>${trL(lang, 'Links', 'پیوندها')}</h3>
    <ul id="links" class="links">${links}</ul>
    <form class="row" hx-post="/api/projects/${p.id}/links" hx-target="#links" hx-swap="innerHTML">
      <input name="label" placeholder="${trL(lang, 'Label (Repo, Live…)', 'برچسب (Repo، Live…)')}" maxlength="100">
      <input name="url" placeholder="https://…" required>
      <button>${trL(lang, 'Add link', 'افزودن پیوند')}</button>
    </form>
  </section>

  <section class="card detail-panel" id="detail-media" role="tabpanel" data-detail-panel="media" hidden>
    <h3>${trL(lang, 'Screenshots', 'اسکرین‌شات‌ها')}</h3>
    <input type="file" id="shot-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    <button class="ghost" onclick="document.getElementById('shot-input').click()">${trL(lang, 'Upload screenshots', 'آپلود اسکرین‌شات‌ها')}</button>
    <div class="shot-grid" id="shots" hx-trigger="load" hx-swap="innerHTML">${shots}</div>
  </section>

  <section class="card detail-panel" id="detail-activity" role="tabpanel" data-detail-panel="activity" hidden>
    <h3>${trL(lang, 'Latest Activity', 'آخرین تغییرات')}</h3>
    <ul class="history">${history}</ul>
    ${d.canvasPromos.length ? html`<h3 style="margin-block-start:1.5rem">${trL(lang, 'Promoted from canvas', 'ترفیع‌شده از بوم')}</h3>
    <ul class="links backlinks">${d.canvasPromos.map((cp) => html`<li class="row spread"><a href="${cp.board === 'notebook' ? '/whiteboard.html' : '/canvas.html'}">${icon('pencil')} ${trL(lang, 'Canvas note', 'یادداشت بوم')}</a> <span class="muted small">${esc((cp.content || '').slice(0, 60))}</span></li>`)}</ul>` : ''}
  </section>

  <!-- Item 5 + 7 (user request 2026-09-09): a shared full-screen modal for the note editor
       (Expand) and the backlog-doc editor (Full screen). Opens with a large textarea that
       saves back to the same endpoints. Pure client-side — the JS in project.html wires it. -->
  <dialog id="pd-editor-modal" class="dialog pd-editor-modal">
    <form class="modal pd-editor-modal-inner" id="pd-editor-form" novalidate>
      <div class="row spread pd-editor-head">
        <h3 id="pd-editor-title">${trL(lang, 'Editor', 'ویرایشگر')}</h3>
        <button type="button" class="ghost" id="pd-editor-close" aria-label="${trL(lang, 'Close', 'بستن')}">${icon('x')}</button>
      </div>
      <input type="text" id="pd-editor-subtitle" class="pd-editor-subtitle" maxlength="200" hidden placeholder="${trL(lang, 'Title…', 'عنوان…')}">
      <textarea id="pd-editor-textarea" rows="20" maxlength="50000" dir="auto" autocomplete="off"></textarea>
      <div class="row pd-editor-footer">
        <span class="muted small" id="pd-editor-hint"></span>
        <span class="grow"></span>
        <button type="submit" id="pd-editor-save">${trL(lang, 'Save', 'ذخیره')}</button>
        <button type="button" class="ghost" id="pd-editor-cancel">${trL(lang, 'Cancel', 'لغو')}</button>
      </div>
    </form>
  </dialog>`
}

export function projectsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const query = listProjectsSchema.safeParse(c.req.query())
    const view = query.success ? query.data.view : 'cards'
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    const conds = ['deleted_at IS NULL', 'user_id = ?']
    const params: unknown[] = [user.id]
    if (query.success && query.data.status) {
      conds.push('status = ?')
      params.push(query.data.status)
    } else {
      // Sparks live on their own shelf (the Ideas page) — every other view excludes them.
      conds.push("status != 'spark'")
    }
    if (query.success && query.data.tag) {
      conds.push(
        'id IN (SELECT pt.project_id FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.id = ? AND t.user_id = ?)',
      )
      params.push(query.data.tag, user.id)
    }
    if (query.success && query.data.q) {
      const match = `"${query.data.q.replace(/"/g, '""')}"`
      conds.push('rowid IN (SELECT rowid FROM projects_fts WHERE projects_fts MATCH ?)')
      params.push(match)
    }
    const folderParam = query.success ? query.data.folder : undefined
    if (folderParam && query.success && query.data.status === 'spark') {
      if (folderParam === 'none') conds.push('folder_id IS NULL')
      else {
        conds.push('folder_id = ?')
        params.push(folderParam)
      }
    }
    const projects = await cfg.db.query<ProjectRow>(
      `SELECT * FROM projects WHERE ${conds.join(' AND ')} ORDER BY status, sort_order, updated_at DESC`,
      params,
    )
    const tagsMap = await loadTags(cfg, user.id)
    if (c.req.header('HX-Request')) {
      const activeStatus = query.success ? query.data.status : undefined
      if (view === 'grid') {
        const countRows = await cfg.db.query<{ status: string; n: number }>(
          'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status != ? GROUP BY status',
          [user.id, 'spark'],
        )
        const counts = new Map<string, number>(countRows.map((r) => [r.status, r.n]))
        return await etag(c, c.html(glanceStrip(counts, activeStatus, lang, true)))
      }
      // P-signals: batch-load per-project signal counts (bugs, ideas, backlog, hurdles)
      const signalsMap = await loadProjectSignals(cfg, user.id, projects.map((p) => p.id))
      let fragment = listFragment(projects, tagsMap, view, lang, signalsMap)
      if (c.req.query('view') !== undefined && activeStatus !== 'spark') {
        const countRows = await cfg.db.query<{ status: string; n: number }>(
          'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status != ? GROUP BY status',
          [user.id, 'spark'],
        )
        const counts = new Map<string, number>(countRows.map((r) => [r.status, r.n]))
        if (countRows.some((r) => r.n > 0)) fragment = glanceStrip(counts, activeStatus, lang) + fragment
      }
      if (activeStatus === 'spark') {
        const folderRows = await cfg.db.query<SparkFolderRow & { n: number }>(
          `SELECT f.id, f.name, (SELECT COUNT(*) FROM projects p WHERE p.folder_id = f.id AND p.user_id = ? AND p.deleted_at IS NULL AND p.status = 'spark') AS n
           FROM spark_folders f WHERE f.user_id = ? ORDER BY f.sort_order, f.created_at`,
          [user.id, user.id],
        )
        const unfiledRows = await cfg.db.query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status = 'spark' AND folder_id IS NULL",
          [user.id],
        )
        if (projects.length === 0) {
          fragment = sparkFolderBar(folderRows, unfiledRows[0]?.n ?? 0, folderParam, lang) + sparkEmptyHtml(lang)
        } else if (view === 'kanban') {
          fragment = sparkKanbanHtml(projects, folderRows, lang)
        } else {
          fragment = sparkFolderBar(folderRows, unfiledRows[0]?.n ?? 0, folderParam, lang) + fragment
        }
      }
      return await etag(c, c.html(fragment))
    }
    return await etag(c, c.json({ projects: projects.map((p) => ({ ...p, tags: tagsMap.get(p.id) ?? [] })) }))
  })

  app.post('/', async (c) => {
    const body = await jsonBody<z.infer<typeof createProjectSchema>>(c, createProjectSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const now = new Date().toISOString()
    const id = body.id ?? uuid()
    // Offline replay safety: a quick-add whose id already landed (response lost on a blip)
    // must not 500 on the primary key — the queue would retry it forever and the
    // “unsynced changes” badge would never clear. Same user + same id = already synced.
    const existing = await cfg.db.query<{ id: string; user_id: string }>('SELECT id, user_id FROM projects WHERE id = ?', [id])
    if (existing.length > 0) {
      if (existing[0].user_id === user.id) return c.json({ ok: true, duplicate: true }, 200)
      return c.json({ error: 'id_conflict' }, 409) // UUID collision across users — never 500
    }
    await cfg.db.execute(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, client_name, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?)`,
      [id, user.id, body.title, body.description, body.type, body.status, body.reminders_enabled ?? 0, body.client_name ?? null, body.due_date ?? null, now, now],
    )
    // Optional tags on create (quick-add modal, spec §5.5): find-or-create per user, then link.
    // H1 fix (2026-09-10): resolve tag IDs atomically via INSERT ... ON CONFLICT ... RETURNING
    // BEFORE the transaction. The old read-then-write pattern (SELECT inside the transaction)
    // raced on concurrent same-name tag creation — both requests saw no existing tag, both
    // tried INSERT, and the UNIQUE(user_id, name) violation rolled back the whole batch.
    if (body.tags && body.tags.length > 0) {
      const tagIds: string[] = []
      for (const t of body.tags ?? []) {
        const name = t.name.trim()
        if (!name) continue
        const rows = await cfg.db.query<{ id: string }>(
          `INSERT INTO tags (id, user_id, name, color, usage_count, created_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
           RETURNING id`,
          [uuid(), user.id, name, t.color ?? '#f6d365', now],
        )
        if (rows[0]) tagIds.push(rows[0].id)
      }
      await cfg.db.transaction(async (tx) => {
        for (const tagId of tagIds) {
          tx.sql('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [id, tagId])
        }
      })
    }
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', `/project.html?id=${id}`)
      return c.html('')
    }
    return c.json({ ok: true, id }, 201)
  })

  app.post('/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    // Reorder is always within a single status group (rule 1 + status coherence): an id of
    // another status (or another user's) is simply never updated.
    await cfg.db.transaction(async (tx) => {
      body.ids.forEach((id, i) => {
        tx.sql('UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = ?', [
          i, new Date().toISOString(), id, user.id, body.status,
        ])
      })
    })
    if (c.req.header('HX-Request')) return c.html('')
    return c.json({ ok: true })
  })

  app.get('/sparks/folders', async (c) => {
    const user = c.get('user')
    const folders = await cfg.db.query<SparkFolderRow & { n: number }>(
      `SELECT f.id, f.name, f.sort_order, f.created_at,
              (SELECT COUNT(*) FROM projects p WHERE p.folder_id = f.id AND p.user_id = ? AND p.deleted_at IS NULL AND p.status = 'spark') AS n
       FROM spark_folders f WHERE f.user_id = ? ORDER BY f.sort_order, f.created_at`,
      [user.id, user.id],
    )
    return c.json({ folders })
  })

  app.post('/sparks/folders', async (c) => {
    const body = await jsonBody<z.infer<typeof sparkFolderSchema>>(c, sparkFolderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const now = new Date().toISOString()
    const id = uuid()
    const max = await cfg.db.query<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM spark_folders WHERE user_id = ?', [user.id])
    await cfg.db.execute(
      'INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, user.id, body.name, (max[0]?.m ?? -1) + 1, now],
    )
    return c.json({ folder: { id, name: body.name, n: 0 } }, 201)
  })

  app.patch('/sparks/folders/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof sparkFolderSchema>>(c, sparkFolderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const res = await cfg.db.execute('UPDATE spark_folders SET name = ? WHERE id = ? AND user_id = ?', [
      body.name, c.req.param('id'), user.id,
    ])
    if (!res.changes) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  })

  app.delete('/sparks/folders/:id', async (c) => {
    const user = c.get('user')
    const folder = await cfg.db.query<{ id: string; name: string }>('SELECT id, name FROM spark_folders WHERE id = ? AND user_id = ?', [
      c.req.param('id'), user.id,
    ])
    if (!folder.length) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM spark_folders WHERE id = ? AND user_id = ?', [folder[0].id, user.id])
    return c.json({ ok: true })
  })

  app.get('/duplicate-check', async (c) => {
    // Soft warning (spec §5.3): near-duplicate titles are flagged, never blocked.
    const user = c.get('user')
    const title = z.string().min(1).max(200).safeParse(c.req.query('title'))
    if (!title.success) return c.json({ error: 'invalid_input' }, 400)
    const rows = await cfg.db.query<{ id: string; title: string }>(
      'SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL AND lower(title) = lower(?)',
      [user.id, title.data],
    )
    return c.json({ duplicate: rows.length > 0, existing: rows[0] ?? null })
  })

  app.get('/:id', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const d = await loadDetail(cfg, p)
    if (c.req.header('HX-Request')) return await etag(c, c.html(detailHtml(p, d, lang)))
    return await etag(c, c.json({ project: { ...p, ...d } }))
  })

  app.patch('/:id', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const body = await jsonBody<z.infer<typeof updateProjectSchema>>(c, updateProjectSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    // batch (s) — folder_id only rides along while the project stays a spark: a folder
    // reference on a non-spark project is meaningless, so it is dropped; a non-null move
    // must point at one of the user's own folders.
    if (body.folder_id !== undefined) {
      const staysSpark = p.status === 'spark' || body.status === 'spark'
      if (!staysSpark) delete body.folder_id
      else if (body.folder_id !== null) {
        const own = await cfg.db.query<{ id: string }>('SELECT id FROM spark_folders WHERE id = ? AND user_id = ?', [
          body.folder_id, user.id,
        ])
        if (!own.length) return c.json({ error: 'folder_not_found' }, 404)
      }
    }
    const now = new Date().toISOString()
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`)
      params.push(v === undefined ? null : v)
    }
    sets.push('updated_at = ?')
    params.push(now)
    params.push(p.id, user.id)
    await cfg.db.execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
    if (body.status && body.status !== p.status) {
      await cfg.db.execute(
        'INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)',
        [uuid(), p.id, `Status → ${STATUS_LABEL[body.status]}`, now],
      )
    }
    if (body.latest_note !== undefined && body.latest_note !== p.latest_note) {
      await cfg.db.execute(
        'INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)',
        [uuid(), p.id, body.latest_note, now],
      )
    }
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Saved', 'ذخیره شد'), lang))
    return c.json({ ok: true })
  })

  app.delete('/:id', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const canHardDelete = p.status === 'spark' || p.status === 'unreviewed'
    const force = c.req.query('force') === '1'
    if (canHardDelete && force) {
      // Hard delete allowed only for Spark/Unreviewed that were force-confirmed (spec §4.15).
      await cfg.db.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', [p.id, user.id])
    } else {
      // Soft delete — undo-toast stays honest for 7 days (Q2 decision), then the cron purges.
      await cfg.db.execute('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
        new Date().toISOString(), new Date().toISOString(), p.id, user.id,
      ])
    }
    if (c.req.header('HX-Request')) {
      return c.html(toastHtml(t('Deleted "{title}".', '«{title}» حذف شد', { title: p.title }), lang, canHardDelete && force ? undefined : `/api/projects/${p.id}/restore`))
    }
    return c.json({ ok: true, soft: !(canHardDelete && force) })
  })

  app.post('/:id/restore', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const user = c.get('user')
    await cfg.db.execute('UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      new Date().toISOString(), c.req.param('id'), user.id,
    ])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Restored', 'بازگردانی شد'), lang))
    return c.json({ ok: true })
  })

  app.post('/:id/revive', async (c) => {
    // Halted revive (spec §5.6): asks every time which status fits — never assumes.
    const body = await jsonBody<{ status: 'unreviewed' | 'investigating' | 'awaiting' | 'doing' | 'operational' }>(c, z.object({ status: z.enum(['unreviewed', 'investigating', 'awaiting', 'doing', 'operational']) }))
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p || p.status !== 'halted') return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE projects SET status = ?, archived_state = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      body.status, now, p.id, user.id,
    ])
    await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
      uuid(), p.id, `Revived → ${STATUS_LABEL[body.status]}`, now,
    ])
    if (c.req.header('HX-Request')) {
      c.header('HX-Redirect', `/project.html?id=${p.id}`)
      return c.html('')
    }
    return c.json({ ok: true })
  })

  app.post('/:id/note', async (c) => {
    const t = trFor(c)
    const lang = localeOf(c)
    const body = await jsonBody<z.infer<typeof noteSchema>>(c, noteSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('id'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    // L2 fix (2026-09-10): add AND user_id = ? as belt-and-suspenders defense-in-depth.
    // The project p was pre-validated via getOwnedProject, but rule #1 says every user-owned
    // query should filter on user_id — consistency closes the "what if the pre-check regresses" gap.
    await cfg.db.execute('UPDATE projects SET latest_note = ?, updated_at = ? WHERE id = ? AND user_id = ?', [body.note, now, p.id, p.user_id])
    // Autosave can fire many times with the same text — only log a history entry when the
    // note actually changed, so the trail stays meaningful (user request: save as you type).
    if (body.note !== p.latest_note) {
      await cfg.db.execute('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
        uuid(), p.id, body.note, now,
      ])
    }
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Note saved', 'یادداشت ذخیره شد'), lang))
    return c.json({ ok: true })
  })

  return app
}
