#!/usr/bin/env node
// qa/s199-live-verify.mjs — S199 (DEBT ZERO + TRUST GATES) live proof.
// The round changed EIGHT js controllers (all dist-bundled): app, mobile-nav,
// emoji-picker, calendar-page, notes-page, project-page, sadhana-page, settings-page —
// the escape-lint hardening (incl. the two REAL quadrant-name fixes). The LIVE proof:
//   1. each page's wired /dist/<name>.<hash>.js ref resolves and is
//      BYTE-IDENTICAL to the canonical local build;
//   2. the live bundles carry the round's own grammar: the quadrant-name <option>
//      sinks interpolate through esc() CALLS (whatever the minifier names them) —
//      the regex is minifier-agnostic;
//   3. sw.js VERSION = hibana-v433 AND its VERSION line is TRIMMED (< 4,000 chars —
//      it was 15,959 before the round);
//   4. health ok/up/63 (no migration this round).
// RUN WITH THE TREE IN WIRED FORM (node scripts/build.mjs --prod --wire-html;
// --restore-html after) — app.js embeds its lazy-asset refs, which the wire step
// rewrites to /dist/*.<hash> paths: a canonical-form build differs there by design
// (the S191/S193 verifier lesson, re-learned on JS bundles this round).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v433'
const EXPECT_SCHEMA = '63'

// the round's controllers + one canonical page each that loads them
const PAGE_TARGETS = {
  'calendar.html': ['calendar-page'],
  'notes.html': ['notes-page'],
  'project.html': ['project-page'],
  'sadhana.html': ['sadhana-page'],
  'settings.html': ['settings-page'],
  'dashboard.html': ['app', 'mobile-nav', 'emoji-picker'],
}

// minifier-agnostic probes: string literals + call-shapes that must survive
const CONTENT_PROBES = {
  app: [/quadrant-emoji/, /\$\{[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.icon\)\} \$\{[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.name\)\}<\/option>/],
  'mobile-nav': [/mobile-more-row/],
  'emoji-picker': [/emoji/],
  'calendar-page': [/cal-color-dot/, /\$\{[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.icon\)\} \$\{[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.name\)\}<\/option>/],
  'notes-page': [/vault-sec-count/],
  'project-page': [/pd-sd-ver|badge-/],
  'sadhana-page': [/qe-swatch-none/],
  'settings-page': [/AI model|ai-model/],
}

const results = []
let fail = false

const localFile = (prefix, ext) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && f.endsWith(ext)) || null

const check = async (label, liveUrl, localPath) => {
  const local = readFileSync(localPath)
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return null }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
  return r.ok ? buf.toString('utf8') : null
}

// 1. byte-identity of every round controller off its page + 2. the content probes
for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const t of targets) {
    const re = new RegExp(`(?:src)="(/dist/${t}\\.[a-f0-9]+\\.js)"`)
    const ref = re.exec(html)?.[1] || null
    const local = ref ? localFile(t, '.js') : null
    if (ref && local) {
      const text = await check(`${t}.js (wired, off ${page})`, BASE + ref, join(DIST, local))
      if (text) {
        for (const probe of CONTENT_PROBES[t] || []) {
          const hit = probe.test(text)
          if (!hit) fail = true
          results.push(`${hit ? '✓' : '✗'} live ${t}.js carries ${probe}`)
        }
      }
    } else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// 3. sw.js version + the VERSION-line trim (the round's own headline: 15,959 chars → ~2.6k)
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  const ok = sw.includes(`const VERSION = "${EXPECT_SW}"`)
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} sw.js VERSION = ${EXPECT_SW}`)
  const versionLine = sw.split('\n').find((l) => l.startsWith('const VERSION =')) || ''
  const trimmed = versionLine.length > 0 && versionLine.length < 4000
  if (!trimmed) fail = true
  results.push(`${trimmed ? '✓' : '✗'} sw.js VERSION line trimmed: ${versionLine.length} chars (< 4,000; was 15,959)`)
}

// 4. health (no migration this round — schema stays 63)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  const ok = h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

console.log(results.join('\n'))
console.log(`\nS199 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
