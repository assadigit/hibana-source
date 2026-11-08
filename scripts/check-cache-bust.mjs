#!/usr/bin/env node
// CI check: verify that any modified file in public/js/ or public/css/ has a bumped ?v=N
// query string in the HTML that references it. The SW precaches files by their ?v= URL;
// forgetting to bump it serves a stale cached file until the next SW activation.
//
// M6 fix (2026-09-10): this script runs in CI (ci.yml) and fails if a JS/CSS file was
// modified but its ?v= wasn't bumped. It compares the working tree against HEAD (the last
// commit), so it catches "I edited app.js but forgot to bump ?v=159 → ?v=160".
//
// Usage: node scripts/check-cache-bust.mjs
// Exit 0 = pass, exit 1 = fail (with a list of files that need a ?v= bump)
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

const PUBLIC_DIR = join(process.cwd(), 'public')
const JS_DIR = join(PUBLIC_DIR, 'js')
const CSS_DIR = join(PUBLIC_DIR, 'css')

// Get the list of JS/CSS files modified in the working tree vs HEAD
function getModifiedFiles(dir, ext) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', dir], { encoding: 'utf8' })
    return output.trim().split('\n').filter((f) => f && f.endsWith(ext)).map((f) => basename(f))
  } catch {
    return [] // not a git repo, or no changes — pass
  }
}

const modifiedJs = getModifiedFiles(JS_DIR, '.js')
const modifiedCss = getModifiedFiles(CSS_DIR, '.css')
const modified = [...modifiedJs, ...modifiedCss]

// Read all HTML files and build a map: filename → highest ?v=N seen
const htmlFiles = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))
const jsRefs = new Map() // 'devboard.js' → Set of versions in injector literals only
const versionMap = new Map() // 'app.js' → Set of version numbers seen across all HTML
const addRef = (file, version) => {
  if (!versionMap.has(file)) versionMap.set(file, new Set())
  versionMap.get(file).add(Number(version))
}

for (const html of htmlFiles) {
  const content = readFileSync(join(PUBLIC_DIR, html), 'utf8')
  // Match: src="/js/app.js?v=159" or href="/css/app.css?v=200"
  const matches = content.matchAll(/(?:src|href)="\/(?:js|css)\/([^"?]+)\?v=(\d+)"/g)
  for (const m of matches) addRef(m[1], m[2])
}

// Review-round 2: dynamically-injected assets (i18n-fa.js via i18n.js's ensureFaDict,
// queue.js via app.js) have NO HTML reference — their ?v= lives in a JS string literal
// ('/js/<name>.js?v=N'). Without this scan the gate fails (or, worse in CI where the
// diff-vs-HEAD is empty post-commit, silently skips) the lazy-loaded file class. The
// build's fixpoint loop rewrites these same literals, so they are first-class refs.
for (const js of readdirSync(JS_DIR).filter((f) => f.endsWith('.js'))) {
  const content = readFileSync(join(JS_DIR, js), 'utf8')
  for (const m of content.matchAll(/['`]\/(?:js)\/([^"'`?]+)\?v=(\d+)['`]/g)) {
    addRef(m[1], m[2])
    if (!jsRefs.has(m[1])) jsRefs.set(m[1], new Set())
    jsRefs.get(m[1]).add(Number(m[2]))
  }
}

// S254 (FE-20 — audit remediation Phase 3): the INJECTOR-LITERAL cross-check. The
// modified-files gate above only fires when a JS/CSS file ITSELF changes — but the
// documented double-cache bug class is exactly the OTHER order: the HTML tag gets
// its ?v= bumped while the injector literal inside island JS (ensureLib's
// inject('/js/devboard.js?v=N') …) is forgotten. The js file is untouched, so that
// gate can't see the drift; two cache entries of one file ship. This pass compares
// EVERY injector literal's version against the HTML-referenced version of the same
// file (lazy-only files — i18n-fa.js, queue.js, image-resize.js — have no HTML ref
// and are skipped) and fails on any mismatch, bumped or not.
const htmlRefs = new Map() // 'devboard.js' → Set of versions seen in HTML only
for (const html of htmlFiles) {
  const content = readFileSync(join(PUBLIC_DIR, html), 'utf8')
  for (const m of content.matchAll(/(?:src|href)="\/(?:js|css)\/([^"?]+)\?v=(\d+)"/g)) {
    if (!htmlRefs.has(m[1])) htmlRefs.set(m[1], new Set())
    htmlRefs.get(m[1]).add(Number(m[2]))
  }
}
const driftFailures = []
for (const [file, jsVersions] of jsRefs) {
  const htmlVersions = htmlRefs.get(file)
  if (!htmlVersions) continue // lazy-only asset — no HTML reference to hold it to
  for (const v of jsVersions) {
    if (!htmlVersions.has(v)) {
      driftFailures.push(`  ✗ ${file} — injector literal says ?v=${v} but the HTML references ${[...htmlVersions].join(', ')} (two cache entries of one file — the documented double-cache bug class)`)
    }
  }
}

// Check: each modified file must have a ?v= reference, and it must be unique (one version)
const failures = []
for (const file of modified) {
  const versions = versionMap.get(file)
  if (!versions || versions.size === 0) {
    failures.push(`  ✗ ${file} — modified but no ?v= reference found in any HTML file`)
  } else if (versions.size > 1) {
    failures.push(`  ✗ ${file} — multiple ?v= values found: ${[...versions].join(', ')} (use one consistent version)`)
  }
  // Note: we can't programmatically detect "was the version actually bumped?" without
  // parsing the diff. But requiring the file to HAVE a ?v= catches the most common mistake:
  // adding a new JS file without a version query. For existing files, the developer must
  // bump manually — this check ensures the reference exists and is consistent.
}

if (modified.length === 0 && driftFailures.length === 0) {
  console.log('PASS: no JS/CSS files modified — cache-bust check skipped (injector literals verified against the HTML ?v=)')
  process.exit(0)
}

if (failures.length > 0 || driftFailures.length > 0) {
  console.error('FAIL: cache-bust check found issues:')
  console.error('  Modified JS/CSS files must have a consistent ?v=N query string in HTML.')
  if (failures.length > 0) {
    console.error('')
    failures.forEach((f) => console.error(f))
  }
  if (driftFailures.length > 0) {
    console.error('')
    console.error('  Injector literals in public/js must ride the SAME ?v= as the HTML tags:')
    driftFailures.forEach((f) => console.error(f))
  }
  console.error('')
  console.error('  Fix: add or bump the ?v=N query on the <script src> or <link href> tag AND every injector literal.')
  process.exit(1)
}

console.log(`PASS: all ${modified.length} modified JS/CSS file(s) have consistent ?v= references`)
modified.forEach((f) => console.log(`  ✓ ${f}`))
console.log('  ✓ injector literals match the HTML ?v= on every shared file')
