// e2e/s106-backlog-slice.spec.ts — S106: the owner's backlog, first slice (2 items).
//
// WHY THIS FILE EXISTS: one pin per owner-reported item from his own Plans box, so
// neither failure direction can silently return:
//
//   1. "Bold Project Names — Project Names, Idea's Folders, and Head groups must
//      appear in Bold text, so eyes can see them faster; currently the head group
//      and its content are both regular font, which damages the hierarchy."
//      ROOT CAUSE: every name/head sat in the 400–600 mid-weights (the vault folder
//      names had NO weight at all — literally regular next to their children). Fix:
//      ONE shared bold register (700) for project names, folder names and group
//      heads across all six surfaces, content stays 400. Pinned by computed weight
//      on every surface. LIVE-QA ADDENDUM: the vault SECTION heads' `font: inherit`
//      shorthand had silently clobbered their designed 11px/700/uppercase label
//      treatment since S105 (the exact "head group reads regular" complaint) —
//      fixed to font-family: inherit and pinned by weight AND size AND transform.
//   2. "Quadrants maximum items in dashboard, must be 4; if there are more items,
//      they must be hidden behind a faded (blur) button so user can click and see
//      the rest… also this tasks must be sorted, the newest come on top."
//      ROOT CAUSE: the widget showed 5 rows + a plain text "See More" button, and
//      the SQL sorted by the manual drag position (pinned DESC, position ASC — the
//      board's order, not a time view). Fix: 4 visible + rows 5–8 behind a FROST
//      pill (translucent wash + backdrop blur, "+N more"); the sort is pinned first,
//      then NEWEST CREATED first (position stays the board's own order — the
//      dashboard drag handlers still PATCH it, the dashboard just no longer
//      DISPLAYS it); beyond the 8-row render cap the board link still rides.
//
// Run: npx playwright test e2e/s106-backlog-slice.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s106@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'

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
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM note_folders WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM spark_folders WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s106', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // One project (status developing) — feeds the cards view, the recently-active
  // rows and the rail tree's stage group heads.
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s106-project', '${USER_ID}', 'S106 Bold Register Project', '', 'personal', 'developing', 0, '${now}', '${now}')`,
  )
  // S106 r2: one board IDEA under that project — grows the rail tree's sub-group
  // so the spec can pin BOTH directions of the register: the PROJECT row bold
  // (700) AND its idea leaf staying regular (400 — content, the S106 contract).
  db.exec(`DELETE FROM dev_tasks WHERE project_id = 's106-project'`)
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('s106-dt1', 's106-project', 'S106 rail tree idea', 'idea', 'medium', 0, '${now}')`,
  )
  // r3: a second branch (Problems) — the hierarchy pins below must hold for every
  // sub-group, and the visual QA gets a realistic multi-branch tree.
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
     VALUES ('s106-dt2', 's106-project', 'S106 rail tree bug', 'bug', 'high', 0, '${now}')`,
  )
  // A vault folder + note (the notes-page folder-name surface).
  db.exec(
    `INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at)
     VALUES ('s106-folder', '${USER_ID}', NULL, 'S106 Folder', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s106-note', '${USER_ID}', 's106-folder', 'S106 note', 'x', '', 0, '${now}', '${now}')`,
  )
  // A spark folder + one filed idea (the Ideas page's folder surface — .spark-folder-name
  // only renders when a folder exists).
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES ('s106-sfolder', '${USER_ID}', 'S106 Idea Folder', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, folder_id, created_at, updated_at)
     VALUES ('s106-spark', '${USER_ID}', 'S106 filed idea', '', 'personal', 'spark', 0, '', 0, 's106-sfolder', '${now}', '${now}')`,
  )
  // Quadrant 1: 6 unpinned tasks (staggered created_at — task-5 newest) + ONE pinned
  // task that is the OLDEST (pinned must still ride on top — the app-wide language).
  // Expected order: [pinned, q5, q4, q3] visible · [q2, q1, q0] hidden behind the pill.
  const base = Date.now() - 10 * 3600 * 1000 // 10h ago
  for (let i = 0; i < 6; i++) {
    const at = new Date(base + i * 3600 * 1000).toISOString() // higher i = newer
    db.exec(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
       VALUES ('s106-q1-${i}', '${USER_ID}', 1, 'S106 q1 task ${i}', 0, 0, ${i}, 'untouched', '${at}', '${at}')`,
    )
  }
  const oldest = new Date(base - 5 * 3600 * 1000).toISOString()
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
     VALUES ('s106-q1-pin', '${USER_ID}', 1, 'S106 q1 PINNED oldest', 0, 1, 99, 'untouched', '${oldest}', '${oldest}')`,
  )
  // Quadrant 2: 9 tasks — beyond the 8-row render cap, so the frost pill (+4) AND
  // the board link (+1) must BOTH render.
  for (let i = 0; i < 9; i++) {
    const at = new Date(base + i * 600 * 1000).toISOString()
    db.exec(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
       VALUES ('s106-q2-${i}', '${USER_ID}', 2, 'S106 q2 task ${i}', 0, 0, ${i}, 'untouched', '${at}', '${at}')`,
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
  await page.waitForTimeout(400)
}

/* ── 1. THE BOLD REGISTER: names + folders + group heads compute 700 ──────────── */

test('S106-1: project names, folders and head groups compute the 700 bold register', async ({ page }) => {
  await login(page)

  // (a) The dashboard's stage-column head (the shared board-col language).
  await page.waitForSelector('.board-col-label', { timeout: 10_000 })
  const labelWeight = await page.locator('.board-col-label').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(labelWeight).toBe('700')

  // (b) The rail tree's stage group head (the "head group" of the owner's words) —
  // the S93 pattern: the Projects rail icon NAVIGATES to /projects.html AND opens
  // the panel beside the rail (the stage groups render inside it).
  await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
  await page.waitForURL('**/projects.html', { timeout: 10_000 })
  await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
  const headWeight = await page.locator('.rail-group-head').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(headWeight).toBe('700')

  // (b2) S106 r2 (owner: "it's not deployed yet, I still see regular font for
  // project names in sidebar"): the rail tree's PROJECT rows — the surface the
  // six-surface register MISSED (S106 bolded the STAGE heads; the project names
  // beneath stayed 400, so the sidebar read as unchanged even though the deploy
  // was live — byte-verified before the fix). The tree's full weight ladder,
  // pinned level by level: stage head 700 (b above) → PROJECT name 700 →
  // sub-group head 500 → idea leaf 400 (content stays regular).
  // S115 r2: the project name lives in the BRANCH HEAD now (a toggle, not a link
  // — the owner's "collapsed until the title is clicked" sketch) and the branch
  // ships COLLAPSED, so it is expanded here before the geometry pins below.
  const projRow = page.locator('.rail-project-head').first()
  const projName = projRow.locator('.rail-project-row')
  await expect(projName).toContainText('S106 Bold Register Project')
  expect(await projName.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700')
  const branch = page.locator('.rail-project-group').first()
  await expect(branch).toHaveClass(/is-collapsed/)
  await projRow.click()
  await expect(branch).not.toHaveClass(/is-collapsed/)

  const subHead = page.locator('.rail-sub-group .rail-group-head').first()
  expect(await subHead.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')

  const leaf = page.locator('.rail-sub-group .rail-item', { hasText: 'S106 rail tree idea' })
  expect(await leaf.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('400')

  // (b3) S106 r3 (owner: "add some hierarchical space — Project Name (bold) / ---Ideas;
  // currently Project name / ideas"): the branch hangs measurably UNDER its project
  // row — the sub-head sits ≥0.75rem deeper, the leaves deeper still — and the
  // ELBOW connector (the owner's '---') actually computes: a riser + tick branching
  // off the stage guide into the sub-head. Geometry pins, not just weights, so a
  // later margin/positioning clobber can't silently re-flatten the tree. The branch
  // ships collapsed (weights pin fine on display:none) but geometry needs a box —
  // expand first, which also pins that the toggle still works under the new CSS.
  await subHead.click()
  const projBox = await projRow.boundingBox()
  const subHeadBox = await subHead.boundingBox()
  const leafBox = await leaf.boundingBox()
  expect(subHeadBox!.x).toBeGreaterThan(projBox!.x + 10) // 0.75rem = 12px of hierarchy space
  expect(leafBox!.x).toBeGreaterThan(subHeadBox!.x + 10) // the leaf nests under its head
  const elbow = await subHead.evaluate((el) => {
    const cs = getComputedStyle(el.parentElement, '::before')
    return { content: cs.content, w: Number.parseFloat(cs.width), tick: cs.borderBottomStyle, riser: cs.borderLeftStyle }
  })
  expect(elbow.content).not.toBe('none') // the pseudo renders
  expect(elbow.w).toBeGreaterThan(15) // spans the full guide→branch gap (1.3rem ≈ 21px)
  expect(elbow.tick).toBe('solid')
  expect(elbow.riser).toBe('solid')

  // (c) The projects home — the overview box labels (the status NAMES the owner
  // reads: Problems / In Progress / Ideas / Plans; the S121 carousel card title this
  // pin used to ride was retired in S123 — the 600-weight contract carries over).
  await page.waitForSelector('.ov-box-label', { timeout: 10_000 })
  const precentWeight = await page.locator('.ov-box-label').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(precentWeight).toBe('600')

  // (d) The projects cards view — the project card title.
  await page.goto('/projects.html?view=cards')
  await page.waitForSelector('.pc-wire .pc-title', { timeout: 10_000 })
  const cardWeight = await page.locator('.pc-wire .pc-title').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(cardWeight).toBe('700')

  // (e) The notes vault folder name ("Idea's Folders" — the vault surface; the
  // sparks folder grid shares the .spark-folder-name rule, pinned by (f) CSS parity).
  await page.goto('/notes.html')
  await page.waitForSelector('.vault-folder-name', { timeout: 10_000 })
  const vaultWeight = await page.locator('.vault-folder-name').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(vaultWeight).toBe('700')

  // (e2) The vault's SECTION heads (Folders / Tags) — a bug class the live QA caught:
  // button.vault-sec-head's `font: inherit` shorthand + explicit text-transform/
  // letter-spacing inherits CLOBBERED every typographic longhand of the base
  // .vault-sec-head rule (the heads rendered 16px/400/no-uppercase since S105,
  // the exact "head group reads regular" complaint). The button must compute the
  // full designed label treatment: 700 weight AND the 0.6875rem uppercase size.
  const secHead = page.locator('button.vault-sec-head').first()
  const secCss = await secHead.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { weight: cs.fontWeight, size: cs.fontSize, transform: cs.textTransform }
  })
  expect(secCss.weight).toBe('700')
  expect(secCss.size).toBe('11px')
  expect(secCss.transform).toBe('uppercase')

  // (f) The sparks folder name (the Ideas page).
  await page.goto('/sparks.html')
  await page.waitForSelector('.spark-folder-name', { timeout: 10_000 })
  const sparkWeight = await page.locator('.spark-folder-name').first().evaluate((el) => getComputedStyle(el).fontWeight)
  expect(sparkWeight).toBe('700')
})

/* ── 2. THE QUADRANT GLANCE: 4 visible, frost pill, newest first ──────────────── */

test('S106-2: a quadrant shows 4 rows + the "+N more" frost pill; pinned rides top, then newest', async ({ page }) => {
  await login(page)
  await page.waitForSelector('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-task', { timeout: 10_000 })

  const quad = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"]')

  // 4 visible, 3 hidden (6 unpinned + 1 pinned = 7 open; render cap 8 → no board link).
  await expect(quad.locator('.dash-todo-task:not([hidden])')).toHaveCount(4)
  await expect(quad.locator('.dash-todo-task[hidden]')).toHaveCount(3)
  await expect(quad.locator('.dash-todo-more-link')).toHaveCount(0)

  // The ORDER: pinned first (even though it is the oldest), then newest created.
  const titles = await quad.locator('.dash-todo-task:not([hidden]) [data-task-title]').allTextContents()
  expect(titles).toEqual(['S106 q1 PINNED oldest', 'S106 q1 task 5', 'S106 q1 task 4', 'S106 q1 task 3'])

  // The counter still tells the whole truth (7 open) — the cap is display-only.
  await expect(quad.locator('.dash-todo-counter')).toHaveText('7')

  // The frost pill: exact "+3 more" label + the blur wash actually computing.
  const pill = quad.locator('.dash-todo-more-pill')
  await expect(pill).toBeVisible()
  await expect(pill).toHaveText('+3 more')
  await expect(pill).toHaveAttribute('aria-expanded', 'false')
  const pillCss = await pill.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { blur: cs.backdropFilter, radius: cs.borderRadius, border: cs.borderStyle }
  })
  expect(pillCss.blur).toContain('blur')
  expect(pillCss.radius).toBe('999px')
  expect(pillCss.border).toBe('dashed')

  // Click → all 7 visible, the label flips to Show less, aria-expanded true.
  await pill.click()
  await expect(quad.locator('.dash-todo-task:not([hidden])')).toHaveCount(7)
  await expect(pill).toHaveText('Show less')
  await expect(pill).toHaveAttribute('aria-expanded', 'true')

  // Collapse → 4 visible again, the label RECOUNTED client-side (+3 more).
  await pill.click()
  await expect(quad.locator('.dash-todo-task:not([hidden])')).toHaveCount(4)
  await expect(pill).toHaveText('+3 more')
  await expect(pill).toHaveAttribute('aria-expanded', 'false')
})

test('S106-3: beyond the render cap the frost pill AND the board link both render', async ({ page }) => {
  await login(page)
  await page.waitForSelector('.dash-todo-quadrant[data-dash-quadrant="2"] .dash-todo-task', { timeout: 10_000 })

  const quad = page.locator('.dash-todo-quadrant[data-dash-quadrant="2"]')
  // 9 open: 8 shipped (4 visible + 4 hidden behind the pill) + 1 beyond the cap (link).
  await expect(quad.locator('.dash-todo-task:not([hidden])')).toHaveCount(4)
  await expect(quad.locator('.dash-todo-task[hidden]')).toHaveCount(4)
  await expect(quad.locator('.dash-todo-counter')).toHaveText('9')

  const pill = quad.locator('.dash-todo-more-pill')
  await expect(pill).toBeVisible()
  await expect(pill).toHaveText('+4 more')

  const link = quad.locator('.dash-todo-more-link')
  await expect(link).toBeVisible()
  await expect(link).toContainText('+1 more on the board')
  await expect(link).toHaveAttribute('href', '/to-do-list#Q2')

  // The pill reveals rows 5–8 (8 visible); the link still points the rest to the board.
  await pill.click()
  await expect(quad.locator('.dash-todo-task:not([hidden])')).toHaveCount(8)
  await expect(pill).toHaveText('Show less')
})
