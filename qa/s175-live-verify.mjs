#!/usr/bin/env node
// S175 live byte-verify — the changed assets must be byte-identical on hibana.ir
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
const cssHeader = /href="(\/css\/project-header[^"]+)"/.exec(html)
const cssPolish = /href="(\/css\/polish-batch[^"]+)"/.exec(html)
const jsPage = /src="(\/js\/project-page[^"]+)"/.exec(html)
results.push(`markup: data-pd-col-collapse present = ${html.includes('data-pd-col-collapse')}`)
results.push(`markup: #pd-tasks- ids present = ${html.includes('id="pd-tasks-')}`)
results.push(`markup: chevron path present = ${html.includes('M6 9l6 6 6-6')}`)

const jobs = []
if (cssHeader) jobs.push(check('project-header.css', BASE + cssHeader[1], cssHeader[1].split('/').pop()))
else results.push('✗ project-header.css: no reference found in live HTML')
if (cssPolish) jobs.push(check('polish-batch.css', BASE + cssPolish[1], cssPolish[1].split('/').pop()))
else results.push('✗ polish-batch.css: no reference found in live HTML')
if (jsPage) jobs.push(check('project-page.js', BASE + jsPage[1], jsPage[1].split('/').pop()))
else results.push('✗ project-page.js: no reference found in live HTML')
await Promise.all(jobs)

// sw.js VERSION
const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
results.push(`${sw.includes('hibana-v410') ? '✓' : '✗'} sw.js VERSION = hibana-v410 (${/const VERSION = "([^"]+)"/.exec(sw)?.[1]})`)

// health
const health = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
results.push(`health: ${health.ok ? '✓' : '✗'} ok=${health.ok} env=${health.environment} schema=${health.schema_version}`)

console.log(results.join('\n'))
if (results.some((l) => l.startsWith('✗'))) process.exit(1)
