import { serve } from '@hono/node-server'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createApp } from './app'
import { createSqliteDb } from './db/sqlite'
import { applyMigrations } from './db/migrate-node'
import { r2ConfigFromEnv } from './services/r2'
import { kvRestConfigFromEnv } from './services/kv'
import { diskShotsFromEnv } from './services/disk-shots'
import type { Config } from './types'

// Non-Cloudflare deployment path (portability requirement — "deployment must be easily
// changeable"). Same Hono app, same SQL, same migrations; only wheels are swapped:
// D1 → better-sqlite3, Worker assets → plain file serving.
// Run: DB_PATH=... GITHUB_* env vars npm run start:node  (see DEPLOY.md)

const workDir = process.cwd()
const dbPath = process.env.DB_PATH ?? join(workDir, 'data', 'hibana.db')
const dataDir = join(workDir, 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
applyMigrations(dbPath, join(workDir, 'migrations')) // rule 4: same numbered files as CF

const publicDir = join(workDir, 'public')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
}

// Perf audit 2026-08-25: the node path served raw bytes with no Cache-Control — 3-4× the
// wire size of the Cloudflare path (which brotli-compresses) and a full re-fetch on every
// repeat view. Mirrors the prod _headers policy: html no-store, app code 1h+SWR,
// vendor/images/fonts 1d+SWR. Raw+gzip are cached per file and re-read on mtime change.
const COMPRESSIBLE = /\.(?:html|css|js|json|svg|webmanifest|txt)$/
const staticCache = new Map<string, { mtimeMs: number; raw: Buffer; gz: Buffer | null }>()

function cacheControlFor(rel: string): string {
  if (rel.endsWith('.html') || rel === 'index.html') return 'no-store'
  // S69 (perf §10-B): /dist files are CONTENT-HASHED by scripts/build.mjs — a different
  // byte is always a different URL. Parity with the prod _headers rule (immutable, 1y):
  // the old 3600+SWR fallback made local perf runs revalidate hashed bundles every hour
  // for no possible change. manifest.json stays revalidating (the one mutable dist file).
  if (rel === 'dist/manifest.json') return 'no-cache'
  if (rel.startsWith('dist/') && /\.[0-9a-f]{8}\.(?:js|css)$/.test(rel)) return 'public, max-age=31536000, immutable'
  if (rel === 'sw.js') return 'no-cache' // S69: SW updates must be detectable immediately (reg.update() honors max-age)
  if (rel.startsWith('vendor/') || /\.(?:png|jpe?g|svg|webp|ico|woff2?|webmanifest)$/.test(rel))
    return 'public, max-age=86400, stale-while-revalidate=604800'
  return 'public, max-age=3600, stale-while-revalidate=86400' // app css/js
}

function serveFile(url: URL, req?: Request): Promise<Response> {
  const pathname = decodeURIComponent(url.pathname)
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = join(publicDir, rel)
  if (file !== publicDir && !file.startsWith(publicDir + sep)) {
    return Promise.resolve(new Response('Forbidden', { status: 403 })) // path traversal guard
  }
  let st
  try {
    st = statSync(file)
  } catch {
    return Promise.resolve(new Response('Not Found', { status: 404 }))
  }
  if (st.isDirectory()) return Promise.resolve(new Response('Not Found', { status: 404 }))
  let entry = staticCache.get(file)
  if (!entry || entry.mtimeMs !== st.mtimeMs) {
    const raw = readFileSync(file)
    entry = { mtimeMs: st.mtimeMs, raw, gz: COMPRESSIBLE.test(rel) && raw.length > 1024 ? gzipSync(raw) : null }
    staticCache.set(file, entry)
  }
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cacheControlFor(rel),
  }
  // Buffer is a valid body at runtime; workers-types' BodyInit overload resolution
  // rejects the ArrayBufferLike generic, hence the narrow cast.
  const bodyOf = (b: Buffer): BodyInit => b as unknown as BodyInit
  if (entry.gz && /\bgzip\b/.test(req?.headers.get('accept-encoding') ?? '')) {
    headers['Content-Encoding'] = 'gzip'
    return Promise.resolve(new Response(bodyOf(entry.gz), { headers }))
  }
  return Promise.resolve(new Response(bodyOf(entry.raw), { headers }))
}

const cfg: Config = {
  db: createSqliteDb(dbPath),
  isProd: process.env.NODE_ENV === 'production',
  // S49-b6: canonical origin for cron/email/ICS deep links (env APP_URL — set it to
  // wherever this Node instance is reachable, e.g. https://my-host.example).
  appUrl: process.env.APP_URL,
  github: {
    owner: process.env.GITHUB_OWNER ?? '',
    repo: process.env.GITHUB_REPO ?? 'pm-app-assets',
    token: process.env.GITHUB_TOKEN,
  },
  // S38: Workers KV screenshot storage (free 1 GB, no card — see services/kv.ts).
  // REST mode via KV_ACCOUNT_ID/KV_NAMESPACE_ID/KV_API_TOKEN; unset = the r2/GitHub
  // chain decides. Storage precedence: kv → r2 → GitHub.
  kv: kvRestConfigFromEnv(process.env) ?? undefined,
  // S35: optional S3/R2 screenshot storage (see services/r2.ts) — unset = GitHub.
  r2: r2ConfigFromEnv(process.env) ?? undefined,
  // S61: HIBANA_SHOTS_DIR — a local-disk object store that overrides the whole chain
  // (local dev + e2e had no working shot storage off-Workers: dummy GitHub creds →
  // every upload 500'd). Node-only module; the Workers entry never sets this field.
  objectStore: diskShotsFromEnv(process.env) ?? undefined,
  emailKey: process.env.RESEND_KEY,
  ownerEmail: process.env.OWNER_EMAIL ?? '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramSecret: process.env.TELEGRAM_SECRET ?? '',
  captchaSecretKey: process.env.CAPTCHA_SECRET_KEY ?? process.env.TURNSTILE_SECRET_KEY,
  // math captcha — Turnstile secret kept as legacy fallback
  openRegistration: process.env.OPEN_REGISTRATION === 'true',
  backupEncryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
  // Mirror origins for the CSRF gate (docs/edge-mirror.md) — same parsing as the Worker entry.
  mirrorOrigins: (process.env.MIRROR_ORIGIN ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((o) => o.replace(/\/+$/, '')),
  assets: serveFile,
}

const app = createApp(cfg)

// Dev resilience: surface any uncaught failure to the log instead of dying silently
// (a detached local Node instance that vanished between requests was impossible to debug
// without this). These never run on the Workers path (src/index.ts is the Worker entry).
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err?.stack || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason)
})

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
  console.log(`Hibana (Node) listening on http://localhost:${info.port} — db: ${dbPath}`)
})