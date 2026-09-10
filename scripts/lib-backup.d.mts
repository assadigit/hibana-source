// Type declarations for scripts/lib-backup.mjs (plain-node ESM, shared by every restore
// script and unit-tested from src/tests/backup-formats.test.ts — this file gives tsc
// the shapes without making the script itself TypeScript).

/** Raw bytes of a backup file, or a Buffer of them. */
export type BackupBytes = Uint8Array | Buffer

export type ParsedBackupFile =
  | { kind: 'encrypted'; bytes: Uint8Array }
  | { kind: 'plaintext-json'; text: string }
  | { kind: 'unknown'; head: string }

export const ENCRYPTED_MAGIC: string

export function base64ToBytes(b64: string): Uint8Array

export function parseBackupFile(raw: BackupBytes): ParsedBackupFile

export function decryptBackupBytes(bytes: Uint8Array, keyB64: string): Promise<string>
