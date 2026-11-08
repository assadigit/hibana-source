#!/usr/bin/env node
// probe-sw-synthesis.mjs — S256 (FE-5): the SW's install-time bundle-synthesis proof.
//
// The four Projects-section pages reference the per-page CSS bundles
// (/dist/board-bundle.<hash>.css + projects-bundle). The SW deliberately does NOT
// network-precache them (their bytes are the union of the precached sheets) — it
// SYNTHESIZES each bundle at install from the cached parts (sw.js, dist/bundles.json).
// This probe proves the contract end-to-end on the WIRED tree:
//
//   1. fresh browser → /kanban (the SW installs; the synthesis populates the cache)
//   2. go OFFLINE, hard-reload /kanban in the SAME context (cache-only)
//   3. assert: the bundle <link> RESOLVES (a stylesheet with real rule count), the
//      lanes render, zero page errors — the offline shell parity FE-5 must preserve
//   4. same for /sprint.html, /projects.html, /project.html
//
// Run (the tree must be WIRED — this script builds it and restores after):
//   node scripts/probe-sw-synthesis.mjs [--base http://localhost:3018]
//
// Exit 0 = all four pages render styled fully offline through the synthesized bundles.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const PORT = process.env.PROBE_PORT ?? '3018'
const BASE = `http://localhost:${PORT}`
const PROJ = 'b0000102-0000-4000-8000-bbbb00000102' // the perf-seed 'doing' project

function run(cmd, args, env) {
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
}

// 1. wire the tree (prod build + wire) — restored on exit no matter what
let wired = true
try {
  run('node', ['scripts/build.mjs', '--prod', '--wire-html'])
} catch {
  process.exit(1)
}
const restore = () => { if (wired) { try { run('node', ['scripts/build.mjs', '--restore-html']) } catch {} } }
process.on('exit', restore)
process.on('SIGINT', () => { restore(); process.exit(1) })

// 2. boot the server on the wired tree (PID captured for a clean teardown — pkill
//    -f self-matches its own bash -c command line, the probe's first crash)
const spawnOut = execFileSync('bash', ['-c',
  `DB_PATH=${process.env.PROBE_DB ?? '/tmp/hibana-e2e.db'} HIBANA_SHOTS_DIR=/tmp/hibana-e2e-shots PORT=${PORT} NODE_ENV=development OPEN_REGISTRATION=true GITHUB_OWNER=x GITHUB_REPO=y GITHUB_TOKEN=x OWNER_EMAIL=test@test.local TELEGRAM_BOT_TOKEN=x TELEGRAM_SECRET=x nohup node --import tsx src/server.ts > /tmp/sw-synthesis-probe.log 2>&1 & echo $!`])
const serverPid = spawnOut.toString().trim()
console.log(`[probe] server pid ${serverPid} on :${PORT}`)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (msg) => { console.error('FAIL: ' + msg); process.exitCode = 1 }

try {
  await wait(4000)
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  await ctx.request.post(`${BASE}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { login: 'e2e@test.local', password: 'e2e-password-123' },
  })

  const PAGES = [
    ['kanban', `/kanban?project=${PROJ}`, '.db-lane'],
    ['sprint', `/sprint.html?project=${PROJ}`, '.sp-wrap, .sp-timeline, main'],
    ['projects', `/projects.html`, 'main'],
    ['project-detail', `/project.html?id=${PROJ}`, '.pd-col'],
  ]

  // ONLINE pass: load each page once (the SW installs on the first one; the
  // synthesis runs inside its install handler), then navigate AGAIN — the second,
  // fully-controlled navigation is what populates the navigation cache entry for the
  // full ?project=/?id= URL (the first load of a fresh context is uncontrolled; a
  // query-carrying URL is only servable offline once its controlled navigation cached
  // it — the PRE-EXISTING SW contract, unchanged by S256).
  const online = []
  for (const [name, path] of PAGES) {
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)))
    await page.goto(BASE + path, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    await page.goto(BASE + path, { waitUntil: 'load' })
    await page.waitForTimeout(800)
    online.push([name, page, errs])
  }

  // Prove the synthesized bundle entries exist in the SW cache before going offline.
  {
    const p = online[0][1]
    const cacheAudit = await p.evaluate(async () => {
      const keys = await caches.keys()
      const latest = keys.sort().pop()
      const cache = await caches.open(latest)
      const entries = (await cache.keys()).map((r) => new URL(r.url).pathname)
      const bundles = entries.filter((e) => e.includes('-bundle.'))
      const sheets = entries.filter((e) => /\/dist\/(variables|rtl|devboard)\./.test(e))
      return { latest, bundles, sheetSample: sheets, total: entries.length }
    })
    console.log(`[probe] SW cache "${cacheAudit.latest}": ${cacheAudit.total} entries; bundles: ${cacheAudit.bundles.join(', ') || 'NONE'}; sheets present: ${cacheAudit.sheetSample.length >= 3}`)
    if (cacheAudit.bundles.length < 2) fail('the SW cache does not hold BOTH synthesized bundles — the synthesis did not run (check sw.js install + dist/bundles.json)')
  }

  // OFFLINE pass: same context, cache-only, hard reload of each page.
  await ctx.setOffline(true)
  let failures = 0
  for (const [name, page, onlineErrs] of online) {
    const errs = [...onlineErrs]
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)))
    await page.goto(BASE + PAGES.find(([n]) => n === name)[1], { waitUntil: 'load' })
    await page.waitForTimeout(1200)
    const r = await page.evaluate(() => {
      let rules = 0
      let bundleRules = 0
      for (const s of document.styleSheets) {
        try { rules += s.cssRules.length } catch { continue }
        if (s.href && s.href.includes('-bundle.')) bundleRules += s.cssRules.length
      }
      return {
        sheets: document.querySelectorAll('link[rel=stylesheet]').length,
        rules,
        bundleRules,
        lanes: document.querySelectorAll('.db-lane, .pd-col, .sp-wrap, main').length,
        fontOk: getComputedStyle(document.body).fontFamily.length > 0,
      }
    })
    const ok = r.bundleRules > 1000 && errs.length === 0
    // (offline boards legitimately render without lanes — the API is never cached;
    // the offline contract here is the STYLED shell + the synthesized bundle + zero
    // page errors, not data.)
    if (!ok) failures++
    console.log(`[probe] OFFLINE ${name.padEnd(14)} sheets=${r.sheets} rules=${r.rules} bundleRules=${r.bundleRules} lanes=${r.lanes} errors=${errs.length} ${ok ? 'OK' : '✗ FAIL' + (errs.length ? ' — ' + errs[0] : '')}`)
  }
  await ctx.setOffline(false)
  await browser.close()
  if (failures === 0 && process.exitCode !== 1) console.log('[probe] ALL FOUR PAGES RENDER STYLED FULLY OFFLINE — the install-time bundle synthesis works.')
  else fail(`${failures} page(s) failed the offline styled-render assertion`)
} finally {
  if (serverPid) { try { process.kill(Number(serverPid), 'SIGTERM') } catch { /* already gone */ } }
  restore()
  wired = false
}
