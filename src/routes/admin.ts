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
export async function scheduledBackup(cfg: Config): Promise<void> {
  if (!cfg.github.token) {
    log.warn('backup_skipped', { reason: 'GITHUB_TOKEN not set' })
    return
  }
  try {
    const result = await backupToGitHub(cfg.db, {
      owner: cfg.github.owner,
      repo: cfg.github.repo,
      token: cfg.github.token,
    }, undefined, BACKUP_RETENTION_DEFAULT, cfg.backupEncryptionKey)
    log.info('backup_committed', { path: result.path, encrypted: !!cfg.backupEncryptionKey })
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
  })
  console.log(`purged ${gone.length} rows, ${goneNotes.length} notes, ${goneSadhana.length} todos`)
  // P3.1 (F-M12): structured log alongside the legacy line (kept for grep continuity).
  log.info('purge_complete', { projects: gone.length, notes: goneNotes.length, todos: goneSadhana.length })
}
