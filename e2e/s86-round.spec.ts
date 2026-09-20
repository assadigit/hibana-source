// e2e/s86-round.spec.ts — the S86 owner round, browser-pinned:
//   1. the Ask-AI panel (the wand's custom-prompt path — the owner's "classify my
//      wishlist books" ask): the toolbar button opens the popover, the third action
//      swaps it into the instruction form, an empty Run is refused client-side, and
//      a real Run degrades honestly on the Node self-host (503 Workers-only) WITHOUT
//      losing the typed instruction.
//   2. note + folder EMOJI (0059): the editor chip opens the shared picker, the pick
//      lands on the chip + the card + the tree, and Remove clears it.
//   3. the drag-REORDER of note cards (0059): a real HTML5 drag moves a card, the
//      sort flips to Custom order, the POST persists, and a RELOAD keeps the order.
//   4. the progress-box heading + content preview (the owner's "14px bold heading
//      with a little preview"): font-weight/size asserted as COMPUTED styles, and
//      the preview line carries the task's content.
//   5. Upload files (PDF) in the task composer: the picker accepts .pdf, the upload
//      lands, and the staged tile is a FILE tile (ext badge + name), not an <img>.
// Run: npx playwright test e2e/s86-round.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s86@test.local'
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
     VALUES ('${id}', 'e2e-s86', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  // Suppress the first-visit tour overlay (S85 lesson: BOTH keys).
  await page.evaluate(() => {
    localStorage.setItem('hibana-tour-done', '1')
    localStorage.setItem('hibana-ln-done', '1')
  })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

/** Create a note through the API (fast — no autosave waits) and return its id. */
async function apiNote(page: Page, title: string, content = 'body'): Promise<string> {
  return page.evaluate(async ({ title, content }) => {
    const res = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    })
    return ((await res.json()) as { note: { id: string } }).note.id
  }, { title, content })
}

test('Ask-AI panel: popover → instruction form → empty-Run refused → 503 keeps the instruction', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page)
  await apiNote(page, 'Wishlist books', 'Dune\nThe Pragmatic Programmer\nSapiens')
  await page.goto('/notes.html')
  await expect(page.locator('.vault-card-title').first()).toContainText('Wishlist books', { timeout: 10_000 })
  await page.click('[data-vault-card]')

  // The toolbar's Ask-AI button opens the wand popover for the editor.
  await expect(page.locator('[data-vault-ai]')).toBeVisible()
  await page.click('[data-vault-ai]')
  const pop = page.locator('.magic-popover')
  await expect(pop).toBeVisible()
  // Three actions now — the third is the custom-prompt path.
  await expect(pop.locator('[data-action="polish"]')).toBeVisible()
  await expect(pop.locator('[data-action="translate"]')).toBeVisible()
  await expect(pop.locator('[data-action="custom"]')).toBeVisible()

  // Ask AI… swaps the popover into the instruction form.
  await pop.locator('[data-action="custom"]').click()
  const ta = pop.locator('.magic-prompt-ta')
  await expect(ta).toBeVisible()
  await expect(ta).toBeFocused()
  await expect(pop.locator('[data-prompt-back]')).toBeVisible()
  await expect(pop.locator('[data-prompt-run]')).toBeVisible()

  // Empty Run: refused client-side — the toast says so, the panel stays.
  await pop.locator('[data-prompt-run]').click()
  await expect(page.locator('#toast .toast-msg')).toContainText(/instruction/i)
  await expect(ta).toBeVisible()

  // A real Run on the Node self-host (no AI binding) → the honest Workers-only
  // error, and the typed instruction SURVIVES (the panel re-renders prefilled).
  await ta.fill('Classify these books into meaningful categories')
  await pop.locator('[data-prompt-run]').click()
  await expect(ta).toHaveValue('Classify these books into meaningful categories', { timeout: 10_000 })
  await expect(ta).toBeVisible()
  expect(errors).toEqual([])
})

test('note emoji: the editor chip + card + Remove; the folder tree gets its own icon', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page)
  await apiNote(page, 'Emoji target note')
  await page.goto('/notes.html')
  await expect(page.locator('.vault-card-title').first()).toContainText('Emoji target note', { timeout: 10_000 })
  await page.click('[data-vault-card]')

  // The chip opens the shared picker; pick whatever emoji heads the grid.
  await page.click('[data-vault-emoji]')
  const picker = page.locator('.emoji-pop.open')
  await expect(picker).toBeVisible()
  const first = picker.locator('.emoji-pop-em').first()
  const emoji = (await first.getAttribute('data-emoji')) || '🙂'
  await first.click()
  await expect(picker).not.toBeVisible()

  // The chip now IS the emoji; the card carries it next to the title.
  const chip = page.locator('[data-vault-emoji]')
  await expect(chip).toHaveClass(/is-set/)
  await expect(chip).toContainText(emoji)
  await expect(page.locator('.vault-card-emoji').first()).toContainText(emoji)

  // The note kebab offers Remove emoji; the chip reverts to the smile glyph.
  await page.click('[data-vault-kebab]')
  const menu = page.locator('.vault-pop')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.vault-pop-item', { hasText: 'Remove emoji' })).toBeVisible()
  await menu.locator('.vault-pop-item', { hasText: 'Remove emoji' }).click()
  await expect(page.locator('[data-vault-emoji]')).not.toHaveClass(/is-set/)
  await expect(page.locator('.vault-card-emoji')).toHaveCount(0)

  // Folder: create one, kebab → Set emoji → the tree row shows it.
  await page.click('[data-vault-newfolder-root]')
  await page.fill('[data-vault-newfolder-input]', 'S86 folder')
  await page.keyboard.press('Enter')
  const row = page.locator('[data-folder-row]', { hasText: 'S86 folder' }).first()
  await expect(row).toBeVisible({ timeout: 5_000 })
  // The kebab is quiet chrome (display:none until the row hovers) — hover first.
  await row.locator('.vault-folder').hover()
  await row.locator('[data-vault-folder-kebab]').click()
  const fmenu = page.locator('.vault-pop')
  await expect(fmenu.locator('.vault-pop-item', { hasText: 'Set emoji' })).toBeVisible()
  await fmenu.locator('.vault-pop-item', { hasText: 'Set emoji' }).click()
  await expect(page.locator('.emoji-pop.open')).toBeVisible()
  await page.locator('.emoji-pop.open .emoji-pop-em').first().click()
  await expect(row.locator('.vault-folder-emoji')).toBeVisible()
  expect(errors).toEqual([])
})

test('drag-reorder: a real HTML5 drag moves the card, flips the sort to Custom order, and RELOAD keeps it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page)
  const ids = {
    a: await apiNote(page, 's86-order-A'),
    b: await apiNote(page, 's86-order-B'),
    c: await apiNote(page, 's86-order-C'),
  }
  await page.goto('/notes.html')
  // Only THIS test's notes (earlier specs in the file leave their own behind).
  const cards = page.locator('[data-vault-card]').filter({ hasText: /s86-order-/ })
  await expect(cards).toHaveCount(3, { timeout: 10_000 })
  await expect(page.locator('[data-vault-sort]')).toHaveValue('updated')
  // Pre-drag order = updated DESC = [c, b, a] (newest first).
  const pre = await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-vault-card')))
  expect(pre).toEqual([ids.c, ids.b, ids.a])

  // A real drag (the label-manager pattern: targetPosition pins the drop point):
  // A (the last card) onto B's TOP edge → A lands BETWEEN C and B.
  await page.locator(`[data-vault-card="${ids.a}"]`).dragTo(page.locator(`[data-vault-card="${ids.b}"]`), { targetPosition: { x: 40, y: 3 } })
  await expect(page.locator('[data-vault-sort]')).toHaveValue('manual')
  const order = await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-vault-card')))
  expect(order).toEqual([ids.c, ids.a, ids.b])

  // Persisted server-side (sort_order ASC on reload — the pref + the rank together).
  await page.reload()
  await expect(cards).toHaveCount(3, { timeout: 10_000 })
  await expect(page.locator('[data-vault-sort]')).toHaveValue('manual')
  const order2 = await cards.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-vault-card')))
  expect(order2).toEqual([ids.c, ids.a, ids.b])
  expect(errors).toEqual([])
})

test('progress box: the heading computes bold + larger, and the content preview rides under it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page)
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `s86 progress ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })

  // Add a task with heading + content through the real composer.
  await page.click('[data-pd-add="idea"]')
  await page.fill('#pd-taskadd-title-input', 'E2E s86 heading')
  await page.fill('#pd-taskadd-textarea', 'The preview line content that should appear under the bold heading')
  await page.click('#pd-taskadd-save')
  const card = page.locator('.pd-task-wrap', { hasText: 'E2E s86 heading' }).first()
  await expect(card).toBeVisible({ timeout: 10_000 })

  // The heading computes to bold (≥600) and LARGER than the meta line beneath it.
  const titleBox = card.locator('.pd-task-title')
  const metaBox = card.locator('.pd-task-meta')
  await expect(titleBox).toBeVisible()
  const fontWeight = await titleBox.evaluate((el) => getComputedStyle(el).fontWeight)
  const titleSize = await titleBox.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const metaSize = await metaBox.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(Number(fontWeight)).toBeGreaterThanOrEqual(600)
  expect(titleSize).toBeGreaterThan(metaSize)

  // The preview: the task's CONTENT, one muted line under the heading.
  const preview = card.locator('.pd-task-preview')
  await expect(preview).toHaveCount(1)
  await expect(preview).toContainText('The preview line content')
  const previewColor = await preview.evaluate((el) => getComputedStyle(el).color)
  expect(previewColor).toBeTruthy()
  expect(errors).toEqual([])
})

test('task composer uploads FILES: a PDF stages as a file tile and pins to the saved task', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))

  await login(page)
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `s86 files ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })

  // The picker's accept list carries the doc extensions; the button says "Upload files".
  await page.click('[data-pd-add="idea"]')
  const accept = await page.locator('#pd-taskadd-shots').getAttribute('accept')
  expect(accept).toContain('.pdf')
  expect(accept).toContain('.xlsx')
  expect(accept).toContain('.docx')
  const modal = page.locator('#pd-taskadd-modal, dialog[open]').first()
  await expect(modal).toBeVisible()
  await expect(page.locator('button', { hasText: 'Upload files' }).first()).toBeVisible()

  // A real PDF file through the composer's picker.
  const PDF = Buffer.from('%PDF-1.4\n%% e2e s86 doc\n')
  await page.setInputFiles('#pd-taskadd-shots', { name: 'wishlist-books.pdf', mimeType: 'application/pdf', buffer: PDF })

  // The staged tile is a FILE tile (ext badge + name), not an <img>.
  const staged = page.locator('#pd-taskadd-shots-grid .shot-card').first()
  await expect(staged).toBeVisible({ timeout: 8_000 })
  await expect(staged).toHaveClass(/is-file/)
  await expect(staged.locator('.shot-file-ext')).toHaveText('PDF')
  await expect(staged.locator('.shot-file-name')).toContainText('wishlist-books.pdf')
  await expect(staged.locator('img')).toHaveCount(0)

  // Save the task with the file attached — the pin badge appears on the card.
  await page.fill('#pd-taskadd-title-input', 's86 task with a pdf')
  await page.click('#pd-taskadd-save')
  const card = page.locator('.pd-task-wrap', { hasText: 's86 task with a pdf' }).first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card.locator('.pd-task-shots')).toBeVisible()

  // The pinned-files dialog renders the same file tile.
  await card.locator('.pd-task-shots').click()
  const dlg = page.locator('dialog[open]', { hasText: 's86 task with a pdf' }).last()
  const tshots = page.locator('dialog[open] .shot-file').first()
  await expect(tshots).toBeVisible({ timeout: 8_000 })
  await expect(tshots.locator('.shot-file-name')).toContainText('wishlist-books.pdf')
  expect(errors).toEqual([])
})
