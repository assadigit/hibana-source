// Notes Vault — note routes (Phase 4 split from routes/vault.ts).
//
// Purpose: the note CRUD surface — GET /notes (filtered list: view/q/tag + 4 sorts),
// GET/POST/PATCH /notes(/:id), duplicate, drag-reorder (manual rank), soft-delete →
// Trash, restore, hard purge (the ONLY information-destroying endpoint), and the
// single-note .md export. Owner rule: soft delete by default, purge only from Trash.
//
// Public API: registerVaultNotes(app, cfg) — registered by vault/index.ts.
import type { Context } from 'hono'
import { z } from 'zod'
import { jsonBody } from '../../lib/http'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import { createNoteSchema, patchNoteSchema, reorderNotesSchema, sanitizeIcon, NOTE_TITLE_LIMIT, normalizeTags, toCard } from './helpers'
import { now, ownedFolder, ownedNote } from './ownership'
import type { Config, UserRow, VaultNoteRow } from '../../types'

const noteFilters = (c: Context, userId: string): { where: string; params: unknown[] } => {
  const q = c.req.query('q')?.trim() ?? ''
  const tag = c.req.query('tag')?.trim().replace(/^#/, '') ?? ''
  const view = c.req.query('view') ?? 'all'
  const where: string[] = ['user_id = ?']
  const params: unknown[] = [userId]
  // The Trash view shows ONLY soft-deleted notes; every other view only live ones.
  where.push(view === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL')
  if (view === 'folder') {
    const folderId = c.req.query('folder') ?? ''
    if (folderId === 'none') where.push('folder_id IS NULL') // the Unfiled pseudo-folder
    else { where.push('folder_id = ?'); params.push(folderId) }
  }
  if (view === 'starred') where.push('starred = 1')
  if (q) {
    where.push('(title LIKE ? ESCAPE \'\\\' OR content LIKE ? ESCAPE \'\\\')')
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
    params.push(like, like)
  }
  if (tag) {
    // Manual pills live in tags (CSV, stored ', '-joined); inline tags appear as
    // '#tag' in content. Both LIKEs escape their wildcards.
    const safe = tag.replace(/[\\%_]/g, (m) => '\\' + m)
    where.push(`(',' || REPLACE(tags, ' ', '') || ',' LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`)
    params.push(`%,${safe},%`, `%#${safe}%`)
  }
  return { where: where.join(' AND '), params }
}
export function registerVaultNotes(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {


  app.get('/notes', async (c) => {
    const user = c.get('user')
    const { where, params } = noteFilters(c, user.id)
    const sort = c.req.query('sort') ?? 'updated'
    // S86 (0059): 'manual' = the drag-reorder rank (sort_order ASC, updated_at DESC
    // tiebreak — a note created after a reorder lands at 0 and ties to the top).
    const orderBy =
      sort === 'created'
        ? 'created_at DESC'
        : sort === 'title'
          ? 'title COLLATE NOCASE ASC'
          : sort === 'manual'
            ? 'sort_order ASC, updated_at DESC'
            : 'updated_at DESC'
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200) || 200, 1), 500)
    const rows = await cfg.db.query<VaultNoteRow>(
      `SELECT * FROM vault_notes WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit}`,
      params,
    )
    return c.json({ notes: rows.map(toCard) })
  })


  // The full note (editor open) — includes content.
  app.get('/notes/:id', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'))
    if (!n) return errJson(c, ErrorCode.not_found)
    return c.json({ note: n })
  })

  app.post('/notes', async (c) => {
    const body = await jsonBody<z.infer<typeof createNoteSchema>>(c, createNoteSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    if (body.folderId && !(await ownedFolder(cfg.db, user.id, body.folderId))) return errJson(c, ErrorCode.folder_not_found)
    const id = uuid()
    const ts = now()
    await cfg.db.execute(
      'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
      [id, user.id, body.folderId ?? null, (body.title ?? '').trim(), body.content ?? '', normalizeTags(body.tags), ts, ts],
    )
    return c.json({ ok: true, note: await ownedNote(cfg.db, user.id, id) }, 201)
  })

  app.patch('/notes/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchNoteSchema>>(c, patchNoteSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    // Autosave target: live notes only (a trashed note is frozen until restored).
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'), false)
    if (!n) return errJson(c, ErrorCode.not_found)
    if (body.folderId && !(await ownedFolder(cfg.db, user.id, body.folderId))) return errJson(c, ErrorCode.folder_not_found)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title.trim()) }
    if (body.content !== undefined) { sets.push('content = ?'); params.push(body.content) }
    if (body.tags !== undefined) { sets.push('tags = ?'); params.push(normalizeTags(body.tags)) }
    if (body.folderId !== undefined) { sets.push('folder_id = ?'); params.push(body.folderId) }
    if (body.starred !== undefined) { sets.push('starred = ?'); params.push(body.starred ? 1 : 0) }
    if (body.icon !== undefined) { sets.push('icon = ?'); params.push(sanitizeIcon(body.icon)) } // S86
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(now())
      await cfg.db.execute(`UPDATE vault_notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, n.id, user.id])
    }
    return c.json({ ok: true, note: await ownedNote(cfg.db, user.id, n.id) })
  })

  // Duplicate (kebab action): a verbatim copy, " (copy)" suffixed title, same folder,
  // unfiled tags/starred copied too (a duplicate should behave like its original).
  app.post('/notes/:id/duplicate', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'), false)
    if (!n) return errJson(c, ErrorCode.not_found)
    const id = uuid()
    const ts = now()
    await cfg.db.execute(
      'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, user.id, n.folder_id, (n.title || 'Untitled').slice(0, NOTE_TITLE_LIMIT - 7) + ' (copy)', n.content, n.tags, n.starred, ts, ts],
    )
    return c.json({ ok: true, note: await ownedNote(cfg.db, user.id, id) }, 201)
  })

  // S86 (0059): manual drag-reorder. The client ships the CURRENT view's note ids in
  // their new visual order (top → bottom); the endpoint renumbers those 0..n-1 and
  // pushes every OTHER live note after them (existing relative order kept) so the
  // global rank stays coherent — folder/tag views are subsets of one rank, not
  // per-view orders. updated_at is deliberately NOT touched: reordering must never
  // masquerade as an edit (the card dates + 'Recently edited' sort stay honest).
  app.post('/notes/reorder', async (c) => {
    const body = await jsonBody<z.infer<typeof reorderNotesSchema>>(c, reorderNotesSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const live = await cfg.db.query<{ id: string; sort_order: number; updated_at: string }>(
      'SELECT id, sort_order, updated_at FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL',
      [user.id],
    )
    if (!live.length) return errJson(c, ErrorCode.not_found)
    const byId = new Map(live.map((r) => [r.id, r]))
    // Unknown/foreign ids are dropped silently (a stale tab can't reorder what it
    // can't see); duplicates collapse to their first position.
    const ordered: string[] = []
    for (const id of body.ids) {
      if (byId.has(id) && !ordered.includes(id)) ordered.push(id)
    }
    if (!ordered.length) return errJson(c, ErrorCode.invalid_input)
    // The rest keep their current relative order, after the renumbered block.
    const rest = live
      .filter((r) => !ordered.includes(r.id))
      .sort((a, b) => a.sort_order - b.sort_order || (a.updated_at < b.updated_at ? 1 : -1))
      .map((r) => r.id)
    const finalOrder = [...ordered, ...rest]
    // One UPDATE per note (≤500) inside no transaction is fine at solo-owner scale —
    // and each statement is idempotent, so a partial failure leaves a consistent
    // prefix ordering rather than a broken interleave.
    for (let i = 0; i < finalOrder.length; i++) {
      await cfg.db.execute('UPDATE vault_notes SET sort_order = ? WHERE id = ? AND user_id = ?', [i, finalOrder[i], user.id])
    }
    return c.json({ ok: true, moved: ordered.length })
  })

  // Soft delete → Trash (the only DELETE a live note ever gets).
  app.delete('/notes/:id', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'), false)
    if (!n) return errJson(c, ErrorCode.not_found)
    const ts = now()
    await cfg.db.execute('UPDATE vault_notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [ts, ts, n.id, user.id])
    return c.json({ ok: true, id: n.id, soft: true })
  })

  app.post('/notes/:id/restore', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'))
    if (!n || !n.deleted_at) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('UPDATE vault_notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [now(), n.id, user.id])
    return c.json({ ok: true, note: await ownedNote(cfg.db, user.id, n.id) })
  })

  // Hard delete — the ONLY information-destroying endpoint, reachable only from the
  // Trash view's explicit "delete forever".
  app.post('/notes/:id/purge', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'))
    if (!n || !n.deleted_at) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM vault_notes WHERE id = ? AND user_id = ?', [n.id, user.id])
    return c.json({ ok: true })
  })

  // Single-note .md download (owner-approved v1 export). The filename is the slugified
  // title (ASCII fallback "note"), sanitized so no header injection can ride it.
  app.get('/notes/:id/export.md', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(cfg.db, user.id, c.req.param('id'))
    if (!n) return errJson(c, ErrorCode.not_found)
    const slug =
      n.title.trim().replace(/[^\w\u0600-\u06FF-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note'
    const body = (n.title.trim() ? `# ${n.title.trim()}\n\n` : '') + n.content
    return c.body(body, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.md"; filename*=UTF-8''${encodeURIComponent(slug)}.md`,
      'Cache-Control': 'no-store',
    })
  })
}
