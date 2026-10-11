#!/usr/bin/env node
// qa/s197-live-verify.mjs — S197 (THE TOUCH + OPTICAL ROUND, Track B) live proof.
// The round changed SEVEN css sheets (all dist-bundled): notes, sadhana-board,
// quicknotes, dashboard, to-do-list, task-controls, calendar — the coarse-floor
// fixes + the crossing-glyph optical forks. The LIVE proof:
//   1. each page's wired /dist/<name>.<hash>.css ref resolves and is
//      BYTE-IDENTICAL to the canonical local build (the whole round rides it);
//   2. the live bundles carry the round's own grammar: the pointer:coarse
//      floors + the 2.1/2.4 optical forks survive minification;
//   3. sw.js VERSION = hibana-v432 + health ok/up/63 (no migration).
// RUN WITH THE TREE IN CANONICAL FORM (the dist bytes verify against the
// canonical build — the S196 verifier lesson: extension-aware localFile).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v432'
const EXPECT_SCHEMA = '63'

// the round's sheets + one canonical page each that links them
const PAGE_TARGETS = {
  'notes.html': ['notes'],
  'sadhana.html': ['sadhana-board', 'calendar'],
  'login.html': ['quicknotes'],
  'projects.html': ['dashboard'],
  'project.html': ['to-do-list'],
  'dashboard.html': ['task-controls'],
}

// distinctive content that must survive minification in the LIVE bundle
const CONTENT_PROBES = {
  notes: [/@media\(pointer:coarse\)\{\.vault-sec-add\{inline-size:2\.5rem/, /\.vault-sec-add \.icon\{[^}]*stroke-width:2\.1/, /\.vault-sec-add\{[^}]*inline-size:2rem/],
  'sadhana-board': [/\.q-pen-svg\{[^}]*stroke-width:2\.4/, /\.q-fab\{width:40px;height:40px\}/, /pointer:coarse/],
  quicknotes: [/\.pd-cat-swatch-tile\{[^}]*inline-size:2\.5rem/, /\.note-add \.qa-btn \.icon\{[^}]*stroke-width:2\.1/],
  dashboard: [/\.dash-vault-dismiss\{[^}]*width:44px/, /\.dash-vault-dismiss \.icon\{[^}]*width:1\.25rem/],
  'to-do-list': [/\.task-note-delete\{[^}]*inline-size:2\.5rem/, /\.task-note-delete \.icon\{[^}]*stroke-width:2\.1/],
  'task-controls': [/\.task-note-delete\{[^}]*min-inline-size:2\.5rem/, /stroke-width:2\.1/],
  calendar: [/\.cal-note-x\{[^}]*min-inline-size:2\.5rem/, /pointer:coarse/],
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

// 1. byte-identity of every round sheet off its page + 2. the content probes
for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const t of targets) {
    const re = new RegExp(`(?:href)="(/dist/${t}\\.[a-f0-9]+\\.css)"`)
    const ref = re.exec(html)?.[1] || null
    const local = ref ? localFile(t, '.css') : null
    if (ref && local) {
      const text = await check(`${t}.css (wired, off ${page})`, BASE + ref, join(DIST, local))
      if (text) {
        for (const probe of CONTENT_PROBES[t] || []) {
          const hit = probe.test(text)
          if (!hit) fail = true
          results.push(`${hit ? '✓' : '✗'} live ${t}.css carries ${probe}`)
        }
      }
    } else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// 3. sw.js version
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  const ok = sw.includes(`const VERSION = "${EXPECT_SW}"`)
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} sw.js VERSION = ${EXPECT_SW}`)
}

// 4. health (no migration this round — schema stays 63)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  const ok = h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA
  if (!ok) fail = true
  results.push(`${ok ? '✓' : '✗'} health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

console.log(results.join('\n'))
console.log(`\nS197 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
