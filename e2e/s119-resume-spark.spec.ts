// e2e/s119-resume-spark.spec.ts — S119: the resume strip covers IDEAS.
//
// WHY THIS FILE EXISTS: "Continue where you left off" (S85) recorded projects and
// vault notes — a spark the owner just EDITED on the Ideas shelf fell out of the
// place-keeping story, even though editing an idea is exactly the S105 "actively
// interacted" mutation the strip is FOR. S119 records the spark at edit-save (the
// S105 rule) and the strip speaks a third kind: Idea (the brand spark bulb, the
// yellow family), linking back to /sparks.html. A PROMOTED spark (the edit dialog's
// stage select moved it out of «ایده») records as a PROJECT with its new stage —
// it left the shelf for the pipeline, so the entry deep-links to the project page.
// These specs pin:
//   1. edit-save records the spark → the dashboard strip shows the Idea entry →
//      the hero link lands on /sparks.html
//   2. a PROMOTED edit records as a project with the stage badge → the link lands
//      on the project page
//   3. keyboard parity for the S118 video lightbox: a FOCUSED tile + Enter opens
//      the big view (project grid AND gallery)
// Run: npx playwright test e2e/s119-resume-spark.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s119@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const USER_ID = randomBytes(16).toString('hex')
const SPARK_ID = 'e2e-s119-spark'
const PROMOTE_ID = 'e2e-s119-promote'
const VIDEO_SHOT = 'e2e-s119-shot-video'
const PROJECT_ID = 'e2e-s119-media-project'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s119', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // Two sparks on the shelf: one stays an idea, one the test promotes.
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${SPARK_ID}', '${USER_ID}', 'S119 edited spark', 'fresh idea', 'personal', 'spark', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROMOTE_ID}', '${USER_ID}', 'S119 promoted spark', 'about to grow up', 'personal', 'spark', 1, '${now}', '${now}')`,
  )
  // One video shot row (stored object absent — fine, structure is the pin) on a
  // project page the keyboard-zoom spec can open.
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJECT_ID}', '${USER_ID}', 'S119 media project', '', 'personal', 'developing', 2, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at)
     VALUES ('${VIDEO_SHOT}', '${PROJECT_ID}', 'shots/${VIDEO_SHOT}.webm', 'video/webm', '', 0, NULL, 4096, 'spec.webm', '${now}')`,
  )
  db.close()
})

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login.html')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

const CONSOLE_NOISE = [/Failed to load resource.*40[14]/]

function watchErrors(page: import('@playwright/test').Page, errors: string[]): void {
  page.on('console', (m) => { if (m.type() === 'error' && !CONSOLE_NOISE.some((re) => re.test(m.text()))) errors.push(m.text()) })
  page.on('pageerror', (err) => { if (!CONSOLE_NOISE.some((re) => re.test(err.message))) errors.push(err.message) })
}

test.use({ viewport: { width: 1280, height: 800 } })

test('an edited spark joins the resume strip and the hero lands on /sparks.html', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/sparks.html')
  // the initial shelf state is the FOLDER GRID — open «All ideas» to reveal the cards
  await page.click('.spark-folder-card[data-sf="all"]')
  // the shelf card's ⋯ kebab → Edit spark → change the title → Save
  const card = page.locator(`.project-card:has([data-spark-edit="${SPARK_ID}"])`)
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.locator('[data-menu-open]').first().click()
  await page.locator(`[data-spark-edit="${SPARK_ID}"]`).click()
  const dlg = page.locator('#spark-edit-dialog')
  await expect(dlg).toBeVisible()
  await dlg.locator('#se-title').fill('S119 edited spark — reworked')
  await dlg.locator('#se-save').click()
  await expect(dlg).not.toBeVisible()

  // the record rode the save success — verify the store, then the strip
  const stored = await page.evaluate(() => localStorage.getItem('hibana-resume'))
  expect(stored).toContain(SPARK_ID)
  expect(stored).toContain('"k":"spark"')

  await page.goto('/dashboard')
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  const hero = strip.locator('.resume-hero')
  await expect(hero.locator('.resume-hero-title')).toHaveText('S119 edited spark — reworked')
  await expect(hero.locator('.resume-hero-kicker')).toContainText('Idea')
  // the hero link lands on the Ideas page
  await hero.click()
  await page.waitForURL('**/sparks.html', { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('a PROMOTED spark records as a project (stage badge, project-page link)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/sparks.html')
  await page.click('.spark-folder-card[data-sf="all"]')
  const card = page.locator(`.project-card:has([data-spark-edit="${PROMOTE_ID}"])`)
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.locator('[data-menu-open]').first().click()
  await page.locator(`[data-spark-edit="${PROMOTE_ID}"]`).click()
  const dlg = page.locator('#spark-edit-dialog')
  await expect(dlg).toBeVisible()
  await dlg.locator('#se-status').selectOption('planning')
  await dlg.locator('#se-save').click()
  await expect(dlg).not.toBeVisible()

  const stored = await page.evaluate(() => localStorage.getItem('hibana-resume'))
  expect(stored).toContain(PROMOTE_ID)
  expect(stored).toContain('"k":"project"')

  await page.goto('/dashboard')
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  const hero = strip.locator('.resume-hero')
  await expect(hero.locator('.resume-hero-title')).toHaveText('S119 promoted spark')
  // the project kind carries the stage badge (planning) and the project-page link
  await expect(hero.locator('.resume-stage-badge')).toBeVisible()
  await hero.click()
  await page.waitForURL('**/project.html?id=' + PROMOTE_ID, { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('keyboard parity: a focused recording tile + Enter opens the big view (project grid)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto(`/project.html?id=${PROJECT_ID}`)
  await expect(page.locator('[data-detail-tab="media"]')).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-detail-tab="media"]').click()
  const grid = page.locator('#shots')
  const tile = grid.locator('video.shot-video')
  await expect(tile).toBeVisible({ timeout: 15_000 })
  await expect(tile).toHaveAttribute('tabindex', '0')

  // focus the tile and press Enter — the lightbox opens with the player
  await tile.focus()
  await page.keyboard.press('Enter')
  const lb = page.locator('.shot-lightbox[data-lb]')
  await expect(lb).toBeVisible()
  await expect(lb.locator('video.lb-video')).toBeVisible()
  await expect(lb.locator('img')).toBeHidden()

  // Esc closes and focus returns to the tile (keyboard users never land in the void)
  await page.keyboard.press('Escape')
  await expect(page.locator('.shot-lightbox')).toHaveCount(0)
  await expect(tile).toBeFocused()
  expect(errors).toEqual([])
})

test('keyboard parity: Enter opens the gallery lightbox from a focused recording tile', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/gallery.html')
  const tile = page.locator('.gal-card video.shot-video')
  await expect(tile).toBeVisible({ timeout: 15_000 })
  await tile.focus()
  await page.keyboard.press('Enter')
  const lb = page.locator('.shot-lightbox[data-lb]')
  await expect(lb).toBeVisible()
  await expect(lb.locator('video.lb-video')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.shot-lightbox')).toHaveCount(0)
  await expect(tile).toBeFocused()
  expect(errors).toEqual([])
})
