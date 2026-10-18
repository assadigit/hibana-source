// s206 live repro #4 — instrument B().load + fetch INSIDE the live page, then walk
// the define-dialog flow. The log tells us exactly where commit() stops.
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  const consoleMsgs = []
  page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 160)))
  page.on('pageerror', (e) => consoleMsgs.push('PAGEERROR: ' + e.message.slice(0, 200)))

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro4 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fix4 Sprint', started_at: today + 'T00:00:00Z' }) })
  }, pid)

  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  // INSTRUMENT: wrap B.load + global fetch
  await page.evaluate(() => {
    window.__log = []
    const B = window.HibanaBoard
    const origLoad = B.load
    B.load = async function (id) {
      window.__log.push('load-called ' + id)
      try {
        const r = await origLoad.call(this, id)
        window.__log.push('load-resolved sprints=' + (r.sprints || []).length)
        return r
      } catch (e) {
        window.__log.push('load-threw ' + (e && e.message))
        throw e
      }
    }
    const origFetch = window.fetch
    window.fetch = function (...args) {
      const u = String(args[0])
      if (/devboard|sprints/.test(u)) window.__log.push('fetch ' + u.slice(-40))
      return origFetch.apply(this, args).then(
        (r) => { if (/devboard|sprints/.test(u)) window.__log.push('fetch-done ' + r.status); return r },
        (e) => { if (/devboard|sprints/.test(u)) window.__log.push('fetch-failed ' + (e && e.message)); throw e },
      )
    }
  })

  // the dialog flow
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Repro4 Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)

  const log = await page.evaluate(() => window.__log)
  console.log('LOG:', JSON.stringify(log, null, 1))
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  console.log('CHIPS:', JSON.stringify(chips))
  console.log('CONSOLE (last 8):', JSON.stringify(consoleMsgs.slice(-8)))

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
