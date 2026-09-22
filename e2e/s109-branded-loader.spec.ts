// e2e/s109-branded-loader.spec.ts — S109 (owner item): "Mobile currently shows a generic
// spinning-circle loader; desktop shows a ⏳emoji. Build a proper branded loading
// indicator for both platforms." The veil (#hibana-page-loader) now carries the brand
// MARK itself (icon.svg's dark tile + white H) with the spark dot orbiting it, the
// pulsing Hibana wordmark, and a slim indeterminate track — ONE system for mobile and
// desktop. The old generic ring (.hibana-page-loader-spinner) must be GONE from every
// page, and the reduced-motion path must park the spark + freeze the track instead of
// the old ⏳ emoji fallback.

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-loader@test.local'
const TEST_PASS = 'e2e-password-123'

// Seed the loader spec's own user (the reveal-gate pattern: direct PBKDF2 insert into
// the e2e SQLite file — no API flakiness, no coupling to other specs' fixtures).
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
     VALUES ('${id}', 'e2e-loader', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

test('the veil carries the branded loader on a public page (login) — and the generic ring is gone', async ({ page }) => {
  await page.goto('/login.html')
  const probe = await page.evaluate(() => {
    const veil = document.getElementById('hibana-page-loader')
    if (!veil) return { veil: false }
    const mark = veil.querySelector<HTMLElement>('.hibana-loader-mark')
    const glyph = veil.querySelector<HTMLElement>('.hibana-loader-glyph')
    const orbit = veil.querySelector<HTMLElement>('.hibana-loader-orbit')
    const spark = veil.querySelector<HTMLElement>('.hibana-loader-spark')
    const track = veil.querySelector<HTMLElement>('.hibana-loader-track')
    const fill = veil.querySelector<HTMLElement>('.hibana-loader-fill')
    const brand = veil.querySelector<HTMLElement>('.hibana-page-loader-brand')
    const cs = (el: HTMLElement | null) => (el ? getComputedStyle(el) : null)
    return {
      veil: true,
      oldSpinner: !!veil.querySelector('.hibana-page-loader-spinner'),
      mark: !!mark,
      glyphText: glyph?.textContent?.trim() ?? null,
      orbitAnim: cs(orbit)?.animationName ?? null,
      markBg: cs(mark)?.backgroundColor ?? null,
      sparkBg: cs(spark)?.backgroundColor ?? null,
      trackOverflow: cs(track)?.overflow ?? null,
      fillAnim: cs(fill)?.animationName ?? null,
      brandText: brand?.textContent?.trim() ?? null,
    }
  })
  expect(probe.veil).toBe(true)
  expect(probe.oldSpinner).toBe(false) // the generic ring must not survive anywhere
  expect(probe.mark).toBe(true)
  expect(probe.glyphText).toBe('H')
  expect(probe.orbitAnim).toBe('hibana-loader-orbit')
  expect(probe.markBg).toBe('rgb(31, 31, 31)') // the icon.svg tile color, exact
  expect(probe.sparkBg).toBe('rgb(253, 224, 71)') // #fde047 — the spark yellow, exact
  expect(probe.trackOverflow).toBe('hidden')
  expect(probe.fillAnim).toBe('hibana-loader-sweep')
  expect(probe.brandText).toBe('Hibana')
})

test('the branded structure ships on an authed page too (the veil is app-wide markup)', async ({ page }) => {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
  const authed = await page.evaluate(() => {
    const veil = document.getElementById('hibana-page-loader')
    return {
      mark: !!veil?.querySelector('.hibana-loader-mark'),
      track: !!veil?.querySelector('.hibana-loader-track'),
      oldSpinner: !!veil?.querySelector('.hibana-page-loader-spinner'),
    }
  })
  expect(authed.mark).toBe(true)
  expect(authed.track).toBe(true)
  expect(authed.oldSpinner).toBe(false)
})

test('prefers-reduced-motion: the orbit parks and the track freezes — no emoji fallback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/login.html')
  const rm = await page.evaluate(() => {
    const veil = document.getElementById('hibana-page-loader')
    const orbit = veil?.querySelector<HTMLElement>('.hibana-loader-orbit')
    const fill = veil?.querySelector<HTMLElement>('.hibana-loader-fill')
    const cs = (el: HTMLElement | null) => (el ? getComputedStyle(el) : null)
    return {
      orbitAnim: cs(orbit)?.animationName ?? null,
      fillAnim: cs(fill)?.animationName ?? null,
      fillWidth: cs(fill)?.inlineSize ?? cs(fill)?.width ?? null,
      veilHtml: veil?.innerHTML ?? '',
    }
  })
  expect(rm.orbitAnim).toBe('none') // parked spark, not a spinning ring
  expect(rm.fillAnim).toBe('none')
  expect(parseFloat(rm.fillWidth ?? '0')).toBeGreaterThan(30) // static partial fill — still reads "loading"
  expect(rm.veilHtml).not.toContain('⏳') // the emoji fallback is retired
})
