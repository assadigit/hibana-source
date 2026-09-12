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
  // First-visit SW claim race (see viewport.spec.ts for the full write-up): the login
  // page's SW registration activates + claims /app → boot.js reloads it once — that
  // reload can supersede the next goto. Let it settle first.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
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

// Locate the text-tool note on the notebook + the PAGE-space position of its
// middle-right / top-right resize handles (scene coords → vpt → canvas element offset).
const textBoxProbe = (page: Page) =>
  page.evaluate(() => {
    const c = window.hibanaNotebook?.getCanvas()
    const o = (c?.getObjects() ?? []).find((x) => x.id && x.type === 'textbox' && !x.isEditing)
    if (!o || !c) return null
    const b = o.getBoundingRect()
    const vpt = c.viewportTransform
    const el = document.getElementById('nb-board')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const toPage = (x: number, y: number) => ({ x: r.left + vpt[0] * x + vpt[2] * y + vpt[4], y: r.top + vpt[1] * x + vpt[3] * y + vpt[5] })
    const mr = toPage(b.left + b.width, b.top + b.height / 2)
    const tr = toPage(b.left + b.width, b.top)
    const ctr = toPage(b.left + b.width / 2, b.top + b.height / 2)
    return { mrX: mr.x, mrY: mr.y, trX: tr.x, trY: tr.y, cx: ctr.x, cy: ctr.y, width: o.width, fixed: o.__fixedWidth, lines: o.textLines.length, scaleX: o.scaleX }
  })

test('text box: drag a corner handle → width grows and the text re-wraps (fewer lines)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page)
  await openNotebook(page)
  await page.evaluate(() => window.hibanaNotebook.getCanvas().clear())

  // Text tool: drag a NARROW ~140×90 box so the typed sentence wraps to several lines.
  await page.click('#nb-toolbar [data-tool="text"]')
  const box = await page.locator('#nb-board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 260, box!.y + 200)
  await page.mouse.down()
  await page.mouse.move(box!.x + 400, box!.y + 290, { steps: 8 })
  await page.mouse.up()

  // The fresh box enters editing (fabric's hidden textarea takes focus).
  await page.waitForFunction(() => {
    const c = window.hibanaNotebook?.getCanvas()
    const t = c?.getObjects().find((o) => o.type === 'textbox' && o.isEditing)
    return !!t && document.activeElement instanceof HTMLTextAreaElement
  }, null, { timeout: 5_000 })
  await page.keyboard.type('e2e nb reflow one two three four five six seven eight nine')

  // Leave editing: switching to the move tool blurs the textarea → editing:exited → save.
  // The note REMAINS the active object — the handles are live immediately (no re-select
  // click: a click on an already-selected fabric IText re-enters editing instead).
  await page.click('#nb-toolbar [data-tool="move"]')

  const before = await textBoxProbe(page)
  expect(before).not.toBeNull()
  const isStillSelected = await page.evaluate(() => window.hibanaNotebook?.getCanvas()?.getActiveObject()?.type === 'textbox')
  expect(isStillSelected).toBe(true)
  expect(before!.lines).toBeGreaterThan(2) // the sentence is wrapped at the narrow width

  // Drag the TOP-RIGHT CORNER handle 200px outward — corners drive the width too.
  await page.mouse.move(before!.trX, before!.trY)
  await page.mouse.down()
  await page.mouse.move(before!.trX + 200, before!.trY + 6, { steps: 12 })
  await page.mouse.up()

  const after = await textBoxProbe(page)
  // Width-driven resize: the container width grew, the scale never moved, and the
  // wrapping re-ran — the same text now fits on fewer lines.
  expect(after!.fixed).toBeGreaterThan(before!.fixed + 140)
  expect(after!.scaleX).toBe(1)
  expect(after!.lines).toBeLessThan(before!.lines)

  // Durable: the record persists the new width (object:modified → save → queue → server).
  const els = await syncedElements(page)
  expect(els).not.toBeNull()
  const rec = els!.find((e: { type: string; content: string; deleted: number }) => e.type === 'note' && !e.deleted && String(e.content).includes('e2e nb reflow one'))
  expect(rec).toBeTruthy()
  expect(rec!.width).toBeGreaterThan(before!.fixed + 140)
  expect(errors).toEqual([])
})

test('notebook move is durable and undoable — Ctrl+Z restores position (W3 + 0049)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  await login(page)
  await openNotebook(page)
  await page.evaluate(() => window.hibanaNotebook.getCanvas().clear())

  // A text note with a unique marker so its SERVER record is identifiable.
  await page.click('#nb-toolbar [data-tool="text"]')
  const box = await page.locator('#nb-board').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 260, box!.y + 180)
  await page.mouse.down()
  await page.mouse.move(box!.x + 400, box!.y + 270, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => {
    const c = window.hibanaNotebook?.getCanvas()
    const t = c?.getObjects().find((o) => o.type === 'textbox' && o.isEditing)
    return !!t && document.activeElement instanceof HTMLTextAreaElement
  }, null, { timeout: 5_000 })
  await page.keyboard.type('e2e nb move marker zulu')
  await page.click('#nb-toolbar [data-tool="move"]') // exit editing → save

  const note = await page.evaluate(() => {
    const c = window.hibanaNotebook?.getCanvas()
    const o = (c?.getObjects() ?? []).find((x) => x.type === 'textbox' && !x.isEditing && String(x.text ?? x.content ?? '').includes('e2e nb move marker zulu'))
    return o ? { id: o.id, left: o.left, top: o.top } : null
  })
  expect(note).not.toBeNull()

  // Move it through the REAL event path (what a fabric drag ends in): set position,
  // fire object:modified → the W3 handler must save AND commit an undo entry.
  await page.evaluate(({ id, dx, dy }) => {
    const c = window.hibanaNotebook?.getCanvas()
    const o = (c?.getObjects() ?? []).find((x) => x.id === id)
    if (!o || !c) return false
    o.set({ left: o.left + dx, top: o.top + dy })
    o.setCoords()
    c.setActiveObject(o)
    c.fire('object:modified', { target: o })
    c.renderAll()
    return true
  }, { id: note!.id, dx: 120, dy: 80 })

  // Durable: the server record carries the moved position.
  const moved = await syncedElements(page)
  expect(moved).not.toBeNull()
  const movedRec = moved!.find((e: { id: string; content: string; deleted: number }) => e.id === note!.id && !e.deleted) as { x: number; y: number } | undefined
  expect(movedRec).toBeTruthy()
  expect(Math.round(movedRec!.x)).toBeGreaterThan(Math.round(note!.left + 100))
  expect(Math.round(movedRec!.y)).toBeGreaterThan(Math.round(note!.top + 60))

  // UNDO the move — pre-W3 there was NO undo entry for notebook moves (the old handler
  // only saved); now history carries 'modify' and Ctrl+Z rebuilds at the old position.
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  const restored = await page.evaluate((id) => {
    const c = window.hibanaNotebook?.getCanvas()
    const o = (c?.getObjects() ?? []).find((x) => x.id === id)
    return o ? { left: o.left, top: o.top } : null
  }, note!.id)
  expect(restored).not.toBeNull()
  expect(Math.abs(Math.round(restored!.left) - Math.round(note!.left))).toBeLessThanOrEqual(2)
  expect(Math.abs(Math.round(restored!.top) - Math.round(note!.top))).toBeLessThanOrEqual(2)

  // And the undo durably reverted the server record too.
  const undone = await syncedElements(page)
  const undoneRec = undone!.find((e: { id: string; deleted: number }) => e.id === note!.id && !e.deleted) as { x: number; y: number } | undefined
  expect(undoneRec).toBeTruthy()
  expect(Math.abs(Math.round(undoneRec!.x) - Math.round(note!.left))).toBeLessThanOrEqual(2)
  expect(errors).toEqual([])
})

// Type augmentation for the notebook global (whiteboard.js exposes { init, getCanvas }).
declare global {
  interface Window {
    hibanaNotebook?: { init: (sel: string, ui: Record<string, unknown>) => Promise<void>; getCanvas: () => { getObjects: () => { id?: string; type?: string; isEditing?: boolean; text?: string; content?: string; left?: number; top?: number; width?: number; scaleX?: number; angle?: number; __innerText?: unknown; set: (opts: Record<string, unknown>) => void; setCoords: () => void; getBoundingRect: () => { left: number; top: number; width: number; height: number } }[]; clear: () => void; setActiveObject: (o: unknown) => void; fire: (name: string, opts?: Record<string, unknown>) => void; renderAll: () => void; getActiveObject: () => { type?: string } | undefined } | null }
    hibanaQueue?: { flush: () => Promise<void>; enqueue: (item: unknown) => void }
  }
}
