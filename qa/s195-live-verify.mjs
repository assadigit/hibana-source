#!/usr/bin/env node
// S195 live byte-verify — THE PANEL CLOSE-BUTTON FIX must land byte-identical
// on hibana.ir. The round changed TWO public assets:
//   layout.css (the head's quiet pair: 36px boxes + the 40px coarse floor +
//               the 1.25rem icons),
//   nav.js     (the X's optical stroke-width 2 path + the recipe comments)
//   — plus every shell page's ?v= busts (layout.css v64 ×26, nav.js v43 ×18)
//   and sw.js v430.
//   No migration: schema stays 63. No i18n change: parity stays 1570/1570.
// projects.html wires the hashed chrome and hosts the panel; notes.html
// double-covers the shared chrome set (its icon-only rail variant).
// RUN WITH THE TREE IN CANONICAL FORM — both assets are wired through the
// build (layout.css + nav.js are in ENTRY_POINTS), so the dist bytes verify
// against the canonical build directly (no raw exception this round).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v430'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'projects.html': ['layout', 'nav'],
  'notes.html': ['layout', 'nav'],
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
  // the LIVE pages serve the WIRED form — the ?v= busts live only in the
  // canonical tree (the S188..S193 lesson, re-applied).
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  const wiredOk = !html.includes('/css/layout.css?v=') && !html.includes('/js/nav.js?v=')
  if (!wiredOk) fail = true
  results.push(`${wiredOk ? '✓' : '✗'} ${page} serves the WIRED form (no raw layout|nav ?v= refs)`)
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const local = localFile(t)
    if (ref && local) await check(`${t} (wired, off ${page})`, BASE + ref, join(DIST, local))
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// the S195 payload actually rides the served bytes (a belt-and-braces content
// probe on the live CSS — the 2.25rem rule + the coarse floor)
{
  const html = await (await fetch(`${BASE}/projects.html`, { cache: 'no-store' })).text()
  const ref = /(?:href)="(\/dist\/layout\.[a-f0-9]+\.css)"/.exec(html)?.[1]
  if (ref) {
    const css = await (await fetch(BASE + ref, { cache: 'no-store' })).text()
    const has36 = css.includes('.rail-panel-close,.rail-panel-tree{display:grid;place-items:center;inline-size:2.25rem;block-size:2.25rem')
    const hasCoarse = css.includes('@media(pointer:coarse){.rail-panel-close,.rail-panel-tree{inline-size:2.5rem;block-size:2.5rem}}')
    const hasIcon = css.includes('.rail-panel-close .icon,.rail-panel-tree .icon{inline-size:1.25rem;block-size:1.25rem}')
    results.push(`${has36 ? '✓' : '✗'} live layout.css carries the 36px box rule`)
    results.push(`${hasCoarse ? '✓' : '✗'} live layout.css carries the 40px coarse floor`)
    results.push(`${hasIcon ? '✓' : '✗'} live layout.css carries the 20px icon rule`)
    if (!has36 || !hasCoarse || !hasIcon) fail = true
  } else { results.push('✗ live layout.css ref not found for the content probe'); fail = true }
}
{
  const html = await (await fetch(`${BASE}/projects.html`, { cache: 'no-store' })).text()
  const ref = /(?:src)="(\/dist\/nav\.[a-f0-9]+\.js)"/.exec(html)?.[1]
  if (ref) {
    const js = await (await fetch(BASE + ref, { cache: 'no-store' })).text()
    const hasX = js.includes('<path stroke-width="2" d="M6 6l12 12M18 6L6 18"/>')
    results.push(`${hasX ? '✓' : '✗'} live nav.js carries the X's optical stroke-width 2`)
    if (!hasX) fail = true
  } else { results.push('✗ live nav.js ref not found for the content probe'); fail = true }
}

// sw.js version
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  const ok = sw.includes(`const VERSION = "${EXPECT_SW}"`)
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} sw.js VERSION = ${EXPECT_SW}`)
}

// health (no migration this round — schema stays 63)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  const ok = h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

console.log(results.join('\n'))
console.log(`\nS195 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
