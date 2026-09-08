#!/usr/bin/env node
// Pre-migration Time Travel bookmark (dr-integrity session — ritual documented in Changelogs.md §4+§9).
// Run via `npm run bookmark:prod` (or bookmark:dev) BEFORE applying migrations or any
// other risky change to the database.
//
// What it does (all read-only except appending one line to Changelogs.md §9 — the
// bookmark log, which must stay the LAST section of that file):
//   1. `wrangler d1 time-travel info <db> --json` → a bookmark = a named, restorable
//      point-in-time for RIGHT NOW (instant, no data copied — it's an entry in D1's
//      continuous undo log).
//   2. Reads the current schema version (number of applied migrations) via the D1 REST
//      API so the record says what state the bookmark captures.
//   3. Appends one line to Changelogs.md (repo root, §9 bookmark log): UTC time · bookmark id ·
//      schema version · reason. Bookmark IDs are NOT secrets.
//
// Why: `wrangler d1 time-travel restore` is the fastest, non-snapshot recovery path for
// a bad migration or logical corruption (minute-granularity, in-place, no file handling,
// works even if no snapshot was taken) — but it is DESTRUCTIVE to current state and the
// operator needs a bookmark to restore to when things go wrong 10 minutes later.
// This script is the ritual: bookmark first, migrate second.
//
// Required env (.secrets.env or process env): CLOUDFLARE_API_TOKEN,
// CLOUDFLARE_ACCOUNT_ID (defaults to the Hibana account).

import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secrets } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const LOG_PATH = join(root, 'Changelogs.md')

const DEV = process.argv.includes('--dev')
const DB_NAME = DEV ? 'pm-app-dev' : 'pm-app-prod'
const PROD_DB_ID = 'd842fcb5-44f6-4bbd-a772-3699ccadb496'
const DEV_DB_ID = '80e02ce2-ca0a-4ccc-beda-8b6cb9c3a984'
const DB_ID = DEV ? DEV_DB_ID : PROD_DB_ID

const s = secrets()
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? s.CLOUDFLARE_API_TOKEN
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? s.CLOUDFLARE_ACCOUNT_ID ?? '6ff25b582afd399d647e91a8db859676'

// Optional --reason "apply 0046" (default: 'manual bookmark'). Last occurrence wins so
// `npm run bookmark:prod -- --reason "..."` overrides the npm script's own default.
const reasonIdx = process.argv.lastIndexOf('--reason')
const reason = reasonIdx !== -1 ? process.argv[reasonIdx + 1] : 'manual bookmark'

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

if (!CF_TOKEN) fail('CLOUDFLARE_API_TOKEN not set (put it in .secrets.env or export it)')

// ─── 1. Create the bookmark (wrangler reads CLOUDFLARE_API_TOKEN from env) ───
console.log(`Creating Time Travel bookmark on ${DB_NAME} …`)
let bookmark
try {
  const out = execFileSync('npx', ['wrangler', 'd1', 'time-travel', 'info', DB_NAME, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT },
    timeout: 60_000,
  })
  // wrangler --json prints only JSON on stdout (warnings go to stderr); tolerate
  // surrounding noise by extracting the {...} block.
  const m = out.match(/\{[\s\S]*\}/)
  bookmark = m ? JSON.parse(m[0]).bookmark : null
} catch (err) {
  fail(`wrangler d1 time-travel info failed: ${err instanceof Error ? err.message : String(err)}`)
}
if (!bookmark) fail('could not parse a bookmark id from wrangler output')

// ─── 2. Current schema version (D1 REST, read-only) ─────────────────────────
let schemaVersion = '?'
try {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${DB_ID}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT count(*) AS n FROM d1_migrations' }),
    },
  )
  const body = await res.json().catch(() => null)
  if (res.ok && body?.success) {
    schemaVersion = String(body.result?.[0]?.results?.[0]?.n ?? '?')
  }
} catch {
  // Non-fatal: the bookmark itself is the artifact; the version is context.
}

// ─── 3. Append the operational record ───────────────────────────────────────
const ts = new Date().toISOString()
if (!existsSync(LOG_PATH)) {
  appendFileSync(
    LOG_PATH,
    [
      '# Hibana — D1 Time Travel bookmark log (operational)',
      '',
      'One line per bookmark, newest last. Created by `npm run bookmark:prod` / `bookmark:dev`',
      '(scripts/pre-migrate-bookmark.mjs) — the pre-migration ritual from Changelogs.md §4.',
      'Restore with: `npx wrangler d1 time-travel restore <db> --bookmark <id>` (Changelogs.md §9',
      '— restore is in-place and destructive to current state).',
      '',
      '| UTC timestamp | database | schema | bookmark id | reason |',
      '|---|---|---|---|---|',
      '',
    ].join('\n'),
  )
}
appendFileSync(LOG_PATH, `| ${ts} | ${DB_NAME} | ${schemaVersion} | ${bookmark} | ${reason} |\n`)

console.log('')
console.log(`✓ Bookmark created:  ${bookmark}`)
console.log(`  Database:          ${DB_NAME} (schema ${schemaVersion})`)
console.log(`  Time (UTC):        ${ts}`)
console.log(`  Reason:            ${reason}`)
console.log(`  Recorded in:       Changelogs.md §9 (bookmark log — keep it the last section)`)  // v0.3.9.2: was dr-bookmarks.md
console.log('')
console.log('If this change goes wrong, restore with:')
console.log(`  npx wrangler d1 time-travel restore ${DB_NAME} --bookmark ${bookmark}`)
console.log('  (in-place restore — see Changelogs.md §9)')
