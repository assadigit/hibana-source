import { esc } from '../../lib/http'
import {
  icon,
  statusLabel,
  STATUS_BADGE,
  STATUS_ICON,
  timeAgo,
} from '../../lib/html'
import { trL, type Locale } from '../../lib/i18n'
import { faDigits } from '../../lib/jalali'
import { personalProgress, clientProgress } from '../../services/progress'
import { PROJECT_STAGES } from '../../types'
import type {
  Config,
  ProjectRow,
  ProjectStatus,
  TagRow,
  HurdleRow,
  SparkFolderRow,
} from '../../types'


// S35 (user request 2026-09): the ARCHIVE SHELF — parked ideas/projects
// (archived_state='offline', any stage — mostly sparks that won't be built in the
// foreseeable future). NOT trash: rows stay forever, restorable, browsable here.
// One row per project: stage badge, title (deep link), description one-liner,
// folder note for sparks, the archived date, and the restore action.
export function archiveShelfHtml(projects: ProjectRow[], tagsMap: Map<string, TagRow[]>, lang: Locale): string {
  if (projects.length === 0) {
    return `<div class="empty-state empty">
      <span class="empty-state-icon" aria-hidden="true">${icon('archive')}</span>
      <p class="empty-state-title">${trL(lang, 'Nothing archived yet', 'هنوز چیزی بایگانی نشده')}</p>
      <p class="empty-state-text">${trL(lang, 'Ideas and projects you archive rest here — kept safe, never deleted, ready whenever you want to look again.', 'ایده‌ها و پروژه‌هایی که بایگانی می‌کنی اینجا می‌خوابند — سالم می‌مانند، حذف نمی‌شوند، و هر وقت بخواهی دوباره سراغشان می‌روی.')}</p>
      <a class="empty-state-cta btn ghost" href="/projects.html">${trL(lang, 'Go to projects', 'رفتن به پروژه‌ها')}</a>
    </div>`
  }
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const rows = projects
    .map((p) => {
      const tags = tagsMap.get(p.id) ?? []
      const desc = p.description ? `<p class="muted small clip-2 arc-desc">${esc(p.description)}</p>` : ''
      const tagChips = tags.length
        ? `<div class="row arc-tags">${tags.map((t) => `<span class="chip pd-tag-chip" dir="auto">${esc(t.name)}</span>`).join('')}</div>`
        : ''
      return `<article class="card arc-row" id="archived-${p.id}" data-project-id="${p.id}">
        <div class="row spread arc-head">
          <span class="row arc-title-wrap">
            <a href="/project.html?id=${p.id}" class="arc-title" dir="auto">${esc(p.title)}</a>
            ${STATUS_BADGE(p.status, lang)}
          </span>
          <span class="muted small">${trL(lang, 'archived {t}', 'بایگانی {t}', { t: timeAgo(p.updated_at, lang) })}</span>
        </div>
        ${desc}
        ${tagChips}
        <div class="row arc-actions">
          <button type="button" class="btn ghost small" hx-post="/api/projects/${p.id}/unarchive?shelf=1" hx-target="#archive-list" hx-swap="innerHTML">${icon('archive')} ${trL(lang, 'Restore', 'بازگردانی')}</button>
          <a class="btn ghost small" href="/project.html?id=${p.id}">${trL(lang, 'Open', 'باز کردن')}</a>
        </div>
      </article>`
    })
    .join('')
  return `<div class="arc-list">${rows}</div><p class="muted small arc-total">${trL(lang, '{n} archived', '{n} مورد بایگانی‌شده', { n: dig(projects.length) })}</p>`
}

export async function loadTags(cfg: Config, userId: string): Promise<Map<string, TagRow[]>> {
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
export interface ProjectSignals {
  bugs: number
  ideas: number
  backlog: number
  hurdles: number
  backlogUpdated: string | null
}
export async function loadProjectSignals(cfg: Config, userId: string, projectIds: string[]): Promise<Map<string, ProjectSignals>> {
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

/** The standalone BUG notification bubble — red, rounded-square chip with the bug
 *  glyph + count (S126: the glyph NAMES what the number counts, and the rounded-
 *  square shape + red ink deliberately differ from the circular .board-count pills
 *  so the two badge roles can't be confused — the owner's badge-collision note).
 *  Placed right next to the project name so the user gets an instant visual signal
 *  that [x] things are problematic. Only renders when bugs > 0. (User request 2026-09-02.) */
export function bugBubbleHtml(signals: ProjectSignals | undefined, lang: Locale): string {
  if (!signals || signals.bugs === 0) return ''
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const title = trL(lang, `${signals.bugs} open ${signals.bugs === 1 ? 'bug' : 'bugs'}`, `${signals.bugs} باگ باز`)
  return `<span class="bug-bubble" title="${title}" aria-label="${title}">${icon('bug', 'icon')}${dig(signals.bugs)}</span>`
}

/** Render the signals strip (lighter chips — ideas, backlog, hurdles). Bugs are NOT here;
 *  they get their own solid bubble via bugBubbleHtml. Only non-zero signals render. */
export function signalsHtml(signals: ProjectSignals | undefined, lang: Locale): string {
  if (!signals) return ''
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const chips: string[] = []
  if (signals.ideas > 0) chips.push(`<span class="sig-chip sig-ideas" title="${trL(lang, `${signals.ideas} ${signals.ideas === 1 ? 'idea' : 'ideas'}`, `${signals.ideas} ایده`)}">${icon('idea', 'icon')}${dig(signals.ideas)}</span>`)
  if (signals.backlog > 0) chips.push(`<span class="sig-chip sig-backlog" title="${trL(lang, 'Has plans', 'برنامه دارد')}">${icon('list-check', 'icon')}${dig(signals.backlog)}</span>`)
  if (signals.hurdles > 0) chips.push(`<span class="sig-chip sig-hurdles" title="${trL(lang, `${signals.hurdles} open ${signals.hurdles === 1 ? 'hurdle' : 'hurdles'}`, `${signals.hurdles} مانده باز`)}">${icon('alert', 'icon')}${dig(signals.hurdles)}</span>`)
  return chips.length ? `<span class="project-signals">${chips.join('')}</span>` : ''
}

/** Latest backlog update time — small muted metadata. Shows 'Backlog: 2h ago' or similar. */
export function backlogMetaHtml(signals: ProjectSignals | undefined, lang: Locale): string {
  if (!signals || !signals.backlogUpdated) return ''
  const label = trL(lang, 'Backlog', 'برنامه')
  return `<span class="backlog-meta muted small" title="${signals.backlogUpdated}">${label}: ${timeAgo(signals.backlogUpdated, lang)}</span>`
}

export function projectProgress(p: ProjectRow, hurdles: HurdleRow[]): number {
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
export function cardHtml(p: ProjectRow, tags: TagRow[], lang: Locale, signals?: ProjectSignals): string {
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
      <span class="pc-title-wrap"><a href="/project.html?id=${p.id}" class="project-title pc-title" data-magic data-magic-save="/api/projects/${p.id}" data-magic-field="title">${esc(p.title)}</a>${bugBubble}</span>
      ${sigs}
    </div>
    ${descHtml}
    ${metaHtml}
  </article>`
}

export function listFragment(projects: ProjectRow[], tagsMap: Map<string, TagRow[]>, view: string, lang: Locale, signalsMap?: Map<string, ProjectSignals>, statusFilter?: string, progressMap?: Map<string, number>, emptyFilter?: { q?: string; tagName?: string }): string {
  if (projects.length === 0) {
    // B2.5: illustrated empty state — icon + headline + helper + CTA.
    // Status-aware: a specific status filter with no matches gets a contextually
    // correct message instead of the generic "capture your first idea" CTA (which is
    // wrong for an empty stage). Session 19 fix.
    // S76: SEARCH/TAG-aware too — a filtered MISS used to fall through to the capture
    // CTA ("No projects yet"), which is wrong twice over when you HAVE projects: it
    // implies emptiness and nudges capture instead of recovery. The honest answer to
    // a miss is "nothing matched — here's the way back to everything".
    if (emptyFilter?.q) {
      return `<div class="empty-state empty pg-filter-empty">
        <span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></span>
        <p class="empty-state-title">${trL(lang, 'No matches', 'نتیجه‌ای پیدا نشد')}</p>
        <p class="empty-state-text">${trL(lang, 'Nothing matches your search — try another word, or clear the filters to see everything.', 'چیزی با جست‌وجوی تو مطابقت ندارد — واژهٔ دیگری را امتحان کن، یا فیلترها را پاک کن تا همه را ببینی.')}</p>
        <a class="empty-state-cta btn ghost" href="/projects.html">${trL(lang, 'Clear filters', 'پاک‌کردن فیلترها')}</a>
      </div>`
    }
    if (emptyFilter?.tagName) {
      return `<div class="empty-state empty pg-filter-empty">
        <span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></span>
        <p class="empty-state-title">${trL(lang, 'No projects with this label', 'پروژه‌ای با این برچسب نیست')}</p>
        <p class="empty-state-text">${trL(lang, 'Nothing carries this label right now — clear the filters to see everything.', 'الان چیزی این برچسب را ندارد — فیلترها را پاک کن تا همه را ببینی.')}</p>
        <a class="empty-state-cta btn ghost" href="/projects.html">${trL(lang, 'Clear filters', 'پاک‌کردن فیلترها')}</a>
      </div>`
    }
    if (statusFilter === 'awaiting_dev') {
      return `<div class="empty-state empty">
        <span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/></svg></span>
        <p class="empty-state-title">${trL(lang, 'Nothing waiting on development right now', 'هیچ پروژه‌ای در انتظار توسعه نیست')}</p>
        <p class="empty-state-text">${trL(lang, 'Projects paused mid-work live here. Ideas parked for the foreseeable future live under Archive instead.', 'پروژه‌هایی که وسط کار متوقف شده‌اند اینجا هستند. ایده‌هایی که برای آیندهٔ نامشخص کنار گذاشته‌ای در «آرشیو» می‌مانند.')}</p>
        <a class="empty-state-cta btn ghost" href="/projects.html">${trL(lang, 'Go to projects', 'رفتن به پروژه‌ها')}</a>
      </div>`
    }
    // A specific non-spark status filter with no matches (e.g. only "developing" selected, none developing).
    if (statusFilter && statusFilter !== 'spark') {
      const stageLabel = statusLabel(statusFilter as ProjectStatus, lang)
      return `<div class="empty-state empty">
        <span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/></svg></span>
        <p class="empty-state-title">${trL(lang, 'Nothing at this stage yet', 'هنوز در این مرحله چیزی نیست')}</p>
        <p class="empty-state-text">${trL(lang, `No projects in “${stageLabel}” right now. Move one here from its page, or browse all.`, `هیچ پروژه‌ای در «${stageLabel}» نیست. یکی را از صفحه‌اش اینجا بیاور، یا همه را ببین.`)}</p>
        <a class="empty-state-cta btn ghost" href="/projects.html">${trL(lang, 'See all projects', 'همهٔ پروژه‌ها')}</a>
      </div>`
    }
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
          // S29 (agenda 5 — color weights): a bucket-tinted progress strip rides the card's
          // bottom edge — the board reads each project's weight at a glance.
          const pct = progressMap?.get(p.id) ?? 0
          return `<div class="card kanban-card" draggable="true" data-project-id="${p.id}" data-status="${s}" data-nav-url="/project.html?id=${p.id}">
          <div class="row spread"><strong>${esc(p.title)}</strong>${bugBubble}</div>
          ${sigs}
          <div class="muted small">${timeAgo(p.updated_at, lang)}${blMeta ? ` · ${blMeta}` : ''}</div>
          <div class="kanban-progress ${progressBucket(pct)}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(trL(lang, 'Progress', 'پیشرفت'))}"><span style="inline-size:${pct}%"></span></div>
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
// Session 14 (user request): empty boxes (count 0) carry .is-empty — app.css hides them
// on phones (≤560px) where they are dead weight. The class is only applied when at least
// one stage has projects, so a fresh account never renders a hollow glance group.
export function glanceStrip(counts: Map<string, number>, activeStatus: ProjectStatus | undefined, lang: Locale, asMain = false): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const anyNonEmpty = PROJECT_STAGES.some((s) => (counts.get(s) ?? 0) > 0)
  const boxes = PROJECT_STAGES.map((s) => {
    const isActive = activeStatus === s
    const isEmpty = anyNonEmpty && (counts.get(s) ?? 0) === 0
    // data-nav-local (S44): the page's own click handler filters the list IN PLACE
    // (htmx fragment swap) — nav.js's interceptor stands down for these anchors. The
    // href stays as the no-JS fallback (a bare full load with the status param).
    return `<a class="pglance-box${isActive ? ' is-active' : ''}${isEmpty ? ' is-empty' : ''}" href="/projects.html?status=${s}&view=cards" data-pglance="${s}" data-nav-local title="${esc(statusLabel(s, lang))}">
      <span class="pglance-icon" aria-hidden="true">${icon(STATUS_ICON[s])}</span>
      <span class="pglance-count" title="${esc(trL(lang, '{n} projects', '{n} پروژه', { n: String(counts.get(s) ?? 0) }))}">${dig(counts.get(s) ?? 0)}</span>
      <span class="pglance-label">${statusLabel(s, lang)}</span>
    </a>`
  }).join('')
  return `<div class="pglance${asMain ? ' pglance-grid' : ''}" role="group" aria-label="${trL(lang, 'Projects by type', 'پروژه‌ها بر اساس نوع')}">${boxes}</div>`
}

// S121 (owner wireframe, 2026-09-24): the projects home becomes a true OVERVIEW —
// "an overall view of all projects". Server-rendered, speaking the EXISTING status
// vocabulary (the wireframe's labels were draft placeholders — the owner confirmed:
// use idea / planned / in_progress / bug and the six stage labels):
//   1. Overall project tasks — an SVG donut of every OPEN dev task across all active
//      projects by status, center = the open total, ring segments in the BOARD's
//      status palette (devboard.css S48p: idea blue, planned yellow, in-progress
//      orange, bug red — one visual language for task statuses everywhere).
//   2. Four recent boxes — the newest items of each open status (Problems / In
//      Progress / Ideas / Plans), each linking to its project (two jobs: never lose
//      your place — the overview answers "where was I" before the first click).
// S123 (owner report): the S121 project-states CAROUSEL (one card per project) is
// RETIRED at the owner's request — the donut + boxes ARE the overview they wanted;
// the per-project cards duplicated what the views below the overview already show.
// Data: one grouped-count query + four 5-row recent queries, all user_id-scoped
// (rule 1). Renders server-side — 0 new client i18n keys (the S118 silent-restore
// pattern; parity count unchanged).
export interface OvCounts { idea: number; planned: number; in_progress: number; bug: number }
// S126: project_status (the owning project's stage) feeds the metadata dot's accent
// color (the --stage-bar-* system the Planning/Queued/Developing rows wear);
// updated_at is the last-updated stamp the recent feeds sort by (0061).
export interface OvTask { id: string; title: string; project_id: string; project_title: string; project_status: string; updated_at: string | null }

// The donut slice order = the lifecycle order (an idea becomes a plan becomes work;
// bugs live in the exception lane at the end) — matches the board column order.
// S126: exported — the ov-tasks page (tasks.ts) speaks the same four buckets.
export const OV_STATUSES = ['idea', 'planned', 'in_progress', 'bug'] as const
export type OvStatus = (typeof OV_STATUSES)[number]
// The rail's group labels (i18n-en/fa 'rail.g.*') are the owner's OWN words for these
// four buckets — the overview borrows them verbatim (server-side inline pairs).
// S126: exported for the ov-tasks page's heading + status switcher.
export const ovLabel = (st: OvStatus, lang: Locale): string =>
  st === 'idea' ? trL(lang, 'Ideas', 'ایده‌ها')
  : st === 'planned' ? trL(lang, 'Plans', 'برنامه‌ها')
  : st === 'in_progress' ? trL(lang, 'In Progress', 'در حال انجام')
  : trL(lang, 'Problems', 'مشکلات')

export async function loadOverviewData(
  cfg: Config,
  userId: string,
): Promise<{ counts: OvCounts; recent: Record<OvStatus, OvTask[]> }> {
  const scope = "p.user_id = ? AND p.deleted_at IS NULL AND (p.archived_state IS NULL OR p.archived_state != 'offline')"
  const statusPh = OV_STATUSES.map(() => '?').join(',')
  const counts: OvCounts = { idea: 0, planned: 0, in_progress: 0, bug: 0 }
  const [statusRows, ...recentLists] = await Promise.all([
    // the pie: open tasks across ALL the user's active projects (the home's scope —
    // deleted + parked-offline excluded, exactly like the glance rail above it)
    cfg.db.query<{ status: string; n: number }>(
      `SELECT t.status, COUNT(*) AS n FROM dev_tasks t JOIN projects p ON p.id = t.project_id
       WHERE ${scope} AND t.status IN (${statusPh}) GROUP BY t.status`,
      [userId, ...OV_STATUSES],
    ),
    // S126 (owner): the four recent feeds — the 3 most recently UPDATED items each
    // ("recent" = last-updated, NOT last-born: an old item edited today outranks a
    // newer untouched one), capped at 3 so the box never needs an internal scroller
    // (the header's View all link carries the rest → /tasks.html?status=…).
    // S57 deploy-ahead-of-D1 belt: a D1 that hasn't applied 0061 yet has no
    // dev_tasks.updated_at — the catch falls back to the pre-S126 born-order query
    // (same shape minus project_status/updated_at ordering) until the column lands.
    ...OV_STATUSES.map((st) =>
      cfg.db
        .query<OvTask>(
          `SELECT t.id, t.title, t.project_id, p.title AS project_title, p.status AS project_status, t.updated_at
         FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         WHERE ${scope} AND t.status = ?
         ORDER BY COALESCE(t.updated_at, t.created_at) DESC LIMIT 3`,
          [userId, st],
        )
        .catch(() =>
          cfg.db.query<OvTask>(
            `SELECT t.id, t.title, t.project_id, p.title AS project_title, p.status AS project_status, NULL AS updated_at
         FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         WHERE ${scope} AND t.status = ?
         ORDER BY t.created_at DESC LIMIT 3`,
            [userId, st],
          ),
        ),
    ),
  ])
  const isOv = (s: string): s is OvStatus => (OV_STATUSES as readonly string[]).includes(s)
  for (const r of statusRows) if (isOv(r.status)) counts[r.status] = r.n
  const recent = {} as Record<OvStatus, OvTask[]>
  OV_STATUSES.forEach((st, i) => { recent[st] = recentLists[i] })
  return { counts, recent }
}

// S124: the pie card and the recent-box card are EXTRACTED builders — overallTasksHtml
// (the projects home) and dashboardOverviewRowHtml (the dashboard's unified projects
// container) compose the SAME cards from them, so both pages speak one overview
// vocabulary (same classes, same palette, same i18n pairs — one definition).
const ovPieHtml = (counts: OvCounts, lang: Locale): string => {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const total = OV_STATUSES.reduce((s, st) => s + counts[st], 0)
  // Donut geometry: r=15.9155 → circumference EXACTLY 100, so every slice's
  // dasharray is its percentage. The <g> (ring + segments) rotates -90° so the
  // accumulation starts at 12 o'clock; the center <text> stays upright outside it.
  let acc = 0
  const segs = OV_STATUSES
    .map((st) => {
      const f = total ? (counts[st] / total) * 100 : 0
      const seg = f > 0
        ? `<circle class="ov-seg" data-st="${st}" r="15.9155" cx="21" cy="21" stroke-dasharray="${f.toFixed(3)} ${(100 - f).toFixed(3)}" stroke-dashoffset="${(25 - acc).toFixed(3)}"></circle>`
        : ''
      acc += f
      return seg
    })
    .join('')
  return `<div class="card ov-pie-card">
      <svg class="ov-donut" viewBox="0 0 42 42" role="img" aria-label="${esc(trL(lang, '{n} open tasks across all projects', '{n} کار باز در همهٔ پروژه‌ها', { n: dig(total) }))}">
        <g transform="rotate(-90 21 21)">
          <circle class="ov-ring" r="15.9155" cx="21" cy="21"></circle>
          ${segs}
        </g>
        <text class="ov-total" x="21" y="21" text-anchor="middle" dominant-baseline="central">${dig(total)}</text>
        <text class="ov-total-label" x="21" y="28.2" text-anchor="middle">${trL(lang, 'open', 'باز')}</text>
      </svg>
      <ul class="ov-legend">
        ${OV_STATUSES.map((st) => `<li class="ov-leg" data-st="${st}"><span class="ov-dot" data-st="${st}" aria-hidden="true"></span><span class="ov-leg-label">${ovLabel(st, lang)}</span><b class="ov-leg-n">${dig(counts[st])}</b></li>`).join('')}
      </ul>
    </div>`
}

const ovBoxHtml = (st: OvStatus, counts: OvCounts, recent: Record<OvStatus, OvTask[]>, lang: Locale): string => {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  // S126: each item's full text rides BOTH the native title (mouse hover — the
  // truncation stays) and data-full, which the CSS :focus-visible tooltip reads
  // (title attrs are not reliably announced to keyboard users). The metadata line
  // wears the owning project's stage accent (ov-proj-dot ← --stage-bar-*).
  const items = recent[st]
    .map((t) => `<li><a class="ov-item" href="/project.html?id=${t.project_id}" data-full="${esc(t.title)}">
          <span class="ov-item-title" dir="auto" title="${esc(t.title)}">${esc(t.title)}</span>
          <span class="ov-item-proj muted small" dir="auto"><span class="ov-proj-dot" data-stage="${esc(t.project_status)}" aria-hidden="true"></span>${esc(t.project_title)}</span>
        </a></li>`)
    .join('')
  // S126: the header joins the stage cards' convention — [dot] [label] [count pill]
  // on the reading-start edge, View all on the inline-end edge. The link lands on
  // the ov-tasks page (ALL items of this status across projects — the cap-3 cards'
  // reachable path for everything past the 3 shown).
  return `<div class="card ov-box" data-ov-box="${st}">
      <div class="row spread ov-box-head">
        <span class="row ov-box-title"><span class="ov-dot" data-st="${st}" aria-hidden="true"></span><span class="ov-box-label">${ovLabel(st, lang)}</span><b class="board-count ov-box-n">${dig(counts[st])}</b></span>
        <a class="ov-viewall small muted" href="/tasks.html?status=${st}">${trL(lang, 'View all', 'مشاهده همه')}</a>
      </div>
      ${items ? `<ul class="ov-items">${items}</ul>` : `<p class="muted small ov-empty">${trL(lang, 'Nothing here', 'چیزی نیست')}</p>`}
    </div>`
}

export function overallTasksHtml(counts: OvCounts, recent: Record<OvStatus, OvTask[]>, lang: Locale): string {
  // Box order = the wireframe's reading order (what's burning first): Problems,
  // In Progress, then the capture lanes Ideas / Plans.
  const boxes = `<div class="ov-boxes">${ovBoxHtml('bug', counts, recent, lang)}${ovBoxHtml('in_progress', counts, recent, lang)}${ovBoxHtml('idea', counts, recent, lang)}${ovBoxHtml('planned', counts, recent, lang)}</div>`
  return `<section class="ov ov-tasks" aria-labelledby="ov-tasks-h">
    <div class="ov-head"><h2 id="ov-tasks-h">${trL(lang, 'Overall project tasks', 'کارهای همهٔ پروژه‌ها')}</h2></div>
    <div class="ov-grid">${ovPieHtml(counts, lang)}${boxes}</div>
  </section>`
}

// S124 (owner wireframe): the DASHBOARD's unified projects container — the same
// overview cards, but the lower panel is a horizontal row (the wireframe order:
// PIECHART, Plans, Problems, In Progress — ideas live in the pie's slice + legend,
// so the separate Ideas box drops out here). No section wrapper/heading: the
// container (dashboard.ts) already carries the context and the carousel above.
export function dashboardOverviewRowHtml(counts: OvCounts, recent: Record<OvStatus, OvTask[]>, lang: Locale): string {
  return `${ovPieHtml(counts, lang)}${ovBoxHtml('planned', counts, recent, lang)}${ovBoxHtml('bug', counts, recent, lang)}${ovBoxHtml('in_progress', counts, recent, lang)}`
}

export function sparkEmptyHtml(lang: Locale): string {
  // Fix 2026-09-09 (Phase 6 deviation #6): the CTA now carries the bulb icon (the audit
  // flagged it as text-only). The icon rides inline-start of the label.
  // S41 (user report: "doesn't show … adding a new folder"): the 0-folders-0-ideas boot
  // state used to offer ONLY capture — a fresh account literally had no way to create
  // its first folder. The New-folder CTA rides the same data-sf-new delegation as the
  // grid's dashed card, so it opens the folder dialog (with the emoji picker).
  return `<div class="empty-state empty">
    <span class="empty-state-icon" aria-hidden="true">${icon('idea')}</span>
    <p class="empty-state-title">${trL(lang, 'No ideas yet!', 'هنوز ایده ای رو ثبت نکردی!')}</p>
    <p class="empty-state-text">${trL(lang, 'Capture your first idea — it stays safe here until the moment is right to pursue it.', 'اولین ایده‌ات را ثبت کن، اینجا امن می‌ماند تا وقتی برای فرصت کنی به آن بپردازی.')}</p>
    <div class="empty-state-actions">
      <button type="button" class="empty-state-cta btn" data-quickadd-open>${icon('idea', 'icon')} ${trL(lang, 'Capture a new idea', 'ثبت ایده جدید')}</button>
      <button type="button" class="empty-state-cta btn ghost" data-sf-new>${icon('folder-plus', 'icon')} ${trL(lang, 'New folder', 'پوشهٔ جدید')}</button>
    </div>
  </div>`
}

export function sparkKanbanHtml(projects: ProjectRow[], folders: (SparkFolderRow & { n: number })[], lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  // S41: a folder with an emoji leads its column with the emoji (not folder-plus)
  const col = (key: string, label: string, rows: ProjectRow[], glyph: string) => `<div class="kanban-col" data-spark-folder="${key}">
    <h4><span class="chip">${glyph}</span> <span>${esc(label)}</span> <span class="muted small">${dig(rows.length)}</span></h4>
    ${rows.map((p) => `<div class="card kanban-card" draggable="true" data-project-id="${p.id}" data-nav-url="/project.html?id=${p.id}">
      <strong>${esc(p.title)}</strong>
      <div class="muted small">${timeAgo(p.updated_at, lang)}</div>
    </div>`).join('') || `<div class="kanban-empty">${trL(lang, 'Drop here', 'اینجا رها کن')}</div>`}
  </div>`
  const byFolder = (fid: string | null) => projects.filter((p) => (p.folder_id ?? null) === fid)
  return `<div class="kanban">${folders.map((f) => col(f.id, f.name, byFolder(f.id), f.icon ? esc(f.icon) : icon('folder-plus', 'icon'))).join('')}${col('', trL(lang, 'No folder', 'بدون پوشه'), byFolder(null), icon('folder-plus', 'icon'))}</div>`
}

export function sparkFolderBar(folders: (SparkFolderRow & { n: number })[], unfiled: number, activeFolder: string | undefined, lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const chip = (key: string, label: string, count: number) => `<button type="button" class="sf-chip${activeFolder === key ? ' is-active' : ''}" data-sf="${key}"><span class="sf-label">${esc(label)}</span> <span class="sf-n">${dig(count)}</span></button>`
  // S41: the HOME chip — «پوشه‌ها» rides first in the bar. Before it, a session that
  // entered a folder could never return to the file-manager grid (the only other exit,
  // «همه», is the flat all-ideas list — folders vanish from view; the owner's mobile
  // report: "doesn't show already made folders"). data-sf="" rides the EXISTING
  // delegation: input.value='' + pref cleared + a folder-less fetch = the grid home.
  const homeChip = `<button type="button" class="sf-chip sf-home" data-sf="" title="${trL(lang, 'All folders', 'همهٔ پوشه‌ها')}">${icon('folder', 'icon')} <span class="sf-label">${trL(lang, 'Folders', 'پوشه‌ها')}</span></button>`
  // "All" chip: active when activeFolder is 'all' or '' (back-compat)
  const allActive = activeFolder === 'all' || activeFolder === '' ? ' is-active' : ''
  const parts = [homeChip, `<button type="button" class="sf-chip${allActive}" data-sf="all"><span class="sf-label">${trL(lang, 'All', 'همه')}</span> <span class="sf-n">${dig(unfiled + folders.reduce((a, f) => a + f.n, 0))}</span></button>`]
  for (const f of folders) {
    // S41: the folder's emoji rides inline-start of the chip label (data-sf-icon feeds
    // the rename dialog's prefill — same pattern as the grid card).
    parts.push(
      `<span class="sf-item" data-sf-icon="${esc(f.icon ?? '')}"><button type="button" class="sf-chip${activeFolder === f.id ? ' is-active' : ''}" data-sf="${f.id}" title="${esc(f.name)}">${f.icon ? `<span class="sf-emoji" aria-hidden="true">${esc(f.icon)}</span>` : ''}<span class="sf-label">${esc(f.name)}</span> <span class="sf-n">${dig(f.n)}</span></button><button type="button" class="sf-more" data-sf-menu="${f.id}" aria-label="${trL(lang, 'Folder actions', 'کارهای پوشه')}" title="${trL(lang, 'Folder actions', 'کارهای پوشه')}">${icon('more-h')}</button></span>`,
    )
  }
  if (folders.length > 0) parts.push(chip('none', trL(lang, 'No folder', 'بدون پوشه'), unfiled))
  parts.push(
    `<button type="button" class="sf-chip sf-new" data-sf-new title="${trL(lang, 'New folder', 'پوشه جدید')}" aria-label="${trL(lang, 'New folder', 'پوشه جدید')}">${icon('plus')}</button>`,
  )
  return `<div class="sf-bar" data-sf-bar role="group" aria-label="${trL(lang, 'Folders', 'پوشه‌ها')}">${parts.join('')}</div>`
}

// Folder grid view (user request 2026-09): when no folder is selected on the Ideas page,
// show folders as large cards (like a file manager). Clicking a folder filters to its ideas.
// Each card shows the folder name, idea count, and a menu button.
export function sparkFolderGrid(folders: (SparkFolderRow & { n: number })[], unfiled: number, lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const totalIdeas = unfiled + folders.reduce((a, f) => a + f.n, 0)
  if (folders.length === 0 && totalIdeas === 0) {
    // No folders + no ideas — show the empty state with a "create folder" hint
    return sparkEmptyHtml(lang)
  }
  const cards = folders.map((f) =>
    `<div class="spark-folder-card" data-sf="${f.id}" data-sf-icon="${esc(f.icon ?? '')}" draggable="false">
      <div class="spark-folder-icon">${f.icon ? `<span class="spark-folder-emoji" role="img" aria-label="${esc(f.name)}">${esc(f.icon)}</span>` : icon('folder-plus')}</div>
      <div class="spark-folder-name">${esc(f.name)}</div>
      <div class="spark-folder-count">${dig(f.n)} ${trL(lang, f.n === 1 ? 'idea' : 'ideas', f.n === 1 ? 'ایده' : 'ایده')}</div>
      <button type="button" class="ghost small spark-folder-menu" data-sf-menu="${f.id}" aria-label="${trL(lang, 'Folder actions', 'کارهای پوشه')}" title="${trL(lang, 'Folder actions', 'کارهای پوشه')}">${icon('more-h')}</button>
    </div>`
  ).join('')
  const unfiledCard = unfiled > 0
    ? `<div class="spark-folder-card spark-folder-unfiled" data-sf="none">
      <div class="spark-folder-icon">${icon('folder-plus')}</div>
      <div class="spark-folder-name">${trL(lang, 'No folder', 'بدون پوشه')}</div>
      <div class="spark-folder-count">${dig(unfiled)} ${trL(lang, unfiled === 1 ? 'idea' : 'ideas', unfiled === 1 ? 'ایده' : 'ایده')}</div>
    </div>`
    : ''
  const allCard = `<div class="spark-folder-card spark-folder-all" data-sf="all">
      <div class="spark-folder-icon">${icon('list-check')}</div>
      <div class="spark-folder-name">${trL(lang, 'All ideas', 'همهٔ ایده‌ها')}</div>
      <div class="spark-folder-count">${dig(totalIdeas)} ${trL(lang, totalIdeas === 1 ? 'idea' : 'ideas', totalIdeas === 1 ? 'ایده' : 'ایده')}</div>
    </div>`
  const newBtn = `<button type="button" class="spark-folder-card spark-folder-new" data-sf-new title="${trL(lang, 'New folder', 'پوشه جدید')}">
      <div class="spark-folder-icon">${icon('plus')}</div>
      <div class="spark-folder-name">${trL(lang, 'New folder', 'پوشه جدید')}</div>
    </button>`
  return `<div class="spark-folder-grid">${allCard}${cards}${unfiledCard}${newBtn}</div>`
}

// S40 (user report: "I can't enter a folder which I made and add an idea there"):
// a deliberately opened view (folder uuid / 'none' / 'all') that matches ZERO sparks
// still owes the user a visible destination — the folder bar + this scoped empty
// state. The capture CTA keeps working because the page's #spark-folder hidden input
// still carries the selection; a capture from here files straight into the folder.
// kind: 'folder' (a named folder), 'none' (unfiled), 'all' (everything, nothing yet).
export function sparkFolderEmptyHtml(
  kind: 'folder' | 'none' | 'all',
  folderName: string | null,
  folderIcon: string | null,
  folders: (SparkFolderRow & { n: number })[],
  lang: Locale,
): string {
  const where =
    kind === 'folder'
      ? trL(lang, `This folder is empty`, `این پوشه خالی است`)
      : kind === 'none'
        ? trL(lang, 'No unfiled ideas — everything lives in a folder.', 'ایدهٔ بدون پوشه‌ای نیست — همه در پوشه‌ها هستند.')
        : folders.length > 0
          ? trL(lang, 'No ideas yet — folders are ready and waiting.', 'هنوز ایده‌ای نیست — پوشه‌ها آماده‌اند.')
          : trL(lang, 'No ideas yet!', 'هنوز ایده‌ای نیست!')
  const iconHtml = kind === 'folder' ? (folderIcon ? `<span aria-hidden="true">${esc(folderIcon)}</span>` : icon('folder-plus')) : icon('idea')
  const nameLine = kind === 'folder' && folderName ? `<p class="empty-state-title">${folderIcon ? `<span aria-hidden="true">${esc(folderIcon)} </span>` : ''}${trL(lang, 'Folder', 'پوشه')}: ${esc(folderName)}</p>` : ''
  return `<div class="empty-state empty spark-folder-empty" data-spark-empty="${kind}">
    <span class="empty-state-icon" aria-hidden="true">${iconHtml}</span>
    ${nameLine}
    <p class="empty-state-text">${where}</p>
    <p class="empty-state-text">${trL(lang, 'Capture an idea — it files into the open view and stays safe here.', 'یک ایده ثبت کن — در همین نمای باز ثبت می‌شود و اینجا امن می‌ماند.')}</p>
    <div class="empty-state-actions">
      <button type="button" class="empty-state-cta btn" data-quickadd-open>${icon('idea', 'icon')} ${trL(lang, 'Capture a new idea', 'ثبت ایده جدید')}</button>
    </div>
  </div>`
}


// S29 (agenda 5 — kanban color weights): batched per-project progress for the board
// renderers. One dev-task aggregate + one hurdle aggregate across ALL visible ids (the
// same batched pattern as loadProjectSignals), then pct = manual override (0002) ?? the
// computed formula (dev tasks once they exist → hurdles). Buckets tint the kanban strip.
export async function loadProjectProgress(
  cfg: Config,
  projects: ProjectRow[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const ids = projects.map((p) => p.id)
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(',')
  const devRows = await cfg.db.query<{ project_id: string; total: number; done: number }>(
    `SELECT project_id, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done FROM dev_tasks WHERE project_id IN (${placeholders}) GROUP BY project_id`,
    ids,
  )
  const devMap = new Map(devRows.map((r) => [r.project_id, r]))
  const hRows = await cfg.db.query<{ project_id: string; total: number; done: number }>(
    `SELECT project_id, COUNT(*) AS total, SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS done FROM hurdles WHERE project_id IN (${placeholders}) GROUP BY project_id`,
    ids,
  )
  const hMap = new Map(hRows.map((r) => [r.project_id, r]))
  for (const p of projects) {
    if (p.progress_percent !== null) {
      map.set(p.id, p.progress_percent)
      continue
    }
    const dev = devMap.get(p.id)
    if (dev && dev.total > 0) {
      map.set(p.id, Math.round((dev.done / dev.total) * 100))
      continue
    }
    const h = hMap.get(p.id)
    map.set(p.id, h && h.total > 0 ? Math.round((h.done / h.total) * 100) : 0)
  }
  return map
}

// The kanban strip's bucket class — same thresholds as the timeline badges (pd-pl-pct),
// so one visual language reads across the board and the Activity tab.
export const progressBucket = (pct: number): string =>
  pct >= 100 ? 'is-done' : pct >= 75 ? 'is-high' : pct >= 50 ? 'is-mid' : pct >= 25 ? 'is-low' : 'is-zero'


// S75: the FULL stale view (GET /api/projects?stale=1 → /projects.html?stale=1) — the
// S72 dashboard nudge caps at 3 chips; its "View all" link lands here. The banner rides
// the SAME visual language as the dashboard's .dash-stale-row (amber = waiting, not an
// alarm) and states the two facts the user needs: how many, and the order (oldest first
// = what you left hanging longest). data-stale-clear is the client's exit hatch (the
// no-JS fallback is the plain /projects.html link below the list — the empty state's
// CTA and every project card link out regardless).
export function staleBannerHtml(count: number, lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  return `<div class="dash-stale-row pg-stale-banner" role="status">
    <span class="dash-stale-flag">${icon('clock', 'icon')} ${trL(lang, 'Untouched for 2+ weeks', 'دو هفته بدون تغییر')}</span>
    <span class="pg-stale-count">${trL(lang, '{n} projects · oldest first', '{n} پروژه · قدیمی‌ترین اول', { n: dig(count) })}</span>
    <button type="button" class="pg-stale-clear" data-stale-clear title="${esc(trL(lang, 'Leave this view — back to all projects', 'ترک این نما — بازگشت به همهٔ پروژه‌ها'))}">
      ${icon('x', 'icon')} ${trL(lang, 'Show all projects', 'همهٔ پروژه‌ها')}
    </button>
  </div>`
}

// The stale view's honest empty state — distinct from "No projects yet" (the user HAS
// projects; none are hanging). Serves job #2 ("never lose your place"): the absence of
// stale work is itself information worth saying out loud.
export function staleEmptyHtml(lang: Locale): string {
  return `<div class="empty-state empty pg-stale-empty">
    <span class="empty-state-icon" aria-hidden="true">${icon('clock')}</span>
    <p class="empty-state-title">${trL(lang, 'Nothing is hanging', 'هیچ چیزی معلق نمانده')}</p>
    <p class="empty-state-text">${trL(lang, 'Every project in motion was touched within the last two weeks. Whatever you leave hanging shows up here — and on the dashboard.', 'هر پروژهٔ در جریان طی دو هفتهٔ گذشته دست‌کاری شده. هرچه رها کنی اینجا — و روی پیشخوان — دیده می‌شود.')}</p>
    <a class="empty-state-cta btn ghost" href="/projects.html">${trL(lang, 'See all projects', 'همهٔ پروژه‌ها')}</a>
  </div>`
}
