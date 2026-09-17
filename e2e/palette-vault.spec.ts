// e2e/palette-vault.spec.ts — S62: the Notes Vault surfaces in the global palette.
//
// The 0040 search-depth matrix never learned about the Notes Vault (0057 shipped
// after it) — Ctrl+K could find everything EXCEPT long-form notes. This pins the
// vault group end-to-end: the deep link opens the note, the matched substring is
// highlighted (<mark class="cmdk-mark">), FA localizes the group header and the
// word count, and the kebab's Copy as Markdown puts the export body on the clipboard.
// Run: npx playwright test e2e/palette-vault.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-cmdk-vault@test.local'
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
     VALUES ('${id}', 'e2e-cmdk-vault', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // Wait for the SW to take control BEFORE touching the palette — the controllerchange
  // reload otherwise lands mid-test and destroys the open dialog (palette-entry.spec.ts
  // pins the same guard; the "navigated to /app" mid-wait failure is this exact race).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// Creates a vault note through the app's own API and returns its id.
async function mkNote(page: Page, title: string, content: string, folderId: string | null = null): Promise<string> {
  const res = await page.evaluate(async ({ title, content, folderId }) => {
    const r = await fetch('/api/vault/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, folderId }),
    })
    if (!r.ok) throw new Error('note create failed: ' + r.status)
    return ((await r.json()) as { note: { id: string } }).note.id
  }, { title, content, folderId })
  return res
}

test.describe('S62: vault notes in the command palette', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('a vault note surfaces, deep-links into the editor, and the match is highlighted', async ({ page }) => {
    const id = await mkNote(page, 'Zephyr coffee roast log', 'light roast, 12g, 200ml, 93C — bright and clean')
    try {
      await page.keyboard.press('Control+k')
      const dlg = page.locator('#cmdk-dialog')
      await expect(dlg).toBeVisible()
      await page.fill('#cmdk-input', 'zephyr')

      // The Vault group renders with its padlock icon + the matched label.
      const row = dlg.locator('.cmdk-item', { hasText: 'Zephyr coffee roast log' })
      await expect(row).toBeVisible({ timeout: 8_000 })
      await expect(dlg.locator('.cmdk-group-label', { hasText: 'Vault' })).toBeVisible()

      // S62 highlight: the eye sees WHY the row matched.
      await expect(row.locator('mark.cmdk-mark')).toHaveText('Zephyr')

      // Activate → the vault editor opens the note (its own #n= deep-link format).
      await row.click()
      await page.waitForURL(`**/notes.html#n=${id}`, { timeout: 10_000 })
      await expect(page.locator('[data-vault-title]')).toHaveValue('Zephyr coffee roast log')
      await expect(page.locator('[data-vault-src]')).toHaveValue(/light roast/)
    } finally {
      await page.evaluate(async (nid) => {
        await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
        await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
      }, id)
    }
  })

  test('FA: group header خزانه + Persian digits in the word count', async ({ page }) => {
    // FA through the app's own settings API (the More-sheet toggle's path).
    await page.evaluate(async () => {
      await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language_pref: 'fa' }) })
    })
    await page.goto('/app')
    await page.waitForTimeout(600)

    const id = await mkNote(page, 'گزارش جلسهٔ دایر', 'متن جلسه با چند کلمه برای شمارش')
    try {
      await page.keyboard.press('Control+k')
      await page.fill('#cmdk-input', 'جلسه')
      const dlg = page.locator('#cmdk-dialog')
      await expect(dlg.locator('.cmdk-group-label', { hasText: 'خزانه' })).toBeVisible({ timeout: 8_000 })

      // Highlight works for Persian text too (code-point exact matching).
      const row = dlg.locator('.cmdk-item', { hasText: 'گزارش جلسهٔ دایر' })
      await expect(row.locator('mark.cmdk-mark')).toHaveText('جلسه')

      await row.click()
      await page.waitForURL(`**/notes.html#n=${id}`, { timeout: 10_000 })
      // The word count localizes its digits (۱۲۳, not 123).
      await expect(page.locator('[data-vault-words]')).toContainText(/[۰-۹]/)
      await expect(page.locator('[data-vault-words]')).not.toContainText(/\d/)

      // Restore EN for the shared account state.
      await page.evaluate(async () => {
        await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language_pref: 'en' }) })
      })
    } finally {
      await page.evaluate(async (nid) => {
        await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
        await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
      }, id)
    }
  })

  // Clipboard access needs granted permissions — Chromium honors these in headless.
  test.describe('clipboard', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

    test('kebab → Copy as Markdown puts the export body on the clipboard', async ({ page }) => {
      const id = await mkNote(page, 'Clipboard probe', 'the copyable body')
      try {
        await page.goto(`/notes.html#n=${id}`)
        await expect(page.locator('[data-vault-title]')).toHaveValue('Clipboard probe')

        await page.click('[data-vault-kebab]')
        const item = page.locator('.vault-pop-item', { hasText: 'Copy as Markdown' })
        await expect(item).toBeVisible()
        await item.click()

        await expect(page.locator('.toast', { hasText: 'Copied as Markdown' })).toBeVisible({ timeout: 5_000 })
        const clip = await page.evaluate(() => navigator.clipboard.readText())
        expect(clip).toBe('# Clipboard probe\n\nthe copyable body')
      } finally {
        await page.evaluate(async (nid) => {
          await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
          await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
        }, id)
      }
    })
  })
})

test.describe('S63: jump-to-match + reading time + menu arrows', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('palette hit deep-links with the query and flashes the body match', async ({ page }) => {
    // 240 filler words then the needle at the end — the jump must find it IN the body,
    // not just open the note. Desktop default mode is split (preview visible).
    const filler = Array.from({ length: 240 }, (_, i) => `word${i}`).join(' ')
    const content = filler + ' zanzibarneedle'
    const id = await mkNote(page, 'Jump probe', content)
    try {
      await page.keyboard.press('Control+k')
      await page.fill('#cmdk-input', 'zanzibarneedle')
      const dlg = page.locator('#cmdk-dialog')
      const row = dlg.locator('.cmdk-item', { hasText: 'Jump probe' })
      await expect(row).toBeVisible({ timeout: 8_000 })
      await row.click()

      // The deep link carries &q=; the vault page consumes it: the first body hit is
      // wrapped in the temporary flash mark.
      await page.waitForURL(`**/notes.html#n=${id}&q=zanzibarneedle`, { timeout: 10_000 })
      await expect(page.locator('[data-vault-title]')).toHaveValue('Jump probe')
      const mark = page.locator('mark.vault-jump')
      await expect(mark).toBeVisible({ timeout: 5_000 })
      await expect(mark).toHaveText('zanzibarneedle')

      // openNote's replaceState strips &q once consumed — a reload reopens clean.
      // (regex, not a glob: the glob `**/notes.html#n=<id>` inexplicably fails to match
      // the identical-looking URL — hash-in-glob matching quirk; the &q= waitForURL
      // above matched, this shape didn't. Regex is unambiguous.)
      await expect(page).toHaveURL(new RegExp('/notes\\.html#n=' + id + '$'))
    } finally {
      await page.evaluate(async (nid) => {
        await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
        await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
      }, id)
    }
  })

  test('long notes gain a reading-time estimate in the status row', async ({ page }) => {
    const content = Array.from({ length: 240 }, (_, i) => `w${i}`).join(' ')
    const id = await mkNote(page, 'Reading time probe', content)
    try {
      await page.goto(`/notes.html#n=${id}`)
      await expect(page.locator('[data-vault-words]')).toContainText('240 words')
      await expect(page.locator('[data-vault-words]')).toContainText('~1 min read')
    } finally {
      await page.evaluate(async (nid) => {
        await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
        await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
      }, id)
    }
  })

  test('the vault kebab menu walks with arrow keys', async ({ page }) => {
    const id = await mkNote(page, 'Menu arrows probe', 'x')
    try {
      await page.goto(`/notes.html#n=${id}`)
      await expect(page.locator('[data-vault-title]')).toHaveValue('Menu arrows probe')

      await page.click('[data-vault-kebab]')
      const items = page.locator('.vault-pop-item')
      await expect(items.nth(0)).toBeFocused() // openMenu focuses the first item

      await page.keyboard.press('ArrowDown')
      await expect(items.nth(1)).toBeFocused()
      await page.keyboard.press('End')
      await expect(items.last()).toBeFocused()
      const n = await items.count()
      await page.keyboard.press('ArrowUp')
      await expect(items.nth(n - 2)).toBeFocused()
      await page.keyboard.press('Home')
      await expect(items.nth(0)).toBeFocused()
    } finally {
      await page.evaluate(async (nid) => {
        await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
        await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
      }, id)
    }
  })
})

test.describe('S63: print — Ctrl+P prints the note, not the app', () => {
  test('print media hides chrome and shows the rendered markdown', async ({ page }) => {
    await login(page)
    const id = await mkNote(page, 'Print probe', '# Heading\n\nprintable body text')
    try {
      await page.goto(`/notes.html#n=${id}`)
      await expect(page.locator('[data-vault-title]')).toHaveValue('Print probe')
      await page.emulateMedia({ media: 'print' })
      // The app chrome and the vault's own navigation surfaces drop out…
      await expect(page.locator('.vault-tree')).toBeHidden()
      await expect(page.locator('.vault-list')).toBeHidden()
      await expect(page.locator('.vault-toolbar')).toBeHidden()
      await expect(page.locator('.topbar')).toBeHidden()
      // …and the printed form is the rendered markdown.
      await expect(page.locator('.vault-preview')).toBeVisible()
      await expect(page.locator('.vault-preview .markdown-body')).toContainText('printable body text')
    } finally {
      await page.evaluate(async (nid) => {
        await fetch(`/api/vault/notes/${nid}`, { method: 'DELETE' })
        await fetch(`/api/vault/notes/${nid}/purge`, { method: 'POST' })
      }, id)
    }
  })
})
