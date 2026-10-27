// Notes Vault ownership + clock helpers (Phase 4 split from routes/vault.ts).
//
// Purpose: the four small db-scoped guards every vault route module shares —
// user-scoped folder/note lookups and the folder-subtree expansion — plus the
// ISO clock. Previously closures inside vaultRoutes; parameterized on db in the
// Phase 4 split (identical SQL, identical semantics).
//
// Public API: now, ownedFolder, subtreeIds, ownedNote.
import type { Db } from '../../db/types'
import type { NoteFolderRow, VaultNoteRow } from '../../types'

export const now = (): string => new Date().toISOString()

export const ownedFolder = async (db: Db, userId: string, id: string): Promise<NoteFolderRow | null> => {
  const rows = await db.query<NoteFolderRow>(
    'SELECT * FROM note_folders WHERE id = ? AND user_id = ?',
    [id, userId],
  )
  return rows.length ? rows[0] : null
}

/** All ids in the folder's subtree (the folder itself + every descendant) — the
 *  delete path unfiles notes in ALL of them, then removes the folders. */
export const subtreeIds = async (db: Db, userId: string, rootId: string): Promise<string[]> => {
  const all = await db.query<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM note_folders WHERE user_id = ?',
    [userId],
  )
  const out: string[] = []
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift()!
    if (out.includes(cur)) continue // cycle guard (shouldn't happen — moves check cycles)
    out.push(cur)
    for (const f of all) if (f.parent_id === cur) queue.push(f.id)
  }
  return out
}

export const ownedNote = async (db: Db, userId: string, id: string, includeDeleted = true): Promise<VaultNoteRow | null> => {
  const rows = await db.query<VaultNoteRow>(
    includeDeleted
      ? 'SELECT * FROM vault_notes WHERE id = ? AND user_id = ?'
      : 'SELECT * FROM vault_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    [id, userId],
  )
  return rows.length ? rows[0] : null
}
