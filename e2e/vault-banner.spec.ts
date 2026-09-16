// e2e/vault-banner.spec.ts — S59 first candidate: Notes Vault onboarding banner.
//
// The banner renders server-side in the /api/dashboard fragment ONLY while the user
// has zero active vault_notes (adoption signal), with a localStorage dismissal
// (hibana-vault-banner-dismissed) honored by an inline fragment script. These pins
// cover the three contracts: visible for a vault-empty user, dismissal persists
// across reloads, and the server stops rendering once a note exists (the API path —
// creating a real note happens through the vault UI, already covered by
// notes-vault.spec.ts).
// Run: npx playwright test e2e/vault-banner.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-vaultbanner@test.local'
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
     VALUES ('${id}', 'e2e-vaultbanner', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // Guarantee the vault-empty precondition even on a reused DB (the /api/vault
  // round-trip tests run against other users, but defensive cleanup is cheap).
  db.exec(`DELETE FROM vault_notes WHERE user_id = '${id}'`)
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

test.beforeEach(async ({ page }) => {
  await login(page)
  // Fresh dismissal state per test.
  await page.evaluate(() => localStorage.removeItem('hibana-vault-banner-dismissed'))
})

test('S59: the banner shows for a vault-empty user, with CTA + dismiss', async ({ page }) => {
  await page.goto('/app')
  await page.waitForSelector('[data-vault-banner]', { timeout: 10_000 })
  const banner = page.locator('[data-vault-banner]')
  await expect(banner).toBeVisible()
  // The CTA deep-links to the vault's new-note composer.
  await expect(banner.locator('a.dash-vault-cta')).toHaveAttribute('href', '/notes.html?new=1')
  // The dismiss control is a real button with an accessible name.
  await expect(banner.locator('button[data-vault-dismiss]')).toBeVisible()
})

test('S59: dismissal persists across reloads (localStorage, server keeps rendering)', async ({ page }) => {
  await page.goto('/app')
  await page.waitForSelector('[data-vault-banner]', { timeout: 10_000 })
  await page.click('button[data-vault-dismiss]')
  // Gone immediately…
  await expect(page.locator('[data-vault-banner]')).toHaveCount(0)
  // …and still gone after a full reload (the fragment script re-hides it).
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await expect(page.locator('[data-vault-banner]')).toHaveCount(0)
  // The server still renders it (zero vault notes) — the dismissal is client-side only.
  // (The fragment renders for HX-Request fetches — htmx's header, not Accept.)
  const html = await page.evaluate(async () => {
    const res = await fetch('/api/dashboard', { headers: { 'HX-Request': 'true' } })
    return res.text()
  })
  expect(html).toContain('data-vault-banner')
})

test('S59: a user WITH a vault note gets no banner (server-side adoption signal)', async ({ page }) => {
  // Create one note through the API the same way the vault UI does, as this user.
  const created = await page.evaluate(async () => {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'banner probe note', content: 'created by the S59 vault-banner e2e' }),
    })
    return res.status
  })
  expect(created).toBe(201)
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await expect(page.locator('[data-vault-banner]')).toHaveCount(0)
  // Leave zero residue: purge the probe note (soft-delete then hard purge).
  await page.evaluate(async () => {
    const res = await fetch('/api/vault/notes', { headers: { Accept: 'application/json' } })
    const data = await res.json()
    const notes = data.notes ?? []
    const probe = notes.find((n: { title: string }) => n.title === 'banner probe note')
    if (!probe) return 'missing'
    await fetch(`/api/vault/notes/${probe.id}`, { method: 'DELETE' })
    const purge = await fetch(`/api/vault/notes/${probe.id}/purge`, { method: 'POST' })
    return purge.status
  })
})
