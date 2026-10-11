// check-bundle-size.mjs — bundle-size tracking for CI.
//
// Runs after `node scripts/build.mjs --prod` and checks the total + per-file
// sizes of /dist/ against a baseline. Fails if any file grows >25% or if the
// total /dist/ size grows >15% (catches accidental bloat regressions).
//
// S200 (PERF-4): per-file compare keys on the LOGICAL manifest name
// (`app.js`), not the content-hashed filename (`app.fad349f1.js`). Hashed keys
// made the guard structurally dead: any edit changes the hash → the "new" file
// has no baseline entry → `continue` → per-file regressions NEVER fired. Only
// the +15% total guard was real. Logical keys survive re-hashing, so a file
// that doubles between releases now fails as it should.
//
// Run: node scripts/check-bundle-size.mjs
// CI: wired into .github/workflows/ci.yml (after the build step).
//
// Baseline is stored in scripts/bundle-size-baseline.json. Update it with:
//   node scripts/check-bundle-size.mjs --update-baseline

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = join(process.cwd(), 'public', 'dist')
const BASELINE_PATH = join(process.cwd(), 'scripts', 'bundle-size-baseline.json')

if (!existsSync(DIST)) {
  console.error('FAIL: public/dist/ does not exist. Run `node scripts/build.mjs --prod` first.')
  process.exit(1)
}

// `app.fad349f1.js` → `app.js` (build.mjs appends an 8-hex content hash before
// the extension; vendor files carry no hash and pass through unchanged).
const logicalName = (f) => f.replace(/\.[0-9a-f]{8}\.(js|css)$/, '.$1')

// Collect current sizes (keyed by logical name)
const files = readdirSync(DIST).filter((f) => f.endsWith('.js') || f.endsWith('.css'))
const current = {}
let totalSize = 0
for (const f of files) {
  const size = statSync(join(DIST, f)).size
  const key = logicalName(f)
  if (key in current) {
    console.error(`FAIL: two dist files share the logical name "${key}" — the build should never emit that.`)
    process.exit(1)
  }
  current[key] = size
  totalSize += size
}

const updateBaseline = process.argv.includes('--update-baseline')

if (updateBaseline || !existsSync(BASELINE_PATH)) {
  // Establish/update the baseline
  const baseline = { totalSize, files: current, updatedAt: new Date().toISOString() }
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`✓ Baseline ${updateBaseline ? 'updated' : 'created'}: ${totalSize} bytes total, ${files.length} files`)
  console.log(`  Saved to: ${BASELINE_PATH}`)
  if (!updateBaseline) console.log('  (First run — baseline established. Subsequent runs will compare against this.)')
  process.exit(0)
}

// Compare against baseline
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const findings = []

// Check total size growth (>15% = fail)
const totalGrowth = ((totalSize - baseline.totalSize) / baseline.totalSize) * 100
if (totalGrowth > 15) {
  findings.push(`Total /dist/ size grew ${totalGrowth.toFixed(1)}% (threshold: 15%) — ${totalSize} bytes (was ${baseline.totalSize})`)
}

// Check per-file growth (>25% = fail), keyed on LOGICAL names (S200/PERF-4 —
// a re-hashed file keeps its logical key, so growth is actually compared).
const removed = []
for (const [key, cur] of Object.entries(current)) {
  const base = baseline.files[key]
  if (base === undefined) continue // genuinely new file — not a regression
  const growth = ((cur - base) / base) * 100
  if (growth > 25) {
    findings.push(`${key} grew ${growth.toFixed(1)}% (threshold: 25%) — ${cur} bytes (was ${base})`)
  }
}
for (const key of Object.keys(baseline.files)) {
  if (!(key in current)) removed.push(key)
}
if (removed.length) console.log(`  (baseline-only entries, no current file: ${removed.join(', ')})`)

// Report
console.log(`Bundle size: ${totalSize} bytes total, ${files.length} files (baseline: ${baseline.totalSize} bytes)`)
console.log(`Growth: ${totalGrowth >= 0 ? '+' : ''}${totalGrowth.toFixed(1)}%`)

if (findings.length === 0) {
  console.log('PASS: no bundle-size regressions detected')
  process.exit(0)
} else {
  console.error(`\nFAIL: ${findings.length} bundle-size regression(s) detected:`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('\nTo update the baseline (if the growth is intentional):')
  console.error('  node scripts/check-bundle-size.mjs --update-baseline')
  process.exit(1)
}
