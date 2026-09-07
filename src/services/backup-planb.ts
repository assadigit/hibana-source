import { buildSnapshot, importAesKey, encryptBackup, bytesToBase64, SNAPSHOT_TABLES } from './backup'
import { sendTelegramDocument, deleteTelegramMessage, pinTelegramMessage, unpinAllTelegramMessages } from './telegram'
import { log } from '../lib/log'
import { uuid } from '../lib/ids'
import type { Db } from '../db/types'
import type { Config, PlanBBackupRow, UserRow } from '../types'

// Plan B backup channel (docs/perf-and-data-safety.md §1) — the SECOND disaster-recovery
// path. On the same 4×/day tick as the GitHub backup, push the SAME buildSnapshot()
// output, encrypted with the SAME BACKUP_ENCRYPTION_KEY (same HIBENC1 blob format), as a
// Telegram document to every opted-in OWNER's linked chat. Telegram is a fully
// independent provider from Cloudflare + GitHub, stores messages indefinitely, and the
// bot infrastructure (token, linked chats) already exists — zero new secrets.
//
// Design constraints (session brief, all enforced here):
//   - reuse buildSnapshot + AES-GCM — no new format          → imports from backup.ts
//   - opt-in per user, owner-scoped                          → users.telegram_backup (0044), role='owner' only
//   - fires on the same 4× daily cron, separate failure domain → called from index.ts after scheduledBackup
//   - NEVER store the key anywhere except the worker secret  → key only ever flows into crypto.subtle
//   - never plaintext to Telegram                            → refuses to run without the key

/** Keep the newest N Plan B documents per opted-in owner. 60 ≈ 15 days at 4/day —
 * matches the GitHub channel's 15-day retention window so both channels cover the
 * same recovery horizon. */
export const PLANB_RETENTION_DEFAULT = 60

export interface PlanBResult {
  /** Owners that received a document this run. */
  sent: { userId: string; chatId: string; messageId: number; fileId: string; size: number; sha256: string }[]
  /** Why nothing was sent (normal reasons — logged, not errors). */
  skipped?: string
  /** Documents pruned by retention this run (message ids). */
  pruned: number[]
}

/** hex sha256 of some bytes — goes into the caption AND the planb_backups row, so the
 * manual restore path can verify integrity with zero D1/Cloudflare access. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  let hex = ''
  for (const b of digest) hex += b.toString(16).padStart(2, '0')
  return hex
}

export async function pushBackupToTelegram(cfg: Config): Promise<PlanBResult> {
  const out: PlanBResult = { sent: [], pruned: [] }

  // Gate 1: the bot must be configured.
  if (!cfg.telegramToken) {
    out.skipped = 'TELEGRAM_BOT_TOKEN not set'
    return out
  }
  // Gate 2: prod only. A dev-worker snapshot in the owner's chat is a restore hazard
  // (stale data indistinguishable from the prod artifact at a glance).
  if (!cfg.isProd) {
    out.skipped = 'Plan B is prod-only (dev snapshots stay on the GitHub channel)'
    return out
  }
  // Gate 3: encryption is MANDATORY on this channel — never push plaintext to Telegram.
  if (!cfg.backupEncryptionKey) {
    out.skipped = 'BACKUP_ENCRYPTION_KEY not set — Plan B refuses to send plaintext'
    log.warn('planb_skipped', { reason: 'no encryption key' })
    return out
  }

  // Opted-in owners with a linked chat (rule 1-ish: whole-DB snapshot, so the recipient
  // set is owners ONLY — see design doc §1.3(b)). telegram_paused does NOT gate this:
  // pausing reminder spam must never silently disable the disaster-recovery channel.
  const owners = await cfg.db.query<Pick<UserRow, 'id' | 'telegram_chat_id' | 'language_pref'>>(
    "SELECT id, telegram_chat_id, language_pref FROM users WHERE role = 'owner' AND telegram_backup = 1 AND telegram_chat_id IS NOT NULL",
  )
  if (owners.length === 0) {
    out.skipped = 'no opted-in owner with a linked Telegram chat'
    return out
  }

  // Build + encrypt ONCE per run (fresh IV — each channel stores its own self-contained
  // encrypted copy; same plaintext as the GitHub push, same HIBENC1 format).
  const snapshot = await buildSnapshot(cfg.db)
  const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot))
  const key = await importAesKey(cfg.backupEncryptionKey)
  const blob = await encryptBackup(key, jsonBytes)
  // The document content is the BASE64 TEXT of the encrypted blob — byte-identical to
  // what a GitHub snapshot file contains, so the exact same restore path handles both
  // (restore.mjs auto-detects HIBENC1 by content, not by filename).
  const docBytes = new TextEncoder().encode(bytesToBase64(blob))
  // sha256 over the DOCUMENT CONTENT (what you download): `sha256sum <file>` in the
  // manual path matches the caption without any base64/decode step.
  const sha = await sha256Hex(docBytes)
  const rows = Object.values(snapshot.data).reduce((n, r) => n + r.length, 0)
  const exportedAt = new Date().toISOString()
  // The name carries the UTC timestamp (rule 3) — lexicographically sortable in the chat.
  const filename = `hibana-backup-${exportedAt.replace(/[:.]/g, '-')}.bin`
  // Single line (multipart values must not carry raw newlines — '·' separators keep the
  // caption readable AND spec-clean). The sha256 is caption-carried ON PURPOSE: it makes
  // the manual restore path D1-independent (verify the downloaded .bin with sha256sum).
  const caption =
    `🗄 Hibana backup (Plan B) · schema ${snapshot.schema_version} · ${exportedAt.slice(11, 16)} UTC · ${rows.toLocaleString()} rows · ` +
    `sha256 ${sha} · AES-256-GCM · restore: docs/runbook.md §2b`

  for (const owner of owners) {
    try {
      // Send silently: 4×/day documents must never buzz the owner (03:17 local!).
      const res = await sendTelegramDocument(cfg.telegramToken, owner.telegram_chat_id!, filename, docBytes, caption, true)
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; result?: { message_id?: number; document?: { file_id?: string; file_size?: number } } }
        | null
      if (!res.ok || !body?.ok || !body.result?.message_id || !body.result.document?.file_id) {
        throw new Error(`sendDocument failed (HTTP ${res.status}${body && !body.ok ? `: ${JSON.stringify(body).slice(0, 200)}` : ''})`)
      }
      const messageId = body.result.message_id
      const fileId = body.result.document.file_id
      const size = body.result.document.file_size ?? docBytes.byteLength

      // Log row: powers the drill + retention. Never contains key material.
      await cfg.db.execute(
        'INSERT INTO planb_backups (id, user_id, chat_id, message_id, file_id, file_size, sha256, schema_version, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), owner.id, owner.telegram_chat_id!, messageId, fileId, size, sha, snapshot.schema_version, exportedAt],
      )
      out.sent.push({ userId: owner.id, chatId: owner.telegram_chat_id!, messageId, fileId, size, sha256: sha })

      // Keep the newest backup pinned at the top of the chat (the disaster artifact
      // should be the first thing the owner sees when opening the chat). Best-effort.
      try {
        await unpinAllTelegramMessages(cfg.telegramToken, owner.telegram_chat_id!)
        await pinTelegramMessage(cfg.telegramToken, owner.telegram_chat_id!, messageId, true)
      } catch {
        /* pinning is cosmetic — a failed pin never fails the backup */
      }

      // Retention: prune old documents + their log rows (best-effort, safe direction).
      const pruned = await prunePlanB(cfg.db, cfg.telegramToken, owner.id, PLANB_RETENTION_DEFAULT)
      out.pruned.push(...pruned)
    } catch (err) {
      // One owner's failure must not block the others or the overall run — but it IS
      // an error worth surfacing (a silent Plan B gap defeats the whole point).
      log.error('planb_send_failed', {
        userId: owner.id,
        err: err instanceof Error ? { message: err.message } : String(err),
      })
    }
  }

  log.info('planb_committed', {
    chats: out.sent.length,
    rows,
    bytes: docBytes.byteLength,
    sha256: sha.slice(0, 16) + '…',
    pruned: out.pruned.length,
    schemaVersion: snapshot.schema_version,
  })
  return out
}

/** Delete Plan B documents beyond the newest `keepN` for one owner (Telegram message +
 * log row). Best-effort: a failed deleteMessage leaves the older document in place
 * (safe direction — extra copies never hurt). Returns the pruned message ids. */
export async function prunePlanB(db: Db, token: string, userId: string, keepN = PLANB_RETENTION_DEFAULT): Promise<number[]> {
  const rows = await db.query<Pick<PlanBBackupRow, 'chat_id' | 'message_id'>>(
    'SELECT chat_id, message_id FROM planb_backups WHERE user_id = ? ORDER BY sent_at DESC, id DESC',
    [userId],
  )
  const doomed = rows.slice(Math.max(1, Math.floor(keepN)))
  const pruned: number[] = []
  for (const row of doomed) {
    try {
      await deleteTelegramMessage(token, row.chat_id, row.message_id)
      pruned.push(row.message_id)
    } catch {
      // Telegram refused (message already gone / chat changed) — still drop the log row
      // so it stops retrying forever; the document itself is already unreachable.
    }
    await db.execute('DELETE FROM planb_backups WHERE user_id = ? AND message_id = ?', [userId, row.message_id])
  }
  return pruned
}

/** How many snapshot tables the Plan B blob covers — exposed for the drill/tests to
 * sanity-check that the channel snapshots the same shape as the GitHub channel. */
export const PLANB_SNAPSHOT_TABLE_COUNT = SNAPSHOT_TABLES.length
