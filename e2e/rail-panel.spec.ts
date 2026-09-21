// e2e/rail-panel.spec.ts — S88: the vertical navigation rail + its secondary panel.
// S89 REWRITE: the rail grew into its LABELED form — every icon carries a small text
// label beneath it (the owner request), the new square logo pair rides the brand
// button (theme-swapped), Canvas + Notebook LEFT the rail (the account menu owns
// them now — their panel sections are retired), and the Calendar panel renders a
// REAL mini month grid (Gregorian EN / Jalali FA, today ring, due dots, ‹ ›
// stepping). The pending-sync chip is GONE from the chrome (Settings → Preferences
// owns offline-sync). The spec pins the new anatomy.
// S93 UPDATE: the to-do panel shows the QUADRANTS with TICKABLE checkbox rows
// (owner item 1), the Projects icon NAVIGATES to /projects.html AND opens its panel
// grouped by the 0060 stages (owner items 10 + 14), and the Dashboard icon is pure
// navigation (owner item 2 — its panel section + Jump-to list are retired).
//
// The two patterns under test:
//   1. MATERIAL "navigation rail" — a vertical icon rail fixed to the left edge:
//      icon + label per destination, the active section wears a filled
//      rounded-square indicator, secondary icons (Settings, Help) sit at the bottom
//      behind a thin divider.
//   2. VS CODE Activity Bar + Side Bar — selecting a rail icon opens a secondary
//      panel DIRECTLY to its right, populated with that section's items under
//      labeled COLLAPSIBLE group headers (quadrants for the to-do panel, stages for
//      the Projects panel, folders for the Ideas panel). The panel is PERSISTENT
//      (pushes main content via body padding — never an overlay), survives page
//      reloads, and Escape/the icon/✕ close it.
// Run: npx playwright test e2e/rail-panel.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-rail@test.local'
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
     VALUES ('${id}', 'e2e-rail', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // A couple of projects so the Projects panel has real rows to list (one DUE TODAY
  // so the Calendar panel's due dots have something to paint).
  db.exec(`DELETE FROM projects WHERE user_id = '${id}'`)
  const today = now.slice(0, 10)
  for (const [i, status] of ['developing', 'operational', 'spark'].entries()) {
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at)
       VALUES ('${id}-p${i}', '${id}', 'Rail project ${i}', '${status}', '${i === 0 ? today : null}', '${now}', '${now}')`,
    )
  }
  // S89: sadhana tasks in two quadrants (one DUE TODAY) so the to-do panel's
  // quadrant grouping + the calendar's todo dots have real rows to group.
  db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${id}'`)
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, due_date, done, position, created_at, updated_at)
     VALUES ('${id}-t1', '${id}', 1, 'Rail today task', '${today}', 0, 1, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, due_date, done, position, created_at, updated_at)
     VALUES ('${id}-t3', '${id}', 3, 'Rail urgent task', NULL, 0, 2, '${now}', '${now}')`,
  )
  // S94 (owner item 6): Rail project 0 (developing) carries one 'idea' + one 'bug'
  // dev task — its rail row grows the nested idea-group TREE branch (the new test
  // below pins it; the stage-head assertion scopes to non-sub groups so these
  // seeds don't disturb the S93 grouping pin).
  db.exec(`DELETE FROM dev_tasks WHERE project_id = '${id}-p0'`)
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${id}-dt1', '${id}-p0', 'Rail tree idea', 'idea', 'medium', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${id}-dt2', '${id}-p0', 'Rail tree bug', 'bug', 'high', 0, '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  // The first-visit tour overlay is a pointer-events wall — suppress it (the S85
  // recipe: BOTH suppression keys, tour + ln).
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
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
  // each test owns its panel state — cleared ONCE after login (NOT in the init
  // script: that re-runs on every reload and would wipe the persistence under test)
  await page.evaluate(() => { try { localStorage.removeItem('hibana-rail-panel') } catch { /* storage blocked */ } })
}

test.describe('the navigation rail (Material navigation-rail pattern, S89 labeled form)', () => {
  test('icon + label per destination, active = filled rounded square, secondary icons behind a divider', async ({ page }) => {
    await login(page)
    const rail = page.locator('nav.rail')
    await expect(rail).toBeVisible()

    // S89 LABELED rail: 5.5rem (88px) wide; every primary button renders a small
    // text label beneath its icon; the accessible name still rides aria-label.
    const railBox = await rail.boundingBox()
    expect(Math.round(railBox!.width)).toBe(88)
    const primary = page.locator('.rail .rail-primary a')
    // S89: canvas + notebook left the rail — 6 destinations (dashboard, to-do,
    // projects, ideas, notes, calendar).
    expect(await primary.count()).toBe(6)
    for (let i = 0; i < 6; i++) {
      const label = await primary.nth(i).getAttribute('aria-label')
      expect(label, `primary icon ${i} has an accessible name`).toBeTruthy()
      const text = (await primary.nth(i).innerText()).trim()
      expect(text.length, `primary icon ${i} shows its label`).toBeGreaterThan(0)
    }
    // The search button is labeled too (it sits above .rail-primary).
    const searchLabel = await page.locator('.rail .rail-search .rail-label').innerText()
    expect(searchLabel.trim().length).toBeGreaterThan(0)

    // The brand button wears the SQUARE logo pair (one per theme — CSS keeps one).
    expect(await page.locator('.rail-brand .themed-logo--light').count()).toBe(1)
    expect(await page.locator('.rail-brand .themed-logo--dark').count()).toBe(1)
    const lightVisible = await page.locator('.rail-brand .themed-logo--light').isVisible()
    const darkVisible = await page.locator('.rail-brand .themed-logo--dark').isVisible()
    expect(lightVisible !== darkVisible).toBe(true) // exactly one per theme

    // S89: the pending-sync chip is GONE from the chrome (Settings owns it).
    expect(await page.locator('.rail [data-sync-badge]').count()).toBe(0)

    // The active section (/app IS the dashboard) wears the filled indicator: the
    // button paints a background (the filled rounded square) + aria-current.
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).toHaveAttribute('aria-current', 'page')
    const bg = await dash.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    // S93 (owner item 2): the Dashboard icon is PURE NAVIGATION — no panel section
    // behind it (clicking it must SHOW the dashboard, not slide a sidebar).
    expect(await dash.getAttribute('data-rail-panel')).toBeNull()

    // Secondary icons (Settings, Help) live BELOW the divider at the rail's bottom.
    const divider = page.locator('.rail .rail-divider')
    await expect(divider).toBeVisible()
    const settings = page.locator('.rail a.rail-secondary[href="/settings.html"]')
    const help = page.locator('.rail [data-rail-help]')
    await expect(settings).toBeVisible()
    await expect(help).toBeVisible()
    await expect(help).toHaveAttribute('aria-label', /.+/)
    const dBox = await divider.boundingBox()
    const sBox = await settings.boundingBox()
    expect(sBox!.y).toBeGreaterThan(dBox!.y)
  })

  test('Canvas + Notebook live in the ACCOUNT menu (the rail does not rent them space)', async ({ page }) => {
    await login(page)
    // Not RAIL BUTTONS (the account-menu links inside .rail-user don't count —
    // they're menu items, not rail destinations).
    expect(await page.locator('.rail .rail-btn[href="/canvas.html"]').count()).toBe(0)
    expect(await page.locator('.rail .rail-btn[href="/whiteboard.html"]').count()).toBe(0)
    // Hovering the avatar opens the menu; Canvas + Notebook are items in it.
    await page.hover('.rail-user-chip')
    const pop = page.locator('.rail-user .user-menu-pop')
    await expect(pop).toBeVisible()
    await expect(pop.locator('a[href="/canvas.html"]')).toBeVisible()
    await expect(pop.locator('a[href="/whiteboard.html"]')).toBeVisible()
    // S89: the language quick rows are gone from the account menu too — language
    // is a Settings → Preferences choice (the one place).
    expect(await pop.locator('[data-lang-toggle]').count()).toBe(0)
  })

  test('≤1024px the rail hides; the slim brand bar (square logo) + bottom-tab nav carry the chrome', async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('nav.rail')).toBeHidden()
    await expect(page.locator('.rail-panel')).toBeHidden()
    await expect(page.locator('.mobile-brandbar .brand-logo-sq').first()).toBeVisible()
    await expect(page.locator('.mobile-nav')).toBeVisible()
    // S89: no sync button on the mobile brand bar either (Settings owns it).
    expect(await page.locator('.mobile-brandbar [data-sync-badge]').count()).toBe(0)
  })
})

test.describe('the secondary panel (VS Code Activity Bar + Side Bar pattern)', () => {
  test('the Projects icon navigates to the page AND opens the panel grouped by stage (S93 items 10+14)', async ({ page }) => {
    await login(page)
    // The main content's gutter = the labeled rail width before anything opens.
    const padBefore = await page.evaluate(() => getComputedStyle(document.body).paddingInlineStart)
    expect(padBefore).toBe('88px')

    // S93 (owner item 10): clicking the Projects icon NAVIGATES to /projects.html…
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    // …AND (owner item 14) opens the panel beside the rail, grouped by the 0060 stages.
    const panel = page.locator('[data-rail-panel-box]')
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail-panel-title')).toHaveText('Projects')

    // The panel sits directly beside the rail; the rail stays visible.
    const pBox = await panel.boundingBox()
    expect(Math.round(pBox!.x)).toBe(88)
    await expect(page.locator('nav.rail')).toBeVisible()

    // The main content is PUSHED (persistent body padding, not an overlay — the
    // 0.22s padding transition means the computed value must be polled, not read).
    await page.waitForFunction(() => parseInt(getComputedStyle(document.body).paddingInlineStart, 10) > 88, null, { timeout: 3_000 })

    // S93 (owner item 14 — the owner's sketch: "-planning / item one / -queued / …"):
    // groups = the 0060 stages; empty stages stay hidden; operational rides collapsed.
    // Seeds: one developing + one operational project. S94: the Developing project also
    // carries a nested idea-group branch — the STAGE heads are the non-sub groups
    // (.rail-sub-group heads are the project-level tree level, pinned by their own test).
    const groups = page.locator('.rail-group:not(.rail-sub-group) > .rail-group-head')
    const labels = await groups.allTextContents()
    expect(labels.map((l) => l.replace(/\d+$/, '').trim())).toEqual(['Developing', 'Operational'])
    // Real items with status dots (the seeded projects), deep-linking to their pages.
    await expect(page.locator('.rail-item').first()).toBeVisible()
    expect(await page.locator('.rail-item .rail-dot').count()).toBeGreaterThan(0)

    // Collapsible: collapsing a group hides its items.
    await page.click('.rail-group-head >> nth=0')
    await expect(page.locator('.rail-group').first()).toHaveClass(/is-collapsed/)
    await page.click('.rail-group-head >> nth=0') // re-open for the item test
    await expect(page.locator('.rail-group').first()).not.toHaveClass(/is-collapsed/)

    // An item click navigates (to the project page) and the panel STAYS OPEN with
    // the rail's active icon following the new page.
    await page.click('.rail-item >> nth=0')
    await page.waitForURL('**/project.html?id=*', { timeout: 10_000 })
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail .rail-primary a[data-rail-panel="projects"]')).toHaveAttribute('aria-current', 'page')

    // Escape closes (dialogs own their Escape first — none open here).
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.waitForFunction(() => getComputedStyle(document.body).paddingInlineStart === '88px', null, { timeout: 3_000 })
  })

  test('the projects panel grows the deeper idea-group TREE under each project (S94 item 6)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    const panel = page.locator('[data-rail-panel-box]')
    await expect(panel).toBeVisible()

    // The developing project's row is intact and still deep-links to its page…
    const row = page.locator('.rail-item', { hasText: 'Rail project 0' }).first()
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('href', /\/project\.html\?id=.+$/)
    // S95 (at-a-glance triage): the row wears a PROBLEMS count pill (one seeded
    // bug) — scannable without expanding anything.
    const bugBadge = row.locator('.rail-item-badge')
    await expect(bugBadge).toHaveText('1')
    await expect(bugBadge).toHaveAttribute('aria-label', '1 Problems')

    // …and directly under it grows the nested branch: TWO collapsible idea-groups
    // ("New ideas" + "Problems" — the project page's progress-box vocabulary), each
    // counting its items, tree-indented one level deeper than the stage rows.
    const subs = page.locator('.rail-sub-group')
    await expect(subs).toHaveCount(2)
    const heads = subs.locator('.rail-group-head')
    await expect(heads.nth(0)).toContainText('New ideas')
    await expect(heads.nth(1)).toContainText('Problems')
    await expect(heads.nth(0).locator('.rail-group-count')).toHaveText('1')
    await expect(heads.nth(1).locator('.rail-group-count')).toHaveText('1')

    // The sub-groups ship COLLAPSED (the panel stays a scannable summary) — the
    // same [data-rail-group] toggle contract the stage heads use.
    await expect(subs.nth(0)).toHaveClass(/is-collapsed/)
    // Expanding reveals the task rows, deep-linking to the project's own page AT
    // the section where that work lives (S95): ideas → the progress board
    // (#pd-board), bugs → the exact problems panel (#detail-problems).
    await heads.nth(0).click()
    await expect(subs.nth(0)).not.toHaveClass(/is-collapsed/)
    const taskRow = subs.nth(0).locator('.rail-item')
    await expect(taskRow).toContainText('Rail tree idea')
    await expect(taskRow).toHaveAttribute('href', /\/project\.html\?id=.+#pd-board$/)
    await heads.nth(1).click()
    const bugRow = subs.nth(1).locator('.rail-item')
    await expect(bugRow).toContainText('Rail tree bug')
    await expect(bugRow).toHaveAttribute('href', /\/project\.html\?id=.+#detail-problems$/)
    // The tree indent compounds: the sub-group body sits deeper than the stage body
    // (the S91 tree-guide anatomy — 0.8rem per NESTED level; the relative margin is
    // the same on both, the absolute depth comes from the nesting, so the x-position
    // of each body's guide is the honest measurement).
    const stageBodyX = await page.locator('.rail-group:not(.rail-sub-group) > .rail-group-body').first().evaluate((el) => el.getBoundingClientRect().x)
    const subBodyX = await subs.nth(0).locator('.rail-group-body').evaluate((el) => el.getBoundingClientRect().x)
    expect(subBodyX).toBeGreaterThan(stageBodyX + 8)

    // A task-row click navigates to the project page, the panel STAYS OPEN (the
    // same persistence contract as the stage rows above), the leaf's SECTION
    // anchor rides the URL, the page LANDS on the board (S95: the htmx-swept
    // target is watched for + scrolled, scroll-margin clearing the topbar) and
    // the current-location marks light BOTH the project row and the exact leaf.
    await taskRow.click()
    await page.waitForURL(/project\.html\?id=.+#pd-board$/, { timeout: 10_000 })
    await expect(panel).toBeVisible()
    await page.waitForFunction(() => {
      const b = document.querySelector('#pd-board')
      return !!b && b.getBoundingClientRect().top < 220
    }, null, { timeout: 10_000 })
    await expect(page.locator('.rail-item.is-row-active', { hasText: 'Rail project 0' })).toHaveClass(/is-row-active/)
    await expect(page.locator('.rail-item.is-row-active', { hasText: 'Rail tree idea' })).toHaveClass(/is-row-active/)

    // The «Problems» leaf (a hash-only soft nav from the same project page):
    // #detail-problems OPENS the problems tab (the panels ship hidden — the
    // page's hash boot un-hides + scrolls it) and its row joins the marks.
    await bugRow.click()
    await page.waitForURL(/project\.html\?id=.+#detail-problems$/, { timeout: 10_000 })
    await expect(page.locator('[data-detail-tab="problems"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#detail-problems')).toBeVisible()
    await expect(page.locator('.rail-item.is-row-active', { hasText: 'Rail tree bug' })).toHaveClass(/is-row-active/)
  })

  test('the Dashboard icon NAVIGATES — it never opens a panel (S93 item 2)', async ({ page }) => {
    await login(page)
    await page.goto('/projects.html')
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
    await page.click('.rail .rail-primary a[href="/dashboard.html"]')
    await page.waitForURL('**/dashboard.html', { timeout: 10_000 })
    // The main area changed (the dashboard renders) and NO sidebar slid out.
    await expect(page.locator('main.shell')).toBeVisible()
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
    await page.waitForTimeout(300)
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
  })

  test('clicking the open section\'s icon toggles the panel closed; switching icons swaps sections', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')

    // Same icon again → closed (the toggle rides a non-navigating icon — the
    // Projects icon always re-navigates by design).
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()

    // A different icon swaps the panel's section (rail never hides).
    await page.click('.rail .rail-primary a[data-rail-panel="sparks"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Ideas')
    await expect(page.locator('nav.rail')).toBeVisible()
  })

  test('the to-do panel shows the QUADRANTS with TICKABLE checkbox rows (S93 item 1)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')
    // Group heads: the default quadrant labels in the user's order
    // (1 Today, 3 Urgent, 2 Strategic, 4 Personal) — every item is a CHECKBOX row.
    const labels = (await page.locator('.rail-group-head').allTextContents()).map((l) => l.replace(/\d+$/, '').trim())
    expect(labels).toContain('Today')
    expect(labels).toContain('Urgent & High Value')
    // The quadrant-3 task rides its quadrant group.
    const q3 = page.locator('.rail-group', { hasText: 'Urgent & High Value' }).locator('.rail-todo-item')
    await expect(q3).toHaveCount(1)
    await expect(q3).toContainText('Rail urgent task')
    // …and it carries a real checkbox (the owner can DIRECTLY tick it).
    const box = q3.locator('input[data-rail-todo]')
    await expect(box).toBeVisible()
    await expect(box).not.toBeChecked()
    // Ticking completes the task: the row strikes + sinks (is-done), the checkbox
    // stays checked — the POST hits the real /complete endpoint.
    await box.check()
    await expect(q3).toHaveClass(/is-done/)
    await expect(box).toBeChecked()
    // Un-ticking reopens it.
    await box.uncheck()
    await expect(q3).not.toHaveClass(/is-done/)
    await expect(box).not.toBeChecked()
  })

  test('the calendar panel renders a real month grid — today ring, due dots, ‹ › stepping', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="calendar"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Calendar')

    // The month grid: weekday header + day cells; the title names the current
    // Gregorian month (the test user's calendar_pref is gregorian + lang en).
    const title = await page.locator('.rail-cal-title').innerText()
    const now = new Date()
    const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][now.getMonth()]
    expect(title).toContain(monthName)
    expect(title).toContain(String(now.getFullYear()))
    expect(await page.locator('.rail-cal-dow').count()).toBe(7)

    // Today wears the ring; the seeded due-today project + task paint dots.
    await expect(page.locator('.rail-cal-day.is-today')).toBeVisible()
    expect(await page.locator('.rail-cal-dots i').count()).toBeGreaterThanOrEqual(1)

    // ‹ › steps the month (zero extra requests — the cached payload re-renders).
    await page.click('[data-rail-cal-nav="1"]')
    await expect(page.locator('.rail-cal-title')).not.toContainText(monthName)
    await page.click('[data-rail-cal-nav="-1"]')
    await expect(page.locator('.rail-cal-title')).toContainText(monthName)

    // A day cell soft-navigates to the full Calendar page.
    await page.click('.rail-cal-day.is-today')
    await page.waitForURL('**/calendar.html', { timeout: 10_000 })
  })

  test('the Ideas panel: an idea item opens THE IDEA ITSELF — its own page, never the folder shelf (S92)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="sparks"]')
    const panel = page.locator('[data-rail-panel-box]')
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail-panel-title')).toHaveText('Ideas')

    // The seeded spark ('Rail project 2', status=spark, no folder) rides Unfiled.
    const item = page.locator('.rail-group', { hasText: 'Unfiled' }).locator('.rail-item', { hasText: 'Rail project 2' })
    await expect(item).toHaveCount(1)

    // S92 (owner report): the row deep-links to the spark's OWN page — the same
    // destination a spark card uses on the Ideas page — not the bare /sparks.html
    // folder shelf the row used to dump you on.
    await expect(item).toHaveAttribute('href', /^\/project\.html\?id=.+/)

    await item.click()
    await page.waitForURL(/\/project\.html\?id=.+/, { timeout: 10_000 })
    // The idea itself is on screen: its title heads its own detail page.
    await expect(page.locator('#pd-title')).toContainText('Rail project 2')
    // The S88 contract holds: the panel stays open across the soft navigation.
    await expect(panel).toBeVisible()
  })

  test('the panel persists across a page reload (localStorage restore)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="notes"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Notes')
    await page.reload()
    await page.waitForSelector('[data-rail-panel-box]:not([hidden])', { timeout: 10_000 })
    await expect(page.locator('.rail-panel-title')).toHaveText('Notes')
    // …and closes cleanly after the restore.
    await page.click('.rail .rail-primary a[data-rail-panel="notes"]')
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
  })

  test('a stale persisted canvas/notebook/dashboard panel key is ignored (their sections are retired)', async ({ page }) => {
    await login(page)
    await page.evaluate(() => { try { localStorage.setItem('hibana-rail-panel', 'dashboard') } catch { /* storage blocked */ } })
    await page.reload()
    await page.waitForSelector('nav.rail', { timeout: 10_000 })
    // The retired section never renders its panel — the stale key fails the
    // RAIL_SECTIONS lookup and is ignored (S93 retired the dashboard section too).
    await page.waitForTimeout(400)
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
  })
})

test.describe('offline sync lives in Settings (S89: it left the chrome)', () => {
  test('Settings → Preferences carries the sync status row + retry chip; the chrome has none', async ({ page }) => {
    await login(page)
    await page.goto('/settings.html')
    await expect(page.locator('.settings-sync-row')).toBeVisible()
    await expect(page.locator('[data-sync-status]')).toBeVisible()
    // The always-honest idle line paints from the queue (zero captures → synced).
    await expect(page.locator('[data-sync-status]')).toContainText(/synced/i)
    // The retry chip is hidden while the queue is empty.
    await expect(page.locator('.settings-sync-row [data-sync-badge]')).toBeHidden()
  })
})
