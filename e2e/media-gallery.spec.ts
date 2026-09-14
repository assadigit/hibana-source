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
