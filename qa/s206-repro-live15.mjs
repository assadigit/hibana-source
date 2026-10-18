// s206 repro #15 — validate the timeout+retry workaround ON PROD: wrap window.fetch
// so GETs abort after 3s and retry once, then run the dialog flow 4× (both hosts).
import { chromium } from '@playwright/test'

const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const PATCH = () => {
  const orig = window.fetch
  window.__retries = 0
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const isGet = !init || !init.method || init.method === 'GET'
    if (!isGet || !/api/.test(url)) return orig(input, init)
    const send = (signal) => orig(input, { ...(init || {}), signal })
    return new Promise((resolve, reject) => {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 3000)
      send(ctl.signal).then(
        (r) => { clearTimeout(timer); resolve(r) },
        (e) => {
          clearTimeout(timer)
          if (e && e.name === 'AbortError') {
            window.__retries++
            const ctl2 = new AbortController()
            const t2 = setTimeout(() => ctl2.abort(), 10000)
            send(ctl2.signal).then((r) => { clearTimeout(t2); resolve(r) }, (e2) => { clearTimeout(t2); reject(e2) })
          } else reject(e)
        },
      )
    })
  }
}

const flowOn = async (browser, base, label) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${base}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async (label) => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `S206 repro15 ${label} (self-cleaning)`, status: 'developing' }) })).json()), label)
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Base15', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${base}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(600)
  await page.evaluate(PATCH) // the workaround, installed before the create

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', label + ' Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(4500)
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  const retries = await page.evaluate(() => window.__retries)
  const hung = !chips.some((c) => c.includes(label))
  console.log(`${label}: hung=${hung} retries=${retries} chips=${JSON.stringify(chips.map((c) => c.slice(0, 26)))}`)
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await page.close()
  return hung
}

const run = async () => {
  const browser = await chromium.launch()
  await flowOn(browser, 'https://hibana.ir', 'wk-hibana-1')
  await flowOn(browser, 'https://projects.hibana.ir', 'wk-projects-1')
  await flowOn(browser, 'https://hibana.ir', 'wk-hibana-2')
  await flowOn(browser, 'https://projects.hibana.ir', 'wk-projects-2')
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
