#!/usr/bin/env node
// S187 live byte-verify — the to-do empty-state round must land byte-identical on
// hibana.ir. The round changed SEVEN hashed public assets (2 css + 5 js):
//   dashboard-todo.css (the centered status line + the .card .dash-todo-list
//   symmetric-padding override + the retired add-text rules), dashboard.css (the
//   .dash-empty comment clarifying the retired register), app.js (the client
//   DASH_TODO_EMPTY_LINE map + the stripped updateDashTaskEmpty twin), i18n-en.js
//   + i18n.js + the lazily-injected i18n-fa.js twin (quadrantEmptyQ1..Q4; the
//   quadrantEmpty + addTask pair retires — parity 1555), sadhana-page.js (the
//   pointed hint + the quadrant-named footer ＋), sadhana-board.css (the empty
//   block's margin-block:auto centering) — plus every shell page's ?v= busts and
//   sw.js v422. No migration: schema stays 63.
// sadhana.html alone wires ALL SEVEN assets; dashboard.html double-covers the
// five app-wide ones. The i18n-fa twin rides INSIDE i18n.js's rewritten literal
// (no page ref) — its hash is extracted from the LIVE i18n.js body.
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v422'
const EXPECT_SCHEMA = '63'
const PAGE_TARGETS = {
  'sadhana.html': ['dashboard-todo', 'dashboard', 'app', 'i18n-en', 'i18n', 'sadhana-page', 'sadhana-board'],
  'dashboard.html': ['dashboard-todo', 'dashboard', 'app', 'i18n-en', 'i18n'],
}
const results = []
let fail = false

const localFile = (prefix) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && (f.endsWith('.js') || f.endsWith('.css'))) || null

const check = async (label, liveUrl, localPath) => {
  const local = readFileSync(localPath)
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
}

let liveI18nBody = null
for (const [page, targets] of Object.entries(PAGE_TARGETS)) {
  // pages 307 to their extensionless live form — fetch follows redirects
  const html = await (await fetch(`${BASE}/${page}`, { cache: 'no-store' })).text()
  for (const t of targets) {
    const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
    const ref = re.exec(html)?.[1] || null
    const local = localFile(t)
    if (ref && local) {
      await check(`${t} (wired, off ${page})`, BASE + ref, join(DIST, local))
      if (t === 'i18n' && page === 'sadhana.html') liveI18nBody = await (await fetch(BASE + ref, { cache: 'no-store' })).text()
    }
    else { results.push(`✗ ${t}: live ref or local file MISSING (off ${page})`); fail = true }
  }
}

// the lazily-injected i18n-fa twin: no page ref — the rewritten literal inside
// the LIVE i18n.js names it; byte-compare that dist file too.
if (liveI18nBody) {
  const faRef = /\/dist\/(i18n-fa\.[a-f0-9]+\.js)/.exec(liveI18nBody)?.[1] || null
  const faLocal = localFile('i18n-fa')
  if (faRef && faLocal) await check(`i18n-fa (lazy twin, ref inside live i18n.js)`, `${BASE}/dist/${faRef}`, join(DIST, faLocal))
  else { results.push('✗ i18n-fa: live literal or local file MISSING'); fail = true }
} else {
  results.push('✗ i18n-fa: live i18n.js body not captured'); fail = true
}

// the S187 markup pin — the wired sadhana page must speak the new grammar:
// no .dash-todo-add-text anywhere in its app.js is already byte-proven; pin the
// quadrant-empty keys present in the live i18n-en bundle instead.
const enLocal = localFile('i18n-en')
if (enLocal) {
  const enBody = readFileSync(join(DIST, enLocal), 'utf8')
  const hasKeys = ["'dashboard.quadrantEmptyQ1'", "'dashboard.quadrantEmptyQ3'", "'dashboard.quadrantEmptyQ2'", "'dashboard.quadrantEmptyQ4'"].every((k) => enBody.includes(k))
  results.push(`${hasKeys ? '✓' : '✗'} i18n-en: quadrantEmptyQ1..Q4 keys present locally`)
  if (!hasKeys) fail = true
}

const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
const swV = /hibana-v[0-9]+/.exec(sw)?.[0] || 'MISSING'
results.push(`sw.js VERSION: ${swV} (expect ${EXPECT_SW}) ${swV === EXPECT_SW ? '✓' : '✗'}`)
if (swV !== EXPECT_SW) fail = true

const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json().catch(() => null)
results.push(`health: ${JSON.stringify(health)}`)
if (!health || health.ok !== true) fail = true
if (health && String(health.db?.schema_version ?? health.schema_version ?? '') !== EXPECT_SCHEMA) {
  results.push(`✗ schema_version: expected ${EXPECT_SCHEMA} — UNEXPECTED DRIFT (no migration shipped this round)`)
  fail = true
}

console.log(results.join('\n'))
process.exit(fail ? 1 : 0)
