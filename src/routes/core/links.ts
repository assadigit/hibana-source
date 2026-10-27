// Core — link routes (Phase 4 split from routes/core.ts).
//
// Purpose: the project link list — list (htmx fragment + JSON), add (bumps
// updated_at per S161), PATCH (owner-scoped at the write, SEC-11), DELETE.
//
// Public API: registerCoreLinks(app, cfg) — registered by core/index.ts.
import { z } from 'zod'
import { jsonBody, esc, isHtmx } from '../../lib/http'
import { getOwnedProject, icon, toastHtml } from '../../lib/html'
import { localeOf, trFor, trL, type Locale } from '../../lib/i18n'
import { uuid } from '../../lib/ids'
import { createLinkSchema, updateLinkSchema } from '../../validation/schemas'
import { errJson, ErrorCode } from '../../lib/errors'
import { ownedProjectId } from './ownership'
import type { Config, LinkRow, UserRow } from '../../types'

export function registerCoreLinks(app: import('hono').Hono<{ Variables: { user: UserRow; reqId?: string } }>, cfg: Config) {
  // ---- links -----------------------------------------------------------------
  const linksHtml = (links: LinkRow[], lang: Locale): string =>
    links
      .map(
        (l) => `<li class="row spread">
        <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>
        <button class="ghost danger" hx-delete="/api/links/${l.id}" hx-target="#links" hx-swap="innerHTML">${icon('x')}</button>
      </li>`,
      )
      .join('') || `<li class="muted">${trL(lang, 'No links yet.', 'هنوز پیوندی نیست.')}</li>`

  app.get('/api/projects/:projectId/links', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const links = await cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [p.id])
    if (isHtmx(c)) return c.html(linksHtml(links, localeOf(c)))
    return c.json({ links })
  })

  app.post('/api/projects/:projectId/links', async (c) => {
    const body = await jsonBody<z.infer<typeof createLinkSchema>>(c, createLinkSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const id = body.id ?? uuid()
    await cfg.db.execute('INSERT INTO links (id, project_id, label, url, created_at) VALUES (?, ?, ?, ?, ?)', [
      id, p.id, body.label, body.url, new Date().toISOString(),
    ])
    // S161 (spec #3): every field edit bumps the idea's updated_at — a link add is a
    // field edit; the folder's "Updated" metric + the shelf's recency order ride it.
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [new Date().toISOString(), p.id])
    if (isHtmx(c)) {
      const links = await cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [p.id])
      return c.html(linksHtml(links, localeOf(c)), 201)
    }
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/links/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateLinkSchema>>(c, updateLinkSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedProjectId(cfg, user.id, 'links', c.req.param('id'))
    if (!projectId) return errJson(c, ErrorCode.not_found)
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`)
      params.push(v)
    }
    params.push(c.req.param('id'))
    // SEC-11 (S198/S199): the UPDATE re-scopes by owner at the write itself (the
    // pre-check read is not a guarantee) — a foreign row is simply not updated.
    params.push(user.id)
    await cfg.db.execute(`UPDATE links SET ${sets.join(', ')} WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`, params)
    if (isHtmx(c)) return c.html(toastHtml(t('Link updated', 'پیوند به‌روزرسانی شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true })
  })

  app.delete('/api/links/:id', async (c) => {
    const user = c.get('user')
    const owned = await cfg.db.query<{ project_id: string }>(
      'SELECT project_id FROM links WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)',
      [c.req.param('id'), user.id],
    )
    // Phase 1 (isolation suite): a foreign/missing id is a 404 like the PATCH above —
    // the old rowcount-agnostic {ok:true} answered a no-op delete with a false 200.
    if (owned.length === 0) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM links WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [
      c.req.param('id'), user.id,
    ])
    // S161 (spec #3): a link remove bumps the owning idea/project's updated_at too.
    if (owned.length) {
      await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [new Date().toISOString(), owned[0].project_id])
    }
    if (isHtmx(c)) {
      const links = owned.length
        ? await cfg.db.query<LinkRow>('SELECT * FROM links WHERE project_id = ? ORDER BY created_at', [owned[0].project_id])
        : []
      return c.html(linksHtml(links, localeOf(c)))
    }
    return c.json({ ok: true })
  })
}
