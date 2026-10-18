// qa/s208-live-verify.mjs — the S208 live verifier (https://projects.hibana.ir).
// Verifies THE TASK-OPTION PARITY ROUND against PRODUCTION after the CD deploy:
//   (1) health + sw v443 (the version the round ships)
//   (2) the NEW-task modal shows the Upload File button (the owner's exact
//       complaint: "creating a task doesn't show the button") + the accept list
//       + the tags field
//   (3) the REAL upload pipeline end-to-end: pick a real PNG → staged grid →
//       SAVE → the shot is PINNED to the created task (API truth) → the card
//       grows the pin badge
//   (4) the EDIT modal: the same button + the inline pinned grid; zoom opens
//       the lightbox; Esc closes ONLY the lightbox (the editor survives)
//   (5) tags on create (staged chips ride the create body)
//   (6) the pinned-pictures dialog from the badge (zoom + unpin reloads)
// Everything runs inside a THROWAWAY project deleted at the end (the owner's
// data is never touched). Credentials from ENV ONLY (never in the file).
// Run: LIVE_EMAIL=… LIVE_PASS=… node qa/s208-live-verify.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.LIVE_BASE || 'https://projects.hibana.ir'
const EMAIL = process.env.LIVE_EMAIL
const PASS = process.env.LIVE_PASS
if (!EMAIL || !PASS) { console.error('LIVE_EMAIL / LIVE_PASS env required'); process.exit(1) }

const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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
  check('service worker: VERSION v443 live', /hibana-v443/.test(swTxt))
  const dbJs = await (await fetch(`${BASE}/js/devboard.js?v=27`)).text()
  check('devboard.js v27 live — the shots machinery shipped', /data-db-shots-add/.test(dbJs) && /uploadShotXHR/.test(dbJs))
  const bpJs = await (await fetch(`${BASE}/js/board-page.js?v=20`)).text()
  check('board-page.js v20 live — the pin badge shipped', /pd-task-shots/.test(bpJs) && /data-db-shots-dialog/.test(bpJs))

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tehran' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(25000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/401|404|manifest|favicon|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()) })

  // 1) login on the custom host (its own __Host- cookie)
  await page.goto(`${BASE}/login.html`)
  await page.fill('[name="login"]', EMAIL)
  await page.fill('[name="password"]', PASS)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/app/, { timeout: 25000 })
  check('login round-trip on projects.hibana.ir', true, page.url())

  // 2) a THROWAWAY project (deleted at the end)
  const proj = await page.evaluate(async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'S208 live probe (self-cleaning)', status: 'developing' }) })
    return r.json()
  })
  const pid = proj.id
  log('probe project:', pid)

  try {
    // 3) THE OWNER'S EXACT COMPLAINT — the NEW-task modal
    await page.goto(`${BASE}/kanban?project=${pid}`)
    await page.waitForSelector('.db-cols', { timeout: 25000 })
    await page.click('[data-add="idea"]')
    await page.waitForSelector('.db-modal-card')
    const newModal = await page.evaluate(() => {
      const btn = document.querySelector('[data-db-shots-add]')
      const input = document.querySelector('[data-db-shots-input]')
      return {
        btn: !!btn,
        label: btn ? btn.textContent.trim() : '',
        accept: input ? input.getAttribute('accept') : '',
        multiple: input ? input.hasAttribute('multiple') : false,
        tagIn: !!document.querySelector('[data-db-newtag-in]'),
        count: !!document.querySelector('[data-db-shots-count]'),
      }
    })
    check('new-task modal: the Upload File button SHOWS (the owner ask)', newModal.btn, JSON.stringify(newModal))
    check('new-task modal: the label reads Upload File', /Upload File/i.test(newModal.label), newModal.label)
    check('new-task modal: the FULL S86 accept list', newModal.accept.includes('video/webm') && newModal.accept.includes('.pdf') && newModal.accept.includes('image/png'), newModal.accept)
    check('new-task modal: multiple + the count span + the tags field', newModal.multiple && newModal.count && newModal.tagIn)

    // 4) THE REAL UPLOAD PIPELINE — stage a real PNG, save, pin lands
    await page.fill('[name=title]', 'S208 live task (picture proof)')
    await page.setInputFiles('[data-db-shots-input]', { name: 's208-proof.png', mimeType: 'image/png', buffer: PNG_BUFFER })
    await page.waitForSelector('.db-modal-card [data-db-shots-grid] .shot-card', { timeout: 30000 })
    const stagedCount = await page.textContent('[data-db-shots-count]')
    check('staged: the grid tiles the picked picture immediately', /1 attached/.test(stagedCount || ''), stagedCount || '')
    // stage a tag too (tags-on-create rides the same save)
    const tagIn = page.locator('[data-db-newtag-in]')
    await tagIn.fill('s208-live')
    await tagIn.press('Enter')
    await page.waitForSelector('.db-modal-card [data-db-newtags] .db-tag')
    check('staged: a tag chip lands (tags on create)', true)
    await page.click('[data-db-save]')
    await page.waitForSelector('.db-modal-card', { state: 'hidden', timeout: 30000 })
    check('save: the modal closed (task created)', true)

    // the PIN landed (API truth — the PATCH fired between create and close)
    const shots = await page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${pid}/screenshots`)
      return (await r.json()).screenshots
    }, pid)
    const pinned = shots.filter((s) => s.task_id)
    check('save: the shot is PINNED to the created task (API truth)', pinned.length === 1 && !!pinned[0].task_id, `pinned=${pinned.length}`)

    // the payload carries the count + the card grows the badge
    const board = await page.evaluate(async (pid) => (await (await fetch(`/api/projects/${pid}/devboard`)).json()), pid)
    const task = board.tasks.find((t) => /S208 live task/.test(t.title))
    check('payload: the task row carries shot_count=1', !!task && Number(task.shot_count) === 1, `shot_count=${task ? task.shot_count : 'missing'}`)
    check('payload: the task row carries the created tag', !!task && (task.tags || []).length === 1, JSON.stringify(task ? task.tags : []))
    await page.reload()
    await page.waitForSelector('.db-cols', { timeout: 25000 })
    await page.waitForSelector('.pd-task-wrap[data-task-card] .pd-task-shots', { timeout: 25000 })
    const badgeTxt = await page.textContent('.pd-task-wrap[data-task-card] .pd-task-shots')
    check('the card grows the pin badge with the count', /1/.test(badgeTxt || ''), (badgeTxt || '').trim())

    // 5) THE EDIT MODAL — the same button + the inline pinned grid
    await page.click('.pd-task-wrap[data-task-card] .pd-task')
    await page.waitForSelector('.db-modal-card')
    // renderPinnedGrid() is async (the shots list fetch) — wait for the tile,
    // then measure (the e2e spec's toBeVisible contract, not a snapshot race)
    await page.waitForSelector('[data-db-shots-grid] .shot-card', { timeout: 25000 })
    const editModal = await page.evaluate(() => ({
      btn: !!document.querySelector('[data-db-shots-add]'),
      gridTile: !!document.querySelector('[data-db-shots-grid] .shot-card'),
      zoom: !!document.querySelector('[data-db-shot-zoom]'),
      tags: !!document.querySelector('[data-db-tag-in]'),
    }))
    check('edit modal: the SAME Upload File button shows', editModal.btn)
    check('edit modal: the pinned grid tiles the task\u2019s shot inline', editModal.gridTile && editModal.zoom)
    check('edit modal: the live tags field (established flow) intact', editModal.tags)

    // 6) the lightbox — zoom + Esc closes ONLY the lightbox
    await page.click('[data-db-shot-zoom]')
    await page.waitForSelector('.shot-lightbox', { timeout: 25000 })
    check('zoom: the lightbox paints above the modal', true)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.shot-lightbox', { state: 'detached', timeout: 10000 })
    const modalStill = await page.isVisible('.db-modal-card')
    check('Esc over the lightbox closes ONLY the lightbox (the editor survives)', modalStill)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.db-modal-card', { state: 'hidden', timeout: 10000 })
    check('the second Esc closes the editor as before', true)

    // 7) the pinned-pictures dialog from the badge (zoom + unpin reloads)
    await page.waitForSelector('.pd-task-wrap[data-task-card] .pd-task-shots')
    await page.click('.pd-task-wrap[data-task-card] .pd-task-shots')
    await page.waitForSelector('#db-taskshots')
    const dlgShot = await page.isVisible('#db-taskshots .shot-card')
    check('the badge opens the pinned-pictures dialog with the shot', dlgShot)
    await page.click('#db-taskshots [data-tshots-unpin]')
    await page.waitForSelector('#db-taskshots', { state: 'hidden', timeout: 25000 })
    await page.waitForSelector('.pd-task-shots', { state: 'detached', timeout: 25000 })
    check('unpin: the dialog closes + the board reloads + the badge drops', true)

    check('zero page errors across the round-trip', errors.length === 0, errors.slice(0, 3).join(' | '))
  } finally {
    // 8) CLEANUP — the throwaway project goes (the ghost-sweep pattern owns the
    // name class anyway: 'S\d+ live probe' + '(self-cleaning)')
    try {
      await page.evaluate(async (pid) => { await fetch('/api/projects/' + pid, { method: 'DELETE' }) }, pid)
      log('probe project deleted:', pid)
    } catch { /* best-effort — the sweeper owns the pattern */ }
    await browser.close()
  }

  const fails = results.filter((r) => !r.ok).length
  console.log(`\n${fails === 0 ? 'ALL GREEN' : fails + ' FAILURES'} — ${results.length - fails}/${results.length} checks passed`)
  process.exit(fails === 0 ? 0 : 1)
}

run().catch((e) => { console.error('FATAL', e); process.exit(1) })
