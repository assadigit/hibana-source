import { Hono, type MiddlewareHandler } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { isBanned } from '../auth/ban'
import { toastHtml } from '../lib/html'
import { localeOf, trFor } from '../lib/i18n'
import { jsonBody, requestOrigin } from '../lib/http'
import { log } from '../lib/log'
import { banUserSchema, roleUserSchema, removeUserSchema, customEmailSchema, broadcastEmailSchema, BAN_PRESET_MS } from '../validation/schemas'
import { BANNED_FOREVER_DATE } from '../auth/ban'
import { buildSnapshot, backupToGitHub, BACKUP_RETENTION_DEFAULT } from '../services/backup'
import { sendPlanBBackupToChat } from '../services/backup-planb'
import { sendAndLog, emailsSentToday, RESEND_DAILY_LIMIT, resetEmailHtml, textToEmailHtml } from '../services/email'
import { createResetToken } from '../services/reset'
import { githubClient } from '../services/github'
import { sendTelegramMessage } from '../services/telegram'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import type { Config, UserRow } from '../types'

// Owner-scoped admin console (batch e: users, bans, roles, the email console, backup
// status/download) plus the original owner tools: /backup triggers the same code the
// daily cron uses; /purge physically removes soft-deleted rows older than 7 days (Q2
// decision).

// Broadcast paging cap: one request sends at most this many emails so a Worker request
// stays short (CPU/timeout) and progress is resumable — the client pages with { offset }
// until { done }. The daily Resend quota is a separate guard (assertQuota below).
const BROADCAST_MAX_PER_REQUEST = 40

type AuthedContext = Context<{ Variables: { user: UserRow } }>

export function adminRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // Batch-e hardening: the per-route isOwner closures were replaced by ONE owner gate
  // mounted right after requireAuth — no admin route added later can forget the check
  // (the 2026-08-28 incident: /purge shipped without the check its sibling /backup had).
  const requireOwner: MiddlewareHandler<{ Variables: { user: UserRow } }> = async (c, next) => {
    if (c.get('user').role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    return next()
  }
  app.use('*', requireOwner)

  const loadUser = async (id: string): Promise<UserRow | null> => {
    const rows = await cfg.db.query<UserRow>('SELECT * FROM users WHERE id = ?', [id])
    return rows[0] ?? null
  }

  // The last-owner guard for demotions: demoting the only owner would lock the console.
  const ownerCount = async (): Promise<number> => {
    const rows = await cfg.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'")
    return rows[0]?.n ?? 0
  }

  app.get('/users', async (c) => {
    const users = await cfg.db.query<UserRow>('SELECT * FROM users ORDER BY created_at ASC')
    const projectCounts = await cfg.db.query<{ user_id: string; c: number }>(
      'SELECT user_id, COUNT(*) AS c FROM projects WHERE deleted_at IS NULL GROUP BY user_id',
    )
    const noteCounts = await cfg.db.query<{ user_id: string; c: number }>(
      'SELECT user_id, COUNT(*) AS c FROM quick_notes WHERE deleted_at IS NULL GROUP BY user_id',
    )
    const pc = new Map(projectCounts.map((r): [string, number] => [r.user_id, r.c]))
    const nc = new Map(noteCounts.map((r): [string, number] => [r.user_id, r.c]))
    const me = c.get('user').id
    const now = Date.now()
    // Presence: requireAuth stamps last_seen_at on every authed request, so "online"
    // = seen within the last 5 minutes. suspended = isBanned (forever sentinel or a
    // still-future until date).
    const list = users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
      email_verified_at: u.email_verified_at,
      banned_until: u.banned_until,
      ban_reason: u.ban_reason,
      last_seen_at: u.last_seen_at,
      online: !!u.last_seen_at && now - new Date(u.last_seen_at).getTime() < 5 * 60 * 1000,
      suspended: isBanned(u),
      projects: pc.get(u.id) ?? 0,
      notes: nc.get(u.id) ?? 0,
      is_self: u.id === me,
    }))
    return c.json({
      users: list,
      summary: {
        total: list.length,
        verified: list.filter((u) => u.email_verified_at).length,
        unverified: list.filter((u) => !u.email_verified_at).length,
        banned: list.filter((u) => u.suspended).length,
        online: list.filter((u) => u.online).length,
        owners: list.filter((u) => u.role === 'owner').length,
      },
    })
  })

  app.patch('/users/:id/ban', async (c) => {
    const body = await jsonBody(c, banUserSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const target = await loadUser(c.req.param('id'))
    if (!target) return c.json({ error: 'not_found' }, 404)
    if (target.role === 'owner') return c.json({ error: 'owner_protected' }, 403)
    let until: string
    if (body.preset) {
      const ms = BAN_PRESET_MS[body.preset]
      // L8 fix: permanent bans use a far-future ISO date instead of the 'forever' string
      // sentinel — the column holds ISO timestamps, so this removes the special case.
      until = ms === null ? BANNED_FOREVER_DATE : new Date(Date.now() + ms).toISOString()
    } else {
      // Custom date: finite, strictly future, at most 10 years out. (The schema refine
      // already rejects past dates as invalid_input; this is the ceiling + NaN guard.)
      const t = new Date(body.until!).getTime()
      if (!Number.isFinite(t) || t <= Date.now() || t > Date.now() + 10 * 365 * 24 * 3600 * 1000) {
        return c.json({ error: 'invalid_until' }, 400)
      }
      until = new Date(t).toISOString()
    }
    // Banning also kills every live session: a banned user must not get to finish
    // the request they were already in the middle of.
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?', [until, body.reason ?? null, target.id])
      tx.sql('DELETE FROM sessions WHERE user_id = ?', [target.id])
    })
    return c.json({ ok: true, banned_until: until, ban_reason: body.reason ?? null })
  })

  app.post('/users/:id/unban', async (c) => {
    const target = await loadUser(c.req.param('id'))
    if (!target) return c.json({ error: 'not_found' }, 404)
    await cfg.db.execute('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?', [target.id])
    return c.json({ ok: true })
  })

  app.post('/users/:id/role', async (c) => {
    const body = await jsonBody(c, roleUserSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const target = await loadUser(c.req.param('id'))
    if (!target) return c.json({ error: 'not_found' }, 404)
    if (target.id === c.get('user').id) return c.json({ error: 'cannot_change_own_role' }, 403)
    if (target.role === body.role) return c.json({ ok: true })
    if (target.role === 'owner' && body.role === 'member' && (await ownerCount()) <= 1) {
      return c.json({ error: 'last_owner' }, 403)
    }
    await cfg.db.execute('UPDATE users SET role = ? WHERE id = ?', [body.role, target.id])
    return c.json({ ok: true, role: body.role })
  })

  app.delete('/users/:id', async (c) => {
    const body = await jsonBody(c, removeUserSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const target = await loadUser(c.req.param('id'))
    if (!target) return c.json({ error: 'not_found' }, 404)
    if (target.role === 'owner') return c.json({ error: 'owner_protected' }, 403)
    // Typing the username (or the email when there is no username) confirms intent.
    const confirmName = target.username ?? target.email
    if (body.confirm !== confirmName) return c.json({ error: 'confirm_mismatch', expected: confirmName }, 400)
    // Invites the user created go with them; invites they consumed survive but lose
    // the attribution (used_by is informational, not an FK to preserve).
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM invites WHERE created_by = ?', [target.id])
      tx.sql('UPDATE invites SET used_by = NULL WHERE used_by = ?', [target.id])
      tx.sql('DELETE FROM users WHERE id = ?', [target.id])
    })
    return c.json({ ok: true, removed: confirmName })
  })

  app.post('/users/:id/send-reset', async (c) => {
    const target = await loadUser(c.req.param('id'))
    if (!target) return c.json({ error: 'not_found' }, 404)
    const origin = requestOrigin(c)
    const token = await createResetToken(cfg.db, target.id)
    const link = `${origin}/reset.html?token=${token}`
    try {
      await sendAndLog(cfg, {
        origin,
        to: target.email,
        subject: 'Password reset — بازنشانی گذرواژه',
        kind: 'reset',
        title: 'بازنشانی گذرواژه — Password reset',
        bodyHtml: resetEmailHtml(link),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'email_failed', detail: msg }, 502)
    }
    return c.json({ ok: true, sent_to: target.email })
  })

  app.get('/emails', async (c) => {
    const sentToday = await emailsSentToday(cfg.db)
    const log = await cfg.db.query(
      'SELECT to_email, kind, subject, status, error, sent_at FROM email_log ORDER BY sent_at DESC LIMIT 50',
    )
    return c.json({ quota: { sent_today: sentToday, limit: RESEND_DAILY_LIMIT }, log })
  })

  // Daily Resend quota guard shared by /email and /email/broadcast: returns the
  // remaining count, or a 429 Response the route returns directly.
  const assertQuota = async (c: AuthedContext): Promise<number | Response> => {
    const remaining = RESEND_DAILY_LIMIT - (await emailsSentToday(cfg.db))
    if (remaining <= 0) return c.json({ error: 'quota_exhausted', limit: RESEND_DAILY_LIMIT }, 429)
    return remaining
  }

  app.post('/email', async (c) => {
    const body = await jsonBody(c, customEmailSchema)
    if (!body) return c.json({ error: 'invalid_input' }, 400)
    const quota = await assertQuota(c)
    if (quota instanceof Response) return quota
    const target = await loadUser(body.to)
    if (!target) return c.json({ error: 'not_found' }, 404)
    const origin = requestOrigin(c)
    try {
      await sendAndLog(cfg, {
        origin,
        to: target.email,
        subject: body.subject,
        kind: 'custom',
        title: body.subject,
        bodyHtml: textToEmailHtml(body.body),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'email_failed', detail: msg }, 502)
    }
    return c.json({ ok: true, sent_to: target.email }, 201)
  })

  app.post('/email/broadcast', async (c) => {
    // L4 fix (2026-09-10): rate-limit broadcast — each invocation sends up to 40 sequential
    // Resend API calls, so a runaway script or compromised owner session could flood Resend.
    // 2 per 60s per IP is generous for real broadcast use (owner-only via requireOwner).
    if (await hitRateLimit(cfg.db, RATE_RULES.broadcast, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many broadcasts — wait a minute and try again.' }, 429)
    }
    // The { offset } paging field lives here, not in the shared broadcastEmailSchema —
    // only this route pages.
    const raw = await c.req.json().catch(() => null)
    const parsed = broadcastEmailSchema.extend({ offset: z.number().int().min(0).default(0) }).safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
    const body = parsed.data
    const quota = await assertQuota(c)
    if (quota instanceof Response) return quota
    const all = await cfg.db.query<UserRow>(
      'SELECT * FROM users WHERE email_verified_at IS NOT NULL ORDER BY created_at ASC',
    )
    // Verified only, not currently banned, and not a placeholder address from the
    // registration fixtures (@local.invalid).
    const recipients = all.filter((u) => !isBanned(u) && !u.email.endsWith('@local.invalid'))
    const offset = body.offset
    if (offset > recipients.length) return c.json({ error: 'offset_out_of_range' }, 400)
    const budget = Math.min(quota, BROADCAST_MAX_PER_REQUEST, recipients.length - offset)
    const origin = requestOrigin(c)
    const failed: { email: string; error: string }[] = []
    let sent = 0
    for (const r of recipients.slice(offset, offset + budget)) {
      try {
        await sendAndLog(cfg, {
          origin,
          to: r.email,
          subject: body.subject,
          kind: 'broadcast',
          title: body.subject,
          bodyHtml: textToEmailHtml(body.body),
        })
        sent++
      } catch (err) {
        failed.push({ email: r.email, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return c.json({
      total: recipients.length,
      offset,
      attempted: budget,
      sent,
      failed,
      quota_remaining: quota - sent,
      done: offset + budget >= recipients.length,
    })
  })

  app.get('/backup/status', async (c) => {
    if (!cfg.github.token) return c.json({ configured: false })
    try {
      const entries = await githubClient(cfg.github).listDir('backups')
      const snaps = entries
        .filter((e) => e.name.startsWith('snapshot-') && e.name.endsWith('.json'))
        .sort((a, b) => a.name.localeCompare(b.name))
      return c.json({
        configured: true,
        count: snaps.length,
        newest: snaps.at(-1)?.name ?? null,
        retention: BACKUP_RETENTION_DEFAULT,
      })
    } catch (err) {
      // An upstream GitHub hiccup must not break the console page — report it as data.
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ configured: true, error: msg }, 200)
    }
  })

  app.get('/backup/download', async (c) => {
    const snapshot = await buildSnapshot(cfg.db)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    return c.body(JSON.stringify(snapshot, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="hibana-backup-${ts}.json"`,
    })
  })

  app.post('/backup', async (c) => {
    const t = trFor(c)
    if (!cfg.github.token) return c.json({ error: 'github_not_configured' }, 503)
    // T1 (SWOT Session 26): production refuses to write plaintext backups to GitHub —
    // matches backup-planb.ts:80-84's refuse-plaintext pattern. Dev/test may omit the key.
    if (cfg.isProd && !cfg.backupEncryptionKey) {
      return c.json({ error: 'backup_encryption_key_not_set', message: 'Production requires BACKUP_ENCRYPTION_KEY — refusing to write plaintext backup.' }, 500)
    }
    try {
      const result = await backupToGitHub(cfg.db, {
        owner: cfg.github.owner,
        repo: cfg.github.repo,
        token: cfg.github.token,
      }, undefined, BACKUP_RETENTION_DEFAULT, cfg.backupEncryptionKey)
      if (c.req.header('HX-Request')) return c.html(toastHtml(t('Backup committed: {path}', 'پشتیبان ثبت شد: {path}', { path: result.path }), localeOf(c)))
      return c.json({ ok: true, ...result }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 502)
    }
  })

  // Plan B manual trigger (docs/perf-and-data-safety.md §1): push the encrypted snapshot
  // as a Telegram document to every LINKED OWNER's chat — the same on-demand send the
  // bot's ⚙ Settings 🗄 item performs for the tapping owner. Session 14: the automatic
  // 4×/day cron push is gone (user request — it spammed the chat); this route and the
  // settings button are the only senders now. Owner-only (requireOwner above) and the
  // body is validated (rule 10) even though it carries no fields.
  const planBBackupSchema = z.object({}).strict()
  app.post('/backup/planb', async (c) => {
    const t = trFor(c)
    const raw = await c.req.json().catch(() => ({}))
    const parsed = planBBackupSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
    try {
      if (!cfg.telegramToken || !cfg.backupEncryptionKey) {
        return c.json({ ok: false, skipped: 'telegram bot or BACKUP_ENCRYPTION_KEY not configured' }, 503)
      }
      const owners = await cfg.db.query<Pick<UserRow, 'id' | 'telegram_chat_id'>>(
        "SELECT id, telegram_chat_id FROM users WHERE role = 'owner' AND telegram_chat_id IS NOT NULL",
      )
      if (owners.length === 0) {
        return c.json({ ok: false, skipped: 'no owner with a linked Telegram chat' }, 503)
      }
      const sent: { userId: string; chatId: string; messageId: number; fileId: string; size: number; sha256: string }[] = []
      const pruned: number[] = []
      for (const owner of owners) {
        const r = await sendPlanBBackupToChat(cfg, owner.id, owner.telegram_chat_id!)
        if (r.ok) sent.push({ userId: owner.id, chatId: owner.telegram_chat_id!, messageId: r.messageId!, fileId: r.fileId!, size: r.size ?? 0, sha256: r.sha256 })
        else log.error('planb_send_failed', { userId: owner.id, reason: r.reason })
        pruned.push(...r.pruned)
      }
      if (sent.length === 0) {
        return c.json({ ok: false, skipped: 'every send failed — see error log' }, 502)
      }
      if (c.req.header('HX-Request')) {
        return c.html(toastHtml(t('Plan B backup sent to {n} chat(s)', 'پشتیبان Plan B به {n} چت ارسال شد', { n: sent.length }), localeOf(c)))
      }
      return c.json({ ok: true, sent, pruned }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 502)
    }
  })

  // Plan B delivery log (admin console / drill surface): newest first, owner-scoped view.
  app.get('/backup/planb/status', async (c) => {
    const rows = await cfg.db.query(
      'SELECT user_id, chat_id, message_id, file_size, sha256, schema_version, sent_at FROM planb_backups ORDER BY sent_at DESC LIMIT 20',
    )
    return c.json({ configured: !!cfg.telegramToken && !!cfg.backupEncryptionKey, deliveries: rows })
  })

  // Error observability viewer (0045, docs/dr-integrity-closeout.md §4): recent rows from
  // error_log + 7-day counts by status. Owner-only (gate above) and Zod-validated (rule 10)
  // even though it is read-only — query params are still input. The stack is trimmed to a
  // preview (first 300 chars) so the console stays readable; full rows live in D1/tail.
  const errorsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.coerce.number().int().min(100).max(599).optional(),
  })
  app.get('/errors', async (c) => {
    const parsed = errorsQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid_input' }, 400)
    const { limit, status } = parsed.data
    const rows = status
      ? await cfg.db.query('SELECT id, created_at, req_id, user_id, path, status, code, message, substr(stack, 1, 300) AS stack FROM error_log WHERE status = ? ORDER BY created_at DESC LIMIT ?', [String(status), String(limit)])
      : await cfg.db.query('SELECT id, created_at, req_id, user_id, path, status, code, message, substr(stack, 1, 300) AS stack FROM error_log ORDER BY created_at DESC LIMIT ?', [String(limit)])
    const byStatus = await cfg.db.query<{ status: number; n: number }>(
      'SELECT status, COUNT(*) AS n FROM error_log WHERE created_at > ? GROUP BY status ORDER BY n DESC',
      [new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()],
    )
    return c.json({ rows, counts_7d: byStatus })
  })

  // Feature-usage analytics + top-10 activity ranking (the last open item on the §6
  // list, 2026-09-12). One read-only owner-scoped endpoint feeding the Usage tab:
  //   (a) features  — per-surface totals with last-activity recency (non-deleted rows)
  //   (b) top_users — weighted all-time activity ranking with a per-surface breakdown
  //   (c) daily     — 14-day zero-filled creation histogram across the main content tables
  // All queries are trivial aggregates (GROUP BY / COUNT / MAX) over the same tables
  // /api/admin/users and /api/reports already scan — no new indexes needed at app scale.
  // Soft-delete conventions differ per table (deleted_at vs deleted flag) and are
  // respected surface-by-surface so the panel never counts tombstoned rows.
  const USAGE_SURFACES: Array<{ key: string; sql: string }> = [
    { key: 'projects', sql: "SELECT COUNT(*) AS c, MAX(COALESCE(updated_at, created_at)) AS m FROM projects WHERE deleted_at IS NULL" },
    { key: 'sparkFolders', sql: 'SELECT COUNT(*) AS c, MAX(created_at) AS m FROM spark_folders' },
    { key: 'canvas', sql: "SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM canvas_elements WHERE board = 'canvas' AND deleted = 0" },
    { key: 'notebook', sql: "SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM canvas_elements WHERE board = 'notebook' AND deleted = 0" },
    { key: 'quickNotes', sql: 'SELECT COUNT(*) AS c, MAX(COALESCE(updated_at, created_at)) AS m FROM quick_notes WHERE deleted_at IS NULL' },
    { key: 'sadhanaTasks', sql: 'SELECT COUNT(*) AS c, MAX(COALESCE(updated_at, created_at)) AS m FROM sadhana_tasks WHERE deleted_at IS NULL' },
    { key: 'sadhanaUpdates', sql: 'SELECT COUNT(*) AS c, MAX(created_at) AS m FROM sadhana_updates' },
    { key: 'devTasks', sql: 'SELECT COUNT(*) AS c, MAX(d.created_at) AS m FROM dev_tasks d JOIN projects p ON d.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'hurdles', sql: 'SELECT COUNT(*) AS c, MAX(h.created_at) AS m FROM hurdles h JOIN projects p ON h.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'sprints', sql: 'SELECT COUNT(*) AS c, MAX(s.created_at) AS m FROM sprints s JOIN projects p ON s.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'backlogDocs', sql: 'SELECT COUNT(*) AS c, MAX(COALESCE(b.updated_at, b.created_at)) AS m FROM backlog_docs b JOIN projects p ON b.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'links', sql: 'SELECT COUNT(*) AS c, MAX(l.created_at) AS m FROM links l JOIN projects p ON l.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'payments', sql: 'SELECT COUNT(*) AS c, MAX(pay.created_at) AS m FROM payments pay JOIN projects p ON pay.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'telegramCaptures', sql: 'SELECT COUNT(*) AS c, MAX(created_at) AS m FROM telegram_captures' },
    { key: 'screenshots', sql: 'SELECT COUNT(*) AS c, MAX(sc.created_at) AS m FROM screenshots sc JOIN projects p ON sc.project_id = p.id WHERE p.deleted_at IS NULL' },
    { key: 'archives', sql: 'SELECT COUNT(*) AS c, MAX(archived_at) AS m FROM project_archives' },
    { key: 'invites', sql: 'SELECT COUNT(*) AS c, MAX(created_at) AS m FROM invites' },
  ]
  // Per-user GROUP BY feeds for the ranking. Weighted: creating a project/task/backlog
  // doc is a heavier commitment than a pen stroke or a quick note, so the score reflects
  // deliberate acts, not raw row counts (a single doodle session would otherwise drown
  // out a week of planning). The breakdown ships unweighted — the UI shows real counts.
  // Project-scoped tables (dev_tasks/backlog_docs/screenshots) join through projects for
  // the owner; sadhana_updates joins through its task (both verified against schema 47:
  // none of them carry user_id directly).
  const RANKING_FEEDS: Array<{ part: string; sql: string; weight: number }> = [
    { part: 'projects', sql: 'SELECT user_id, COUNT(*) AS c FROM projects WHERE deleted_at IS NULL GROUP BY user_id', weight: 3 },
    { part: 'canvas', sql: "SELECT user_id, COUNT(*) AS c FROM canvas_elements WHERE board = 'canvas' AND deleted = 0 GROUP BY user_id", weight: 1 },
    { part: 'notebook', sql: "SELECT user_id, COUNT(*) AS c FROM canvas_elements WHERE board = 'notebook' AND deleted = 0 GROUP BY user_id", weight: 1 },
    { part: 'notes', sql: 'SELECT user_id, COUNT(*) AS c FROM quick_notes WHERE deleted_at IS NULL GROUP BY user_id', weight: 1 },
    { part: 'sadhana', sql: 'SELECT user_id, COUNT(*) AS c FROM sadhana_tasks WHERE deleted_at IS NULL GROUP BY user_id', weight: 2 },
    { part: 'updates', sql: 'SELECT t.user_id AS user_id, COUNT(*) AS c FROM sadhana_updates u JOIN sadhana_tasks t ON u.task_id = t.id WHERE t.deleted_at IS NULL GROUP BY t.user_id', weight: 1 },
    { part: 'devtasks', sql: 'SELECT p.user_id AS user_id, COUNT(*) AS c FROM dev_tasks d JOIN projects p ON d.project_id = p.id WHERE p.deleted_at IS NULL GROUP BY p.user_id', weight: 2 },
    { part: 'backlog', sql: 'SELECT p.user_id AS user_id, COUNT(*) AS c FROM backlog_docs b JOIN projects p ON b.project_id = p.id WHERE p.deleted_at IS NULL GROUP BY p.user_id', weight: 2 },
    { part: 'telegram', sql: 'SELECT user_id, COUNT(*) AS c FROM telegram_captures GROUP BY user_id', weight: 2 },
    { part: 'screenshots', sql: 'SELECT p.user_id AS user_id, COUNT(*) AS c FROM screenshots sc JOIN projects p ON sc.project_id = p.id WHERE p.deleted_at IS NULL GROUP BY p.user_id', weight: 2 },
  ]
  app.get('/usage', async (c) => {
    // The 14-day histogram is TWO 5-term compound SELECTs (not one 10-term UNION ALL),
    // merged by day in JS: D1 enforces a compound-SELECT term cap that the 10-term form
    // blew past live on the Workers runtime ("D1_ERROR: too many terms in compound
    // SELECT" — node:sqlite accepted it, so only the deployed worker caught it).
    // 5 terms per compound stays under the cap with headroom for future surfaces.
    const dailyPartA = `SELECT day, SUM(c) AS c FROM (
           SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM projects WHERE deleted_at IS NULL GROUP BY day
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM quick_notes WHERE deleted_at IS NULL GROUP BY 1
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM canvas_elements WHERE deleted = 0 GROUP BY 1
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM sadhana_tasks WHERE deleted_at IS NULL GROUP BY 1
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM sadhana_updates GROUP BY 1
         ) GROUP BY day`
    const dailyPartB = `SELECT day, SUM(c) AS c FROM (
           SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM dev_tasks GROUP BY day
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM backlog_docs GROUP BY 1
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM links GROUP BY 1
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM telegram_captures GROUP BY 1
           UNION ALL SELECT substr(created_at, 1, 10), COUNT(*) FROM screenshots GROUP BY 1
         ) GROUP BY day`
    const [featRows, rankRows, users, dailyA, dailyB] = await Promise.all([
      Promise.all(USAGE_SURFACES.map((s) => cfg.db.query<{ c: number; m: string | null }>(s.sql))),
      Promise.all(RANKING_FEEDS.map((f) => cfg.db.query<{ user_id: string; c: number }>(f.sql))),
      cfg.db.query<{ id: string; username: string | null; email: string; last_seen_at: string | null }>(
        'SELECT id, username, email, last_seen_at FROM users',
      ),
      cfg.db.query<{ day: string; c: number }>(dailyPartA),
      cfg.db.query<{ day: string; c: number }>(dailyPartB),
    ])
    const features = USAGE_SURFACES.map((s, i) => ({ key: s.key, count: featRows[i][0]?.c ?? 0, last_at: featRows[i][0]?.m ?? null }))
    // Merge the per-surface GROUP BYs into one per-user record, then rank by score.
    const byUser = new Map<string, { parts: Record<string, number>; score: number }>()
    for (const [i, feed] of RANKING_FEEDS.entries()) {
      for (const row of rankRows[i]) {
        let rec = byUser.get(row.user_id)
        if (!rec) { rec = { parts: {}, score: 0 }; byUser.set(row.user_id, rec) }
        rec.parts[feed.part] = row.c
        rec.score += row.c * feed.weight
      }
    }
    const nameOf = new Map(users.map((u) => [u.id, u]))
    const topUsers = [...byUser.entries()]
      .filter(([id]) => nameOf.has(id)) // orphaned rows (hard-deleted user cascade gap) never rank
      .map(([id, rec]) => ({
        id,
        username: nameOf.get(id)!.username,
        email: nameOf.get(id)!.email,
        last_seen_at: nameOf.get(id)!.last_seen_at,
        score: rec.score,
        parts: rec.parts,
      }))
      .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
      .slice(0, 10)
    // Zero-fill the last 14 days (oldest → newest) so the chart never has gaps.
    // dailyA + dailyB are merged first (the two compound halves of the histogram).
    const dailyMap = new Map<string, number>()
    for (const row of [...dailyA, ...dailyB]) dailyMap.set(row.day, (dailyMap.get(row.day) ?? 0) + row.c)
    const daily: Array<{ day: string; count: number }> = []
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10)
      daily.push({ day, count: dailyMap.get(day) ?? 0 })
    }
    return c.json({ features, top_users: topUsers, daily })
  })

  // Manual trigger of the 7-day purge — owner-only via requireOwner (like every console
  // route): it hard-deletes every user's soft-deleted rows, so a member must never be
  // able to force that early. (History: 2026-08-28, this route shipped without the
  // owner check its sibling /backup had — both per-route checks are now the middleware.)
  app.post('/purge', async (c) => {
    const t = trFor(c)
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const gone = await cfg.db.query<{ id: string }>(
      'SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [cutoff],
    )
    const goneNotes = await cfg.db.query<{ id: string }>(
      'SELECT id FROM quick_notes WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [cutoff],
    )
    const goneSadhana = await cfg.db.query<{ id: string }>(
      'SELECT id FROM sadhana_tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [cutoff],
    )
    // Set-based deletes (2026-08-28): FK cascades fire identically, but this is 4 statements
    // instead of one per row — a big purge week no longer builds thousands of batched stmts.
    // Hygiene extension (2026-08-28, Phase 2): soft-deleted sadhana_tasks were never
    // hard-deleted — their update journal, tags, reminder logs and recurrence history
    // (all ON DELETE CASCADE, migration 0018) piled up forever. Also sweeps expired
    // email-verification codes (rejected by /verify anyway, so deleting is invisible).
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]) // children cascade
      tx.sql('DELETE FROM quick_notes WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff])
      tx.sql('DELETE FROM sadhana_tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]) // journal/tags/logs cascade
      tx.sql('DELETE FROM password_resets WHERE expires_at < ?', [new Date().toISOString()])
      tx.sql('DELETE FROM email_verifications WHERE expires_at < ?', [new Date().toISOString()])
      tx.sql('DELETE FROM sessions WHERE expires_at < ?', [cutoff])
      tx.sql('DELETE FROM rate_limits WHERE window_start < ?', [Math.floor(Date.now() / 1000) - 24 * 3600])
    })
    if (c.req.header('HX-Request')) return c.html(toastHtml(t('Purged {n} deleted project(s), {m} note(s), {k} to-do(s), + expired sessions', '{n} پروژهٔ حذف‌شده، {m} یادداشت، {k} کار لیست، + نشست‌های منقضی پاک شد', { n: gone.length, m: goneNotes.length, k: goneSadhana.length }), localeOf(c)))
    return c.json({ ok: true, purged: gone.length, purgedNotes: goneNotes.length, purgedTodos: goneSadhana.length })
  })

  return app
}

// Cron entry (wrangler.toml triggers). Runs without a user session — backups are a whole-DB
// snapshot, not per-user, so no auth applies (and none is possible on a scheduled job).
//
// dr-integrity session: returns its OUTCOME instead of pure void — the dead-man's-switch
// wiring in src/index.ts needs to know whether the cron actually pushed a backup (the
// alerting below still fires internally; the return value is new information, not a new
// failure path — the function still never throws).
export type BackupOutcome =
  | { kind: 'pushed'; path: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }

export async function scheduledBackup(cfg: Config): Promise<BackupOutcome> {
  if (!cfg.github.token) {
    log.warn('backup_skipped', { reason: 'GITHUB_TOKEN not set' })
    return { kind: 'skipped', reason: 'GITHUB_TOKEN not set' }
  }
  // T1 (SWOT Session 26): production refuses to write plaintext backups — matches
  // backup-planb.ts:80-84. A missing key in prod is a configuration error, not a
  // silent degradation to plaintext.
  if (cfg.isProd && !cfg.backupEncryptionKey) {
    log.error('backup_skipped', { reason: 'BACKUP_ENCRYPTION_KEY not set in production — refusing plaintext' })
    return { kind: 'skipped', reason: 'BACKUP_ENCRYPTION_KEY not set — production refuses to write plaintext' }
  }
  try {
    const result = await backupToGitHub(cfg.db, {
      owner: cfg.github.owner,
      repo: cfg.github.repo,
      token: cfg.github.token,
    }, undefined, BACKUP_RETENTION_DEFAULT, cfg.backupEncryptionKey)
    log.info('backup_committed', { path: result.path, encrypted: !!cfg.backupEncryptionKey })
    return { kind: 'pushed', path: result.path }
  } catch (err) {
    // P3.1 (F-M12) + P3.5(c) (F-M4): structured error log + owner-email alert. A failed
    // backup previously only logged (plain text); now it also emails the owner so a silent
    // backup gap can't go unnoticed. The email send is best-effort (never rethrows).
    log.error('backup_failed', { err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) })
    if (cfg.emailKey && cfg.ownerEmail) {
      try {
        await sendAndLog(
          { db: cfg.db, emailKey: cfg.emailKey, assets: cfg.assets },
          {
            to: cfg.ownerEmail,
            kind: 'backup_failed',
            subject: 'Hibana backup failed',
            title: 'Backup failed',
            bodyHtml: `<p>The scheduled Hibana backup failed at ${new Date().toISOString()}.</p><p>Error: ${err instanceof Error ? err.message : String(err)}</p><p>The next scheduled run will retry. Check <code>wrangler tail</code> for the structured error.</p>`,
            origin: 'https://hibana.ir',
          },
        )
      } catch (emailErr) {
        log.error('backup_alert_email_failed', { err: emailErr instanceof Error ? { message: emailErr.message } : String(emailErr) })
      }
    }
    // H6 fix (2026-09-10): Telegram-direct backup-failure alert — a SECONDARY channel that
    // works even if Resend itself is down (the email alert above uses the same Resend key).
    // Looks up the owner's linked Telegram chat and sends a direct bot message. Best-effort:
    // if the owner isn't linked to Telegram, or the bot isn't configured, this is a no-op.
    if (cfg.telegramToken) {
      try {
        const owners = await cfg.db.query<UserRow>(
          "SELECT telegram_chat_id FROM users WHERE role = 'owner' AND telegram_chat_id IS NOT NULL AND telegram_paused = 0",
        )
        const errMsg = err instanceof Error ? err.message : String(err)
        for (const o of owners) {
          await sendTelegramMessage(
            cfg.telegramToken,
            o.telegram_chat_id!,
            `🔴 <b>Hibana backup failed</b>\n\nTime: ${new Date().toISOString()}\nError: ${errMsg.slice(0, 500)}\n\nThe next scheduled run will retry automatically.`,
            'HTML',
          )
        }
      } catch (tgErr) {
        log.error('backup_alert_telegram_failed', { err: tgErr instanceof Error ? { message: tgErr.message } : String(tgErr) })
      }
    }
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Same purge logic as the admin route, for the cron. */
export async function scheduledPurge(cfg: Config): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const gone = await cfg.db.query<{ id: string }>(
    'SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    [cutoff],
  )
  const goneNotes = await cfg.db.query<{ id: string }>(
    'SELECT id FROM quick_notes WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    [cutoff],
  )
  const goneSadhana = await cfg.db.query<{ id: string }>(
    'SELECT id FROM sadhana_tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    [cutoff],
  )
  await cfg.db.transaction(async (tx) => {
    tx.sql('DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff])
    tx.sql('DELETE FROM quick_notes WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff])
    tx.sql('DELETE FROM sadhana_tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff])
    tx.sql('DELETE FROM password_resets WHERE expires_at < ?', [new Date().toISOString()])
    tx.sql('DELETE FROM email_verifications WHERE expires_at < ?', [new Date().toISOString()])
    tx.sql('DELETE FROM sessions WHERE expires_at < ?', [cutoff])
    tx.sql('DELETE FROM rate_limits WHERE window_start < ?', [Math.floor(Date.now() / 1000) - 24 * 3600])
    // 0045: error_log rides the same 7-day retention window — it is observability, not
    // history (longer-lived evidence of an incident belongs in the runbook/incident notes,
    // not in an unbounded table).
    tx.sql('DELETE FROM error_log WHERE created_at < ?', [cutoff])
  })
  console.log(`purged ${gone.length} rows, ${goneNotes.length} notes, ${goneSadhana.length} todos`)
  // P3.1 (F-M12): structured log alongside the legacy line (kept for grep continuity).
  log.info('purge_complete', { projects: gone.length, notes: goneNotes.length, todos: goneSadhana.length })
}
