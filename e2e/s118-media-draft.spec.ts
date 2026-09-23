// e2e/s118-media-draft.spec.ts — S118: the zoom lightbox speaks video + the
// quick-add draft survives the reload + the untitled-note label lands everywhere.
//
// WHY THIS FILE EXISTS: S115 made webm recordings real <video> TILES, but the zoom
// LIGHTBOX they belong to still spoke only <img> — a recording could never open the
// big view, and the browser walk silently SKIPPED every video (and could land on a
// doc row and paint a broken <img> fed a PDF). S118 teaches both lightboxes the
// player (dblclick a tile = the big view; the walk includes videos, excludes docs;
// the walked-away video pauses) and completes two S117 follow-ups: the quick-add
// draft persistence (the S117 rail pattern, now on the app-wide capture dialog) and
// the untitled-note label (the resume strip showed a bare '—'; the vault tree
// hardcoded English 'Untitled'). These specs pin:
//   1. project lightbox: dblclick a recording tile → video player visible (img
//      hidden); the walk lands on the picture → img visible (video paused+hidden)
//   2. gallery lightbox: the walk set EXCLUDES doc rows (counter reads the
//      media-only length) and includes the video player
//   3. quick-add: typed draft rides a reload (sessionStorage) — Escape = the
//      deliberate discard (a reload after Esc restores NOTHING)
//   4. resume strip: an untitled note renders the localized 'Untitled note' — the
//      legacy '—' placeholder normalizes too
//   5. vault tree (FA): an untitled note in a folder renders «بی‌عنوان», not
//      hardcoded English
// Run: npx playwright test e2e/s118-media-draft.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s118@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const USER_ID = randomBytes(16).toString('hex')
const PROJECT_ID = 'e2e-s118-project'
const VIDEO_SHOT = 'e2e-s118-shot-video'
const IMAGE_SHOT = 'e2e-s118-shot-image'
const DOC_SHOT = 'e2e-s118-shot-pdf'
const FOLDER_ID = 'e2e-s118-folder'
const NOTE_ID = 'e2e-s118-note-untitled'

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
    db.exec(`DELETE FROM note_folders WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  // language_pref 'fa' — the vault-tree pin speaks Persian.
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s118', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'fa', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJECT_ID}', '${USER_ID}', 'S118 lightbox project', '', 'personal', 'developing', 0, '${now}', '${now}')`,
  )
  // Three shot rows whose STORED OBJECTS don't exist — the S116 404 contract keeps
  // every route honest and the tiles render regardless (structure is what we pin).
  // created_at DESC ordering with STAGGERED timestamps: video newest → first in the
  // grid/gallery walk (same-second ties would order by rowid — nondeterministic).
  const tDoc = new Date(Date.parse(now) - 120_000).toISOString()
  const tImg = new Date(Date.parse(now) - 60_000).toISOString()
  db.exec(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at)
     VALUES ('${DOC_SHOT}', '${PROJECT_ID}', 'shots/${DOC_SHOT}.pdf', 'application/pdf', '', 0, NULL, 1024, 'spec.pdf', '${tDoc}')`,
  )
  db.exec(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at)
     VALUES ('${IMAGE_SHOT}', '${PROJECT_ID}', 'shots/${IMAGE_SHOT}.png', 'image/png', '', 0, NULL, 2048, 'spec.png', '${tImg}')`,
  )
  db.exec(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at)
     VALUES ('${VIDEO_SHOT}', '${PROJECT_ID}', 'shots/${VIDEO_SHOT}.webm', 'video/webm', '', 0, NULL, 4096, 'spec.webm', '${now}')`,
  )
  db.exec(
    `INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('${FOLDER_ID}', '${USER_ID}', NULL, 'S118 folder', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, deleted_at, created_at, updated_at)
     VALUES ('${NOTE_ID}', '${USER_ID}', '${FOLDER_ID}', '', 'untitled body', '', 0, NULL, '${now}', '${now}')`,
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

test('project lightbox: a recording opens the big view on dblclick and walks to the picture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto(`/project.html?id=${PROJECT_ID}`)
  // the media panel is a TAB (hidden until clicked) — open it first
  await expect(page.locator('[data-detail-tab="media"]')).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-detail-tab="media"]').click()
  const grid = page.locator('#shots')
  await expect(grid.locator('video.shot-video')).toBeVisible({ timeout: 15_000 })
  await expect(grid.locator('[data-shot-zoom]')).toHaveCount(1)

  // dblclick the recording tile → the lightbox speaks video. The position dodges the
  // native controls' center (Chromium's closed media shadow-DOM swallows events
  // there — real users double-click the SURFACE, and that's the affordance).
  const tileBox = await grid.locator('video.shot-video').boundingBox()
  await grid.locator('video.shot-video').dblclick({ position: { x: Math.round((tileBox?.width ?? 100) * 0.3), y: Math.round((tileBox?.height ?? 100) * 0.3) } })
  const lb = page.locator('.shot-lightbox[data-lb]')
  await expect(lb).toBeVisible()
  await expect(lb.locator('video.lb-video')).toBeVisible()
  await expect(lb.locator('video.lb-video')).not.toHaveAttribute('hidden', /.*/)
  await expect(lb.locator('img')).toBeHidden()
  // the walk set = media rows of the grid (video + image; the doc tile is excluded) —
  // FA digits (the seeded user is FA)
  await expect(lb.locator('.lb-count')).toHaveText('۱ / ۲')

  // walk forward → the picture element takes over (the player hides). NOTE: the seeded
  // user is FA/RTL — forward is ArrowLeft, and the counter reads Persian digits.
  await page.keyboard.press('ArrowLeft')
  await expect(lb.locator('img')).toBeVisible()
  await expect(lb.locator('video.lb-video')).toBeHidden()
  await expect(lb.locator('.lb-count')).toHaveText('۲ / ۲')

  // Esc closes; nothing lingers
  await page.keyboard.press('Escape')
  await expect(page.locator('.shot-lightbox')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('gallery lightbox: the walk includes the video player and excludes docs', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/gallery.html')
  const galVideo = page.locator('.gal-card video.shot-video')
  await expect(galVideo).toBeVisible({ timeout: 15_000 })

  // dblclick the recording tile → the lightbox speaks video (surface, not controls)
  const galBox = await galVideo.boundingBox()
  await galVideo.dblclick({ position: { x: Math.round((galBox?.width ?? 100) * 0.3), y: Math.round((galBox?.height ?? 100) * 0.3) } })
  const lb = page.locator('.shot-lightbox[data-lb]')
  await expect(lb).toBeVisible()
  await expect(lb.locator('video.lb-video')).toBeVisible()
  await expect(lb.locator('img')).toBeHidden()
  // 3 rows exist (video, image, pdf) — the counter pins the DOC-EXCLUDED walk: 2 (FA digits).
  await expect(lb.locator('.lb-count')).toHaveText('۱ / ۲')

  // walk forward (RTL: ArrowLeft) → the picture; the pdf row never renders a broken <img>
  await page.keyboard.press('ArrowLeft')
  await expect(lb.locator('img')).toBeVisible()
  await expect(lb.locator('video.lb-video')).toBeHidden()
  await expect(lb.locator('.lb-count')).toHaveText('۲ / ۲')
  await page.keyboard.press('Escape')
  await expect(page.locator('.shot-lightbox')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('quick-add draft: typed words ride a reload; Escape is the deliberate discard', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/sparks.html')
  const trigger = page.locator('[data-quickadd-open]').first()
  await expect(trigger).toBeVisible({ timeout: 10_000 })

  // half-type the idea…
  await trigger.click()
  const dlg = page.locator('#quickadd-dialog')
  await expect(dlg).toBeVisible()
  await dlg.locator('#qa-title').fill('draft rides the reload')
  await dlg.locator('#qa-description').fill('one-liner that must survive')

  // …reload (the exact loss path: F5 / a bounced session)…
  await page.reload()
  const trigger2 = page.locator('[data-quickadd-open]').first()
  await expect(trigger2).toBeVisible({ timeout: 10_000 })
  await trigger2.click()

  // …the draft comes BACK, both fields.
  await expect(dlg.locator('#qa-title')).toHaveValue('draft rides the reload')
  await expect(dlg.locator('#qa-description')).toHaveValue('one-liner that must survive')

  // Escape = the deliberate discard: a reload after Esc restores NOTHING.
  await page.keyboard.press('Escape')
  await expect(dlg).not.toBeVisible()
  await page.reload()
  const trigger3 = page.locator('[data-quickadd-open]').first()
  await expect(trigger3).toBeVisible({ timeout: 10_000 })
  await trigger3.click()
  await expect(dlg.locator('#qa-title')).toHaveValue('')
  await expect(dlg.locator('#qa-description')).toHaveValue('')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('resume strip: an untitled note reads the localized label (legacy dash normalizes)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/dashboard')
  // Seed the store AFTER landing (the app owns the key): one empty-title note (the
  // S118 shape) + one legacy '—' entry (the pre-S118 shape) + one titled chip.
  await page.evaluate(() => {
    const now = Date.now()
    localStorage.setItem('hibana-resume', JSON.stringify([
      { k: 'note', id: 's118-untitled', t: '', ts: now - 60_000 },
      { k: 'note', id: 's118-legacy', t: '—', ts: now - 120_000 },
      { k: 'note', id: 's118-titled', t: 'Real note title', ts: now - 180_000 },
    ]))
  })
  await page.reload()
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  // hero = the newest entry (the empty-title note) → the LOCALIZED label (the user is
  // FA), never a bare '—'
  await expect(strip.locator('.resume-hero-title')).toHaveText('یادداشت بی\u200cنام')
  // chips: the legacy '—' normalizes to the label too; the titled chip stays honest
  const chipTitles = strip.locator('.resume-chip-title')
  await expect(chipTitles).toHaveCount(2)
  await expect(chipTitles.nth(0)).toHaveText('یادداشت بی\u200cنام')
  await expect(chipTitles.nth(1)).toHaveText('Real note title')
  // the aria label speaks the same title (the {t} interpolation) — language-agnostic
  await expect(strip.locator('.resume-hero')).toHaveAttribute('aria-label', /یادداشت بی\u200cنام/)
  expect(errors).toEqual([])
})

test('vault tree (FA): an untitled note renders «بی‌عنوان», not hardcoded English', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/notes.html')
  await expect(page.locator('[data-vault-new]').first()).toBeVisible({ timeout: 15_000 })
  // the folder ships COLLAPSED (S115) — expand it to reveal the note row
  const tw = page.locator(`[data-vault-tw="${FOLDER_ID}"]`)
  await expect(tw).toBeVisible({ timeout: 10_000 })
  await tw.click()
  const row = page.locator(`[data-note-row="${NOTE_ID}"] .vault-note-name`)
  await expect(row).toHaveText('بی\u200cعنوان')
  expect(errors).toEqual([])
})
