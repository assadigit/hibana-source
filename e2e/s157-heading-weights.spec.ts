// e2e/s157-heading-weights.spec.ts — S157 (owner report: "use lesser weight for
// headings, they're too bold" — the dashboard 'To-Do List' h2 as the example).
// The heading rungs dropped one weight rung, 600 → 500 (variables.css
// --text-h1-weight/--text-h2-weight), and the hardcoded stragglers joined the
// ladder: base h4 (was 600 — a fourth-level heading outweighed H3), the
// dashboard's .precent-head h2 (was a hardcoded 700 — General Sans 700 isn't
// shipped, so it rendered SYNTHETIC bold), and the notes reader's markdown
// h1/h2/h3 (was a hardcoded 600). Labels/badges/names that the owner
// deliberately asked to be bold (the S106 register) are NOT headings and stay.
// Pins:
//   (1) the owner's exact example: the dashboard 'To-Do List' h2 computes 500
//       (and its trailing date stays 400);
//   (2) a base h4 computes 500 (and the settings h4 keeps its eyebrow rung);
//   (3) the notes reader's markdown h1/h2/h3 compute 500 (token-driven);
//   (4) dark: the heading ladder is weight-identical (tokens don't flip).
// NOTE: the .precent-head h2 700→token repoint in dashboard.css stays as cleanup,
// but the class is DEAD (retired with the S123 carousel — it renders nowhere),
// so there is no live pin for it; the live pins below cover every rendered rung.
// Run: npx playwright test e2e/s157-heading-weights.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s157@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')

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
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* first run */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s157', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page, opts?: { theme?: 'claude-dark' }) {
  await page.addInitScript((o) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (o?.theme) localStorage.setItem('hibana-theme', o.theme)
    } catch { /* storage blocked */ }
  }, opts)
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

test("S179: the dashboard 'To-Do List' h2 computes the advisor's SEMI-BOLD 600 (supersedes S157's 500) and its date stays 400", async ({ page }) => {
  await login(page)
  await page.goto('/dashboard.html')
  const h2 = page.locator('#dashboard-todo h2').first()
  await expect(h2).toBeVisible()
  const weight = await h2.evaluate((el) => getComputedStyle(el).fontWeight)
  // S179 (advisor block 5): ONE section-heading pattern — ~18px SEMI-BOLD (600)
  expect(weight, 'the To-Do List h2 rides the 600 semi-bold rung (S179 supersedes S157)').toBe('600')

  const date = page.locator('#dashboard-todo h2 .dash-todo-date').first()
  await expect(date).toBeVisible()
  expect(await date.evaluate((el) => getComputedStyle(el).fontWeight), 'the date is a caption, not a heading — stays 400').toBe('400')
})

test('a base h4 computes 500 — a fourth-level heading no longer outweighs H3', async ({ page }) => {
  await login(page)
  await page.goto('/settings.html')
  const weight = await page.evaluate(() => {
    const el = document.createElement('h4')
    el.textContent = 's157 probe'
    document.body.appendChild(el)
    const w = getComputedStyle(el).fontWeight
    el.remove()
    return w
  })
  expect(weight, 'base h4 must be 500 (was 600)').toBe('500')
})

test('the notes reader markdown headings compute the tokens (h1/h2/h3 → 500)', async ({ page }) => {
  await login(page)
  await page.goto('/notes.html')
  await page.waitForSelector('.markdown-body, main', { timeout: 10_000 })
  const weights = await page.evaluate(() => {
    const wrap = document.createElement('div')
    wrap.className = 'markdown-body'
    wrap.innerHTML = '<h1>a</h1><h2>b</h2><h3>c</h3>'
    wrap.style.position = 'absolute'
    wrap.style.opacity = '0'
    document.body.appendChild(wrap)
    const w = [...wrap.querySelectorAll('h1,h2,h3')].map((el) => getComputedStyle(el).fontWeight)
    wrap.remove()
    return w
  })
  expect(weights, 'markdown h1/h2/h3 must all ride the 500 heading rungs (were hardcoded 600)').toEqual(['500', '500', '500'])
})

test('dark: the heading ladder is weight-identical (tokens do not flip in dark)', async ({ page }) => {
  await login(page, { theme: 'claude-dark' })
  await page.goto('/settings.html')
  await page.waitForSelector('h1')
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('claude-dark')
  const weight = await page.locator('h1').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(weight).toBe('500')
})
