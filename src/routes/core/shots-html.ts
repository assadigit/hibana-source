// Core — screenshot grid rendering (Phase 4 split from routes/core.ts).
//
// Purpose: the shared shot-tile renderer (image / video / doc-file variants, the
// S35 problem-report card with kebab menu, pin lines, click-to-edit note) plus
// the display-name helper and the pinned-task map. Used by the media routes and
// re-exported from core/index.ts (routes/projects/detail-helpers.ts imports it).
//
// Public API: SHOT_BOX (type), shotDisplayName, shotFileTileHtml, shotsGridHtml, shotTaskMap.
import { esc } from '../../lib/http'
import { icon } from '../../lib/html'
import { trL, type Locale } from '../../lib/i18n'
import { queryIn } from '../../lib/inchunk'
import type { Config, ScreenshotRow } from '../../types'

/** The five progress boxes a shot can be STUCK to (0054). Kept in lockstep with the
 *  COLS map in routes/projects/detail-helpers.ts — the SAME board the user sees. */
const SHOT_BOX: Record<string, [string, string]> = {
  idea: ['New Ideas', 'ایده‌های جدید'],
  bug: ['Problems', 'مشکلات'],
  planned: ['Plans', 'برنامه‌ها'],
  in_progress: ['In Progress', 'در حال انجام'],
  done: ['Done', 'انجام‌شده'],
}

/** Shared screenshot grid (Batch (p)): the project page's Screenshots tab and the
 *  HX screenshots endpoint render the same figures, so an uploaded shot appears in
 *  both after one swap.
 *  S35 (user request 2026-09): each shot is a UI/UX PROBLEM REPORT — image + note
 *  (caption) + open/fixed state. Clicking the image opens the lightbox; the note
 *  edits inline (client swaps the figcaption into a form); the resolve toggle PATCHes
 *  {resolved}; delete asks first. Bidi law: the note is dir="auto" + plaintext.
 *  S39 (user request 2026-09-13): the note is CLICK-TO-EDIT (the whole note area opens
 *  the form — the tiny pencil alone was undiscoverable, which read as "you can't add
 *  a note"), and each shot can be STUCK to a progress-box item: a pin button opens the
 *  task picker (project-page.js) and the pin line shows WHERE it lives — box + task
 *  title — with a one-click unpin. tasks: the id → {title, status} map of the project's
 *  dev_tasks (only pinned ids are needed; callers may pass a superset). */
/** S86 (0059): a doc upload's display name — the stored filename column, falling back
 *  to the stored-path basename (legacy image rows never hit this path). */
export function shotDisplayName(s: ScreenshotRow): string {
  if (s.filename && s.filename.trim()) return s.filename.trim()
  const base = (s.github_path || '').split('/').pop() || ''
  return base.replace(/^[0-9a-f-]{36}-/i, '') || 'file'
}

/** S86: doc uploads (PDF/CSV/XLSX/DOCX/MD/TXT) render a FILE tile, not an image —
 *  an extension badge + the name + a download affordance. Kept next to
 *  shotsGridHtml so every surface (grid + HX endpoint) speaks the same shape. */
export function shotFileTileHtml(s: ScreenshotRow, lang: Locale): string {
  const name = shotDisplayName(s)
  const ext = (name.split('.').pop() || '').toUpperCase().slice(0, 5) || 'FILE'
  return `<a class="shot-file" href="/api/media/screenshots/${s.id}/file" download aria-label="${trL(lang, 'Download {f}', 'دانلود {f}', { f: name })}" title="${trL(lang, 'Download {f}', 'دانلود {f}', { f: name })}">
        <span class="shot-file-ext" aria-hidden="true">${esc(ext)}</span>
        <span class="shot-file-name" dir="auto">${esc(name)}</span>
        <span class="shot-file-dl" aria-hidden="true">${icon('download')}</span>
      </a>`
}

export function shotsGridHtml(
  shots: ScreenshotRow[],
  lang: Locale,
  tasks: Map<string, { title: string; status: string }> = new Map(),
): string {
  return shots
    .map((s) => {
      // S115: a video (webm screen recording) is MEDIA, not a file tile — it renders
      // an inline <video> with native controls; preload="metadata" keeps a big grid
      // cheap (frames fetch on demand, bytes stay in KV until deleted).
      const isImage = String(s.mime_type || '').startsWith('image/')
      const isVideo = String(s.mime_type || '').startsWith('video/')
      return `<figure class="shot shot-card${s.resolved ? ' is-fixed' : ''}${isVideo ? ' is-video' : isImage ? '' : ' is-file'}" data-shot="${s.id}" data-resolved="${s.resolved ? '1' : '0'}"${s.task_id ? ` data-task="${s.task_id}"` : ''}>
        ${isImage
          ? `<button type="button" class="shot-img-btn" data-shot-zoom="${s.id}" aria-label="${trL(lang, 'View screenshot', 'دیدن اسکرین‌شات')}">
          <img src="/api/media/screenshots/${s.id}/file" alt="${esc(s.caption)}" loading="lazy">
        </button>`
          : isVideo
          ? `<video class="shot-video" src="/api/media/screenshots/${s.id}/file" controls preload="metadata" playsinline tabindex="0" aria-label="${trL(lang, 'Recording — press Enter to view full screen', 'ضبط‌شده — برای دیدن تمام‌صفحه اینتر را بزنید')}"></video>`
          : shotFileTileHtml(s, lang)}
        <figcaption class="shot-body">
          ${s.task_id && tasks.get(s.task_id) ? (() => {
            const t = tasks.get(s.task_id)!
            const box = SHOT_BOX[t.status] ?? SHOT_BOX.idea
            const fullTitle = String(t.title || '').split('\n')[0]
            return `<div class="row spread shot-pin" dir="auto">
              <span class="row shot-pin-text" style="gap:0.25rem" title="${esc(fullTitle)}">${icon('pin')} <b>${trL(lang, box[0], box[1])}</b> · <span class="shot-pin-task">${esc(t.title)}</span></span>
              <button type="button" class="ghost small danger shot-unpin" data-shot-unpin="${s.id}" title="${trL(lang, 'Unpin — keep the picture, just detach it', 'برداشتن سنجاق — تصویر می‌ماند، فقط جدا می‌شود')}" aria-label="${trL(lang, 'Unpin', 'برداشتن سنجاق')}">${icon('x')}</button>
            </div>`
          })() : ''}
          <p class="shot-note muted small" dir="auto" data-shot-note-edit title="${trL(lang, 'Click to write the note — what & where to work', 'برای نوشتن یادداشت کلیک کن — چه چیزی و کجا')}" role="button" tabindex="0">${esc(s.caption) || '<span class="shot-note-empty">' + trL(lang, 'Add a note — what & where to work…', 'یادداشت اضافه کن — چه چیزی و کجا…') + '</span>'}</p>
          <div class="row spread shot-actions">
            <span class="shot-state${s.resolved ? ' is-fixed' : ''}" data-shot-state>${s.resolved ? '✓ ' + trL(lang, 'fixed', 'درست شد') : trL(lang, 'open problem', 'باز')}${''}</span>
            <!-- S107 (owner: "the settings like delete edit etc can be hidden under a
                 setting '...' menu for each uploaded picture"): the four inline icon
                 buttons (pin / note / toggle / delete) cluttered every tile — they now
                 live in the app's standard .spark-menu kebab popover (same pattern as
                 pd-task / kanban / note cards). The menu items keep the EXACT data-*
                 attributes the delegated project-page.js handler already speaks, so
                 the wiring is unchanged — only the affordance moved. -->
            <div class="spark-menu shot-menu">
              <button type="button" data-shot-menu data-menu-open aria-haspopup="true" aria-label="${trL(lang, 'More actions', 'کارهای بیشتر')}" title="${trL(lang, 'More actions', 'کارهای بیشتر')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg></button>
              <div class="spark-menu-pop" role="menu" hidden>
                <button type="button" role="menuitem" data-shot-pin="${s.id}" title="${trL(lang, 'Stick this picture to a progress-box item (e.g. the Problems box)', 'این تصویر را به یک قلم جعبهٔ پیشرفت سنجاق کن (مثلاً جعبهٔ مشکلات)')}">${icon('pin')} <span>${trL(lang, 'Pin to a task', 'سنجاق به یک کار')}</span></button>
                <button type="button" role="menuitem" data-shot-note="${s.id}" title="${trL(lang, 'Edit note', 'ویرایش یادداشت')}">${icon('pencil')} <span>${trL(lang, 'Edit note', 'ویرایش یادداشت')}</span></button>
                <button type="button" role="menuitem" data-shot-toggle="${s.id}" title="${s.resolved ? trL(lang, 'Mark as open again', 'بازگشتی به باز') : trL(lang, 'Mark as fixed', 'علامت درست‌شد')}">${s.resolved
                  ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>'
                  : icon('check')} <span>${s.resolved ? trL(lang, 'Mark as open again', 'بازگشتی به باز') : trL(lang, 'Mark as fixed', 'علامت درست‌شد')}</span></button>
                <button type="button" role="menuitem" class="danger" data-shot-del="${s.id}" title="${trL(lang, 'Delete', 'حذف')}">${icon('trash')} <span>${trL(lang, 'Delete', 'حذف')}</span></button>
              </div>
            </div>
          </div>
        </figcaption>
      </figure>`
    })
    .join('') || `<div class="empty-state empty"><span class="empty-state-icon" aria-hidden="true">${icon('image')}</span><p class="empty-state-title">${trL(lang, 'No files yet', 'هنوز فایلی نیست')}</p><p class="empty-state-text">${trL(lang, 'Snap the broken UI/UX, drop it here, write what & where — so you know exactly what to work on.', 'از UI/UX خراب عکس بگیر، همین‌جا رها کن و بنویس چه چیزی و کجاست — تا دقیقاً بدانی روی چه کار کنی.')}</p></div>`
}

/** The task map for pinned shots in ONE project (S39): id → {title, status} for every
 *  task a shot is stuck to, so the pin line can say WHICH box + item. */
export async function shotTaskMap(
  cfg: Config,
  shots: ScreenshotRow[],
): Promise<Map<string, { title: string; status: string }>> {
  const ids = [...new Set(shots.map((s) => s.task_id).filter((x): x is string => !!x))]
  const map = new Map<string, { title: string; status: string }>()
  if (!ids.length) return map
  // AP-20: chunked — a project with 100+ pinned shots exceeds D1's param cap.
  const rows = await queryIn<{ id: string; title: string; status: string }>(
    cfg.db,
    'SELECT id, title, status FROM dev_tasks WHERE id IN {{IN}}',
    [],
    ids,
  )
  for (const r of rows) map.set(r.id, { title: r.title, status: r.status })
  return map
}
