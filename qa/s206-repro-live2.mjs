// s206 live repro #2 — the stale in-page reload on live. Resource Timing tells the
// truth about whether reload()'s GET fired and where it came from.
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS
if (!EMAIL || !PASS) { console.error('env required'); process.exit(1) }

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|manifest/i.test(m.text())) errors.push('console: ' + m.text()) })

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro2 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  console.log('project', pid)
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fix Sprint', started_at: today + 'T00:00:00Z' }) })
  }, pid)

  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  // reset resource timing, then create through the dialog
  await page.evaluate(() => performance.clearResourceTimings())
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Repro2 Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)

  const diag = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource').filter((e) => /devboard|sprints/.test(e.name)).map((e) => ({ url: e.name.replace(location.origin, ''), status: e.responseStatus, transfer: e.transferSize, cached: e.transferSize === 0 }))
    const B = window.HibanaBoard
    return {
      entries,
      sprints: (B && B.state.sprints || []).map((s) => s.name),
      chips: [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()),
      toasts: [...document.querySelectorAll('[class*=toast]')].map((t) => t.textContent.trim()).slice(-4),
    }
  })
  console.log('DIAG:', JSON.stringify(diag, null, 1))
  console.log('ERRORS:', JSON.stringify(errors))

  // in-page fresh fetch — is the data on the server?
  const fresh = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}/devboard`, { cache: 'no-store' })
    const j = await r.json()
    return { status: r.status, names: (j.sprints || []).map((s) => s.name) }
  }, pid)
  console.log('FRESH FETCH:', JSON.stringify(fresh))

  // cleanup
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
