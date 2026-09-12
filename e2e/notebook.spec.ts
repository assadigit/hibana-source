// e2e/notebook.spec.ts — Notebook (whiteboard.html) E2E: render + Fabric interactions.
// Safety net for the Session 27 whiteboard.js modularization (history.js helper +
// sticky-note concern extraction). Covers the load-bearing behaviors: page render with
// zero console errors, pen-stroke creation, sticky-note create → type → save round-trip
// (durable sync verified against the API), and undo/redo (tombstone + restore).
// Run: npx playwright test e2e/notebook.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-nb@test.local'
const TEST_PASS = 'e2e-password-123'

// Seed the test user before tests run (migrations auto-run on server boot).
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
     VALUES ('${id}', 'e2e-nb', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

// 401s from /api/auth/me before login + the SW navigation probe are expected (login.spec.ts
// filters the same patterns).
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

// Open the notebook and wait until init() has fully finished: the board-loading pill is
// removed in load()'s finally, AFTER all canvas event handlers are wired — interacting
// before that drop events on the floor (handlers not yet registered) or hit the pill.
async function openNotebook(page: Page) {
  await page.goto('/whiteboard.html')
  await expect(page).toHaveTitle(/Notebook/)
  await page.waitForFunction(() => !!window.hibanaNotebook?.getCanvas(), null, { timeout: 10_000 })
  await page.waitForSelector('[data-board-loading]', { state: 'detached', timeout: 10_000 })
  await page.waitForTimeout(250) // fabric offset/layout settle
}

// Board object count through the notebook's public API.
const objectCount = (page: Page) =>
  page.evaluate(() => window.hibanaNotebook?.getCanvas()?.getObjects().length ?? -1)

// Elements synced to the server for the notebook board (same-origin fetch → cookies).
const syncedElements = (page: Page) =>
  page.evaluate(async () => {
    await window.hibanaQueue?.flush?.()
    const res = await fetch('/api/canvas/full?board=notebook')
    if (!res.ok) return null
    const body = await res.json()
    return body.elements ?? null
  })

test('notebook page renders with zero console errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors = trackErrors(page)

  await login(page)
  await openNotebook(page)

  // Fabric canvas is constructed and the toolbar is wired.
  await expect(page.locator('#nb-toolbar')).toBeVisible()
  await expect(page.locator('#nb-board')).toBeVisible()
  expect(errors).toEqual([])
})

test('pen stroke creates a synced canvas object', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page)
  await openNotebook(page)
  await page.evaluate(() => window.hibanaNotebook.getCanvas().clear())

  // Select the black pen, draw a small stroke.
  await page.click('#nb-toolbar [data-tool="black"]')
  const box = await page.locator('#nb-board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 100, box!.y + 100)
  await page.mouse.down()
  await page.mouse.move(box!.x + 160, box!.y + 130, { steps: 6 })
  await page.mouse.up()

  await expect.poll(() => objectCount(page)).toBe(1)
  // The stroke is durable: path:created → save → queue → server.
  const els = await syncedElements(page)
  expect(els).not.toBeNull()
  expect(els!.some((e: { type: string; deleted: number; content: string }) => e.type === 'stroke' && !e.deleted && Array.isArray(JSON.parse(e.content)) && JSON.parse(e.content)[0]?.[0] !== null)).toBe(true)
  expect(errors).toEqual([])
})

test('sticky note: create → type → save round-trip, then undo/redo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page)
  await openNotebook(page)
  await page.evaluate(() => window.hibanaNotebook.getCanvas().clear())

  // Select the note tool and click empty board → default sticky + editing twin.
  await page.click('#nb-toolbar [data-tool="note"]')
  const box = await page.locator('#nb-board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + 120, box!.y + 120)

  // The editing twin is a Fabric textbox in editing mode with a hidden textarea that must
  // hold focus before keystrokes land (Fabric focuses it inside enterEditing — give it a beat).
  const editing = await page.waitForFunction(() => {
    const c = window.hibanaNotebook?.getCanvas()
    if (!c) return false
    const twin = c.getObjects().find((o) => o.type === 'textbox' && o.isEditing)
    if (!twin) return false
    const ta = document.activeElement
    return !!ta && ta instanceof HTMLTextAreaElement && ta.dataset?.fabricHiddentextarea !== undefined || ta === twin.hiddenTextarea
  }, null, { timeout: 5_000 })
  expect(editing).toBeTruthy()
  await page.waitForFunction(() => {
    const ta = document.activeElement
    return ta instanceof HTMLTextAreaElement
  }, null, { timeout: 5_000 })

  await page.keyboard.type('e2e sticky hello')

  // Leave editing by switching to the move tool (DOM click blurs Fabric's textarea →
  // editing:exited → save + single undo entry).
  await page.click('#nb-toolbar [data-tool="move"]')

  const els = await syncedElements(page)
  expect(els).not.toBeNull()
  const note = els!.find((e: { type: string; content: string; deleted: number }) => e.type === 'sticky' && !e.deleted)
  expect(note).toBeTruthy()
  expect(note!.content).toContain('e2e sticky hello')

  // Undo (Ctrl+Z) tombstones the note: canvas count drops to 0.
  await page.keyboard.press('Control+z')
  await expect.poll(() => objectCount(page)).toBe(0)
  // Redo (Ctrl+Y) restores it.
  await page.keyboard.press('Control+y')
  await expect.poll(() => objectCount(page)).toBe(1)
  expect(errors).toEqual([])
})

// Type augmentation for the notebook global (whiteboard.js exposes { init, getCanvas }).
declare global {
  interface Window {
    hibanaNotebook?: { init: (sel: string, ui: Record<string, unknown>) => Promise<void>; getCanvas: () => { getObjects: () => unknown[]; clear: () => void } | null }
    hibanaQueue?: { flush: () => Promise<void>; enqueue: (item: unknown) => void }
  }
}
