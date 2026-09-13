import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, etag, jsonBody } from '../lib/http'
import { icon } from '../lib/html'
import { trFor } from '../lib/i18n'
import { uuid } from '../lib/ids'
import { refreshTagUsage, syncTaskSearchTags } from './devboard-helpers'
import { createTagSchema } from '../validation/schemas'
import type { Config, TagRow, UserRow } from '../types'

// Tags — the ONE home for /api/tags (S43 consolidation).
//
// History: this file used to be shadowed by devboard.ts's S30-batch-4 label-manager
// routes (app.route('/', devboardRoutes) registers BEFORE app.route('/api/tags',
// tagsRoutes) and Hono keeps the first match) — so settings.html's
// hx-get="/api/tags" (expects CHIP HTML when HX-Request is set) received devboard's
// JSON instead. The raw JSON string — an unbreakable 497px token — was dumped into
// #taglist, overflowing the settings page sideways on phones (the S43 mobile audit's
// "container out of box" on settings: doc h-scroll +107, the whole layout zoomed to
// fit). The devboard duplicates are deleted; this file now carries the FULL
// label-manager semantics (rename-collision-merge, search_tags FTS rewrite,
// delete-unused-only) plus the HX branches the settings page needs.

const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})
const tagMergeSchema = z.object({ into: z.string().max(64) })

export function tagsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // The chip row the settings page swaps into #taglist (hx-swap="innerHTML").
  // The delete affordance rides only UNUSED tags — the endpoint refuses to delete
  // in-use ones (409), so a button on a used chip would be a dead control.
  const chipsHtml = (tags: TagRow[], t: (en: string, fa: string) => string) =>
    tags
      .map(
        (tag) =>
          `<span class="chip" style="background:${tag.color}33"><span style="color:${tag.color}">●</span> ${esc(tag.name)} · ${tag.usage_count}${
            (tag.usage_count ?? 0) === 0
              ? ` <button class="ghost danger" hx-delete="/api/tags/${tag.id}" hx-target="#taglist" hx-swap="innerHTML">${icon('x')}</button>`
              : ''
          }</span>`,
      )
      .join('') +
      `<div class="muted small">${t('Rename/merge for tags lives on the board (Labels). Used tags are merged, never deleted.', 'تغییر نام و ادغام برچسب‌ها در برد (برچسب‌ها) انجام می‌شود. برچسبِ در حال استفاده ادغام می‌شود، نه حذف.')}</div>`

  app.get('/', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const tags = await cfg.db.query<TagRow>(
      'SELECT t.* FROM tags t WHERE t.user_id = ? ORDER BY t.usage_count DESC, t.name',
      [user.id],
    )
    if (c.req.header('HX-Request')) {
      const res = c.html(chipsHtml(tags, t))
      // The SAME url serves JSON (fetch clients) and HTML (htmx) — the browser HTTP
      // cache must never cross-serve them (the S43 bug class this route closed).
      res.headers.set('Vary', 'HX-Request')
      return await etag(c, res)
    }
    return await etag(c, c.json({ tags }))
  })

  app.post('/', async (c) => {
    const body = await jsonBody<z.infer<typeof createTagSchema>>(c, createTagSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const id = uuid()
    try {
      await cfg.db.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', [
        id, user.id, body.name.trim(), body.color ?? '#f6d365', new Date().toISOString(),
      ])
    } catch {
      return c.json({ error: 'duplicate_tag' }, 409)
    }
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof tagUpdateSchema>>(c, tagUpdateSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const tag = await cfg.db.query<{ id: string; name: string }>('SELECT id, name FROM tags WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id])
    if (!tag.length) return c.json({ error: 'not_found' }, 404)
    const tagRow = tag[0]

    // RENAME with collision = MERGE (the manager's rename doubles as a merge when the
    // target name already exists): "Refactor" → "Tech-Debt" moves every link onto the
    // existing Tech-Debt tag and deletes Refactor. Exact + NOCASE collisions only.
    if (body.name !== undefined && body.name !== tagRow.name) {
      const clash = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?', [user.id, body.name, tagRow.id])
      if (clash.length) {
        const target = clash[0].id
        // dev-task links: INSERT OR IGNORE (a task linked to both keeps ONE row — the PK)
        await cfg.db.execute(
          `INSERT OR IGNORE INTO dev_task_tags (task_id, tag_id) SELECT task_id, ? FROM dev_task_tags WHERE tag_id = ?`,
          [target, tagRow.id],
        )
        await cfg.db.execute(
          `INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT project_id, ? FROM project_tags WHERE tag_id = ?`,
          [target, tagRow.id],
        )
        // rewrite search_tags for every task that carried the old tag, then drop it
        const affected = await cfg.db.query<{ task_id: string }>('SELECT task_id FROM dev_task_tags WHERE tag_id = ?', [tagRow.id])
        await cfg.db.execute('DELETE FROM dev_task_tags WHERE tag_id = ?', [tagRow.id])
        await cfg.db.execute('DELETE FROM project_tags WHERE tag_id = ?', [tagRow.id])
        await cfg.db.execute('DELETE FROM tags WHERE id = ?', [tagRow.id])
        for (const row of affected) await syncTaskSearchTags(cfg, row.task_id)
        await refreshTagUsage(cfg, [tagRow.id, target])
        return c.json({ ok: true, merged_into: target })
      }
      await cfg.db.execute('UPDATE tags SET name = ? WHERE id = ?', [body.name, tagRow.id])
    }
    if (body.color !== undefined) {
      await cfg.db.execute('UPDATE tags SET color = ? WHERE id = ?', [body.color, tagRow.id])
    }
    // a plain rename/color change rewrites every affected task's FTS text
    if (body.name !== undefined) {
      const affected = await cfg.db.query<{ task_id: string }>('SELECT task_id FROM dev_task_tags WHERE tag_id = ?', [tagRow.id])
      for (const row of affected) await syncTaskSearchTags(cfg, row.task_id)
    }
    return c.json({ ok: true })
  })

  // Explicit merge: { into: targetTagId } — moves every link, deletes the source.
  app.post('/:id/merge', async (c) => {
    const body = await jsonBody<z.infer<typeof tagMergeSchema>>(c, tagMergeSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const src = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id])
    const dst = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE id = ? AND user_id = ?', [body.into, user.id])
    if (!src.length || !dst.length || src[0].id === dst[0].id) return c.json({ error: 'not_found' }, 404)
    const srcId = src[0].id
    const dstId = dst[0].id
    await cfg.db.execute('INSERT OR IGNORE INTO dev_task_tags (task_id, tag_id) SELECT task_id, ? FROM dev_task_tags WHERE tag_id = ?', [dstId, srcId])
    await cfg.db.execute('INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT project_id, ? FROM project_tags WHERE tag_id = ?', [dstId, srcId])
    const affected = await cfg.db.query<{ task_id: string }>('SELECT task_id FROM dev_task_tags WHERE tag_id = ?', [srcId])
    await cfg.db.execute('DELETE FROM dev_task_tags WHERE tag_id = ?', [srcId])
    await cfg.db.execute('DELETE FROM project_tags WHERE tag_id = ?', [srcId])
    await cfg.db.execute('DELETE FROM tags WHERE id = ?', [srcId])
    for (const row of affected) await syncTaskSearchTags(cfg, row.task_id)
    await refreshTagUsage(cfg, [srcId, dstId])
    return c.json({ ok: true })
  })

  // Delete a tag — UNUSED tags only (usage_count = 0). Used tags must be merged or
  // unlinked first ("delete-unused tags", the owner's wording). HX requests get the
  // refreshed chip row back (settings' hx-target="#taglist" hx-swap="innerHTML").
  app.delete('/:id', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ usage_count: number }>('SELECT usage_count FROM tags WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id])
    if (!rows.length) return c.json({ error: 'not_found' }, 404)
    if ((rows[0].usage_count ?? 0) > 0) return c.json({ error: 'tag_in_use' }, 409)
    await cfg.db.execute('DELETE FROM tags WHERE id = ?', [c.req.param('id')])
    if (c.req.header('HX-Request')) {
      const t = trFor(c)
      const tags = await cfg.db.query<TagRow>(
        'SELECT t.* FROM tags t WHERE t.user_id = ? ORDER BY t.usage_count DESC, t.name',
        [user.id],
      )
      const res = c.html(chipsHtml(tags, t))
      res.headers.set('Vary', 'HX-Request')
      return res
    }
    return c.json({ ok: true })
  })

  return app
}
