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

test('the sticky note headbar: ⋯ at the inline-start corner, ✕ alone at the inline-end (S115 r2)', async ({ page }) => {
  await login(page)
  const card = page.locator('#notebook .note-card').first()
  await expect(card).toBeVisible()
  // The headbar rides the STICKY/GRID views only (list keeps its own footer
  // delete) — switch to the sticky view the way the owner does: open the
  // notebook's view-options <details>, then pick Sticky from its segment.
  await page.click('#notebook .note-controls-toggle summary')
  await page.click('label[for="nv-sticky"]')
  const menu = card.locator('.spark-menu > [data-menu-open]')
  const del = card.locator('[data-note-delete]').first() // the headbar's ✕ (DOM-first)
  await expect(menu).toBeVisible()
  await expect(del).toBeVisible()

  const mBox = await menu.boundingBox()
  const dBox = await del.boundingBox()
  expect(mBox, 'the ⋯ menu renders in the sticky view').toBeTruthy()
  expect(dBox, 'the ✕ close renders in the sticky view').toBeTruthy()
  // LTR: the ⋯ sits at the LEFT corner, the ✕ at the RIGHT — and a real run of
  // card lies between them, so the two controls can no longer be mis-tapped for
  // each other.
  expect(mBox!.x).toBeLessThan(dBox!.x)
  expect(dBox!.x - (mBox!.x + mBox!.width)).toBeGreaterThan(24)
  // The ✕ keeps the dismiss seat: within a card-padding of the card's inline-END
  // edge (the corner the eye goes to for dismiss — the S105 contract).
  const cBox = await card.boundingBox()
  expect(cBox).toBeTruthy()
  expect(cBox!.x + cBox!.width - (dBox!.x + dBox!.width)).toBeLessThan(32)
})
