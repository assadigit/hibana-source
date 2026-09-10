// Session-9 audit: static consistency checks (no git needed — reads the tree as shipped).
// 1) ?v= cache-bust consistency: every asset referenced by ANY html page must use the
//    SAME ?v=N across all referencing pages; every /js/*.js + /css/*.css reference must
//    be versioned at all; SW SHELL list must match the HTML versions.
// 2) i18n key parity: EN and FA dictionaries in public/js/i18n.js must have identical
//    key sets (recursive).
// Exit 0 = pass; findings printed otherwise.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'))

const findings = []
const assetVersions = new Map() // asset -> Set of versions
const refPages = new Map() // asset -> pages referencing

for (const page of pages) {
  const html = readFileSync(join(PUB, page), 'utf8')
  // script src / link href references to /js/ or /css/
  const refs = [...html.matchAll(/(?:src|href)="\/(js|css)\/([a-z0-9-]+\.(?:js|css))(\?v=(\d+))?"/gi)]
  for (const [, dir, file, q, ver] of refs) {
    const asset = `${dir}/${file}`
    if (!ver) findings.push(`[UNVERSIONED] ${page} → /${asset} (no ?v=)`)
    const key = asset
    if (!assetVersions.has(key)) { assetVersions.set(key, new Set()); refPages.set(key, new Set()) }
    assetVersions.get(key).add(ver ?? 'NONE')
    refPages.get(key).add(page)
  }
}

for (const [asset, vers] of assetVersions) {
  if (vers.size > 1) findings.push(`[INCONSISTENT] /${asset} referenced as ?v={${[...vers].join(', ')}}`)
}

// SW shell list must reference the same versions
const sw = readFileSync(join(PUB, 'sw.js'), 'utf8')
const swRefs = [...sw.matchAll(/\/(js|css)\/([a-z0-9-]+\.(?:js|css))\?v=(\d+)/g)]
for (const [, dir, file, ver] of swRefs) {
  const asset = `${dir}/${file}`
  const htmlVers = assetVersions.get(asset)
  if (htmlVers && !htmlVers.has(ver)) findings.push(`[SW-MISMATCH] sw.js /${asset}?v=${ver} vs HTML ?v={${[...htmlVers].join(',')}}`)
}
// SW should precache every html-referenced versioned asset? Not necessarily (dynamic), report info only.

// ---- i18n parity ----
const i18n = readFileSync(join(PUB, 'js', 'i18n.js'), 'utf8')
// crude but effective: eval the dictionary in a sandbox-ish way. i18n.js structure:
// look for the I18N/dictionary object literal with en: {...}, fa: {...}
const m = i18n.match(/const\s+(\w+)\s*=\s*\{[\s\S]*?\n(\s*)(en|EN)\s*:/)
if (!m) {
  findings.push('[I18N] could not locate dictionary literal — manual review needed')
} else {
  // find `en: {` and `fa: {` top-level keys within one object; extract balanced braces
  const extract = (label) => {
    const re = new RegExp(`\\b${label}\\s*:\\s*\\{`)
    const at = i18n.search(re)
    if (at < 0) return null
    let i = i18n.indexOf('{', at), depth = 0, start = i
    for (; i < i18n.length; i++) {
      if (i18n[i] === '{') depth++
      else if (i18n[i] === '}') { depth--; if (depth === 0) break }
    }
    return i18n.slice(start, i + 1)
  }
  const en = extract('en'), fa = extract('fa')
  const flat = (obj, prefix = '') => {
    const out = new Set()
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) { for (const x of flat(v, key)) out.add(x) }
      else out.add(key)
    }
    return out
  }
  try {
    const enObj = eval(`(${en})`), faObj = eval(`(${fa})`)
    const enKeys = flat(enObj), faKeys = flat(faObj)
    const onlyEn = [...enKeys].filter((k) => !faKeys.has(k))
    const onlyFa = [...faKeys].filter((k) => !enKeys.has(k))
    if (onlyEn.length) findings.push(`[I18N] keys missing in FA (${onlyEn.length}): ${onlyEn.slice(0, 15).join(', ')}${onlyEn.length > 15 ? ' …' : ''}`)
    if (onlyFa.length) findings.push(`[I18N] keys missing in EN (${onlyFa.length}): ${onlyFa.slice(0, 15).join(', ')}${onlyFa.length > 15 ? ' …' : ''}`)
    console.log(`i18n parity: EN ${enKeys.size} keys, FA ${faKeys.size} keys`)
  } catch (e) {
    findings.push(`[I18N] parse failed: ${e.message}`)
  }
}

console.log(`pages scanned: ${pages.length}; assets referenced: ${assetVersions.size}`)
if (findings.length) {
  console.log('\nFINDINGS:')
  for (const f of findings) console.log(' -', f)
  process.exit(1)
}
console.log('ALL CONSISTENCY CHECKS PASS')
