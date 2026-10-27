// Core — scoped child-record ownership (Phase 4 split from routes/core.ts).
//
// Purpose: the fixed-allowlist child-table lookup (hurdles/links/screenshots)
// proving a record belongs to a project that belongs to the user (rule 1).
//
// Public API: ownedProjectId.
import type { Config } from '../../types'

/** Scoped child lookup: row must belong to a project that belongs to the user (rule 1). */
// Phase 0 hardening: the table name is interpolated into SQL, so it MUST come from a fixed
// allowlist — never a caller-supplied string. Unknown tables throw (defensive fail-closed),
// which keeps this query-injection-shaped pattern from ever becoming a real vector.
const CHILD_TABLES = new Set(['hurdles', 'links', 'screenshots'])
function assertChildTable(table: string): void {
  if (!CHILD_TABLES.has(table)) throw new Error(`blocked child-table lookup: ${table}`)
}

export async function ownedProjectId(cfg: Config, userId: string, table: string, recordId: string): Promise<string | null> {
  assertChildTable(table)
  const rows = await cfg.db.query<{ project_id: string }>(
    `SELECT project_id FROM ${table} WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL)`,
    [recordId, userId],
  )
  return rows.length ? rows[0].project_id : null
}
