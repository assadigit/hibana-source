// e2e/sparks.spec.ts — Ideas (sparks.html) E2E: the S40 audit's regression net.
// The page had ZERO functional e2e coverage (only a viewport h-scroll check) — that's
// how "an empty folder can't be entered" and "the grid ⋯ menu shadows into folder
// entry" shipped. Covers: folder grid render, EMPTY-folder entry (bar + scoped empty
// state — never the grid), the ⋯ menu in grid view, capture-into-open-folder with the
// soft refresh (no context loss), the All-ideas view, and folder-context persistence
// across reload.
// Run: npx playwright test e2e/sparks.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-sparks@test.local'
const TEST_PASS = 'e2e-password-123'
const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')

// The seeded shape mirrors the owner's live account at audit time: folders that are
// EMPTY (the "can't enter" bug state) + unfiled sparks.
const FOLDER_EMPTY = { id: UUID(), name: 'e2e empty folder' }
const FOLDER_FILLED = { id: UUID(), name: 'e2e filled folder' }

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
  try { db.exec(`DELETE FROM spark_folders WHERE user_id = '${id}'`) } catch { /* table may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-sparks', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // Two folders: one EMPTY (the bug state), one with a spark.
  db.exec(`INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES ('${FOLDER_EMPTY.id}', '${id}', '${FOLDER_EMPTY.name}', 0, '${now}')`)
  db.exec(`INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES ('${FOLDER_FILLED.id}', '${id}', '${FOLDER_FILLED.name}', 1, '${now}')`)
  const mkSpark = (title: string, folder: string | null) =>
    db.exec(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, folder_id, created_at, updated_at)
       VALUES ('${UUID()}', '${id}', '${title.replace(/'/g, "''")}', '', 'personal', 'spark', 0, '', 0, ${folder ? `'${folder}'` : 'NULL'}, '${now}', '${now}')`,
    )
  mkSpark('e2e filed spark', FOLDER_FILLED.id)
  mkSpark('e2e loose spark one')
  mkSpark('e2e loose spark two')
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

async function openSparks(page: Page) {
  await page.goto('/sparks.html')
  await expect(page).toHaveTitle(/Ideas/)
  await page.waitForSelector('#spark-shelf .spark-folder-grid, #spark-shelf .sf-bar', { timeout: 10_000 })
  await page.waitForTimeout(300) // htmx swap + menu injection settle
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
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

test('sparks: folder grid renders with zero console errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)
  await expect(page.locator('.spark-folder-grid')).toBeVisible()
  await expect(page.locator('.spark-folder-all')).toBeVisible()
  expect(errors).toEqual([])
})

test('sparks: an EMPTY folder is enterable — bar + scoped empty state, never the grid (S40)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  // Click the EMPTY folder card.
  await page.click(`.spark-folder-card[data-sf="${FOLDER_EMPTY.id}"]`)
  await page.waitForSelector('#spark-shelf .sf-bar', { timeout: 10_000 })

  // The folder view: bar + scoped empty state (S40 fix — previously the grid re-rendered).
  await expect(page.locator('#spark-shelf [data-spark-empty="folder"]')).toBeVisible()
  await expect(page.locator('#spark-shelf .spark-folder-grid')).toHaveCount(0)
  // The capture CTA is present — capture files into the open folder.
  await expect(page.locator('#spark-shelf [data-quickadd-open]')).toBeVisible()
  // The hidden input carries the folder (the quick-add's filing target).
  const folderVal = await page.inputValue('#spark-folder')
  expect(folderVal).toBe(FOLDER_EMPTY.id)
  expect(errors).toEqual([])
})

test('sparks: the grid ⋯ folder menu opens (rename/delete reachable — S40 order fix)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  // Click the ⋯ button INSIDE a folder card — previously closest('[data-sf]') shadowed
  // it and the click entered the folder instead of opening the menu.
  await page.click(`.spark-folder-card[data-sf="${FOLDER_FILLED.id}"] .spark-folder-menu`)
  await page.waitForSelector('#spark-shelf .sf-menu', { timeout: 5_000 })
  await expect(page.locator('#spark-shelf .sf-menu')).toBeVisible()
  // The menu offers rename — clicking it opens the rename dialog (not a folder entry).
  await page.click('#spark-shelf .sf-menu [data-sf-rename]')
  await page.waitForSelector('#spark-folder-dialog', { state: 'visible', timeout: 5_000 })
  await expect(page.locator('#spark-folder-dialog #sf-name')).toHaveValue(FOLDER_FILLED.name)
  // The click stayed a menu click: no folder view opened (no bar), and the hidden
  // folder input never moved — the grid view is still the shelf's content.
  await expect(page.locator('#spark-shelf .sf-bar')).toHaveCount(0)
  await expect(page.locator('#spark-folder')).toHaveValue('')
  // Close the dialog.
  await page.click('#spark-folder-dialog #sf-cancel')
  await expect(page.locator('#spark-folder-dialog')).toBeHidden()
  expect(errors).toEqual([])
})

test('sparks: capture into the open folder — soft refresh keeps the context (S40)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  // Enter the EMPTY folder (S40 makes this possible).
  await page.click(`.spark-folder-card[data-sf="${FOLDER_EMPTY.id}"]`)
  await page.waitForSelector('#spark-shelf [data-spark-empty="folder"]', { timeout: 10_000 })

  // Open the quick-add from the empty state's CTA and capture.
  await page.click('#spark-shelf [data-quickadd-open]')
  await page.waitForSelector('#quickadd-dialog', { state: 'visible', timeout: 5_000 })
  await expect(page.locator('#qa-folder-hint')).toBeVisible()
  await expect(page.locator('#qa-folder-hint')).toContainText(FOLDER_EMPTY.name)
  await page.fill('#qa-title', 'e2e spark born in folder')
  await page.click('#quickadd-dialog button[type="submit"]')

  // The soft refresh path: NO navigation (the old code hard-reloaded /sparks.html and
  // lost the folder). The shelf refetches in place and the new idea appears INSIDE the
  // folder view.
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('#spark-shelf .project-card')
    return cards.length === 1 && (cards[0].textContent || '').includes('e2e spark born in folder')
  }, null, { timeout: 10_000 })
  await expect(page).toHaveURL(/\/sparks\.html/) // still on the page — no reload happened

  // Durable server-side: the idea is filed into the folder.
  const filed = await page.evaluate(async () => {
    const res = await fetch('/api/projects?status=spark')
    const body = await res.json()
    const p = body.projects.find((x) => x.title === 'e2e spark born in folder')
    return p ? p.folder_id : null
  })
  expect(filed).toBe(FOLDER_EMPTY.id)
  expect(errors).toEqual([])
})

test('sparks: «All ideas» lists every spark (filed + unfiled) — never silently back to the grid', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  await page.click('.spark-folder-all')
  await page.waitForSelector('#spark-shelf .sf-bar', { timeout: 10_000 })
  // The flat list renders every spark: 1 filed + 2 loose + 1 born-in-folder (prior test) = 4.
  await expect(page.locator('#spark-shelf .project-card')).toHaveCount(4, { timeout: 10_000 })
  // The grid is gone — the click visibly went somewhere.
  await expect(page.locator('#spark-shelf .spark-folder-grid')).toHaveCount(0)
  const folderVal = await page.inputValue('#spark-folder')
  expect(folderVal).toBe('all')
  expect(errors).toEqual([])
})

test('sparks: the open folder survives a reload (S40 inline stamp + persisted pref)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  // Enter the filled folder (its bar + 1 card), then reload.
  await page.click(`.spark-folder-card[data-sf="${FOLDER_FILLED.id}"]`)
  await page.waitForSelector('#spark-shelf .sf-bar', { timeout: 10_000 })
  await page.reload()
  await page.waitForSelector('#spark-shelf .sf-bar', { timeout: 10_000 })
  // Still INSIDE the folder — the inline stamp restored #spark-folder before htmx's
  // first fetch (no grid→folder flash, no context loss).
  await expect(page.locator('#spark-shelf .project-card')).toHaveCount(1, { timeout: 10_000 })
  const folderVal = await page.inputValue('#spark-folder')
  expect(folderVal).toBe(FOLDER_FILLED.id)
  expect(errors).toEqual([])
})

// ---- S41: folder EMOJI icons + the mobile layout ---------------------------------

test('sparks: a folder born through the dialog carries its picked emoji (S41)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  // Open the New-folder card's dialog, then the emoji picker from its preview button.
  await page.click('.spark-folder-new')
  await page.waitForSelector('#spark-folder-dialog', { state: 'visible', timeout: 5_000 })
  await page.click('#sf-icon-btn')
  await page.waitForSelector('.emoji-pop.open', { timeout: 5_000 })

  // Search + pick the rocket.
  await page.fill('#emoji-pop-q', 'rocket')
  await page.click('.emoji-pop-em')
  // The picker closes itself; the preview carries the pick; the clear affordance shows.
  await expect(page.locator('.emoji-pop.open')).toHaveCount(0)
  await expect(page.locator('#sf-icon-preview')).toHaveText('🚀')
  await expect(page.locator('#sf-icon-clear')).toBeVisible()

  await page.fill('#sf-name', 'e2e emoji folder')
  await page.click('#sf-save')
  await page.waitForTimeout(600) // toast + shelf refetch

  // The grid card renders the emoji (not the folder-plus glyph) and stamps data-sf-icon.
  const card = page.locator('.spark-folder-card', { hasText: 'e2e emoji folder' })
  await expect(card).toHaveCount(1)
  await expect(card.locator('.spark-folder-emoji')).toHaveText('🚀')
  await expect(card).toHaveAttribute('data-sf-icon', '🚀')

  // Durable server-side truth: the folders API returns the icon.
  const icon = await page.evaluate(async () => {
    const res = await fetch('/api/projects/sparks/folders')
    const body = await res.json()
    const f = body.folders.find((x) => x.name === 'e2e emoji folder')
    return f ? f.icon : null
  })
  expect(icon).toBe('🚀')
  expect(errors).toEqual([])
})

test('sparks: rename prefills the emoji and clearing it restores the glyph (S41)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  await openSparks(page)

  // The folder from the prior test (name-unique; if this run is standalone the prior
  // test created it) — create it if missing so the test is order-independent.
  const hasFolder = await page.evaluate(async () => {
    const res = await fetch('/api/projects/sparks/folders')
    const body = await res.json()
    return body.folders.some((x) => x.name === 'e2e emoji folder')
  })
  if (!hasFolder) {
    await page.evaluate(async () => {
      await fetch('/api/projects/sparks/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'e2e emoji folder', icon: '🚀' }),
      })
    })
    await page.reload()
    await openSparks(page)
  }

  // ⋯ menu → rename: the dialog prefills BOTH the name and the emoji.
  const card = page.locator('.spark-folder-card', { hasText: 'e2e emoji folder' })
  await card.locator('.spark-folder-menu').click()
  await page.click('#spark-shelf .sf-menu [data-sf-rename]')
  await page.waitForSelector('#spark-folder-dialog', { state: 'visible', timeout: 5_000 })
  await expect(page.locator('#sf-name')).toHaveValue('e2e emoji folder')
  await expect(page.locator('#sf-icon-preview')).toHaveText('🚀')

  // Clear → save: the PATCH sends icon:null; the card returns to the folder-plus glyph.
  await page.click('#sf-icon-clear')
  await expect(page.locator('#sf-icon-preview')).toHaveText('📁')
  await page.click('#sf-save')
  await page.waitForTimeout(600)
  const cardAfter = page.locator('.spark-folder-card', { hasText: 'e2e emoji folder' })
  await expect(cardAfter.locator('.spark-folder-emoji')).toHaveCount(0)
  await expect(cardAfter.locator('.spark-folder-icon .icon')).toHaveCount(1)
  await expect(cardAfter).toHaveAttribute('data-sf-icon', '')
  expect(errors).toEqual([])
})

test('sparks: mobile — two-up folder grid + the bar home chip exits to it (S41)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await openSparks(page)

  // Two-up: every grid card is ~half the 390px viewport (≤ 200px), never full-width.
  const widths = await page.$$eval('.spark-folder-card', (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))
  expect(widths.length).toBeGreaterThanOrEqual(4)
  for (const w of widths) expect(w).toBeLessThanOrEqual(200)
  // No horizontal scroll at 390px.
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hscroll).toBe(false)

  // Enter a folder, then come HOME via the bar's «Folders» chip — the grid returns
  // (previously there was NO in-session exit: «All» was the flat list, folders vanished).
  await page.click(`.spark-folder-card[data-sf="${FOLDER_FILLED.id}"]`)
  await page.waitForSelector('#spark-shelf .sf-bar', { timeout: 10_000 })
  await expect(page.locator('#spark-shelf .sf-home')).toBeVisible()
  await page.click('#spark-shelf .sf-home')
  await page.waitForSelector('#spark-shelf .spark-folder-grid', { timeout: 10_000 })
  await expect(page.locator('#spark-shelf .sf-bar')).toHaveCount(0)
  // The folder context is cleared — a capture from here files to «All»/unfiled.
  await expect(page.locator('#spark-folder')).toHaveValue('')
  expect(errors).toEqual([])
})
