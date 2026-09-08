// Shared backup-file format detection + decryption for the whole restore toolchain
// (restore.mjs, restore-safe.mjs, restore-drill.mjs, restore-drill-planb.mjs).
//
// A Hibana backup file can arrive in TWO physical shapes that both wrap the SAME
// HIBENC1 encrypted blob (docs/perf-and-data-safety.md):
//   1. base64 TEXT — the Telegram Plan B documents, and what GitHub's Contents API
//      returns in its JSON "content" field. restore.mjs's original auto-detect shape.
//   2. RAW BINARY — what you get downloading a GitHub snapshot via its download_url or
//      the `Accept: application/vnd.github.v3.raw` header: the Contents API PUT decodes
//      the base64 payload we send before storing, so the repo file IS the raw blob.
//      (Found broken 2026-09-11: the runbook's documented download path fed shape 2
//      into a parser that only knew shape 1 → JSON.parse crashed on binary. Both
//      shapes decrypt to the same plaintext snapshot; this module accepts both.)
//   3. legacy plaintext JSON (pre-C3, starts with '{') — still accepted.
//
// Pure Node (node:crypto), no TypeScript imports — usable from plain-node scripts.

import { webcrypto } from 'node:crypto'

export const ENCRYPTED_MAGIC = 'HIBENC1'
const MAGIC_SEPARATOR = 0
const IV_BYTES = 12

const magicBytes = Buffer.from(ENCRYPTED_MAGIC, 'utf8')

/** Byte-wise prefix compare (Uint8Array has no .equals — Buffer does; this works for both). */
function startsWithMagic(bytes) {
  if (bytes.length < magicBytes.length) return false
  for (let i = 0; i < magicBytes.length; i++) if (bytes[i] !== magicBytes[i]) return false
  return true
}

/** Raw bytes start with "HIBENC1\x00" → an encrypted blob in binary form. */
function isEncryptedBinary(bytes) {
  return (
    bytes.length >= magicBytes.length + 1 + IV_BYTES + 16 &&
    startsWithMagic(bytes) &&
    bytes[magicBytes.length] === MAGIC_SEPARATOR
  )
}

/** base64 (standard + URL-safe, padding stripped) → Uint8Array. */
export function base64ToBytes(b64) {
  const cleaned = b64.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  return new Uint8Array(Buffer.from(cleaned, 'base64'))
}

/**
 * Classify a backup file's bytes.
 * @returns {{ kind: 'encrypted', bytes: Uint8Array }
 *          | { kind: 'plaintext-json', text: string }
 *          | { kind: 'unknown', head: string }}
 */
export function parseBackupFile(raw) {
  const bytes = Buffer.isBuffer(raw) ? new Uint8Array(raw) : raw
  // Shape 2: raw binary blob.
  if (isEncryptedBinary(bytes)) return { kind: 'encrypted', bytes }
  // Shape 3: legacy plaintext JSON.
  const text = Buffer.from(bytes).toString('utf8').trim()
  if (text.startsWith('{')) return { kind: 'plaintext-json', text }
  // Shape 1: base64 text that decodes to the binary blob.
  const decoded = Buffer.from(text, 'base64')
  if (isEncryptedBinary(new Uint8Array(decoded))) return { kind: 'encrypted', bytes: new Uint8Array(decoded) }
  return { kind: 'unknown', head: text.slice(0, 40) }
}

/**
 * Decrypt an encrypted blob (from parseBackupFile) with BACKUP_ENCRYPTION_KEY
 * (base64 32-byte key) → the plaintext JSON snapshot text.
 */
export async function decryptBackupBytes(bytes, keyB64) {
  const keyBytes = base64ToBytes(keyB64)
  if (keyBytes.byteLength !== 32) throw new Error(`BACKUP_ENCRYPTION_KEY must be 32 bytes, got ${keyBytes.byteLength}`)
  const iv = bytes.subarray(magicBytes.length + 1, magicBytes.length + 1 + IV_BYTES)
  const cipher = bytes.subarray(magicBytes.length + 1 + IV_BYTES)
  const key = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return Buffer.from(plain).toString('utf8')
}
