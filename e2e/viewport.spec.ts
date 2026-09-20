// e2e/viewport.spec.ts — document-level responsive integrity pins (Session 29 audit).
//
// The S29 responsive sweep (15 pages × 4 widths × EN+FA) found ONE real page-level bug:
// calendar.html scrolled 69px horizontally at 768px (.cal-controls never wrapped — the
// wrap was gated ≤640px). These specs pin the document-level contract on 7 key pages
// at 4 widths (360/768/1024/1440) plus the specific calendar regressions and the
// shell-fills-viewport (sticky-footer) discipline. In-page scroll containers (the
// dashboard quadrant carousel, sadhana sub-bar strip, reports bar-rows) are INTENTIONAL
// and don't affect documentElement scrollWidth — only the document is asserted.
// Run: npx playwright test e2e/viewport.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-viewport@test.local'
const TEST_PASS = 'e2e-password-123'
const WIDTHS = [360, 768, 1024, 1440] as const

// Seed the test user before tests run (migrations auto-run on server boot).
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
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-viewport', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // S43 (mobile audit): the old seed was EMPTY — the reports/settings pins passed
  // vacuously (no timeline entries → no wide feed titles; no tags → the shadowed
  // /api/tags JSON dump was a tiny {"tags":[]} that didn't overflow). Seed the exact
  // shapes that broke: a LONG project title + history rows (the feed), tags (one used,
  // one loose — the settings #taglist), an overdue task (notifications), and a doing
  // project with dev tasks (project-detail board).
  const UUID = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
  const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const longTitle = 'A deliberately long project title that used to overflow the timeline feed sideways'
  const pid = UUID()
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, reminders_enabled, created_at, updated_at)
     VALUES ('${pid}', '${id}', '${longTitle.replace(/'/g, "''")}', '', 'personal', 'developing', 0, '', 0, '${now}', '${now}')`,
  )
  for (const note of ['started the audit sweep', 'fixed the ghost grid track', 'shipped the touch floor']) {
    db.exec(`INSERT INTO project_history_log (id, project_id, note, created_at) VALUES ('${UUID()}', '${pid}', '${note}', '${now}')`)
  }
  db.exec(`INSERT INTO tasks (id, project_id, title, done, due_date, created_at) VALUES ('${UUID()}', '${pid}', 'overdue probe task', 0, '${days(-2)}', '${now}')`)
  const tagUsed = UUID()
  const tagLoose = UUID()
  db.exec(`INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${tagUsed}', '${id}', 'ui', '#d4a373', 1, '${now}')`)
  db.exec(`INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES ('${tagLoose}', '${id}', 'loose', '#e63946', 0, '${now}')`)
  db.exec(`INSERT INTO project_tags (project_id, tag_id) VALUES ('${pid}', '${tagUsed}')`)
  for (const [title, status] of [['board task one', 'idea'], ['board task two', 'in_progress'], ['board task three', 'done']] as const) {
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at, done_at, start_at, end_at, search_tags)
       VALUES ('${UUID()}', '${pid}', '${title}', '${status}', 'medium', 0, '${now}', ${status === 'done' ? `'${now}'` : 'NULL'}, NULL, NULL, '')`,
    )
  }
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  // First-visit SW claim race: the SW registered on the login page activates +
  // clients.claim()s this page → boot.js's controllerchange listener RELOADS /app once.
  // That reload can supersede a goto issued in the next instant (observed: a
  // /calendar.html navigation landing back on /app as navType "reload"). Wait for the
  // claim + the reload to settle BEFORE the test navigates again.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

// Document-level horizontal overflow: the <html> element must never scroll sideways.
const noDocHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// Assert a page never scrolls the DOCUMENT sideways at all four audited widths.
// A fresh goto per width (not a resize) — deterministic CSS media-query evaluation.
async function expectNoHScrollAtAllWidths(page: Page, path: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await noDocHScroll(page)
    expect(overflow, `${path} @${width}px h-scrolls ${overflow}px`).toBeLessThanOrEqual(1)
  }
}

test('login: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await expectNoHScrollAtAllWidths(page, '/login.html')
})

test('dashboard: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/app')
})

test('projects: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/projects.html')
})

test('sparks: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/sparks.html')
})

test('calendar: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/calendar.html')
})

test('reports: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/reports.html')
})

test('settings: no document h-scroll at 360/768/1024/1440', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await expectNoHScrollAtAllWidths(page, '/settings.html')
})

test('calendar @768: the controls row stays fully inside the viewport (regression pin)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/calendar.html')
  await page.waitForLoadState('networkidle')

  // The 69px overflow signature: .cal-controls (prev/today/next + view buttons) extended
  // past the right edge because its wrap was gated ≤640px. Unconditional wrap fixed it.
  const inside = await page.evaluate(() => {
    const el = document.querySelector('.cal-controls')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { right: r.right, clientWidth: document.documentElement.clientWidth }
  })
  expect(inside).not.toBeNull()
  expect(inside!.right).toBeLessThanOrEqual(inside!.clientWidth + 1)
  expect(await noDocHScroll(page)).toBeLessThanOrEqual(1)
})

test('calendar: the Jalali/Gregorian segmented control taps at ≥40px height', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/calendar.html')
  await page.waitForLoadState('networkidle')

  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('.cal-sys button')].map((b) => b.getBoundingClientRect().height),
  )
  expect(heights.length).toBeGreaterThanOrEqual(2) // Jalali + Gregorian pair
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(40)
})

test('short pages fill the viewport — no dead gap below the layout column', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  // The sticky-footer discipline in this app is the .shell column (min-block-size:
  // calc(100vh - 4rem)): a SHORT page must still fill the viewport instead of
  // collapsing into a floating block with dead space below it.
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/login.html')
  await page.waitForLoadState('networkidle')
  const filled = await page.evaluate(() => {
    const shell = document.querySelector('.shell') ?? document.body
    return { shellHeight: shell.getBoundingClientRect().height, vh: window.innerHeight }
  })
  expect(filled.shellHeight).toBeGreaterThanOrEqual(filled.vh - 80) // the 4rem header band
})

// S42 (owner: "this part is too compacted because of right left handles. expand this
// section. make handles over them."): the dashboard's projects-by-stage carousel. The
// OLD layout flanked the strip with the prev/next handles as flex columns — on a 390px
// phone they stole ~80px (2rem + gap per side), so every stage card rendered ~262px
// wide with ellipsized titles. The pin: the strip spans the FULL section width, the
// handles float OVER it (absolute, inside .stat-stage), and at the ends the useless
// handle steps aside (at-start/at-end auto-hide from app.js's syncStatCarousel).
test('dashboard @390: stage-carousel strip is full-width; handles overlay + auto-hide', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  test.setTimeout(60_000) // login + seeding + paging settle
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  // The first-visit onboarding tour's coachmark backdrop intercepts pointer clicks —
  // dismiss it (localStorage gate) before interacting with the carousel.
  await page.evaluate(() => { try { localStorage.setItem('hibana-tour-done', '1') } catch { /* private mode */ } })

  // Idempotent: drop probe projects left by a failed earlier run first.
  await page.evaluate(async () => {
    const list = (await (await fetch('/api/projects')).json()) as { projects?: { id: string; title: string }[] }
    for (const p of list.projects ?? []) {
      if (p.title.startsWith('e2e s42 carousel')) await fetch(`/api/projects/${p.id}`, { method: 'DELETE' })
    }
  })

  // Seed ≥2 non-empty stages so the track actually pages (is-empty boxes are hidden
  // ≤640px; one visible box would be a 1-page carousel and both handles would hide).
  const made: string[] = []
  for (const st of ['planning', 'queued', 'developing']) {
    const res = await page.evaluate(async ({ st }) => {
      const create = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `e2e s42 carousel ${st} ${Date.now()}` }) })
      const { id } = (await create.json()) as { id: string }
      await fetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st }) })
      return id
    }, { st })
    made.push(res)
  }
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  // The at-start fade-out (0.25s transition) must settle before opacity is pinned.
  await page.waitForTimeout(500)

  const geo = await page.evaluate(() => {
    const track = document.querySelector('[data-stat-track]') as HTMLElement
    const section = document.querySelector('.dash-projects-section') as HTMLElement
    const stage = document.querySelector('.stat-stage') as HTMLElement
    const prev = document.querySelector('[data-stat-prev]') as HTMLElement
    const next = document.querySelector('[data-stat-next]') as HTMLElement
    const r = (el: Element) => el.getBoundingClientRect()
    return {
      sectionW: r(section).width,
      trackW: r(track).width,
      stageW: r(stage).width,
      pages: Math.round(track.scrollWidth / Math.max(1, track.clientWidth)),
      prev: { position: getComputedStyle(prev).position, opacity: getComputedStyle(prev).opacity, x: r(prev).x, cy: r(prev).y + r(prev).height / 2 },
      next: { position: getComputedStyle(next).position, opacity: getComputedStyle(next).opacity, x: r(next).x, cy: r(next).y + r(next).height / 2 },
      trackCY: r(track).y + r(track).height / 2,
      handleSize: r(next).width,
      docScroll: document.documentElement.scrollWidth,
    }
  })

  // 1) The section EXPANDED: the strip (and its anchor) spans ≥94% of the section —
  //    the old flank layout measured ~77% (262/342) on this exact viewport.
  expect(geo.trackW).toBeGreaterThanOrEqual(geo.sectionW * 0.94)
  expect(geo.stageW).toBeGreaterThanOrEqual(geo.sectionW * 0.94)
  expect(geo.pages).toBeGreaterThanOrEqual(2)
  // No sideways document scroll introduced by the overlay overhang.
  expect(geo.docScroll).toBeLessThanOrEqual(390)

  // 2) The handles are OVER the strip: absolute, ≥40px (coarse-pointer tap law), and
  //    vertically centered on the track (±8px tolerance).
  expect(geo.prev.position).toBe('absolute')
  expect(geo.next.position).toBe('absolute')
  expect(geo.handleSize).toBeGreaterThanOrEqual(40)
  expect(Math.abs(geo.prev.cy - geo.trackCY)).toBeLessThanOrEqual(8)
  expect(Math.abs(geo.next.cy - geo.trackCY)).toBeLessThanOrEqual(8)
  // They sit at the outer edges flanking the strip (direction-agnostic: one handle's
  // CENTER near the left edge, the other's near the right edge) — over the strip's
  // edge region, inside the viewport.
  const centers = [geo.prev.x + geo.handleSize / 2, geo.next.x + geo.handleSize / 2]
  expect(Math.min(...centers)).toBeLessThanOrEqual(52)
  expect(Math.max(...centers)).toBeGreaterThanOrEqual(390 - 52)

  // 3) At the start the useless prev handle steps aside; after one page it returns.
  //    (Tolerance-based: the 0.25s fade means "invisible" < 0.1, "visible" > 0.9.)
  expect(parseFloat(geo.prev.opacity)).toBeLessThan(0.1)
  expect(parseFloat(geo.next.opacity)).toBeGreaterThan(0.9)
  await page.click('[data-stat-next]')
  await page.waitForTimeout(700)
  const paged = await page.evaluate(() => {
    const track = document.querySelector('[data-stat-track]') as HTMLElement
    const prev = document.querySelector('[data-stat-prev]') as HTMLElement
    const dots = [...document.querySelectorAll('.stat-dot')]
    return { scroll: Math.abs(track.scrollLeft), prevOpacity: getComputedStyle(prev).opacity, activeDot: dots.findIndex((d) => d.classList.contains('is-active')) }
  })
  expect(paged.scroll).toBeGreaterThan(200)
  expect(parseFloat(paged.prevOpacity)).toBeGreaterThan(0.9)
  expect(paged.activeDot).toBe(1)

  // 4) Page to the end via direct scrolls (the same capture-scroll driver path native
  //    swipes take; clicking the hidden handle would fail Playwright actionability) →
  //    the next handle steps aside too.
  for (let i = 0; i < 8 && !(await page.evaluate(() => document.querySelector('.stat-carousel')?.classList.contains('at-end'))); i++) {
    await page.evaluate(() => {
      const t = document.querySelector('[data-stat-track]') as HTMLElement
      const rtl = getComputedStyle(t).direction === 'rtl'
      t.scrollBy({ left: (rtl ? -1 : 1) * t.clientWidth, behavior: 'instant' })
    })
    await page.waitForTimeout(180)
  }
  const atEnd = await page.evaluate(() => {
    const car = document.querySelector('.stat-carousel') as HTMLElement
    const next = document.querySelector('[data-stat-next]') as HTMLElement
    const track = document.querySelector('[data-stat-track]') as HTMLElement
    return { classes: car.className, nextOpacity: getComputedStyle(next).opacity, maxed: Math.abs(track.scrollLeft) >= track.scrollWidth - track.clientWidth - 1 }
  })
  expect(atEnd.classes).toContain('at-end')
  expect(parseFloat(atEnd.nextOpacity)).toBeLessThan(0.1)
  expect(atEnd.maxed).toBe(true)

  // Cleanup the probe projects.
  for (const id of made) {
    await page.evaluate(async (id) => { await fetch(`/api/projects/${id}`, { method: 'DELETE' }) }, id)
  }
})

// --- S43 (mobile audit) regression pins --------------------------------------------
// The audit found page-level sideways overflow on project-detail (+37), 404 (+87),
// canvas (+810) and notifications (+9) — plus the reports/settings breaks that the
// ENRICHED seed above now exercises honestly. Each pin = the exact defect shape.

test('project-detail: the progress board never scrolls the document sideways (S35-known bleed, fixed S43)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  const pid = await page.evaluate(async () => {
    const r = await fetch('/api/projects?status=developing&limit=1', { headers: { Accept: 'application/json' } })
    const j = await r.json()
    return j?.projects?.[0]?.id || ''
  })
  expect(pid).toBeTruthy()
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/project.html?id=${pid}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600) // htmx board + filter mount settle
    const overflow = await noDocHScroll(page)
    expect(overflow, `project-detail @${width}px h-scrolls ${overflow}px`).toBeLessThanOrEqual(1)
  }
})

test('notifications + 404: no document h-scroll at 360/390 (S43)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/notifications.html')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    const notifItems = await page.locator('.notif-item').count()
    expect(notifItems).toBeGreaterThan(0) // the overdue-task notification renders — an honest pin
    expect(await noDocHScroll(page), `notifications @${width}px`).toBeLessThanOrEqual(1)
    await page.goto('/404.html')
    await page.waitForLoadState('networkidle')
    expect(await noDocHScroll(page), `404 @${width}px`).toBeLessThanOrEqual(1)
  }
})

test('canvas: the fabric board is born viewport-sized — never the 1200×800 markup attributes (S43)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/canvas.html')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2500) // fabric init + first chunk
  const geo = await page.evaluate(() => {
    const wrap = document.getElementById('canvas-wrap')
    const cont = document.querySelector('.canvas-container') as HTMLElement | null
    if (!wrap || !cont) return null
    const w = wrap.getBoundingClientRect()
    const c = cont.getBoundingClientRect()
    return { wrap: Math.round(w.width), cont: Math.round(c.width), doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  expect(geo).not.toBeNull()
  expect(geo!.cont).toBeLessThanOrEqual(geo!.wrap + 2) // the wrapper fits the wrap (was: 1200 on a 390 phone)
  expect(geo!.cont).toBeGreaterThanOrEqual(390 - 2) // ...and fills it
  expect(geo!.doc).toBeLessThanOrEqual(1)
})

test('settings @390: the taglist receives CHIPS, not raw JSON (the shadowed-route bug)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings.html')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(900) // the hx-get taglist swap
  const state = await page.evaluate(() => {
    const tl = document.getElementById('taglist')
    return {
      chips: tl ? tl.querySelectorAll('.chip').length : -1,
      rawJson: tl ? tl.textContent?.includes('{"tags"') : true,
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(state.rawJson).toBe(false) // the S43 signature: JSON dumped as text
  expect(state.chips).toBeGreaterThanOrEqual(2) // ui + loose (the enriched seed)
  expect(state.doc).toBeLessThanOrEqual(1)
})
