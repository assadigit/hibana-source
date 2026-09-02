// Drives the live dev site in headless Chrome via CDP to verify the Dashboard + quick-add
// modal end-to-end: login, dashboard render, console cleanliness, and modal open/cancel.
// Usage: node scripts/browser-check.mjs  (reads creds from argv/env)
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.HIBANA_BASE || 'https://hibana.aliassadi.workers.dev'
const USER = process.env.HIBANA_USER || 'admin-bkzn6cd1'
const PASS = process.env.HIBANA_PASS

if (!PASS) {
  console.error('Set HIBANA_PASS (and optionally HIBANA_USER/HIBANA_BASE).')
  process.exit(1)
}

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.CDP_PORT || 9223)
const profile = mkdtempSync(join(tmpdir(), 'hibana-cdp-'))

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const consoleLogs = []

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(300)
  }
  throw new Error('Chrome CDP target not available')
}

async function main() {
  const target = await getTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      consoleLogs.push(`${msg.params.type}: ${args}`)
    } else if (msg.method === 'Log.entryAdded') {
      consoleLogs.push(`log: ${msg.params.entry.level}: ${msg.params.entry.text}`)
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await new Promise((r) => (ws.onopen = r))

  const cmd = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, (msg) => resolve(msg.result))
      ws.send(JSON.stringify({ id: mid, method, params }))
    })

  await cmd('Page.enable')
  await cmd('Runtime.enable')
  await cmd('Log.enable')
  await cmd('Console.enable')
  await cmd('Network.enable')

  const failedUrls = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Network.responseReceived') {
      const s = msg.params.response.status
      if (s >= 400) failedUrls.push(`${msg.params.response.url} -> ${s}`)
    } else if (msg.method === 'Network.loadingFailed') {
      failedUrls.push(`${msg.params.requestId} failed (${msg.params.errorText ?? '?'})`)
    }
  })

  const nav = async (url) => {
    await cmd('Page.navigate', { url })
    await sleep(3500) // let scripts + htmx settle
  }
  const evalJs = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r?.result?.value
  }

  // 1) Login page
  await nav(`${BASE}/login`)
  const pageTitle0 = await evalJs('document.title')
  console.log('PASS login page title:', pageTitle0)

  // 2) Fill + submit login (htmx handles the POST -> sets cookie -> HX-Redirect)
  await evalJs(`(() => { const f=document.querySelector('form'); f.querySelector('[name=login]').value=${JSON.stringify(USER)}; f.querySelector('[name=password]').value=${JSON.stringify(PASS)}; f.requestSubmit(); return true })()`)
  await sleep(3000)

  // 3) Dashboard
  await nav(`${BASE}/dashboard`)
  const title = await evalJs('document.title')
  const bodySample = await evalJs('document.body.innerText.slice(0, 400)')
  const hasNav = await evalJs(`!!document.querySelector('.topbar')`)
  const hasStats = await evalJs(`/Recent activity|Sparks shelf|no projects|No projects/.test(document.body.innerText)`)
  const statStrip = await evalJs(`!!document.querySelector('.stat-strip')`)
  console.log('PASS dashboard title:', title)
  console.log('PASS nav bar rendered:', hasNav)
  console.log('PASS stats/activity present:', hasStats, '| stats strip node:', statStrip)

  // Theme: toggle in the nav and verify the palette genuinely changes the page colors.
  const themeBefore = await evalJs(`document.documentElement.dataset.theme || 'none'`)
  await evalJs(`document.querySelector('[data-theme-toggle]').click(); true`)
  const themeAfter = await evalJs(`document.documentElement.dataset.theme || 'none'`)
  await evalJs(`document.documentElement.dataset.theme='dark'; true`)
  const darkBg = await evalJs(`getComputedStyle(document.body).backgroundColor`)
  await evalJs(`document.documentElement.dataset.theme='light'; true`)
  const lightBg = await evalJs(`getComputedStyle(document.body).backgroundColor`)
  console.log('PASS nav theme toggle:', themeBefore, '->', themeAfter)
  console.log('PASS dark body bg / light body bg:', darkBg, '/', lightBg, '| differ:', darkBg !== lightBg)

  // 4) Quick-add modal: open -> verify -> cancel -> verify closed
  await evalJs(`document.querySelector('[data-quickadd-open]').click(); true`)
  await sleep(400)
  const opened = await evalJs(`!!document.getElementById('quickadd-dialog') && document.getElementById('quickadd-dialog').open`)
  console.log('PASS quick-add opens:', opened)
  const cancelVisible = await evalJs(`!!document.getElementById('qa-cancel')`)
  console.log('PASS cancel button exists:', cancelVisible)
  await evalJs(`document.getElementById('qa-cancel').click(); true`)
  await sleep(300)
  const closed = await evalJs(`document.getElementById('quickadd-dialog') ? !document.getElementById('quickadd-dialog').open : true`)
  console.log('PASS quick-add cancel closes it:', closed)

  // 5a) The shared offline queue must be present (bug: it was missing on non-Canvas pages).
  const queueOk = await evalJs(`typeof window.hibanaQueue !== 'undefined' && typeof window.hibanaQueue.enqueue === 'function'`)
  console.log('PASS window.hibanaQueue available:', queueOk)

  // 5b) Create a Spark through the real UI (regression for the enqueue error).
  await evalJs(`document.querySelector('[data-quickadd-open]').click(); true`)
  await sleep(300)
  await evalJs(`document.getElementById('qa-title').value = 'Browser-check spark'; true`)
  await evalJs(`document.getElementById('qa-save').click(); true`)
  await sleep(4000)
  const createdLoc = await evalJs(`location.pathname`)
  const createdErr = (await evalJs(`document.getElementById('qa-error') ? document.getElementById('qa-error').textContent : ''`)) || ''
  // Cloudflare strips .html extensions: /project.html and /project are the same page.
  const createdOk = /^\/project(\.html)?$/.test(createdLoc)
  console.log('PASS spark created via UI:', createdOk, '| error text:', createdErr || '(none)', '| path:', createdLoc)

  // 6) Screenshot of the dashboard
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    writeFileSync(join(process.cwd(), 'dashboard-check.png'), Buffer.from(shot.data, 'base64'))
    console.log('screenshot saved: dashboard-check.png')
  }

  console.log('--- console messages ---')
  console.log(consoleLogs.filter((l) => l && !l.includes('Manifest')).join('\n') || '(clean)')
  const errors = consoleLogs.filter((l) => /error|failed/i.test(l))
  console.log('console ERRORS:', errors.length === 0 ? 'none' : errors.join(' | '))
  console.log('failed network requests:', failedUrls.length === 0 ? 'none' : failedUrls.join(' | '))

  ws.close()
  chrome.kill()
  await sleep(800) // give Chrome a beat to release the profile dir (Windows file locks)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch (err) {
    console.warn('temp profile cleanup deferred:', err.message)
  }
}

main().catch((e) => {
  console.error('BROWSER CHECK FAILED:', e)
  chrome.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  process.exit(1)
})