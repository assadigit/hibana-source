// e2e/s175-board-fold.spec.ts — S175 (owner round, two asks):
// 1) the Project Progress boxes (New Ideas / Problems / Plans / In Progress / Done)
//    FOLD: every column header gains a chevron; folding hides the box's contents and
//    shrinks it to a fit-content chip so the REMAINING boxes grow into the freed
//    width (the board row is a flex track now). The fold PERSISTS in the
//    'hibana-pd-cols-collapsed' localStorage store (the dashboard's collapse
//    contract) — a folded box stays folded across reloads until the owner unfolds
//    it; a #pd-col-<status> deep-link (the rail tree's leaves) auto-unfolds its
//    target, and a card DROPPED onto a folded box unfolds it and lands.
// 2) DONE items lose their priority coding: the banner in the Done box turns pale
//    + faded (container-scoped CSS — project page AND the fullscreen board, and it
//    follows cards as they move between boxes with no per-card state).
// Run: npx playwright test e2e/s175-board-fold.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s175@test.local'
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
  try { db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`) } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s175', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // Suppress the onboarding coachmarks (the tour backdrop intercepts pointer clicks).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

interface Seeded { pid: string; ideaId: string; doneId: string }

async function seedProject(page: Page): Promise<Seeded> {
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `e2e s175 fold ${Date.now()}`, status: 'developing' }),
    })
    return ((await res.json()) as { id: string }).id
  })
  const mk = async (title: string, status: string, priority: string) => {
    const tid = await page.evaluate(async ({ pid, title, status, priority }) => {
      const res = await fetch(`/api/projects/${pid}/devtasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, status, priority }),
      })
      return ((await res.json()) as { id: string }).id
    }, { pid, title, status, priority })
    return tid
  }
  const ideaId = await mk('s175 idea urgent card', 'idea', 'urgent')
  const doneId = await mk('s175 done urgent card', 'done', 'urgent')
  await mk('s175 done medium card', 'done', 'medium')
  await mk('s175 planned card', 'planned', 'medium')
  await mk('s175 inprog card', 'in_progress', 'high')
  return { pid, ideaId, doneId }
}

test('every progress box carries a fold chevron — folding hides contents, frees width for the others, and persists', async ({ page }) => {
  await login(page)
  const { pid } = await seedProject(page)
  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board .pd-task-title')

  // All five boxes ship OPEN with an expanded chevron.
  const cols = page.locator('#pd-board .pd-col[data-status]')
  await expect(cols).toHaveCount(5)
  for (const st of ['idea', 'bug', 'planned', 'in_progress', 'done']) {
    const chevron = page.locator(`#pd-col-${st} [data-pd-col-collapse]`)
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    await expect(chevron).toHaveAttribute('aria-controls', `pd-tasks-${st}`)
  }

  // Fold the New Ideas box.
  const before = await page.locator('#pd-col-in_progress').boundingBox()
  await page.locator('#pd-col-idea [data-pd-col-collapse]').click()
  const ideaCol = page.locator('#pd-col-idea')
  await expect(ideaCol).toHaveAttribute('data-collapsed', '')
  // contents + Add button + action cluster all hidden
  await expect(page.locator('#pd-tasks-idea')).toBeHidden()
  await expect(page.locator('#pd-col-idea > .pd-task-add')).toBeHidden()
  await expect(page.locator('#pd-col-idea .pd-col-actions')).toBeHidden()
  // chevron flips + AT state follows
  await expect(page.locator('#pd-col-idea [data-pd-col-collapse]')).toHaveAttribute('aria-expanded', 'false')
  const flip = await page.locator('#pd-col-idea [data-pd-col-collapse] .icon').evaluate((el) => getComputedStyle(el).transform)
  expect(flip).not.toBe('none')
  // the fold is persisted…
  expect(await page.evaluate(() => localStorage.getItem('hibana-pd-cols-collapsed'))).toBe('["idea"]')
  // …and the REMAINING boxes grew into the freed width
  const after = await page.locator('#pd-col-in_progress').boundingBox()
  expect(before).not.toBeNull(); expect(after).not.toBeNull()
  expect((after as { width: number }).width - (before as { width: number }).width).toBeGreaterThanOrEqual(10)

  // The fold SURVIVES a reload (the owner's "must remain collapsed" ask)…
  // (wait on a column that is never folded in this test — the first title in DOM
  // order lives in the folded Ideas box and is legitimately hidden)
  await page.reload()
  await page.waitForSelector('#pd-board .pd-col[data-status="planned"] .pd-task-title')
  await expect(page.locator('#pd-col-idea')).toHaveAttribute('data-collapsed', '')
  await expect(page.locator('#pd-tasks-idea')).toBeHidden()

  // …until the user unfolds it.
  await page.locator('#pd-col-idea [data-pd-col-collapse]').click()
  await expect(page.locator('#pd-col-idea')).not.toHaveAttribute('data-collapsed')
  await expect(page.locator('#pd-tasks-idea')).toBeVisible()
  await expect(page.locator('#pd-col-idea [data-pd-col-collapse]')).toHaveAttribute('aria-expanded', 'true')
  expect(await page.evaluate(() => localStorage.getItem('hibana-pd-cols-collapsed'))).toBe('[]')
})

test('a #pd-col-<status> deep-link auto-unfolds a folded target box (the rail tree never hits a wall)', async ({ page }) => {
  await login(page)
  const { pid } = await seedProject(page)
  // fold the Ideas box first…
  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board .pd-task-title')
  await page.locator('#pd-col-idea [data-pd-col-collapse]').click()
  await expect(page.locator('#pd-col-idea')).toHaveAttribute('data-collapsed', '')
  // …then arrive via the deep link (the rail tree's leaf)
  await page.goto(`/project.html?id=${pid}#pd-col-idea`)
  await page.waitForSelector('#pd-board .pd-task-title')
  await expect(page.locator('#pd-col-idea')).not.toHaveAttribute('data-collapsed')
  await expect(page.locator('#pd-tasks-idea')).toBeVisible()
  await expect(page.locator('#pd-col-idea')).toHaveClass(/q-arrived/)
  expect(await page.evaluate(() => localStorage.getItem('hibana-pd-cols-collapsed'))).toBe('[]')
})

test('done items lose their priority coding — the banner turns pale + faded on BOTH surfaces, and follows the card', async ({ page }) => {
  await login(page)
  const { pid, ideaId } = await seedProject(page)
  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board .pd-task-title')

  // The OPEN box's urgent banner: the saturated fill, full presence.
  const live = page.locator(`.pd-task-wrap[data-pd-task="${ideaId}"] .prio-banner`)
  await expect(live).toHaveCSS('background-color', 'rgb(191, 42, 30)')
  await expect(live).toHaveCSS('opacity', '1')

  // The DONE box's urgent banner: SAME priority, pale + faded (priority-agnostic).
  const doneBanner = page.locator('[data-pd-tasks="done"] .prio-banner').first()
  await expect(doneBanner).toHaveCSS('opacity', '0.7')
  const doneBg = await doneBanner.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(doneBg).not.toBe('rgb(191, 42, 30)')
  expect(doneBg).not.toBe('rgba(0, 0, 0, 0)')

  // The fullscreen board speaks the same language (one container-scoped rule).
  await page.goto(`/board.html?project=${pid}`)
  await page.waitForSelector('.pd-task-title')
  const boardDone = page.locator('[data-pd-tasks="done"] .prio-banner').first()
  await expect(boardDone).toHaveCSS('opacity', '0.7')
  const boardLive = page.locator('.pd-task-wrap[data-priority="urgent"] .prio-banner').first()
  await expect(boardLive).toHaveCSS('background-color', 'rgb(191, 42, 30)')

  // And the treatment FOLLOWS the card: drag the urgent idea card into Done —
  // its banner fades on arrival (no reload, no per-card state).
  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board .pd-task-title')
  await page.evaluate(({ ideaId }) => {
    const srcCard = document.querySelector(`.pd-task-wrap[data-pd-task="${ideaId}"] .pd-task`)
    const dst = document.querySelector('.pd-col[data-status="done"]')
    const dt = new DataTransfer()
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt }
    srcCard!.dispatchEvent(new DragEvent('dragstart', opts))
    dst!.dispatchEvent(new DragEvent('dragover', opts))
    dst!.dispatchEvent(new DragEvent('drop', opts))
    srcCard!.dispatchEvent(new DragEvent('dragend', opts))
  }, { ideaId })
  const moved = page.locator(`[data-pd-tasks="done"] .pd-task-wrap[data-pd-task="${ideaId}"] .prio-banner`)
  await expect(moved).toHaveCSS('opacity', '0.7')
})

test('a card DROPPED onto a folded box unfolds it and lands — the fold is a layout preference, not a wall', async ({ page, browser }) => {
  await login(page)
  const { pid, ideaId } = await seedProject(page)
  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board .pd-task-title')

  // Fold the Done box…
  await page.locator('#pd-col-done [data-pd-col-collapse]').click()
  await expect(page.locator('#pd-col-done')).toHaveAttribute('data-collapsed', '')

  // …and drop the urgent idea card onto its narrow chip.
  await page.evaluate(({ ideaId }) => {
    const srcCard = document.querySelector(`.pd-task-wrap[data-pd-task="${ideaId}"] .pd-task`)
    const dst = document.querySelector('#pd-col-done')
    const dt = new DataTransfer()
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt }
    srcCard!.dispatchEvent(new DragEvent('dragstart', opts))
    dst!.dispatchEvent(new DragEvent('dragover', opts))
    dst!.dispatchEvent(new DragEvent('drop', opts))
    srcCard!.dispatchEvent(new DragEvent('dragend', opts))
  }, { ideaId })

  // The box unfolded and the card landed in it (visible, pale banner).
  await expect(page.locator('#pd-col-done')).not.toHaveAttribute('data-collapsed')
  const landed = page.locator(`[data-pd-tasks="done"] .pd-task-wrap[data-pd-task="${ideaId}"]`)
  await expect(landed).toBeVisible()
  await expect(landed.locator('.prio-banner')).toHaveCSS('opacity', '0.7')
  // the fold store no longer carries 'done' (the drop was a deliberate unfold)
  expect(await page.evaluate(() => localStorage.getItem('hibana-pd-cols-collapsed'))).toBe('[]')
})

test('touch context: the fold chevron carries the 44px touch floor (the house coarse-pointer law)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  // Suppress the onboarding coachmarks (same as login()).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  const pid = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e s175 touch ${Date.now()}`, status: 'developing' }) })
    return ((await res.json()) as { id: string }).id
  })
  await page.goto(`/project.html?id=${pid}`)
  await page.waitForSelector('#pd-board .pd-col[data-status]')
  await expect(page.locator('#pd-col-idea [data-pd-col-collapse]')).toBeVisible()
  const geo = await page.locator('#pd-col-idea [data-pd-col-collapse]').boundingBox()
  expect(geo).not.toBeNull()
  expect(Math.min((geo as { width: number }).width, (geo as { height: number }).height)).toBeGreaterThanOrEqual(44)
  await ctx.close()
})
