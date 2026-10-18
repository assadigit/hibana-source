// s206 repro #13 — loop the dialog flow under the tail until a HANG reproduces;
// dump what the Worker SAW for the hung iteration (did the GET arrive? outcome?).
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const flow = async (page, iter) => {
  const proj = await page.evaluate(async (i) => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `S206 repro13-${i} (self-cleaning)`, status: 'developing' }) })).json()), iter)
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base13', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.evaluate(() => { window.__t0 = Date.now() })
  await page.waitForTimeout(600)
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Thirteen ' + iter)
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.evaluate(() => { window.__t0 = Date.now() })
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  const hung = !chips.some((c) => c.includes('Thirteen'))
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  return { hung, pid, chips: chips.map((c) => c.slice(0, 26)) }
}

const run = async () => {
  const tail = spawn('node', ['node_modules/.bin/wrangler', 'tail', 'hibana-prod', '--format', 'json'], {
    cwd: process.cwd(),
    env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CF_ACCOUNT },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chunks = []
  const markers = []
  tail.stdout.on('data', (d) => { const s = String(d); chunks.push(s); if (/api\/projects/.test(s)) markers.push(Date.now()) })
  tail.stderr.on('data', () => {})
  await new Promise((r) => setTimeout(r, 15000))

  const browser = await chromium.launch()
  let page
  let result = null
  for (let i = 1; i <= 4; i++) {
    if (!page || i > 1) { if (page) await page.close(); page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); page.setDefaultTimeout(20000); await page.goto(`${BASE}/login.html`); await page.fill('[name="login"]', EMAIL); await page.fill('[name="password"]', PASS); await page.click('button[type=submit]'); await page.waitForURL(/\/app/) }
    const r = await flow(page, i)
    console.log(`iter ${i}: hung=${r.hung} chips=${JSON.stringify(r.chips)}`)
    if (r.hung) { result = { iter: i, pid: r.pid }; break }
  }
  await browser.close()
  await new Promise((r) => setTimeout(r, 8000))
  tail.kill('SIGTERM')

  const all = chunks.join('')
  console.log('\n=== WORKER-SIDE api/projects invocations, in order ===')
  const re = /"wallTime": ([0-9]+),[\s\S]{0,400}?"url": "(https:\/\/projects\.hibana\.ir\/api\/projects\/[^"]+)",\n\s+"method": "([A-Z]+)"/g
  const seen = [...all.matchAll(re)]
  console.log('(parsed ' + seen.length + ' of ' + (all.match(/api\/projects/g) || []).length + ' mentions)')
  for (const m of all.split('\n').filter((l) => /"outcome"|"url"|wallTime/.test(l)).slice(0, 0)) { /* placeholder */ }
  // simpler: dump every url+method+outcome triple in stream order
  const triples = []
  const lines = all.split('}')
  // events are pretty-printed JSON objects concatenated; use a streaming scan instead
  let buf = ''
  const objRe = /\{[\s\S]*?"event": \{[\s\S]*?"response": \{[\s\S]*?"status": [0-9]+\s*\}\s*\}\s*\}/g
  for (const m of all.matchAll(/"url": "(https:\/\/projects\.hibana\.ir\/api\/[^"]+)",\n\s+"method": "([A-Z]+)"/g)) {
    triples.push(m[1].replace('https://projects.hibana.ir', '') + ' ' + m[2])
  }
  triples.forEach((t) => console.log('  ' + t))
  console.log('outcomes:', JSON.stringify([...all.matchAll(/"outcome": "([a-z]+)"/g)].map((m) => m[1])))
  console.log('statuses:', JSON.stringify([...all.matchAll(/"response": \{\n\s+"status": ([0-9]+)/g)].map((m) => m[1])))
  if (result) console.log('\nHUNG at iter', result.iter, 'pid', result.pid)
  else console.log('\nno hang reproduced in 4 iters')
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
