// e2e/s111-share-target.spec.ts — S111 (v0.3.44.0): "Share into Hibana" + the login
// round-trip that never loses your place. Two contracts pinned:
//
// 1. PWA share_target: the manifest points the OS share sheet (GET title/text/url) at
//    /dashboard.html, and app.js's consumeShareTarget opens the quick-add modal
//    PREFILLED (title = shared title | URL hostname | first text line; description =
//    text + the URL). Cancel/save strips the params — a reload never re-triggers.
//
// 2. The 401 bounce preserves the destination: every redirect-to-login path (app.js
//    handle401, hib-init's htmx + boot guards, sw.js v405's navigate handler) now lands
//    on /login.html?next=<path+query>; a successful sign-in returns the user to the
//    EXACT place — so an expired session can no longer drop a shared idea. THE MONEY
//    PIN: an anon visitor hitting a share-target URL bounces to login, signs in, and
//    lands back on the share URL with the capture sheet open and prefilled.
//
// (runs against the playwright-managed Node server + fresh /tmp DB; SWs blocked — the
// first-visit shape, and the only shape where page routes can intercept at all)

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-share@test.local'
const TEST_PASS = 'e2e-password-123'
const SHARE_TITLE = 'Weekly ride idea'
const SHARE_TEXT = 'Check the new bike lane route along the river'
const SHARE_URL = 'https://www.example.com/route/river-loop'

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
     VALUES ('${id}', 'e2e-share', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

test('the manifest carries the share_target contract', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.ok()).toBeTruthy()
  const manifest = await res.json()
  expect(manifest.share_target).toBeTruthy()
  expect(manifest.share_target.action).toBe('/dashboard.html')
  expect(manifest.share_target.method).toBe('GET')
  expect(manifest.share_target.enctype).toBe('application/x-www-form-urlencoded')
  expect(manifest.share_target.params).toEqual({ title: 'title', text: 'text', url: 'url' })
})

test('a share landing opens quick-add prefilled; closing strips the params', async ({ page }) => {
  await login(page)
  await page.goto(`/dashboard.html?title=${encodeURIComponent(SHARE_TITLE)}&text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`)

  // The quick-add modal auto-opens, prefilled from the share sheet's fields.
  await page.waitForSelector('#quickadd-dialog[open]')
  expect(await page.inputValue('#qa-title')).toBe(SHARE_TITLE)
  expect(await page.inputValue('#qa-description')).toBe(`${SHARE_TEXT}\n\n${SHARE_URL}`)

  // Cancel → the share params are stripped so a reload never re-triggers the sheet.
  await page.click('#qa-cancel')
  await page.waitForSelector('#quickadd-dialog[open]', { state: 'hidden' })
  // The strip is a synchronous history.replaceState on the dialog's close event, but
  // Playwright's tracked page.url() propagates same-document URL changes ASYNC — under
  // full-suite load that propagation has raced the plain read (S115 r3, twice in CI
  // shards; 9× green focused). Poll: absorbs the read latency, still fails on a
  // genuinely unstripped URL.
  await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('title=')
  expect(page.url()).not.toContain('url=')
})

test('title composition falls back to the URL hostname (no title shared)', async ({ page }) => {
  await login(page)
  await page.goto(`/dashboard.html?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`)
  await page.waitForSelector('#quickadd-dialog[open]')
  expect(await page.inputValue('#qa-title')).toBe('example.com')
  expect(await page.inputValue('#qa-description')).toBe(`${SHARE_TEXT}\n\n${SHARE_URL}`)
  await page.click('#qa-cancel')
  await page.waitForSelector('#quickadd-dialog[open]', { state: 'hidden' })
})

test('saving the prefilled share creates a spark (never lose an idea)', async ({ page }) => {
  await login(page)
  const title = `Share-captured spark ${Date.now()}`
  await page.goto(`/dashboard.html?title=${encodeURIComponent(title)}&url=${encodeURIComponent(SHARE_URL)}`)
  await page.waitForSelector('#quickadd-dialog[open]')
  expect(await page.inputValue('#qa-title')).toBe(title)
  expect(await page.inputValue('#qa-description')).toBe(SHARE_URL)
  await page.click('#qa-save')
  await page.waitForSelector('#quickadd-dialog[open]', { state: 'hidden' })
  const found = await page.evaluate(async (t) => {
    const res = await fetch('/api/projects?status=spark')
    if (!res.ok) return false
    const body = await res.json()
    const arr = Array.isArray(body) ? body : (body.items ?? body.projects ?? [])
    return arr.some((p: { title?: string }) => p.title === t)
  }, title)
  expect(found, 'the shared idea exists as a spark').toBe(true)
})

test('an expired session bounces to login WITH the share intact — and sign-in returns to the capture', async ({ page }) => {
  // Anonymous visitor opens the OS-share landing URL: the boot guard must redirect to
  // login carrying the FULL share URL inside ?next= (the sw.js v405 navigate handler
  // does the same server-side for SW-covered navigations).
  const shareUrl = `/dashboard.html?title=${encodeURIComponent(SHARE_TITLE)}&text=${encodeURIComponent(SHARE_TEXT)}`
  await page.goto(shareUrl)
  await page.waitForURL('**/login.html**')
  const loginUrl = new URL(page.url())
  expect(loginUrl.pathname).toBe('/login.html')
  const next = loginUrl.searchParams.get('next')
  expect(next, 'next preserves path AND query').toBe(shareUrl)

  // Sign in → honored ?next= returns to the share URL → the capture opens prefilled.
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard.html**')
  expect(new URL(page.url()).searchParams.get('title')).toBe(SHARE_TITLE)
  await page.waitForSelector('#quickadd-dialog[open]')
  expect(await page.inputValue('#qa-title')).toBe(SHARE_TITLE)
  expect(await page.inputValue('#qa-description')).toBe(SHARE_TEXT)
})

test('a plain 401 bounce (no share params) also returns the user to their page', async ({ page }) => {
  await page.goto('/notes.html?view=grid')
  await page.waitForURL('**/login.html**')
  const loginUrl = new URL(page.url())
  expect(loginUrl.searchParams.get('next')).toBe('/notes.html?view=grid')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/notes.html**')
  expect(new URL(page.url()).searchParams.get('view')).toBe('grid')
})

test('safeNext rejects off-site and looping destinations (open-redirect guard)', async ({ page }) => {
  // Protocol-relative and absolute off-site next values must be IGNORED — login falls
  // through to the server's default redirect instead.
  await page.goto('/login.html?next=' + encodeURIComponent('//evil.example.com/dashboard.html'))
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !String(u).includes('evil.example.com'), { timeout: 10_000 })
  expect(new URL(page.url()).hostname).not.toBe('evil.example.com')
})
