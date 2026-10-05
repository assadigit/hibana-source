// e2e/s190-mobile-active-shape.spec.ts — S190: ONE ACTIVE GRAMMAR, MOBILE.
//
// The S189 rail shape (the owner's CHANGE 7) reaches the last two navigation
// surfaces: the mobile bottom bar's tabs and the More sheet's current-page row.
// The contract, pinned here at 390px:
// 1) THE SHAPE — the active tab paints the SAME soft filled teal (the
//    --nav-active-* family, 14% light / 20% dark — alpha on the background
//    COLOR only), the icon at the full teal, the label one rung further with
//    weight 600; the tile is the tab's own rounded box (14px) sitting ~6px off
//    the bar's outer edges (the 6–8px band; the bar's 0.375rem block padding),
//    covering the icon AND label as ONE unit.
// 2) THE MORE TWIN — on secondary pages (calendar) the More tab carries the
//    same shape; the sheet's own current row speaks the same family
//    (--accent-soft/--link retired).
// 3) ONE ACTIVE PATTERN — the More-EXPANDED teal ink is RETIRED on primary
//    pages (the open sheet is the indicator; aria-expanded keeps semantics).
// 4) FOCUS IS SEPARATE — the bar tabs have their OWN 2px keyboard ring now
//    (the S61 gap: the sheet rows had rings, the tabs had none), outside the
//    shape; the tint never doubles as focus.
// 5) TAP-TO-TOP — activating the CURRENT tab re-orients: a scrolled page
//    glides to the head WITHOUT a re-mount (the byte-identical go() branch);
//    at the head it stays a quiet no-op.
// 6) TWINS — the dark theme (lighter teals at 20%) and the FA/RTL layout.
import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s190@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s190-fa@test.local'

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
  }
  seedUser(randomBytes(16).toString('hex'), TEST_EMAIL, 'e2e-s190', 'en')
  seedUser(randomBytes(16).toString('hex'), FA_EMAIL, 'e2e-s190-fa', 'fa') // language_pref='fa' → dir=rtl
  db.close()
})

async function login(page: Page, email = TEST_EMAIL, theme?: 'claude-dark') {
  await page.addInitScript((args) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (args.theme) localStorage.setItem('hibana-theme', args.theme)
    } catch { /* storage blocked */ }
  }, { theme })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForTimeout(300)
}

const ACTIVE_BG = 'rgba(47, 123, 127, 0.14)'
const ACTIVE_BG_DARK = 'rgba(143, 204, 207, 0.2)'
const ICON_INK = 'rgb(47, 123, 127)'
const ICON_INK_DARK = 'rgb(143, 204, 207)'
const LABEL_INK = 'rgb(31, 90, 93)'
const LABEL_INK_DARK = 'rgb(154, 212, 215)'

test.describe('S190 — the mobile bar + sheet join the S189 active shape', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
  })

  test('geometry + inks: the active tab paints the family — 14px tile, ~6px shoulders, icon+label ONE unit', async ({ page }) => {
    await page.goto('/notes.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(400) // the 0.12s color/background transition settles

    const tab = page.locator('.mobile-nav a[aria-current="page"]')
    await expect(tab).toHaveCount(1)
    await expect(tab).toHaveAttribute('aria-current', 'page')
    await expect(tab).toHaveCSS('background-color', ACTIVE_BG)
    await expect(tab).toHaveCSS('color', ICON_INK)
    const label = tab.locator('.mobile-nav-label')
    await expect(label).toHaveCSS('color', LABEL_INK)
    await expect(label).toHaveCSS('font-weight', '600')
    await expect(tab).toHaveCSS('border-radius', '14px') // --radius-sm — the tab's own rounded box

    // The tile sits inside the bar with block shoulders in the 6–8px band
    // (0.375rem padding + the 1px hairline; safe-area is 0 in CI) and the
    // bar grew to cover it (61px = 48 tile + 12 padding + 1 hairline).
    const geo = await page.evaluate(() => {
      const bar = document.querySelector('.mobile-nav')!.getBoundingClientRect()
      const t = document.querySelector('.mobile-nav a[aria-current="page"]')!.getBoundingClientRect()
      const icon = document.querySelector('.mobile-nav a[aria-current="page"] .icon')!.getBoundingClientRect()
      const lbl = document.querySelector('.mobile-nav a[aria-current="page"] .mobile-nav-label')!.getBoundingClientRect()
      return {
        barH: bar.height,
        tileW: t.width,
        tileH: t.height,
        topShoulder: t.y - bar.y,
        bottomShoulder: bar.y + bar.height - (t.y + t.height),
        iconInside: icon.y >= t.y && icon.y + icon.height <= t.y + t.height && icon.x >= t.x && icon.x + icon.width <= t.x + t.width,
        labelInside: lbl.y >= t.y && lbl.y + lbl.height <= t.y + t.height && lbl.x >= t.x && lbl.x + lbl.width <= t.x + t.width,
      }
    })
    expect(geo.barH).toBeGreaterThan(59)
    expect(geo.barH).toBeLessThan(64)
    expect(geo.tileH).toBeGreaterThanOrEqual(48) // the 48px touch floor holds
    expect(geo.tileW).toBeGreaterThan(50) // 390px bar / 6 tabs ≈ 62px
    expect(geo.tileW).toBeLessThan(72)
    expect(geo.topShoulder).toBeGreaterThanOrEqual(5) // the 6–8px band (±1 sub-pixel)
    expect(geo.topShoulder).toBeLessThanOrEqual(9)
    expect(geo.bottomShoulder).toBeGreaterThanOrEqual(5)
    expect(geo.bottomShoulder).toBeLessThanOrEqual(9)
    expect(geo.iconInside).toBe(true) // the ONE-unit contract: the tint covers both
    expect(geo.labelInside).toBe(true)
  })

  test('the More twin: a secondary page carries the shape on the More tab, and the sheet row speaks the family', async ({ page }) => {
    await page.goto('/calendar.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(400)

    const more = page.locator('.mobile-nav-more')
    await expect(more).toHaveAttribute('aria-current', 'page')
    await expect(more).toHaveCSS('background-color', ACTIVE_BG)
    await expect(more).toHaveCSS('color', ICON_INK)
    await expect(more.locator('.mobile-nav-label')).toHaveCSS('color', LABEL_INK)

    // Open the sheet — its own current row (Calendar) joins the family.
    await more.click()
    await page.waitForSelector('.mobile-more-sheet.open', { timeout: 5_000 })
    const row = page.locator('.mobile-more-sheet a.mobile-more-row[aria-current="page"]')
    await expect(row).toHaveCount(1)
    await expect(row).toHaveCSS('background-color', ACTIVE_BG)
    await expect(row).toHaveCSS('color', LABEL_INK)
    await expect(row.locator('.icon')).toHaveCSS('color', ICON_INK)
    await expect(row).toHaveCSS('font-weight', '600')

    // While the sheet is open on the SECONDARY page the More tab keeps its
    // CURRENT shape (it is the position indicator — only the expanded-INK on
    // primary pages retired; this is the one-pattern contract, not its loss).
    await expect(more).toHaveCSS('background-color', ACTIVE_BG)
  })

  test('one active pattern: the More-EXPANDED teal ink retires on primary pages (the sheet is the indicator)', async ({ page }) => {
    await page.goto('/notes.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(400)

    const more = page.locator('.mobile-nav-more')
    await more.click()
    await page.waitForSelector('.mobile-more-sheet.open', { timeout: 5_000 })
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(more).not.toHaveAttribute('aria-current', 'page') // semantics: the attribute is REMOVED on primary pages…
    await expect(more).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)') // …but NO shape…
    await expect(more).toHaveCSS('color', 'rgb(92, 92, 92)') // …and NO teal ink — the open sheet is the indicator
  })

  test('focus: the bar tabs have their OWN 2px keyboard ring now, outside the shape', async ({ page }) => {
    await page.goto('/notes.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(400)

    const tab = page.locator('.mobile-nav a[aria-current="page"]')
    // Walk the tab order until a bar tab carries focus (keyboard focus —
    // :focus-visible only paints for real key traversal).
    let reached = false
    for (let i = 0; i < 120 && !reached; i++) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return !!el && !!el.closest('.mobile-nav')
      })
    }
    expect(reached, 'Tab reaches the bottom bar').toBe(true)

    // The ring: 2px, solid, offset 2px — a separate signal OUTSIDE the tile.
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, color: cs.outlineColor, bg: cs.backgroundColor }
    })
    expect(ring.style).toBe('solid')
    expect(ring.width).toBe('2px')
    expect(ring.offset).toBe('2px')
    expect(ring.color).not.toBe(ring.bg) // the ring ink ≠ the tint (focus ≠ active)
    // …and the shape is UNCHANGED by focus (the tint marks the page, not focus).
    await expect(tab).toHaveCSS('background-color', ACTIVE_BG)
  })

  test('tap-to-top: activating the CURRENT tab re-orients — scrolled page glides to the head, NO re-mount', async ({ page }) => {
    // projects.html: a regular scrolling shell page whose active tab (Projects)
    // hrefs the byte-identical URL — notes.html's shell is height-constrained
    // (its vault scrolls internally), so it can't host the window-scroll proof.
    await page.goto('/projects.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(400)

    // Scaffold real overflow (a fresh user's page doesn't scroll) — the
    // div lives INSIDE main.shell, so a soft-nav re-mount would destroy it:
    // its survival after the tap is the no-remount proof.
    await page.evaluate(() => {
      const div = document.createElement('div')
      div.id = 's190-overflow'
      div.style.height = '2000px'
      document.querySelector('main.shell')!.appendChild(div)
      window.scrollTo(0, 600)
    })
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(600)

    const tab = page.locator('.mobile-nav a[aria-current="page"]')
    await tab.click()
    await expect
      .poll(async () => Math.round(await page.evaluate(() => window.scrollY)), { timeout: 3_000 })
      .toBe(0) // the glide lands at the head…
    expect(page.url()).toContain('/projects.html') // …without navigating…
    expect(await page.evaluate(() => !!document.getElementById('s190-overflow'))).toBe(true) // …and without re-mounting.

    // At the head the same tap stays a quiet no-op (still no re-mount).
    await tab.click()
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0)
    expect(await page.evaluate(() => !!document.getElementById('s190-overflow'))).toBe(true)
  })

  test('dark twin: the lighter teals at 20% carry the same shape on the bar', async ({ page }) => {
    await login(page, TEST_EMAIL, 'claude-dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/notes.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(400)

    const tab = page.locator('.mobile-nav a[aria-current="page"]')
    await expect(tab).toHaveCSS('background-color', ACTIVE_BG_DARK)
    await expect(tab).toHaveCSS('color', ICON_INK_DARK)
    await expect(tab.locator('.mobile-nav-label')).toHaveCSS('color', LABEL_INK_DARK)
    await expect(tab.locator('.mobile-nav-label')).toHaveCSS('font-weight', '600')
  })

  test('FA/RTL twin: the same shape + inks under the Farsi bar', async ({ page }) => {
    await login(page, FA_EMAIL)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/notes.html')
    await page.waitForSelector('.mobile-nav', { timeout: 10_000 })
    await page.waitForTimeout(600) // the async i18n apply() translates the labels

    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')
    const tab = page.locator('.mobile-nav a[aria-current="page"]')
    await expect(tab).toHaveCSS('background-color', ACTIVE_BG)
    await expect(tab).toHaveCSS('color', ICON_INK)
    await expect(tab.locator('.mobile-nav-label')).toHaveCSS('color', LABEL_INK)
    // The tile geometry is direction-symmetric (flex row, logical properties):
    // the active tile keeps ~6px block shoulders under RTL exactly as LTR.
    const geo = await page.evaluate(() => {
      const bar = document.querySelector('.mobile-nav')!.getBoundingClientRect()
      const t = document.querySelector('.mobile-nav a[aria-current="page"]')!.getBoundingClientRect()
      return { top: t.y - bar.y, bottom: bar.y + bar.height - (t.y + t.height) }
    })
    expect(geo.top).toBeGreaterThanOrEqual(5)
    expect(geo.top).toBeLessThanOrEqual(9)
    expect(geo.bottom).toBeGreaterThanOrEqual(5)
    expect(geo.bottom).toBeLessThanOrEqual(9)
  })
})
