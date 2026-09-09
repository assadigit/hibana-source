import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { esc, etag, jsonBody } from '../lib/http'
import { icon, toastHtml } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { uuid } from '../lib/ids'
import { createTagSchema, updateTagSchema, mergeTagsSchema } from '../validation/schemas'
import type { Config, TagRow, UserRow } from '../types'

export function tagsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const tags = await cfg.db.query<TagRow>(
      'SELECT t.*, COUNT(pt.project_id) AS usage_count FROM tags t LEFT JOIN project_tags pt ON pt.tag_id = t.id WHERE t.user_id = ? GROUP BY t.id ORDER BY t.name',
      [user.id],
    )
    if (c.req.header('HX-Request')) {
      return await etag(c, c.html(
        tags
          .map(
            (t) => `<span class="chip" style="background:${t.color}33"><span style="color:${t.color}">●</span> ${esc(t.name)} · ${t.usage_count} <button class="ghost danger" hx-delete="/api/tags/${t.id}" hx-target="#taglist" hx-swap="innerHTML">${icon('x')}</button></span>`,
          )
          .join('') +
          `<div class="muted small">${t('Rename/merge for tags arrives with Settings (Phase 3).', 'تغییر نام و ادغام برچسب‌ها همراه با تنظیمات (فاز ۳) ارائه می‌شود.')}</div>`,
      ))
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
    const body = await jsonBody<z.infer<typeof updateTagSchema>>(c, updateTagSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`)
      params.push(v)
    }
    params.push(c.req.param('id'), user.id)
    await cfg.db.execute(`UPDATE tags SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
    return c.json({ ok: true })
  })

  app.delete('/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    await cfg.db.execute('DELETE FROM tags WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id])
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Tag deleted', 'برچسب حذف شد'), localeOf(c)))
    return c.json({ ok: true })
  })

  app.post('/merge', async (c) => {
    const body = await jsonBody<z.infer<typeof mergeTagsSchema>>(c, mergeTagsSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    await cfg.db.transaction(async (tx) => {
      tx.sql(
        'UPDATE project_tags SET tag_id = ? WHERE tag_id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
        [body.toId, body.fromId, user.id],
      )
      tx.sql('DELETE FROM tags WHERE id = ? AND user_id = ?', [body.fromId, user.id])
    })
    return c.json({ ok: true })
  })

  return app
}