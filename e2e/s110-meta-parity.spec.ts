// e2e/s110-meta-parity.spec.ts — S110 (v0.3.43.0), the [MEDIUM] backlog item's lock:
// "the fullscreen version must inherit the exact design tokens and layout decisions of
// the projects-page box." S105 aligned the title register + preview; the audit this
// round found the LAST drift — the board's meta was a bare date while the project page
// renders "<priority label> · date · clock" (✓ when done). Both surfaces now render
// through the SHARED chip-render metaHtml, and this pin asserts the two surfaces
// produce BYTE-IDENTICAL meta for the same seeded task — the drift can never return
// silently. (runs against the playwright-managed Node server + fresh /tmp DB)

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-parity@test.local'
const TEST_PASS = 'e2e-password-123'
// FIXED timestamps → deterministic meta strings on both surfaces.
const T_CREATED = '2026-09-22T14:41:00.000Z' // → "22 Sep 2026 · 2:41 PM" (EN)
const PROJECT_ID = 'parity-proj-0001'
const TASK_OPEN = 'parity-task-open1'
const TASK_DONE = 'parity-task-done1'

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
     VALUES ('${id}', 'e2e-parity', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(`DELETE FROM dev_tasks WHERE project_id = '${PROJECT_ID}'`)
  db.exec(`DELETE FROM projects WHERE id = '${PROJECT_ID}'`)
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at)
     VALUES ('${PROJECT_ID}', '${id}', 'Parity project', 'developing', NULL, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${TASK_OPEN}', '${PROJECT_ID}', 'Parity task alpha', 'planned', 'high', 0, '${T_CREATED}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at, done_at)
     VALUES ('${TASK_DONE}', '${PROJECT_ID}', 'Parity task beta', 'done', 'low', 0, '${T_CREATED}', '${T_CREATED}')`,
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

const readCard = (page: import('@playwright/test').Page, title: string, cardSel: string) =>
  page.evaluate(({ title, cardSel }) => {
    const cards = [...document.querySelectorAll(cardSel)]
    const card = cards.find((c) => (c.querySelector('.pd-task-title')?.textContent ?? '').includes(title))
    if (!card) return { found: false }
    const meta = card.querySelector('.pd-task-meta')
    return {
      found: true,
      metaText: meta?.textContent?.trim() ?? null,
      hasPrioChip: !!meta?.querySelector('.pd-meta-prio'),
      prioClass: meta?.querySelector('.pd-meta-prio')?.className ?? null,
      prioLabel: meta?.querySelector('.pd-meta-prio')?.textContent?.trim() ?? null,
      metaFont: meta ? getComputedStyle(meta).fontSize : null,
      usesOldDateSpan: !!card.querySelector('.db-card-date'),
    }
  }, { title, cardSel })

test('the fullscreen board renders the EXACT meta the project page renders (shared chip-render metaHtml)', async ({ page }) => {
  await login(page)

  await page.goto('/project.html?id=' + PROJECT_ID)
  await page.waitForSelector('.pd-task-title')
  const pdOpen = await readCard(page, 'Parity task alpha', '.pd-task')
  const pdDone = await readCard(page, 'Parity task beta', '.pd-task')
  expect(pdOpen.found, 'open task visible on the project page').toBe(true)
  expect(pdOpen.hasPrioChip).toBe(true)
  expect(pdOpen.prioLabel).toBe('High Priority')
  expect(pdOpen.metaText).toBe('High Priority · 22 Sep 2026 · 2:41 PM')
  expect(pdDone.metaText).toBe('Low Priority · ✓ 22 Sep 2026 · 2:41 PM')

  await page.goto('/board.html?project=' + PROJECT_ID)
  await page.waitForSelector('.pd-task-title')
  const dbOpen = await readCard(page, 'Parity task alpha', '.pd-task-wrap')
  const dbDone = await readCard(page, 'Parity task beta', '.pd-task-wrap')
  expect(dbOpen.found, 'open task visible on the fullscreen board').toBe(true)
  // THE PARITY PINS — byte-identical meta on both surfaces:
  expect(dbOpen.metaText).toBe(pdOpen.metaText)
  expect(dbDone.metaText).toBe(pdDone.metaText)
  expect(dbOpen.prioLabel).toBe('High Priority')
  expect(dbOpen.prioClass).toContain('prio-high')
  expect(dbOpen.usesOldDateSpan).toBe(false)
  expect(dbDone.metaText.startsWith('Low Priority · ✓')).toBe(true)
  // the .pd-task-meta token (font parity — project-header.css loads on board.html)
  expect(dbOpen.metaFont).toBe(pdOpen.metaFont)
})

test('the shared metaHtml renderer exists on both surfaces (HibanaChips contract)', async ({ page }) => {
  await login(page)
  await page.goto('/project.html?id=' + PROJECT_ID)
  const p = await page.evaluate(() => typeof (window.HibanaChips as any)?.metaHtml)
  expect(p).toBe('function')
  await page.goto('/board.html?project=' + PROJECT_ID)
  const b = await page.evaluate(() => typeof (window.HibanaChips as any)?.metaHtml)
  expect(b).toBe('function')
})
