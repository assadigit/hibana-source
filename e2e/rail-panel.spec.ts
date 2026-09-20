// e2e/rail-panel.spec.ts — S88: the vertical navigation rail + its secondary panel.
//
// The owner specced two patterns in one round:
//   1. MATERIAL "navigation rail" — the horizontal topbar is replaced by a vertical
//      icon rail fixed to the left edge: icons ONLY (no text labels — every icon
//      carries aria-label + title), equal spacing, the active section wears a filled
//      rounded-square indicator, secondary icons (Settings, Help) sit at the bottom
//      behind a thin divider.
//   2. VS CODE Activity Bar + Side Bar — selecting a rail icon opens a secondary
//      panel DIRECTLY to its right, populated with that section's items under
//      labeled COLLAPSIBLE group headers (All / Ongoing / Done…). The rail stays
//      visible at all times; the panel is PERSISTENT (pushes main content via body
//      padding — never an overlay), survives page reloads, and Escape/the icon/✕
//      close it.
// Run: npx playwright test e2e/rail-panel.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-rail@test.local'
const TEST_PASS = 'e2e-password-123'

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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-rail', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // A couple of projects so the Projects panel has real rows to list.
  db.exec(`DELETE FROM projects WHERE user_id = '${id}'`)
  for (const [i, status] of ['doing', 'operational', 'spark'].entries()) {
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
       VALUES ('${id}-p${i}', '${id}', 'Rail project ${i}', '${status}', '${now}', '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page) {
  // The first-visit tour overlay is a pointer-events wall — suppress it (the S85
  // recipe: BOTH suppression keys, tour + ln).
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
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
  // each test owns its panel state — cleared ONCE after login (NOT in the init
  // script: that re-runs on every reload and would wipe the persistence under test)
  await page.evaluate(() => { try { localStorage.removeItem('hibana-rail-panel') } catch { /* storage blocked */ } })
}

test.describe('the navigation rail (Material navigation-rail pattern)', () => {
  test('icons only, aria-labeled, active = filled rounded square, secondary icons behind a divider', async ({ page }) => {
    await login(page)
    const rail = page.locator('nav.rail')
    await expect(rail).toBeVisible()

    // Icon-only: the rail is 4rem wide and NO text labels render (the accessible
    // name rides aria-label).
    const railBox = await rail.boundingBox()
    expect(Math.round(railBox!.width)).toBe(64)
    const primary = page.locator('.rail .rail-primary a')
    expect(await primary.count()).toBe(8)
    for (let i = 0; i < 8; i++) {
      const label = await primary.nth(i).getAttribute('aria-label')
      expect(label, `primary icon ${i} has an accessible name`).toBeTruthy()
      expect(await primary.nth(i).innerText()).toBe('') // no visible text
    }

    // The active section (/app IS the dashboard) wears the filled indicator: the
    // button paints a background (the filled rounded square) + aria-current.
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).toHaveAttribute('aria-current', 'page')
    const bg = await dash.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')

    // Secondary icons (Settings, Help) live BELOW the divider at the rail's bottom.
    const divider = page.locator('.rail .rail-divider')
    await expect(divider).toBeVisible()
    const settings = page.locator('.rail a.rail-secondary[href="/settings.html"]')
    const help = page.locator('.rail [data-rail-help]')
    await expect(settings).toBeVisible()
    await expect(help).toBeVisible()
    await expect(help).toHaveAttribute('aria-label', /.+/)
    const dBox = await divider.boundingBox()
    const sBox = await settings.boundingBox()
    expect(sBox!.y).toBeGreaterThan(dBox!.y)
  })

  test('≤1024px the rail hides; the slim brand bar + bottom-tab nav carry the chrome', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('nav.rail')).toBeHidden()
    await expect(page.locator('.rail-panel')).toBeHidden()
    await expect(page.locator('.mobile-brandbar .brand-logo')).toBeVisible()
    await expect(page.locator('.mobile-nav')).toBeVisible()
  })
})

test.describe('the secondary panel (VS Code Activity Bar + Side Bar pattern)', () => {
  test('selecting an icon opens the panel beside the rail — grouped, collapsible, pushing content', async ({ page }) => {
    await login(page)
    // The main content's gutter = the rail width before anything opens.
    const padBefore = await page.evaluate(() => getComputedStyle(document.body).paddingInlineStart)
    expect(padBefore).toBe('64px')

    // Selecting the Projects icon OPENS THE PANEL — it does not navigate.
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    const panel = page.locator('[data-rail-panel-box]')
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail-panel-title')).toHaveText('Projects')
    expect(page.url()).toContain('/app') // no navigation happened

    // The panel sits directly beside the rail; the rail stays visible.
    const pBox = await panel.boundingBox()
    expect(Math.round(pBox!.x)).toBe(64)
    await expect(page.locator('nav.rail')).toBeVisible()

    // The main content is PUSHED (persistent body padding, not an overlay — the
    // 0.22s padding transition means the computed value must be polled, not read).
    await page.waitForFunction(() => parseInt(getComputedStyle(document.body).paddingInlineStart, 10) > 64, null, { timeout: 3_000 })

    // Grouped under labeled, collapsible section headers — All / Ongoing / Done.
    const groups = page.locator('.rail-group-head')
    const labels = await groups.allTextContents()
    expect(labels.map((l) => l.replace(/\d+$/, '').trim())).toEqual(['All', 'Ongoing', 'Done'])
    // Real items with status dots (the seeded projects).
    await expect(page.locator('.rail-item').first()).toBeVisible()
    expect(await page.locator('.rail-item .rail-dot').count()).toBeGreaterThan(0)

    // Collapsible: collapsing a group hides its items.
    await page.click('.rail-group-head >> nth=0')
    await expect(page.locator('.rail-group').first()).toHaveClass(/is-collapsed/)
    await page.click('.rail-group-head >> nth=0') // re-open for the item test
    await expect(page.locator('.rail-group').first()).not.toHaveClass(/is-collapsed/)

    // An item click navigates (to the project page) and the panel STAYS OPEN with
    // the rail's active icon following the new page.
    await page.click('.rail-item >> nth=0')
    await page.waitForURL('**/project.html?id=*', { timeout: 10_000 })
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail .rail-primary a[data-rail-panel="projects"]')).toHaveAttribute('aria-current', 'page')

    // Escape closes (dialogs own their Escape first — none open here).
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.waitForFunction(() => getComputedStyle(document.body).paddingInlineStart === '64px', null, { timeout: 3_000 })
  })

  test('clicking the open section\'s icon toggles the panel closed; switching icons swaps sections', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Projects')

    // Same icon again → closed.
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()

    // A different icon swaps the panel's section (rail never hides).
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')
    await expect(page.locator('nav.rail')).toBeVisible()
  })

  test('the panel persists across a page reload (localStorage restore)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="notes"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Notes')
    await page.reload()
    await page.waitForSelector('[data-rail-panel-box]:not([hidden])', { timeout: 10_000 })
    await expect(page.locator('.rail-panel-title')).toHaveText('Notes')
    // …and closes cleanly after the restore.
    await page.click('.rail .rail-primary a[data-rail-panel="notes"]')
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
  })

  test('every section opens a panel (the dashboard reads the resume store client-side)', async ({ page }) => {
    await login(page)
    for (const section of ['dashboard', 'sparks', 'canvas', 'notebook', 'calendar']) {
      await page.click(`.rail .rail-primary a[data-rail-panel="${section}"]`)
      await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
      await expect(page.locator('.rail-panel-title')).toBeTruthy()
    }
  })
})
