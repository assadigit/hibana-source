// src/routes/devboard/index.ts — S257 (the Phase 6 split, AUDIT-REMEDIATION-SPEC §9):
// the former 1,511-line src/routes/devboard.ts monolith split by feature into six
// sub-routers, ALL mounted at '/' so every one of the 33 endpoint paths (the spec's
// "31" pre-dates S255's GET /api/sprints/:id/doc) stays byte-identical — the module
// resolution is the only thing that changed: app.ts's `import { devboardRoutes }
// from './routes/devboard'` now resolves here. The shared domain layer stays at
// src/routes/devboard-helpers.ts (its 3 importers untouched).
//
// Sub-routers (in the monolith's original section order):
//   board.ts      GET  /api/projects/:projectId/devboard (the one payload)
//   tasks.ts      devtasks CRUD + reorder + archive-done + tags + deps
//   sprints.ts    sprints CRUD + lifecycle + the doc read
//   strategies.ts strategies CRUD
//   archives.ts   archives GET/restore/delete (owns the shared snapshot fold)
//   misc.ts       categories quick-add + backlog + project tags + ping
//
// requireAuth runs ONCE here (app.use before every mount), exactly like the
// monolith's top-of-file middleware — the sub-routers carry no auth of their own.

import { Hono } from 'hono'
import { requireAuth } from '../../auth/middleware'
import type { Config, UserRow } from '../../types'
import { boardRoutes } from './board'
import { taskRoutes } from './tasks'
import { sprintRoutes } from './sprints'
import { strategyRoutes } from './strategies'
import { archiveRoutes } from './archives'
import { miscRoutes } from './misc'

export function devboardRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))
  app.route('/', boardRoutes(cfg))
  app.route('/', taskRoutes(cfg))
  app.route('/', sprintRoutes(cfg))
  app.route('/', strategyRoutes(cfg))
  app.route('/', archiveRoutes(cfg))
  app.route('/', miscRoutes(cfg))
  return app
}
