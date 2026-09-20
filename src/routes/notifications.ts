import { Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { icon, timeAgo } from '../lib/html'
import { esc, etag } from '../lib/http'
import { localeOf, trL, type Locale } from '../lib/i18n'
import type { Config, ProjectRow, UserRow } from '../types'
import type { SadhanaTask } from '../services/sadhana'

// In-app Notification Center (Round 2) — a derived view of "things that need attention":
// overdue tasks, unreviewed sparks, upcoming deadlines, stale projects. Zero DB changes:
// every notification is computed from existing columns (projects.status, projects.due_date,
// tasks.due_date, sadhana_tasks.due_date, projects.updated_at). One read-only aggregate
// endpoint, one new page. No notifications table, no server-side state.

export type Notification = {
  id: string // stable hash of kind+entityId for dedupe
  kind: 'overdue-task' | 'overdue-sadhana' | 'overdue-project' | 'unreviewed-spark' | 'upcoming-deadline' | 'stale-project'
  severity: 'urgent' | 'warning' | 'info'
  title: string
  detail: string
  href: string
  date: string | null // the relevant due_date or updated_at (Gregorian YYYY-MM-DD)
}

export function notificationsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  app.get('/', async (c) => {
    const user = c.get('user')
    const today = new Date().toISOString().slice(0, 10)
    const weekAhead = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

    // Five parallel user-scoped queries — all indexed (rule 9). Each yields a notification kind.
    const [overdueTasks, overdueSadhana, overdueProjects, unreviewedSparks, upcomingDeadlines, staleProjects] = await Promise.all([
      // Client tasks past their due_date, not done.
      cfg.db.query<{ id: string; project_id: string; title: string; due_date: string }>(
        `SELECT t.id, t.project_id, t.title, t.due_date FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE p.user_id = ? AND p.deleted_at IS NULL AND t.done = 0 AND t.due_date IS NOT NULL AND t.due_date < ?
         ORDER BY t.due_date ASC LIMIT 20`,
        [user.id, today],
      ),
      // Sadhana tasks past their due_date, not done.
      cfg.db.query<SadhanaTask>(
        `SELECT * FROM sadhana_tasks
         WHERE user_id = ? AND deleted_at IS NULL AND done = 0 AND due_date IS NOT NULL AND due_date < ?
         ORDER BY due_date ASC LIMIT 20`,
        [user.id, today],
      ),
      // Client projects past their due_date, not paused (0060: awaiting_dev).
      cfg.db.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND type = 'client' AND due_date IS NOT NULL
         AND due_date < ? AND status != 'awaiting_dev'
         ORDER BY due_date ASC LIMIT 20`,
        [user.id, today],
      ),
      // Sparks that have been sitting unreviewed for >7 days (the "never lose an idea" check).
      cfg.db.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'spark' AND created_at < ?
         ORDER BY created_at ASC LIMIT 20`,
        [user.id, new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()],
      ),
      // Upcoming deadlines in the next 7 days (client projects + tasks + sadhana).
      cfg.db.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND type = 'client' AND due_date IS NOT NULL
         AND due_date >= ? AND due_date <= ? AND status != 'awaiting_dev'
         ORDER BY due_date ASC LIMIT 20`,
        [user.id, today, weekAhead],
      ),
      // Developing/Operational projects not touched in 30 days (the "where did I leave off?" nudge).
      cfg.db.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE user_id = ? AND deleted_at IS NULL AND status IN ('developing','operational') AND updated_at < ?
         ORDER BY updated_at ASC LIMIT 10`,
        [user.id, monthAgo],
      ),
    ])

    const lang = localeOf(c)
    const notifs: Notification[] = []

    for (const t of overdueTasks) {
      notifs.push({
        id: `overdue-task-${t.id}`, kind: 'overdue-task', severity: 'urgent',
        title: trL(lang, 'Task overdue', 'کار گذشته'),
        detail: t.title, href: `/project.html?id=${t.project_id}`, date: t.due_date,
      })
    }
    for (const s of overdueSadhana) {
      notifs.push({
        id: `overdue-sadhana-${s.id}`, kind: 'overdue-sadhana', severity: 'urgent',
        title: trL(lang, 'To-do overdue', 'کار لیست گذشته'),
        detail: s.title, href: '/to-do-list', date: s.due_date,
      })
    }
    for (const p of overdueProjects) {
      notifs.push({
        id: `overdue-project-${p.id}`, kind: 'overdue-project', severity: 'urgent',
        title: trL(lang, 'Project overdue', 'پروژهٔ گذشته'),
        detail: p.title, href: `/project.html?id=${p.id}`, date: p.due_date,
      })
    }
    for (const p of unreviewedSparks) {
      notifs.push({
        id: `spark-${p.id}`, kind: 'unreviewed-spark', severity: 'info',
        title: trL(lang, 'Unreviewed idea', 'ایدهٔ بررسی‌نشده'),
        detail: p.title, href: `/project.html?id=${p.id}`, date: p.created_at.slice(0, 10),
      })
    }
    for (const p of upcomingDeadlines) {
      notifs.push({
        id: `upcoming-${p.id}`, kind: 'upcoming-deadline', severity: 'warning',
        title: trL(lang, 'Deadline soon', 'مهلت نزدیک'),
        detail: p.title, href: `/project.html?id=${p.id}`, date: p.due_date,
      })
    }
    for (const p of staleProjects) {
      notifs.push({
        id: `stale-${p.id}`, kind: 'stale-project', severity: 'info',
        title: trL(lang, 'Project untouched', 'پروژهٔ رهاشده'),
        detail: p.title, href: `/project.html?id=${p.id}`, date: p.updated_at.slice(0, 10),
      })
    }

    // Urgent first, then warning, then info; within each group, by date.
    const sevOrder = { urgent: 0, warning: 1, info: 2 }
    notifs.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || String(a.date ?? '').localeCompare(String(b.date ?? '')))

    if (c.req.header('HX-Request')) {
      return await etag(c, c.html(notifListHtml(notifs, lang)))
    }
    return await etag(c, c.json({ count: notifs.length, notifications: notifs }))
  })

  return app
}

function notifListHtml(notifs: Notification[], lang: Locale): string {
  if (!notifs.length) {
    return `<div class="empty-state empty">
      <span class="empty-state-icon" aria-hidden="true">${icon('check')}</span>
      <p class="empty-state-title">${trL(lang, 'All caught up', 'همه چیز مرتب است')}</p>
      <p class="empty-state-text">${trL(lang, 'No overdue tasks, no unreviewed ideas, no stale projects. You’re on top of things.', 'هیچ کار گذشته، ایدهٔ بررسی‌نشده یا پروژهٔ رهاشده‌ای نیست. همه چیز تحت کنترل است.')}</p>
    </div>`
  }
  const SEV_ICON: Record<string, string> = {
    'overdue-task': 'alert', 'overdue-sadhana': 'alert', 'overdue-project': 'alert',
    'unreviewed-spark': 'idea', 'upcoming-deadline': 'clock', 'stale-project': 'archive',
  }
  const rows = notifs.map((n) => {
    const ic = icon(SEV_ICON[n.kind] ?? 'bell')
    const dateLabel = n.date ? ` · ${timeAgo(n.date + 'T00:00:00Z', lang)}` : ''
    // SECURITY (2026-08-28): n.detail is user-stored content (project/task titles) — it MUST
    // be escaped; a title like "<img src=x onerror=…>" used to execute on this page (XSS).
    return `<li class="notif-item notif-${n.severity}">
      <span class="notif-icon">${ic}</span>
      <div class="notif-body">
        <span class="notif-kind">${n.title}</span>
        <a href="${esc(n.href)}" class="notif-detail">${esc(n.detail)}</a>
        <span class="notif-date muted small">${dateLabel}</span>
      </div>
    </li>`
  }).join('')
  return `<ul class="notif-list">${rows}</ul>`
}
