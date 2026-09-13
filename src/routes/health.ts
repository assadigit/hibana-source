import { Hono } from 'hono'
import type { Config, UserRow } from '../types'

// Public health endpoint (ROADMAP P2 — monitoring). Registered on the ROOT Hono app like
// the Telegram webhook: coreRoutes has a global requireAuth wildcard, and a health check
// must be reachable by an uptime monitor without a session. It exposes no user data — just
// app + DB liveness and the applied schema version, so drift or breakage is visible at a
// glance instead of silently rotting.

// Runtime difference: wrangler's D1 migrations are tracked in `d1_migrations`, the Node
// runner in `_migrations` (CLAUDE.md portability rule). Probe whichever exists.
async function schemaVersion(db: Config['db']): Promise<string | null> {
  for (const table of ['_migrations', 'd1_migrations']) {
    try {
      const rows = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)
      return String(rows[0]?.n ?? 0)
    } catch {
      // table doesn't exist on this runtime — try the other
    }
  }
  return null
}

export function registerHealth(app: Hono<{ Variables: { user: UserRow } }>, cfg: Config) {
  app.get('/api/health', async (c) => {
    // Monitors must never get a stale cached success (Cloudflare edge caches + SW precache).
    c.header('Cache-Control', 'no-store')

    let version: string | null = null
    try {
      await cfg.db.query('SELECT 1')
      version = await schemaVersion(cfg.db)
    } catch {
      return c.json({ ok: false, db: 'down', error: 'db_unreachable' }, 503)
    }

    return c.json({
      ok: true,
      service: 'hibana',
      environment: cfg.isProd ? 'prod' : 'dev',
      db: 'up',
      schema_version: version,
      // S38: which screenshot store is active — kv (Workers KV, the no-card default),
      // s3 (B2/R2 via R2_*), or github (the Contents-API fallback). Lets live probes
      // and the owner verify the storage wiring at a glance.
      storage: cfg.kv ? 'kv' : cfg.r2 ? 's3' : 'github',
      time: new Date().toISOString(),
    })
  })
}