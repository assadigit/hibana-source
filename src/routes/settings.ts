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

  return app
}
