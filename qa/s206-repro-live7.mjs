// s206 live repro #7 — the settle test: load the page, WAIT OUT the SW install
// (15s), then the dialog create. Works ⇒ the hang is a first-visit/install-window
// artifact; still hangs ⇒ a persistent bug.
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro7 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base7', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  // WAIT OUT the install storm
  await page.waitForTimeout(15000)
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return { controller: !!navigator.serviceWorker.controller, state: reg ? (reg.installing ? 'installing' : reg.waiting ? 'waiting' : reg.active ? 'active' : 'none') : 'unregistered' }
  })
  console.log('SW state after settle:', JSON.stringify(swState))

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Settled Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(2500)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  console.log('CHIPS after settled create:', JSON.stringify(chips.map((c) => c.slice(0, 34))))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
