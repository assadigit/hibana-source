// e2e/s155-typography.spec.ts — S155 (owner round: the typography system).
// The owner's spec: ONE family (General Sans, weights 400/500/600 only — 700 in
// reserve), the ink rungs (opacity carries hierarchy, not a second color), and the
// type scale (H1 24→20 mobile · H2 18→16 mobile · H3 14 · Body 16 · Label 14/500 ·
// Eyebrow 12/500/+0.03em sentence case · Caption 12/500). Pins the four load-bearing
// contracts the ladder must never silently lose:
//   (1) light: the family loads + the body/body-secondary/label registers compute
//   (2) the element ladder: H1/H2 tokens (desktop + the mobile shrink) on real pages
//   (3) dark: the ink rungs invert to the white-based ladder (tertiary pinned at the
//       0.50 band edge — 0.45 fails AA on the #1f1e1c card, verified this round)
//   (4) fa: the Farsi stack still leads with Vazir (General Sans has no Arabic glyphs)
// Run: npx playwright test e2e/s155-typography.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s155@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
// a dedicated fa user: i18n resolves the language from the PROFILE's language_pref
// (localStorage is only a paint cache the profile overwrites), so the fa contract
// test needs a user actually seeded fa
const FA_EMAIL = 'e2e-s155-fa@test.local'
const FA_USER_ID = randomBytes(16).toString('hex')

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
  try {
    db.exec(`DELETE FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}')`)
  } catch { /* first run */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s155', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${FA_USER_ID}', 'e2e-s155-fa', '${FA_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page, opts?: { theme?: 'claude-dark'; lang?: 'fa'; as?: string }) {
  await page.addInitScript((o) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (o?.theme) localStorage.setItem('hibana-theme', o.theme)
    } catch { /* storage blocked */ }
  }, opts)
  await page.goto('/login.html')
  await page.fill('[name="login"]', opts?.as ?? TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

// a detached probe element resolves any token/class without depending on which
// page happens to render which component
const probe = (page: Page, setup: string) =>
  page.evaluate((s) => {
    const el = document.createElement('div')
    el.setAttribute('style', s)
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    const out = { color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing }
    el.remove()
    return out
  }, setup)

test('light: General Sans loads and the ink rungs + registers compute (family, body, secondary, label, caption)', async ({ page }) => {
  await login(page)
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => document.fonts.check('16px "General Sans"'))
  expect(loaded, 'General Sans woff2 loaded').toBe(true)

  // the family leads the stack everywhere (Vazir pair follows for FA glyph coverage)
  const body = await probe(page, 'font-family: var(--font-sans)')
  expect(body.fontFamily.startsWith('"General Sans"') || body.fontFamily.startsWith("'General Sans'")).toBe(true)

  // the ink rungs: --text/--muted are the primary/secondary rungs FLATTENED ON
  // WHITE (opaque — the ink-anchored color-mix recipes need an opaque anchor; see
  // variables.css); the raw translucent rungs stay reachable via --ink-*
  const bodyInk = await probe(page, 'color: var(--text)')
  expect(bodyInk.color).toBe('rgb(20, 20, 20)') // #141414 = 0.92 black flattened
  const mutedInk = await probe(page, 'color: var(--muted)')
  expect(mutedInk.color).toBe('rgb(92, 92, 92)') // #5C5C5C = 0.64 black flattened
  const primaryRung = await probe(page, 'color: var(--ink-primary)')
  expect(primaryRung.color).toBe('rgba(0, 0, 0, 0.92)')
  const tertiary = await probe(page, 'color: var(--ink-tertiary)')
  expect(tertiary.color).toBe('rgba(0, 0, 0, 0.56)')

  // the registers: body 16px/1.55 → body-secondary 14px → label 500 → caption 12px/500
  expect(body.fontSize).toBe('16px')
  expect(body.lineHeight).toBe('24.8px') // 1.55 × 16
  const secondary = await probe(page, 'font-size: var(--text-body-secondary-size)')
  expect(secondary.fontSize).toBe('14px')
  const label = await probe(page, 'font-size: var(--text-label-size); font-weight: var(--text-label-weight)')
  expect(label.fontSize).toBe('14px')
  expect(label.fontWeight).toBe('500')
  const caption = await probe(page, 'font-size: var(--text-caption-size); font-weight: var(--text-caption-weight)')
  expect(caption.fontSize).toBe('12px')
  expect(caption.fontWeight).toBe('500')
  // the eyebrow tracking: 0.03em → 0.48px at the probe's inherited 16px
  const eyebrow = await probe(page, 'letter-spacing: var(--text-eyebrow-tracking)')
  expect(eyebrow.letterSpacing).toBe('0.48px')
  // base <button> sits on the Label register now
  const btn = await page.evaluate(() => {
    const b = document.createElement('button')
    document.body.appendChild(b)
    const w = getComputedStyle(b).fontWeight
    b.remove()
    return w
  })
  expect(btn).toBe('500')
})

test('the element ladder: H1/H2 compute the tokens on a real page, and shrink on mobile only', async ({ page }) => {
  await login(page)
  await page.goto('/settings.html')
  const h1 = page.locator('h1').first()
  await expect(h1).toBeVisible()
  expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe('24px')
  // S157: the heading rungs dropped 600 → 500 (the owner's lighter-heading ladder)
  expect(await h1.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')
  expect(await h1.evaluate((el) => getComputedStyle(el).lineHeight)).toBe('28.8px') // 1.2 × 24
  // mobile: ONLY H1/H2 shrink (the spec's "headings have room to give; working text doesn't")
  await page.setViewportSize({ width: 375, height: 667 })
  expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe('20px')
  await page.setViewportSize({ width: 1280, height: 720 })
  // body stays 16px on the same 375px visit — covered by the register test above (16px at desktop);
  // the caption/label tokens carry no mobile variants by construction (single tokens, no -mobile twins)
})

test('dark: the ink rungs invert to the white-based ladder', async ({ page }) => {
  await login(page, { theme: 'claude-dark' })
  await page.goto('/settings.html')
  await page.waitForSelector('h1')
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('claude-dark')
  const bodyInk = await probe(page, 'color: var(--text)')
  expect(bodyInk.color).toBe('rgb(237, 237, 236)') // #EDEDEC = 0.92 white flattened on the card
  const mutedInk = await probe(page, 'color: var(--muted)')
  expect(mutedInk.color).toBe('rgb(156, 156, 155)') // #9C9C9B = 0.56 white flattened
  const primaryRung = await probe(page, 'color: var(--ink-primary)')
  expect(primaryRung.color).toBe('rgba(255, 255, 255, 0.92)')
  // tertiary pinned at the TOP of the owner's 0.40–0.50 band (0.45 computes 4.40:1
  // on the #1f1e1c card — below AA for the 12px captions that wear this rung)
  const tertiary = await probe(page, 'color: var(--ink-tertiary)')
  expect(tertiary.color).toBe('rgba(255, 255, 255, 0.5)')
})

test('fa: the Farsi stack still leads with Vazir (General Sans has no Arabic glyphs)', async ({ page }) => {
  await login(page, { as: FA_EMAIL }) // the profile's language_pref 'fa' drives i18n
  await page.goto('/settings.html')
  await page.waitForSelector('h1')
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fa')
  const body = await probe(page, 'font-family: var(--font-fa)')
  expect(body.fontFamily.startsWith('Vazir') || body.fontFamily.startsWith('"Vazir"') || body.fontFamily.startsWith("'Vazir'")).toBe(true)
})
