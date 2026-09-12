// check-bundle-size.mjs — bundle-size tracking for CI.
//
// Runs after `node scripts/build.mjs --prod` and checks the total + per-file
// sizes of /dist/ against a baseline. Fails if any file grows >25% or if the
// total /dist/ size grows >15% (catches accidental bloat regressions).
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

// Collect current sizes
const files = readdirSync(DIST).filter(f => f.endsWith('.js') || f.endsWith('.css'))
const current = {}
let totalSize = 0
for (const f of files) {
  const size = statSync(join(DIST, f)).size
  current[f] = size
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

// Check per-file growth (>25% = fail)
for (const f of files) {
  const cur = current[f]
  const base = baseline.files[f]
  if (!base) continue // new file — not a regression
  const growth = ((cur - base) / base) * 100
  if (growth > 25) {
    findings.push(`${f} grew ${growth.toFixed(1)}% (threshold: 25%) — ${cur} bytes (was ${base})`)
  }
}

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
