// check-i18n-parity.mjs — W8 (SWOT Session 26)
//
// Verifies EN + FA i18n dictionaries have identical key sets (recursive).
// Phase 3c moved the dictionaries from i18n.js to i18n-en.js + i18n-fa.js; the old
// audit-consistency.mjs parity check broke because it regex-parsed i18n.js for a dict
// literal that no longer lives there. This script reads the split files directly and
// loads them in a VM sandbox (the files assign to window.__hibanaDictEN/__hibanaDictFA).
//
// Run: node scripts/check-i18n-parity.mjs
// Wired into: package.json (check:i18n-parity) + .github/workflows/ci.yml
// Exit 0 = parity holds; exit 1 = drift found (prints EN-only + FA-only keys).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB_JS = join(ROOT, 'public', 'js')

/** Load a dictionary file in a VM sandbox and return the assigned object. */
function loadDict(file, varName) {
  const src = readFileSync(file, 'utf8')
  const sandbox = { window: {} }
  runInNewContext(src, sandbox, { filename: file, timeout: 5000 })
  const dict = sandbox.window[varName]
  if (!dict || typeof dict !== 'object') {
    throw new Error(`could not load ${varName} from ${file} — expected window.${varName} = {...}`)
  }
  return dict
}

/** Recursively flatten an object's keys to dot-separated paths. */
function flatKeys(obj, prefix = '') {
  const out = new Set()
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const x of flatKeys(v, key)) out.add(x)
    } else {
      out.add(key)
    }
  }
  return out
}

const enDict = loadDict(join(PUB_JS, 'i18n-en.js'), '__hibanaDictEN')
const faDict = loadDict(join(PUB_JS, 'i18n-fa.js'), '__hibanaDictFA')

const enKeys = flatKeys(enDict)
const faKeys = flatKeys(faDict)

const onlyEn = [...enKeys].filter((k) => !faKeys.has(k)).sort()
const onlyFa = [...faKeys].filter((k) => !enKeys.has(k)).sort()

console.log(`i18n parity: EN ${enKeys.size} keys, FA ${faKeys.size} keys`)

if (onlyEn.length === 0 && onlyFa.length === 0) {
  console.log('PASS: EN + FA key sets are identical.')
  process.exit(0)
}

if (onlyEn.length) {
  console.log(`\nFAIL: ${onlyEn.length} key(s) in EN but MISSING in FA:`)
  for (const k of onlyEn.slice(0, 30)) console.log(`  - ${k}`)
  if (onlyEn.length > 30) console.log(`  … and ${onlyEn.length - 30} more`)
}
if (onlyFa.length) {
  console.log(`\nFAIL: ${onlyFa.length} key(s) in FA but MISSING in EN:`)
  for (const k of onlyFa.slice(0, 30)) console.log(`  - ${k}`)
  if (onlyFa.length > 30) console.log(`  … and ${onlyFa.length - 30} more`)
}
process.exit(1)
