import { githubClient, type GitHubClient, type GitHubConfig } from './github'
import type { Db } from '../db/types'

// Database protection (user priority). Full snapshot of every user-owned table, committed
// to the GitHub assets repo by a scheduled cron. Rule 8: users.password_hash is excluded
// and sessions is excluded entirely — credentials never touch git history.
// §15: the file carries schema_version so old snapshots stay interpretable after changes.
//
// C3 fix (2026-09-10): when BACKUP_ENCRYPTION_KEY is set, the snapshot is encrypted with
// AES-GCM (256-bit, 12-byte IV, GCM tag) BEFORE base64. The encrypted blob carries a
// magic prefix so restore auto-detects encrypted vs legacy plaintext. Without the key
// the app falls back to plaintext (dev/test convenience) — production MUST set the secret.

// Magic prefix for encrypted backups: lets restore.mjs auto-detect the format.
// Layout: b64( "HIBENC1" + 0x00 + IV(12 bytes) + ciphertext+tag )
const ENCRYPTED_MAGIC = 'HIBENC1'
const MAGIC_SEPARATOR = 0x00
const IV_BYTES = 12

/** Import a base64-encoded 32-byte key into a Web Crypto AES-GCM CryptoKey. */
async function importAesKey(b64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(b64Key)
  if (raw.byteLength !== 32) throw new Error(`BACKUP_ENCRYPTION_KEY must be 32 bytes (base64), got ${raw.byteLength}`)
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Encrypt UTF-8 plaintext bytes → returns the full encrypted blob (magic + separator + IV + ciphertext). */
async function encryptBackup(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource))
  // Assemble: magic string + 0x00 + IV + ciphertext (which includes the 16-byte GCM tag)
  const magicBytes = new TextEncoder().encode(ENCRYPTED_MAGIC)
  const out = new Uint8Array(magicBytes.length + 1 + iv.length + cipher.length)
  out.set(magicBytes, 0)
  out[magicBytes.length] = MAGIC_SEPARATOR
  out.set(iv, magicBytes.length + 1)
  out.set(cipher, magicBytes.length + 1 + iv.length)
  return out
}

/** Decrypt an encrypted blob back to UTF-8 plaintext bytes. */
export async function decryptBackup(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  const magicBytes = new TextEncoder().encode(ENCRYPTED_MAGIC)
  if (blob.length < magicBytes.length + 1 + IV_BYTES + 16) throw new Error('encrypted blob too short')
  const sepIdx = magicBytes.length
  const ivStart = sepIdx + 1
  const cipherStart = ivStart + IV_BYTES
  const iv = blob.subarray(ivStart, cipherStart)
  const cipher = blob.subarray(cipherStart)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource))
}

/** Does this decoded blob start with the encrypted magic prefix? */
export function isEncryptedBlob(bytes: Uint8Array): boolean {
  const magicBytes = new TextEncoder().encode(ENCRYPTED_MAGIC)
  if (bytes.length < magicBytes.length + 1) return false
  for (let i = 0; i < magicBytes.length; i++) {
    if (bytes[i] !== magicBytes[i]) return false
  }
  return bytes[magicBytes.length] === MAGIC_SEPARATOR
}

/** Decode a base64 string into bytes (handles standard + URL-safe, strips padding). */
function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const bin = atob(cleaned)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Every user-owned table + support tables. FTS virtual tables are excluded on purpose
// (they rebuild from triggers). Projects_fts/changelogs_fts carry no source data of their own.
// 2026-08-28: quick_notes + the sadhana board tables were silently missing here — the daily
// backup did not cover the notebook or the to-do board ("never lose an idea" tables). Added.
// Phase 5 (§15, 2026-09-09): spark_folders (idea folders) + the dev-board tables
// (dev_tasks, task_categories, sprints, backlog_docs, backlog_doc_revisions) joined the
// snapshot — the whole-DB shape change is what the version bump below marks.
// P2.5 (F-L14+F-L15, 2026-09-02): dropped 'password_resets' (transient — like sessions,
// which is already excluded) and 'changelogs' (dead table — feature removed per
// RECOVERED.md, table intentionally left in DB but carries no live data). Shrinks the
// snapshot and stops backing up throwaway/transient rows.
export const SNAPSHOT_TABLES = [
  'users', 'invites', 'spark_folders', 'projects', 'project_history_log', 'hurdles', 'tags', 'project_tags',
  'links', 'screenshots', 'tasks', 'payments', 'canvas_elements',
  'telegram_captures', 'telegram_links',
  'quick_notes', 'sadhana_tasks', 'sadhana_tags', 'sadhana_updates',
  'sadhana_recur_history', 'sadhana_quadrant_names',
  'dev_tasks', 'task_categories', 'sprints', 'backlog_docs', 'backlog_doc_revisions',
] as const

export interface Snapshot {
  schema_version: number
  exported_at: string
  data: Record<string, unknown[]>
}

export async function buildSnapshot(db: Db): Promise<Snapshot> {
  const data: Record<string, unknown[]> = {}
  for (const table of SNAPSHOT_TABLES) {
    const rows = await db.query(`SELECT * FROM ${table}`)
    if (table === 'users') {
      // Rule 8: never backup password hashes.
      data[table] = rows.map((r) => {
        const { password_hash: _drop, ...safe } = r
        return safe
      })
    } else {
      data[table] = rows
    }
  }
  return {
    schema_version: 20260910,
    // P2.5: bumped 20260909 -> 20260910 (snapshot shape changed: password_resets +
    // changelogs dropped from SNAPSHOT_TABLES). Old snapshots stay interpretable — the
    // restore script keys on table names present in the data, not on the table list.
    exported_at: new Date().toISOString(),
    data,
  }
}

// ---------------------------------------------------------------------------------
// Personal export scope (security fix 2026-08-28). GET /api/export?format=json used to
// call buildSnapshot() — the WHOLE-DB shape the owner's backup cron uses — which meant any
// authenticated member could download every other user's data under open registration.
// buildUserSnapshot() returns only the requesting user's rows:
//   - users: the user's own row (password_hash stripped, rule 8)
//   - user_id-scoped tables: WHERE user_id = ?
//   - project-scoped tables: WHERE project_id IN (the user's projects, soft-deleted included)
//   - sadhana-children: WHERE task_id IN (the user's sadhana tasks)
// Deliberately EXCLUDED from a personal export: invites + password_resets (platform/auth
// state, not user content), sessions (rule 8), email_verifications/rate_limits/
// telegram_note_sessions/sadhana_reminder_logs (transient server state).
// ---------------------------------------------------------------------------------

/** Tables scoped directly by user_id. */
const USER_SCOPED_EXPORT_TABLES = [
  'projects', 'spark_folders', 'tags', 'quick_notes', 'canvas_elements',
  'telegram_captures', 'telegram_links', 'sadhana_tasks', 'sadhana_quadrant_names',
] as const
/** Tables that scope through projects.project_id (the user's projects, incl. soft-deleted). */
const PROJECT_SCOPED_EXPORT_TABLES = [
  'project_history_log', 'hurdles', 'links', 'screenshots', 'changelogs',
  'tasks', 'payments', 'project_tags',
] as const
/** Tables that scope through sadhana_tasks.task_id. */
const SADHANA_CHILD_EXPORT_TABLES = [
  'sadhana_tags', 'sadhana_updates', 'sadhana_recur_history',
] as const

export async function buildUserSnapshot(db: Db, userId: string): Promise<Snapshot> {
  const data: Record<string, unknown[]> = {}

  // Own profile row, rule 8 applied.
  const users = await db.query('SELECT * FROM users WHERE id = ?', [userId])
  data.users = users.map((r) => {
    const { password_hash: _drop, ...safe } = r
    return safe
  })

  for (const table of USER_SCOPED_EXPORT_TABLES) {
    data[table] = await db.query(`SELECT * FROM ${table} WHERE user_id = ?`, [userId])
  }
  for (const table of PROJECT_SCOPED_EXPORT_TABLES) {
    data[table] = await db.query(
      `SELECT * FROM ${table} WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)`,
      [userId],
    )
  }
  for (const table of SADHANA_CHILD_EXPORT_TABLES) {
    data[table] = await db.query(
      `SELECT * FROM ${table} WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)`,
      [userId],
    )
  }

  return {
    // §15: the personal export shape was not touched by the Phase 5 bump — stays 20260828
    // (exactly as deployed; only the whole-DB snapshot got the new version).
    schema_version: 20260828,
    exported_at: new Date().toISOString(),
    data,
  }
}

export async function backupToGitHub(db: Db, gh: GitHubConfig, ownerUserId?: string, keepN = BACKUP_RETENTION_DEFAULT, encryptionKey?: string): Promise<{ path: string; url: string; retained: string[] }> {
  const snapshot = await buildSnapshot(db)
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `backups/snapshot-${ts}.json`
  const client = githubClient(gh)
  // btoa() throws on any codepoint above 0xFF — Persian content in the snapshot JSON
  // would kill the nightly backup. Encode to UTF-8 bytes and build the binary string in
  // 8k chunks (a spread String.fromCharCode on the whole array would blow the stack).
  //
  // C3 fix (2026-09-10): if an encryption key is configured, the UTF-8 bytes are
  // encrypted with AES-GCM before base64 — the GitHub repo never holds plaintext.
  // Without a key (dev/test) the behavior is unchanged (plaintext base64, auto-detected
  // by restore on read via the HIBENC1 magic prefix).
  const jsonBytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2))
  let bytesForBase64: Uint8Array = jsonBytes
  let encrypted = false
  if (encryptionKey) {
    const key = await importAesKey(encryptionKey)
    bytesForBase64 = await encryptBackup(key, jsonBytes)
    encrypted = true
  }
  let bin = ''
  for (let i = 0; i < bytesForBase64.length; i += 8192) bin += String.fromCharCode(...bytesForBase64.subarray(i, i + 8192))
  const b64 = btoa(bin)
  const pushed = await client.pushFile(path, b64, encrypted ? 'Hibana automated backup (encrypted)' : 'Hibana automated backup')
  const retained = await enforceRetention(client, keepN)
  return { path, url: pushed.html_url, retained }
}

// Backup retention (ROADMAP P2): snapshots accumulate daily forever; without cleanup the
// assets repo grows without bound. Keep only the newest N. Filenames carry ISO-8601 UTC
// timestamps, so lexicographic order == chronological order — "newest" is the highest name.
export const BACKUP_RETENTION_DEFAULT = 120 // 4×/day × 2 workers (dev+prod) = 8/day → 120 ≈ 15 days of snapshots

/** Pure convenience for tests/blob expectations: which snapshot files are older than the newest `keepN`? */
export function selectOldBackups(paths: string[], keepN: number): string[] {
  const n = Math.max(1, Math.floor(keepN))
  const snapshots = paths
    .filter((p) => p.split('/').pop()?.startsWith('snapshot-') && p.endsWith('.json'))
    .sort()
  return snapshots.slice(0, Math.max(0, snapshots.length - n))
}

/**
 * Best-effort prune of backups/snapshot-*.json beyond the newest `keepN`.
 * Never throws: a failed prune must never fail the backup itself — snapshots merely
 * accumulate until the next successful run (safe direction).
 */
export async function enforceRetention(gh: GitHubClient, keepN = BACKUP_RETENTION_DEFAULT): Promise<string[]> {
  const n = Math.max(1, Math.floor(keepN))
  let entries
  try {
    entries = await gh.listDir('backups')
  } catch {
    return [] // cannot list — skip pruning this run
  }
  const byName = entries
    .filter((e) => e.name.startsWith('snapshot-') && e.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
  const doomed = byName.slice(0, Math.max(0, byName.length - n))
  const deleted: string[] = []
  for (const entry of doomed) {
    try {
      await gh.deleteFile(entry.path, entry.sha)
      deleted.push(entry.path)
    } catch {
      // leave it; the next run tries again
    }
  }
  return deleted
}