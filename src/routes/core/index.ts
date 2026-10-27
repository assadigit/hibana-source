// Core — route registration index (Phase 4 split from routes/core.ts).
//
// Purpose: ONE Hono app for every root-mounted route ('/' — Hono cannot chain
// sibling sub-apps at the same path, so everything root-mounted shares this
// instance). Registers hurdles → links → media → canvas in the original order
// and re-exports the shot-grid symbols detail-helpers.ts imports from '../core'.
//
// Public API: coreRoutes(cfg) + the shot-grid re-exports.
import { Hono } from 'hono'
import { requireAuth } from '../../auth/middleware'
import { registerCoreHurdles } from './hurdles'
import { registerCoreLinks } from './links'
import { registerCoreMedia } from './media'
import { registerCoreCanvas } from './canvas'
import type { Config, UserRow } from '../../types'

export { shotsGridHtml, shotDisplayName, shotFileTileHtml, shotTaskMap } from './shots-html'

export function coreRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow; reqId?: string } }>()
  app.use('*', requireAuth(cfg))
  registerCoreHurdles(app, cfg)
  registerCoreLinks(app, cfg)
  registerCoreMedia(app, cfg)
  registerCoreCanvas(app, cfg)
  return app
}
