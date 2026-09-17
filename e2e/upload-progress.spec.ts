// e2e/upload-progress.spec.ts — S61: real upload progress on the project page.
//
// Both shot-upload surfaces (the media panel's grid + the task composer's staged
// shots) used fetch() with base64 JSON bodies — no upload-progress events exist on
// fetch, so the user saw NOTHING (grid) or a bare text line (composer) for seconds
// on mobile. Both now share an XHR helper with live per-file progress rows. These
// specs pin the observable lifecycle: row appears with the file name → bar fills →
// row drops on success (stays red on failure) + the grid refreshes.
//
// The POST response is held via route interception so the "uploading" window is
// observable despite localhost's instant transfer.
// Run: npx playwright test e2e/upload-progress.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-upl@test.local'
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
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-upl', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

/** A real (tiny) PNG — the API validates mimeType and the bytes land in KV. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EIwESMolGFI0chAG+bAR12QP9sAAAAAElFTkSuQmCC',
  'base64',
)

async function openProject(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e upload ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  return id
}

test('main grid: progress row appears mid-upload, drops on success, grid refreshes', async ({ page }) => {
  await login(page)
  const id = await openProject(page)

  // Hold the POST response so the uploading window is observable.
  let release: (() => void) | null = null
  const held = new Promise<void>((r) => (release = r))
  await page.route(`**/api/projects/${id}/screenshots`, async (route) => {
    if (route.request().method() === 'POST') await held
    await route.continue()
  })

  // Open the media tab (panels are tabbed; #detail-media is hidden until selected).
  await page.click('[data-detail-tab="media"]')
  await expect(page.locator('#detail-media')).toBeVisible()

  await page.setInputFiles('#shot-input', { name: 'e2e-shot.png', mimeType: 'image/png', buffer: PNG })

  // The row is up with the file name while the response is held.
  const row = page.locator('.shots-upload-row').first()
  await expect(row).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('.shots-upload-name')).toHaveText('e2e-shot.png')
  // While held: queued or active (localhost transfers instantly, so the bar is at 100%
  // of the REQUEST — the state machine is what's pinned, not a mid-transfer fraction).
  await expect(row).toHaveAttribute('data-state', /^(queued|active)$/)

  // Release: done → fade → the strip drops itself.
  release!()
  await expect(page.locator('.shots-upload-strip')).toHaveCount(0, { timeout: 5_000 })
  // The grid refreshed with the new shot card.
  await expect(page.locator('#shots .shot-card').first()).toBeVisible({ timeout: 5_000 })

  // Zero residue: remove the project (shot cascade handled server-side).
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
  }, id)
})

test('main grid: a rejected upload leaves an error row, not silence', async ({ page }) => {
  await login(page)
  const id = await openProject(page)

  // Force a failure: the server rejects a non-image mimeType (Zod regex).
  await page.route(`**/api/projects/${id}/screenshots`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"bad"}' })
    } else {
      await route.continue()
    }
  })

  await page.click('[data-detail-tab="media"]')
  await expect(page.locator('#detail-media')).toBeVisible()
  await page.setInputFiles('#shot-input', { name: 'e2e-shot.png', mimeType: 'image/png', buffer: PNG })

  const row = page.locator('.shots-upload-row').first()
  await expect(row).toBeVisible({ timeout: 5_000 })
  // Error state: red row with ✕, lingers (removed only after its 6s timer).
  await expect(row).toHaveAttribute('data-state', 'error', { timeout: 5_000 })
  await expect(row).toBeVisible()

  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
  }, id)
})

test('task composer: staged uploads show the same progress rows', async ({ page }) => {
  await login(page)
  const id = await openProject(page)

  let release: (() => void) | null = null
  const held = new Promise<void>((r) => (release = r))
  await page.route(`**/api/projects/${id}/screenshots`, async (route) => {
    if (route.request().method() === 'POST') await held
    await route.continue()
  })

  // Open the task composer (the box's + add-item row).
  const addBtn = page.locator('[data-pd-add]').first()
  await addBtn.click()
  const composer = page.locator('#pd-taskadd-shots')
  await expect(composer).toBeAttached({ timeout: 5_000 })

  await page.setInputFiles('#pd-taskadd-shots', { name: 'e2e-staged.png', mimeType: 'image/png', buffer: PNG })

  const row = page.locator('.shots-upload-row').first()
  await expect(row).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('.shots-upload-name')).toHaveText('e2e-staged.png')

  release!()
  // Done → strip drops; the staged thumbnail grid renders the shot.
  await expect(page.locator('.shots-upload-strip')).toHaveCount(0, { timeout: 5_000 })
  await expect(page.locator('#pd-taskadd-shots-grid .shot-card').first()).toBeVisible({ timeout: 5_000 })

  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}`, { method: 'DELETE' })
  }, id)
})
