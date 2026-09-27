// e2e/s159-sparks-kanban-bar.spec.ts — S159 (the sparks folder-Kanban becomes a
//   first-class folder manager):
//   (1) FEATURE — the sf-bar folder bar rides the kanban view ALWAYS. The kanban
//       home used to drop it (the bar rendered only when a folder was selected),
//       so in kanban home the New-folder (+), rename/delete (⋯), the All/
//       No-folder filters and the folder counts were ALL unreachable — the
//       affordances appeared and vanished with the folder state.
//   (2) STYLING — the folder column's head joins the app's shared board-column
//       convention (S85/S137: [glyph] [label] [count pill]; it was a bare <h4>
//       with a .chip pill glyph and a plain muted count — the pre-S85 look).
//       The count rides the shared .board-count pill with its NEUTRAL muted ink
//       (folders carry no status role → no --badge-fg assignment).
// Pins:
//   (1) kanban home (no folder): the .sf-bar exists inside the shelf and carries
//       the New-folder chip (+), the folder chips with their ⋯ (data-sf-menu),
//       and the honest no-active-chip state.
//   (2) every column head: .kanban-col-head + .kanban-col-label + .board-count
//       (pill shape computed) + the glyph slot — on the emoji face AND the
//       folder-plus fallback face (the No-folder column).
//   (3) the pill's computed ink is the NEUTRAL muted rung (no status tint).
//   (4) FA/RTL: the same pins (the head is flex — logical, auto-flips) + no
//       h-scroll with the bar present.
//   (5) 390px: the bar wraps, no h-scroll.
//   (6) a folder-selected kanban keeps working: chip click → active chip + the
//       filtered board re-renders.
// Spec lessons banked (S158): seeded spark_folders ids MUST be dashed 36-char
//   UUIDs (crypto.randomUUID) — the quick-add's folder_id guard rejects bare hex;
//   rows are user-scoped — the FA user needs their OWN folder + spark.
// Run: npx playwright test e2e/s159-sparks-kanban-bar.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s159@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const FA_EMAIL = 'e2e-s159-fa@test.local'
const FA_USER_ID = randomBytes(16).toString('hex')
const FOLDER_ID = crypto.randomUUID() // S158 lesson: dashed 36-char UUID
const FOLDER_NAME = 's159 kb folder'
const IN_FOLDER_ID = randomBytes(16).toString('hex')
const UNFILED_ID = randomBytes(16).toString('hex')
const FA_FOLDER_ID = crypto.randomUUID()
const FA_SPARK_ID = randomBytes(16).toString('hex')

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
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}'))`)
    db.exec(`DELETE FROM spark_folders WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}'))`)
    db.exec(`DELETE FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}')`)
  } catch { /* first run */ }
  for (const [uid, uname, uemail, lang] of [[USER_ID, 'e2e-s159', TEST_EMAIL, 'en'], [FA_USER_ID, 'e2e-s159-fa', FA_EMAIL, 'fa']] as const) {
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${uid}', '${uname}', '${uemail}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
  }
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, icon, sort_order, created_at)
     VALUES ('${FOLDER_ID}', '${USER_ID}', '${FOLDER_NAME}', '✒️', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${IN_FOLDER_ID}', '${USER_ID}', 's159 filed spark', '', 'personal', 'spark', 0, '${FOLDER_ID}', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${UNFILED_ID}', '${USER_ID}', 's159 unfiled spark', '', 'personal', 'spark', 1, NULL, '${now}', '${now}')`,
  )
  // the FA user's own surface (rule 1: rows are user-scoped)
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, sort_order, created_at)
     VALUES ('${FA_FOLDER_ID}', '${FA_USER_ID}', 'پوشهٔ تست', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${FA_SPARK_ID}', '${FA_USER_ID}', 'ایدهٔ تست', '', 'personal', 'spark', 0, '${FA_FOLDER_ID}', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page, opts?: { as?: string }) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.setItem('hibana-sparks-view', 'kanban') // boot straight into the folder board
      localStorage.removeItem('hibana-sparks-folder')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', opts?.as ?? TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

// the kanban home: the shelf should be [sf-bar, .kanban] with the full folder
// affordance set — the S159 contract.
async function openKanbanHome(page: Page) {
  await page.goto('/sparks.html')
  const kan = page.locator('#spark-shelf .kanban')
  await kan.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(400) // let the 30s poll quiesce — the swap is the target
  return kan
}

test('kanban home: the folder bar rides the board — New-folder + ⋯ + counts, no active chip', async ({ page }) => {
  await login(page)
  await openKanbanHome(page)

  const bar = page.locator('#spark-shelf .sf-bar')
  await expect(bar).toBeVisible()
  // the New-folder affordance is reachable in kanban home (the S159 gap)
  await expect(bar.locator('[data-sf-new]')).toHaveCount(1)
  // the folder chip + its ⋯ (rename/delete) ride the bar
  const item = bar.locator(`.sf-item[data-sf-icon]`).filter({ hasText: FOLDER_NAME })
  await expect(item).toHaveCount(1)
  await expect(item.locator('[data-sf-menu]')).toHaveCount(1)
  // kanban home applies NO filter — no chip is active (the honest state)
  const active = await page.$$eval('#spark-shelf .sf-chip.is-active', (els) => els.map((e) => e.className))
  expect(active, 'no chip should be active in kanban home (no filter applied)').toEqual([])
  // the bar sits INSIDE the shelf, above the board
  const kids = await page.$$eval('#spark-shelf > *', (els) => els.map((e) => e.tagName + '.' + String(e.className).split(' ')[0]))
  expect(kids[0]).toContain('sf-bar')
  expect(kids[1]).toContain('kanban')
})

test('every column head joins the S85/S137 board-column recipe — glyph + label + count pill (emoji AND fallback faces)', async ({ page }) => {
  await login(page)
  await openKanbanHome(page)

  const heads = page.locator('#spark-shelf .kanban-col[data-spark-folder] h4')
  await expect(heads).toHaveCount(2) // the seeded folder + No-folder
  for (const h of await heads.all()) {
    await expect(h).toHaveClass(/kanban-col-head/)
    await expect(h.locator('.spark-kb-glyph')).toHaveCount(1)
    await expect(h.locator('.kanban-col-label')).toHaveCount(1)
    await expect(h.locator('.board-count')).toHaveCount(1)
  }
  // the emoji face (the seeded folder's ✒️) and the fallback face (No-folder's
  // folder-plus svg) BOTH ride the glyph slot
  const glyphs = await page.$$eval('#spark-shelf .kanban-col .spark-kb-glyph', (els) => els.map((e) => ({ emoji: !!e.textContent?.trim().match(/✒/), icon: !!e.querySelector('svg.icon') })))
  expect(glyphs.some((g) => g.emoji)).toBe(true)
  expect(glyphs.some((g) => g.icon)).toBe(true)

  // the pill: the shared shape computes, and the ink is the NEUTRAL muted rung
  // (folders carry no status role — no --badge-fg assignment)
  const pill = await page.evaluate(() => {
    const el = document.querySelector('#spark-shelf .kanban-col .board-count') as HTMLElement
    const cs = getComputedStyle(el)
    return { radius: cs.borderRadius, color: cs.color, tabular: cs.fontVariantNumeric }
  })
  expect(pill.radius, 'the count rides the shared pill shape').toBe('999px')
  expect(pill.tabular).toBe('tabular-nums')
  expect(pill.color, 'the folder pill ink is the neutral muted rung (#5C5C5C light)').toBe('rgb(92, 92, 92)')
  // the label carries the folder name; the count is the honest number
  const filedHead = page.locator(`#spark-shelf .kanban-col[data-spark-folder="${FOLDER_ID}"]`)
  await expect(filedHead.locator('.kanban-col-label')).toHaveText(FOLDER_NAME)
  await expect(filedHead.locator('.board-count')).toHaveText('1')
})

test("the owner's FA/RTL surface: the same bar + recipe pins hold, no h-scroll", async ({ page }) => {
  await login(page, { as: FA_EMAIL })
  await openKanbanHome(page)
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')

  await expect(page.locator('#spark-shelf .sf-bar')).toBeVisible()
  await expect(page.locator('#spark-shelf .sf-bar [data-sf-new]')).toHaveCount(1)
  const faHead = page.locator('#spark-shelf .kanban-col[data-spark-folder] h4.kanban-col-head')
  await expect(faHead.first()).toBeVisible()
  await expect(faHead.first().locator('.board-count')).toHaveCount(1)

  const r = await page.evaluate(() => ({
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
    heads: document.querySelectorAll('.kanban-col-head .board-count').length,
  }))
  expect(r.noHScroll, 'RTL kanban home with the bar must not h-scroll').toBe(true)
  expect(r.heads).toBeGreaterThanOrEqual(2)
})

test('390px: the bar wraps, the board stays contained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await openKanbanHome(page)
  const r = await page.evaluate(() => {
    const bar = document.querySelector('#spark-shelf .sf-bar') as HTMLElement
    const shelf = document.querySelector('#spark-shelf') as HTMLElement
    const br = bar.getBoundingClientRect()
    const sr = shelf.getBoundingClientRect()
    return {
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
      wraps: getComputedStyle(bar).flexWrap,
      barInside: br.left >= sr.left - 1 && br.right <= sr.right + 1,
      cols: document.querySelectorAll('#spark-shelf .kanban-col').length,
    }
  })
  expect(r.noHScroll, '390px kanban home must not h-scroll').toBe(true)
  expect(r.wraps, 'the bar must be allowed to wrap on narrow viewports').toBe('wrap')
  expect(r.barInside).toBe(true)
})

test('a folder-selected kanban keeps working: chip click → active chip + the filtered board', async ({ page }) => {
  await login(page)
  await openKanbanHome(page)

  const chip = page.locator(`#spark-shelf .sf-bar [data-sf="${FOLDER_ID}"]`)
  await chip.click()
  // the chip becomes active; the board re-renders scoped to the folder (the one
  // filed card is still present; the input carries the selection)
  await expect(page.locator(`#spark-shelf .sf-chip[data-sf="${FOLDER_ID}"]`)).toHaveClass(/is-active/)
  await expect(page.locator('#spark-shelf .kanban')).toBeVisible()
  const r = await page.evaluate(([inId, unId]) => ({
    folder: (document.getElementById('spark-folder') || {}).value,
    filed: !!document.querySelector(`#spark-shelf .kanban-card[data-project-id="${inId}"]`),
    unfiled: !!document.querySelector(`#spark-shelf .kanban-card[data-project-id="${unId}"]`),
  }), [IN_FOLDER_ID, UNFILED_ID])
  expect(r.folder).toBe(FOLDER_ID)
  expect(r.filed, 'the folder card stays on the board (its own column)').toBe(true)
  expect(r.unfiled, 'the unfiled idea is filtered OUT of the folder-scoped board').toBe(false)
})
