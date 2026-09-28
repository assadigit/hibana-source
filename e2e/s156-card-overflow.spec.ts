// e2e/s156-card-overflow.spec.ts — S156 (owner reports, both board-page):
//   (1) "The content is outside — sometimes the contents go outside the area
//        container": an idea card whose description held a long x.com URL painted
//        PAST the card's right edge. ROOT CAUSE: .clip-2's line-clamp hides extra
//        LINES but never fixes the BOX — a grid item's min-width:auto refuses to
//        shrink below an unbreakable token's min-content, so the desc element
//        extended past the card, and .card-grid's 1fr track floored at the item's
//        min-content and widened the whole column past the container ("sometimes").
//        Fix: overflow-wrap:anywhere + min-inline-size:0 on .clip-2, the
//        .card-grid > * belt, the sibling .kanban-card strong.
//   (2) "Align the 'no tasks yet' to center": .pd-board-empty carried
//        justify-items:start — the Project Progress empty state now centers
//        (justify-items:center + text-align:center, direction-neutral).
// Pins (geometric, computed against live boxes — not class names):
//   (1) LTR light desktop: the desc BOX sits inside its card's box on BOTH edges,
//       the card inside its track, and the page has NO horizontal scroll — with a
//       130-char unbreakable URL seeded as the description.
//   (2) the owner's FA/RTL surface (profile-driven language): same containment.
//   (3) 390px: same containment + no h-scroll.
//   (4) the empty board: justify-items:center COMPUTED + the title/icon optically
//       centered (±2px) at desktop AND 390px.
// Spec lessons banked (S156/S120): /projects.html?status=spark is NOT the ideas
// card surface — the flat shelf is /sparks.html + click [data-sf="all"] (the
// ?folder=all query is NOT honored on hard load); the desc EMPTY placeholder has
// no .clip-2 (a naive .pc-desc probe computes overflow-wrap:normal and lies).
// Run: npx playwright test e2e/s156-card-overflow.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s156@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const FA_EMAIL = 'e2e-s156-fa@test.local'
const FA_USER_ID = randomBytes(16).toString('hex')
// the idea card whose description is the long unbreakable token
const URL_PROJ_ID = randomBytes(16).toString('hex')
// a second spark so the shelf's grid renders (and the folder counts are honest)
const PLAIN_PROJ_ID = randomBytes(16).toString('hex')
// the project whose detail page shows the empty Project Progress board
const EMPTY_PROJ_ID = randomBytes(16).toString('hex')
// 130 chars, no break opportunity anywhere — the min-content killer
const LONG_URL = 'https://x.com/' + 'a'.repeat(116)

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
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}'))`)
    db.exec(`DELETE FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}')`)
  } catch { /* first run */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s156', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${FA_USER_ID}', 'e2e-s156-fa', '${FA_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'fa', 'shamsi', 'UTC', '${now}', '${now}')`,
  )
  // the URL card (a spark — the ideas shelf's row type) + a plain sibling + the
  // empty-detail project (a non-spark status, zero dev_tasks → [data-pd-empty])
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${URL_PROJ_ID}', '${USER_ID}', 's156 url card', '${LONG_URL}', 'personal', 'spark', 0, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PLAIN_PROJ_ID}', '${USER_ID}', 's156 plain card', 'A short description with ordinary words.', 'personal', 'spark', 1, '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${EMPTY_PROJ_ID}', '${USER_ID}', 's156 empty board', '', 'personal', 'planning', 2, '${now}', '${now}')`,
  )
  // the FA user needs their OWN spark (rows are user-scoped — rule 1): without it
  // the fa shelf renders the zero-ideas empty state and no [data-sf="all"] at all
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${randomBytes(16).toString('hex')}', '${FA_USER_ID}', 's156 fa url card', '${LONG_URL}', 'personal', 'spark', 0, '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page, opts?: { as?: string }) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', opts?.as ?? TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

// the flat ideas shelf: /sparks.html renders the FOLDER GRID home (?folder=all is
// NOT honored on hard load — the S120/S156 lesson); click the visible "all" chip.
async function openFlatShelf(page: Page) {
  await page.goto('/sparks.html')
  const all = page.locator('[data-sf="all"]').first()
  await all.waitFor({ state: 'visible', timeout: 10_000 })
  await all.click()
  await page.locator('.spark-card').first().waitFor({ state: 'visible', timeout: 10_000 })
}

// the geometric pins: desc box inside card box on BOTH edges, card inside its
// grid track, no page horizontal scroll. Bounding-box containment is
// direction-neutral (works identically in RTL).
async function pinContainment(page: Page) {
  // S161: mobile (≤640px) CONDENSES cards — the desc is display:none until the
  // first tap expands it. Measure AFTER expanding (the S167 lesson: expand-before-
  // measuring), or the bounding boxes lie.
  if ((await page.evaluate(() => window.innerWidth)) <= 640) {
    await page.locator('.spark-card [data-spark-expand]').first().click()
    await page.waitForTimeout(150)
  }
  const r = await page.evaluate(() => {
    const card = document.querySelector('.spark-card') as HTMLElement
    // ONLY the clamp-carrying desc — the empty placeholder has no .clip-2 and
    // would compute overflow-wrap:normal and lie (the S156 lesson)
    const desc = card.querySelector('.spark-card-desc.clip-2') as HTMLElement
    const grid = document.querySelector('.card-grid') as HTMLElement
    const c = card.getBoundingClientRect()
    const d = desc.getBoundingClientRect()
    const g = grid.getBoundingClientRect()
    return {
      wrap: getComputedStyle(desc).overflowWrap,
      minInline: getComputedStyle(desc).minInlineSize,
      descInCard: d.left >= c.left - 1 && d.right <= c.right + 1,
      cardInGrid: c.left >= g.left - 1 && c.right <= g.right + 1,
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
      cardRight: Math.round(c.right), descRight: Math.round(d.right),
      docW: document.documentElement.scrollWidth, vw: window.innerWidth,
    }
  })
  expect(r.wrap, 'overflow-wrap:anywhere must compute on the clamp desc').toBe('anywhere')
  expect(r.minInline, 'min-inline-size:0 must compute on the clamp desc').toBe('0px')
  expect(r.descInCard, `desc box [${r.descRight}] must sit inside its card [..${r.cardRight}] on both edges`).toBe(true)
  expect(r.cardInGrid, 'card must sit inside its grid track').toBe(true)
  expect(r.noHScroll, `page must not h-scroll (doc ${r.docW} vs viewport ${r.vw})`).toBe(true)
}

test('LTR light desktop: the URL desc box is contained in its card and the page never h-scrolls', async ({ page }) => {
  await login(page)
  await openFlatShelf(page)
  await pinContainment(page)
})

test("the owner's FA/RTL surface: the same containment holds (profile-driven fa)", async ({ page }) => {
  await login(page, { as: FA_EMAIL })
  await openFlatShelf(page)
  const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'))
  expect(dir).toBe('rtl')
  await pinContainment(page)
})

test('390px: the URL card is contained and the page still never h-scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await openFlatShelf(page)
  await pinContainment(page)
})

test("the empty board: 'No tasks yet' centers — computed justify-items + optical title/icon (desktop and 390)", async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${EMPTY_PROJ_ID}`)
  const empty = page.locator('[data-pd-empty]')
  await empty.waitFor({ state: 'visible', timeout: 10_000 })

  const pin = async () => {
    const r = await page.evaluate(() => {
      const empty = document.querySelector('[data-pd-empty]') as HTMLElement
      const title = empty.querySelector('.empty-state-title') as HTMLElement
      const icon = empty.querySelector('.empty-state-icon') as HTMLElement
      const e = empty.getBoundingClientRect()
      const t = title.getBoundingClientRect()
      const i = icon.getBoundingClientRect()
      const mid = (b: DOMRect) => (b.left + b.right) / 2
      return {
        justify: getComputedStyle(empty).justifyItems,
        textAlign: getComputedStyle(empty).textAlign,
        titleOff: Math.abs(mid(t) - mid(e)),
        iconOff: Math.abs(mid(i) - mid(e)),
      }
    })
    expect(r.justify, 'justify-items:center must compute on the empty board').toBe('center')
    expect(r.textAlign, 'text-align:center must compute on the empty board').toBe('center')
    expect(r.titleOff, `title must be optically centered (±2px) — off by ${r.titleOff}px`).toBeLessThanOrEqual(2)
    expect(r.iconOff, `icon must be optically centered (±2px) — off by ${r.iconOff}px`).toBeLessThanOrEqual(2)
  }

  await pin() // desktop
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await empty.waitFor({ state: 'visible', timeout: 10_000 })
  await pin() // mobile
})
