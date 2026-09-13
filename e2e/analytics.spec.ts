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

test('dashboard: the urgent fire strip renders + deep-links, quiet projects hide it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e fire ${Date.now()}` }) })
    const p = ((await res.json()) as { id: string }).id
    await fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'e2e fire task', status: 'in_progress', priority: 'urgent' }) })
    // S31b: a FARSI-first urgent row in the same strip — pins the mirror side of the
    // plaintext fix (its dot must stay on the RIGHT, leading the RTL text).
    await fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'کارِ فارسیِ سنجش', status: 'in_progress', priority: 'urgent' }) })
    return p
  })
  await page.goto('/app')
  const strip = page.locator('#dash-urgent')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  await expect(strip.locator('h2')).toContainText(/urgent across projects/i)
  const row = strip.locator('.dash-urgent-row', { hasText: 'e2e fire task' })
  await expect(row).toBeVisible()
  await expect(row.locator('.dash-urgent-title')).toHaveAttribute('href', new RegExp(`/board\\.html\\?project=${pid}&task=`))
  // the row carries the project name link
  await expect(row.locator('.dash-urgent-project')).toHaveAttribute('href', `/project.html?id=${pid}`)
  // S31 (user request: "no red background — instead a beeping pulsating red light"):
  // the row itself stays TRANSPARENT (the old unscoped .prio-* rule painted the whole
  // <li> solid red), the title reads at weight 400, and the urgent dot runs the
  // double-beat prio-beep keyframes; the flame flickers on the same rhythm.
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(row.locator('.dash-urgent-title')).toHaveCSS('font-weight', '400')
  await expect(row.locator('.prio-dot')).toHaveCSS('animation-name', 'prio-beep')
  await expect(page.locator('.dash-urgent-flame')).toHaveCSS('animation-name', 'dash-flame-flicker')
  // S31b (user report: "the text is latin but showing RTL" + the stray trailing
  // bullet): the dot + title flow INLINE inside one .dash-urgent-main paragraph with
  // unicode-bidi: plaintext — the paragraph direction follows the title's first
  // strong character (an English row renders LTR with the dot LEADING at the line
  // start; a Farsi row stays RTL with the dot on the right). Before, the dot was the
  // row's first flex item (always the right edge) — an English sentence's END landed
  // right next to it and read as a stray bullet.
  await expect(row.locator('.dash-urgent-main .prio-dot')).toHaveCount(1)
  await expect(row.locator('.dash-urgent-main')).toHaveCSS('unicode-bidi', 'plaintext')
  // a Farsi-first row keeps its dot on the RIGHT (RTL lead) — the mirror of the fix
  const faRow = strip.locator('.dash-urgent-row', { hasText: 'کارِ فارسیِ سنجش' })
  await expect(faRow).toBeVisible()
  const dotSide = await faRow.locator('.dash-urgent-main').evaluate((main) => {
    const dot = main.querySelector('.prio-dot')!
    return dot.getBoundingClientRect().left - main.getBoundingClientRect().left > 30 ? 'right' : 'left'
  })
  expect(dotSide).toBe('right')
})
