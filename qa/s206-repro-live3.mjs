// s206 live repro #3 — call B().load() directly on the live page after a create:
// does it resolve, throw, or hang? This isolates the break point.
import { chromium } from '@playwright/test'

const BASE = 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  const consoleMsgs = []
  page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text()))

  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 repro3 (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fix3 Sprint', started_at: today + 'T00:00:00Z' }) })
  }, pid)

  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(800)

  // direct load() call with a timeout race — does it resolve/throw/hang?
  const loadProbe = await page.evaluate(async (pid) => {
    const B = window.HibanaBoard
    const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve({ hung: true }), ms))
    try {
      const res = await Promise.race([
        B.load(pid).then((d) => ({ ok: true, sprints: (d.sprints || []).map((s) => s.name) }), (e) => ({ threw: String(e && e.message || e) })),
        timeout(5000),
      ])
      return res
    } catch (e) { return { threwOuter: String(e && e.message || e) } }
  }, pid)
  console.log('DIRECT B().load():', JSON.stringify(loadProbe))

  // and the raw api() path — the 304 question, once and for all
  const apiProbe = await page.evaluate(async (pid) => {
    const raw = await fetch(`/api/projects/${pid}/devboard`)
    const j = await raw.json()
    return { firstStatus: raw.status, etag: raw.headers.get('etag'), cacheCtrl: raw.headers.get('cache-control'), names: (j.sprints || []).map((s) => s.name) }
  }, pid)
  console.log('RAW fetch #1:', JSON.stringify(apiProbe))
  const apiProbe2 = await page.evaluate(async (pid) => {
    const raw = await fetch(`/api/projects/${pid}/devboard`) // same URL again — revalidation path
    return { secondStatus: raw.status, body: raw.status === 200 ? ((await raw.json()).sprints || []).length : 'n/a' }
  }, pid)
  console.log('RAW fetch #2 (same URL):', JSON.stringify(apiProbe2))

  // create another sprint, then B().load() again — the EXACT post-create state
  const created = await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    const r = await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'After Load Sprint', started_at: today + 'T00:00:00Z', ended_at: plus3 + 'T23:59:59Z' }) })
    return r.status
  }, pid)
  console.log('create #2 status:', created)
  const loadProbe2 = await page.evaluate(async (pid) => {
    const B = window.HibanaBoard
    const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve({ hung: true }), ms))
    return await Promise.race([
      B.load(pid).then((d) => ({ ok: true, sprints: (d.sprints || []).map((s) => s.name) }), (e) => ({ threw: String(e && e.message || e) })),
      timeout(5000),
    ])
  }, pid)
  console.log('B().load() after create #2:', JSON.stringify(loadProbe2))

  console.log('CONSOLE (last 10):', JSON.stringify(consoleMsgs.slice(-10)))
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
