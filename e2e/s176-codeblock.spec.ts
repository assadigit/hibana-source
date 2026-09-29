// e2e/s176-codeblock.spec.ts — the S176 round: (1) the composer's code block is ONE
// container (no box-in-a-box) with the dark panel, the header bar (language dropdown +
// copy button), plain-text paste, Tab=2-spaces, the format-toolbar disabling while the
// caret is inside, highlight.js auto-detect + the 5-token palette, and the PLAIN-TEXT
// storage round-trip (the fence never carries the span markup); (2) the folded progress
// box is a VERTICAL RAIL (the owner's sketch): ~40px wide, the title rotated
// bottom→top, the chevron on top, the count at the foot — the remaining boxes get the
// freed width back. Run: npx playwright test e2e/s176-codeblock.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s176@test.local'
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
     VALUES ('${id}', 'e2e-s176', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

async function openProject(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e s176 ${Date.now()}`, status: 'developing' }),
    })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  return id
}

const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
  /Failed to load resource.*400/,
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

// ── S176: the code block — one container, the bar, the behaviors ──────────────────
test('code block: ONE container + dark panel; Tab=2 spaces; plain-text paste; toolbar disables inside; copy button; save round-trip', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const id = await openProject(page)
  // the copy-button verification reads the real clipboard
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.click('[data-pd-add="idea"]')
  const dlg = page.locator('#pd-taskadd-modal')
  await expect(dlg).toBeVisible()
  await page.fill('#pd-taskadd-title-input', 'e2e s176 code block')

  const area = page.locator('#pd-taskadd-textarea')
  await area.click()
  await page.click('[data-tb="code"]')
  await page.waitForTimeout(150)

  // (1) ONE container: pre.t-code-pre wraps the non-editable bar + ONE code element —
  // no box-in-a-box (the pre carries the surface, the code carries only typography).
  const pre = area.locator('pre.t-code-pre')
  await expect(pre).toHaveCount(1)
  await expect(pre.locator('> code.t-code')).toHaveCount(1)
  await expect(pre.locator('.t-code-bar')).toHaveCount(1)
  await expect(pre.locator('.t-code-bar')).toHaveAttribute('contenteditable', 'false')
  await expect(pre.locator('[data-code-lang]')).toHaveCount(1)
  const copyBtn = pre.locator('[data-code-copy]')
  await expect(copyBtn).toHaveCount(1)
  await expect(copyBtn).toHaveAttribute('aria-label', 'Copy code')
  await expect(copyBtn).toHaveAttribute('data-tip', 'Copied')

  // the geometry: the PRE owns the panel surface (the dark token), the CODE inside is
  // transparent — exactly one visible box.
  await expect(pre).toHaveCSS('background-color', 'rgb(45, 42, 38)')
  await expect(pre.locator('> code.t-code')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(pre.locator('> code.t-code')).toHaveCSS('border-top-width', '0px')
  await expect(pre.locator('> code.t-code')).toHaveCSS('font-family', /ui-monospace|monospace/)
  await expect(pre.locator('> code.t-code')).toHaveCSS('white-space', 'pre')
  await expect(pre.locator('> code.t-code')).toHaveCSS('direction', 'ltr')
  // the panel contrasts the editor surface (light theme --bg) — a dark box on a light field
  const preBg = await pre.evaluate((el) => getComputedStyle(el).backgroundColor)
  const areaBg = await area.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(preBg).not.toBe(areaBg)

  // (2) Tab inserts TWO spaces (white-space:pre preserves them) — never moves focus.
  await page.keyboard.press('Tab')
  await page.keyboard.type('const greeting = "hello"')
  const codeEl = pre.locator('> code.t-code')
  await expect(codeEl).toContainText('  const greeting = "hello"')

  // (3) the debounce fires: hljs lazy-loads, auto-detects JavaScript, paints the
  // five-token palette (keyword + string spans appear; the label flips off "Auto").
  await expect(page.locator('.t-code-pre .hljs-keyword').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.t-code-pre .hljs-string').first()).toBeVisible()
  await expect(pre.locator('[data-code-lang]')).toHaveValue('javascript', { timeout: 10_000 })
  // the detected language rides the container (the fence will save it)
  await expect(pre).toHaveAttribute('data-lang', 'javascript')

  // (4) PLAIN-TEXT paste: a clipboard carrying BOTH html (bold) + text lands as text
  // only — no <b>/<span style> ever enters the block; line breaks + indentation stay.
  await page.evaluate(() => {
    const target = document.querySelector('#pd-taskadd-textarea pre.t-code-pre code') as HTMLElement | null
    if (!target) return
    const sel = window.getSelection()
    const r = document.createRange()
    r.selectNodeContents(target)
    r.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(r)
    target.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: (function () {
        const dt = new DataTransfer()
        dt.setData('text/html', '<b>bold line</b><div><i>styled</i></div>')
        dt.setData('text/plain', 'bold line\n  indented second')
        return dt
      })(),
    }))
  })
  await expect(codeEl).toContainText('bold line')
  await expect(codeEl).toContainText('indented second')
  expect(await codeEl.locator('b, i, [style]').count()).toBe(0)
  // the paste re-ran the highlight (immediately) — the pasted string is tokenized too
  await expect(codeEl.locator('.hljs-string').first()).toBeVisible({ timeout: 10_000 })

  // (5) the format toolbar DISABLES while the caret is inside the block (the "<>"
  // toggle itself stays active); ArrowDown at the block's end hops out and re-enables.
  await expect(page.locator('#pd-taskadd-modal [data-tb="bold"]')).toBeDisabled()
  await expect(page.locator('#pd-taskadd-modal [data-tb="underline"]')).toBeDisabled()
  await expect(page.locator('#pd-taskadd-modal [data-tb="align-left"]')).toBeDisabled()
  await expect(page.locator('#pd-taskadd-modal [data-tb="code"]')).toBeEnabled()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.type('after code')
  await expect(page.locator('#pd-taskadd-modal [data-tb="bold"]')).toBeEnabled()

  // (6) the copy button: PLAIN TEXT only (the token spans never ride along), the icon
  // swaps to the check + the tooltip shows for ~2s.
  await copyBtn.click()
  await expect(copyBtn).toHaveClass(/copied/)
  await expect(copyBtn.locator('.i-check')).toBeVisible()
  await expect(copyBtn.locator('.i-copy')).toBeHidden()
  await page.waitForTimeout(2300)
  await expect(copyBtn).not.toHaveClass(/copied/)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('const greeting = "hello"')
  expect(clip).toContain('bold line')
  expect(clip).toContain('indented second')

  // (7) the language dropdown: an explicit choice repaints + persists on the container.
  await pre.locator('[data-code-lang]').selectOption('python')
  await expect(pre).toHaveAttribute('data-lang', 'python', { timeout: 5_000 })

  // (8) SAVE round-trip: the stored markdown fence keeps the code + the language and
  // NEVER the highlight markup; re-editing upgrades it back to the one-container block.
  await page.click('#pd-taskadd-save')
  await expect(dlg).not.toBeVisible()
  const card = page.locator('.pd-task-wrap', { hasText: 'e2e s176 code block' })
  await expect(card).toBeVisible({ timeout: 10_000 })
  const raw = await card.locator('.pd-task-title').getAttribute('data-raw-title')
  expect(raw).toContain('```python')
  expect(raw).toContain('const greeting = "hello"')
  expect(raw).toContain('  indented second')
  expect(raw).not.toContain('hljs-')
  expect(raw).not.toContain('<span')
  // the editor re-opens on the upgraded block (normalize) with the language kept
  await card.hover()
  await card.locator('[data-menu-open]').click()
  await card.locator('[data-pd-task-edit]').click()
  const editDlg = page.locator('#pd-task-edit-modal')
  await expect(editDlg).toBeVisible()
  const editPre = page.locator('#pde-input pre.t-code-pre')
  await expect(editPre).toHaveCount(1)
  await expect(editPre.locator('> code.t-code')).toContainText('const greeting = "hello"')
  await expect(editPre).toHaveAttribute('data-lang', 'python')
  // the normalize wakes the highlighter — the reloaded block paints its tokens too
  await expect(editPre.locator('.hljs-string').first()).toBeVisible({ timeout: 10_000 })
  // no fence markers or bar chrome ever leak into the visible code
  const codeText = await editPre.locator('> code.t-code').innerText()
  expect(codeText).not.toContain('```')
  expect(codeText).not.toContain('Copy code')
  expect(codeText).not.toContain('Python')

  expect(errors).toEqual([])
})

// ── S176: the folded box is a VERTICAL RAIL (the owner's sketch) ──────────────────
test('the folded progress box is a vertical rail: ~40px wide, rotated title, chevron on top, count at the foot, width freed for the others', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const id = await openProject(page)

  // seed two tasks so the board renders with real columns
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/devtasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'rail task', status: 'idea' }),
    })
    await fetch(`/api/projects/${pid}/devtasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'rail task 2', status: 'planned' }),
    })
  }, id)
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })

  const ideaCol = page.locator('#pd-col-idea')
  const inprogCol = page.locator('#pd-col-in_progress')
  const before = await inprogCol.boundingBox()

  // fold the Ideas box → the rail
  await ideaCol.locator('[data-pd-col-collapse]').click()
  await expect(ideaCol).toHaveAttribute('data-collapsed', '')
  // the rail shape: ~40px wide (2.5rem), tall (min 9rem), the title rotated
  // bottom→top, the chevron docked on top, the count pinned at the foot.
  await expect(ideaCol).toHaveCSS('inline-size', '40px')
  const railBox = await ideaCol.boundingBox()
  expect((railBox as { width: number }).width).toBeLessThanOrEqual(44)
  expect((railBox as { height: number }).height).toBeGreaterThanOrEqual(144)
  await expect(ideaCol.locator('.pd-col-title')).toHaveCSS('writing-mode', 'vertical-rl')
  await expect(ideaCol.locator('.pd-col-title')).toHaveCSS('transform', /matrix\(/) // the 180° flip
  // contents stay hidden (the fold contract)
  await expect(ideaCol.locator('.pd-tasks')).toBeHidden()
  await expect(ideaCol.locator('.pd-task-add')).toBeHidden()
  // the count badge still shows (pinned to the rail's foot)
  await expect(ideaCol.locator('.detail-tab-count')).toBeVisible()

  // the remaining boxes grew into the freed width (the owner's whole point): the
  // rail keeps ~40px, the freed ~3/4 of the old share spreads over the rest
  const after = await inprogCol.boundingBox()
  expect((after as { width: number }).width - (before as { width: number }).width).toBeGreaterThanOrEqual(30)

  // unfold → the box returns to its share + horizontal title
  await ideaCol.locator('[data-pd-col-collapse]').click()
  await expect(ideaCol).not.toHaveAttribute('data-collapsed')
  await expect(ideaCol.locator('.pd-col-title')).toHaveCSS('writing-mode', 'horizontal-tb')
  const restored = await inprogCol.boundingBox()
  expect(Math.abs((restored as { width: number }).width - (before as { width: number }).width)).toBeLessThanOrEqual(2)

  expect(errors).toEqual([])
})
