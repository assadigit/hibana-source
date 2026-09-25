// e2e/s144-prio-banner.spec.ts — S144 (owner: "I want the priority of the tasks to be
// shown like the given screenshot instead of current way" + the CRM-card screenshot):
// the task card's priority is a PRIORITY BANNER — a colored strip fused across the
// card's TOP carrying the label — instead of the old left-border accent + tiny cycling
// dot + meta label. One canonical --prio-banner-* token per priority (white-label pairs,
// AA-verified), consumed identically by the board renderer AND the project page's
// server fragments. The banner IS the cycle affordance (the old dot's contract).
// Run: npx playwright test e2e/s144-prio-banner.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s144@test.local'
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
     VALUES ('${id}', 'e2e-s144', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // Suppress the onboarding coachmarks (the tour backdrop intercepts pointer clicks).
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
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

async function seedProject(page: Page): Promise<string> {
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e banners ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  for (const body of [
    { title: 's144 urgent task', priority: 'urgent' },
    { title: 's144 high task', priority: 'high' },
    { title: 's144 medium task', priority: 'medium' },
    { title: 's144 low task', priority: 'low' },
  ]) {
    await page.evaluate(async ({ pid, body }) => {
      await fetch(`/api/projects/${pid}/devtasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }, { pid, body })
  }
  return pid
}

test('every task card wears its priority banner — label on the strip, meta carries no label', async ({ page }) => {
  await login(page)
  const pid = await seedProject(page)
  await page.goto('/board.html?project=' + pid)
  await page.waitForSelector('.pd-task-title')
  for (const [prio, label] of [
    ['urgent', 'Urgent'],
    ['high', 'High Priority'],
    ['medium', 'Medium Priority'],
    ['low', 'Low Priority'],
  ] as const) {
    const wrap = page.locator(`.pd-task-wrap[data-priority="${prio}"]`)
    await expect(wrap).toHaveCount(1)
    const banner = wrap.locator('.prio-banner')
    await expect(banner).toHaveClass(new RegExp(`prio-banner prio-${prio}`))
    await expect(banner.locator('.prio-banner-label')).toHaveText(label)
    // AA white-label pairs from the ONE token set — inline style would drift; the
    // computed background must come from --prio-banner-<prio> (non-transparent).
    const bg = await banner.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    // the meta line keeps just the date — the label moved to the banner
    const meta = wrap.locator('.pd-task-meta')
    await expect(meta).not.toContainText(label)
    // the banner fuses the card's top: it sits flush above the card, same inline size
    const box = await banner.boundingBox()
    const card = await wrap.locator('.pd-task').boundingBox()
    expect(box).not.toBeNull(); expect(card).not.toBeNull()
    expect(Math.abs((box as { width: number }).width - (card as { width: number }).width)).toBeLessThan(2)
    expect((box as { y: number }).y).toBeLessThan((card as { y: number }).y)
  }
})

test('clicking the banner cycles the priority in place — and survives a reload', async ({ page }) => {
  await login(page)
  const pid = await seedProject(page)
  await page.goto('/board.html?project=' + pid)
  await page.waitForSelector('.pd-task-title')
  const low = page.locator('.pd-task-wrap[data-priority="low"]')
  await low.locator('.prio-banner').click() // low → medium, no editor
  await expect(page.locator('#pd-task-edit-modal')).toBeHidden()
  await expect(page.locator('.pd-task-wrap[data-priority="medium"]', { hasText: 's144 low task' })).toHaveCount(1)
  await page.reload()
  await page.waitForSelector('.pd-task-title')
  // persisted: the cycle PATCHed the server
  await expect(page.locator('.pd-task-wrap[data-priority="medium"]', { hasText: 's144 low task' })).toHaveCount(1)
})

test('the project page’s server-rendered fragments wear the same banner', async ({ page }) => {
  await login(page)
  const pid = await seedProject(page)
  await page.goto('/project.html?id=' + pid)
  await page.waitForSelector('.pd-task-title')
  const urgent = page.locator('.pd-task-wrap[data-pd-priority="urgent"]')
  await expect(urgent).toHaveCount(1)
  const banner = urgent.locator('.prio-banner')
  await expect(banner).toHaveClass(/prio-banner prio-urgent/)
  await expect(banner.locator('.prio-banner-label')).toHaveText('Urgent')
  await expect(urgent.locator('.pd-task-meta')).not.toContainText('Urgent')
  // the banner is the cycle button on this surface too — click urgent → low (wrap);
  // the wrap re-sorts to its new priority slot, so re-locate it by the NEW attr + text
  await banner.click()
  await expect(page.locator('#pd-task-edit-modal')).toBeHidden()
  const cycled = page.locator('.pd-task-wrap[data-pd-priority="low"]', { hasText: 's144 urgent task' })
  await expect(cycled).toHaveCount(1)
  await expect(cycled.locator('.prio-banner')).toHaveClass(/prio-banner prio-low/)
  await expect(cycled.locator('.prio-banner-label')).toHaveText('Low Priority')
})
