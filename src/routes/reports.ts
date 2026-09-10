import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { etag } from '../lib/http'
import type { Config, UserRow } from '../types'

// Reports (spec §5.7): snapshot counts by status/type + activity over time in four
// granularities (day/week/month/year — the user asked for all four, explicitly).

const granularitySchema = z.enum(['day', 'week', 'month', 'year'])

function buckets(granularity: 'day' | 'week' | 'month' | 'year', now = new Date()): { key: string; label: string; start: Date; end: Date }[] {
  const b: { key: string; label: string; start: Date; end: Date }[] = []
  const startOf = (d: Date): Date => {
    const r = new Date(d)
    r.setUTCHours(0, 0, 0, 0)
    return r
  }
  const n = granularity === 'day' ? 30 : granularity === 'week' ? 12 : granularity === 'month' ? 12 : 6
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(now)
    const start = new Date(end)
    if (granularity === 'day') start.setUTCDate(end.getUTCDate() - i)
    else if (granularity === 'week') start.setUTCDate(end.getUTCDate() - i * 7)
    else if (granularity === 'month') start.setUTCMonth(end.getUTCMonth() - i)
    else start.setUTCFullYear(end.getUTCFullYear() - i)
    const key = start.toISOString().slice(0, 10)
    const label =
      granularity === 'day' ? key.slice(5) : granularity === 'week' ? `${key.slice(0, 7)} w${Math.ceil(start.getUTCDate() / 7)}` : granularity === 'month' ? key.slice(0, 7) : key.slice(0, 4)
    b.push({ key, label, start: startOf(start), end: new Date(end.getTime()) })
  }
  return b
}

export function reportsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/summary', async (c) => {
    const user = c.get('user')
    const [byStatus, byType, totalHurdles, recents] = await Promise.all([
      cfg.db.query<{ status: string; n: number }>(
        'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL GROUP BY status',
        [user.id],
      ),
      cfg.db.query<{ type: string; n: number }>(
        'SELECT type, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL GROUP BY type',
        [user.id],
      ),
      cfg.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM hurdles WHERE project_id IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL)',
        [user.id],
      ),
      cfg.db.query<{ id: string; title: string; status: string }>(
        "SELECT id, title, status FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status IN ('operational', 'halted') ORDER BY updated_at DESC LIMIT 8",
        [user.id],
      ),
    ])
    const status = { spark: 0, unreviewed: 0, investigating: 0, awaiting: 0, doing: 0, halted: 0, operational: 0 }
    for (const r of byStatus) if (r.status in status) status[r.status as keyof typeof status] = r.n
    const type = { personal: 0, client: 0 }
    for (const r of byType) type[r.type as keyof typeof type] = r.n
    // The Operational/Halted boxes moved here from the dashboard (user request 2026-08-21):
    // up to 4 recents per status, with links on the page.
    const recentsByStatus: Record<string, { id: string; title: string }[]> = { operational: [], halted: [] }
    for (const r of recents) {
      const list = recentsByStatus[r.status] ?? []
      if (list.length < 4) list.push({ id: r.id, title: r.title })
      recentsByStatus[r.status] = list
    }
    const summary = { status, type, recents: recentsByStatus, totalProjects: byStatus.reduce((s, r) => s + r.n, 0), totalHurdles: totalHurdles[0]?.n ?? 0 }
    return await etag(c, c.json(summary))
  })

  app.get('/activity', async (c) => {
    const gran = granularitySchema.safeParse(c.req.query('granularity') ?? 'day')
    if (!gran.success) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const now = new Date()
    const b = buckets(gran.data)

    const [hurdles, created] = await Promise.all([
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(solved_at, 1, 10) AS bucket, COUNT(*) AS n FROM hurdles
         WHERE solved_at IS NOT NULL AND project_id IN (SELECT id FROM projects WHERE user_id = ?)
         GROUP BY bucket`,
        [user.id],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS n FROM projects WHERE user_id = ?
         GROUP BY bucket`,
        [user.id],
      ),
    ])
    const byHurdle = new Map(hurdles.map((r) => [r.bucket, r.n]))
    const byCreated = new Map(created.map((r) => [r.bucket, r.n]))
    const rows = b.map((bk) => ({
      key: bk.key,
      label: bk.label,
      hurdlesCompleted: byHurdle.get(bk.key) ?? 0,
      projectsCreated: byCreated.get(bk.key) ?? 0,
    }))
    return await etag(c, c.json({ granularity: gran.data, rows }))
  })

  // B3.6: calendar heatmap — last 91 days of activity (hurdles solved + projects created).
  // Same data sources as /activity, just a fixed daily granularity over a 13-week window.
  // Returns [{ date: 'YYYY-MM-DD', hurdles: n, projects: n }] for the client to render
  // as a GitHub-style contribution grid. Zero DB cost beyond two indexed aggregations.
  app.get('/heatmap', async (c) => {
    const user = c.get('user')
    const days = 91
    const since = new Date(Date.now() - (days - 1) * 24 * 3600 * 1000)
    const sinceStr = since.toISOString().slice(0, 10)
    const [hurdles, created] = await Promise.all([
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(solved_at, 1, 10) AS bucket, COUNT(*) AS n FROM hurdles
         WHERE solved_at IS NOT NULL AND solved_at >= ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)
         GROUP BY bucket`,
        [sinceStr, user.id],
      ),
      cfg.db.query<{ bucket: string; n: number }>(
        `SELECT substr(created_at, 1, 10) AS bucket, COUNT(*) AS n FROM projects
         WHERE user_id = ? AND created_at >= ? AND deleted_at IS NULL
         GROUP BY bucket`,
        [user.id, sinceStr],
      ),
    ])
    const byHurdle = new Map(hurdles.map((r) => [r.bucket, r.n]))
    const byCreated = new Map(created.map((r) => [r.bucket, r.n]))
    const rows: { date: string; hurdles: number; projects: number; total: number }[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setUTCDate(since.getUTCDate() + i)
      const date = d.toISOString().slice(0, 10)
      const h = byHurdle.get(date) ?? 0
      const p = byCreated.get(date) ?? 0
      rows.push({ date, hurdles: h, projects: p, total: h + p })
    }
    return await etag(c, c.json({ days, rows }))
  })

  return app
}