// e2e/s177-sidebar-quiet.spec.ts — S177 (owner round, the design advisor's six
// blocks for the Projects sidebar panel — the "quiet sidebar"):
// 1) TEXT-ONLY group headers: no background fill, no rounded corners, small/
//    medium/muted type, count on the same row at the inline end, groups separated
//    by vertical space, and the muted ink still clears 4.5:1 AA on the panel.
// 2) The SELECTED row is the ONLY filled element: accent wash + inline-start bar
//    + aria-current="true"; every other row stays unfilled (a subtle hover wash
//    aside).
// 3) The tree CONNECTOR LINES are gone (vertical guides + branch elbows) —
//    hierarchy rides ~16px logical indents per level (+ lighter/smaller child ink).
// 4) No STATUS DOT before project names — the stage grouping already encodes the
//    status; the name starts at the row's inline-start edge.
// 5) The PLATFORM chevron convention: inline-end when collapsed, DOWN when
//    expanded (one rotating icon), chevrons only on expandable rows — mirrored
//    true under RTL (collapsed points at the inline-end = LEFT).
// 6) The ↗ goto chip HIDES by default, reveals on row hover + :focus-within +
//    on the selected branch, and stays ALWAYS visible on coarse pointers.
// Run: npx playwright test e2e/s177-sidebar-quiet.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s177@test.local'
const TEST_PASS = 'e2e-password-123'
const FA_EMAIL = 'e2e-s177-fa@test.local'
const DOWN = 'matrix(0, 1, -1, 0, 0, 0)' // rotate(90deg) — the expanded chevron
const MIRRORED = 'matrix(-1, 0, 0, 1, 0, 0)' // scaleX(-1) — the RTL collapsed chevron

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
  const seedProjects = (id: string) => {
    db.exec(`DELETE FROM projects WHERE user_id = '${id}'`)
    db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id = '${id}')`)
    // one DEVELOPING project carrying a board task tree → the collapsible branch
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
       VALUES ('${id}-branch', '${id}', 'S177 branch project', 'developing', '${now}', '${now}')`,
    )
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${id}-dt1', '${id}-branch', 'S177 rail tree idea', 'idea', 'medium', 0, '${now}')`,
    )
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${id}-dt2', '${id}-branch', 'S177 rail tree bug', 'bug', 'high', 0, '${now}')`,
    )
    // one task-less OPERATIONAL project → the plain link row (no chevron, no branch)
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, created_at, updated_at)
       VALUES ('${id}-plain', '${id}', 'S177 plain project', 'operational', '${now}', '${now}')`,
    )
  }
  const en = randomBytes(16).toString('hex')
  seedUser(en, TEST_EMAIL, 'e2e-s177', 'en')
  seedProjects(en)
  const fa = randomBytes(16).toString('hex')
  seedUser(fa, FA_EMAIL, 'e2e-s177-fa', 'fa') // language_pref='fa' → dir=rtl
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
  await page.evaluate(() => { try { localStorage.removeItem('hibana-rail-panel') } catch { /* storage blocked */ } })
}

async function openProjectsPanel(page: Page, title?: string) {
  await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
  await page.waitForURL('**/projects.html', { timeout: 10_000 })
  await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
  if (title) await expect(page.locator('.rail-panel-title')).toHaveText(title) // EN only — the FA panel speaks Farsi
  await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
}

// the luminance/ratio math from e2e/fixtures/contrast-fn.js, inline for one probe
const contrastProbe = () => {
  const head = document.querySelector('.rail-group-head') as HTMLElement
  const panel = head.closest('.rail-panel') as HTMLElement
  const parse = (c: string) => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); return m ? { r: +m[1], g: +m[2], b: +m[3] } : null }
  const lum = (p: { r: number; g: number; b: number }) => {
    const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b)
  }
  const fg = parse(getComputedStyle(head).color)
  const bg = parse(getComputedStyle(panel).backgroundColor)
  if (!fg || !bg) return -1
  const la = lum(fg), lb = lum(bg)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

test.describe('S177 — the quiet sidebar (the design advisor\'s six blocks)', () => {
  test('block 1: text-only group headers — no fill, no radius, muted ink ≥ AA, count at the inline end, space between groups', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    const head = page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head').first()
    // No background fill, no rounded corners — the typographic hierarchy owns the row.
    expect(await head.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    expect(await head.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px')
    // Small size, medium weight, muted ink (the eyebrow register).
    expect(await head.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')
    expect(await head.evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px')
    // The muted header ink still clears WCAG AA (4.5:1) against the panel surface.
    expect(await page.evaluate(contrastProbe)).toBeGreaterThanOrEqual(4.5)

    // The count rides the SAME row, aligned to the END (its box hugs the row's
    // content edge — a resolved auto margin pushing it past any label width),
    // never below the label.
    const count = head.locator('.rail-group-count')
    const headBox = await head.boundingBox()
    const countBox = await count.boundingBox()
    expect(countBox!.y).toBeGreaterThanOrEqual(headBox!.y)
    expect(countBox!.y + countBox!.height).toBeLessThanOrEqual(headBox!.y + headBox!.height + 1)
    expect(countBox!.x + countBox!.width).toBeGreaterThanOrEqual(headBox!.x + headBox!.width - 12)

    // Groups separate by VERTICAL SPACE (the sibling margin), not boxes.
    expect(await page.evaluate(() => {
      const g = document.querySelectorAll('.rail-panel-body > .rail-group')
      return g.length >= 2 ? Number.parseFloat(getComputedStyle(g[1]).marginBlockStart) : -1
    })).toBeGreaterThan(10)
  })

  test('blocks 3+4: no connector lines, ~16px indents, no status dots, the name at the inline-start edge', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Block 4: NO status dot before any project name (plain row or branch head) —
    // the stage grouping already encodes the status, so the dot was noise.
    expect(await page.locator('[data-rail-panel-box] .rail-dot').count()).toBe(0)
    // The plain project's NAME starts at the row's content edge (0.5rem padding —
    // no dot column before it).
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S177 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click() // ships folded
    const plainBox = await plain.boundingBox()
    const labelBox = await plain.locator('.rail-item-label').boundingBox()
    expect(Math.round(labelBox!.x - plainBox!.x)).toBe(8) // 0.5rem padding — nothing before the name

    // Block 3: expand the branch (chevron on the head) + its first sub-group, then
    // pin the indentation ladder + the GONE connectors.
    const branch = page.locator('.rail-project-group').first()
    const head = branch.locator('.rail-project-head')
    await head.click()
    const subHead = branch.locator('.rail-sub-group .rail-group-head').first()
    await subHead.click()
    const leaf = branch.locator('.rail-sub-group .rail-item').first()
    const projBox = await head.boundingBox()
    const subBox = await subHead.boundingBox()
    const leafBox = await leaf.boundingBox()
    // each nesting level indents ~16px (1rem) from its parent row
    expect(subBox!.x).toBeGreaterThan(projBox!.x + 14)
    expect(leafBox!.x).toBeGreaterThan(subBox!.x + 14)
    // child ink is LIGHTER than its parent (the muted leaf vs the primary row)
    const leafColor = await leaf.evaluate((el) => getComputedStyle(el).color)
    const projColor = await head.evaluate((el) => getComputedStyle(el).color)
    expect(leafColor).not.toBe(projColor)
    // NO vertical guide under any group, NO elbow connector on the sub-groups
    const connectors = await page.evaluate(() => {
      const body = document.querySelector('.rail-group-body') as HTMLElement | null
      const sub = document.querySelector('.rail-sub-group') as HTMLElement | null
      return {
        guide: body ? getComputedStyle(body).borderInlineStartStyle : 'missing',
        guideW: body ? getComputedStyle(body).borderInlineStartWidth : 'missing',
        elbow: sub ? getComputedStyle(sub, '::before').content : 'missing',
      }
    })
    expect(connectors.guide).toBe('none')
    expect(connectors.guideW).toBe('0px')
    expect(['none', 'normal']).toContain(connectors.elbow) // 'normal' is Chrome's no-rule string
  })

  test('block 2: the selected row is the ONLY filled element + aria-current="true"', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Unselected rows carry NO fill (transparent) — hover may wash subtly, and the
    // SELECTION is the single filled element in the panel.
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S177 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    expect(await plain.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')

    // Navigate onto the plain project's page: its row lights — accent wash + the
    // inline-start bar + aria-current="true" (the programmatic twin of the wash).
    await plain.click()
    await page.waitForURL(/project\.html\?id=.+$/, { timeout: 10_000 })
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
    await expect(plain).toHaveClass(/is-row-active/)
    await expect(plain).toHaveAttribute('aria-current', 'true')
    // The accent wash — POLLED: every <a> transitions background-color 0.15s
    // (base.css's global button/.chip/a/input rule), so an instant read catches
    // the oklab mid-flight color.
    await expect.poll(() => plain.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(74, 159, 163, 0.13)')
    const pill = await plain.evaluate((el) => getComputedStyle(el, '::before'))
    expect(pill.content).not.toBe('none') // the inline-start accent bar renders
    expect(pill.backgroundColor).toBe('rgb(74, 159, 163)') // the brand pill ink

    // Every OTHER row stays unfilled — exactly one filled row in the panel (the
    // selected one; not even the branch is lit — we're on the PLAIN project).
    // Polled through the same 0.15s background transition every <a> speaks.
    await expect.poll(() => page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-rail-panel-box] .rail-item, [data-rail-panel-box] .rail-group-headrow'))
        .filter((el) => {
          const bg = getComputedStyle(el).backgroundColor
          return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
        }).length), { timeout: 2_000 }).toBe(1)

    // Now onto the BRANCH's own page (via its chip — hover-revealed, then clicked):
    // the branch you are ON wears the same register on its headrow — accent wash,
    // and the goto chip (the branch's own link) carries aria-current and stays
    // revealed (the 0.14s opacity fade is polled through).
    const branch = page.locator('.rail-project-group').first()
    const chip = branch.locator('.rail-group-goto')
    await branch.locator('.rail-group-headrow').hover()
    await chip.click()
    await expect(branch).toHaveClass(/is-here/, { timeout: 10_000 })
    await expect(chip).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('1')
    const headrow = branch.locator('.rail-group-headrow')
    await expect.poll(() => headrow.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(74, 159, 163, 0.13)')
  })

  test('block 5: the platform chevron — inline-end when collapsed, DOWN when expanded, only on expandable rows', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // The collapsed Operational stage (ships folded) + the collapsed branch both
    // speak the RESTING glyph: a right-pointing chevron, identity transform.
    const operational = page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group)', { hasText: 'Operational' })
    const opChevron = operational.locator('> .rail-group-head > .icon')
    expect(await opChevron.locator('path').evaluate((el) => el.getAttribute('d'))).toBe('m9 6 6 6-6 6')
    expect(await opChevron.evaluate((el) => getComputedStyle(el).transform)).toBe('none')

    // Expanding rotates the SAME icon 90° (right → down) — the 0.14s rotation is
    // polled through (an instant read catches the mid-transition matrix).
    await operational.locator('> .rail-group-head').click()
    expect(await operational.evaluate((el) => !el.classList.contains('is-collapsed'))).toBe(true)
    await expect.poll(() => opChevron.evaluate((el) => getComputedStyle(el).transform), { timeout: 2_000 }).toBe(DOWN)

    // The project BRANCH head (collapsed by design) → identity; expanded → down.
    const branch = page.locator('.rail-project-group').first()
    const branchChevron = branch.locator('.rail-project-head > .icon')
    expect(await branchChevron.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    await branch.locator('.rail-project-head').click()
    await expect.poll(() => branchChevron.evaluate((el) => getComputedStyle(el).transform), { timeout: 2_000 }).toBe(DOWN)

    // The aspect SUB-GROUP heads carry the chevron too (they expand)…
    const subChevron = branch.locator('.rail-sub-group > .rail-group-head > .icon').first()
    expect(await subChevron.locator('path').evaluate((el) => el.getAttribute('d'))).toBe('m9 6 6 6-6 6')
    // …while PLAIN rows (nothing to expand) carry NO chevron at all.
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S177 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    expect(await plain.locator('svg').count()).toBe(0)
  })

  test('block 5 (RTL): the collapsed chevron points at the INLINE-END (left), the expanded one still points down', async ({ page }) => {
    await login(page, FA_EMAIL)
    await openProjectsPanel(page) // no EN title pin — the FA panel speaks Farsi

    // language_pref='fa' → documentElement.dir='rtl'
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')

    // The collapsed BRANCH head chevron mirrors to point LEFT (the RTL inline-end).
    const branch = page.locator('.rail-project-group').first()
    const branchChevron = branch.locator('.rail-project-head > .icon')
    expect(await branchChevron.evaluate((el) => getComputedStyle(el).transform)).toBe(MIRRORED)
    // Expanding REPLACES the mirror with the rotation — the down-tip is direction-
    // neutral (polled through the 0.14s rotation).
    await branch.locator('.rail-project-head').click()
    await expect.poll(() => branchChevron.evaluate((el) => getComputedStyle(el).transform), { timeout: 2_000 }).toBe(DOWN)

    // The indent ladder mirrors too — in RTL the indent rides the INLINE-START
    // edge (the RIGHT), and the tree's rows are full-width flex children whose
    // LEFT edge never moves, so the pins read the END edge (x + width): each
    // deeper level's end edge sits ~16px further from the start edge.
    const subHead = branch.locator('.rail-sub-group > .rail-group-head').first()
    await subHead.click()
    const leaf = branch.locator('.rail-sub-group .rail-item').first()
    const projBox = await branch.locator('.rail-project-head').boundingBox()
    const subBox = await subHead.boundingBox()
    const leafBox = await leaf.boundingBox()
    expect(subBox!.x + subBox!.width).toBeLessThan(projBox!.x + projBox!.width - 14)
    expect(leafBox!.x + leafBox!.width).toBeLessThan(subBox!.x + subBox!.width - 14)
  })

  test('block 6: the ↗ chip hides by default, reveals on hover + focus + selection', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    const branch = page.locator('.rail-project-group').first()
    const chip = branch.locator('.rail-group-goto')
    // Default: hidden (opacity 0 — still focusable, never display:none).
    expect(await chip.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
    // Hovering the ROW reveals it (the 0.14s fade is polled through).
    await branch.locator('.rail-group-headrow').hover()
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('1')
    // Keyboard focus on the chip (or the row) keeps it revealed — :focus-within.
    await page.mouse.move(0, 0) // leave the hover state
    await chip.focus()
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('1')

    // Navigating via the chip: the branch you are ON keeps its chip ALWAYS lit.
    await chip.click()
    await page.waitForURL(/project\.html\?id=.+$/, { timeout: 10_000 })
    await expect(page.locator('.rail-project-group.is-here').first()).toBeVisible()
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('1')
  })

  test('block 6 (coarse pointer): the ↗ chip stays visible without hover', async ({ browser }) => {
    // A touch-class device at desktop width (the rail panel only renders >1024px).
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
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
    // The emulation must actually model a coarse pointer — pin the media state.
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
    const chip = page.locator('.rail-group-goto').first()
    await expect(chip).toHaveCount(1)
    // No hover ever happens — the chip is visible on sight.
    expect(await chip.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await ctx.close()
  })
})
