#!/usr/bin/env node
// scripts/check-fn-lengths.mjs — the Phase 3 (M3) function-shape gate.
//
// FAILS when:
//   1. any function nests control flow deeper than 4 levels (no exceptions — the
//      codebase is at zero since Phase 3; else-if chains count flat, nested helper
//      functions count as their own function, matching every practical depth metric);
//   2. a LEAF function (no long nested function of its own) exceeds 60 lines and is
//      not listed in docs/autopilot/FN-ALLOWLIST.md with a recorded reason.
//
// Route FACTORIES — a function whose body is dominated by route registrations
// (>= 5 `app.get/post/patch/delete/put` calls, each handler small) — are the
// Phase 4 file-splitting domain and are exempt by design (the reason is recorded
// here, once); the allowlist carries the rest.
//
// Usage: node scripts/check-fn-lengths.mjs   (exit 1 on any violation)
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const ALLOWLIST = join(ROOT, 'docs/autopilot/FN-ALLOWLIST.md')
const MAX_LINES = 60
const MAX_NEST = 4
const FACTORY_MIN_ROUTES = 5

const files = []
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === 'tests' || e === 'vendor') continue
      walk(p)
    } else if (p.endsWith('.ts')) files.push(p)
  }
}
walk(SRC)

function lineCount(src, start, end) {
  return src.slice(start, end).split('\n').length
}

function countRouteRegistrations(node, n = 0) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (ts.isPropertyAccessExpression(callee) && /^(get|post|patch|delete|put|on|use)$/.test(callee.name.text) && callee.expression.getText().length <= 12) n++
  }
  for (const c of node.getChildren()) n = Math.max(n, countRouteRegistrations(c, n))
  return n
}

function maxNesting(node, depth = 0, best = 0, isRoot = true) {
  if (!isRoot && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return best
  const kind = node.kind
  const isControl =
    kind === ts.SyntaxKind.IfStatement || kind === ts.SyntaxKind.ForStatement ||
    kind === ts.SyntaxKind.ForOfStatement || kind === ts.SyntaxKind.ForInStatement ||
    kind === ts.SyntaxKind.WhileStatement || kind === ts.SyntaxKind.DoStatement ||
    kind === ts.SyntaxKind.SwitchStatement || kind === ts.SyntaxKind.TryStatement ||
    kind === ts.SyntaxKind.CatchClause
  const d = isControl ? depth + 1 : depth
  best = Math.max(best, d)
  for (const child of node.getChildren()) {
    // else-if chains are FLAT dispatch, not nesting.
    const isElseIf = node.kind === ts.SyntaxKind.IfStatement && ts.isIfStatement(child)
    best = Math.max(best, maxNesting(child, isElseIf ? depth : d, best, false))
  }
  return best
}

// key: "relpath:fnName" (fnName = declared name or <anon>@Lline)
const allow = new Set()
const allowRaw = readFileSync(ALLOWLIST, 'utf8')
for (const m of allowRaw.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)) allow.add(m[1])

const violations = []
const reported = new Set()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ES2022, true)
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const rel = f.slice(ROOT.length + 1)
      let name = '<anon>'
      if (node.name && ts.isIdentifier(node.name)) name = node.name.text
      else if (ts.isVariableDeclaration(node.parent)) name = node.parent.name.getText()
      const line = ts.getLineAndCharacterOfPosition(sf, node.getStart()).line + 1
      const key = `${rel}:${name === '<anon>' ? `<anon>@L${line}` : name}`
      if (reported.has(key)) return
      reported.add(key)
      const lines = lineCount(src, node.getStart(), node.getEnd())
      const nest = node.body ? maxNesting(node.body, 0, 0, true) : 0
      if (nest > MAX_NEST) violations.push(`${key} — nesting ${nest} > ${MAX_NEST} (NO allowlist path: restructure)`)
      if (lines > MAX_LINES) {
        // long nested function inside? → container; route factory? → Phase 4 domain
        const routes = node.body ? countRouteRegistrations(node.body) : 0
        const hasLongChild = (() => {
          let found = false
          const scan = (n) => {
            if (n !== node && (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))) {
              if (lineCount(src, n.getStart(), n.getEnd()) > MAX_LINES) { found = true; return }
              scan(n.body ?? n)
              return
            }
            ts.forEachChild(n, scan)
          }
          scan(node.body ?? node)
          return found
        })()
        if (!hasLongChild && routes < FACTORY_MIN_ROUTES && !allow.has(key)) {
          violations.push(`${key} — ${lines} lines > ${MAX_LINES} (not in docs/autopilot/FN-ALLOWLIST.md)`)
        }
      }
      // still recurse for nesting inside nested fns (they report under their own key)
      ts.forEachChild(node, (c) => { if (!ts.isFunctionDeclaration(c) && !ts.isMethodDeclaration(c) && !ts.isArrowFunction(c) && !ts.isFunctionExpression(c)) visit(c) })
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (violations.length) {
  console.error(`fn-shape: ${violations.length} violation(s)`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  process.exit(1)
}
console.log(`fn-shape: PASS (nesting ≤ ${MAX_NEST} everywhere; every leaf ≤ ${MAX_LINES} lines or allowlisted; route factories ≥ ${FACTORY_MIN_ROUTES} registrations exempt as the Phase 4 file-splitting domain)`)
