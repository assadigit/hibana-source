// e2e/palette-quicknotes.spec.ts — S64: quick notes finish the find → open → SEE story.
//
// The 0040 palette group always deep-linked to /whiteboard.html#note-<id> — the Fabric
// notebook SHEET, which has never rendered a #note-<id> element (the cards live in the
// dashboard widget). The link was dead on arrival. S64 retargets it to /app with S63's
// jump-to-match language: the card scrolls into view + pulses, the first body hit wears
// a temporary <mark class="note-jump">, the hash is consumed, and a hit deeper than the
// widget's 20-note cap toasts instead of dead-scrolling. This spec pins all of it, plus
// the new kind + FTS-snippet sublabel that gives untitled hits their information scent.
// Run: npx playwright test e2e/palette-quicknotes.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-cmdk-qn@test.local'
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
     VALUES ('${id}', 'e2e-cmdk-qn', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // S64: suppress the first-visit onboarding tour (pointer-events wall 1200ms after
  // DOMContentLoaded — the ae1041a CI flake's root). This spec's palette opens via
  // keyboard and its clicks land in the top-layer dialog, but on a slow runner the
  // overlay adds a confound nothing here exercises. Deterministic beats lucky.
  await page.addInitScript(() => { try { localStorage.setItem('hibana-tour-done', '1') } catch { /* storage blocked */ } })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// Creates a quick note through the app's own API and returns its id.
async function mkQuickNote(page: Page, content: string, title = ''): Promise<string> {
  return await page.evaluate(async ({ content, title }) => {
    const r = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'note', title, content }),
    })
    if (!r.ok) throw new Error('quick note create failed: ' + r.status)
    return ((await r.json()) as { ok: boolean; id: string }).id
  }, { content, title })
}

async function rmQuickNote(page: Page, id: string) {
  await page.evaluate(async (nid) => { await fetch(`/api/notes/${nid}`, { method: 'DELETE' }) }, id)
}

test.describe('S64: quick-note jump-to-match from the palette', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('an untitled hit carries kind + snippet, deep-links to the dashboard card, flashes it, marks the body hit, and consumes the hash', async ({ page }) => {
    const id = await mkQuickNote(page, 'capture scratch: the lantern archive quillneedle burns at midnight, note it down')
    try {
      await page.keyboard.press('Control+k')
      const dlg = page.locator('#cmdk-dialog')
      await expect(dlg).toBeVisible()
      await page.fill('#cmdk-input', 'quillneedle')

      // The Notes group renders; the UNTITLED row now says WHERE it hit (kind + snippet).
      const row = dlg.locator('.cmdk-item', { hasText: 'Untitled note' })
      await expect(row).toBeVisible({ timeout: 8_000 })
      await expect(dlg.locator('.cmdk-group-label', { hasText: 'Notes' })).toBeVisible()
      await expect(row.locator('.cmdk-sublabel')).toContainText('quillneedle')
      await expect(row.locator('.cmdk-sublabel')).toContainText('Note')

      // Activate → /app#note-<id>&q=… → the card pulses and the body hit is marked.
      await row.click()
      const card = page.locator(`#note-${id}`)
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card).toHaveClass(/note-jump/)
      const mark = page.locator('mark.note-jump')
      await expect(mark).toHaveText('quillneedle')
      // The deep link is consumed — a reload reopens the dashboard clean.
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 5_000 }).toBe('')

      // Zero residue: the pulse and the mark unwrap themselves.
      await page.waitForTimeout(3_200)
      await expect(page.locator('mark.note-jump')).toHaveCount(0)
      await expect(card).not.toHaveClass(/note-jump/)
      await expect(card.locator('.note-render')).toContainText('quillneedle')
    } finally {
      await rmQuickNote(page, id)
    }
  })

  test('a hit deeper than the dashboard\'s 20-note recent list toasts instead of dead-scrolling', async ({ page }) => {
    // 21 notes: the FIRST created carries the lowest sort_order → ranks 21st → beyond
    // the widget's LIMIT 20. The deep link must say so, not scroll nowhere silently.
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'ancient needle hoard: the oldest note in the drawer'))
    for (let i = 0; i < 20; i++) ids.push(await mkQuickNote(page, `filler note number ${i} — recent window padding`))
    try {
      await page.goto(`/app#note-${ids[0]}&q=needle`)
      await expect(page.locator('#toast .toast-msg')).toContainText('That note is saved, but older than the recent list shown here.', { timeout: 10_000 })
      await expect(page.locator('.note-card.note-jump')).toHaveCount(0)
      // The hash was still consumed — the URL doesn't keep a dead fragment around.
      await expect.poll(() => page.evaluate(() => location.hash), { timeout: 5_000 }).toBe('')
    } finally {
      for (const nid of ids) await rmQuickNote(page, nid)
    }
  })
})
