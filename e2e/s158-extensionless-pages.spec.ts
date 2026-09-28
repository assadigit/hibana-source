// e2e/s158-extensionless-pages.spec.ts — S158 (the extensionless page-identity bug):
//   Cloudflare's assets binding (html_handling auto-trailing-slash) 307s every
//   /page.html to /page on LIVE, so a hard load always runs extensionless
//   (/sparks — verified: curl /sparks.html → 307 /sparks). Node serves BOTH forms
//   (S70 parity, no redirect), and a soft-nav pushState can carry either. The
//   client's page-identity checks compared location.pathname === '/sparks.html'
//   etc. — NEVER matching on live. Three owner-requested behaviors were silently
//   dead on prod (verified live, then re-verified after the fix):
//     (1) Session 28 "go to a folder and create the idea there": the quick-add's
//         folder_id attach (app.js) never fired — captures made with a folder open
//         filed UNFILED (live repro: folder_id:null via the API).
//     (2) 2026-08-25 "capturing from the Ideas page lands back there": the
//         stay-on-page branch never fired — the user bounced to /app.
//     (3) the "Files into: <folder>" hint (Session 28 UX) never showed.
//     (4) the desktop rail's aria-current (hib-init norm / nav.js railNorm) never
//         lit on a hard load — href '/sparks.html' vs pathname '/sparks'.
//   Fix: pageIs() (both forms) in app.js; norm/railNorm/markRailRows strip .html on
//   both sides (mobile-nav.js's normPath is the in-repo precedent).
// Pins (behavioral, on the Node server which serves BOTH URL forms):
//   (1) /sparks (extensionless): with a folder open, the hint SHOWS, the capture
//       files into the folder (API folder_id), the page STAYS on /sparks, and the
//       shelf soft-refreshes with the new card.
//   (2) /sparks.html (the .html form): the same triple — no regression.
//   (3) the rail marks the current page on extensionless hard loads (/sparks +
//       /projects) and on the .html form.
// Spec lessons banked (S120/S156): the flat shelf is a CLICK away; here the folder
//   grid home is the start state and [data-sf="<uuid>"] is the folder CARD itself.
// Run: npx playwright test e2e/s158-extensionless-pages.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s158@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
// the folder id MUST be a dashed 36-char UUID — app.js's folder_id attach guard is
// /^[0-9a-f-]{36}$/i (the server's uuid() = crypto.randomUUID shape); a bare 32-hex
// id would (correctly) be rejected and the spec would pin a lie.
const FOLDER_ID = crypto.randomUUID()
const FOLDER_NAME = 's158 capture folder'
// a seeded spark INSIDE the folder so the folder card renders with an honest count
const SEEDED_SPARK_ID = randomBytes(16).toString('hex')

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
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM spark_folders WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* first run */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s158', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO spark_folders (id, user_id, name, sort_order, created_at)
     VALUES ('${FOLDER_ID}', '${USER_ID}', '${FOLDER_NAME.replace(/'/g, "''")}', 0, '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, folder_id, created_at, updated_at)
     VALUES ('${SEEDED_SPARK_ID}', '${USER_ID}', 's158 seeded spark', '', 'personal', 'spark', 0, '${FOLDER_ID}', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.removeItem('hibana-sparks-view')
      localStorage.removeItem('hibana-sparks-folder')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

// The core triple at a given URL form: open the folder, capture, and pin that the
// idea FILED into the folder, the page STAYED, and the shelf refreshed in place.
async function captureInsideFolder(page: Page, url: string, title: string) {
  await page.goto(url)
  // the folder grid home renders the folder card ([data-sf="<uuid>"] — S158 lesson:
  // on the grid the folder chips ARE the cards; the sf-bar is a click away)
  const folderCard = page.locator(`.spark-folder-card[data-sf="${FOLDER_ID}"]`)
  await folderCard.waitFor({ state: 'visible', timeout: 10_000 })
  await folderCard.click()
  // the folder is open: the hidden input carries the UUID (sparks-page stamps it)
  await expect(page.locator('#spark-folder')).toHaveValue(FOLDER_ID, { timeout: 10_000 })

  // the quick-add with a folder open: the "Files into" hint SHOWS (dead on live
  // before the fix — app.js compared the .html form only)
  await page.click('[data-quickadd-open]')
  const hint = page.locator('#qa-folder-hint')
  await hint.waitFor({ state: 'visible', timeout: 5_000 })
  await expect(hint).toContainText(FOLDER_NAME)

  // capture — a unique title so the shelf pin is unambiguous
  await page.fill('#qa-title', title)
  await page.click('#qa-save')

  // (2) the page STAYS on the ideas surface — the pre-fix bounce went to /app. The
  // quick-add is a FETCH caller (the S161 HX-Redirect serves HTMX callers); on the
  // Ideas page the S40 soft-refresh contract holds — capture stays in the open folder.
  await page.waitForTimeout(1_500) // the queue flush + close + shelf reload
  expect(page.url()).not.toContain('/app')
  expect(page.url()).toContain('/sparks')

  // the shelf soft-refreshed: the new card is visible IN the open folder's shelf
  // (S161: the shelf's cards wear .spark-card now)
  await page.locator('.spark-card', { hasText: title }).first().waitFor({ state: 'visible', timeout: 10_000 })

  // (1) the capture FILED into the folder — the API is the source of truth
  const filed = await page.evaluate(async (t) => {
    const res = await fetch('/api/projects?status=spark')
    const rows = await res.json()
    const arr = Array.isArray(rows) ? rows : (rows.projects || [])
    return arr.find((p: { title: string }) => p.title === t) || null
  }, title)
  expect(filed, 'the captured idea must exist via the API').not.toBeNull()
  expect(filed.folder_id, 'the capture made with the folder open must file INTO it (S28: folder_id attach)').toBe(FOLDER_ID)
}

test('extensionless /sparks: capture with a folder open files into it, stays on the page, hint shows', async ({ page }) => {
  await login(page)
  await captureInsideFolder(page, '/sparks', 's158 extless capture')
})

test('the .html form /sparks.html: the same capture triple (no regression)', async ({ page }) => {
  await login(page)
  await captureInsideFolder(page, '/sparks.html', 's158 htmlform capture')
})

test('the desktop rail marks the current page on extensionless hard loads', async ({ page }) => {
  await login(page)
  // /sparks (the live form): the Ideas icon lights
  await page.goto('/sparks')
  await page.locator('#spark-shelf').waitFor({ state: 'visible', timeout: 10_000 })
  const sparksMarked = await page.locator('.rail .rail-primary a[href="/sparks.html"]').getAttribute('aria-current')
  expect(sparksMarked, 'the Ideas rail icon must carry aria-current at /sparks (extensionless)').toBe('page')

  // /projects (the live form): the Projects icon lights
  await page.goto('/projects')
  await page.waitForTimeout(1_000)
  const projectsMarked = await page.locator('.rail .rail-primary a[href="/projects.html"]').getAttribute('aria-current')
  expect(projectsMarked, 'the Projects rail icon must carry aria-current at /projects (extensionless)').toBe('page')

  // the .html form still marks (the Node/e2e form)
  await page.goto('/sparks.html')
  await page.locator('#spark-shelf').waitFor({ state: 'visible', timeout: 10_000 })
  const htmlFormMarked = await page.locator('.rail .rail-primary a[href="/sparks.html"]').getAttribute('aria-current')
  expect(htmlFormMarked, 'the Ideas rail icon must carry aria-current at /sparks.html too').toBe('page')
})
