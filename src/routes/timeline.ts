import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { etag } from '../lib/http'
import { STATUS_BADGE, timeAgo, icon } from '../lib/html'
import { localeOf, trL, type Locale } from '../lib/i18n'
import type { Config, UserRow } from '../types'

// Activity timeline (Phase B4.2) — a unified feed across projects + sadhana + quick notes,
// sorted by timestamp. One new read-only aggregate endpoint; zero DB changes. Each item
// is a "something happened at time T" entry derived from the existing updated_at/created_at
// columns on projects, sadhana_tasks, and quick_notes.

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().max(40).optional(), // ISO timestamp — entries older than this
})

type FeedItem = {
  ts: string
  kind: 'project' | 'sadhana' | 'note'
  id: string
  title: string
  status?: string
  done?: boolean
  href: string
}

export function timelineRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const q = listSchema.safeParse(c.req.query())
    if (!q.success) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const limit = q.data.limit
    const cursor = q.data.cursor

    // Three parallel queries, each user-scoped + indexed, each returning the most-recent N.
    // We over-fetch (limit*2) so the merge-sort has enough headroom when one source dominates.
    const fetch = limit * 2
    const [projects, sadhana, notes] = await Promise.all([
      cfg.db.query<{ id: string; title: string; status: string; updated_at: string }>(
        `SELECT id, title, status, updated_at FROM projects
         WHERE user_id = ? AND deleted_at IS NULL ${cursor ? 'AND updated_at < ?' : ''}
         ORDER BY updated_at DESC LIMIT ?`,
        cursor ? [user.id, cursor, fetch] : [user.id, fetch],
      ),
      cfg.db.query<{ id: string; title: string; done: number; updated_at: string }>(
        `SELECT id, title, done, updated_at FROM sadhana_tasks
         WHERE user_id = ? AND deleted_at IS NULL ${cursor ? 'AND updated_at < ?' : ''}
         ORDER BY updated_at DESC LIMIT ?`,
        cursor ? [user.id, cursor, fetch] : [user.id, fetch],
      ),
      cfg.db.query<{ id: string; content: string; kind: string; updated_at: string }>(
        `SELECT id, content, kind, updated_at FROM quick_notes
         WHERE user_id = ? AND deleted_at IS NULL ${cursor ? 'AND updated_at < ?' : ''}
         ORDER BY updated_at DESC LIMIT ?`,
        cursor ? [user.id, cursor, fetch] : [user.id, fetch],
      ),
    ])

    const items: FeedItem[] = [
      ...projects.map((p) => ({ ts: p.updated_at, kind: 'project' as const, id: p.id, title: p.title, status: p.status, href: `/project.html?id=${p.id}` })),
      ...sadhana.map((s) => ({ ts: s.updated_at, kind: 'sadhana' as const, id: s.id, title: s.title, done: s.done === 1, href: '/to-do-list' })),
      ...notes.map((n) => {
        const flat = (n.content || '').replace(/\s+/g, ' ').trim()
        return { ts: n.updated_at, kind: 'note' as const, id: n.id, title: flat.slice(0, 80) || (n.kind === 'list' ? 'List' : 'Note'), href: '/dashboard.html' }
      }),
    ]
    items.sort((a, b) => b.ts.localeCompare(a.ts))
    const page = items.slice(0, limit)
    const nextCursor = page.length === limit ? page[page.length - 1]?.ts : null

    if (c.req.header('HX-Request')) {
      const lang = localeOf(c)
      const html2 = page.map((it) => feedItemHtml(it, lang)).join('')
      return await etag(c, c.html(html2))
    }
    return await etag(c, c.json({ items: page, nextCursor }))
  })

  // B4.3: "On this day" — items touched on this exact date in previous weeks/months/years.
  // Returns a flat list grouped by "N units ago" labels. Zero DB changes (same tables).
  app.get('/on-this-day', async (c) => {
    const user = c.get('user')
    const now = new Date()
    const today = now.toISOString().slice(5, 10) // 'MM-DD' — matches this date in any year
    const windows = [
      { label: trL(localeOf(c), '1 week ago', 'یک هفته پیش'), days: 7 },
      { label: trL(localeOf(c), '1 month ago', 'یک ماه پیش'), days: 30 },
      { label: trL(localeOf(c), '3 months ago', 'سه ماه پیش'), days: 90 },
      { label: trL(localeOf(c), '1 year ago', 'یک سال پیش'), days: 365 },
    ]
    const results: { label: string; items: FeedItem[] }[] = []
    for (const w of windows) {
      const target = new Date(now.getTime() - w.days * 24 * 3600 * 1000)
      const targetStr = target.toISOString().slice(0, 10)
      const [p, s, n] = await Promise.all([
        cfg.db.query<{ id: string; title: string; status: string; updated_at: string }>(
          `SELECT id, title, status, updated_at FROM projects WHERE user_id = ? AND deleted_at IS NULL AND substr(updated_at,1,10) = ? LIMIT 5`,
          [user.id, targetStr],
        ),
        cfg.db.query<{ id: string; title: string; done: number; updated_at: string }>(
          `SELECT id, title, done, updated_at FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND substr(updated_at,1,10) = ? LIMIT 5`,
          [user.id, targetStr],
        ),
        cfg.db.query<{ id: string; content: string; kind: string; updated_at: string }>(
          `SELECT id, content, kind, updated_at FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL AND substr(updated_at,1,10) = ? LIMIT 5`,
          [user.id, targetStr],
        ),
      ])
      const items: FeedItem[] = [
        ...p.map((x) => ({ ts: x.updated_at, kind: 'project' as const, id: x.id, title: x.title, status: x.status, href: `/project.html?id=${x.id}` })),
        ...s.map((x) => ({ ts: x.updated_at, kind: 'sadhana' as const, id: x.id, title: x.title, done: x.done === 1, href: '/to-do-list' })),
        ...n.map((x) => ({ ts: x.updated_at, kind: 'note' as const, id: x.id, title: (x.content || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Note', href: '/dashboard.html' })),
      ]
      if (items.length) results.push({ label: w.label, items })
    }
    return await etag(c, c.json({ windows: results }))
  })

  return app
}

function feedItemHtml(it: FeedItem, lang: Locale): string {
  const kindIcon = it.kind === 'project' ? icon('folder-plus') : it.kind === 'sadhana' ? icon('target') : icon('pencil')
  const kindLabel = trL(lang, it.kind === 'project' ? 'Project' : it.kind === 'sadhana' ? 'To-do' : 'Note',
                              it.kind === 'project' ? 'پروژه' : it.kind === 'sadhana' ? 'کار' : 'یادداشت')
  const statusBadge = it.status ? STATUS_BADGE(it.status as 'spark', lang) : ''
  const doneMark = it.done ? '✓ ' : ''
  return `<li class="feed-item feed-${it.kind}">
    <span class="feed-icon">${kindIcon}</span>
    <div class="feed-body">
      <a href="${it.href}" class="feed-title">${doneMark}${escapeHtml(it.title)}</a>
      <span class="feed-meta muted small">${kindLabel} · ${timeAgo(it.ts, lang)}${statusBadge ? ' ' + statusBadge : ''}</span>
    </div>
  </li>`
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

// Re-export for potential test use
export { feedItemHtml }
export type { FeedItem }
