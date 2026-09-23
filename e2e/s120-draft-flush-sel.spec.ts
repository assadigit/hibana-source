// e2e/s120-draft-flush-sel.spec.ts — S120: never lose an idea, three more doors.
//
// WHY THIS FILE EXISTS: the S118 quick-add draft proved the pattern (sessionStorage
// per keystroke, sync clear inside close() — the 'close' event is a QUEUED task);
// S120 extends the never-lose-an-idea contract to the two surfaces S118 didn't
// reach, plus the gallery's selection ring finally covering recordings:
//   1. the sparks EDIT dialog keeps a half-edit across a reload (restore into the
//      SAME spark; a stale draft for a DIFFERENT spark is dropped; Escape truly
//      discards)
//   2. the notes editor's 900ms autosave debounce is a LOSS WINDOW — a tab closed
//      inside it (or crashed) dropped the tail keystrokes; a LOCAL draft (sync
//      localStorage writes survive any teardown) restores on reopen and the
//      re-armed autosave converges the server copy (the pagehide keepalive PATCH
//      stays as the network belt — CDP-driven teardowns drop unload requests, so
//      the draft is the testable guarantee)
//   3. a SELECTED recording in the gallery shows the brand ring (the is-sel state
//      was img-button-only — a picked video looked unpicked)
//   4. a recording tile paints its first frame without playing (the 1ms seek after
//      loadedmetadata — the no-ffmpeg poster substitute; S119 candidate 6)
// Run: npx playwright test e2e/s120-draft-flush-sel.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const TEST_EMAIL = 'e2e-s120@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const USER_ID = randomBytes(16).toString('hex')
const SPARK_ID = 'e2e-s120-spark'
const OTHER_ID = 'e2e-s120-other'
const PROJECT_ID = 'e2e-s120-media-project'
const VIDEO_SHOT = 'e2e-s120-shot-video'
const SHOTS_ROOT = '/tmp/hibana-e2e-shots'

// A 755-byte VP8/WebM (320x240, amber, 0.5s, ffmpeg libvpx) — REAL decodable bytes
// so the tile's preload="metadata" fetch actually fires 'loadedmetadata' (a 404ing
// row never would — the S118 seeds pinned structure; this pin needs the event).
const WEBM_B64 =
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAALDEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEkTbuMU6uEHFO7a1OsggKt7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAgsAAAAAAABZUrmvJrgEAAAAAAABA14EBc8WIIL0EkkxsF/icgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JGwggFAuoHwmoECVbCEVbmBARJUw2f7c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS43LjEwM3Nz1mPAi2PFiCC9BJJMbBf4Z8ihRaOHRU5DT0RFUkSHlExhdmM2MS4xOS4xMDEgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC42MDAwMDAwMDAAH0O2dUED54EAo0C9gQAAgBATAJ0BKkAB8AAARwiFhYiFhIgCAgJ1qgP4A/oCBram3TeJk4NAsk+17c2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD2TnD16AP7WMf/3x/foNpn/fIH/9bAbIApv+tAAo56BAMgA0QIAARAQABgAGFgv9AAIgAQzX61yT5xzAACjnoEBkADRAgABEBAAGAAYWC/0AAiABDNfrXJPnHMAABxTu2uRu4+zgQC3iveBAfGCAaTwgQM='

test.beforeAll(async () => {
  // the fixture bytes land at <root>/<github_path> — the disk store keys by
  // github_path verbatim (src/services/disk-shots.ts joins root + safeKey).
  mkdirSync(join(SHOTS_ROOT, 'shots'), { recursive: true })
  writeFileSync(join(SHOTS_ROOT, 'shots', `${VIDEO_SHOT}.webm`), Buffer.from(WEBM_B64, 'base64'))
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
     VALUES ('${USER_ID}', 'e2e-s120', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${SPARK_ID}', '${USER_ID}', 'S120 draft spark', 'the draft belongs here', 'personal', 'spark', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${OTHER_ID}', '${USER_ID}', 'S120 other spark', 'not the draft spark', 'personal', 'spark', 1, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJECT_ID}', '${USER_ID}', 'S120 media project', '', 'personal', 'developing', 2, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at)
     VALUES ('${VIDEO_SHOT}', '${PROJECT_ID}', 'shots/${VIDEO_SHOT}.webm', 'video/webm', '', 0, NULL, 755, 'spec.webm', '${now}')`,
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

test('a half-edited spark rides a reload; a different spark drops the stale draft; Escape discards', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/sparks.html')
  // the initial shelf state is the FOLDER GRID — open «All ideas» to reveal the cards
  // (after a reload the shelf may or may not restore the cards view — handle both)
  const ensureCards = async () => {
    try {
      await page.click('.spark-folder-card[data-sf="all"]', { timeout: 4_000 })
    } catch { /* already in the cards view */ }
  }
  await ensureCards()

  const openEdit = async (id: string) => {
    const card = page.locator(`.project-card:has([data-spark-edit="${id}"])`)
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.locator('[data-menu-open]').first().click()
    await page.locator(`[data-spark-edit="${id}"]`).click()
    await expect(page.locator('#spark-edit-dialog')).toBeVisible()
  }

  // ── a stale draft for spark A must NOT leak into spark B's dialog ──
  await openEdit(SPARK_ID)
  const dlg = page.locator('#spark-edit-dialog')
  await dlg.locator('#se-title').fill('S120 half-typed draft')
  await page.reload() // the edit dialog dies with the document — the draft must not
  await ensureCards()
  await openEdit(OTHER_ID)
  await expect(page.locator('#se-title')).toHaveValue('S120 other spark') // prefill stands
  await page.keyboard.press('Escape')
  await expect(page.locator('#spark-edit-dialog')).not.toBeVisible()

  // the mismatched draft was dropped on B's open — A's dialog shows the row truth
  await openEdit(SPARK_ID)
  await expect(page.locator('#se-title')).toHaveValue('S120 draft spark')
  await page.keyboard.press('Escape')
  await expect(page.locator('#spark-edit-dialog')).not.toBeVisible()

  // ── a draft for THIS spark rides the reload (newer intent wins) ──
  await openEdit(SPARK_ID)
  await page.locator('#se-title').fill('S120 half-typed draft')
  await page.reload()
  await ensureCards()
  await openEdit(SPARK_ID)
  await expect(page.locator('#se-title')).toHaveValue('S120 half-typed draft')

  // ── Escape TRULY discards (the sync clear inside close(); no resurrection) ──
  await page.keyboard.press('Escape')
  await expect(page.locator('#spark-edit-dialog')).not.toBeVisible()
  await openEdit(SPARK_ID)
  await expect(page.locator('#se-title')).toHaveValue('S120 draft spark')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('a tab closed inside the autosave debounce loses nothing (local draft restores, autosave converges)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/notes.html')
  // a fresh user renders TWO "New note" buttons (empty-state CTA + list row) — either creates
  await page.locator('[data-vault-new]').first().click({ timeout: 15_000 })
  await page.fill('[data-vault-title]', 'S120 flush note')
  await page.fill('[data-vault-src]', 'the tail survives')
  // RELOAD INSIDE THE 900ms DEBOUNCE — the tab "died" mid-window. The local draft
  // (sync localStorage writes survive any teardown) must restore the keystrokes on
  // reopen; the re-armed autosave then converges the server copy.
  await page.reload()
  // the editor may auto-open from the #n= hash after the reload — otherwise the card opens it
  const titleInput = page.locator('[data-vault-title]')
  try {
    await expect(titleInput).toHaveValue('S120 flush note', { timeout: 3_000 })
  } catch {
    await page.locator('[data-vault-card]').first().click()
    await expect(titleInput).toHaveValue('S120 flush note', { timeout: 10_000 })
  }
  await expect(page.locator('[data-vault-src]')).toHaveValue(/the tail survives/)
  // the restore re-armed the autosave — wait out the debounce + PATCH, then check
  // the SERVER truth directly (the editor could be showing the local draft; the DB
  // read proves the convergence actually landed)
  await page.waitForTimeout(1_800)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const row = db.prepare('SELECT title, content FROM vault_notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(USER_ID) as { title: string; content: string }
  db.close()
  expect(row.title).toBe('S120 flush note')
  expect(row.content).toContain('the tail survives')
  expect(errors).toEqual([])
})

test('a selected recording wears the brand pick ring (the is-sel state reaches video tiles)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto('/gallery.html')
  const tile = page.locator('.gal-card video.shot-video')
  await expect(tile).toBeVisible({ timeout: 15_000 })
  const fig = page.locator('.gal-card:has(video.shot-video)')
  // selection mode exposes the per-card check buttons (CSS gates them on [data-selecting])
  await page.locator('#gallery-select-btn').click()
  await fig.locator('.gal-check').click()
  await expect(fig).toHaveClass(/is-sel/)
  // the ring: outline paints above the media frame of a replaced element — 2px brand
  await expect
    .poll(() =>
      tile.evaluate((el) => {
        const cs = getComputedStyle(el)
        return cs.outlineStyle === 'solid' && cs.outlineWidth === '2px'
      }),
    )
    .toBeTruthy()
  expect(errors).toEqual([])
})

test('a recording tile paints its first frame without playing (the loadedmetadata 1ms seek)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors: string[] = []
  watchErrors(page, errors)
  await login(page)
  await page.goto(`/project.html?id=${PROJECT_ID}`)
  await expect(page.locator('[data-detail-tab="media"]')).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-detail-tab="media"]').click()
  const tile = page.locator('#shots video.shot-video')
  await expect(tile).toBeVisible({ timeout: 15_000 })
  // the nudge ran on metadata and the 1ms seek moved the still-at-zero player onto
  // its first frame — currentTime > 0 is the paint precondition, dataset the receipt
  await expect
    .poll(() => tile.evaluate((el) => (el as HTMLVideoElement).currentTime), { timeout: 10_000 })
    .toBeGreaterThan(0)
  expect(await tile.evaluate((el) => (el as HTMLVideoElement).dataset.framed === '1')).toBe(true)
  expect(errors).toEqual([])
})
