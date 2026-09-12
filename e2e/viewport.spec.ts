// e2e/viewport.spec.ts — document-level responsive integrity pins (Session 29 audit).
//
// The S29 responsive sweep (15 pages × 4 widths × EN+FA) found ONE real page-level bug:
// calendar.html scrolled 69px horizontally at 768px (.cal-controls never wrapped — the
// wrap was gated ≤640px). These specs pin the document-level contract on 7 key pages
// at 4 widths (360/768/1024/1440) plus the specific calendar regressions and the
// shell-fills-viewport (sticky-footer) discipline. In-page scroll containers (the
// dashboard quadrant carousel, sadhana sub-bar strip, reports bar-rows) are INTENTIONAL
// and don't affect documentElement scrollWidth — only the document is asserted.
// Run: npx playwright test e2e/viewport.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-viewport@test.local'
const TEST_PASS = 'e2e-password-123'
const WIDTHS = [360, 768, 1024, 1440] as const

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
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-viewport', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race: the SW registered on the login page activates +
  // clients.claim()s this page → boot.js's controllerchange listener RELOADS /app once.
  // That reload can supersede a goto issued in the next instant (observed: a
  // /calendar.html navigation landing back on /app as navType "reload"). Wait for the
  // claim + the reload to settle BEFORE the test navigates again.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// Document-level horizontal overflow: the <html> element must never scroll sideways.
const noDocHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// Assert a page never scrolls the DOCUMENT sideways at all four audited widths.
// A fresh goto per width (not a resize) — deterministic CSS media-query evaluation.
async function expectNoHScrollAtAllWidths(page: Page, path: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await noDocHScroll(page)
    expect(overflow, `${path} @${width}px h-scrolls ${overflow}px`).toBeLessThanOrEqual(1)
  }
}

test('login: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await expectNoHScrollAtAllWidths(page, '/login.html')
})

test('dashboard: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/app')
})

test('projects: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/projects.html')
})

test('sparks: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/sparks.html')
})

test('calendar: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/calendar.html')
})

test('reports: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/reports.html')
})

test('settings: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/settings.html')
})

test('calendar @768: the controls row stays fully inside the viewport (regression pin)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/calendar.html')
  await page.waitForLoadState('networkidle')

  // The 69px overflow signature: .cal-controls (prev/today/next + view buttons) extended
  // past the right edge because its wrap was gated ≤640px. Unconditional wrap fixed it.
  const inside = await page.evaluate(() => {
    const el = document.querySelector('.cal-controls')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { right: r.right, clientWidth: document.documentElement.clientWidth }
  })
  expect(inside).not.toBeNull()
  expect(inside!.right).toBeLessThanOrEqual(inside!.clientWidth + 1)
  expect(await noDocHScroll(page)).toBeLessThanOrEqual(1)
})

test('calendar: the Jalali/Gregorian segmented control taps at ≥40px height', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/calendar.html')
  await page.waitForLoadState('networkidle')

  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('.cal-sys button')].map((b) => b.getBoundingClientRect().height),
  )
  expect(heights.length).toBeGreaterThanOrEqual(2) // Jalali + Gregorian pair
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(40)
})

test('short pages fill the viewport — no dead gap below the layout column', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  // The sticky-footer discipline in this app is the .shell column (min-block-size:
  // calc(100vh - 4rem)): a SHORT page must still fill the viewport instead of
  // collapsing into a floating block with dead space below it.
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/login.html')
  await page.waitForLoadState('networkidle')
  const filled = await page.evaluate(() => {
    const shell = document.querySelector('.shell') ?? document.body
    return { shellHeight: shell.getBoundingClientRect().height, vh: window.innerHeight }
  })
  expect(filled.shellHeight).toBeGreaterThanOrEqual(filled.vh - 80) // the 4rem header band
})
