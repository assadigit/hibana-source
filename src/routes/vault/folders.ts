// Notes Vault — folders + sidebar bootstrap routes (Phase 4 split from routes/vault.ts).
//
// Purpose: GET /bootstrap (folders + note index + tag index + smart counts) and the
// folder CRUD (POST /folders, PATCH /folders/:id rename/move with cycle rejection,
// DELETE /folders/:id subtree-unfile-then-delete). Owner rule honored: folder
// deletion UNFILES notes, never destroys them.
//
// Public API: registerVaultFolders(app, cfg) — registered by vault/index.ts.
import { z } from 'zod'
import { jsonBody } from '../../lib/http'
import { uuid } from '../../lib/ids'
import { executeIn } from '../../lib/inchunk'
import { errJson, ErrorCode } from '../../lib/errors'
import { createFolderSchema, patchFolderSchema, sanitizeIcon } from './helpers'
import { now, ownedFolder, subtreeIds } from './ownership'
import type { Config, UserRow, NoteFolderRow, VaultNoteRow } from '../../types'

export function registerVaultFolders(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  // Sidebar bootstrap: folders (flat — the client builds the tree) each with its live
  // note count, the tag index (manual + inline #tags), and the smart-view counts.
  // has_sparks (S54): powers the empty-state "import your ideas" CTA — shown only
  // when the vault is empty AND the user actually has sparks to bring over.
  app.get('/bootstrap', async (c) => {
    const user = c.get('user')
    const [folderRows, countRows, unfiledRow, sparkRow, qnRow] = await Promise.all([
      cfg.db.query<NoteFolderRow>(
        'SELECT * FROM note_folders WHERE user_id = ? ORDER BY sort_order, name COLLATE NOCASE',
        [user.id],
      ),
      cfg.db.query<{ folder_id: string | null; n: number }>(
        'SELECT folder_id, COUNT(*) AS n FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL GROUP BY folder_id',
        [user.id],
      ),
      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL AND folder_id IS NULL',
        [user.id],
      ),
      cfg.db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM projects WHERE user_id = ? AND status = 'spark' AND deleted_at IS NULL",
        [user.id],
      ),
      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL',
        [user.id],
      ),
    ])
    const countByFolder = new Map(countRows.map((r) => [r.folder_id ?? '', r.n]))
    const folders = folderRows.map((f) => ({ ...f, note_count: countByFolder.get(f.id) ?? 0 }))
    // S105 (owner: "users cannot collapse the headings — e.g. collapsing the group of
    // the ‘AI’ folder"): the tree now nests NOTES under their folders Obsidian-style,
    // so the bootstrap carries a light note index (id + title + folder) for the
    // sidebar. Capped at 500 — the same limit the list API uses — newest first.
    const noteIndex = await cfg.db.query<{ id: string; title: string; folder_id: string | null }>(
      'SELECT id, title, folder_id FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500',
      [user.id],
    )
    const notes = await cfg.db.query<Pick<VaultNoteRow, 'tags' | 'content' | 'starred' | 'deleted_at'>>(
      'SELECT tags, content, starred, deleted_at FROM vault_notes WHERE user_id = ?',
      [user.id],
    )
    // Tag index: manual pills + inline #tags, one vote per note per tag (a tag both
    // manual AND inline in the same note counts once). First-seen casing is kept for
    // display; counting is case-insensitive.
    const tagIndex = new Map<string, { tag: string; count: number }>()
    const bump = (tag: string) => {
      const key = tag.toLowerCase()
      const e = tagIndex.get(key)
      if (e) e.count++
      else tagIndex.set(key, { tag, count: 1 })
    }
    let all = 0
    let starred = 0
    let trash = 0
    for (const n of notes) {
      if (n.deleted_at) {
        trash++
        continue
      }
      all++
      if (n.starred === 1) starred++
      const seen = new Set<string>()
      for (const t of (n.tags ?? '').split(',')) {
        const tag = t.trim().replace(/^#/, '')
        if (tag) { seen.add(tag.toLowerCase()); bump(tag) }
      }
      // inline #tags — the same regex family as the client parser (word chars + Persian
      // letters + slashes for nested obsidian-style tags). A # followed by a space is a
      // markdown heading, not a tag; '##x' can't match (the # prefix class excludes #).
      for (const m of n.content.matchAll(/(^|[^#\w\u0600-\u06FF])#([\w\u0600-\u06FF][\w\u0600-\u06FF/-]*)/g)) {
        const tag = m[2]
        if (tag && !seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); bump(tag) }
      }
    }
    return c.json({
      folders,
      noteIndex,
      tags: [...tagIndex.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
      counts: { all, starred, trash, unfiled: unfiledRow[0]?.n ?? 0, has_sparks: (sparkRow[0]?.n ?? 0) > 0, has_quicknotes: (qnRow[0]?.n ?? 0) > 0 },
    })
  })

  app.post('/folders', async (c) => {
    const body = await jsonBody<z.infer<typeof createFolderSchema>>(c, createFolderSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    if (body.parentId && !(await ownedFolder(cfg.db, user.id, body.parentId))) return errJson(c, ErrorCode.parent_not_found)
    const id = uuid()
    const ts = now()
    await cfg.db.execute(
      'INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, user.id, body.parentId ?? null, body.name.trim(), ts, ts],
    )
    const folder = await ownedFolder(cfg.db, user.id, id)
    return c.json({ ok: true, folder }, 201)
  })

  // Rename / move. A move validates the new parent (owned, exists) and rejects cycles
  // (a folder cannot become its own descendant) — the tree must stay a tree.
  app.patch('/folders/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchFolderSchema>>(c, patchFolderSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const folder = await ownedFolder(cfg.db, user.id, c.req.param('id'))
    if (!folder) return errJson(c, ErrorCode.not_found)
    if (body.parentId !== undefined) {
      if (body.parentId === null) {
        // move to root — always fine
      } else {
        if (body.parentId === folder.id) return errJson(c, ErrorCode.cycle)
        if (!(await ownedFolder(cfg.db, user.id, body.parentId))) return errJson(c, ErrorCode.parent_not_found)
        const subtree = new Set(await subtreeIds(cfg.db, user.id, folder.id))
        if (subtree.has(body.parentId)) return errJson(c, ErrorCode.cycle)
      }
    }
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name.trim()) }
    if (body.parentId !== undefined) { sets.push('parent_id = ?'); params.push(body.parentId) }
    if (body.icon !== undefined) { sets.push('icon = ?'); params.push(sanitizeIcon(body.icon)) } // S86
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(now())
      await cfg.db.execute(`UPDATE note_folders SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, folder.id, user.id])
    }
    return c.json({ ok: true, folder: await ownedFolder(cfg.db, user.id, folder.id) })
  })

  // Delete a folder: notes in the subtree are UNFILED (never deleted — owner rule),
  // then the folders go. Done explicitly (not via FK cascade) so behavior is identical
  // on paths where the FK pragma is off.
  app.delete('/folders/:id', async (c) => {
    const user = c.get('user')
    const folder = await ownedFolder(cfg.db, user.id, c.req.param('id'))
    if (!folder) return errJson(c, ErrorCode.not_found)
    const ids = await subtreeIds(cfg.db, user.id, folder.id)
    // AP-20: chunked — a deep folder tree can exceed 99 subtree ids (D1 param cap).
    await executeIn(cfg.db, 'UPDATE vault_notes SET folder_id = NULL, updated_at = ? WHERE user_id = ? AND folder_id IN {{IN}}', [now(), user.id], ids)
    await executeIn(cfg.db, 'DELETE FROM note_folders WHERE user_id = ? AND id IN {{IN}}', [user.id], ids)
    return c.json({ ok: true, unfiled: ids.length })
  })
}
