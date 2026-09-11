import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, jsonBody, etag } from '../lib/http'
import { icon } from '../lib/html'
import { localeOf, trL, type Locale } from '../lib/i18n'
import { renderMarkdown } from '../lib/markdown'
import { calendarFor, formatDate } from '../lib/jalali'
import { uuid } from '../lib/ids'
import type { Config, UserRow } from '../types'
import type { Db } from '../db/types'

// Dashboard quick-notebook (user request): a capture widget in two modes — free typing
// ('note') or a task list ('list'). Everything routes through /api/notes; the same handlers
// serve JSON to fetch() and the re-rendered widget body to htmx (single-origin, Q1-A).
// Lists store their items as JSON in content: [{id, t, d}] with t = text, d = done (0|1).


import {
  type QuickNote,
  NOTE_COLORS,
  type NoteColor,
  NOTE_COLOR_HEX,
  createNoteSchema,
  patchNoteSchema,
  addItemSchema,
  toggleItemSchema,
  reorderSchema,
  type TaskItem,
  parseItems,
  itemsHtml,
  colorPickerHtml,
  dateChipHtml,
  decodeEntities,
  latinRuns,
  noteCard,
  attachWidget,
  attachedTitles,
  notebookHtml,
} from './quicknotes-helpers'
// Re-export for backward compat (dashboard.ts, projects/helpers.ts, ics-export.ts import these)
export { notebookHtml, attachedTitles, type QuickNote, type NoteColor, type TaskItem } from './quicknotes-helpers'

export function quickNotesRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  const activeNotes = async (userId: string): Promise<QuickNote[]> =>
    cfg.db.query<QuickNote>(
      // P1.2 (F-M8): newest note at the TOP. sort_order DESC so the highest value renders
      // first. New notes are created with sort_order = COUNT(*) (the current highest), so a
      // freshly-created note lands at the top automatically. The drag-reorder below writes
      // sort_order by reversed visual index so DESC stays consistent after a manual drag.
      // P5.2 (F-M2): LIMIT 100 — the notebook widget re-renders all notes on every mutation
      // (create/patch/delete/reorder). Without a cap, the re-render grows unbounded as the
      // notebook accumulates. 100 is ample for a solo owner; the full notebook lives at
      // /whiteboard.html for the complete list. The incremental-swap optimization (return
      // only the affected card on create/patch instead of the full list) is deferred — the
      // full re-render of ≤100 notes is < 50ms, not user-perceived at solo-owner scale.
      'SELECT * FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order DESC, updated_at DESC LIMIT 100',
      [userId],
    )

  const owned = async (userId: string, id: string): Promise<QuickNote | null> => {
    const rows = await cfg.db.query<QuickNote>('SELECT * FROM quick_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId])
    return rows.length ? rows[0] : null
  }

  type Ctx = Context<{ Variables: { user: UserRow } }>
  // 0040/dashboard: the `dashboard` flag is echoed back via ?dashboard=1 so every htmx
  // re-render (create/patch/toggle/delete/reorder) preserves the collapsed-controls
  // dashboard widget layout. Same pattern as the existing ?mode= for composer mode.
  const widget = async (c: Ctx, notes: QuickNote[], composerMode?: 'note' | 'list', status?: ContentfulStatusCode) =>
    c.html(notebookHtml(notes, localeOf(c), composerMode, await attachedTitles(cfg.db, c.get('user').id, notes), c.req.query('dashboard') === '1'), status)
  // The composer keeps its Note/List mode across htmx swaps — the client echoes the current
  // mode back as ?mode= so a refresh after an action doesn't silently flip it to Note.
  const composerMode = (c: Ctx): 'note' | 'list' | undefined => {
    const m = c.req.query('mode')
    return m === 'list' ? 'list' : m === 'note' ? 'note' : undefined
  }
  const json = (c: Ctx, body: unknown, status?: ContentfulStatusCode) => c.json(body, status)

  // Rule 1: an attach target must be the user's own live project — never someone else's.
  const ensureOwnProject = async (userId: string, projectId: string | null): Promise<boolean> => {
    if (!projectId) return true // detach
    const rows = await cfg.db.query(
      'SELECT id FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [projectId, userId],
    )
    return rows.length > 0
  }

  // List the notebook (JSON for API consumers, widget html for htmx).
  app.get('/', async (c) => {
    const user = c.get('user')
    const notes = await activeNotes(user.id)
    return await etag(c, c.req.header('HX-Request') ? await widget(c, notes, composerMode(c)) : json(c, { notes }))
  })

  // Create a note or a list (accepts an optional client id, like the quick-add flow).
  app.post('/', async (c) => {
    const body = await jsonBody<z.infer<typeof createNoteSchema>>(c, createNoteSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    // Rule 10 + user request: an empty note/list must never be created — the client shows
    // “Write a note first” and the API agrees (defense for any direct caller).
    if (!body.content.trim()) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    if (body.project_id && !(await ensureOwnProject(user.id, body.project_id))) return c.json({ error: 'project_not_found' }, 400)
    const now = new Date().toISOString()
    const id = body.id ?? uuid()
    // Append at the end of the user's order (sticky-view reorder can move it later).
    const pos = (await cfg.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL', [user.id]))[0]?.n ?? 0
    if (body.kind === 'list') {
      // User-requested behavior: every Enter adds one task (each rendered with its own
      // checkbox). Lines are split server-side too, so pasting a multi-line block still
      // creates one item per line instead of one item with embedded newlines.
      const items = body.content
        .split(/\r?\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((t) => ({ id: uuid(), t: t.slice(0, 300), d: 0 as const }))
      await cfg.db.execute(
        'INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, sort_order, note_date, sticky, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, user.id, 'list', body.title ?? '', JSON.stringify(items), body.project_id ?? null, pos, body.note_date ?? null, body.sticky ? 1 : 0, now, now],
      )
    } else {
      await cfg.db.execute(
        'INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, sort_order, color, note_date, sticky, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, user.id, 'note', body.title ?? '', body.content.trim().slice(0, 20_000), body.project_id ?? null, pos, body.color ?? 'yellow', body.note_date ?? null, body.sticky ? 1 : 0, now, now],
      )
    }
    const notes = await activeNotes(user.id)
    // Keep the composer in the mode that just created the note (list flow stays on List).
    return c.req.header('HX-Request') ? await widget(c, notes, body.kind, 201) : json(c, { ok: true, id }, 201)
  })

  // Edit the title or the raw content of a note/list — or attach/detach it to a project.
  app.patch('/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchNoteSchema>>(c, patchNoteSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const n = await owned(user.id, c.req.param('id'))
    if (!n) return c.json({ error: 'not_found' }, 404)
    // Attach/detach (user request): uuid = relate the note to a project of the same user.
    if (body.project_id !== undefined) {
      if (!(await ensureOwnProject(user.id, body.project_id))) return c.json({ error: 'project_not_found' }, 400)
    }
    const sets: string[] = []
    const params: unknown[] = []
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title.slice(0, 120)) }
    if (body.content !== undefined) {
      sets.push('content = ?')
      params.push(n.kind === 'list' ? body.content : body.content.trim().slice(0, 20_000))
    }
    if (body.project_id !== undefined) { sets.push('project_id = ?'); params.push(body.project_id) }
    if (body.color !== undefined) { sets.push('color = ?'); params.push(body.color) }
    if (body.note_date !== undefined) { sets.push('note_date = ?'); params.push(body.note_date) }
    if (body.sticky !== undefined) { sets.push('sticky = ?'); params.push(body.sticky ? 1 : 0) }
    // 0038 — only a project-linked note carries the done flag; free notes ignore it.
    if (body.done !== undefined && n.project_id) {
      sets.push('done = ?')
      params.push(body.done ? 1 : 0)
    }
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(new Date().toISOString())
      await cfg.db.execute(`UPDATE quick_notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, n.id, user.id])
    }
    const notes = await activeNotes(user.id)
    return c.req.header('HX-Request') ? await widget(c, notes, composerMode(c)) : json(c, { ok: true })
  })

  // Attach-picker fragment (htmx): the user's live projects as one-tap attach buttons.
  app.get('/attach-picker', async (c) => {
    const user = c.get('user')
    const n = await owned(user.id, c.req.query('note_id') ?? '')
    if (!n) return c.json({ error: 'not_found' }, 404)
    const projects = await cfg.db.query<{ id: string; title: string }>(
      'SELECT id, title FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 40',
      [user.id],
    )
    const t = (en: string, fa: string) => trL(localeOf(c), en, fa)
    if (projects.length === 0) {
      return c.html(`<p class="muted small">${t('No projects to attach to yet — create one first.', 'هنوز پروژه‌ای برای اتصال نیست — اول یکی بساز.')}</p>`)
    }
    return c.html(`<div class="attach-picker">
      <div class="row spread"><strong class="small">${t('Attach to…', 'اتصال به…')}</strong>
        <button class="ghost" hx-get="/api/notes/attach?note_id=${n.id}" hx-target="#attach-${n.id}" hx-swap="innerHTML" aria-label="${t('Cancel', 'انصراف')}">${icon('x')}</button></div>
      <div class="attach-options">
        ${projects
          .map(
            (p) => `<button type="button" class="attach-option" hx-patch="/api/notes/${n.id}" hx-vals='{"project_id":"${p.id}"}' hx-target="#notebook" hx-swap="outerHTML">${esc(p.title)}</button>`,
          )
          .join('')}
      </div>
    </div>`)
  })

  // The attach widget fragment alone (button or chip) — used to cancel out of the picker.
  app.get('/attach', async (c) => {
    const user = c.get('user')
    const n = await owned(user.id, c.req.query('note_id') ?? '')
    if (!n) return c.json({ error: 'not_found' }, 404)
    const titles = await attachedTitles(cfg.db, user.id, [n])
    return c.html(attachWidget(n, titles, localeOf(c)))
  })

  // Add a task to a list (works on the owning note's content JSON).
  app.post('/list/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof addItemSchema>>(c, addItemSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const n = await owned(user.id, c.req.param('id'))
    if (!n || n.kind !== 'list') return c.json({ error: 'not_found' }, 404)
    const items = parseItems(n.content)
    // The client drafts several lines (Enter per line) and commits them at once — the append
    // splits newline-joined text just like the create path, one item per line.
    for (const line of body.text.split(/\r?\n+/)) {
      const t = line.trim()
      if (t) items.push({ id: uuid(), t: t.slice(0, 300), d: 0 })
    }
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE quick_notes SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify(items), now, n.id, user.id,
    ])
    const notes = await activeNotes(user.id)
    return c.req.header('HX-Request') ? await widget(c, notes, composerMode(c)) : json(c, { ok: true })
  })

  // Toggle a task done/undone (item id lives in the note's content JSON).
  app.patch('/list/:itemId', async (c) => {
    const body = await jsonBody<z.infer<typeof toggleItemSchema>>(c, toggleItemSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string; content: string }>(
      `SELECT id, content FROM quick_notes WHERE user_id = ? AND kind = 'list' AND deleted_at IS NULL`,
      [user.id],
    )
    const note = rows.find((r) => parseItems(r.content).some((it) => it.id === c.req.param('itemId')))
    if (!note) return c.json({ error: 'not_found' }, 404)
    const items = parseItems(note.content).map((it) => (it.id === c.req.param('itemId') ? { ...it, d: body.done } : it))
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE quick_notes SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify(items), now, note.id, user.id,
    ])
    const notes = await activeNotes(user.id)
    return c.req.header('HX-Request') ? await widget(c, notes, composerMode(c)) : json(c, { ok: true })
  })

  // Remove a task from a list.
  app.delete('/list/:itemId', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string; content: string }>(
      `SELECT id, content FROM quick_notes WHERE user_id = ? AND kind = 'list' AND deleted_at IS NULL`,
      [user.id],
    )
    const note = rows.find((r) => parseItems(r.content).some((it) => it.id === c.req.param('itemId')))
    if (!note) return c.json({ error: 'not_found' }, 404)
    const items = parseItems(note.content).filter((it) => it.id !== c.req.param('itemId'))
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE quick_notes SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify(items), now, note.id, user.id,
    ])
    const notes = await activeNotes(user.id)
    return c.req.header('HX-Request') ? await widget(c, notes) : json(c, { ok: true })
  })

  // Soft-delete the whole note — undo-toast stays honest for 7 days (Q2), then purged.
  // The client (app.js) handles the toast + undo; this endpoint just marks the row.
  app.delete('/:id', async (c) => {
    const user = c.get('user')
    const n = await owned(user.id, c.req.param('id'))
    if (!n) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE quick_notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      now, now, n.id, user.id,
    ])
    return c.json({ ok: true, id: n.id, soft: true })
  })

  // Undo delete (restores within the 7-day window).
  app.post('/:id/restore', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM quick_notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [c.req.param('id'), user.id],
    )
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE quick_notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [
      now, rows[0].id, user.id,
    ])
    const notes = await activeNotes(user.id)
    return c.req.header('HX-Request') ? await widget(c, notes, composerMode(c)) : json(c, { ok: true })
  })

  // Sticky-note view reorder (2026-08-25): the client ships the full order; stray ids are
  // ignored (rule 1 + ownership), each owned id gets its position as sort_order.
  app.post('/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof reorderSchema>>(c, reorderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL',
      [user.id],
    )
    const ownedIds = new Set(rows.map((r) => r.id))
    const now = new Date().toISOString()
    // P1.2 (F-M8): the client ships ids in visual order (top -> bottom). Under DESC the
    // visual-TOP must get the HIGHEST sort_order, so we reverse: the bottom item gets i=0
    // (lowest), the top item gets i=N-1 (highest) -> renders first under ORDER BY ... DESC.
    let i = 0
    for (const id of [...body.ids].reverse()) {
      if (!ownedIds.has(id)) continue
      await cfg.db.execute('UPDATE quick_notes SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
        i++, now, id, user.id,
      ])
    }
    const notes = await activeNotes(user.id)
    return c.req.header('HX-Request') ? await widget(c, notes, composerMode(c)) : json(c, { ok: true })
  })

  return app
}