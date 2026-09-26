// e2e/s152-categories.spec.ts — S152 (owner round: the GLOBAL task-category system,
// nine blocks). Pins the round's load-bearing surfaces end to end:
//   (1) Settings → Categories (block 2): the library lists non-archived rows with
//       swatch + name; create via the add form; rename + recolor inline; archive
//       removes the row from the screen.
//   (2) The board chip (block 6): a categorized task renders its category as a
//       small colored chip DIRECTLY ABOVE the task title, wearing the category's
//       own fill+ink pair.
//   (3) The composer picker (blocks 3+4+7): suggestions come from the project's
//       enabled categories; a typed non-match offers the inline Create-'name'
//       option whose swatch step saves to the global library in one beat; the
//       zero-enabled setup prompt shows the toggle list on a fresh project and
//       disappears the moment one category is enabled.
//   (4) Archive semantics (block 8): an archived category leaves the pickers and
//       the toggle lists but its chip KEEPS rendering on tasks that reference it.
// Run: npx playwright test e2e/s152-categories.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s152@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
// Two projects: one seeded WITH a categorized task, one with ZERO enabled
// categories (the block-7 setup prompt's only legal surface).
const PROJ_ID = randomBytes(16).toString('hex')
const EMPTY_PROJ_ID = randomBytes(16).toString('hex')
const CAT_ID = randomBytes(16).toString('hex')
const CAT_NAME = 'UI/UX'
const CAT_FILL = '#ECF0CC'
const CAT_INK = '#5F6827'
const TASK_ID = randomBytes(16).toString('hex')
const TASK_TITLE = 's152 categorized task'

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
    // by EMAIL (the id is random per run — earlier runs' residue must go too) and by
    // NAME (the partial unique index (block 3) makes a stale same-name row collide
    // with this run's fresh id — including test 4's rename target and test 2's
    // quick-created 'Brand Work').
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM categories WHERE id = '${CAT_ID}' OR lower(trim(name)) IN ('${CAT_NAME.toLowerCase()}', 'design', 'brand work')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s152', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT OR IGNORE INTO categories (id, name, color_fill, color_text, is_archived, created_at)
     VALUES ('${CAT_ID}', '${CAT_NAME}', '${CAT_FILL}', '${CAT_INK}', 0, '${now}')`,
  )
  for (const pid of [PROJ_ID, EMPTY_PROJ_ID]) {
    db.exec(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
       VALUES ('${pid}', '${USER_ID}', 's152 project', '', 'personal', 'planning', 0, '${now}', '${now}')`,
    )
  }
  // the join AFTER both parents exist (FK: project_id + category_id)
  db.exec(
    `INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES ('${PROJ_ID}', '${CAT_ID}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sort_order, created_at)
     VALUES ('${TASK_ID}', '${PROJ_ID}', '${TASK_TITLE}', 'planned', 'medium', '${CAT_ID}', 1, '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

test('block 6: the board card renders the category chip directly above the title in the pair colors', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  const wrap = page.locator(`.pd-task-wrap[data-pd-task="${TASK_ID}"]`)
  await expect(wrap).toBeVisible()
  const chip = wrap.locator('.pd-task-body > .cat-chip')
  await expect(chip).toHaveText(CAT_NAME)
  // the chip sits ABOVE the title row (the owner's placement spec)
  const chipBox = await chip.boundingBox()
  const titleBox = await wrap.locator('.pd-task-title-row').boundingBox()
  expect(chipBox && titleBox && chipBox.y + chipBox.height <= titleBox.y + 2).toBeTruthy()
  // and it wears the category's own curated pair (style attribute from the DB row)
  await expect(chip).toHaveAttribute('style', new RegExp(CAT_FILL.replace('#', '#'), 'i'))
})

test('blocks 3+4: the composer picker suggests enabled categories, quick-creates non-matches', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  await page.click('[data-pd-add="planned"]')
  const input = page.locator('#pd-taskadd-cat')
  // block 7 first: this project HAS an enabled category → the setup prompt stays hidden
  await expect(page.locator('#pd-taskadd-cat-setup')).toBeHidden()
  await input.click()
  const pop = page.locator('#pd-taskadd-cat-pop')
  await expect(pop.locator('.pd-cat-pop-row', { hasText: CAT_NAME })).toBeVisible()
  // typing a NON-match offers the inline Create option (block 4)
  await input.fill('Brand Work')
  await expect(pop.locator('[data-cat-create]')).toContainText('Create “Brand Work”')
  await pop.locator('[data-cat-create]').click()
  // the swatch step: 16 curated tiles, pick one → the category exists + is selected
  await expect(pop.locator('[data-cat-swatch]')).toHaveCount(16)
  await pop.locator('[data-cat-swatch]').nth(5).click()
  await expect(input).toHaveValue('Brand Work')
  // it saved to the GLOBAL library immediately (block 4) — visible in the settings API
  const lib = await page.evaluate(() => fetch('/api/categories', { cache: 'reload' }).then((r) => r.json()))
  expect((lib.categories as { name: string }[]).some((c) => c.name === 'Brand Work')).toBeTruthy()
  await page.keyboard.press('Escape')
})

test('block 7: a zero-category project gets the setup prompt, and enabling one dismisses it', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${EMPTY_PROJ_ID}`)
  await page.click('[data-pd-add="planned"]')
  const setup = page.locator('#pd-taskadd-cat-setup')
  await expect(setup).toBeVisible()
  // the toggle list offers the LIBRARY rows (the UI/UX category exists globally)
  await expect(setup.locator('.pd-cat-toggle', { hasText: CAT_NAME })).toBeVisible()
  await setup.locator('.pd-cat-toggle input').first().check()
  // one enabled → the prompt retreats (it only interrupts when actually needed)
  await expect(setup).toBeHidden()
  await page.keyboard.press('Escape')
})

test('blocks 2+8: Settings manages the library; archiving keeps the card chip but drops the picker row', async ({ page }) => {
  await login(page)
  // rename + recolor the seeded category via the settings screen
  await page.goto('/settings.html')
  await page.evaluate(() => document.getElementById('settings-categories')?.scrollIntoView())
  const row = page.locator('#catlist .pd-cat-row', { hasText: CAT_NAME })
  await expect(row).toBeVisible()
  await row.locator('[data-cat-rename]').click()
  await page.fill('[data-cat-name-in]', 'Design')
  await page.locator('.pd-cat-edit .pd-cat-swatch-tile').nth(2).click()
  await page.locator('[data-cat-save]').click()
  await expect(page.locator('#catlist .cat-chip', { hasText: 'Design' })).toBeVisible()
  // archive it → the row leaves the screen
  page.on('dialog', (d) => d.accept())
  await page.locator('#catlist .pd-cat-row', { hasText: 'Design' }).locator('[data-cat-archive]').click()
  await expect(page.locator('#catlist .pd-cat-row', { hasText: 'Design' })).toHaveCount(0)
  // block 8 on the board: the chip KEEPS rendering (history visible) under the new name
  await page.goto(`/project.html?id=${PROJ_ID}`)
  const chip = page.locator(`.pd-task-wrap[data-pd-task="${TASK_ID}"] .pd-task-body > .cat-chip`)
  await expect(chip).toHaveText('Design')
  // ...but the composer picker excludes the archived category from NEW selections
  await page.click('[data-pd-add="planned"]')
  await page.click('#pd-taskadd-cat')
  await expect(page.locator('#pd-taskadd-cat-pop .pd-cat-pop-row', { hasText: 'Design' })).toHaveCount(0)
})
