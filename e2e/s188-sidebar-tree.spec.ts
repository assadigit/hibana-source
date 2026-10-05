// e2e/s188-sidebar-tree.spec.ts — S188 (the owner's six-change Projects sidebar
// round):
// 1) CHANGE 1 — the idea rows: TITLE ONLY, ONE line, ellipsis on overflow, every
//    row at the SAME ~32px height, and ALL items in every section (no cap, no
//    "show more" row — the API's projectTasks LIMIT is gone).
// 2) CHANGE 2 — the panel body scrolls INTERNALLY with STICKY top-level group
//    headers (the panel head never scrolls away), and every node's open/closed
//    state PERSISTS to localStorage and restores after a reload.
// 3) CHANGE 3 — the nested-level GUIDE LINES: a 1px vertical guide through each
//    expanded parent's children + a rounded elbow meeting each child row; the
//    top-level groups stay bare. (Geometry + RTL twins live here; the
//    presence/ink pins also ride s177/s106.)
// 4) CHANGE 4 — the COUNT BADGES: one inline-end column (circle at one digit,
//    pill at two+), neutral tint, hidden at zero, absent on EXPANDED project
//    rows, aria-labeled ("N projects/sections/items" — FA digits under fa).
// 5) CHANGE 5 — ONE active rail pattern: only the CURRENT ROUTE's icon carries
//    aria-current="page" (the S189 filled shape); the panel-open icon carries NO visual accent
//    (aria-expanded keeps the semantics).
// 6) CHANGE 6 — the ROUNDED FLOATING panel: ~10px gaps, 16px radius, thin border
//    + soft shadow, inner padding, clipped scroll — beside the UNCHANGED rail;
//    the RTL twin mirrors the whole geometry.
import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s188@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s188-fa@test.local'

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

  const seedUser = (id: string, email: string, name: string, lang: string) => {
    try { db.exec(`DELETE FROM users WHERE email = '${email}'`) } catch { /* may not exist yet */ }
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${id}', '${name}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
  }
  // One DEVELOPING project with a BIG board: 30 ideas (the two-digit badge + a
  // genuinely scrolling panel), one bug, two planned — plus one idea whose title
  // is long enough that the OLD 2-line clamp wrapped it into a text blob.
  const seedProjects = (id: string) => {
    db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id = '${id}')`)
    db.exec(`DELETE FROM projects WHERE user_id = '${id}'`)
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
       VALUES ('${id}-branch', '${id}', 'S188 big board', 'developing', '${now}', '${now}')`,
    )
    for (let i = 0; i < 29; i++) {
      db.exec(
        `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
         VALUES ('${id}-idea-${i}', '${id}-branch', 'S188 idea ${i}', 'idea', 'medium', ${i}, '${now}')`,
      )
    }
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${id}-idea-long', '${id}-branch',
               'S188 the longest idea title in the tree — long enough that the old two-line clamp wrapped it into a description-like text blob',
               'idea', 'medium', 99, '${now}')`,
    )
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${id}-bug-1', '${id}-branch', 'S188 rail tree bug', 'bug', 'high', 0, '${now}')`,
    )
    for (let i = 0; i < 2; i++) {
      db.exec(
        `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
         VALUES ('${id}-plan-${i}', '${id}-branch', 'S188 plan ${i}', 'planned', 'medium', ${i}, '${now}')`,
      )
    }
    // one task-less OPERATIONAL project → the plain link row
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
       VALUES ('${id}-plain', '${id}', 'S188 plain project', 'operational', '${now}', '${now}')`,
    )
  }
  const en = randomBytes(16).toString('hex')
  seedUser(en, TEST_EMAIL, 'e2e-s188', 'en')
  seedProjects(en)
  const fa = randomBytes(16).toString('hex')
  seedUser(fa, FA_EMAIL, 'e2e-s188-fa', 'fa') // language_pref='fa' → dir=rtl
  seedProjects(fa)
  db.close()
})

async function login(page: Page, email = TEST_EMAIL) {
  // Suppress the onboarding coachmarks (the tour backdrop intercepts pointer clicks).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('nav.rail', { timeout: 10_000 })
}

async function openProjectsPanel(page: Page) {
  await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
  await page.waitForURL('**/projects.html', { timeout: 10_000 })
  await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
  await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
}

test.describe('S188 — the Projects sidebar panel (the owner\'s six changes)', () => {
  test('CHANGE 1: title-only single-line rows, one equal height, ALL items — no cap, no "show more"', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Expand the branch + its New ideas section.
    const branch = page.locator('.rail-project-group').first()
    await branch.locator('.rail-project-head').click()
    const ideasGroup = branch.locator('.rail-sub-group', { hasText: 'New ideas' })
    await ideasGroup.locator('.rail-group-head').click()

    // ALL 30 ideas ride — the old LIMIT-era behavior capped nothing client-side,
    // but this pins the shipped contract: every item, no "show more" row.
    const items = ideasGroup.locator('.rail-item')
    await expect(items).toHaveCount(30)
    expect(await page.locator('[data-rail-panel-box] [data-rail-more]').count()).toBe(0)

    // The long title speaks ONE line: nowrap + hidden + ellipsis, and the label
    // is genuinely truncated (scrollWidth > clientWidth — the text overflows).
    const longRow = items.filter({ hasText: 'longest idea title' })
    await expect(longRow).toHaveCount(1)
    const label = longRow.locator('.rail-item-label')
    expect(await label.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap')
    expect(await label.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden')
    expect(await label.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
    expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

    // ONE equal row height: the long row, a short row, the section head, and the
    // project head all stand at the same ~32px (the old 2-line blob made rows
    // uneven — the whole point of the change).
    const rowH = async (loc: import('@playwright/test').Locator) => Math.round((await loc.boundingBox())!.height)
    const longH = await rowH(longRow)
    const shortH = await rowH(items.filter({ hasText: 'S188 idea 0' }))
    const subHeadH = await rowH(ideasGroup.locator('.rail-group-head'))
    const projHeadH = await rowH(branch.locator('.rail-project-head'))
    for (const h of [shortH, subHeadH, projHeadH]) expect(h).toBe(longH)
    expect(longH).toBeGreaterThanOrEqual(30)
    expect(longH).toBeLessThanOrEqual(36) // the owner's compact ~32–36px band
  })

  test('CHANGE 2: internal scroll + STICKY group headers (the panel head never scrolls away)', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Open the tree first — the 30-row section is what makes the body overflow.
    await page.locator('.rail-project-group .rail-project-head').first().click()
    await page.locator('.rail-sub-group .rail-group-head').first().click()

    // The body scrolls INSIDE its own container (the 30-row tree overflows it)…
    const body = page.locator('.rail-panel-body')
    const scrolls = await body.evaluate((el) => el.scrollHeight > el.clientHeight)
    expect(scrolls).toBe(true)
    // …while the PANEL HEAD stays fixed above it (never scrolls away).
    const panelHead = page.locator('.rail-panel-head')
    const headBefore = (await panelHead.boundingBox())!.y

    // The top-level stage head sticks at the scrollport's top while its rows
    // slide under it — scroll, then re-measure.
    const stageHead = page.locator('.rail-panel-body > .rail-group > .rail-group-head').first()
    const leaf = page.locator('.rail-sub-group .rail-item').first()
    const leafBefore = (await leaf.boundingBox())!.y
    await body.evaluate((el) => { el.scrollTop = 260 })
    await page.waitForTimeout(150) // let the sticky layout settle
    const bodyBox = await body.boundingBox()
    const stageBox = await stageHead.boundingBox()
    expect(Math.round(stageBox!.y)).toBe(Math.round(bodyBox!.y)) // PINNED at the scrollport top
    expect((await leaf.boundingBox())!.y).toBeLessThan(leafBefore) // the rows DID scroll
    expect(Math.round((await panelHead.boundingBox())!.y)).toBe(Math.round(headBefore)) // the panel head never moved
    await body.evaluate((el) => { el.scrollTop = 0 })
  })

  test('CHANGE 2: the open/closed state of every node PERSISTS (localStorage) and restores on load', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Ship-state: Developing open, the branch + its sub-groups folded.
    const stage = page.locator('.rail-panel-body > .rail-group').first()
    const branch = page.locator('.rail-project-group').first()
    await expect(branch).toHaveClass(/is-collapsed/)

    // The owner's choices: expand the branch, expand its FIRST sub-group, fold
    // the branch's SECOND sub-group, and collapse the whole Developing stage.
    await branch.locator('.rail-project-head').click()
    const subs = branch.locator('.rail-sub-group')
    await subs.nth(0).locator('.rail-group-head').click() // New ideas → open
    await expect(subs.nth(1)).toHaveClass(/is-collapsed/) // Problems stays folded (its default)
    await stage.locator('> .rail-group-head').click() // Developing → folded
    await expect(stage).toHaveClass(/is-collapsed/)

    // The states landed in localStorage (the stable fold keys, not label text).
    const stored = await page.evaluate(() => localStorage.getItem('hibana-rail-fold-v1'))
    expect(stored).toBeTruthy()
    const folds = JSON.parse(stored as string) as Record<string, boolean>
    expect(Object.keys(folds).length).toBeGreaterThanOrEqual(4)
    const branchKey = await branch.getAttribute('data-fold-key')
    expect(folds[branchKey as string]).toBe(false) // the branch: OPEN
    expect(folds['st:developing']).toBe(true) // the stage: folded

    // RELOAD — the panel restores (the S88 key) and the TREE restores with it.
    await page.reload()
    await page.waitForSelector('[data-rail-panel-box]:not([hidden])', { timeout: 10_000 })
    await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
    const stageAfter = page.locator('.rail-panel-body > .rail-group').first()
    await expect(stageAfter).toHaveClass(/is-collapsed/)
    await stageAfter.locator('> .rail-group-head').click() // re-open the stage…
    // …and the branch is STILL open + its New ideas section STILL open — the
    // remembered tree, not the shipped defaults.
    const branchAfter = page.locator('.rail-project-group').first()
    await expect(branchAfter).not.toHaveClass(/is-collapsed/)
    const subsAfter = branchAfter.locator('.rail-sub-group')
    await expect(subsAfter.nth(0)).not.toHaveClass(/is-collapsed/)

    // The bulk tree-fold button persists too: collapse all → reload → still all folded
    // (6 groups: 2 stages + the branch + its 3 sections).
    await page.click('[data-rail-tree]')
    await expect(page.locator('.rail-group.is-collapsed')).toHaveCount(6)
    await page.reload()
    await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
    await expect(page.locator('.rail-group.is-collapsed')).toHaveCount(6)
  })

  test('CHANGE 3: the guide + elbows MEET — each child\'s connector lands on the parent\'s vertical line (RTL twin too)', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)
    await page.locator('.rail-project-group .rail-project-head').first().click()
    await page.locator('.rail-sub-group .rail-group-head').first().click()

    // LTR geometry: the sub-group head's elbow starts exactly AT the project
    // body's guide line (its inline-start border) and ends at the row's edge.
    const geo = await page.evaluate(() => {
      const sub = document.querySelector('.rail-sub-group') as HTMLElement
      const projBody = document.querySelector('.rail-project-group > .rail-group-body') as HTMLElement
      const elbow = sub.querySelector('.rail-elbow') as HTMLElement
      const gs = getComputedStyle(projBody)
      const eb = elbow.getBoundingClientRect()
      const pb = projBody.getBoundingClientRect()
      return {
        guideX: gs.borderInlineStartStyle !== 'none' ? pb.x : -1,
        elbowX: eb.x,
        elbowW: eb.width,
        guideStyle: gs.borderInlineStartStyle,
        guideW: gs.borderInlineStartWidth,
      }
    })
    expect(geo.guideStyle).toBe('solid')
    expect(geo.guideW).toBe('1px')
    expect(Math.round(geo.elbowX)).toBe(Math.round(geo.guideX)) // the elbow MEETS the guide
    expect(Math.round(geo.elbowW)).toBe(17) // 1rem + 1px — from the guide to the row's edge

    // The leaf rows carry elbows too — each child of EVERY section's body (the
    // New ideas 30 + Problems 1 + Plans 2 = 33; scoped to the open section: 30).
    const ideasGroup0 = page.locator('.rail-sub-group').first()
    expect(await ideasGroup0.locator('.rail-item .rail-elbow').count()).toBe(30)
    expect(await page.locator('.rail-sub-group .rail-item .rail-elbow').count()).toBe(33)
    // A collapsed branch draws NO guide (its body is display:none — no line leaks).
    await page.locator('.rail-project-group .rail-project-head').first().click()
    const collapsedGuide = await page.evaluate(() => {
      const projBody = document.querySelector('.rail-project-group > .rail-group-body') as HTMLElement
      return projBody ? getComputedStyle(projBody).display : 'gone'
    })
    expect(['none', 'gone']).toContain(collapsedGuide)
  })

  test('CHANGE 4: the badges — one inline-end column, circle→pill, hidden at zero, none on EXPANDED projects, aria-labeled', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // The stage head (Developing, 1 project) wears a ONE-DIGIT circle; the
    // collapsed branch counts its SECTIONS (3) in a circle of its own; the
    // section rows (30 ideas / 1 bug / 2 planned) wear a pill for 30 and circles
    // for 1 and 2. All ends align in ONE column.
    const stageHead = page.locator('.rail-panel-body > .rail-group > .rail-group-head').first()
    const branch = page.locator('.rail-project-group').first()
    const stageBadge = stageHead.locator('.rail-group-count')
    await expect(stageBadge).toHaveText('1')
    await expect(stageBadge).toHaveAttribute('aria-label', '1 projects')
    const sb = await stageBadge.boundingBox()
    expect(Math.round(sb!.width)).toBe(Math.round(sb!.height)) // circle at one digit

    const branchBadge = branch.locator('.rail-project-head .rail-group-count')
    await expect(branchBadge).toHaveText('3') // the branch's DIRECT children: its sections
    await expect(branchBadge).toHaveAttribute('aria-label', '3 sections')

    // Expand the branch → the badge RETIRES (the sections are visible; CSS hides it).
    await branch.locator('.rail-project-head').click()
    await expect(branch.locator('.rail-project-head .rail-group-count')).toBeHidden()

    // The New ideas section's 30 → a PILL (wider than tall), and Problems' 1 a circle.
    const ideasGroup = branch.locator('.rail-sub-group', { hasText: 'New ideas' })
    const bugGroup = branch.locator('.rail-sub-group', { hasText: 'Problems' })
    await ideasGroup.locator('.rail-group-head').click()
    const pill = ideasGroup.locator('.rail-group-head .rail-group-count')
    await expect(pill).toHaveText('30')
    await expect(pill).toHaveAttribute('aria-label', '30 items')
    const pb = await pill.boundingBox()
    expect(pb!.width).toBeGreaterThan(pb!.height) // grew into a pill at two digits
    const cb = await bugGroup.locator('.rail-group-head .rail-group-count').boundingBox()
    expect(Math.round(cb!.width)).toBe(Math.round(cb!.height)) // one digit stays a circle

    // ONE column, measured in two phases (a collapsed branch hides its sections,
    // so the branch badge and the section badges are never on screen together):
    // first the stage + section badges (branch expanded)…
    const columnXs: number[] = []
    for (const loc of [
      stageBadge,
      pill,
      bugGroup.locator('.rail-group-head .rail-group-count'),
    ]) {
      const b = await loc.boundingBox()
      columnXs.push(Math.round(b!.x + b!.width))
    }
    expect(Math.max(...columnXs) - Math.min(...columnXs)).toBeLessThanOrEqual(1)

    // …then the re-collapsed branch's badge joins the SAME column (the stage
    // badge re-measured in the same phase for honesty).
    await branch.locator('.rail-project-head').click() // fold the branch back (badge returns)
    const sb2 = await stageBadge.boundingBox()
    const bb2 = await branchBadge.boundingBox()
    expect(Math.round(bb2!.x + bb2!.width) - Math.round(sb2!.x + sb2!.width)).toBeLessThanOrEqual(1)

    // The plain project (0 board tasks) renders NO badge — zero hides it.
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S188 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    await expect(plain).toBeVisible()
    await expect(plain.locator('.rail-group-count')).toHaveCount(0)
  })

  test('CHANGE 5: ONE active rail pattern — the current route\'s shape alone; the panel-open icon carries NO accent', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page) // lands on /projects.html with the panel OPEN

    // Only the CURRENT ROUTE's icon carries aria-current="page" (the Projects
    // icon — checked against the route, never against the open panel).
    const projectsIcon = page.locator('.rail .rail-primary a[data-rail-panel="projects"]')
    const dash = page.locator('.rail .rail-primary a[href="/dashboard.html"]')
    const canvas = page.locator('.rail .rail-primary a[href="/canvas.html"]')
    await expect(projectsIcon).toHaveAttribute('aria-current', 'page')
    await expect(dash).not.toHaveAttribute('aria-current', 'page')

    // The panel-open icon speaks NO visual accent: its ink is EXACTLY the
    // current-page ink (aria-current's --text rung) — never the retired
    // brand-teal the old .is-panel-open rule painted on the icon. (The 0.14s
    // color transition on .rail-btn means the read waits for the settle —
    // an instant read catches the oklab mid-flight value.)
    await page.waitForTimeout(300)
    const settledProjectsColor = await projectsIcon.evaluate((el) => getComputedStyle(el).color)
    expect(settledProjectsColor).not.toBe('rgb(74, 159, 163)') // the retired brand-teal accent
    // …while aria-expanded still ANNOUNCES the open panel (semantics, not ink).
    await expect(projectsIcon).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas).not.toHaveAttribute('aria-expanded')

    // The shape FOLLOWS the route: soft-navigate to the dashboard → Dashboard wears
    // it, Projects loses it (the shape can never go stale).
    await dash.click()
    await page.waitForURL('**/dashboard.html', { timeout: 10_000 })
    await expect(dash).toHaveAttribute('aria-current', 'page')
    await expect(projectsIcon).not.toHaveAttribute('aria-current', 'page')
    // The panel stayed open (persistent) with NO accent on its icon — and the
    // PROOF the accent is gone: Dashboard's current-page ink (no panel open on
    // it) settles to EXACTLY the ink Projects wore in phase 1 (current page +
    // panel open) — the panel-open state paints NOTHING on top of the page ink.
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
    await expect.poll(() => dash.evaluate((el) => getComputedStyle(el).color), { timeout: 2_000 })
      .toBe(settledProjectsColor)
    // …and a not-current icon with its panel open settles to exactly the plain
    // navigators' muted resting ink (no brand tint).
    const canvasColor = await canvas.evaluate((el) => getComputedStyle(el).color)
    await expect.poll(() => projectsIcon.evaluate((el) => getComputedStyle(el).color), { timeout: 2_000 })
      .toBe(canvasColor)
  })

  test('CHANGE 6: the ROUNDED FLOATING panel beside the UNCHANGED rail — gaps, radius, border, clipped scroll', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    const vw = 1280
    const vh = 720
    const panel = page.locator('[data-rail-panel-box]')
    const pBox = await panel.boundingBox()
    expect(Math.round(pBox!.x)).toBe(98) // rail 88 + the 10px gap
    expect(Math.round(pBox!.y)).toBe(10) // the block gap
    expect(Math.round(pBox!.height)).toBe(vh - 20) // inset from BOTH screen edges
    expect(Math.round(pBox!.width)).toBe(280)
    expect(await panel.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('16px')
    expect(await panel.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px') // the thin edge
    expect(await panel.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(212, 212, 212)') // --line
    expect(await panel.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden') // the scroll clips inside
    expect(await panel.evaluate((el) => getComputedStyle(el).padding)).toBe('8px') // the inner padding

    // The rail is UNCHANGED: full height, its own surface + edge.
    const rail = page.locator('nav.rail')
    const rBox = await rail.boundingBox()
    expect(Math.round(rBox!.x)).toBe(0)
    expect(Math.round(rBox!.y)).toBe(0)
    expect(Math.round(rBox!.width)).toBe(88)
    expect(Math.round(rBox!.height)).toBe(vh)
    expect(await rail.evaluate((el) => getComputedStyle(el).borderInlineEndWidth)).toBe('1px')

    // The main content is pushed past the floating footprint (rail + gap +
    // panel + gap = 388), never under it.
    await page.waitForFunction(() => parseInt(getComputedStyle(document.body).paddingInlineStart, 10) >= 388, null, { timeout: 3_000 })
  })

  test('RTL twin (FA): the floating panel mirrors to the inline-end; the badge column + elbows mirror with it', async ({ page }) => {
    await login(page, FA_EMAIL)
    await openProjectsPanel(page)

    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')

    // The panel floats at the INLINE-END: 1280 - 88 (rail) - 10 (gap) - 280.
    const panel = page.locator('[data-rail-panel-box]')
    const pBox = await panel.boundingBox()
    expect(Math.round(pBox!.x)).toBe(1280 - 88 - 10 - 280)
    expect(Math.round(pBox!.y)).toBe(10)

    // The badge column sits at the INLINE-START edge of each row (mirrored):
    // the stage badge ends ~8px from the row's LEFT edge.
    await page.locator('.rail-project-group .rail-project-head').first().click()
    const stageHead = page.locator('.rail-panel-body > .rail-group > .rail-group-head').first()
    const stageBadge = stageHead.locator('.rail-group-count')
    const hb = await stageHead.boundingBox()
    const bb = await stageBadge.boundingBox()
    expect(Math.round(bb!.x - hb!.x)).toBe(8)
    // FA digits + the FA accessible name.
    await expect(stageBadge).toHaveText('۱')
    await expect(stageBadge).toHaveAttribute('aria-label', '۱ پروژه')

    // The section badges speak Farsi too (۳۰ مورد with FA digits).
    const ideasGroup = page.locator('.rail-sub-group').first()
    await ideasGroup.locator('.rail-group-head').click()
    await expect(ideasGroup.locator('.rail-group-head .rail-group-count')).toHaveText('۳۰')

    // The guide + elbow mirror: the section body's border rides the row's RIGHT
    // side (inline-start under RTL), and the elbow reaches back to it.
    const geo = await page.evaluate(() => {
      const sub = document.querySelector('.rail-sub-group') as HTMLElement
      const projBody = document.querySelector('.rail-project-group > .rail-group-body') as HTMLElement
      const elbow = sub.querySelector('.rail-elbow') as HTMLElement
      const eb = elbow.getBoundingClientRect()
      const pb = projBody.getBoundingClientRect()
      return { guideRight: pb.x + pb.width, elbowRight: eb.x + eb.width }
    })
    expect(Math.round(geo.elbowRight)).toBe(Math.round(geo.guideRight)) // meets the guide, mirrored

    // The remembered tree works under RTL as well: fold the branch + reload →
    // the fold RESTORES (still collapsed after the reload).
    await page.locator('.rail-project-group .rail-project-head').first().click()
    await page.reload()
    await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
    await expect(page.locator('.rail-project-group').first()).toHaveClass(/is-collapsed/)
  })
})
