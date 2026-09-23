// e2e/analytics.spec.ts — S30 batch 3: the reports Task-analytics card + the dashboard
// fire strip. Seeds a mixed board through the API, then pins both surfaces end-to-end.
// Run: npx playwright test e2e/analytics.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-an@test.local'
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
     VALUES ('${id}', 'e2e-an', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

test('reports: task analytics card (priority mix + labels + velocity)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  // seed: 1 urgent open (labeled), 1 urgent done, 1 high open — plus a sprint holding the done one
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e analytics ${Date.now()}` }) })
    return ((await res.json()) as { id: string }).id
  })
  await page.evaluate(async ({ pid: p }) => {
    const post = (body: unknown) => fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await post({ title: 'an urgent open', status: 'in_progress', priority: 'urgent', tags: ['Analytics'] })
    await post({ title: 'an urgent done', status: 'done', priority: 'urgent', tags: ['Analytics'] })
    await post({ title: 'an high open', status: 'idea', priority: 'high' })
    const s = await (await fetch(`/api/projects/${p}/sprints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'VS1' }) })).json() as { id: string }
    await fetch(`/api/sprints/${s.id}/start`, { method: 'POST' })
    const b = await (await fetch(`/api/projects/${p}/devboard`)).json() as { tasks: { id: string; title: string }[] }
    const done = b.tasks.find((t) => t.title === 'an urgent done')!
    await fetch(`/api/devtasks/${done.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sprint_id: s.id }) })
  }, { pid })

  await page.goto('/reports.html')
  const card = page.locator('.rep-tasks')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card.locator('h3')).toHaveText(/task analytics/i)
  // priority mix: urgent 1 open / 1 done
  const stats = card.locator('.stat', { hasText: /urgent/i })
  await expect(stats).toContainText('1')
  // share bar rendered with segments + the urgent percentage
  await expect(card.locator('.rep-share-seg').first()).toBeVisible()
  await expect(card.locator('.rep-share-note')).toContainText(/50% urgent/i)
  // label distribution chip
  await expect(card.locator('.rep-label-chip', { hasText: 'Analytics' })).toContainText('2')
  // velocity row: the done urgent task in the sprint
  const velRow = card.locator('.rep-vel-table tbody tr', { hasText: 'VS1' })
  await expect(velRow).toBeVisible()
  await expect(velRow).toContainText('1')
})

test('dashboard: the unified projects container carries the overview row; the fire strip is retired (S124)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e unified ${Date.now()}` }) })
    const p = ((await res.json()) as { id: string }).id
    // a bug-status task — the Problems box is the retired fire strip's replacement
    await fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'e2e fire task', status: 'bug', priority: 'urgent' }) })
    // a planned task — the Plans box (the wireframe's first box after the pie)
    await fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'e2e plan task', status: 'planned' }) })
    return p
  })
  await page.goto('/app')
  const container = page.locator('.dash-proj-unified')
  await expect(container).toBeVisible({ timeout: 10_000 })
  // ONE container: the stage carousel AND the overview row live inside the same card
  await expect(container.locator('[data-stat-track]')).toBeVisible()
  await expect(container.locator('[data-stat-dots]')).toBeVisible() // dots stay below the top row
  await expect(container.locator('.dash-proj-lower')).toBeVisible()
  // S124: the retired fire strip is gone — no section, no rows, even with urgent tasks burning
  await expect(page.locator('#dash-urgent')).toHaveCount(0)
  await expect(page.locator('.dash-urgent-row')).toHaveCount(0)
  // the lower row's order: pie card first, then Plans → Problems → In Progress
  const kids = container.locator('.dash-proj-lower > .card')
  await expect(kids).toHaveCount(4)
  await expect(kids.nth(0)).toHaveClass(/ov-pie-card/)
  await expect(kids.nth(1)).toHaveAttribute('data-ov-box', 'planned')
  await expect(kids.nth(2)).toHaveAttribute('data-ov-box', 'bug')
  await expect(kids.nth(3)).toHaveAttribute('data-ov-box', 'in_progress')
  // the donut speaks the shared overview vocabulary
  await expect(container.locator('.ov-donut')).toBeVisible()
  await expect(container.locator('.ov-box[data-ov-box="bug"] .ov-item-title', { hasText: 'e2e fire task' })).toBeVisible()
  await expect(container.locator('.ov-box[data-ov-box="bug"] .ov-item').first()).toHaveAttribute('href', `/project.html?id=${pid}`)
  await expect(container.locator('.ov-box[data-ov-box="planned"] .ov-item-title', { hasText: 'e2e plan task' })).toBeVisible()
  // the lower panel is a HORIZONTAL scroller (overflow-x) with snap points
  const overflowX = await container.locator('.dash-proj-lower').evaluate((el) => getComputedStyle(el).overflowX)
  expect(['auto', 'scroll']).toContain(overflowX)
  const snapType = await container.locator('.dash-proj-lower').evaluate((el) => getComputedStyle(el).scrollSnapType)
  expect(snapType).not.toBe('none')
  // the floating action button anchors to the container's bottom corner and opens
  // the same New Project dialog as the projects page's quick-add
  const fab = container.locator('.dash-proj-fab')
  await expect(fab).toBeVisible()
  await expect(fab).toHaveAttribute('data-projectquickadd', '')
  const fabBox = await fab.boundingBox()
  const boxBox = await container.boundingBox()
  expect(fabBox!.y + fabBox!.height).toBeGreaterThan(boxBox!.y + boxBox!.height * 0.6) // bottom-anchored
  await fab.click()
  await expect(page.locator('#projectadd-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#projectadd-dialog')).not.toBeVisible()
})
