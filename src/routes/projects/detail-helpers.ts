import { esc } from '../../lib/http'
import { html } from '../../lib/htmlx'
import {
  icon,
  progressBar,
  statusLabel,
  STATUS_BADGE,
  timeAgo,
} from '../../lib/html'
import { trL, type Locale } from '../../lib/i18n'
import { faDigits, toJalali } from '../../lib/jalali'
import { loadBacklog, taskTagsForProject, PRIO_ORDER_SQL, type BacklogEvent, type TaskTagJoin } from '../devboard-helpers'
import { shotsGridHtml } from '../core'
import { STATUS_ORDER } from '../../types'
import type {
  Config,
  ProjectRow,
  TagRow,
  LinkRow,
  ScreenshotRow,
  HurdleRow,
  DevTaskRow,
  TaskCategory,
  SprintRow,
} from '../../types'
import type { QuickNote } from '../quicknotes'
import { projectProgress } from './helpers'


export async function loadDetail(cfg: Config, p: ProjectRow) {
  const [hurdles, links, screenshots, history, tags, notes, canvasPromos, devTasks, devTaskTags, categories, sprints, backlog] = await Promise.all([
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
    // S29 follow-up (user request 2026-09-12): PRIORITY-FIRST ordering — the boxes
    // auto-sort urgent → high → medium → low (manual drag order survives within a tier).
    cfg.db.query<DevTaskRow>(`SELECT t.* FROM dev_tasks t WHERE t.project_id = ? ORDER BY ${PRIO_ORDER_SQL}, t.sort_order, t.created_at`, [p.id]),
    // S29 follow-up: per-task labels ({task_id, id, name, color}) — chips on the cards.
    taskTagsForProject(cfg, p.id),
    cfg.db.query<TaskCategory>('SELECT * FROM task_categories WHERE project_id = ? ORDER BY sort_order, created_at', [p.id]),
    cfg.db.query<SprintRow>('SELECT * FROM sprints WHERE project_id = ? ORDER BY started_at', [p.id]),
    // برنامه آتی tab payload (0033): documents + merged history feed.
    loadBacklog(cfg, p.id),
  ])
  return { hurdles, links, screenshots, history, tags, notes, canvasPromos, devTasks, devTaskTags, categories, sprints, backlog }
}


export function detailHtml(p: ProjectRow, d: Awaited<ReturnType<typeof loadDetail>>, lang: Locale): string {
  // Progress model (S30, user request 2026-09-12: "remove the whole thing"): the manual
  // override UI is GONE — progress is ALWAYS the computed number. dev tasks drive it
  // once they exist (2026-08-29); before that the hurdle formula (0002's Auto).
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
      .join('') || `<div class="empty-state empty"><span class="empty-state-icon" aria-hidden="true">${icon('link')}</span><p class="empty-state-title">${trL(lang, 'No links yet', 'هنوز پیوندی نیست')}</p><p class="empty-state-text">${trL(lang, 'Add the repo, the live site, or any reference — keep them one click away.', 'ریپو، سایت زنده یا هر مرجع را اضافه کن — یک کلیک دور.')}</p></div>`

  // S39: the shots grid needs the pinned tasks' {title, status} (the pin line says
  // WHICH box + item the picture is stuck to) — build the map from the dev tasks the
  // detail payload already loaded, and count pins per task for the board badges.
  const taskById = new Map<string, DevTaskRow>()
  for (const t of d.devTasks) taskById.set(t.id, t)
  const shotTasks = new Map<string, { title: string; status: string }>()
  const pinsByTask = new Map<string, number>()
  for (const s of d.screenshots) {
    if (!s.task_id) continue
    const t = taskById.get(s.task_id)
    if (t) shotTasks.set(t.id, { title: t.title, status: t.status })
    pinsByTask.set(s.task_id, (pinsByTask.get(s.task_id) ?? 0) + 1)
  }
  const shots = shotsGridHtml(d.screenshots, lang, shotTasks)

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
  // S39: `dig` lives HERE now (the pin badges below use it — it used to sit below COLS,
  // which is AFTER this block: a temporal-dead-zone ReferenceError on the whole page).
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const bugTasks = d.devTasks.filter((t) => (t.status as DevTaskRow['status'] | 'bug') === 'bug')
  const problemsList =
    bugTasks
      .map(
        (t) => `<li class="hurdle" data-problem="${t.id}">
        <button type="button" class="ghost toggle" data-problem-solve="${t.id}" aria-label="${trL(lang, 'Mark solved', 'حل‌شده علامت بزن')}" title="${trL(lang, 'Solved — moves to Done', 'حل شد — می‌رود به انجام‌شده')}">${icon('check')}</button>
        <span class="hurdle-text">${esc(t.title)}</span>
        ${pinsByTask.has(t.id) ? `<button type="button" class="pd-task-shots" data-pd-shots="${t.id}" title="${esc(trL(lang, 'Pinned pictures — note + proof stuck to this problem', 'تصاویر سنجاق‌شده — یادداشت + مدرکِ سنجاق‌شده به این مشکل'))}" aria-label="${esc(trL(lang, 'Pinned pictures ({n})', 'تصاویر سنجاق‌شده ({n})', { n: dig(pinsByTask.get(t.id)!) }))}">${icon('pin')} ${dig(pinsByTask.get(t.id)!)}</button>` : ''}
        <button type="button" class="ghost hurdle-edit" data-problem-edit="${t.id}" aria-label="${trL(lang, 'Edit problem', 'ویرایش مشکل')}" title="${trL(lang, 'Edit problem', 'ویرایش مشکل')}">${icon('pencil')}</button>
        <button type="button" class="ghost danger" data-problem-del="${t.id}" aria-label="${trL(lang, 'Delete problem', 'حذف مشکل')}">${icon('x')}</button>
      </li>`,
      )
      .join('') || ''
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
      .join('') || '<li class="muted">' + trL(lang, 'No plan changes yet.', 'هنوز تغییری در برنامه‌ها ثبت نشده.') + '</li>'
  const plannedCount = d.devTasks.filter((t) => t.status === 'planned').length
  const COLS: { key: DevTaskRow['status'] | 'bug'; en: string; fa: string }[] = [
    { key: 'idea', en: 'New Ideas', fa: 'ایده‌های جدید' },
    { key: 'bug', en: 'Problems', fa: 'مشکلات' },
    { key: 'planned', en: 'Plans', fa: 'برنامه‌ها' },
    { key: 'in_progress', en: 'In Progress', fa: 'در حال انجام' },
    { key: 'done', en: 'Done', fa: 'انجام‌شده' },
  ]

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
  // S29 follow-up (user request 2026-09-12): the four priorities with their color coding —
  // the dropdown wording the owner asked for ("Urgent / High Priority / Medium Priority /
  // Low Priority") + a shared label for the meta line so the auto-sort reads at a glance.
  const PRIO_LABEL: Record<string, [string, string]> = {
    urgent: ['Urgent', 'فوری'],
    high: ['High Priority', 'اولویت بالا'],
    medium: ['Medium Priority', 'اولویت متوسط'],
    low: ['Low Priority', 'اولویت کم'],
  }
  const prioLabel = (p: string): string => {
    const pair = PRIO_LABEL[p] ?? PRIO_LABEL.medium
    return lang === 'fa' ? pair[1] : pair[0]
  }

  // S30 batch 4 (user request: "hover the project header strip → '3 urgent · 2 high ·
  // 5 medium'"): the bar's tooltip breaks the task pool down by priority tier. The
  // client repaints it live (pdTaskTruth in project-page.js) as tasks move.
  const tierCounts: Record<string, number> = {}
  for (const t of d.devTasks) tierCounts[t.priority || 'medium'] = (tierCounts[t.priority || 'medium'] ?? 0) + 1
  const tierTitle = ['urgent', 'high', 'medium', 'low']
    .filter((p) => tierCounts[p])
    .map((p) => `${dig(tierCounts[p])} ${prioLabel(p)}`)
    .join(' · ')
  // Per-task label chips — d.devTaskTags is the flat join; group once, render little
  // colored pills under the title (data-pd-tags carries the same JSON for the client).
  const tagsByTask = new Map<string, TaskTagJoin[]>()
  for (const row of d.devTaskTags) {
    const list = tagsByTask.get(row.task_id) ?? []
    list.push(row)
    tagsByTask.set(row.task_id, list)
  }
  const taskTagChips = (taskId: string): string => {
    const list = tagsByTask.get(taskId) ?? []
    if (!list.length) return ''
    return `<span class="pd-task-tags">${list
      .map((tg) => `<span dir="auto" class="pd-tag" data-pd-tag-name="${esc(tg.name)}"><i class="pd-tag-dot" style="background:${esc(tg.color)}"></i>${esc(tg.name)}</span>`)
      .join('')}</span>`
  }
  const taskTagsAttr = (taskId: string): string => {
    const list = tagsByTask.get(taskId) ?? []
    return esc(JSON.stringify(list.map((tg) => ({ name: tg.name, color: tg.color }))))
  }
  // Inline "Project Progress" board preview (user sketch 2026-08-29): the five columns
  // with their top cards — adding happens RIGHT HERE through the per-column inline
  // composer (user request 2026-08-29: "add tasks directly in project's page into boxes");
  // the full drag & drop board stays one click away.
  // Session 22 (user request): task titles are unlimited (server cap is a 100k sanity
  // guard). The progress boxes show the first 150 CHARACTERS; the rest lives in a
  // hidden .pd-title-rest span INSIDE the title element, so textContent (the magic
  // wand, inline editors, copy/export, undo) still reads the FULL title. A real
  // "read more" button (data-task-read-more) toggles the rest — project.html wires it.
  //
  // Session 23 (user request): titles may carry fenced ``` CODE blocks (inserted via
  // the composer toolbar or pasted), **bold** spans and manual line breaks. renderTitle
  // walks the ESCAPED string line-by-line: fence lines open/close a dedicated
  // <code class="t-code" dir="ltr"> container (monospace LTR island, data-lang label);
  // prose lines get **pair** → <strong>. The ``` fence LINES themselves are emitted as
  // <span hidden class="t-fence"> markers INSIDE the <code>, so the title element's
  // textContent still reads the RAW title EXACTLY — every textContent consumer
  // (editors' prefill, magic wand, copy/export, delete-undo) round-trips with zero
  // changes. Unclosed fences render as code till end-of-string (self-healing).
  // S46.8 (bullet list): `- `/`* ` prefixed lines → <ul><li> (mirrors chip-render.js).
  // S48d (owner: "fullscreen editor needs underline/strikethrough/ordered-list/
  // alignment"): added __underline__ → <u>, ~~strikethrough~~ → <s>, 1. ordered list
  // → <ol><li>, {:left}/{:center}/{:right}/{:justify} → <div style="text-align:…">.
  const TITLE_CLAMP = 150
  const renderTitle = (raw: string): string => {
    const escd = esc(raw)
    const hasFence = /(^|\n)\s*```/.test(escd)
    const hasBold = /\*\*[^*\n]+\*\*/.test(escd)
    const hasUnderline = /__[^_\n]+__/.test(escd)
    const hasStrike = /~~[^~\n]+~~/.test(escd)
    const hasBullet = /(^|\n)\s*[-*]\s+/.test(escd)
    const hasOrdered = /(^|\n)\s*\d+\.\s+/.test(escd)
    const hasAlign = /(^|\n)\s*\{:(?:left|center|right|justify)\}/.test(escd)
    if (!hasFence && !hasBold && !hasUnderline && !hasStrike && !hasBullet && !hasOrdered && !hasAlign) return escd
    // inline transforms shared by prose + list items (NOT code)
    const inline = (s: string): string => s
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<u>$1</u>')
      .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    const lines = escd.split('\n')
    let out = ''
    let inCode = false, inUl = false, inOl = false
    const closeUl = () => { if (inUl) { out += '</ul>'; inUl = false } }
    const closeOl = () => { if (inOl) { out += '</ol>'; inOl = false } }
    const closeLists = () => { closeUl(); closeOl() }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const nl = i < lines.length - 1 ? '\n' : ''
      if (!inCode && /^\s*```/.test(line)) {
        closeLists()
        inCode = true
        const codeLang = line.trim().slice(3).trim()
        out += `<code class="t-code"${codeLang ? ` data-lang="${codeLang}"` : ''} dir="ltr"><span hidden class="t-fence">${line}</span>`
      } else if (inCode && line.trim() === '```') {
        inCode = false
        out += `<span hidden class="t-fence">${line}</span></code>`
      } else if (inCode) {
        out += line // code content: verbatim (already escaped), no inline transforms
      } else {
        const am = line.match(/^(\s*)\{:(left|center|right|justify)\}(.*)$/)
        if (am) {
          closeLists()
          out += `<div style="text-align:${am[2]}">${inline(am[3])}</div>`
        } else {
          const bm = line.match(/^(\s*)(?:[-*])\s+(.*)$/)
          const om = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
          if (bm) {
            closeOl()
            if (!inUl) { out += '<ul>'; inUl = true }
            out += `<li>${inline(bm[2])}</li>`
          } else if (om) {
            closeUl()
            if (!inOl) { out += '<ol>'; inOl = true }
            out += `<li>${inline(om[3])}</li>`
          } else {
            closeLists()
            out += inline(line) + nl
          }
        }
      }
    }
    closeLists()
    if (inCode) out += '</code>'
    return out
  }
  // S48j: card shows ONLY the first line (the title). Full title+content is in
  //   data-raw-title (the editor reads it on open → splits on \n → title + content).
  const titleHtml = (title: string): string => {
    const nl = title.indexOf('\n')
    const titleOnly = nl >= 0 ? title.slice(0, nl) : title
    return titleOnly.length <= TITLE_CLAMP
      ? renderTitle(titleOnly)
      : renderTitle(titleOnly.slice(0, TITLE_CLAMP)) + `<span class="pd-title-rest" hidden>${renderTitle(titleOnly.slice(TITLE_CLAMP))}</span>`
  }
  // S86 (owner request): under the (now bolder, larger) heading, a LITTLE PREVIEW of
  // the task's content — the lines after the first \n, flattened, ~110 chars,
  // single-line ellipsis. Markup-only change: data-raw-title stays the source of
  // truth, the editor/clamp/read-more flows are untouched.
  const previewHtml = (title: string): string => {
    const nl = title.indexOf('\n')
    if (nl < 0) return ''
    const rest = title.slice(nl + 1).replace(/\s+/g, ' ').trim()
    if (!rest) return ''
    const PREVIEW_CLAMP = 110
    const cut = rest.length > PREVIEW_CLAMP
    return `<span class="pd-task-preview" dir="auto">${esc(rest.slice(0, PREVIEW_CLAMP))}${cut ? '…' : ''}</span>`
  }
  const titleAttrs = (title: string): string => (title.length > TITLE_CLAMP ? ' data-clamped=""' : '') + ` data-raw-title="${esc(title)}"`
  const readMoreBtn = (title: string): string =>
    title.length > TITLE_CLAMP
      ? `<button type="button" class="pd-read-more" data-task-read-more aria-expanded="false">${trL(lang, 'read more', 'بیشتر بخوان')}</button>`
      : ''

  // S105 (owner: "the Plans tab — whose count badge shows 5 — doesn't show current
  //   plans" + the two-concepts ruling: a PLAN is ALWAYS a kanban item in the
  //   project-progress Plans box; a PLAN DOCUMENT is a consolidated roadmap that can
  //   contain many tweaks). The tab now renders BOTH, clearly separated: the plan
  //   ITEMS the badge counts first, then the plan documents.
  const blPlans = d.devTasks
    .filter((t) => t.status === 'planned')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map(
      (t) => `<div class="bl-plan" data-bl-plan="${t.id}" data-raw-title="${esc(t.title)}">
        <span class="prio-dot prio-${t.priority || 'medium'}" title="${prioLabel(t.priority || 'medium')}"></span>
        <span class="bl-plan-main">
          <span class="bl-plan-title" dir="auto">${titleHtml(t.title)}</span>
          ${previewHtml(t.title)}
        </span>
        <span class="muted small bl-plan-date">${timeAgo(t.created_at, lang)}</span>
      </div>`,
    )
    .join('') || `<p class="muted small bl-plans-empty">${trL(lang, 'No plans yet — add one above; it lands in the Plans box of the progress board.', 'هنوز برنامه‌ای نیست — بالا یکی اضافه کن؛ در جعبهٔ «برنامه‌ها» تابلوی پیشرفت می‌نشیند.')}</p>`

  const boardPreview = `
  <section class="card pd-board" id="pd-board" data-total="${d.devTasks.length}" data-done="${doneTasks}">
    <div class="row spread pd-board-head">
      <h3>${icon('kanban')} ${trL(lang, 'Project Progress', 'پیشرفت پروژه')}</h3>
      <div class="row">
        <!-- S33 (user request 2026-09-13): the «اسپرینت جدید» CTA — a PROMINENT (solid,
             brand-colored) button, first in the head row. Opens the new-sprint dialog
             (name + version + description → create → «ورود به اسپرینت» → the full-screen
             rich sprint editor). project-page.js wires [data-pd-new-sprint]. -->
        <button type="button" class="small pd-new-sprint" data-pd-new-sprint title="${trL(lang, 'Define the next sprint — name, version and plan', 'اسپرینت بعدی را تعریف کن — نام، نسخه و برنامه')}">${icon('diamond')} ${trL(lang, 'New sprint', 'اسپرینت جدید')}</button>
        <a class="btn ghost small" href="/board.html?project=${p.id}">${icon('expand')} ${trL(lang, 'Full screen board', 'برد تمام‌صفحه')}</a>
        <a class="btn ghost small" href="/sprint.html?project=${p.id}">${icon('diamond')} ${trL(lang, 'Sprints', 'اسپرینت‌ها')}${d.sprints.length ? ` <span class="pd-sprint-count">${dig(d.sprints.length)}</span>` : ''}</a>
      </div>
    </div>
    <!-- S30 batch 2 (user request): the filter-bar mount — project-page.js builds the
         priority × label toggles here from the API truth payload (the DOM only renders
         5 per column, so the label list can't come from markup). -->
    <div class="db-filter pd-filter" data-pd-filter hidden></div>
    ${d.devTasks.length === 0
      ? `<div class="pd-board-empty empty-state empty" data-pd-empty>
          <span class="empty-state-icon" aria-hidden="true">${icon('kanban')}</span>
          <p class="empty-state-title">${trL(lang, 'No tasks yet', 'هنوز کاری نیست')}</p>
          <p class="empty-state-text">${trL(lang, 'Serious development tasks live here — from first idea to launched. Add one with the ＋ on a column below.', 'کارهای جدیِ توسعه اینجا زندگی می‌کنند — از اولین ایده تا عرضه. یکی را با ＋ پایین اضافه کن.')}</p>
        </div>`
      : ''}
    <div class="pd-board-grid">${COLS.map((col) => {
          const items = d.devTasks.filter((t) => t.status === col.key)
          const MAX_VISIBLE = 5 // Session 19 (user request): was 3 — show up to 5 per column
          const top = items.slice(0, MAX_VISIBLE)
          const hiddenCount = items.length - MAX_VISIBLE
          return `<div class="pd-col" id="pd-col-${col.key}" data-status="${col.key}">
            <div class="pd-col-head"><span class="pd-col-title">${trL(lang, col.en, col.fa)}</span><span class="detail-tab-count" data-pd-count="${col.key}" data-n="${items.length}">${dig(items.length)}</span>
              <span class="pd-col-actions">
                ${col.key === 'done' ? `<button type="button" class="ghost small" data-pd-archive-done title="${trL(lang, 'Archive done tasks', 'بایگانی کارهای انجام‌شده')}" aria-label="${trL(lang, 'Archive done tasks', 'بایگانی کارهای انجام‌شده')}">${icon('archive')}</button>` : ''}
                <button type="button" class="ghost small" data-pd-copy="${col.key}" title="${trL(lang, 'Copy items as bullet points', 'کپی موارد به صورت بولت')}" aria-label="${trL(lang, 'Quick copy', 'کپی سریع')}">${icon('clipboard')}</button>
                <button type="button" class="ghost small" data-pd-export="${col.key}" title="${trL(lang, 'Export as Markdown', 'خروجی مارک‌داون')}" aria-label="${trL(lang, 'Export Markdown', 'خروجی مارک‌داون')}">${icon('download')}</button>
              </span>
            </div>
            <div class="pd-tasks" data-pd-tasks="${col.key}" data-pd-total="${items.length}">
              ${top.map((t) => `<div class="pd-task-wrap" data-pd-task="${t.id}" data-pd-status="${t.status}" data-pd-created="${t.created_at}" data-pd-priority="${t.priority}" data-pd-tags="${taskTagsAttr(t.id)}"${t.done_at ? ` data-pd-done="${t.done_at}"` : ''}>
                <div class="pd-task st-${t.status}" draggable="true" role="button" tabindex="0" aria-label="${esc(t.title)}">
                  <span class="pd-task-body">
                    <span class="pd-task-title-row" dir="auto">
                      <button type="button" class="prio-dot-btn" data-pd-cycle-prio title="${esc(trL(lang, 'Priority: {p} — click to change', 'اولویت: {p} — برای تغییر کلیک کن', { p: prioLabel(t.priority) }))}" aria-label="${esc(trL(lang, 'Priority: {p} — click to change', 'اولویت: {p} — برای تغییر کلیک کن', { p: prioLabel(t.priority) }))}"><span class="prio-dot prio-${t.priority}"></span></button>
                      <span class="pd-task-title"${titleAttrs(t.title)}>${titleHtml(t.title)}</span>
                    </span>
                    ${previewHtml(t.title)}
                    ${readMoreBtn(t.title)}
                    ${taskTagChips(t.id)}
                    <span class="pd-task-meta"><span class="pd-meta-prio prio-${t.priority}">${esc(prioLabel(t.priority))}</span> · ${taskMetaLabel(t)}${pinsByTask.has(t.id) ? ` · <button type="button" class="pd-task-shots" data-pd-shots="${t.id}" title="${esc(trL(lang, 'Pinned pictures — note + proof stuck to this item', 'تصاویر سنجاق‌شده — یادداشت + مدرکِ سنجاق‌شده به این قلم'))}" aria-label="${esc(trL(lang, 'Pinned pictures ({n})', 'تصاویر سنجاق‌شده ({n})', { n: dig(pinsByTask.get(t.id)!) }))}">${icon('pin')} ${dig(pinsByTask.get(t.id)!)}</button>` : ''}</span>
                  </span>
                </div>
              </div>`).join('')}
              ${hiddenCount > 0 ? `<button type="button" class="pd-more-link" data-pd-more="${col.key}">+${dig(hiddenCount)} ${trL(lang, 'more', 'بیشتر')}</button>` : ''}
            </div>
            <button type="button" class="pd-task-add" data-pd-add="${col.key}">${icon('plus')} ${trL(lang, 'Add', 'افزودن')}</button>
          </div>`
        }).join('')}</div>
  </section>

  <!-- Project Archives (user request 2026-09): archived done tasks. Loaded lazily by
       project.html (GET /api/projects/:id/archives) when the section is scrolled into view
       or the user clicks the header. Restore + permanent delete. -->
  <section class="card pd-section" id="pd-archives-section">
    <div class="row spread pd-archives-head">
      <h3>${trL(lang, 'Project archives', 'بایگانی پروژه')}</h3>
      <button type="button" class="ghost small" id="pd-archives-toggle" data-pd-archives-toggle>${icon('archive')} ${trL(lang, 'Show archives', 'نمایش بایگانی')}</button>
    </div>
    <div class="pd-archives-list" id="pd-archives-list" hidden></div>
  </section>`

  const tagChips = d.tags
    .map((tg) => `<span dir="auto" class="chip pd-tag-chip" data-tag-chip="${tg.id}">${esc(tg.name)} <button type="button" class="ghost danger pd-tag-x" data-tag-remove="${tg.id}" aria-label="${trL(lang, 'Remove tag', 'حذف برچسب')}">${icon('x')}</button></span>`)
    .join('')

  return `
  <header class="card pd-head">
    <div class="row spread pd-head-main">
      <div class="row pd-head-left">
        ${p.logo_path ? `<div class="pd-logo-wrap"><img class="pd-logo" src="/api/projects/${p.id}/logo/file" alt="${esc(p.title)} logo" loading="lazy" decoding="async" /><button type="button" class="ghost small danger pd-logo-remove" data-pd-logo-remove="${p.id}" title="${trL(lang, 'Remove logo', 'حذف لوگو')}" aria-label="${trL(lang, 'Remove logo', 'حذف لوگو')}">${icon('trash')}</button></div>` : `<div class="pd-logo-placeholder" data-pd-logo-upload data-hint="${trL(lang, 'Add logo', 'افزودن لوگو')}" title="${trL(lang, 'Add logo', 'افزودن لوگو')}">${icon('image')}</div>`}
        <h1 id="pd-title" title="${trL(lang, 'Click to edit', 'برای ویرایش کلیک کن')}">${esc(p.title)}<button type="button" class="pd-title-pen" data-edit-title aria-label="${trL(lang, 'Edit title', 'ویرایش عنوان')}">${icon('pencil')}</button></h1>
        <span id="pd-stage-badge">${STATUS_BADGE(p.status, lang)}</span>
      </div>
      <div class="row pd-head-actions">
        <label class="sr-only" for="pd-stage">${trL(lang, 'Stage', 'مرحله')}</label>
        <select id="pd-stage" class="pd-stage-select" data-project-id="${p.id}" title="${trL(lang, 'Stage — saved on change', 'مرحله — با تغییر ذخیره می‌شود')}">
          ${STATUS_ORDER.map((k) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${statusLabel(k, lang)}</option>`).join('')}
        </select>
        <a class="btn small" id="pd-stage-save" href="/projects.html" data-project-id="${p.id}">${icon('check')} ${trL(lang, 'Save', 'ذخیره')}</a>
        ${p.archived_state === 'offline'
          ? `<button type="button" class="btn small" data-pd-unarchive data-project-id="${p.id}" title="${trL(lang, 'Put it back on your boards', 'برگرداندن به برد‌هایت')}">${icon('archive')} ${trL(lang, 'Restore', 'بازگردانی')}</button>`
          : `<button type="button" class="btn ghost small" data-pd-archive data-project-id="${p.id}" title="${trL(lang, 'Park this idea/project for later — kept safe, restorable any time, not deleted', 'این ایده/پروژه را برای بعد کنار بگذار — سالم می‌ماند، هر وقت خواستی بازگردانی می‌شود، حذف نمی‌شود')}">${icon('archive')} ${trL(lang, 'Archive', 'بایگانی')}</button>`}
        <button class="btn danger small" hx-delete="/api/projects/${p.id}" hx-confirm="${trL(lang, 'Delete this project?', 'این پروژه حذف شود؟')}" hx-target="#project-body" hx-swap="innerHTML">${icon('trash')} ${trL(lang, 'Delete', 'حذف')}</button>
      </div>
    </div>
    ${p.archived_state === 'offline' ? `<div class="pd-archived-banner" role="status">
      ${icon('archive')} <span>${trL(lang, 'Archived — parked, not deleted. It stays out of your lists until you restore it.', 'بایگانی‌شده — کنار گذاشته، نه حذف. تا بازگردانیش از لیست‌هایت بیرون می‌ماند.')}</span>
      <a class="ghost small" href="/archive.html">${trL(lang, 'See the Archive', 'دیدن آرشیو')}</a>
    </div>` : ''}
    <textarea id="pd-desc" rows="1" maxlength="2000" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'Short description here…', 'توضیح کوتاه اینجا…')}">${esc(p.description)}</textarea>
    <div class="muted small" id="pd-desc-status" aria-live="polite"></div>
    <div class="row spread pd-head-bottom">
      <div class="row pd-tags" id="pd-tags">
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
      <div class="row small muted pd-meta">
        <span data-pd-meta>${trL(lang, p.type, p.type === 'client' ? 'مشتری' : 'شخصی')} · ${trL(lang, 'created {x}', 'ساخت {x}', { x: timeAgo(p.created_at, lang) })}<span data-pd-tasks-line ${d.devTasks.length ? '' : 'hidden'}> · ${trL(lang, '{n} of {m} tasks done', '{n} از {m} کار انجام شد', { n: dig(doneTasks), m: dig(d.devTasks.length) })}</span></span>
        <span class="row">${progressBar(pct).replace('<span ', `<span data-pd-bar title="${tierTitle}" `)} <b data-pd-pct-sr class="sr-only">${dig(pct)}%</b></span>
      </div>
    </div>
  </header>

  ${boardPreview}

  <!-- Batch (p) 2026-09-06: tab priority reordered by the user — یادداشت‌ها › مشکل‌ها ›
       برنامه آتی › پیوندها › اسکرین‌شات › آخرین تغییرات. The «تغییرات» (changelog file
       upload) tab is GONE; the new برنامه آتی tab takes its slot. -->
  <div class="detail-tabs" role="tablist" aria-label="${trL(lang, 'Project sections', 'بخش‌های پروژه')}">
    <button type="button" class="detail-tab is-active" role="tab" aria-selected="true" aria-controls="detail-notes" data-detail-tab="notes" tabindex="0">${trL(lang, 'Notes', 'یادداشت‌ها')}</button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-problems" data-detail-tab="problems" tabindex="-1">${trL(lang, 'Problems', 'مشکل‌ها')} <span class="detail-tab-count" data-tab-count="problems" data-n="${bugTasks.length}">${dig(bugTasks.length)}</span></button>
    <button type="button" class="detail-tab" role="tab" aria-selected="false" aria-controls="detail-backlog" data-detail-tab="backlog" tabindex="-1">${trL(lang, 'Plans', 'برنامه‌ها')} <span class="detail-tab-count" data-tab-count="backlog" data-n="${plannedCount}">${dig(plannedCount)}</span></button>
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
      <div class="row pd-note-actions"><button type="submit">${trL(lang, 'Save note', 'ذخیره یادداشت')}</button><button type="button" class="ghost small danger" data-note-clear title="${trL(lang, 'Clear the note', 'پاک کردن یادداشت')}">${icon('x')} ${trL(lang, 'Clear', 'پاک‌کردن')}</button><button type="button" class="ghost small" data-note-expand title="${trL(lang, 'Open a larger editor', 'باز کردن ویرایشگر بزرگ‌تر')}">${icon('expand')} ${trL(lang, 'Expand', 'بزرگ‌نمایی')}</button><span class="muted small" id="note-status" hidden></span></div>
    </form>
    <h3 style="margin-block-start:1.5rem">${trL(lang, 'Related notes ({n})', 'یادداشت‌های مرتبط ({n})', { n: dig(d.notes.length) })}</h3>
    <ul class="links related-notes">${relatedNotes}</ul>
  </section>

  <section class="card detail-panel" id="detail-problems" role="tabpanel" data-detail-panel="problems" hidden>
    <h3>${trL(lang, 'Problems', 'مشکل‌ها')}</h3>
    <p class="muted small">${trL(lang, 'Bugs and blockers — the exact same items as the Problems box on the board. Solving one moves it to Done.', 'باگ و مانع — دقیقاً همان موارد جعبهٔ «مشکلات» روی برد. با حل‌شدن، به «انجام‌شده» می‌رود.')}</p>
    <ul class="hurdles" id="problems">${problemsList}</ul>
    <!-- S30 batch 2 (user request): the bulk bug-add composer gets a PRIORITY picker —
         the flow used to default every line to medium. One picker, applied to all the
         lines in the batch (the per-task editor can still diverge them afterwards). -->
    <form class="row note-compose" data-problem-add>
      <textarea class="note-compose-text" name="text" rows="2" maxlength="5000" autocomplete="off" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'Type it and press Enter — each line becomes a problem in the board’s Problems box', 'بنویس و Enter بزن — هر خط یک مشکل می‌شود و خودکار در جعبهٔ «مشکلات» می‌نشیند')}"></textarea>
      <select name="priority" class="pd-problem-prio pd-prio-select" aria-label="${trL(lang, 'Priority for the new problems', 'اولویت مشکلات جدید')}" title="${trL(lang, 'Priority for the new problems', 'اولویت مشکلات جدید')}">
        <option class="prio-urgent" value="urgent">${prioLabel('urgent')}</option>
        <option class="prio-high" value="high">${prioLabel('high')}</option>
        <option class="prio-medium" value="medium" selected>${prioLabel('medium')}</option>
        <option class="prio-low" value="low">${prioLabel('low')}</option>
      </select>
      <button type="submit" class="ghost" aria-label="${trL(lang, 'Add problem', 'افزودن مشکل')}">${icon('plus')}</button>
    </form>
  </section>

  <section class="card detail-panel" id="detail-backlog" role="tabpanel" data-detail-panel="backlog" hidden>
    <h3>${trL(lang, 'Plans', 'برنامه‌ها')}</h3>
    <p class="muted small">${trL(lang, 'Two kinds: a PLAN is a single task/tweak in the Plans box of the progress board; a PLAN DOCUMENT consolidates many tweaks into one roadmap with a change history.', 'دو جور است: «برنامه» یک قلم تک در جعبهٔ «برنامه‌ها» تابلوی پیشرفت است؛ «سند برنامه» چند ترفع را در یک نقشهٔ راه با تاریخچهٔ تغییر جمع می‌کند.')}</p>

    <form class="pd-quick-add bl-item-form" data-bl-item>
      <input name="title" maxlength="300" dir="auto" autocomplete="off" placeholder="${trL(lang, '− Fix the dashboard CSS problems…', '− رفع مشکلات CSS داشبورد…')}" aria-label="${trL(lang, 'Plan item', 'قلم برنامه')}">
      <button type="submit" class="ghost" aria-label="${trL(lang, 'Add item', 'افزودن قلم')}">${icon('plus')}</button>
    </form>
    <p class="muted small bl-hint">${trL(lang, 'Every item lands in the Plans box above — ideas still need a review before they join the plan.', 'هر قلم بلافاصله در جعبهٔ «برنامه‌ها» بالا می‌نشیند — ایده‌ها پیش از ورود به برنامه بازبینی و انتخاب می‌شوند.')}</p>

    <!-- S105: THE PLANS THEMSELVES — the kanban items the tab badge counts. The
         tab used to show only plan documents, so a “Plans 5” badge over an empty
         panel read as broken. -->
    <h4 class="bl-sub" data-bl-plans-head>${trL(lang, 'Plans', 'برنامه‌ها')} <span class="muted small">· ${trL(lang, 'box items', 'قلم‌های جعبه')} <span data-bl-plans-count>${dig(plannedCount)}</span></span></h4>
    <div class="bl-plans" data-bl-plans>${blPlans}</div>

    <h4 class="bl-sub">${trL(lang, 'Plan documents', 'اسناد برنامه')}</h4>
    <div class="bl-docs" data-bl-docs>${blDocs}</div>

    <button type="button" class="pd-task-add" data-bl-newdoc>${icon('plus')} ${trL(lang, 'New plan document', 'سند جدید برنامه')}</button>

    <form class="bl-doc-form" data-bl-docform hidden>
      <input name="title" maxlength="200" dir="auto" autocomplete="off" placeholder="${trL(lang, 'Document title — e.g. Backlog of V 12.1', 'عنوان سند — مثلاً برنامهٔ نسخهٔ ۱۲٫۱')}" required>
      <textarea name="content" rows="8" maxlength="50000" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'The full plan — everything that has to be done…', 'برنامهٔ کامل — همهٔ کارهایی که باید انجام شود…')}"></textarea>
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
    <h3>${trL(lang, 'Screenshots — UI/UX problems', 'اسکرین‌شات‌ها — مشکلات UI/UX')}</h3>
    <p class="muted small">${trL(lang, 'Snap what looks broken (button, file picker, gallery), drop it here or paste it, then write the note on the card — what & where to work. Fix it and check it off.', 'از چیزهای خراب عکس بگیر (دکمه، فایل‌پیکر، گالری)، همین‌جا رها کن یا پیست کن، بعد روی کارت یادداشتش را بنویس — چه چیزی و کجا. درستش که شد تیکش را بزن.')}</p>
    <input type="file" id="shot-input" accept=".pdf,.csv,.xlsx,.docx,.md,.txt,image/png,image/jpeg,image/webp,image/gif" multiple hidden>
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
      <textarea id="pd-editor-textarea" rows="20" maxlength="50000" dir="${lang === 'fa' ? 'rtl' : 'auto'}" autocomplete="off"></textarea>
      <div class="row pd-editor-footer">
        <span class="muted small" id="pd-editor-hint"></span>
        <span class="grow"></span>
        <button type="submit" id="pd-editor-save">${trL(lang, 'Save', 'ذخیره')}</button>
        <button type="button" class="ghost" id="pd-editor-cancel">${trL(lang, 'Cancel', 'لغو')}</button>
      </div>
    </form>
  </dialog>

  <!-- Modal task composer (user request 2026-09-15): the «افزودن» button in each progress
       column used to reveal a one-line inline input — long sentences only showed a few
       words while typing. It now opens THIS dialog: a wide multi-line textarea where the
       whole sentence stays visible. Session 22 (user request): the dialog now actually
       OPENS at 78rem (a CSS specificity bug had it stuck at 26rem — see app.css), the
       textarea is 18rem min + user-resizable, and the title is UNLIMITED — the "۰ / ۳۰۰"
       counter is gone (the 300 cap is lifted end-to-end). Enter adds, Esc / Cancel / ✕
       close. Session 23 (user request): (a) dir follows the UI locale — fa → rtl (an
       auto-detected LTR made Farsi writing read backwards; code blocks stay LTR islands
       at RENDER time), (b) a formatting toolbar (Code block / Bold / Bullet) inserts
       triple-backtick fences, **pairs** and "- " prefixes — newlines are now PRESERVED
       on submit (titles render multi-line; the problems-box composer still splits
       lines into separate tasks by design). Same POST + insertTaskChip path as before;
       project.html's delegated JS wires it (click-time lookups — the dialog re-renders
       with every htmx swap of #project-body). -->
  <dialog id="pd-taskadd-modal" class="dialog pd-taskadd-modal" aria-labelledby="pd-taskadd-title">
    <form class="modal pd-taskadd-inner" id="pd-taskadd-form" novalidate>
      <div class="row spread pd-editor-head">
        <h3 id="pd-taskadd-title">${trL(lang, 'Create a new task', 'ایجاد یک کار جدید')}</h3>
        <button type="button" class="ghost" id="pd-taskadd-close" aria-label="${trL(lang, 'Close', 'بستن')}">${icon('x')}</button>
      </div>
      <!-- S89 (owner item: the "Create a new task" modal's scroll fix): everything
           between the header and the footer lives in ONE scroll region
           (.pd-modal-body, overflow-y auto) — the header (title + ✕) and the footer
           (Add/Cancel) never scroll away, however long the content or how many files
           are staged. The dialog + form are overflow:hidden flex columns. -->
      <div class="pd-modal-body">
      <div class="pd-taskadd-col muted small">${trL(lang, 'Lands in', 'ثبت در')} <span class="chip" id="pd-taskadd-col-chip"></span></div>
      <div class="pd-tb" role="toolbar" aria-label="${trL(lang, 'Formatting', 'قالب‌بندی')}">
        <button type="button" class="pd-tb-btn" data-tb="bold" title="${trL(lang, 'Bold (**text**)', 'پررنگ (**متن**)')}" aria-label="${trL(lang, 'Bold', 'پررنگ')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h6a3.5 3.5 0 1 1 0 7H7zM7 12h7a3.5 3.5 0 1 1 0 7H7z"/></svg></button>
        <button type="button" class="pd-tb-btn" data-tb="underline" title="${trL(lang, 'Underline (__text__)', 'زیرخط (__متن__)')}" aria-label="${trL(lang, 'Underline', 'زیرخط')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v5a5 5 0 0 0 10 0V4"/><path d="M5 19h14"/></svg></button>
        <button type="button" class="pd-tb-btn" data-tb="strikethrough" title="${trL(lang, 'Strikethrough (~~text~~)', 'خط‌خورده (~~متن~~)')}" aria-label="${trL(lang, 'Strikethrough', 'خط‌خورده')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M16 8a4 4 0 0 0-4-2c-2 0-3.5 1-3.5 2.5M8 16a4 4 0 0 0 4 2c2 0 3.5-1 3.5-2.5"/></svg></button>
        <span class="pd-tb-sep" aria-hidden="true"></span>
        <button type="button" class="pd-tb-btn" data-tb="list" title="${trL(lang, 'Bullet list', 'بولت')}" aria-label="${trL(lang, 'Bullet list', 'بولت')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg></button>
        <button type="button" class="pd-tb-btn" data-tb="ordered-list" title="${trL(lang, 'Numbered list', 'فهرست شماره‌دار')}" aria-label="${trL(lang, 'Numbered list', 'فهرست شماره‌دار')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 5h.01M4 4.5v4M3.5 16h1a1 1 0 0 0 0-2h-.5a1 1 0 0 1 0-2H5" stroke-width="1.5" stroke-linecap="round"/></svg></button>
        <span class="pd-tb-sep" aria-hidden="true"></span>
        <button type="button" class="pd-tb-btn" data-tb="align-left" title="${trL(lang, 'Align left', 'چپ‌چین')}" aria-label="${trL(lang, 'Align left', 'چپ‌چین')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg></button>
        <button type="button" class="pd-tb-btn" data-tb="align-center" title="${trL(lang, 'Align center', 'وسط‌چین')}" aria-label="${trL(lang, 'Align center', 'وسط‌چین')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M6 10h12M6 14h12M4 18h16"/></svg></button>
        <button type="button" class="pd-tb-btn" data-tb="align-right" title="${trL(lang, 'Align right', 'راست‌چین')}" aria-label="${trL(lang, 'Align right', 'راست‌چین')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg></button>
        <button type="button" class="pd-tb-btn" data-tb="align-justify" title="${trL(lang, 'Justify', 'هم‌تراز')}" aria-label="${trL(lang, 'Justify', 'هم‌تراز')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg></button>
        <span class="pd-tb-sep" aria-hidden="true"></span>
        <button type="button" class="pd-tb-btn" data-tb="code" title="${trL(lang, 'Code block (```…```)', 'بلوک کد (```…```)')}" aria-label="${trL(lang, 'Code block', 'بلوک کد')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg></button>
      </div>
      <label>${trL(lang, 'Title', 'عنوان')} <input type="text" id="pd-taskadd-title-input" class="pde-title-field" dir="auto" data-magic="" placeholder="${trL(lang, 'e.g. UI/UX Tweaks', 'مثلاً بهینه‌سازی رابط کاربری')}" /></label>
      <div class="pde-field"><span class="pde-field-label">${trL(lang, 'Content', 'محتوا')}</span><div id="pd-taskadd-textarea" contenteditable="true" role="textbox" aria-multiline="true" dir="${lang === 'fa' ? 'rtl' : 'auto'}" aria-label="${trL(lang, 'Task content', 'محتوای کار')}" data-magic="" data-placeholder="${trL(lang, 'Write the task — long sentences and code blocks are welcome…', 'کار را بنویس — جمله‌های بلند و بلوک‌های کد جای دارند…')}" class="pde-edit-area"></div></div>
      <!-- S31b: the RTL dir stays the FA typing default (caret/empty line), while
           polish-batch.css sets unicode-bidi: plaintext on this textarea — each
           RENDERED line resolves its own direction (English lines LTR, Farsi lines
           RTL), the GitHub-textarea recipe. The old whole-value dir="auto" flip is
           gone; the mangled-Latin-display class is gone too. -->
      <!-- S29 follow-up (user request 2026-09-12): Priority dropdown + Labels on the task
           composer — the task lands in its box ALREADY prioritized (color-coded, options
           ordered urgent → low) and labeled; the boxes then auto-sort by the chosen
           priority. The chip mirrors the select (a live color preview) — plain <option>
           styling varies by browser, the chip is the guaranteed color signal. -->
      <div class="row pd-taskadd-opts">
        <label class="pd-opt">${trL(lang, 'Status', 'وضعیت')}
          <select id="pd-taskadd-status" class="pd-prio-select">
            <option value="idea">${trL(lang, 'New Ideas', 'ایده‌های جدید')}</option>
            <option value="bug">${trL(lang, 'Problems', 'مشکلات')}</option>
            <option value="planned">${trL(lang, 'Plans', 'برنامه‌ها')}</option>
            <option value="in_progress">${trL(lang, 'In Progress', 'در حال انجام')}</option>
            <option value="done">${trL(lang, 'Done', 'انجام‌شده')}</option>
          </select>
        </label>
        <label class="pd-opt">${trL(lang, 'Priority', 'اولویت')}
          <span class="pd-prio-row">
            <select id="pd-taskadd-priority" class="pd-prio-select">
              <option value="urgent" class="prio-urgent">${trL(lang, 'Urgent', 'فوری')}</option>
              <option value="high" class="prio-high">${trL(lang, 'High Priority', 'اولویت بالا')}</option>
              <option value="medium" class="prio-medium" selected>${trL(lang, 'Medium Priority', 'اولویت متوسط')}</option>
              <option value="low" class="prio-low">${trL(lang, 'Low Priority', 'اولویت کم')}</option>
            </select>
            <span class="pd-prio-chip" id="pd-taskadd-prio-chip" aria-hidden="true"><span class="prio-dot prio-medium"></span><span class="pd-prio-chip-label">${trL(lang, 'Medium Priority', 'اولویت متوسط')}</span></span>
          </span>
        </label>
        <label class="pd-opt">${trL(lang, 'Labels', 'برچسب‌ها')}
          <input id="pd-taskadd-tags" dir="${lang === 'fa' ? 'rtl' : 'auto'}" autocomplete="off" maxlength="480" aria-label="${trL(lang, 'Labels', 'برچسب‌ها')}" placeholder="${trL(lang, 'e.g. UI/UX, Security', 'مثلاً UI/UX، امنیت')}" />
          <span class="muted small">${trL(lang, 'Comma-separated — a chip per label', 'با کاما جدا کن — یک چیپ برای هر برچسب')}</span>
        </label>
        <label class="pd-opt">${trL(lang, 'Sprint', 'اسپرینت')}
          <select id="pd-taskadd-sprint" class="pd-prio-select">
            <option value="">${trL(lang, 'Auto (active sprint)', 'خودکار (اسپرینت فعال)')}</option>
            ${d.sprints.filter((s) => !s.ended_at).map((s) => `<option value="${s.id}">${esc(s.name)}${s.is_draft ? ' ' + trL(lang, '(draft)', '(پیش‌نویس)') : ''}</option>`).join('')}
            <option value="none">${trL(lang, 'No sprint', 'بدون اسپرینت')}</option>
          </select>
        </label>
      </div>
      <!-- S46.3 (owner mockup: "Screenshots Uploaded and shown in the same page. ability to
           delete screenshot, or edit it's note"): screenshots now upload IMMEDIATELY on
           pick (POST, no task_id yet) + render as inline thumbnails in #pd-taskadd-shots-grid
           (each with a delete ✕ + a note-edit button). On submit they're pinned to the new
           task (PATCH taskId); on cancel they're deleted (cleanup). project-page.js owns the
           stagedShots[] state + the render/delete/edit-note/pin/cleanup lifecycle. -->
      <div class="pd-taskadd-shots">
        <input type="file" id="pd-taskadd-shots" accept=".pdf,.csv,.xlsx,.docx,.md,.txt,image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        <div class="row" style="gap:.4rem;align-items:center;margin-top:.5rem">
          <button type="button" class="ghost small" onclick="document.getElementById('pd-taskadd-shots').click()" title="${trL(lang, 'Upload a screenshot or file — images, PDF, Excel, Word, Markdown, text — pinned to this item', 'اسکرین‌شات یا فایل آپلود کن — تصویر، PDF، اکسل، ورد، مارک‌داون، متن — سنجاق‌شده به این قلم')}">${icon('attach')} ${trL(lang, 'Upload screenshot', 'آپلود اسکرین‌شات')}</button>
          <!-- S61: the old «در حال اپلود تصویر …» span is gone — project-page.js mounts a
               .shots-upload-strip with per-file progress bars right above the grid. -->
          <span class="muted small" id="pd-taskadd-shots-count"></span>
        </div>
        <div class="pd-taskadd-shots-grid" id="pd-taskadd-shots-grid"></div>
      </div>
      <div class="row spread">
        <span class="muted small">${trL(lang, 'Unlimited length · newlines kept', 'بدون محدودیت طول · خطوط حفظ می‌شوند')}</span>
        <span class="muted small">${trL(lang, 'Enter adds · Shift+Enter new line · Esc closes', 'Enter برای افزودن · Shift+Enter خط جدید · Esc برای بستن')}</span>
      </div>
      <p class="error" id="pd-taskadd-error" role="alert" hidden></p>
      </div>
      <div class="row pd-taskadd-actions">
        <button type="submit" id="pd-taskadd-save">${icon('plus')} ${trL(lang, 'Add', 'افزودن')}</button>
        <button type="button" class="ghost" id="pd-taskadd-cancel">${trL(lang, 'Cancel', 'لغو')}</button>
      </div>
    </form>
  </dialog>

  <!-- S33 (user request 2026-09-13): the «اسپرینت جدید» flow. The CTA in the board head
       opens THIS dialog: sprint name + version number + a description box. Create POSTs
       /api/projects/:id/sprints (a DRAFT, 0034) — then the dialog flips to the "created"
       view whose big button ENTERS the sprint (the full-screen editor below). When a
       draft already exists (409 draft_exists) project-page.js prefills THIS SAME form and
       the save button PATCHes the existing draft instead. All lookups at click time —
       the dialog re-renders with every htmx swap of #project-body. -->
  <dialog id="pd-sprintnew-modal" class="dialog pd-sprintnew-modal" aria-labelledby="pd-sprintnew-title">
    <form class="modal pd-sprintnew-inner" id="pd-sprintnew-form" novalidate>
      <div class="row spread pd-editor-head">
        <h3 id="pd-sprintnew-title">${trL(lang, 'New sprint', 'اسپرینت جدید')}</h3>
        <button type="button" class="ghost" id="pd-sprintnew-close" aria-label="${trL(lang, 'Close', 'بستن')}">${icon('x')}</button>
      </div>
      <div id="pd-sprintnew-fields" class="pd-sprintnew-fields">
        <label class="pd-opt">${trL(lang, 'Sprint name', 'نام اسپرینت')}
          <input id="pd-sprintnew-name" dir="auto" autocomplete="off" maxlength="80" placeholder="${trL(lang, 'e.g. Payments flow', 'مثلاً فرآیند پرداخت')}" aria-label="${trL(lang, 'Sprint name', 'نام اسپرینت')}">
        </label>
        <label class="pd-opt">${trL(lang, 'Version number', 'شمارهٔ نسخه')}
          <!-- data-no-fa-digits (hib-init's opt-out): a version label is a code-like token
               ("12.1.0" — monospace chip, semantic-versioning conventions) — it stays
               Latin-form even while typing Farsi around it. -->
          <input id="pd-sprintnew-version" dir="auto" autocomplete="off" inputmode="text" maxlength="40" data-no-fa-digits placeholder="${trL(lang, 'e.g. 12.1', 'مثلاً 12.1')}" aria-label="${trL(lang, 'Version number', 'شمارهٔ نسخه')}">
        </label>
        <label class="pd-opt">${trL(lang, 'Description', 'توضیح')}
          <textarea id="pd-sprintnew-desc" rows="6" maxlength="100000" dir="${lang === 'fa' ? 'rtl' : 'auto'}" placeholder="${trL(lang, 'What is this sprint about? A sentence now — the full plan lives in the editor.', 'این اسپرینت دربارهٔ چیست؟ الان یک جمله — برنامهٔ کامل در ویرایشگر.')}" aria-label="${trL(lang, 'Description', 'توضیح')}"></textarea>
        </label>
        <p class="muted small" id="pd-sprintnew-hint">${trL(lang, 'Born as a draft — start it later from the sprint timeline.', 'به‌صورت پیش‌نویس ساخته می‌شود — بعداً از تایم‌لاین اسپرینت شروعش کن.')}</p>
      </div>
      <p class="error" id="pd-sprintnew-error" role="alert" hidden></p>
      <div class="row pd-sprintnew-actions" id="pd-sprintnew-actions">
        <button type="submit" id="pd-sprintnew-save">${icon('diamond')} <span id="pd-sprintnew-save-label">${trL(lang, 'Create sprint', 'ساخت اسپرینت')}</span></button>
        <button type="button" class="ghost" id="pd-sprintnew-cancel">${trL(lang, 'Cancel', 'لغو')}</button>
      </div>
      <div id="pd-sprintnew-done" class="pd-sprintnew-done" hidden>
        <p class="pd-sprintnew-done-title"><span class="pd-sprintnew-check" aria-hidden="true">✓</span> ${trL(lang, 'Sprint created', 'اسپرینت ساخته شد')}</p>
        <p class="pd-sprintnew-done-name" id="pd-sprintnew-done-name" dir="auto"></p>
        <p class="muted small">${trL(lang, 'Now write its plan — tasks, decisions, code. Everything is saved as you type.', 'حالا برنامه‌اش را بنویس — کارها، تصمیم‌ها، کد. همه‌چیز هم‌زمان با نوشتن ذخیره می‌شود.')}</p>
        <div class="row pd-sprintnew-actions">
          <button type="button" class="pd-sprintnew-enter" id="pd-sprintnew-enter">${icon('expand')} ${trL(lang, 'Enter sprint', 'ورود به اسپرینت')}</button>
          <button type="button" class="ghost" id="pd-sprintnew-done-close">${trL(lang, 'Close', 'بستن')}</button>
        </div>
      </div>
    </form>
  </dialog>

  <!-- S33: the FULL-SCREEN sprint editor («ورود به اسپرینت» lands here). A true
       full-bleed dialog (100vw × 100dvh) with a rich-text toolbar (headings, bold,
       italic, strike, bullet/numbered/TASK lists, quote, inline code, LINKS, IMAGES,
       TABLES, dividers, and CODE BLOCKS — the special ask), a live Markdown preview,
       and AUTOSAVE (debounced PATCH /api/sprints/:id {description}). S34 (user request
       2026-09-13): PRIVATE COMMENTS — the «==text== %%note%%» toolbar button + Ctrl+M
       wrap any span of the doc with an author-only note (rationale reminders); the
       preview renders the anchor amber with a hover/tap popover, and the foot toggle
       hides them for a clean read. The task list's checkboxes TOGGLE from the preview
       (each click writes [x]/[ ] back into the source + autosaves). The textarea
       follows the S32 bidi law (locale dir as typing default + unicode-bidi:
       plaintext per line); the preview's fenced blocks render as LTR .t-code islands
       with data-lang labels, identical to task-title code.
       state: which sprint, its name/version chip, and the project title all live in
       project-page.js (openSprintDoc). -->
  <dialog id="pd-sprintdoc-modal" class="dialog pd-sd-full" aria-labelledby="pd-sd-title">
    <div class="pd-sd" id="pd-sd">
      <header class="pd-sd-head">
        <div class="pd-sd-titlewrap">
          <span class="pd-sd-diamond" aria-hidden="true">${icon('diamond')}</span>
          <h3 id="pd-sd-title" dir="auto">${trL(lang, 'Sprint plan', 'برنامهٔ اسپرینت')}</h3>
          <span class="chip pd-sd-ver" id="pd-sd-ver" dir="auto" hidden></span>
          <span class="muted small pd-sd-project" id="pd-sd-project"></span>
        </div>
        <div class="row pd-sd-headactions">
          <span class="muted small pd-sd-status" id="pd-sd-status" role="status" aria-live="polite"></span>
          <div class="pd-tb pd-sd-tabs" role="group" aria-label="${trL(lang, 'Editor view', 'نمای ویرایشگر')}">
            <button type="button" class="pd-tb-btn" id="pd-sd-tab-write" aria-pressed="true">${trL(lang, 'Write', 'نوشتن')}</button>
            <button type="button" class="pd-tb-btn" id="pd-sd-tab-preview" aria-pressed="false">${trL(lang, 'Preview', 'پیش‌نمایش')}</button>
          </div>
          <button type="button" class="btn small" id="pd-sd-done">${trL(lang, 'Done', 'تمام')}</button>
          <button type="button" class="ghost" id="pd-sd-close" aria-label="${trL(lang, 'Close', 'بستن')}">${icon('x')}</button>
        </div>
      </header>
      <div class="pd-tb pd-sd-tb" role="toolbar" aria-label="${trL(lang, 'Formatting', 'قالب‌بندی')}">
        <button type="button" class="pd-tb-btn" data-sb="h2" title="${trL(lang, 'Heading (##)', 'تیتر (##)')}" aria-label="${trL(lang, 'Heading', 'تیتر')}">H2</button>
        <button type="button" class="pd-tb-btn" data-sb="h3" title="${trL(lang, 'Subheading (###)', 'تیتر فرعی (###)')}" aria-label="${trL(lang, 'Subheading', 'تیتر فرعی')}">H3</button>
        <button type="button" class="pd-tb-btn" data-sb="bold" title="${trL(lang, 'Bold (**text**)', 'پررنگ (**متن**)')}" aria-label="${trL(lang, 'Bold', 'پررنگ')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h6a3.5 3.5 0 1 1 0 7H7zM7 12h7a3.5 3.5 0 1 1 0 7H7z"/></svg></button>
        <button type="button" class="pd-tb-btn" data-sb="italic" title="${trL(lang, 'Italic (*text*)', 'کج (*متن*)')}" aria-label="${trL(lang, 'Italic', 'کج')}"><span class="pd-sd-ital" aria-hidden="true">I</span></button>
        <button type="button" class="pd-tb-btn" data-sb="strike" title="${trL(lang, 'Strikethrough (~~text~~)', 'خط‌خورده (~~متن~~)')}" aria-label="${trL(lang, 'Strikethrough', 'خط‌خورده')}"><span class="pd-sd-strike" aria-hidden="true">S</span></button>
        <button type="button" class="pd-tb-btn" data-sb="list" title="${trL(lang, 'Bullet list', 'بولت')}" aria-label="${trL(lang, 'Bullet list', 'بولت')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg></button>
        <button type="button" class="pd-tb-btn" data-sb="num" title="${trL(lang, 'Numbered list', 'لیست شماره‌دار')}" aria-label="${trL(lang, 'Numbered list', 'لیست شماره‌دار')}"><span aria-hidden="true">1.</span></button>
        <button type="button" class="pd-tb-btn" data-sb="task" title="${trL(lang, 'Task list (- [ ] task — clickable in preview)', 'لیست کار (- [ ] کار — در پیش‌نمایش تیک‌خورده)')}" aria-label="${trL(lang, 'Task list', 'لیست کار')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="m7.6 12.3 3 3 5.6-6.2"/></svg></button>
        <button type="button" class="pd-tb-btn" data-sb="quote" title="${trL(lang, 'Quote (&gt; text)', 'نقل‌قول (&gt; متن)')}" aria-label="${trL(lang, 'Quote', 'نقل‌قول')}"><span class="pd-sd-quote" aria-hidden="true">❝</span></button>
        <button type="button" class="pd-tb-btn" data-sb="inline" title="${trL(lang, 'Inline code (`code`)', 'کد درون‌خطی (`کد`)')}" aria-label="${trL(lang, 'Inline code', 'کد درون‌خطی')}"><code class="pd-sd-inlineg" aria-hidden="true">&lt;/&gt;</code></button>
        <button type="button" class="pd-tb-btn pd-sd-codebtn" data-sb="code" title="${trL(lang, 'Code block (```…```) — the special place for code', 'بلوک کد (```…```) — جای مخصوص کد')}" aria-label="${trL(lang, 'Code block', 'بلوک کد')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg> ${trL(lang, 'Code', 'کد')}</button>
        <button type="button" class="pd-tb-btn" data-sb="link" title="${trL(lang, 'Link [text](https://…)', 'پیوند [متن](https://…)')}" aria-label="${trL(lang, 'Link', 'پیوند')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.2-1.2"/></svg></button>
        <button type="button" class="pd-tb-btn" data-sb="img" title="${trL(lang, 'Image ![alt](https://…)', 'تصویر ![توضیح](https://…)')}" aria-label="${trL(lang, 'Image', 'تصویر')}">${icon('image')}</button>
        <button type="button" class="pd-tb-btn" data-sb="table" title="${trL(lang, 'Table (| col | col |)', 'جدول (| ستون | ستون |)')}" aria-label="${trL(lang, 'Table', 'جدول')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17M9.5 9.5V19M15 9.5V19"/></svg></button>
        <button type="button" class="pd-tb-btn" data-sb="hr" title="${trL(lang, 'Divider (---)', 'جداکننده (---)')}" aria-label="${trL(lang, 'Divider', 'جداکننده')}"><span aria-hidden="true">—</span></button>
        <!-- S34 (user request 2026-09-13): PRIVATE COMMENTS — «==text== %%note%%» wraps any
             part of the doc with a note only the author reads in preview (hover/tap the
             amber anchor). The toggle in the foot hides them for a clean read. -->
        <button type="button" class="pd-tb-btn pd-sd-notebtn" data-sb="note" title="${trL(lang, 'Comment (==text== %%note%%) — visible only to you', 'دیدگاه (==متن== %%یادداشت%%) — فقط خودت می‌بینی')}" aria-label="${trL(lang, 'Comment', 'دیدگاه')}">${icon('message')} ${trL(lang, 'Comment', 'دیدگاه')}</button>
      </div>
      <div class="pd-sd-main" id="pd-sd-main" data-view="write">
        <textarea id="pd-sd-text" dir="${lang === 'fa' ? 'rtl' : 'auto'}" autocomplete="off" spellcheck="true" aria-label="${trL(lang, 'Sprint plan text', 'متن برنامهٔ اسپرینت')}" placeholder="${trL(lang, 'Write the sprint plan… headings, lists, decisions — and code blocks for the code.', 'برنامهٔ اسپرینت را بنویس… تیتر، لیست، تصمیم — و بلوک کد برای کد.')}"></textarea>
        <div class="pd-sd-preview" id="pd-sd-preview" dir="auto" aria-label="${trL(lang, 'Preview', 'پیش‌نمایش')}"></div>
      </div>
      <footer class="pd-sd-foot">
        <span class="muted small pd-sd-kbd">${trL(lang, 'Ctrl+B bold · Ctrl+I italic · Ctrl+M comment · Tab indents inside code', 'Ctrl+B پررنگ · Ctrl+I کج · Ctrl+M دیدگاه · Tab تورفتگی داخل کد')}</span>
        <span class="grow"></span>
        <!-- S34: show/hide the doc's private comments (==…== %%…%%) + their count. Toggling
             off gives the clean read — anchors render as plain text, notes vanish. -->
        <button type="button" class="pd-tb-btn pd-sd-notesbtn" id="pd-sd-notes" aria-pressed="true" title="${trL(lang, 'Show or hide your private comments', 'نمایش/پنهان‌کردن دیدگاه‌های خصوصی')}" aria-label="${trL(lang, 'Toggle comments', 'دیدگاه‌ها')}">${icon('eye')} <span id="pd-sd-notes-label">${trL(lang, 'Comments', 'دیدگاه‌ها')}</span></button>
        <span class="muted small" id="pd-sd-count"></span>
      </footer>
    </div>
  </dialog>`
}


