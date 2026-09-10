// Reads the zone status for hibana.ir from the Cloudflare API using the wrangler-saved
// OAuth token (never printed). Prints only zone meta (id/status/nameservers) + guidance.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function getOAuthToken() {
  const base = process.env.WRANGLER_HOME
  const candidates = [
    join(homedir(), '.wrangler', 'config', 'default.toml'),
    join(homedir(), 'AppData', 'Roaming', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    base ? join(base, 'config', 'default.toml') : null,
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      const txt = readFileSync(p, 'utf8')
      const m = txt.match(/oauth_token\s*=\s*["']?([A-Za-z0-9_.-]+)["']?/)
      if (m) return m[1]
      const m2 = txt.match(/api_token\s*=\s*["']?([A-Za-z0-9_.-]+)["']?/)
      if (m2) return m2[1]
    } catch {
      /* next */
    }
  }
  return null
}

const token = getOAuthToken()
if (!token) {
  console.error('No wrangler OAuth/api token found — run `npx wrangler login` first.')
  process.exit(1)
}

const ACCOUNT_ID = '6ff25b582afd399d647e91a8db859676' // Aliassadi@live.com's Account

const list = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json())

const zones = (list?.result ?? []).filter((z) => z.name === 'hibana.ir')
if (zones.length === 0) {
  console.log('No hibana.ir zone found in this account yet.')
} else {
  for (const z of zones) {
    console.log(`zone: ${z.name}`)
    console.log(`  id        : ${z.id}`)
    console.log(`  status    : ${z.status}   (active = ready to serve)`)
    console.log(`  namesrv   : ${(z.name_servers ?? []).join(', ')}`)
  }
}

// Worker custom domains attached to the account's workers.
try {
  const d = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/domains?per_page=50`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  const doms = d?.result ?? []
  if (doms.length === 0) console.log('worker custom domains: none')
  else
    for (const el of doms) console.log(`custom domain: ${el.hostname} -> ${el.worker?.service ?? '?'} (${el.environment ?? ''})`)  
} catch (e) {
  console.log('worker custom domains: (check failed) ' + (e instanceof Error ? e.message : String(e)))
}