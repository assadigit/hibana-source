// e2e/s102-pale-quadrant.spec.ts — the PALE QUADRANT round (owner's two instructions).
//
// WHY THIS FILE EXISTS (S102): the owner reported (1) "the colors are too saturated —
// more pastel, more pale" and (2) "selecting a color doesn't change the quadrant color,
// but it MUST." Root cause of (2) was NOT a bug but the S95 r2 "restraint rule" — the
// quadrant BOX wash had been retired app-wide, so a pick only re-inked small elements
// (title 52% / count 65% / the icon at FULL saturation — the saturation behind (1)).
// S102 brings the box wash BACK pale (7% fill + 30% edge light; 11%/32% claude-dark)
// and drops every small-element mix.
//
// These specs pin the OWNER-VISIBLE contract on BOTH picker surfaces — the dashboard
// popover (server-rendered swatches; the S101 escaped-swatch bug class survived six
// sessions because no test ever OPENED that popover) and the /to-do-list board's rename
// popover — by asserting the QUADRANT'S OWN COMPUTED BACKGROUND flips from the neutral
// white card to the EXACT pale wash (coral #D08A77 at 7% over #FFFFFF = rgb(252, 247,
// 245)) and back to neutral on the ∅ clear. The exact rgb pins BOTH requirements: a
// pick must change the box, and the change must stay pastel (a re-saturated 12% wash
// would compute rgb(245, 238, 235) and fail).
// Run: npx playwright test e2e/s102-pale-quadrant.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s102@test.local'
const TEST_PASS = 'e2e-password-123'
// The picked token + the EXACT computed washes it must produce (light theme, the
// neutral #FFFFFF card): coral #D08A77 = rgb(208, 138, 119).
//   fill      7% over card → rgb(252, 247, 245)
//   title ink 38% over #262118 → rgb(103, 73, 60)
//   border    30% over #D4D4D4 → rgb(211, 190, 184)
const CORAL_FILL = '252,247,245'
const CORAL_TITLE = '103,73,60'
const CORAL_BORDER = '211,190,184'
const NEUTRAL_CARD = '255,255,255'

// Chromium serializes computed color-mix() values as `color(srgb r g b)` (0–1 floats)
// while plain colors come back as `rgb(r, g, b)` — normalize BOTH to a "r,g,b" string
// of 0–255 ints so the pins below are form-agnostic. (color(srgb 0.987098 0.967882
// 0.962667) = rgb(252, 247, 245) — the exact 7% coral-over-white wash.)
// NEVER throws: transient forms — a mid-TRANSITION oklab() snapshot (Chrome
// interpolates color transitions in oklab) or '' read off a node detached by the
// board's buildGrid repaint — pass through raw, never equal an "r,g,b" pin, and
// expect.poll retries until the value settles. (Throwing here instead would ABORT
// the poll on its first frame — the exact flake this helper replaced.)
function computedRgb(value: string): string {
  const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)
  if (rgb) return `${rgb[1]},${rgb[2]},${rgb[3]}`
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value)
  if (srgb) return srgb.slice(1).map((n) => Math.round(Number(n) * 255)).join(',')
  return value
}

let USER_ID = ''

// Seed the test user before tests run (migrations auto-run on server boot).
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
  USER_ID = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM sadhana_quadrant_names WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s102', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

// Leave the seed DB exactly as we found it (neutral quadrants) — other specs + the
// post-suite live QA share /tmp/hibana-e2e.db.
test.afterAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  try { db.exec(`DELETE FROM sadhana_quadrant_names WHERE user_id = '${USER_ID}'`) } catch { /* gone */ }
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see viewport.spec.ts): let the claim + reload settle.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

const swatchErrors = [/Failed to load resource.*401/, /Failed to load resource.*404/]

test.describe('S102 pale quadrant (dashboard popover)', () => {
  test('picking a swatch recolors THE QUADRANT box, pale — and ∅ returns it to neutral', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !swatchErrors.some((p) => p.test(msg.text()))) errors.push(msg.text())
    })

    await login(page)
    await page.goto('/app')
    const quad = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"]')
    await expect(quad).toBeVisible()

    // Neutral start: the plain white card (the S95-r2 language the owner overruled).
    const neutralBg = computedRgb(await quad.evaluate((el) => getComputedStyle(el).backgroundColor))
    expect(neutralBg).toBe(NEUTRAL_CARD)

    // Open the customize popover (the S101 escaped-swatch surface — no test had ever
    // opened it before; 68 real swatch buttons must be in there).
    await quad.locator('[data-dash-style="1"]').first().click()
    const pop = quad.locator('[data-dash-style-pop="1"]')
    await expect(pop).toBeVisible()
    await expect(pop.locator('.dash-style-swatch:not(.dash-style-swatch-none)')).toHaveCount(16)
    await expect(pop.locator('.dash-style-swatch-none')).toHaveCount(1)

    // Pick coral → the PATCH must fire AND the box must flip to the EXACT pale wash.
    const patch = page.waitForResponse((r) => r.url().includes('/api/sadhana/quadrants/1') && r.request().method() === 'PATCH' && r.status() === 200)
    await pop.locator('[data-dash-accent="accent-coral"]').click()
    await patch
    await expect
      .poll(async () => computedRgb(await quad.evaluate((el) => getComputedStyle(el).backgroundColor)), { timeout: 5_000 })
      .toBe(CORAL_FILL)
    // The border edge + the title ink join the pale language (38% over the text ink).
    await expect
      .poll(async () => computedRgb(await quad.evaluate((el) => getComputedStyle(el).borderTopColor)), { timeout: 5_000 })
      .toBe(CORAL_BORDER)
    await expect
      .poll(async () => computedRgb(await quad.locator('.dash-todo-qtitle strong').evaluate((el) => getComputedStyle(el).color)), { timeout: 5_000 })
      .toBe(CORAL_TITLE)
    // The picked chip reflects the state.
    await expect(pop.locator('[data-dash-accent="accent-coral"]')).toHaveClass(/is-selected/)

    // ∅ clears back to the neutral quadrant — the box returns to plain white.
    const clear = page.waitForResponse((r) => r.url().includes('/api/sadhana/quadrants/1') && r.request().method() === 'PATCH' && r.status() === 200)
    await pop.locator('[data-dash-accent="none"]').click()
    await clear
    await expect
      .poll(async () => computedRgb(await quad.evaluate((el) => getComputedStyle(el).backgroundColor)), { timeout: 5_000 })
      .toBe(NEUTRAL_CARD)

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
  })
})

test.describe('S102 pale quadrant (board rename popover)', () => {
  test('pick → save repaints THE QUADRANT box pale; ∅ restores the neutral board', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !swatchErrors.some((p) => p.test(msg.text()))) errors.push(msg.text())
    })

    await login(page)
    await page.goto('/to-do-list')
    const quad = page.locator('#Q1.quadrant')
    await expect(quad).toBeVisible()

    // Neutral start: the board's plain white surface.
    const neutralBg = computedRgb(await quad.evaluate((el) => getComputedStyle(el).backgroundColor))
    expect(neutralBg).toBe(NEUTRAL_CARD)

    // The ✎ pen (hover-revealed on the title row) opens the rename + symbol + pastel
    // popover — the swatch row only exists once it opens (buildQeSwatches on openQEdit).
    await quad.locator('.q-title-row').hover()
    await quad.locator('.q-pen').click()
    const pop = page.locator('#qePop')
    await expect(pop).toHaveClass(/open/)
    // 17 = 16 color chips + the ∅ clear (it carries both classes) — the S101 pin's count.
    await expect(pop.locator('.qe-swatch')).toHaveCount(17)
    await expect(pop.locator('.qe-swatch-none')).toHaveCount(1)
    // The chips preview the PALE quadrant (50% over the surface), never the full ink —
    // every channel sits well above the full-saturation coral rgb(208, 138, 119).
    const chipBg = computedRgb(await pop
      .locator('.qe-swatch[style*="accent-coral"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor))
    const [chipR, chipG, chipB] = chipBg.split(',').map(Number)
    expect(chipR).toBeGreaterThan(208)
    expect(chipG).toBeGreaterThan(138)
    expect(chipB).toBeGreaterThan(119)

    // Pick coral + save → PATCH → the board repaints with the inline --q-accent and
    // the BOX must carry the pale wash.
    await pop.locator('.qe-swatch[style*="accent-coral"]').click()
    const patch = page.waitForResponse((r) => r.url().includes('/api/sadhana/quadrants/1') && r.request().method() === 'PATCH' && r.status() === 200)
    await page.locator('#qeSave').click()
    await patch
    await expect
      .poll(async () => computedRgb(await quad.evaluate((el) => getComputedStyle(el).backgroundColor)), { timeout: 5_000 })
      .toBe(CORAL_FILL)

    // ∅ restores the neutral board surface.
    await quad.locator('.q-title-row').hover()
    await quad.locator('.q-pen').click()
    await expect(pop).toHaveClass(/open/)
    await pop.locator('.qe-swatch-none').click()
    const clear = page.waitForResponse((r) => r.url().includes('/api/sadhana/quadrants/1') && r.request().method() === 'PATCH' && r.status() === 200)
    await page.locator('#qeSave').click()
    await clear
    await expect
      .poll(async () => computedRgb(await quad.evaluate((el) => getComputedStyle(el).backgroundColor)), { timeout: 5_000 })
      .toBe(NEUTRAL_CARD)

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([])
  })
})
