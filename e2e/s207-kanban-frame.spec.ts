// e2e/s207-kanban-frame.spec.ts — S207 (owner asks 2026-10-19):
//   (1) the MOTHER CONTAINER — .db-frame wraps toolbar + filter + columns in ONE
//       var(--card) surface (the board stops floating loose cards on the gray desk);
//       the toolbar's .card chrome retires into the frame's header row
//   (2) TRUE full width — the board is EXEMPT from the misc.css item-12 page-width
//       'standard' 1366px cap (the owner asked twice; the cap re-caged the S206
//       full-bleed board); the frame is edge-to-edge
//   (3) /board.html?project= carries the same frame + exemption (same board.html)
//       while keeping its classic icons-rail contract
// Contract owners: board.html .db-frame/main.board-shell, devboard.css, misc.css
// (the exemption, after the item-12 block).

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s207@test.local'
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
     VALUES ('${id}', 'e2e-s207', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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
    await fetch(`/api/projects/${id}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'frame task', status: 'in_progress' }) })
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

test('kanban frame: the MOTHER CONTAINER exists — one var(--card) surface wrapping toolbar + board; the toolbar card chrome retires', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's207 frame board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // the frame exists and owns the WHOLE board family: toolbar + loading + #db-board
  // are its children (board.html structure)
  const structure = await page.evaluate(() => {
    const frame = document.querySelector('.db-frame')
    const shell = document.querySelector('main.shell')
    return {
      frame: !!frame,
      frameIsShellChild: !!(frame && shell && frame.parentElement === shell),
      toolbarInFrame: !!(frame && document.getElementById('db-toolbar')?.parentElement === frame),
      boardInFrame: !!(frame && document.getElementById('db-board')?.parentElement === frame),
      loadingInFrame: !!(frame && document.getElementById('db-loading')?.parentElement === frame),
    }
  })
  expect(structure.frame).toBe(true)
  expect(structure.frameIsShellChild).toBe(true)
  expect(structure.toolbarInFrame).toBe(true)
  expect(structure.boardInFrame).toBe(true)
  expect(structure.loadingInFrame).toBe(true)

  // the surface is the card token (white in the light default) — not transparent,
  // not the gray desk
  const frameBg = await page.evaluate(() => getComputedStyle(document.querySelector('.db-frame')!).backgroundColor)
  expect(frameBg).toBe('rgb(255, 255, 255)')

  // the toolbar's .card chrome RETIRED inside the frame: transparent, no ring,
  // a hairline under it (the frame's header row)
  const toolbarChrome = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('db-toolbar')!)
    return { bg: cs.backgroundColor, top: cs.borderTopWidth, start: cs.borderInlineStartWidth, bottom: cs.borderBottomWidth, radius: cs.borderRadius }
  })
  expect(toolbarChrome.bg).toBe('rgba(0, 0, 0, 0)')
  expect(toolbarChrome.top).toBe('0px')
  expect(toolbarChrome.start).toBe('0px')
  expect(toolbarChrome.bottom).toBe('1px')
  expect(toolbarChrome.radius).toBe('0px')
  expect(errors).toEqual([])
})

test('kanban frame: TRUE full width under the STANDARD page-width choice — the frame is edge-to-edge, the columns span the viewport', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's207 width board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // the default fresh-context choice is 'standard' — the exact condition that
  // used to cap the board at 1366px. Prove the exemption is exercised.
  const pageWidth = await page.evaluate(() => document.documentElement.dataset.pageWidth || '')
  expect(['standard', '']).toContain(pageWidth)

  // the shell's cap is GONE (misc.css exemption) and its padding is 0
  const shellMetrics = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('main.shell')!)
    return { maxInline: cs.maxInlineSize, padding: cs.paddingInline }
  })
  expect(shellMetrics.maxInline).toBe('none')
  expect(shellMetrics.padding).toBe('0px')

  // the frame is EDGE-TO-EDGE — AP-2 (Phase 2): the old single-sample assertion
  // (left === 0 && right === innerWidth) was runner-side nondeterministic: CI hit
  // offsets 31/3/57 across runs (transient layout states at sample time — htmx swap
  // settling, late reflow), and `right === innerWidth` ALSO breaks whenever a vertical
  // scrollbar legitimately exists (content taller than the viewport shrinks the layout
  // viewport by the scrollbar width). The INTENT is unchanged — edge-to-edge against
  // the CONTENT viewport — but now it is scrollbar-independent and polls until the
  // geometry settles instead of sampling once.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const r = document.querySelector('.db-frame')!.getBoundingClientRect()
          const root = document.documentElement
          const rootLeft = root.getBoundingClientRect().left
          return Math.round(r.left - rootLeft) === 0 && Math.round(r.width) === root.clientWidth
        }),
      { timeout: 4000 },
    )
    .toBe(true)
  const vw = await page.evaluate(() => innerWidth)

  // the columns span (viewport minus the frame's own padding) — NOT a centered
  // 1366px island: assert the board grid takes ≥ 90% of the viewport width and
  // starts within the frame's inset
  const colsBox = await page.evaluate(() => {
    const r = document.querySelector('.db-cols')!.getBoundingClientRect()
    return { left: Math.round(r.left), width: Math.round(r.width) }
  })
  expect(colsBox.width).toBeGreaterThan(vw * 0.9)
  expect(colsBox.left).toBeLessThan(40)
  expect(errors).toEqual([])
})

test('kanban frame: the surface fills the first screen (the height floor) — a short board still reads as THE board', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's207 floor board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const floor = await page.evaluate(() => {
    const frame = document.querySelector('.db-frame')!
    const cs = getComputedStyle(frame)
    const hasFloor = cs.minBlockSize !== 'auto' && parseFloat(cs.minBlockSize) > 0
    return { hasFloor, height: Math.round(frame.getBoundingClientRect().height), vh: innerHeight }
  })
  expect(floor.hasFloor).toBe(true)
  expect(floor.height).toBeGreaterThanOrEqual(floor.vh - 48) // fills the viewport (± the 1.5rem floor allowance)
  expect(errors).toEqual([])
})

test('/board.html?project= carries the same frame + width exemption while keeping its classic contract', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's207 board classic')
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })

  // same board.html → same mother container + same exemption (cap gone)
  await expect(page.locator('.db-frame')).toHaveCount(1)
  const maxInline = await page.evaluate(() => getComputedStyle(document.querySelector('main.shell')!).maxInlineSize)
  expect(maxInline).toBe('none')

  // the classic contract stays: icons-only rail + its 64px gutter + the Back link
  expect(await page.evaluate(() => document.body.classList.contains('rail-icons-only'))).toBe(true)
  await expect
    .poll(async () => await page.evaluate(() => getComputedStyle(document.body).paddingInlineStart), { timeout: 5_000 })
    .toBe('64px')
  await expect(page.locator('[data-back-link]')).toBeVisible()
  expect(errors).toEqual([])
})

test('mobile: the frame stays full-bleed and padded at phone width', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's207 mobile frame')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const frame = await page.evaluate(() => {
    const el = document.querySelector('.db-frame')!
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { left: Math.round(r.left), width: Math.round(r.width), vw: innerWidth, pad: cs.paddingInline }
  })
  expect(frame.left).toBe(0)
  expect(frame.width).toBe(frame.vw)
  // the phone inset — present (breathing room) but slimmer than the desktop 1rem
  const padPx = parseFloat(frame.pad)
  expect(padPx).toBeGreaterThan(0)
  expect(padPx).toBeLessThanOrEqual(16)
  expect(errors).toEqual([])
})
