// S206 probe v5 — synthetic HTML5 DnD (dragstart/dragover/drop with a real
// DataTransfer) to test the HANDLER paths, plus elementFromPoint hit-testing
// of the dot vs the boundary rail.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'

const PORT = 3035
const DB = '/tmp/hibana-s206e.db'
const SHOTS = '/tmp/hibana-s206e-shots'
const BASE = `http://localhost:${PORT}`
const EMAIL = 'probe5@test.local'
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
  page.setDefaultTimeout(15000)

  await page.goto(`${BASE}/login.html`)
  await page.fill('input[name=login]', EMAIL)
  await page.fill('input[name=password]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app**')
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Synth DnD', stage: 'planning' }) })
    return r.json()
  })
  const pid = proj.id
  const taskIds = await page.evaluate(async (pid) => {
    const ids = []
    for (const title of ['Dot A', 'Dot B', 'Side C']) {
      const r = await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, status: 'in_progress' }) })
      ids.push((await r.json()).id)
    }
    return ids
  }, pid)
  const sprint = await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    const r = await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Synth Sprint', started_at: today + 'T00:00:00Z' }) })
    return r.json()
  }, pid)
  log('sprint:', sprint.id)

  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])')
  await page.click('[data-cat-toggle="none"]')
  await page.waitForTimeout(400)

  // hit-test: what sits at the dot's center?
  const hit = await page.evaluate(() => {
    const dot = document.querySelector('.sp-dot')
    if (!dot) return 'no dot'
    const r = dot.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return el ? el.className + ' <' + el.tagName + '>' : 'nothing'
  })
  log('hit-test at dot center:', JSON.stringify(hit))

  // synthetic DnD: DOT → sprint lane
  const synthDrag = async (srcSel, dstSel) => page.evaluate(([srcSel, dstSel]) => {
    const src = document.querySelector(srcSel)
    const dst = document.querySelector(dstSel)
    if (!src || !dst) return 'missing ' + (src ? 'dst' : 'src')
    const dt = new DataTransfer()
    const fire = (el, type, x, y) => {
      const r = el.getBoundingClientRect()
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: (x ?? r.x + r.width / 2), clientY: (y ?? r.y + r.height / 2) })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    }
    const s1 = fire(src, 'dragstart')
    const dr = dst.getBoundingClientRect()
    const s2 = fire(dst, 'dragover', dr.x + 60, dr.y + 8)
    fire(dst, 'drop', dr.x + 60, dr.y + 8)
    fire(src, 'dragend')
    return JSON.stringify({ dragstartPrevented: s1, dragoverPrevented: s2 })
  }, [srcSel, dstSel])
  log('A dot→sprint synth:', await synthDrag('.sp-dot', '.sp-sprint'))
  await page.waitForTimeout(1500)
  let board = await page.evaluate(async (pid) => (await (await fetch(`/api/projects/${pid}/devboard`)).json()), pid)
  log('A after: ', JSON.stringify(board.tasks.map((t) => [t.title, t.sprint_id === sprint.id ? 'IN-SPRINT' : null])))

  // synthetic DnD: SIDEBAR task → sprint lane
  log('B side→sprint synth:', await synthDrag('[data-sptask]', '.sp-sprint'))
  await page.waitForTimeout(1500)
  board = await page.evaluate(async (pid) => (await (await fetch(`/api/projects/${pid}/devboard`)).json()), pid)
  log('B after: ', JSON.stringify(board.tasks.map((t) => [t.title, t.sprint_id === sprint.id ? 'IN-SPRINT' : null])))

  // synthetic DnD: DOT → category lane (moves the category)
  log('C dot→lane synth:', await synthDrag('.sp-dot', '.sp-lane'))
  await page.waitForTimeout(1500)
  board = await page.evaluate(async (pid) => (await (await fetch(`/api/projects/${pid}/devboard`)).json()), pid)
  log('C after: cats', JSON.stringify(board.tasks.map((t) => [t.title, t.category_id])))
  await browser.close()
}

try { await run() } catch (e) { console.error('PROBE FAILED:', e && e.message) } finally { server.kill('SIGTERM'); setTimeout(() => process.exit(0), 300) }
