#!/usr/bin/env node
// S180 live byte-verify — the STICKY RESTORE (blocks 1–7) must land
// byte-identical on hibana.ir. The round changed FOUR public assets
// (quicknotes.css — the compact notebook's yellow sticky papers re-scoped
// under .notebook-dashboard at the sheet's END; app.js — the Move-to menu's
// keyboard wiring + the delete path's face-aware widget re-GET; resume.js —
// block 7's server-seeded "Continue where you left off" strip;
// claude-dark-theme.css — the dark dash meta ink bump) + sw.js v415 (every
// shell page's markup changed with the ?v= busts). This pins those four plus
// the two shell twins as sanity anchors:
//   nav.<hash>.js · layout.<hash>.css · app.<hash>.js ·
//   quicknotes.<hash>.css · resume.<hash>.js · claude-dark-theme.<hash>.css
// plus the sw.js VERSION (v415) and the health endpoint.
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v415'
const TARGETS = ['nav', 'layout', 'app', 'quicknotes', 'resume', 'claude-dark-theme']
const results = []
let fail = false

// /dashboard.html 307s to the extensionless /dashboard (the S158 live form)
const html = await (await fetch(`${BASE}/dashboard.html`, { cache: 'no-store' })).text()
const refs = {}
for (const t of TARGETS) {
  const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
  refs[t] = re.exec(html)?.[1] || null
  results.push(`markup: wired ${t} ref = ${refs[t] || 'MISSING'}`)
}

const localFile = (prefix) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && (f.endsWith('.js') || f.endsWith('.css'))) || null

const check = async (label, liveUrl, localName) => {
  const local = readFileSync(join(DIST, localName))
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
}

for (const t of TARGETS) {
  const local = localFile(t)
  if (refs[t] && local) await check(`${t} (wired)`, BASE + refs[t], local)
  else { results.push(`✗ ${t}: live ref or local file MISSING`); fail = true }
}

const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
const swV = /hibana-v[0-9]+/.exec(sw)?.[0] || 'MISSING'
results.push(`sw.js VERSION: ${swV} (expect ${EXPECT_SW}) ${swV === EXPECT_SW ? '✓' : '✗'}`)
if (swV !== EXPECT_SW) fail = true

const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json().catch(() => null)
results.push(`health: ${JSON.stringify(health)}`)
if (!health || health.ok !== true) fail = true

console.log(results.join('\n'))
process.exit(fail ? 1 : 0)
