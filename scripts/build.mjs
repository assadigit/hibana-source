// P3-a (2026-09-10): esbuild-based asset bundling + content hashing.
//
// What this does:
//   1. Bundles each entry-point JS file in public/js/ into a single minified file
//      with a content-hash suffix (e.g. app.js → app.[hash].js)
//   2. Minifies public/css/app.css → app.[hash].css
//   3. Writes a manifest.json mapping logical names → hashed filenames
//   4. The HTML files are NOT rewritten by this script (that would require an HTML parser
//      and a separate pass). Instead, the manifest is consumed at serve-time by a small
//      <script> that maps logical names to hashed URLs. This keeps the build simple and
//      the HTML editable.
//
// What this does NOT do (yet — future iterations):
//   - Tree-shaking across page scripts (each entry is bundled independently)
//   - Code splitting (shared chunks) — each page still loads its own bundle
//   - HTML rewriting to swap <script src> tags automatically
//   - ESM conversion (files stay as IIFE globals for Alpine/htmx compatibility)
//
// The immediate win: content-hashed filenames mean the SW can cache them forever
// (no more manual ?v=N bumps), and the browser never serves a stale file.

import { build, context } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'

const PUBLIC_DIR = join(process.cwd(), 'public')
const JS_DIR = join(PUBLIC_DIR, 'js')
const CSS_DIR = join(PUBLIC_DIR, 'css')
const VENDOR_DIR = join(PUBLIC_DIR, 'vendor')
const DIST_DIR = join(PUBLIC_DIR, 'dist')
const MANIFEST_PATH = join(DIST_DIR, 'manifest.json')

const WATCH = process.argv.includes('--watch')
const PROD = process.argv.includes('--prod')

// Entry points: the page-specific JS files that should be bundled.
// Vendor libs (fabric, htmx, alpine) are copied as-is — they're already minified
// and bundling them would lose their UMD global.
const ENTRY_POINTS = [
  'app.js', 'admin.js', 'boot.js', 'canvas.js', 'command-palette.js',
  'devboard.js', 'emoji-picker.js', 'go-to.js', 'i18n.js', 'install-prompt.js',
  'jalali-holidays.js', 'mobile-nav.js', 'nav.js', 'queue.js', 'touch-drag.js',
  'zen-mode.js', 'micro-interactions.js',
]

function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8)
}

async function buildAssets() {
  mkdirSync(DIST_DIR, { recursive: true })
  const manifest = {}

  // 1. Bundle + hash each JS entry point
  for (const entry of ENTRY_POINTS) {
    const srcPath = join(JS_DIR, entry)
    if (!existsSync(srcPath)) continue

    const result = await build({
      entryPoints: [srcPath],
      bundle: false, // don't bundle imports — these are IIFE globals, not ESM
      minify: PROD,
      sourcemap: PROD ? false : 'linked',
      write: false,
      target: ['es2020'],
      format: 'iife',
    })

    const code = result.outputFiles[0].text
    const hash = fileHash(code)
    const hashedName = entry.replace(/\.js$/, `.${hash}.js`)
    const outPath = join(DIST_DIR, hashedName)
    writeFileSync(outPath, code)
    manifest[entry] = `dist/${hashedName}`
    console.log(`  ✓ ${entry} → dist/${hashedName} (${(code.length / 1024).toFixed(1)}KB)`)
  }

  // 2. Minify + hash app.css
  const cssSrc = join(CSS_DIR, 'app.css')
  if (existsSync(cssSrc)) {
    const cssResult = await build({
      entryPoints: [cssSrc],
      bundle: false,
      minify: PROD,
      write: false,
      loader: { '.css': 'css' },
    })
    const css = cssResult.outputFiles[0].text
    const hash = fileHash(css)
    const hashedName = `app.${hash}.css`
    writeFileSync(join(DIST_DIR, hashedName), css)
    manifest['app.css'] = `dist/${hashedName}`
    console.log(`  ✓ app.css → dist/${hashedName} (${(css.length / 1024).toFixed(1)}KB)`)
  }

  // 3. Bundle fabric v6 shim → public/vendor/fabric.min.js (L14 fix, 2026-09-10).
  // Fabric v6 is ESM-only; this shim imports the v6 classes and assigns them to window.fabric,
  // producing a UMD-style global that canvas.js/whiteboard.js can load via <script src>.
  // Replaces the old static public/vendor/fabric.min.js (v5.3.0 UMD).
  const shimSrc = join(process.cwd(), 'src', 'vendor', 'fabric-shim.ts')
  if (existsSync(shimSrc)) {
    const shimResult = await build({
      entryPoints: [shimSrc],
      bundle: true, // bundle the fabric v6 ESM dependency into one file
      minify: PROD,
      write: false,
      target: ['es2020'],
      format: 'iife', // immediately-invoked function expression — sets window.fabric
      globalName: 'fabricShim',
      sourcemap: PROD ? false : 'linked',
      loader: { '.ts': 'ts' },
    })
    const shimCode = shimResult.outputFiles[0].text
    // Write to public/vendor/fabric.min.js (replaces the old v5 file)
    writeFileSync(join(VENDOR_DIR, 'fabric.min.js'), shimCode)
    manifest['vendor/fabric.min.js'] = 'vendor/fabric.min.js'
    console.log(`  ✓ fabric v6 shim → vendor/fabric.min.js (${(shimCode.length / 1024).toFixed(1)}KB)`)
  }

  // 4. Copy remaining vendor libs as-is (htmx, alpine, vazir — already minified).
  //    Perf session (2026-09-10): these are copied to PUBLIC/VENDOR ONLY — the copy
  //    into dist/ was removed. Two reasons: (1) nothing references /dist/<vendor> (HTML
  //    loads /vendor/*), so those copies were dead weight; (2) they are UNHASHED
  //    filenames, and _headers now serves /dist/*.js|css as immutable — an unhashed
  //    file there would be pinned stale forever by the browser. dist/ now contains
  //    ONLY content-hashed files, which is what the immutable rule requires.
  if (existsSync(VENDOR_DIR)) {
    for (const file of readdirSync(VENDOR_DIR)) {
      if (file === 'fabric.min.js') continue // already handled above (writes into vendor/)
      manifest[`vendor/${file}`] = `vendor/${file}`
    }
  }

  // 4. Write manifest
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  console.log(`\n  ✓ manifest.json written (${Object.keys(manifest).length} entries)`)
  console.log(`  → HTML files should reference dist/[hashed-name] instead of js/[name]?v=N`)
}

if (WATCH) {
  console.log('Watching for changes...')
  // Simple watch: rebuild on any JS/CSS change
  const { watch } = await import('node:fs')
  watch(JS_DIR, { recursive: true }, buildAssets)
  watch(CSS_DIR, { recursive: true }, buildAssets)
} else {
  console.log(`Building assets (${PROD ? 'production' : 'development'})...`)
  await buildAssets()
  console.log('Done.')
}
