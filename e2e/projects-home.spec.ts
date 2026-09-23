// e2e/projects-home.spec.ts — S45 regression net for the projects page's redesigned home.
// Owner directive (verbatim): "improving UI/UX of sprints and projects page and
// functionality, as the most important aspect of hibana for me."
// The S45 contract, pinned (S121 update: the home is now the OVERVIEW — the
// «Recently active» list grew into the project-states carousel; the rail, the sort
// and the empty states keep their S45 geometry):
//   1. The stages home = COMPACT glance rail + the project-states carousel (the home
//      used to render six 169px count-boxes and NOTHING else — zero actual work visible).
//   2. The rail stays a CONTROLLER: box height ≤ 80px, click-to-filter untouched
//      (covered by projects-glance.spec.ts — this spec pins the new geometry).
//   3. Sort: ?sort= recent/title/stage — server ORDER BY switch + select wiring.
//   4. 390px: the search input keeps its own full-width line (it used to collapse to
//      ~48px beside the selects); no document h-scroll; the FAB stack gets clearance
//      (bottom shell padding) so it never sits on the last content row.
//   5. A zero-project home renders the capture empty state (not a hollow rail).
// Run: npx playwright test e2e/projects-home.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s45home@test.local'
const EMPTY_EMAIL = 'e2e-s45empty@test.local'
const TEST_PASS = 'e2e-password-123'

async function hashPass(pass: string) {
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  return `pbkdf2$100000$${toB64(salt)}$${toB64(Buffer.from(bits))}`
}

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const now = new Date().toISOString()
  for (const [email, username] of [[TEST_EMAIL, 'e2e-s45home'], [EMPTY_EMAIL, 'e2e-s45empty']] as const) {
    const id = randomBytes(16).toString('hex')
    const hash = await hashPass(TEST_PASS)
    try {
      db.exec(`DELETE FROM users WHERE email = '${email}'`)
    } catch { /* may not exist yet */ }
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page, email = TEST_EMAIL) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

async function api(page: Page, path: string, method: string, body?: object) {
  return page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }, { path, method, body })
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/]
const trackErrors = (page: Page) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectedErrorPatterns.some((re) => re.test(msg.text()))) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (expectedErrorPatterns.some((re) => re.test(err.message))) return
    errors.push(err.message)
  })
  return errors
}

test('S45 home (S121 overview): compact rail + states carousel — the home shows real work, cards navigate', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  // Seed: three projects — creation order = updated_at order (A oldest, C newest).
  const stamp = Date.now()
  const mk = async (title: string, status: string) => {
    const p = (await api(page, '/api/projects', 'POST', { title })) as { json: { id: string } }
    await api(page, `/api/projects/${p.json.id}`, 'PATCH', { status })
    return p.json.id
  }
  await mk(`s45 home alpha ${stamp}`, 'developing')
  await mk(`s45 home beta ${stamp}`, 'planning')
  await mk(`s45 home gamma ${stamp}`, 'operational')

  await page.goto('/projects.html')
  await page.waitForSelector('.pglance-box', { timeout: 10_000 })
  await page.waitForTimeout(600)

  // 1) The rail is COMPACT: every box is a one-line control (≤ 80px tall) — the old
  //    stacked boxes measured 169px. Five boxes (0060 taxonomy), one rail.
  const boxHeights = await page.$$eval('.pglance-box', (els) => els.map((e) => e.getBoundingClientRect().height))
  expect(boxHeights).toHaveLength(5)
  for (const h of boxHeights) expect(h).toBeLessThanOrEqual(80)
  expect(Math.max(...boxHeights)).toBeGreaterThanOrEqual(40) // still a 40px+ control

  // 2) The project-states carousel rides under the rail (S121): EVERY project is a
  //    card (the S45 list capped at 6 — the carousel is the whole range), each links
  //    to its project page, and the NEWEST project is the FIRST card (recency = the
  //    "never lose your place" job).
  await expect(page.locator('.ov-card')).toHaveCount(3)
  const firstCard = page.locator('.ov-card').first()
  await expect(firstCard).toContainText('gamma')
  const href = await firstCard.getAttribute('href')
  expect(href).toMatch(/^\/project\.html\?id=/)

  // 3) Clicking a carousel card opens the project page (soft nav via nav.js).
  await firstCard.click()
  await page.waitForTimeout(1_200)
  expect(page.url()).toMatch(/\/project\.html\?id=/)

  expect(errors).toEqual([])
})

test('S45 sort: recent re-orders the list; ?sort= deep link + select persistence', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  const stamp = Date.now()
  // Creation order = updated_at order (each POST+PATCH stamps now): alpha OLDEST,
  // zulu NEWEST (created last).
  const mk = async (title: string) => {
    const p = (await api(page, '/api/projects', 'POST', { title })) as { json: { id: string } }
    await api(page, `/api/projects/${p.json.id}`, 'PATCH', { status: 'developing' })
    return p.json.id
  }
  await mk(`s45 sort alpha ${stamp}`)
  await mk(`s45 sort middle ${stamp}`)
  await mk(`s45 sort zulu ${stamp}`)

  // Deep link: ?sort=recent → the NEWEST project (zulu) leads the cards view.
  await page.goto('/projects.html?view=cards&sort=recent')
  await page.waitForSelector('.project-card', { timeout: 10_000 })
  await page.waitForTimeout(600)
  const firstCard = await page.textContent('#project-list .project-card .project-title')
  expect(firstCard).toContain('zulu')

  // The select reflects the URL param.
  await expect(page.locator('#sort-select-sel')).toHaveValue('recent')

  // Switching to 'title' via the select re-requests (alphabetical: alpha first).
  await page.selectOption('#sort-select-sel', 'title')
  await page.waitForTimeout(900)
  const firstCardTitled = await page.textContent('#project-list .project-card .project-title')
  expect(firstCardTitled).toContain('alpha')
  // The choice persisted (localStorage pref — future visits reopen sorted by title).
  const pref = await page.evaluate(() => localStorage.getItem('hibana-projects-sort'))
  expect(pref).toBe('title')

  // 'stage' (default) — the historical order returns: status groups, then recency
  // within group; zulu (newest doing) leads the doing group = leads the list.
  await page.selectOption('#sort-select-sel', 'stage')
  await page.waitForTimeout(900)
  const firstCardStage = await page.textContent('#project-list .project-card .project-title')
  expect(firstCardStage).toContain('zulu')

  expect(errors).toEqual([])
})

test('S45 @390: search keeps a full-width line, no h-scroll, FAB clearance under content', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)

  await page.goto('/projects.html')
  await page.waitForSelector('.pglance-box', { timeout: 10_000 })
  await page.waitForTimeout(600)

  const vp = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)

  const probe = await page.evaluate(() => {
    const search = document.querySelector('form.filters input[type="search"]') as HTMLInputElement | null
    const sr = search?.getBoundingClientRect()
    const shell = document.querySelector('main.shell') as HTMLElement | null
    const rows = [...document.querySelectorAll('.precent-row')].map((e) => Math.round(e.getBoundingClientRect().width))
    return {
      docHScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      searchW: sr ? Math.round(sr.width) : 0,
      searchOwnRow: sr ? Math.round(sr.width) >= 300 : false,
      shellPadEnd: shell ? getComputedStyle(shell).paddingBlockEnd : '',
      rowWs: rows.slice(0, 3),
      rowContained: rows.every((w) => w <= 390),
    }
  })
  expect(probe.docHScroll).toBeLessThanOrEqual(1)
  expect(probe.searchOwnRow).toBe(true) // the 48px-sliver bug is dead
  // FAB clearance: the shell's bottom padding clears the stack (≥ 140px with the
  // bottom-tab lift; the raw padding is a calc() string — resolve to px via the rect).
  const padPx = parseFloat(probe.shellPadEnd)
  expect(padPx).toBeGreaterThanOrEqual(140)
  // Recent rows never exceed the viewport (the ghost-track overflow is dead).
  expect(probe.rowContained).toBe(true)

  expect(errors).toEqual([])
})

test('S45 empty home: a zero-project account gets the capture empty state, not a hollow rail', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page, EMPTY_EMAIL)

  await page.goto('/projects.html')
  await page.waitForSelector('.pglance-box', { timeout: 10_000 })
  await page.waitForTimeout(600)

  // The rail renders (fresh-account fallback: no .is-empty marks, all five boxes)…
  expect(await page.locator('.pglance-box').count()).toBe(5)
  // …and the empty state beneath it says "capture your first idea" with a working CTA.
  await expect(page.locator('.empty-state')).toBeVisible()
  await expect(page.locator('.empty-state-title')).toContainText(/no projects yet/i)
  await expect(page.locator('.empty-state-cta')).toBeVisible()
  // No overview sections on an empty account (S121: the carousel replaces the old
  // «Recently active» guard — same contract, new surface).
  expect(await page.locator('.ov-states').count()).toBe(0)
  expect(await page.locator('.ov-tasks').count()).toBe(0)

  expect(errors).toEqual([])
})
