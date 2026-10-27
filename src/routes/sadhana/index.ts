// Sadhana — route registration index (Phase 4 split from routes/sadhana.ts).
//
// Purpose: mounts the /api/sadhana namespace behind requireAuth and registers
// the route groups in their original registration order (quadrant surface →
// task lifecycle → notes/journal → archive; the only order-sensitive pair,
// POST /quadrants/reorder before POST /quadrants/:q, lives inside
// registerSadhanaQuadrants and keeps its order there).
//
// Public API: sadhanaRoutes(cfg) — called once from src/app.ts.
import { Hono } from 'hono'
import { requireAuth } from '../../auth/middleware'
import { registerSadhanaQuadrants } from './quadrants'
import { registerSadhanaTasks } from './tasks'
import { registerSadhanaNotes } from './notes'
import { registerSadhanaArchive } from './archive'
import type { Config, UserRow } from '../../types'

export function sadhanaRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))
  registerSadhanaQuadrants(app, cfg)
  registerSadhanaTasks(app, cfg)
  registerSadhanaNotes(app, cfg)
  registerSadhanaArchive(app, cfg)
  return app
}
