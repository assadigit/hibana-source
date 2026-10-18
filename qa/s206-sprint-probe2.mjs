// S206 probe v2 — sprint bugs under the OWNER's timezone (Asia/Tehran) + the
// untested flows: dated-create geometry, task-editor "＋ New sprint" (409 path),
// DnD onto a sprint band, presets, reopen/extend/delete, all-sprints counts.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const PORT = 3032
const DB = '/tmp/hibana-s206b.db'
const SHOTS = '/tmp/hibana-s206b-shots'
const BASE = `http://localhost:${PORT}`
const EMAIL = 'probe2@test.local'
const PASS = 'probe-password-123'

rmSync(DB, { force: true })
mkdirSync(SHOTS, { recursive: true })

const server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'development', RATE_LIMIT_DISABLE: '1',
    OPEN_REGISTRATION: 'true', GITHUB_OWNER: 'x', GITHUB_REPO: 'y', GITHUB_TOKEN: 'x',
    OWNER_EMAIL: 'owner@test.local', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_SECRET: 'x',
    CAPTCHA_SECRET_KEY: 'test-secret', HIBANA_SHOTS_DIR: SHOTS,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('=== ' + a.join(' '))
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true } catch { /* retry */ }
    await sleep(500)
  }
  throw new Error('server never came up')
}
const seedUser = async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(bits)}`
  const now = new Date().toISOString()
  db.exec(`INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${randomBytes(16).toString('hex')}', 'probe', '${EMAIL}', '${hash}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`)
  db.close()
}

const run = async () => {
  await waitUp()
  await seedUser()
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tehran' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|manifest/i.test(m.text())) errors.push('console: ' + m.text()) })
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {})
  const toasts = () => page.$$eval('.toast, [class*=toast]', (els) => els.map((e) => e.textContent.trim()).slice(-4)).catch(() => [])

  // login
  await page.goto(`${BASE}/login.html`)
  await page.fill('input[name=login]', EMAIL)
  await page.fill('input[name=password]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app**')

  // project + tasks
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'TZ Probe', stage: 'planning' }) })
    return r.json()
  })
  const pid = proj.id
  await page.evaluate(async (pid) => {
    for (const title of ['Task A', 'Task B', 'Task C']) {
      await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, status: 'idea' }) })
    }
  }, pid)
  log('project + 3 tasks ready')

  // sanity: what does the browser think "today" is (Tehran)?
  const browserNow = await page.evaluate(() => {
    const d = new Date()
    return { local: d.toString(), iso: d.toISOString(), localDate: new Date().toLocaleDateString('en-CA') }
  })
  log('browser now:', JSON.stringify(browserNow))

  // ---- FLOW 1: dated create under Tehran TZ --------------------------------
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'TZ Sprint')
  const localToday = browserNow.localDate
  const localPlus3 = new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-CA')
  await page.fill('[data-sp-define-start]', localToday)
  await page.fill('[data-sp-define-end]', localPlus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(1500)
  await shot('v2-01-dated-create')

  const geom = await page.evaluate(() => {
    const tl = document.getElementById('sp-timeline')
    const today = tl.querySelector('.sp-today-line')
    const cells = [...tl.querySelectorAll('.sp-cell')].filter((c) => !c.className.includes('week'))
    const bands = [...tl.querySelectorAll('.sp-band')].map((b) => ({ start: b.style.insetInlineStart, w: b.style.inlineSize }))
    return { todayPct: today?.style.insetInlineStart, bands, cellCount: cells.length }
  })
  log('F1 geometry (picked', localToday, '→', localPlus3, '):', JSON.stringify(geom))

  // expected: band start == left edge of today cell == todayPct - halfCell
  const info = await page.evaluate(() => {
    const tl = document.getElementById('sp-timeline')
    const band = tl.querySelector('.sp-band')
    const today = tl.querySelector('.sp-today-line')
    const cells = [...tl.querySelectorAll('.sp-cell')].filter((c) => !c.className.includes('week'))
    const pxPerPct = tl.querySelector('.sp-body').getBoundingClientRect().width / 100
    const bStart = parseFloat(band.style.insetInlineStart) * pxPerPct
    const tLine = parseFloat(today.style.insetInlineStart) * pxPerPct
    const firstCellDate = cells.length ? (cells[0].textContent || '').trim() : '?'
    return { bandStartPx: Math.round(bStart), todayPx: Math.round(tLine), firstCellDate, chip: document.querySelector('.sp-sprint-chip')?.textContent?.trim() }
  })
  log('F1 detail:', JSON.stringify(info))

  // ---- FLOW 2: task editor "＋ New sprint" while a draft exists --------------
  // create a draft first (name-only define)
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'The Draft')
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(1200)
  log('F2 draft exists:', (await page.$('.sp-draft-card')) != null)

  // now open the BOARD task editor and pick "＋ New sprint"
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('#db-board .db-cols')
  await page.click('.pd-task-wrap >> nth=0')
  await page.waitForSelector('.db-modal-card')
  await page.selectOption('select[data-db-sprint]', '__new')
  await page.fill('.db-modal-card [name=title]', 'Task A')
  await page.click('[data-db-save]')
  await page.waitForTimeout(1500)
  await shot('v2-02-409-save')
  log('F2 toasts after save with __new:', JSON.stringify(await toasts()))
  log('F2 modal still open?', (await page.$('.db-modal-card:not([hidden])')) != null, (await page.$('.db-modal')) != null && !(await page.$('.db-modal[hidden]')))

  // ---- FLOW 3: drag a sidebar task onto the sprint band ----------------------
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(300)
  const src = await page.$('[data-sptask]')
  const band = await page.$('.sp-sprint:not(.is-open)') || await page.$('.sp-sprint')
  if (src && band) {
    const sb = await src.boundingBox()
    const bb = await band.boundingBox()
    if (sb && bb) {
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
      await page.mouse.down()
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(1500)
      log('F3 after drag — toasts:', JSON.stringify(await toasts()))
      const chip = await page.textContent('.sp-sprint-chip').catch(() => null)
      log('F3 running chip after drag:', JSON.stringify(chip))
    }
  } else log('F3 skipped — no sidebar task or band')

  // all-sprints counts (bug: always 0)
  const rows = await page.$$eval('.sp-list-row', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')))
  log('F3 ALL-SPRINTS rows:', JSON.stringify(rows, null, 1))

  // ---- FLOW 4: preset create (24h) -------------------------------------------
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.click('[data-sp-preset]') // first preset = 24h
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(1500)
  const chips = await page.$$eval('.sp-sprint-chip', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')))
  log('F4 chips after 24h preset:', JSON.stringify(chips))
  await shot('v2-04-preset')

  // ---- FLOW 5: chip popover — extend + delete ---------------------------------
  const anyChip = await page.$('.sp-sprint-chip')
  if (anyChip) {
    await anyChip.click()
    await page.waitForSelector('.sp-sprint-pop')
    log('F5 popover visible')
    // Extend needs window.prompt — auto-accept with 3
    page.once('dialog', (d) => d.accept('3'))
    const ext = await page.$('[data-sp-extend]')
    if (ext) { await ext.click(); await page.waitForTimeout(1500); log('F5 extend clicked, toasts:', JSON.stringify(await toasts())) }
    else log('F5 no extend button (finished sprint?)')
  }

  // ---- FLOW 6: page errors -----------------------------------------------------
  console.log('\n==== PAGE ERRORS (' + errors.length + ') ====')
  errors.slice(0, 40).forEach((e) => console.log('  ' + e))
  await browser.close()
}

try { await run() } catch (e) { console.error('PROBE FAILED:', e && e.message) } finally { server.kill('SIGTERM'); setTimeout(() => process.exit(0), 300) }
