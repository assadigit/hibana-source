// e2e/s161-ideas-redesign.spec.ts — S161 (0063): the Ideas section becomes its own
// lean surface (the owner's 16-item spec, hibana-ideas-section-spec.md).
// Pins (the S167 rebuild round):
//   (1)  the LEAN page's field-set + a dirty→Save→"✓ Saved" round-trip (reload-durable)
//   (2)  the pin toggle floats a card to the top + PERSISTS across reload
//   (3)  search: live filtering + the match count + the ✕ clear
//   (4)  search matches a LINK URL fragment (spec #12's cross-field reach)
//   (5)  the folder header (bar + name + count + Updated metrics + banner prompt)
//   (6)  the list view's icon column (pin/link/image glyphs; Tags/Signals columns GONE)
//   (7)  /project.html?id=<spark> hands off to /spark.html (the HX-Redirect)
//   (8)  the folder dialog's 16 curated swatches → the saved pair paints the tile bar
//   (9)  chip-drop filing via SYNTHETIC DragEvents (the s149 pattern — Playwright's
//        native dragAndDrop flaked against delegated DnD)
//   (10) the ⋯ menu's PROMOTE dialog moves an idea into the project pipeline
// E2E lessons banked (S161/S158): seeded ids MUST be dashed 36-char UUIDs where a
//   uuid zod gate rides the API (crypto.randomUUID); rows are user-scoped.
// Run: npx playwright test e2e/s161-ideas-redesign.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'

const TEST_EMAIL = 'e2e-s161@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const FOLDER_ID = crypto.randomUUID()
const FOLDER_NAME = 's161 Content Lab'
const OTHER_FOLDER_ID = crypto.randomUUID()
// dashed-uuid ids where the API's zod uuid gate can see them (PATCH bodies)
const SPARK_PIN = crypto.randomUUID()
const SPARK_SEARCH = crypto.randomUUID()
const SPARK_LINK = crypto.randomUUID()
const SPARK_ICO = crypto.randomUUID()
const SPARK_HANDOFF = crypto.randomUUID()
const SPARK_PROMOTE = crypto.randomUUID()
const SHOT_ID = crypto.randomUUID()

// a real 1×1 PNG — the disk store serves it, the thumb variant falls back to it
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
  try {
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM spark_folders WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* first run */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s161', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, icon, sort_order, created_at)
     VALUES ('${FOLDER_ID}', '${USER_ID}', '${FOLDER_NAME}', '✨', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, icon, sort_order, created_at)
     VALUES ('${OTHER_FOLDER_ID}', '${USER_ID}', 's161 Other Zone', NULL, 1, '${now}')`,
  )
  const spark = (id: string, title: string, desc: string, folder: string | null, so: number, updated: string) =>
    db.exec(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
       VALUES ('${id}', '${USER_ID}', '${title.replace(/'/g, "''")}', '${desc.replace(/'/g, "''")}', 'personal', 'spark', ${so}, ${folder ? `'${folder}'` : 'NULL'}, '${now}', '${updated}')`,
    )
  spark(SPARK_PIN, 's161 pinnable aurora idea', 'pin me', null, 0, new Date(Date.now() - 8 * 3600_000).toISOString())
  spark(SPARK_SEARCH, 's161 searchable nebula idea', 'find me by title', null, 1, new Date(Date.now() - 7 * 3600_000).toISOString())
  spark(SPARK_LINK, 's161 quiet titled idea', 'no title match here', null, 2, new Date(Date.now() - 6 * 3600_000).toISOString())
  spark(SPARK_ICO, 's161 glyphful idea', 'carries a link and an image', null, 3, new Date(Date.now() - 5 * 3600_000).toISOString())
  spark(SPARK_HANDOFF, 's161 handoff idea', 'heavy template begone', null, 4, new Date(Date.now() - 4 * 3600_000).toISOString())
  spark(SPARK_PROMOTE, 's161 promote me', 'ready for the pipeline', FOLDER_ID, 5, new Date(Date.now() - 3 * 3600_000).toISOString())
  // a link (URL-only matching target) + an image shot (the icons column + the thumb)
  db.exec(`INSERT INTO links (id, project_id, label, url, created_at) VALUES ('${crypto.randomUUID()}', '${SPARK_LINK}', 'Strange board', 'https://example.com/strange-planet-art', '${now}')`)
  db.exec(`INSERT INTO links (id, project_id, label, url, created_at) VALUES ('${crypto.randomUUID()}', '${SPARK_ICO}', 'Docs', 'https://docs.example.dev', '${now}')`)
  const shotPath = `${USER_ID}/${SPARK_ICO}/screenshots/${SHOT_ID}-seed.png`
  db.exec(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at)
     VALUES ('${SHOT_ID}', '${SPARK_ICO}', '${shotPath}', 'image/png', '', 0, NULL, 95, 'seed.png', '${now}')`,
  )
  // the disk store serves the bytes (S61 parity; HIBANA_SHOTS_DIR=/tmp/hibana-e2e-shots)
  mkdirSync(`/tmp/hibana-e2e-shots/${USER_ID}/${SPARK_ICO}/screenshots`, { recursive: true })
  writeFileSync(`/tmp/hibana-e2e-shots/${shotPath}`, Buffer.from(PNG_B64, 'base64'))
  db.close()
})

async function login(page: Page, view = 'cards') {
  await page.addInitScript((v) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.setItem('hibana-sparks-view', v)
      localStorage.removeItem('hibana-sparks-folder')
    } catch { /* storage blocked */ }
  }, view)
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

test('S161 lean page: field-set + dirty→Save→"✓ Saved" round-trip (reload-durable)', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // the shelf boots to the folder GRID home — enter the flat All view first
  await page.locator('.spark-folder-card.spark-folder-all').click()
  // All-ideas view: click the handoff idea's card → the LEAN page
  await page.locator(`[data-project-id="${SPARK_HANDOFF}"] a[href="/spark.html?id=${SPARK_HANDOFF}"]`).first().click()
  await page.waitForURL(`**/spark.html?id=${SPARK_HANDOFF}`)
  // The lean field-set: title, description, tags, folder, links, images — and NO
  // kanban/tabs scaffolding (spec #6's whole point).
  // a regex, not the literal: test 1 (the save round-trip) legitimately renames this
  // idea — a self-sufficient pin never depends on a sibling test's mutations
  await expect(page.locator('#spark-title')).toHaveValue(/s161 handoff idea/, { timeout: 5_000 })
  await expect(page.locator('#spark-desc')).toHaveValue('heavy template begone')
  await expect(page.locator('#spark-folder-sel')).toBeVisible()
  await expect(page.locator('#spark-tags')).toBeVisible()
  await expect(page.locator('#links')).toBeVisible()
  await expect(page.locator('#spark-gallery')).toBeVisible()
  await expect(page.locator('.pd-tabs, [data-detail-panel]')).toHaveCount(0)
  // dirty → Save → the ✓ flash
  await page.fill('#spark-title', 's161 handoff idea EDITED')
  await expect(page.locator('#spark-status')).toHaveText('Unsaved changes')
  await page.click('#spark-save')
  await expect(page.locator('#spark-status')).toHaveText('✓ Saved', { timeout: 5_000 })
  // durable across reload (and the draft store retired on save)
  await page.reload()
  await expect(page.locator('#spark-title')).toHaveValue('s161 handoff idea EDITED', { timeout: 5_000 })
  await expect(page.locator('#spark-status')).toHaveText('')
  // Ctrl+S saves too
  await page.fill('#spark-desc', 'ctrl-s path')
  await page.keyboard.press('Control+s')
  await expect(page.locator('#spark-status')).toHaveText('✓ Saved', { timeout: 5_000 })
})

test('S161 pin: the toggle floats a card to the top + persists across reload', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // the shelf boots to the folder GRID home — enter the flat All view first
  await page.locator('.spark-folder-card.spark-folder-all').click()
  const pinBtn = page.locator(`[data-project-id="${SPARK_PIN}"] .spark-pin`)
  await expect(pinBtn).toBeVisible({ timeout: 5_000 })
  await pinBtn.click()
  // optimistic + authoritative: the pinned card is the FIRST card in the grid
  await expect(page.locator('.spark-grid .spark-card').first()).toHaveAttribute('data-project-id', SPARK_PIN, { timeout: 5_000 })
  await expect(page.locator('.spark-grid .spark-card').first()).toHaveClass(/is-pinned/)
  // persists (the reload boots back to the grid home — 'all' is a browsing state,
  // not a pref; re-entering All still proves the pin survived the server round-trip)
  await page.reload()
  await page.locator('.spark-folder-card.spark-folder-all').click()
  await expect(page.locator('.spark-grid .spark-card').first()).toHaveAttribute('data-project-id', SPARK_PIN, { timeout: 5_000 })
  await expect(page.locator('.spark-grid .spark-card').first()).toHaveClass(/is-pinned/)
})

test('S161 search: live filtering + the match count + the ✕ clear', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // the shelf boots to the folder GRID home — enter the flat All view first
  await page.locator('.spark-folder-card.spark-folder-all').click()
  await expect(page.locator('#spark-shelf [data-project-id]')).toHaveCount(6, { timeout: 5_000 })
  // type → debounce → the matches own the view + the honest count
  await page.fill('#sparks-q', 'nebula')
  await expect(page.locator('#spark-shelf .spark-card')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator('#sparks-q-count')).toHaveText('1 match')
  // a second match pluralizes
  await page.fill('#sparks-q', 'idea')
  await expect(page.locator('#spark-shelf .spark-card')).toHaveCount(5, { timeout: 5_000 })
  await expect(page.locator('#sparks-q-count')).toHaveText('5 matches', { timeout: 5_000 })
  // the miss state
  await page.fill('#sparks-q', 'quantum-xylophone')
  await expect(page.locator('.spark-search-empty')).toBeVisible({ timeout: 5_000 })
  // the ✕ clears: count empties, every idea returns
  await page.click('#sparks-q-clear')
  await expect(page.locator('#sparks-q-count')).toHaveText('')
  await expect(page.locator('#spark-shelf .spark-card')).toHaveCount(6, { timeout: 5_000 })
})

test('S161 search: a LINK URL fragment finds the idea (spec #12 cross-field reach)', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  await page.fill('#sparks-q', 'strange-planet')
  await expect(page.locator('#spark-shelf .spark-card')).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator('#spark-shelf .spark-card')).toHaveAttribute('data-project-id', SPARK_LINK)
  // and a FOLDER-NAME fragment reaches into the folder from the shelf home
  await page.fill('#sparks-q', 'Other Zone')
  await expect(page.locator('#spark-shelf .spark-card')).toHaveCount(0, { timeout: 5_000 })
})

test('S161 folder header: name + count + Updated metrics + the banner prompt (spec #1/#2/#3)', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // enter the folder via its TILE on the grid home
  await page.locator(`.spark-folder-card[data-sf="${FOLDER_ID}"]`).click()
  await expect(page.locator('.sfh')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.sfh-name')).toContainText(FOLDER_NAME)
  await expect(page.locator('.sfh-metrics')).toContainText('1 idea')
  await expect(page.locator('.sfh-metrics')).toContainText('Updated')
  // no banner yet: the pastel placeholder + the upload prompt
  await expect(page.locator('[data-sfh-upload]')).toBeVisible()
  await expect(page.locator('.sfh-banner-img')).toHaveCount(0)
  // spec #16's verbatim empty-side line never shows for a NON-empty folder
  await expect(page.locator(`[data-project-id="${SPARK_PROMOTE}"]`)).toBeVisible()
})

test('S161 list view: the icon column (pin + link/image glyphs + row thumbs); Tags/Signals columns GONE (spec #9)', async ({ page }) => {
  await login(page, 'list')
  await page.goto('/sparks.html')
  // the shelf boots to the folder GRID home — enter the flat All view first
  await page.locator('.spark-folder-card.spark-folder-all').click()
  await expect(page.locator('.spark-table')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.spark-table thead th')).toHaveCount(3)
  await expect(page.locator('.spark-table thead').locator('text=Signals')).toHaveCount(0)
  await expect(page.locator('.spark-table thead').locator('text=Tags')).toHaveCount(0)
  // the glyphful row: pin button + link glyph + image glyph + the row thumb
  const row = page.locator(`.spark-table tr[data-project-id="${SPARK_ICO}"]`)
  await expect(row.locator('.spark-pin')).toBeVisible()
  await expect(row.locator('.spark-glyph')).toHaveCount(2)
  await expect(row.locator('.spark-row-thumb img')).toBeVisible()
  // the bare row: no glyphs, no thumb
  const bare = page.locator(`.spark-table tr[data-project-id="${SPARK_SEARCH}"]`)
  await expect(bare.locator('.spark-glyph')).toHaveCount(0)
  await expect(bare.locator('.spark-row-thumb')).toHaveCount(0)
  // every row title deep-links the LEAN page
  await expect(row.locator(`a[href="/spark.html?id=${SPARK_ICO}"]`)).toBeVisible()
})

test('S161 hand-off: /project.html?id=<spark> redirects to the lean page', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${SPARK_HANDOFF}`)
  // project.html's htmx boot fetch hits the spark HX-Redirect → the lean page
  await page.waitForURL(`**/spark.html?id=${SPARK_HANDOFF}`, { timeout: 8_000 })
  // a regex, not the literal: test 1 (the save round-trip) legitimately renames this
  // idea — a self-sufficient pin never depends on a sibling test's mutations
  await expect(page.locator('#spark-title')).toHaveValue(/s161 handoff idea/, { timeout: 5_000 })
})

test('S161 folder dialog: 16 curated swatches → the saved pair paints the tile bar (spec #3)', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // the folder grid home: open the rename dialog via the tile's ⋯
  await page.locator(`.spark-folder-card[data-sf="${OTHER_FOLDER_ID}"] [data-sf-menu]`).click()
  await page.locator('[data-sf-rename]').click()
  const dlg = page.locator('#spark-folder-dialog')
  await expect(dlg).toBeVisible()
  // the 16 curated tiles (from the --cat-sw-* tokens)
  await expect(dlg.locator('.sf-swatch')).toHaveCount(16)
  // pick the 5th (DEF0CC/476827 — the green tile) → save
  await dlg.locator('.sf-swatch').nth(4).click()
  await dlg.locator('#sf-save').click()
  await expect(dlg).toBeHidden({ timeout: 5_000 })
  // the grid tile's color bar now carries the stored pair
  const tile = page.locator(`.spark-folder-card[data-sf="${OTHER_FOLDER_ID}"]`)
  await expect(tile).toHaveAttribute('data-sf-pair', '#DEF0CC|#476827', { timeout: 5_000 })
  await expect(tile.locator('.spark-folder-bar')).toBeVisible()
})

test('S161 chip-drop: dragging a card onto a folder chip FILES it (s149 synthetic DnD)', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // All-ideas view first (the bar with droppable folder chips rides every list view)
  await page.locator('.spark-folder-card.spark-folder-all').click()
  await expect(page.locator(`[data-project-id="${SPARK_PIN}"]`)).toBeVisible({ timeout: 5_000 })
  // the synthetic HTML5 DnD sequence the delegated handlers listen for
  await page.evaluate(({ sparkId, folderId }) => {
    const srcCard = document.querySelector(`#spark-shelf [data-project-id="${sparkId}"]`)
    const chip = document.querySelector(`.sf-bar .sf-chip[data-sf="${folderId}"]`)
    const dt = new DataTransfer()
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt }
    srcCard!.dispatchEvent(new DragEvent('dragstart', opts))
    chip!.dispatchEvent(new DragEvent('dragover', opts))
    chip!.dispatchEvent(new DragEvent('drop', opts))
    srcCard!.dispatchEvent(new DragEvent('dragend', opts))
  }, { sparkId: SPARK_PIN, folderId: FOLDER_ID })
  // the reload re-renders: the pin idea now lives inside the folder
  await page.locator(`.sf-bar [data-sf="${FOLDER_ID}"]`).click()
  await expect(page.locator(`#spark-shelf [data-project-id="${SPARK_PIN}"]`)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.sfh-name')).toContainText(FOLDER_NAME)
})

test('S161 promote: the ⋯ menu\u2019s Promote dialog moves an idea into the pipeline (spec #17)', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  // the shelf boots to the folder GRID home — enter the flat All view first
  await page.locator('.spark-folder-card.spark-folder-all').click()

  // open the ⋯ on the promote idea's card
  await page.locator(`[data-project-id="${SPARK_PROMOTE}"] [data-menu-open]`).click()
  await page.locator(`[data-project-id="${SPARK_PROMOTE}"] [data-spark-promote]`).click()
  const dlg = page.locator('#spark-promote-dialog')
  await expect(dlg).toBeVisible()
  // pick a stage + save — the idea leaves the shelf
  await dlg.locator('#sp-status').selectOption('developing')
  await dlg.locator('#sp-save').click()
  await expect(page.locator(`#spark-shelf [data-project-id="${SPARK_PROMOTE}"]`)).toHaveCount(0, { timeout: 8_000 })
  // …and lives on the projects page now (a real project row)
  await page.goto('/projects.html?status=developing&view=cards')
  await expect(page.locator(`[data-project-id="${SPARK_PROMOTE}"]`).first()).toBeVisible({ timeout: 8_000 })
})
