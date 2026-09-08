import { buildSnapshot, importAesKey, encryptBackup, bytesToBase64, SNAPSHOT_TABLES } from './backup'
import { sendTelegramDocument, deleteTelegramMessage, pinTelegramMessage, unpinAllTelegramMessages } from './telegram'
import { log } from '../lib/log'
import { uuid } from '../lib/ids'
import type { Db } from '../db/types'
import type { Config, PlanBBackupRow } from '../types'

// Plan B backup channel (docs/perf-and-data-safety.md §1) — the SECOND disaster-recovery
// path. Pushes the SAME buildSnapshot() output, encrypted with the SAME
// BACKUP_ENCRYPTION_KEY (same HIBENC1 blob format), as a Telegram document to an owner's
// linked chat. Telegram is a fully independent provider from Cloudflare + GitHub, stores
// messages indefinitely, and the bot infrastructure (token, linked chats) already exists.
//
// Session 14 (user request) — ON-DEMAND ONLY: the channel used to fire automatically on
// the 4×/day backup tick, which filled the owner's chat with backup documents ("a lot of
// backup notifications"). The automatic cron push is REMOVED (src/index.ts no longer
// calls it). A backup document is now sent ONLY when the owner explicitly asks for one:
//   - the 🗄 item in the bot's own ⚙ Settings keyboard (tap = one encrypted snapshot
//     delivered right away), or
//   - the owner-only admin route POST /api/admin/backup/planb (sends to every linked
//     owner chat — the manual drill trigger).
// No message is ever sent "after each backup" — the GitHub channel keeps running silently
// 4×/day and only FAILURES alert (email + direct bot message, unchanged).
//
// Design constraints carried over:
//   - reuse buildSnapshot + AES-GCM — no new format          → imports from backup.ts
//   - owner-scoped delivery                                   → callers gate on role='owner'
//   - NEVER store the key anywhere except the worker secret  → key only ever flows into crypto.subtle
//   - never plaintext to Telegram                             → refuses to run without the key

/** Keep the newest N Plan B documents per owner. 60 ≈ the old 15-days-at-4/day horizon;
 * on-demand sends are far rarer, so this simply bounds chat clutter. */
export const PLANB_RETENTION_DEFAULT = 60

export interface PlanBSendOutcome {
  /** true when the document landed in the chat. */
  ok: boolean
  /** Set on success: the Bot API message/document handles. */
  messageId?: number
  fileId?: string
  size?: number
  /** hex sha256 of the document content ('' on refusal). */
  sha256: string
  /** Refusal or failure reason (normal skips + errors — callers render it). */
  reason?: string
  /** Documents pruned by retention after this send (message ids). */
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

/**
 * Send ONE encrypted whole-DB snapshot as a Telegram document to ONE chat, on demand.
 * Gates (both return { ok:false, reason } without any network call):
 *   - the bot token must be configured;
 *   - BACKUP_ENCRYPTION_KEY must be set — this channel NEVER sends plaintext.
 * The isProd gate from the automatic era is deliberately GONE: the send only happens when
 * an owner explicitly taps (or calls the admin route), so a self-hosted deployment
 * answering its own tap is correct — the "indistinguishable automatic dev artifact"
 * hazard the gate guarded against no longer exists.
 * Caller responsibility: only invoke for role='owner' recipients (the snapshot holds
 * every user's rows — members must never receive it, even encrypted).
 */
export async function sendPlanBBackupToChat(cfg: Config, userId: string, chatId: string): Promise<PlanBSendOutcome> {
  const out: PlanBSendOutcome = { ok: false, sha256: '', pruned: [] }

  // Gate 1: the bot must be configured.
  if (!cfg.telegramToken) {
    out.reason = 'TELEGRAM_BOT_TOKEN not set'
    return out
  }
  // Gate 2: encryption is MANDATORY on this channel — never push plaintext to Telegram.
  if (!cfg.backupEncryptionKey) {
    out.reason = 'BACKUP_ENCRYPTION_KEY not set — Plan B refuses to send plaintext'
    log.warn('planb_skipped', { reason: 'no encryption key' })
    return out
  }

  // Build + encrypt (fresh IV — each send is a self-contained encrypted copy; same
  // plaintext as the GitHub push, same HIBENC1 format).
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

  try {
    // Send silently: this is a document the owner explicitly asked for, not an alert —
    // it must land without buzzing the phone.
    const res = await sendTelegramDocument(cfg.telegramToken, chatId, filename, docBytes, caption, true)
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
      [uuid(), userId, chatId, messageId, fileId, size, sha, snapshot.schema_version, exportedAt],
    )

    // Keep the newest backup pinned at the top of the chat (the disaster artifact
    // should be the first thing the owner sees when opening the chat). Best-effort.
    try {
      await unpinAllTelegramMessages(cfg.telegramToken, chatId)
      await pinTelegramMessage(cfg.telegramToken, chatId, messageId, true)
    } catch {
      /* pinning is cosmetic — a failed pin never fails the backup */
    }

    // Retention: prune old documents + their log rows (best-effort, safe direction).
    const pruned = await prunePlanB(cfg.db, cfg.telegramToken, userId, PLANB_RETENTION_DEFAULT)

    log.info('planb_sent', {
      userId,
      rows,
      bytes: docBytes.byteLength,
      sha256: sha.slice(0, 16) + '…',
      pruned: pruned.length,
      schemaVersion: snapshot.schema_version,
    })
    return { ok: true, messageId, fileId, size, sha256: sha, pruned }
  } catch (err) {
    out.reason = err instanceof Error ? err.message : String(err)
    log.error('planb_send_failed', {
      userId,
      err: err instanceof Error ? { message: err.message } : String(err),
    })
    return out
  }
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
