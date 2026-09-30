// e2e/s180-sticky-restore.spec.ts — S180 (owner blocks 1–7): the sticky restore.
//
// WHY THIS FILE EXISTS: after S179's dashboard system pass, the compact Quick
// Notebook's CSS rules sat ABOVE the shared .note-card/.note-list base rules in
// quicknotes.css — at equal specificity the later base rules won every conflict,
// so the yellow stickies regressed into small WHITE CHIPS stacked vertically in
// a tall panel, and the "Continue where you left off" strip vanished for any
// browser whose hibana-resume store was empty (it renders nothing without
// entries — the owner read that as "the section was removed").
//
// These specs pin the S180 contracts:
//   1. the sticky look — yellow paper (#FFF59D), dark-brown ink (#4D440A), soft
//      shadow, 4px radius, and the CREATION date + time on every note
//   2. readable text — the note body at 14px; the 12px timestamp in the brown
//      family (#6B5B10 — 6.01:1 on the yellow, over the 4.5:1 AA floor)
//   3. the compact layout — a WRAPPING row of equal-width (~180px) stickies,
//      newest first from the inline-start edge; the panel height follows content
//   4. the 5-cap + "View all (N)" with the count hidden at ≤5
//   5. the Move-to menu's KEYBOARD operability (Enter opens, arrows cycle,
//      Escape closes + refocuses the summary)
//   6. the resume SEED — an empty store still renders the strip (server-sourced,
//      display-only: the store stays null), above every dashboard section; Clear
//      recents dismisses it for the session and Undo restores it
// Run: npx playwright test e2e/s180-sticky-restore.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s180@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const USER_ID = 's180-user-' + randomBytes(8).toString('hex')

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = Date.now()
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM quick_notes WHERE user_id LIKE 's180-user-%'`)
    db.exec(`DELETE FROM projects WHERE user_id LIKE 's180-user-%'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id LIKE 's180-user-%'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s180', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${iso(86400000 * 30)}', '${iso(86400000 * 30)}')`,
  )
  // Two projects (resume-seed + Move-to targets), distinct updated_at ladder.
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s180-proj-alpha', '${USER_ID}', 'Alpha website', '', 'personal', 'developing', 0, '${iso(86400000 * 12)}', '${iso(3600000 * 8)}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s180-proj-beta', '${USER_ID}', 'Beta research', '', 'personal', 'planning', 1, '${iso(86400000 * 6)}', '${iso(3600000 * 26)}')`,
  )
  // One vault note — newest of all (the seed's hero).
  db.exec(
    `INSERT INTO vault_notes (id, user_id, title, content, tags, created_at, updated_at)
     VALUES ('s180-vn-1', '${USER_ID}', 'Seed vault note', 'x', '', '${iso(3600000 * 2)}', '${iso(3600000 * 2)}')`,
  )
  // 8 quick notes: the wrap row shows the 5 highest sort_order (newest first).
  const notes = [
    { id: 's180-n1', content: 'Call the dentist about the appointment reschedule', color: 'yellow', ms: 3600000 * 2 },
    { id: 's180-n2', content: 'Landlord said the repair team comes Thursday morning', color: 'yellow', ms: 3600000 * 9 },
    { id: 's180-n3', content: 'Book idea: a quiet guide to keeping a small notebook', color: 'green', ms: 86400000 },
    { id: 's180-n4', content: 'Groceries: olive oil, bread, tomatoes, coffee filters', color: 'yellow', ms: 86400000 * 2 },
    { id: 's180-n5', content: 'Ask Nima which microphone he uses for the podcast', color: 'pink', ms: 86400000 * 3 },
    { id: 's180-n6', content: 'Draft the client-work reminder email template', color: 'yellow', ms: 86400000 * 5 },
    { id: 's180-n7', content: 'Old note beyond the cap, lives in the archive only', color: 'yellow', ms: 86400000 * 8 },
    { id: 's180-n8', content: 'Oldest note beyond the cap', color: 'yellow', ms: 86400000 * 11 },
  ]
  notes.forEach((n, i) => {
    db.exec(
      `INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, deleted_at, sort_order, color, note_date, sticky, done, created_at, updated_at)
       VALUES ('${n.id}', '${USER_ID}', 'note', '', '${n.content.replace(/'/g, "''")}', NULL, NULL, ${100 - i}, '${n.color}', NULL, 0, 0, '${iso(n.ms)}', '${iso(n.ms)}')`,
    )
  })
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
  await page.waitForTimeout(1200) // the htmx dashboard swap + the notebook render
}

/* ── 1. The sticky look restored ─────────────────────────────────────────────── */

test('S180-1: the sticky paper — yellow surface, brown ink, soft shadow, 4px radius', async ({ page }) => {
  await login(page)
  const card = page.locator('#notebook .note-card-dash').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  const style = await card.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, ink: cs.color, radius: cs.borderRadius, shadow: cs.boxShadow !== 'none' }
  })
  expect(style.bg).toBe('rgb(255, 245, 157)') // #FFF59D — the owner's spec
  expect(style.ink).toBe('rgb(77, 68, 10)') // #4D440A — the dark-brown ink
  expect(style.radius).toBe('4px') // the small corner radius
  expect(style.shadow).toBe(true) // the soft drop shadow
})

test('S180-1b: the creation date AND time stamp every sticky', async ({ page }) => {
  await login(page)
  const meta = page.locator('#notebook .note-card-dash .note-meta').first()
  await expect(meta).toBeVisible()
  // "Wednesday 30 Sep 12:36" — the weekday + day + month + HH:MM of CREATION.
  await expect(meta).toHaveText(/^[A-Za-z]+ \d{1,2} [A-Za-z]+ \d{2}:\d{2}$/)
})

/* ── 2. Readable text ────────────────────────────────────────────────────────── */

test('S180-2: 14px note text; the 12px timestamp in the brown family (≥4.5:1)', async ({ page }) => {
  await login(page)
  const card = page.locator('#notebook .note-card-dash').first()
  const style = await card.evaluate((el) => {
    const body = el.querySelector('.note-render')
    const meta = el.querySelector('.note-meta')
    return { body: getComputedStyle(body!).fontSize, meta: getComputedStyle(meta!).fontSize, metaColor: getComputedStyle(meta!).color }
  })
  expect(style.body).toBe('14px') // ≥13px — the owner's floor
  expect(style.meta).toBe('12px')
  expect(style.metaColor).toBe('rgb(107, 91, 16)') // #6B5B10 — 6.01:1 on #FFF59D
})

/* ── 3. The compact layout ───────────────────────────────────────────────────── */

test('S180-3: a wrapping row of equal-width stickies from the inline-start edge; the panel follows its content', async ({ page }) => {
  await login(page)
  const row = page.locator('.dash-note-row')
  const rowStyle = await row.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { display: cs.display, wrap: cs.flexWrap, gap: cs.gap, justify: cs.justifyContent }
  })
  expect(rowStyle.display).toBe('flex')
  expect(rowStyle.wrap).toBe('wrap')
  expect(parseFloat(rowStyle.gap)).toBeGreaterThan(0)
  expect(['flex-start', 'normal', 'start']).toContain(rowStyle.justify) // the inline-start edge
  // Equal ~180px papers, five of them.
  const widths = await page.locator('#notebook .note-card-dash').evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().width)))])
  expect(widths).toEqual([180])
  await expect(page.locator('#notebook .note-card-dash')).toHaveCount(5)
  // No fixed min-height on the panel — the height follows the content.
  const panel = page.locator('.card.notebook-dashboard')
  const minH = await panel.evaluate((el) => getComputedStyle(el).minHeight)
  expect(minH).toBe('auto')
  // Newest first: the dentist note (2h ago) leads the row.
  await expect(page.locator('#notebook .note-card-dash .note-render').first()).toContainText('dentist')
})

/* ── 4. The cap + the View-all count ─────────────────────────────────────────── */

test('S180-4: "View all (N)" carries the live total; the count hides at ≤5', async ({ page }) => {
  await login(page)
  // 8 stored, 5 rendered → the count rides the link.
  await expect(page.locator('.note-view-all')).toHaveText('View all (8)')
  // Two deletions through the hover-revealed cluster (Desktop Chrome pins the
  // hover branch) → 6 stored: still beyond the row's 5, the count updates live.
  for (const label of ['Groceries', 'Ask Nima']) {
    const card = page.locator('#notebook .note-card-dash', { hasText: label }).first()
    await card.hover()
    await card.locator('[data-note-delete]').click()
    await expect(page.locator('#notebook .note-card-dash').first()).toBeVisible({ timeout: 10_000 }) // the re-GET settled
  }
  await expect(page.locator('.note-view-all')).toHaveText('View all (6)')
  // A third deletion lands the total ON the cap → the count hides (the plain link stays).
  const card = page.locator('#notebook .note-card-dash', { hasText: 'Book idea' }).first()
  await card.hover()
  await card.locator('[data-note-delete]').click()
  await expect(page.locator('.note-view-all')).toHaveText('View all', { timeout: 10_000 })
})

/* ── 5. The Move-to menu is keyboard-operable ────────────────────────────────── */

test('S180-5: Enter opens the Move-to menu, arrows cycle the options, Escape closes and refocuses the summary', async ({ page }) => {
  await login(page)
  const card = page.locator('#notebook .note-card-dash').first()
  const menu = card.locator('.dash-note-move')
  const summary = menu.locator('summary')

  // Enter OPENS (native summary behavior).
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => menu.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)

  // ArrowDown rides the options in order; ArrowUp walks back.
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => page.evaluate(() => (document.activeElement?.textContent || '').trim())).toBe('Idea')
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => page.evaluate(() => (document.activeElement?.textContent || '').trim())).toBe('To-do')
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => page.evaluate(() => (document.activeElement?.textContent || '').trim())).toBe('Project note')
  await page.keyboard.press('ArrowUp')
  await expect.poll(async () => page.evaluate(() => (document.activeElement?.textContent || '').trim())).toBe('To-do')

  // Escape CLOSES the menu and returns focus to the summary (the trigger).
  await page.keyboard.press('Escape')
  await expect.poll(async () => menu.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)
  await expect.poll(async () => page.evaluate(() => document.activeElement?.tagName)).toBe('SUMMARY')
})

/* ── 6. The resume SEED — the strip renders for an empty store ────────────────── */

test('S180-6: an empty store still renders "Continue where you left off" — server-seeded, display-only, above every section', async ({ page }) => {
  // A clean context: no hibana-resume, no session dismissal — the fallback's home turf.
  await login(page)
  await page.evaluate(() => { localStorage.removeItem('hibana-resume'); sessionStorage.removeItem('hibana-resume-seed-dismissed') })
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible()
  // The server seed's hero = the vault note (2h old — newest of all).
  await expect(page.locator('.resume-hero-title')).toHaveText('Seed vault note')
  await expect(page.locator('.resume-hero-cta')).toContainText('Open')
  // Above EVERY dashboard section (first child after the sr-only h1).
  const idx = await strip.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
  expect(idx).toBe(1)
  // DISPLAY-ONLY: the seed never writes the store (the S105 recording rule).
  expect(await page.evaluate(() => localStorage.getItem('hibana-resume'))).toBeNull()
})

test('S180-6b: Clear recents dismisses the seed for the session; Undo restores it', async ({ page }) => {
  await login(page)
  await page.evaluate(() => { localStorage.removeItem('hibana-resume'); sessionStorage.removeItem('hibana-resume-seed-dismissed') })
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await expect(page.locator('#resume-strip')).toBeVisible()

  await page.click('[data-resume-clear]')
  await expect(page.locator('#resume-strip')).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('hibana-resume-seed-dismissed'))).toBe('1')
  // The store stays untouched (it was empty all along).
  expect(await page.evaluate(() => localStorage.getItem('hibana-resume'))).toBeNull()

  // The 6s Undo toast writes nothing either — it just un-dismisses + re-renders.
  const undo = page.locator('#toast button', { hasText: 'Undo' })
  await expect(undo).toBeVisible()
  await undo.click()
  await expect(page.locator('#resume-strip')).toBeVisible()
  await expect(page.locator('.resume-hero-title')).toHaveText('Seed vault note')
  expect(await page.evaluate(() => sessionStorage.getItem('hibana-resume-seed-dismissed'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('hibana-resume'))).toBeNull()

  // A reload mid-session keeps the DISMISSAL (Clear sticks within the session).
  await page.click('[data-resume-clear]')
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  await expect(page.locator('#resume-strip')).toHaveCount(0)
})

test('S180-6c: a real store still wins — the seed never overrides recorded history', async ({ page }) => {
  await login(page)
  await page.evaluate(() => {
    localStorage.setItem('hibana-resume', JSON.stringify([
      { k: 'project', id: 's180-proj-beta', t: 'Beta research', ts: Date.now() - 60_000, b: 'planning' },
    ]))
    sessionStorage.removeItem('hibana-resume-seed-dismissed')
  })
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  // The store's entry is the hero — NOT the server seed's newer vault note.
  await expect(page.locator('.resume-hero-title')).toHaveText('Beta research')
})
