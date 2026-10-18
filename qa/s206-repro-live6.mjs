// s206 live repro #6 — CDP-level network truth + the no-SW control:
//   A) with the SW: does the devboard GET reach the NETWORK layer at all?
//   B) without the SW (unregistered + fresh load): does the dialog reload work?
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const flow = async (page, pid, tag) => {
  page.removeAllListeners('request')
  page.removeAllListeners('response')
  page.removeAllListeners('requestfailed')
  const net = []
  page.on('request', (r) => { if (/devboard/.test(r.url())) net.push('req') })
  page.on('response', (r) => { if (/devboard/.test(r.url())) net.push('resp:' + r.status()) })
  page.on('requestfailed', (r) => { if (/devboard/.test(r.url())) net.push('FAILED:' + (r.failure() && r.failure().errorText)) })

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop', { timeout: 15000 })
  await page.fill('[data-sp-define-name]', tag + ' Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(2500)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  return { net, chips: chips.map((c) => c.slice(0, 30)) }
}

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro6 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base6', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)
  const swOn = await page.evaluate(() => !!navigator.serviceWorker.controller)
  console.log('SW controlling:', swOn)

  // A) WITH the SW
  console.log('A (SW on):', JSON.stringify(await flow(page, pid, 'A')))
  // B) WITHOUT the SW — unregister, hard reload (no controller)
  await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister() })
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(800)
  console.log('SW controlling after unregister+reload:', await page.evaluate(() => !!navigator.serviceWorker.controller))
  console.log('B (SW off):', JSON.stringify(await flow(page, pid, 'B')))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
