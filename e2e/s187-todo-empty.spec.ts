// e2e/s187-todo-empty.spec.ts — S187 (the owner's to-do empty-state round):
// the empty quadrant is INFORMATION, not a second button.
//   Dashboard widget: the "Add a task" text link is GONE from the DOM (Hick's law —
//   the header ＋ is the ONE add path), each quadrant renders its own centered
//   muted STATUS LINE (Q1 Today "Nothing due today." / Q3 Urgent & High Value
//   "Nothing urgent right now." / Q2 Strategic "Nothing strategic right now." /
//   Q4 Personal & Sentimental "Nothing personal right now."), and the ＋ carries a
//   quadrant-named accessible name + tooltip ("Add task to {name}" — custom names
//   included). The add path still round-trips through the header ＋.
//   Board page (/to-do-list): the dashed bulb block CENTERS in the card body
//   (between the header and the ＋ footer — margin-block:auto), keeps its size +
//   dashed border, the hint points at the card's OWN button ("Tap + to add one"),
//   and the footer ＋ carries the same quadrant-named label.
//   FA/RTL: centered text has no direction — the FA twins render with dir=rtl on
//   both surfaces.
// Run: npx playwright test e2e/s187-todo-empty.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s187@test.local'
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
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id LIKE 's187-%'`)
    db.exec(`DELETE FROM sadhana_quadrant_names WHERE user_id LIKE 's187-%'`)
    db.exec(`DELETE FROM projects WHERE user_id LIKE 's187-%'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id LIKE 's187-%'`)
    db.exec(`DELETE FROM quick_notes WHERE user_id LIKE 's187-%'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('s187-user', 'e2e-s187', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${iso(86400000 * 30)}', '${iso(86400000 * 30)}')`,
  )
  // ONE project + ONE vault note so the dashboard renders its full section stack
  // (the to-do panel sits among live siblings, not a cold page).
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s187-proj', 's187-user', 'S187 project', '', 'personal', 'developing', 0, '${iso(86400000 * 10)}', '${iso(3600000 * 2)}')`,
  )
  db.exec(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES ('s187-note', 's187-user', NULL, 'S187 note', 'x', '', 0, '${iso(86400000)}', '${iso(86400000)}')`,
  )
  // Q1 = ONE task (filled box); Q2/Q3/Q4 = empty (their status lines render).
  db.exec(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
     VALUES ('s187-q1-0', 's187-user', 1, 'S187 only task', 0, 0, 0, 'untouched', '${iso(3600000 * 3)}', '${iso(3600000 * 3)}')`,
  )
  // The owner's own vocabulary as Q3's CUSTOM name — proves custom names flow
  // into the ＋'s accessible name (aria-label + title), not just the defaults.
  db.exec(
    `INSERT INTO sadhana_quadrant_names (user_id, quadrant, name)
     VALUES ('s187-user', 3, 'Urgent & Important')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.removeItem('hibana-resume')
      localStorage.removeItem('hibana-vault-banner-dismissed')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForSelector('.dash-todo-panel', { timeout: 10_000 })
}

/* ── 1. THE DASHBOARD WIDGET — the quadrant status lines ──────────────────── */

test('S187-1: dashboard — the empty quadrants speak their own centered lines; no add-link in the DOM; the ＋ is named', async ({ page }) => {
  await login(page)

  // The redundant action is REMOVED from the DOM (not display:none) — keyboard
  // focus can never land on it.
  await expect(page.locator('.dash-todo-add-text')).toHaveCount(0)

  // The four quadrants: Q1 filled (no strip), the other three with their OWN line.
  const q1 = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"]')
  const q3 = page.locator('.dash-todo-quadrant[data-dash-quadrant="3"]')
  const q2 = page.locator('.dash-todo-quadrant[data-dash-quadrant="2"]')
  const q4 = page.locator('.dash-todo-quadrant[data-dash-quadrant="4"]')
  await expect(q1.locator('.dash-todo-empty')).toHaveCount(0)
  await expect(q3.locator('.dash-todo-empty-text')).toHaveText('Nothing urgent right now.')
  await expect(q2.locator('.dash-todo-empty-text')).toHaveText('Nothing strategic right now.')
  await expect(q4.locator('.dash-todo-empty-text')).toHaveText('Nothing personal right now.')

  // The strip is pure information — centered in the empty card's free space, on
  // the muted ink + the app's small type (the strip's own computed grammar).
  const r = await q3.evaluate((el) => {
    const strip = el.querySelector('.dash-todo-empty') as HTMLElement
    const text = el.querySelector('.dash-todo-empty-text') as HTMLElement
    const win = el.querySelector('.dash-todo-list') as HTMLElement
    const cs = getComputedStyle(strip)
    const mid = (b: DOMRect) => (b.top + b.bottom) / 2
    const midX = (b: DOMRect) => (b.left + b.right) / 2
    return {
      display: cs.display,
      justify: cs.justifyContent,
      textAlign: cs.textAlign,
      color: cs.color,
      fontSize: cs.fontSize,
      stripH: strip.getBoundingClientRect().height,
      winH: win.getBoundingClientRect().height,
      vOff: Math.abs(mid(strip.getBoundingClientRect()) - mid(win.getBoundingClientRect())),
      hOff: Math.abs(midX(text.getBoundingClientRect()) - midX(win.getBoundingClientRect())),
    }
  })
  expect(r.display).toBe('flex')
  expect(r.justify).toBe('center')
  expect(r.textAlign).toBe('center')
  // The muted ink + the small type survive the redesign (owner: "Keep the existing
  // muted text color and font size") — the strip resolves the light --muted #5C5C5C.
  expect(r.color).toBe('rgb(92, 92, 92)')
  // The strip is the quiet 2.5rem line and it rides MID-WINDOW: the list's
  // align-content flips start → center for the empty case, so the single grid row
  // (and its centered text) sits at the window's vertical + horizontal center.
  const listAlign = await q3.locator('.dash-todo-list').evaluate((el) => getComputedStyle(el).alignContent)
  expect(listAlign).toBe('center')
  expect(r.vOff, `the strip's center must sit mid-window (±6px, sub-pixel tolerant) — off by ${r.vOff}px`).toBeLessThanOrEqual(6)
  expect(r.hOff).toBeLessThanOrEqual(2)
  // QA-found with this round (live-confirmed since S182): the generic .card ul
  // indent (1.25rem inline-start) outranked the list's own padding:0 — the board
  // sat 20px inset on ONE edge. The S187 override restores both edges symmetric,
  // so the centered line lands on the card's true center (and the task rows
  // align flush with the header + quick-add form).
  const pads = await q3.locator('.dash-todo-list').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { start: cs.paddingInlineStart, end: cs.paddingInlineEnd }
  })
  expect(pads.start).toBe(pads.end)
  expect(pads.start).toBe('0px')

  // The ONE add path — the header ＋ — carries the quadrant's own name (custom for
  // Q3, the seeded "Urgent & Important"; the default title for Q1), as the
  // accessible name AND the mouse tooltip.
  await expect(q3.locator('.dash-todo-fab')).toHaveAttribute('aria-label', 'Add task to Urgent & Important')
  await expect(q3.locator('.dash-todo-fab')).toHaveAttribute('title', 'Add task to Urgent & Important')
  await expect(q1.locator('.dash-todo-fab')).toHaveAttribute('aria-label', 'Add task to Today')
  await expect(q2.locator('.dash-todo-fab')).toHaveAttribute('aria-label', 'Add task to Strategic')
  await expect(q4.locator('.dash-todo-fab')).toHaveAttribute('aria-label', 'Add task to Personal & Sentimental')
})

/* ── 2. THE ONE ADD PATH — the header ＋ still round-trips an empty quadrant ─ */

test('S187-2: dashboard — adding through the header ＋ replaces the status line (the one add path works)', async ({ page }) => {
  await login(page)

  const q4 = page.locator('.dash-todo-quadrant[data-dash-quadrant="4"]')
  await expect(q4.locator('.dash-todo-empty-text')).toHaveText('Nothing personal right now.')

  // The ＋ reveals the quick-add form (the ONLY add affordance in the card).
  await q4.locator('.dash-todo-fab').click()
  await expect(q4.locator('.dash-quickadd')).toBeVisible()
  await q4.locator('.dash-quickadd input[name="title"]').fill('S187 added through the header plus')
  await q4.locator('.dash-quickadd input[name="title"]').press('Enter')

  // The task lands, the counter flips, and the status line is GONE (replaced by
  // the row — exactly the S182 swap path, now without the retired link).
  await expect(q4.locator('.dash-todo-counter')).toHaveText('1', { timeout: 10_000 })
  await expect(q4.locator('.dash-todo-task [data-task-title]', { hasText: 'S187 added through the header plus' })).toHaveCount(1)
  await expect(q4.locator('.dash-todo-empty')).toHaveCount(0)

  // Leave Q4 empty for the tests that follow (the FA twin asserts its line) —
  // remove the round-trip's row straight from the seed DB.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  db.exec(`DELETE FROM sadhana_tasks WHERE user_id = 's187-user' AND quadrant = 4 AND title = 'S187 added through the header plus'`)
  db.close()
})

/* ── 3. THE BOARD PAGE — the centered dashed block + the pointed hint ─────── */

test('S187-3: board — the empty quadrant block centers in the card body; the hint points at the card’s own ＋; the footer ＋ is named', async ({ page }) => {
  await login(page)
  await page.goto('/sadhana.html')
  await page.waitForSelector('#matGrid .quadrant', { timeout: 10_000 })
  await page.waitForFunction(() => document.querySelectorAll('#matGrid .q-body > .empty, #matGrid .q-body .task-card').length >= 4, null, { timeout: 10_000 })

  // Q2 renders the empty block (no tasks); its copy keeps the plain board line +
  // the S187 hint that names the card's OWN button (the ＋ lives in the footer,
  // never "below the card").
  const q2 = page.locator('#Q2')
  const empty = q2.locator('.q-body > .empty')
  await expect(empty).toHaveCount(1)
  await expect(empty.locator('.et')).toContainText('No tasks yet')
  await expect(empty.locator('.et-hint')).toHaveText('Tap + to add one')

  // The block CENTERS in the card body — vertically mid-way between the header
  // and the ＋ footer (margin-block:auto splits the free space), stretched to the
  // body's width (its current size), dashed border intact.
  const g = await q2.evaluate((el) => {
    const body = el.querySelector('.q-body') as HTMLElement
    const block = el.querySelector('.q-body > .empty') as HTMLElement
    const foot = el.querySelector('.q-foot') as HTMLElement
    const bb = body.getBoundingClientRect()
    const kb = block.getBoundingClientRect()
    const fb = foot.getBoundingClientRect()
    const mid = (b: DOMRect) => (b.top + b.bottom) / 2
    return {
      vOff: Math.abs(mid(kb) - mid(bb)),
      widthRatio: kb.width / bb.width,
      borderStyle: getComputedStyle(block).borderTopStyle,
      footAtBottom: Math.abs(fb.bottom - el.getBoundingClientRect().bottom) <= 2,
      blockTop: kb.top - bb.top,
    }
  })
  expect(g.vOff, `the dashed block must center in the card body (±6px) — off by ${g.vOff}px`).toBeLessThanOrEqual(6)
  expect(g.widthRatio, 'the block keeps its size — stretched across the body width').toBeGreaterThan(0.9)
  expect(g.borderStyle).toBe('dashed')
  expect(g.footAtBottom, 'the ＋ footer stays pinned at the card bottom').toBe(true)
  expect(g.blockTop, 'the block no longer clings to the header').toBeGreaterThan(20)

  // The footer ＋ carries the quadrant's name (defaults here — Q2 "Strategic";
  // Q3's custom name flows through the board's own quad payload too).
  await expect(q2.locator('.q-fab')).toHaveAttribute('aria-label', 'Add task to Strategic')
  await expect(page.locator('#Q3 .q-fab')).toHaveAttribute('aria-label', 'Add task to Urgent & Important')
})

/* ── 4. THE BOARD PAGE — FA/RTL twin (centered copy has no direction) ─────── */

test('S187-4: board FA/RTL — the FA hint + the FA-named ＋ under dir=rtl', async ({ page }) => {
  // The board's boot syncs lang from the ACCOUNT pref (sadhana-page.js: lang =
  // me.user.language_pref), so flip the seed user server-side — the FA twins of
  // the hint + the ＋'s name render, and the shell flips dir=rtl.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  db.exec(`UPDATE users SET language_pref = 'fa' WHERE id = 's187-user'`)
  db.close()

  await login(page)
  await page.goto('/sadhana.html')
  await page.waitForSelector('#matGrid .quadrant', { timeout: 10_000 })
  await page.waitForFunction(() => document.querySelectorAll('#matGrid .q-body > .empty, #matGrid .q-body .task-card').length >= 4, null, { timeout: 10_000 })

  await expect(page.locator('#Q2 .q-body > .empty .et-hint')).toHaveText('برای افزودن، + را بزن')
  await expect(page.locator('#Q2 .q-fab')).toHaveAttribute('aria-label', 'افزودن وظیفه به استراتژیک')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  // The centered geometry survives the RTL flip — same body-center contract.
  const vOff = await page.locator('#Q2').evaluate((el) => {
    const body = el.querySelector('.q-body') as HTMLElement
    const block = el.querySelector('.q-body > .empty') as HTMLElement
    const mid = (b: DOMRect) => (b.top + b.bottom) / 2
    return Math.abs(mid(block.getBoundingClientRect()) - mid(body.getBoundingClientRect()))
  })
  expect(vOff).toBeLessThanOrEqual(6)

  // Restore EN for the account (leave the seed as found).
  const db2 = new DatabaseSync(DB)
  db2.exec(`UPDATE users SET language_pref = 'en' WHERE id = 's187-user'`)
  db2.close()
})

/* ── 5. THE DASHBOARD — FA/RTL twin (the server-side lines flip with the user) ─ */

test('S187-5: dashboard FA — the quadrant lines + the ＋ names flip; rtl holds', async ({ page }) => {
  // Flip the account's language server-side (the dashboard is SSR per pref) —
  // the FA twins of the four lines + the FA aria-label on the ＋.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  db.exec(`UPDATE users SET language_pref = 'fa' WHERE id = 's187-user'`)
  db.close()

  await login(page)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  const q3 = page.locator('.dash-todo-quadrant[data-dash-quadrant="3"]')
  const q2 = page.locator('.dash-todo-quadrant[data-dash-quadrant="2"]')
  const q4 = page.locator('.dash-todo-quadrant[data-dash-quadrant="4"]')
  await expect(q3.locator('.dash-todo-empty-text')).toHaveText('الان چیزی فوری نیست.')
  await expect(q2.locator('.dash-todo-empty-text')).toHaveText('الان کاری استراتژیک نیست.')
  await expect(q4.locator('.dash-todo-empty-text')).toHaveText('الان دغدغهٔ دل نیست.')
  // Q3 keeps its (unilingual) custom name in the FA label; Q1 speaks the FA default.
  await expect(q3.locator('.dash-todo-fab')).toHaveAttribute('aria-label', 'افزودن کار به Urgent & Important')
  await expect(page.locator('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-fab')).toHaveAttribute('aria-label', 'افزودن کار به امروز')

  // Restore EN for the account (leave the seed as found).
  const db2 = new DatabaseSync(DB)
  db2.exec(`UPDATE users SET language_pref = 'en' WHERE id = 's187-user'`)
  db2.close()
})
