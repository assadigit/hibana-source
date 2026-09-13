// e2e/label-manager.spec.ts — S30 batch 4: the label manager (rename-merges/recolor/
// delete-unused), the drag-into-zone priority adoption, and the bar's tier tooltip.
// Run: npx playwright test e2e/label-manager.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-lm@test.local'
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
     VALUES ('${id}', 'e2e-lm', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

test('label manager: usage list, rename-merge, recolor, delete-unused', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e lm ${Date.now()}` }) })
    const p = ((await res.json()) as { id: string }).id
    const post = (body: unknown) => fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await post({ title: 'lm one', status: 'idea', priority: 'medium', tags: ['Alpha'] })
    await post({ title: 'lm two', status: 'idea', priority: 'medium', tags: ['Alpha'] })
    await post({ title: 'lm three', status: 'idea', priority: 'medium', tags: ['Beta'] })
    return p
  })
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('.db-card')).toHaveCount(3)

  // open the manager from the toolbar
  await page.click('#db-labels-btn')
  const dlg = page.locator('.db-modal:not([hidden])')
  await expect(dlg).toBeVisible()
  const rows = dlg.locator('.db-label-row')
  await expect(rows).toHaveCount(2)
  // usage is honest: Alpha used 2×, Beta 1× — and no delete buttons (both in use)
  await expect(rows.filter({ has: page.locator('input[value="Alpha"]') }).locator('.db-label-usage')).toContainText('2')
  await expect(rows.filter({ has: page.locator('input[value="Beta"]') }).locator('.db-label-usage')).toContainText('1')
  await expect(dlg.locator('[data-lbl-del]')).toHaveCount(0)

  // rename Alpha → beta (case-insensitive collision → MERGE onto Beta)
  const alphaRow = rows.filter({ has: page.locator('input[value="Alpha"]') })
  await alphaRow.locator('.db-label-name').fill('beta')
  await alphaRow.locator('.db-label-name').press('Enter')
  await expect(dlg.locator('.db-label-row')).toHaveCount(1) // Alpha merged away
  await expect(dlg.locator('.db-label-usage')).toContainText('3')
  await page.keyboard.press('Escape')
  // the board reloaded through onChanged: every card now shows the Beta chip
  await expect(page.locator('.db-card .db-mini-chip', { hasText: 'Beta' })).toHaveCount(3)

  // recolor via the palette. The reopen's async refresh() re-renders the rows (and
  // resets every palette to hidden) — wait for its GET /api/tags to land BEFORE
  // interacting, or the clicks can race a detached re-render (the flake this buries).
  const tagsLoaded = page.waitForResponse((r) => r.url().includes('/api/tags') && r.request().method() === 'GET')
  await page.click('#db-labels-btn')
  await tagsLoaded
  await expect(dlg.locator('.db-label-row')).toHaveCount(1)
  await page.waitForTimeout(150)
  await dlg.locator('.db-label-row [data-lbl-color]').click()
  await dlg.locator('.db-label-palette [data-color="#8FD3A9"]').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.db-card .db-mini-chip').first()).toHaveAttribute('style', /8FD3A9/i)

  // delete-unused: unlink Beta from one task (PATCH tags []), then… the tag is still
  // used → the manager hides the delete button; unlink everywhere then delete works.
  await page.evaluate(async ({ pid: p }) => {
    const b = await (await fetch(`/api/projects/${p}/devboard`)).json() as { tasks: { id: string }[] }
    for (const t of b.tasks) await fetch(`/api/devtasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: [] }) })
  }, { pid })
  await page.click('#db-labels-btn')
  await expect(dlg.locator('[data-lbl-del]')).toHaveCount(1) // unused now
  page.on('dialog', (d) => d.accept()) // no confirm on delete — the row button is the confirm
  await dlg.locator('[data-lbl-del]').click()
  await expect(dlg.locator('.db-label-row')).toHaveCount(0)
})

test('project page: drag into the urgent zone adopts urgent; the bar tooltip breaks down tiers', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e zone ${Date.now()}` }) })
    const p = ((await res.json()) as { id: string }).id
    const post = (body: unknown) => fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await post({ title: 'zone urgent', status: 'idea', priority: 'urgent' })
    await post({ title: 'zone medium', status: 'idea', priority: 'medium' })
    await post({ title: 'zone low', status: 'idea', priority: 'low' })
    return p
  })
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })

  // the server-rendered tooltip: 1 urgent · 1 medium · 1 low
  const bar = page.locator('[data-pd-bar]')
  await expect(bar).toHaveAttribute('title', /1 urgent · 1 medium · 1 low/i)

  // drag the LOW card and drop it at the TOP of the urgent card (the urgent ZONE).
  // Playwright's dragTo speaks the real HTML5 drag protocol (mouse events alone
  // don't start a native drag).
  const col = page.locator('[data-pd-tasks="idea"]')
  const low = col.locator('.pd-task-wrap[data-pd-priority="low"]')
  const urgent = col.locator('.pd-task-wrap[data-pd-priority="urgent"]')
  await low.locator('.pd-task').dragTo(urgent.locator('.pd-task-title'), { targetPosition: { x: 20, y: 2 } })
  // the adopted tier: the wrap becomes urgent, the column re-sorts, the tooltip updates
  await expect(col.locator('.pd-task-wrap[data-pd-priority="low"]')).toHaveCount(0)
  await expect(col.locator('.pd-task-wrap[data-pd-priority="urgent"]')).toHaveCount(2)
  await expect(bar).toHaveAttribute('title', /2 urgent · 1 medium/i)
  // persisted (reload = server truth)
  await page.reload()
  await expect(page.locator('[data-pd-tasks="idea"] .pd-task-wrap[data-pd-priority="urgent"]')).toHaveCount(2)
})
