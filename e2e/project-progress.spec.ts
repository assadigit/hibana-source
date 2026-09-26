// e2e/project-progress.spec.ts — the progress board E2E. S30 (2026-09-12): the
// manual progress box (slider + milestones + Auto/Manual + note — S29 agenda 5) was
// REMOVED at the user's request, so its spec went with it; progress is the computed
// read-only bar. What stays (and is pinned here): the task composer's PRIORITY dropdown
// (color-coded) + LABELS, the boxes' AUTO-SORT by priority, and the edit dialog's
// faithful priority pre-fill. Run: npx playwright test e2e/project-progress.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-pp@test.local'
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
     VALUES ('${id}', 'e2e-pp', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race (see viewport.spec.ts): settle before navigating.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

async function openProject(page: Page): Promise<string> {
  // seed a fresh project through the API (the page's own session does the POST)
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e progress ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${id}`)
  // S30: the manual progress box is gone — the project header's title is the
  // page-ready marker (always rendered + visible; the bar's fill span is 0-width and
  // the empty boxes collapse on a fresh project, so neither can serve as a marker).
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  return id
}

// 401s from /api/auth/me before login, the SW navigation probe's 404, and this spec's
// own deliberate 400 (PATCH progress_percent — pinning that the field is rejected) are
// expected.
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

// S30 (2026-09-12 — user request "remove the whole thing"): the manual progress box
// (slider, milestone chips, Auto/Manual toggle, note, timeline) is GONE. This spec pins
// the REMOVAL — no box, no handlers, no endpoints — plus the computed bar staying live.
test('progress box removed: no slider UI, PATCH progress_percent rejected, computed bar stays', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const id = await openProject(page)

  // The whole box is gone from the DOM — every S29 selector must match nothing.
  await expect(page.locator('[data-pd-progress]')).toHaveCount(0)
  await expect(page.locator('[data-pd-slider]')).toHaveCount(0)
  await expect(page.locator('[data-pd-milestone]')).toHaveCount(0)
  await expect(page.locator('[data-pd-auto]')).toHaveCount(0)
  await expect(page.locator('[data-pd-progress-log]')).toHaveCount(0)

  // The computed bar is alive: a single done task via the API → 100%.
  await page.evaluate(async (pid) => {
    await fetch(`/api/projects/${pid}/devtasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'only task', status: 'done', priority: 'low' }),
    })
  }, id)
  await page.goto(`/project.html?id=${id}`)
  // data-pd-bar is the bar's FILL span (inline-size style) — at 100% it is full width;
  // assert the style attribute directly (computed px would be resolution-dependent).
  await expect(page.locator('[data-pd-bar]')).toHaveAttribute('style', 'inline-size:100%', { timeout: 10_000 })
  await expect(page.locator('[data-pd-pct-sr]')).toHaveText('100%')

  // The override + timeline endpoints are closed: PATCH progress_percent → 400
  // (the schema dropped the field), GET /progress → 404 (the route is gone).
  const patch = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress_percent: 40, progress_note: 'x' }),
    })
    return res.status
  }, id)
  expect(patch).toBe(400)
  const gone = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/progress`)
    return res.status
  }, id)
  expect(gone).toBe(404)
  expect(errors).toEqual([])
})

// S29 follow-up (user request 2026-09-12 — "O1: richer progress box, part 2"): the task
// composer's PRIORITY dropdown (Urgent / High / Medium / Low, color-coded via the live
// chip), LABELS (UI/UX, Security…), the boxes' AUTO-SORT by priority, and the edit
// dialog's faithful priority pre-fill (the old editor always defaulted to medium).
test('task composer: priority dropdown + labels; boxes auto-sort by priority', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const id = await openProject(page)

  const ideaTasks = page.locator('[data-pd-tasks="idea"]')

  // Helper: open the composer on the idea box, type, pick a priority, add labels, save.
  const addTask = async (title: string, priority: string | null, labels?: string) => {
    await page.click('[data-pd-add="idea"]')
    const dlg = page.locator('#pd-taskadd-modal')
    await expect(dlg).toBeVisible()
    // the dropdown + labels input exist and are reset per open
    await expect(page.locator('#pd-taskadd-priority')).toHaveValue('medium')
    if (priority) await page.selectOption('#pd-taskadd-priority', priority)
    if (priority) {
      // the live color chip mirrors the selection
      await expect(page.locator('#pd-taskadd-prio-chip')).toHaveClass(/prio-/)
      await expect(page.locator('#pd-taskadd-prio-chip .prio-dot')).toHaveClass(new RegExp(`prio-${priority}`))
    }
    if (labels) await page.fill('#pd-taskadd-tags', labels)
    await page.fill('#pd-taskadd-textarea', title)
    await page.click('#pd-taskadd-save')
    await expect(dlg).not.toBeVisible()
  }

  // 1. a LOW task — the meta line carries the muted priority label
  await addTask('low one', 'low')
  await expect(ideaTasks.locator('.pd-task-wrap')).toHaveCount(1)
  await expect(ideaTasks.locator('.pd-task-wrap').first()).toHaveAttribute('data-pd-priority', 'low')
  await expect(ideaTasks.locator('.prio-banner-label').first()).toHaveText(/Low Priority/i)

  // 2. a MEDIUM task (the dropdown's default) lands AFTER the low card? No — it
  // OUTRANKS low, so it auto-sorts ABOVE it.
  await addTask('medium one', null)
  // 3. an URGENT task WITH LABELS — jumps to the top of the box
  await addTask('urgent labeled', 'urgent', 'UI/UX, Security')
  await expect(ideaTasks.locator('.pd-task-wrap')).toHaveCount(3)
  // the boxes AUTO-SORT: urgent → medium → low
  await expect.poll(async () =>
    (await ideaTasks.locator('.pd-task-wrap').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.pdPriority))).join(','),
  ).toBe('urgent,medium,low')
  // label chips ride the urgent card (server-assigned palette colors)
  const urgentCard = ideaTasks.locator('.pd-task-wrap').first()
  await expect(urgentCard.locator('.pd-tag[data-pd-tag-name="UI/UX"]')).toBeVisible()
  await expect(urgentCard.locator('.pd-tag[data-pd-tag-name="Security"]')).toBeVisible()
  // the urgent card's meta leads with the (red) Urgent label + tinted dot
  await expect(urgentCard.locator('.prio-banner-label')).toHaveText(/Urgent/i)

  // 4. RELOAD: the server renders the same priority-first order + the same chips
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  const reloaded = page.locator('[data-pd-tasks="idea"]')
  await expect(reloaded.locator('.pd-task-wrap')).toHaveCount(3)
  await expect.poll(async () =>
    (await reloaded.locator('.pd-task-wrap').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.pdPriority))).join(','),
  ).toBe('urgent,medium,low')
  await expect(reloaded.locator('.pd-task-wrap').first().locator('.pd-tag')).toHaveCount(2)

  // 5. EDIT round-trip: the low card's editor pre-fills its REAL priority (the old
  // editor always defaulted to medium and silently reset it on save) — then promote
  // it to Urgent and watch it jump above the medium card.
  // S149 contract: the card click opens the DETAIL SLIDE-OVER (the owner moved the
  // editor behind the ⋯ menu) — so the editor opens via ⋯ → Edit now.
  const lowWrap = reloaded.locator('.pd-task-wrap').nth(2)
  await lowWrap.locator('.pd-task').click()
  await expect(page.locator('#pd-detail-root')).toHaveClass(/open/) // the panel, not the editor
  await expect(page.locator('#pd-task-edit-modal')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await lowWrap.hover()
  await lowWrap.locator('[data-menu-open]').click()
  await lowWrap.locator('[data-pd-task-edit]').click()
  const edit = page.locator('#pd-task-edit-modal')
  await expect(edit).toBeVisible()
  await expect(page.locator('#pde-priority')).toHaveValue('low') // the REAL pre-fill
  // the labels input pre-fills from the card's datasets (empty here)
  await expect(page.locator('#pde-tags')).toHaveValue('')
  await page.selectOption('#pde-priority', 'urgent')
  await page.click('#pde-save')
  await expect(edit).not.toBeVisible()
  // auto-sort snaps the promoted card into the top tier (arrival order within it)
  await expect.poll(async () =>
    (await reloaded.locator('.pd-task-wrap').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.pdPriority))).join(','),
  ).toBe('urgent,urgent,medium')
  // and the priority PERSISTED (reload once more — the server is the source of truth)
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  const finalBox = page.locator('[data-pd-tasks="idea"]')
  await expect.poll(async () =>
    (await finalBox.locator('.pd-task-wrap').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.pdPriority))).join(','),
  ).toBe('urgent,urgent,medium')

  expect(errors).toEqual([])
})

// S82 (owner report: "click < > to write code, then you can't get OUT of the code
// container to type normal words"): the code-block escape gestures. Inside a
// toolbar-inserted <pre><code> block, plain Enter used to SUBMIT the composer (the
// quick-capture contract ran on every Enter) — the natural escape killed the dialog
// mid-thought, and arrows refused to hop the block boundary. Now:
//   · Enter inside the block = a newline (the modal must STAY OPEN)
//   · Enter on an EMPTY last line = exit the block (caret lands after it)
//   · ArrowDown at the block's end = hop out to the paragraph below
// This spec pins all three gestures + the saved round-trip keeping the fence.
test('code block: Enter newlines instead of submitting; empty-line Enter and ArrowDown escape the block', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const id = await openProject(page)

  await page.click('[data-pd-add="idea"]')
  const dlg = page.locator('#pd-taskadd-modal')
  await expect(dlg).toBeVisible()
  await page.fill('#pd-taskadd-title-input', 'e2e code escape')

  // click into the content area, insert a code block, type a line inside it
  const area = page.locator('#pd-taskadd-textarea')
  await area.click()
  await page.click('[data-tb="code"]')
  await page.waitForTimeout(150) // the caret placement is a setTimeout(0) after insertHTML
  await page.keyboard.type('const x = 1')

  // (1) Enter inside the block = NEWLINE, never a submit — the old bug: the dialog
  // closed here (the form submitted) and the typed code was lost mid-thought.
  await page.keyboard.press('Enter')
  await page.keyboard.type('const y = 2')
  await expect(dlg).toBeVisible() // still open — Enter was eaten by the block
  const codeEl = area.locator('pre code')
  await expect(codeEl).toHaveCount(1) // one block, not nested/fragmented

  // (2) ArrowDown at the block's end hops OUT — the caret lands in the paragraph
  // after it, so normal words are typeable again.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.type('after the block')
  // the code block's text is ONLY the code; the escaped words live in a sibling <p>
  await expect.poll(async () => area.locator('pre code').innerText()).toContain('const x = 1')
  const codeText = await area.locator('pre code').innerText()
  expect(codeText).not.toContain('after the block')
  expect(await area.locator('p', { hasText: 'after the block' }).count()).toBeGreaterThan(0)

  // (3) a SECOND code block + the empty-last-line Enter exit: Enter twice on a fresh
  // block (first = the empty new line, second = the slack-style exit gesture).
  await area.locator('p', { hasText: 'after the block' }).click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('End')
  await page.click('[data-tb="code"]')
  await page.waitForTimeout(150)
  await page.keyboard.type('exit me')
  await page.keyboard.press('Enter') // newline → now on an empty last line
  await page.keyboard.press('Enter') // the exit gesture → caret leaves the block
  await page.keyboard.type('tail words')
  await expect(area.locator('pre code')).toHaveCount(2)
  expect(await area.locator('pre code').nth(1).innerText()).toContain('exit me')
  expect(await area.locator('p', { hasText: 'tail words' }).count()).toBeGreaterThan(0)

  // (4) the SAVE round-trip keeps the code (S77's fence converter + these gestures):
  // saving with two blocks must persist both fences through htmlToMd → renderTitle.
  await page.click('#pd-taskadd-save')
  await expect(dlg).not.toBeVisible()
  await page.goto(`/project.html?id=${id}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  // the card shows the TITLE line only (S48j); the full title+content rides in
  // data-raw-title. Open the edit dialog — its #pde-input prefills via
  // renderTitle(contentMd), where the fences become .t-code islands.
  const card = page.locator('.pd-task-wrap', { hasText: 'e2e code escape' })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card.locator('.pd-task-title')).toHaveText(/e2e code escape/)
  // S149 contract: the card click opens the DETAIL SLIDE-OVER (and the panel itself
  // proves the renderTitle round-trip — the fence bodies render as .t-code islands
  // in the read-only content block); the EDITOR opens via ⋯ → Edit.
  await card.locator('.pd-task').click()
  await expect(page.locator('#pd-detail-root')).toHaveClass(/open/)
  await expect(page.locator('[data-pd-detail-content] .t-code').first()).toContainText('const x = 1')
  await page.keyboard.press('Escape')
  await expect(page.locator('#pd-detail-root')).not.toHaveClass(/open/)
  await card.hover()
  await card.locator('[data-menu-open]').click()
  await card.locator('[data-pd-task-edit]').click()
  const editDlg = page.locator('#pd-task-edit-modal')
  await expect(editDlg).toBeVisible()
  const editArea = page.locator('#pde-input')
  await expect(editArea.locator('.t-code').first()).toContainText('const x = 1')
  await expect(editArea.locator('.t-code').nth(1)).toContainText('exit me')
  // the escaped paragraphs survived the round-trip too (not swallowed by the fences)
  await expect(editArea).toContainText('after the block')
  await expect(editArea).toContainText('tail words')

  expect(errors).toEqual([])
})
