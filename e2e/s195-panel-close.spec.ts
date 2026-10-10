// e2e/s195-panel-close.spec.ts — S195 (the owner's report): the panel head's
// CLOSE BUTTON steps out of the hairline era. The probe that drove the fix:
// the .icon stroke-width 1.8 lives in the 24-unit viewBox, so at the old
// 17.6px render the effective stroke was 1.32px → 1px anti-aliased runs — the
// crossing X read as a fragile hairline (three VLM audits concurred, both
// themes, worst in dark), and the 32px box sat UNDER the app's own 40px
// coarse-pointer floor. The fix: 36px boxes (40px coarse), 20px icons (the
// .rail-btn .icon size), and the X's path carries its own optical
// stroke-width 2 (at equal stroke the crossing reads lighter than the
// chevron's vertex — the pair now reads matched at 20px).
//
// Pins:
// 1) Geometry: 36px box × both buttons, 20px icon, 8px radius, the pair
//    vertically centered in the head (the head grows with the box).
// 2) The optical stroke: the X's path computes 2px, the chevron keeps the
//    system's 1.8px (a scoped fork, not a drift).
// 3) Function: the close closes the panel; the tree twin still toggles
//    (Collapse all ↔ Expand all) — the shared recipe survives.
// 4) The quiet grammar: transparent rest, bg-soft + text ink on hover (a REAL
//    pointer — the S192 lesson), the 2px brand focus ring.
// 5) The dark twin: same geometry, same stroke (the hairline was worst here).
// 6) The FA/RTL twin: 36px, the close at the inline-END (left in RTL), the
//    Persian aria-label.
// 7) Zero console errors.
// Run: npx playwright test e2e/s195-panel-close.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s195@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s195-fa@test.local'

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

  const seedUser = (id: string, email: string, name: string, lang: string) => {
    try { db.exec(`DELETE FROM users WHERE email = '${email}'`) } catch { /* may not exist yet */ }
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${id}', '${name}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
    // one project so the panel body renders a tree under the head
    db.exec(`DELETE FROM projects WHERE user_id = '${id}'`)
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
       VALUES ('${id}-p1', '${id}', 'S195 anchor project', 'developing', '${now}', '${now}')`,
    )
  }
  seedUser(randomBytes(16).toString('hex'), TEST_EMAIL, 'e2e-s195', 'en')
  seedUser(randomBytes(16).toString('hex'), FA_EMAIL, 'e2e-s195-fa', 'fa') // language_pref='fa' → dir=rtl
  db.close()
})

async function login(page: Page, email = TEST_EMAIL) {
  // Suppress the onboarding coachmarks (the tour backdrop intercepts pointer clicks).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
}

async function openProjectsPanel(page: Page) {
  await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
  await page.waitForURL('**/projects.html', { timeout: 10_000 })
  await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
  await page.waitForSelector('.rail-panel-close', { timeout: 10_000 })
  // wait for the tree DATA too — loadRailData()'s re-render replaces the head's
  // buttons after the first paint (hovering the pre-data node reads transparent)
  await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
}

// geometry + stroke probe, shared by the theme/dir twins
const probeHead = () => {
  const close = document.querySelector('.rail-panel-close') as HTMLButtonElement
  const tree = document.querySelector('.rail-panel-tree') as HTMLButtonElement
  const head = document.querySelector('.rail-panel-head') as HTMLElement
  const cBox = close.getBoundingClientRect()
  const tBox = tree.getBoundingClientRect()
  const hBox = head.getBoundingClientRect()
  const cIcon = close.querySelector('svg')!.getBoundingClientRect()
  const xPath = close.querySelector('path')!
  const chevPath = tree.querySelector('path')!
  return {
    closeW: cBox.width, closeH: cBox.height,
    treeW: tBox.width,
    iconW: cIcon.width,
    xStroke: getComputedStyle(xPath).strokeWidth,
    chevStroke: getComputedStyle(chevPath).strokeWidth,
    radius: getComputedStyle(close).borderRadius,
    topGap: cBox.top - hBox.top,
    bottomGap: hBox.bottom - cBox.bottom,
    closeRightOfTree: cBox.left > tBox.left, // LTR: close sits AFTER the tree twin
    restBg: getComputedStyle(close).backgroundColor,
    restInk: getComputedStyle(close).color,
  }
}

test.describe('S195 — the panel head close button (the hairline fix)', () => {
  test('geometry: 36px boxes, 20px icons, centered pair, transparent rest', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)
    const g = await page.evaluate(probeHead)
    expect(g.closeW).toBe(36) // 2.25rem — was 32
    expect(g.closeH).toBe(36)
    expect(g.treeW).toBe(36) // the fold twin rides the same recipe
    expect(g.iconW).toBe(20) // 1.25rem — was 17.6 (the hairline render)
    expect(g.radius).toBe('8px') // 0.5rem — unchanged
    // vertically centered in the head (the head grew 55→~59px with the box)
    expect(Math.abs(g.topGap - g.bottomGap)).toBeLessThanOrEqual(1.5)
    expect(g.closeRightOfTree).toBe(true) // LTR: [title][open][tree][close]
    // the quiet rest: transparent background, muted ink
    expect(g.restBg).toBe('rgba(0, 0, 0, 0)')
  })

  test('the optical stroke: the X at 2px, the chevron keeps the 1.8 system', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)
    const g = await page.evaluate(probeHead)
    // the scoped fork: the crossing X gets its own optical weight
    expect(g.xStroke).toBe('2px')
    // every other icon keeps the one-stroke system — this is not a drift
    expect(g.chevStroke).toBe('1.8px')
  })

  test('function: the close closes the panel; the tree twin still toggles', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)
    // the tree twin: one click folds every group, the aria flips
    const tree = page.locator('.rail-panel-tree')
    await expect(tree).toHaveAttribute('aria-label', 'Collapse all')
    await tree.click()
    await expect(tree).toHaveAttribute('aria-label', 'Expand all')
    // the close: the panel state leaves the body
    await page.click('.rail-panel-close')
    await expect(page.locator('body')).not.toHaveClass(/rail-panel-open/)
    // and the panel reopens cleanly (the S195 markup re-renders per open)
    await openProjectsPanel(page)
    const g = await page.evaluate(probeHead)
    expect(g.closeW).toBe(36)
  })

  test('the quiet grammar: bg-soft + text ink on hover (a REAL pointer), the brand ring on focus', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)
    const close = page.locator('.rail-panel-close')
    // CSS :hover needs a real pointer (the S192 lesson) + a settle for the
    // computed read (the recalc can trail the mouse move by a frame)
    await close.hover()
    await expect.poll(async () => close.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 })
      .toBe('rgb(222, 222, 222)') // var(--bg-soft), light theme
    const hover = await close.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }))
    expect(hover.ink).toBe('rgb(20, 20, 20)') // var(--text)
    // the keyboard ring: its own separate 2px outline, outside the shape
    await page.keyboard.press('Tab') // the pointer leaves the button on nav
    const focus = await close.evaluate((el) => {
      el.focus()
      const cs = getComputedStyle(el)
      return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`
    })
    expect(focus).toBe('solid 2px rgb(74, 159, 163)') // var(--brand) #4A9FA3, light theme
  })

  test('the dark twin: same geometry + stroke (the hairline was worst in dark)', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)
    await page.click('[aria-label="Toggle theme (light/dark)"]')
    const g = await page.evaluate(probeHead)
    expect(g.closeW).toBe(36)
    expect(g.iconW).toBe(20)
    expect(g.xStroke).toBe('2px')
    expect(g.chevStroke).toBe('1.8px')
  })

  test('the FA/RTL twin: 36px at the inline-END, the Persian aria-label', async ({ page }) => {
    await login(page, FA_EMAIL)
    await openProjectsPanel(page)
    const g = await page.evaluate(probeHead)
    expect(g.closeW).toBe(36)
    expect(g.xStroke).toBe('2px')
    // RTL: the close sits at the inline-end = LEFT of the tree twin
    expect(g.closeRightOfTree).toBe(false)
    // the localized label rides the i18n key
    await expect(page.locator('.rail-panel-close')).toHaveAttribute('aria-label', 'بستن پنل')
  })

  test('zero console errors across the pair', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await login(page) // console listeners attach AFTER login (the 401 login-noise lesson)
    errors.length = 0
    await openProjectsPanel(page)
    await page.click('.rail-panel-tree')
    await page.click('.rail-panel-close')
    expect(errors).toEqual([])
  })
})
