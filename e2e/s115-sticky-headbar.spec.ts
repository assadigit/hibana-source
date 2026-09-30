// e2e/s115-sticky-headbar.spec.ts — S115 r2 (owner, the collision fix): the sticky
// note's ⋯ menu and its ✕ close shared the inline-END corner — "[✕][⋯]" side by
// side, one mis-tap from DELETING what the owner meant to configure. The owner's
// sketch separates them to opposite corners:
//
//   [...]                    [x]
//
// ⋯ at the inline-START (top-left LTR / top-right RTL), ✕ alone at the inline-END
// dismiss seat (the S105 corner the eye goes to for dismiss). The fix is pure CSS
// (quicknotes.css: the headbar's .spark-menu gets order:-1 + an auto inline-end
// margin) — the spec pins the rendered GEOMETRY in the sticky view so the corners
// can't quietly drift back together.
//
// Run: npx playwright test e2e/s115-sticky-headbar.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-sticky@test.local'
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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-sticky', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // One quick note (the owner's screenshot's own text) — the sticky view's headbar
  // needs a real card to render on.
  db.exec(`DELETE FROM quick_notes WHERE user_id = '${id}'`)
  db.exec(
    `INSERT INTO quick_notes (id, user_id, kind, title, content, color, created_at, updated_at)
     VALUES ('${id}-n1', '${id}', 'note', '', 'Backup claudes skills and create a repo', 'green', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // The first-visit tour overlay is a pointer-events wall — suppress it (the S85
  // recipe: BOTH suppression keys, tour + ln).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('#notebook', { timeout: 10_000 })
}

test('S179: the compact sticky cluster — Move-to… beside ✕ at the inline-end corner, hover-revealed', async ({ page }) => {
  await login(page)
  // S179 (advisor block 9): the dashboard notebook is the COMPACT panel now — the
  // retired sticky headbar's corner contract lives on in the compact card's own
  // hover-revealed cluster (.dash-note-acts: Move-to… + delete at the inline-end
  // corner). The seeded account has one note; the dashboard renders it compact.
  const card = page.locator('#notebook .note-card-dash').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  const move = card.locator('.dash-note-move summary')
  const del = card.locator('[data-note-delete]')
  await expect(move).toBeAttached()
  await expect(del).toBeAttached()

  // The cluster is HOVER-REVEALED on pointer devices: hidden (opacity 0) at rest,
  // lit on card hover, and the two controls sit together at the card's inline-END
  // corner (Move-to… first, ✕ beside it — the delete keeps the far-end seat).
  await expect.poll(async () => card.locator('.dash-note-acts').evaluate((el) => getComputedStyle(el).opacity), { timeout: 3_000 }).toBe('0')
  await card.hover()
  // the 0.15s reveal transition — poll until it settles fully lit
  await expect.poll(async () => parseFloat(await card.locator('.dash-note-acts').evaluate((el) => getComputedStyle(el).opacity)), { timeout: 3_000 }).toBe(1)

  const mBox = await move.boundingBox()
  const dBox = await del.boundingBox()
  const cBox = await card.boundingBox()
  expect(mBox, 'the Move-to trigger renders').toBeTruthy()
  expect(dBox, 'the delete renders').toBeTruthy()
  expect(cBox).toBeTruthy()
  // LTR: Move-to… sits INLINE-START of the ✕, both inside the card's end corner.
  expect(mBox!.x).toBeLessThan(dBox!.x)
  expect(dBox!.x - (mBox!.x + mBox!.width)).toBeLessThanOrEqual(4) // the pair sits together
  expect(cBox!.x + cBox!.width - (dBox!.x + dBox!.width)).toBeLessThan(32)
  // Keyboard focus reveals the cluster too (:focus-within — the block-9 contract).
  await card.locator('.note-render').focus()
  await expect.poll(async () => parseFloat(await card.locator('.dash-note-acts').evaluate((el) => getComputedStyle(el).opacity)), { timeout: 3_000 }).toBe(1)
})
