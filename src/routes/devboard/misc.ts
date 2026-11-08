// src/routes/devboard/misc.ts — S257 (the Phase 6 split of the former devboard.ts
// monolith): the devboard domain's odds and ends — the inline category quick-add,
// the backlog plan docs («برنامه آتی»), the project-level tag chips, and the
// htmlx ping. Behavior-neutral move; the project updated_at stamps ride
// touchProject (BE-16). BE-16's own quick note: the S152 category rename/recolor/
// archive routes RETIRED to routes/categories.ts long ago (0062) — they stay there.

import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody } from '../../lib/http'
import { getOwnedProject, toastHtml } from '../../lib/html'
import { localeOf, trFor } from '../../lib/i18n'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import { categoriesUserScoped, isValidCatPair, normCatName } from '../../lib/categories'
import type { Config, UserRow } from '../../types'
import {
  logHistory,
  ownedBacklogDoc,
  loadBacklog,
  findOrCreateTag, // S252 (BE-6/BE-12): the ONE shared race-safe + case-consistent tag resolver
  refreshTagUsage,
  touchProject, // S257 (BE-16): the ONE project updated_at stamp
} from '../devboard-helpers'
import { createCategorySchema, createBacklogDocSchema, updateBacklogDocSchema, tagBodySchema } from './schemas'

export function miscRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

  // ---- categories (S152: the library — create + enable in one beat) ----
  // The inline quick-add path (block 4): creates the category in the caller's
  // library (16-tile pair validated) AND enables it on this project in the same
  // request, so the composer never detours to Settings. A live case/trim-
  // insensitive name match IN THE CALLER'S OWN library (S181: user-scoped —
  // another user's same-named row must NOT be attached to this project) is
  // REUSED (enabled on this project + returned) instead of forking a duplicate.
  app.post('/api/projects/:projectId/categories', async (c) => {
    const body = await jsonBody<z.infer<typeof createCategorySchema>>(c, createCategorySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    if (!isValidCatPair(body.color_fill, body.color_text)) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const name = body.name.trim()
    if (!name) return errJson(c, ErrorCode.invalid_input)
    const scoped = await categoriesUserScoped(cfg.db)
    const existing = scoped
      ? await cfg.db.query<{ id: string }>(
          'SELECT id FROM categories WHERE user_id = ? AND lower(trim(name)) = ? AND is_archived = 0 LIMIT 1',
          [user.id, normCatName(name)],
        )
      : await cfg.db.query<{ id: string }>(
          'SELECT id FROM categories WHERE lower(trim(name)) = ? AND is_archived = 0 LIMIT 1',
          [normCatName(name)],
        )
    if (existing[0]) {
      await cfg.db.execute('INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)', [p.id, existing[0].id])
      return c.json({ ok: true, id: existing[0].id, existing: true }, 200)
    }
    const id = uuid()
    if (scoped) {
      await cfg.db.execute(
        'INSERT INTO categories (id, user_id, name, color_fill, color_text, is_archived, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [id, user.id, name, body.color_fill.toUpperCase(), body.color_text.toUpperCase(), new Date().toISOString()],
      )
    } else {
      await cfg.db.execute(
        'INSERT INTO categories (id, name, color_fill, color_text, is_archived, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        [id, name, body.color_fill.toUpperCase(), body.color_text.toUpperCase(), new Date().toISOString()],
      )
    }
    await cfg.db.execute('INSERT INTO project_categories (project_id, category_id) VALUES (?, ?)', [p.id, id])
    return c.json({ ok: true, id }, 201)
  })

  // S152: PATCH/DELETE /api/categories/:id + POST /api/projects/:projectId/categories/reorder
  // are RETIRED from this module — the global library serves rename/recolor/archive
  // (routes/categories.ts) and the library reads name-ordered (no reorder). The
  // legacy per-project rows folded into the library in 0062; two systems writing one
  // dev_tasks.category_id column would corrupt each other's UX.

  // ---- backlog plan docs (0033, «برنامه آتی» tab) --------------------------------

  app.get('/api/projects/:projectId/backlog', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    return c.json(await loadBacklog(cfg, p.id))
  })

  app.post('/api/projects/:projectId/backlog/docs', async (c) => {
    const body = await jsonBody<z.infer<typeof createBacklogDocSchema>>(c, createBacklogDocSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const id = uuid()
    const now = new Date().toISOString()
    await cfg.db.transaction(async (tx) => {
      tx.sql('INSERT INTO backlog_docs (id, project_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id, p.id, body.title, body.content, now, now,
      ])
      tx.sql("INSERT INTO backlog_doc_revisions (id, doc_id, kind, title, content, created_at) VALUES (?, ?, 'create', ?, ?, ?)", [
        uuid(), id, body.title, body.content, now,
      ])
    })
    await touchProject(cfg, p.id, now) // S257 (BE-16): the one project-stamp helper
    await logHistory(cfg, p.id, t('Plan doc created: {title}', 'سند برنامه «{title}» ایجاد شد', { title: body.title }))
    return c.json({ ok: true, id }, 201)
  })

  app.patch('/api/backlog/docs/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof updateBacklogDocSchema>>(c, updateBacklogDocSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const doc = await ownedBacklogDoc(cfg, user.id, c.req.param('id'))
    if (!doc) return errJson(c, ErrorCode.not_found)
    const now = new Date().toISOString()
    const title = body.title ?? doc.title
    const content = body.content ?? doc.content
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE backlog_docs SET title = ?, content = ?, updated_at = ? WHERE id = ?', [title, content, now, doc.id])
      tx.sql("INSERT INTO backlog_doc_revisions (id, doc_id, kind, title, content, created_at) VALUES (?, ?, 'update', ?, ?, ?)", [
        uuid(), doc.id, title, content, now,
      ])
    })
    await touchProject(cfg, doc.project_id, now) // S257 (BE-16): the one project-stamp helper
    await logHistory(cfg, doc.project_id, t('Plan doc updated: {title}', 'سند برنامه «{title}» به‌روزرسانی شد', { title }))
    return c.json({ ok: true })
  })

  app.delete('/api/backlog/docs/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const doc = await ownedBacklogDoc(cfg, user.id, c.req.param('id'))
    if (!doc) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM backlog_docs WHERE id = ?', [doc.id])
    await logHistory(cfg, doc.project_id, t('Plan doc deleted: {title}', 'سند برنامه «{title}» حذف شد', { title: doc.title }))
    return c.json({ ok: true })
  })

  // ---- project tags attach/detach (the redesigned detail header's tag chips) ----

  app.post('/api/projects/:projectId/tags', async (c) => {
    const body = await jsonBody<z.infer<typeof tagBodySchema>>(c, tagBodySchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // S252 (BE-6/BE-12): the shared find-or-create replaces this route's private
    // exact-match copy — same shape as the task-tags route in tasks.ts. {ok:true,id}, 201.
    const tagId = await findOrCreateTag(cfg, user.id, body.name, body.color)
    await cfg.db.execute('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [p.id, tagId])
    // S30 (B2): project chips count toward usage too — the label manager totals both.
    await refreshTagUsage(cfg, [tagId])
    // S161 (spec #3): a tag add is a field edit — the idea's updated_at bumps.
    await touchProject(cfg, p.id) // S257 (BE-16): fresh stamp, exactly as before
    return c.json({ ok: true, id: tagId }, 201)
  })

  app.delete('/api/projects/:projectId/tags/:tagId', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM project_tags WHERE project_id = ? AND tag_id = ?', [p.id, c.req.param('tagId')])
    await refreshTagUsage(cfg, [c.req.param('tagId')])
    // S161 (spec #3): a tag remove bumps the idea's updated_at too.
    await touchProject(cfg, p.id) // S257 (BE-16): fresh stamp, exactly as before
    return c.json({ ok: true })
  })

  app.all('/api/devboard/ping', (c) => {
    const t = trFor(c)
    return c.html(toastHtml(t('Saved', 'ذخیره شد'), localeOf(c), undefined, 'ok'))
  })

  return app
}
