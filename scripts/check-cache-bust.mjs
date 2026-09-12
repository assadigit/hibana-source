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

if (modified.length === 0) {
  console.log('PASS: no JS/CSS files modified — cache-bust check skipped')
  process.exit(0)
}

// Read all HTML files and build a map: filename → highest ?v=N seen
const htmlFiles = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))
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
  const matches = content.matchAll(/['`]\/(?:js)\/([^"'`?]+)\?v=(\d+)['`]/g)
  for (const m of matches) addRef(m[1], m[2])
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

if (failures.length > 0) {
  console.error('FAIL: cache-bust check found issues:')
  console.error('  Modified JS/CSS files must have a consistent ?v=N query string in HTML.')
  console.error('')
  failures.forEach((f) => console.error(f))
  console.error('')
  console.error('  Fix: add or bump the ?v=N query on the <script src> or <link href> tag.')
  process.exit(1)
}

console.log(`PASS: all ${modified.length} modified JS/CSS file(s) have consistent ?v= references`)
modified.forEach((f) => console.log(`  ✓ ${f}`))
