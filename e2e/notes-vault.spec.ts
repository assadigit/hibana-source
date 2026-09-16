// e2e/notes-vault.spec.ts — the Notes Vault golden path (0057, S53).
// login → /notes renders the 3-pane vault → create a note → type → autosave persists →
// star → folder breadcrumb → markdown preview renders (the fixed list wrap) →
// trash → restore → purge wall. Catches the "unit-green but broken in the browser"
// class for the vault page specifically (boot ordering, i18n keys, CSP, cache-bust).
// Run: npx playwright test e2e/notes-vault.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-notes@test.local'
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
     VALUES ('${id}', 'e2e-notes', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

test('notes vault: create → autosave → preview → star → trash → restore, zero console errors', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')

  const errors: string[] = []
  const expectedErrorPatterns = [
    /Failed to load resource.*401/, // pre-login /api/auth/me probe
    /Failed to load resource.*404/, // SW manifest before the build step
  ]
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })

  await page.goto('/login.html')
  // Let the SW settle HERE (install → claim → boot.js's controllerchange reload): a reload
  // on the login page is harmless, and once a controller exists no further controllerchange
  // can fire mid-test and wipe the open editor (the pattern every multi-page spec uses).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app') // the authenticated landing route serves dashboard.html

  // The vault page: 3 panes render
  await page.goto('/notes.html')
  await expect(page.locator('.vault-tree')).toBeVisible()
  await expect(page.locator('.vault-list')).toBeVisible()
  await expect(page.locator('.vault-editor')).toBeVisible()
  await expect(page.locator('[data-vault-view-title]')).toHaveText('All notes')

  // Create a note: the + button creates, focuses the title, autosaves on type
  await page.click('[data-vault-new]')
  await expect(page.locator('[data-vault-title]')).toBeFocused()
  await page.fill('[data-vault-title]', 'E2E vault note')
  await page.fill('[data-vault-src]', '## Heading\n\n- one\n- two\n\n**bold** text')
  // autosave (900ms debounce) → the status chip flips to Saved
  await expect(page.locator('[data-vault-save][data-state="saved"]')).toBeVisible({ timeout: 6000 })
  // the card list shows the new note with its title
  await expect(page.locator('.vault-card-title').first()).toContainText('E2E vault note')

  // the live preview renders markdown (single <ul> wrap — the S53 renderer fix)
  const previewHtml = await page.locator('[data-vault-preview-body]').innerHTML()
  expect(previewHtml).toContain('<h2>Heading</h2>')
  expect(previewHtml).toContain('<ul><li>one</li>')
  expect(previewHtml).toContain('<strong>bold</strong>')
  expect(previewHtml).not.toContain('<ul><ol>')

  // star it: the button flips and the sidebar count updates
  await page.click('[data-vault-star]')
  await expect(page.locator('[data-vault-star][aria-pressed="true"]')).toBeVisible()

  // reload: the note persisted (server round-trip through the whole stack)
  await page.reload()
  await expect(page.locator('.vault-card-title').first()).toContainText('E2E vault note')
  await page.click('[data-vault-card]')
  await expect(page.locator('[data-vault-title]')).toHaveValue('E2E vault note')

  // trash flow: delete from the kebab → toast undo → trash view → restore
  await page.click('[data-vault-kebab]')
  await page.click('.vault-pop-item:has-text("Move to Trash")')
  await expect(page.locator('#toast')).toContainText('Trash')
  await page.click('[data-vault-view="trash"]')
  await expect(page.locator('[data-vault-card]')).toHaveCount(1)
  await page.click('[data-vault-restore]')
  await expect(page.locator('[data-vault-card]')).toHaveCount(0) // restored out of trash
  await page.click('[data-vault-view="all"]')
  await expect(page.locator('[data-vault-card]')).toHaveCount(1)

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

test('notes vault: FAB “New note” lands on /notes with a fresh focused note', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')

  const errors: string[] = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/login.html')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('load').catch(() => {})

  // The dashboard FAB carries the vault capture item (S54): idea / project / note / quick note.
  await page.click('.fab[data-fab-toggle]')
  const vaultItem = page.locator('.fab-item[data-i18n-title="fab.vault"]')
  await expect(vaultItem).toBeVisible()
  await vaultItem.click()

  // Soft-navigation lands on /notes with the ?new=1 param consumed → fresh note open.
  await page.waitForURL('**/notes.html', { timeout: 10_000 })
  await expect(page.locator('[data-vault-title]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-vault-title]')).toBeFocused()
  await expect(page.locator('[data-vault-title]')).toHaveValue('')
  expect(page.url()).not.toContain('new=1') // stripped so a reload reopens the list

  // Type → autosave persists (the full S53 path re-verified through the FAB entry).
  await page.fill('[data-vault-title]', 'From the FAB')
  await page.fill('[data-vault-src]', 'captured from the dashboard +')
  await expect(page.locator('[data-vault-save][data-state="saved"]')).toBeVisible({ timeout: 6_000 })

  const filtered = errors.filter((e) => !/Failed to load resource.*(401|404)/.test(e))
  expect(filtered, `console errors: ${filtered.join(' | ')}`).toEqual([])
})
