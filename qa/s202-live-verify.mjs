#!/usr/bin/env node
// qa/s202-live-verify.mjs — S202 (THE APPROVED ASKS) live proof.
// The round: the vazir font diet (PERF-9, owner-approved — the 21 legacy .eot/.woff/.ttf
// files + the never-referenced Vazir-Variable set deleted, font-face.css trimmed to
// woff2-only) + sw.js v435 (the SHELL re-caches the trimmed font-face.css) + zod 3→4
// (UX-13 part 1 — backend-only; PERF-16 resolved HONESTLY with NO migration: the
// audit's 4th table was dropped by 0048 and the other three access paths are PK-
// covered — see src/tests/index-coverage.test.ts). The LIVE proof:
//   1. the 6 kept woff2 weights are byte-identical + served as font/woff2;
//   2. the deleted legacy formats 404 (a stale edge/SW copy would still serve);
//   3. font-face.css is byte-identical to the canonical file AND woff2-only
//      (no .eot/.ttf refs, no Variable, no bare-.woff refs);
//   4. sw.js VERSION = hibana-v435 AND the SHELL still precaches the font CSS;
//   5. zod 4 parses on the live Worker: a type-invalid login body → 400
//      invalid_input (the reject path), a valid-shape unknown login → 401
//      invalid_credentials (the pass path) — the two halves of the jsonBody
//      contract, no real account touched;
//   6. health ok/up/63 — schema UNCHANGED (the honest PERF-16 resolution).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const EXPECT_SW = 'hibana-v435'
const EXPECT_SCHEMA = '63'
const VENDOR = join(process.cwd(), 'public', 'vendor', 'vazir')

const results = []
let fail = false
const note = (ok, label) => { if (!ok) fail = true; results.push(`${ok ? '✓' : '✗'} ${label}`) }

// 1. the kept woff2 weights — byte-identical + the right content type
for (const w of ['Regular', 'Bold', 'Medium', 'Light', 'Thin', 'Black']) {
  const local = readFileSync(join(VENDOR, `Vazir-${w}.woff2`))
  const r = await fetch(`${BASE}/vendor/vazir/Vazir-${w}.woff2`, { cache: 'no-store' })
  if (!r.ok) { note(false, `Vazir-${w}.woff2 HTTP ${r.status}`); continue }
  const buf = Buffer.from(await r.arrayBuffer())
  const ctype = r.headers.get('content-type') || ''
  note(buf.equals(local) && /font\/woff2|octet-stream/.test(ctype),
    `Vazir-${w}.woff2: ${buf.byteLength} vs ${local.length} bytes ${buf.equals(local) ? 'IDENTICAL' : 'DIFFERS'} · ${ctype}`)
}

// 2. the deleted legacy formats 404 on live
for (const p of ['Vazir-Regular.eot', 'Vazir-Regular.woff', 'Vazir-Regular.ttf', 'Vazir-Variable.woff2', 'Vazir-Bold.woff']) {
  const r = await fetch(`${BASE}/vendor/vazir/${p}`, { cache: 'no-store' })
  note(r.status === 404, `${p} → ${r.status} (expect 404 — deleted by the diet)`)
}

// 3. font-face.css — byte-identical + woff2-only content
{
  const local = readFileSync(join(VENDOR, 'font-face.css'))
  const r = await fetch(`${BASE}/vendor/vazir/font-face.css`, { cache: 'no-store' })
  const text = await r.text()
  note(text === local.toString('utf8'), `font-face.css byte-identical (${text.length} vs ${local.length})`)
  note(text.includes("url('Vazir-Regular.woff2')"), 'font-face.css carries the woff2 src')
  note(!text.includes('.eot') && !text.includes('.ttf') && !text.includes('Variable'), 'font-face.css has no .eot/.ttf/Variable refs')
  note(!/\.woff[')]/.test(text), 'font-face.css has no bare-.woff refs')
}

// 4. sw.js VERSION + the SHELL's font CSS
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  note(sw.includes(`const VERSION = "${EXPECT_SW}"`), `sw.js VERSION = ${EXPECT_SW}`)
  note(sw.includes("'/vendor/vazir/font-face.css'"), 'sw.js SHELL still precaches the font CSS')
}

// 5. zod 4 on the live Worker — the jsonBody contract's two halves (T6 origin gate:
// server-side callers must send an explicit Origin)
{
  const hdrs = { 'Content-Type': 'application/json', Origin: BASE }
  const bad = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: hdrs, body: JSON.stringify({ login: 12345 }) })
  note(bad.status === 400, `zod reject path: type-invalid body → ${bad.status} (expect 400)`)
  const good = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ login: 'zod4-live-probe@nonexistent.example', password: 'x' }),
  })
  note(good.status === 401, `zod pass path: valid-shape unknown login → ${good.status} (expect 401 invalid_credentials)`)
}

// 6. health — schema stays 63 (PERF-16 resolved with NO migration)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  note(h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA,
    `health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

console.log(results.join('\n'))
console.log(`\nS202 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
