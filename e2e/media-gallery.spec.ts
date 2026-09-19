// e2e/media-gallery.spec.ts — S39 (user request 2026-09-13):
//   1. NOTE CARDS: the note area on a screenshot card is CLICK-TO-EDIT (the owner
//      read the tiny pencil alone as "you can't add a note").
//   2. PINNING: a shot sticks to a progress-box item — the pin button opens a
//      grouped task picker, the card grows the pin line (box + task title = note +
//      picture proof + categorization), the task card + Problems row grow a 📌 badge
//      that opens the pinned-pictures dialog, and unpin detaches (never deletes).
//   3. THE GALLERY: /gallery.html lists every picture with project + pin chips +
//      the space meter; filters work; delete removes it (the only removal path).
// The shot row is seeded directly (the e2e server has no real storage creds — the
// card interactions are the story, the image bytes 500 as in sprint-timeline.spec).
// Run: npx playwright test e2e/media-gallery.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s39@test.local'
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
     VALUES ('${id}', 'e2e-s39', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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
  // the seeded shot row has no real bytes behind it — the media read 500s on the
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

test('note card + pin flow: click-to-edit, stick to the Problems box, badge, unpin', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s39 pin ${Date.now()}` })) as { json: { id: string } }).json.id
  const task = (await api(page, `/api/projects/${pid}/devtasks`, 'POST', { title: 'Dashboard cards overlap at 390px', status: 'bug' })) as { json: { id: string } }
  const tid = task.json.id
  // seed the shot row directly (no real storage in e2e)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const shotId = crypto.randomUUID()
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, 70, ?)')
    .run(shotId, pid, `e2e/${shotId}.png`, 'image/png', '', new Date().toISOString())
  db.close()

  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board')
  // open the Screenshots tab — the card is there
  await page.click('[data-detail-tab="media"]')
  const card = page.locator(`.shot-card[data-shot="${shotId}"]`)
  await expect(card).toHaveCount(1)

  // 1. THE NOTE: clicking the note AREA (not the pencil) opens the form — the S39 fix
  await card.locator('[data-shot-note-edit]').click()
  // S46: the note editor is now a MODAL (was the inline .shot-note-form). The modal
  // reuses makeDialog → dialog.pd-pin-modal, distinguished by its aria-labelledby.
  const noteDlg = page.locator('dialog:has(#pd-shotnote-title)')
  await expect(noteDlg).toBeVisible()
  await noteDlg.locator('.pd-shot-note-ta').fill('Cards overlap on the small board — the meta line wraps under the badge')
  await noteDlg.locator('[data-shot-note-save]').click()
  await expect(noteDlg).not.toBeVisible()
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] .shot-note`)).toContainText('Cards overlap')

  // 2. THE PIN: the pin button opens the picker, grouped by box, bug task listed
  await page.locator(`.shot-card[data-shot="${shotId}"] [data-shot-pin]`).click()
  const dlg = page.locator('.pd-pin-modal')
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('.pd-pin-group .pd-pin-grouplabel').filter({ hasText: 'Problems' })).toHaveCount(1)
  const bugRow = dlg.locator(`[data-pin-task="${tid}"]`)
  await expect(bugRow).toContainText('Dashboard cards overlap at 390px')
  await bugRow.click()
  await expect(dlg).not.toBeVisible()

  // the card now carries the pin line: box + task title (the categorization)
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] .shot-pin`)).toBeVisible()
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] .shot-pin`)).toContainText('Problems')
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] .shot-pin`)).toContainText('Dashboard cards overlap')

  // the board's Problems box + the Problems tab row both carry the 📌 1 badge
  await expect(page.locator(`[data-pd-shots="${tid}"]`)).toHaveCount(2)
  await page.click('[data-detail-tab="problems"]')
  await expect(page.locator(`#problems [data-pd-shots="${tid}"]`)).toContainText('1')

  // the badge opens the pinned-pictures dialog (the picture + its note, one click away)
  await page.locator(`#problems [data-pd-shots="${tid}"]`).click()
  const shotsDlg = page.locator('.pd-pin-modal')
  await expect(shotsDlg).toBeVisible()
  await expect(shotsDlg.locator('.pd-tshots-grid .shot-card')).toHaveCount(1)
  await expect(shotsDlg.locator('.pd-tshots-grid .shot-note')).toContainText('Cards overlap')
  await page.locator('.pd-pin-modal [data-pin-close]').click()
  await expect(shotsDlg).not.toBeVisible()

  // 3. UNPIN from the card's ✕ — the picture STAYS, the pin line goes
  await page.click('[data-detail-tab="media"]')
  await page.locator(`.shot-card[data-shot="${shotId}"] [data-shot-unpin]`).click()
  await page.waitForTimeout(400) // PATCH + full-body re-render
  await expect(page.locator(`.shot-card[data-shot="${shotId}"]`)).toHaveCount(1) // still there
  await expect(page.locator(`.shot-card[data-shot="${shotId}"] .shot-pin`)).toHaveCount(0)
  await expect(page.locator(`[data-pd-shots="${tid}"]`)).toHaveCount(0)

  expect(errors).toEqual([])
})

test('the gallery: every picture, project + pin chips, filters, space meter, delete', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s39 gallery ${Date.now()}` })) as { json: { id: string } }).json.id
  const pid2 = ((await api(page, '/api/projects', 'POST', { title: `e2e s39 second ${Date.now()}` })) as { json: { id: string } }).json.id
  const task = (await api(page, `/api/projects/${pid}/devtasks`, 'POST', { title: 'Checkout misaligned', status: 'bug' })) as { json: { id: string } }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  // the e2e DB is shared and this user's earlier test (same spec) left its shot
  // behind — the gallery test asserts ABSOLUTE counts, so start from a clean slate.
  db.prepare("DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = (SELECT id FROM users WHERE email = ?))").run(TEST_EMAIL)
  const s1 = crypto.randomUUID()
  const s2 = crypto.randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 120, ?)')
    .run(s1, pid, `e2e/${s1}.png`, 'image/png', 'The broken checkout', task.json.id, now)
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 1, NULL, 80, ?)')
    .run(s2, pid2, `e2e/${s2}.png`, 'image/png', 'Already fixed one', now)
  db.close()

  await page.goto('/gallery.html')
  await page.waitForSelector('.gal-card')
  // both pictures, with the space meter
  await expect(page.locator('.gal-card')).toHaveCount(2)
  await expect(page.locator('#gallery-stats')).toContainText('2')
  // the pinned one carries the pin chip (box + task), the other one doesn't
  const pinned = page.locator(`.gal-card[data-shot="${s1}"]`)
  await expect(pinned.locator('.gal-pin')).toContainText('Problems')
  await expect(pinned.locator('.gal-pin')).toContainText('Checkout misaligned')
  await expect(page.locator(`.gal-card[data-shot="${s2}"] .gal-pin`)).toHaveCount(0)
  // the project chip deep-links to the project
  await expect(pinned.locator('.gal-project')).toHaveAttribute('href', `/project.html?id=${pid}`)

  // filters: pinned → only the pinned one; fixed → only the fixed one
  await page.click('[data-gs="pinned"]')
  await expect(page.locator('.gal-card')).toHaveCount(1)
  await expect(page.locator(`.gal-card[data-shot="${s1}"]`)).toHaveCount(1)
  await page.click('[data-gs="fixed"]')
  await expect(page.locator('.gal-card')).toHaveCount(1)
  await expect(page.locator(`.gal-card[data-shot="${s2}"]`)).toHaveCount(1)
  // project filter (back to all, then filter by project 2)
  await page.click('[data-gs="all"]')
  await page.selectOption('#gallery-project', pid2)
  await expect(page.locator('.gal-card')).toHaveCount(1)
  await expect(page.locator(`.gal-card[data-shot="${s2}"]`)).toHaveCount(1)
  await page.selectOption('#gallery-project', '')

  // DELETE: the pinned picture goes for good; the meter follows (2 → 1)
  page.once('dialog', (d) => d.accept())
  await page.locator(`.gal-card[data-shot="${s1}"] [data-gal-del]`).click()
  await page.waitForTimeout(500)
  await expect(page.locator(`.gal-card[data-shot="${s1}"]`)).toHaveCount(0)
  await expect(page.locator('.gal-card')).toHaveCount(1)
  await expect(page.locator('#gallery-stats')).toContainText('1')

  expect(errors).toEqual([])
})

test('the gallery: URL params deep-link the filters (S59b — never lose your place)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // seed one project with an OPEN (pinned) shot + a second project with a FIXED shot
  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s59b gal ${Date.now()}` })) as { json: { id: string } }).json.id
  const pid2 = ((await api(page, '/api/projects', 'POST', { title: `e2e s59b gal2 ${Date.now()}` })) as { json: { id: string } }).json.id
  const task = (await api(page, `/api/projects/${pid}/devtasks`, 'POST', { title: 'URL-param pin target', status: 'bug' })) as { json: { id: string } }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  db.prepare("DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = (SELECT id FROM users WHERE email = ?))").run(TEST_EMAIL)
  const s1 = crypto.randomUUID()
  const s2 = crypto.randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 120, ?)')
    .run(s1, pid, `e2e/${s1}.png`, 'image/png', 'Open problem shot', task.json.id, now)
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, bytes, created_at) VALUES (?, ?, ?, ?, ?, 1, 80, ?)')
    .run(s2, pid2, `e2e/${s2}.png`, 'image/png', 'Fixed shot', now)
  db.close()

  // ?gs=fixed deep-links the state filter: only the fixed shot, chip pressed, URL kept
  await page.goto(`/gallery.html?gs=fixed`)
  await page.waitForSelector('.gal-card')
  await expect(page.locator('.gal-card')).toHaveCount(1)
  await expect(page.locator(`.gal-card[data-shot="${s2}"]`)).toHaveCount(1)
  await expect(page.locator('[data-gs="fixed"]')).toHaveAttribute('aria-pressed', 'true')
  expect(page.url()).toContain('gs=fixed')

  // ?project=<id> deep-links the project filter: select carries it, URL kept
  await page.goto(`/gallery.html?project=${pid2}`)
  await page.waitForSelector('.gal-card')
  await expect(page.locator('.gal-card')).toHaveCount(1)
  await expect(page.locator(`.gal-card[data-shot="${s2}"]`)).toHaveCount(1)
  await expect(page.locator('#gallery-project')).toHaveValue(pid2)
  expect(page.url()).toContain(`project=${pid2}`)

  // a STALE project id (no pictures) falls back to All AND cleans the param —
  // an empty grid with a silent filter would read as data loss
  await page.goto(`/gallery.html?project=00000000-dead-beef-0000-000000000000`)
  await page.waitForSelector('.gal-card')
  await expect(page.locator('.gal-card')).toHaveCount(2)
  await expect(page.locator('#gallery-project')).toHaveValue('')
  expect(page.url()).not.toContain('project=')

  // filter CHANGES rewrite the URL in place (replaceState): the history stack does
  // not grow per filter click — back still leaves the page in one hop
  await page.click('[data-gs="pinned"]')
  await expect(page.locator('.gal-card')).toHaveCount(1)
  expect(page.url()).toContain('gs=pinned')
  const histLen = await page.evaluate(() => history.length)
  await page.click('[data-gs="all"]')
  await page.click('[data-gs="open"]')
  await page.click('[data-gs="all"]')
  expect(await page.evaluate(() => history.length)).toBe(histLen)
  expect(page.url()).not.toContain('gs=')

  expect(errors).toEqual([])
})

test('the gallery lightbox: prev/next browse the filtered set, counter + caption, Esc restores focus (S59b)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // three shots in one project — the browse set
  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s59b lb ${Date.now()}` })) as { json: { id: string } }).json.id
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  db.prepare("DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = (SELECT id FROM users WHERE email = ?))").run(TEST_EMAIL)
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const now = new Date().toISOString()
  for (let i = 0; i < ids.length; i++) {
    db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, 100, ?)')
      .run(ids[i], pid, `e2e/${ids[i]}.png`, 'image/png', `Browse shot ${i + 1}`, now)
  }
  db.close()

  await page.goto('/gallery.html')
  await page.waitForSelector('.gal-card')
  await expect(page.locator('.gal-card')).toHaveCount(3)

  // open the FIRST card's zoom → dialog with counter + caption + state chip + focused close
  await page.locator('.gal-card').first().locator('[data-gal-zoom]').click()
  const lb = page.locator('.shot-lightbox[data-lb]')
  await expect(lb).toBeVisible()
  await expect(lb.locator('.lb-count')).toHaveText('1 / 3')
  await expect(lb.locator('.lb-cap')).toHaveText('Browse shot 1')
  await expect(lb.locator('.lb-state')).toHaveText('Open problems') // S60 chip: shot 1 is unresolved
  await expect(lb.locator('.lb-close')).toBeFocused()

  // next button + ArrowRight walk forward; wrap-around lands on 1 again
  await lb.locator('.lb-next').click()
  await expect(lb.locator('.lb-count')).toHaveText('2 / 3')
  await lb.locator('.lb-next').click()
  await expect(lb.locator('.lb-count')).toHaveText('3 / 3')
  await page.keyboard.press('ArrowRight')
  await expect(lb.locator('.lb-count')).toHaveText('1 / 3')
  // ArrowLeft walks back
  await page.keyboard.press('ArrowLeft')
  await expect(lb.locator('.lb-count')).toHaveText('3 / 3')
  await expect(lb.locator('.lb-cap')).toHaveText('Browse shot 3')

  // Esc closes AND focus returns to the trigger (the zoom button of the opening card)
  await page.keyboard.press('Escape')
  await expect(lb).toHaveCount(0)
  await expect(page.locator('.gal-card').first().locator('[data-gal-zoom]')).toBeFocused()

  // after close: no stray nav buttons anywhere (the S60 project-page lightbox also
  // uses [data-lb] now — its browse behavior is pinned in the project shots test)
  await expect(page.locator('.lb-nav')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('project shots lightbox: prev/next browse the grid siblings, counter + caption, Esc restores focus (S60)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // three shots in one project — the browse set for the main grid
  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s60 lb ${Date.now()}` })) as { json: { id: string } }).json.id
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const now = new Date().toISOString()
  for (let i = 0; i < ids.length; i++) {
    db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, 90, ?)')
      .run(ids[i], pid, `e2e/${ids[i]}.png`, 'image/png', `Project browse ${i + 1}`, now)
  }
  db.close()

  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board')
  await page.click('[data-detail-tab="media"]')
  await expect(page.locator('#shots .shot-card')).toHaveCount(3)

  // zoom the FIRST card → browser lightbox with counter + caption + state chip + focused close
  await page.locator('#shots .shot-card').first().locator('[data-shot-zoom]').click()
  const lb = page.locator('.shot-lightbox[data-lb]')
  await expect(lb).toBeVisible()
  await expect(lb.locator('.lb-count')).toHaveText('1 / 3')
  await expect(lb.locator('.lb-cap')).toHaveText('Project browse 1')
  await expect(lb.locator('.lb-state')).toHaveText('open problem') // S60 chip rides the browse
  await expect(lb.locator('.lb-close')).toBeFocused()

  // next + ArrowRight walk forward with wrap-around
  await lb.locator('.lb-next').click()
  await expect(lb.locator('.lb-count')).toHaveText('2 / 3')
  await lb.locator('.lb-next').click()
  await lb.locator('.lb-next').click() // 3 → wraps to 1
  await expect(lb.locator('.lb-count')).toHaveText('1 / 3')
  await page.keyboard.press('ArrowRight')
  await expect(lb.locator('.lb-count')).toHaveText('2 / 3')
  await page.keyboard.press('ArrowLeft')
  await expect(lb.locator('.lb-count')).toHaveText('1 / 3')

  // Esc closes AND focus returns to the opening card's zoom button
  await page.keyboard.press('Escape')
  await expect(lb).toHaveCount(0)
  await expect(page.locator('#shots .shot-card').first().locator('[data-shot-zoom]')).toBeFocused()

  expect(errors).toEqual([])
})

test('the gallery manager: click-to-edit note modal (wand rides it) + Select mode bulk-deletes with one confirm (S79)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // four shots in one project: two carry notes to edit, the space story is real
  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s79 manager ${Date.now()}` })) as { json: { id: string } }).json.id
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  db.prepare("DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = (SELECT id FROM users WHERE email = ?))").run(TEST_EMAIL)
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const now = new Date().toISOString()
  const caps = ['Manager note A', '', 'Manager shot C', 'Manager shot D']
  for (let i = 0; i < ids.length; i++) {
    db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, 200, ?)')
      .run(ids[i], pid, `e2e/${ids[i]}.png`, 'image/png', caps[i], now)
  }
  db.close()

  await page.goto('/gallery.html')
  await page.waitForSelector('.gal-card')
  await expect(page.locator('.gal-card')).toHaveCount(4)

  // ---- (a) THE NOTE EDITOR: the caption itself is click-to-edit ----------------
  // the empty caption carries the affordance too ("No note" invites the first one)
  await expect(page.locator(`.gal-card[data-shot="${ids[1]}"] .shot-note`)).toContainText('No note')
  await page.locator(`.gal-card[data-shot="${ids[0]}"] .shot-note`).click()
  const noteDlg = page.locator('dialog.gal-note-modal')
  await expect(noteDlg).toBeVisible()
  await expect(noteDlg.locator('h3')).toContainText('Note')
  // the textarea prefills the current caption and rides the wand (data-magic)
  const ta = noteDlg.locator('.gal-note-ta')
  await expect(ta).toHaveValue('Manager note A')
  await expect(ta).toHaveAttribute('data-magic', '')
  // focusing the note reveals the wand INSIDE the dialog (top-layer aware)
  await ta.focus()
  await expect(noteDlg.locator('.magic-wand')).toBeVisible()
  await expect(noteDlg.locator('.gal-note-hint')).toContainText('wand')
  // save the edit → the card updates in place (no grid re-fetch flash)
  await ta.fill('Manager note A — edited in the gallery')
  await noteDlg.locator('[data-gal-note-save]').click()
  await expect(noteDlg).toHaveCount(0)
  await expect(page.locator(`.gal-card[data-shot="${ids[0]}"] .shot-note`)).toContainText('edited in the gallery')
  await expect(page.locator(`.gal-card[data-shot="${ids[0]}"] .shot-note`)).toHaveClass(/has-note/)
  // the edit is real: the API carries the new caption
  const listed = (await api(page, '/api/media', 'GET')) as { json: { screenshots: { id: string; caption: string }[] } }
  expect(listed.json.screenshots.find((p) => p.id === ids[0])?.caption).toBe('Manager note A — edited in the gallery')

  // ---- (b) SELECT MODE: bulk space management ----------------------------------
  // the toggle enters select mode: checks appear, the button flips to "Done"
  await page.click('#gallery-select-btn')
  await expect(page.locator('#gallery-select-btn')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#gallery-select-btn')).toContainText('Done')
  await expect(page.locator('#gallery-grid')).toHaveAttribute('data-selecting', '')
  // no picks yet → the bar invites, Delete disabled (a 0-delete is a misclick trap)
  await expect(page.locator('.gal-selbar')).toBeVisible()
  await expect(page.locator('.gal-selbar-count')).toContainText('Tap pictures')
  await expect(page.locator('.gal-selbar-del')).toBeDisabled()

  // pick via the whole TILE (the big target) and via the CHECK chip — both count
  await page.locator(`.gal-card[data-shot="${ids[2]}"] .shot-img-btn`).click()
  await page.locator(`.gal-card[data-shot="${ids[3]}"] .gal-check`).click()
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(2)
  await expect(page.locator('.gal-selbar-count')).toContainText('2 selected')
  await expect(page.locator(`.gal-card[data-shot="${ids[2]}"] .gal-check`)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.gal-selbar-del')).toBeEnabled()

  // a filter change exits select mode — the selection would be a stale set
  await page.click('[data-gs="fixed"]')
  await expect(page.locator('#gallery-grid')).not.toHaveAttribute('data-selecting', '')
  await expect(page.locator('.gal-selbar')).toHaveCount(0)
  await page.click('[data-gs="all"]')

  // re-enter, re-pick the SAME two, delete with ONE confirm (the whole point:
  // a cleanup pass of N pictures is 1 confirm, not N)
  await page.click('#gallery-select-btn')
  await page.locator(`.gal-card[data-shot="${ids[2]}"] .shot-img-btn`).click()
  await page.locator(`.gal-card[data-shot="${ids[3]}"] .gal-check`).click()
  await expect(page.locator('.gal-selbar-count')).toContainText('2 selected')
  page.once('dialog', (d) => d.accept())
  await page.locator('.gal-selbar-del').click()
  // the bar is gone before the first DELETE lands (a stale count reads as a lie),
  // mode exits, the grid + space meter land on the post-cleanup truth
  await expect(page.locator('.gal-selbar')).toHaveCount(0)
  await expect(page.locator('.gal-card')).toHaveCount(2)
  await expect(page.locator(`.gal-card[data-shot="${ids[2]}"]`)).toHaveCount(0)
  await expect(page.locator(`.gal-card[data-shot="${ids[3]}"]`)).toHaveCount(0)
  await expect(page.locator('#gallery-stats')).toContainText('2')

  // ---- Esc exits select mode (keyboard parity) ---------------------------------
  await page.click('#gallery-select-btn')
  await expect(page.locator('#gallery-grid')).toHaveAttribute('data-selecting', '')
  await page.keyboard.press('Escape')
  await expect(page.locator('#gallery-grid')).not.toHaveAttribute('data-selecting', '')

  expect(errors).toEqual([])
})

test('the gallery power tools: sort order + Select all + Shift-click ranges (S80)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // five shots with DISTINCT sizes + dates — the sort story needs real variance
  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s80 tools ${Date.now()}` })) as { json: { id: string } }).json.id
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  db.prepare("DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = (SELECT id FROM users WHERE email = ?))").run(TEST_EMAIL)
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  const bytes = [400_000, 50_000, 900_000, 150_000, 700_000] // alpha bravo charlie delta echo
  const dates = ['2026-09-01T10:00:00Z', '2026-09-05T10:00:00Z', '2026-09-10T10:00:00Z', '2026-09-15T10:00:00Z', '2026-09-18T10:00:00Z']
  for (let i = 0; i < ids.length; i++) {
    db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .run(ids[i], pid, `e2e/${ids[i]}.png`, 'image/png', `S80 ${i}`, bytes[i], dates[i])
  }
  db.close()

  await page.goto('/gallery.html')
  await page.waitForSelector('.gal-card')
  await expect(page.locator('.gal-card')).toHaveCount(5)

  // ---- default order = API order (newest first: echo…alpha) ---------------------
  const capOf = (i: number) => page.locator('.gal-card').nth(i).locator('.shot-note')
  await expect(capOf(0)).toContainText('S80 4') // echo — newest
  await expect(capOf(4)).toContainText('S80 0') // alpha — oldest

  // ---- SORT: largest first — the space story gets an order ---------------------
  await page.selectOption('#gallery-sort', 'big')
  await expect(page.locator('#gallery-grid')).toHaveAttribute('data-sort-size', 'big')
  await expect(page.locator('#gallery-sort')).toHaveClass(/is-on/)
  await expect(page.locator('.gal-card').first().locator('.shot-note')).toContainText('S80 2') // charlie 900KB
  await expect(page.locator('.gal-card').last().locator('.shot-note')).toContainText('S80 1') // bravo 50KB
  await expect(page.locator('.gal-card').first().locator('.shot-size')).toContainText('879 KB')
  // the URL carries the deep-linkable param
  await expect(page).toHaveURL(/sort=big/)
  // the emphasis hook promoted the size to the leading fact (weight 600, text color)
  const sizeWeight = await page.locator('.gal-card').first().locator('.shot-size').evaluate((el) => getComputedStyle(el).fontWeight)
  expect(sizeWeight).toBe('600')

  // a sort change re-renders WITHOUT rebuilding the API call set (client-side order)
  await page.selectOption('#gallery-sort', 'old')
  await expect(page.locator('.gal-card').first().locator('.shot-note')).toContainText('S80 0') // alpha first now
  await expect(page).toHaveURL(/sort=old/)
  await expect(page.locator('#gallery-grid')).toHaveAttribute('data-sort-size', '')

  // ---- SELECT ALL: the master toggle mirrors the visible set ------------------
  await page.click('#gallery-select-btn')
  await expect(page.locator('.gal-selbar')).toBeVisible()
  await expect(page.locator('.gal-selbar-all')).toContainText('Select all (5)')
  await page.click('.gal-selbar-all')
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(5)
  await expect(page.locator('.gal-selbar-count')).toContainText('5 selected')
  await expect(page.locator('.gal-selbar-all')).toContainText('Deselect all')
  await expect(page.locator('.gal-selbar')).toHaveClass(/is-all/)
  // the master toggle flips back — clearing everything
  await page.click('.gal-selbar-all')
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(0)
  await expect(page.locator('.gal-selbar-all')).toContainText('Select all (5)')

  // ---- SHIFT+CLICK ranges: file-manager semantics (ranges ADD) ----------------
  // pick the anchor (index 0 = alpha in old-first order), shift-click index 2 → 3 picks
  await page.locator('.gal-card').nth(0).locator('.shot-img-btn').click()
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(1)
  await page.locator('.gal-card').nth(2).locator('.shot-img-btn').click({ modifiers: ['Shift'] })
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(3)
  await expect(page.locator('.gal-selbar-count')).toContainText('3 selected')
  // a SECOND range extends from the new anchor (2 → 4): picks 3,4 ADD, 0..2 stay
  await page.locator('.gal-card').nth(4).locator('.shot-img-btn').click({ modifiers: ['Shift'] })
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(5)

  // ---- the master toggle mirrors against the FULL set → Deselect all ----------
  await expect(page.locator('.gal-selbar-all')).toContainText('Deselect all')
  await page.click('.gal-selbar-all')
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(0)

  // ---- sort while selecting: order changes, picks SURVIVE (no stale exit) -----
  await page.selectOption('#gallery-sort', 'big')
  await page.locator('.gal-card').nth(0).locator('.shot-img-btn').click()
  await page.selectOption('#gallery-sort', 'new')
  await expect(page.locator('#gallery-grid')).toHaveAttribute('data-selecting', '')
  await expect(page.locator('.gal-card.is-sel')).toHaveCount(1)
  await expect(page.locator('.gal-selbar-count')).toContainText('1 selected')

  // ---- deep link: ?sort=big lands sorted without touching the control ---------
  await page.goto('/gallery.html?sort=big')
  await page.waitForSelector('.gal-card')
  await expect(page.locator('#gallery-sort')).toHaveValue('big')
  await expect(page.locator('.gal-card').first().locator('.shot-note')).toContainText('S80 2')
  // a stray value degrades to the default (no crash, canonical order)
  await page.goto('/gallery.html?sort=garbage')
  await page.waitForSelector('.gal-card')
  await expect(page.locator('#gallery-sort')).toHaveValue('new')

  expect(errors).toEqual([])
})
