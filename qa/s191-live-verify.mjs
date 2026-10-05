#!/usr/bin/env node
// S191 live byte-verify — THE ATTENTION SURFACE must land byte-identical on
// hibana.ir. The round changed NINE hashed public assets:
//   variables.css (the --badge-pending pair, defined at last),
//   claude-dark-theme.css (the dark pending twin),
//   quicknotes.css (the chrome pills: chip-notif-badge + menu-count-pill),
//   notifications.css (the severity groups + sticky heads + chips-as-buttons),
//   hib-init.js (wireNotifBadge: the counts fetch + paint + event),
//   mobile-nav.js (the More sheet row pill),
//   notifications-page.js (the filter chips + hash deep-links),
//   i18n-en.js + i18n.js (+ the lazily-injected i18n-fa.js — its hashed ref is
//   rewritten INTO the i18n.js bundle by the build's fixpoint loop; verified via
//   the literal, the S188 lesson)
//   — plus every shell page's ?v= busts (variables v26, claude-dark v29,
//   quicknotes v46, notifications v12, hib-init v12, mobile-nav v14,
//   notifications-page v2, i18n-en v96, i18n v150) and sw.js v427.
//   No migration: schema stays 63.
// notifications.html wires all nine directly; projects.html double-covers the
// shared chrome set. Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v427'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'notifications.html': ['notifications', 'quicknotes', 'variables', 'claude-dark-theme', 'hib-init', 'mobile-nav', 'notifications-page', 'i18n-en', 'i18n'],
  'projects.html': ['quicknotes', 'variables', 'claude-dark-theme', 'hib-init', 'mobile-nav', 'i18n-en', 'i18n'],
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
  // NOTE (the S188/S189/S190 lesson, re-applied): the LIVE pages serve the WIRED
  // form — the ?v= busts live only in the canonical tree; the wired HTML carries
  // /dist/<hash> refs. The proof: every target extracts a HASHED ref and the bytes
  // match the local dist build exactly — the ?v= ledger rides sw.js's VERSION.
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  const wiredOk = !html.includes('/css/notifications.css?v=') && !html.includes('/js/hib-init.js?v=') && !html.includes('/js/i18n.js?v=')
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

// The lazily-injected FA dictionary (the S188 lesson): its hashed ref lives as a
// literal inside the LIVE i18n.js bundle (the build's fixpoint rewrite). Extract +
// byte-verify the twin.
{
  const html = await (await fetch(`${BASE}/notifications.html`, { cache: 'no-store' })).text()
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

// The unhashed shell: sw.js carries the VERSION ledger (v427).
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
if (fail) { console.log('\nS191 LIVE VERIFY: FAIL'); process.exit(1) }
console.log('\nS191 LIVE VERIFY: ALL GREEN')
