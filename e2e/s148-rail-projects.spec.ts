// e2e/s148-rail-projects.spec.ts — S148 (the S143 next-round candidate: "wire the same
// event into projects-page/sparks-page mutations — project status changes + spark stage
// moves still leave the panel's projects/sparks sections stale"): every project/spark
// mutation page now calls window.hibana.rail.refresh() (the nav.js direct hook, the
// sanctioned S143 channel) after each successful write, so the rail panel follows the
// mutation in the same beat — no physical reload. These pins hold the click-driven
// surfaces end-to-end: the projects page's ⋯ Delete (the rail drops the row) + its Undo
// toast (the row returns), the sparks page's Delete/Undo, and the sparks page's
// Move-to-folder dialog (the rail regroups the idea under its folder). A live-window
// canary must survive every assertion (no reload happened).
// Run: npx playwright test e2e/s148-rail-projects.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'

const TEST_EMAIL = 'e2e-s148@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const PROJ_ID = randomBytes(16).toString('hex')
const SPARK_ID = randomBytes(16).toString('hex')
const PROJ_TITLE = 's148-alpha project'
const SPARK_TITLE = 's148-beta idea'
const FOLDER_NAME = 's148 folder'

// The spark folder id MUST be a real UUID — the project PATCH validates folder_id's
// format server-side (a hex id 400s the move).
const FOLDER_ID = randomUUID()

// Seed the test user + one live project (status 'planning' → the rail's projects
// section lists it), one spark (status 'spark' → the shelf's Unfiled group) and one
// spark folder (the Move pin's destination).
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
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM spark_folders WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s148', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJ_ID}', '${USER_ID}', '${PROJ_TITLE}', '', 'personal', 'planning', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${SPARK_ID}', '${USER_ID}', '${SPARK_TITLE}', '', 'personal', 'spark', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, sort_order, created_at)
     VALUES ('${FOLDER_ID}', '${USER_ID}', '${FOLDER_NAME}', 0, '${now}')`,
  )
  db.close()
})

async function login(page: Page, section: 'projects' | 'sparks') {
  // Suppress the onboarding coachmarks and persist the rail panel's section so its
  // boot restore opens it on every page this spec lands on (the S143 recipe).
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.setItem('hibana-rail-panel', s)
    } catch { /* storage blocked */ }
  }, section)
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

async function openCardMenu(page: Page, id: string) {
  const card = page.locator(`.project-card[data-project-id="${id}"]`)
  await expect(card).toBeVisible()
  // The ⋯ rides a hover-reveal — hover the card first, then click the toggle.
  await card.hover()
  await card.locator('[data-menu-open]').click()
  return card.locator('.spark-menu-pop')
}

test('projects page ⋯ Delete → the rail projects section drops the row in the same beat; Undo restores it', async ({ page }) => {
  await login(page, 'projects')
  await page.goto('/projects.html?view=cards') // the ⋯ menu rides the cards view (the default 'Stages' overview has no cards)
  const panel = page.locator('[data-rail-panel-box]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.rail-project-row', { hasText: PROJ_TITLE })).toBeVisible()
  // no-reload canary: a live window flag must survive every assertion
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s148live = 1 })

  // Delete via the card's ⋯ menu (the projects-page deleteCard path → DELETE + refresh()).
  const pop = await openCardMenu(page, PROJ_ID)
  await pop.locator('[data-card-delete]').click()
  // The panel re-render is debounced 250ms + one /api/rail read — toPass rides it.
  await expect(async () => {
    expect(await panel.locator('.rail-project-row', { hasText: PROJ_TITLE }).count()).toBe(0)
  }).toPass({ timeout: 5_000 })

  // Undo (the delete toast's Undo button) → the row returns to the panel too.
  await page.locator('#toast button', { hasText: 'Undo' }).click()
  await expect(panel.locator('.rail-project-row', { hasText: PROJ_TITLE })).toBeVisible({ timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s148live)).toBe(1)
})

test('sparks page ⋯ Delete → the rail sparks section drops the idea; Undo brings it back', async ({ page }) => {
  await login(page, 'sparks')
  await page.goto('/sparks.html?view=cards') // cards view carries the ⋯ menu (delete + move)
  // The sparks cards view boots on the FOLDER grid — open the «All ideas» context first
  // so the actual idea cards (with their ⋯ menus) render.
  await page.locator('.spark-folder-card[data-sf="all"]').click()
  const panel = page.locator('[data-rail-panel-box]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.rail-item', { hasText: SPARK_TITLE })).toBeVisible()
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s148live = 1 })

  const pop = await openCardMenu(page, SPARK_ID)
  await pop.locator('[data-spark-delete]').click() // the sparks menu's delete trigger (the projects page uses data-card-delete)
  await expect(async () => {
    expect(await panel.locator('.rail-item', { hasText: SPARK_TITLE }).count()).toBe(0)
  }).toPass({ timeout: 5_000 })

  await page.locator('#toast button', { hasText: 'Undo' }).click()
  await expect(panel.locator('.rail-item', { hasText: SPARK_TITLE })).toBeVisible({ timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s148live)).toBe(1)
})

test('sparks page Move-to-folder → the rail regroups the idea under its folder in the same beat', async ({ page }) => {
  await login(page, 'sparks')
  await page.goto('/sparks.html?view=cards')
  await page.locator('.spark-folder-card[data-sf="all"]').click() // open the «All ideas» context — idea cards render there
  const panel = page.locator('[data-rail-panel-box]')
  await expect(panel).toBeVisible()
  // Before: the idea sits in the UNFILED group; the folder group is shipped folded.
  const unfiled = panel.locator('.rail-group', { hasText: 'Unfiled' })
  await expect(unfiled.locator('.rail-item', { hasText: SPARK_TITLE })).toBeVisible()
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s148live = 1 })

  // Move via the ⋯ menu's Move-to-folder dialog (the sparks-page PATCH folder_id path).
  const pop = await openCardMenu(page, SPARK_ID)
  await pop.locator('[data-spark-move]').click()
  const dlg = page.locator('dialog:has(#sf-move-form)')
  await dlg.locator(`input[name="sf-move"][value="${FOLDER_ID}"]`).check()
  await dlg.locator('#sf-move-save').click()

  // The rail re-renders: the idea now lives under the folder's (folded) group —
  // count the row inside the folder group without expanding it.
  await expect(async () => {
    const folderGroup = panel.locator('.rail-group', { hasText: FOLDER_NAME })
    expect(await folderGroup.locator('.rail-item', { hasText: SPARK_TITLE }).count()).toBe(1)
    expect(await panel.locator('.rail-group', { hasText: 'Unfiled' }).locator('.rail-item', { hasText: SPARK_TITLE }).count()).toBe(0)
  }).toPass({ timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s148live)).toBe(1)
})
