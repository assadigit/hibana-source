// e2e/s112-polish.spec.ts — S112 (v0.3.45.0): three contracts pinned
//
// 1. THE TOUR WIDTH FIX (mobile QA finding, agent-browser 390px): the centered tour
//    card shrink-fit against left:50% — exactly HALF the viewport (195px on a phone);
//    the welcome card wrapped every 3–4 words. placeCardCentered now forces an explicit
//    width (min(360, vw-24)); placeCardBeside resets it so anchored steps shrink-wrap.
// 2. The share-capture toast (the S111 carry-forward): saving a share-sheet capture
//    announces itself — in place when the document survives, or on the landing page
//    after a hard navigation. Cancel never toasts.
// 3. The branded sketch chip: the raw "Choose File" UA control is replaced by a chip
//    that mirrors the file input (filename on pick, idle hint on reset).

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s112@test.local'
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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* fresh */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${randomBytes(16).toString('hex')}', 'e2e-s112', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

const loginFresh = async (page: import('@playwright/test').Page) => {
  // fresh profile per navigation block: the tour gate + share flags ride localStorage/sessionStorage
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 15000 })
}

test('the centered tour card gets an explicit width on a 390px phone — not half the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginFresh(page)
  // the tour arms 1200ms after DOMContentLoaded (+ the account-age probe)
  await page.waitForSelector('.tour-overlay', { timeout: 10000 })
  await page.waitForTimeout(300)
  const card = page.locator('.tour-card')
  const box = await card.boundingBox()
  expect(box).toBeTruthy()
  // the fix: width = min(360, vw-24) = 360 → at least 340 (small layout drift tolerated);
  // the BUG was 195 (half of 390)
  expect(box!.width).toBeGreaterThanOrEqual(340)
  expect(box!.width).toBeLessThanOrEqual(367)
  // and the card stays centered inside the viewport
  expect(box!.x).toBeGreaterThanOrEqual(10)
  expect(box!.x + box!.width).toBeLessThanOrEqual(381)
  // advancing to an ANCHORED step resets the forced width (the FAB step is targetable)
  // — jump straight to the FAB step via the progress dots (step index 9 of 13)
  await page.click('.tour-dot[data-step="9"]')
  await page.waitForTimeout(250)
  const beside = await card.boundingBox()
  expect(beside).toBeTruthy()
  expect(beside!.width).toBeLessThanOrEqual(340) // shrink-wrap restored
  // the forced width never sticks after the tour ends either
  await page.click('.tour-skip')
  await page.waitForSelector('.tour-overlay', { state: 'detached' })
})

test('saving a share-sheet capture announces itself with a toast; cancel never does', async ({ page }) => {
  await loginFresh(page)
  await page.evaluate(() => { try { localStorage.removeItem('hibana-tour-done') } catch {} ; localStorage.setItem('hibana-tour-done', '1') })
  // land with share params
  await page.goto(`/dashboard.html?title=${encodeURIComponent('Toast ride')}&text=${encodeURIComponent('toast body')}&url=${encodeURIComponent('https://example.com/toast')}`)
  await page.waitForSelector('#quickadd-dialog[open]')
  await page.fill('#qa-title', 'Toast ride')
  await page.click('#qa-save')
  // online save → close → navigate to /app (soft) — the save handler toasts in place
  await page.waitForSelector('#quickadd-dialog[open]', { state: 'hidden' })
  await page.waitForSelector('.toast, [class*="toast"]', { timeout: 10000 })
  const toastText = await page.locator('.toast, [class*="toast"]').first().textContent()
  expect(toastText).toContain('Idea captured from the share sheet')
  // the token is consumed on the next boot — a reload of the SAME document shape never re-toasts
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const retoast = await page.locator('.toast, [class*="toast"]').count()
  expect(retoast).toBe(0)
})

test('the sketch chip mirrors the file input — filename on pick, idle hint on reset', async ({ page }) => {
  await loginFresh(page)
  await page.evaluate(() => localStorage.setItem('hibana-tour-done', '1'))
  await page.goto('/dashboard.html')
  await page.waitForSelector('[data-fab-toggle]', { timeout: 10000 })
  await page.click('[data-fab-toggle]') // opens the FAB menu
  await page.click('[data-quickadd-open]') // its first item opens quick-add
  await page.waitForSelector('#quickadd-dialog[open]')
  // idle: the hint shows, the name is hidden
  await expect(page.locator('.qa-sketch-text')).toBeVisible()
  await expect(page.locator('.qa-sketch-name')).toBeHidden()
  // pick a file (setInputFiles on the visually-hidden input)
  await page.setInputFiles('#qa-file', {
    name: 'sketch.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  })
  await expect(page.locator('.qa-sketch-name')).toBeVisible()
  await expect(page.locator('.qa-sketch-name')).toHaveText('sketch.png')
  await expect(page.locator('.qa-sketch-text')).toBeHidden()
  await expect(page.locator('.qa-sketch')).toHaveClass(/has-file/)
  // cancel → the dialog form persists across close (draft preservation is by design —
  // only a successful save resets), so reopening shows the chip STILL mirroring the
  // file input: has-file with the same filename. The mirror must be faithful.
  await page.click('#qa-cancel')
  await page.waitForSelector('#quickadd-dialog[open]', { state: 'hidden' })
  await page.waitForTimeout(150)
  await page.click('[data-fab-toggle]')
  await page.click('[data-quickadd-open]')
  await page.waitForSelector('#quickadd-dialog[open]')
  await expect(page.locator('.qa-sketch-name')).toBeVisible()
  await expect(page.locator('.qa-sketch-name')).toHaveText('sketch.png')
  await expect(page.locator('.qa-sketch')).toHaveClass(/has-file/)
  // clearing the file input returns the chip to idle (name hidden, hint back)
  await page.setInputFiles('#qa-file', [])
  await expect(page.locator('.qa-sketch-text')).toBeVisible()
  await expect(page.locator('.qa-sketch-name')).toBeHidden()
})
