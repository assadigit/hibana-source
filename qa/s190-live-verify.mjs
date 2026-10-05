#!/usr/bin/env node
// S190 live byte-verify — ONE ACTIVE GRAMMAR, MOBILE must land byte-identical on
// hibana.ir. The round changed THREE hashed public assets:
//   polish-ui.css (the bar's S190 block: the active tab's shape + inks + the press
//                  family + the retired expanded ink + the focus rings + the bar's
//                  0.375rem geometry + the 3.9rem body reserve),
//   quicknotes.css (the More sheet's current-row family swap),
//   nav.js (the tap-to-top re-orient in go()'s byte-identical branch)
//   — plus every shell page's ?v= busts (polish-ui v39, quicknotes v45, nav v42)
//   and sw.js v426. No migration: schema stays 63.
// notes.html wires all three hashed assets; projects.html double-covers them.
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v426'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'notes.html': ['polish-ui', 'quicknotes', 'nav'],
  'projects.html': ['polish-ui', 'quicknotes', 'nav'],
}
const results = []
let fail = false

const localFile = (prefix) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && (f.endsWith('.js') || f.endsWith('.css'))) || null

const check = async (label, liveUrl, localPath) => {
  const local = readFileSync(localPath)
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
}

for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  // pages 307 to their extensionless live form — fetch follows redirects.
  // NOTE (the S188 lesson, re-applied in S189): the LIVE pages serve the WIRED
  // form — the ?v= busts live only in the canonical tree; the wired HTML carries
  // /dist/<hash> refs. The proof here: every target extracts a HASHED ref and the
  // bytes match the local dist build exactly — the ?v= ledger rides sw.js's VERSION.
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  const wiredOk = !html.includes('/css/polish-ui.css?v=') && !html.includes('/js/nav.js?v=')
  if (!wiredOk) fail = true
  results.push(`${wiredOk ? '✓' : '✗'} ${page} serves the WIRED form (no raw /css|js/ ?v= refs)`)
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const local = localFile(t)
    if (ref && local) await check(`${t} (wired, off ${page})`, BASE + ref, join(DIST, local))
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// The unhashed shell: sw.js carries the VERSION ledger (v426).
const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
const swOk = sw.includes(`const VERSION = "${EXPECT_SW}"`)
if (!swOk) fail = true
results.push(`${swOk ? '✓' : '✗'} sw.js VERSION = ${EXPECT_SW}`)

// Health + schema (no migration this round — 63 must hold). NOTE the live
// /api/health shape: { ok, db: 'up'|'dn', schema_version } — flat, db a STRING.
const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
const hOk = health?.ok === true && health?.db === 'up' && String(health?.schema_version) === EXPECT_SCHEMA
if (!hOk) fail = true
results.push(`${hOk ? '✓' : '✗'} health ok=${health?.ok} db=${health?.db} schema_version=${health?.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)

console.log(results.join('\n'))
if (fail) { console.log('\nS190 LIVE VERIFY: FAIL'); process.exit(1) }
console.log('\nS190 LIVE VERIFY: ALL GREEN')
