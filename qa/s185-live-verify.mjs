#!/usr/bin/env node
// S185 live byte-verify — the COLOR BATCH-1 round must land byte-identical on
// hibana.ir. The round changed THREE public CSS assets (variables.css — the S185
// role-token palette block: --page-bg/--surface/--border-soft/--text-muted/
// --primary + the five --col-* one-family sets + the four --prio-* pairs;
// claude-dark-theme.css — the tokens' dark twins: clay primary, near-black canvas,
// low-alpha column washes; project-header.css — the five column rules + the prio
// options resolving through the tokens + the scoped body.pd-page canvas/card/
// field affordances) + project.html's own body class + sw.js v420 (every shell
// page changed markup via the ?v= busts: variables v24 + claude-dark v27 ×27,
// project-header v49 ×23). No JS changed this round. This pins those three (off
// project.html, the round's page) plus sw v420 and the health endpoint — schema
// stays 63 (NO migration; pure frontend).
// Run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const EXPECT_SW = 'hibana-v420'
const EXPECT_SCHEMA = '63'
// the three assets project.html references directly…
const TARGETS = ['variables', 'claude-dark-theme', 'project-header']
const results = []
let fail = false

// /project.html 307s to the extensionless /project (the S158 live form)
const html = await (await fetch(`${BASE}/project.html`, { cache: 'no-store' })).text()
const refs = {}
for (const t of TARGETS) {
  const re = new RegExp(`(?:src|href)="(/dist/${t}\\.[a-f0-9]+\\.(?:js|css))"`)
  refs[t] = re.exec(html)?.[1] || null
  results.push(`markup: wired ${t} ref = ${refs[t] || 'MISSING'}`)
}

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
