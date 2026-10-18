// s206 final check — the in-page reload DELIVERS without a manual refresh: create →
// wait 6s (past the 3s abort + retry window) → chips WITHOUT any hard reload.
import { chromium } from '@playwright/test'

const BASE = 'https://hibana.ir' // the owner's daily host
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

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 final (self-cleaning)', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Final Base', started_at: today + 'T00:00:00Z' }) })
  }, pid)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(600)

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Final Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(6000) // PAST the 3s abort + retry window — NO reload
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim()))
  const ok = chips.some((c) => c.includes('Final Sprint'))
  console.log('IN-PAGE RELOAD DELIVERED:', ok, JSON.stringify(chips.map((c) => c.slice(0, 30))))

  // also: the quick-add path (the second mutation class)
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(300)
  await page.fill('[data-quickadd="none"]', 'final quickadd')
  await page.press('[data-quickadd="none"]', 'Enter')
  await page.waitForTimeout(5000)
  const taskCount = await page.evaluate(() => document.querySelectorAll('.sp-task').length)
  console.log('QUICK-ADD RENDERED tasks in sidebar:', taskCount)

  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  await browser.close()
  process.exit(ok ? 0 : 1)
}

run().catch((e) => { console.error('CRASHED:', e && e.message); process.exit(1) })
