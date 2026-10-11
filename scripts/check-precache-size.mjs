// check-precache-size.mjs — SW precache budget gate (S200, PERF-5).
//
// The service worker precaches SHELL (public/sw.js) + every manifest.json dist
// entry at install. Nothing tracked that total: the in-code "~1.87MB" comment was
// ~2 releases stale (measured 2,179 KB raw at S198) and growth was invisible.
// This gate measures the real install payload and fails past a hard budget, so
// "oops, a 400 KB asset joined the precache" is a red CI line, not a silent
// first-visit regression (the SW re-downloads the whole set on every version bump).
//
// What it counts (raw bytes, matching what cache.put stores):
//   - every SHELL entry that maps to a file under public/ ('/' → index.html;
//     dynamic routes like /api/nav and /to-do-list contribute ~0 and are skipped)
//   - every value in public/dist/manifest.json (the hashed bundles)
// NOT counted (by design, mirroring the SW's install filter): vendor/* (runtime SWR
// cache), i18n-fa.js (FA-only lazy bundle — S80), sourcemaps.
//
// Run: node scripts/check-precache-size.mjs   (after `bun run build`)
// CI: wired into .github/workflows/ci.yml after the bundle-size check.
// Budget re-pins: move BUDGET_BYTES down when the diet shrinks things (ratchet
// discipline — only ever DOWN, like the eslint warning ratchet).

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SW_PATH = join(ROOT, 'public', 'sw.js')
const MANIFEST_PATH = join(ROOT, 'public', 'dist', 'manifest.json')
const PUBLIC = join(ROOT, 'public')

// Budget: 2,300 KB raw (measured 2,179 KB at S198 + ~5% headroom). Ratchet DOWN
// on deliberate shrinks (e.g. PERF-8's Login.jpg → WebP); never raise it without
// a written reason in the commit message.
const BUDGET_BYTES = 2_300 * 1024

if (!existsSync(SW_PATH)) {
  console.error('FAIL: public/sw.js not found.')
  process.exit(1)
}
if (!existsSync(MANIFEST_PATH)) {
  console.error('FAIL: public/dist/manifest.json not found — run `bun run build` first.')
  process.exit(1)
}

// Extract the SHELL array (first `const SHELL = [ … ]` block) and pull the
// single-quoted entries. Comment lines are stripped first — their prose also
// contains single-quoted phrases (e.g. "don't") that would read as entries.
const sw = readFileSync(SW_PATH, 'utf8')
const shellBlock = /const SHELL = \[([\s\S]*?)\n\]/.exec(sw)
if (!shellBlock) {
  console.error('FAIL: could not parse the SHELL array out of public/sw.js — did its shape change?')
  process.exit(1)
}
const shellSrc = shellBlock[1].replace(/\/\/.*$/gm, '')
const shell = [...shellSrc.matchAll(/'([^']+)'/g)].map((m) => m[1])

const missing = []
const shellBytes = new Map() // url → bytes (file-backed entries only)
for (const url of shell) {
  if (url.startsWith('/api/')) continue // dynamic route — no file to measure
  let rel = url === '/' ? 'index.html' : url.slice(1)
  rel = rel.split('?')[0]
  const p = join(PUBLIC, rel)
  if (!existsSync(p) || statSync(p).isDirectory()) {
    // Route-style entries (e.g. /to-do-list) are served by the Worker, not a file.
    missing.push(url)
    continue
  }
  shellBytes.set(url, statSync(p).size)
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
let manifestBytes = 0
const manifestEntries = []
for (const [logical, url] of Object.entries(manifest)) {
  // Mirror the SW's install logic EXACTLY (public/sw.js): it precaches manifest
  // entries whose value starts with 'dist/' — vendor/* values (public/vendor,
  // runtime SWR) and i18n-fa.js (FA-only lazy, S80) are deliberately OUT.
  if (!url.startsWith('dist/') || logical === 'i18n-fa.js') continue
  const rel = url.slice('dist/'.length)
  const p = join(PUBLIC, 'dist', rel)
  if (!existsSync(p)) {
    console.error(`FAIL: manifest entry ${logical} → ${url} has no file in public/dist/`)
    process.exit(1)
  }
  manifestBytes += statSync(p).size
  manifestEntries.push({ logical, bytes: statSync(p).size })
}

const shellTotal = [...shellBytes.values()].reduce((n, b) => n + b, 0)
const total = shellTotal + manifestBytes

console.log(`Precache: ${(total / 1024).toFixed(0)} KB raw — SHELL ${shellBytes.size} files ${(shellTotal / 1024).toFixed(0)} KB + manifest ${manifestEntries.length} entries ${(manifestBytes / 1024).toFixed(0)} KB (budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`)
if (missing.length) console.log(`  (route-style SHELL entries, not file-backed: ${missing.join(', ')})`)

const top = [...manifestEntries].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
for (const t of top) console.log(`  top: ${t.logical} ${(t.bytes / 1024).toFixed(1)} KB`)

if (total > BUDGET_BYTES) {
  console.error(`\nFAIL: SW precache ${(total / 1024).toFixed(0)} KB exceeds the ${(BUDGET_BYTES / 1024).toFixed(0)} KB budget.`)
  console.error('If the growth is intentional, this is the conversation to have it in: raise BUDGET_BYTES')
  console.error('in scripts/check-precache-size.mjs WITH a written reason — or move the asset out of the')
  console.error('precache (the fabric/Vazir lazy pattern) instead of paying it on every install.')
  process.exit(1)
}
console.log(`PASS: precache within budget (${(BUDGET_BYTES - total >= 0 ? '+' : '')}${((BUDGET_BYTES - total) / 1024).toFixed(0)} KB headroom)`)
