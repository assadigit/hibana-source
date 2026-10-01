#!/usr/bin/env node
// S183 live byte-verify — the DEPTH-AUDIT round must land byte-identical on
// hibana.ir. The round changed NINE public assets (dashboard.css — the head-in-
// panel strip grammar + the panel classes + --shadow-card + the min-inline-size
// 390px guard; dashboard-todo.css — the panel restructure + the compact rows +
// the listwrap fade edges + the hidden scrollbar; quicknotes.css — the notebook
// card restructure + the composer gray-well fix; misc.css — the prog-track trim
// + the ov-collapse panel grammar; polish-ui.css — the resume strip restructure
// + the retired progress rules; claude-dark-theme.css — the dark L4 split
// (#191817) + the four new panel tints; app.js — syncDashTodoFades; resume.js —
// the head-in-card + the retired progress bar; i18n-en.js + i18n.js (+ its lazy
// i18n-fa.js twin) — the resume.progress key removed, parity 1553) + sw.js v418
// (every shell page changed markup). This pins those nine plus sw v418 and the
// health endpoint — schema stays 63 (NO migration; pure frontend).
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v418'
const EXPECT_SCHEMA = '63'
// the five assets dashboard.html references directly…
const TARGETS = ['dashboard', 'dashboard-todo', 'quicknotes', 'misc', 'polish-ui', 'claude-dark-theme', 'app', 'resume', 'i18n-en', 'i18n']
const results = []
let fail = false

// /dashboard.html 307s to the extensionless /dashboard (the S158 live form)
const html = await (await fetch(`${BASE}/dashboard.html`, { cache: 'no-store' })).text()
const refs = {}
for (const t of TARGETS) {
  const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
  refs[t] = re.exec(html)?.[1] || null
  results.push(`markup: wired ${t} ref = ${refs[t] || 'MISSING'}`)
}

// …and i18n-fa, whose dist ref only exists inside i18n.js's body (the lazy
// FA dictionary the build's fixpoint loop rewrites)
const localFile = (prefix) =>
  readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && (f.endsWith('.js') || f.endsWith('.css'))) || null

const check = async (label, liveUrl, localName) => {
  const local = readFileSync(join(DIST, localName))
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); fail = true; return null }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  if (!same) fail = true
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
  return buf.toString()
}

for (const t of TARGETS) {
  const local = localFile(t)
  if (refs[t] && local) await check(`${t} (wired)`, BASE + refs[t], local)
  else { results.push(`✗ ${t}: live ref or local file MISSING`); fail = true }
}

// i18n-fa: discovered from the live i18n.js body, then byte-compared
const i18nBody = refs['i18n'] ? await (await fetch(BASE + refs['i18n'], { cache: 'no-store' })).text() : ''
const faRef = /\/dist\/(i18n-fa\.[a-f0-9]+\.js)/.exec(i18nBody)?.[1] || null
results.push(`markup: wired i18n-fa ref (inside i18n.js) = ${faRef ? '/' + faRef : 'MISSING'}`)
const faLocal = localFile('i18n-fa')
if (faRef && faLocal) await check('i18n-fa (lazy twin)', `${BASE}/dist/${faRef}`, faLocal)
else { results.push('✗ i18n-fa: live ref or local file MISSING'); fail = true }

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
