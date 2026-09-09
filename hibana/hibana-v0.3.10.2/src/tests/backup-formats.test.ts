import { describe, it, expect } from 'vitest'
import { encryptBackup, importAesKey } from '../services/backup'
// Plain-node ESM module (no TS) — vitest imports it fine; it powers every restore script.
import { parseBackupFile, decryptBackupBytes } from '../../scripts/lib-backup.mjs'

// Backup file format shapes (scripts/lib-backup.mjs). Found broken 2026-09-11: the
// GitHub Contents API decodes the base64 PUT before storing, so the repo file is the
// RAW BINARY blob — and restore.mjs only auto-detected the base64-TEXT shape, so the
// documented runbook download path crashed JSON.parse. These tests pin BOTH shapes.

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')

async function makeBlob() {
  const snapshot = JSON.stringify({ schema_version: 20260910, data: { projects: [{ id: 'p1', title: 'تست' }] } })
  const key = await importAesKey(KEY)
  return await encryptBackup(key, new TextEncoder().encode(snapshot))
}

describe('backup file format detection (scripts/lib-backup.mjs)', () => {
  it('raw-binary HIBENC1 file → encrypted + decrypts (the GitHub download_url shape)', async () => {
    const blob = await makeBlob()
    const parsed = parseBackupFile(new Uint8Array(blob))
    expect(parsed.kind).toBe('encrypted')
    if (parsed.kind !== 'encrypted') return
    const json = await decryptBackupBytes(parsed.bytes, KEY)
    const snapshot = JSON.parse(json)
    expect(snapshot.schema_version).toBe(20260910)
    expect(snapshot.data.projects[0].title).toBe('تست')
  })

  it('base64-text HIBENC1 file → encrypted + decrypts (the Telegram Plan B / GitHub JSON content shape)', async () => {
    const blob = await makeBlob()
    const textBytes = new TextEncoder().encode(Buffer.from(blob).toString('base64'))
    const parsed = parseBackupFile(textBytes)
    expect(parsed.kind).toBe('encrypted')
    if (parsed.kind !== 'encrypted') return
    const json = await decryptBackupBytes(parsed.bytes, KEY)
    expect(JSON.parse(json).data.projects).toHaveLength(1)
  })

  it('legacy plaintext JSON snapshot → plaintext-json', () => {
    const parsed = parseBackupFile(new TextEncoder().encode('{"schema_version":1,"data":{}}'))
    expect(parsed.kind).toBe('plaintext-json')
    if (parsed.kind === 'plaintext-json') expect(parsed.text.startsWith('{')).toBe(true)
  })

  it('garbage → unknown (never misdetected as encrypted)', () => {
    expect(parseBackupFile(new TextEncoder().encode('SElCRU5DMQAA-not-actually-a-backup')).kind).toBe('unknown')
    expect(parseBackupFile(new Uint8Array(4)).kind).toBe('unknown')
  })

  it('wrong key length is rejected loudly', async () => {
    const blob = await makeBlob()
    const parsed = parseBackupFile(new Uint8Array(blob))
    if (parsed.kind !== 'encrypted') throw new Error('expected encrypted')
    await expect(decryptBackupBytes(parsed.bytes, 'short-key')).rejects.toThrow(/32 bytes/)
  })
})
