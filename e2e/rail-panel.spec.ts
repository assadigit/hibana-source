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
// S113: the seeded user's id (set in beforeAll) — the all-clear test restores the
// tasks it ticks via the same /uncomplete API the panel's Undo speaks.
let seedUserId = ''

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
  seedUserId = id
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
  // S99: a second dated to-do (Q2, due TOMORROW) — the Coming-up rows land on
  // their quadrant, and the to-do panel grows its THIRD quadrant group (the
  // goto-chip test pins three chips on it).
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, due_date, done, position, created_at, updated_at)
     VALUES ('${id}-t2', '${id}', 2, 'Rail strategic task', '${tomorrow}', 0, 3, '${now}', '${now}')`,
  )
  // S113 (owner, URGENT): a DONE task in Q4 — the sidebar shows OPEN work only, so
  // this row must NEVER ride the panel and the Q4-only-done group folds away
  // entirely (the goto-chip count stays three).
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, due_date, done, position, created_at, updated_at)
     VALUES ('${id}-t4', '${id}', 4, 'Rail finished task', NULL, 1, 4, '${now}', '${now}')`,
  )
  // S94 (owner item 6) + S95 r2 (owner item 1): Rail project 0 (developing) carries
  // one 'idea' + one 'bug' + one 'planned' dev task — its rail row grows the nested
  // box TREE branch (every board box with ≥1 item shows; the new test below pins
  // it; the stage-head assertion scopes to non-sub groups so these seeds don't
  // disturb the S93 grouping pin).
  db.exec(`DELETE FROM dev_tasks WHERE project_id = '${id}-p0'`)
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${id}-dt1', '${id}-p0', 'Rail tree idea', 'idea', 'medium', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${id}-dt2', '${id}-p0', 'Rail tree bug', 'bug', 'high', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('${id}-dt3', '${id}-p0', 'Rail tree plan', 'planned', 'low', 0, '${now}')`,
  )
  // S115 r2 (owner, the sidebar sketch): a spark FOLDER carrying one filed idea —
  // the Ideas panel ships folders COLLAPSED until clicked (the Unfiled inbox stays
  // open — it is the capture surface, not a folder). The S92 pin (the unfiled spark
  // rides Unfiled) stays intact beside it.
  db.exec(`DELETE FROM spark_folders WHERE user_id = '${id}'`)
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, sort_order, created_at)
     VALUES ('${id}-f1', '${id}', 'Rail idea folder', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, status, folder_id, created_at, updated_at)
     VALUES ('${id}-p3', '${id}', 'Rail filed idea', 'spark', '${id}-f1', '${now}', '${now}')`,
  )
  // S131 (owner: "clicking the Ideas icon must show all ideas folders"): an EMPTY
  // folder rides beside the filed one — the panel must list EVERY folder, the
  // zero-item groups included (the old render silently dropped empty folders,
  // so a brand-new folder never showed until it held its first idea).
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, sort_order, created_at)
     VALUES ('${id}-f2', '${id}', 'Rail empty folder', 1, '${now}')`,
  )
  // S100: Rail project 1 becomes a CLIENT project carrying one dated checklist
  // task (the tasks table's only writer is the clients UI) — the Coming-up
  // list's client rows deep-link to /clients.html#task-<id> (the projects query
  // doesn't filter type, so no pinned count moves).
  db.exec(`UPDATE projects SET type = 'client' WHERE id = '${id}-p1'`)
  db.exec(`DELETE FROM tasks WHERE project_id = '${id}-p1'`)
  db.exec(
    `INSERT INTO tasks (id, project_id, title, done, due_date, created_at)
     VALUES ('${id}-ct1', '${id}-p1', 'Rail client task', 0, '${today}', '${now}')`,
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
    // S132: Canvas returned to the rail — 7 destinations (dashboard, to-do,
    // projects, ideas, notes, calendar, canvas — canvas directly BELOW calendar).
    expect(await primary.count()).toBe(7)
    for (let i = 0; i < 7; i++) {
      const label = await primary.nth(i).getAttribute('aria-label')
      expect(label, `primary icon ${i} has an accessible name`).toBeTruthy()
      const text = (await primary.nth(i).innerText()).trim()
      expect(text.length, `primary icon ${i} shows its label`).toBeGreaterThan(0)
    }
    // S132 (owner placement): the Canvas button sits directly BELOW Calendar and is
    // PURE NAVIGATION — no data-rail-panel (the S89/S90 panel section stays retired).
    const calBtn = page.locator('.rail .rail-primary a[href="/calendar.html"]')
    const canvasBtn = page.locator('.rail .rail-primary a[href="/canvas.html"]')
    const calBox = await calBtn.boundingBox()
    const canvasBox = await canvasBtn.boundingBox()
    expect(canvasBox!.y).toBeGreaterThan(calBox!.y)
    expect(await canvasBtn.getAttribute('data-rail-panel')).toBeNull()
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
    // S95 r2 (owner item 4): the ONE active pattern is the SOLID --cta pill —
    // #2E7B7F (rgb 46 123 127) with white icon+label ink, and NO lead bar on the
    // rail-facing edge (the ::before geometry is gone entirely). toHaveCSS /
    // expect.poll RETRY (a plain read raced the cold server's sheet load once).
    await expect(dash).toHaveCSS('background-color', 'rgb(46, 123, 127)')
    await expect(dash).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect.poll(async () => dash.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none')
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

  test('Canvas is a rail destination again; only Notebook stays an ACCOUNT-menu item (S132)', async ({ page }) => {
    await login(page)
    // S132 (owner): Canvas is a rail button (below Calendar) — and the account menu
    // stops duplicating it (the S90 one-home rule). Notebook is NOT a rail button —
    // the account menu keeps its row (menu items inside .rail-user don't count as
    // rail destinations).
    expect(await page.locator('.rail .rail-btn[href="/whiteboard.html"]').count()).toBe(0)
    // Hovering the avatar opens the menu; Notebook is a row in it, Canvas is not.
    await page.hover('.rail-user-chip')
    const pop = page.locator('.rail-user .user-menu-pop')
    await expect(pop).toBeVisible()
    expect(await pop.locator('a[href="/canvas.html"]').count()).toBe(0)
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
    // Seeds: one developing + one operational project. S115 r2: the Developing project
    // also carries a per-project collapsible BRANCH — the STAGE heads are the non-sub,
    // non-project groups (each tree level is pinned by its own test below).
    const groups = page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head')
    const labels = await groups.allTextContents()
    expect(labels.map((l) => l.replace(/\d+$/, '').trim())).toEqual(['Developing', 'Operational'])
    // Real items with status dots (the seeded projects), deep-linking to their pages.
    // S115 r2: the Developing project is a collapsed BRANCH (its leaves stay hidden
    // until the title is clicked) — the visible plain row is the task-less
    // Operational project.
    await expect(page.locator('.rail-item.rail-project-row', { hasText: 'Rail project 1' })).toHaveCount(1)
    expect(await page.locator('.rail-item .rail-dot').count()).toBeGreaterThan(0)

    // Collapsible: collapsing a group hides its items.
    await page.click('.rail-group-head >> nth=0')
    await expect(page.locator('.rail-group').first()).toHaveClass(/is-collapsed/)
    await page.click('.rail-group-head >> nth=0') // re-open for the item test
    await expect(page.locator('.rail-group').first()).not.toHaveClass(/is-collapsed/)

    // An item click navigates (to the project page) and the panel STAYS OPEN with
    // the rail's active icon following the new page. S115 r2: the Developing project
    // is a collapsed BRANCH now, so the clicked row is the task-less Operational
    // project (a plain link) — expand its stage first (it ships collapsed).
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    await page.locator('.rail-item.rail-project-row', { hasText: 'Rail project 1' }).click()
    await page.waitForURL('**/project.html?id=*', { timeout: 10_000 })
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail .rail-primary a[data-rail-panel="projects"]')).toHaveAttribute('aria-current', 'page')

    // Escape closes (dialogs own their Escape first — none open here).
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.waitForFunction(() => getComputedStyle(document.body).paddingInlineStart === '88px', null, { timeout: 3_000 })
  })

  test('the projects panel: each project COLLAPSES its aspects until its title is clicked (S115 r2, owner)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    const panel = page.locator('[data-rail-panel-box]')
    await expect(panel).toBeVisible()

    // Rail project 0 (developing, carries 3 board tasks) renders a per-project
    // BRANCH — a toggle HEAD, not a link — wearing the bold name and the status
    // dot, and shipping COLLAPSED: the owner's sketch is "collapsed, and only
    // shown when user clicks on the project title".
    const branch = page.locator('.rail-project-group').first()
    await expect(branch).toHaveClass(/is-collapsed/)
    const head = branch.locator('.rail-project-head')
    await expect(head).toContainText('Rail project 0')
    await expect(head.locator('.rail-dot')).toHaveAttribute('data-status', 'developing')
    // S125 (owner): the problems COUNT pill is retired from the rail rows — the
    // glance reads names only; problems live in the dashboard's Problems box and
    // the branch's own Problems sub-group below.
    await expect(head.locator('.rail-item-badge')).toHaveCount(0)
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    // The aspect sub-groups exist but sit hidden behind the fold — the panel reads
    // stage → PROJECT NAME and nothing else until the title is clicked.
    await expect(branch.locator('.rail-sub-group')).toHaveCount(3)
    await expect(branch.locator('.rail-sub-group').first()).toBeHidden()
    await expect(page.locator('.rail-item', { hasText: 'Rail tree idea' })).toBeHidden()

    // …a click on the TITLE expands the collapsible menu…
    await head.click()
    await expect(branch).not.toHaveClass(/is-collapsed/)
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    // …revealing the three aspect groups in the BOARD's column order, each FOLDED
    // in turn, counting its items.
    const subs = branch.locator('.rail-sub-group')
    await expect(subs.first()).toBeVisible()
    const subLabels = await subs.locator('.rail-group-head').allTextContents()
    expect(subLabels.map((l) => l.replace(/\d+$/, '').trim())).toEqual(['New ideas', 'Problems', 'Plans'])
    await expect(subs.nth(0)).toHaveClass(/is-collapsed/)

    // A second click folds the branch back; a third re-opens for the leaf test.
    await head.click()
    await expect(branch).toHaveClass(/is-collapsed/)
    await head.click()
    await expect(branch).not.toHaveClass(/is-collapsed/)

    // A leaf deep-links to the EXACT box where the work lives (the S95 contract
    // survives inside the branch): Problems → the problems panel.
    await subs.nth(1).locator('.rail-group-head').click()
    const bugRow = subs.nth(1).locator('.rail-item')
    await expect(bugRow).toContainText('Rail tree bug')
    await expect(bugRow).toHaveAttribute('href', /\/project\.html\?id=.+#detail-problems$/)

    // The ↗ goto chip (the head's sibling — expansion and navigation don't fight
    // over one click) keeps the S89 deep link: it opens the project's page with
    // the panel staying open, and the branch you are ON wears the current-location
    // mark (.is-here).
    await branch.locator('.rail-group-goto').click()
    await page.waitForURL(/project\.html\?id=.+$/, { timeout: 10_000 })
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail-project-group.is-here').first()).toBeVisible()

    // A project with NO board tasks (Rail project 1) stays a plain LINK row —
    // nothing to expand, so the click opens the project itself. The Operational
    // stage ships folded (S93), so expand it first to reveal the plain row.
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'Rail project 1' })
    await expect(plain).toBeVisible()
    await expect(plain).toHaveAttribute('href', /\/project\.html\?id=.+$/)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  // S97 (the tree fold): one button in the panel head collapses/expands EVERY
  // group — the seeded projects tree (S115 r2: two stage groups + one project
  // branch + its three aspect sub-groups) folds and unfolds in one tap, the
  // button's label/icon/aria flipping with the state.
  test('the panel head\'s TREE FOLD collapses/expands every group (S97)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    await expect(page.locator('.rail-panel-title')).toHaveText('Projects')

    // The seeded tree: Developing (open) + Operational (collapsed by design) at the
    // stage level; the Developing project's BRANCH ships collapsed (S115 r2) with
    // its three aspect sub-groups folded inside → 6 groups, 5 folded.
    await expect(page.locator('.rail-group')).toHaveCount(6)
    await expect(page.locator('.rail-group.is-collapsed')).toHaveCount(5)

    // The button mirrors the state: not everything folded → it offers Collapse
    // all (a DOWN chevron — the same "the content lives below" glyph the group
    // heads speak).
    const btn = page.locator('[data-rail-tree]')
    await expect(btn).toHaveAttribute('aria-label', 'Collapse all')
    await expect(btn).toHaveAttribute('title', 'Collapse all')
    expect(await btn.locator('.icon path').evaluate((el) => el.getAttribute('d'))).toBe('m6 15 6 6 6-6')

    // One tap folds the lot — every group collapsed, every head's aria follows.
    await btn.click()
    await expect(page.locator('.rail-group.is-collapsed')).toHaveCount(6)
    await expect(page.locator('.rail-group-head[aria-expanded="false"]')).toHaveCount(6)

    // The button flipped: Expand all — label + title + the i18n key + the UP icon.
    await expect(btn).toHaveAttribute('aria-label', 'Expand all')
    await expect(btn).toHaveAttribute('data-i18n-aria-label', 'rail.expandAll')
    expect(await btn.locator('.icon path').evaluate((el) => el.getAttribute('d'))).toBe('m6 9 6-6 6 6')

    // The other direction: everything back open (the operational stage's default
    // collapsed state loses to the explicit expand — the button is the boss).
    await btn.click()
    await expect(page.locator('.rail-group:not(.is-collapsed)')).toHaveCount(6)
    await expect(page.locator('.rail-group-head[aria-expanded="true"]')).toHaveCount(6)
    await expect(btn).toHaveAttribute('aria-label', 'Collapse all')
  })

  // S98 (the goto chips): every quadrant group head in the to-do panel carries an
  // "open on the board ↗" chip landing ON that exact quadrant — the head rides a
  // flex row (the toggle contract untouched), and the chip navigates with the
  // arrival mark on the exact quadrant only.
  test('the to-do panel\'s quadrant groups carry GOTO CHIPS landing on the board (S98)', async ({ page }) => {
    await login(page)
    await page.goto('/projects.html')
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')

    // THREE quadrant groups carry tasks (Q1 today, Q3 urgent, Q2 strategic — Q4's
    // only task is DONE so the group stays hidden, S113 open-work-only) → exactly
    // three chips, in the panel's quadrant order.
    const chips = page.locator('.rail-group-goto')
    await expect(chips).toHaveCount(3)
    await expect(chips.nth(0)).toHaveAttribute('href', '/to-do-list#Q1')
    await expect(chips.nth(1)).toHaveAttribute('href', '/to-do-list#Q3')
    await expect(chips.nth(2)).toHaveAttribute('href', '/to-do-list#Q2')
    // The chip speaks: aria-label + title (EN here; FA under the fa locale).
    await expect(chips.nth(0)).toHaveAttribute('aria-label', 'Open on the board')
    await expect(chips.nth(0)).toHaveAttribute('title', 'Open on the board')

    // The toggle contract SURVIVES the headrow: the head still collapses its
    // group (an <a> can never nest in a <button> — the row keeps them siblings),
    // and the chevron rotation works through the headrow path. The quadrant
    // groups ship EXPANDED — the first click folds, the second reopens.
    const head = page.locator('.rail-group-headrow .rail-group-head').first()
    await head.click()
    await expect(page.locator('.rail-group').first()).toHaveClass(/is-collapsed/)
    await head.click()
    await expect(page.locator('.rail-group').first()).not.toHaveClass(/is-collapsed/)

    // The chip's navigation lands ON its quadrant with the arrival mark — and
    // ONLY that quadrant (the sibling boxes stay clean).
    await chips.nth(2).click()
    await page.waitForURL(/to-do-list#Q2$/, { timeout: 15_000 })
    await expect(page.locator('#Q2')).toHaveClass(/q-arrived/)
    await expect(page.locator('#Q1')).not.toHaveClass(/q-arrived/)
    await expect(page.locator('#Q3')).not.toHaveClass(/q-arrived/)
  })

  // S97 (the deep-link arrival): a #Q<id> landing marks THAT quadrant — the
  // accent frame + ring flash pin which box you arrived on; the sibling
  // quadrants stay neutral, the target scrolls into view.
  test('a #Q<id> deep link lands ON the quadrant with the arrival mark (S97)', async ({ page }) => {
    await login(page)
    await page.goto('/to-do-list#Q3')
    await page.waitForSelector('#Q3', { timeout: 15_000 })
    // The mark rides the exact target only.
    await expect(page.locator('#Q3')).toHaveClass(/q-arrived/)
    await expect(page.locator('#Q1')).not.toHaveClass(/q-arrived/)
    await expect(page.locator('#Q3')).toBeInViewport()
    // Accent vs neutral computed borders — the border-color TRANSITION means the
    // computed style lags one beat (the documented race): wait for the DIVERGENCE.
    await page.waitForFunction(() => {
      const a = document.querySelector('#Q3.q-arrived')
      const n = document.querySelector('#Q1')
      return !!a && !!n && getComputedStyle(a).borderColor !== getComputedStyle(n).borderColor
    }, null, { timeout: 10_000 })
  })

  // S99 (the Coming-up deep links): the calendar panel's dated to-do rows land
  // ON their quadrant instead of the board top; project deadlines keep their
  // project-page hrefs (the project top IS the work's home).
  test('the calendar panel\'s Coming-up rows land on their QUADRANT (S99)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="calendar"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Calendar')

    // The seeded dated to-dos deep-link to their own quadrants…
    const today = page.locator('.rail-item', { hasText: 'Rail today task' }).first()
    await expect(today).toBeVisible()
    await expect(today).toHaveAttribute('href', /\/to-do-list#Q1$/)
    const strategic = page.locator('.rail-item', { hasText: 'Rail strategic task' }).first()
    await expect(strategic).toBeVisible()
    await expect(strategic).toHaveAttribute('href', /\/to-do-list#Q2$/)
    // …while the seeded project deadline keeps its project-page href.
    const deadline = page.locator('.rail-item', { hasText: 'Rail project 0' }).first()
    await expect(deadline).toBeVisible()
    await expect(deadline).toHaveAttribute('href', /\/project\.html\?id=.+$/)

    // The landing flow: the Q2 row lands the board ON its quadrant, marked.
    await strategic.click()
    await page.waitForURL(/to-do-list#Q2$/, { timeout: 15_000 })
    await expect(page.locator('#Q2')).toHaveClass(/q-arrived/)
    await expect(page.locator('#Q1')).not.toHaveClass(/q-arrived/)
  })

  // S100 (the client-task deep links): the Coming-up CLIENT-CHECKLIST rows land
  // ON their own checklist item (the old project-page href pointed at a page
  // that never renders those rows — a genuine never-lose-your-place violation).
  test('the Coming-up client-task rows land ON their own checklist item (S100)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="calendar"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('Calendar')

    // The seeded client task rides with its own checklist anchor.
    const row = page.locator('.rail-item', { hasText: 'Rail client task' }).first()
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('href', /\/clients\.html#task-.+$/)

    // The landing flow: a SOFT navigation to /clients.html#task-<id> — the
    // checklist ships inside a COLLAPSED <details> whose body arrives via the
    // #client-body htmx sweep; the hash consumer opens the details, marks the
    // exact row (.q-arrived), and scrolls it into view.
    await row.click()
    await page.waitForURL(/clients\.html#task-.+$/, { timeout: 10_000 })
    await expect.poll(async () => page.evaluate(() => {
      const el = document.querySelector('.hurdle.q-arrived')
      const details = el ? el.closest('details') : null
      return !!(el && details && details.open)
    }), { timeout: 10_000 }).toBe(true)
    const marked = page.locator('.hurdle.q-arrived')
    await expect(marked).toHaveCount(1)
    await expect(marked).toContainText('Rail client task')
    await expect(marked).toBeInViewport()
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

  test('the To-do icon NAVIGATES to /to-do-list (S95 r2 item 3) — its tickable panel rides along', async ({ page }) => {
    await login(page)
    await page.goto('/projects.html')
    // To-do carries data-rail-nav now (the Projects pattern): the click opens the
    // panel AND lands on the to-do-list page (a hard page — the panel restores
    // from localStorage on its boot, beside the board).
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await page.waitForURL('**/to-do-list', { timeout: 15_000 })
    await page.waitForSelector('nav.rail', { timeout: 10_000 })
    // The To-do icon is the current page's pill, and the panel restored beside it.
    const todoIcon = page.locator('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(todoIcon).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')
    // One active pattern: the Dashboard icon carries NO pill while To-do is current.
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    await expect(dash).not.toHaveAttribute('aria-current', 'page')
    await expect(dash).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })

  test('the Notes module collapses the rail to an ICON RAIL (S95 r2 item 9)', async ({ page }) => {
    await login(page)
    // Open the projects panel first — entering the Notes module must close it
    // (the module's own 3-pane sidebar owns the space beside the rail).
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()

    // Enter the Notes module directly (the Notes ICON opens its panel from other
    // pages — VS Code semantics; the module page itself is the icon-rail state).
    await page.goto('/notes.html')
    await page.waitForSelector('.vault-tree', { timeout: 10_000 })
    await expect(page.locator('body')).toHaveClass(/rail-icons-only/)
    const labelDisplay = await page.locator('.rail .rail-label').first().evaluate((el) => getComputedStyle(el).display)
    expect(labelDisplay).toBe('none')
    await page.waitForFunction(() => getComputedStyle(document.body).paddingInlineStart === '64px', null, { timeout: 5_000 })
    // The panel closed with the entry (nothing doubles the module's own sidebar).
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()
    // The module's own sidebar still carries full labels.
    await expect(page.locator('.vault-tree')).toBeVisible()

    // Leaving the module restores the labeled rail (Dashboard icon is a plain
    // navigation link — no panel semantics to suppress).
    await page.click('.rail .rail-primary a[href="/dashboard.html"]')
    await page.waitForURL('**/dashboard.html', { timeout: 10_000 })
    await expect(page.locator('body')).not.toHaveClass(/rail-icons-only/)
    const labelBack = await page.locator('.rail .rail-label').first().evaluate((el) => getComputedStyle(el).display)
    expect(labelBack).not.toBe('none')
    await page.waitForFunction(() => getComputedStyle(document.body).paddingInlineStart === '88px', null, { timeout: 5_000 })

    // Projects clicked FROM a module page still arrives with its tree: on the icon
    // rail the nav icons remember their panel for the destination.
    await page.goto('/notes.html')
    await page.waitForSelector('.vault-tree', { timeout: 10_000 })
    await expect(page.locator('body')).toHaveClass(/rail-icons-only/)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForURL('**/projects.html', { timeout: 10_000 })
    await expect(page.locator('body')).not.toHaveClass(/rail-icons-only/)
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
    await expect(page.locator('.rail-panel-title')).toHaveText('Projects')
  })

  test('every panel icon NAVIGATES now — Notes joins (S133); switching icons swaps sections', async ({ page }) => {
    await login(page)
    // S133 (owner, "It must open the notebooks, currently it only opens the
    // sidebar"): the Notes icon joins the navigators — the click lands on
    // /notes.html (the S105 Calendar / S115 Ideas one-attribute pattern). With
    // every section navigating, the re-click toggle path retires: the panel's
    // ✕ + Escape own the close contract (pinned in the reload test below).
    await page.click('.rail .rail-primary a[data-rail-panel="notes"]')
    await page.waitForURL('**/notes.html', { timeout: 10_000 })
    // The Notes MODULE page owns the sidebar space there (S95 r2 item 9): the
    // rail collapses to icons and the panel box stays hidden — the vault tree
    // IS the notes sidebar.
    await expect(page.locator('body')).toHaveClass(/rail-icons-only/)
    await expect(page.locator('[data-rail-panel-box]')).toBeHidden()

    // A navigating icon swaps the panel's section on its destination (the rail
    // itself never hides) — from the module page, the remembered panel restores.
    await page.click('.rail .rail-primary a[data-rail-panel="sparks"]')
    await page.waitForURL('**/sparks.html', { timeout: 10_000 })
    await expect(page.locator('.rail-panel-title')).toHaveText('Ideas')
    await expect(page.locator('nav.rail')).toBeVisible()
  })

  test('the to-do panel shows the QUADRANTS with TICKABLE checkbox rows (S93 item 1) — and a tick REMOVES the row (S113, owner urgent)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')
    // Group heads: the default quadrant labels in the user's order
    // (1 Today, 3 Urgent, 2 Strategic, 4 Personal) — every item is a CHECKBOX row.
    // (S99 flake hardening: these were one-shot allTextContents reads that raced
    // the async /api/rail fetch in warm full-suite runs — auto-retrying
    // visibility assertions now, the documented S94 "flaky-pass on retry" class.)
    await expect(page.locator('.rail-group-head', { hasText: 'Today' })).toBeVisible()
    await expect(page.locator('.rail-group-head', { hasText: 'Urgent & High Value' })).toBeVisible()
    // S113: the sidebar shows OPEN work only — the done task never rides the panel
    // and the Q4-only-done group folds away entirely.
    await expect(page.locator('.rail-group-head', { hasText: 'Personal & Sentimental' })).toHaveCount(0)
    await expect(page.locator('.rail-todo-item', { hasText: 'Rail finished task' })).toHaveCount(0)
    // The quadrant-3 task rides its quadrant group.
    const q3 = page.locator('.rail-group', { hasText: 'Urgent & High Value' }).locator('.rail-todo-item')
    await expect(q3).toHaveCount(1)
    await expect(q3).toContainText('Rail urgent task')
    // …and it carries a real checkbox (the owner can DIRECTLY tick it).
    const box = q3.locator('input[data-rail-todo]')
    await expect(box).toBeVisible()
    await expect(box).not.toBeChecked()
    // Ticking completes the task AND REMOVES the row — done work leaves the
    // sidebar (the POST hits the real /complete endpoint; the fold is ~360ms).
    await box.check()
    await expect(page.locator('.rail-todo-item', { hasText: 'Rail urgent task' })).toHaveCount(0)
    // The emptied group folds away with its last row…
    await expect(page.locator('.rail-group-head', { hasText: 'Urgent & High Value' })).toHaveCount(0)
    // …while the OTHER groups' counts keep tracking their open rows (Today: 1).
    await expect(page.locator('.rail-group', { hasText: 'Today' }).locator('.rail-group-count')).toHaveText('1')
    // The toast announces the completion and its UNDO brings the task back (an
    // accidental tick is one tap from recovery — never lose your place).
    const undo = page.locator('#toast button', { hasText: 'Undo' })
    await expect(undo).toBeVisible()
    await undo.click()
    await expect(page.locator('.rail-group', { hasText: 'Urgent & High Value' }).locator('.rail-todo-item')).toHaveCount(1)
    await expect(page.locator('.rail-todo-item', { hasText: 'Rail urgent task' })).toContainText('Rail urgent task')
  })

  test('ticking the LAST open task flips the panel to the all-clear state (S113, owner urgent)', async ({ page }) => {
    await login(page)
    await page.click('.rail .rail-primary a[data-rail-panel="todo"]')
    await expect(page.locator('.rail-panel-title')).toHaveText('To-do list')
    // Tick every open task (Q1 today, Q3 urgent, Q2 strategic — the list mutates as
    // rows fold away, so always re-resolve the FIRST remaining checkbox; the fold
    // settles in ~360ms, a hair more here keeps the loop deterministic).
    await expect(page.locator('.rail-todo-item input[data-rail-todo]').first()).toBeVisible()
    for (let guard = 0; guard < 6; guard++) {
      const remaining = page.locator('.rail-todo-item input[data-rail-todo]')
      if ((await remaining.count()) === 0) break
      await remaining.first().check()
      await page.waitForTimeout(480)
    }
    // The last group out flips the panel to the finish line — the all-clear state.
    const clear = page.locator('.rail-todo-clear')
    await expect(clear).toBeVisible()
    await expect(clear).toContainText('All clear — every task here is done.')
    await expect(clear).toHaveAttribute('role', 'status')
    await expect(page.locator('.rail-group')).toHaveCount(0)
    // Restore the seeded state for the tests that follow (this file runs serially
    // through one server) — the same /uncomplete endpoint the panel's Undo speaks,
    // via the page's own fetch (the API's origin guard 403s the out-of-page
    // request context; the in-page path is the one the panel itself uses).
    await page.evaluate(async (uid) => {
      for (const suffix of ['t1', 't2', 't3']) {
        await fetch(`/api/sadhana/tasks/${uid}-${suffix}/uncomplete`, { method: 'POST', credentials: 'same-origin' })
      }
    }, seedUserId)
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
    // S115 r2 (owner, "clicking on idea icon must open https://hibana.ir/sparks as
    // well"): the Ideas icon joins the NAVIGATORS — the click lands on the Ideas
    // page with the panel riding along (the To-do/Projects/Calendar pattern).
    await page.waitForURL('**/sparks.html', { timeout: 10_000 })
    const panel = page.locator('[data-rail-panel-box]')
    await expect(panel).toBeVisible()
    await expect(page.locator('.rail-panel-title')).toHaveText('Ideas')

    // The seeded spark ('Rail project 2', status=spark, no folder) rides Unfiled.
    const item = page.locator('.rail-group', { hasText: 'Unfiled' }).locator('.rail-item', { hasText: 'Rail project 2' })
    await expect(item).toHaveCount(1)

    // S115 r2 (owner, "the folders must be collapsed until user clicks on them"):
    // the seeded folder ships FOLDED — its idea is hidden until the folder head is
    // clicked, then the row reveals with its deep link (the Unfiled inbox stays
    // open — it is the capture surface, not a folder).
    const folder = page.locator('.rail-group', { hasText: 'Rail idea folder' })
    await expect(folder).toHaveClass(/is-collapsed/)
    const filed = folder.locator('.rail-item', { hasText: 'Rail filed idea' })
    await expect(filed).toBeHidden()
    await folder.locator('.rail-group-head').click()
    await expect(folder).not.toHaveClass(/is-collapsed/)
    await expect(filed).toBeVisible()
    await expect(filed).toHaveAttribute('href', /^\/project\.html\?id=.+/)

    // S131 (owner: "clicking the Ideas icon must show all ideas folders"): the
    // EMPTY folder rides the panel too — visible, collapsed, its count pill
    // honestly 0 — and expanding it reveals nothing (no ideas yet). The old
    // render dropped it silently for having zero ideas.
    const emptyFolder = page.locator('.rail-group', { hasText: 'Rail empty folder' })
    await expect(emptyFolder).toBeVisible()
    await expect(emptyFolder).toHaveClass(/is-collapsed/)
    await expect(emptyFolder.locator('.rail-group-count')).toHaveText('0')
    await emptyFolder.locator('.rail-group-head').click()
    await expect(emptyFolder).not.toHaveClass(/is-collapsed/)
    await expect(emptyFolder.locator('.rail-item')).toHaveCount(0)

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
    // S133: every icon navigates now — the reload ride uses a non-module
    // destination (sparks), whose panel restores from the persisted key.
    await page.click('.rail .rail-primary a[data-rail-panel="sparks"]')
    await page.waitForURL('**/sparks.html', { timeout: 10_000 })
    await expect(page.locator('.rail-panel-title')).toHaveText('Ideas')
    await page.reload()
    await page.waitForSelector('[data-rail-panel-box]:not([hidden])', { timeout: 10_000 })
    await expect(page.locator('.rail-panel-title')).toHaveText('Ideas')
    // …and closes cleanly via the ✕ — with every icon navigating, the ✕ + Escape
    // own the close contract (S133).
    await page.click('[data-rail-close]')
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
