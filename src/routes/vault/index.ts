// Notes Vault — route registration index (Phase 4 split from routes/vault.ts).
//
// Purpose: mounts the /api/vault/* namespace (folders+bootstrap → notes → imports,
// the original registration order) behind requireAuth, and re-exports the helpers
// the test suite imports directly (excerptOf/wordCount/VaultNoteCard) so
// `from '../routes/vault'` keeps resolving after the split.
//
// Public API: vaultRoutes(cfg) + re-exports.
import { Hono } from 'hono'
import { requireAuth } from '../../auth/middleware'
import { registerVaultFolders } from './folders'
import { registerVaultNotes } from './notes'
import { registerVaultImports } from './imports'
import type { Config, UserRow } from '../../types'

export { excerptOf, wordCount, type VaultNoteCard } from './helpers'

export function vaultRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))
  registerVaultFolders(app, cfg)
  registerVaultNotes(app, cfg)
  registerVaultImports(app, cfg)
  return app
}
