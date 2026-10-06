#!/usr/bin/env node
// S193 live byte-verify — THE REVIEW FLOW must land byte-identical on hibana.ir.
// The round changed FIVE public assets:
//   spark-page.js (the queue fetch/render/hops + the promote dialog + the
//                 queue-aware landings + the dirty save-and-continue) — NOTE:
//                 spark-page.js is the ONE page controller NOT in the build's
//                 ENTRY_POINTS (an S161 miss — every other *-page.js is bundled
//                 + wired); it serves RAW at /js/spark-page.js?v=N, so it is
//                 verified RAW: live bytes vs the canonical public/js file,
//   dashboard.css (the .spark-queue bar on the --nav-active-* tint family +
//                 the .spark-promote secondary),
//   i18n-en.js / i18n.js (+ the i18n-fa lazy literal: the five S193 keys —
//                 spark.reviewQueue/queuePos/nextIdea/prevIdea/queueUnsaved)
//   — plus every shell page's ?v= busts (dashboard.css v40 ×23, i18n-en v97,
//   i18n.js v151, spark-page.js v6 on spark.html) and sw.js v429.
//   No migration: schema stays 63.
// spark.html wires the hashed chrome + carries the raw spark-page ref;
// projects.html double-covers the shared chrome set.
// RUN WITH THE TREE IN WIRED FORM (build --prod --wire-html) — the wired build's
// fixpoint rewrites i18n.js's lazy FA literal to /dist/, so canonical-build dist
// bytes differ from live by that literal (the S191 lesson, 6 bytes).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v429'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'spark.html': ['dashboard', 'i18n-en', 'i18n'],
  'projects.html': ['dashboard', 'i18n-en', 'i18n'],
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
  // NOTE (the S188..S192 lesson, re-applied): the LIVE pages serve the WIRED
  // form — the ?v= busts live only in the canonical tree; the wired HTML
  // carries /dist/<hash> refs. spark-page.js is the exception (raw, below).
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  const wiredOk = !html.includes('/css/dashboard.css?v=') && !html.includes('/js/i18n-en.js?v=') && !html.includes('/js/i18n.js?v=')
  if (!wiredOk) fail = true
  results.push(`${wiredOk ? '✓' : '✗'} ${page} serves the WIRED form (no raw /css|js/ ?v= refs, spark-page excepted)`)
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const local = localFile(t)
    if (ref && local) await check(`${t} (wired, off ${page})`, BASE + ref, join(DIST, local))
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// spark-page.js — the RAW asset (not in ENTRY_POINTS since S161): the live page
// carries /js/spark-page.js?v=6; byte-verify the live raw serve against the
// canonical public/js file. The ?v= bust IS the cache key (this round: v6).
{
  const html = await (await fetch(`${BASE}/spark.html`, { cache: 'no-store' })).text()
  const ref = /(?:src|href)="(\/js\/spark-page\.js\?v=\d+)"/.exec(html)?.[1] || null
  if (ref && ref.endsWith('v=6')) {
    await check('spark-page.js (raw, the S161 exception, v=6)', BASE + ref, join(process.cwd(), 'public', 'js', 'spark-page.js'))
  } else {
    results.push(`✗ spark-page.js: live raw ref MISSING or wrong version (got ${ref})`); fail = true
  }
}

// The lazily-injected FA dictionary (the S188/S191 lesson): its hashed ref lives
// as a literal inside the LIVE i18n.js bundle (the build's fixpoint rewrite).
// Extract + byte-verify the twin — the five S193 FA keys ride it.
{
  const html = await (await fetch(`${BASE}/spark.html`, { cache: 'no-store' })).text()
  const i18nRef = /(?:src|href)="(\/dist\/i18n\.[a-f0-9]+\.js)"/.exec(html)?.[1]
  if (i18nRef) {
    const i18nLive = await (await fetch(BASE + i18nRef, { cache: 'no-store' })).text()
    // the literal rides the minifier's DOUBLE quotes (r.src="/dist/i18n-fa.<hash>.js") —
    // accept either quote style.
    const faRef = /[ "']?(\/dist\/i18n-fa\.[a-f0-9]+\.js)["']?/.exec(i18nLive)?.[1]
    const faLocal = localFile('i18n-fa')
    if (faRef && faLocal) await check(`i18n-fa (the lazy literal inside the live i18n.js)`, BASE + faRef, join(DIST, faLocal))
    else { results.push('✗ i18n-fa: lazy literal or local file MISSING'); fail = true }
  } else { results.push('✗ i18n.js wired ref MISSING (FA twin unprovable)'); fail = true }
}

// The unhashed shell: sw.js carries the VERSION ledger (v429).
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
if (fail) { console.log('\nS193 LIVE VERIFY: FAIL'); process.exit(1) }
console.log('\nS193 LIVE VERIFY: ALL GREEN')
