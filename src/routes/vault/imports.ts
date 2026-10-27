// Notes Vault — one-way import routes (Phase 4 split from routes/vault.ts).
//
// Purpose: POST /import/sparks (materialize every live spark as a vault note in the
// find-or-create "Ideas" folder, dedupe by title) and POST /import/quicknotes (the
// Notebook twin — kind 'note' takes first line as title, kind 'list' renders done
// items struck through). COPY, never move: the source rows are never touched.
//
// Public API: registerVaultImports(app, cfg) — registered by vault/index.ts.
import { uuid } from '../../lib/ids'
import { NOTE_TITLE_LIMIT, NOTE_BODY_LIMIT } from './helpers'
import { now } from './ownership'
import type { Config, UserRow } from '../../types'

export function registerVaultImports(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
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
}
