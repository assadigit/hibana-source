#!/usr/bin/env node
// Deploy gate (dr-integrity session, docs/dr-integrity-closeout.md §5.2): run between
// `build.mjs --prod --wire-html` and `wrangler deploy` (chained in the deploy scripts,
// and in CI in wired mode). It validates the WIRED artifact shape BEFORE upload:
//
//   1. every /dist/... reference in public/*.html matches the current manifest exactly
//      (a mismatch would serve a 404 or, worse, a stale-but-immutable file forever);
//   2. every manifest JS/CSS entry is referenced by some HTML page — except the
//      DYNAMIC_INJECTED allowlist (files loaded at runtime by other JS, not by pages);
//   3. no dist file exists on disk that the manifest doesn't list (orphans get served
//      immutable under a content-addressed name — must not happen by accident);
//   4. no unwired references to /js/<entry>.js or /css/<entry>.css remain in HTML for
//      manifest-covered files (the wiring must be complete, not partial);
//   5. the SW (sw.js) references /dist/manifest.json (the manifest-driven precache).
//
// Exit 0 = pass, 1 = fail (deploy aborts). In the COMMITTED (canonical) tree this script
// is a no-op pass — it only asserts when HTML is actually wired (dist refs present).

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PUBLIC_DIR = join(process.cwd(), 'public')
const DIST_DIR = join(PUBLIC_DIR, 'dist')
const MANIFEST_PATH = join(DIST_DIR, 'manifest.json')

// Entries loaded dynamically by other JS (not linked from any HTML page).
const DYNAMIC_INJECTED = new Set(['emoji-data.js'])

function fail(msgs) {
  console.error('FAIL: dist wiring check found issues:')
  for (const m of msgs) console.error(`  ✗ ${m}`)
  console.error('')
  console.error('  The deploy was aborted before upload. Re-run: node scripts/build.mjs --prod --wire-html')
  process.exit(1)
}

if (!existsSync(MANIFEST_PATH)) {
  console.log('PASS (skipped): no dist/manifest.json — tree is in canonical (unwired) form')
  process.exit(0)
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const htmlFiles = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))
if (htmlFiles.length === 0) fail(['no HTML files found in public/'])

// Collect every /dist/… reference across pages + whether wiring happened at all.
const distRefs = [] // all /dist/x.<hash>.js|css refs seen
const wiredPages = new Set()
for (const html of htmlFiles) {
  const content = readFileSync(join(PUBLIC_DIR, html), 'utf8')
  const refs = content.match(/\/dist\/[A-Za-z0-9_-]+\.[0-9a-f]{8}\.(?:js|css)/g) ?? []
  if (refs.length > 0) wiredPages.add(html)
  distRefs.push(...refs)
}

if (wiredPages.size === 0) {
  console.log('PASS (skipped): no wired pages — tree is in canonical (unwired) form')
  process.exit(0)
}

const problems = []

// 1. every dist ref matches the manifest
const manifestValues = new Set(Object.values(manifest).map((v) => `/${v}`))
for (const ref of new Set(distRefs)) {
  if (!manifestValues.has(ref)) problems.push(`HTML references ${ref} which is NOT in the manifest`)
}

// 2. every manifest JS/CSS entry is referenced (pages or dynamic allowlist)
const referenced = new Set(distRefs)
for (const [logical, hashed] of Object.entries(manifest)) {
  if (!hashed.startsWith('dist/')) continue
  if (DYNAMIC_INJECTED.has(logical)) continue
  if (!referenced.has(`/${hashed}`)) {
    problems.push(`manifest entry ${logical} → /${hashed} is not referenced by any HTML page`)
  }
}

// 3. no orphan files in dist/
const distFiles = readdirSync(DIST_DIR).filter((f) => f !== 'manifest.json')
const manifestFiles = new Set(Object.values(manifest).filter((v) => v.startsWith('dist/')).map((v) => v.slice('dist/'.length)))
for (const f of distFiles) {
  if (!manifestFiles.has(f)) problems.push(`dist/${f} exists on disk but is not in the manifest (orphan — would be served immutable)`)
}
// (dev sourcemaps are fine in non-wired trees; a WIRED tree must be prod → no .maps)
for (const f of distFiles) {
  if (f.endsWith('.map')) problems.push(`dist/${f} — sourcemaps must not ship in a wired (prod) build`)
}

// 4. no unwired refs to manifest-covered files
for (const [logical] of Object.entries(manifest)) {
  if (!logical.endsWith('.js') && !logical.endsWith('.css')) continue
  if (!logical.includes('/')) { // page entries only (vendor/* entries are unhashed by design)
    const re = new RegExp(`["']/(?:js|css)/${logical.replace(/\./g, '\\.')}(?:\\?v=\\d+)?["']`)
    for (const html of wiredPages) {
      const content = readFileSync(join(PUBLIC_DIR, html), 'utf8')
      if (re.test(content)) problems.push(`${html} still references the unwired /${logical.endsWith('.css') ? 'css' : 'js'}/${logical} (wiring incomplete)`)
    }
  }
}

// 5. the SW must use the manifest-driven precache
const sw = readFileSync(join(PUBLIC_DIR, 'sw.js'), 'utf8')
if (!sw.includes('/dist/manifest.json')) problems.push('sw.js does not reference /dist/manifest.json — the SW precache is not manifest-driven')

if (problems.length > 0) fail(problems)

console.log(`PASS: dist wiring is consistent — ${wiredPages.size} wired page(s), ${distRefs.length} refs, ${distFiles.length} dist file(s), manifest covers all`)
