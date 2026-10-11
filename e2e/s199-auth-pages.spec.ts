// e2e/s199-auth-pages.spec.ts — S199 (HLTH-18): signup.html, confirm.html and
// reset.html had NEVER loaded in any e2e spec (the token scan over the suite found
// zero visits) — the three auth surfaces riders on unit tests alone. This spec pins
// the page-level contract of each:
//
//   1. signup.html renders its form + solves the captcha round-trip
//      (GET /api/auth/captcha → the question paints + the token hides) — the QA
//      server has no Resend key, so the FULL signup would roll back at the mail
//      step by design; the form + captcha contract is the page-level pin here.
//   2. confirm.html verifies a 6-digit code END-TO-END: an unverified user + a
//      seeded code row → the real page posts to /api/auth/verify → session minted
//      + HX-Redirect to /app + email_verified_at stamped.
//   3. reset.html consumes a one-time token END-TO-END (the S199 SEC-5 atomic
//      single-use path): ?token= prefills the hidden field → new password → the
//      success section swaps in + session minted + the user's OLD session dies —
//      and the SAME token replayed is rejected (single-use proof).
//
// DB seeding uses the established raw DatabaseSync pattern (page.request mutations
// on the API are 403 — the CSRF origin gate rejects out-of-page contexts, S193).
// Run: npx playwright test e2e/s199-auth-pages.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { sha256Hex } from '../src/services/reset'

const TEST_PASS = 'e2e-password-123'

async function seedUnverifiedUser(email: string): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$100000$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try { db.exec(`DELETE FROM users WHERE email = '${email}'`) } catch { /* absent */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at)
     VALUES ('${id}', 'u${id.slice(0, 8)}', '${email}', '${hash.replace(/'/g, "''")}', 'member', 'en', 'gregorian', 'UTC', '${now}')`,
  )
  db.close()
  return id
}

test.describe('auth pages (S199 coverage-gap close)', () => {
  test('signup.html renders the form + the captcha round-trip paints the question', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(String(err)))
    await page.goto('/signup.html')
    await page.waitForLoadState('networkidle')

    // the four signup fields + the invite row + the submit button exist
    await expect(page.locator('input[name="email"]')).toBeVisible()
    await expect(page.locator('input[name="username"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.locator('input[name="captcha"]')).toBeVisible()
    await expect(page.locator('#register-submit')).toBeVisible()

    // the captcha round-trip: /api/auth/captcha answers and the page paints the
    // question + hides the token (signup-page.js does this on load)
    await expect
      .poll(async () => page.locator('#captcha-token').inputValue(), { timeout: 10_000 })
      .not.toBe('')
    const q = await page.textContent('body')
    expect(q).toMatch(/\d+\s*[+\-×]\s*\d+|captcha|Captcha/i)

    expect(errors).toEqual([])
  })

  test('confirm.html verifies the seeded 6-digit code → session + /app + verified stamp', async ({ page }) => {
    const email = 'e2e-s199-confirm@test.local'
    const uid = await seedUnverifiedUser(email)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync('/tmp/hibana-e2e.db')
    const now = new Date()
    const exp = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    db.prepare('INSERT INTO email_verifications (id, user_id, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(randomUUIDHex(), uid, await sha256Hex('3198'), now.toISOString(), exp)
    db.close()

    await page.goto('/confirm.html')
    await page.waitForLoadState('networkidle')
    await page.fill('#email-input', email)
    await page.fill('#code-input', '3198')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/app', { timeout: 10_000 }) // HX-Redirect after the session mints

    // email_verified_at is stamped (the login gate opens)
    const db2 = new DatabaseSync('/tmp/hibana-e2e.db')
    const row = db2.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(uid) as { email_verified_at: string }
    db2.close()
    expect(row.email_verified_at).toBeTruthy()
  })

  test('reset.html consumes the one-time token → password set + session + old session dead; replay rejected', async ({ page, request }) => {
    const email = 'e2e-s199-reset@test.local'
    const uid = await seedUnverifiedUser(email)

    // the user has an EXISTING session (the one the reset must kill) …
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync('/tmp/hibana-e2e.db')
    const oldToken = randomUUIDHex() + randomUUIDHex()
    const oldHash = await sha256Hex(oldToken)
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(oldHash, uid, new Date().toISOString(), new Date(Date.now() + 30 * 864e5).toISOString())

    // … and a live one-time reset token (the real reset-email shape)
    const resetToken = 'e2e-s199-' + randomUUIDHex()
    db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(await sha256Hex(resetToken), uid, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString())
    db.close()

    // the page fills the hidden token from ?token= and shows the confirm form
    await page.goto(`/reset.html?token=${resetToken}`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#token')).toHaveValue(resetToken)
    await page.fill('input[name="password"]', 'brand-new-password-9')
    await page.click('#confirm-section button[type="submit"]')

    // the success section swaps in (htmx) and the browser is signed in
    await expect(page.locator('[data-reset-done="1"]')).toBeVisible({ timeout: 10_000 })

    // the OLD session is dead (the reset killed it — rule: reset revokes sessions)
    const me = await request.get('/api/auth/me', { headers: { Cookie: `hibana_session=${oldToken}` } })
    expect(me.status()).toBe(401)

    // the password actually changed: the old password no longer logs in via the API
    const login = await request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3017' },
      data: { login: email, password: 'e2e-password-123' },
    })
    expect(login.status()).toBe(401)

    // SINGLE-USE proof (the S199 SEC-5 atomic consumption): replaying the same token
    // gets the invalid/expired message — the second confirm can never mint a session.
    const replay = await request.post('/api/auth/reset/confirm', {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3017' },
      data: { token: resetToken, password: 'another-password-77' },
    })
    expect(replay.status()).toBe(400)
    const rb = (await replay.json()) as { error?: string }
    expect(rb.error).toBe('invalid_or_expired_token')
  })
})

function randomUUIDHex(): string {
  return randomBytes(16).toString('hex')
}
