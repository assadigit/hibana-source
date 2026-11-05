#!/usr/bin/env node
// scripts/live-focus-probe.mjs — S237's live probe (the S232 live-labels pattern
// adapted to a PURE-CLIENT round: focus mode has zero API/DB surface, so the live
// proof is (a) the DEPLOYED CARRIERS — sw v451, focus-core.js v1, board-page v27,
// devboard.css v38, settings-page v18, the i18n carriers — and (b) the deployed
// code actually RUNNING the feature in a real browser against the deployed worker:
// the five lanes render, the toggle-off default, the live hibana:focus-mode event
// growing the two head buttons, the blur focus + ] cycling + Esc peeling, and the
// auto-restore after reload. Seeds a probe user straight into D1 (the S43/S232
// doctrine), purges it at the end.
// Usage: CLOUDFLARE_API_TOKEN=… node scripts/live-focus-probe.mjs [dev|prod]   (default: prod)

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require2 = createRequire(path.join(REPO_ROOT, 'package.json'))

const target = process.argv[2] || 'prod'
const URL_BASE = target === 'prod' ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
const DB = target === 'prod' ? 'pm-app-prod' : 'pm-app-dev'
const envArg = target === 'prod' ? ['--env', 'prod'] : []

const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
const EMAIL = `probe-s237-${target}@hibana.local`
const TOKEN = randomBytes(32).toString('hex')

async function sha256(s) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex')
}

function d1(sql) {
  const file = `/tmp/live-s237-probe-${Date.now()}.sql`
  writeFileSync(file, sql)
  try {
    return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, ...envArg, '--file', file, '--remote', '-y'].flat(), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } finally {
    rmSync(file, { force: true })
  }
}

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const text = async (p) => (await fetch(`${URL_BASE}${p}`, { cache: 'no-store' })).text()

const main = async () => {
  // ── 1) THE DEPLOYED CARRIERS ────────────────────────────────────────────────
  const sw = await text('/sw.js')
  check('sw.js VERSION is hibana-v451 (the S237 cache-bust carrier)', /const VERSION = "hibana-v451"/.test(sw), '')
  check('sw.js precaches js/focus-core.js (the NEW pure core)', /focus-core\.js/.test(sw), '')

  const core = await text('/js/focus-core.js?v=1')
  check('js/focus-core.js?v=1 serves 200 with the pure core', /parseToggle/.test(core) && /cycleLane/.test(core) && /escLayer/.test(core) && /autoRestore/.test(core) && /resolveFKey/.test(core), `${core.length} bytes`)

  const boardHtml = await text('/board.html')
  // the DEPLOYED page is wired (build.mjs --wire-html): focus-core.js rides verbatim
  // (defer, outside the bundle), board-page + the CSS ride hashed /dist/ URLs — accept
  // BOTH forms (source form for local/unwired servers, wired form for deployments).
  const wiredBoard = /src="\/dist\/board-page\.[a-f0-9]+\.js"/.test(boardHtml) || boardHtml.includes('/js/board-page.js?v=27')
  check('board.html carries focus-core.js?v=1 verbatim + the board-page carrier (source or wired)', boardHtml.includes('/js/focus-core.js?v=1') && wiredBoard, '')
  check('board.html carries the devboard.css carrier (source or wired)', /href="\/dist\/devboard\.[a-f0-9]+\.css"/.test(boardHtml) || boardHtml.includes('/css/devboard.css?v=38'), '')

  const css = await text('/css/devboard.css?v=38')
  check('devboard.css v38 carries the dim recipe (.db-dim blur+opacity+inert)', /\.pd-col\.db-dim/.test(css) && /blur\(3px\)/.test(css) && /saturate\(\.5\)/.test(css), '')
  check('devboard.css v38 carries the enlarge sheet (.db-focus-sheet) + overlay', /\.db-focus-sheet/.test(css) && /\.db-focus-overlay/.test(css), '')

  const settingsHtml = await text('/settings.html')
  check('settings.html carries the focus-mode toggle row (hibana-focus-mode)', settingsHtml.includes('hibana-focus-mode'), '')
  check('settings.html wires the settings-page carrier (source or wired)', /src="\/dist\/settings-page\.[a-f0-9]+\.js"/.test(settingsHtml) || settingsHtml.includes('/js/settings-page.js?v=18'), '')

  const en = await text('/js/i18n-en.js?v=104')
  const fa = await text('/js/i18n-fa.js?v=98')
  check('i18n-en.js v104 carries the db.focus.* keys (9)', ['mode', 'hint', 'toggle', 'exit', 'enlarge', 'sheetAdd', 'sheetTitle', 'on', 'off'].every((k) => en.includes(`'db.focus.${k}'`) || en.includes(`"db.focus.${k}"`) || en.includes(`db.focus.${k}`)), '')
  check('i18n-fa.js v98 carries the db.focus.* keys (9)', ['mode', 'hint', 'toggle', 'exit', 'enlarge', 'sheetAdd', 'sheetTitle', 'on', 'off'].every((k) => fa.includes(`db.focus.${k}`)), '')

  // ── 2) THE DEPLOYED FEATURE RUNNING IN A REAL BROWSER ──────────────────────
  // seed: probe user + session + a project with one planned task (sessions.id
  // stores sha256(token) — the S41 gotcha)
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('probe-s237-password'), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  const hash = `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
  const uid = UUID()
  const pid = UUID()
  const tid = UUID()
  const now = new Date().toISOString()
  await d1(`
    DELETE FROM users WHERE email = '${EMAIL}';
    INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
      VALUES ('${uid}', 'probe-s237', '${EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}');
    INSERT INTO projects (id, user_id, title, type, status, sort_order, reminders_enabled, created_at, updated_at)
      VALUES ('${pid}', '${uid}', 'probe s237 focus', 'personal', 'developing', 0, 0, '${now}', '${now}');
    INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, search_tags, created_at, updated_at)
      VALUES ('${tid}', '${pid}', 'probe focus task', 'planned', 'medium', 0, '', '${now}', '${now}');
    INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${await sha256(TOKEN)}', '${uid}', '${now}', '${new Date(Date.now() + 3600_000).toISOString()}');
  `)

  const { chromium } = require2('playwright')
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: '__Host-hibana_session', value: TOKEN, url: URL_BASE }])
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  try {
  await page.goto(`${URL_BASE}/board.html?project=${pid}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.db-cols > .pd-col', { timeout: 20_000 })
  check('the LIVE board rendered the five lanes', (await page.locator('.db-cols > .pd-col').count()) === 5, `${await page.locator('.db-cols > .pd-col').count()} lanes`)

  const state0 = await page.evaluate(() => (window.HibanaBoard && window.HibanaBoard.focusState) ? window.HibanaBoard.focusState() : null)
  check('focus mode defaults OFF on the live deploy (no head buttons)', !!state0 && state0.enabled === false, JSON.stringify(state0))
  check('the pure core is loaded on the live board (window.HibanaFocusCore)', await page.evaluate(() => !!(window.HibanaFocusCore && window.HibanaFocusCore.cycleLane)), '')

  // the live toggle event (the same event the settings page dispatches)
  await page.evaluate(() => { try { localStorage.setItem('hibana-focus-mode', 'on') } catch (e) {} document.dispatchEvent(new CustomEvent('hibana:focus-mode', { detail: { enabled: true } })) })
  await page.waitForTimeout(300)
  check('the live hibana:focus-mode event grew the two buttons on ALL FIVE heads', (await page.locator('.pd-col-head .db-focus-btn').count()) === 5 && (await page.locator('.pd-col-head .db-focus-enlarge').count()) === 5, `focus=${await page.locator('.pd-col-head .db-focus-btn').count()} enlarge=${await page.locator('.pd-col-head .db-focus-enlarge').count()}`)

  // the blur focus on planned
  await page.locator('.db-focus-btn[data-db-focus="planned"]').first().click()
  await page.waitForTimeout(250)
  const dim = await page.evaluate(() => ({
    state: window.HibanaBoard.focusState(),
    dims: document.querySelectorAll('.db-cols > .pd-col.db-dim').length,
    scope: !!document.querySelector('.db-cols[data-focus-active]'),
  }))
  check('focusing planned dimmed the OTHER FOUR lanes on the live board', dim.dims === 4 && dim.state.focusedStatus === 'planned' && dim.scope, JSON.stringify({ dims: dim.dims, state: dim.state }))

  // the ] cycling + the Esc peel
  await page.keyboard.press(']')
  await page.waitForTimeout(200)
  const cycled = await page.evaluate(() => window.HibanaBoard.focusState())
  check("']' moved the live focus to in_progress", cycled.focusedStatus === 'in_progress', JSON.stringify(cycled))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const cleared = await page.evaluate(() => ({ state: window.HibanaBoard.focusState(), dims: document.querySelectorAll('.db-cols > .pd-col.db-dim').length }))
  check('Esc cleared the live blur focus (one layer, no dim left)', cleared.state.focusedStatus === null && cleared.dims === 0, JSON.stringify(cleared))

  // the auto-restore after reload (hibana-focus-last persisted)
  await page.locator('.db-focus-btn[data-db-focus="planned"]').first().click()
  await page.waitForTimeout(200)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.db-cols > .pd-col', { timeout: 20_000 })
  await page.waitForTimeout(400)
  const restored = await page.evaluate(() => ({ state: window.HibanaBoard.focusState(), dims: document.querySelectorAll('.db-cols > .pd-col.db-dim').length }))
  check('reload auto-restored the remembered lane (hibana-focus-last)', restored.state.enabled === true && restored.state.focusedStatus === 'planned' && restored.dims === 4, JSON.stringify(restored))

  check('ZERO page errors through the whole live flow', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  } finally {
    // the purge ALWAYS runs — a failing leg never strands the probe user in prod D1
    await browser.close().catch(() => {})
    await d1(`DELETE FROM users WHERE email = '${EMAIL}';`)
    const gone = await (await fetch(`${URL_BASE}/api/tags`, { headers: { Cookie: `__Host-hibana_session=${TOKEN}` }, cache: 'no-store' })).json()
    check('probe user purged (session dead → 401 body)', gone?.error === 'unauthorized' || gone?.error === 'auth_required', JSON.stringify(gone).slice(0, 80))
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n[live-focus-probe:${target}] ${results.length - failed.length}/${results.length} PASS${failed.length ? ' — FAILURES: ' + failed.map((f) => f.name).join(' ; ') : ''}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => { console.error('[live-focus-probe] fatal:', e); process.exit(1) })
