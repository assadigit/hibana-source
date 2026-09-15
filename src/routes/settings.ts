import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { jsonBody, extForMime, mimeForPath } from '../lib/http'
import { toastHtml } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { calendarFor } from '../lib/jalali'
import { uuid } from '../lib/ids'
import { githubClient, type GitHubConfig } from '../services/github'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import type { Config, UserRow } from '../types'

// Settings (spec §5.8): language/calendar/timezone live on the user record (multi-device).
// Theme is a per-device preference and stays in localStorage (§14) — no schema change needed.
// Profile picture (user request): bytes go to the GitHub assets repo like screenshots (§8);
// D1 keeps only `users.avatar_path`. The Worker proxies reads so the token never reaches the
// browser, and every lookup is scoped to the authenticated user (rule 1).

const prefsSchema = z
  .object({
    language_pref: z.enum(['en', 'fa']).optional(),
    calendar_pref: z.enum(['gregorian', 'shamsi']).optional(),
    timezone: z.string().max(64).optional(),
    // Dashboard view options (user request 2026-08-26) — columns added in migration 0022.
    dash_show_header: z.union([z.literal(0), z.literal(1)]).optional(),
    dash_show_projects: z.union([z.literal(0), z.literal(1)]).optional(),
    dash_show_todo: z.union([z.literal(0), z.literal(1)]).optional(),
    dash_show_notebook: z.union([z.literal(0), z.literal(1)]).optional(),
    dash_show_activity: z.union([z.literal(0), z.literal(1)]).optional(),
    dash_order: z
      .string()
      .regex(/^[a-z]+(,[a-z]+)*$/)
      .max(120)
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'empty update' })

// The client normalizes the picture to a 256×256 PNG before sending (canvas cover-crop),
// so the payload is tiny and the MIME is pinned.
const avatarUploadSchema = z.object({
  dataBase64: z.string().min(1).max(3_500_000), // ≪ GitHub's 100MB cap (spec §8); a 256px PNG is a few KB
  mimeType: z.string().regex(/^image\/(png|jpeg|webp)$/),
})

export function settingsRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  const gh = () => githubClient(cfg.github as GitHubConfig)

  // Remove a remote file (best-effort): the Contents API needs the current SHA to delete,
  // so list the dir to find it. Failures just leave the old file — never fatal.
  async function removeRemote(path: string | null | undefined): Promise<void> {
    if (!path) return
    const parts = path.split('/').filter(Boolean)
    const name = parts[parts.length - 1] ?? ''
    const dir = parts.slice(0, -1).join('/')
    try {
      const entries = await gh().listDir(dir)
      const entry = entries.find((e) => e.name === name)
      if (entry) await gh().deleteFile(entry.path, entry.sha)
    } catch {
      /* best-effort */
    }
  }

  app.get('/', async (c) => {
    const u = c.get('user')
    return c.json({
      prefs: {
        language_pref: u.language_pref,
        calendar_pref: calendarFor(u.language_pref),
        timezone: u.timezone,
        dash_show_header: u.dash_show_header,
        dash_show_projects: u.dash_show_projects,
        dash_show_todo: u.dash_show_todo,
        dash_show_notebook: u.dash_show_notebook,
        dash_show_activity: u.dash_show_activity,
        dash_order: u.dash_order,
      },
    })
  })

  app.patch('/', async (c) => {
    const body = await jsonBody<z.infer<typeof prefsSchema>>(c, prefsSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    const t = trFor(c)
    const sets: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(body)) {
      sets.push(`${k} = ?`)
      params.push(v)
    }
    // Calendar always follows language (user decision 2026-08-25): fa → shamsi, en →
    // gregorian. A submitted calendar_pref is ignored; we store the derived value so any
    // stale reader still sees the truth.
    sets.push('calendar_pref = ?')
    params.push(calendarFor(body.language_pref ?? c.get('user').language_pref))
    params.push(user.id)
    await cfg.db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params)
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Preferences saved', 'ترجیحات ذخیره شد'), localeOf(c)))
    return c.json({ ok: true })
  })

  // Upload/replace the profile picture. Replaces the previous remote file (best-effort).
  app.put('/avatar', async (c) => {
    // M8 fix (2026-09-10): wire the upload rate limiter — avatar uploads push bytes into
    // the GitHub assets repo. 30 req/60s per IP.
    if (await hitRateLimit(cfg.db, RATE_RULES.upload, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many uploads — wait a minute and try again.' }, 429)
    }
    const body = await jsonBody<z.infer<typeof avatarUploadSchema>>(c, avatarUploadSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const user = c.get('user')
    if (!cfg.github.token) return c.json({ error: 'github_not_configured' }, 503)
    const path = `avatars/${user.id}/avatar-${Date.now()}-${uuid().slice(0, 8)}${extForMime(body.mimeType)}`
    await removeRemote(user.avatar_path)
    await gh().pushFile(path, body.dataBase64, 'Hibana profile picture')
    await cfg.db.execute('UPDATE users SET avatar_path = ? WHERE id = ?', [path, user.id])
    return c.json({ ok: true, path })
  })

  // Serve the avatar bytes (rule 7: raw Accept header for files over 1MB — cheap here).
  app.get('/avatar/file', async (c) => {
    const user = c.get('user')
    if (!user.avatar_path) return c.json({ error: 'not_found' }, 404)
    const bytes = await gh().readBinary(user.avatar_path)
    return new Response(bytes, {
      headers: { 'Content-Type': mimeForPath(user.avatar_path), 'Cache-Control': 'private, max-age=3600' },
    })
  })

  app.delete('/avatar', async (c) => {
    const user = c.get('user')
    await removeRemote(user.avatar_path)
    await cfg.db.execute('UPDATE users SET avatar_path = NULL WHERE id = ?', [user.id])
    return c.json({ ok: true })
  })

  // Trash (S50): the user-facing view of the 7-day soft-delete window. Notes, to-dos and
  // projects deleted in the UI keep deleted_at set and stay invisible everywhere until
  // the daily cron (admin.ts scheduledPurge — same cutoff) hard-deletes them. Until now
  // the ONLY recovery path was the 5-6s undo toast at delete time; a missed toast meant
  // the item was unrecoverable in practice even though the row still existed. This route
  // lists what is still recoverable, newest first. The restore POSTs ride the EXISTING
  // per-entity endpoints (POST /api/notes/:id/restore, /api/sadhana/tasks/:id/restore,
  // /api/projects/:id/restore) — this file adds no write path of its own. Read-only,
  // user_id-scoped (rule 1), no schema change: the purge cutoff is duplicated here in
  // days, not SQL, because the listing must NOT filter by age — an item at day 7 minus
  // one hour still shows (with days_left 0 = "purges today") right up until the cron runs.
  app.get('/trash', async (c) => {
    const user = c.get('user')
    const DAY = 24 * 3600 * 1000
    const now = Date.now()
    const daysLeft = (deletedAt: string) => Math.max(0, 7 - Math.floor((now - Date.parse(deletedAt)) / DAY))
    type Item = { id: string; kind: 'project' | 'note' | 'todo'; title: string; snippet: string | null; deleted_at: string; days_left: number }
    const items: Item[] = []

    const projects = await cfg.db.query<{ id: string; title: string; deleted_at: string }>(
      'SELECT id, title, deleted_at FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50',
      [user.id],
    )
    for (const p of projects) items.push({ id: p.id, kind: 'project', title: p.title, snippet: null, deleted_at: p.deleted_at, days_left: daysLeft(p.deleted_at) })

    const notes = await cfg.db.query<{ id: string; title: string | null; content: string; kind: string; deleted_at: string }>(
      'SELECT id, title, content, kind, deleted_at FROM quick_notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50',
      [user.id],
    )
    for (const n of notes) {
      // List notes store their tasks as JSON items — surface the first line either way;
      // the UI truncates to one row, this is a recognition hint, not the full content.
      let first = n.content
      if (n.kind === 'list') {
        try {
          const arr = JSON.parse(n.content) as { t?: string }[]
          if (Array.isArray(arr) && arr.length) first = String(arr[0]?.t ?? '')
        } catch { /* unparseable list — fall back to raw content */ }
      }
      items.push({ id: n.id, kind: 'note', title: n.title || first.slice(0, 80) || '(untitled)', snippet: first.slice(0, 120), deleted_at: n.deleted_at, days_left: daysLeft(n.deleted_at) })
    }

    const todos = await cfg.db.query<{ id: string; title: string; deleted_at: string }>(
      'SELECT id, title, deleted_at FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50',
      [user.id],
    )
    for (const t of todos) items.push({ id: t.id, kind: 'todo', title: t.title, snippet: null, deleted_at: t.deleted_at, days_left: daysLeft(t.deleted_at) })

    items.sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at))
    return c.json({ items: items.slice(0, 100) })
  })

  return app
}
