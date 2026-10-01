// e2e/s182-todo-panel.spec.ts — S182 (the owner's two-item round on the dashboard's
// To-Do List section) + the S183 additions:
//   (1) "add a background for to-do list section, like the one quick note has" —
//       the section body joins the Quick Notebook's card grammar: ONE .card panel
//       (.dash-todo-panel, the .card.notebook-dashboard recipe token-for-token)
//       wrapping the quadrant board. S183 (the depth audit): the head rides INSIDE
//       the panel as its header strip + hairline (the S179 above-card placement
//       retires), and the panel carries the --shadow-card elevation token.
//   (2) "the boxes need aligment and same size… the minimum height must be
//       equivalent of 3 items, whether filled or empty, the rest gets scroll" —
//       every quadrant card renders at ONE fixed height (the 3-item window);
//       the list inside owns the overflow (scroll).
//   (3) S183 (owner): "make each task item more compact so 3 items fit fully
//       inside the fixed card height without scrolling" — the compact rows put
//       THREE single-line tasks inside the window with NO overflow; "add a
//       fade-out edge to the bottom… hide the native scrollbar" — the listwrap
//       fades only while content overflows, the scrollbar hides, wheel still
//       scrolls, and the top fade appears once scrolled.
// Pins: the panel card grammar (computed, compared against the live notebook
// card) + the head-inside-panel order + the shadow, the equal-height matrix
// (full × fitting × empty), the 3-row-fit window + the scroll contract, the
// fade-edge states, the quick-add reveal's height invariance, and the phone
// carousel's own fixed window inside the panel.
// Run: npx playwright test e2e/s182-todo-panel.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s182@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const SALT = randomBytes(16)

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(SALT)}$${toB64(Buffer.from(bits))}`
  const now = Date.now()
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id LIKE 's182-%'`)
    db.exec(`DELETE FROM projects WHERE user_id LIKE 's182-%'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id LIKE 's182-%'`)
    db.exec(`DELETE FROM quick_notes WHERE user_id LIKE 's182-%'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('s182-user', 'e2e-s182', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${iso(86400000 * 30)}', '${iso(86400000 * 30)}')`,
  )
  // ONE project + ONE vault note so the notebook section renders its card (the
  // grammar comparison needs the live Quick Notebook) and the vault banner stays
  // quiet (a note exists).
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s182-proj', 's182-user', 'S182 panel project', '', 'personal', 'developing', 0, '${iso(86400000 * 10)}', '${iso(3600000 * 2)}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s182-note', 's182-user', NULL, 'S182 note', 'x', '', 0, '${iso(86400000)}', '${iso(86400000)}')`,
  )
  // The height matrix: Q1 = 6 tasks (scrolls + fades), Q2 = 3 single-line tasks
  // (the S183 3-fit contract — compact rows, NO overflow), Q3+Q4 = empty.
  // Every card must land at ONE height; Q1's list scrolls; Q3/Q4 keep the strip
  // inside the same-height window.
  const mk = (i: number, quadrant: number) =>
    db.exec(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
       VALUES ('s182-q${quadrant}-${i}', 's182-user', ${quadrant}, 'S182 q${quadrant} task ${i}', 0, 0, ${i}, 'untouched', '${iso(3600000 * (20 - i))}', '${iso(3600000 * (20 - i))}')`,
    )
  for (let i = 0; i < 6; i++) mk(i, 1)
  for (let i = 0; i < 3; i++) mk(i, 2)
  db.close()
})

async function login(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.removeItem('hibana-resume')
      localStorage.removeItem('hibana-vault-banner-dismissed')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('.dash-todo-panel', { timeout: 10_000 })
}

/* ── 1. THE PANEL — the Quick Notebook's card grammar ────────────────────────── */

test('S182-1: the to-do section body rides in the notebook\'s card grammar (bg/border/radius/shadow), head INSIDE the panel', async ({ page }) => {
  await login(page)

  const panel = page.locator('.dash-todo-panel')
  await expect(panel).toHaveCount(1)
  // The panel WRAPS the quadrant board (the grid + swipe hint ride inside it).
  await expect(panel.locator('> .dash-quad-wrap .dash-todo-grid')).toHaveCount(1)

  // The computed card grammar — compared against the LIVE Quick Notebook card
  // ("like the one quick note has", the owner's words): same surface fill, same
  // hairline width, same radius.
  const notebook = page.locator('.card.notebook-dashboard')
  await expect(notebook).toHaveCount(1)
  const read = (el) =>
    el.evaluate((node) => {
      const cs = getComputedStyle(node)
      return { bg: cs.backgroundColor, bw: cs.borderTopWidth, radius: cs.borderRadius }
    })
  const panelCss = await read(panel.first())
  const notebookCss = await read(notebook.first())
  expect(panelCss.bg).toBe(notebookCss.bg)
  expect(panelCss.bw).toBe('1px')
  expect(panelCss.radius).toBe('20px')

  // S183 (the depth audit — L2 realized): the head rides INSIDE the panel as its
  // header strip (the panel's FIRST child), with the hairline divider under it —
  // the title lives on the surface it names (the S179 above-card order retires).
  const section = page.locator('#dashboard-todo')
  const head = panel.locator('> header.dash-todo-head.dash-sec-head')
  await expect(head).toHaveCount(1)
  const headIdx = await panel.evaluate((el) => {
    const kids = [...el.children]
    return kids.findIndex((k) => k.classList.contains('dash-todo-head'))
  })
  expect(headIdx).toBe(0)
  const headCss = await head.evaluate((el) => getComputedStyle(el).borderBlockEndWidth)
  expect(parseFloat(headCss)).toBeGreaterThan(0)
  // The panel carries the ONE elevation token (--shadow-card) — the audit's
  // monotonic stack: page < panel < the in-card boxes.
  const panelShadow = await panel.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(panelShadow).not.toBe('none')

  // The phone dots stay BELOW the panel (section-level, not part of its surface).
  const dotsBelow = await section.evaluate((el) => {
    const kids = [...el.children]
    return kids.findIndex((k) => k.classList.contains('dash-todo-panel')) <
      kids.findIndex((k) => k.classList.contains('dash-quad-dots'))
  })
  expect(dotsBelow).toBe(true)
})

/* ── 2. THE BOXES — same size, fixed height, 3-item window, empty included ───── */

test('S182-2: all four quadrant boxes are the same fixed height (full, fitting, empty); the window is ~3 items', async ({ page }) => {
  await login(page)

  const cards = page.locator('.dash-todo-quadrant')
  await expect(cards).toHaveCount(4)

  // Every card at ONE height — the full (6 tasks), the fitting (1 task) and the
  // EMPTY (2 quadrants) all land within 1px of each other ("whether filled or
  // empty", the owner's words).
  const heights = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  expect(heights[0]).toBeGreaterThan(0)
  for (const h of heights) expect(Math.abs(h - heights[0])).toBeLessThanOrEqual(1)

  // The computed block-size is the FIXED 3-item window (not min-height, not auto):
  // paddings (0.85rem×2) + head (3.1rem) + gap (0.65rem) + 3 rows (3×2.81rem) +
  // the 2 inter-row gaps (0.48rem) = 14.36rem = 229.76px (± rounding).
  const cardCss = await cards.first().evaluate((el) => ({ bs: getComputedStyle(el).blockSize, minBs: getComputedStyle(el).minBlockSize }))
  expect(parseFloat(cardCss.bs)).toBeGreaterThan(225)
  expect(parseFloat(cardCss.bs)).toBeLessThan(235)
  expect(cardCss.minBs).toBe('0px')

  // The list window: Q1 (6 rows in the DOM) overflows and scrolls; the window is
  // the 3-item register (~141px — the S182 derivation; the S183 compact rows ride
  // inside it with slack, ~29px each at rest).
  const q1List = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-list')
  const q1Geom = await q1List.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  expect(q1Geom.scroll).toBeGreaterThan(q1Geom.client + 45) // 6 rows in a 3-row window
  expect(q1Geom.client).toBeGreaterThan(90)
  expect(q1Geom.client).toBeLessThan(180)

  // S183 (owner: "3 items fit fully inside the fixed card height without
  // scrolling"): Q2's THREE single-line tasks sit COMPLETELY inside the window —
  // no overflow, no scroll, no fade.
  const q2List = page.locator('.dash-todo-quadrant[data-dash-quadrant="2"] .dash-todo-list')
  const q2Geom = await q2List.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  expect(q2Geom.scroll).toBeLessThanOrEqual(q2Geom.client + 1)
  const q2Wrap = page.locator('.dash-todo-quadrant[data-dash-quadrant="2"] .dash-todo-listwrap')
  await expect(q2Wrap).not.toHaveClass(/can-scroll/)
  await expect(q2Wrap).not.toHaveClass(/fade-bottom/)

  // The empty quadrant: the quiet strip rides INSIDE the same-height window, no
  // scroll, and the card did NOT collapse (the S179 short-strip is gone).
  const q3 = page.locator('.dash-todo-quadrant[data-dash-quadrant="3"]')
  await expect(q3.locator('.dash-todo-empty')).toHaveCount(1)
  await expect(q3.locator('.dash-todo-empty-text')).toHaveText('No tasks yet.')
  const q3Geom = await q3.locator('.dash-todo-list').evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  expect(q3Geom.scroll).toBeLessThanOrEqual(q3Geom.client + 1)
  const q3Height = await q3.evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.abs(q3Height - heights[0])).toBeLessThanOrEqual(1)
})

/* ── 3. THE SCROLL — the rest is reached by scrolling; the box never resizes ──── */

test('S182-3: scrolling the window reveals the lower rows; the quick-add reveal never changes the card height', async ({ page }) => {
  await login(page)

  const quad = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"]')
  const card = quad
  const list = quad.locator('.dash-todo-list')

  const before = await card.evaluate((el) => el.getBoundingClientRect().height)

  // Scroll to the bottom of the window — the 6th row rides into view (the S182
  // reveal: no pill, no hidden attrs; the scroll IS the affordance).
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const scrolled = await list.evaluate((el) => el.scrollTop)
  expect(scrolled).toBeGreaterThan(40)
  const lastVisible = await quad.locator('.dash-todo-task').last().evaluate((el) => {
    const box = el.getBoundingClientRect()
    const win = el.closest('.dash-todo-list').getBoundingClientRect()
    return box.bottom <= win.bottom + 1
  })
  expect(lastVisible).toBe(true)

  // The quick-add form reveals WITHOUT resizing the card (fixed-height contract:
  // the form takes list window, never card height).
  await quad.locator('.dash-todo-fab').click()
  await expect(quad.locator('.dash-quickadd')).toBeVisible()
  const during = await card.evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.abs(during - before)).toBeLessThanOrEqual(1)

  // A row added through the form lands in the list (counter 6 -> 7) and the card
  // STILL holds the fixed height after the htmx sweep.
  await quad.locator('.dash-quickadd input[name="title"]').fill('S182 added row')
  await quad.locator('.dash-quickadd input[name="title"]').press('Enter')
  await expect(quad.locator('.dash-todo-counter')).toHaveText('7', { timeout: 10_000 })
  await expect(quad.locator('.dash-todo-task [data-task-title]', { hasText: 'S182 added row' })).toHaveCount(1)
  const after = await card.evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1)
})

/* ── 3.5. THE FADE EDGES (S183) — the scroll affordance ───────────────────── */

test('S183-5: the fade edges + the hidden scrollbar (overflow-gated, both edges, still scrollable)', async ({ page }) => {
  await login(page)

  const q1List = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-list')
  const q1Wrap = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-listwrap')

  // The overflowing list: bottom fade + can-scroll at rest; NO top fade yet
  // (the owner: "bottom fade only when content exists below; top fade only
  // after scrolling down").
  await expect(q1Wrap).toHaveClass(/can-scroll/)
  await expect(q1Wrap).toHaveClass(/fade-bottom/)
  await expect(q1Wrap).not.toHaveClass(/fade-top/)

  // The native scrollbar is hidden (the fade + the scroll itself are the
  // affordance now)…
  const sbw = await q1List.evaluate((el) => getComputedStyle(el).scrollbarWidth)
  expect(sbw).toBe('none')
  // …but the list STILL scrolls — trusted wheel input over the list moves it
  // (hiding the scrollbar never disabled wheel/touch/keyboard scrolling).
  const before = await q1List.evaluate((el) => el.scrollTop)
  await q1List.hover()
  await page.mouse.wheel(0, 60)
  await q1List.evaluate(() => new Promise((r) => setTimeout(r, 150))) // settle beat for the scroll listener
  const after = await q1List.evaluate((el) => el.scrollTop)
  expect(after).toBeGreaterThan(before)

  // Scrolled down: BOTH edges fade (content above AND below)…
  await expect(q1Wrap).toHaveClass(/fade-top/)
  await expect(q1Wrap).toHaveClass(/fade-bottom/)

  // …at the very bottom: the top fade stays, the bottom one retires.
  await q1List.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(q1Wrap).toHaveClass(/fade-top/)
  await expect(q1Wrap).not.toHaveClass(/fade-bottom/)

  // The fitting list (3 tasks) and the empty quadrant: no overflow → NO fade at
  // all (the owner: "the fade must turn off when the list doesn't overflow").
  const q2Wrap = page.locator('.dash-todo-quadrant[data-dash-quadrant="2"] .dash-todo-listwrap')
  await expect(q2Wrap).not.toHaveClass(/can-scroll/)
  await expect(q2Wrap).not.toHaveClass(/fade-bottom/)
  await expect(q2Wrap).not.toHaveClass(/fade-top/)
  const q3Wrap = page.locator('.dash-todo-quadrant[data-dash-quadrant="3"] .dash-todo-listwrap')
  await expect(q3Wrap).not.toHaveClass(/can-scroll/)
})

/* ── 4. THE PHONE — the carousel keeps its own fixed window inside the panel ──── */

test('S182-4: on the phone the panel wraps the swipe carousel; the slide keeps its own fixed window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 })
  await login(page)

  const panel = page.locator('.dash-todo-panel')
  await expect(panel).toHaveCount(1)

  // The phone slide: ONE full-width quadrant at the carousel's own fixed window
  // (min(26rem, 96vw) on a 390px viewport = 374px) — same fixed-height + scroll
  // contract as the desktop, only deeper.
  const card = page.locator('.dash-todo-quadrant').first()
  const height = await card.evaluate((el) => el.getBoundingClientRect().height)
  expect(height).toBeGreaterThan(360)
  expect(height).toBeLessThan(385)

  // The dots ride BELOW the panel and index the four quadrants.
  const dots = page.locator('.dash-quad-dots .dash-quad-dot')
  await expect(dots).toHaveCount(4)
})
