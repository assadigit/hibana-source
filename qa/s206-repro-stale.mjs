// S206 repro: the live verifier's stale-reload symptom — replicate the exact live
// flow locally (login → /kanban → /sprint → dated create → is the in-page reload
// fetching fresh?). If it reproduces locally, it's a code bug; if not, live-env.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const PORT = 3036
const DB = '/tmp/hibana-s206r.db'
const SHOTS = '/tmp/hibana-s206r-shots'
const BASE = `http://localhost:${PORT}`
const EMAIL = 'repro@test.local'
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
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true } catch { /* retry */ } await sleep(500) } throw new Error('never up') }
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)

  await page.goto(`${BASE}/login.html`)
  await page.fill('input[name=login]', EMAIL)
  await page.fill('input[name=password]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app**')
  log('logged in; SW controller:', await page.evaluate(() => !!navigator.serviceWorker.controller))

  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Repro', status: 'developing' }) })).json()))
  const pid = proj.id
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fix Sprint', started_at: today + 'T00:00:00Z' }) })
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'task A', status: 'in_progress' }) })
  }, pid)

  // EXACT live flow: /kanban first, then /sprint
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('.db-cols')
  await page.waitForTimeout(600)
  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.waitForTimeout(600)

  const gets = []
  page.on('response', (r) => { if (/devboard/.test(r.url())) gets.push(r.status()) })

  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Repro Sprint')
  const today = new Date().toISOString().slice(0, 10)
  const plus3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-sp-define-start]', today)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(2500)

  log('devboard GET statuses after create:', JSON.stringify(gets))
  const chips = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim().replace(/\s+/g, ' ')))
  log('chips in-page (no reload):', JSON.stringify(chips))
  const swCtl = await page.evaluate(() => !!navigator.serviceWorker.controller)
  log('SW still controlling:', swCtl)
  await browser.close()
}

try { await run() } catch (e) { console.error('REPRO FAILED:', e && e.message) } finally { server.kill('SIGTERM'); setTimeout(() => process.exit(0), 300) }
