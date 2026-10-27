// scripts/check-import-boundaries.mjs — the layer/import-boundary gate (PLAYBOOK §5 Phase 4, M4).
//
// Goal: every part of src/ has ONE reason to change, and the Workers/Node portability
// is enforced by structure. Layers (top imports bottom, NEVER upward or sideways):
//
//   entry      src/app.ts, src/server.ts, src/index.ts   — composition roots / runtime entries
//   routes     src/routes/**                             — HTTP (Hono route factories)
//   services   src/services/**                           — business rules + integration adapters
//                                                        (kv/r2/github/email/telegram/ai sit here
//                                                        behind small interfaces, DA-6)
//   auth       src/auth/**                               — sessions/password/ban
//   db         src/db/**                                 — SQL via the Db interface (d1 + sqlite)
//   validation src/validation/**                         — Zod request schemas
//   lib        src/lib/**                                — shared pure functions (html/i18n/jalali…)
//   root       src/types.ts                              — shared ambient types
//   vendor     src/vendor/**                             — browser shims bundled by build.mjs
//                                                        directly (NOT part of the src import graph;
//                                                        nothing in src/ may import it)
//
// Rules:
//   1. A file may import ONLY its own layer and the layers listed in MAY_IMPORT below.
//      No upward imports (routes→services ok, services→routes NEVER), no sideways
//      imports between sibling domains that are not on an allowed path.
//   2. `import type` / `export type` statements are EXEMPT (counted, reported as
//      type-only edges): types have zero runtime effect and `import type` makes the
//      dependency explicit and erasable. Mixed statements (`import { x, type y }`)
//      count as RUNTIME imports (the value binding decides).
//   3. `await import('…')` dynamic imports count as runtime imports (currently 1:
//      routes/dev.ts → services/email, a legal downward edge).
//   4. src/tests/** is NOT checked (tests may import anything by design).
//   5. Bare specifiers (npm packages / node: builtins) are NOT checked here — that is
//      check-portability.mjs's job (runtime adapter boundaries).
//
// Run: npm run check:boundaries   (also part of `npm run verify` + CI)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const ROOT = process.cwd()

// The layer table. MAY_IMPORT lists the layers each layer may import (its own layer
// is always allowed). Verified against the measured graph (2026-10-27): with
// type-only edges exempt, the current tree has ZERO violations.
const LAYERS = [
  // [match, layer, mayImport[]] — first match wins; entries are file globs as prefixes
  { layer: 'entry', files: ['src/app.ts', 'src/server.ts', 'src/index.ts'],
    may: ['entry', 'routes', 'services', 'db', 'auth', 'validation', 'lib', 'root'] },
  { layer: 'routes', prefix: 'src/routes/',
    may: ['routes', 'services', 'db', 'auth', 'validation', 'lib', 'root'] },
  { layer: 'services', prefix: 'src/services/',
    may: ['services', 'db', 'lib', 'auth', 'validation', 'root'] },
  { layer: 'auth', prefix: 'src/auth/', may: ['auth', 'lib', 'root', 'db'] },
  { layer: 'db', prefix: 'src/db/', may: ['db', 'lib', 'root'] },
  { layer: 'validation', prefix: 'src/validation/', may: ['validation', 'lib', 'root'] },
  { layer: 'lib', prefix: 'src/lib/', may: ['lib', 'root'] },
  { layer: 'root', files: ['src/types.ts'], may: [] },
  { layer: 'vendor', prefix: 'src/vendor/', may: [] }, // bundled by build.mjs, not importable
]

function layerOf(relFile) {
  for (const L of LAYERS) {
    if (L.files?.includes(relFile)) return L.layer
    if (L.prefix && relFile.startsWith(L.prefix)) return L.layer
  }
  return null // unknown (tests / anything else) — not checked
}

function layerAllows(fromLayer, toLayer) {
  const L = LAYERS.find((x) => x.layer === fromLayer)
  return !!L && L.may.includes(toLayer)
}

// --- collect every non-test src file -----------------------------------------
const files = []
function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p)
  }
}
walk(join(ROOT, 'src'))

// --- import extraction ---------------------------------------------------------
// Static import/export-from statements (value or mixed) — runtime edges.
const RE_FROM = /(?:^|\n)[ \t]*(?:import|export)\s+[^;'"]*?\bfrom\s*['"](\.[^'"]+)['"]/g
// Pure type-only statements — exempt edges.
const RE_TYPE_FROM = /(?:^|\n)[ \t]*(?:import|export)\s+type\s[^;'"]*?\bfrom\s*['"](\.[^'"]+)['"]/g
// Side-effect imports — runtime edges.
const RE_SIDE_EFFECT = /(?:^|\n)[ \t]*import\s*['"](\.[^'"]+)['"]/g
// Awaited dynamic imports — runtime edges. (Inline type-position `import('./x').T`
// is NOT matched because it is never preceded by `await`.)
const RE_DYNAMIC = /await\s+import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g

function resolveSpec(fromFile, spec) {
  let t = resolve(dirname(fromFile), spec)
  for (const cand of [t + '.ts', t, join(t, 'index.ts')]) {
    try { statSync(cand); return cand } catch { /* next */ }
  }
  return null
}

const violations = []
const typeOnlyEdges = []
const runtimeEdges = new Map() // "from -> to" layer pair -> count

let checked = 0
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (rel.startsWith('src/tests/')) continue
  const fromLayer = layerOf(rel)
  if (!fromLayer) continue // entry-adjacent unknown files (none today)
  checked++
  const src = readFileSync(f, 'utf8')

  const typeSpecs = new Set()
  for (const m of src.matchAll(RE_TYPE_FROM)) typeSpecs.add(m[1])

  const runtimeSpecs = new Set()
  for (const m of src.matchAll(RE_FROM)) {
    // skip pure-type statements; keep value/mixed ones
    if (typeSpecs.has(m[1])) {
      // a mixed statement (`import { x, type y } from`) is NOT `import type` — only
      // the exact `import type` / `export type` prefix is exempt. RE_TYPE_FROM only
      // matches those, and RE_FROM matched the same specifier through the generic
      // branch, so distinguish: if the statement is type-prefixed it was consumed by
      // RE_TYPE_FROM. Match again precisely:
      const isTypeOnly = new RegExp(
        `(?:^|\\n)[ \\t]*(?:import|export)\\s+type\\s[^;'\"]*?\\bfrom\\s*['"]${specEscape(m[1])}['"]`,
      ).test(src)
      if (isTypeOnly) { typeOnlyEdges.push([rel, m[1]]); continue }
    }
    runtimeSpecs.add(m[1])
  }
  for (const m of src.matchAll(RE_SIDE_EFFECT)) runtimeSpecs.add(m[1])
  for (const m of src.matchAll(RE_DYNAMIC)) runtimeSpecs.add(m[1])

  for (const spec of runtimeSpecs) {
    const target = resolveSpec(f, spec)
    if (!target) {
      violations.push(`${rel}: unresolvable relative import '${spec}' (boundaries cannot be judged)`)
      continue
    }
    const tRel = relative(ROOT, target).replace(/\\/g, '/')
    const toLayer = layerOf(tRel)
    if (!toLayer || toLayer === fromLayer) continue
    const key = `${fromLayer} -> ${toLayer}`
    runtimeEdges.set(key, (runtimeEdges.get(key) ?? 0) + 1)
    if (!layerAllows(fromLayer, toLayer)) {
      violations.push(`${rel}: imports ${tRel}  [${key} — NOT allowed; allowed layers: ${layerMayList(fromLayer)}]`)
    }
  }
}

function specEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function layerMayList(l) { return LAYERS.find((x) => x.layer === l)?.may.join(', ') ?? '?' }

// --- report ---------------------------------------------------------------------
console.log(`check-import-boundaries: ${checked} files scanned (src/tests excluded)`)
console.log('runtime layer edges:')
for (const [k, v] of [...runtimeEdges].sort()) console.log(`  ${k.padEnd(22)} ${String(v).padStart(3)}`)
console.log(`type-only edges (exempt, erasable): ${typeOnlyEdges.length}`)
for (const [f, s] of typeOnlyEdges) console.log(`  ${f}  (type)  ${s}`)

if (violations.length > 0) {
  console.error(`\nFAIL — ${violations.length} import-boundary violation(s):`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nLayer rules (PLAYBOOK §5 Phase 4): entry > routes > services > {auth, db, validation} > lib > root; vendor is outside the graph.')
  process.exit(1)
}
console.log('\nPASS — no import-boundary violations.')
