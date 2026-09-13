// e2e/sprint-doc.spec.ts — S33 (user request 2026-09-13): the «اسپرینت جدید» flow.
//   1. The CTA button renders on the project board head («اسپرینت جدید» / "New sprint").
//   2. Click → the modal with name + version + description; create POSTs a draft.
//   3. The created view's «ورود به اسپرینت» button opens the FULL-SCREEN editor.
//   4. The rich-text toolbar works (code block fences, bold, list) + the live preview
//      renders the markdown (headings, code island with the language label).
//   5. AUTOSAVE: the typed doc lands on the sprint (server-verified) — and RELOADING
//      via the deep link (?sprint=) reopens the editor with the same doc.
//   6. Second CTA open → edit-draft mode (prefilled + «به‌روزرسانی پیش‌نویس» label).
// Run: npx playwright test e2e/sprint-doc.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-sd@test.local'
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
     VALUES ('${id}', 'e2e-sd', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(300)
}

const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
]
const trackErrors = (page: Page) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })
  return errors
}

async function seedProject(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e sprint doc ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
}

test('«اسپرینت جدید» CTA → modal → enter → full-screen editor with code blocks + autosave', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page)
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })

  // 1 — the CTA renders (EN locale here; the FA label is pinned by the locale guard)
  const cta = page.locator('[data-pd-new-sprint]')
  await expect(cta).toBeVisible()
  await expect(cta).toContainText('New sprint')

  // 2 — the modal: name + version + description
  await cta.click()
  const modal = page.locator('#pd-sprintnew-modal')
  await expect(modal).toBeVisible()
  await page.fill('#pd-sprintnew-name', 'Payments flow')
  await page.fill('#pd-sprintnew-version', '12.1')
  await page.fill('#pd-sprintnew-desc', 'Checkout rebuild.')
  await page.click('#pd-sprintnew-save')
  // the created view: sprint name + the ENTER button
  await expect(page.locator('#pd-sprintnew-done')).toBeVisible()
  await expect(page.locator('#pd-sprintnew-done-name')).toContainText('Payments flow')
  await expect(page.locator('#pd-sprintnew-done-name')).toContainText('12.1')

  // 3 — «Enter sprint» opens the FULL-SCREEN editor
  await page.click('#pd-sprintnew-enter')
  const editor = page.locator('#pd-sprintdoc-modal')
  await expect(editor).toBeVisible()
  await expect(page.locator('#pd-sd-title')).toContainText('Payments flow')
  await expect(page.locator('#pd-sd-ver')).toContainText('12.1')
  // full-bleed: the dialog box fills the viewport
  const box = await editor.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(1200) // 100vw on the default 1280 viewport
  expect(box!.height).toBeGreaterThan(650) // ~100vh
  // the modal's description seeded the editor
  await expect(page.locator('#pd-sd-text')).toHaveValue('Checkout rebuild.')

  // 4 — the rich-text toolbar: code block + heading + list, then the LIVE PREVIEW
  const ta = page.locator('#pd-sd-text')
  await ta.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await ta.fill('## Sprint goal\nShip it.')
  // the Code button drops a ``` fence pair and parks the caret inside
  await page.click('[data-sb="code"]')
  await page.keyboard.type('const price = 42;')
  await page.click('[data-sb="bold"]') // empty selection → caret pair (no crash)
  // preview tab: the markdown renders — heading, code island with the label
  await page.click('#pd-sd-tab-preview')
  const preview = page.locator('#pd-sd-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('h2')).toContainText('Sprint goal')
  await expect(preview.locator('code.t-code')).toBeVisible()
  const codeText = await preview.locator('code.t-code').textContent()
  expect(codeText).toContain('const price = 42;')

  // 5 — AUTOSAVE: back to write, edit, wait for the debounced PATCH to land
  await page.click('#pd-sd-tab-write')
  await ta.focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('final line')
  await expect(page.locator('#pd-sd-status')).toContainText('Saved', { timeout: 8_000 })
  const doc = await page.evaluate(async (projectId) => {
    const body = await (await fetch(`/api/projects/${projectId}`)).json()
    const s = (body.project.sprints as { name: string; version: string | null; description: string | null; is_draft: number }[])[0]
    return { name: s.name, version: s.version, description: s.description, isDraft: s.is_draft }
  }, pid)
  expect(doc.name).toBe('Payments flow')
  expect(doc.version).toBe('12.1')
  expect(doc.isDraft).toBe(1) // born a draft — the 0034 rule survived 0052
  expect(doc.description).toContain('## Sprint goal')
  expect(doc.description).toContain('```')
  expect(doc.description).toContain('const price = 42;')
  expect(doc.description).toContain('final line')

  // close via Done (flush + close)
  await page.click('#pd-sd-done')
  await expect(editor).toBeHidden()

  // 6 — the deep link (?sprint=) reopens the editor with the SAME doc
  await page.goto(`/project.html?id=${pid}&sprint=nope`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  // unknown sprint id → toast, no editor
  await expect(editor).toBeHidden({ timeout: 4_000 })
  const sid = await page.evaluate(async (projectId) => {
    const body = await (await fetch(`/api/projects/${projectId}`)).json()
    return (body.project.sprints as { id: string }[])[0].id
  }, pid)
  await page.goto(`/project.html?id=${pid}&sprint=${sid}`)
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#pd-sd-text')).toHaveValue(/final line/, { timeout: 10_000 })
  await page.click('#pd-sd-done')
  await expect(editor).toBeHidden()

  // 7 — re-opening the CTA lands in EDIT-draft mode: prefilled + Update label
  await cta.click()
  await expect(modal).toBeVisible()
  await expect(page.locator('#pd-sprintnew-name')).toHaveValue('Payments flow')
  await expect(page.locator('#pd-sprintnew-version')).toHaveValue('12.1')
  await expect(page.locator('#pd-sprintnew-save-label')).toContainText('Update draft')
  await page.click('#pd-sprintnew-cancel')
  expect(errors).toEqual([])
})
