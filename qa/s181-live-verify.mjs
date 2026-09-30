#!/usr/bin/env node
// S181 live byte-verify — the OPENING QUARTET + the owner's five approved items
// must land byte-identical on hibana.ir. The round changed NINE public assets
// (variables.css — the --ident-* identity family + the sidebar bar rung + the
// five laws' token values; layout.css — the sidebar current-location bar rules;
// claude-dark-theme.css — no overrides for the new tokens; polish-ui.css — the
// .dash-sec-head one-grammar + the quiet-nudge registers; dashboard.css — the
// visible h1 + the resume section wrap + the progress meter + the zero page;
// resume.js — the progress-map fetch + the hero summary line/meter; i18n-en.js
// + i18n.js (+ its lazily-injected i18n-fa.js twin) — the new strings) +
// sw.js v416 (every shell page changed markup via the global ?v= busts +
// dashboard.html's visible h1). This pins those nine plus sw v416 and the
// health endpoint — which must now report schema 63 (0064 applied to BOTH D1s).
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v416'
const EXPECT_SCHEMA = '63'
// the eight assets dashboard.html references directly…
const TARGETS = ['variables', 'layout', 'claude-dark-theme', 'polish-ui', 'dashboard', 'resume', 'i18n-en', 'i18n']
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

// …and i18n-fa, whose dist ref only exists inside i18n.js's body (the lazy
// FA dictionary the build's fixpoint loop rewrites)
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

// i18n-fa: discovered from the live i18n.js body, then byte-compared
const i18nBody = refs['i18n'] ? await (await fetch(BASE + refs['i18n'], { cache: 'no-store' })).text() : ''
const faRef = /\/dist\/(i18n-fa\.[a-f0-9]+\.js)/.exec(i18nBody)?.[1] || null
results.push(`markup: wired i18n-fa ref (inside i18n.js) = ${faRef ? '/' + faRef : 'MISSING'}`)
const faLocal = localFile('i18n-fa')
if (faRef && faLocal) await check('i18n-fa (lazy twin)', `${BASE}/dist/${faRef}`, faLocal)
else { results.push('✗ i18n-fa: live ref or local file MISSING'); fail = true }

const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
const swV = /hibana-v[0-9]+/.exec(sw)?.[0] || 'MISSING'
results.push(`sw.js VERSION: ${swV} (expect ${EXPECT_SW}) ${swV === EXPECT_SW ? '✓' : '✗'}`)
if (swV !== EXPECT_SW) fail = true

const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json().catch(() => null)
results.push(`health: ${JSON.stringify(health)}`)
if (!health || health.ok !== true) fail = true
if (health && String(health.db?.schema_version ?? health.schema_version ?? '') !== EXPECT_SCHEMA) {
  results.push(`✗ schema_version: expected ${EXPECT_SCHEMA} (0064 applied to BOTH D1s) — run the §5 d1-migrate ritual`)
  fail = true
}

console.log(results.join('\n'))
process.exit(fail ? 1 : 0)
