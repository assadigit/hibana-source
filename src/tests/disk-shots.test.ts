// S61: the local-disk shot store (HIBANA_SHOTS_DIR) — pins the ObjectStore contract
// (put → get roundtrip, get-throws-when-missing, delete-idempotent) and the path
// traversal refusal (unsafe keys can never escape the store root).
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diskShotsFromEnv, _safeKey } from '../services/disk-shots'

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hibana-diskshots-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('diskShotsFromEnv', () => {
  it('is disabled without HIBANA_SHOTS_DIR (Workers parity: unset = chain decides)', () => {
    expect(diskShotsFromEnv({})).toBeNull()
    expect(diskShotsFromEnv({ HIBANA_SHOTS_DIR: '' })).toBeNull()
  })

  it('put → get roundtrip with nested keys (the real key shape)', async () => {
    const store = diskShotsFromEnv({ HIBANA_SHOTS_DIR: root })!
    const b64 = Buffer.from('hello-shot-bytes').toString('base64')
    await store.putObject('user-abc/proj-123/screenshots/uuid-shot.png', b64, 'image/png')
    const back = await store.getObject('user-abc/proj-123/screenshots/uuid-shot.png')
    expect(Buffer.from(back).toString()).toBe('hello-shot-bytes')
  })

  it('getObject throws when missing (the R2 contract — callers translate to 404/500)', async () => {
    const store = diskShotsFromEnv({ HIBANA_SHOTS_DIR: root })!
    await expect(store.getObject('nope/never-existed.png')).rejects.toThrow()
  })

  it('deleteObject is idempotent', async () => {
    const store = diskShotsFromEnv({ HIBANA_SHOTS_DIR: root })!
    const key = 'u/p/screenshots/gone.png'
    await store.putObject(key, Buffer.from('x').toString('base64'), 'image/png')
    await store.deleteObject(key)
    await store.deleteObject(key) // second delete: not an error
    expect(existsSync(join(root, key))).toBe(false)
  })

  it('refuses traversal keys — nothing escapes the root', async () => {
    const store = diskShotsFromEnv({ HIBANA_SHOTS_DIR: root })!
    await expect(store.putObject('../escape.png', 'eHg=', 'image/png')).rejects.toThrow()
    await expect(store.putObject('a/../../escape.png', 'eHg=', 'image/png')).rejects.toThrow()
    await expect(store.putObject('/abs.png', 'eHg=', 'image/png')).rejects.toThrow()
    await expect(store.putObject('back\\slash.png', 'eHg=', 'image/png')).rejects.toThrow()
    await expect(store.getObject('../escape.png')).rejects.toThrow()
    // sanitized inputs must also never land outside
    expect(existsSync(join(root, '..', 'escape.png'))).toBe(false)
    // the sanitizer itself: the legit key shape passes
    expect(_safeKey('u1/p2/screenshots/id-shot.name.png')).toBe('u1/p2/screenshots/id-shot.name.png')
  })
})
