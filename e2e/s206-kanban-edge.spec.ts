// e2e/s206-kanban-edge.spec.ts — S206 (owner asks 2026-10-18):
//   (1) the kanban board is FULL-WIDTH by default — the rail gutter drops to 0
//   (2) the sidebar is HIDDEN (even its collapsed icon form) and returns ONLY on
//       start-edge hover (the #rail-edge-zone tripwire) — it slides in as an
//       overlay, and hides again when the pointer leaves
//   (3) the toolbar's project name gets room + the control register (fs-md,
//       single-line ellipsis) and the Back link retires on the dedicated entry
// Contract owners: layout.css body.rail-edge / #rail-edge-zone, nav.js
// RAIL_EDGE_PAGES + syncEdgeZone, devboard.css .db-title/.db-switch, board-page.js.

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s206@test.local'
const TEST_PASS = 'e2e-password-123'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s206', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForTimeout(400)
}

async function seedProject(page: Page, title: string): Promise<string> {
  return await page.evaluate(async (title) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    await fetch(`/api/projects/${id}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'edge task', status: 'in_progress' }) })
    return id
  }, title)
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

test('kanban edge rail: full-bleed gutter + the rail is OFF-CANVAS until the pointer nears the start edge', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's206 edge board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // (1) the body gutter is GONE — the board owns the full viewport width.
  await expect
    .poll(async () => await page.evaluate(() => getComputedStyle(document.body).paddingInlineStart), { timeout: 5_000 })
    .toBe('0px')
  const bodyHasEdge = await page.evaluate(() => document.body.classList.contains('rail-edge'))
  expect(bodyHasEdge).toBe(true)

  // (2) the rail is off-canvas (translated past the start edge) — not visible.
  const railBoxHidden = await page.evaluate(() => {
    const rail = document.querySelector('nav.rail') as HTMLElement | null
    if (!rail) return null
    const r = rail.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    return rtl ? { right: Math.round(r.right), left: Math.round(r.left) } : { left: Math.round(r.left), right: Math.round(r.right) }
  })
  expect(railBoxHidden).not.toBeNull()
  // LTR: fully left of x=0; (RTL mirror is exercised by the FA suite's geometry.)
  expect((railBoxHidden as { left: number; right: number }).right).toBeLessThanOrEqual(0)

  // the tripwire exists and is pointer-reachable at the start edge
  const zone = page.locator('#rail-edge-zone')
  await expect(zone).toHaveCount(1)

  // (3) hover at the edge REVEALS the rail as an overlay (no body reflow)
  await page.mouse.move(4, 400)
  await expect
    .poll(async () => await page.evaluate(() => document.body.classList.contains('rail-edge-open')), { timeout: 5_000 })
    .toBe(true)
  const railBoxOpen = await page.evaluate(() => {
    const r = document.querySelector('nav.rail')!.getBoundingClientRect()
    const pad = getComputedStyle(document.body).paddingInlineStart
    return { left: Math.round(r.left), width: Math.round(r.width), pad }
  })
  // the 0.18s slide may still be mid-flight — poll the settled geometry
  await expect
    .poll(async () => await page.evaluate(() => Math.round(document.querySelector('nav.rail')!.getBoundingClientRect().left)), { timeout: 5_000 })
    .toBe(0)
  expect(railBoxOpen.width).toBeGreaterThan(40) // the compact icon rail (64px), not zero
  expect(railBoxOpen.pad).toBe('0px') // overlay, never a reflow
  // the rail's icons are clickable while revealed
  await expect(page.locator('nav.rail .rail-btn').first()).toBeVisible()

  // (4) leaving the edge + rail HIDES it again (300ms grace)
  await page.mouse.move(600, 400)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => document.body.classList.contains('rail-edge-open'))).toBe(false)

  // (5) a revealed rail NAVIGATES: hovering in, clicking an icon lands on a page
  // with the labeled rail restored (edge class gone, gutter back).
  await page.mouse.move(4, 400)
  await expect
    .poll(async () => await page.evaluate(() => document.body.classList.contains('rail-edge-open')), { timeout: 5_000 })
    .toBe(true)
  await page.click('nav.rail .rail-primary a[href="/projects.html"]')
  await page.waitForURL('**/projects.html', { timeout: 10_000 })
  await expect
    .poll(async () => await page.evaluate(() => document.body.classList.contains('rail-edge')), { timeout: 5_000 })
    .toBe(false)
  await expect
    .poll(async () => await page.evaluate(() => getComputedStyle(document.body).paddingInlineStart), { timeout: 5_000 })
    .toBe('88px')
  expect(errors).toEqual([])
})

test('kanban edge rail: keyboard focus reveals it too (the a11y path — no mouse required)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's206 focus board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () => await page.evaluate(() => document.body.classList.contains('rail-edge')), { timeout: 5_000 })
    .toBe(true)

  // focus a rail link directly (as Tab would after the skip-link) — the rail slides in
  await page.evaluate(() => {
    const link = document.querySelector('nav.rail .rail-primary a') as HTMLElement | null
    link?.focus()
  })
  await expect
    .poll(async () => await page.evaluate(() => document.body.classList.contains('rail-edge-open')), { timeout: 5_000 })
    .toBe(true)
  // focus leaving the rail hides it again (same grace)
  await page.evaluate(() => (document.getElementById('db-project-switch') as HTMLElement).focus())
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => document.body.classList.contains('rail-edge-open'))).toBe(false)
  expect(errors).toEqual([])
})

test('kanban toolbar: the project name takes the room — control register, one line, ellipsis; the Back link retires on the entry', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // a deliberately long title — the old fs-xl + overflow-wrap squeezed this into a
  // multi-line mess beside the Back link + counts + two buttons
  const longTitle = 's206 ' + 'A very long project name that used to wrap the toolbar into a squeeze '
  const pid = await seedProject(page, longTitle)
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('#db-project-switch')).toBeVisible({ timeout: 10_000 })

  // the Back link is GONE on the dedicated entry (kept on /board.html — the
  // project-page context — pinned in the next test)
  await expect(page.locator('[data-back-link]')).toBeHidden()

  // the name speaks the control register: 14px (fs-md), one line, ellipsized
  const titleMetrics = await page.evaluate(() => {
    const el = document.getElementById('db-title')!
    const cs = getComputedStyle(el)
    return { fontSize: cs.fontSize, whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, height: Math.round(el.getBoundingClientRect().height), full: (el as HTMLElement).title }
  })
  expect(titleMetrics.fontSize).toBe('14px')
  expect(titleMetrics.whiteSpace).toBe('nowrap')
  expect(titleMetrics.textOverflow).toBe('ellipsis')
  // the full name rides the span's title attribute (hover reveals it)
  expect(titleMetrics.full).toContain('A very long project name')
  // the h2 flexes and the switcher stays a single-line control (44px touch floor,
  // never a multi-line 60px+ box)
  const switchBox = await page.locator('#db-project-switch').boundingBox()
  expect(switchBox).not.toBeNull()
  expect(switchBox!.height).toBeLessThanOrEqual(48)

  // the switcher still OPENS (the S205 contract is intact)
  await page.click('#db-project-switch')
  await expect(page.locator('#db-switch-pop')).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('/board.html?project= keeps its own contract: the Back link visible + the icons-only rail (the project-page context)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's206 board classic')
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  // the classic board keeps the icons-only rail (S136) — NOT the edge mode
  expect(await page.evaluate(() => document.body.classList.contains('rail-edge'))).toBe(false)
  expect(await page.evaluate(() => document.body.classList.contains('rail-icons-only'))).toBe(true)
  await expect
    .poll(async () => await page.evaluate(() => getComputedStyle(document.body).paddingInlineStart), { timeout: 5_000 })
    .toBe('64px')
  // and its Back link stays (arrived FROM the project page)
  await expect(page.locator('[data-back-link]')).toBeVisible()
  expect(errors).toEqual([])
})

test('mobile: the edge zone never renders below the desktop breakpoint (the bottom nav owns navigation)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's206 mobile board')
  await page.setViewportSize({ width: 780, height: 900 })
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  // the zone element may exist (nav.js mounts it on edge pages) but CSS keeps it
  // display:none below 1025px — no dead invisible strip over the board
  const zoneDisplay = await page.evaluate(() => {
    const el = document.getElementById('rail-edge-zone')
    return el ? getComputedStyle(el).display : 'absent'
  })
  expect(['none', 'absent']).toContain(zoneDisplay)
  // the rail itself is display:none on mobile (the existing contract)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('nav.rail')!).display)).toBe('none')
  expect(errors).toEqual([])
})
