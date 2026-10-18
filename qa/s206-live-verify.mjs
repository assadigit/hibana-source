// qa/s206-live-verify.mjs — the S206 live verifier (https://projects.hibana.ir).
// Verifies the round's four owner asks AGAINST PRODUCTION after the CD deploy:
//   (1) /kanban full-bleed (gutter 0) + the edge-auto rail (off-canvas, hover reveals)
//   (2) the toolbar's project-name register + the Back-link retirement on the entry
//   (3) the sprint fixes under the OWNER's timezone (Asia/Tehran): real item counts,
//       the dated-create geometry, the draft-reuse save — inside a THROWAWAY project
//       that is deleted at the end (the owner's data is never touched)
// Credentials come from ENV ONLY (never in the file, never committed):
//   LIVE_EMAIL, LIVE_PASS — the test account.
// Run: LIVE_EMAIL=… LIVE_PASS=… node qa/s206-live-verify.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.LIVE_BASE || 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS
if (!EMAIL || !PASS) { console.error('LIVE_EMAIL / LIVE_PASS env required'); process.exit(1) }

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''))
}
const log = (...a) => console.log('=== ' + a.join(' '))

const run = async () => {
  // 0) health + sw version
  const health = await (await fetch(`${BASE}/api/health`)).json()
  check('health: ok / prod / db up', health.ok === true && health.environment === 'prod' && health.db === 'up', JSON.stringify(health))
  const swTxt = await (await fetch(`${BASE}/sw.js`)).text()
  check('service worker: VERSION v439 live', /hibana-v439/.test(swTxt))
  const layoutCss = await (await fetch(`${BASE}/css/layout.css?v=67`)).text()
  check('layout.css v67 serves the edge-rail rules', /rail-edge-zone/.test(layoutCss) && /body\.rail-edge/.test(layoutCss))

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tehran' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|manifest|favicon/i.test(m.text())) errors.push('console: ' + m.text()) })

  // 1) login on the custom host (its own __Host- cookie)
  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/, { timeout: 20000 })
  check('login round-trip on projects.hibana.ir', true, page.url())

  // 2) a THROWAWAY project (deleted at the end)
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S206 live probe (self-cleaning)', status: 'developing' }) })
    return r.json()
  })
  const pid = proj.id
  log('probe project:', pid)

  // 3) THE KANBAN ENTRY (owner items 1-3)
  await page.goto(`${BASE}/kanban?project=${pid}`)
  await page.waitForSelector('.db-cols', { timeout: 20000 })
  await page.waitForTimeout(600) // nav partial + syncRailIconMode
  const edge = await page.evaluate(() => ({
    railEdge: document.body.classList.contains('rail-edge'),
    pad: getComputedStyle(document.body).paddingInlineStart,
    railLeft: Math.round(document.querySelector('nav.rail').getBoundingClientRect().right),
    zone: !!document.getElementById('rail-edge-zone'),
    backHidden: (document.querySelector('[data-back-link]') || {}).hidden === true,
    titleFont: getComputedStyle(document.getElementById('db-title')).fontSize,
    titleWrap: getComputedStyle(document.getElementById('db-title')).whiteSpace,
  }))
  check('kanban: body.rail-edge engaged', edge.railEdge)
  check('kanban: FULL-BLEED — body gutter 0px', edge.pad === '0px', edge.pad)
  check('kanban: rail off-canvas (right ≤ 0)', edge.railLeft <= 0, String(edge.railLeft))
  check('kanban: the edge tripwire mounted', edge.zone)
  check('kanban: Back link retired on the entry', edge.backHidden)
  check('kanban: project name at the control register (14px, nowrap)', edge.titleFont === '14px' && edge.titleWrap === 'nowrap', edge.titleFont + '/' + edge.titleWrap)

  // hover reveal (real mouse into the start edge) — poll the SETTLED geometry (the
  // 0.18s slide can be mid-flight at first read)
  await page.mouse.move(4, 400)
  await page.waitForFunction(() => document.body.classList.contains('rail-edge-open'), null, { timeout: 5000 }).catch(() => {})
  await page.waitForFunction(() => Math.round(document.querySelector('nav.rail').getBoundingClientRect().left) === 0, null, { timeout: 5000 }).catch(() => {})
  const revealed = await page.evaluate(() => ({
    open: document.body.classList.contains('rail-edge-open'),
    left: Math.round(document.querySelector('nav.rail').getBoundingClientRect().left),
    width: Math.round(document.querySelector('nav.rail').getBoundingClientRect().width),
    pad: getComputedStyle(document.body).paddingInlineStart,
  }))
  check('kanban: edge hover REVEALS the rail (overlay, no reflow)', revealed.open && revealed.left === 0 && revealed.width >= 60 && revealed.pad === '0px', JSON.stringify(revealed))
  await page.mouse.move(700, 400)
  await page.waitForTimeout(700)
  check('kanban: leaving hides it again', await page.evaluate(() => !document.body.classList.contains('rail-edge-open')))

  // 4) THE SPRINT FIXES (owner item 4) under Tehran time
  await page.evaluate(async (pid) => {
    const today = new Date().toISOString().slice(0, 10)
    await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Live Fix Sprint', started_at: today + 'T00:00:00Z' }) })
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'live count task A', status: 'in_progress' }) })
    await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'live count task B', status: 'in_progress' }) })
  }, pid)
  // assign both to the sprint via the API (the DnD fix is e2e-pinned; here we verify the COUNT truth)
  const board0 = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), pid)
  const sid = board0.sprints[0].id
  await page.evaluate(async ([pid, sid]) => {
    for (const t of (await (await fetch(`/api/projects/${pid}/devboard`)).json()).tasks) {
      await fetch(`/api/devtasks/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sprint_id: sid }) })
    }
  }, [pid, sid])

  await page.goto(`${BASE}/sprint.html?project=${pid}`)
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(800)
  const listRow = await page.textContent('.sp-list-row').catch(() => '')
  check('sprints: all-sprints list counts REAL items (2)', /2\s*items/.test(listRow), JSON.stringify(listRow && listRow.trim()))
  const chip = await page.textContent('.sp-sprint-chip').catch(() => '')
  check('sprints: the chip stats agree (0/2)', /0\/2/.test(chip), JSON.stringify(chip && chip.trim()))

  // define-with-dates geometry (Tehran): pick today → +3d ⇒ 4 inclusive days, band at today's cell
  const sprintPosts = []
  const boardGets = []
  page.on('response', async (r) => {
    if (/\/api\/projects\/[^/]+\/sprints/.test(r.url()) && r.request().method() === 'POST') {
      sprintPosts.push({ status: r.status(), body: await r.text().catch(() => '') })
    }
    if (/\/api\/projects\/[^/]+\/devboard/.test(r.url())) {
      const body = await r.text().catch(() => '')
      boardGets.push({ status: r.status(), hasTZ: /Live TZ Sprint/.test(body), len: body.length, cache: r.headers()['cache-control'] || '' })
    }
  })
  await page.click('#sp-new-sprint')
  await page.waitForSelector('.sp-define-pop')
  await page.fill('[data-sp-define-name]', 'Live TZ Sprint')
  const localToday = await page.evaluate(() => new Date().toLocaleDateString('en-CA'))
  const plus3 = await page.evaluate(() => new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-CA'))
  await page.fill('[data-sp-define-start]', localToday)
  await page.fill('[data-sp-define-end]', plus3)
  await page.click('[data-sp-define-ok]')
  await page.waitForTimeout(3000)
  // DIAGNOSTIC: what do the client's state + a hard reload say?
  const stateDiag = await page.evaluate(() => {
    const B = window.HibanaBoard
    return { sprints: (B && B.state.sprints ? B.state.sprints : []).map((s) => [s.name, s.is_draft, s.started_at, s.ended_at]), toasts: [...document.querySelectorAll('[class*=toast]')].map((t) => t.textContent.trim()).slice(-3) }
  }).catch((e) => ({ err: String(e) }))
  console.log('DIAG state:', JSON.stringify(stateDiag))
  console.log('DIAG GETs:', JSON.stringify(boardGets))
  await page.reload()
  await page.waitForSelector('#sp-wrap:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(800)
  const afterHardReload = await page.evaluate(() => [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim().replace(/\s+/g, ' ')))
  console.log('DIAG chips after hard reload:', JSON.stringify(afterHardReload))
  const tz = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.sp-sprint-chip')].map((c) => c.textContent.trim().replace(/\s+/g, ' '))
    const tl = document.getElementById('sp-timeline')
    const band = [...tl.querySelectorAll('.sp-band')].map((b) => parseFloat(b.style.insetInlineStart))
    const today = parseFloat(tl.querySelector('.sp-today-line').style.insetInlineStart)
    return { chips, band, today }
  })
  check('sprints: dated create — 4 inclusive days under Tehran time (was 5, a day early)', tz.chips.some((c) => /Live TZ Sprint.*4 days/.test(c)), JSON.stringify(tz.chips) + ' POSTS:' + JSON.stringify(sprintPosts))
  check('sprints: the band starts at TODAY\'s cell (the picked day)', tz.band.some((b) => Math.abs(b - (tz.today - 100 / 34 / 2)) < 100 / 34 / 2), JSON.stringify({ band: tz.band, today: tz.today }))

  // the dot-under-rail click (z-order fix) — click the first dot, the editor must OPEN
  const dotHit = await page.evaluate(() => {
    const dot = document.querySelector('.sp-dot')
    if (!dot) return 'no dot'
    const r = dot.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return el ? el.className : 'nothing'
  })
  check('sprints: a task dot under a boundary rail is the TOP hit target (clickable)', /sp-dot/.test(dotHit), String(dotHit))
  if (/sp-dot/.test(dotHit)) {
    await page.click('.sp-dot >> nth=0')
    const editorOpened = await page.waitForSelector('.db-modal-card', { timeout: 5000 }).then(() => true).catch(() => false)
    check('sprints: clicking the dot opens the task editor', editorOpened)
    await page.keyboard.press('Escape')
  }

  // 5) cleanup: delete the throwaway project (its sprints + tasks cascade)
  await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, pid)
  const gone = await page.evaluate(async (pid) => (await fetch(`/api/projects/${pid}/devboard`)).status, pid)
  check('cleanup: the probe project is deleted (404)', gone === 404, String(gone))

  console.log('\n==== PAGE ERRORS (' + errors.length + ') ====')
  errors.slice(0, 20).forEach((e) => console.log('  ' + e))
  check('zero console/page errors on the round-trip', errors.length === 0)

  await browser.close()
  const fails = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fails.length}/${results.length} PASS — ${fails.length ? 'FAILURES ABOVE' : 'ALL GREEN'}`)
  process.exit(fails.length ? 1 : 0)
}

run().catch((e) => { console.error('LIVE VERIFY CRASHED:', e && e.message); process.exit(1) })
