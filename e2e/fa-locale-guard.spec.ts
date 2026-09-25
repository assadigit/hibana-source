// e2e/fa-locale-guard.spec.ts — S30 batch 5 (user request): the FA-locale guard.
// The "Farsi shows English dropdown items" bug class has bitten twice (Session 23,
// and it nearly did again today) — every new dropdown/label surface ships EN+FA, but
// nothing PINS the Farsi render. This spec flips a fresh account to language_pref='fa'
// and asserts the translated strings of every S30 surface: the composer's priority
// dropdown, the filter bar, the dot-cycle tooltip, the problems picker, the bar's
// tier tooltip, and the board's filter row. Run:
//   npx playwright test e2e/fa-locale-guard.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-fa@test.local'
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
  // NOTE: language_pref='fa' — the whole point. The bug class: a new dropdown ships
  // with hard-coded English strings and only Farsi users notice.
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-fa', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}')`,
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

async function seedProject(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e fa ${Date.now()}` }),
    })
    const pid = ((await res.json()) as { id: string }).id
    await fetch(`/api/projects/${pid}/devtasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'فوری تست', status: 'in_progress', priority: 'urgent', tags: ['امنیت'] }),
    })
    return pid
  })
}

test('FA locale: every S30 surface renders Farsi (composer, filter bar, tooltips, pickers)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await seedProject(page)

  // ---- the project page ----
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })

  // the composer's PRIORITY dropdown: the four owner-worded options in Farsi
  await page.click('[data-pd-add="idea"]')
  const dlg = page.locator('#pd-taskadd-modal')
  await expect(dlg).toBeVisible()
  const opts = page.locator('#pd-taskadd-priority option')
  await expect(opts).toHaveCount(4)
  await expect(opts.nth(0)).toHaveText('فوری')
  await expect(opts.nth(1)).toHaveText('اولویت بالا')
  await expect(opts.nth(2)).toHaveText('اولویت متوسط')
  await expect(opts.nth(3)).toHaveText('اولویت کم')
  await expect(page.locator('#pd-taskadd-tags')).toHaveAttribute('placeholder', /UI\/UX|امنیت/)
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()

  // the filter bar: labels + the priority toggles + the label chip
  await expect(page.locator('[data-pd-filter] [data-fp]')).toHaveCount(4, { timeout: 10_000 })
  const filterBar = page.locator('[data-pd-filter]')
  await expect(filterBar).toContainText('اولویت')
  await expect(page.locator('[data-pd-filter] [data-fp="urgent"]')).toContainText('فوری')
  await expect(page.locator('[data-pd-filter] [data-ft]')).toHaveCount(1)
  await expect(page.locator('[data-pd-filter] [data-ft]')).toContainText('امنیت')

  // the dot-cycle tooltip + the meta priority label
  const dot = page.locator('[data-pd-cycle-prio]').first()
  await expect(dot).toHaveAttribute('title', 'اولویت: فوری — برای تغییر کلیک کن')
  await expect(page.locator('.pd-meta-prio').first()).toHaveText('فوری')

  // the bar's tier tooltip (FA digits + Farsi tier names)
  await expect(page.locator('[data-pd-bar]')).toHaveAttribute('title', '۱ فوری')

  // the problems composer's picker
  await page.click('[data-detail-tab="problems"]')
  const picker = page.locator('[data-problem-add] select[name=priority]')
  await expect(picker).toBeVisible()
  await expect(picker.locator('option')).toHaveText(['فوری', 'اولویت بالا', 'اولویت متوسط', 'اولویت کم'])

  // ---- the board page ----
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('[data-db-filter]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1)
  await expect(page.locator('[data-db-filter]')).toContainText('اولویت')
  await expect(page.locator('[data-db-filter] [data-fp="urgent"]')).toContainText('فوری')
  await expect(page.locator('[data-db-filter] [data-ft]')).toContainText('امنیت')
  // the dot tooltip uses the board's short wording — فوری, translated
  await expect(page.locator('[data-db-cycle-prio]')).toHaveAttribute('title', /فوری|اولویت/)
})
