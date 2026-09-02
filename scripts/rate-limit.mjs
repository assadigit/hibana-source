#!/usr/bin/env node
// §15 — basic rate limiting on the internet-facing endpoints (login, password reset, and
// the Telegram webhook) via Cloudflare free-tier Rate Limiting Rules (zone ruleset phase
// http_ratelimit). No code changes needed — this is edge config.
//   node scripts/rate-limit.mjs          # show current rules
//   node scripts/rate-limit.mjs --apply  # PUT the two guard rules
// Uses the wrangler-saved OAuth token (never printed). Requires Zone > WAF (or equivalent
// ruleset edit) permission; if PUT returns 403, apply manually in the dashboard
// (Security -> WAF -> Rate limiting rules) with the expressions printed below.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ZONE_ID = '084061b09720c0506f4538e740377c4b' // hibana.ir
const ENTRYPOINT = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint`

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

// Free-tier-friendly, per-visitor guards. Period in seconds; block long enough to hurt bots
// but never the owner.
const RULES = [
  {
    expression:
      '(http.request.uri.path eq "/api/auth/login" or http.request.uri.path starts_with "/api/auth/reset/")',
    description: 'Hibana: brute-force guard on login + password reset',
    action: 'block',
    ratelimit: {
      characteristics: ['cf.colo.id', 'ip.src'],
      period: 60,
      requests_per_period: 30,
      mitigation_timeout: 300,
      requests_to_origin: true,
    },
  },
  {
    expression: 'http.request.uri.path eq "/api/telegram/webhook"',
    description: 'Hibana: webhook flood guard (Telegram POSTs only)',
    action: 'block',
    ratelimit: {
      characteristics: ['cf.colo.id', 'ip.src'],
      period: 60,
      requests_per_period: 300,
      mitigation_timeout: 60,
      requests_to_origin: true,
    },
  },
]

const show = async () => {
  const r = await fetch(ENTRYPOINT, { headers })
  const j = await r.json()
  if (!r.ok || !j.success) {
    console.error(`read failed (${r.status}):`, JSON.stringify(j.errors ?? (await r.text())).slice(0, 300))
    return
  }
  const rules = j.result?.rules ?? []
  console.log(`existing http_ratelimit rules: ${rules.length}`)
  for (const rule of rules) {
    console.log(`  - ${rule.description ?? rule.id}  (${rule.action})`)
  }
}

if (process.argv.includes('--apply')) {
  await show()
  const r = await fetch(ENTRYPOINT, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: RULES }),
  })
  const j = await r.json()
  if (!r.ok || !j.success) {
    console.error(
      `PUT failed (${r.status}) — likely missing Zone>WAF/ruleset scope; apply manually in the dashboard (Security -> WAF -> Rate limiting rules) with:\n` +
        RULES.map((x) => `  expr: ${x.expression}`).join('\n'),
      JSON.stringify(j.errors).slice(0, 400),
    )
    process.exit(1)
  }
  console.log(`applied ${j.result?.rules?.length ?? RULES.length} rate-limiting rule(s) to hibana.ir`)
} else {
  await show()
}
