// e2e/s196-capture-clip.spec.ts — S196 (Track A coverage-gap audit): the web-clipper
// page /clip.html was the app's ONLY zero-e2e CAPTURE surface (the six other capture
// channels all have specs) — and capture is job #1 ("never lose an idea"). The page
// is a popup-class flow driven by query params (title/url/text — what a browser
// share-extension or the PWA share-target passes in). Pins:
//   1. the auth bounce: an anonymous visit redirects to login with the return
//      destination preserved (the clip never loses the captured idea).
//   2. the prefill: title+url renders the source link; selected text + title/url
//      prefill the textarea in the established order.
//   3. the capture itself: Save POSTs to /api/notes (kind=note) — the note is
//      provably in the Quick Notebook (API round-trip + the dashboard composer's
//      list shows it).
//   4. the empty form guard: no params + empty textarea = the inline error, no POST.
//   5. 0 console/page errors on the page's own surface.
// Run: npx playwright test e2e/s196-capture-clip.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s196-clip@test.local'
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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s196-clip', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
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
}

test.describe('the clip page (/clip.html) — the seventh capture channel', () => {
  test('anonymous visit bounces to login with the full return destination (the idea never dies)', async ({ page }) => {
    const dest = '/clip.html?title=Shared%20idea&url=https%3A%2F%2Fexample.com%2Fpage'
    await page.goto(dest)
    await page.waitForURL(/\/login\.html/, { timeout: 10_000 })
    const url = new URL(page.url())
    expect(url.searchParams.get('return')).toBe(dest)
  })

  test('title + url + selected text prefill the form; the source link renders', async ({ page }) => {
    await login(page)
    await page.goto('/clip.html?title=River%20loop&url=https%3A%2F%2Fexample.com%2Froute&text=Check%20the%20bike%20lane')
    await page.waitForSelector('#clip-form', { timeout: 10_000 })
    // THE S196 BUG PIN: the loader veil must lift with the auth answer (≤2s), never
    // ride the 20s CSS escape — clip.html loads no app.js, so its own controller
    // owns the reveal. The old bug: the opaque #hibana-page-loader covered the
    // capture form (and swallowed clicks) for 20 seconds.
    await expect(page.locator('#hibana-page-loader')).toHaveClass(/is-hidden/, { timeout: 2_000 })
    // the app's own veil grammar: is-hidden = opacity 0 + pointer-events none (the
    // element stays in the DOM by design — base.css's comment says so)
    await expect.poll(async () => page.locator('#hibana-page-loader').evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('0')
    await expect(page.locator('#hibana-page-loader').evaluate((el) => getComputedStyle(el).pointerEvents)).resolves.toBe('none')
    const source = page.locator('#clip-source')
    await expect(source).toBeVisible()
    await expect(source.locator('a')).toHaveAttribute('href', 'https://example.com/route')
    await expect(source.locator('a')).toHaveText('River loop')
    // the textarea prefill order: selected text first, then [title](url)
    const value = await page.inputValue('#clip-text')
    expect(value).toContain('Check the bike lane')
    expect(value).toContain('[River loop](https://example.com/route)')
    expect(value.indexOf('Check the bike lane')).toBeLessThan(value.indexOf('[River loop]'))
  })

  test('Save captures the note — the API round-trip proves it landed in the Quick Notebook', async ({ page }) => {
    await login(page)
    await page.goto('/clip.html?title=Clip%20round-trip&url=https%3A%2F%2Fexample.com%2Fclip')
    await page.waitForSelector('#clip-form', { timeout: 10_000 })
    await page.fill('#clip-text', 'My added note about this page')
    await page.click('#clip-save')
    // the success panel replaces the form
    await expect(page.locator('#clip-success')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#clip-form')).toBeHidden()

    // THE MONEY PIN: the note is in the user's quick notes (user-scoped API)
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/notes?limit=20', { headers: { Accept: 'application/json' } })
      return r.json()
    })
    const notes = Array.isArray(res) ? res : (res.items ?? res.notes ?? [])
    const found = notes.find((n: { title?: string; content?: string }) =>
      n.title === 'Clip round-trip' && (n.content ?? '').includes('My added note about this page'))
    expect(found, 'the captured note must appear in GET /api/notes').toBeTruthy()
  })

  test('a bare visit with an empty textarea shows the inline guard — no POST, no navigation', async ({ page }) => {
    await login(page)
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/clip.html')
    await page.waitForSelector('#clip-form', { timeout: 10_000 })
    // no params → the textarea is empty; no source row
    await expect(page.locator('#clip-source')).toBeHidden()
    await page.fill('#clip-text', '   ') // whitespace only — trimmed to nothing
    await page.click('#clip-save')
    await expect(page.locator('#clip-error')).toBeVisible()
    await expect(page.locator('#clip-error')).toContainText('Nothing to capture')
    await expect(page.locator('#clip-form')).toBeVisible() // still on the form
    expect(errors).toEqual([])
  })
})
