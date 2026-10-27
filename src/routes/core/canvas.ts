// Core — canvas sync routes (Phase 4 split from routes/core.ts).
//
// Purpose: the idempotent LWW canvas/notebook element sync — viewport + full
// GET, the batch POST (element-by-element validation per AP-34, newest-wins
// per id, chunked pre-check per AP-20, conflict-scoped upsert, 7-day tombstone
// sweep), and note→idea promotion.
//
// Public API: registerCoreCanvas(app, cfg) — registered by core/index.ts.
import { z } from 'zod'
import { jsonBody, isHtmx } from '../../lib/http'
import { toastHtml } from '../../lib/html'
import { localeOf, trFor } from '../../lib/i18n'
import { log } from '../../lib/log'
import { uuid } from '../../lib/ids'
import { queryIn } from '../../lib/inchunk'
import { uuidSchema } from '../../validation/schemas'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow } from '../../types'

export function registerCoreCanvas(app: import('hono').Hono<{ Variables: { user: UserRow; reqId?: string } }>, cfg: Config) {
  // ---- canvas sync (spec §3.4 — idempotent LWW batch upsert, Q4-A) ----------
  const elementSchema = z.object({
    id: uuidSchema,
    type: z.enum(['note', 'stroke', 'image', 'frame', 'shape', 'comment', 'block', 'sticky']),
    // frame: movable region that carries content (2026-08-26); shape/comment/block: 0032 squig batch (2026-08-31) — rect/oval/circle primitives, comment pins, lo-fi wireframe groups; sticky: notebook sticky notes (batch s)
    x: z.number(),
    y: z.number(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    color: z.string().max(20).optional().default('#fef08a'),
    content: z.string().max(10_000).optional().default(''),
    font_size: z.number().int().min(6).max(400).nullable().optional(),
    // 0055 (S40): fabric text alignment — NULL/absent = 'left' (the fabric default),
    // so legacy rows and old clients keep rendering exactly as before.
    text_align: z.enum(['left', 'center', 'right']).nullable().optional(),
    board: z.enum(['canvas', 'notebook']).optional().default('canvas'),
    promoted_project_id: uuidSchema.nullable().optional(),
    z_index: z.number().int().optional().default(0),
    deleted: z.union([z.literal(0), z.literal(1)]).optional().default(0),
    locked: z.union([z.literal(0), z.literal(1)]).optional().default(0), // 0024: per-element lock
    angle: z.number().min(-3600).max(3600).optional().default(0), // 0049: persisted rotation (fabric mtr), degrees CW y-down
    created_at: z.string().optional(),
    updated_at: z.string().max(40),
  })
  // AP-34 (Phase 2): per-element tolerance — the array is validated element-BY-element.
  // The old whole-array schema let ONE bad element (e.g. content over the 10k cap)
  // 400 the ENTIRE body, and the client's 400-drop rule then silently discarded every
  // OTHER queued edit with it (a mass-drop on top of an already-unsaveable element).
  // Body-level problems (elements not an array / >500 entries) still 400.
  const syncSchema = z.object({ elements: z.array(z.unknown()).max(500), upto: z.string().optional() })
  const promoteSchema = z.object({ title: z.string().min(1).max(200).optional() })

  app.get('/api/canvas', async (c) => {
    const q = c.req.query()
    const board = q.board === 'notebook' ? 'notebook' : 'canvas'
    const user = c.get('user')
    // P1.5 (F-L4): Number('abc') returns NaN -> x < NaN is always false -> silent empty
    // canvas. Guard with a finite check: garbage/minX/maxY params fall back to the open
    // defaults (1e9 / -1e9) so a malformed viewport query returns all elements, not none.
    const num = (v: string | undefined, dflt: number): number => {
      if (v === undefined) return dflt
      const n = Number(v)
      return Number.isFinite(n) ? n : dflt
    }
    const rows = await cfg.db.query(
      `SELECT * FROM canvas_elements
       WHERE user_id = ? AND board = ? AND deleted = 0 AND x < ? AND x + COALESCE(width, 0) > ? AND y < ? AND y + COALESCE(height, 0) > ?
       ORDER BY z_index, created_at`,
      [user.id, board, num(q.maxX, 1e9), num(q.minX, -1e9), num(q.maxY, 1e9), num(q.minY, -1e9)],
    )
    return c.json({ elements: rows })
  })

  app.get('/api/canvas/full', async (c) => {
    const board = c.req.query('board') === 'notebook' ? 'notebook' : 'canvas'
    const user = c.get('user')
    const rows = await cfg.db.query('SELECT * FROM canvas_elements WHERE user_id = ? AND board = ? AND deleted = 0 ORDER BY z_index, created_at', [user.id, board])
    const [maxRow] = await cfg.db.query<{ m: string | null }>('SELECT MAX(updated_at) AS m FROM canvas_elements WHERE user_id = ? AND board = ?', [user.id, board])
    return c.json({ elements: rows, serverUpdatedAt: maxRow?.m ?? null })
  })

  app.post('/api/canvas/sync', async (c) => {
    const body = await jsonBody<z.infer<typeof syncSchema>>(c, syncSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)

    // AP-34: validate each element against the strict schema; invalid entries are
    // SKIPPED (reported in the response) instead of poisoning the whole batch.
    const validated: z.infer<typeof elementSchema>[] = []
    let skipped = 0
    for (const raw of body.elements) {
      const parsed = elementSchema.safeParse(raw)
      if (parsed.success) validated.push(parsed.data)
      else skipped += 1
    }
    if (skipped > 0) {
      // Server-side signal for an edit the client could never land (over-cap content,
      // a shape a newer client sends that this server doesn't know, etc.).
      log.warn('canvas_sync_skipped', { skipped, user: user.id.slice(0, 8), reqId: c.get('reqId') })
    }

    // The offline queue can hold several writes for the same element in one batch (IndexedDB
    // keys are random uuids, so array order is not time order). Keep only the newest per id:
    // without this, an older edit could apply after a newer one and win the conflict upsert.
    const byIdNewest = new Map<string, (typeof validated)[number]>()
    for (const el of validated) {
      const cur = byIdNewest.get(el.id)
      if (!cur || el.updated_at > cur.updated_at) byIdNewest.set(el.id, el)
    }
    const elements = [...byIdNewest.values()]

    // AP-20 (Phase 2): D1 caps one statement at 100 bound params — the offline queue
    // can legally sync up to 500 elements, so the pre-check SELECT runs in chunks.
    const stored = await queryIn<{ id: string; updated_at: string; created_at: string }>(
      cfg.db,
      `SELECT id, updated_at, created_at FROM canvas_elements
       WHERE user_id = ? AND id IN {{IN}}`,
      [user.id],
      elements.map((e) => e.id),
    )
    const byId = new Map(stored.map((r) => [r.id, r]))

    const applied: string[] = []
    await cfg.db.transaction(async (tx) => {
      for (const el of elements) {
        const prev = byId.get(el.id)
        if (prev && el.updated_at <= prev.updated_at) continue // LWW (Q4-A)
        const createdAt = el.created_at ?? prev?.created_at ?? new Date().toISOString()
        tx.sql(
          `INSERT INTO canvas_elements (id, user_id, board, type, x, y, width, height, color, content, font_size, text_align, promoted_project_id, z_index, deleted, locked, angle, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             board = excluded.board, type = excluded.type, x = excluded.x, y = excluded.y, width = excluded.width,
             height = excluded.height, color = excluded.color, content = excluded.content, font_size = excluded.font_size,
             text_align = excluded.text_align,
             promoted_project_id = excluded.promoted_project_id, z_index = excluded.z_index,
             deleted = excluded.deleted, locked = excluded.locked, angle = excluded.angle, updated_at = excluded.updated_at
             WHERE canvas_elements.user_id = ?`,
          [el.id, user.id, el.board ?? 'canvas', el.type, el.x, el.y, el.width ?? null, el.height ?? null, el.color, el.content,
           el.font_size ?? null, el.text_align ?? null, el.promoted_project_id ?? null, el.z_index, el.deleted, el.locked ?? 0, el.angle ?? 0, createdAt, el.updated_at, user.id],
        )
        applied.push(el.id)
      }
    })

    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    await cfg.db.execute('DELETE FROM canvas_elements WHERE user_id = ? AND deleted = 1 AND updated_at < ?', [user.id, cutoff])

    const [maxRow] = await cfg.db.query<{ m: string | null }>('SELECT MAX(updated_at) AS m FROM canvas_elements WHERE user_id = ?', [user.id])
    if (isHtmx(c)) return c.html(toastHtml(t('Synced {n} element(s)', '{n} مورد همگام شد', { n: applied.length }), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true, applied, skipped, serverUpdatedAt: maxRow?.m ?? null })
  })

  app.post('/api/canvas/elements/:id/promote', async (c) => {
    const body = await jsonBody<z.infer<typeof promoteSchema>>(c, promoteSchema)
    const user = c.get('user')
    const t = trFor(c)
    const rows = await cfg.db.query<{ id: string; content: string; type: string }>(
      'SELECT id, content, type FROM canvas_elements WHERE id = ? AND user_id = ? AND deleted = 0',
      [c.req.param('id'), user.id],
    )
    if (rows.length === 0) return errJson(c, ErrorCode.not_found)
    const el = rows[0]
    const projectId = uuid()
    const now = new Date().toISOString()
    const title = (body?.title ?? (el.content || 'Promoted from canvas')).slice(0, 200)
    await cfg.db.transaction(async (tx) => {
      tx.sql(
        'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
        [projectId, user.id, title, 'Promoted from the canvas', 'personal', 'spark', '', now, now],
      )
      tx.sql('UPDATE canvas_elements SET promoted_project_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', [projectId, now, el.id, user.id])
      if (el.type === 'note' && el.content) {
        tx.sql('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)', [
          uuid(), projectId, `Promoted from canvas note: ${el.content.slice(0, 200)}`, now,
        ])
      }
    })
    if (isHtmx(c)) return c.html(toastHtml(t('Promoted to Idea — <a href="/project.html?id={id}">open it</a>', 'به ایده تبدیل شد — <a href="/project.html?id={id}">باز کردن آن</a>', { id: projectId }), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true, projectId }, 201)
  })
}
