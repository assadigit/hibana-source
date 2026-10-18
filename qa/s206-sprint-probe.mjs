// S206 (owner: "the sprint system is buggy") — a manual-flow probe of the whole
// sprint lifecycle in a REAL browser, against a LOCAL Node server + fresh DB.
// Purpose: discover the bugs the e2e suite doesn't cover (all 9 sprint specs
// pass green — the owner's pain lives in untested flows).
//
// Run: node qa/s206-sprint-probe.mjs
// (Spawns the server itself; the sandbox kills detached background processes,
//  so server + browser must live inside one foreground command.)
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const PORT = Number(process.env.PROBE_PORT ?? 3031)
const DB = '/tmp/hibana-s206-probe.db'
const SHOTS = '/tmp/hibana-s206-shots'
const BASE = `http://localhost:${PORT}`
const EMAIL = 'probe@test.local'
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
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => process.stdout.write('[srv] ' + d))
server.stderr.on('data', (d) => process.stderr.write('[srv!] ' + d))

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
  const id = randomBytes(16).toString('hex')
  db.exec(`INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'probe', '${EMAIL}', '${hash}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`)
  db.close()
  return id
}

const run = async () => {
  await waitUp()
  log('server up on', PORT)
  await seedUser()
  log('user seeded')

  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|manifest/i.test(m.text())) errors.push('console: ' + m.text()) })
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {})

  // ---- login ---------------------------------------------------------------
  await page.goto(`${BASE}/login.html`)
  await page.fill('input[name=login]', EMAIL)
  await page.fill('input[name=password]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app**', { timeout: 15000 })
  log('logged in:', page.url())

  // ---- project ---------------------------------------------------------------
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Sprint Probe Project', stage: 'planning' }),
    })
    return r.json()
  })
  const pid = proj.id
  log('project:', pid)

  // tasks via API
  const tasks = []
  for (const t of [{ title: 'Fix login bug', status: 'bug' }, { title: 'Write docs', status: 'idea' }]) {
    const created = await page.evaluate(async ([pid, t]) => {
      const r = await fetch(`/api/projects/${pid}/devtasks`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(t),
      })
      return r.json()
    }, [pid, t])
    tasks.push(created)
  }
  log('tasks:', tasks.map((t) => t.id).join(', '))

  // ---- BOARD: Sprints link ----------------------------------------------------
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('#db-board .db-cols')
  log('board sprint link:', await page.getAttribute('#db-sprint-link', 'href'))
  await shot('00-board')

  // ---- SPRINT PAGE lifecycle ---------------------------------------------------
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await shot('01-sprint-fresh')

  // 1) DEFINE a draft (name only)
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Sprint Alpha')
  await page.click('[data-sp-define-ok]')
  await page.waitForSelector('.sp-draft-card')
  log('draft card visible')
  await shot('02-draft')

  const listRow = await page.textContent('.sp-list-row').catch(() => null)
  log('ALL-SPRINTS row:', JSON.stringify(listRow))

  // 2) quick-add a task (auto-joins draft) — expand the Uncategorized list first
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(300)
  const addInput = await page.$('[data-quickadd="none"]')
  await addInput.fill('Draft auto-join task')
  await addInput.press('Enter')
  await page.waitForTimeout(1200)
  log('draft badge count:', await page.textContent('.sp-draft-card .detail-tab-count').catch(() => null))
  await shot('03-draft-with-task')

  // 3) START the draft
  await page.click('[data-sp-draft-start]')
  await page.waitForTimeout(1500)
  log('running chip:', JSON.stringify(await page.textContent('.sp-sprint-chip').catch(() => null)))
  await shot('04-started')

  // board badges
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('#db-board .db-cols')
  log('board sprint badges:', JSON.stringify(await page.$$eval('.db-sprint-badge', (els) => els.map((e) => e.textContent.trim()))))

  // 4) FINISH via toolbar
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.click('#sp-finish-btn')
  await page.waitForTimeout(1500)
  const rows = await page.$$eval('.sp-list-row', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')))
  log('after finish — ALL SPRINTS:', JSON.stringify(rows, null, 1))
  await shot('05-finished')

  // 5) DEFINE with dates — today → +3d
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Sprint Beta')
  const today = new Date().toISOString().slice(0, 10)
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', in3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(1500)
  log('chips after dated create:', JSON.stringify(await page.$$eval('.sp-sprint-chip', (els) => els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')))))
  await shot('06-beta-dated')

  // geometry: today line vs band start
  const geom = await page.evaluate(() => {
    const tl = document.getElementById('sp-timeline')
    const today = tl.querySelector('.sp-today-line')
    const bands = [...tl.querySelectorAll('.sp-band')].map((b) => b.style.insetInlineStart)
    return { todayPct: today?.style.insetInlineStart ?? null, bands }
  })
  log('geometry:', JSON.stringify(geom))

  // 6) sprint options in the board task editor
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('#db-board .db-cols')
  const firstCard = await page.$('.pd-task-wrap')
  if (firstCard) {
    await firstCard.click()
    try { await page.waitForSelector('.db-modal-card', { timeout: 8000 }) } catch { log('task editor did not open') }
    if (await page.$('.db-modal-card')) {
      log('task-editor sprint options:', JSON.stringify(await page.$$eval('select[data-db-sprint] option', (os) => os.map((o) => o.textContent.trim()))))
      await page.keyboard.press('Escape')
    }
  }

  console.log('\n==== PAGE ERRORS (' + errors.length + ') ====')
  errors.slice(0, 40).forEach((e) => console.log('  ' + e))
  await browser.close()
  log('probe complete')
}

try { await run() } catch (e) { console.error('PROBE FAILED:', e && e.message, e && e.stack) } finally { server.kill('SIGTERM'); setTimeout(() => process.exit(0), 300) }
