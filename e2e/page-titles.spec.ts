// e2e/page-titles.spec.ts — S64: localized tab titles everywhere the user can land.
//
// Three fixes pinned here:
// 1. The branded 404 serves /404.html's bytes AT the miss URL, so i18n.js's
//    TITLE_PAGES['/404.html'] key never matched — EN users kept the hardcoded Persian
//    <title>. Detection now keys on the .nf-page body class, whatever the URL is.
// 2. /notes.html (the Vault, S53) and /gallery.html (S39) were missing from the title
//    map — FA users saw English tab titles on both.
// 3. /project.html now carries the project's OWN name (language-neutral content).
// Run: npx playwright test e2e/page-titles.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const EN_EMAIL = 'e2e-titles-en@test.local'
const FA_EMAIL = 'e2e-titles-fa@test.local'
const TEST_PASS = 'e2e-password-123'

async function seedUser(email: string, username: string, lang: 'en' | 'fa') {
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
     VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', '${lang === 'fa' ? 'shamsi' : 'gregorian'}', 'UTC', '${now}', '${now}')`,
  )
  db.close()
}

test.beforeAll(async () => {
  await seedUser(EN_EMAIL, 'e2e-titles-en', 'en')
  await seedUser(FA_EMAIL, 'e2e-titles-fa', 'fa')
})

async function login(page: Page, email: string) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // Same settle guard as palette-vault.spec.ts: the login → /app redirect chain can
  // still have a navigation in flight when waitForURL resolves; a goto issued in that
  // window gets destroyed mid-flight ("interrupted by another navigation to /app").
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

test.describe('S64: localized tab titles', () => {
  test('EN user: the branded 404 at a miss URL says "Page not found", never the old Persian default', async ({ page }) => {
    await login(page, EN_EMAIL)
    await page.goto('/definitely-not-a-real-page')
    await page.waitForTimeout(600) // i18n apply() is async post-load
    await expect(page).toHaveTitle('Page not found — Hibana')
  })

  test('FA user: the 404 localizes to Persian', async ({ page }) => {
    await login(page, FA_EMAIL)
    await page.goto('/definitely-not-a-real-page')
    await page.waitForTimeout(600)
    await expect(page).toHaveTitle('صفحه پیدا نشد — Hibana')
  })

  test('FA user: the Vault (S53) and the Gallery (S39) carry Persian tab titles at last', async ({ page }) => {
    await login(page, FA_EMAIL)
    await page.goto('/notes.html')
    await page.waitForTimeout(600)
    await expect(page).toHaveTitle('یادداشت‌ها — Hibana')
    await page.goto('/gallery.html')
    await page.waitForTimeout(600)
    await expect(page).toHaveTitle('نگارخانه — Hibana')
  })

  test('the project page carries the project\'s OWN name in the tab (language-neutral content)', async ({ page }) => {
    await login(page, EN_EMAIL)
    const id = await page.evaluate(async () => {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Aurora Drone Maps', status: 'spark' }),
      })
      if (!r.ok) throw new Error('project create failed: ' + r.status)
      return ((await r.json()) as { ok: boolean; id: string }).id
    })
    try {
      await page.goto(`/project.html?id=${id}`)
      await expect(page.locator('#project-body header h1')).toHaveText('Aurora Drone Maps', { timeout: 10_000 })
      await expect(page).toHaveTitle('Aurora Drone Maps — Hibana')
    } finally {
      await page.evaluate(async (pid) => { await fetch(`/api/projects/${pid}`, { method: 'DELETE' }) }, id)
    }
  })
})
