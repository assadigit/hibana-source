import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware'
import { uuid } from '../lib/ids'
import { markdownFromZip, parseMarkdownNote, ZipLimitError } from '../lib/obsidian'
import { esc, requestOrigin } from '../lib/http'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import { createResetToken } from '../services/reset'
import { sendTelegramMessage } from '../services/telegram'
import type { Config, UserRow } from '../types'
import type { Db } from '../db/types'

// Telegram bot (spec §9 + §4.10) + Obsidian import (spec §9).

/** Constant-time string compare for webhook secrets (length mismatch also returns fast,
 * which only reveals the length — the secret length is not sensitive). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
// register*() functions add routes directly to the ROOT Hono app, before any sub-app at
// '/' — this is deliberate: coreRoutes has a global requireAuth middleware that would
// otherwise intercept the (public) Telegram webhook. Root-level routes are matched first
// and are not subject to the mounted apps' wildcard middleware.

const tgApi = (token: string, method: string, body: Record<string, unknown>) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const UPDATE_SCHEMA = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      from: z.object({ id: z.number() }),
      text: z.string().optional().default(''),
    })
    .optional(),
  text: z.string().optional(),
})

// The bot's public identity — Settings shows it so users know what to open, and the
// webhook's unlinked-chat replies point back here. Tokens come from secrets; the handle
// is not secret, so a module constant is fine (it keeps Settings and replies in sync).
const TELEGRAM_BOT = { handle: '@Hibana_PM_bot', url: 'https://t.me/Hibana_PM_bot' }
const LINK_CODE_TTL_MS = 60 * 60 * 1000 // link codes expire after 1h, like password resets

// ---- Bot note/list helpers (/note + /list flows) --------------------------------
const LIST_SESSION_TTL_MS = 2 * 60 * 60 * 1000 // a /list session goes stale after 2h of silence
const LIST_MAX_ITEMS = 50
const ITEM_MAX_CHARS = 300 // mirrors the web UI's per-item cap (quicknotes.ts)
const NOTE_MAX_CHARS = 20_000

/** Pending items for a user's /list session; null when none exists or it went stale. */
async function noteSession(db: Db, userId: string): Promise<string[] | null> {
  const rows = await db.query<{ items: string; updated_at: string }>(
    'SELECT items, updated_at FROM telegram_note_sessions WHERE user_id = ?',
    [userId],
  )
  if (rows.length === 0) return null
  if (Date.now() - new Date(rows[0].updated_at).getTime() > LIST_SESSION_TTL_MS) {
    await db.execute('DELETE FROM telegram_note_sessions WHERE user_id = ?', [userId]) // stale (rule 3)
    return null
  }
  try {
    const items = JSON.parse(rows[0].items)
    return Array.isArray(items) ? items.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function saveNoteSession(db: Db, userId: string, items: string[]): Promise<void> {
  await db.execute(
    'INSERT INTO telegram_note_sessions (user_id, items, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at',
    [userId, JSON.stringify(items), new Date().toISOString()],
  )
}

/** A plain Quick Note card on the dashboard notebook. */
async function createQuickNote(db: Db, userId: string, content: string): Promise<string> {
  const id = uuid()
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, 'note', '', content.trim().slice(0, NOTE_MAX_CHARS), now, now],
  )
  return id
}

/** A checklist card on the dashboard notebook — same JSON items shape as the web UI. */
async function createListNote(db: Db, userId: string, items: string[]): Promise<number> {
  const tasks = items.map((t) => ({ id: uuid(), t: t.slice(0, ITEM_MAX_CHARS), d: 0 as const }))
  const id = uuid()
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, 'list', '', JSON.stringify(tasks), now, now],
  )
  await db.execute('DELETE FROM telegram_note_sessions WHERE user_id = ?', [userId]) // consumed by the save
  return tasks.length
}

export function registerTelegram(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  // Spec §15: flood guard BEFORE the secret check (the limiter must count hostile traffic
  // too; 300 req/60s per IP — same value as the CF webhook rule).
  const webhookLimiter: MiddlewareHandler = async (c, next) => {
    if (await hitRateLimit(cfg.db, RATE_RULES.webhook, clientIp(c))) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }

  // Public webhook (secret-token header). Telegram calls this for every message (rule 11).
  // Timing-safe compare (hardening 2026-08-28): a plain !== leaks a (theoretical) early-exit
  // oracle on how many leading bytes match.
  app.post('/api/telegram/webhook', webhookLimiter, async (c) => {
    const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')
    if (!secret || !cfg.telegramSecret || !timingSafeEqual(secret, cfg.telegramSecret)) return c.json({ error: 'forbidden' }, 403) // rule 11
    const token = cfg.telegramToken
    if (!token) return c.json({ error: 'telegram_not_configured' }, 503)

    const parsed = UPDATE_SCHEMA.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ ok: true }) // ignore non-message updates

    const msg = parsed.data.message ?? { chat: { id: 0 }, from: { id: 0 }, text: parsed.data.text ?? '' }
    const chatId = msg.chat.id
    const text = (msg.text ?? '').trim()

    // The chat's account (if linked) drives every command below — rule 1: all bot data is
    // scoped to this user. Unlinked chats get a capture-now/link-later flow (§4.10).
    const owned = await cfg.db.query<UserRow>('SELECT id, username, telegram_paused FROM users WHERE telegram_chat_id = ?', [String(chatId)])

    // /start <code> links the chat to the account (one-time code from Settings).
    // Codes expire after 1h and are single-use, so an expired row is as invalid as a
    // missing one (created_at is stored as UTC ISO strings — lexicographically comparable).
    const start = text.match(/^\/start\s+(\S+)/i)
    if (start) {
      const expiredBefore = new Date(Date.now() - LINK_CODE_TTL_MS).toISOString()
      const links = await cfg.db.query<{ user_id: string }>(
        'SELECT user_id FROM telegram_links WHERE code = ? AND created_at >= ?',
        [start[1], expiredBefore],
      )
      if (links.length === 0) {
        await sendTelegramMessage(token, chatId, 'That link code is invalid or already used.')
        return c.json({ ok: true })
      }
      await cfg.db.transaction(async (tx) => {
        tx.sql('UPDATE users SET telegram_chat_id = ?, telegram_paused = 0 WHERE id = ?', [String(chatId), links[0].user_id]) // re-linking also resumes reminders (spec §6.22)
        tx.sql('DELETE FROM telegram_links WHERE code = ?', [start[1]]) // single-use
        tx.sql('UPDATE telegram_captures SET user_id = ? WHERE telegram_user_id = ? AND user_id IS NULL', [links[0].user_id, String(msg.from.id)])
      })
      await sendTelegramMessage(token, chatId, '✅ Linked to your Hibana account. Text me an idea whenever it hits — it is safe.')
      return c.json({ ok: true })
    }

    // /start alone (or /help): greet + show the commands, adapted to linked/unlinked.
    if (/^\/start$/i.test(text) || /^\/help\b/i.test(text)) {
      const help = owned.length === 0
        ? '🤖 Hibana bot — link your account first so your notes and ideas land safely:\n\nOpen Hibana Settings → Telegram → Generate link code, then send:\n/start <code>\n\nThen you can use: /idea, /note, /list, /help'
        : '🤖 Hibana bot — send me:\n\n/idea <text> — save a new Idea and get a link back\n/note <text> — add a Quick Note to your dashboard\n/list — collect a list (send items one per message, /done saves it, /cancel stops)\n/status — linked account + open task deadlines\n/pause — suspend reminders (send /resume to turn them back on)\n/reset — get a password-reset link here\n/help — this message'
      await sendTelegramMessage(token, chatId, help)
      return c.json({ ok: true })
    }

    // /status — linked account + how many open tasks have deadlines (spec §5.17).
    if (/^\/status\b/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 You are not linked to a Hibana account yet. Link it first: Hibana Settings → Telegram → generate a code, then send /start <code> here.')
      } else {
        const rows = await cfg.db.query<{ n: number }>(
          'SELECT COUNT(*) AS n FROM sadhana_tasks WHERE user_id = ? AND done = 0 AND deleted_at IS NULL AND due_date IS NOT NULL',
          [owned[0].id],
        )
        const paused = owned[0].telegram_paused === 1
        await sendTelegramMessage(
          token,
          chatId,
          `📊 <b>${esc(owned[0].username ?? 'Hibana user')}</b> — open tasks with deadlines: <b>${rows[0]?.n ?? 0}</b>.\nReminders: ${paused ? '⏸ paused (send /resume)' : '✅ on'}.`,
          'HTML',
        )
      }
      return c.json({ ok: true })
    }

    // /pause & /resume — suspend/resume bot reminders without unlinking (spec §5.17/§6.22;
    // §8 Q6 resolved: re-linking via /start <code> also resumes, and so does /resume).
    if (/^\/pause\b/i.test(text) || /^\/resume\b/i.test(text)) {
      const pause = /^\/pause\b/i.test(text)
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔗 You are not linked to a Hibana account yet. Link it first: Hibana Settings → Telegram → generate a code, then send /start <code> here.')
      } else {
        await cfg.db.execute('UPDATE users SET telegram_paused = ? WHERE id = ?', [pause ? 1 : 0, owned[0].id])
        await sendTelegramMessage(
          token,
          chatId,
          pause
            ? '⏸ Reminders paused — no deadline or progress alerts will arrive here. Send /resume to turn them back on (or generate a fresh code in Hibana Settings and /start it).'
            : '▶️ Reminders resumed — deadline and progress alerts will arrive here again.',
        )
      }
      return c.json({ ok: true })
    }

    // /reset — secondary password reset through the linked chat (spec §9). The chat being
    // LINKED is the authentication: only the account owner's linked chat can ever trigger it.
    // Issues the same one-time hashed token as the email path; delivery is via the bot.
    if (/^\/reset\b/i.test(text)) {
      if (owned.length === 0) {
        await sendTelegramMessage(token, chatId, '🔐 Your Telegram is not linked to a Hibana account yet. Link it first: Hibana Settings → Telegram → generate a code, then send /start <code> here.')
      } else {
        const resetToken = await createResetToken(cfg.db, owned[0].id)
        const link = `${requestOrigin(c)}/reset.html?token=${resetToken}`
        await sendTelegramMessage(token, chatId, `🔐 Password reset for your Hibana account:\n\n<a href="${link}">Set a new password →</a>\n\nThis link expires in 1 hour.`, 'HTML')
      }
      return c.json({ ok: true })
    }

    // Unlinked chat: nothing can be saved yet. Commands get the link-first instructions
    // (no junk captures); free text is captured for assignment once the account links (§4.10).
    if (owned.length === 0) {
      if (/^\//.test(text)) {
        await sendTelegramMessage(token, chatId, '🔗 Link your account first: Hibana Settings → Telegram → Generate link code, then send /start <code> here.')
        return c.json({ ok: true })
      }
      await cfg.db.execute(
        'INSERT INTO telegram_captures (id, user_id, raw_text, telegram_user_id, received_at, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
        [uuid(), text, String(msg.from.id), new Date().toISOString(), new Date().toISOString()],
      )
      await sendTelegramMessage(token, chatId, '📩 Idea captured. Link your account in Hibana Settings → Telegram: generate a code, then send /start <code> here.')
      return c.json({ ok: true })
    }

    const userId = owned[0].id

    // The one save path for Ideas (explicit /idea and the default plain-text capture).
    const captureIdea = async (raw: string): Promise<void> => {
      const id = uuid()
      const now = new Date().toISOString()
      await cfg.db.execute(
        'INSERT INTO telegram_captures (id, user_id, raw_text, telegram_user_id, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, userId, raw, String(msg.from.id), now, now],
      )
      await cfg.db.execute(
        "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'personal', 'spark', 0, 'Captured from Telegram', 0, ?, ?)",
        [id, userId, raw.slice(0, 120), raw, now, now],
      )
      const base = requestOrigin(c)
      // HTML parse mode: user text must be escaped — a raw "<" in the message used to make
      // Telegram reject the whole send (400) and silently lose the confirmation reply.
      await sendTelegramMessage(token, chatId, `📎 Captured:\n\n<b>${esc(raw)}</b>\n\n<a href="${base}/project.html?id=${id}">Open it in Hibana →</a>`, 'HTML')
    }

    if (!text) {
      await sendTelegramMessage(token, chatId, 'Send me a note, an idea, or /help — whatever is on your mind.')
      return c.json({ ok: true })
    }

    // /note <text> — a Quick Note on the dashboard notebook.
    const note = text.match(/^\/note\b([\s\S]*)/i)
    if (note) {
      const content = note[1].trim()
      if (!content) {
        await sendTelegramMessage(token, chatId, 'Usage: /note <text> — e.g. /note call mom')
        return c.json({ ok: true })
      }
      await createQuickNote(cfg.db, userId, content)
      const preview = content.length > 120 ? content.slice(0, 117) + '…' : content
      await sendTelegramMessage(token, chatId, `✅ Note added to your dashboard:\n\n<b>${esc(preview)}</b>`, 'HTML')
      return c.json({ ok: true })
    }

    // /idea <text> — explicit alias of the default capture.
    const idea = text.match(/^\/idea\b([\s\S]*)/i)
    if (idea) {
      const content = idea[1].trim()
      if (!content) {
        await sendTelegramMessage(token, chatId, 'Usage: /idea <text> — e.g. /idea redesign the landing page')
        return c.json({ ok: true })
      }
      await captureIdea(content)
      return c.json({ ok: true })
    }

    // /list — start (or join) a list session: items arrive one per message, /done saves.
    if (/^\/list$/.test(text)) {
      const items = await noteSession(cfg.db, userId)
      if (items) {
        await sendTelegramMessage(token, chatId, `List already collecting — ${items.length} item${items.length === 1 ? '' : 's'} so far. Send /done to save or /cancel to stop.`)
      } else {
        await saveNoteSession(cfg.db, userId, [])
        await sendTelegramMessage(token, chatId, '📋 List mode on — send the items, one per message. Send /done to save the list to your dashboard, or /cancel to stop.')
      }
      return c.json({ ok: true })
    }

    // /done — finalize the pending list into a dashboard list note.
    if (/^\/done$/.test(text)) {
      const items = await noteSession(cfg.db, userId)
      if (!items || items.length === 0) {
        await sendTelegramMessage(token, chatId, 'No active list — send /list first, then your items, then /done.')
        return c.json({ ok: true })
      }
      const count = await createListNote(cfg.db, userId, items)
      await sendTelegramMessage(token, chatId, `✅ List saved (${count} item${count === 1 ? '' : 's'}) — it is on your dashboard Quick Notebook.`)
      return c.json({ ok: true })
    }

    // /cancel — abandon the list session.
    if (/^\/cancel$/.test(text)) {
      const items = await noteSession(cfg.db, userId)
      await cfg.db.execute('DELETE FROM telegram_note_sessions WHERE user_id = ?', [userId])
      await sendTelegramMessage(token, chatId, items && items.length ? `List discarded (${items.length} item${items.length === 1 ? '' : 's'}).` : 'No active list.')
      return c.json({ ok: true })
    }

    // List session active + plain message → append the item(s) (lines split like the web UI).
    if (!/^\//.test(text)) {
      const session = await noteSession(cfg.db, userId)
      if (session) {
        const lines = text.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean)
        if (lines.length) {
          const total = session.length + lines.length
          if (total > LIST_MAX_ITEMS) {
            await sendTelegramMessage(token, chatId, `List is full (${LIST_MAX_ITEMS} items max) — send /done to save it.`)
            return c.json({ ok: true })
          }
          await saveNoteSession(cfg.db, userId, [...session, ...lines.map((l) => l.slice(0, ITEM_MAX_CHARS))])
          await sendTelegramMessage(token, chatId, `✓ ${total} item${total === 1 ? '' : 's'} so far — send more, or /done to save.`)
          return c.json({ ok: true })
        }
      }
    }

    // Unknown command → help pointer; anything else is an Idea.
    if (/^\//.test(text)) {
      await sendTelegramMessage(token, chatId, 'Unknown command — try /help to see what I can do.')
      return c.json({ ok: true })
    }
    await captureIdea(text)
    return c.json({ ok: true })
  })

  // Any authenticated user can link their own Telegram chat (§4.10): Settings shows a
  // one-time code; the user sends /start <code> to the bot. Codes expire after 1h and
  // generating a new one invalidates any previous unused code for the same account.
  app.get('/api/telegram/link-code', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    // 12 hex chars (48 bits, hardening 2026-08-28): the code links a chat to an account —
    // 8 hex chars was only ~4.3B guesses. Telegram's own flood limits make brute force
    // impractical either way, but doubling the entropy costs nothing.
    const code = uuid().replace(/-/g, '').slice(0, 12)
    await cfg.db.transaction(async (tx) => {
      tx.sql('DELETE FROM telegram_links WHERE created_at < ?', [new Date(Date.now() - LINK_CODE_TTL_MS).toISOString()]) // expired sweep
      tx.sql('DELETE FROM telegram_links WHERE user_id = ?', [user.id]) // one active code per account
      tx.sql('INSERT INTO telegram_links (code, user_id, created_at) VALUES (?, ?, ?)', [code, user.id, new Date().toISOString()])
    })
    return c.json({ ok: true, code })
  })

  // Authed status for Settings: is this account linked, and where is the bot?
  app.get('/api/telegram/status', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    return c.json({ ok: true, bot: TELEGRAM_BOT.handle, botUrl: TELEGRAM_BOT.url, linked: !!user.telegram_chat_id, chat_id: user.telegram_chat_id })
  })

  // Unlink: severs the chat mapping for this account. Captures already assigned stay —
  // they are account data now (rule 1); only the delivery channel is cut.
  app.delete('/api/telegram/link', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    await cfg.db.transaction(async (tx) => {
      tx.sql('UPDATE users SET telegram_chat_id = NULL WHERE id = ?', [user.id])
      tx.sql('DELETE FROM telegram_links WHERE user_id = ?', [user.id])
    })
    return c.json({ ok: true })
  })
}

// Obsidian bulk import (spec §9): exported .md files — or a .zip of the whole vault —
// become Ideas (H1 or filename as the title, tagged “Imported”). Re-importing the same
// notes is a no-op: a title that already exists (case-insensitive, per user) is skipped.
export function registerImport(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.post('/api/import/obsidian', requireAuth(cfg), async (c) => {
    const user = c.get('user')
    // Heavy-endpoint metering (hardening 2026-08-28): import inflates archives and writes
    // unbounded rows — 5 per minute per IP is generous for a real vault import.
    if (await hitRateLimit(cfg.db, RATE_RULES.import, clientIp(c))) {
      return c.json({ error: 'rate_limited', message: 'Too many imports — wait a minute and try again.' }, 429)
    }
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'invalid_input' }, 400)

    const allFiles = (form.getAll('files') as File[]).filter((f) => f && typeof f.arrayBuffer === 'function')
    const mdFiles = allFiles.filter((f) => /\.md$/i.test(f.name ?? ''))
    const zipFiles = allFiles.filter((f) => /\.zip$/i.test(f.name ?? ''))
    if (mdFiles.length === 0 && zipFiles.length === 0) {
      return c.json({ error: 'no_markdown_files', message: 'Attach .md files or a .zip of your exported notes.' }, 400)
    }
    // Request-shape caps (hardening 2026-08-28): bounded file count + total upload bytes,
    // enforced before anything is read into memory. 100MB matches Cloudflare's body cap.
    const MAX_FILES = 200
    const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
    if (allFiles.length > MAX_FILES) {
      return c.json({ error: 'too_many', message: `Attach at most ${MAX_FILES} files per import.` }, 400)
    }
    const totalBytes = allFiles.reduce((n, f) => n + (f.size ?? 0), 0)
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return c.json({ error: 'too_many', message: 'Import is limited to 100MB of uploads per request.' }, 413)
    }

    // rule 1: titles are scoped to this user; collect existing ones once for dedupe.
    const existing = await cfg.db.query<{ title: string }>("SELECT LOWER(title) AS title FROM projects WHERE user_id = ?", [user.id])
    const knownTitles = new Set(existing.map((r) => String(r.title).toLowerCase()))

    const notes: Array<{ fileName: string; content: string }> = []
    for (const file of mdFiles) notes.push({ fileName: file.name, content: await file.text() })
    for (const file of zipFiles) {
      try {
        notes.push(...markdownFromZip(new Uint8Array(await file.arrayBuffer())))
      } catch (err) {
        if (err instanceof ZipLimitError) {
          return c.json({ error: 'too_many', message: err.message }, 413)
        }
        return c.json({ error: 'invalid_zip', message: 'Could not read that .zip file — is it a valid archive?' }, 400)
      }
    }

    let count = 0
    let duplicates = 0
    for (const note of notes) {
      const parsed = parseMarkdownNote(note.fileName, note.content)
      if (!parsed) continue
      const key = parsed.title.toLowerCase()
      if (knownTitles.has(key)) {
        duplicates++
        continue
      }
      knownTitles.add(key)

      const id = uuid()
      const now = new Date().toISOString()
      await cfg.db.execute(
        "INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'personal', 'spark', 0, '', 0, ?, ?)",
        [id, user.id, parsed.title, parsed.description, now, now],
      )
      await cfg.db.transaction(async (tx) => {
        const tag = await cfg.db.query<{ id: string }>('SELECT id FROM tags WHERE user_id = ? AND name = ?', [user.id, 'Imported'])
        const tagId = tag.length ? tag[0].id : uuid()
        if (!tag.length) {
          tx.sql('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', [tagId, user.id, 'Imported', '#94a3b8', now])
        }
        tx.sql('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)', [id, tagId])
      })
      count++
    }
    return c.json({ ok: true, imported: count, duplicates })
  })
}