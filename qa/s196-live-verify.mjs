#!/usr/bin/env node
// S196 live byte-verify — THE TEST-NET + BUILD-ENTRY ROUND must land byte-identical
// on hibana.ir. The round changed:
//   1. THE S161-MISS CLASS CLOSES: spark-page.js, magic-wand.js, image-crop.js,
//      ai-autopolish.js, clip.css, magic-wand.css join the build ENTRY_POINTS —
//      they now ship as content-hashed /dist/ bundles, wired into their pages.
//      The LIVE proof: the referencing pages carry /dist/<name>.<hash>.(js|css)
//      refs and NO raw /js/<name>.js?v= (or /css/<name>.css?v=) leftovers — the
//      S193 "raw exception" documentation retires.
//   2. THE LOADER-VEIL LIFT (the bug the round's own new e2e caught): clip-page.js
//      (v2) + 404-page.js (v3) lift #hibana-page-loader themselves — the live
//      wired bundles carry the lift.
//   3. sw.js v431 + health (schema stays 63; parity stays 1570/1570).
// RUN WITH THE TREE IN CANONICAL FORM — the dist bytes verify against the
// canonical build (all verified assets are ENTRY_POINTS members now; there is
// NO raw-asset exception left in the app).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v431'
const EXPECT_SCHEMA = '63'

// The newly-wired assets + one page each that references them (the round's pages):
//   spark.html → spark-page.js + magic-wand.js + image-crop.js + magic-wand.css
//   dashboard.html → ai-autopolish.js
//   clip.html → clip-page.js (+ clip.css — its only page)
//   404.html (served at a miss URL) → 404-page.js
const PAGE_TARGETS = {
  'spark.html': ['spark-page', 'magic-wand', 'image-crop', 'magic-wand'],
  'dashboard.html': ['ai-autopolish'],
  'clip.html': ['clip-page', 'clip'],
}
// raw refs that must be GONE from each page (the S161-miss class's retirement proof)
const RAW_GONE = {
  'spark.html': ['/js/spark-page.js?v=', '/js/magic-wand.js?v=', '/js/image-crop.js?v=', '/css/magic-wand.css?v='],
  'dashboard.html': ['/js/ai-autopolish.js?v='],
  'clip.html': ['/js/clip-page.js?v=', '/css/clip.css?v='],
}

const results = []
let fail = false

// extension-aware: 'magic-wand' exists as BOTH .js and .css in dist — the caller
// must name the kind (the first run's .find() picked the CSS for the JS ref and
// false-failed the byte-compare — the S191-style verifier lesson again)
const localFile = (prefix, ext) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && f.endsWith(ext)) || null

const check = async (label, liveUrl, localPath) => {
  const local = readFileSync(localPath)
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
}

// 1. every newly-wired page: dist refs present + raw refs GONE + the dist bytes match
for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const raw of RAW_GONE[page]) {
    const gone = !html.includes(raw)
    if (!gone) fail = true
    results.push(`${gone ? '✓' : '✗'} ${page}: raw ref ${raw} is GONE (wired)`)
  }
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const ext = ref ? ref.endsWith('.css') ? '.css' : '.js' : null
    const local = ext ? localFile(t, ext) : null
    if (ref && local) await check(`${t} (${ext.slice(1)}, wired, off ${page})`, BASE + ref, join(DIST, local))
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// 2. THE LOADER-VEIL LIFT rides the live bytes (the bug fix's content probe)
{
  const html = await (await fetch(`${BASE}/clip.html?title=probe`, { cache: 'no-store' })).text()
  const ref = /(?:src)="(\/dist\/clip-page\.[a-f0-9]+\.js)"/.exec(html)?.[1]
  if (ref) {
    const js = await (await fetch(BASE + ref, { cache: 'no-store' })).text()
    // esbuild minify normalizes quotes to double — probe both spellings
    const hasLift = /getElementById\(['"]hibana-page-loader['"]\)/.test(js) && /classList\.add\(['"]is-hidden['"]\)/.test(js)
    results.push(`${hasLift ? '✓' : '✗'} live clip-page.js carries the loader-veil lift`)
    if (!hasLift) fail = true
  } else { results.push('✗ live clip-page.js ref not found for the lift probe'); fail = true }
}
{
  // 404.html serves at miss URLs; its canonical asset ref is what the wired page carries
  const html = await (await fetch(`${BASE}/404.html`, { cache: 'no-store' })).text()
  const ref = /(?:src)="(\/dist\/404-page\.[a-f0-9]+\.js)"/.exec(html)?.[1]
  if (ref) {
    const js = await (await fetch(BASE + ref, { cache: 'no-store' })).text()
    const hasLift = /getElementById\(['"]hibana-page-loader['"]\)/.test(js) && /classList\.add\(['"]is-hidden['"]\)/.test(js)
    results.push(`${hasLift ? '✓' : '✗'} live 404-page.js carries the loader-veil lift`)
    if (!hasLift) fail = true
  } else { results.push('✗ live 404-page.js ref not found for the lift probe'); fail = true }
}

// 3. the live clip page answers 200 (the popup surface itself)
{
  const r = await fetch(`${BASE}/clip.html?title=probe`, { cache: 'no-store' })
  const ok = r.status === 200
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} GET /clip.html → ${r.status}`)
}

// 4. sw.js version
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  const ok = sw.includes(`const VERSION = "${EXPECT_SW}"`)
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} sw.js VERSION = ${EXPECT_SW}`)
}

// 5. health (no migration this round — schema stays 63)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  const ok = h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

console.log(results.join('\n'))
console.log(`\nS196 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
