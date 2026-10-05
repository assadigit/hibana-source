// e2e/s177-sidebar-quiet.spec.ts — S177 + S178 (owner rounds, the design advisor's
// blocks for the Projects sidebar panel — the "quiet sidebar" + its refinement):
// 1) The PANEL HEADER rides the sidebar's own surface (no gray well) + a thin
//    divider; TEXT-ONLY group headers (no fill, no radius, small/medium/muted
//    type) with the count INLINE AFTER the title (smaller + muted, never at the
//    row's far edge), groups separated by 16–20px of vertical space, muted ink
//    still clearing 4.5:1 AA on the panel.
// 2) The TYPE HIERARCHY: project names one step over the group header (medium
//    weight, primary ink), child rows slightly smaller (regular, secondary),
//    tight row heights (project ~30–32px, child ~26–28px, ≥40px on coarse
//    pointers), and a collapsed project row exactly as tall as any other.
// 3) The SELECTED row is the ONLY filled element: the accent pill + a short
//    INSET brand bar (~4px in, ~3px wide, ~60% tall, rounded ends) +
//    aria-current="true"; every other row stays unfilled (a subtle hover wash
//    aside).
// 4) The tree CONNECTOR LINES are gone (vertical guides + branch elbows) —
//    hierarchy rides ~16px logical indents per level (+ lighter/smaller child ink).
// 5) No STATUS DOT before project names; every project row (childless included)
//    reserves the FIXED chevron slot, so all names align at one inline-start edge.
// 6) The PLATFORM chevron convention: inline-end when collapsed, DOWN when
//    expanded (one rotating icon), chevrons only on expandable rows — mirrored
//    true under RTL (collapsed points at the inline-end = LEFT).
// 7) The ↗ goto chip HIDES by default, reveals on row hover + :focus-within +
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

// the plain (childless) project row's LABEL x — the edge every project name shares
const labelX = async (row: import('@playwright/test').Locator) =>
  (await row.locator('.rail-item-label').boundingBox())!.x
// the indent ladder: each nesting level sits ~16px (≥14px) in from its parent
const subBoxOf = (sub: { x: number }, leaf: { x: number }, proj: { x: number }) =>
  sub.x > proj.x + 14 && leaf.x > sub.x + 14

test.describe('S177/S178 — the quiet sidebar (the design advisor\'s blocks)', () => {
  test('panel header (S178): the sidebar\'s own surface + the thin divider — no gray well', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // The head wears the SAME background as the panel/sidebar (--card — the S95
    // pale-well band is retired), and the thin divider along its bottom edge stays.
    const head = page.locator('.rail-panel-head')
    expect(await head.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)') // var(--card)
    const panel = page.locator('.rail-panel')
    expect(await head.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)) // same surface
    expect(await head.evaluate((el) => getComputedStyle(el).borderBlockEndWidth)).toBe('1px')
    expect(await head.evaluate((el) => getComputedStyle(el).borderBlockEndStyle)).toBe('solid')
    // "Open →" stays the one clear action in the header.
    await expect(head.locator('.rail-panel-open-link')).toBeVisible()
  })

  test('group headers (S178 block 2, re-pinned by S188 CHANGE 4): text-only heads, muted ink ≥ AA, the count BADGE at the inline-end edge, 16–20px group bands', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    const head = page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head').first()
    // S188 (CHANGE 2): the top-level heads are STICKY — they paint the panel's own
    // surface (--card) so rows slide under them cleanly (the S177 transparent head
    // is superseded by the sticky cover; the "text-only" register survives in the
    // no-radius + muted-ink pins below).
    expect(await head.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)') // var(--card) — the sticky cover
    expect(await head.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px')
    // Small size, medium weight, muted ink (the eyebrow register).
    expect(await head.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')
    expect(await head.evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px')
    // The muted header ink still clears WCAG AA (4.5:1) against the panel surface.
    expect(await page.evaluate(contrastProbe)).toBeGreaterThanOrEqual(4.5)

    // S188 (owner, CHANGE 4 — SUPERSEDES the S178 inline placement): the count is
    // a BADGE pinned at the row's INLINE-END edge — ONE vertical column of numbers
    // the eye compares across rows. Neutral tint (--bg-soft — never the accent),
    // small font, fully rounded; a CIRCLE at one digit (inline-size == height).
    const label = head.locator('.rail-group-label')
    const count = head.locator('.rail-group-count')
    const headBox = await head.boundingBox()
    const labelBox = await label.boundingBox()
    const countBox = await count.boundingBox()
    expect(countBox!.y).toBeGreaterThanOrEqual(headBox!.y)
    expect(countBox!.y + countBox!.height).toBeLessThanOrEqual(headBox!.y + headBox!.height + 1)
    expect(countBox!.x).toBeGreaterThan(labelBox!.x + labelBox!.width) // past the title…
    // …pinned AT the far edge: the badge's end sits ~8px (the 0.5rem row padding) off the head's end
    expect(Math.round(headBox!.x + headBox!.width - (countBox!.x + countBox!.width))).toBe(8)
    expect(await count.evaluate((el) => getComputedStyle(el).fontSize)).toBe('10px') // small font
    expect(await count.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(222, 222, 222)') // --bg-soft, the neutral tint
    expect(await count.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px') // fully rounded
    expect(Math.round(countBox!.width)).toBe(Math.round(countBox!.height)) // a CIRCLE at one digit (seeded: 1 project)
    expect(await count.evaluate((el) => getComputedStyle(el).color)).toBe(await head.evaluate((el) => getComputedStyle(el).color)) // muted like its head
    // The badge's accessible name speaks the noun ("1 projects").
    await expect(count).toHaveAttribute('aria-label', '1 projects')

    // Groups separate by 16–20px of vertical space above each header (the
    // sibling margin), not boxes.
    expect(await page.evaluate(() => {
      const g = document.querySelectorAll('.rail-panel-body > .rail-group')
      return g.length >= 2 ? Number.parseFloat(getComputedStyle(g[1]).marginBlockStart) : -1
    })).toBeGreaterThanOrEqual(16)
    // …and the gap between GROUPS is clearly larger than the gap between ROWS.
    const groupGap = await page.evaluate(() => {
      const g = document.querySelectorAll('.rail-panel-body > .rail-group')
      return g.length >= 2 ? Number.parseFloat(getComputedStyle(g[1]).marginBlockStart) : -1
    })
    const rowGap = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.querySelector('.rail-group-body') as HTMLElement).rowGap))
    expect(groupGap).toBeGreaterThan(rowGap * 4)
  })

  test('blocks 3+4+9 (S178, heights re-pinned by S188 CHANGE 1): the type hierarchy, ONE equal row height, chevron slot alignment — guide lines on the NESTED levels, no dots', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Block 4: NO status dot before any project name (plain row or branch head) —
    // the stage grouping already encodes the status, so the dot was noise.
    expect(await page.locator('[data-rail-panel-box] .rail-dot').count()).toBe(0)

    // The TYPE HIERARCHY (S178 block 3): the project name sits one step over the
    // group header (14px vs 12px), weighs MEDIUM (500), speaks the primary ink;
    // the child rows are slightly smaller, REGULAR, secondary.
    const branch = page.locator('.rail-project-group').first()
    const head = branch.locator('.rail-project-head')
    const name = head.locator('.rail-project-row')
    expect(await name.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
    expect(await name.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')
    expect(await head.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(20, 20, 20)') // --text (primary)

    // ROW HEIGHTS (S178 block 4): the branch head stands ~30–32px, and a COLLAPSED
    // project row (block 6) is EXACTLY as tall as any other project row — the
    // folded body leaves no margin/padding/height behind (display:none).
    await expect(branch).toHaveClass(/is-collapsed/)
    const foldedBox = await head.boundingBox()
    expect(foldedBox!.height).toBeGreaterThanOrEqual(30)
    expect(foldedBox!.height).toBeLessThanOrEqual(32)
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S177 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click() // ships folded
    const plainBox = await plain.boundingBox()
    expect(Math.round(plainBox!.height)).toBe(Math.round(foldedBox!.height)) // same height, folded or childless

    // Block 9 (the FIXED chevron slot): the childless row reserves the chevron's
    // width — the SLOT span — so its name lands at the SAME inline-start edge as
    // the expandable branch's name (one aligned scanning edge).
    const slot = plain.locator('.rail-chev-slot')
    await expect(slot).toHaveCount(1)
    const slotBox = await slot.boundingBox()
    expect(Math.round(slotBox!.x - plainBox!.x)).toBe(8) // 0.5rem row padding, then the slot
    const branchNameBox = await name.boundingBox()
    expect(Math.round(await labelX(plain))).toBe(Math.round(branchNameBox!.x)) // names align (±0px)

    // Block 3: expand the branch + its first sub-group, pin the CHILD register
    // (12px/400/muted — smaller than the project name, lighter than the head)
    // and the indentation ladder + the S188 guide lines (nested levels only).
    await head.click()
    const subHead = branch.locator('.rail-sub-group .rail-group-head').first()
    const subLabel = subHead.locator('.rail-group-label')
    expect(await subLabel.evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px')
    expect(await subLabel.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('400')
    expect(await subHead.evaluate((el) => getComputedStyle(el).color)).not.toBe(await head.evaluate((el) => getComputedStyle(el).color)) // secondary vs primary
    // S188 (CHANGE 4): the section's count badge rides at the sub-head's INLINE-END
    // edge — the same badge column the stage heads speak.
    const subCount = subHead.locator('.rail-group-count')
    const subCountBox = await subCount.boundingBox()
    const subLabelBox = await subLabel.boundingBox()
    const subHeadBox = await subHead.boundingBox()
    expect(subCountBox!.x).toBeGreaterThan(subLabelBox!.x + subLabelBox!.width) // past the label…
    expect(Math.round(subHeadBox!.x + subHeadBox!.width - (subCountBox!.x + subCountBox!.width))).toBe(8) // …at the far edge
    expect(await subCount.evaluate((el) => getComputedStyle(el).fontSize)).toBe('10px')
    // S188 (CHANGE 1 — SUPERSEDES the S178 tighter-child register): the section
    // head joins the tree's ONE equal row height (~30–34px — the project rows'
    // own 32px rhythm; single-line, equal-height rows scan).
    expect(subHeadBox!.height).toBeGreaterThanOrEqual(30)
    expect(subHeadBox!.height).toBeLessThanOrEqual(34)

    await subHead.click()
    const leaf = branch.locator('.rail-sub-group .rail-item').first()
    const leafBox = await leaf.boundingBox()
    const projBox = await head.boundingBox()
    // each nesting level indents ~16px (1rem) from its parent row
    expect(subBoxOf(subHeadBox, leafBox, projBox)).toBe(true)
    // child ink is LIGHTER than its parent (the muted leaf vs the primary row)
    const leafColor = await leaf.evaluate((el) => getComputedStyle(el).color)
    const projColor = await head.evaluate((el) => getComputedStyle(el).color)
    expect(leafColor).not.toBe(projColor)
    // S188 (CHANGE 1): the leaf speaks ONE line — title only, ellipsis on overflow
    // (the old 2-line clamp is what made each idea read as a two-line text blob).
    const leafLabel = leaf.locator('.rail-item-label')
    expect(await leafLabel.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap')
    expect(await leafLabel.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden')
    expect(await leafLabel.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
    // …and EVERY row in the tree stands at the SAME height (the leaf == the project row)
    expect(Math.round(leafBox!.height)).toBe(Math.round(foldedBox!.height))
    // S188 (CHANGE 3 — SUPERSEDES the S177 retirement, nested levels only): the
    // guide lines return — 1px logical borders on the project + section bodies,
    // rounded elbow spans on the children — while the TOP-LEVEL stage body stays
    // bare (plain text + chevron, no line).
    const connectors = await page.evaluate(() => {
      const stageBody = document.querySelector('.rail-panel-body > .rail-group > .rail-group-body') as HTMLElement | null
      const projBody = document.querySelector('.rail-project-group > .rail-group-body') as HTMLElement | null
      const subBody = document.querySelector('.rail-sub-group > .rail-group-body') as HTMLElement | null
      const elbow = document.querySelector('.rail-sub-group .rail-elbow') as HTMLElement | null
      const elbowStyle = elbow ? getComputedStyle(elbow) : null
      return {
        stageGuide: stageBody ? getComputedStyle(stageBody).borderInlineStartWidth : 'missing',
        projGuide: projBody ? getComputedStyle(projBody).borderInlineStartWidth : 'missing',
        projGuideColor: projBody ? getComputedStyle(projBody).borderInlineStartColor : 'missing',
        subGuide: subBody ? getComputedStyle(subBody).borderInlineStartWidth : 'missing',
        elbowCount: document.querySelectorAll('.rail-sub-group .rail-elbow').length,
        elbowHeight: elbowStyle ? elbowStyle.blockSize : 'missing',
        elbowRadius: elbowStyle ? elbowStyle.borderRadius : 'missing',
      }
    })
    expect(connectors.stageGuide).toBe('0px')    // top-level groups: NO line (plain text + chevron)
    expect(connectors.projGuide).toBe('1px')     // the project's body carries the 1px guide
    expect(connectors.subGuide).toBe('1px')      // each section's body carries the 1px guide
    expect(connectors.projGuideColor).toBe('rgb(212, 212, 212)') // --line (the low-contrast token ink)
    expect(connectors.elbowCount).toBeGreaterThan(0)
    expect(connectors.elbowHeight).toBe('1px')
    expect(connectors.elbowRadius).toBe('999px') // rounded ends
  })

  test('block 2+11 (S178): the selected row — the only fill, the INSET accent bar, aria-current="true"', async ({ page }) => {
    await login(page)
    await openProjectsPanel(page)

    // Unselected rows carry NO fill (transparent) — hover may wash subtly, and the
    // SELECTION is the single filled element in the panel.
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S177 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    expect(await plain.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')

    // Navigate onto the plain project's page: its row lights — the accent PILL
    // (rounded corners kept) + the short INSET bar + aria-current="true" (the
    // programmatic twin of the wash).
    await plain.click()
    await page.waitForURL(/project\.html\?id=.+$/, { timeout: 10_000 })
    await expect(page.locator('[data-rail-panel-box]')).toBeVisible()
    await expect(plain).toHaveClass(/is-row-active/)
    await expect(plain).toHaveAttribute('aria-current', 'true')
    // The accent wash — POLLED: every <a> transitions background-color 0.15s
    // (base.css's global button/.chip/a/input rule), so an instant read catches
    // the oklab mid-flight color.
    await expect.poll(() => plain.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(74, 159, 163, 0.13)')
    // The pill's corners stay rounded (the flush bar never squared them).
    expect(await plain.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('8px')
    const pill = await plain.evaluate((el) => getComputedStyle(el, '::before'))
    expect(pill.content).not.toBe('none') // the inset accent bar renders
    expect(pill.backgroundColor).toBe('rgb(61, 141, 145)') // the S181 color-block bar ink (--brand-hover rung: 3.42:1 on the wash)
    // S178 block 11 — the INSET bar: ~4px in from the pill's inline-start edge,
    // ~3px wide, ~60% of the row's height, ROUNDED ends.
    expect(pill.left).toBe('4px')
    expect(pill.width).toBe('3px')
    const rowBox = await plain.boundingBox()
    expect(Number.parseFloat(pill.height)).toBeGreaterThan(rowBox!.height * 0.5)
    expect(Number.parseFloat(pill.height)).toBeLessThan(rowBox!.height * 0.7)
    expect(pill.borderRadius).toBe('999px')

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
    // the branch you are ON wears the same register on its headrow — the accent
    // wash with the same INSET bar geometry, and the goto chip (the branch's own
    // link) carries aria-current and stays revealed (the 0.14s opacity fade is
    // polled through).
    const branch = page.locator('.rail-project-group').first()
    const chip = branch.locator('.rail-group-goto')
    await branch.locator('.rail-group-headrow').hover()
    await chip.click()
    await expect(branch).toHaveClass(/is-here/, { timeout: 10_000 })
    await expect(chip).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_000 }).toBe('1')
    const headrow = branch.locator('.rail-group-headrow')
    await expect.poll(() => headrow.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2_000 }).toBe('rgba(74, 159, 163, 0.13)')
    const branchBar = await headrow.evaluate((el) => getComputedStyle(el, '::before'))
    expect(branchBar.content).not.toBe('none')
    expect(branchBar.backgroundColor).toBe('rgb(61, 141, 145)')
    expect(branchBar.left).toBe('4px')   // inset from the pill's inline-start edge
    expect(branchBar.width).toBe('3px')  // ~3px wide
    expect(branchBar.borderRadius).toBe('999px')
    const headrowBox = await headrow.boundingBox()
    expect(Number.parseFloat(branchBar.height)).toBeGreaterThan(headrowBox!.height * 0.5)  // ~60% tall
    expect(Number.parseFloat(branchBar.height)).toBeLessThan(headrowBox!.height * 0.7)
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

    // The aspect SUB-GROUP heads carry the chevron too (they expand — "New ideas",
    // "Problems", "Plans" are collapsible rows with counts, not bare labels)…
    const subChevron = branch.locator('.rail-sub-group > .rail-group-head > .icon').first()
    expect(await subChevron.locator('path').evaluate((el) => el.getAttribute('d'))).toBe('m9 6 6 6-6 6')
    // …while PLAIN rows (nothing to expand) carry NO chevron glyph — only the
    // fixed-width EMPTY SLOT that keeps their name aligned with the branch heads.
    const plain = page.locator('.rail-item.rail-project-row', { hasText: 'S177 plain project' })
    await page.locator('.rail-group:not(.rail-sub-group):not(.rail-project-group) > .rail-group-head', { hasText: 'Operational' }).click()
    expect(await plain.locator('svg').count()).toBe(0)
    expect(await plain.locator('.rail-chev-slot').count()).toBe(1) // the slot, not a glyph
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

  test('block 4+6 (coarse pointer): the ↗ chip stays visible without hover, rows grow to the ≥40px touch floor', async ({ browser }) => {
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
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await page.click('.rail .rail-primary a[data-rail-panel="projects"]')
    await page.waitForSelector('.rail-group-head', { timeout: 10_000 })
    const chip = page.locator('.rail-group-goto').first()
    await expect(chip).toHaveCount(1)
    // No hover ever happens — the chip is visible on sight.
    expect(await chip.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    // S178 block 4: the tree's rows stand ≥40px on coarse pointers (both the
    // project rows and the child rows ride the 2.5rem floor).
    const branchHead = page.locator('.rail-project-head').first()
    const branchHeadBox = await branchHead.boundingBox()
    expect(branchHeadBox!.height).toBeGreaterThanOrEqual(40)
    await branchHead.click() // expand the branch for a child row
    const subHead = page.locator('.rail-sub-group .rail-group-head').first()
    const subHeadBox = await subHead.boundingBox()
    expect(subHeadBox!.height).toBeGreaterThanOrEqual(40)
    await ctx.close()
  })
})
