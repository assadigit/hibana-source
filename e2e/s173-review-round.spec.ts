// e2e/s173-review-round.spec.ts — S173 (the S171+S172 review round + the backlog
//   sweep, rebuilt after the sandbox reset ate the local commits):
//   (1) S172 — the Categories surface: the composer's block-7 setup prompt is GONE;
//       the board-header dialog's toggle rows render as FLEX lines inside the modal
//       (the `.modal label{display:grid}` specificity restore), 44px tall; a toggle
//       saves, flips its On/Off label IN PLACE (no scroll-snapping repaint), toasts
//       'ok', and the enable persists (the API truth).
//   (2) S171 — the lean page's Created·Updated meta line (EN + FA units/digits),
//       the beforeunload guard (arms on dirty, disarms after Save).
//   (3) Backlog — the ?q= deep-link prefills + the initial fetch carries it; the
//       search renders the <mark class="spark-hit"> highlight + the match-reason
//       badges (Title/Description/Tag/Folder); a dead remembered folder self-heals.
//   (4) Backlog — the promote dialog driven purely by KEYBOARD (arrows + Enter).
//   (5) Backlog — the palette's Idea folders group quick-jumps to the folder view.
// Run: npx playwright test e2e/s173-review-round.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s173@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const FA_EMAIL = 'e2e-s173-fa@test.local'
const FA_USER_ID = randomBytes(16).toString('hex')

const PROJECT_ID = randomBytes(16).toString('hex') // a REAL project (the board's Categories button)
const CAT_ID = randomBytes(16).toString('hex')     // a global category, NOT enabled for the project
const SPARK_A = randomBytes(16).toString('hex')    // title match ('needle in title')
const SPARK_B = randomBytes(16).toString('hex')    // description match
const SPARK_C = randomBytes(16).toString('hex')    // tag match
const SPARK_D = randomBytes(16).toString('hex')    // folder-name match
const SPARK_FA = randomBytes(16).toString('hex')   // the FA user's meta-line pin
const PROMOTE_ID = randomBytes(16).toString('hex') // the keyboard-promote pin
const TAG_ID = randomBytes(16).toString('hex')
const FOLDER_ID = crypto.randomUUID() // S158 lesson: dashed 36-char UUIDs for folders
const FOLDER_NAME = 's173 needler folder'
const DEAD_FOLDER_ID = crypto.randomUUID()
const NEEDLE = 'needle'

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
  const past = new Date(Date.now() - 3 * 24 * 3600_000).toISOString() // '3d ago' units for the meta line
  try {
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}'))`)
    db.exec(`DELETE FROM spark_folders WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}'))`)
    db.exec(`DELETE FROM tags WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}'))`)
    // the s152 lesson: the live-name unique index is name-scoped — a random id per
    // run never matches the PREVIOUS run's row, so the name must go too
    db.exec(`DELETE FROM project_categories WHERE category_id IN (SELECT id FROM categories WHERE lower(trim(name)) = 's173 category') OR category_id = '${CAT_ID}'`)
    db.exec(`DELETE FROM categories WHERE id = '${CAT_ID}' OR lower(trim(name)) = 's173 category'`)
    db.exec(`DELETE FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}')`)
  } catch { /* first run */ }
  for (const [uid, uname, uemail, lang] of [[USER_ID, 'e2e-s173', TEST_EMAIL, 'en'], [FA_USER_ID, 'e2e-s173-fa', FA_EMAIL, 'fa']] as const) {
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${uid}', '${uname}', '${uemail}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
  }
  // the S172 pin: one REAL project + one global category it has NOT enabled
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${PROJECT_ID}', '${USER_ID}', 's173 project', '', 'personal', 'planning', 0, NULL, '${past}', '${past}')`,
  )
  db.exec(
    `INSERT INTO categories (id, name, color_fill, color_text, is_archived, created_at)
     VALUES ('${CAT_ID}', 's173 category', '#F0CCCC', '#682727', 0, '${now}')`,
  )
  // the search matrix: title / description / tag / folder-name matches for 'needle'
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${SPARK_A}', '${USER_ID}', 'needle in title', '', 'personal', 'spark', 0, NULL, '${past}', '${past}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${SPARK_B}', '${USER_ID}', 'plain thing', 'the needle hides in the description', 'personal', 'spark', 1, NULL, '${past}', '${past}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${SPARK_C}', '${USER_ID}', 'tagged thing', '', 'personal', 'spark', 2, NULL, '${past}', '${past}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${SPARK_D}', '${USER_ID}', 'filed thing', '', 'personal', 'spark', 3, '${FOLDER_ID}', '${past}', '${past}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${PROMOTE_ID}', '${USER_ID}', 's173 promote me', '', 'personal', 'spark', 4, NULL, '${past}', '${past}')`,
  )
  db.exec(
    `INSERT INTO tags (id, user_id, name, color, usage_count, created_at)
     VALUES ('${TAG_ID}', '${USER_ID}', 'needleish', '#f6d365', 1, '${now}')`,
  )
  db.exec(`INSERT INTO project_tags (project_id, tag_id) VALUES ('${SPARK_C}', '${TAG_ID}')`)
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, icon, sort_order, created_at)
     VALUES ('${FOLDER_ID}', '${USER_ID}', '${FOLDER_NAME}', '✒️', 0, '${now}')`,
  )
  // the FA user's own spark (rule 1: rows are user-scoped)
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${SPARK_FA}', '${FA_USER_ID}', 'ایدهٔ تست', '', 'personal', 'spark', 0, NULL, '${past}', '${past}')`,
  )
  db.close()
})

async function login(page: Page, opts?: { as?: string }) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.removeItem('hibana-sparks-view')
      localStorage.removeItem('hibana-sparks-folder')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', opts?.as ?? TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

// ---------------------------------------------------------------------------
// (1) S172 — the Categories dialog
// ---------------------------------------------------------------------------
test('categories dialog: flex toggle rows (not the modal grid), 44px, in-place On/Off + ok toast + persisted enable', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJECT_ID}`)
  await page.locator('[data-pd-cats]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.click('[data-pd-cats]')
  const dlg = page.locator('#pd-cats-dialog')
  await expect(dlg).toBeVisible()
  const row = dlg.locator('.pd-cat-toggle', { hasText: 's173 category' })
  await expect(row).toHaveCount(1)

  // the specificity pin: `.modal label{display:grid}` used to stack these rows —
  // the restore keeps them the flex line they are, with the 44px touch floor
  const geo = await row.evaluate((el) => {
    const cs = getComputedStyle(el)
    const input = el.querySelector('input') as HTMLElement | null
    return { display: cs.display, minHeight: cs.minHeight, inputStretch: input ? parseFloat(getComputedStyle(input).inlineSize) : 0 }
  })
  expect(geo.display, 'the toggle row renders as a flex line inside the modal').toBe('flex')
  expect(parseFloat(geo.minHeight), 'the toggle row carries the 44px touch floor').toBeGreaterThanOrEqual(44)
  expect(geo.inputStretch, 'the checkbox must not stretch to the row width (the old grid bug)').toBeLessThan(200)

  // the toggle: label flips IN PLACE, the ok toast lands, the enable persists
  const state = row.locator('.pd-cat-toggle-state')
  await expect(state).toHaveText('Off')
  await row.locator('input[type="checkbox"]').click()
  await expect(state, 'the On/Off label syncs in place (no scroll-snapping repaint)').toHaveText('On')
  await expect(page.locator('#toast')).toContainText('Category enabled')
  const enabled = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}/categories`)
    const j = await r.json()
    return j.enabled as string[]
  }, PROJECT_ID)
  expect(enabled).toContain(CAT_ID)
})

test('the composer: the block-7 setup prompt is retired — no interruption, the picker stands alone', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJECT_ID}`)
  await page.locator('[data-pd-add]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.click('[data-pd-add]')
  const modal = page.locator('#pd-taskadd-modal')
  await expect(modal).toBeVisible()
  // THE S172 pin: the 639px setup block is gone from the composer entirely
  await expect(modal.locator('#pd-taskadd-cat-setup')).toHaveCount(0)
  await expect(modal.locator('.pd-cat-setup')).toHaveCount(0)
  // the category picker field remains (the picker's inline Create auto-enables)
  await expect(modal.locator('#pd-taskadd-cat-field')).toHaveCount(1)
})

// ---------------------------------------------------------------------------
// (2) S171 — the lean page
// ---------------------------------------------------------------------------
test('lean page: the Created·Updated meta line renders (EN units, 3d ago from the seed)', async ({ page }) => {
  await login(page)
  await page.goto(`/spark.html?id=${SPARK_A}`)
  const meta = page.locator('#spark-meta')
  await expect(meta).toBeVisible()
  await expect(meta).toContainText('Created 3d ago')
  await expect(meta).toContainText('Updated 3d ago')
})

test('lean page (FA): the meta line speaks Persian units with Persian digits', async ({ page }) => {
  await login(page, { as: FA_EMAIL })
  await page.goto(`/spark.html?id=${SPARK_FA}`)
  const meta = page.locator('#spark-meta')
  await expect(meta).toBeVisible()
  await expect(meta).toContainText('ساخته‌شده ۳ روز پیش')
  await expect(meta).toContainText('به‌روزرسانی ۳ روز پیش')
})

test('lean page: the beforeunload guard arms on edit and disarms after Save', async ({ page }) => {
  await login(page)
  await page.goto(`/spark.html?id=${SPARK_A}`)
  await page.locator('#spark-title').waitFor({ state: 'visible', timeout: 15_000 })

  const guard = () => page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  })
  expect(await guard(), 'pristine page: the guard is disarmed').toBe(false)

  await page.fill('#spark-title', 'needle in title — edited')
  await page.waitForTimeout(150) // markDirty rides the input event
  expect(await guard(), 'dirty page: the guard intercepts the unload').toBe(true)

  await page.click('#spark-save')
  await expect(page.locator('#spark-status')).toContainText('Saved')
  expect(await guard(), 'after Save: the guard is disarmed again').toBe(false)
})

// ---------------------------------------------------------------------------
// (3) Backlog — the ?q= deep-link, the highlight + the match badges, self-heal
// ---------------------------------------------------------------------------
test('sparks ?q= deep-link: the input prefills, the initial fetch carries it, the highlight + match badges render', async ({ page }) => {
  await login(page)
  await page.goto(`/sparks.html?q=${NEEDLE}`)
  // the input carries the deep-linked query and the clear button is visible from frame one
  await expect(page.locator('#sparks-q')).toHaveValue(NEEDLE)
  await expect(page.locator('#sparks-q-clear')).toBeVisible()
  // the shelf settles on the four matches (title/desc/tag/folder)
  await page.locator(`#spark-shelf [data-project-id="${SPARK_A}"]`).waitFor({ state: 'visible', timeout: 15_000 })
  const count = await page.locator('#spark-shelf [data-project-id]').count()
  expect(count).toBe(4)
  await expect(page.locator('#sparks-q-count')).toContainText('4 matches')

  // the highlight: the title match lights up in place
  const marks = await page.$$eval('#spark-shelf mark.spark-hit', (els) => els.map((e) => e.textContent || ''))
  expect(marks, 'the matched substring is marked').toContain(NEEDLE)

  // the badges: WHY each row matched — one pill per reason
  await expect(page.locator(`#spark-shelf [data-project-id="${SPARK_A}"] .spark-hit-badge`, { hasText: 'Title' })).toHaveCount(1)
  await expect(page.locator(`#spark-shelf [data-project-id="${SPARK_B}"] .spark-hit-badge`, { hasText: 'Description' })).toHaveCount(1)
  await expect(page.locator(`#spark-shelf [data-project-id="${SPARK_C}"] .spark-hit-badge`, { hasText: 'Tag: needleish' })).toHaveCount(1)
  await expect(page.locator(`#spark-shelf [data-project-id="${SPARK_D}"] .spark-hit-badge`, { hasText: `Folder: ${FOLDER_NAME}` })).toHaveCount(1)
})

test('a dead remembered folder self-heals — the pref clears and the grid home renders', async ({ page }) => {
  await login(page)
  await page.addInitScript((deadId) => {
    try { localStorage.setItem('hibana-sparks-folder', JSON.stringify({ id: deadId, name: 'ghost' })) } catch { /* storage blocked */ }
  }, DEAD_FOLDER_ID)
  await page.goto('/sparks.html')
  // the heal fires after the first swap: the pref + input reset and the folder GRID
  // (the home) renders — not the dead folder's empty view
  await page.locator('#spark-shelf .spark-folder-card').first().waitFor({ state: 'visible', timeout: 15_000 })
  await expect(page.locator('#spark-folder')).toHaveValue('')
  const pref = await page.evaluate(() => localStorage.getItem('hibana-sparks-folder'))
  expect(pref, 'the dead pref is cleared from storage').toBeNull()
})

// ---------------------------------------------------------------------------
// (4) Backlog — the promote dialog, keyboard-driven
// ---------------------------------------------------------------------------
test('the promote dialog drives purely by keyboard: arrows change the stage, Enter submits, the status lands', async ({ page }) => {
  await login(page)
  // ?folder=all — the shelf boots into the flat all-ideas list (a bare /sparks.html
  // boots to the folder GRID home, where idea cards don't render)
  await page.goto('/sparks.html?folder=all')
  const card = page.locator(`#spark-shelf [data-project-id="${PROMOTE_ID}"]`)
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.locator('[data-menu-open]').click()
  await card.locator('[data-spark-promote]').click()
  const dlg = page.locator('#spark-promote-dialog')
  await expect(dlg).toBeVisible()

  // KEYBOARD ONLY from here: the stage select walks down (planning → queued),
  // then Tab reaches Save and Enter submits the form
  await page.focus('#sp-status')
  await page.keyboard.press('ArrowDown')
  const stage = await page.$eval('#sp-status', (el) => (el as HTMLSelectElement).value)
  expect(stage).toBe('queued')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('#toast')).toContainText('Promoted')

  // the API truth: the idea left the shelf and carries the keyboard-chosen stage
  const status = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/projects/${pid}`)
    const j = await r.json()
    return j.project?.status as string
  }, PROMOTE_ID)
  expect(status).toBe('queued')
})

// ---------------------------------------------------------------------------
// (5) Backlog — the palette's Idea folders quick-jump
// ---------------------------------------------------------------------------
test('the palette: the Idea folders group lists the folder and quick-jumps into its view', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html')
  await page.locator('#spark-shelf').waitFor({ state: 'visible', timeout: 15_000 })
  await page.keyboard.press('Control+k')
  const list = page.locator('#cmdk-list')
  await expect(list).toBeVisible()
  const group = list.locator('.cmdk-group-label', { hasText: 'Idea folders' })
  await expect(group).toHaveCount(1)
  const row = list.locator('.cmdk-item', { hasText: FOLDER_NAME })
  await expect(row).toHaveCount(1)
  await row.click()
  await page.waitForURL(`**/sparks.html?folder=${FOLDER_ID}**`)
  // the deep-link lands the folder view on the FIRST fetch: the header renders,
  // the chip goes active, and the folder's idea is present
  await page.locator(`#spark-shelf [data-project-id="${SPARK_D}"]`).waitFor({ state: 'visible', timeout: 15_000 })
  await expect(page.locator(`#spark-shelf .sf-chip[data-sf="${FOLDER_ID}"]`)).toHaveClass(/is-active/)
})
