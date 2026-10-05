#!/usr/bin/env node
// S188 live byte-verify — the Projects sidebar panel round must land byte-identical
// on hibana.ir. The round changed FOUR hashed public assets:
//   nav.js (single-line rows markup, elbows, badges, fold persistence),
//   layout.css (floating panel + sticky heads + guides + badges + the retired
//   is-panel-open accent), i18n-en.js + i18n.js + the lazily-injected i18n-fa.js
//   twin (6 badge aria-label keys; the fa loader literal v89) — plus every shell
//   page's ?v= busts (nav v41, layout v62, i18n-en v95, i18n v149) and sw.js v424.
//   No migration: schema stays 63.
// projects.html wires all four hashed assets; sadhana.html double-covers the
// i18n pair. The i18n-fa twin rides INSIDE i18n.js's rewritten literal (no page
// ref) — its hash is extracted from the LIVE i18n.js body.
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v424'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'projects.html': ['nav', 'layout', 'i18n-en', 'i18n'],
  'sadhana.html': ['nav', 'layout', 'i18n-en', 'i18n'],
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

let liveI18nBody = null
for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  // pages 307 to their extensionless live form — fetch follows redirects
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const local = localFile(t)
    if (ref && local) {
      await check(`${t} (wired, off ${page})`, BASE + ref, join(DIST, local))
      if (t === 'i18n' && page === 'projects.html') liveI18nBody = await (await fetch(BASE + ref, { cache: 'no-store' })).text()
    }
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// The lazily-injected i18n-fa twin: no page carries its URL — it lives inside the
// LIVE i18n.js body as the build-rewritten hashed literal /dist/i18n-fa.<hash>.js
// (the canonical tree's ?v=89 rides the unwired /js/i18n.js literal; the wired
// form swaps it for the content hash — so match the hashed path, not the query).
if (liveI18nBody) {
  const faRef = /\/dist\/(i18n-fa\.[a-f0-9]+\.js)/.exec(liveI18nBody)?.[1] || null
  const localFa = localFile('i18n-fa')
  if (faRef && localFa) await check('i18n-fa (lazy twin, out of the live i18n.js literal)', `${BASE}/dist/${faRef}`, join(DIST, localFa))
  else { results.push('✗ i18n-fa: the hashed literal or local file MISSING'); fail = true }
} else { results.push('✗ i18n body never fetched'); fail = true }

// The unhashed shell: sw.js carries the VERSION ledger (v424).
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
if (fail) { console.log('\nS188 LIVE VERIFY: FAIL'); process.exit(1) }
console.log('\nS188 LIVE VERIFY: ALL GREEN')
