// qa/s207-ghost-sweep.mjs — the live ghost-project sweeper.
//
// WHY (S207, owner report 2026-10-19): the S206 sprint-hang investigation drove 15+
// repro generations against PROD with disposable projects ("S206 reproN
// (self-cleaning)", "S206 live probe (self-cleaning)", …). The probes' cleanup
// DELETE only ran on the SUCCESS path — a probe that crashed mid-run (timeouts
// during the hang hunt; the sandbox also kills background processes) left its
// project behind. Two survivors ("S206 repro5/repro9 (self-cleaning)") showed up
// in the owner's kanban project switcher as junk rows.
//
// WHAT: logs in with LIVE_EMAIL/LIVE_PASS (env-only, never committed), lists
// /api/projects, deletes every project whose title matches the probe-artifact
// patterns below, and reports before/after. Real project names never match
// (SportSignal, Currena, …) — the patterns are deliberately narrow.
//
// RUNBOOK: after any live probe round that creates projects, run:
//   LIVE_EMAIL=… LIVE_PASS=… node qa/s207-ghost-sweep.mjs
// (LIVE_BASE optional, defaults to https://projects.hibana.ir)
//
// FUTURE PROBES: create titles matching this pattern (or add your pattern here),
// and wrap your run in try/finally so cleanup runs on the crash path too — this
// sweeper is the belt-and-braces, not a license to leak.

import { chromium } from '@playwright/test'

const BASE = process.env.LIVE_BASE || 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS

// probe-artifact title patterns — deliberately narrow, never a real name
const GHOST_PATTERNS = [
  /^\s*S\d+\s+(repro|live probe|final|sprint probe|sprint-probe)\b/i, // "S206 repro9 …", "S206 live probe …"
  /\(self-cleaning\)\s*$/i, // the probes' explicit marker
]
const isGhost = (title) => typeof title === 'string' && GHOST_PATTERNS.some((re) => re.test(title))

if (!EMAIL || !PASS) {
  console.error('LIVE_EMAIL and LIVE_PASS env vars are required (the owner probe account).')
  process.exit(1)
}

const run = async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/)

  const list = async () =>
    await page.evaluate(async () => {
      const r = await fetch('/api/projects?sort=recent', { headers: { accept: 'application/json' } })
      const d = await r.json()
      return Array.isArray(d) ? d : d.projects || d.data || []
    })

  const before = await list()
  const ghosts = before.filter((p) => isGhost(p.title))
  console.log(`projects before: ${before.length}; ghost artifacts: ${ghosts.length}`)
  for (const g of ghosts) console.log(`  ghost: "${g.title}" [${g.id}] created ${g.created_at || g.created || '?'}`)

  for (const g of ghosts) {
    const status = await page.evaluate(async (id) => {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      return res.status
    }, g.id)
    console.log(`DELETE "${g.title}" [${g.id}] → ${status}`)
    if (status >= 400) console.error('  ^ DELETE FAILED — investigate before continuing')
  }

  const after = await list()
  const remaining = after.filter((p) => isGhost(p.title))
  console.log(`projects after: ${after.length}; remaining ghosts: ${remaining.length}`)
  if (remaining.length) {
    console.error('FAIL: ghosts survived the sweep')
    process.exitCode = 1
  } else {
    console.log('SWEEP CLEAN ✓')
  }
  await browser.close()
}

run().catch((e) => {
  console.error('CRASHED:', e && e.message)
  process.exit(1)
})
