// e2e/s154-prio-dark.spec.ts — S154 (owner round: the priority badges go dark-native).
// The owner supplied the exact DARK pairs (a low-opacity tint of each priority's hue
// blended into the dark surface + a lightened same-hue ink) and forbade substitution:
// High (4.68:1) and Urgent (4.54:1) sit just above the AA floor. Light mode must stay
// UNTOUCHED (the S150 fill+ink pairs). Pins all of it on the ONE --prio-banner-*
// token family:
//   (1) dark: the four kanban banners wear the owner's exact computed pair
//   (2) dark: the detail slide-over's priority chip wears the same pair (it reads
//       the banner tokens since S154 — the hardcoded #fff base ink is gone too)
//   (3) dark: the reports share-bar segments ride the same tokens (the retired
//       S143 rgb literals + the stale #d9365b fallback are gone)
//   (4) light: the banner pairs are STILL the S150 fills (light untouched)
// Run: npx playwright test e2e/s154-prio-dark.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s154@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const PROJ_ID = randomBytes(16).toString('hex')
const TASKS = [
  { id: randomBytes(16).toString('hex'), title: 's154 low task', prio: 'low' },
  { id: randomBytes(16).toString('hex'), title: 's154 medium task', prio: 'medium' },
  { id: randomBytes(16).toString('hex'), title: 's154 high task', prio: 'high' },
  { id: randomBytes(16).toString('hex'), title: 's154 urgent task', prio: 'urgent' },
] as const

// the owner's S154 DARK pairs — rgb() of the exact hexes (no substitution allowed)
const DARK = {
  low: { ink: 'rgb(131, 163, 195)', fill: 'rgb(41, 47, 54)' }, // #83A3C3 / #292F36
  medium: { ink: 'rgb(226, 190, 90)', fill: 'rgb(56, 51, 37)' }, // #E2BE5A / #383325
  high: { ink: 'rgb(233, 121, 73)', fill: 'rgb(62, 42, 35)' }, // #E97949 / #3E2A23
  urgent: { ink: 'rgb(236, 110, 101)', fill: 'rgb(62, 40, 40)' }, // #EC6E65 / #3E2828
} as const
// the S150 LIGHT pairs — must NOT change this round
const LIGHT = {
  low: { ink: 'rgb(69, 82, 94)', fill: 'rgb(211, 217, 223)' }, // #45525E / #D3D9DF
  medium: { ink: 'rgb(96, 73, 16)', fill: 'rgb(244, 229, 189)' }, // #604910 / #F4E5BD
  high: { ink: 'rgb(255, 255, 255)', fill: 'rgb(193, 78, 27)' }, // #FFFFFF / #C14E1B
  urgent: { ink: 'rgb(255, 255, 255)', fill: 'rgb(191, 42, 30)' }, // #FFFFFF / #BF2A1E
} as const

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
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM dev_tasks WHERE title LIKE 's154 %'`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s154', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJ_ID}', '${USER_ID}', 's154 dark badges', '', 'personal', 'planning', 0, '${now}', '${now}')`,
  )
  for (const t of TASKS) {
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${t.id}', '${PROJ_ID}', '${t.title}', 'planned', '${t.prio}', ${TASKS.indexOf(t) + 1}, '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page, theme?: 'claude-dark') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (t) localStorage.setItem('hibana-theme', t)
    } catch { /* storage blocked */ }
  }, theme)
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

const bannerPair = (page: Page, prio: string) =>
  page.evaluate((p) => {
    const b = document.querySelector(`.pd-task-wrap[data-pd-task] .prio-banner.prio-${p}`)
    if (!b) return null
    const cs = getComputedStyle(b)
    return { fill: cs.backgroundColor, ink: cs.color }
  }, prio)

test('dark: every priority banner wears the owner\'s exact pair', async ({ page }) => {
  await login(page, 'claude-dark')
  await page.goto(`/project.html?id=${PROJ_ID}`)
  await expect(page.locator('.prio-banner').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('claude-dark')
  for (const t of TASKS) {
    const pair = await bannerPair(page, t.prio)
    expect(pair, `${t.prio} banner pair`).toEqual({ fill: DARK[t.prio].fill, ink: DARK[t.prio].ink })
  }
})

test('dark: the detail slide-over chip wears the same pair (banner tokens, no hardcoded ink)', async ({ page }) => {
  await login(page, 'claude-dark')
  await page.goto(`/project.html?id=${PROJ_ID}`)
  const wrap = page.locator(`.pd-task-wrap[data-pd-task="${TASKS[3].id}"]`)
  await expect(wrap).toBeVisible()
  await wrap.locator('.pd-task').click()
  const chip = page.locator('.pd-detail-prio.prio-urgent')
  await expect(chip).toBeVisible()
  const cs = await chip.evaluate((el) => ({ fill: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }))
  expect(cs).toEqual({ fill: DARK.urgent.fill, ink: DARK.urgent.ink })
  await page.keyboard.press('Escape')
})

test('light: the banner pairs are STILL the S150 fills (light untouched)', async ({ page }) => {
  await login(page) // no theme init — default light
  await page.goto(`/project.html?id=${PROJ_ID}`)
  await expect(page.locator('.prio-banner').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
  for (const t of TASKS) {
    const pair = await bannerPair(page, t.prio)
    expect(pair, `${t.prio} banner pair (light)`).toEqual({ fill: LIGHT[t.prio].fill, ink: LIGHT[t.prio].ink })
  }
})

test('dark: the reports share-bar segments ride the same tokens (S143 literals gone)', async ({ page }) => {
  await login(page, 'claude-dark')
  await page.goto('/reports.html')
  const bar = page.locator('.rep-tasks .rep-share').first()
  await expect(bar).toBeVisible({ timeout: 10_000 })
  for (const prio of ['low', 'medium', 'high', 'urgent'] as const) {
    const seg = bar.locator(`.rep-share-seg.prio-${prio}`).first()
    await expect(seg).toBeVisible()
    const fill = await seg.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(fill, `${prio} segment`).toBe(DARK[prio].fill)
  }
})
