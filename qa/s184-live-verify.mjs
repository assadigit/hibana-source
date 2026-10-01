#!/usr/bin/env node
// S184 live byte-verify — the LAYOUT-CONSISTENCY round must land byte-identical
// on hibana.ir. The round changed SEVEN public CSS assets (dashboard.css — the
// one-rhythm flex gap + the .dash-sec-link grammar + the 1rem/3rem head-strip
// geometry + the static nav-row handles; dashboard-todo.css — the 1rem panel
// inset + the todo head's one-grammar join; quicknotes.css — the notebook's
// 1rem frame + the composer's card-surface affordance + the .dash-note-foot;
// misc.css — the skeleton's one-gap rhythm + the retired per-head chrome; pol-
// ish-ui.css — the Continue card's 12px/16px foot + the 1rem inset; claude-dark-
// theme.css — the dark composer well twin; layout.css — the rail's active bar
// moved to the rail's own start edge) + sw.js v419 (every shell page changed
// markup via the ?v= busts). No JS changed this round (app.js/resume.js/i18n*
// keep their S183 hashes). This pins those seven plus sw v419 and the health
// endpoint — schema stays 63 (NO migration; pure frontend).
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v419'
const EXPECT_SCHEMA = '63'
// the seven assets dashboard.html references directly…
const TARGETS = ['dashboard', 'dashboard-todo', 'quicknotes', 'misc', 'polish-ui', 'claude-dark-theme', 'layout']
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
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return null }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
  return buf.toString()
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
if (health && String(health.db?.schema_version ?? health.schema_version ?? '') !== EXPECT_SCHEMA) {
  results.push(`✗ schema_version: expected ${EXPECT_SCHEMA} — UNEXPECTED DRIFT (no migration shipped this round)`)
  fail = true
}

console.log(results.join('\n'))
process.exit(fail ? 1 : 0)
