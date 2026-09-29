#!/usr/bin/env node
// S176 live byte-verify — the changed assets must be byte-identical on hibana.ir
// (the wired dist twins of the canonical ?v= references in project.html + sw.js VERSION).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const dist = (f) => readFileSync(join(process.cwd(), 'dist', f))

const html = await (await fetch(`${BASE}/project.html`, { cache: 'no-store' })).text()
const results = []
const check = (label, liveUrl, localFile) => {
  const local = dist(localFile)
  return fetch(liveUrl, { cache: 'no-store' }).then((r) => {
    if (!r.ok) { results.push(`✗ ${label}: HTTP ${r.status}`); return }
    return r.arrayBuffer().then((buf) => {
      const same = Buffer.from(buf).equals(local)
      results.push(`${same ? '✓' : '✗'} ${label}: ${liveUrl} ${same ? 'IDENTICAL' : 'DIFFERS'} (${buf.byteLength} vs ${local.length} bytes)`)
    })
  })
}

// extract the wired asset URLs from the live HTML
const ref = (re) => { const m = re.exec(html); return m ? m[1] : null }
const cssHeader = ref(/href="(\/css\/project-header[^"]+)"/)
const jsPage = ref(/src="(\/js\/project-page[^"]+)"/)
const jsChip = ref(/src="(\/js\/chip-render[^"]+)"/)
const jsI18nEn = ref(/src="(\/js\/i18n-en[^"]+)"/)
const jsI18n = ref(/src="(\/js\/i18n\.js[^"]+)"/)
results.push(`markup: v48 header css ref = ${cssHeader || 'MISSING'}`)
results.push(`markup: v74 project-page ref = ${jsPage || 'MISSING'}`)
results.push(`markup: v11 chip-render ref = ${jsChip || 'MISSING'}`)
results.push(`markup: v88 i18n-en ref = ${jsI18nEn || 'MISSING'}`)
results.push(`markup: v142 i18n.js ref = ${jsI18n || 'MISSING'}`)

const jobs = []
if (cssHeader) jobs.push(check('project-header.css', BASE + cssHeader, cssHeader.split('/').pop()))
if (jsPage) jobs.push(check('project-page.js', BASE + jsPage, jsPage.split('/').pop()))
if (jsChip) jobs.push(check('chip-render.js', BASE + jsChip, jsChip.split('/').pop()))
if (jsI18nEn) jobs.push(check('i18n-en.js', BASE + jsI18nEn, jsI18nEn.split('/').pop()))
if (jsI18n) jobs.push(check('i18n.js', BASE + jsI18n, jsI18n.split('/').pop()))
await Promise.all(jobs)

// the vendored highlight.js (lazy-loaded by the code-block runtime)
jobs.length = 0
const hljs = await fetch(`${BASE}/vendor/highlight.min.js`, { cache: 'no-store' })
const hljsLocal = readFileSync(join(process.cwd(), 'public', 'vendor', 'highlight.min.js'))
if (hljs.ok) {
  const buf = await hljs.arrayBuffer()
  const same = Buffer.from(buf).equals(hljsLocal)
  results.push(`${same ? '✓' : '✗'} vendor/highlight.min.js: ${same ? 'IDENTICAL' : 'DIFFERS'} (${buf.byteLength} vs ${hljsLocal.length} bytes)`)
} else results.push(`✗ vendor/highlight.min.js: HTTP ${hljs.status}`)

// sw.js VERSION
const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
results.push(`${sw.includes('hibana-v411') ? '✓' : '✗'} sw.js VERSION = hibana-v411 (${/const VERSION = "([^"]+)"/.exec(sw)?.[1]})`)

// health
const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
results.push(`health: ${health.ok ? '✓' : '✗'} ok=${health.ok} env=${health.environment} schema=${health.schema_version}`)

console.log(results.join('\n'))
if (results.some((l) => l.startsWith('✗'))) process.exit(1)
