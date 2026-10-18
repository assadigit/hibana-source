// s206 live repro #5 — A/B test: patch window.fetch to force {cache:'no-store'} on
// devboard GETs BEFORE walking the dialog. If the reload completes under no-store,
// the revalidation path is the hang's trigger and devboard.js api() gets the fix.
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const walkDialog = async (page, pid, name) => {
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', name)
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(2500)
  return page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
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

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro5 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base Sprint', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  // RUN A — the plain flow (expected: hangs, stale)
  const chipsA = await walkDialog(page, pid, 'A Plain Sprint')
  console.log('RUN A (plain):', JSON.stringify(chipsA))

  // RUN B — patch fetch: no-store on devboard GETs
  await page.evaluate(() => {
    const orig = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (/devboard/.test(url) && (!init || !init.method || init.method === 'GET')) {
        return orig(input, { ...(init || {}), cache: 'no-store' })
      }
      return orig(input, init)
    }
  })
  const chipsB = await walkDialog(page, pid, 'B NoStore Sprint')
  console.log('RUN B (no-store):', JSON.stringify(chipsB))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
