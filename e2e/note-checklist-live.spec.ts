// e2e/note-checklist-live.spec.ts — S84: the LIVE checklist in the editing surface.
// The owner's report: "Checkbox in note editor is added but it shows like a raw
// markdown like this [ ] instead, it should be a clickable and nicely checkbox."
// The pretty interactive boxes used to live ONLY in the preview pane — and edit mode
// is the mobile default, so the owner typed into a raw textarea and never saw them.
// This spec pins the overlay: pretty controls rendered EXACTLY over the raw markers
// in edit mode, click-to-toggle through the shared data-md-task delegation, the
// caret-reveal (Obsidian live-preview semantics), Enter list-continuation + the
// empty-task unwrap, and the mobile-default path (390px → edit mode, zero clicks).
// Run: npx playwright test e2e/note-checklist-live.spec.ts

import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-checklist@test.local'
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
     VALUES ('${id}', 'e2e-checklist', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // the user's notes from a previous run must not leak into this run's assertions
  try {
    db.exec(`DELETE FROM vault_notes WHERE user_id = '${id}'`)
  } catch { /* schema drift safety; the per-user flow re-asserts anyway */ }
  db.close()
})

const settleIn = async (page: import('@playwright/test').Page) => {
  await page.goto('/login.html')
  // let the SW settle HERE (install → claim → controllerchange reload) — the pattern
  // every multi-page spec uses so no controllerchange can fire mid-test
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

test('live checklist: pretty clickable boxes render OVER the raw markers in edit mode; click flips the source; caret reveals syntax; Enter continues/unwraps', async ({ page, browserName }) => {
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

  await settleIn(page)
  await page.goto('/notes.html')
  await expect(page.locator('.vault-tree')).toBeVisible()

  // fresh note with a mixed checklist (open, done, bare — the widened grammar) and a
  // trailing plain line so the caret-at-doc-end reveals nothing
  await page.click('[data-vault-new]')
  await expect(page.locator('[data-vault-title]')).toBeFocused()
  await page.fill('[data-vault-title]', 'E2E live checklist')
  await page.fill('[data-vault-src]', '- [ ] milk\n[ ] bare task\n- [x] eggs\nplain tail line')

  // force EDIT mode (desktop default is split — edit is the mode the owner lives in)
  await page.click('[data-vault-mode="edit"]')

  // THE overlay: three pretty controls, one per task line (bare included)
  await expect(page.locator('.md-live-check')).toHaveCount(3)
  await expect(page.locator('.md-live-check').first()).not.toHaveClass(/is-on/)
  await expect(page.locator('.md-live-check').nth(2)).toHaveClass(/is-on/)
  // the raw syntax is still the source of truth underneath
  await expect(page.locator('[data-vault-src]')).toHaveValue('- [ ] milk\n[ ] bare task\n- [x] eggs\nplain tail line')

  // position sanity: the first control sits INSIDE the textarea box, on the first
  // content line, at the line's start (over the `- [ ]` glyphs)
  await expect(async () => {
    const geo = await page.evaluate(() => {
      const ta = document.querySelector('[data-vault-src]')
      const btn = document.querySelector('.md-live-check')
      if (!(ta && btn)) return null
      const tr = ta.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      return { t: br.top - tr.top, l: br.left - tr.left, w: br.width, h: br.height }
    })
    expect(geo).toBeTruthy()
    expect(geo!.t).toBeGreaterThan(10) // below the textarea's top padding edge
    expect(geo!.t).toBeLessThan(50) // on the FIRST content line
    expect(geo!.l).toBeGreaterThan(10) // at the line's start (past the left padding)
    expect(geo!.l).toBeLessThan(80)
    expect(geo!.w).toBeGreaterThan(18) // covers the whole marker, not just the box
  }).toPass()

  // CLICK the first control → the SOURCE line flips (clickable, not decoration).
  // The caret is parked on the PLAIN tail line first (a focused caret on a task
  // line would lift that very cover — Obsidian live-preview semantics — and
  // hide the button under test); position 36 = start of "plain tail line"
  // ("- [ ] milk"=10 + \n, "[ ] bare task"=13 + \n, "- [x] eggs"=10 + \n → 36).
  // The length-neutral flip's selection preservation is pinned deterministically.
  await page.evaluate(() => {
    const ta = document.querySelector('[data-vault-src]') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(36, 36) // start of "plain tail line" — no cover lifted
  })
  await page.click('.md-live-check >> nth=0')
  await expect(page.locator('[data-vault-src]')).toHaveValue('- [x] milk\n[ ] bare task\n- [x] eggs\nplain tail line')
  await expect(page.locator('.md-live-check').first()).toHaveClass(/is-on/)
  // caret preservation: the flip is length-neutral, the selection survives
  await expect.poll(async () => page.evaluate(() => {
    const ta = document.querySelector('[data-vault-src]') as HTMLTextAreaElement | null
    return ta ? [ta.selectionStart, ta.selectionEnd] : null
  })).toEqual([36, 36])

  // autosave still rides the input pipeline (the overlay never bypassed it)
  await expect(page.locator('[data-vault-save][data-state="saved"]')).toBeVisible({ timeout: 6000 })

  // CARET REVEAL: put the caret on task line 1 → its cover lifts (raw syntax shows),
  // the OTHER tasks keep their pretty boxes
  await page.evaluate(() => {
    const ta = document.querySelector('[data-vault-src]') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(0, 0)
    ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
  })
  await expect(page.locator('.md-live-check').first()).toHaveClass(/is-raw/)
  await expect(page.locator('.md-live-check').nth(1)).not.toHaveClass(/is-raw/)
  await expect(page.locator('.md-live-check').nth(2)).not.toHaveClass(/is-raw/)
  // caret back at doc end (a PLAIN line) → every cover returns
  await page.evaluate(() => {
    const ta = document.querySelector('[data-vault-src]') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
    ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }))
  })
  await expect(page.locator('.md-live-check').first()).not.toHaveClass(/is-raw/)

  // ENTER CONTINUES the list: caret at the end of task line 1 ("- [x] milk" is 10
  // chars — position 10 is the line end; 11 would be line 2's start and native)
  // → a fresh task line is born and the caret lands in it
  await page.evaluate(() => {
    const ta = document.querySelector('[data-vault-src]') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(10, 10) // end of "- [x] milk"
  })
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-vault-src]')).toHaveValue('- [x] milk\n- [ ] \n[ ] bare task\n- [x] eggs\nplain tail line')
  // …and typing lands in the fresh task
  await page.keyboard.type('bread')
  await expect(page.locator('[data-vault-src]')).toHaveValue('- [x] milk\n- [ ] bread\n[ ] bare task\n- [x] eggs\nplain tail line')
  // FOUR pretty controls now (the born task included)
  await expect(page.locator('.md-live-check')).toHaveCount(4)

  // EMPTY-TASK UNWRAP: a task line with no text + Enter → the marker is removed
  await page.fill('[data-vault-src]', 'alpha\n\n- [ ]')
  await page.keyboard.press('Enter') // fill() leaves the caret at the doc end
  await expect(page.locator('[data-vault-src]')).toHaveValue('alpha\n\n\n')

  // the toolbar ☑ still round-trips through the same grammar (S83 path, now live)
  await page.fill('[data-vault-src]', 'just a plain line')
  await page.click('[data-vault-tb="check"]')
  await expect(page.locator('[data-vault-src]')).toHaveValue('- [ ] just a plain line')
  await expect(page.locator('.md-live-check')).toHaveCount(1)

  // READ mode: the textarea (and its overlay) hide; the preview's boxes take over
  await page.click('[data-vault-mode="read"]')
  await expect(page.locator('[data-vault-md-live]')).toBeHidden()
  await expect(page.locator('[data-vault-preview-body] li.md-task')).toHaveCount(1)

  // SPLIT mode: both surfaces live — preview boxes AND edit-surface controls
  await page.click('[data-vault-mode="split"]')
  await expect(page.locator('.md-live-check')).toHaveCount(1)
  await expect(page.locator('[data-vault-preview-body] li.md-task')).toHaveCount(1)

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
})

test('live checklist on the phone path: 390px defaults to edit mode — the boxes are there with zero mode clicks', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only for now')

  await page.setViewportSize({ width: 390, height: 844 })
  await settleIn(page)
  await page.goto('/notes.html')
  await expect(page.locator('.vault-tree')).toBeVisible()

  await page.click('[data-vault-new]')
  // the mobile editor slide-over opens on the new note
  await expect(page.locator('[data-vault-editor][data-open="true"]')).toBeVisible()
  await page.fill('[data-vault-title]', 'E2E phone checklist')
  await page.fill('[data-vault-src]', '- [ ] call ali\n- [x] ship it')

  // EDIT mode is the mobile default — the pretty controls must already be there
  await expect(page.locator('.vault-body[data-mode="edit"]')).toBeVisible()
  await expect(page.locator('.md-live-check')).toHaveCount(2)

  // tapping the box toggles the source line (the cover is a real touch target)
  await page.click('.md-live-check >> nth=0')
  await expect(page.locator('[data-vault-src]')).toHaveValue('- [x] call ali\n- [x] ship it')
  await expect(page.locator('.md-live-check').first()).toHaveClass(/is-on/)

  // cleanup: trash the note so later rounds start clean
  await page.click('[data-vault-kebab]')
  await page.click('.vault-pop-item:has-text("Move to Trash")')
  await expect(page.locator('#toast')).toContainText('Trash')
})
