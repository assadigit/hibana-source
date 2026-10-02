// e2e/s186-cta-grammar.spec.ts — S186 (the owner's CTA round): the app-wide
// button grammar, verified in the live DOM.
//   1. THE CROP INCIDENT (the round's origin): the Crop-banner modal's Apply is
//      the view's ONE primary — the shared bare-button grammar (solid teal
//      var(--cta) fill + var(--btn-text) ink) at the TRAILING end — and Cancel
//      is the NEUTRAL secondary beside it (ghost + var(--text) ink, no teal
//      text). The on-teal label clears AA (≥4.5:1) by the WCAG luminance math,
//      computed in-page from the real computed styles.
//   2. THE FOOTER GRAMMAR: the promote dialog's row is [secondary…, primary] —
//      Cancel first (ghost), Save LAST (the trailing-end submit, bare-button
//      teal). Mirrors under RTL (flex row), so DOM order is the pin.
//   3. THE DROPDOWN LIFT: every ⋯ menu opens as a <body>-level portal
//      (window.hibanaMenu — body > .spark-menu-pop.is-floating), so no card's
//      overflow:hidden can clip it; the pop rect sits INSIDE the viewport
//      (clamped/shifted); Escape and scroll both close it.
//   4. THE NOTES PAGE (the owner's revised block): on phones the header "New
//      note" retires and the sort owns the row; while the vault is EMPTY the
//      empty-state "New note" is the page's only primary; once a note exists
//      the empty-state button is gone (the global FAB is the only phone
//      creation entry); on desktop the header button stays the page primary.
//      Creation boots directly via /notes?new=1 (the shared-helper lesson).
//   5. THE FAB (the app-shell exemption): the global "+" rides notes.html now
//      — always visible, the shared primary style (solid teal circle), and its
//      "New note" item lands on /notes?new=1 with a fresh focused note.
// Run: npx playwright test e2e/s186-cta-grammar.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s186@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const SPARK_ID = 'e2e-s186-spark'

// The shared primary's tokens (light theme), in Chromium's computed rgb() form.
const CTA = 'rgb(46, 123, 127)'      // --cta #2E7B7F — the solid teal fill
const ON_CTA = 'rgb(255, 255, 255)'  // --btn-text — the on-teal label
const NEUTRAL_INK = 'rgb(20, 20, 20)' // --text #141414 — the secondary's ink

// A 1×1 PNG — enough for the crop dialog's cover-fit stage.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s186', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${SPARK_ID}', '${USER_ID}', 'S186 cta spark', 'the round\u2019s probe idea', 'personal', 'spark', 0, '${now}', '${now}')`,
  )
  // Fillers so the shelf genuinely overflows the viewport — the scroll closer
  // needs a real scrollable page, not a one-card list that fits.
  for (let i = 2; i <= 12; i++) {
    db.exec(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
       VALUES ('${SPARK_ID}-${i}', '${USER_ID}', 'S186 filler spark ${i}', 'filler', 'personal', 'spark', ${i}, '${now}', '${now}')`,
    )
  }
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

// The WCAG relative-luminance contrast ratio, computed in-page from computed
// styles — the proof the on-teal label clears AA on the real rendered fill.
const CONTRAST_FN = `(() => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const lum = (r, g, b) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  const parse = (s) => s.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/).slice(1, 4).map(Number)
  return (a, b) => {
    const [r1, g1, b1] = parse(a), [r2, g2, b2] = parse(b)
    const L1 = lum(r1, g1, b1), L2 = lum(r2, g2, b2)
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2)
    return (hi + 0.05) / (lo + 0.05)
  }
})()`

test('the crop incident: Apply is the ONE solid-teal primary (AA label) at the trailing end; Cancel is the neutral secondary', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html?folder=all')
  const card = page.locator(`#spark-shelf .spark-card[data-project-id="${SPARK_ID}"]`)
  await expect(card).toBeVisible({ timeout: 15_000 })

  // Drive the crop dialog directly (the banner picker's pick path — image-crop.js
  // exposes openCrop; the dialog itself is what the incident was about). The PNG
  // bytes are built with atob — the page CSP blocks fetch('data:…') round-trips.
  await page.evaluate((b64) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const file = new File([bytes], 'banner.png', { type: 'image/png' })
    ;(window as unknown as Record<string, unknown>).__s186Crop = (window as unknown as { hibanaImageCrop: { openCrop: (f: File, o: { aspect: number }) => Promise<unknown> } }).hibanaImageCrop.openCrop(file, { aspect: 2.5 })
  }, PNG_1X1)
  const dlg = page.locator('#hibana-crop-dialog')
  await expect(dlg).toBeVisible({ timeout: 5_000 })

  // The row: [Cancel (ghost secondary), Apply (bare primary)] — the trailing end.
  const row = dlg.locator('.row')
  const cancel = row.locator('[data-crop-cancel]')
  const apply = row.locator('[data-crop-apply]')
  await expect(cancel).toHaveClass(/ghost/)
  await expect(apply).not.toHaveClass(/ghost/)
  expect(await row.locator('button').last().getAttribute('data-crop-apply')).not.toBeNull()

  // The shared primary grammar: solid teal fill + on-teal label (the bare-button
  // rules ARE the component — "Capture an idea"'s own style).
  await expect(apply).toHaveCSS('background-color', CTA)
  await expect(apply).toHaveCSS('color', ON_CTA)
  // The neutral secondary: ghost ink reads var(--text) — teal text retired.
  await expect(cancel).toHaveCSS('color', NEUTRAL_INK)

  // AA on the real rendered pair: the on-teal label vs the teal fill ≥ 4.5:1.
  const ratio = await page.evaluate(`(${CONTRAST_FN})(${JSON.stringify(CTA)}, ${JSON.stringify(ON_CTA)})`)
  expect(ratio).toBeGreaterThanOrEqual(4.5)

  // Cancel closes — the promise resolves null (cancelled), the placeholder stays.
  await cancel.click()
  await expect(dlg).toHaveCount(0)
})

test('the footer grammar: the promote dialog is [Cancel (secondary), Save (primary)] — the submit rides the trailing end', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html?folder=all')
  const card = page.locator(`#spark-shelf .spark-card[data-project-id="${SPARK_ID}"]`)
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.hover()
  await card.locator('[data-menu-open]').click()
  // S186: the pop is page-scoped while it floats on <body>.
  await page.locator('body > .spark-menu-pop.is-floating [data-spark-promote]').click()
  const dlg = page.locator('#spark-promote-dialog')
  await expect(dlg).toBeVisible()

  const row = dlg.locator('.row')
  const buttons = row.locator('button')
  expect(await buttons.count()).toBeGreaterThanOrEqual(2)
  // DOM order: the ghost Cancel FIRST, the submit Save LAST (the trailing end).
  await expect(buttons.first()).toHaveClass(/ghost/)
  expect(await buttons.last().getAttribute('id')).toBe('sp-save')
  expect(await buttons.last().getAttribute('type')).toBe('submit')
  await expect(buttons.last()).not.toHaveClass(/ghost/)
  // And the two grammars read exactly as the rule says.
  await expect(buttons.last()).toHaveCSS('background-color', CTA)
  await expect(buttons.first()).toHaveCSS('color', NEUTRAL_INK)

  await dlg.locator('#sp-cancel').click()
  await expect(dlg).toHaveCount(0)
})

test('the dropdown lift: the ⋯ menu floats on <body> (un-clipped, inside the viewport) and Escape + scroll close it', async ({ page }) => {
  await login(page)
  await page.goto('/sparks.html?folder=all')
  const card = page.locator(`#spark-shelf .spark-card[data-project-id="${SPARK_ID}"]`)
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.hover()
  await card.locator('[data-menu-open]').click()

  // The lift: the pop is a DIRECT child of <body> while open — no card's
  // overflow:hidden, scrollport, or stacking context can ever clip it again.
  const pop = page.locator('body > .spark-menu-pop.is-floating')
  await expect(pop).toBeVisible()
  expect(await pop.count()).toBe(1)

  // The collision handling: the pop rect sits fully INSIDE the viewport
  // (clamped + shifted), anchored to its button.
  const rect = await pop.boundingBox()
  const vp = page.viewportSize() ?? { width: 1280, height: 720 }
  expect(rect).toBeTruthy()
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.y).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(vp.width)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(vp.height)

  // Escape docks it back — nothing floats anymore.
  await page.keyboard.press('Escape')
  await expect(page.locator('body > .spark-menu-pop.is-floating')).toHaveCount(0)
  await expect(pop).toBeHidden()

  // Re-open, then a scroll closes it too (the anchor scrolls away).
  await card.hover()
  await card.locator('[data-menu-open]').click()
  await expect(page.locator('body > .spark-menu-pop.is-floating')).toHaveCount(1)
  await page.evaluate(() => window.scrollBy(0, 400))
  await expect(page.locator('body > .spark-menu-pop.is-floating')).toHaveCount(0)
})

test('the Notes page: phones retire the header button (sort owns the row, empty-state is the only primary while empty, FAB after); desktop keeps the header primary', async ({ page }) => {
  await login(page)

  // PHONE, EMPTY VAULT: the header "New note" is retired, the sort is the row,
  // and the empty-state "New note" is the page's only primary CTA.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/notes.html')
  const headerNew = page.locator('.vault-list-tools .vault-new[data-vault-new]')
  await expect(page.locator('#vault-sort')).toBeVisible({ timeout: 10_000 })
  await expect(headerNew).toHaveCSS('display', 'none')
  const emptyNew = page.locator('.vault-empty .vault-new[data-vault-new]')
  await expect(emptyNew).toBeVisible({ timeout: 10_000 })
  await expect(emptyNew).toHaveCSS('background-color', CTA)
  // The global FAB is an app-shell element — always visible, even here.
  await expect(page.locator('.fab[data-fab-toggle]')).toBeVisible()

  // Create the first note by booting the flow directly (/notes?new=1 — the
  // shared-helper lesson: never depend on a transient button).
  await page.goto('/notes.html?new=1')
  await expect(page.locator('[data-vault-title]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-vault-title]')).toBeFocused()
  await page.fill('[data-vault-title]', 'S186 cta note')
  await expect(page.locator('[data-vault-save][data-state="saved"]')).toBeVisible({ timeout: 6_000 })

  // PHONE, VAULT NO LONGER EMPTY: the empty state (and its button) are GONE —
  // the global floating "+" is the only creation entry left on the phone.
  await page.goto('/notes.html')
  await expect(page.locator('.vault-cards .vault-card-title').first()).toContainText('S186 cta note', { timeout: 10_000 })
  await expect(page.locator('.vault-empty .vault-new[data-vault-new]')).toHaveCount(0)
  await expect(page.locator('.fab[data-fab-toggle]')).toBeVisible()
  await expect(headerNew).toHaveCSS('display', 'none')

  // DESKTOP: the header "New note" stays the page primary (teal), and with
  // notes existing the empty-state twin is gone here too — one primary.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/notes.html')
  await expect(page.locator('.vault-cards .vault-card-title').first()).toContainText('S186 cta note', { timeout: 10_000 })
  await expect(headerNew).toBeVisible()
  await expect(headerNew).toHaveCSS('background-color', CTA)
  await expect(page.locator('.vault-empty .vault-new[data-vault-new]')).toHaveCount(0)
})

test('the FAB on notes: the app-shell exemption rides the shared primary style and its New note lands on a fresh focused note', async ({ page }) => {
  await login(page)
  await page.goto('/notes.html')

  // The global "+" now lives on the notes page too — always visible, and it
  // wears the shared primary grammar (the solid teal circle + white glyph).
  const fab = page.locator('.fab[data-fab-toggle]')
  await expect(fab).toBeVisible({ timeout: 10_000 })
  await expect(fab).toHaveCSS('background-color', CTA)
  await expect(fab).toHaveCSS('color', ON_CTA)
  await expect(fab).toHaveCSS('border-radius', '50%')

  // The quick-add set: idea / project / note (vault) / quick note.
  await fab.click()
  const menu = page.locator('[data-fab-menu]')
  await expect(menu).toBeVisible()
  await expect(page.locator('[data-fab-menu] .fab-item')).toHaveCount(4)
  const vaultItem = page.locator('.fab-item[data-i18n-title="fab.vault"]')
  await expect(vaultItem).toBeVisible()
  await expect(vaultItem).toHaveAttribute('href', '/notes.html?new=1')

  // Landing on /notes?new=1 boots a fresh focused note (the param consumed).
  await vaultItem.click()
  await page.waitForURL('**/notes.html?new=1', { timeout: 10_000 })
  await expect(page.locator('[data-vault-title]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-vault-title]')).toBeFocused()
  await expect(page.locator('[data-vault-title]')).toHaveValue('')
})
