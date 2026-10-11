// e2e/s197-touch-floor.spec.ts — S197 (Track B: UI/UX — THE TOUCH + OPTICAL
// ROUND). qa/s197-touch-audit.mjs measured the app's REAL tap law: the visual
// box + the EFFECTIVE hit area (elementFromPoint compass probes — the ::after
// hit rings COUNT, the S196 banked audit's rect-only probe over-counted misses)
// + the S195 effective-stroke math, in BOTH pointer worlds. This spec pins the
// live geometry on the app's own surfaces:
//   1. the ringed family (pw-toggle/theme-floater) — a ring tile genuinely
//      extends the hit area (the recipe the round did NOT touch, now guarded).
//   2. the genuine floor fixes: vault-sec-add 24→32 fine / 40 coarse, q-fab
//      36→40 coarse, swatch tiles 30→40 coarse, dash-vault-dismiss 32→44
//      coarse (+ the 1.25rem icon), and the S43 q-pen floor re-pinned.
//   3. the optical forks: the vault + and the pen glyph carry the computed
//      crossing-glyph strokes (2.1 / 2.4) — the S195 hairline class retired.
//   4. 0 console/page errors on every probed surface (the s193 lesson:
//      listeners attach AFTER login on authenticated pages).
// The pointer:coarse world comes from Playwright's hasTouch context — Chromium's
// CDP setEmulatedMedia IGNORES the 'pointer' feature (the banked audit's silent
// bug); a hasTouch context sets it natively, and each coarse test asserts
// matchMedia before believing its own numbers.
// Run: npx playwright test e2e/s197-touch-floor.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s197-touch@test.local'
const TEST_PASS = 'e2e-password-123'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
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
     VALUES ('${id}', 'e2e-s197-touch', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      // the vault banner must render for the dismiss probe — never carry a dismissal
      localStorage.removeItem('hibana-vault-banner-dismissed')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

// console/page-error listeners — attach AFTER login on authenticated surfaces
// (the s193 lesson: the logged-out /api/auth/me 401 is login-page noise)
function watchConsole(page: Page, sink: string[]) {
  page.on('console', (m) => { if (m.type() === 'error') sink.push(m.text()) })
  page.on('pageerror', (e) => sink.push(String(e)))
}

const BOX = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }
}

const ICON_STROKE = (el: Element) => {
  const svg = (el.matches('svg') ? el : el.querySelector('svg')) as SVGSVGElement | null
  if (!svg) return null
  const r = svg.getBoundingClientRect()
  const sw = parseFloat(getComputedStyle(svg).strokeWidth || '0')
  return { px: Math.round(r.width * 10) / 10, sw, eff: Math.round(sw * r.width / 24 * 100) / 100 }
}

// the audit's own math, in-test: the EFFECTIVE hit size = box + 2× the worst
// compass reach (elementFromPoint, 1px steps — the ::after rings COUNT)
const EFFECTIVE_HIT = (el: Element) => {
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  const reaches: number[] = []
  for (const [dx, dy] of dirs) {
    let d = 0
    for (let step = 1; step <= 12; step++) {
      const px = cx + dx * (r.width / 2 + step), py = cy + dy * (r.height / 2 + step)
      if (px < 0 || py < 0 || px > window.innerWidth || py > window.innerHeight) break
      const hit = document.elementFromPoint(px, py)
      if (!(hit === el || (hit && el.contains(hit)))) break
      d = step
    }
    reaches.push(d)
  }
  const worst = Math.min(...reaches)
  return { box: Math.round(Math.min(r.width, r.height) * 10) / 10, worst, eff: Math.round((Math.min(r.width, r.height) + 2 * worst) * 10) / 10 }
}

test.describe('fine pointers — the ring recipe + the fixed geometry', () => {
  test('login: pw-toggle + theme-floater — the hidden hit rings genuinely extend the tap area (≥40px effective)', async ({ page }) => {
    const errors: string[] = []
    watchConsole(page, errors)
    await page.goto('/login.html')
    await page.waitForSelector('.pw-toggle')
    // pw-toggle: 30.4px visual + the -0.45rem ring → 44.4 effective
    const pw = await page.locator('.pw-toggle').evaluate(EFFECTIVE_HIT)
    expect(pw.box).toBeCloseTo(30.4, 0)
    expect(pw.eff).toBeGreaterThanOrEqual(40)
    // theme-floater: the -0.55rem ring (base.css) — same recipe, same proof
    // (NB login.html loads no misc.css, so the 40px coarse min never applies
    // here — the RING is what carries the floor on this surface)
    const tf = await page.locator('.theme-floater').evaluate(EFFECTIVE_HIT)
    expect(tf.eff).toBeGreaterThanOrEqual(40)
    // the logged-out /api/auth/me 401 is the documented login-page noise (s193)
    const real = errors.filter((e) => !/401/.test(e))
    expect(real).toEqual([])
  })

  test('notes: vault-sec-add — the exact 32px box + the crossing-+ optical fork (computed 2.1)', async ({ page }) => {
    const errors: string[] = []
    await login(page)
    watchConsole(page, errors)
    await page.goto('/notes.html')
    const add = page.locator('[data-vault-newfolder-root]')
    await expect(add).toBeVisible({ timeout: 10_000 })
    const box = await add.evaluate(BOX)
    expect(box.w).toBe(32)
    expect(box.h).toBe(32)
    const icon = await add.evaluate(ICON_STROKE)
    expect(icon).not.toBeNull()
    expect(icon!.sw).toBe(2.1)
    expect(icon!.px).toBeGreaterThanOrEqual(16) // 1.05rem pinned
    expect(icon!.eff).toBeGreaterThanOrEqual(1.4) // 1.47 measured — solid, not a hairline
    expect(errors).toEqual([])
  })
})

test.describe('coarse pointers — the 40px floor (hasTouch sets pointer:coarse natively)', () => {
  test.use({ hasTouch: true })

  test('login: the media genuinely engages + both auth-surface togglers hit ≥40px effective', async ({ page }) => {
    const errors: string[] = []
    watchConsole(page, errors)
    await page.goto('/login.html')
    // THE AUDIT'S OWN VALIDITY GUARD (the banked audit's silent bug): never
    // believe coarse numbers without asserting the media matches
    await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await page.waitForSelector('.theme-floater')
    // login.html loads no misc.css — the floater's coarse floor lives in its
    // -0.55rem ring (42px effective), not a 40px box; the pw-toggle's ring
    // carries 44.4. The REAL live surface, measured as the audit measures.
    const tf = await page.locator('.theme-floater').evaluate(EFFECTIVE_HIT)
    expect(tf.eff).toBeGreaterThanOrEqual(40)
    const pw = await page.locator('.pw-toggle').evaluate(EFFECTIVE_HIT)
    expect(pw.eff).toBeGreaterThanOrEqual(40)
    const real = errors.filter((e) => !/401/.test(e)) // the s193 login-page noise
    expect(real).toEqual([])
  })

  test('notes: vault-sec-add floors at 40 + the + icon grows to the 1.25rem register', async ({ page }) => {
    const errors: string[] = []
    await login(page)
    watchConsole(page, errors)
    await page.goto('/notes.html')
    const add = page.locator('[data-vault-newfolder-root]')
    await expect(add).toBeVisible({ timeout: 10_000 })
    const box = await add.evaluate(BOX)
    expect(box.w).toBe(40)
    expect(box.h).toBe(40)
    const icon = await add.evaluate(ICON_STROKE)
    expect(icon).not.toBeNull()
    expect(icon!.px).toBeGreaterThanOrEqual(20) // 1.25rem
    expect(icon!.eff).toBeGreaterThanOrEqual(1.7) // 2.1 × 20/24 = 1.75
    expect(errors).toEqual([])
  })

  test("sadhana: the q-fab floors at 40 + the S43 q-pen floor re-pinned + the pen glyph's 2.4 optical stroke", async ({ page }) => {
    const errors: string[] = []
    await login(page)
    watchConsole(page, errors)
    await page.goto('/sadhana.html')
    const fab = page.locator('.q-fab').first()
    await expect(fab).toBeVisible({ timeout: 10_000 })
    const fabBox = await fab.evaluate(BOX)
    expect(fabBox.w).toBe(40)
    expect(fabBox.h).toBe(40)
    // the S43 block floors the quiet pair at 40 — re-pinned as the regression
    // guard (the banked audit's mismeasured list called this a miss)
    const pen = page.locator('.q-pen').first()
    await expect(pen).toBeAttached()
    const penBox = await pen.evaluate(BOX)
    expect(Math.min(penBox.w, penBox.h)).toBeGreaterThanOrEqual(40)
    // the pen glyph: 13px at the 2.4 optical fork → 1.3px effective (0.9 before)
    const penIcon = await pen.evaluate(ICON_STROKE)
    expect(penIcon).not.toBeNull()
    expect(penIcon!.sw).toBe(2.4)
    expect(penIcon!.eff).toBeGreaterThanOrEqual(1.25)
    expect(errors).toEqual([])
  })

  test('settings: the category swatch tiles floor at 40 (the promised pointer-keyed bump)', async ({ page }) => {
    const errors: string[] = []
    await login(page)
    watchConsole(page, errors)
    await page.goto('/settings.html')
    const tile = page.locator('.pd-cat-swatch-tile').first()
    await expect(tile).toBeVisible({ timeout: 10_000 })
    const box = await tile.evaluate(BOX)
    expect(box.w).toBe(40)
    expect(box.h).toBe(40)
    expect(errors).toEqual([])
  })

  test("dashboard: the vault banner's dismiss floors at 44 + the 1.25rem icon", async ({ page }) => {
    const errors: string[] = []
    await login(page)
    watchConsole(page, errors)
    await page.goto('/app')
    const banner = page.locator('[data-vault-banner]')
    await expect(banner).toBeVisible({ timeout: 10_000 })
    const dismiss = page.locator('.dash-vault-dismiss')
    await expect(dismiss).toBeVisible()
    const box = await dismiss.evaluate(BOX)
    expect(box.w).toBe(44)
    expect(box.h).toBe(44)
    const icon = await dismiss.evaluate(ICON_STROKE)
    expect(icon).not.toBeNull()
    expect(icon!.px).toBeGreaterThanOrEqual(20)
    expect(errors).toEqual([])
  })
})
