// Sadhana board — quadrant surface routes (Phase 4 split from routes/sadhana.ts).
//
// Purpose: GET / (board HTML + the full JSON payload), GET /rename/:q, the
// quadrant quick-add + manual quadrant reorder (REGISTRATION ORDER MATTERS:
// POST /quadrants/reorder must stay before POST /quadrants/:q or "reorder" is
// captured as :q), PATCH /quadrants/:q (rename/style upsert), GET /focus/:q.
//
// Public API: registerSadhanaQuadrants(app, cfg) — registered by sadhana/index.ts.
import { z } from 'zod'
import { esc, jsonBody, etag } from '../../lib/http'
import { icon } from '../../lib/html'
import { uuid } from '../../lib/ids'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow } from '../../types'
import { QUADRANTS, TAGS, parseQuadrantOrder, resetDueRecurring } from '../../services/sadhana'
import { GLYPH_IDS, quickAddSchema, quadrantOrderSchema, renameSchema } from '../sadhana-helpers'
import { loadAll, ordered } from './data'
import { ctxOf, zone, isHx, t, qName, boardZoneHtml } from './render'
import { focusZone } from './fragments'

export function registerSadhanaQuadrants(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.get('/', async (c) => {
    const ctx = ctxOf(c)
    await resetDueRecurring(cfg.db, ctx.user.id, ctx.tz) // spec §7.1: resets run on board load too
    const data = await loadAll(cfg.db, ctx.user.id)
    if (isHx(c)) return await etag(c, c.html(boardZoneHtml(data, ctx)))
    // JSON consumers (the standalone Sadhana board page): everything one paint needs —
    // quadrant meta (names/subtitles/order), tags, and the full task set with journals.
    const lang = ctx.lang
    const tasksByQ: Record<string, unknown[]> = { '1': [], '2': [], '3': [], '4': [] }
    for (const task of data.tasks) {
      tasksByQ[String(task.quadrant)].push({
        id: task.id,
        emoji: task.emoji,
        title: task.title,
        fuzzy: task.fuzzy ?? '',
        date: task.due_date ?? '',
        time: task.due_time ?? '',
        tags: data.tags.get(task.id) ?? [],
        done: task.done === 1,
        pinned: task.pinned === 1,
        pos: task.position,
        progress: task.progress,
        note: task.note ?? '',
        recur: task.recurring === 1,
        recur_type: task.recur_type ?? '',
        recur_config: task.recur_config ?? '',
        updates: (data.notes.get(task.id) ?? []).map((u) => ({ id: u.id, text: u.text, ts: u.created_at })),
        // S76: the TRUE per-task note count (the board caps `updates` at the latest 20;
        // the client toggle + truncation hint read this so the to-do list page stays
        // as honest as the server-rendered surfaces).
        updates_total: data.noteTotals.get(task.id) ?? (data.notes.get(task.id) ?? []).length,
      })
    }
    return await etag(c, c.json({
      ok: true,
      today: ctx.today,
      lang,
      cal: ctx.cal,
      tz: ctx.tz,
      names: Object.fromEntries(data.names),
      subtitles: Object.fromEntries(ordered(ctx.user).map((q) => [q.id, data.subtitles.get(q.id) ?? (lang === 'fa' ? q.subtitle.fa : q.subtitle.en)])),
      order: ordered(ctx.user).map((q) => q.id),
      // icon = the quadrant's EFFECTIVE emoji (custom emoji > default); icon_id = the raw
      // custom value (SVG glyph id or emoji, null = default) so rich clients can render glyphs.
      quadrants: ordered(ctx.user).map((q) => {
        const custom = data.styles.get(q.id)?.icon ?? null
        const isEmoji = !!custom && !GLYPH_IDS.has(custom)
        return { id: q.id, icon: isEmoji ? custom : q.icon, name: qName(q.id, data.names, lang) }
      }),
      // Bilingual quadrant meta for the standalone board page (client-side lang switching
      // without a refetch): custom names/subtitles apply to both langs, defaults localize.
      // S93: accent_color rides along (null = no picked pastel) so the board page tints
      // each quadrant with the user's swatch.
      quads: ordered(ctx.user).map((q) => ({
        id: q.id,
        icon: q.icon,
        icon_id: data.styles.get(q.id)?.icon ?? null,
        accent: data.styles.get(q.id)?.accent ?? null,
        name_en: qName(q.id, data.names, 'en'),
        name_fa: qName(q.id, data.names, 'fa'),
        sub_en: data.subtitles.get(q.id) ?? q.subtitle.en,
        sub_fa: data.subtitles.get(q.id) ?? q.subtitle.fa,
      })),
      tags: Object.entries(TAGS).map(([id, tg]) => ({ id, icon: tg.icon, text: lang === 'fa' ? tg.fa : tg.en })),
      tasks: tasksByQ,
    }))
  })

  // Inline quadrant rename form (spec §5.19; subtitle added 0025): the card header swaps
  // into an edit row with the heading AND an optional subheading — both save together.
  app.get('/rename/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    if (![1, 2, 3, 4].includes(q)) return errJson(c, ErrorCode.invalid_input)
    const rows = await cfg.db.query<{ name: string; subtitle: string | null; icon_id: string | null; accent_color: string | null }>('SELECT name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?', [ctx.user.id, q])
    const custom = rows.length ? rows[0].name : ''
    const customSub = rows.length ? rows[0].subtitle ?? '' : ''
    const meta = QUADRANTS.find((x) => x.id === q)!
    return c.html(zone(`<section class="sadhana-rename card" data-quadrant="${q}">
      <h3 class="row"><span class="sadhana-qicon">${icon(meta.glyph)}</span> ${t(ctx.lang, 'Rename this quadrant', 'تغییر نام این بخش')}</h3>
      <form class="column" hx-patch="/api/sadhana/quadrants/${q}" hx-target="closest .sadhana-zone" hx-swap="outerHTML">
        <input name="name" value="${esc(custom)}" maxlength="60" required placeholder="${esc(qName(q, new Map(), ctx.lang))}" aria-label="${t(ctx.lang, 'New name', 'نام جدید')}">
        <input name="subtitle" value="${esc(customSub)}" maxlength="120" placeholder="${t(ctx.lang, 'Subtitle (optional)', 'زیرعنوان (اختیاری)')}" aria-label="${t(ctx.lang, 'Subtitle (optional)', 'زیرعنوان (اختیاری)')}">
        <div class="row">
          ${custom ? `<button type="button" class="ghost" hx-patch="/api/sadhana/quadrants/${q}" hx-vals='{"name":null,"subtitle":null}' hx-target="closest .sadhana-zone" hx-swap="outerHTML">${t(ctx.lang, 'Restore default', 'بازنشانی نام')}</button>` : ''}
          <button type="button" class="ghost" hx-get="/api/sadhana" hx-target="closest .sadhana-zone" hx-swap="outerHTML">${t(ctx.lang, 'Cancel', 'انصراف')}</button>
          <button>${t(ctx.lang, 'Save', 'ذخیره')}</button>
        </div>
      </form>
    </section>`))
  })

  app.post('/quadrants/reorder', async (c) => {
    const ctx = ctxOf(c)
    const body = await jsonBody<z.infer<typeof quadrantOrderSchema>>(c, quadrantOrderSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const order = body.ids.join(',')
    await cfg.db.execute('UPDATE users SET sadhana_quadrant_order = ? WHERE id = ?', [order, ctx.user.id])
    ctx.user.sadhana_quadrant_order = order
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c)
      ? c.html(boardZoneHtml(data, ctx))
      : c.json({ ok: true, order: parseQuadrantOrder(order) })
  })

  app.post('/quadrants/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    const body = await jsonBody<z.infer<typeof quickAddSchema>>(c, quickAddSchema)
    if (!body || ![1, 2, 3, 4].includes(q)) return errJson(c, ErrorCode.invalid_input)
    const id = uuid()
    const now = new Date().toISOString()
    await cfg.db.execute(
      'INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, recur_last, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, ctx.user.id, q, body.title.trim(), body.emoji || '', ctx.today, now, now],
    )
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true, id }, 201)
  })
  // ---- quadrant rename (requested change, §5.19) -------------------------------------
  app.patch('/quadrants/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    if (![1, 2, 3, 4].includes(q)) return errJson(c, ErrorCode.invalid_input)
    const body = await jsonBody<z.infer<typeof renameSchema>>(c, renameSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    if (body.name === null && (body.subtitle === null || body.subtitle === undefined) && body.icon_id === undefined && body.accent_color === undefined) {
      // explicit restore → delete the whole row (built-in heading + subtitle)
      await cfg.db.execute('DELETE FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?', [ctx.user.id, q])
    } else {
      // heading and/or subtitle changed → upsert; preserve whichever field wasn't sent
      const name = body.name !== null && body.name !== undefined ? body.name.trim() : null
      if (name === '' || (name && name.length > 60)) return errJson(c, ErrorCode.invalid_name) // empty heading rejected (§6.27)
      const current = await cfg.db.query<{ name: string | null; subtitle: string | null; icon_id: string | null; accent_color: string | null }>(
        'SELECT name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ? AND quadrant = ?',
        [ctx.user.id, q],
      )
      const prevName = current.length ? current[0].name : null
      const prevSub = current.length ? current[0].subtitle : null
      const nextName = name ?? prevName
      const nextSub = body.subtitle !== undefined ? body.subtitle : prevSub
      const currentStyle = current.length ? current[0] : null
      const nextIcon = body.icon_id ?? currentStyle?.icon_id ?? null
      // S93: explicit null clears the pastel (the ∅ swatch); undefined keeps the saved one.
      const nextAccent = body.accent_color === null ? null : (body.accent_color ?? currentStyle?.accent_color ?? null)
      await cfg.db.execute(
        'INSERT INTO sadhana_quadrant_names (user_id, quadrant, name, subtitle, icon_id, accent_color) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, quadrant) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, icon_id = excluded.icon_id, accent_color = excluded.accent_color',
        [ctx.user.id, q, nextName, nextSub, nextIcon, nextAccent],
      )
    }
    const data = await loadAll(cfg.db, ctx.user.id)
    return isHx(c) ? c.html(boardZoneHtml(data, ctx)) : c.json({ ok: true })
  })

  // ---- focus (zen) view (§5.10) -------------------------------------------------------
  app.get('/focus/:q', async (c) => {
    const ctx = ctxOf(c)
    const q = Number(c.req.param('q'))
    if (![1, 2, 3, 4].includes(q)) return errJson(c, ErrorCode.invalid_input)
    const data = await loadAll(cfg.db, ctx.user.id)
    return c.html(focusZone(q, data, ctx))
  })
}
