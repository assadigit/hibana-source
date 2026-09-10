// Obsidian bulk import (spec §9): extracted from integrations.ts Phase 4.
// Register the /api/import/obsidian route — .md files or .zip vault → Ideas.
import { Hono } from 'hono'
import { requireAuth } from '../../auth/middleware'
import { uuid } from '../../lib/ids'
import { markdownFromZip, parseMarkdownNote, ZipLimitError } from '../../lib/obsidian'
import { clientIp, hitRateLimit, RATE_RULES } from '../../services/ratelimit'
import type { Config, UserRow } from '../../types'

export function registerImport(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.post('/api/import/obsidian', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    // Heavy-endpoint metering (hardening 2026-08-28): import inflates archives and writes
    // unbounded rows — 5 per minute per IP is generous for a real vault import.
    if (await hitRateLimit(cfg.db, RATE_RULES.import, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many imports — wait a minute and try again.' }, 429)
    }
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'invalid_input' }, 400)

    const allFiles = (form.getAll('files') as File[]).filter((f) => f && typeof f.arrayBuffer === 'function')
    const mdFiles = allFiles.filter((f) => /\.md$/i.test(f.name ?? ''))
    const zipFiles = allFiles.filter((f) => /\.zip$/i.test(f.name ?? ''))
    if (mdFiles.length === 0 && zipFiles.length === 0) {
      return c.json({ error: 'no_markdown_files', message: 'Attach .md files or a .zip of your exported notes.' }, 400)
    }
    // Request-shape caps (hardening 2026-08-28): bounded file count + total upload bytes,
    // enforced before anything is read into memory. 100MB matches Cloudflare's body cap.
    const MAX_FILES = 200
    const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
    if (allFiles.length > MAX_FILES) {
      return c.json({ error: 'too_many', message: `Attach at most ${MAX_FILES} files per import.` }, 400)
    }
    const totalBytes = allFiles.reduce((n, f) => n + (f.size ?? 0), 0)
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return c.json({ error: 'too_many', message: 'Import is limited to 100MB of uploads per request.' }, 413)
    }

    // rule 1: titles are scoped to this user; collect existing ones once for dedupe.
    const existing = await cfg.db.query<{ title: string }>("SELECT LOWER(title) AS title FROM projects WHERE user_id = ?", [user.id])
    const knownTitles = new Set(existing.map((r) => String(r.title).toLowerCase()))

    const notes: Array<{ fileName: string; content: string }> = []
    for (const file of mdFiles) notes.push({ fileName: file.name, content: await file.text() })
    for (const file of zipFiles) {
      try {
        notes.push(...markdownFromZip(new Uint8Array(await file.arrayBuffer())))
      } catch (err) {
        if (err instanceof ZipLimitError) {
          return c.json({ error: 'too_many', message: err.message }, 413)
        }
        return c.json({ error: 'invalid_zip', message: 'Could not read that .zip file — is it a valid archive?' }, 400)
      }
    }

    let count = 0
    let duplicates = 0
    // H1 fix (2026-09-10): resolve the 'Imported' tag id atomically BEFORE the transaction
    // loop. The old pattern queried inside the loop on every iteration — pre-batch reads see
    // stale state, so every iteration after the first tried to INSERT a duplicate 'Imported'
    // tag, hitting UNIQUE(user_id, name) and rolling back the ENTIRE import. A fresh-user
    // multi-note import was guaranteed to fail.
    const importedTagRows = await cfg.db.query<{ id: string }>(
      `INSERT INTO tags (id, user_id, name, color, usage_count, created_at)
       VALUES (?, ?, 'Imported', '#94a3b8', 0, ?)
       ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
       RETURNING id`,
      [uuid(), user.id, new Date().toISOString()],
    )
    const importedTagId = importedTagRows[0]?.id
    // P3.2 (F-M3): wrap the whole import loop in ONE transaction. Was ~200 sequential
    // iterations each doing an INSERT + a sub-transaction (3-4 round trips each). Now
    // batched: all INSERTs + tag links land atomically; a failure rolls back the whole
    // import (no half-imported state).
    await cfg.db.transaction(async (tx) => {
      for (const note of notes) {
        const parsed = parseMarkdownNote(note.fileName, note.content)
        if (!parsed) continue
        const key = parsed.title.toLowerCase()
        if (knownTitles.has(key)) {
          duplicates++
          continue
        }
        knownTitles.add(key)

        const id = uuid()
        const now = new Date().toISOString()
        tx.sql(
          "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'personal', 'spark', 0, '', 0, ?, ?)",
          [id, user.id, parsed.title, parsed.description, now, now],
        )
        if (importedTagId) tx.sql('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [id, importedTagId])
        count++
      }
    })
    return c.json({ ok: true, imported: count, duplicates })
  })
}
