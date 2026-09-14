// e2e/sprint-timeline.spec.ts — S35 (user request 2026-09): three features.
//   1. SPRINT STRIPS (the "video-editing timeline"): a started sprint renders a
//      start-dot + a clip that grows (open → today, live edge) and FREEZES on
//      finish (end-dot + «n days» chip); the chip carries duration + done stats;
//      the strip fill + done-day ticks come from the dev tasks done in the window;
//      the axis extends BACK so a finished sprint stays visible.
//   2. THE ARCHIVE: archiving an idea (spark) parks it — off the projects list,
//      on /archive.html with a Restore action that puts it back.
//   3. SCREENSHOT PROBLEM CARDS: each shot renders as image + note + open/fixed
//      state; the note edits inline, the resolve toggle PATCHes, delete removes.
//      (The shot row is seeded directly — the e2e server has no real storage
//      credentials; the card interactions are pure API + DOM.)
// Run: npx playwright test e2e/sprint-timeline.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s35@test.local'
const TEST_PASS = 'e2e-password-123'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s35', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('load').catch(() => {})
  // the SW-controller wait every spec carries (S34's flake fix)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
  // the screenshot spec seeds rows with no real bytes — the media read 500s on the
  // fake GitHub token; the CARD interactions are the story, not the image bytes
  /Failed to load resource.*500/,
]
const trackErrors = (page: Page) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })
  return errors
}

/** API helpers — the sprint board's own truth pipeline (POST /sprints → /start → devtasks). */
async function api(page: Page, path: string, method: string, body?: object) {
  return page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }, { path, method, body })
}

test('sprint strip: start-dot + growing clip with progress → finish freezes it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s35 sprint ${Date.now()}` })) as { json: { id: string } }).json.id
  // define → start a sprint
  const created = (await api(page, `/api/projects/${pid}/sprints`, 'POST', { name: 'Auth module' })) as { json: { id: string } }
  await api(page, `/api/sprints/${created.json.id}/start`, 'POST')
  // two tasks join the sprint; one gets DONE
  const t1 = (await api(page, `/api/projects/${pid}/devtasks`, 'POST', { title: 'Design schema', status: 'in_progress', sprint_id: created.json.id })) as { json: { id: string } }
  const t2 = (await api(page, `/api/projects/${pid}/devtasks`, 'POST', { title: 'Write migration', status: 'in_progress', sprint_id: created.json.id })) as { json: { id: string } }
  await api(page, `/api/devtasks/${t1.json.id}`, 'PATCH', { status: 'done' })
  await api(page, `/api/devtasks/${t2.json.id}`, 'PATCH', { status: 'done' })

  await page.goto(`/sprint.html?project=${pid}`)
  await expect(page.locator('.sp-sprint')).toHaveCount(1)
  // the strip anatomy: chip with stats + start dot + open clip (fill + ticks + live edge)
  const chip = page.locator('.sp-sprint-chip')
  await expect(chip).toContainText('Auth module')
  await expect(chip).toContainText('✓ 2/2')
  await expect(page.locator('.sp-startdot')).toHaveCount(1)
  const clip = page.locator('.sp-clip')
  await expect(clip).toHaveClass(/is-open-clip/)
  // the sprint just started → the strip is a STUB at the start day (the "a dot
  // appears for today" moment); the progress fill renders inside it (2/2 done)
  const clipBox0 = await clip.boundingBox()
  const fillBox = await clip.locator('.sp-clip-fill').boundingBox()
  expect(clipBox0).not.toBeNull()
  expect(clipBox0!.width).toBeLessThan(60) // still the opening stub, not a long strip
  expect(fillBox!.width).toBeGreaterThan(2)
  await expect(clip.locator('.sp-clip-tick')).not.toHaveCount(0) // a done-day tick exists
  // the popover carries the story + the plan link
  await chip.click()
  await expect(page.locator('.sp-sprint-pop .sp-pop-stats')).toContainText(/done/)
  await expect(page.locator('.sp-sprint-pop .sp-pop-plan')).toHaveAttribute('href', new RegExp(`project\\.html\\?id=${pid}&sprint=${created.json.id}`))
  await page.keyboard.press('Escape')

  // FINISH → the strip freezes: end-dot appears, the chip reads total days
  await api(page, `/api/sprints/${created.json.id}/finish`, 'POST')
  await page.reload()
  await expect(page.locator('.sp-sprint')).toHaveCount(1)
  await expect(page.locator('.sp-enddot')).toHaveCount(1)
  await expect(page.locator('.sp-clip')).not.toHaveClass(/is-open-clip/)
  await expect(page.locator('.sp-sprint-chip')).toContainText(/day|روز|1 days|2 days/i)
  // the axis extends BACK over the sprint's own start (the strip is fully visible)
  const clipBox = await page.locator('.sp-clip').boundingBox()
  const scroll = await page.locator('#sp-scroll').evaluate((el) => ({ left: el.scrollLeft, width: el.clientWidth, scrollW: el.scrollWidth }))
  expect(clipBox).not.toBeNull()
  expect(clipBox!.width).toBeGreaterThan(4)
  expect(scroll.scrollW).toBeGreaterThanOrEqual(scroll.width)

  expect(errors).toEqual([])
})

test('archive: park an idea → off the lists, on the Archive shelf → restore', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s35 idea ${Date.now()}`, status: 'spark' })) as { json: { id: string } }).json.id

  // archive it (the API the project page's button calls)
  const arch = (await api(page, `/api/projects/${pid}/archive`, 'POST')) as { status: number }
  expect(arch.status).toBe(200)

  // the projects page does NOT list it; the Archive page does, with Restore
  await page.goto('/projects.html')
  await page.waitForLoadState('load')
  await expect(page.locator('main')).not.toContainText('e2e s35 idea', { ignoreCase: true })
  await page.goto('/archive.html')
  const row = page.locator(`.arc-row[data-project-id="${pid}"]`)
  await expect(row).toHaveCount(1)
  await expect(row.locator('.badge')).toHaveCount(1) // the stage badge rides the row
  // restore from the shelf → the row disappears
  await row.locator('[hx-post]').click()
  await expect(page.locator(`.arc-row[data-project-id="${pid}"]`)).toHaveCount(0)
  // back on the ideas shelf
  await page.goto('/sparks.html')
  await page.waitForLoadState('load')
  const ideasHtml = await page.locator('main').innerHTML()
  expect(ideasHtml).not.toContain('sf-bar') // folder shelf loaded
  expect(errors).toEqual([])
})

test('screenshot problem cards: note edit, resolve toggle, delete', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s35 shots ${Date.now()}` })) as { json: { id: string } }).json.id

  // seed a shot row directly (no real storage creds in e2e — the card is the story)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const shotId = crypto.randomUUID()
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(shotId, pid, `e2e/${shotId}.png`, 'image/png', 'Buttons overlap on the dashboard at 390px', new Date().toISOString())
  db.close()

  await page.goto(`/project.html?id=${pid}`)
  await page.locator('[data-detail-tab="media"]').click()
  const card = page.locator(`.shot-card[data-shot="${shotId}"]`)
  await expect(card).toHaveCount(1)
  // the OPEN state + the seeded note
  await expect(card.locator('[data-shot-state]')).not.toContainText('fixed')
  await expect(card.locator('.shot-note')).toContainText('Buttons overlap')

  // edit the note inline
  await card.locator('[data-shot-note]').click()
  // S46: the note editor is now a MODAL (was the inline .shot-note-form). The modal
  // reuses makeDialog → dialog.pd-pin-modal, distinguished by its aria-labelledby.
  const noteDlg = page.locator('dialog:has(#pd-shotnote-title)')
  await expect(noteDlg).toBeVisible()
  await noteDlg.locator('.pd-shot-note-ta').fill('Fixed zone: the toolbar wraps instead of overlapping')
  await noteDlg.locator('[data-shot-note-save]').click()
  await expect(noteDlg).not.toBeVisible()
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] .shot-note`)).toContainText('toolbar wraps')

  // resolve it → the card flips
  await page.locator(`.shot-card[data-shot="${shotId}"] [data-shot-toggle]`).click()
  await expect(page.locator(`.shot-card[data-shot="${shotId}"]`)).toHaveClass(/is-fixed/)
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] [data-shot-state]`)).toContainText('fixed')

  // delete it (confirm auto-accepted)
  page.once('dialog', (d) => d.accept())
  await page.locator(`.shot-card[data-shot="${shotId}"] [data-shot-del]`).click()
  await expect(page.locator(`.shot-card[data-shot="${shotId}"]`)).toHaveCount(0)

  expect(errors).toEqual([])
})

// S44 (owner: "there must be some space and offset to todays timeline on sprints so
// you can see the actual point"): a sprint started today used to render the today
// line FLUSH at the axis's leading edge — clipped, indistinguishable from the border.
// The home axis now LEADS with ~10% pad days (part of the px fit — zero horizontal
// scroll preserved) and the line carries a small «Today» flag chip.
test('sprint timeline: the today line has breathing room + the flag (S44)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s44 today-pad ${Date.now()}` })) as { json: { id: string } }).json.id
  const created = (await api(page, `/api/projects/${pid}/sprints`, 'POST', { name: 'Today sprint' })) as { json: { id: string } }
  await api(page, `/api/sprints/${created.json.id}/start`, 'POST')

  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('.sp-today-line', { timeout: 10_000 })
  await page.waitForTimeout(600)

  // The flag chip rides the line and reads "Today" (EN e2e user).
  const flag = page.locator('.sp-today-flag')
  await expect(flag).toHaveCount(1)
  await expect(flag).toBeVisible()
  await expect(flag).toContainText(/today/i)

  // Breathing room: the line sits clear of BOTH edges of the scroll port (the axis
  // leads with pad days before today), and the today CELL is not the first cell.
  const geom = await page.evaluate(() => {
    const line = document.querySelector('.sp-today-line') as HTMLElement
    const sc = document.getElementById('sp-scroll') as HTMLElement
    const lr = line.getBoundingClientRect()
    const sr = sc.getBoundingClientRect()
    const cells = Array.from(document.querySelectorAll('.sp-cell'))
    return {
      fromStart: Math.round(lr.left - sr.left),
      fromEnd: Math.round(sr.right - lr.right),
      todayCellIdx: cells.findIndex((c) => c.classList.contains('is-today')),
      docHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })
  expect(geom.fromStart).toBeGreaterThan(15)
  expect(geom.fromEnd).toBeGreaterThan(15)
  expect(geom.todayCellIdx).toBeGreaterThanOrEqual(2) // pad days lead the axis
  // Zero-scroll property preserved: the axis still fits the port when data does.
  expect(geom.docHScroll).toBe(false)

  expect(errors).toEqual([])
})
