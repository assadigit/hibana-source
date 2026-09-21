// e2e/s105-owners-agenda.spec.ts — S105: the owner's agenda (12-item round).
//
// WHY THIS FILE EXISTS: one spec per BUG CLASS the owner reported, so neither failure
// direction of any fix can silently return:
//
//   1. [URGENT] "the note page appears unloaded and messed up for the first 1–2 loads"
//      ROOT CAUSE (verified with a route.abort on a cold context): the S83/S84
//      watchdog installed its error listener at the END of <head>, AFTER the
//      stylesheet links — a reset arriving while the parser blocks on the sync
//      boot.js fetch fired the LINK error BEFORE the listener existed, so early
//      failures were invisible (no reload, no heal — a broken paint until the user
//      manually refreshed). The S105 guardian runs FIRST in <head> and heals a
//      dropped stylesheet IN PLACE (a cache-busted twin href, up to 3 attempts,
//      veil held while healing) — the page must NEVER reload for a CSS failure.
//   2. [HIGH] dark-mode sticky notes were near-black (#2E2818-family) — they must
//      read as MUTED COLORS. Pinned by exact computed rgb on all four papers.
//   3. [HIGH] the screenshots grid "into each other and messed up": a pinned shot's
//      long task title overflowed its card (flex min-width:auto) and painted ACROSS
//      the neighboring tiles. Pinned by the ellipsis actually engaging.
//   4. [MED] the vault tree folders/sections couldn't collapse — notes never rendered
//      in-tree and the section heads were static. Pinned end-to-end.
//   5. [MED] the calendar rail icon only opened the panel — it must NAVIGATE too.
//   6. [MED] the fullscreen board drifted from the projects-page box (stale local
//      renderer, unbold title). Pinned on the shared renderer's output + weight.
//   7. [MED] the Plans tab showed only plan documents while its badge counted the
//      planned kanban items. Pinned: the list renders and MATCHES the badge.
//   8. [MED] the ⚙ view-options menu painted under later sections (the #notebook
//      container-type stacking context). Pinned: the open panel lifts to <body>.
//   9. [MED] success toasts read "Saved [x]" — they must read "Saved ✓" on pastel
//      green with the × at the top-right corner. Pinned on a real save.
//
// Run: npx playwright test e2e/s105-owners-agenda.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s105@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'

// The S105 muted dark sticky register (claude-dark, sticky/grid views):
const DARK_STICKY = {
  yellow: '179,151,91',  // #b3975b
  green: '92,153,115',   // #5c9973
  pink: '196,138,171',   // #c48aab
  blue: '122,149,189',   // #7a95bd
}

// Chromium serializes computed color-mix() as `color(srgb …)` and plain colors as
// `rgb(…)` — normalize both to "r,g,b" (the s102 helper; NEVER throws so expect.poll
// can retry through mid-transition oklab snapshots).
function computedRgb(value: string): string {
  const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)
  if (rgb) return `${rgb[1]},${rgb[2]},${rgb[3]}`
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value)
  if (srgb) return srgb.slice(1).map((n) => Math.round(Number(n) * 255)).join(',')
  return value
}

let USER_ID = ''

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  USER_ID = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM note_folders WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM quick_notes WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s105', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // One project carrying the plans-tab + board + screenshots fixtures.
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s105-project', '${USER_ID}', 'S105 Owner Agenda Project', '', 'personal', 'developing', 0, '${now}', '${now}')`,
  )
  // 5 planned tasks (the badge count the owner saw) + a bullet-titled in-progress one
  // for the board-renderer pin.
  for (let i = 0; i < 5; i++) {
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('s105-plan-${i}', 's105-project', 'S105 planned tweak ${i}', 'planned', 'medium', ${i}, '${now}')`,
    )
  }
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('s105-bullet', 's105-project', '- bullet one
- bullet two', 'in_progress', 'high', 0, '${now}')`,
  )
  // The vault: an "AI" folder with TWO notes (the collapsible group) + one unfiled.
  db.exec(
    `INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('s105-ai', '${USER_ID}', NULL, 'AI', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s105-note-1', '${USER_ID}', 's105-ai', 'GPT prompt patterns', 'one
two', '', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s105-note-2', '${USER_ID}', 's105-ai', 'RAG notes', 'retrieval', '', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s105-note-3', '${USER_ID}', NULL, 'Unfiled scratch', 'x', '', 0, '${now}', '${now}')`,
  )
  // The four sticky papers for the dark-mode color pins.
  for (const color of ['yellow', 'green', 'pink', 'blue']) {
    db.exec(
      `INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at, color, sticky)
       VALUES ('s105-qn-${color}', '${USER_ID}', 'note', '', 'S105 ${color} paper', '${now}', '${now}', '${color}', 1)`,
    )
  }
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
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
}

/* ── 1. THE GUARDIAN: a dropped stylesheet heals in place — never a reload ─────── */

// The TRUE first-visit shape: no service worker exists yet (a fresh profile's very
// first load — the owner's exact scenario). Blocking SWs also keeps the reset visible
// to Playwright's route interception (an active SW's fetches bypass page routes).
test.use({ serviceWorkers: 'block' })

test('S105-1 [URGENT]: a reset stylesheet HEALS IN PLACE on the notes page — no reload, no budget spent', async ({ page }) => {
  await login(page)
  // The flaky-link shape: the FIRST fetch of notes.css is reset (connectionreset),
  // everything after flows. This is exactly the owner's first-visit failure.
  let aborted = false
  await page.route('**/css/notes.css*', async (route) => {
    if (!aborted) { aborted = true; return route.abort('connectionreset') }
    return route.continue()
  })
  await page.goto('/notes.html')
  // The heal twin replaces the failed link (cache-busted href, retry counter).
  await expect(page.locator('link[data-hibana-heal]')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.locator('link[data-hibana-heal]')).toHaveAttribute('href', /notes\.css\?v=\d+&hibana-r=1$/)
  // A page marker set after load must SURVIVE — proof location.reload() never fired.
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__s105NoReload = 42 })
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__s105NoReload)).toBe(42)
  expect(await page.evaluate(() => sessionStorage.getItem('hibana-boot-retries'))).toBeNull()
  // And the page is genuinely STYLED + booted (the 3-pane vault grid + the tree).
  await expect(page.locator('.vault-folder-row').first()).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(async () => page.evaluate(() => getComputedStyle(document.querySelector('.vault') as HTMLElement).gridTemplateColumns.split(' ').length), { timeout: 10_000 })
    .toBe(3)
})

/* ── 2. Dark-mode sticky notes stay COLORED (muted, not near-black) ───────────── */

test('S105-2 [HIGH]: claude-dark sticky notes read as muted COLORS, not near-black', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-theme', 'claude-dark')
      localStorage.setItem('hibana-note-view', 'sticky') // the sticky paper view
    } catch { /* storage blocked */ }
  })
  await login(page)
  for (const [color, rgb] of Object.entries(DARK_STICKY)) {
    const card = page.locator(`.note-card[data-note-color="${color}"]`)
    await expect(card).toBeVisible({ timeout: 15_000 })
    // The EXACT muted register — the retired near-black (#2E2818 = 46,40,24) and any
    // full-saturation light-mode fill both fail this pin.
    await expect
      .poll(async () => page.evaluate((c) => {
        const el = document.querySelector(`#notebook .note-card[data-note-color="${c}"]`) as HTMLElement | null
        return el ? getComputedStyle(el).backgroundColor : 'missing'
      }, color).then(computedRgb), { timeout: 10_000 })
      .toBe(rgb)
  }
})

/* ── 3. The screenshots grid: a long pinned title stays INSIDE its card ───────── */

test('S105-3 [HIGH]: a pinned shot with a long task title no longer bleeds across the grid', async ({ page }) => {
  await login(page)
  await page.goto('/project.html?id=s105-project')
  await page.waitForSelector('#project-body header h1', { timeout: 15_000 })

  // Upload one real screenshot through the picker (the S61 disk store serves it).
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mNk+M+ACzDhVQ4CAAvwATkP0aAAAAAAAElFTkSuQmCC',
    'base64',
  )
  await page.setInputFiles('#shot-input', { name: 's105-shot.png', mimeType: 'image/png', buffer: PNG })

  // Create the LONG-titled task + pin the shot to it (the owner's real-world shape).
  // The upload rides an async XHR — poll until the shot row lands before pinning.
  const longTitle = 'Screenshot gallery of projects — turns the screenshot word to Files, also fix the issue of displaying, they are into each other and messed up beyond recognition'
  await page.evaluate(async (longTitle) => {
    const res = await fetch('/api/projects/s105-project/devtasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: longTitle, status: 'bug' }),
    })
    if (!res.ok) throw new Error('task create failed')
    const { id } = (await res.json()) as { id: string }
    let shotId: string | undefined
    for (let i = 0; i < 50 && !shotId; i++) {
      const shots = (await (await fetch('/api/projects/s105-project/screenshots')).json()) as { screenshots: { id: string }[] }
      shotId = shots.screenshots[0]?.id
      if (!shotId) await new Promise((r) => setTimeout(r, 200))
    }
    if (!shotId) throw new Error('shot never landed')
    const pin = await fetch(`/api/screenshots/${shotId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: id }),
    })
    if (!pin.ok) throw new Error('pin failed')
  }, longTitle)

  // Fresh render with the pin, on the media tab.
  await page.goto('/project.html?id=s105-project')
  await page.waitForSelector('#project-body header h1', { timeout: 15_000 })
  await page.click('[data-detail-tab="media"]')
  await expect(page.locator('.shot-pin-task').first()).toBeVisible({ timeout: 15_000 })

  // The pin line stays INSIDE its card: the pin's BOX never exceeds the card, and
  // the CARD itself keeps its single grid track (the min-width:auto overflow used
  // to stretch the card across the whole grid width, painting over the neighbors).
  const clamp = await page.evaluate(() => {
    const task = document.querySelector('.shot-pin-task') as HTMLElement | null
    const pin = document.querySelector('.shot-pin') as HTMLElement | null
    const card = pin?.closest('.shot-card') as HTMLElement | null
    const grid = document.querySelector('#shots') as HTMLElement | null
    if (!task || !pin || !card || !grid) return null
    return {
      ellipsized: getComputedStyle(task).textOverflow === 'ellipsis' && getComputedStyle(task).overflow === 'hidden',
      pinWidth: pin.getBoundingClientRect().width,
      cardWidth: card.getBoundingClientRect().width,
      gridWidth: grid.getBoundingClientRect().width,
    }
  })
  expect(clamp).toBeTruthy()
  expect(clamp!.ellipsized).toBe(true)          // the ellipsis machinery is active
  expect(clamp!.pinWidth).toBeLessThanOrEqual(clamp!.cardWidth + 1) // the box fits the card
  expect(clamp!.cardWidth).toBeLessThanOrEqual(clamp!.gridWidth / 3) // one track, not the grid
})

/* ── 4. The vault tree: collapsible groups (folders WITH notes) + section heads ── */

test('S105-4 [MED]: the AI folder collapses/expands its notes; the Folders section heading collapses', async ({ page }) => {
  await login(page)
  await page.goto('/notes.html')
  await expect(page.locator('.vault-folder-row', { hasText: 'AI' })).toBeVisible({ timeout: 15_000 })

  // The AI folder (notes, no subfolders) now carries a WORKING twisty — the owner's
  // "collapsing the group of the AI folder".
  const tw = page.locator('[data-vault-tw="s105-ai"]')
  await expect(tw).toBeVisible()
  await expect(tw).not.toHaveClass(/spacer/)
  await expect(page.locator('.vault-note-row')).toHaveCount(0) // collapsed by default

  // Expand → the two notes render IN-TREE (Obsidian-style)…
  await tw.click()
  await expect(page.locator('.vault-note-row')).toHaveCount(2)
  await expect(page.locator('.vault-note', { hasText: 'GPT prompt patterns' })).toBeVisible()
  // …and a note row OPENS the note in the editor.
  await page.locator('.vault-note', { hasText: 'RAG notes' }).click()
  await expect
    .poll(async () => page.evaluate(() => (document.querySelector('[data-vault-title]') as HTMLInputElement | null)?.value), { timeout: 10_000 })
    .toBe('RAG notes')
  // Collapse again → the rows fold away (and persist).
  await page.locator('[data-vault-tw="s105-ai"]').click()
  await expect(page.locator('.vault-note-row')).toHaveCount(0)

  // The FOLDERS section heading collapses the whole section (persisted per-pref).
  const head = page.locator('[data-vault-sec="folders"]')
  await expect(head).toBeVisible()
  await head.click()
  await expect(page.locator('[data-vault-folders]')).toBeHidden()
  await head.click()
  await expect(page.locator('[data-vault-folders]')).toBeVisible()
})

/* ── 5. The calendar rail icon NAVIGATES to the calendar page ─────────────────── */

test('S105-5 [MED]: the calendar rail icon opens its panel AND lands on /calendar.html', async ({ page }) => {
  await login(page)
  await page.click('.rail .rail-primary a[data-rail-panel="calendar"]')
  await page.waitForURL('**/calendar.html', { timeout: 15_000 })
  // The tickable panel rides along (the To-do/Projects data-rail-nav pattern).
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
  await expect(page.locator('[data-rail-panel-box]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.rail-panel-title')).toHaveText('Calendar')
})

/* ── 6. The fullscreen board inherits the projects-page card rendering ────────── */

test('S105-6 [MED]: the fullscreen board renders bullets + a BOLD title (the shared renderer)', async ({ page }) => {
  await login(page)
  await page.goto('/board.html?project=s105-project')
  // The bullet-titled task renders through window.HibanaChips — the FIRST line
  // becomes a real <ul><li> bullet (the retired local renderer left "- bullet one"
  // as literal text), and the second line rides the S86 PREVIEW (S48j title-only —
  // the exact projects-page card shape the board must inherit).
  const card = page.locator('.db-card', { hasText: 'bullet one' }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card.locator('.db-card-title ul > li')).toHaveCount(1)
  await expect(card.locator('.db-card-title ul > li')).toHaveText('bullet one')
  // The preview flattens the remaining raw line (marker included — the exact
  // projects-page preview behavior).
  await expect(card.locator('.pd-task-preview')).toHaveText('- bullet two')
  // The title carries the projects-page register: 0.75rem / weight 700.
  const typography = await card.locator('.db-card-title').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { weight: cs.fontWeight, size: cs.fontSize }
  })
  expect(typography.weight).toBe('700')
  expect(typography.size).toBe('12px')
})

/* ── 7. The Plans tab renders the planned items its badge counts ─────────────── */

test('S105-7 [MED]: the Plans tab lists the planned box items — count matches the badge', async ({ page }) => {
  await login(page)
  await page.goto('/project.html?id=s105-project')
  await page.waitForSelector('#project-body header h1', { timeout: 15_000 })

  // The tab badge says 5 (the seeded planned items)…
  const badge = page.locator('[data-tab-count="backlog"]')
  await expect(badge).toHaveText('5')
  // …and the PANEL now lists exactly those 5 — the old panel showed only plan
  // documents ("No plan documents yet") under the same 5 badge.
  await page.click('[data-detail-tab="backlog"]')
  await expect(page.locator('.bl-plan')).toHaveCount(5)
  await expect(page.locator('[data-bl-plans-count]')).toHaveText('5')
  await expect(page.locator('.bl-plan', { hasText: 'S105 planned tweak 0' })).toBeVisible()

  // The two concepts stay labeled apart: plan ITEMS vs plan DOCUMENTS.
  await expect(page.locator('[data-bl-plans-head]')).toContainText('Plans')
  await expect(page.locator('.bl-sub', { hasText: 'Plan documents' })).toBeVisible()

  // Adding a plan via the composer appends to the list LIVE (the primary complaint
  // path — items were added but never appeared).
  await page.fill('[data-bl-item] input[name="title"]', 'S105 live-added plan')
  await page.locator('[data-bl-item] button[type="submit"]').click()
  await expect(page.locator('.bl-plan')).toHaveCount(6, { timeout: 10_000 })
  await expect(page.locator('.bl-plan', { hasText: 'S105 live-added plan' })).toBeVisible()
})

/* ── 8. The ⚙ view-options panel lifts above everything while open ───────────── */

test('S105-8 [MED]: the quick-note view menu lifts to <body> — no more painting under sections', async ({ page }) => {
  await login(page)
  await page.waitForSelector('#notebook', { timeout: 15_000 })
  await page.click('#notebook .note-controls-toggle summary')
  // The panel is now a DIRECT <body> child with fixed positioning (the spark-menu
  // lift pattern) — the #notebook container-type stacking context can't trap it.
  const floating = page.locator('body > .note-head-controls.is-floating')
  await expect(floating).toBeVisible({ timeout: 5_000 })
  const style = await floating.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { position: cs.position, z: cs.zIndex, parent: el.parentElement?.tagName }
  })
  expect(style.position).toBe('fixed')
  expect(Number(style.z)).toBeGreaterThanOrEqual(90)
  expect(style.parent).toBe('BODY')
  // Closing returns it home (no orphans).
  await page.click('#notebook .note-controls-toggle summary')
  await expect(page.locator('body > .note-head-controls.is-floating')).toHaveCount(0)
})

/* ── 9. The success toast: "Saved ✓" on pastel green, × at the top-right ──────── */

test('S105-9 [MED]: a save renders the ✓ success toast — pastel green, corner ×', async ({ page }) => {
  await login(page)
  await page.goto('/project.html?id=s105-project')
  await page.waitForSelector('#project-body header h1', { timeout: 15_000 })

  // A real save: add a plan item (the composer POST → 'Task added' toast, ok kind).
  await page.click('[data-detail-tab="backlog"]')
  await page.fill('[data-bl-item] input[name="title"]', 'S105 toast plan')
  await page.locator('[data-bl-item] button[type="submit"]').click()

  const toast = page.locator('#toast.toast.ok')
  await expect(toast).toBeVisible({ timeout: 10_000 })
  // The leading ✓ glyph + the message…
  await expect(toast.locator('.toast-check')).toBeVisible()
  await expect(toast.locator('.toast-msg')).toContainText('Task added')
  // …pastel GREEN (the operational badge family — not the neutral card white)…
  const bg = await toast.evaluate((el) => getComputedStyle(el).backgroundColor).then(computedRgb)
  const [r, g, b] = bg.split(',').map(Number)
  expect(g).toBeGreaterThan(r) // green channel dominates
  expect(g).toBeGreaterThan(b)
  // …and the small × sits at the TOP-RIGHT corner.
  const x = toast.locator('.toast-x')
  await expect(x).toBeVisible()
  const corner = await toast.evaluate((el) => {
    const t = el.getBoundingClientRect()
    const x = el.querySelector('.toast-x')?.getBoundingClientRect()
    if (!x) return null
    return { dx: t.right - x.right, dy: x.top - t.top }
  })
  expect(corner!.dx).toBeLessThanOrEqual(8)
  expect(corner!.dy).toBeLessThanOrEqual(8)
})
