// e2e/s184-section-grammar.spec.ts — S184 (the owner's layout/consistency audit of
// the v0.4.1.10 dashboard — the six-instruction round):
//   (1) "Place all five section cards in one parent container. Set one gap on that
//       container (~24px). Remove the vertical margins from the individual cards.
//       Set the space between the 'Dashboard' page title and the first card to the
//       same gap value." — main.shell-dash is the parent: a flex column with ONE
//       1.5rem gap; no child carries a block margin; the measured card-to-card
//       beats are all 24px (the audit measured ~80/~80/~50/~17px drift).
//   (2) "Define one card padding value (~16px)… one min-height on all card headers
//       (~48px)… one font size and one font weight for all card titles (~18px,
//       medium)." — every head strip: 3rem min-height, vertically centered, 1rem
//       inline inset on every panel, the title's start edge aligned with the body
//       content's start edge.
//   (3) "Use one link style in all card headers… 'Go to [page] →' wording for
//       card-level links. Reserve 'View all' for the column-level links inside
//       cards." — every head link wears .dash-sec-link (one computed color/size/
//       weight + a trailing arrow); the overview head gains "Go to tasks →" onto
//       /tasks.html (its own destination page); the notebook's head link is "Go to
//       notebook →" onto /whiteboard.html (the page the app names "Notebook" — the
//       vault's /notes.html is a different feature); its archive "View all (N)"
//       button rides the card's FOOT (column-level vocabulary).
//   (4) "Give the input the same surface color as its card. Add a visible 1px
//       border. Strengthen the border and show a focus ring on :focus." — the
//       composer's computed surface == the card's, a 1px --line-strong border, the
//       accent border + halo ring on focus; the dark twin keeps the recessed well.
//       Plus the Continue card's foot: the chips row clears the bottom edge (16px =
//       the side inset) and sits ~12px under the hero row (the audit measured ~2px
//       + a near-touch).
// Run: npx playwright test e2e/s184-section-grammar.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s184@test.local'
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
    db.exec(`DELETE FROM projects WHERE user_id LIKE 's184-%'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id LIKE 's184-%'`)
    db.exec(`DELETE FROM quick_notes WHERE user_id LIKE 's184-%'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('s184-user', 'e2e-s184', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${iso(86400000 * 30)}', '${iso(86400000 * 30)}')`,
  )
  // A vault note keeps the onboarding banner out of the rhythm measures; projects
  // (recent, across stages) feed the carousel + the activity feed + the resume
  // seed; 6 quick notes put the archive "View all (N)" button in the notebook's
  // new foot row.
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s184-note', 's184-user', NULL, 'S184 note', 'x', '', 0, '${iso(86400000)}', '${iso(86400000)}')`,
  )
  for (const [id, title, status, hoursAgo] of [
    ['s184-p1', 'S184 Elixir', 'developing', 2],
    ['s184-p2', 'S184 GitCurator', 'planning', 5],
    ['s184-p3', 'S184 Hibana', 'queued', 26],
    ['s184-p4', 'S184 SportSignal', 'operational', 50],
  ] as const) {
    db.exec(
      `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
       VALUES ('${id}', 's184-user', '${title}', '', 'personal', '${status}', 0, '${iso(86400000 * 9)}', '${iso(3600000 * hoursAgo)}')`,
    )
  }
  for (let i = 1; i <= 6; i++) {
    db.exec(
      `INSERT INTO quick_notes (id, user_id, kind, title, content, color, project_id, sort_order, created_at, updated_at)
       VALUES ('s184-qn${i}', 's184-user', 'note', '', 'note ${i}', 'yellow', NULL, ${i}, '${iso(3600000 * i)}', '${iso(3600000 * i)}')`,
    )
  }
  db.close()
})

async function login(page: Page): Promise<void> {
  await page.goto('/login.html')
  await page.waitForLoadState('load')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('input[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

const G = 24 // the ONE gap value (1.5rem)

test('S184-1: ONE rhythm — the parent flex gap owns every card-to-card beat (24px), no child margins', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.waitForSelector('.resume-strip', { timeout: 10_000 }) // the seed fallback renders the strip
  await page.waitForTimeout(400)                                   // settle the swap + fade transitions

  const rhythm = await page.evaluate(() => {
    const main = document.querySelector('main.shell-dash') as HTMLElement
    const cs = getComputedStyle(main)
    const kids = [...main.children].filter((el) => {
      const k = el as HTMLElement
      return k.tagName !== 'SCRIPT' && k.getBoundingClientRect().height > 0
    }) as HTMLElement[]
    const r = (el: Element) => el.getBoundingClientRect()
    const gaps: number[] = []
    for (let i = 0; i + 1 < kids.length; i++) gaps.push(r(kids[i + 1]).top - r(kids[i]).bottom)
    return {
      display: cs.display,
      gap: cs.rowGap,
      childMargins: kids.map((k) => getComputedStyle(k).marginBottom),
      gaps,
      firstChild: kids[0]?.tagName,
      kidClasses: kids.map((k) => k.className),
    }
  })
  expect(rhythm.display).toBe('flex')
  expect(rhythm.gap).toBe('24px')
  expect(rhythm.firstChild).toBe('H1')
  // No child carries its own block margin — the parent gap is the one beat.
  for (const m of rhythm.childMargins) expect(m).toBe('0px')
  // Every measured beat (h1→resume, resume→todo, todo→projects(+ov inside), …)
  // is the same 24px (±2px rendering tolerance).
  expect(rhythm.gaps.length).toBeGreaterThanOrEqual(4)
  for (const g of rhythm.gaps) expect(Math.abs(g - G)).toBeLessThanOrEqual(2)

  // The projects section's two sibling panels ride the SAME beat internally.
  const innerGap = await page.evaluate(() => {
    const sec = document.querySelector('.dash-projects-section') as HTMLElement
    return getComputedStyle(sec).rowGap
  })
  expect(innerGap).toBe('24px')
})

test('S184-2: ONE inset + ONE head geometry — 3rem min-height head strips, 1rem inline padding, title aligned with the body', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.waitForSelector('.resume-strip', { timeout: 10_000 })
  await page.waitForTimeout(400)

  const panels = await page.evaluate(() => {
    const sels = ['.resume-strip.card', '.dash-todo-panel', '.dash-projects-panel', '.dash-ov-panel', '.card.notebook-dashboard', '.dash-activity-panel']
    return sels.map((sel) => {
      const card = document.querySelector(sel) as HTMLElement | null
      if (!card) return { sel, missing: true }
      const head = card.querySelector(':scope > .dash-sec-head') as HTMLElement
      const title = head.querySelector('.dash-sec-title') as HTMLElement
      const body = [...card.children].find((c) => c !== head && (c as HTMLElement).getBoundingClientRect().height > 0) as HTMLElement
      const hr = head.getBoundingClientRect()
      const cr = card.getBoundingClientRect()
      const tr = title.getBoundingClientRect()
      const br = body.getBoundingClientRect()
      const bcs = getComputedStyle(body)
      const hcs = getComputedStyle(head)
      return {
        sel,
        missing: false,
        headMinH: hcs.minBlockSize,
        headH: hr.height,
        // the head's own inline padding (S184: 1rem everywhere)
        headPadInline: hcs.paddingInlineStart,
        // the title's ABSOLUTE inset from the card's border edge ≈ 16px (+ the 1px card border)
        titleInset: tr.left - cr.left,
        // the first body block's CONTENT inset — its own inline padding joins the
        // same 16px line as the title (the wrappers span the card's full width)
        bodyInset: br.left + parseFloat(bcs.paddingLeft) - cr.left,
        titleSize: getComputedStyle(title).fontSize,
        titleWeight: getComputedStyle(title).fontWeight,
        centered: hcs.alignItems,
      }
    })
  })
  for (const p of panels) {
    expect(p.missing, `panel ${p.sel} missing`).toBe(false)
    expect(p.headMinH).toBe('48px')
    expect(p.headH).toBeGreaterThanOrEqual(47)
    expect(p.headPadInline).toBe('16px')
    expect(Math.abs(p.titleInset - 16)).toBeLessThanOrEqual(1)
    expect(Math.abs(p.bodyInset - 16)).toBeLessThanOrEqual(1)
    // One title size + one weight (the S157 ladder's 500 — S183 kept, S184 pins)
    expect(p.titleSize).toBe('18px')
    expect(p.titleWeight).toBe('500')
    expect(p.centered).toBe('center')
  }
})

test('S184-3: ONE header link grammar — every head link .dash-sec-link, "Go to [page]" wording, arrows; "View all" stays column-level', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.waitForSelector('.resume-strip', { timeout: 10_000 })
  await page.waitForTimeout(400)

  const links = await page.evaluate(() =>
    [...document.querySelectorAll('.dash-sec-head .dash-sec-link')].map((a) => {
      const el = a as HTMLElement
      const cs = getComputedStyle(el)
      return {
        href: el.getAttribute('href') || '',
        text: (el.textContent || '').trim(),
        color: cs.color,
        size: cs.fontSize,
        weight: cs.fontWeight,
        hasArrow: !!el.querySelector('.icon.arrow, svg.icon'),
      }
    }),
  )
  // The five card-level links (todo, projects, overview, notebook, activity).
  expect(links.length).toBe(5)
  const byHref: Record<string, (typeof links)[number]> = {}
  for (const l of links) byHref[l.href] = l
  expect(byHref['/to-do-list'].text).toContain('Go to to-do list')
  expect(byHref['/projects.html'].text).toContain('Go to projects')
  expect(byHref['/tasks.html'].text).toContain('Go to tasks')
  expect(byHref['/whiteboard.html'].text).toContain('Go to notebook')
  for (const l of links) {
    expect(l.text.startsWith('Go to')).toBe(true)
    expect(l.hasArrow, `link ${l.href} lost its trailing arrow`).toBe(true)
  }
  // ONE computed grammar across all five.
  const first = links[0]
  for (const l of links) {
    expect(l.color).toBe(first.color)
    expect(l.size).toBe(first.size)
    expect(l.weight).toBe(first.weight)
  }
  expect(first.weight).toBe('500')
  // "View all" stays COLUMN-level: the stat boxes' hop + the notebook's foot
  // archive button (moved out of the head in S184).
  const colLevel = await page.evaluate(() => ({
    statViewalls: document.querySelectorAll('.stat-carousel .stat-viewall').length,
    footBtn: document.querySelector('.dash-note-foot .note-view-all'),
    footText: (document.querySelector('.dash-note-foot .note-view-all')?.textContent || '').trim(),
    headBtnGone: !document.querySelector('.dash-notebook-head .note-view-all'),
  }))
  expect(colLevel.statViewalls).toBeGreaterThanOrEqual(5)
  expect(colLevel.footBtn).toBeTruthy()
  expect(colLevel.footText).toBe('View all (6)')
  expect(colLevel.headBtnGone).toBe(true)
})

test('S184-4: the composer affordance + the Continue card\'s foot (light + the dark well twin)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.waitForSelector('.resume-strip', { timeout: 10_000 })
  await page.waitForTimeout(400)

  const light = await page.evaluate(() => {
    const card = document.querySelector('.card.notebook-dashboard') as HTMLElement
    const field = document.querySelector('.notebook-dashboard .note-compose-text') as HTMLTextAreaElement
    const ccs = getComputedStyle(card)
    const fcs = getComputedStyle(field)
    return {
      cardBg: ccs.backgroundColor,
      fieldBg: fcs.backgroundColor,
      borderWidth: fcs.borderTopWidth,
      borderColor: fcs.borderTopColor,
      placeholderColor: getComputedStyle(field, '::placeholder').color,
    }
  })
  // The field speaks the card's own surface — never the page canvas's gray.
  expect(light.fieldBg).toBe(light.cardBg)
  expect(light.fieldBg).not.toBe('rgb(231, 231, 231)')
  expect(light.borderWidth).toBe('1px')
  // A VISIBLE border — the --line-strong register (#BFBFBF = rgb(191,191,191)),
  // one step stronger than the --line hairline (#D4D4D4) the old field wore.
  expect(light.borderColor).toBe('rgb(191, 191, 191)')

  // The focus ring: accent border + the 3px halo (the app's input focus grammar).
  await page.focus('.notebook-dashboard .note-compose-text')
  await page.waitForTimeout(120)
  const focused = await page.evaluate(() => {
    const field = document.querySelector('.notebook-dashboard .note-compose-text') as HTMLTextAreaElement
    const cs = getComputedStyle(field)
    return { borderColor: cs.borderTopColor, shadow: cs.boxShadow }
  })
  expect(focused.borderColor).not.toBe(light.borderColor)
  expect(focused.shadow).not.toBe('none')

  // The Continue card: the chips row clears the bottom edge by the side inset
  // (16px, measured tile-bottom → card-bottom, was ~2px) and sits ~12px under the
  // hero row — no fixed height, the natural flow owns the card.
  const foot = await page.evaluate(() => {
    const row = document.querySelector('.resume-strip .resume-row') as HTMLElement
    const body = document.querySelector('.resume-strip .resume-body') as HTMLElement
    const card = document.querySelector('.resume-strip.card') as HTMLElement
    if (!row) return { missing: true }
    const rcs = getComputedStyle(row)
    return {
      missing: false,
      padTop: rcs.paddingTop,
      padBottom: rcs.paddingBottom,
      // the row's CONTENT top (its 0.75rem padding-top rides inside the element)
      heroToChips: row.getBoundingClientRect().top + parseFloat(rcs.paddingTop) - body.getBoundingClientRect().bottom,
      // the TILES' content bottom — the row's 16px foot padding rides inside the
      // element, so the content edge is paddingBottom above the row's box bottom
      tilesToCardBottom: card.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom + parseFloat(rcs.paddingBottom),
    }
  })
  expect(foot.missing).toBe(false)
  expect(foot.padTop).toBe('12px')
  expect(foot.padBottom).toBe('16px')
  expect(foot.heroToChips).toBeGreaterThanOrEqual(11)
  // The tiles clear the card's bottom edge by ~the side inset (16px + the 1px border).
  expect(Math.abs(foot.tilesToCardBottom - 17)).toBeLessThanOrEqual(2)

  // The dark twin: the composer keeps the RECESSED well (a lower well reads as an
  // input on a dark canvas — only light's gray-on-gray read as disabled).
  await page.evaluate(() => { try { localStorage.setItem('hibana-theme', 'claude-dark') } catch { /* private mode */ } })
  await page.reload()
  await page.waitForSelector('.resume-strip', { timeout: 10_000 })
  await page.waitForTimeout(400)
  const dark = await page.evaluate(() => {
    const field = document.querySelector('.notebook-dashboard .note-compose-text') as HTMLTextAreaElement
    const card = document.querySelector('.card.notebook-dashboard') as HTMLElement
    return {
      theme: document.documentElement.dataset.theme,
      fieldBg: getComputedStyle(field).backgroundColor,
      cardBg: getComputedStyle(card).backgroundColor,
      borderColor: getComputedStyle(field).borderTopColor,
    }
  })
  expect(dark.theme).toBe('claude-dark')
  expect(dark.fieldBg).toBe('rgb(20, 20, 19)')          /* --bg #141413 — the recessed well */
  expect(dark.fieldBg).not.toBe(dark.cardBg)
  expect(dark.borderColor).not.toBe('rgba(0, 0, 0, 0)') /* a visible border in dark too */
  await page.evaluate(() => { try { localStorage.removeItem('hibana-theme') } catch { /* private mode */ } })
})
