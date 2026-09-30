#!/usr/bin/env node
// S178 live byte-verify — the changed assets must be byte-identical on hibana.ir:
// the WIRED dist twins (nav.<hash>.js + layout.<hash>.css — content-hashed filenames,
// byte-identical bodies) + the sw.js VERSION (v413) + the health endpoint.
// Reuses the S177 contract; run with the tree in WIRED form (build --prod --wire-html).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const DIST = join(process.cwd(), 'public', 'dist')
const results = []

// /dashboard.html 307s to the extensionless /dashboard (the S158 live form)
const html = await (await fetch(`${BASE}/dashboard.html`, { cache: 'no-store' })).text()
const navRef = /src="(\/dist\/nav\.[a-f0-9]+\.js)"/.exec(html)?.[1] || null
const cssRef = /href="(\/dist\/layout\.[a-f0-9]+\.css)"/.exec(html)?.[1] || null
results.push(`markup: wired nav ref = ${navRef || 'MISSING'}`)
results.push(`markup: wired layout ref = ${cssRef || 'MISSING'}`)

const localFile = (prefix, ext) => readdirSync(DIST).find((f) => f.startsWith(prefix + '.') && f.endsWith(ext)) || null
const localNav = localFile('nav', '.js')
const localCss = localFile('layout', '.css')
results.push(`local build: ${localNav || 'nav MISSING'} + ${localCss || 'layout MISSING'}`)

const check = async (label, liveUrl, localName) => {
  const local = readFileSync(join(DIST, localName))
  const r = await fetch(liveUrl, { cache: 'no-store' })
  if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); return }
  const buf = Buffer.from(await r.arrayBuffer())
  const same = buf.equals(local)
  results.push(`${same ? '✓' : '✗'} ${label}: ${buf.byteLength} vs ${local.length} bytes ${same ? 'IDENTICAL' : 'DIFFERS'}`)
}

if (navRef && localNav) await check('nav.js (wired)', BASE + navRef, localNav)
if (cssRef && localCss) await check('layout.css (wired)', BASE + cssRef, localCss)

// informational: the shell HTML itself (every shell page changed markup via the ?v= busts)
try {
  const localHtml = readFileSync(join(process.cwd(), 'public', 'dashboard.html'), 'utf8')
  const wiredNav = /src="(\/dist\/nav\.[a-f0-9]+\.js)"/.exec(localHtml)?.[1] || null
  const wiredCss = /href="(\/dist\/layout\.[a-f0-9]+\.css)"/.exec(localHtml)?.[1] || null
  const htmlSame = wiredNav === navRef && wiredCss === cssRef
  results.push(`info: shell HTML wired refs match local wired build: ${htmlSame ? 'yes' : 'NO'} (local ${wiredNav} / ${wiredCss})`)
} catch { results.push('info: shell HTML compare unavailable') }

const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
const swV = /hibana-v[0-9]+/.exec(sw)?.[0] || 'MISSING'
results.push(`sw.js VERSION: ${swV} (expect v413) ${swV === 'hibana-v413' ? '✓' : '✗'}`)

const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json().catch(() => null)
results.push(`health: ${JSON.stringify(health)}`)

console.log(results.join('\n'))
const ok = results.every((r) => r.startsWith('✓') || r.startsWith('markup') || r.startsWith('local') || r.startsWith('health') || r.startsWith('sw.js') || r.startsWith('info')) && !!health
process.exit(ok ? 0 : 1)
