// e2e/s189-rail-active.spec.ts — S189 (the owner's CHANGE 7): the left icon
// rail's ACTIVE item paints a soft FILLED BACKGROUND SHAPE, superseding the
// S179/S184 start-edge accent bar (S188's CHANGE 5 kept ONE active pattern;
// this round replaces WHAT that pattern is — the bar retires, the shape is
// the only active indicator).
//
// The contract, pinned here:
// 1) GEOMETRY — the shape is the button itself: ~12px rounded corners, inset
//    EXACTLY 8px off each rail edge (the labeled hit column widened 68px →
//    72px inside the 88px rail), covering the icon AND its label as ONE unit.
// 2) COLOR — the teal #2F7B7F at 14% alpha ON THE BACKGROUND COLOR ONLY
//    (rgba — never the opacity property, which would fade the ink); the ICON
//    at the full #2F7B7F; the LABEL one rung darker (#1F5A5D — 4.5:1+ on its
//    own tint); the inactive hover = the same teal at ~7%.
// 3) THE BAR IS GONE — no ::before on the active rail button, anywhere.
// 4) FOCUS IS SEPARATE — the keyboard ring stays its own 2px outline OUTSIDE
//    the shape; the active tint is never the focus signal.
// 5) THE SHAPE FOLLOWS THE ROUTE — soft navigation moves it; it can never go
//    stale (markNav keys aria-current to the current route).
// 6) TWINS — the dark theme (lighter teals at 20%), the FA/RTL layout (the
//    geometry mirrors; logical properties keep the shape centered), and the
//    icon-only rail (48px squares, same 8px shoulders).
import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s189@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s189-fa@test.local'

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
  seedUser(randomBytes(16).toString('hex'), TEST_EMAIL, 'e2e-s189', 'en')
  seedUser(randomBytes(16).toString('hex'), FA_EMAIL, 'e2e-s189-fa', 'fa') // language_pref='fa' → dir=rtl
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
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
  await page.waitForTimeout(300) // the 0.14s color/background transition settles
}

const ACTIVE_BG = 'rgba(47, 123, 127, 0.14)'
const ACTIVE_HOVER_BG = 'rgba(47, 123, 127, 0.18)'
const HOVER_BG = 'rgba(47, 123, 127, 0.07)'
const ICON_INK = 'rgb(47, 123, 127)'
const LABEL_INK = 'rgb(31, 90, 93)'

test.describe('S189 — the rail\'s active SHAPE (the owner\'s CHANGE 7)', () => {
  test('geometry: the filled shape — 12px corners, 8px off each rail edge, covering icon + label as ONE unit', async ({ page }) => {
    await login(page)

    const rail = page.locator('nav.rail')
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).toHaveAttribute('aria-current', 'page')

    const railBox = await rail.boundingBox()
    const btnBox = await dash.boundingBox()
    expect(Math.round(railBox!.width)).toBe(88)          // the labeled rail, unchanged
    expect(Math.round(btnBox!.width)).toBe(72)           // the widened hit column (was 68)
    // The shape sits ~8px off EACH rail edge — the change's 6–8px inset band.
    // Exact geometry: the flex centers the 72px button in the rail's 87px CONTENT
    // box (88px border-box − the 1px inline-end hairline) → 7.5px shoulders inside
    // the content box on BOTH sides; measured from the OUTER edges the inline-end
    // shoulder carries the hairline's +1px → 7.5 start / 8.5 end (sub-pixel, the
    // flex center is the symmetry; the border rides inline-end in BOTH directions
    // so RTL mirrors the split — pinned in the FA twin below).
    expect(btnBox!.x - railBox!.x).toBeCloseTo(7.5, 1)
    expect((railBox!.x + railBox!.width) - (btnBox!.x + btnBox!.width)).toBeCloseTo(8.5, 1)
    // The tile is a generous target: ≥ 48px tall (icon 20px + label ~12px + rhythm).
    expect(Math.round(btnBox!.height)).toBeGreaterThanOrEqual(48)
    // ~12px rounded corners (the change's suggested radius).
    expect(await dash.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px')
    // The tint rides the BACKGROUND COLOR ONLY — the element's own opacity
    // stays 1 (the rgba carries the alpha; opacity would fade the ink too).
    expect(await dash.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

    // ONE unit: the shape's box covers BOTH the icon and the label (tolerance
    // 0.5px — a pseudo-element or inset shape would fail this).
    const iconBox = await dash.locator('.icon').boundingBox()
    const labelBox = await dash.locator('.rail-label').boundingBox()
    for (const [name, box] of [['icon', iconBox], ['label', labelBox]] as const) {
      expect(box!.x, `${name} inside the shape (start)`).toBeGreaterThanOrEqual(btnBox!.x - 0.5)
      expect(box!.y, `${name} inside the shape (top)`).toBeGreaterThanOrEqual(btnBox!.y - 0.5)
      expect(box!.x + box!.width, `${name} inside the shape (end)`).toBeLessThanOrEqual(btnBox!.x + btnBox!.width + 0.5)
      expect(box!.y + box!.height, `${name} inside the shape (bottom)`).toBeLessThanOrEqual(btnBox!.y + btnBox!.height + 0.5)
    }
    // …and the pair reads centered (icon and label share the shape's axis).
    const btnMid = btnBox!.x + btnBox!.width / 2
    expect(Math.abs(iconBox!.x + iconBox!.width / 2 - btnMid)).toBeLessThanOrEqual(1)
    expect(Math.abs(labelBox!.x + labelBox!.width / 2 - btnMid)).toBeLessThanOrEqual(1)
  })

  test('color: the teal at 14% on the background only; the icon full teal, the label one rung darker; hover deepens', async ({ page }) => {
    await login(page)

    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).toHaveCSS('background-color', ACTIVE_BG)
    await expect(dash).toHaveCSS('color', ICON_INK) // the icon's currentColor
    await expect(dash.locator('.rail-label')).toHaveCSS('color', LABEL_INK)
    await expect(dash.locator('.rail-label')).toHaveCSS('font-weight', '600')
    // THE BAR IS RETIRED: no ::before content on the active rail button.
    expect(await dash.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none')

    // Hovering the ACTIVE item deepens the tint one notch (the shape stays).
    await dash.hover()
    await expect.poll(() => dash.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe(ACTIVE_HOVER_BG)
    await page.mouse.move(4, 4) // leave
    await expect.poll(() => dash.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe(ACTIVE_BG)
  })

  test('the inactive hover: the SAME teal at ~7% — never the old gray text wash', async ({ page }) => {
    await login(page)

    const canvas = page.locator('.rail .rail-primary a[href="/canvas.html"]')
    await expect(canvas).not.toHaveAttribute('aria-current', 'page')
    await expect(canvas).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)') // resting: no shape
    await canvas.hover()
    await expect.poll(() => canvas.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe(HOVER_BG)
    // the ink keeps the app's hover grammar (muted → text)
    await expect.poll(() => canvas.evaluate((el) => getComputedStyle(el).color), { timeout: 2_000 }).toBe('rgb(20, 20, 20)')
    await page.mouse.move(4, 4) // leave
    await expect.poll(() => canvas.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(0, 0, 0, 0)')
  })

  test('focus: the keyboard ring is its OWN 2px outline outside the shape — the tint never doubles as focus', async ({ page }) => {
    await login(page)

    // Walk the tab order until the ACTIVE rail button carries focus (keyboard
    // focus — :focus-visible only paints for real key traversal).
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    let focused = false
    for (let i = 0; i < 20 && !focused; i++) {
      await page.keyboard.press('Tab')
      focused = await dash.evaluate((el) => document.activeElement === el)
    }
    expect(focused, 'Tab reaches the active rail button').toBe(true)

    // The ring: 2px, solid, offset 2px — OUTSIDE the shape, a separate signal.
    expect(await dash.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
    expect(await dash.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('2px')
    expect(await dash.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('2px')
    // …and the ring ink is NOT the shape tint (instruction 11: focus ≠ active).
    const ring = await dash.evaluate((el) => getComputedStyle(el).outlineColor)
    const shape = await dash.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(ring).not.toBe(shape)
    // The shape itself is UNCHANGED by focus (the tint marks the page, not focus).
    expect(shape).toBe(ACTIVE_BG)
  })

  test('the shape follows the route — soft navigation moves it; it can never go stale', async ({ page }) => {
    await login(page)

    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    const projects = page.locator('.rail .rail-primary a[data-rail-panel="projects"]')
    await expect(dash).toHaveCSS('background-color', ACTIVE_BG)

    await projects.click()
    await page.mouse.move(4, 4) // the click leaves the pointer ON the button — leave, so the resting tint (not the hover tint) is what settles
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    await expect(projects).toHaveAttribute('aria-current', 'page')
    // the shape MOVED: Projects wears it…
    await expect.poll(() => projects.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe(ACTIVE_BG)
    await expect.poll(() => projects.evaluate((el) => getComputedStyle(el).color), { timeout: 2_000 }).toBe(ICON_INK)
    // …Dashboard lost it entirely (transparent again — one shape, one route).
    await expect.poll(() => dash.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(0, 0, 0, 0)')
  })

  test('dark twin: the lighter teals at 20% — icon #8FCCCF, label #9AD4D7 on the dark rail', async ({ page }) => {
    await login(page, TEST_EMAIL, 'claude-dark')

    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).toHaveCSS('background-color', 'rgba(143, 204, 207, 0.2)')
    await expect(dash).toHaveCSS('color', 'rgb(143, 204, 207)')
    await expect(dash.locator('.rail-label')).toHaveCSS('color', 'rgb(154, 212, 215)')
    // the same 12px shape geometry in the dark theme
    expect(await dash.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px')
    // the inactive hover twin rides the lighter teal at ~10%
    const canvas = page.locator('.rail .rail-primary a[href="/canvas.html"]')
    await canvas.hover()
    await expect.poll(() => canvas.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(143, 204, 207, 0.1)')
  })

  test('FA/RTL twin: the shape mirrors — same 8px shoulders, the FA label inside the one unit', async ({ page }) => {
    await login(page, FA_EMAIL)

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const rail = page.locator('nav.rail')
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).toHaveAttribute('aria-current', 'page')
    await expect(dash).toHaveCSS('background-color', ACTIVE_BG)
    await expect(dash.locator('.rail-label')).toHaveCSS('color', LABEL_INK)

    // The mirrored geometry: ~8px off EACH edge, the 1px hairline's split MIRRORED
    // (the border rides inline-end = the LEFT edge under dir=rtl, so the start
    // shoulder carries the +1px: 8.5 start / 7.5 end — the exact LTR mirror,
    // proving the geometry is logical, not hardcoded left/right).
    const railBox = await rail.boundingBox()
    const btnBox = await dash.boundingBox()
    expect(Math.round(btnBox!.width)).toBe(72)
    expect(btnBox!.x - railBox!.x).toBeCloseTo(8.5, 1)
    expect((railBox!.x + railBox!.width) - (btnBox!.x + btnBox!.width)).toBeCloseTo(7.5, 1)
    // The FA label (داشبورد) rides INSIDE the shape, centered on its axis.
    const labelBox = await dash.locator('.rail-label').boundingBox()
    expect(labelBox!.x).toBeGreaterThanOrEqual(btnBox!.x - 0.5)
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(btnBox!.x + btnBox!.width + 0.5)
    const btnMid = btnBox!.x + btnBox!.width / 2
    expect(Math.abs(labelBox!.x + labelBox!.width / 2 - btnMid)).toBeLessThanOrEqual(1)
    // …and no bar in RTL either.
    expect(await dash.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none')
  })

  test('the icon-only rail twin (notes.html): 48px squares, the SAME 8px shoulders + shape', async ({ page }) => {
    await login(page)
    await page.goto('/notes.html')
    await page.waitForSelector('body.rail-icons-only', { timeout: 10_000 })

    const rail = page.locator('nav.rail')
    const notes = page.locator('.rail .rail-primary a[data-rail-panel="notes"]')
    await expect(notes).toHaveAttribute('aria-current', 'page')

    const railBox = await rail.boundingBox()
    const btnBox = await notes.boundingBox()
    expect(Math.round(railBox!.width)).toBe(64)  // the collapsed rail
    expect(Math.round(btnBox!.width)).toBe(48)   // the widened icon square (was 44)
    expect(Math.round(btnBox!.height)).toBe(48)
    // the SAME ~8px shoulders + the hairline's split as the labeled rail
    // (64px border-box − 1px end border = 63px content; 48px centered → 7.5/8.5)
    expect(btnBox!.x - railBox!.x).toBeCloseTo(7.5, 1)
    expect((railBox!.x + railBox!.width) - (btnBox!.x + btnBox!.width)).toBeCloseTo(8.5, 1)
    // the shape + ink pair ride the icon-only form unchanged
    await expect(notes).toHaveCSS('background-color', ACTIVE_BG)
    await expect(notes).toHaveCSS('color', ICON_INK)
    expect(await notes.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px')
  })
})
