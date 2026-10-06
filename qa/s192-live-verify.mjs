#!/usr/bin/env node
// S192 live byte-verify — THE ATTENTION PATH must land byte-identical on hibana.ir.
// The round changed FOUR hashed public assets:
//   command-palette.js (the Notifications row: the live-count sublabel off the
//                      shared __hibNotifCounts memo + the smart #urgent|#warning|#info
//                      destination + readNotifCounts on open),
//   hib-init.js (the account-menu row's smart deep-link),
//   mobile-nav.js (the More sheet row's smart deep-link + the data-notif-row stable
//                 hook + normPath drops the hash so aria-current stays route-true),
//   quicknotes.css (the badge ring tracks the chip's hover/focus surface)
//   — plus every shell page's ?v= busts (command-palette v19, hib-init v13,
//   mobile-nav v15, quicknotes v47) and sw.js v428. No migration: schema stays 63.
// notifications.html wires all four directly; projects.html double-covers the
// shared chrome set. Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v428'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'notifications.html': ['command-palette', 'hib-init', 'mobile-nav', 'quicknotes'],
  'projects.html': ['command-palette', 'hib-init', 'mobile-nav', 'quicknotes'],
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
  // NOTE (the S188..S191 lesson, re-applied): the LIVE pages serve the WIRED form —
  // the ?v= busts live only in the canonical tree; the wired HTML carries
  // /dist/<hash> refs. The proof: every target extracts a HASHED ref and the bytes
  // match the local dist build exactly — the ?v= ledger rides sw.js's VERSION.
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  const wiredOk = !html.includes('/js/command-palette.js?v=') && !html.includes('/js/hib-init.js?v=') && !html.includes('/js/mobile-nav.js?v=') && !html.includes('/css/quicknotes.css?v=')
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

// The unhashed shell: sw.js carries the VERSION ledger (v428).
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
if (fail) { console.log('\nS192 LIVE VERIFY: FAIL'); process.exit(1) }
console.log('\nS192 LIVE VERIFY: ALL GREEN')
