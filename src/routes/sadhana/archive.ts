// Sadhana board — archive routes (Phase 4 split from routes/sadhana.ts).
//
// Purpose: the Archive overlay — DELETE /archive (purge all: user-owned cleared
// tasks + satellite tags/updates/recur-history in one tx, no undo by design)
// and GET /archive (grouped HTML + the JSON branch with recurring history).
//
// Public API: registerSadhanaArchive(app, cfg) — registered by sadhana/index.ts.
import { esc } from '../../lib/http'
import { icon } from '../../lib/html'
import type { Config, UserRow } from '../../types'
import { type SadhanaTask, type TagId } from '../../services/sadhana'
import { ordered } from './data'
import { ctxOf, zone, isHx, t, qName, deadlineHtml, tagChips } from './render'
import { recurLogHtml } from './fragments'
import { faDigits } from '../../lib/jalali'

export function registerSadhanaArchive(app: import('hono').Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  // ---- archive (§5.15) ----------------------------------------------------------------
  // S115 (owner): PURGE ALL — the Archive overlay's "Purge all" empties the archive in
  // one tap (free-tier storage discipline: archived bug screenshots / done chores pile
  // up forever otherwise). Same scope as the GET below (user-owned, cleared, not
  // soft-deleted) and the same satellite cleanup as /tasks/:id/hard — tags, updates
  // journal AND recurring history go with the tasks, in one transaction. No undo by
  // design; the confirm lives client-side with the exact count.
  app.delete('/archive', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL',
      [ctx.user.id],
    )
    if (rows.length) {
      await cfg.db.transaction(async (tx) => {
        tx.sql('DELETE FROM sadhana_tags WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL)', [ctx.user.id])
        tx.sql('DELETE FROM sadhana_updates WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL)', [ctx.user.id])
        tx.sql('DELETE FROM sadhana_recur_history WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL)', [ctx.user.id])
        tx.sql('DELETE FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL', [ctx.user.id])
      })
    }
    return c.json({ ok: true, purged: rows.length })
  })

  app.get('/archive', async (c) => {
    const ctx = ctxOf(c)
    const rows = await cfg.db.query<SadhanaTask>(
      'SELECT * FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NOT NULL ORDER BY cleared_at DESC',
      [ctx.user.id],
    )
    const tagRows = await cfg.db.query<{ task_id: string; tag: TagId }>('SELECT * FROM sadhana_tags WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)', [ctx.user.id])
    const tags = new Map<string, TagId[]>()
    for (const r of tagRows) {
      const list = tags.get(r.task_id) ?? []
      list.push(r.tag)
      tags.set(r.task_id, list)
    }
    const total = rows.length
    const byQuadrant = ordered(ctx.user).map((q) => ({ ...q, count: rows.filter((r) => r.quadrant === q.id).length }))
    const nameRows = await cfg.db.query<{ quadrant: number; name: string }>('SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = ?', [ctx.user.id])
    const names = new Map<number, string>(nameRows.map((r) => [r.quadrant, r.name]))
    const groups = ordered(ctx.user).map(
      (q) => `<section class="card"><h3>${esc(qName(q.id, names, ctx.lang))} — ${rows.filter((r) => r.quadrant === q.id).length}</h3>
        <ul class="sadhana-archive-list">${rows
          .filter((r) => r.quadrant === q.id)
          .map(
            (r) => `<li class="sadhana-archive-item">${icon('check', 'icon')} ${esc(r.emoji)} <b>${esc(r.title)}</b> ${deadlineHtml(r, ctx.lang, ctx.tz, ctx.cal)}${tagChips(tags.get(r.id), ctx.lang)}${r.recurring ? ' ' + t(ctx.lang, 'Recurring', 'تکرارشونده') : ''}${r.note ? `<div class="muted small">${esc(r.note.split('\n')[0].slice(0, 80))}</div>` : ''}</li>`,
          )
          .join('') || `<li class="muted">${t(ctx.lang, 'No completed tasks yet', 'هنوز کار انجام‌شده‌ای نیست')}</li>`}</ul></section>`,
    ).join('')
    const log = await recurLogHtml(cfg.db, ctx)
    const html = zone(`<div class="sadhana-head row spread wrap">
        <h1>${t(ctx.lang, 'Archive', 'بایگانی')}</h1>
        <button type="button" class="ghost" data-view-board>← ${t(ctx.lang, 'Board', 'تابلو')}</button>
      </div>
      <div class="archive-stats row wrap">${byQuadrant.map((q) => `<span class="chip">${icon(q.glyph, 'icon')} ${esc(qName(q.id, names, ctx.lang))}: <b>${ctx.lang === 'fa' ? faDigits(String(q.count)) : q.count}</b></span>`).join('')}<span class="chip">${t(ctx.lang, 'Total', 'کل')}: <b>${ctx.lang === 'fa' ? faDigits(String(total)) : total}</b></span></div>
      ${groups}
      ${log}`)
    if (isHx(c)) return c.html(html)
    // JSON branch (standalone board page): archived tasks with tags + recurring history.
    const recurRows = await cfg.db.query<{ task_id: string; title: string; emoji: string; cn: number; dates: string }>(
      `SELECT rh.task_id, st.title, st.emoji, COUNT(rh.id) AS cn, GROUP_CONCAT(rh.completed_on, ',') AS dates
       FROM sadhana_recur_history rh JOIN sadhana_tasks st ON st.id = rh.task_id
       WHERE st.user_id = ? GROUP BY rh.task_id ORDER BY st.title`,
      [ctx.user.id],
    )
    return c.json({
      ok: true,
      total,
      byQuadrant: byQuadrant.map((q) => ({ id: q.id, name: qName(q.id, names, ctx.lang), count: q.count })),
      tasks: rows.map((r) => ({ id: r.id, quadrant: r.quadrant, emoji: r.emoji, title: r.title, tags: tags.get(r.id) ?? [], recurring: r.recurring === 1, note: r.note, cleared_at: r.cleared_at })),
      recurring: recurRows.map((r) => ({ id: r.task_id, emoji: r.emoji, title: r.title, count: r.cn, dates: (r.dates ?? '').split(',').filter(Boolean) })),
    })
  })
}
