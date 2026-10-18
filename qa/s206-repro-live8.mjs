// s206 live repro #8 — isolate the fix on FIRST creates, each in a FRESH context:
//   ctx1: no-store only (the deployed fix — suspected insufficient)
//   ctx2: URL cache-buster (?_=now — unique URL, no cache machinery at all)
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const runCtx = async (browser, label, patch) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async (label) => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro8 ' + label + ' (self-cleaning)', status: 'developing' }) })).json()), label)
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base8', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  // install the patch (a fetch wrapper) BEFORE the FIRST create
  await page.evaluate(patch)

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', label + ' Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(2500)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  console.log(label + ' FIRST-create chips:', JSON.stringify(chips.map((c) => c.slice(0, 32))))
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await page.close()
}

const run = async () => {
  const browser = await chromium.launch()
  await runCtx(browser, 'ctx1-nostore', () => {
    const orig = window.fetch
    window.fetch = function (input, init) {
      return orig(input, { ...(init || {}), cache: 'no-store' })
    }
  })
  await runCtx(browser, 'ctx2-bust', () => {
    const orig = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (/devboard/.test(url) && (!init || !init.method || init.method === 'GET')) {
        return orig(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), { ...(init || {}), cache: 'no-store' })
      }
      return orig(input, init)
    }
  })
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
