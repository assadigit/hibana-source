// s206 repro #12 — the tail + the hang, one foreground process (the sandbox kills
// detached background procs). Wrangler tail (json) streams the Worker's invocations
// while the dialog flow reproduces the hang; then we dump what the Worker SAW.
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const run = async () => {
  const tail = spawn('node', ['node_modules/.bin/wrangler', 'tail', 'hibana-prod', '--format', 'json'], {
    cwd: process.cwd(),
    env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CF_ACCOUNT },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const events = []
  tail.stdout.on('data', (d) => {
    const chunk = String(d)
    // json lines may be pretty-printed multi-object streams — split on top-level closing braces
    for (const m of chunk.split('}\n{').length ? [chunk] : [chunk]) { /* keep raw */ }
    events.push(chunk)
  })
  tail.stderr.on('data', (d) => process.stderr.write('[tail] ' + d))
  await new Promise((r) => setTimeout(r, 15000)) // let the tail connect

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route('**/sw.js', (route) => route.abort()) // NO service worker — the pure origin path
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro12 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base12', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Twelve Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(4000)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  console.log('chips:', JSON.stringify(chips.map((c) => c.slice(0, 30))))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
  await new Promise((r) => setTimeout(r, 6000)) // drain tail events
  tail.kill('SIGTERM')

  const all = events.join('')
  const urls = [...all.matchAll(/"url": "(https:\/\/projects\.hibana\.ir\/api\/projects\/[^"]+)"/g)].map((m) => m[1])
  console.log('\n=== WORKER-SIDE api/projects invocations (' + urls.length + ') ===')
  for (const u of urls) console.log('  ' + u.replace('https://projects.hibana.ir', ''))
  const outcomes = [...all.matchAll(/"outcome": "([a-z]+)"/g)].map((m) => m[1])
  console.log('outcomes:', JSON.stringify(outcomes))
  const cpuTimes = [...all.matchAll(/"cpuTime": ([0-9]+)/g)].map((m) => m[1])
  console.log('cpuTimes:', JSON.stringify(cpuTimes))
  const excs = all.includes('"exceptions": [\n    ]') ? 'none' : 'SOME!'
  console.log('exceptions blocks:', (all.match(/"exceptions": \[/g) || []).length, '— nonempty:', !all.includes('"exceptions": [\n    ]'))
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
