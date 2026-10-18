// e2e/s205-kanban-entry.spec.ts — S205 (the Kanban entry-point spec, §3.1–§3.3):
//   /kanban is the dedicated project-Kanban entry point. This spec pins:
//     (1) AUTH: unauthenticated /kanban bounces to /login.html?next=/kanban and the
//         login round-trip returns to /kanban (the server-side loginNext contract —
//         a bookmarked board survives an expired session).
//     (2) DIRECT: /kanban?project=<id> renders the board (title, cards, filter bar)
//         and deep links (?add=) ride through.
//     (3) DEFAULT: bare /kanban resolves last-used (hibana-kanban-last), then
//         most-recent accessible project (sort=recent), canonicalizing ?project=.
//     (4) EMPTY: a user with no projects gets the no-projects empty state + CTA.
//     (5) SWITCHER: the title button opens the searchable popover; clicking a row
//         switches IN PLACE (no navigation — a window marker survives), the URL
//         gains the new ?project=, the board title + counts swap, refresh keeps it,
//         and Back (popstate → nav.js soft-reload) returns to the previous board.
//     (6) COMPAT: /board.html bare redirects to /kanban; /kanban.html 301s to
//         /kanban; a deleted project shows the gone state.
//     (7) RTL: an FA user's switcher popover opens with FA placeholder text and the
//         document in rtl direction.
// Run: npx playwright test e2e/s205-kanban-entry.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s205@test.local'
const TEST_PASS = 'e2e-password-123'

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s205', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

/** Seeds one project + tasks through the real API (auth'd in-page fetch). */
async function seedProject(page: Page, title: string, tasks: { title: string; status: string; priority?: string }[]): Promise<string> {
  return await page.evaluate(async ({ title, tasks }) => {
    const res = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, status: 'developing' }),
    })
    const { id } = (await res.json()) as { id: string }
    for (const t of tasks) {
      await fetch(`/api/projects/${id}/devtasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      })
    }
    return id
  }, { title, tasks })
}

const expectedErrorPatterns = [
  /Failed to load resource.*401/,
  /Failed to load resource.*404/,
]
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

const boardReady = async (page: Page, titlePart: string) => {
  await expect(page.locator('#db-project-switch')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#db-title')).toContainText(titlePart, { timeout: 10_000 })
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
}

test('kanban entry: unauth bounce preserves ?next= and returns after login', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)

  // Fresh context — no session. The server route must bounce to login WITH the entry URL.
  await page.goto('/kanban')
  await page.waitForURL(/\/login\.html\?next=/, { timeout: 10_000 })
  const next = new URL(page.url()).searchParams.get('next') ?? ''
  expect(next).toBe('/kanban')

  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  // safeNext returns the user to the exact entry point (not the dashboard).
  await page.waitForURL(/\/kanban/, { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('kanban entry: /kanban?project= renders the board + deep links ride through', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's205 direct board', [
    { title: 'first task', status: 'in_progress' },
    { title: 'second task', status: 'idea' },
  ])
  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page, 's205 direct board')
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2)
  // the title button is the switcher: focusable, aria contract in place
  const btn = page.locator('#db-project-switch')
  await expect(btn).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(btn).toHaveAttribute('aria-expanded', 'false')
  // the tab title carries the project's own name (the S64 convention)
  await expect(page).toHaveTitle('s205 direct board — Hibana')
  expect(errors).toEqual([])
})

test('kanban entry: bare /kanban resolves the last-used board and canonicalizes ?project=', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pidA = await seedProject(page, 's205 last used A', [{ title: 'a-task', status: 'in_progress' }])
  const pidB = await seedProject(page, 's205 last used B', [{ title: 'b-task', status: 'done' }])

  // Visit B's board — records it as the last-used board (hibana-kanban-last).
  await page.goto(`/kanban?project=${pidB}`)
  await boardReady(page, 's205 last used B')

  // A bare /kanban (fresh navigation, same context) reopens B.
  await page.goto('/kanban')
  await boardReady(page, 's205 last used B')
  // canonicalized: the URL picked up the resolved project
  await expect(page).toHaveURL(new RegExp(`kanban\\?project=${pidB}`))
  expect(errors).toEqual([])
})

test('kanban entry: no last-used falls back to the most-recent accessible project', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // seed order: A first, B last → B has the newer updated_at (sort=recent = DESC)
  const pidA = await seedProject(page, 's205 recent A', [{ title: 'a', status: 'idea' }])
  const pidB = await seedProject(page, 's205 recent B', [{ title: 'b', status: 'idea' }])
  expect(pidA).not.toBe(pidB)

  // fresh context? No — same context may carry hibana-kanban-last from the previous
  // test's visit; clear it to pin the fallback branch explicitly.
  await page.evaluate(() => localStorage.removeItem('hibana-kanban-last'))
  await page.goto('/kanban')
  await boardReady(page, 's205 recent B')
  await expect(page).toHaveURL(new RegExp(`kanban\\?project=${pidB}`))
  expect(errors).toEqual([])
})

test('kanban entry: a user with no projects gets the empty state + CTA', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // remove any projects this test user owns (previous tests' seeds) + the last-used key
  await page.evaluate(() => localStorage.removeItem('hibana-kanban-last'))
  await page.evaluate(async () => {
    const res = await fetch('/api/projects')
    const body = (await res.json()) as { projects: { id: string }[] }
    for (const p of body.projects) {
      await fetch(`/api/projects/${p.id}?force=1`, { method: 'DELETE' })
    }
  })
  await page.goto('/kanban')
  await expect(page.locator('.db-noprojects')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.db-noprojects .empty-state-title')).toContainText('No projects yet')
  await expect(page.locator('.db-noprojects .empty-state-cta')).toHaveAttribute('href', '/projects.html')
  expect(errors).toEqual([])
})

test('kanban entry: the switcher switches in place, URL + board swap, refresh + back keep state', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pidA = await seedProject(page, 's205 switch alpha', [
    { title: 'alpha-one', status: 'in_progress', priority: 'urgent' },
  ])
  const pidB = await seedProject(page, 's205 switch beta', [
    { title: 'beta-one', status: 'bug' },
    { title: 'beta-two', status: 'done' },
  ])

  await page.goto(`/kanban?project=${pidA}`)
  await boardReady(page, 's205 switch alpha')

  // open the switcher
  await page.click('#db-project-switch')
  const pop = page.locator('#db-switch-pop')
  await expect(pop).toBeVisible()
  await expect(page.locator('#db-project-switch')).toHaveAttribute('aria-expanded', 'true')
  // the search input is focused and both projects are listed
  await expect(pop.locator('#db-switch-q')).toBeFocused()
  await expect(pop.locator('.db-switch-row')).toHaveCount(2)
  // the current row is marked
  await expect(pop.locator(`.db-switch-row[data-switch-id="${pidA}"]`)).toHaveAttribute('aria-current', 'true')

  // search narrows to beta
  await page.fill('#db-switch-q', 'beta')
  await expect(pop.locator('.db-switch-row')).toHaveCount(1)
  // clear → both again
  await page.fill('#db-switch-q', '')
  await expect(pop.locator('.db-switch-row')).toHaveCount(2)

  // an in-page marker proves the switch NEVER full-navigates
  await page.evaluate(() => { (window as unknown as { __s205Marker?: boolean }).__s205Marker = true })

  // activate beta's row (keyboard: ArrowDown then Enter — the keyboard path)
  await page.keyboard.press('ArrowDown')
  await expect(pop.locator('.db-switch-row').first()).toBeFocused()
  await page.keyboard.press('Enter')

  // the board swapped in place (marker survives), URL + title + counts followed
  await boardReady(page, 's205 switch beta')
  expect(await page.evaluate(() => (window as unknown as { __s205Marker?: boolean }).__s205Marker)).toBe(true)
  await expect(page).toHaveURL(new RegExp(`kanban\\?project=${pidB}`))
  await expect(page.locator('.pd-task-wrap')).toHaveCount(2)

  // Escape contract: reopen + close via Escape, focus returns to the title button
  await page.click('#db-project-switch')
  await expect(pop).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(page.locator('#db-project-switch')).toBeFocused()

  // refresh keeps the selected project (the URL owns it)
  await page.reload()
  await boardReady(page, 's205 switch beta')

  // Back returns to alpha's entry (popstate → nav.js soft-reload of ?project=A)
  await page.goBack()
  await boardReady(page, 's205 switch alpha')
  expect(errors).toEqual([])
})

test('kanban entry: bare /board.html redirects to /kanban; /kanban.html 301s to /kanban', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's205 redirect target', [{ title: 'r', status: 'idea' }])
  // visit the board once so the bare entry has a last-used board to resolve
  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page, 's205 redirect target')

  // the legacy bare /board.html now lands on the smart entry point
  await page.goto('/board.html')
  await page.waitForURL(/\/kanban/, { timeout: 10_000 })
  await boardReady(page, 's205 redirect target')

  // /kanban.html 301s to the canonical short form (server-level)
  const res = await page.request.get('/kanban.html', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers()['location']).toBe('/kanban')
  expect(errors).toEqual([])
})

test('kanban entry: a deleted project shows the gone state (no data leak)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's205 doomed project', [{ title: 'x', status: 'idea' }])
  // soft-delete it (deleted_at → the board's 404 path)
  await page.evaluate(async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  }, pid)
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('#db-loading')).toContainText("doesn't exist or was deleted", { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('kanban entry: FA/RTL — the popover opens with the FA dictionary + rtl direction', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  // set the FA language pref through the settings API the app itself uses
  // (PATCH /api/settings { language_pref: 'fa' } — the settings page's own contract)
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language_pref: 'fa' }) })
  })
  const pid = await seedProject(page, 's205 rtl board', [{ title: 'کار آزمایشی', status: 'in_progress' }])
  await page.goto(`/kanban?project=${pid}`)
  await boardReady(page, 's205 rtl board')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 })

  await page.click('#db-project-switch')
  const pop = page.locator('#db-switch-pop')
  await expect(pop).toBeVisible()
  // the FA placeholder (from the lazy FA dictionary — the i18n-ready boot contract)
  await expect(pop.locator('#db-switch-q')).toHaveAttribute('placeholder', 'جستجوی پروژه…', { timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  expect(errors).toEqual([])
})
