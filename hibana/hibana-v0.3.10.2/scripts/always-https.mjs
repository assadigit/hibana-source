#!/usr/bin/env node
// P0 (ROADMAP): flip Cloudflare's "Always Use HTTPS" zone setting for hibana.ir so plain
// http:// auto-redirects to https:// (the worker can't see the scheme, so this must be
// a zone-level edge setting). Uses the wrangler-saved OAuth token (never printed).
//   node scripts/always-https.mjs        # show current value
//   node scripts/always-https.mjs --on   # enable  (desired: delivery of http -> https)
//   node scripts/always-https.mjs --off  # disable
// Requires the OAuth token to have Zone > Settings:Edit permission (wrangler's default
// token usually does). If PATCH returns 403, it stays a manual dashboard toggle.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ZONE_ID = '084061b09720c0506f4538e740377c4b' // hibana.ir

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
const headers = { Authorization: `Bearer ${token}` }
const url = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/always_use_https`

const show = async () => {
  const r = await fetch(url, { headers })
  const j = await r.json()
  if (!r.ok || !j.success) {
    console.error(`read failed (${r.status}):`, j.errors ?? (await r.text()))
    process.exit(1)
  }
  console.log(`alwayS HTTPS for hibana.ir is currently: ${j.result.value}`)
}

if (process.argv.includes('--on') || process.argv.includes('--off')) {
  const value = process.argv.includes('--on') ? 'on' : 'off'
  const r = await fetch(url, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
  const j = await r.json()
  if (!r.ok || !j.success) {
    console.error(`PATCH failed (${r.status}) — likely missing Zone>Settings:Edit scope; set it manually in the dashboard (SSL/TLS -> Edge Certificates -> Always Use HTTPS).`, j.errors ?? '')
    process.exit(1)
  }
  console.log(`set Always Use HTTPS -> ${j.result.value}`)
} else {
  await show()
}
