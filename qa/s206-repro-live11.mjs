// s206 live repro #11 — SW blocked + raw CDP Network on the page session: does the
// GET request actually LEAVE the renderer (server-side hang) or never dispatch
// (client-side hang)?
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const run = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route('**/sw.js', (route) => route.abort())
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  const cdp = await ctx.newCDPSession(page)
  const net = []
  cdp.on('Network.requestWillBeSent', (e) => { if (/devboard|sprints/.test(e.request.url)) net.push(['>req', e.request.url.slice(-40)]) })
  cdp.on('Network.responseReceived', (e) => { if (/devboard|sprints/.test(e.response.url)) net.push(['<resp', e.response.status]) })
  cdp.on('Network.loadingFailed', (e) => net.push(['!fail', e.errorText]))
  await cdp.send('Network.enable')

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro11 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base11', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  net.length = 0
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)
  console.log('boot:', JSON.stringify(net))
  net.length = 0

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Eleven Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)
  console.log('create:', JSON.stringify(net))
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  console.log('chips:', JSON.stringify(chips.map((c) => c.slice(0, 30))))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
