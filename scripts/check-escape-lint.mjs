#!/usr/bin/env node
// scripts/check-escape-lint.mjs — the XSS escape-lint gate (S199, SEC-1).
//
// The app's CSP carries unsafe-inline/unsafe-eval (documented tradeoff), so the ONLY
// barrier between user text and same-origin script execution is the escaping
// discipline in the 300+ `innerHTML =` / `insertAdjacentHTML(` sinks across
// public/js. Until now that discipline was manual (sampled clean by the S198 audit —
// but every FUTURE `${` in a sink template was a security-critical review point).
// Its first run caught two real misses (the sadhana quadrant-name <option> sinks —
// user-renameable text, now esc()'d).
//
// This gate mechanizes the discipline: every template literal feeding an innerHTML
// sink must interpolate only ESCAPED or structurally-safe expressions:
//
//   SAFE shapes (the app's established conventions — see the audit's SEC-1 notes):
//     - a call to an esc-family helper        esc(  escHtml(  escS(  pdEsc(  …Esc( )
//     - a call to an *Html builder            pdTitleHtml(  toastHtml(  …Html( )
//     - JSON.stringify(…)                     (the data-attribute idiom)
//     - _t(…)                                 i18n dictionary lookups (code-authored)
//     - encodeURIComponent/encodeURI/Number/Math.*(
//     - literals / numbers / booleans         1  2.5  true  null
//     - boolean-yielding comparisons          a === b  !x   (operands still checked)
//     - ternaries whose RESULT branches are safe (the condition never renders)
//     - numeric arithmetic over safe atoms    vw - 16
//     - id-like / enum-like / counter names   …id, …Id, uuid, status, kind, type,
//                                             key, color, icon, version, count,
//                                             total, index, idx, i, j, k, n, len,
//                                             length, ts, at, page, size, vw, vh,
//                                             w, h, x, y, dx, dy, px, day, month,
//                                             year  (server-Zod'd UUIDs + enums +
//                                             numbers — never free text)
//     - .length / Date.now()
//   Everything else FAILS — write esc(x) (or an *Html builder) at the sink.
//
// Nested templates ride along: an interpolation containing its own template literal
// (the .map(r => `<li>${esc(r)}</li>`) idiom) is checked recursively — every leaf
// interpolation must match a safe shape.
//
// Usage: node scripts/check-escape-lint.mjs   (exit 1 on any violation)
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JS_DIR = join(ROOT, 'public', 'js')

// ---- shape rules ----------------------------------------------------------------
const ESC_CALL = /(^|[^\w$])(?:[A-Za-z_$][\w$]*)?[Ee]sc[A-Za-z_$\w]*\s*\(/
const HTML_BUILDER = /(^|[^\w$])[A-Za-z_$][\w$]*Html\s*\(/
const SAFE_FN = /(^|[^\w$])(_t|tr|svg|renderMarkdown|toFa|encodeURIComponent|encodeURI|Number|parseInt|parseFloat|String)\s*\(/
const MATH_FN = /(^|[^\w$])Math\s*\.\s*\w+\s*\(/
const JSON_STRINGIFY = /(^|[^\w$])JSON\s*\.\s*stringify\s*\(/
const LITERAL = /^(true|false|null|undefined|\d+(\.\d+)?)$/
const STRING_LIT = /^(['"])(?:\\.|(?!\1).)*\1$/ // quoted literal — no interpolation
const SCREAMING_DICT = /^[A-Z][A-Z0-9_]*(\.[A-Za-z_$][\w$]*|\[[^\][]*\])+$/ // STATIC_CONST.anything
const HTML_VAR = /^[A-Za-z_$][\w$]*Html$/ // prebuilt-markup variable (*Html convention)
const SAFE_TERMINAL = new RegExp(
  '^(id|ids|uuid|status|kind|type|key|keys|color|icon|version|count|total|index|idx|' +
  'i|j|k|n|q|len|length|ts|at|page|v|pos|num|qty|size|vw|vh|w|h|x|y|dx|dy|px|em|rem|' +
  'day|week|month|year|min|max|mode|dow|jm|jy|jd|level|accent)$',
)
const SAFE_MEMBER = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\.length$/
const SAFE_CALL = /^(Date\.now\(\)|[A-Za-z_$][\w$]*\.(getDate|getFullYear|getMonth|getDay|getHours|getMinutes|getSeconds|getTime)\(\))$/
const COMPARISON = /===|!==|==|!=|<=|>=|[^=!<>]<[^=!<>]|[^=!<>]>[^=!<>]/

const isSafeExpr = (expr, depth = 0) => {
  let e = expr.trim()
  // common empty-fallback idiom: X || '' and X ?? '' — judged on X, the fallback is a literal
  e = e.replace(/\s*(\|\||\?\?)\s*(''|""|"")\s*$/, '').trim()
  if (!e) return true // `${}` — dead interpolation, harmless
  if (depth > 8) return false
  if (LITERAL.test(e)) return true
  if (/^`[\s\S]*`$/.test(e)) return true // a lone nested template — its own interpolations were validated by the scan loop
  if (STRING_LIT.test(e)) return true
  if (SCREAMING_DICT.test(e)) return true // STATIC_CONST lookup — compile-time data
  if (HTML_VAR.test(e)) return true // a prebuilt-markup variable (*Html naming)
  if (ESC_CALL.test(e) || HTML_BUILDER.test(e) || JSON_STRINGIFY.test(e)) return true
  if (SAFE_FN.test(e) || MATH_FN.test(e)) return true
  if (SAFE_CALL.test(e)) return true
  if (SAFE_MEMBER.test(e)) return true
  if (/^!+[A-Za-z_$][\w$.]*$/.test(e)) return true // pure negation of an identifier/member
  if (/^!+[A-Za-z_$][\w$]*\(\)$/.test(e)) return true // negation of a call — renders boolean
  // ternary: the CONDITION is never rendered — only the two result branches matter
  const tern = splitTernary(e)
  if (tern) return isSafeExpr(tern.then, depth + 1) && isSafeExpr(tern.els, depth + 1)
  // boolean-yielding comparison — the WHOLE expression is comparison/grouping only
  // (operands never render). && and || are excluded (they yield operand VALUES), and
  // so are ?: (ternary — handled above) and + (string concatenation).
  if (/===|!==|==|!=|<=|>=|instanceof/.test(e) && !/&&|\|\||\?|[+*/%]/.test(e)) return true
  // pure arithmetic over numeric-safe atoms: `min(20rem, ${vw - 16}px)`
  if (/[+\-*/%]/.test(e) && /^[\w$.\s()+\-*/%0-9]+$/.test(e)) {
    const atoms = e.replace(/[()+\-*/%]/g, '\u0001').split('\u0001').map((x) => x.trim()).filter(Boolean)
    if (atoms.length && atoms.every((a) => isSafeExpr(a, depth + 1))) return true
  }
  // identifier / member-expression: judge by the LAST segment
  const m = e.match(/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/)
  if (m) {
    const last = e.split('.').pop()
    if (SAFE_TERMINAL.test(last)) return true
  }
  return false
}

// split a top-level ternary: returns {then, els} or null (cond is never rendered)
function splitTernary(e) {
  let d = 0
  for (let i = 0; i < e.length; i++) {
    const c = e[i]
    if (c === '\\') { i++; continue }
    if (c === '\`') { i++; while (i < e.length && e[i] !== '\`') { if (e[i] === '\\') i++; i++ } continue } // skip template strings
    if (c === '"' || c === "'") { const q = c; i++; while (i < e.length && e[i] !== q) { if (e[i] === '\\') i++; i++ } continue }
    if (c === '(' || c === '[' || c === '{') d++
    else if (c === ')' || c === ']' || c === '}') d--
    else if (c === '?' && d === 0 && e[i + 1] !== '.' && e[i + 1] !== '?') {
      let d2 = 0
      for (let j = i + 1; j < e.length; j++) {
        const c2 = e[j]
        if (c2 === '\\') { j++; continue }
        if (c2 === '\`') { j++; while (j < e.length && e[j] !== '\`') { if (e[j] === '\\') j++; j++ } continue }
        if (c2 === '"' || c2 === "'") { const q2 = c2; j++; while (j < e.length && e[j] !== q2) { if (e[j] === '\\') j++; j++ } continue }
        if (c2 === '(' || c2 === '[' || c2 === '{') d2++
        else if (c2 === ')' || c2 === ']' || c2 === '}') d2--
        else if (c2 === ':' && d2 === 0 && e[j - 1] !== ':') {
          return { then: e.slice(i + 1, j), els: e.slice(j + 1) }
        }
      }
    }
  }
  return null
}

// ---- template-literal extraction with nesting ------------------------------------
// walkTemplate(src, i): i points AT the opening backtick.
function walkTemplate(src, i) {
  const out = { start: i, end: -1, interpolations: [] }
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === '`') { out.end = j; return out }
    if (c === '$' && src[j + 1] === '{') {
      let depth = 1, k = j + 2
      let inner = ''
      while (k < src.length && depth > 0) {
        const d = src[k]
        if (d === '\\') { inner += d + (src[k + 1] ?? ''); k += 2; continue }
        if (d === '"' || d === "'" || d === '`') {
          const q = d
          let s = k + 1
          while (s < src.length) {
            if (src[s] === '\\') { s += 2; continue }
            if (src[s] === q) break
            s++
          }
          inner += src.slice(k, s + 1)
          k = s + 1
          continue
        }
        if (d === '{') depth++
        if (d === '}') { depth--; if (depth === 0) break }
        inner += d
        k++
      }
      out.interpolations.push({ start: j, end: k, expr: inner })
      j = k + 1
      continue
    }
    j++
  }
  return out // unterminated — the build's own syntax gate catches those
}

// collect every template literal inside a span (recursively via walkTemplate)
function templatesInSpan(src, from, to) {
  const found = []
  let j = from
  while (j < to) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === '"' || c === "'") {
      const q = c
      j++
      while (j < to) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === q) { j++; break }
        j++
      }
      continue
    }
    if (c === '`') {
      const t = walkTemplate(src, j)
      found.push(t)
      j = (t.end > t.start ? t.end : j) + 1
      continue
    }
    j++
  }
  return found
}

// The expression span of a sink, from after the marker to the statement end.
// insertAdjacentHTML(…): to its matching close paren.
// innerHTML = …: to the `;` at depth 0 — or (ASI) the newline where the statement
// is complete: depths all zero and the last non-space char is not a continuation
// (operator / comma / open bracket / `=` / `.` / closing backtick-or-quote context).
function sinkSpan(src, markerEnd, isParenCall) {
  let pdepth = 0, bdepth = 0, cdepth = 0
  let j = markerEnd
  let lastNonWs = ''
  while (j < src.length && j < markerEnd + 20000) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      j++
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === q) break
        j++
      }
      j++
      lastNonWs = q
      continue
    }
    if (c === '(') { pdepth++; lastNonWs = c; j++; continue }
    if (c === ')') {
      pdepth--
      if (isParenCall && pdepth < 0) return j // the call's closing paren
      lastNonWs = c; j++; continue
    }
    if (c === '[') { bdepth++; lastNonWs = c; j++; continue }
    if (c === ']') { bdepth--; lastNonWs = c; j++; continue }
    if (c === '{') { cdepth++; lastNonWs = c; j++; continue }
    if (c === '}') { cdepth--; lastNonWs = c; j++; continue }
    if (!isParenCall && pdepth <= 0 && bdepth <= 0 && cdepth <= 0 && c === ';') return j
    if (c === '\n' && !isParenCall && pdepth <= 0 && bdepth <= 0 && cdepth <= 0) {
      // ASI: did the statement end complete (no dangling operator/comma/open)?
      if (!/[+\-*/%,(&|?:{[=.`'"`]$/.test(lastNonWs)) return j - 1
    }
    if (!/\s/.test(c)) lastNonWs = c
    j++
  }
  return Math.min(j, markerEnd + 20000)
}

// ---- scan ------------------------------------------------------------------------
const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort()
const SINK_RE = /\.innerHTML\s*\+?=|\.insertAdjacentHTML\s*\(/g
const violations = []
const sinks = {}

for (const file of files) {
  const src = readFileSync(join(JS_DIR, file), 'utf8')
  // comment/string ranges, so markers inside comments/strings don't count
  const skip = []
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { const s = i; i += 2; while (i < src.length && src[i] !== '\n') i++; skip.push([s, i]) }
    else if (c === '/' && src[i + 1] === '*') { const s = i; i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; skip.push([s, i + 2]) }
    else if (c === '"' || c === "'" || c === '`') { const q = c; const s = i; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ } skip.push([s, i + 1]) }
  }
  const inSkip = (i) => skip.some(([a, b]) => i >= a && i < b)

  SINK_RE.lastIndex = 0
  let m
  while ((m = SINK_RE.exec(src)) !== null) {
    if (inSkip(m.index)) continue
    sinks[file] = (sinks[file] ?? 0) + 1
    const isParenCall = m[0].includes('insertAdjacentHTML')
    const spanEnd = sinkSpan(src, m.index + m[0].length, isParenCall)
    const templates = templatesInSpan(src, m.index + m[0].length, spanEnd)
    for (const t of templates) {
      for (const interp of t.interpolations) {
        // nested templates inside this interpolation get their own recursive checks
        const nested = templatesInSpan(src, interp.start + 2, interp.end)
        for (const nt of nested) {
          for (const ni of nt.interpolations) {
            if (!isSafeExpr(ni.expr)) violations.push({ file, at: ni.start, expr: ni.expr.trim().slice(0, 90), sink: m[0].trim() })
          }
        }
        if (nested.length) {
          // the OUTER expression is map/filter/join plumbing around the nested
          // templates — allow it only if the remainder carries no string literals
          // (a concatenated 'evil' + … would show as a quoted literal)
          const remainder = interp.expr.replace(/\.join\((['"])\1\)/g, '\u0002')
          if (!/['"`]/.test(remainder)) continue
        }
        if (!isSafeExpr(interp.expr)) violations.push({ file, at: interp.start, expr: interp.expr.trim().slice(0, 90), sink: m[0].trim() })
      }
    }
  }
}

const totalSinks = Object.values(sinks).reduce((a, b) => a + b, 0)
const report = violations.map((v) => {
  const src = readFileSync(join(JS_DIR, v.file), 'utf8')
  const line = src.slice(0, v.at).split('\n').length
  return `${v.file}:${line}  ${v.sink}  ←  \${${v.expr}}`
})

if (report.length) {
  console.error(`escape-lint FAIL — ${report.length} unescaped interpolation(s) in innerHTML sinks:`)
  for (const r of report) console.error('  ' + r)
  console.error('\nWrap free-text expressions in esc(...) / escHtml(...) (or an *Html builder).')
  process.exit(1)
}
console.log(`escape-lint PASS — ${totalSinks} innerHTML/insertAdjacentHTML sinks scanned across ${files.length} public/js files, every interpolation escaped or structurally safe.`)
