#!/usr/bin/env node
// scripts/mobile-probe.mjs — one-off/live responsive root-cause probe (S43).
// Boots the audit server on the SEEDED /tmp/hibana-audit.db (created by
// mobile-audit.mjs), logs in as the FA user, visits given pages at 390px and
// reports: document h-scroll + the chain of >viewport-wide elements with the
// computed properties that refuse to shrink (display, min-width, width,
// overflow, flex/grid roles). Usage:
//   node scripts/mobile-probe.mjs project reports settings 404 canvas notifications

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PORT = 3019
const DB = '/tmp/hibana-audit.db'
const BASE = `http://127.0.0.1:${PORT}`
const EMAIL = 'mobile-fa@test.local'
const PASS = 'e2e-password-123'
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['project']

async function hashPass(pass) {
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  return `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
}

async function startServer() {
  const child = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'development', OPEN_REGISTRATION: 'true',
      GITHUB_OWNER: 'x', GITHUB_REPO: 'y', GITHUB_TOKEN: 'x', OWNER_EMAIL: 'test@test.local', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_SECRET: 'x' },
    stdio: ['ignore', 'ignore', 'inherit'], detached: true,
  })
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return child } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server failed')
}

const PROBE = `(() => {
  const vw = document.documentElement.clientWidth
  const out = { vw, docScrollW: document.documentElement.scrollWidth, chains: [] }
  const label = (el) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 3).join('.') : ''
    return tag + id + (cls ? '.' + cls : '')
  }
  // widest elements, deepest-first dedupe: walk all, keep those wider than vw
  const wide = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width > vw + 1 && r.width > 0) {
      const cs = getComputedStyle(el)
      wide.push({
        el: label(el), w: Math.round(r.width), x: Math.round(r.left),
        display: cs.display, minWidth: cs.minWidth, width: cs.width, maxWidth: cs.maxWidth,
        flex: cs.flex, flexBasis: cs.flexBasis, overflowX: cs.overflowX,
        gridCols: cs.gridTemplateColumns, whitespace: cs.whiteSpace, role: cs.position,
        parent: el.parentElement ? label(el.parentElement) : 'none',
      })
    }
  }
  out.wide = wide
  return JSON.stringify(out)
})()`

const server = await startServer()
console.log('probe server on', PORT)

// ensure user exists (from mobile-audit seed); refresh password hash to PASS
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(DB)
const hash = (await hashPass(PASS)).replace(/'/g, "''")
db.exec(`UPDATE users SET password_hash = '${hash}' WHERE email = '${EMAIL}'`)
const doing = db.prepare("SELECT id FROM projects WHERE user_id = (SELECT id FROM users WHERE email = ?) AND status = 'doing' LIMIT 1").get(EMAIL)
db.close()
if (!doing) { console.error('no seeded data — run mobile-audit.mjs first'); process.exit(1) }

const { chromium } = await import('playwright')
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran' })
const page = await ctx.newPage()
await page.goto(`${BASE}/login.html`)
await page.fill('[name="login"]', EMAIL)
await page.fill('[name="password"]', PASS)
await page.click('button[type="submit"]')
await page.waitForURL('**/app', { timeout: 15000 })
await page.waitForTimeout(600)

const ROUTES = {
  project: `/project.html?id=${doing.id}`,
  reports: '/reports.html',
  settings: '/settings.html',
  '404': '/404.html',
  canvas: '/canvas.html',
  whiteboard: '/whiteboard.html',
  notifications: '/notifications.html',
  sadhana: '/sadhana.html',
  sprint: `/sprint.html?project=${doing.id}`,
  board: `/board.html?project=${doing.id}`,
  app: '/app',
}

for (const name of PAGES) {
  await page.goto(`${BASE}${ROUTES[name] || '/'}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(900)
  const res = JSON.parse(await page.evaluate(PROBE))
  console.log(`\n===== ${name} — doc ${res.docScrollW} vs vw ${res.vw}`)
  // print the NARROWEST wide elements (leaf-iest first) — top 12
  const sorted = res.wide.slice().sort((a, b) => a.w - b.w)
  for (const w of sorted.slice(0, 14)) {
    console.log(`  ${String(w.w).padStart(4)}px  ${w.el}`)
    console.log(`          parent=${w.parent} display=${w.display} minW=${w.minWidth} width=${w.width} maxW=${w.maxWidth} ovX=${w.overflowX} ws=${w.whitespace}`)
    if (w.gridCols !== 'none') console.log(`          gridCols=${w.gridCols}`)
  }
}
await browser.close()
try { process.kill(-server.pid, 'SIGTERM') } catch {}
