// S126 (owner item 3): the "View all" destination for the overview status cards.
//
// The dashboard's Plans / Problems / In Progress cards (and the projects home's four)
// cap at the 3 most recently updated items — without a reachable path the remaining
// items would become invisible instead of just collapsed. This route is that path:
// EVERY open item of one dev-task status across ALL the user's active projects,
// most recently updated first (the same "recent = last-updated, not last-born"
// contract the cards follow — 0061's dev_tasks.updated_at, with the S57
// deploy-ahead-of-D1 belt: a D1 without the column falls back to born-order).
//
// Consumed by public/tasks.html (static shell) as an htmx fragment on
// HX-Request; a plain GET returns the same payload as JSON. All queries are
// user_id-scoped (rule 1); validation at the boundary (rule 10 — the status
// allowlist below).

import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { etag, esc } from '../lib/http'
import { localeOf, trL, type Locale } from '../lib/i18n'
import { faDigits } from '../lib/jalali'
import { timeAgo } from '../lib/html'
import { OV_STATUSES, ovLabel, type OvStatus } from './projects/helpers'
import type { Config, UserRow } from '../types'

interface OvTaskListRow {
  id: string
  title: string
  project_id: string
  project_title: string
  project_status: string
  created_at: string
  updated_at: string | null
  // S152 (block 6): the task's category (LEFT JOIN — uncategorized tasks carry NULLs)
  cat_name: string | null
  cat_fill: string | null
  cat_ink: string | null
}

const rowHtml = (t: OvTaskListRow, lang: Locale): string => {
  // 0061 belt: a row from the fallback query carries updated_at = NULL — the
  // "updated" stamp then degrades to the birth time instead of lying or breaking.
  const when = t.updated_at ?? t.created_at
  // S152: the category chip rides the list row too (inline-start of the title —
  // the compact row keeps its single line; recognition at a glance, block 6).
  const chip = t.cat_name && t.cat_fill && t.cat_ink
    ? `<span class="cat-chip cat-chip-sm" style="background:${esc(t.cat_fill)};color:${esc(t.cat_ink)}" dir="auto">${esc(t.cat_name)}</span> `
    : ''
  return `<li><a class="ov-item ovt-row" href="/project.html?id=${t.project_id}">
          ${chip}<span class="ov-item-title ovt-row-title" dir="auto">${esc(t.title)}</span>
          <span class="ov-item-proj" dir="auto"><span class="ov-proj-dot" data-stage="${esc(t.project_status)}" aria-hidden="true"></span>${esc(t.project_title)}<span class="ovt-when" title="${trL(lang, 'Last updated', 'آخرین به‌روزرسانی')}"> · ${timeAgo(when, lang)}</span></span>
        </a></li>`
}

export function ovTasksHtml(rows: OvTaskListRow[], status: OvStatus, lang: Locale): string {
  const dig = (n: number) => (lang === 'fa' ? faDigits(String(n)) : String(n))
  const switcher = OV_STATUSES.map(
    (s) =>
      `<a class="chip ovt-switch-chip${s === status ? ' is-active' : ''}" href="/tasks.html?status=${s}"${s === status ? ' aria-current="page"' : ''}>${ovLabel(s, lang)}</a>`,
  ).join('')
  const list = rows.length
    ? `<ul class="ovt-list">${rows.map((t) => rowHtml(t, lang)).join('')}</ul>`
    : `<div class="empty-state empty"><p class="empty-state-title">${trL(lang, 'Nothing here', 'چیزی نیست')}</p><p class="empty-state-text">${trL(lang, 'No open items with this status right now.', 'در حال حاضر موردی با این وضعیت باز نیست.')}</p></div>`
  return `<section class="ovt" data-ovt-status="${status}">
    <header class="row spread ovt-head">
      <h1 class="ovt-h"><span class="ov-dot" data-st="${status}" aria-hidden="true"></span>${ovLabel(status, lang)}</h1>
      <b class="board-count ov-box-n" title="${trL(lang, '{n} items', '{n} مورد', { n: dig(rows.length) })}">${dig(rows.length)}</b>
    </header>
    <p class="muted small ovt-sub">${trL(lang, 'Every open item across your projects — most recently updated first.', 'همهٔ موارد باز در پروژه‌هایت — بر اساس آخرین به‌روزرسانی.')}</p>
    <nav class="row wrap ovt-switch" aria-label="${trL(lang, 'Status', 'وضعیت')}">${switcher}</nav>
    ${list}
  </section>`
}

export function ovTasksRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    const lang = localeOf(c)
    const q = c.req.query('status') ?? 'planned'
    const status = (OV_STATUSES as readonly string[]).includes(q) ? (q as OvStatus) : null
    // rule 10: the only input is the status filter — allowlist or 400.
    if (!status) return c.json({ error: 'invalid_status' }, 400)
    const scope = "p.user_id = ? AND p.deleted_at IS NULL AND (p.archived_state IS NULL OR p.archived_state != 'offline')"
    // The same 0061/S57 belt the overview feeds wear: without the column (a D1 the
    // migration hasn't reached yet) degrade to born-order instead of erroring.
    const rows = await cfg.db
      .query<OvTaskListRow>(
        `SELECT t.id, t.title, t.project_id, p.title AS project_title, p.status AS project_status, t.created_at, t.updated_at,
                cat.name AS cat_name, cat.color_fill AS cat_fill, cat.color_text AS cat_ink
         FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         LEFT JOIN categories cat ON cat.id = t.category_id
         WHERE ${scope} AND t.status = ?
         ORDER BY COALESCE(t.updated_at, t.created_at) DESC LIMIT 200`,
        [user.id, status],
      )
      .catch(() =>
        cfg.db.query<OvTaskListRow>(
          `SELECT t.id, t.title, t.project_id, p.title AS project_title, p.status AS project_status, t.created_at, NULL AS updated_at,
                  cat.name AS cat_name, cat.color_fill AS cat_fill, cat.color_text AS cat_ink
         FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         LEFT JOIN categories cat ON cat.id = t.category_id
         WHERE ${scope} AND t.status = ?
         ORDER BY t.created_at DESC LIMIT 200`,
          [user.id, status],
        ),
      )
      // The 0062 belt: a D1 the categories migration hasn't reached yet has no
      // `categories` table — degrade to the chip-less born-order query, not a 500.
      .catch(() =>
        cfg.db.query<OvTaskListRow>(
          `SELECT t.id, t.title, t.project_id, p.title AS project_title, p.status AS project_status, t.created_at, NULL AS updated_at,
                  NULL AS cat_name, NULL AS cat_fill, NULL AS cat_ink
         FROM dev_tasks t JOIN projects p ON p.id = t.project_id
         WHERE ${scope} AND t.status = ?
         ORDER BY t.created_at DESC LIMIT 200`,
          [user.id, status],
        ),
      )
    if (c.req.header('HX-Request')) return await etag(c, c.html(ovTasksHtml(rows, status, lang)))
    return c.json({ status, tasks: rows })
  })

  return app
}
