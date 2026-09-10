// P3-a (2026-09-10): esbuild-based asset bundling + content hashing.
//
// What this does:
//   1. Bundles each entry-point JS file in public/js/ into a single minified file
//      with a content-hash suffix (e.g. app.js → app.[hash].js)
//   2. Minifies public/css/*.css → <name>.[hash].css
//   3. Writes a manifest.json mapping logical names → hashed filenames
//   4. (dr-integrity session, --wire-html) rewrites every HTML page's /js|css asset
//      references to the hashed /dist/ URLs, plus the quoted '/js/<name>.js' literals
//      inside the bundles themselves (the dynamic-injection graph). Deploy-only: the
//      COMMITTED HTML keeps the human-editable ?v= URLs; --restore-html puts them back
//      after wrangler deploy has uploaded the wired copies. docs/dr-integrity-closeout.md §5.
//
// What this does NOT do (yet — future iterations):
//   - Tree-shaking across page scripts (each entry is bundled independently)
//   - Code splitting (shared chunks) — each page still loads its own bundle
//   - ESM conversion (files stay as IIFE globals for Alpine/htmx compatibility)
//
// The immediate win: content-hashed filenames mean the SW + browser cache them forever
// (immutable, no more manual ?v=N bumps on the DEPLOYED artifact), and the byte the
// browser caches is provably current — the stale-pin failure class becomes structurally
// impossible for app assets.

import { build, context } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'

const PUBLIC_DIR = join(process.cwd(), 'public')
const JS_DIR = join(PUBLIC_DIR, 'js')
const CSS_DIR = join(PUBLIC_DIR, 'css')
const VENDOR_DIR = join(PUBLIC_DIR, 'vendor')
const DIST_DIR = join(PUBLIC_DIR, 'dist')
const MANIFEST_PATH = join(DIST_DIR, 'manifest.json')
// Wired-HTML backup — OUTSIDE public/ so it can never be deployed, and gitignored.
const BACKUP_DIR = join(process.cwd(), '.build-backup')

const WATCH = process.argv.includes('--watch')
const PROD = process.argv.includes('--prod')
const WIRE_HTML = process.argv.includes('--wire-html')
const RESTORE_HTML = process.argv.includes('--restore-html')

// Entry points: every page JS file (the union of what HTML references + what the SW
// precaches). Vendor libs (fabric, htmx, alpine) are copied as-is — they're already
// minified and bundling them would lose their UMD global.
// dr-integrity session: whiteboard.js, tour.js, emoji-data.js added — they were
// referenced by pages/SW but never bundled (wiring needs ALL of them hashed).
const ENTRY_POINTS = [
  'app.js', 'admin.js', 'boot.js', 'canvas.js', 'command-palette.js',
  'devboard.js', 'emoji-data.js', 'emoji-picker.js', 'go-to.js', 'i18n.js',
  'install-prompt.js', 'jalali-holidays.js', 'mobile-nav.js', 'nav.js', 'queue.js',
  'touch-drag.js', 'tour.js', 'whiteboard.js', 'zen-mode.js', 'micro-interactions.js',
]

// Page CSS files (all linked from HTML; all hashed + immutable via manifest).
// Session 25 Phase 1 (refactor): app.css (8,822 lines) split into 16 modular files by
// contiguous section — byte-identical concatenation, zero cascade change.
// Session 25 Phase 1.5 (Option B): dark-theme rules extracted to themes.css (loaded LAST
// among feature files) + RTL rules extracted to rtl.css (loaded after themes.css).
// Both are safe by specificity: html[data-theme='dark'] (0,2,1) and [dir='rtl'] (0,1,0)
// prefix selectors beat base rules. rtl.css loads after themes.css so RTL overrides
// always win (the intended behavior for directional overrides).
// Order matters: 16 feature files → themes.css (dark overrides) → rtl.css (directional) →
// task-controls.css (separate concern).
const CSS_ENTRY_POINTS = [
  'variables.css', 'base.css', 'layout.css', 'dashboard.css', 'dashboard-todo.css',
  'components.css', 'canvas.css', 'quicknotes.css', 'to-do-list.css', 'polish-ui.css',
  'calendar.css', 'notifications.css', 'polish-batch.css', 'project-header.css',
  'devboard.css', 'misc.css', 'themes.css', 'rtl.css', 'task-controls.css',
]

// In-bundle dynamic-injection literals that get rewritten to hashed URLs during wiring.
// app.js injects /js/queue.js; emoji-picker.js injects /js/emoji-data.js?v=1.
// (nav.js needs no rewrite — soft-navigation reads the TARGET page's own <script src>,
// which the HTML wiring has already hashed.)
const BUNDLE_LITERAL_PREFIX = '/js/'

function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8)
}

async function buildAssets() {
  mkdirSync(DIST_DIR, { recursive: true })
  const manifest = {}

  // 1. Bundle every JS entry point into memory FIRST (raw code, before any in-bundle
  //    literal rewriting). The rewrite needs the TARGET entry's final URL, and targets
  //    can appear earlier OR later in ENTRY_POINTS than their referencer (app.js —
  //    entry #1 — injects queue.js — entry #15), so hashing happens in a FIXPOINT loop
  //    below instead of a single ordered pass.
  const rawCodes = new Map()
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
    rawCodes.set(entry, result.outputFiles[0].text)
  }

  // 2. Fixpoint: rewrite each bundle's quoted '/js/<entry>.js' literals to the hashed
  //    URLs (the dynamic-injection graph becomes immutable too), hashing the REWRITTEN
  //    bytes. Iteration 0 seeds provisional hashes (no urls known → no rewrites); a
  //    referencer picks up its target's url in the next pass; leaf files converge
  //    immediately. 2–3 passes reach a fixpoint; 5 is a hard stop (paranoia).
  const urls = new Map() // entry → 'dist/<name>.<hash>.js'
  const finalCodes = new Map()
  for (let iter = 0; iter < 5; iter++) {
    let changed = false
    for (const [entry, raw] of rawCodes) {
      let code = raw
      if (WIRE_HTML) {
        for (const other of ENTRY_POINTS) {
          if (other === entry) continue
          const target = urls.get(other)
          if (!target) continue
          code = code.split(`'${BUNDLE_LITERAL_PREFIX}${other}'`).join(`'/${target}'`)
          code = code.split(`"${BUNDLE_LITERAL_PREFIX}${other}"`).join(`"/${target}"`)
          // also the ?v=N spelling (emoji-picker injects '/js/emoji-data.js?v=1')
          code = code.replace(new RegExp(`(['"])${BUNDLE_LITERAL_PREFIX}${other.replace(/\./g, '\\.')}\\?v=\\d+\\1`, 'g'), `$1/${target}$1`)
        }
      }
      const hash = fileHash(code)
      const url = `dist/${entry.replace(/\.js$/, `.${hash}.js`)}`
      if (urls.get(entry) !== url) {
        urls.set(entry, url)
        changed = true
      }
      finalCodes.set(entry, code)
    }
    if (!changed) break
  }

  // 3. Write the bundles
  for (const [entry, code] of finalCodes) {
    const url = urls.get(entry)
    writeFileSync(join(DIST_DIR, basename(url)), code)
    manifest[entry] = url
    console.log(`  ✓ ${entry} → ${url} (${(code.length / 1024).toFixed(1)}KB)`)
  }

  // 2. Minify + hash each CSS entry point
  for (const cssEntry of CSS_ENTRY_POINTS) {
    const cssSrc = join(CSS_DIR, cssEntry)
    if (!existsSync(cssSrc)) continue
    const cssResult = await build({
      entryPoints: [cssSrc],
      bundle: false,
      minify: PROD,
      write: false,
      loader: { '.css': 'css' },
    })
    const css = cssResult.outputFiles[0].text
    const hash = fileHash(css)
    const hashedName = cssEntry.replace(/\.css$/, `.${hash}.css`)
    writeFileSync(join(DIST_DIR, hashedName), css)
    manifest[cssEntry] = `dist/${hashedName}`
    console.log(`  ✓ ${cssEntry} → dist/${hashedName} (${(css.length / 1024).toFixed(1)}KB)`)
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
  //    filenames, and _headers serves /dist/*.js|css as immutable — an unhashed
  //    file there would be pinned stale forever by the browser. dist/ contains
  //    ONLY content-hashed files (or the manifest), which is what the immutable rule requires.
  if (existsSync(VENDOR_DIR)) {
    for (const file of readdirSync(VENDOR_DIR)) {
      if (file === 'fabric.min.js') continue // already handled above (writes into vendor/)
      const st = statSync(join(VENDOR_DIR, file))
      if (st.isDirectory()) {
        manifest[`vendor/${file}`] = `vendor/${file}`
      } else if (file.endsWith('.js') || file.endsWith('.css')) {
        manifest[`vendor/${file}`] = `vendor/${file}`
      }
    }
  }

  // 5. Write manifest
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  console.log(`\n  ✓ manifest.json written (${Object.keys(manifest).length} entries)`)

  // 5b. Purge stale hashed files (PROD builds only — dev keeps .map sidecars alive).
  // dist/ is now a DEPLOYED surface served immutable: a file from an older build would
  // be pinned forever under a name nothing references (dead weight) — worse, check-dist-
  // wiring treats orphans as a deploy-abort condition (correctly). Keep only manifest
  // entries (+ their .map sidecars) + the manifest itself.
  if (PROD) {
    const keep = new Set(
      Object.values(manifest)
        .filter((v) => v.startsWith('dist/'))
        .flatMap((v) => [v.slice('dist/'.length), `${v.slice('dist/'.length)}.map`]),
    )
    keep.add('manifest.json')
    let removed = 0
    for (const file of readdirSync(DIST_DIR)) {
      if (keep.has(file)) continue
      if (!/\.(js|css|map)$/.test(file)) continue
      rmSync(join(DIST_DIR, file))
      removed++
    }
    if (removed > 0) console.log(`  ✓ purged ${removed} stale dist file(s) from previous builds`)
  }

  // 6. Wire HTML (deploy-only, --wire-html)
  if (WIRE_HTML) wireHtml(manifest)
}

// ─── HTML wiring (dr-integrity session) ─────────────────────────────────────────
// Canonical committed HTML references /js/<name>.js?v=N + /css/<name>.css?v=N (human-
// editable; check-cache-bust guards that discipline). This step rewrites, IN PLACE, each
// page's references to the hashed /dist/ URLs so the deployed artifact is content-
// addressed + immutable. The originals are backed up to .build-backup/ (outside public/)
// and restored after deploy via --restore-html — never via git, which could eat
// uncommitted operator edits.
//
// INVARIANT (learned the hard way during this session's own verification): the backup
// must ONLY ever contain CANONICAL pages. A page that is already wired (carries /dist/
// refs) is re-wired idempotently but is NEVER written into the backup — a backup holding
// wired content would make --restore-html restore garbage. And if a wired page has NO
// canonical backup, wiring ABORTS (fail loudly: recover the canonical file from git or a
// previous backup first; a silent unrestorable tree is the worse outcome by far).
function wireHtml(manifest) {
  const htmlFiles = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html'))
  mkdirSync(BACKUP_DIR, { recursive: true })
  let wired = 0
  let refs = 0
  const problems = []
  for (const html of htmlFiles) {
    const path = join(PUBLIC_DIR, html)
    const original = readFileSync(path, 'utf8')
    const alreadyWired = /\/dist\/[A-Za-z0-9_-]+\.[0-9a-f]{8}\.(?:js|css)/.test(original)
    const backupPath = join(BACKUP_DIR, html)
    const hasCanonicalBackup = existsSync(backupPath)
    if (alreadyWired && !hasCanonicalBackup) {
      problems.push(`${html} is already wired but has no canonical backup — refusing to continue (recover the canonical file first)`)
      continue
    }
    let out = original
    for (const [logical, hashed] of Object.entries(manifest)) {
      if (!hashed.startsWith('dist/')) continue
      const name = logical // e.g. 'app.js' | 'task-controls.css'
      const kind = name.endsWith('.css') ? 'css' : 'js'
      // src="/js/app.js?v=159" / src="/js/app.js" / href="/css/app.css?v=201" / already-wired
      // /dist/app.<oldhash>.js (idempotent re-runs on a previously wired tree).
      const patterns = [
        new RegExp(`(["'])/(?:js|css)/${name.replace(/\./g, '\\.')}(?:\\?v=\\d+)?\\1`, 'g'),
        new RegExp(`(["'])/${hashed.replace(/\./g, '\\.')}\\1`, 'g'),
        new RegExp(`(["'])/dist/${name.replace(/\.js$/, '').replace(/\.css$/, '')}\\.[0-9a-f]{8}\\.${kind}\\1`, 'g'),
      ]
      for (const re of patterns) {
        out = out.replace(re, `$1/${hashed}$1`)
      }
    }
    // count how many dist refs this page now carries
    refs += (out.match(/\/dist\/[a-z0-9-]+\.[0-9a-f]{8}\.(?:js|css)/g) ?? []).length
    const mode = statSync(path).mode & 0o777 // git-tracked pages are 0755 — preserve it
    if (out !== original) {
      // Backup ONLY canonical content: an already-wired page's canonical form is the
      // backup that already exists (or the abort branch above fired).
      if (!alreadyWired) {
        writeFileSync(backupPath, original)
        chmodSync(backupPath, mode)
      }
      writeFileSync(path, out)
      chmodSync(path, mode)
      wired++
    } else if (!alreadyWired) {
      // untouched canonical page — back it up so --restore-html is a full-tree restore
      writeFileSync(backupPath, original)
      chmodSync(backupPath, mode)
    }
  }
  if (problems.length > 0) {
    console.error('\nWIRING ABORTED — canonical-HTML invariant violated:')
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error('  Recover the canonical HTML (git checkout -- public/<page> or a prior .build-backup) and re-run.')
    process.exit(1)
  }
  const backedUp = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.html')).length
  console.log(`  ✓ HTML wired: ${wired}/${htmlFiles.length} page(s) rewritten, ${refs} dist reference(s) (canonical backups: ${backedUp})`)
}

// ─── Restore canonical HTML (--restore-html, runs after wrangler deploy) ───────
function restoreHtml() {
  if (!existsSync(BACKUP_DIR)) {
    console.log('  (no .build-backup/ found — nothing to restore)')
    return
  }
  let restored = 0
  let wiredBackups = 0
  for (const file of readdirSync(BACKUP_DIR)) {
    if (!file.endsWith('.html')) continue
    const content = readFileSync(join(BACKUP_DIR, file), 'utf8')
    // The invariant says backups are canonical-only; if one somehow holds wired content,
    // DO NOT restore it (that would write wired HTML into the working tree) — warn and
    // leave the page as-is for manual recovery.
    if (/\/dist\/[A-Za-z0-9_-]+\.[0-9a-f]{8}\.(?:js|css)/.test(content)) {
      console.error(`  ⚠ .build-backup/${file} holds WIRED content — not restoring it; recover public/${file} from git.`)
      wiredBackups++
      continue
    }
    const mode = statSync(join(BACKUP_DIR, file)).mode & 0o777
    copyFileSync(join(BACKUP_DIR, file), join(PUBLIC_DIR, file))
    chmodSync(join(PUBLIC_DIR, file), mode)
    restored++
  }
  rmSync(BACKUP_DIR, { recursive: true, force: true })
  console.log(`  ✓ canonical HTML restored (${restored} page(s)) — working tree is back to the ?v= source form`)
  if (wiredBackups > 0) {
    console.error(`  ✗ ${wiredBackups} page(s) could not be restored from backup — run: git checkout -- public/`)
    process.exit(1)
  }
}

if (RESTORE_HTML) {
  restoreHtml()
  process.exit(0)
}

if (WATCH) {
  console.log('Watching for changes...')
  // Simple watch: rebuild on any JS/CSS change
  const { watch } = await import('node:fs')
  watch(JS_DIR, { recursive: true }, buildAssets)
  watch(CSS_DIR, { recursive: true }, buildAssets)
} else {
  console.log(`Building assets (${PROD ? 'production' : 'development'}${WIRE_HTML ? ' + HTML wiring' : ''})...`)
  await buildAssets()
  console.log('Done.')
}
