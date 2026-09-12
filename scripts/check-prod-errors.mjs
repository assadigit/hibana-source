// check-prod-errors.mjs — checks the prod D1 error_log for entries newer than a threshold.
// Run: node scripts/check-prod-errors.mjs [--since <ISO>]
// Default: checks for errors in the last 24h. Exits 1 if errors found.
//
// Can be wired into CI (post-deploy check) or run manually:
//   npm run check:prod-errors
//   node scripts/check-prod-errors.mjs --since 2026-09-11T00:00:00Z
//
// Reads .secrets.env for CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (never prints values).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Parse .secrets.env for Cloudflare creds (same pattern as scripts/lib.mjs)
function parseKeyValue(file) {
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

const secrets = parseKeyValue(join(ROOT, '.secrets.env'))
const accountId = secrets.CLOUDFLARE_ACCOUNT_ID
const apiToken = secrets.CLOUDFLARE_API_TOKEN

if (!accountId || !apiToken) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in .secrets.env')
  process.exit(1)
}

// Parse --since (default: 24h ago)
const sinceArg = process.argv.includes('--since') ? process.argv[process.argv.indexOf('--since') + 1] : null
const since = sinceArg ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()

// Query prod D1 error_log
const dbId = 'd842fcb5-44f6-4bbd-a772-3699ccadb496' // pm-app-prod
const sql = `SELECT count(*) AS n, max(created_at) AS latest, group_concat(DISTINCT path) AS paths FROM error_log WHERE created_at > '${since}';`

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  },
)

const data = await res.json()
if (!data.success) {
  console.error('D1 query failed:', data.errors)
  process.exit(1)
}

const row = data.result?.[0]?.results?.[0]
if (!row) {
  console.log('No error_log data returned')
  process.exit(1)
}

const count = Number(row.n)
const latest = row.latest
const paths = row.paths || '(none)'

console.log(`Prod error_log since ${since}:`)
console.log(`  count: ${count}`)
console.log(`  latest: ${latest || '(none)'}`)
console.log(`  paths: ${paths}`)

if (count > 0) {
  console.error(`\nFAIL: ${count} error(s) in prod error_log since ${since}`)
  process.exit(1)
}

console.log('\nPASS: no new prod errors')
process.exit(0)
