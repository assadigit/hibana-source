// s206 repro #14 — the HOST test: the same dialog flow against hibana.ir (the
// primary host) vs projects.hibana.ir (the S205 custom-domain attachment). If the
// hang is host-specific, it's a zone/route config issue, not app code.
import { chromium } from '@playwright/test'

const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const flowOn = async (browser, base, label) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${base}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async (label) => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `S206 repro14 ${label} (self-cleaning)`, status: 'developing' }) })).json()), label)
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base14', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${base}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', label + ' Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  const hung = !chips.some((c) => c.includes(label))
  console.log(`${label}: hung=${hung} chips=${JSON.stringify(chips.map((c) => c.slice(0, 26)))}`)
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await page.close()
  return hung
}

const run = async () => {
  const browser = await chromium.launch()
  // interleave: primary host, custom host, primary again
  await flowOn(browser, 'https://hibana.ir', 'hibana-ir-1')
  await flowOn(browser, 'https://projects.hibana.ir', 'projects-ir-1')
  await flowOn(browser, 'https://hibana.ir', 'hibana-ir-2')
  await flowOn(browser, 'https://projects.hibana.ir', 'projects-ir-2')
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
