// S39: ONE shared constructor for the screenshots object store, extracted from the
// inline chain core.ts carried since S35 — the project hard-delete + the 7-day purge
// cron now clean remote bytes through the EXACT same precedence the routes use
// (kv → r2 → github), instead of orphaning objects in the bucket when a project dies.
import type { Config } from '../types'
import { queryIn } from '../lib/inchunk'
import { log } from '../lib/log'
import { githubClient, type GitHubConfig } from './github'
import { r2Storage, type ObjectStore } from './r2'
import { kvStorage } from './kv'

export function shotStoreFor(cfg: Config): ObjectStore {
  // S61: an explicitly-wired store (Node disk store via HIBANA_SHOTS_DIR) overrides
  // the whole chain — local dev + e2e get a real, working shot pipeline off-Workers.
  if (cfg.objectStore) return cfg.objectStore
  if (cfg.kv) return kvStorage(cfg.kv)
  if (cfg.r2) return r2Storage(cfg.r2)
  return {
    putObject: async (key: string, contentB64: string, _ct: string) => { await githubClient(cfg.github as GitHubConfig).pushFile(key, contentB64, 'Screenshot upload') },
    getObject: async (key: string) => githubClient(cfg.github as GitHubConfig).readBinary(key),
    deleteObject: async (key: string) => { try { await githubClient(cfg.github as GitHubConfig).deleteFile(key) } catch { /* already gone */ } },
  }
}

/** S39: best-effort cleanup of a project's screenshot objects in the remote store —
 *  called BEFORE the rows cascade away (project hard-delete + the 7-day purge).
 *  Until now those paths dropped the screenshots ROWS (FK cascade) but left the
 *  BYTES in KV/GitHub forever: invisible orphans the media gallery could never
 *  offer for deletion. Never throws — orphaned bytes are a space leak, never a
 *  data-loss risk (the rows are going away either way). */
export async function purgeShotBytes(cfg: Config, projectIds: string[]): Promise<void> {
  if (!projectIds.length) return
  try {
    // AP-20: chunked — a full purge (account wipe / owner purge-all) can exceed 99
    // projects (D1 param cap); the old single IN silently failed there and orphaned bytes.
    const rows = await queryIn<{ github_path: string }>(
      cfg.db,
      'SELECT github_path FROM screenshots WHERE project_id IN {{IN}}',
      [],
      projectIds,
    )
    if (!rows.length) return
    const store = shotStoreFor(cfg)
    // S69: each shot's .thumb tile sibling rides along — a purged project must not
    // leave orphaned grid tiles in the bucket either.
    await Promise.allSettled(rows.flatMap((r) => [store.deleteObject(r.github_path), store.deleteObject(`${r.github_path}.thumb`)]))
  } catch (err) {
    // Never throw — orphaned bytes are a space leak, never a data-loss risk (the rows
    // are going away either way). But AP-20: log it — a silent failure here used to
    // leave orphans with zero signal.
    log.warn('shotstore_purge_failed', { err: err instanceof Error ? err.message : String(err), hint: 'bytes may orphan' })
  }
}
