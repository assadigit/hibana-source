#!/usr/bin/env node
// qa/s205-kanban-perf.mjs — S205 (spec §5 Workstream C): reproducible LOCAL Kanban
// performance measurements, before/after the entry-point + switcher round.
//
// What it measures (Chromium, 5 runs each, medians reported):
//   1. COLD BOARD LOAD — /board.html?project=<id> (the pre-existing entry) vs /kanban
//      (the new auth-gated Worker route serving the same board.html): navigation →
//      .db-cols rendered (first useful board render).
//   2. PROJECT SWITCH — the OLD flow (a hard navigation to /board.html?project=<other>,
//      what a bookmark/palette jump did) vs the NEW in-place switcher (open popover →
//      activate row → new board rendered, no navigation).
//   3. THE BOARD PAYLOAD — GET /api/projects/:id/devboard bytes + duration on the local
//      Node server (the D1-equivalent SQLite path — the same SQL runs on both).
//
// Method caveats (stated per spec §5.4): local Node server on loopback with a small
// synthetic dataset — absolute numbers measure THIS sandbox's hardware, not prod D1
// latency from an edge PoP; the comparison (old vs new flow, same harness, same data)
// is the meaningful signal. Production-like data volume is unavailable locally.
//
// Run: node --import tsx qa/s205-kanban-perf.mjs     (boots its own server on :3029)

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 3029
const DB = '/tmp/hibana-s205-perf.db'
const SHOTS = '/tmp/hibana-s205-perf-shots'
const EMAIL = 'perf-s205@test.local'
const PASS = 'perf-password-123'
const RUNS = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function bootServer() {
  rmSync(DB, { force: true })
  const child = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      DB_PATH: DB,
      PORT: String(PORT),
      NODE_ENV: 'development',
      RATE_LIMIT_DISABLE: '1',
      GITHUB_OWNER: 'x', GITHUB_REPO: 'y', GITHUB_TOKEN: 'x',
      TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_SECRET: 'x',
      HIBANA_SHOTS_DIR: SHOTS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`)
      if (r.ok) return child
    } catch {}
    await sleep(500)
  }
  child.kill()
  throw new Error('server did not boot')
}

async function seed() {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITER = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  const hash = `pbkdf2$${ITER}$${b64(salt)}$${b64(Buffer.from(bits))}`
  const uid = randomBytes(16).toString('hex')
  const now = new Date().toISOString()
  db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${EMAIL}')`)
  db.exec(`DELETE FROM users WHERE email = '${EMAIL}'`)
  db.exec(`INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
           VALUES ('${uid}', 'perf-s205', '${EMAIL}', '${hash}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`)
  // two projects × 24 tasks spread across the five columns — a mid-sized personal board
  const ids = []
  for (const title of ['Perf Alpha Board', 'Perf Beta Board']) {
    const pid = randomBytes(16).toString('hex')
    ids.push(pid)
    db.exec(`INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at)
             VALUES ('${pid}', '${uid}', '${title}', '', 'personal', 'developing', 0, '', 0, '${now}', '${now}')`)
    const statuses = ['idea', 'bug', 'planned', 'in_progress', 'done']
    for (let i = 0; i < 24; i++) {
      const st = statuses[i % statuses.length]
      const prio = ['low', 'medium', 'high', 'urgent'][i % 4]
      db.exec(`INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
               VALUES ('${randomBytes(16).toString('hex')}', '${pid}', 'perf task ${i} — ${title}', '${st}', '${prio}', ${i}, '${now}')`)
    }
  }
  db.close()
  return ids
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const fmt = (ms) => Math.round(ms) + ' ms'

async function main() {
  const server = await bootServer()
  const [pidA, pidB] = await seed()
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // login once (the session cookie rides the context for every measurement)
  await page.goto(`http://localhost:${PORT}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 15_000 })
  await page.waitForTimeout(600)

  // warm both paths once (script cache, service worker, JIT)
  await page.goto(`http://localhost:${PORT}/board.html?project=${pidA}`)
  await page.waitForSelector('.db-cols', { timeout: 15_000 })
  await page.goto(`http://localhost:${PORT}/kanban?project=${pidA}`)
  await page.waitForSelector('.db-cols', { timeout: 15_000 })

  const measure = async (fn) => {
    const times = []
    for (let i = 0; i < RUNS; i++) {
      const t0 = Date.now()
      await fn()
      times.push(Date.now() - t0)
    }
    return median(times)
  }

  // 1. cold board load (hard navigation → .db-cols rendered)
  const coldBoard = await measure(async () => {
    await page.goto(`http://localhost:${PORT}/board.html?project=${pidA}`)
    await page.waitForSelector('.db-cols', { timeout: 15_000 })
  })
  const coldKanban = await measure(async () => {
    await page.goto(`http://localhost:${PORT}/kanban?project=${pidA}`)
    await page.waitForSelector('.db-cols', { timeout: 15_000 })
  })

  // 2. project switch: old flow (hard navigation between boards) vs new (in-place)
  const oldSwitch = await measure(async () => {
    await page.goto(`http://localhost:${PORT}/board.html?project=${pidB}`)
    await page.waitForSelector('.db-cols', { timeout: 15_000 })
    await page.waitForFunction((b) => document.querySelector('#db-title')?.textContent === b, 'Perf Beta Board', { timeout: 15_000 })
  })
  // the switcher needs to be on /kanban with alpha loaded
  await page.goto(`http://localhost:${PORT}/kanban?project=${pidA}`)
  await page.waitForSelector('.db-cols', { timeout: 15_000 })
  await page.waitForFunction((a) => document.querySelector('#db-title')?.textContent === a, 'Perf Alpha Board', { timeout: 15_000 })
  const newSwitch = await measure(async () => {
    await page.click('#db-project-switch')
    await page.click(`#db-switch-pop .db-switch-row[data-switch-id="${pidB}"]`)
    await page.waitForFunction((b) => document.querySelector('#db-title')?.textContent === b, 'Perf Beta Board', { timeout: 15_000 })
    // switch back so the loop is symmetric
    await page.click('#db-project-switch')
    await page.click(`#db-switch-pop .db-switch-row[data-switch-id="${pidA}"]`)
    await page.waitForFunction((a) => document.querySelector('#db-title')?.textContent === a, 'Perf Alpha Board', { timeout: 15_000 })
  })

  // 3. board payload (raw fetch, 5 runs)
  const payload = { bytes: [], ms: [] }
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now()
    const r = await page.evaluate(async (id) => {
      const res = await fetch(`/api/projects/${id}/devboard`)
      const text = await res.text()
      return text.length
    }, pidA)
    payload.ms.push(Date.now() - t0)
    payload.bytes.push(r)
  }

  console.log('S205 Kanban performance — local Node server (:3029), 5 runs, medians')
  console.log('  dataset: 2 projects × 24 dev tasks; Chromium headless; loopback')
  console.log('')
  console.log('  COLD LOAD (goto → .db-cols rendered)')
  console.log(`    /board.html?project=   ${fmt(coldBoard)}`)
  console.log(`    /kanban?project=       ${fmt(coldKanban)}   (auth-gated Worker route, same board.html)`)
  console.log('')
  console.log('  PROJECT SWITCH (alpha → beta, board rendered)')
  console.log(`    OLD hard navigation    ${fmt(oldSwitch)}`)
  console.log(`    NEW in-place switcher  ${fmt(newSwitch / 2)}   (loop switches both ways; halved)`)
  console.log('')
  console.log(`  BOARD PAYLOAD  GET /api/projects/:id/devboard — ${median(payload.bytes)} bytes, ${fmt(median(payload.ms))}`)
  console.log('')
  console.log('  Caveats: sandbox hardware + SQLite loopback (not prod D1 from an edge PoP);')
  console.log('  the old-vs-new comparison shares the harness, data, and warm caches.')

  await browser.close()
  server.kill()
  rmSync(DB, { force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
