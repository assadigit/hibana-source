import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { applyMigrations } from '../src/db/migrate-node'

// npm run migrate:node — applies the same numbered migrations to local SQLite
// (non-Cloudflare deploys; structured data only, rule 4).
const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'hibana.db')
// A fresh checkout has no data dir yet — create it like server.ts does, so the
// documented “migrate then start” order works without a manual mkdir (rule 4).
if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true })
applyMigrations(dbPath, join(process.cwd(), 'migrations'))
console.log(`Migrations up to date. DB: ${dbPath}`)