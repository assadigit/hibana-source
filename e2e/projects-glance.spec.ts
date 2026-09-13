// e2e/projects-glance.spec.ts — S44 regression net for the projects page's glance strip.
// The owner's report (verbatim): "https://hibana.ir/projects.html?status=doing&view=cards
// here when you click [the در حال انجام box] nothing happens, but it is supposed to
// show در حال انجام projects." Root cause: nav.js's CAPTURE-phase link interceptor
// stopPropagation'd the click before the page's in-place filter handler could run, then
// no-op'd on the byte-identical URL — dead click. The boxes now carry data-nav-local
// (the navigator stands down) and the handler rides the form's own change machinery,
// flipping the stages grid to cards like any other filter touch.
// Run: npx playwright test e2e/projects-glance.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-glance@test.local'
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
     VALUES ('${id}', 'e2e-glance', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
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

test('glance strip: clicking a box filters IN PLACE (grid flips to cards) — never a dead click', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // Two doing + one operational project (API truth pipeline).
  const mk = async (title: string, status: string) => {
    const p = (await api(page, '/api/projects', 'POST', { title })) as { json: { id: string } }
    await api(page, `/api/projects/${p.json.id}`, 'PATCH', { status })
    return p.json.id
  }
  await mk(`e2e glance doing one ${Date.now()}`, 'doing')
  await mk(`e2e glance doing two ${Date.now()}`, 'doing')
  await mk(`e2e glance operational ${Date.now()}`, 'operational')

  // 1) From the default GRID: clicking the doing box applies the stage filter in
  //    place — no navigation (URL stays /projects.html), the view flips to cards.
  await page.goto('/projects.html')
  await page.waitForSelector('.pglance-box', { timeout: 10_000 })
  await page.waitForTimeout(400)
  await page.click('.pglance-box[data-pglance="doing"]')
  await page.waitForTimeout(800)
  expect(page.url()).toMatch(/\/projects\.html$/) // no ?status= navigation
  await expect(page.locator('select[name="status"]')).toHaveValue('doing')
  await expect(page.locator('#view')).toHaveValue('cards')
  const titles = await page.$$eval('#project-list .project-title', (els) => els.map((e) => e.textContent || ''))
  expect(titles.filter((t) => t.includes('glance doing'))).toHaveLength(2)
  expect(titles.some((t) => t.includes('glance operational'))).toBe(false)
  await expect(page.locator('.pglance-box.is-active')).toHaveAttribute('data-pglance', 'doing')

  // 2) Clicking the ACTIVE box clears the filter (toggle) — all statuses visible.
  await page.click('.pglance-box[data-pglance="doing"]')
  await page.waitForTimeout(800)
  await expect(page.locator('select[name="status"]')).toHaveValue('')
  const titlesAll = await page.$$eval('#project-list .project-title', (els) => els.map((e) => e.textContent || ''))
  expect(titlesAll.some((t) => t.includes('glance operational'))).toBe(true)

  // 3) THE OWNER'S EXACT SCENARIO: hard-load the status URL, then click that same
  //    box — before S44 this was a dead click (nav.js same-URL skip). It must toggle
  //    the filter off in place.
  await page.goto('/projects.html?status=doing&view=cards')
  await page.waitForSelector('.pglance-box', { timeout: 10_000 })
  await page.waitForTimeout(400)
  await page.click('.pglance-box[data-pglance="doing"]')
  await page.waitForTimeout(800)
  await expect(page.locator('select[name="status"]')).toHaveValue('')
  const titlesAfter = await page.$$eval('#project-list .project-title', (els) => els.map((e) => e.textContent || ''))
  expect(titlesAfter.some((t) => t.includes('glance operational'))).toBe(true)

  expect(errors).toEqual([])
})

test('glance strip: same-page re-entry re-mounts (language-toggle/popstate path keeps URL params)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const p = (await api(page, '/api/projects', 'POST', { title: `e2e glance remount ${Date.now()}` })) as { json: { id: string } }
  await api(page, `/api/projects/${p.json.id}`, 'PATCH', { status: 'doing' })

  await page.goto('/projects.html?status=doing&view=cards')
  await page.waitForSelector('.pglance-box', { timeout: 10_000 })
  await page.waitForTimeout(500)
  await expect(page.locator('select[name="status"]')).toHaveValue('doing') // param adopted on hard load

  // hibanaNav.reload() is the language toggle's path: a same-page soft navigation.
  // Before S44 the fresh shell never re-mounted (the page script was "already
  // present") — the list fell back to the unfiltered default grid.
  await page.evaluate(() => window.hibanaNav?.reload())
  await page.waitForTimeout(1200)
  expect(page.url()).toMatch(/status=doing/)
  await expect(page.locator('select[name="status"]')).toHaveValue('doing')
  await expect(page.locator('#view')).toHaveValue('cards')
  const titles = await page.$$eval('#project-list .project-title', (els) => els.map((e) => e.textContent || ''))
  expect(titles.some((t) => t.includes('glance remount'))).toBe(true)

  expect(errors).toEqual([])
})
