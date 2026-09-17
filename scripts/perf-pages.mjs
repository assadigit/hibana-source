#!/usr/bin/env node
// S69 perf-session page-load baseline harness (agenda #1: MEASURE FIRST).
// 8 key pages × {EN, FA} × {cold, warm} × 3 cycles — medians + per-API breakdown.
//
//   cold = fresh browser context (empty HTTP cache, no SW registration)
//   warm = second navigation in the SAME context (HTTP cache + SW precache active)
//
// Tour suppressed in all runs (hibana-tour-done=1) for comparability — cold numbers
// therefore EXCLUDE the first-visit tour overlay cost. Language via user pref
// (PATCH /api/settings) + localStorage 'hibana-lang' (boot cache), matching the app.
//
// Run (server on :3017 must be up, perf-seed applied):
//   node scripts/perf-pages.mjs [--json scripts/perf-baseline.json]
//
// No CPU throttle (raw desktop numbers); headless; deterministic settle waits.

import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.PERF_BASE ?? 'http://localhost:3017'
const CYCLES = Number(process.env.PERF_CYCLES ?? 3)
const ONLY = process.env.PERF_PAGES ? process.env.PERF_PAGES.split(',') : null
const EMAIL = 'e2e@test.local'
const PASS = 'e2e-password-123'

// The 8 key pages (mission list). Project detail uses a deterministic 'doing' project
// from the perf seed (uuid('b', 100+…)); we discover one via the API at boot.
const PAGES = [
  ['dashboard', '/dashboard.html'],
  ['projects', '/projects.html'],
  ['project-detail', '/project.html?id=__DOING__'],
  ['notes-vault', '/notes.html'],
  ['gallery', '/gallery.html'],
  ['calendar', '/calendar.html'],
  ['whiteboard', '/whiteboard.html'],
  ['settings', '/settings.html'],
]

const collectJs = `(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paints = performance.getEntriesByType('paint')
  const res = performance.getEntriesByType('resource')
  const api = res.filter(r => r.name.includes('/api/'))
  const apiEntries = api.map(r => {
    const u = new URL(r.name)
    return { path: u.pathname + (u.search ? u.search.slice(0, 24) : ''), ms: Math.round(r.duration), bytes: r.transferSize || r.encodedBodySize || 0, status: r.responseStatus ?? 0 }
  })
  return {
    ttfb: Math.round(nav.responseStart),
    dcl: Math.round(nav.domContentLoadedEventEnd),
    load: Math.round(nav.loadEventEnd),
    fcp: Math.round((paints.find(p => p.name === 'first-contentful-paint') || { startTime: -1 }).startTime),
    transfer: res.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) + (nav.transferSize || nav.encodedBodySize || 0),
    resources: res.length + 1,
    apiCount: api.length,
    apiMs: Math.round(api.reduce((n, r) => n + r.duration, 0)),
    domNodes: document.querySelectorAll('*').length,
    swControlled: !!navigator.serviceWorker.controller,
    apiEntries,
  }
})()`

// Cold loads self-reload once (SW first-install controllerchange → boot.js reload).
// Wait until the page settles: same (url, loadEventEnd, domNodes) signature on two
// consecutive probes ≥600ms apart, with the load event actually finished.
async function waitForSettled(page, timeoutMs = 20000) {
  const start = Date.now()
  let lastSig = null
  let stableAt = 0
  while (Date.now() - start < timeoutMs) {
    const sig = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0]
      return `${location.pathname}|${n ? Math.round(n.loadEventEnd) : -1}|${document.querySelectorAll('*').length}`
    }).catch(() => null)
    if (sig && sig === lastSig && !sig.endsWith('|-1') && !/\|0$/.test(sig)) {
      if (!stableAt) stableAt = Date.now()
      if (Date.now() - stableAt >= 600) return true
    } else {
      stableAt = 0
      lastSig = sig
    }
    await page.waitForTimeout(250)
  }
  return false
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function setLanguage(request, lang) {
  await request.post(`${BASE}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { login: EMAIL, password: PASS },
  })
  const r = await request.patch(`${BASE}/api/settings`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { language_pref: lang },
  })
  if (!r.ok()) throw new Error(`settings PATCH failed: ${r.status()}`)
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const results = []

  // discover a 'doing' project id for project-detail
  const probe = await browser.newContext()
  await probe.request.post(`${BASE}/api/auth/login`, { headers: { 'Content-Type': 'application/json', Origin: BASE }, data: { login: EMAIL, password: PASS } })
  const me = await probe.request.get(`${BASE}/api/projects?status=doing`, { headers: { Origin: BASE } })
  const projects = (await me.json()).projects ?? []
  const doing = projects[0]?.id
  await probe.close()
  if (!doing) throw new Error('no doing project found — run perf-seed first')
  const urls = Object.fromEntries(PAGES.map(([k, u]) => [k, u.replace('__DOING__', doing)]))
  const pages = ONLY ? PAGES.filter(([k]) => ONLY.includes(k)) : PAGES

  for (const lang of ['en', 'fa']) {
    // set the server-side pref once per language phase
    const langCtx = await browser.newContext()
    await setLanguage(langCtx.request, lang)
    await langCtx.close()

    for (const [name, path] of pages) {
      const url = `${BASE}${urls[name]}`
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        const ctx = await browser.newContext()
        await ctx.addInitScript(([l]) => {
          localStorage.setItem('hibana-lang', l)
          localStorage.setItem('hibana-tour-done', '1')
        }, [lang])
        // login inside this fresh context (cookie lands in the shared jar)
        await ctx.request.post(`${BASE}/api/auth/login`, {
          headers: { 'Content-Type': 'application/json', Origin: BASE },
          data: { login: EMAIL, password: PASS },
        })
        const page = await ctx.newPage()
        const consoleErrors = []
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
        page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 160)))

        // COLD — first navigation, empty caches (may self-reload once on SW first install)
        let coldNavs = 0
        page.on('framenavigated', (f) => { if (f === page.mainFrame() && f.url().startsWith('http')) coldNavs++ })
        await page.goto(url, { waitUntil: 'load' }).catch((e) => console.log(`\n  !! goto cold ${lang}/${name} failed: ${e.message.slice(0, 200)}`))
        await waitForSettled(page)
        const cold = await page.evaluate(collectJs)
        cold.selfReloads = coldNavs - 1

        // WARM — same context, HTTP cache + SW active
        await page.reload({ waitUntil: 'load' }).catch((e) => console.log(`\n  !! reload warm ${lang}/${name} failed: ${e.message.slice(0, 200)}`))
        await waitForSettled(page)
        const warm = await page.evaluate(collectJs)

        for (const [kind, m] of [['cold', cold], ['warm', warm]]) {
          results.push({ lang, page: name, cycle, kind, ...m, consoleErrors: consoleErrors.length, consoleSample: [...new Set(consoleErrors)].slice(0, 3) })
        }
        await ctx.close()
        process.stdout.write(`  ${lang}/${name} c${cycle} cold=${cold.load}ms warm=${warm.load}ms api=${cold.apiCount}/${warm.apiCount}  \r`)
      }
    }
  }
  await browser.close()

  // ── aggregate ──
  const out = { generatedAt: new Date().toISOString(), base: BASE, cycles: CYCLES, note: 'tour suppressed; no CPU throttle; medians of N cycles; ms; bytes', rows: results }
  const jsonPath = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : 'scripts/perf-baseline.json'
  writeFileSync(jsonPath, JSON.stringify(out, null, 2))

  console.log('\n\n═'.repeat(96))
  console.log('PAGE LOAD BASELINE (median of cycles) — ms | KB transferred | resources | api calls | api ms | DOM nodes')
  console.log('═'.repeat(96))
  console.log(`${'page'.padEnd(15)} ${'lang'.padEnd(4)} ${'TTFB'.padStart(5)} ${'DCL'.padStart(6)} ${'LOAD'.padStart(6)} ${'FCP'.padStart(6)} ${'KB'.padStart(7)} ${'res'.padStart(4)} ${'api'.padStart(4)} ${'apiMs'.padStart(6)} ${'dom'.padStart(6)} ${'err'.padStart(4)}`)
  for (const lang of ['en', 'fa']) {
    for (const [name] of PAGES) {
      for (const kind of ['cold', 'warm']) {
        const rows = results.filter((r) => r.lang === lang && r.page === name && r.kind === kind)
        const line = [
          median(rows.map((r) => r.ttfb)),
          median(rows.map((r) => r.dcl)),
          median(rows.map((r) => r.load)),
          median(rows.map((r) => r.fcp)),
          Math.round(median(rows.map((r) => r.transfer)) / 1024),
          median(rows.map((r) => r.resources)),
          median(rows.map((r) => r.apiCount)),
          median(rows.map((r) => r.apiMs)),
          median(rows.map((r) => r.domNodes)),
          rows.reduce((n, r) => n + r.consoleErrors, 0),
        ]
        console.log(`${name.padEnd(15)} ${lang.padEnd(4)} ${kind.padStart(5)} ${line.map((v) => String(v).padStart(6)).join(' ')}`)
      }
    }
  }

  // ── per-API endpoint breakdown (cold, EN — the N+1 lens) ──
  console.log('\n' + '═'.repeat(96))
  console.log('API BREAKDOWN (cold, EN+FA pooled — count × ms × KB per endpoint, medians per cycle)')
  console.log('═'.repeat(96))
  const perEndpoint = new Map()
  for (const r of results.filter((r) => r.kind === 'cold')) {
    const seen = new Map()
    for (const e of r.apiEntries) {
      if (!seen.has(e.path)) seen.set(e.path, { n: 0, ms: 0, bytes: 0 })
      const s = seen.get(e.path)
      s.n++; s.ms += e.ms; s.bytes += e.bytes
    }
    for (const [path, s] of seen) {
      if (!perEndpoint.has(path)) perEndpoint.set(path, [])
      perEndpoint.get(path).push(s)
    }
  }
  const endpoints = [...perEndpoint.entries()]
    .map(([path, samples]) => ({ path, n: median(samples.map((s) => s.n)), ms: median(samples.map((s) => s.ms)), bytes: Math.round(median(samples.map((s) => s.bytes)) / 1024) }))
    .sort((a, b) => b.n * b.ms - a.n * a.ms)
  for (const e of endpoints) console.log(`${String(e.n).padStart(4)}× ${String(e.ms).padStart(6)}ms ${String(e.bytes).padStart(6)}KB  ${e.path}`)
  console.log(`\nJSON written: ${jsonPath}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
