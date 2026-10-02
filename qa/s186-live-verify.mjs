#!/usr/bin/env node
// S186 live byte-verify — the CTA round must land byte-identical on hibana.ir.
// (Re-authored after the sandbox wipe ate the untracked original; the rebuilt
// tree was first proven byte-identical to the release zip's 70 dist files +
// 27 wired pages, so this script re-proves the LIVE side.)
// The round changed ELEVEN public assets (3 css + 8 js):
//   base.css (the S186 CTA rule block + the neutral ghost ink), notes.css (the
//   vault-new shared tokens + the ≤768px mobile consolidation), to-do-list.css;
//   app.js (the shared window.hibanaMenu body-portal lift), image-crop.js (the
//   incident fix: Apply = the bare-button solid-teal primary, Cancel = neutral
//   ghost), notes-page.js, sparks-page.js, projects-page.js, sprint-page.js,
//   clients-page.js, sadhana-page.js — plus every shell page's ?v= busts and
//   sw.js v421. No migration: schema stays 63.
// image-crop.js rides OUTSIDE the hashed manifest (canonical /js/ + ?v=3) — it
// is verified by its plain URL, not by a wired ref.
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v421'
const EXPECT_SCHEMA = '63'
// page → the hashed assets it references that this round changed
const PAGE_TARGETS = {
  'sparks.html': ['base', 'to-do-list', 'app', 'sparks-page'],
  'notes.html': ['notes', 'notes-page'],
  'projects.html': ['projects-page'],
  'sprint.html': ['sprint-page'],
  'clients.html': ['clients-page'],
  'sadhana.html': ['sadhana-page'],
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
  // /sparks.html 307s to the extensionless /sparks (the S158 live form) — fetch follows
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const local = localFile(t)
    if (ref && local) await check(`${t} (wired, off ${page})`, BASE + ref, join(DIST, local))
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// image-crop.js — the canonical (unhashed) rider: byte-compare the plain URL
// + pin the ?v=3 ref the wired pages carry.
const sparksHtml = await (await fetch(`${BASE}/sparks.html`, { cache: 'no-store' })).text()
const cropRef = /(?:src|href)="(\/js\/image-crop\.js\?v=\d+)"/.exec(sparksHtml)?.[1] || 'MISSING'
results.push(`markup: image-crop canonical ref = ${cropRef} ${cropRef === '/js/image-crop.js?v=3' ? '✓' : '✗'}`)
if (cropRef !== '/js/image-crop.js?v=3') fail = true
await check('image-crop.js (canonical)', `${BASE}/js/image-crop.js`, join(process.cwd(), 'public', 'js', 'image-crop.js'))

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
