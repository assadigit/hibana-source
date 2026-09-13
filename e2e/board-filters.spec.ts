// e2e/board-filters.spec.ts — S30 batch 2 (user request 2026-09-12): the priority ×
// label FILTER BAR (board.html + the project page's board preview), the translated
// priority tooltips, click-the-dot priority cycling, and the problems-box composer's
// priority picker. Run: npx playwright test e2e/board-filters.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-bf@test.local'
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
     VALUES ('${id}', 'e2e-bf', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

type TaskBody = { title: string; status?: string; priority?: string; tags?: string[] }

async function seedProject(page: Page, tasks: TaskBody[]): Promise<string> {
  const id = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e filters ${Date.now()}` }),
    })
    return ((await res.json()) as { id: string }).id
  })
  for (const t of tasks) {
    await page.evaluate(async ({ pid, body }) => {
      await fetch(`/api/projects/${pid}/devtasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }, { pid: id, body: t })
  }
  return id
}

test('board: filter bar (priority × label), dot cycles priority, exports carry both', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, [
    { title: 'urgent auth leak', status: 'in_progress', priority: 'urgent', tags: ['Security'] },
    { title: 'medium thing', status: 'in_progress', priority: 'medium' },
    { title: 'low chore', status: 'idea', priority: 'low' },
  ])
  await page.goto(`/board.html?project=${pid}`)
  await expect(page.locator('[data-db-filter]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.db-card')).toHaveCount(3)

  // the bar: 4 priority toggles + the label toggle(s) from the seeded tags
  await expect(page.locator('[data-db-filter] [data-fp]')).toHaveCount(4)
  const labelToggles = page.locator('[data-db-filter] [data-ft]')
  await expect(labelToggles).toHaveCount(1)
  await expect(labelToggles.first()).toContainText('Security')

  // S31 (user request: "unbold this text chips… without red background"): the filter
  // toggles read at weight 400 on a plain card background — the global button rule's
  // 600 was bolding them, and nothing paints them red.
  const urgentToggle = page.locator('[data-db-filter] [data-fp="urgent"]')
  await expect(urgentToggle).toHaveCSS('font-weight', '400')
  await expect(urgentToggle).toHaveCSS('background-color', /rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)/)
  // and the urgent dot is the beeping red light (double-beat keyframes, reduced-motion off in headless)
  await expect(urgentToggle.locator('.prio-dot')).toHaveCSS('animation-name', 'prio-beep')
  // S31b (user report: "the text is latin but showing RTL"): card titles resolve
  // per-paragraph direction from their own first strong character — the English
  // seeded titles read LTR inside the FA/RTL page instead of a right-aligned
  // ragged-left RTL paragraph with flipped punctuation.
  await expect(page.locator('.db-card-title').first()).toHaveCSS('unicode-bidi', 'plaintext')

  // S32 (user request: "decrease the size of this chips — a little too big"): the
  // filter toggles read compact — 26px min-block-size (was the 40px touch floor)
  // at xs font; and the GENERAL bidi law covers the chips themselves (a Latin
  // label like "Security" resolves LTR inside the FA page, a Farsi one stays RTL).
  expect(await urgentToggle.boundingBox()).not.toBeNull()
  expect((await urgentToggle.boundingBox())!.height).toBeLessThanOrEqual(30)
  await expect(urgentToggle).toHaveCSS('min-height', '26px')
  await expect(labelToggles.first()).toHaveCSS('unicode-bidi', 'plaintext')
  // the card's label chips follow the law too (S32)
  await expect(page.locator('.db-card .db-mini-chip').first()).toHaveCSS('unicode-bidi', 'plaintext')

  // priority filter: urgent only → one card; the column counts follow
  await page.click('[data-db-filter] [data-fp="urgent"]')
  await expect(page.locator('.db-card')).toHaveCount(1)
  await expect(page.locator('.db-card-title')).toContainText('urgent auth leak')
  await expect(page.locator('.db-filter-shown')).toContainText('1 of 3')

  // label filter ANDs with the priority filter → zero cards (the medium task has no label)
  await page.click('[data-db-filter] [data-ft]')
  await expect(page.locator('.db-card')).toHaveCount(1) // urgent auth leak IS labeled Security

  // clear → all three back
  await page.click('[data-db-filter-clear]')
  await expect(page.locator('.db-card')).toHaveCount(3)

  // the dot: TRANSLATED tooltip + click cycles (low → medium), persisted
  const chore = page.locator('.db-card', { hasText: 'low chore' })
  const choreDot = chore.locator('[data-db-cycle-prio]')
  await expect(choreDot).toHaveAttribute('title', /Priority: Low — click to change/i)
  await choreDot.click()
  await expect(chore.locator('.prio-dot')).toHaveClass(/prio-medium/)
  await page.reload()
  await expect(page.locator('[data-db-filter]')).toBeVisible({ timeout: 10_000 })
  const choreReloaded = page.locator('.db-card', { hasText: 'low chore' })
  await expect(choreReloaded.locator('.prio-dot')).toHaveClass(/prio-medium/)

  // the card's label chip is a filter toggle (GitHub behavior)
  await page.locator('.db-card .db-mini-chip').first().click()
  await expect(page.locator('.db-card')).toHaveCount(1)
  await page.click('[data-db-filter-clear]')

  // MD copy carries priority + labels — stub the clipboard, click Quick Copy on the
  // in_progress column, read the written text
  await page.evaluate(() => {
    window.__mdCopied = null
    navigator.clipboard.writeText = (t) => { (window as unknown as { __mdCopied: string }).__mdCopied = t; return Promise.resolve() }
  })
  await page.click('[data-db-copy="in_progress"]')
  const copied = await page.evaluate(() => (window as unknown as { __mdCopied: string | null }).__mdCopied)
  expect(copied).toContain('- [URGENT] urgent auth leak #Security')
  expect(copied).toContain('- [MEDIUM] medium thing')
  expect(errors).toEqual([])
})

test('project page: filter bar on the preview + problems composer priority picker', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, [
    { title: 'urgent labeled one', status: 'in_progress', priority: 'urgent', tags: ['UI/UX'] },
    { title: 'low other', status: 'in_progress', priority: 'low' },
  ])
  await page.goto(`/project.html?id=${pid}`)
  await expect(page.locator('#pd-title')).toBeVisible({ timeout: 10_000 })
  // the bar builds from the afterSwap (the body arrives via htmx)
  await expect(page.locator('[data-pd-filter] [data-fp]')).toHaveCount(4, { timeout: 10_000 })
  await expect(page.locator('[data-pd-filter] [data-ft]')).toHaveCount(1)
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2)

  // S32: the project page's twin bar carries the same compact chips (26px floor)
  const pdChipBox = await page.locator('[data-pd-filter] [data-fp="urgent"]').boundingBox()
  expect(pdChipBox).not.toBeNull()
  expect(pdChipBox!.height).toBeLessThanOrEqual(30)

  // urgent filter hides the low card in place
  await page.click('[data-pd-filter] [data-fp="urgent"]')
  await expect(page.locator('.pd-task-wrap[data-pd-priority="low"]')).toBeHidden()
  await expect(page.locator('.pd-task-wrap[data-pd-priority="urgent"]')).toBeVisible()
  await expect(page.locator('[data-pd-filter-shown]')).toContainText('1 of 2')
  await page.click('[data-pd-filter-clear]')
  await expect(page.locator('.pd-task-wrap[data-pd-priority="low"]')).toBeVisible()

  // the dot cycles WITHOUT opening the editor (urgent → low, then the wrap re-sorts)
  const urgent = page.locator('.pd-task-wrap[data-pd-priority="urgent"]')
  await urgent.locator('[data-pd-cycle-prio]').click()
  await expect(page.locator('#pd-task-edit-modal')).toBeHidden() // no editor opened
  await expect(page.locator('.pd-task-wrap[data-pd-priority="urgent"]')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-pd-filter] [data-fp]')).toHaveCount(4, { timeout: 10_000 })
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2) // persisted: no urgent left

  // problems composer: the picker rides the batch (urgent chosen → the bug lands urgent)
  await page.click('[data-detail-tab="problems"]')
  const composer = page.locator('[data-problem-add]')
  await expect(composer.locator('select[name=priority]')).toHaveValue('medium')
  await composer.locator('select[name=priority]').selectOption('urgent')
  await composer.locator('textarea[name=text]').fill('bulk bug one')
  await composer.locator('button[type=submit]').click()
  await expect(page.locator('#problems li')).toHaveCount(1)
  const bugPrio = await page.evaluate(async (projectId) => {
    const body = await (await fetch(`/api/projects/${projectId}`)).json()
    return (body.project.devTasks as { title: string; priority: string }[]).find((t) => t.title === 'bulk bug one')?.priority
  }, pid)
  expect(bugPrio).toBe('urgent')
  expect(errors).toEqual([])
})
