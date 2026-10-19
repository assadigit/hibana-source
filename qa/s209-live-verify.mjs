// qa/s209-live-verify.mjs — the S209 live verifier (THE KANBAN 1:1 PARITY ROUND).
// Verifies against PRODUCTION after the CD deploy, on the host LIVE_BASE points at
// (run twice: https://projects.hibana.ir AND https://hibana.ir — the __Host-
// session cookie is host-only, each host gets its own login round-trip):
//   (1) health + sw v444 + the round's asset versions live (devboard.js v28 with
//       the fullscreen toggle + the 10-op toolbar; project-page.js v76 with the
//       label-manager wiring; devboard.css v34 with the embedded frame)
//   (2) /kanban: the mother container + the FULL toolbar + the FULLSCREEN writing
//       mode (enter → metadata hides → the FIRST Esc exits focus only → the modal
//       survives → the second Esc closes)
//   (3) /board.html?project=: the SAME contracts + the two documented
//       entry-contextual exceptions (Back link visible + icons rail)
//   (4) the EMBEDDED board (project.html): the .db-frame mother container + the
//       hairline header row + NO viewport floor + the LABEL MANAGER (the shared
//       devboard.js dialog opens) + the ◆ sprint badge + the pin badge surviving
//       the +N expand repaint
//   (5) sprint.html: the Board link targets the canonical /kanban
// Everything runs inside a THROWAWAY project deleted at the end (the owner's data
// is never touched). Credentials from ENV ONLY (never in the file).
// Run: LIVE_EMAIL=… LIVE_PASS=… LIVE_BASE=https://projects.hibana.ir node qa/s209-live-verify.mjs
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
const log = (...a) => console.log('=== ' + a.join(' ') + ' [host: ' + BASE + ']')

const run = async () => {
  // 0) health + sw version + the round's assets
  const health = await (await fetch(`${BASE}/api/health`)).json()
  check('health: ok / prod / db up', health.ok === true && health.environment === 'prod' && health.db === 'up', JSON.stringify(health))
  const swTxt = await (await fetch(`${BASE}/sw.js`)).text()
  check('service worker: VERSION v444 live', /hibana-v444/.test(swTxt))
  const dbJs = await (await fetch(`${BASE}/js/devboard.js?v=28`)).text()
  check('devboard.js v28 live — the fullscreen toggle + the full toolbar shipped', /data-db-fullscreen/.test(dbJs) && /data-tb="underline"/.test(dbJs) && /data-tb="ordered-list"/.test(dbJs) && /data-tb="align-justify"/.test(dbJs) && /exitFullscreenOrClose/.test(dbJs))
  const ppJs = await (await fetch(`${BASE}/js/project-page.js?v=76`)).text()
  check('project-page.js v76 live — the label-manager wiring + the badge-bearing truth builder shipped', /data-pd-labels/.test(ppJs) && /openLabels/.test(ppJs) && /pdDetailMaps/.test(ppJs))
  const dbCss = await (await fetch(`${BASE}/css/devboard.css?v=34`)).text()
  check('devboard.css v34 live — the embedded frame + the fullscreen styles shipped', /\.pd-board\.db-frame/.test(dbCss) && /\.db-modal-card\.db-fullscreen/.test(dbCss) && /main\.board-shell \.db-frame \{ min-block-size/.test(dbCss))

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tehran' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(25000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|manifest|favicon|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()) })

  // 1) login (the host's own __Host- cookie)
  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/, { timeout: 25000 })
  check('login round-trip on ' + BASE, true, page.url())

  // 2) a THROWAWAY project (deleted at the end)
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S209 live probe (self-cleaning)', status: 'developing' }) })
    return r.json()
  })
  const pid = proj.id
  log('probe project:', pid)

  try {
    // a sprint + 7 tasks in one column + a pinned shot on the 7th (the badge matrix)
    const sprint = await page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${pid}/sprints`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'S209 Live Sprint' }) })
      return r.json()
    }, pid)
    await page.evaluate(async ([pid, sid]) => {
      await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S209 live sprinted task', status: 'in_progress', sprint_id: sid }) })
      for (let i = 1; i <= 7; i++) await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `S209 live col task ${i}`, status: 'in_progress' }) })
    }, [pid, sprint.id])

    // 3) /kanban — the mother container + the FULL toolbar + FULLSCREEN
    await page.goto(`${BASE}/kanban?project=${pid}`)
    await page.waitForSelector('.db-cols', { timeout: 25000 })
    const kanban = await page.evaluate(() => ({
      frame: !!document.querySelector('.db-frame'),
      switcher: !!document.getElementById('db-project-switch'),
      backHidden: document.querySelector('[data-back-link]')?.hidden === true,
      edgeRail: document.body.classList.contains('rail-edge'),
      toolbar: Array.from(document.querySelectorAll('.db-modal .pd-tb [data-tb]')).map((b) => b.dataset.tb),
      fullscreenBtn: !!document.querySelector('.db-modal [data-db-fullscreen]'),
      sprintBadge: !!document.querySelector('.db-sprint-badge'),
    }))
    // the modal hasn't opened yet — open it to measure the editor contracts
    await page.click('[data-add="idea"]')
    await page.waitForSelector('.db-modal-card')
    const modalState = await page.evaluate(() => ({
      toolbar: Array.from(document.querySelectorAll('.db-modal .pd-tb [data-tb]')).map((b) => b.dataset.tb),
      fullscreenBtn: !!document.querySelector('.db-modal [data-db-fullscreen]'),
      upload: !!document.querySelector('[data-db-shots-add]'),
      tags: !!document.querySelector('[data-db-newtag-in]'),
    }))
    check('/kanban: the mother container + the switcher + no Back link + the edge rail', kanban.frame && kanban.switcher && kanban.backHidden && kanban.edgeRail)
    check('/kanban editor: the FULL 10-op toolbar (the original editor\'s vocabulary)', JSON.stringify(modalState.toolbar) === JSON.stringify(['bold', 'underline', 'strikethrough', 'list', 'ordered-list', 'align-left', 'align-center', 'align-right', 'align-justify', 'code']), JSON.stringify(modalState.toolbar))
    check('/kanban editor: the Upload File button + the tags field (S208 intact)', modalState.upload && modalState.tags)

    // the toolbar op works live — underline a selection (raw markdown)
    await page.evaluate(() => {
      const ta = document.querySelector('.db-modal [name=title]')
      ta.focus(); ta.value = 's209 live toolbar'; ta.setSelectionRange(0, 4)
    })
    await page.click('.db-modal [data-tb="underline"]')
    const marked = await page.evaluate(() => (document.querySelector('.db-modal [name=title]')).value)
    check('/kanban editor: the underline op writes __raw markdown__ live', marked.includes('__s209__'), marked)

    // FULLSCREEN — enter, metadata hides, the FIRST Esc exits focus ONLY
    await page.click('.db-modal [data-db-fullscreen]')
    await page.waitForTimeout(300)
    const focused = await page.evaluate(() => {
      const card = document.querySelector('.db-modal .db-modal-card')
      const statusField = document.querySelector('.db-modal .db-seg[data-seg="status"]').closest('.db-field')
      return { cls: card.classList.contains('db-fullscreen'), statusHidden: statusField.offsetParent === null, titleVisible: !!(document.querySelector('.db-modal [name=title]')).offsetParent }
    })
    check('/kanban editor: FULLSCREEN enters (the writing row claims the viewport, metadata hides)', focused.cls && focused.statusHidden && focused.titleVisible, JSON.stringify(focused))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const afterFirstEsc = await page.evaluate(() => ({
      cls: document.querySelector('.db-modal .db-modal-card').classList.contains('db-fullscreen'),
      open: !!(document.querySelector('.db-modal')).offsetParent,
    }))
    check('/kanban editor: the FIRST Esc exits fullscreen ONLY (the modal survives)', !afterFirstEsc.cls && afterFirstEsc.open, JSON.stringify(afterFirstEsc))
    await page.keyboard.press('Escape')
    await page.waitForSelector('.db-modal-card', { state: 'hidden', timeout: 10000 })
    check('/kanban editor: the second Esc closes the editor as before', true)

    // 4) /board.html — the SAME contracts + the two documented exceptions
    await page.goto(`${BASE}/board.html?project=${pid}`)
    await page.waitForSelector('.db-cols', { timeout: 25000 })
    const boardHtml = await page.evaluate(() => ({
      frame: !!document.querySelector('.db-frame'),
      backVisible: !!(document.querySelector('[data-back-link]'))?.offsetParent,
      iconsRail: document.body.classList.contains('rail-icons-only'),
      edgeRail: document.body.classList.contains('rail-edge'),
    }))
    check('/board.html: the SAME mother container + the Back link + the icons rail (the documented entry-contextual exceptions)', boardHtml.frame && boardHtml.backVisible && boardHtml.iconsRail && !boardHtml.edgeRail, JSON.stringify(boardHtml))

    // 5) the EMBEDDED board (project.html) — the frame + the label manager + the badges
    await page.goto(`${BASE}/project.html?id=${pid}`)
    await page.waitForSelector('#pd-board', { timeout: 25000 })
    const embedded = await page.evaluate(() => {
      const el = document.getElementById('pd-board')
      const head = el.querySelector('.pd-board-head')
      const cs = getComputedStyle(el)
      const hs = getComputedStyle(head)
      return {
        hasFrame: el.classList.contains('db-frame'),
        bg: cs.backgroundColor,
        floorPx: parseFloat(cs.minBlockSize) || 0,
        headToolbar: head.classList.contains('db-toolbar'),
        headBg: hs.backgroundColor,
        labelsBtn: !!document.querySelector('[data-pd-labels]'),
        sprintBadge: !!document.querySelector('.db-sprint-badge')?.textContent?.includes('S209 Live Sprint'),
      }
    })
    check('embedded board: the .db-frame mother container + the hairline header row (no viewport floor)', embedded.hasFrame && embedded.bg === 'rgb(255, 255, 255)' && embedded.floorPx < 100 && embedded.headToolbar && embedded.headBg === 'rgba(0, 0, 0, 0)', JSON.stringify(embedded))
    check('embedded board: the ◆ sprint badge renders (the /kanban card contract)', embedded.sprintBadge)
    await page.click('[data-pd-labels]')
    await page.waitForSelector('.db-labels-card', { timeout: 25000 })
    check('embedded board: the LABEL MANAGER opens (the shared devboard.js dialog)', true)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.db-labels-card', { state: 'hidden', timeout: 10000 })

    // the pin badge survives the +N expand — pin a shot to the 7th column task
    const colTask = await page.evaluate(async (pid) => {
      const board = await (await fetch(`/api/projects/${pid}/devboard`)).json()
      return board.tasks.filter((t) => /S209 live col task/.test(t.title)).sort((a, b) => a.title.localeCompare(b.title))[6].id
    }, pid)
    await page.evaluate(async ([pid, tid]) => {
      // the API upload path (base64, the app's own contract — a 1x1 png);
      // the response is 201 { ok, id, mimeType } (core.ts)
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const r = await fetch(`/api/projects/${pid}/screenshots`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 's209-live-proof.png', mimeType: 'image/png', dataBase64: b64, caption: '' }) })
      const shot = await r.json()
      await fetch(`/api/screenshots/${shot.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: tid }) })
    }, [pid, colTask])
    await page.reload()
    await page.waitForSelector('#pd-board', { timeout: 25000 })
    await page.click('[data-pd-more="in_progress"]')
    await page.waitForFunction((tid) => !!document.querySelector(`.pd-task-wrap[data-pd-task="${tid}"] .pd-task-shots`), colTask, { timeout: 25000 })
    const badgeTxt = await page.evaluate((tid) => document.querySelector(`.pd-task-wrap[data-pd-task="${tid}"] .pd-task-shots`)?.textContent?.trim() || '', colTask)
    check('embedded board: the pin badge SURVIVES the +N expand repaint (it used to vanish)', /1/.test(badgeTxt), badgeTxt)

    // 6) sprint.html — the Board link targets the canonical entry
    await page.goto(`${BASE}/sprint.html?project=${pid}`)
    await page.waitForSelector('#sp-wrap', { timeout: 25000 })
    const boardHref = await page.evaluate(() => document.getElementById('sp-board-link')?.getAttribute('href'))
    check('sprint.html: the Board link targets the canonical /kanban entry', boardHref === `/kanban?project=${pid}`, boardHref || '')

    check('zero page errors across the round-trip', errors.length === 0, errors.slice(0, 3).join(' | '))
  } finally {
    // 7) CLEANUP — the throwaway project goes (the ghost-sweep pattern owns the
    // name class: 'S\d+ live probe' + '(self-cleaning)')
    try {
      await page.evaluate(async (pid) => { await fetch('/api/projects/' + pid, { method: 'DELETE' }) }, pid)
      log('probe project deleted:', pid)
    } catch { /* best-effort — the sweeper owns the pattern */ }
    await browser.close()
  }

  const fails = results.filter((r) => !r.ok).length
  console.log(`\n${fails === 0 ? 'ALL GREEN' : fails + ' FAILURES'} — ${results.length - fails}/${results.length} checks passed [host: ${BASE}]`)
  process.exit(fails === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL', e); process.exit(1) })
