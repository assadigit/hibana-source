import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { jsonBody } from '../lib/http'
import { uuid } from '../lib/ids'
import type { Config, UserRow, NoteFolderRow, VaultNoteRow } from '../types'

// Notes Vault (0057, S53 — owner request): the standalone long-form knowledge base at
// /notes with an Obsidian-inspired UX. Everything the vault page needs rides this
// /api/vault/* namespace (quick_notes owns /api/notes since 0010 — that mount is NOT
// reused). JSON only — the page is a fetch()-driven client (rich 3-pane UI), so unlike
// quicknotes there are no htmx fragments to return.
//
// Owner constraint honored throughout: NOTHING is ever hard-deleted except through the
// explicit purge endpoint (Trash → "delete forever"). Folder deletion unfiles its notes
// (folder_id → NULL) instead of destroying them. Every query is user-scoped (rule 1).

const NOTE_BODY_LIMIT = 200_000 // ~200KB — D1 row safety (owner-approved cap)
const NOTE_TITLE_LIMIT = 300
const FOLDER_NAME_LIMIT = 80
const TAG_LIMIT = 24

const createNoteSchema = z.object({
  title: z.string().max(NOTE_TITLE_LIMIT).optional(),
  content: z.string().max(NOTE_BODY_LIMIT).optional(),
  folderId: z.string().uuid().nullable().optional(),
  tags: z.string().max(500).optional(),
})
const patchNoteSchema = z.object({
  title: z.string().max(NOTE_TITLE_LIMIT).optional(),
  content: z.string().max(NOTE_BODY_LIMIT).optional(),
  folderId: z.string().uuid().nullable().optional(), // omitted = untouched; null = unfile
  tags: z.string().max(500).optional(),
  starred: z.boolean().optional(),
})
const createFolderSchema = z.object({
  name: z.string().min(1).max(FOLDER_NAME_LIMIT),
  parentId: z.string().uuid().nullable().optional(),
})
const patchFolderSchema = z.object({
  name: z.string().min(1).max(FOLDER_NAME_LIMIT).optional(),
  parentId: z.string().uuid().nullable().optional(), // null = move to root
})

/** Normalize a manual-tags CSV: trim, drop empties + duplicates (case-insensitive),
 * cap the count, re-join with ", ". The pills are rendered from this. */
function normalizeTags(raw: string | null | undefined): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of String(raw ?? '').split(',')) {
    const tag = t.trim().replace(/^#/, '')
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= TAG_LIMIT) break
  }
  return out.join(', ')
}

/** First ~160 chars of the note as a card excerpt: markdown markers stripped so the
 *  card reads like the rendered note, newlines flattened to spaces. */
export function excerptOf(content: string, max = 160): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ') // code blocks → nothing useful in an excerpt
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s{0,3}>\s?/gm, '') // quote markers
    // S84: task markers stripped BEFORE the list strip (a `- [ ] milk` line would
    // otherwise excerpt as literal `[ ] milk` — the raw-markdown look the owner
    // flagged). Bullet optional + space-or-EOL after `]` so `[x](url)` stays a link.
    .replace(/^[ \t]*(?:[-*+]|\d+\.)?[ \t]*\[[ xX]\](?:[ \t]+|$)/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '') // list markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[*_~`#]+/g, '') // emphasis/code markers
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain
}

/** Word count for the status bar / cards. Persian and English both count by whitespace
 *  runs; digits + Latin abbreviations count as words. */
export function wordCount(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean)
  return words.length
}

/** A note minus the full body — what list views return (the body would bloat the
 *  payload for folders with many notes; the editor fetches it on open). */
export type VaultNoteCard = Omit<VaultNoteRow, 'content'> & {
  excerpt: string
  word_count: number
}

const toCard = (n: VaultNoteRow): VaultNoteCard => {
  const { content, ...rest } = n
  return { ...rest, excerpt: excerptOf(content), word_count: wordCount(content) }
}

export function vaultRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  const now = () => new Date().toISOString()

  // ---- folders -------------------------------------------------------------------

  const ownedFolder = async (userId: string, id: string): Promise<NoteFolderRow | null> => {
    const rows = await cfg.db.query<NoteFolderRow>(
      'SELECT * FROM note_folders WHERE id = ? AND user_id = ?',
      [id, userId],
    )
    return rows.length ? rows[0] : null
  }

  /** All ids in the folder's subtree (the folder itself + every descendant) — the
   *  delete path unfiles notes in ALL of them, then removes the folders. */
  const subtreeIds = async (userId: string, rootId: string): Promise<string[]> => {
    const all = await cfg.db.query<{ id: string; parent_id: string | null }>(
      'SELECT id, parent_id FROM note_folders WHERE user_id = ?',
      [userId],
    )
    const out: string[] = []
    const queue = [rootId]
    while (queue.length) {
      const cur = queue.shift()!
      if (out.includes(cur)) continue // cycle guard (shouldn't happen — moves check cycles)
      out.push(cur)
      for (const f of all) if (f.parent_id === cur) queue.push(f.id)
    }
    return out
  }

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
      tags: [...tagIndex.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
      counts: { all, starred, trash, unfiled: unfiledRow[0]?.n ?? 0, has_sparks: (sparkRow[0]?.n ?? 0) > 0, has_quicknotes: (qnRow[0]?.n ?? 0) > 0 },
    })
  })

  app.post('/folders', async (c) => {
    const body = await jsonBody<z.infer<typeof createFolderSchema>>(c, createFolderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    if (body.parentId && !(await ownedFolder(user.id, body.parentId))) return c.json({ error: 'parent_not_found' }, 400)
    const id = uuid()
    const ts = now()
    await cfg.db.execute(
      'INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, user.id, body.parentId ?? null, body.name.trim(), ts, ts],
    )
    const folder = await ownedFolder(user.id, id)
    return c.json({ ok: true, folder }, 201)
  })

  // Rename / move. A move validates the new parent (owned, exists) and rejects cycles
  // (a folder cannot become its own descendant) — the tree must stay a tree.
  app.patch('/folders/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchFolderSchema>>(c, patchFolderSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const folder = await ownedFolder(user.id, c.req.param('id'))
    if (!folder) return c.json({ error: 'not_found' }, 404)
    if (body.parentId !== undefined) {
      if (body.parentId === null) {
        // move to root — always fine
      } else {
        if (body.parentId === folder.id) return c.json({ error: 'cycle' }, 400)
        if (!(await ownedFolder(user.id, body.parentId))) return c.json({ error: 'parent_not_found' }, 400)
        const subtree = new Set(await subtreeIds(user.id, folder.id))
        if (subtree.has(body.parentId)) return c.json({ error: 'cycle' }, 400)
      }
    }
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name.trim()) }
    if (body.parentId !== undefined) { sets.push('parent_id = ?'); params.push(body.parentId) }
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(now())
      await cfg.db.execute(`UPDATE note_folders SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, folder.id, user.id])
    }
    return c.json({ ok: true, folder: await ownedFolder(user.id, folder.id) })
  })

  // Delete a folder: notes in the subtree are UNFILED (never deleted — owner rule),
  // then the folders go. Done explicitly (not via FK cascade) so behavior is identical
  // on paths where the FK pragma is off.
  app.delete('/folders/:id', async (c) => {
    const user = c.get('user')
    const folder = await ownedFolder(user.id, c.req.param('id'))
    if (!folder) return c.json({ error: 'not_found' }, 404)
    const ids = await subtreeIds(user.id, folder.id)
    const ph = ids.map(() => '?').join(',')
    await cfg.db.execute(`UPDATE vault_notes SET folder_id = NULL, updated_at = ? WHERE user_id = ? AND folder_id IN (${ph})`, [now(), user.id, ...ids])
    await cfg.db.execute(`DELETE FROM note_folders WHERE user_id = ? AND id IN (${ph})`, [user.id, ...ids])
    return c.json({ ok: true, unfiled: ids.length })
  })

  // ---- notes ---------------------------------------------------------------------

  const noteFilters = (c: import('hono').Context, userId: string): { where: string; params: unknown[] } => {
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

  app.get('/notes', async (c) => {
    const user = c.get('user')
    const { where, params } = noteFilters(c, user.id)
    const sort = c.req.query('sort') ?? 'updated'
    const orderBy =
      sort === 'created' ? 'created_at DESC' : sort === 'title' ? 'title COLLATE NOCASE ASC' : 'updated_at DESC'
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200) || 200, 1), 500)
    const rows = await cfg.db.query<VaultNoteRow>(
      `SELECT * FROM vault_notes WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit}`,
      params,
    )
    return c.json({ notes: rows.map(toCard) })
  })

  const ownedNote = async (userId: string, id: string, includeDeleted = true): Promise<VaultNoteRow | null> => {
    const rows = await cfg.db.query<VaultNoteRow>(
      includeDeleted
        ? 'SELECT * FROM vault_notes WHERE id = ? AND user_id = ?'
        : 'SELECT * FROM vault_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [id, userId],
    )
    return rows.length ? rows[0] : null
  }

  // The full note (editor open) — includes content.
  app.get('/notes/:id', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(user.id, c.req.param('id'))
    if (!n) return c.json({ error: 'not_found' }, 404)
    return c.json({ note: n })
  })

  app.post('/notes', async (c) => {
    const body = await jsonBody<z.infer<typeof createNoteSchema>>(c, createNoteSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    if (body.folderId && !(await ownedFolder(user.id, body.folderId))) return c.json({ error: 'folder_not_found' }, 400)
    const id = uuid()
    const ts = now()
    await cfg.db.execute(
      'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
      [id, user.id, body.folderId ?? null, (body.title ?? '').trim(), body.content ?? '', normalizeTags(body.tags), ts, ts],
    )
    return c.json({ ok: true, note: await ownedNote(user.id, id) }, 201)
  })

  app.patch('/notes/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchNoteSchema>>(c, patchNoteSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    // Autosave target: live notes only (a trashed note is frozen until restored).
    const n = await ownedNote(user.id, c.req.param('id'), false)
    if (!n) return c.json({ error: 'not_found' }, 404)
    if (body.folderId && !(await ownedFolder(user.id, body.folderId))) return c.json({ error: 'folder_not_found' }, 400)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.title !== undefined) { sets.push('title = ?'); params.push(body.title.trim()) }
    if (body.content !== undefined) { sets.push('content = ?'); params.push(body.content) }
    if (body.tags !== undefined) { sets.push('tags = ?'); params.push(normalizeTags(body.tags)) }
    if (body.folderId !== undefined) { sets.push('folder_id = ?'); params.push(body.folderId) }
    if (body.starred !== undefined) { sets.push('starred = ?'); params.push(body.starred ? 1 : 0) }
    if (sets.length) {
      sets.push('updated_at = ?')
      params.push(now())
      await cfg.db.execute(`UPDATE vault_notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, n.id, user.id])
    }
    return c.json({ ok: true, note: await ownedNote(user.id, n.id) })
  })

  // Duplicate (kebab action): a verbatim copy, " (copy)" suffixed title, same folder,
  // unfiled tags/starred copied too (a duplicate should behave like its original).
  app.post('/notes/:id/duplicate', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(user.id, c.req.param('id'), false)
    if (!n) return c.json({ error: 'not_found' }, 404)
    const id = uuid()
    const ts = now()
    await cfg.db.execute(
      'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, user.id, n.folder_id, (n.title || 'Untitled').slice(0, NOTE_TITLE_LIMIT - 7) + ' (copy)', n.content, n.tags, n.starred, ts, ts],
    )
    return c.json({ ok: true, note: await ownedNote(user.id, id) }, 201)
  })

  // Soft delete → Trash (the only DELETE a live note ever gets).
  app.delete('/notes/:id', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(user.id, c.req.param('id'), false)
    if (!n) return c.json({ error: 'not_found' }, 404)
    const ts = now()
    await cfg.db.execute('UPDATE vault_notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [ts, ts, n.id, user.id])
    return c.json({ ok: true, id: n.id, soft: true })
  })

  app.post('/notes/:id/restore', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(user.id, c.req.param('id'))
    if (!n || !n.deleted_at) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('UPDATE vault_notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', [now(), n.id, user.id])
    return c.json({ ok: true, note: await ownedNote(user.id, n.id) })
  })

  // Hard delete — the ONLY information-destroying endpoint, reachable only from the
  // Trash view's explicit "delete forever".
  app.post('/notes/:id/purge', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(user.id, c.req.param('id'))
    if (!n || !n.deleted_at) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('DELETE FROM vault_notes WHERE id = ? AND user_id = ?', [n.id, user.id])
    return c.json({ ok: true })
  })

  // Single-note .md download (owner-approved v1 export). The filename is the slugified
  // title (ASCII fallback "note"), sanitized so no header injection can ride it.
  app.get('/notes/:id/export.md', async (c) => {
    const user = c.get('user')
    const n = await ownedNote(user.id, c.req.param('id'))
    if (!n) return c.json({ error: 'not_found' }, 404)
    const slug =
      n.title.trim().replace(/[^\w\u0600-\u06FF-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note'
    const body = (n.title.trim() ? `# ${n.title.trim()}\n\n` : '') + n.content
    return c.body(body, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.md"; filename*=UTF-8''${encodeURIComponent(slug)}.md`,
      'Cache-Control': 'no-store',
    })
  })

  // Sparks → Vault one-way import (S54, owner-approved in the S53 spec Q&A: "should
  // Sparks/Quick Notes be importable into Notes later? — Yes they can"). COPY, never
  // move: the sparks stay exactly where they are (the promote-to-project flow, the
  // sparks page, history — all untouched); this materializes a long-form twin of each
  // idea as a vault note so the knowledge base starts with real content.
  //  - Destination: a folder named "Ideas" (reused if one exists — exact, case-insensitive).
  //  - Dedupe: a spark whose title already exists as a LIVE note in that folder (case-insensitive)
  //    is skipped, so re-running the import is idempotent.
  //  - Body: description + the spark's "where I left off" note as a markdown quote —
  //    no new markdown syntax (S53 owner rule), just the subset the renderer already has.
  //  - Tag "idea" rides every imported note so the tag index groups them.
  app.post('/import/sparks', async (c) => {
    const user = c.get('user')
    const sparks = await cfg.db.query<{ id: string; title: string; description: string; latest_note: string | null }>(
      "SELECT id, title, description, latest_note FROM projects WHERE user_id = ? AND status = 'spark' AND deleted_at IS NULL ORDER BY updated_at DESC",
      [user.id],
    )
    if (!sparks.length) return c.json({ ok: true, created: 0, skipped: 0 })

    // Find-or-create the "Ideas" folder (user-scoped, case-insensitive name match).
    const existing = await cfg.db.query<{ id: string }>(
      "SELECT id FROM note_folders WHERE user_id = ? AND name COLLATE NOCASE = 'Ideas'",
      [user.id],
    )
    let folderId = existing[0]?.id
    const ts = now()
    if (!folderId) {
      folderId = uuid()
      await cfg.db.execute(
        'INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, NULL, \'Ideas\', 0, ?, ?)',
        [folderId, user.id, ts, ts],
      )
    }

    // Titles already present as live notes in the destination folder.
    const present = await cfg.db.query<{ title: string }>(
      'SELECT title FROM vault_notes WHERE user_id = ? AND folder_id = ? AND deleted_at IS NULL',
      [user.id, folderId],
    )
    const presentTitles = new Set(present.map((r) => r.title.trim().toLowerCase()))

    let created = 0
    let skipped = 0
    for (const s of sparks) {
      const title = s.title.trim() || 'Untitled idea'
      if (presentTitles.has(title.toLowerCase())) {
        skipped++
        continue
      }
      const sections: string[] = []
      if (s.description?.trim()) sections.push(s.description.trim())
      if (s.latest_note?.trim()) sections.push(`> ${s.latest_note.trim().replace(/\n/g, '\n> ')}`)
      await cfg.db.execute(
        'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
        [uuid(), user.id, folderId, title.slice(0, NOTE_TITLE_LIMIT), sections.join('\n\n').slice(0, NOTE_BODY_LIMIT), 'idea', ts, ts],
      )
      created++
    }
    return c.json({ ok: true, created, skipped, folder_id: folderId })
  })

  // S55: Quick-Notes → Vault import — the sparks twin (same owner approval: capture
  // surfaces get a one-way COPY into the knowledge base). The dashboard's sticky
  // notebook is for throwaway captures; this materializes each live quick note as a
  // long-form note so the things worth keeping can graduate into the vault.
  //  - Destination: a folder named "Notebook" (reused if one exists — case-insensitive).
  //  - kind 'note': first line becomes the title, full text the body.
  //  - kind 'list': the list's own title (or first item) is the title; items render as
  //    plain markdown bullets — done items struck through (~~x~~), the renderer's own
  //    subset; NO task-list syntax (S53 owner rule).
  //  - Dedupe: a derived title already present as a LIVE note in that folder is skipped
  //    (case-insensitive) — re-running is idempotent.
  //  - Tag "quicknote" rides every imported note; quick_notes rows are never touched.
  app.post('/import/quicknotes', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string; kind: string; title: string; content: string }>(
      'SELECT id, kind, title, content FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
      [user.id],
    )
    if (!rows.length) return c.json({ ok: true, created: 0, skipped: 0 })

    const existing = await cfg.db.query<{ id: string }>(
      "SELECT id FROM note_folders WHERE user_id = ? AND name COLLATE NOCASE = 'Notebook'",
      [user.id],
    )
    let folderId = existing[0]?.id
    const ts = now()
    if (!folderId) {
      folderId = uuid()
      await cfg.db.execute(
        "INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, NULL, 'Notebook', 0, ?, ?)",
        [folderId, user.id, ts, ts],
      )
    }
    const present = await cfg.db.query<{ title: string }>(
      'SELECT title FROM vault_notes WHERE user_id = ? AND folder_id = ? AND deleted_at IS NULL',
      [user.id, folderId],
    )
    const presentTitles = new Set(present.map((r) => r.title.trim().toLowerCase()))

    let created = 0
    let skipped = 0
    for (const q of rows) {
      let title = ''
      let body = ''
      if (q.kind === 'list') {
        let items: { t: string; d?: number }[] = []
        try {
          const parsed = JSON.parse(q.content)
          if (Array.isArray(parsed)) items = parsed.filter((x) => x && typeof x.t === 'string')
        } catch { /* malformed — falls back to empty item list */ }
        title = (q.title || '').trim() || (items[0]?.t ?? '').trim() || 'List'
        body = items
          .map((it) => `- ${it.d ? `~~${it.t.trim()}~~` : it.t.trim()}`)
          .filter((l) => l !== '-')
          .join('\n')
      } else {
        const text = q.content.replace(/\r\n/g, '\n')
        const firstLine = text.split('\n').find((l) => l.trim())?.trim() ?? ''
        title = firstLine.replace(/^#+\s*/, '').slice(0, 80)
        body = text
      }
      title = title.trim() || 'Untitled note'
      if (!body.trim() || presentTitles.has(title.toLowerCase())) {
        skipped++
        continue
      }
      await cfg.db.execute(
        'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
        [uuid(), user.id, folderId, title.slice(0, NOTE_TITLE_LIMIT), body.slice(0, NOTE_BODY_LIMIT), 'quicknote', ts, ts],
      )
      created++
    }
    return c.json({ ok: true, created, skipped, folder_id: folderId })
  })

  return app
}
