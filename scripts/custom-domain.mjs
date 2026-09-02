// Attach/verify a Worker custom domain via the Cloudflare API.
// Wrangler 4 no longer honours the `custom_domains` key in wrangler.toml (it warns
// "Unexpected fields found ... custom_domains"), so custom domains must be added via the
// Cloudflare API/dashboard. This script does it with the stored OAuth token (never printed).
//
// Usage:
//   node scripts/custom-domain.mjs                  # list current worker custom domains
//   node scripts/custom-domain.mjs add <host>       # attach <host> to the prod worker
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ACCOUNT = '6ff25b582afd399d647e91a8db859676' // Aliassadi@live.com's Account
const ZONE_ID = '084061b09720c0506f4538e740377c4b' // hibana.ir zone
const SERVICE = 'hibana-prod'
const ENV = 'production'

function oauthToken() {
  const cands = [
    join(homedir(), '.wrangler', 'config', 'default.toml'),
    join(homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml'),
  ]
  for (const p of cands) {
    try {
      const t = readFileSync(p, 'utf8')
      const m = t.match(/oauth_token\s*=\s*["']?([A-Za-z0-9_.-]+)["']?/)
      if (m) return m[1]
    } catch {}
  }
  return null
}

const token = oauthToken()
if (!token) {
  console.error('No wrangler OAuth token found — run `npx wrangler login` first.')
  process.exit(1)
}
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/domains`

async function list() {
  const r = await fetch(base, { headers }).then((x) => x.json())
  if (!r.success) return console.log('list failed:', JSON.stringify(r.errors))
  const doms = r.result ?? []
  if (doms.length === 0) return console.log('worker custom domains: none')
  for (const d of doms) console.log(`  ${d.hostname} -> ${d.service} (${d.environment})`)
}

async function add(host) {
  const body = { hostname: host, service: SERVICE, environment: ENV, zone_id: ZONE_ID }
  const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) }).then((x) => x.json())
  if (r.success) {
    console.log(`added ${host} -> ${SERVICE} (${ENV})`)
    console.log(`  status: ${r.result?.status}  cert: ${r.result?.certificate_status ?? 'n/a'}`)
  } else {
    console.log('add failed:', JSON.stringify(r.errors))
  }
}

const cmd = process.argv[2]
const host = process.argv[3] ?? 'hibana.ir'
if (cmd === 'add') await add(host)
else await list()
