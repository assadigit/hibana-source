// S61: local-disk screenshot store for the NODE server (HIBANA_SHOTS_DIR) — the same
// "explicit store wins, else kv → r2 → github" precedence, with a filesystem branch
// that exists ONLY on the Node path. Why: local dev / e2e had NO working shot storage
// (no KV binding, no R2 env, dummy GITHUB_TOKEN in the playwright env) — every
// screenshot upload 500'd locally, so the entire shot pipeline (upload → serve →
// gallery → delete → purge) was untestable off-Workers. This module imports node:fs
// and is imported ONLY by src/server.ts (the Node entry) — exactly the isolation
// pattern src/db/sqlite.ts uses; the Workers bundle never sees it.
//
// Contract (matches services/r2.ts ObjectStore):
//   putObject    throws on failure
//   getObject    throws when missing
//   deleteObject idempotent (missing = already gone, not an error)
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import type { ObjectStore } from './r2'

/** Defense in depth: keys are safe by construction (server-generated user/project ids +
 *  a filename regex that strips path separators), but the disk store REFUSES anything
 *  that could escape the root — traversal segments, absolute paths, backslashes, NULs. */
function safeKey(key: string): string | null {
  if (!key || key.includes('\0') || key.includes('\\')) return null
  const n = normalize(key)
  if (n.startsWith('..') || n.startsWith('/') || n.startsWith(sep)) return null
  if (n.split(sep).includes('..')) return null
  return n
}

export function diskShotsFromEnv(env: { HIBANA_SHOTS_DIR?: string }): ObjectStore | null {
  const root = env.HIBANA_SHOTS_DIR
  if (!root) return null
  return {
    async putObject(key, contentBase64) {
      const k = safeKey(key)
      if (!k) throw new Error(`disk store: refusing unsafe key ${JSON.stringify(key)}`)
      const file = join(root, k)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(contentBase64, 'base64'))
    },
    async getObject(key) {
      const k = safeKey(key)
      if (!k) throw new Error(`disk store: refusing unsafe key ${JSON.stringify(key)}`)
      const buf = readFileSync(join(root, k)) // throws ENOENT when missing — the contract
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return ab as ArrayBuffer
    },
    async deleteObject(key) {
      const k = safeKey(key)
      if (!k) return // nothing sane to delete — treat as gone
      try {
        unlinkSync(join(root, k))
      } catch {
        /* already gone — idempotent */
      }
    },
  }
}

/** Test seam: expose the sanitizer (pins the traversal refusal). */
export const _safeKey = safeKey
