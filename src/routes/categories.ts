// S152 — the GLOBAL task-category library routes (the owner's 9-block spec). The
// library is the single source of truth every surface reads: Settings → Categories
// (block 2's management screen), the task composer's picker (block 3), the inline
// quick-add (block 4), the per-project toggle (block 7) and the devboard's unified
// flows. The legacy project-scoped task_categories system folded into this library
// in migration 0062 — two id namespaces in dev_tasks.category_id would corrupt each
// other's UX, so there is ONE system now.
//
// S181 (0064, the owner's written approval): the library is USER-SCOPED. Every
// route below filters on the caller — the `void user` placeholders are gone. On a
// D1 that has not applied 0064 yet (the deploy-ahead window), the
// categoriesUserScoped() probe falls back to the legacy un-scoped queries so the
// window behaves exactly like the pre-0064 install (readable, writable) instead of
// 500ing.
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { jsonBody } from '../lib/http'
import { getOwnedProject } from '../lib/html'
import { uuid } from '../lib/ids'
import { CAT_PAIRS, categoriesUserScoped, isValidCatPair, normCatName, type CategoryRow } from '../lib/categories'
import type { Config, UserRow } from '../types'

const createSchema = z.object({
  name: z.string().min(1).max(80),
  color_fill: z.string().max(7),
  color_text: z.string().max(7),
})
const renameSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color_fill: z.string().max(7).optional(),
  color_text: z.string().max(7).optional(),
})
const toggleSchema = z.object({ ids: z.array(z.string().max(64)).max(200) })

// The enabled-category rows a project's pickers/toggles read (block 3: suggestions
// come from the project's enabled categories; block 8: archived never re-enters).
// Post-0064 a project's enables can only ever link its OWNER's categories (the
// migration backfilled it that way + the PUT below validates it), so the
// project-scoped join is user-safe by construction — no extra filter needed.
export async function enabledCategoriesForProject(cfg: Config, projectId: string): Promise<CategoryRow[]> {
  return cfg.db.query<CategoryRow>(
    `SELECT c.* FROM categories c
     JOIN project_categories pc ON pc.category_id = c.id
     WHERE pc.project_id = ? AND c.is_archived = 0
     ORDER BY c.name COLLATE NOCASE, c.created_at`,
    [projectId],
  )
}

// 409 when a LIVE category already carries the name (case/trim-insensitive) —
// S181: within the CALLER's library only (two users may both have a "ui/ux").
// BUGFIX (S181, caught by the scoping tests): the old `id != COALESCE(?, ?)`
// shape passed (null, null) on the CREATE path (no excludeId) — and
// `id != NULL` is NULL in SQL, so the whole WHERE went NULL and the create-path
// duplicate NEVER matched (the 409 was unreachable; the INSERT then died on the
// unique index as a 500). The (? IS NULL OR id != ?) form keeps the
// rename-excludes-itself case AND finally lets the create case match.
async function liveNameOwner(cfg: Config, userId: string, name: string, excludeId?: string): Promise<{ id: string } | undefined> {
  const scoped = await categoriesUserScoped(cfg.db)
  const rows = scoped
    ? await cfg.db.query<{ id: string }>(
        'SELECT id FROM categories WHERE user_id = ? AND lower(trim(name)) = ? AND is_archived = 0 AND (? IS NULL OR id != ?) LIMIT 1',
        [userId, normCatName(name), excludeId ?? null, excludeId ?? null],
      )
    : await cfg.db.query<{ id: string }>(
        'SELECT id FROM categories WHERE lower(trim(name)) = ? AND is_archived = 0 AND (? IS NULL OR id != ?) LIMIT 1',
        [normCatName(name), excludeId ?? null, excludeId ?? null],
      )
  return rows[0]
}

export function categoriesRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // Block 2 — the management screen's list: every NON-archived category of the
  // CALLER's library (archived rows stay in the table for history but leave every
  // selection surface).
  app.get('/api/categories', async (c) => {
    const user = c.get('user')
    const scoped = await categoriesUserScoped(cfg.db)
    const rows = scoped
      ? await cfg.db.query<CategoryRow & { projects: number }>(
          `SELECT c.*, (SELECT COUNT(*) FROM project_categories pc WHERE pc.category_id = c.id) AS projects
           FROM categories c WHERE c.user_id = ? AND c.is_archived = 0 ORDER BY c.name COLLATE NOCASE, c.created_at`,
          [user.id],
        )
      : await cfg.db.query<CategoryRow & { projects: number }>(
          `SELECT c.*, (SELECT COUNT(*) FROM project_categories pc WHERE pc.category_id = c.id) AS projects
           FROM categories c WHERE c.is_archived = 0 ORDER BY c.name COLLATE NOCASE, c.created_at`,
        )
    return c.json({ categories: rows })
  })

  // Create — the pair must be one of the 16 curated tiles (block 5), the name must
  // not duplicate a live row in the CALLER's library (block 3's why, enforced
  // server-side too).
  app.post('/api/categories', async (c) => {
    const body = await jsonBody<z.infer<typeof createSchema>>(c, createSchema)
    if (!body || !isValidCatPair(body.color_fill, body.color_text)) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const name = body.name.trim()
    if (!name) return c.json({ error: 'invalid_input' }, 400)
    const owner = await liveNameOwner(cfg, user.id, name)
    if (owner) return c.json({ error: 'duplicate', id: owner.id }, 409)
    const id = uuid()
    const scoped = await categoriesUserScoped(cfg.db)
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
    return c.json({ ok: true, id }, 201)
  })

  // Rename / recolor (block 2's per-category actions). Archiving has its own POST —
  // the PATCH never flips is_archived (block 8's archive-don't-delete is explicit).
  app.patch('/api/categories/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof renameSchema>>(c, renameSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const scoped = await categoriesUserScoped(cfg.db)
    const rows = scoped
      ? await cfg.db.query<CategoryRow>('SELECT * FROM categories WHERE id = ? AND user_id = ? AND is_archived = 0', [c.req.param('id'), user.id])
      : await cfg.db.query<CategoryRow>('SELECT * FROM categories WHERE id = ? AND is_archived = 0', [c.req.param('id')])
    const cat = rows[0]
    if (!cat) return c.json({ error: 'not_found' }, 404)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return c.json({ error: 'invalid_input' }, 400)
      const owner = await liveNameOwner(cfg, user.id, name, cat.id)
      if (owner) return c.json({ error: 'duplicate' }, 409)
      sets.push('name = ?')
      params.push(name)
    }
    if (body.color_fill !== undefined || body.color_text !== undefined) {
      const fill = body.color_fill ?? cat.color_fill
      const ink = body.color_text ?? cat.color_text
      if (!isValidCatPair(fill, ink)) return c.json({ error: 'invalid_input' }, 400)
      sets.push('color_fill = ?', 'color_text = ?')
      params.push(fill.toUpperCase(), ink.toUpperCase())
    }
    if (!sets.length) return c.json({ ok: true })
    params.push(cat.id)
    await cfg.db.execute(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, params)
    return c.json({ ok: true })
  })

  // Archive (block 8): the row STAYS, every task keeps its category_id, and the
  // category merely leaves the NEW-selection surfaces (autocomplete + toggles).
  app.post('/api/categories/:id/archive', async (c) => {
    const user = c.get('user')
    const scoped = await categoriesUserScoped(cfg.db)
    const rows = scoped
      ? await cfg.db.query<CategoryRow>('SELECT id FROM categories WHERE id = ? AND user_id = ? AND is_archived = 0', [c.req.param('id'), user.id])
      : await cfg.db.query<CategoryRow>('SELECT id FROM categories WHERE id = ? AND is_archived = 0', [c.req.param('id')])
    if (!rows[0]) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('UPDATE categories SET is_archived = 1 WHERE id = ?', [rows[0].id])
    return c.json({ ok: true })
  })

  // S174 (owner round: "add option to delete category — currently it's only
  // archive"): HARD DELETE, the archive's destructive sibling. Semantics mirror the
  // FK declarations in 0062 exactly — dev_tasks.category_id is ON DELETE SET NULL
  // (the tasks themselves stay, they just lose their chip) and project_categories
  // is ON DELETE CASCADE (the per-project enables go). The explicit statements run
  // inside ONE transaction so the outcome never depends on the engine's
  // foreign_keys enforcement mode (the Node path and D1 differ there). Works on
  // archived rows too — the id is the only contract. S181: only the OWNER's row.
  app.delete('/api/categories/:id', async (c) => {
    const user = c.get('user')
    const scoped = await categoriesUserScoped(cfg.db)
    const rows = scoped
      ? await cfg.db.query<CategoryRow>('SELECT id FROM categories WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id])
      : await cfg.db.query<CategoryRow>('SELECT id FROM categories WHERE id = ?', [c.req.param('id')])
    if (!rows[0]) return c.json({ error: 'not_found' }, 404)
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE dev_tasks SET category_id = NULL WHERE category_id = ?', [rows[0].id])
      tx.sql('DELETE FROM project_categories WHERE category_id = ?', [rows[0].id])
      tx.sql('DELETE FROM categories WHERE id = ?', [rows[0].id])
    })
    return c.json({ ok: true })
  })

  // Block 7 — the per-project toggle list (read) and the enable-set write. The PUT
  // replaces the whole set (the client sends the post-toggle ids): every id must be
  // a live category OF THE PROJECT'S OWNER (S181 — a foreign id, or another user's
  // id, is a 400, not a half-applied set).
  app.get('/api/projects/:projectId/categories', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const enabled = await enabledCategoriesForProject(cfg, p.id)
    const scoped = await categoriesUserScoped(cfg.db)
    const all = scoped
      ? await cfg.db.query<CategoryRow>('SELECT * FROM categories WHERE user_id = ? AND is_archived = 0 ORDER BY name COLLATE NOCASE, created_at', [user.id])
      : await cfg.db.query<CategoryRow>('SELECT * FROM categories WHERE is_archived = 0 ORDER BY name COLLATE NOCASE, created_at')
    const on = new Set(enabled.map((r) => r.id))
    return c.json({ enabled: enabled.map((r) => r.id), categories: all.map((r) => ({ ...r, enabled: on.has(r.id) ? 1 : 0 })) })
  })

  app.put('/api/projects/:projectId/categories', async (c) => {
    const body = await jsonBody<z.infer<typeof toggleSchema>>(c, toggleSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return c.json({ error: 'not_found' }, 404)
    const uniq = [...new Set(body.ids)]
    const scoped = await categoriesUserScoped(cfg.db)
    for (const id of uniq) {
      const rows = scoped
        ? await cfg.db.query<{ id: string }>('SELECT id FROM categories WHERE id = ? AND user_id = ? AND is_archived = 0', [id, user.id])
        : await cfg.db.query<{ id: string }>('SELECT id FROM categories WHERE id = ? AND is_archived = 0', [id])
      if (!rows[0]) return c.json({ error: 'invalid_input' }, 400)
    }
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM project_categories WHERE project_id = ?', [p.id])
      for (const id of uniq) tx.sql('INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)', [p.id, id])
    })
    return c.json({ ok: true, ids: uniq })
  })

  return app
}

// The 16 tiles re-exported for the swatch-grid renderers (server-side HTML builders
// read this — the client reads the --cat-sw-* tokens from variables.css).
export { CAT_PAIRS }
