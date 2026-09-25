// e2e/s140-ov-tasks.spec.ts — S140: the "Overall project tasks" section collapses
// (both surfaces, ONE shared state) and hides via Settings → Views.
//
// WHY THIS FILE EXISTS: the owner asked for the ov-tasks section to be collapsible on
// the main dashboard AND the main projects page, plus a settings opt-out. The collapse
// rides the house [data-dash-collapse] recipe (app.js initCollapseButtons + the shared
// 'hibana-dash-collapsed' store — the SAME 'ov-tasks' id on both surfaces, so one
// state rules both; re-applied after every htmx swap); the hide rides the page-width
// pure-client-preference pattern (boot.js paints html[data-ov-tasks-mode='hidden']
// pre-render; misc.css drops .ov-tasks / .dash-ov).
// These pins guard: the head anatomy (the chevron button inside the h2), the collapse
// toggling + its persistence across reloads, the cross-surface state share, and the
// settings hide on both pages.
// Run: npx playwright test e2e/s140-ov-tasks.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const DB = '/tmp/hibana-e2e.db'
const PASS = 'e2e-password-123'
const U = { email: 'e2e-s140@test.local', username: 'e2e-s140', id: randomBytes(16).toString('hex') }

async function openDb(): Promise<import('node:sqlite').DatabaseSync> {
  const { DatabaseSync } = await import('node:sqlite')
  return new DatabaseSync(DB)
}

test.beforeAll(async () => {
  const db = await openDb()
  const now = new Date().toISOString()
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const hash = `pbkdf2$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`
  db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id = '${U.id}')`)
  db.exec(`DELETE FROM projects WHERE user_id = '${U.id}'`)
  db.exec(`DELETE FROM users WHERE email = '${U.email}'`)
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${U.id}', '${U.username}', '${U.email}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s140-p1', '${U.id}', 'S140 Project', '', 'personal', 'developing', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('s140-t1', 's140-p1', 'S140 task', 'in_progress', 'medium', 0, '${now}')`,
  )
  db.close()
})

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login.html')
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', U.email)
  await page.fill('input[name="password"]', PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

test.use({ viewport: { width: 1280, height: 800 } })

test('projects: the head collapses the overview and persists across reloads', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  await login(page)
  await page.goto('/projects.html')
  const section = page.locator('#ov-tasks')
  await expect(section).toBeVisible({ timeout: 15_000 })
  // the head anatomy: a real toggle button inside the h2 (the house dash-collapse recipe)
  const btn = page.locator('#ov-tasks-h [data-dash-collapse="ov-tasks"]')
  await expect(btn).toHaveCount(1)
  // collapse → the body hides, the head stays (the toggle lives there)
  await btn.click()
  await expect(section).toHaveClass(/is-collapsed/)
  await expect(page.locator('#ov-tasks .ov-grid')).toBeHidden()
  await expect(page.locator('#ov-tasks-h')).toBeVisible()
  // persisted in the shared house store
  const stored = await page.evaluate(() => localStorage.getItem('hibana-dash-collapsed') ?? '')
  expect(stored).toContain('ov-tasks')
  // survives a reload (app.js re-applies the class on boot)
  await page.reload()
  await expect(page.locator('#ov-tasks')).toHaveClass(/is-collapsed/, { timeout: 15_000 })
  await expect(page.locator('#ov-tasks .ov-grid')).toBeHidden()
  // expand again
  await page.locator('#ov-tasks-h [data-dash-collapse="ov-tasks"]').click()
  await expect(page.locator('#ov-tasks .ov-grid')).toBeVisible()
})

test('dashboard: the same head exists and the collapse state is SHARED across surfaces', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  await login(page)
  await page.goto('/dashboard.html')
  const panel = page.locator('#ov-tasks')
  await expect(panel).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#ov-tasks-h')).toContainText('Overall project tasks')
  await expect(page.locator('.dash-proj-lower')).toBeVisible()
  // collapse HERE…
  await page.locator('#ov-tasks-h [data-dash-collapse="ov-tasks"]').click()
  await expect(page.locator('.dash-proj-lower')).toBeHidden()
  await expect(page.locator('#ov-tasks-h')).toBeVisible()
  // …and the projects page inherits the SAME state (one store id)
  await page.goto('/projects.html')
  await expect(page.locator('#ov-tasks')).toHaveClass(/is-collapsed/, { timeout: 15_000 })
  await expect(page.locator('#ov-tasks .ov-grid')).toBeHidden()
  // clean up: expand again so later tests start open
  await page.locator('#ov-tasks-h [data-dash-collapse="ov-tasks"]').click()
  await expect(page.locator('#ov-tasks .ov-grid')).toBeVisible()
})

test('settings: hiding the section removes it from both pages, unhiding restores', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  await login(page)
  await page.goto('/settings.html')
  const sel = page.locator('#ov-tasks-vis-sel')
  await expect(sel).toHaveValue('shown')
  await sel.selectOption('hidden')
  await expect(page.locator('html')).toHaveAttribute('data-ov-tasks-mode', 'hidden')
  // projects: the section is display:none (still in the DOM — hidden, not removed)
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toBeHidden({ timeout: 15_000 })
  // dashboard: the whole panel (head + row) hidden too
  await page.goto('/dashboard.html')
  await expect(page.locator('.dash-ov')).toBeHidden({ timeout: 15_000 })
  // restore
  await page.goto('/settings.html')
  await page.locator('#ov-tasks-vis-sel').selectOption('shown')
  await page.goto('/projects.html')
  await expect(page.locator('.ov-tasks')).toBeVisible({ timeout: 15_000 })
})
