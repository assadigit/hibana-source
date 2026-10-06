#!/usr/bin/env node
// S193 live byte-verify — THE REVIEW FLOW must land byte-identical on hibana.ir.
// The round changed FIVE hashed public assets:
//   spark-page.js (the queue fetch/render/hops + the promote dialog + the
//                 queue-aware landings + the dirty save-and-continue),
//   dashboard.css (the .spark-queue bar on the --nav-active-* tint family +
//                 the .spark-promote secondary),
//   i18n-en.js / i18n.js (+ the i18n-fa lazy literal: the five S193 keys —
//                 spark.reviewQueue/queuePos/nextIdea/prevIdea/queueUnsaved)
//   — plus every shell page's ?v= busts (dashboard.css v40 ×23, i18n-en v97,
//   i18n.js v151, spark-page.js v6 on spark.html) and sw.js v429.
//   No migration: schema stays 63.
// spark.html wires all five directly (the round's own page); projects.html
// double-covers the shared chrome set. Run with the tree in WIRED form
// (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v429'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'spark.html': ['spark-page', 'dashboard', 'i18n-en', 'i18n'],
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
  // carries /dist/<hash> refs. The proof: every target extracts a HASHED ref
  // and the bytes match the local dist build exactly — the ?v= ledger rides
  // sw.js's VERSION.
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  const wiredOk = !html.includes('/js/spark-page.js?v=') && !html.includes('/css/dashboard.css?v=') && !html.includes('/js/i18n-en.js?v=') && !html.includes('/js/i18n.js?v=')
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
