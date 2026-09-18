import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { jsonBody, extForMime, mimeForPath } from '../lib/http'
import { toastHtml } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { calendarFor } from '../lib/jalali'
import { uuid } from '../lib/ids'
import { githubClient, type GitHubConfig } from '../services/github'
import { FREE_TIER_MODELS, DEFAULT_AI_MODEL } from '../services/ai'
import { TELEGRAM_BOT } from './integrations/telegram-helpers'
import { purgeShotBytes } from '../services/shotstore'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import type { Config, UserRow, InviteRow } from '../types'

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

// S75: the trash listing, extracted from GET /trash so the settings OVERVIEW (below)
// composes the exact same rows without a self-fetch. user_id-scoped (rule 1); the
// purge cutoff is duplicated in days, not SQL, because the listing must NOT filter by
// age — an item at day 7 minus one hour still shows (days_left 0 = "purges today")
// right up until the cron runs.
async function collectTrashItems(cfg: Config, userId: string): Promise<{ id: string; kind: 'project' | 'note' | 'todo'; title: string; snippet: string | null; deleted_at: string; days_left: number }[]> {
  const DAY = 24 * 3600 * 1000
  const now = Date.now()
  const daysLeft = (deletedAt: string) => Math.max(0, 7 - Math.floor((now - Date.parse(deletedAt)) / DAY))
  const items: { id: string; kind: 'project' | 'note' | 'todo'; title: string; snippet: string | null; deleted_at: string; days_left: number }[] = []

  const projects = await cfg.db.query<{ id: string; title: string; deleted_at: string }>(
    'SELECT id, title, deleted_at FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50',
    [userId],
  )
  for (const p of projects) items.push({ id: p.id, kind: 'project', title: p.title, snippet: null, deleted_at: p.deleted_at, days_left: daysLeft(p.deleted_at) })

  const notes = await cfg.db.query<{ id: string; title: string | null; content: string; kind: string; deleted_at: string }>(
    'SELECT id, title, content, kind, deleted_at FROM quick_notes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50',
    [userId],
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
    [userId],
  )
  for (const t of todos) items.push({ id: t.id, kind: 'todo', title: t.title, snippet: null, deleted_at: t.deleted_at, days_left: daysLeft(t.deleted_at) })

  items.sort((a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at))
  return items.slice(0, 100)
}

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

  // S75 (§10-F4, the named perf candidate): the settings OVERVIEW — one request
  // composes every READ the settings page needs on load: prefs, me, invites, the AI
  // model registry, telegram link status, and the trash listing. The page previously
  // fired 8 parallel JSON GETs (three of them literal duplicates: /api/settings ×2
  // for prefs+views, /api/auth/me ×2 for account+avatar, /api/ai/models ×2 via the
  // soft-nav safety re-run) — S69 measured the shotgun at ~1s summed apiMs cold.
  // Each slice keeps its standalone endpoint's EXACT response shape, so every legacy
  // consumer (and every post-mutation refresh, which stays targeted on purpose)
  // keeps working unchanged. user_id-scoped (rule 1); Zod-validated queryless GET.
  app.get('/overview', async (c) => {
    const user = c.get('user')
    const [trashItems, inviteRows] = await Promise.all([
      collectTrashItems(cfg, user.id),
      user.role === 'owner'
        ? cfg.db.query<InviteRow>('SELECT * FROM invites ORDER BY created_at DESC')
        : cfg.db.query<InviteRow>('SELECT * FROM invites WHERE created_by = ? ORDER BY created_at DESC', [user.id]),
    ])
    return c.json({
      prefs: {
        language_pref: user.language_pref,
        calendar_pref: calendarFor(user.language_pref),
        timezone: user.timezone,
        dash_show_header: user.dash_show_header,
        dash_show_projects: user.dash_show_projects,
        dash_show_todo: user.dash_show_todo,
        dash_show_notebook: user.dash_show_notebook,
        dash_show_activity: user.dash_show_activity,
        dash_order: user.dash_order,
      },
      // Same shape as GET /api/auth/me.
      me: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar_path: user.avatar_path,
          language_pref: user.language_pref,
          calendar_pref: calendarFor(user.language_pref),
          timezone: user.timezone,
          created_at: user.created_at,
        },
      },
      // Same shape as GET /api/auth/invites (JSON path).
      invites: inviteRows,
      // Same shape as GET /api/ai/models.
      ai: { models: FREE_TIER_MODELS, default: DEFAULT_AI_MODEL },
      // Same shape as GET /api/telegram/status.
      telegram: { ok: true, bot: TELEGRAM_BOT.handle, botUrl: TELEGRAM_BOT.url, linked: !!user.telegram_chat_id, chat_id: user.telegram_chat_id },
      // Same shape as GET /api/settings/trash.
      trash: { items: trashItems },
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
  // /api/projects/:id/restore) — this file adds no write path of its own. Read-only;
  // S75: the row collection itself moved into collectTrashItems (shared with /overview).
  app.get('/trash', async (c) => {
    const user = c.get('user')
    return c.json({ items: await collectTrashItems(cfg, user.id) })
  })

  // S71: user-facing "delete forever" — the explicit companion to Restore in the Trash
  // view. The 7-day cron remains the default; this is the user CHOOSING to free an item
  // now. Mirrors the admin purge's safety order exactly: screenshot BYTES first (best
  // effort — the row delete proceeds on failure, same as the cron), then the rows via
  // FK cascade (children of projects and the sadhana journal/tags/logs all cascade).
  // Only rows already soft-deleted are reachable (a live item must go through its own
  // delete flow first), everything is user_id-scoped (rule 1), and the vault's OWN
  // notes keep their dedicated /api/vault/notes/:id/purge (they are not in this panel).
  const PURGE_TABLES = { project: 'projects', note: 'quick_notes', todo: 'sadhana_tasks' } as const
  const purgeSchema = z.object({ kind: z.enum(['project', 'note', 'todo']), id: z.string().uuid() })

  app.post('/trash/purge', async (c) => {
    const user = c.get('user')
    const body = await jsonBody<z.infer<typeof purgeSchema>>(c, purgeSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const { kind, id } = body
    const table = PURGE_TABLES[kind]
    const row = await cfg.db.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
      [id, user.id],
    )
    if (!row.length) return c.json({ error: 'not_found' }, 404)
    if (kind === 'project') await purgeShotBytes(cfg, [id]) // best-effort, same order as the cron
    await cfg.db.execute(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [id, user.id])
    return c.json({ ok: true, kind, id })
  })

  // S71: "Empty trash" — the same delete, every soft-deleted row of THIS user at once.
  // Returns counts so the UI can confirm what was freed. Identical safety order.
  app.post('/trash/empty', async (c) => {
    const user = c.get('user')
    const goneProjects = await cfg.db.query<{ id: string }>(
      'SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL',
      [user.id],
    )
    const goneNotes = await cfg.db.query<{ id: string }>(
      'SELECT id FROM quick_notes WHERE user_id = ? AND deleted_at IS NOT NULL',
      [user.id],
    )
    const goneTodos = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NOT NULL',
      [user.id],
    )
    await purgeShotBytes(cfg, goneProjects.map((g) => g.id)) // best-effort; delete proceeds
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL', [user.id]) // children cascade
      tx.sql('DELETE FROM quick_notes WHERE user_id = ? AND deleted_at IS NOT NULL', [user.id])
      tx.sql('DELETE FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NOT NULL', [user.id]) // journal/tags/logs cascade
    })
    return c.json({
      ok: true,
      purgedProjects: goneProjects.length,
      purgedNotes: goneNotes.length,
      purgedTodos: goneTodos.length,
    })
  })

  return app
}
