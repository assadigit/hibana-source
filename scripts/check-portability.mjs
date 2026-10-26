// scripts/check-portability.mjs — the Workers/Node portability gate (PLAYBOOK §2).
//
// Hibana is ONE codebase that must run on BOTH Cloudflare Workers (D1/KV/AI via env
// bindings) and plain Node 24+ (node:sqlite + node:fs). Runtime-portable code lives
// between the adapters; the ONLY files allowed to touch Node-only or Workers-only
// facilities are the adapter layers below. This check scans every import specifier
// in src/ (tests excluded — they run under vitest/Node by design) and fails the
// build when the boundary is crossed anywhere else.
//
// Rules:
//   1. `node:*` / bare-Node-builtin imports (`fs`, `path`, `zlib`, `os`, …) and
//      `@hono/node-server` are allowed ONLY in ADAPTER_FILES.
//   2. `cloudflare:*` imports are allowed NOWHERE (today the Workers adapters reach
//      bindings through the env object, never through module imports).
//   3. `process.` usage outside ADAPTER_FILES must be guarded by `typeof process`
//      in the same file (Workers has no `process` global).
//
// Run: npm run check:portability   (also part of `npm run verify` + CI)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

// The adapter layers — the ONLY places Node-only APIs may appear. Verified against
// the current tree (grep "node:" src/ --include="*.ts"):
//   - src/server.ts              — the Node ENTRY (fs/path/zlib + @hono/node-server)
//   - src/db/sqlite.ts           — the node:sqlite Db adapter
//   - src/db/migrate-node.ts     — the Node migration runner (fs/path + node:sqlite)
//   - src/services/disk-shots.ts — the Node-only explicit disk object store (HIBANA_SHOTS_DIR)
const ADAPTER_FILES = new Set([
  'src/server.ts',
  'src/db/sqlite.ts',
  'src/db/migrate-node.ts',
  'src/services/disk-shots.ts',
])

const NODE_PREFIX = /^node:[a-z]+$/
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'zlib', 'url', 'util', 'crypto', 'child_process', 'http', 'https',
  'net', 'stream', 'events', 'buffer', 'querystring', 'string_decoder', 'tty', 'v8',
  'worker_threads', 'perf_hooks', 'assert', 'async_hooks', 'dgram', 'dns', 'tls', 'module',
  'readline', 'repl', 'vm', 'inspector', 'process',
])
const WORKERS_ONLY_PREFIX = /^cloudflare:/
const NODE_ONLY_PACKAGES = new Set(['@hono/node-server', 'better-sqlite3'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) out.push(p)
  }
  return out
}

function classify(spec) {
  if (WORKERS_ONLY_PREFIX.test(spec)) return `cloudflare:-prefixed (Workers-only) import '${spec}'`
  if (NODE_PREFIX.test(spec)) return `Node-only builtin '${spec}'`
  if (NODE_BUILTINS.has(spec)) return `Node builtin '${spec}' (unprefixed)`
  if (NODE_ONLY_PACKAGES.has(spec)) return `Node-only package '${spec}'`
  return null
}

const files = walk(join(ROOT, 'src')).filter((f) => !relative(ROOT, f).split('\\').join('/').startsWith('src/tests/'))

const violations = []
const adapterUses = []
let scanned = 0

for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/')
  scanned += 1
  const isAdapter = ADAPTER_FILES.has(rel)
  const src = readFileSync(file, 'utf8')

  // every kind of import specifier: `from 'x'`, side-effect `import 'x'`, dynamic `import('x')`
  const specs = new Set()
  for (const re of [/from\s+['"][^'"]+['"]/g, /import\s+['"][^'"]+['"]/g, /import\s*\(\s*['"][^'"]+['"]\s*\)/g]) {
    let m
    while ((m = re.exec(src)) !== null) {
      const open = m[0].indexOf('"') >= 0 ? m[0].indexOf('"') : m[0].indexOf("'")
      const close = m[0].lastIndexOf('"') >= 0 ? m[0].lastIndexOf('"') : m[0].lastIndexOf("'")
      if (close > open) specs.add(m[0].slice(open + 1, close))
    }
  }

  for (const spec of specs) {
    if (spec.startsWith('.')) continue // relative imports carry no platform binding
    const reason = classify(spec)
    if (!reason) continue
    if (isAdapter) adapterUses.push(`${rel}: ${reason}`)
    else violations.push(`${rel}: ${reason} — outside the adapter layers`)
  }

  // unguarded process usage outside adapters (Workers has no `process` global)
  if (!isAdapter && /\bprocess\./.test(src) && !/\btypeof\s+process\b/.test(src)) {
    violations.push(`${rel}: uses process.* without a 'typeof process' guard (breaks on Workers)`)
  }
}

// every allowlisted adapter must actually exist — a stale entry would silently rot
for (const adapter of ADAPTER_FILES) {
  if (!files.some((f) => relative(ROOT, f).split('\\').join('/') === adapter)) {
    violations.push(`${adapter}: listed as an adapter but NOT FOUND — update the allowlist`)
  }
}

console.log(`portability: scanned ${scanned} source files under src/ (tests excluded)`)
console.log(`adapter layers (the allowed Node-only surface): ${[...ADAPTER_FILES].join(', ')}`)
for (const use of adapterUses) console.log(`  · ${use}`)

if (violations.length > 0) {
  console.error(`\nFAIL: ${violations.length} portability violation(s):`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error('\nCode outside the adapter layers must not import Node-only or Workers-only modules.')
  process.exit(1)
}
console.log('PASS: no Workers-only or Node-only imports outside the adapter layers.')
