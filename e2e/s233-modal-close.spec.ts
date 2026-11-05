// e2e/s233-modal-close.spec.ts — S233 (the owner ask, with the settings-sheet
// screenshot): EVERY MODAL CARRIES A CLOSE ON ITS TOP RIGHT. The board's surfaces
// prove the contract: the task editor + labels manager (the established row-spread
// ✕ grammar — the census keeps them covered), the delete-task confirm (the native
// dialog's new title-row ✕), and the S210 danger confirm (the hib-confirm head's
// corner ✕ — the cancel path's twin, never the confirm).
// Run: npx playwright test e2e/s233-modal-close.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s233@test.local'
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
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s233', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
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

test('board modals: every modal carries a top-right close — editor, labels, delete-task confirm', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e s233 ${Date.now()}`, status: 'developing' }) })
    const p = ((await res.json()) as { id: string }).id
    await fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's233 task', status: 'idea', priority: 'medium', tags: ['KeepMe'] }) })
    return p
  })
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1)

  // 1. the task VIEW (S238 — the census's new member): a card click opens the
  //    read-only view — its head row carries the same ✕ grammar, and it closes.
  await page.locator('.pd-task').first().click()
  const view = page.locator('.db-view-overlay:not([hidden])')
  await expect(view).toBeVisible()
  const viewX = view.locator('[data-db-view-x]')
  await expect(viewX).toBeVisible()
  await expect(viewX).toHaveAttribute('aria-label', 'Close')
  await viewX.click()
  await expect(view).toBeHidden()

  // 1b. the task editor — S238: the ⋯ menu's Edit opens it (the card click no
  //     longer does). The established grammar (the census): the ✕ rides the
  //     header row's inline end, and it closes the editor. (Scope to
  //     .db-modal-head — the footer's Cancel button carries data-db-close too.)
  await page.locator('.pd-task').first().hover()
  await page.locator('.db-card-menu [data-menu-open]').first().click()
  await page.locator('[data-db-edit-card]').first().click()
  const editor = page.locator('.db-modal:not([hidden])')
  await expect(editor).toBeVisible()
  const editorX = editor.locator('.db-modal-head [data-db-close]')
  await expect(editorX).toBeVisible()
  await expect(editorX).toHaveAttribute('aria-label', 'Close')
  await editorX.click()
  await expect(editor).toBeHidden()

  // 2. the labels manager — the census: same ✕ grammar, same close.
  await page.click('#db-labels-btn')
  const labels = page.locator('.db-modal:not([hidden])')
  await expect(labels).toBeVisible()
  const labelsX = labels.locator('[data-lbl-close]')
  await expect(labelsX).toBeVisible()
  await expect(labelsX).toHaveAttribute('aria-label', 'Close')
  await labelsX.click()
  await expect(labels).toBeHidden()

  // 3. the delete-task confirm (S233): the native dialog's title row now carries
  //    the ✕ on the inline end — the Cancel twin. The ✕ closes; the task survives.
  await page.locator('.db-card-menu [data-menu-open]').first().click()
  await page.locator('[data-db-del-card]').first().click()
  const delDlg = page.locator('#db-del-confirm')
  await expect(delDlg).toBeVisible()
  const delX = delDlg.locator('#db-del-x')
  await expect(delX).toBeVisible()
  await expect(delX).toHaveAttribute('aria-label', 'Close')
  // the ✕ sits in the title row, on the title's inline end (the row-spread grammar)
  await expect(delDlg.locator('.row.spread h3')).toBeVisible()
  await delX.click()
  await expect(delDlg).toBeHidden()
  await expect(page.locator('.pd-task-wrap')).toHaveCount(1) // nothing deleted
})

test('the S210 confirm modal carries the top-right ✕ — the cancel path, never the confirm', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e s233c ${Date.now()}`, status: 'developing' }) })
    const p = ((await res.json()) as { id: string }).id
    const post = (body: unknown) => fetch(`/api/projects/${p}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await post({ title: 's233 used one', status: 'idea', priority: 'medium', tags: ['Guarded'] })
    await post({ title: 's233 used two', status: 'idea', priority: 'medium', tags: ['Guarded'] })
    return p
  })
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2)

  // a USED label's delete confirm — the danger card with a title. The head row
  // carries the corner ✕ (its own data value — the cancel locators stay
  // single-match); clicking it resolves the CANCEL path: overlay gone, label kept.
  await page.click('#db-labels-btn')
  const labels = page.locator('.db-modal:not([hidden])')
  await expect(labels).toBeVisible()
  await labels.locator('[data-lbl-del]').first().click()
  const overlay = page.locator('.hib-confirm-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('.hib-confirm-message')).toContainText('2')
  const cornerX = overlay.locator('[data-hib-confirm="x"]')
  await expect(cornerX).toBeVisible()
  await expect(cornerX).toHaveAttribute('aria-label', 'Close')
  await cornerX.click()
  await expect(overlay).toHaveCount(0)
  // the label survived the ✕ (the cancel twin): the row is still there, usage 2
  await expect(labels.locator('.db-label-row[data-tag-id] input[value="Guarded"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.pd-task .pd-tag', { hasText: 'Guarded' })).toHaveCount(2)
})
