// s206 live repro #9 — raw CDP Network domain: watch EVERY network event (incl.
// SW-internal fetches) around the first dialog create. Did response bytes arrive?
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  const cdp = await page.context().newCDPSession(page)
  const net = []
  cdp.on('Network.requestWillBeSent', (e) => { if (/devboard|sprints/.test(e.request.url)) net.push(['>req', e.requestId.slice(-6), e.request.url.slice(-46), e.request.headers['if-none-match'] || '-']) })
  cdp.on('Network.responseReceived', (e) => { if (/devboard|sprints/.test(e.response.url)) net.push(['<resp', e.requestId.slice(-6), e.response.status, (e.response.headers || {})['content-length'] || '-']) })
  cdp.on('Network.loadingFailed', (e) => net.push(['!fail', e.requestId.slice(-6), e.errorText]))
  cdp.on('Network.loadingFinished', (e) => net.push(['=done', e.requestId.slice(-6), e.encodedDataLength]))
  await cdp.send('Network.enable')

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro9 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base9', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  net.length = 0 // only the sprint-page events from here
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)
  console.log('--- boot events ---')
  net.forEach((e) => console.log(JSON.stringify(e)))
  net.length = 0

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Nine Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  net.length = 0
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)
  console.log('--- create events ---')
  net.forEach((e) => console.log(JSON.stringify(e)))
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  console.log('chips:', JSON.stringify(chips.map((c) => c.slice(0, 30))))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
