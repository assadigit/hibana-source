// S206 probe v3 — DnD verification via page.dragAndDrop (HTML5 native), plus the
// __new-sprint create path when NO draft exists (expect: works), and the draft→409
// toast wording. Tehran TZ to mirror the owner.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const PORT = 3033
const DB = '/tmp/hibana-s206c.db'
const SHOTS = '/tmp/hibana-s206c-shots'
const BASE = `http://localhost:${PORT}`
const EMAIL = 'probe3@test.local'
const PASS = 'probe-password-123'

rmSync(DB, { force: true })
mkdirSync(SHOTS, { recursive: true })
const server = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'development', RATE_LIMIT_DISABLE: '1', OPEN_REGISTRATION: 'true', GITHUB_OWNER: 'x', GITHUB_REPO: 'y', GITHUB_TOKEN: 'x', OWNER_EMAIL: 'owner@test.local', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_SECRET: 'x', CAPTCHA_SECRET_KEY: 'test-secret', HIBANA_SHOTS_DIR: SHOTS },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('=== ' + a.join(' '))
const waitUp = async () => {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true } catch { /* retry */ } await sleep(500) }
  throw new Error('server never came up')
}
const seedUser = async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const hash = `pbkdf2$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`
  const now = new Date().toISOString()
  db.exec(`INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at) VALUES ('${randomBytes(16).toString('hex')}', 'probe', '${EMAIL}', '${hash}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`)
  db.close()
}

const run = async () => {
  await waitUp(); await seedUser()
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tehran' })).newPage()
  page.setDefaultTimeout(15000)
  const toasts = () => page.$$eval('[class*=toast]', (els) => els.map((e) => e.textContent.trim()).slice(-3)).catch(() => [])

  await page.goto(`${BASE}/login.html`)
  await page.fill('input[name=login]', EMAIL)
  await page.fill('input[name=password]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app**')
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'DnD Probe', stage: 'planning' }) })
    return r.json()
  })
  const pid = proj.id
  await page.evaluate(async (pid) => {
    for (const title of ['Drag me', 'Drag me too']) await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, status: 'idea' }) })
  }, pid)

  // a RUNNING sprint exists (dated create via API)
  const sprint = await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    const r = await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'DnD Target', started_at: today + 'T00:00:00Z', ended_at: null }) })
    return { status: r.status, body: await r.json() }
  }, pid)
  log('sprint created:', JSON.stringify(sprint))

  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(400)

  // DnD: sidebar task → sprint band (page.dragAndDrop fires real HTML5 events)
  await page.dragAndDrop('[data-sptask] >> nth=0', '.sp-sprint', { targetPosition: { x: 100, y: 8 } })
  await page.waitForTimeout(1500)
  log('DnD sidebar→sprint toasts:', JSON.stringify(await toasts()))
  log('chip after DnD:', JSON.stringify(await page.textContent('.sp-sprint-chip').catch(() => null)))

  // DnD: sidebar task → a category LANE (moves category — lane 'none' = uncategorized)
  // (skip: same category)

  // DnD: timeline DOT → sprint band
  const dot = await page.$('.sp-dot')
  if (dot) {
    const chipBox = await page.locator('.sp-sprint').boundingBox()
    const dotBox = await dot.boundingBox()
    if (chipBox && dotBox) {
      await page.mouse.move(dotBox.x + 5, dotBox.y + 5)
      await page.mouse.down()
      await page.mouse.move(chipBox.x + 120, chipBox.y + 10, { steps: 15 })
      await page.mouse.up()
      await page.waitForTimeout(1200)
      log('dot drag via mouse — chip:', JSON.stringify(await page.textContent('.sp-sprint-chip').catch(() => null)))
    }
  } else log('no dots on timeline')

  // ---- __new sprint in task editor with NO draft present ----------------------
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('#db-board .db-cols')
  await page.click('.pd-task-wrap >> nth=0')
  await page.waitForSelector('.db-modal-card')
  await page.selectOption('select[data-db-sprint]', '__new')
  await page.click('[data-db-save]')
  await page.waitForTimeout(1500)
  log('task save with __new (no draft) — toasts:', JSON.stringify(await toasts()))
  log('modal gone?', (await page.$('.db-modal[hidden]')) != null)

  // verify the task now belongs to the new DRAFT sprint
  const board = await page.evaluate(async (pid) => (await (await fetch(`/api/projects/${pid}/devboard`)).json()))
  const drafts = board.sprints.filter((s) => s.is_draft)
  log('drafts after __new:', JSON.stringify(drafts.map((d) => ({ id: d.id, name: d.name }))))
  log('task sprint_ids:', JSON.stringify(board.tasks.map((t) => ({ t: t.title.slice(0, 12), s: t.sprint_id }))))
  await browser.close()
}

try { await run() } catch (e) { console.error('PROBE FAILED:', e && e.message) } finally { server.kill('SIGTERM'); setTimeout(() => process.exit(0), 300) }
