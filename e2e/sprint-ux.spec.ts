// e2e/sprint-ux.spec.ts — S45 (owner directive: "improving UI/UX of sprints and
// projects page and functionality"): the SPRINT BATCH presentation contracts.
//   1. S1 (the FA-locale guard, third bite): the sprint page's INJECTED DOM —
//      the categories side-head, the chip popover's Save/Finish/Reopen/Delete,
//      the new-category form — must translate AT RENDER TIME. i18n.js's apply()
//      scans the static DOM only; injected data-i18n attrs are never re-scanned,
//      so these surfaces rendered English on the FA page forever.
//   2. S3: FINISH is a compact outlined control with the sprint name in its own
//      ellipsized span (was a 264px solid-red block that read as an error banner).
//   3. S4: the strip is VISIBLE — clip ≥ 19px, chip ≥ 27px (was 9px / 22px).
//   4. S7: the no-sprints lane is a rich empty state whose CTA opens the SAME
//      define popover as the toolbar's ◆ button.
//   5. S2 (390px): the TIMELINE renders above the categories panel.
// Run: npx playwright test e2e/sprint-ux.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const FA_EMAIL = 'e2e-s45fa@test.local'
const EN_EMAIL = 'e2e-s45en@test.local'
const TEST_PASS = 'e2e-password-123'

async function seedUser(email: string, lang: string) {
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
    db.exec(`DELETE FROM users WHERE email = '${email}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', '${email.split('@')[0]}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', '${lang === 'fa' ? 'shamsi' : 'gregorian'}', 'UTC', '${now}', '${now}')`,
  )
  db.close()
}

test.beforeAll(async () => {
  await seedUser(FA_EMAIL, 'fa')
  await seedUser(EN_EMAIL, 'en')
})

async function login(page: Page, email: string) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForTimeout(300)
}

async function api(page: Page, path: string, method: string, body?: object) {
  return page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }, { path, method, body })
}

const trackErrors = (page: Page) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (/Failed to load resource/.test(msg.text())) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test('S45 sprint FA: injected surfaces translate at render time (S1, the third-bite guard)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s45 fa ${Date.now()}` })) as { json: { id: string } }).json.id
  const sid = ((await api(page, `/api/projects/${pid}/sprints`, 'POST', { name: 'اسپرینت تست' })) as { json: { id: string } }).json.id
  await api(page, `/api/sprints/${sid}/start`, 'POST')

  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('.sp-sprint-chip', { timeout: 10_000 })
  await page.waitForTimeout(500)

  // The categories side-head — the exact string the audit caught rendering
  // English on the FA page (data-i18n on injected DOM is inert).
  await expect(page.locator('.sp-side-head')).toHaveText('دسته‌بندی‌ها')

  // The chip popover's action buttons — same bug class, same fix.
  await page.click('.sp-sprint-chip')
  await page.waitForSelector('.sp-sprint-pop', { timeout: 5_000 })
  await expect(page.locator('.sp-sprint-pop [data-sp-save]')).toHaveText('ذخیره')
  await expect(page.locator('.sp-sprint-pop [data-sp-finish]')).toHaveText('پایان اسپرینت')
  await expect(page.locator('.sp-sprint-pop [data-sp-del]')).toHaveText('حذف')
  await page.keyboard.press('Escape')

  // The new-category form's Add/Cancel (injected with the side panel).
  await page.click('[data-new-category]')
  await expect(page.locator('[data-cat-form] button[type="submit"]')).toHaveText('افزودن')
  await expect(page.locator('[data-cat-form] [data-cat-cancel]')).toHaveText('انصراف')

  expect(errors).toEqual([])
})

test('S45 sprint: finish is a compact control + the strip is visible (S3 + S4)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, EN_EMAIL)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s45 ux ${Date.now()}` })) as { json: { id: string } }).json.id
  const sid = ((await api(page, `/api/projects/${pid}/sprints`, 'POST', { name: 'Auth module' })) as { json: { id: string } }).json.id
  await api(page, `/api/sprints/${sid}/start`, 'POST')

  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('.sp-sprint-chip', { timeout: 10_000 })
  await page.waitForTimeout(500)

  // S4: the video-editing strip is tall enough to SEE (was a 9px sliver).
  const clipBox = await page.locator('.sp-clip').boundingBox()
  const chipBox = await page.locator('.sp-sprint-chip').boundingBox()
  expect(clipBox!.height).toBeGreaterThanOrEqual(19)
  expect(chipBox!.height).toBeGreaterThanOrEqual(27)
  // The strip sits BELOW the chip, never overlapping it.
  expect(clipBox!.y).toBeGreaterThanOrEqual(chipBox!.y + chipBox!.height - 1)

  // S3: outlined danger (not a solid red banner), width capped, and the running
  // sprint's NAME rides its own span.
  const btn = page.locator('#sp-finish-btn')
  await expect(btn).toBeVisible()
  await expect(btn).toHaveClass(/ghost/)
  const btnBox = await btn.boundingBox()
  expect(btnBox!.width).toBeLessThanOrEqual(244)
  await expect(page.locator('#sp-finish-lbl')).toHaveText('Finish sprint')
  await expect(page.locator('#sp-finish-name')).toContainText('Auth module')
  // The full context rides the tooltip + aria-label.
  await expect(btn).toHaveAttribute('aria-label', /Auth module/)

  expect(errors).toEqual([])
})

test('S45 sprint: the no-sprints lane is a rich empty state whose CTA opens the define popover (S7)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, EN_EMAIL)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s45 empty ${Date.now()}` })) as { json: { id: string } }).json.id
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('.sp-empty', { timeout: 10_000 })

  await expect(page.locator('.sp-empty-title')).toContainText(/No sprints yet/i)
  await expect(page.locator('.sp-empty-hint')).toContainText(/strip/i)
  // The CTA opens the SAME define popover as the toolbar's ◆ (one code path —
  // the outside-click guard must not eat it in the opening tick).
  await page.click('[data-sp-empty-define]')
  await expect(page.locator('.sp-define-pop [data-sp-define-name]')).toBeVisible()
  await expect(page.locator('.sp-define-pop')).toContainText(/Define a new sprint/i)
  // Typing a name + Define commits → the draft panel appears (the popover works).
  await page.fill('[data-sp-define-name]', 'First sprint')
  await page.click('[data-sp-define-ok]')
  await expect(page.locator('[data-sp-draft-card]')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('[data-sp-draft-name]')).toHaveValue('First sprint')

  expect(errors).toEqual([])
})

test('S45 sprint 390px: the timeline renders ABOVE the categories panel (S2)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, FA_EMAIL)

  const pid = ((await api(page, '/api/projects', 'POST', { title: `e2e s45 m ${Date.now()}` })) as { json: { id: string } }).json.id
  const sid = ((await api(page, `/api/projects/${pid}/sprints`, 'POST', { name: 'اسپرینت موبایل' })) as { json: { id: string } }).json.id
  await api(page, `/api/sprints/${sid}/start`, 'POST')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/sprint.html?project=${pid}`)
  await page.waitForSelector('.sp-sprint-chip', { timeout: 10_000 })
  await page.waitForTimeout(500)

  // The page's PURPOSE leads: the timeline's y sits above the side panel's y
  // (the categories panel used to stack ~580px of chrome above the board).
  const scrollBox = await page.locator('#sp-scroll').boundingBox()
  const sideBox = await page.locator('#sp-side').boundingBox()
  expect(scrollBox!.y).toBeLessThan(sideBox!.y)
  // No horizontal document scroll at 390 (the S43 law).
  const docH = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(docH).toBe(false)

  expect(errors).toEqual([])
})
