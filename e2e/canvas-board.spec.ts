// e2e/canvas-board.spec.ts — Canvas board (canvas.html) E2E: render + Fabric interactions.
// Safety net for the Session 28 sticky-factory consolidation (makeStickyNote is being
// extracted into public/js/sticky.js shared by both boards) and the export v2 work
// (clipboard copy on both boards). Mirrors the notebook.spec.ts pattern: page render with
// zero console errors, pen-stroke creation synced to the server, sticky-note
// drag-create → double-click edit twin → type → save round-trip, and undo/redo.
// Run: npx playwright test e2e/canvas-board.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_PASS = 'e2e-password-123'

// Per-test users (the board data persists server-side across tests in this file — a
// shared user would see the previous test's strokes when the page reloads its viewport).
const USERS = {
  render: 'e2e-cv-r@test.local',
  pen: 'e2e-cv-p@test.local',
  sticky: 'e2e-cv-s@test.local',
  text: 'e2e-cv-t@test.local',
}

// Seed a test user (migrations auto-run on server boot).
async function seedUser(email: string) {
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
    db.exec(`DELETE FROM users WHERE email = '${email}'`)
    db.exec(`DELETE FROM canvas_elements WHERE user_id = '${id}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', '${email.split('@')[0]}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
}

// Seed all three users before tests run.
test.beforeAll(async () => {
  await seedUser(USERS.render)
  await seedUser(USERS.pen)
  await seedUser(USERS.sticky)
  await seedUser(USERS.text)
})

async function login(page: Page, email: string) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
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

// Open the canvas board and wait until init() has fully finished: the board-loading pill
// is removed after all canvas event handlers are wired — interacting before that drops
// events on the floor (handlers not yet registered) or hits the pill.
async function openCanvas(page: Page) {
  await page.goto('/canvas.html')
  await expect(page).toHaveTitle(/Canvas/)
  await page.waitForFunction(() => !!window.hibanaCanvas?.getCanvas(), null, { timeout: 10_000 })
  await page.waitForSelector('[data-board-loading]', { state: 'detached', timeout: 10_000 })
  await page.waitForTimeout(250) // fabric offset/layout settle
}

// Persisted board objects only (helper chrome like lock badges carries no id).
const objectCount = (page: Page) =>
  page.evaluate(() => window.hibanaCanvas?.getCanvas()?.getObjects().filter((o) => o.id).length ?? -1)

// Elements synced to the server for the main canvas board (same-origin fetch → cookies).
const syncedElements = (page: Page) =>
  page.evaluate(async () => {
    await window.hibanaQueue?.flush?.()
    const res = await fetch('/api/canvas/full?board=canvas')
    if (!res.ok) return null
    const body = await res.json()
    return body.elements ?? null
  })

test('canvas page renders with zero console errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')
  const errors = trackErrors(page)

  await login(page, USERS.render)
  await openCanvas(page)

  // Fabric canvas is constructed and the toolbar is wired.
  await expect(page.locator('#canvas-toolbar')).toBeVisible()
  await expect(page.locator('#board')).toBeVisible()
  expect(errors).toEqual([])
})

test('pen stroke creates a synced canvas object', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page, USERS.pen)
  await openCanvas(page)

  // Select the pen, draw a small stroke.
  await page.click('#canvas-toolbar [data-tool="pen"]')
  const box = await page.locator('#board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 100, box!.y + 100)
  await page.mouse.down()
  await page.mouse.move(box!.x + 160, box!.y + 130, { steps: 6 })
  await page.mouse.up()

  await expect.poll(() => objectCount(page)).toBe(1)
  // The stroke is durable: path:created → save → queue → server.
  const els = await syncedElements(page)
  expect(els).not.toBeNull()
  expect(els!.some((e: { type: string; deleted: number }) => e.type === 'stroke' && !e.deleted)).toBe(true)
  expect(errors).toEqual([])
})

test('sticky note: drag-create → double-click edit → save round-trip, then undo/redo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page, USERS.sticky)
  await openCanvas(page)

  // The canvas note tool is DRAG-to-size (a plain click spawns nothing — machine-gun fix).
  // Drag a ~120×120 square well past the 40px minimum.
  await page.click('#canvas-toolbar [data-tool="note"]')
  const box = await page.locator('#board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 120, box!.y + 120)
  await page.mouse.down()
  await page.mouse.move(box!.x + 240, box!.y + 240, { steps: 8 })
  await page.mouse.up()

  // The note is on the board (persisted with an id immediately).
  await expect.poll(() => objectCount(page)).toBe(1)

  // Double-click the note's center → the edit twin (a top-level Textbox) enters editing.
  await page.click('#canvas-toolbar [data-tool="select"]')
  const note = await page.evaluate(() => {
    const c = window.hibanaCanvas?.getCanvas()
    const o = c?.getObjects().find((x) => x.id)
    if (!o) return null
    const r = o.getBoundingRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  })
  expect(note).not.toBeNull()
  // Scene coords (identity vpt on a fresh load) → viewport coords: offset by the canvas
  // element's position within the page (the toolbar sits above the board).
  await page.mouse.dblclick(box!.x + note!.cx, box!.y + note!.cy)
  await page.waitForFunction(() => {
    const c = window.hibanaCanvas?.getCanvas()
    if (!c) return false
    const twin = c.getObjects().find((o) => o.type === 'textbox' && o.isEditing)
    if (!twin) return false
    const ta = document.activeElement
    return !!ta && ta instanceof HTMLTextAreaElement
  }, null, { timeout: 5_000 })

  await page.keyboard.type('e2e cv sticky hello')

  // Leave editing by switching to the move tool (DOM click blurs Fabric's textarea →
  // editing:exited → twin commits through save + history).
  await page.click('#canvas-toolbar [data-tool="select"]')

  const els = await syncedElements(page)
  expect(els).not.toBeNull()
  const noteEl = els!.find((e: { type: string; content: string; deleted: number }) => e.type === 'note' && !e.deleted)
  expect(noteEl).toBeTruthy()
  expect(noteEl!.content).toContain('e2e cv sticky hello')

  // Undo ×2 (creation pushed 'add', the text edit pushed 'modify'): the note tombstones.
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(150)
  await page.keyboard.press('Control+z')
  await expect.poll(() => objectCount(page)).toBe(0)
  // Redo ×2 restores it with its text.
  await page.keyboard.press('Control+y')
  await page.waitForTimeout(150)
  await page.keyboard.press('Control+y')
  await expect.poll(() => objectCount(page)).toBe(1)
  expect(errors).toEqual([])
})

// Locate the given text-box note on the board + the PAGE-space position of its
// middle-right resize handle (scene coords → vpt → canvas element offset). The vpt math
// is explicit (identity on a fresh load, but the formula stays correct at any zoom).
const textBoxProbe = (page: Page) =>
  page.evaluate(() => {
    const c = window.hibanaCanvas?.getCanvas()
    const o = c?.getObjects().find((x) => x.id && x.type === 'textbox' && !x.isEditing)
    if (!o || !c) return null
    const b = o.getBoundingRect()
    const vpt = c.viewportTransform
    const el = document.getElementById('board')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const mr = { x: b.left + b.width, y: b.top + b.height / 2 } // middle-right handle (scene)
    return {
      mrX: r.left + vpt[0] * mr.x + vpt[2] * mr.y + vpt[4],
      mrY: r.top + vpt[1] * mr.x + vpt[3] * mr.y + vpt[5],
      cx: r.left + vpt[0] * (b.left + b.width / 2) + vpt[2] * (b.top + b.height / 2) + vpt[4],
      cy: r.top + vpt[1] * (b.left + b.width / 2) + vpt[3] * (b.top + b.height / 2) + vpt[5],
      width: o.width,
      fixed: o.__fixedWidth,
      lines: o.textLines.length,
      scaleX: o.scaleX,
      id: o.id,
    }
  })

test('text box: drag the mr handle → width grows and the text re-wraps (fewer lines)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page, USERS.text)
  await openCanvas(page)

  // Text tool: drag a NARROW ~150×90 box so the typed sentence wraps to several lines.
  await page.click('#canvas-toolbar [data-tool="text"]')
  const box = await page.locator('#board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 300, box!.y + 160)
  await page.mouse.down()
  await page.mouse.move(box!.x + 450, box!.y + 250, { steps: 8 })
  await page.mouse.up()

  // The fresh box enters editing (fabric's hidden textarea takes focus).
  await page.waitForFunction(() => {
    const c = window.hibanaCanvas?.getCanvas()
    const t = c?.getObjects().find((o) => o.type === 'textbox' && o.isEditing)
    return !!t && document.activeElement instanceof HTMLTextAreaElement
  }, null, { timeout: 5_000 })
  await page.keyboard.type('e2e reflow alpha beta gamma delta epsilon zeta eta theta')

  // Leave editing: switching to the select tool blurs the textarea → editing:exited → save.
  // The note REMAINS the active object — the handles are live immediately (no re-select
  // click: a click on an already-selected fabric IText re-enters editing instead).
  await page.click('#canvas-toolbar [data-tool="select"]')

  const before = await textBoxProbe(page)
  expect(before).not.toBeNull()
  const isStillSelected = await page.evaluate(() => window.hibanaCanvas?.getCanvas()?.getActiveObject()?.type === 'textbox')
  expect(isStillSelected).toBe(true)
  expect(before!.lines).toBeGreaterThan(2) // the sentence is wrapped at the narrow width

  // Drag the middle-right handle 180px outward.
  await page.mouse.move(before!.mrX, before!.mrY)
  await page.mouse.down()
  await page.mouse.move(before!.mrX + 180, before!.mrY, { steps: 12 })
  await page.mouse.up()

  const after = await textBoxProbe(page)
  // Width-driven resize: the container width grew, the scale never moved, and the
  // wrapping re-ran — the same text now fits on fewer lines.
  expect(after!.fixed).toBeGreaterThan(before!.fixed + 120)
  expect(after!.scaleX).toBe(1)
  expect(after!.lines).toBeLessThan(before!.lines)

  // Durable: the record persists the new width (persistDebounced 400ms → queue → server).
  await page.waitForTimeout(650)
  const els = await syncedElements(page)
  expect(els).not.toBeNull()
  const rec = els!.find((e: { type: string; content: string; deleted: number }) => e.type === 'note' && !e.deleted && String(e.content).includes('e2e reflow alpha'))
  expect(rec).toBeTruthy()
  expect(rec!.width).toBeGreaterThan(before!.fixed + 120)

  // Undo the resize ('modify' entry): the note rebuilds at the original wrap width.
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  const undone = await textBoxProbe(page)
  expect(Math.round(undone!.fixed)).toBe(Math.round(before!.fixed))
  expect(errors).toEqual([])
})

// Type augmentation for the canvas global (canvas.js exposes { init, getElement, getCanvas }).
declare global {
  interface Window {
    hibanaCanvas?: { init: (sel: string, ui: Record<string, unknown>) => Promise<void>; getElement: (id: string) => unknown; getCanvas: () => ({ getObjects: () => { id?: string; type?: string; isEditing?: boolean; width?: number; scaleX?: number; __fixedWidth?: number; textLines?: unknown[]; getBoundingRect: () => { left: number; top: number; width: number; height: number } }[]; getActiveObject: () => { type?: string } | undefined; viewportTransform: number[] } & { clear: () => void }) | null }
    hibanaQueue?: { flush: () => Promise<void>; enqueue: (item: unknown) => void }
  }
}
