// e2e/project-progress.spec.ts — the interactive progress box (S29 agenda 5) E2E:
// the Auto ⇄ Manual toggle, the milestone chip save (with a note), the reload
// round-trip, and the timeline. Pins the full client→server→0050-log→re-render loop.
// Run: npx playwright test e2e/project-progress.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-pp@test.local'
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
     VALUES ('${id}', 'e2e-pp', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see viewport.spec.ts): settle before navigating.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

async function openProject(page: Page): Promise<string> {
  // seed a fresh project through the API (the page's own session does the POST)
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e progress ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('[data-pd-progress]')).toBeVisible({ timeout: 10_000 })
  return id
}

// 401s from /api/auth/me before login + the SW navigation probe are expected.
const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
]
const trackErrors = (page: Page) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })
  return errors
}

test('progress box: Auto ⇄ Manual, milestone chip + note, reload round-trip, timeline', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const id = await openProject(page)

  // Fresh project: Auto is on — slider + chips + note are disabled, hint says Auto.
  const auto = page.locator('[data-pd-auto]')
  await expect(auto).toBeChecked()
  await expect(page.locator('[data-pd-slider]')).toBeDisabled()
  await expect(page.locator('[data-pd-hint]')).toContainText(/Auto/i)

  // Switch to Manual: the controls enable and the current value commits immediately.
  await auto.uncheck()
  await expect(page.locator('[data-pd-slider]')).toBeEnabled()
  await expect(page.locator('[data-pd-milestone="0"]')).toBeEnabled()

  // Type a milestone note, then tap the 50% chip — one gesture sets + saves.
  await page.fill('[data-pd-note]', 'Halfway checkpoint')
  await page.click('[data-pd-milestone="50"]')
  // The % label + the header bar repaint to 50.
  await expect(page.locator('[data-pd-pct]')).toHaveText('50%')
  await expect.poll(() =>
    page.evaluate(async (pid) => {
      const body = (await (await fetch(`/api/projects/${pid}/progress`)).json()) as { entries: { pct: number; note: string }[]; current: { pct: number; auto: boolean } }
      return body
    }, id),
  ).toMatchObject({ current: { pct: 50, auto: false } })

  // RELOAD: the manual value persists, the box re-opens in Manual, the timeline carries
  // both commits (the 0 on switching + the 50 with the note).
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('[data-pd-progress]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-pd-slider]')).toHaveValue('50')
  await expect(page.locator('[data-pd-auto]')).not.toBeChecked()
  await expect(page.locator('[data-pd-pct]')).toHaveText('50%')
  const timeline = page.locator('[data-pd-progress-log]')
  await expect(timeline).toContainText('Halfway checkpoint')
  await expect(timeline.locator('.pd-pl-pct.is-mid')).toHaveCount(1) // the 50% bucket badge

  // Back to Auto: the override clears (null), the timeline gains an "Auto" entry.
  await page.locator('[data-pd-auto]').check()
  await expect.poll(() =>
    page.evaluate(async (pid) => {
      const body = (await (await fetch(`/api/projects/${pid}/progress`)).json()) as { current: { auto: boolean; pct: number } }
      return body.current
    }, id),
  ).toMatchObject({ auto: true, pct: 0 })
  await expect(page.locator('[data-pd-slider]')).toBeDisabled()
  expect(errors).toEqual([])
})
