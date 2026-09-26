// e2e/s149-priority-detail.spec.ts — S149 (owner rounds, three asks in one):
//   (1) "Use this new colors for priority color-coding" — the banner palette.
//       S150 RE-PIN (owner: "Use this for color-coding priorities"): the fills are
//       the FILL+INK PAIR set (Low #D3D9DF pale slate + #45525E dark ink · Medium
//       #F4E5BD pale gold + #604910 dark ink · High #C14E1B burnt orange + white ·
//       Urgent #BF2A1E saturated red + white) — the tokens are byte-checked off
//       :root, the urgent banner keeps WHITE ink, and the visible medium banner
//       proves the PALE pair's dark ink.
//   (2) "I want the Kanban To work like ajax … when a user drags a plan item from
//       its box to done, the other one, which was hidden behind a 'See More' button
//       … becomes visible without refresh" — a cross-box drag PATCHes, then BOTH
//       columns repaint from server truth in the same beat: the origin's hidden
//       item surfaces, the more-link re-counts, no reload (a live-window canary
//       survives).
//   (3) "when clicking on items of projects … I want a sliding sidebar to appear
//       from right on LTR, and LEFT on RTL, showing the title (full) and content in
//       full of that item. the editing menu … will only be available by clicking on
//       '...' and selecting 'edit'" — the card click opens the detail slide-over
//       (full title + full content, zero fetch via data-raw-title), the editor only
//       opens from the ⋯ menu's Edit, and the panel anchors inline-end (right in
//       LTR, left in RTL).
// Run: npx playwright test e2e/s149-priority-detail.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s149@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const PROJ_ID = randomBytes(16).toString('hex')
const PROJ_TITLE = 's149 kanban project'

// Seven planned tasks (equal priority → the server's ORDER BY rides sort_order):
// the board shows the first five; six + seven hide behind the «+2 more» link.
const TASKS = Array.from({ length: 7 }, (_, i) => ({
  id: randomBytes(16).toString('hex'),
  title: `s149 task ${i + 1}`,
  sort: i + 1,
}))
// The detail-panel task: a real title + multi-line content (bullets + a code fence)
// stored the S48g way — title + '\n' + content in the single title column.
const DETAIL_TASK = {
  id: randomBytes(16).toString('hex'),
  raw: 's149 Deep Task\nPlan the migration carefully:\n- step one\n- step two\n```js\nconsole.log("s149-content-marker")\n```',
}

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
  try {
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s149', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJ_ID}', '${USER_ID}', '${PROJ_TITLE}', '', 'personal', 'planning', 0, '${now}', '${now}')`,
  )
  for (const t of TASKS) {
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${t.id}', '${PROJ_ID}', '${t.title}', 'planned', 'medium', ${t.sort}, '${now}')`,
    )
  }
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${DETAIL_TASK.id}', '${PROJ_ID}', '${DETAIL_TASK.raw.replace(/'/g, "''")}', 'planned', 'urgent', 99, '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
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
  await page.waitForURL('**/app')
}

test('S150 palette: the priority banner fills are the owner\'s fill+ink pairs', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  // The canonical token block (the owner's exact hexes) off :root.
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const v = (n: string) => cs.getPropertyValue(n).trim()
    return {
      low: v('--color-low'), lowInk: v('--color-low-ink'),
      medium: v('--color-medium'), mediumInk: v('--color-medium-ink'),
      high: v('--color-high'), urgent: v('--color-urgent'),
    }
  })
  expect(tokens.low).toBe('#d3d9df')
  expect(tokens.lowInk).toBe('#45525e')
  expect(tokens.medium).toBe('#f4e5bd')
  expect(tokens.mediumInk).toBe('#604910')
  expect(tokens.high).toBe('#c14e1b')
  expect(tokens.urgent).toBe('#bf2a1e')
  // urgent → --color-urgent #BF2A1E = rgb(191, 42, 30) — the saturated pair, WHITE ink.
  const banner = page.locator(`.pd-task-wrap[data-pd-task="${DETAIL_TASK.id}"] .prio-banner`)
  await expect(banner).toBeVisible()
  await expect(banner).toHaveCSS('background-color', 'rgb(191, 42, 30)')
  await expect(banner).toHaveCSS('color', 'rgb(255, 255, 255)')
  // t1 is a visible MEDIUM card: the pale-gold pair carries its DARK ink (#604910).
  const med = page.locator(`.pd-task-wrap[data-pd-task="${TASKS[0].id}"] .prio-banner`)
  await expect(med).toHaveCSS('background-color', 'rgb(244, 229, 189)')
  await expect(med).toHaveCSS('color', 'rgb(96, 73, 16)')
})

test('S149 AJAX kanban: a cross-box drag repaints both boxes — the hidden item surfaces without refresh', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  const planned = page.locator('[data-pd-tasks="planned"]')
  const done = page.locator('[data-pd-tasks="done"]')
  // The urgent detail task sorts FIRST (priority-first ORDER BY), so the visible
  // five are: detail, t1..t4; hidden: t5, t6, t7 behind «+3 more».
  await expect(planned.locator('.pd-task-wrap')).toHaveCount(5)
  await expect(planned.locator('.pd-more-link')).toHaveText('+3 more')
  await page.evaluate(() => { (window as unknown as Record<string, number>).__s149live = 1 })

  // Drag t1 (a visible medium card) to Done — the HTML5 dnd sequence the delegated
  // handlers listen for.
  const T1 = TASKS[0].id
  await page.evaluate((t1) => {
    const srcCard = document.querySelector(`[data-pd-tasks="planned"] .pd-task-wrap[data-pd-task="${t1}"] .pd-task`)
    const dst = document.querySelector('.pd-col[data-status="done"]')
    const dt = new DataTransfer()
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt }
    srcCard!.dispatchEvent(new DragEvent('dragstart', opts))
    dst!.dispatchEvent(new DragEvent('dragover', opts))
    dst!.dispatchEvent(new DragEvent('drop', opts))
    srcCard!.dispatchEvent(new DragEvent('dragend', opts))
  }, T1)

  // The repaint: planned drops to 7 tasks → 5 visible + «+2 more» — t5 SURFACED
  // (it was hidden behind the more-link before the drag, without any reload).
  await expect(planned.locator('.pd-more-link')).toHaveText('+2 more', { timeout: 5_000 })
  await expect(planned.locator(`.pd-task-wrap[data-pd-task="${TASKS[4].id}"]`)).toBeVisible()
  await expect(planned.locator(`.pd-task-wrap[data-pd-task="${TASKS[6].id}"]`)).toHaveCount(0) // t7 still hidden
  await expect(done.locator(`.pd-task-wrap[data-pd-task="${T1}"]`)).toBeVisible()
  await expect(done.locator('.pd-task-wrap')).toHaveCount(1)
  // no-reload canary
  expect(await page.evaluate(() => (window as unknown as Record<string, number>).__s149live)).toBe(1)
})

test('S149 detail slide-over: card click opens it (full title + content), ⋯ Edit opens the editor', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  const wrap = page.locator(`.pd-task-wrap[data-pd-task="${DETAIL_TASK.id}"]`)
  await expect(wrap).toBeVisible()

  // Card click → the slide-over, NOT the editor. (The open class rides the
  // #pd-detail-root wrapper; the aside + scrim are its children.)
  await wrap.locator('.pd-task').click()
  const panel = page.locator('#pd-detail-root')
  const aside = page.locator('.pd-detail')
  await expect(panel).toHaveClass(/open/, { timeout: 3_000 })
  // Title (full first line) + content in full — the bullets + the code fence body.
  await expect(panel.locator('.pd-detail-title')).toHaveText('s149 Deep Task')
  await expect(panel.locator('.pd-detail-content')).toContainText('step one')
  await expect(panel.locator('.pd-detail-content')).toContainText('step two')
  await expect(panel.locator('.pd-detail-content')).toContainText('s149-content-marker')
  // Priority chip rides the S150 fill+ink pairs (urgent = saturated red + white ink).
  await expect(panel.locator('.pd-detail-prio')).toHaveCSS('background-color', 'rgb(191, 42, 30)')
  // LTR: the panel anchors INLINE-END (right edge) when open.
  const box = await aside.boundingBox()
  const vw = await page.evaluate(() => window.innerWidth)
  expect(box).toBeTruthy()
  expect(Math.round(box!.x + box!.width)).toBeGreaterThanOrEqual(vw - 2)

  // The editor did NOT open from the card click.
  expect(await page.locator('#pd-task-edit-modal[open]').count()).toBe(0)

  // ✕ closes; Escape closes too (open again first).
  await page.locator('[data-pd-detail-close].pd-detail-x').click()
  await expect(panel).not.toHaveClass(/open/)
  await wrap.locator('.pd-task').click()
  await expect(panel).toHaveClass(/open/)
  await page.keyboard.press('Escape')
  await expect(panel).not.toHaveClass(/open/)

  // ⋯ → Edit opens the EDITOR (the owner's split: menu = edit).
  await wrap.hover()
  await wrap.locator('[data-menu-open]').click()
  await wrap.locator('[data-pd-task-edit]').click()
  await expect(page.locator('#pd-task-edit-modal')).toBeVisible()
  const titleVal = await page.locator('#pde-title-input').inputValue()
  expect(titleVal).toBe('s149 Deep Task')
  await page.keyboard.press('Escape')
})

test('S149 RTL: the slide-over anchors the LEFT edge (inline-end mirror)', async ({ page }) => {
  // Flip the user's language pref to fa → the app boots dir=rtl.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  db.exec(`UPDATE users SET language_pref = 'fa' WHERE email = '${TEST_EMAIL}'`)
  db.close()
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  const wrap = page.locator(`.pd-task-wrap[data-pd-task="${DETAIL_TASK.id}"]`)
  await expect(wrap).toBeVisible()
  await wrap.locator('.pd-task').click()
  const panel = page.locator('#pd-detail-root')
  const aside = page.locator('.pd-detail')
  await expect(panel).toHaveClass(/open/, { timeout: 3_000 })
  const box = await aside.boundingBox()
  expect(box).toBeTruthy()
  expect(Math.round(box!.x)).toBeLessThanOrEqual(2) // LEFT edge in RTL
  // cleanup: back to en
  const db2 = new DatabaseSync('/tmp/hibana-e2e.db')
  db2.exec(`UPDATE users SET language_pref = 'en' WHERE email = '${TEST_EMAIL}'`)
  db2.close()
})
