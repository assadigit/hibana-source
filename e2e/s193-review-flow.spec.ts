// e2e/s193-review-flow.spec.ts — S193: THE REVIEW FLOW (the attention path, round 3).
//
// The deliberate review decision reaches the lean idea page, and the review
// queue keeps your place in the unreviewed set:
//   (a) the queue bar — "Review queue · i of n" + Prev/Next — renders ONLY while
//       the current idea is itself in the unreviewed set with siblings (contextual,
//       never a nag); oldest-first order, position updates through hops;
//   (b) the Promote action (the board's dialog grammar) on the lean page — dirty
//       fields fold into the ONE PATCH; the landing is queue-aware (next idea;
//       the new project's page without a queue; the caught-up close at the end);
//   (c) delete from the queue lands on the next idea too;
//   (d) a fresh idea (<7d) and a lone unreviewed idea show NO bar.
//
// STATE DISCIPLINE: every test re-arms its own world via direct DB writes at
// its start (the CSRF origin gate 403s out-of-page request contexts — raw
// DatabaseSync is the e2e pattern), so no test depends on another's tail state.
//
// Run: npx playwright test e2e/s193-review-flow.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s193@test.local'
const FA_EMAIL = 'e2e-s193-fa@test.local'
const TEST_PASS = 'e2e-password-123'
const U1 = 's193u1'
const U2 = 's193u2'

const DAY = 24 * 3600 * 1000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()

// The full seed: three OLD sparks (30d / 14d / 8d — the unreviewed set, oldest
// first) + one FRESH spark (2d — never in the set). Both users mirror the data.
test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  // ONCE, before the loop (the S191 lesson): explicit child-table deletes — raw
  // DatabaseSync runs WITHOUT PRAGMA foreign_keys.
  db.exec(`DELETE FROM projects WHERE id LIKE 's193%' OR user_id IN (SELECT id FROM users WHERE email LIKE 'e2e-s193%')`)
  db.exec(`DELETE FROM users WHERE email LIKE 'e2e-s193%'`)
  const now = iso(0)
  for (const [uid, email, uname, lang] of [
    [U1, TEST_EMAIL, 'e2e-s193', 'en'],
    [U2, FA_EMAIL, 'e2e-s193-fa', 'fa'],
  ] as const) {
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${uid}', '${uname}', '${email}', 'PLACEHOLDER-HASH', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
    )
    for (const [i, days] of [[1, 30], [2, 14], [3, 8]] as const) {
      db.exec(
        `INSERT INTO projects (id, user_id, title, status, description, created_at, updated_at)
         VALUES ('${uid}-sp${i}', '${uid}', 's193 old idea #${i}', 'spark', 'the body of idea #${i}', '${iso(-days * DAY)}', '${iso(-days * DAY)}')`,
      )
    }
    db.exec(
      `INSERT INTO projects (id, user_id, title, status, description, created_at, updated_at)
       VALUES ('${uid}-fresh', '${uid}', 's193 the fresh idea', 'spark', 'captured a moment ago', '${iso(-2 * DAY)}', '${iso(-2 * DAY)}')`,
    )
  }
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  db.exec(`UPDATE users SET password_hash = '${hash.replace(/'/g, "''")}' WHERE email LIKE 'e2e-s193%'`)
  db.close()
})

// The per-test world re-arm: sets each of the four seeded rows to the exact
// status + age asked for ('spark' + days-old, or any project stage = out of the set).
async function arm(rows: Array<{ id: string; status: string; days?: number }>) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  for (const r of rows) {
    const age = r.days === undefined ? '' : `, created_at = '${iso(-r.days * DAY).slice(0, 19)}'`
    db.exec(`UPDATE projects SET status = '${r.status}'${age} WHERE id = '${r.id}'`)
  }
  db.close()
}

async function login(page: Page, email = TEST_EMAIL, theme?: 'claude-dark') {
  await page.addInitScript((args) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (args.theme) localStorage.setItem('hibana-theme', args.theme)
    } catch { /* storage blocked */ }
  }, { theme })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
}

test('the queue bar renders IN-set with the honest position + both hops', async ({ page }) => {
  await arm([
    { id: `${U1}-sp1`, status: 'spark', days: 30 },
    { id: `${U1}-sp2`, status: 'spark', days: 14 },
    { id: `${U1}-sp3`, status: 'spark', days: 8 },
    { id: `${U1}-fresh`, status: 'spark', days: 2 },
  ])
  await login(page)
  await page.goto(`/spark.html?id=${U1}-sp2`)
  const bar = page.locator('#spark-queue')
  await expect(bar).toBeVisible()
  // oldest-first: sp1 (30d) → sp2 (14d) → sp3 (8d); we're on the middle one
  await expect(page.locator('.spark-queue-pos')).toHaveText('Review queue · 2 of 3')
  await expect(page.locator('#spark-queue-prev')).toBeEnabled()
  await expect(page.locator('#spark-queue-next')).toBeEnabled()
  // the aria carries the destination idea's name
  await expect(page.locator('#spark-queue-next')).toHaveAttribute('aria-label', /next idea: s193 old idea #3/i)
  // NEXT → the youngest of the set; the position follows; next retires at the end
  await page.click('#spark-queue-next')
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U1}-sp3`))
  await expect(page.locator('#spark-title')).toHaveValue('s193 old idea #3')
  await expect(page.locator('.spark-queue-pos')).toHaveText('Review queue · 3 of 3')
  await expect(page.locator('#spark-queue-next')).toBeDisabled()
  await expect(page.locator('#spark-queue-prev')).toBeEnabled()
  // PREV → back to the middle
  await page.click('#spark-queue-prev')
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U1}-sp2`))
  await expect(page.locator('.spark-queue-pos')).toHaveText('Review queue · 2 of 3')
})

test('a fresh idea shows NO bar (contextual, never a nag) — but the promote action stays', async ({ page }) => {
  await arm([
    { id: `${U1}-sp1`, status: 'spark', days: 30 },
    { id: `${U1}-sp2`, status: 'spark', days: 14 },
    { id: `${U1}-fresh`, status: 'spark', days: 2 },
  ])
  await login(page)
  // fresh (<7d): not in the unreviewed set — the queue fetch never fires for it
  await page.goto(`/spark.html?id=${U1}-fresh`)
  await expect(page.locator('#spark-title')).toHaveValue('s193 the fresh idea')
  await expect(page.locator('#spark-queue')).toBeHidden()
  // the promote action is still there — reviewing a fresh idea stays possible
  await expect(page.locator('#spark-promote')).toBeVisible()
})

test('promote from the lean page: the dialog grammar + the queue-aware landing', async ({ page }) => {
  await arm([
    { id: `${U1}-sp1`, status: 'spark', days: 30 },
    { id: `${U1}-sp2`, status: 'spark', days: 14 },
    { id: `${U1}-sp3`, status: 'spark', days: 8 },
  ])
  await login(page)
  await page.goto(`/spark.html?id=${U1}-sp2`)
  // dirty fields fold into the ONE PATCH — the words are never lost to the
  // promotion. (The edit happens BEFORE the dialog opens — a native <dialog>
  // showModal() makes the page behind it inert.)
  await page.fill('#spark-title', 's193 old idea #2 (edited mid-review)')
  // the deliberate review decision, where the idea is READ
  await page.click('#spark-promote')
  const dlg = page.locator('#spark-promote-dialog')
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('h3')).toHaveText('Promote to project')
  // the board's stage set rides the dialog
  const stages = dlg.locator('#sp-status option')
  await expect(stages).toHaveCount(5)
  await expect(stages.first()).toHaveAttribute('value', 'planning')
  await expect(stages.last()).toHaveAttribute('value', 'operational')
  await dlg.locator('#sp-status').selectOption('queued')
  await dlg.locator('#sp-save').click()
  // queue-aware landing: the NEXT unreviewed idea (sp3), not the board
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U1}-sp3`))
  await expect(page.locator('#spark-title')).toHaveValue('s193 old idea #3')
  // the promoted idea left the set: the fresh set is [sp1, sp3] → "2 of 2"
  await expect(page.locator('.spark-queue-pos')).toHaveText('Review queue · 2 of 2')
  // the promoted idea is a PROJECT now, with the mid-review edit carried in
  const promoted = await page.request.get(`/api/projects/${U1}-sp2`)
  expect(promoted.ok()).toBe(true)
  const body = await promoted.json()
  expect(body.project.status).toBe('queued')
  expect(body.project.title).toBe('s193 old idea #2 (edited mid-review)')
})

test('the LAST one closes the loop on the caught-up notifications page', async ({ page }) => {
  await arm([
    { id: `${U1}-sp1`, status: 'spark', days: 30 },
    { id: `${U1}-sp2`, status: 'queued' },
    { id: `${U1}-sp3`, status: 'developing' },
    { id: `${U1}-fresh`, status: 'spark', days: 2 },
  ])
  await login(page)
  // sp1 is the LONE unreviewed idea — the lone idea carries no bar (nothing to
  // traverse), but promote still answers: no next, no siblings → the loop
  // closes where it began, on the attention surface.
  await page.goto(`/spark.html?id=${U1}-sp1`)
  await expect(page.locator('#spark-queue')).toBeHidden()
  await page.click('#spark-promote')
  await page.locator('#spark-promote-dialog #sp-status').selectOption('planning')
  await page.locator('#spark-promote-dialog #sp-save').click()
  await page.waitForURL(/\/notifications\.html/)
  await expect(page.locator('.empty-state-title')).toHaveText('All caught up')
})

test('delete from the queue lands on the NEXT idea', async ({ page }) => {
  await arm([
    { id: `${U1}-sp1`, status: 'queued' },
    { id: `${U1}-sp2`, status: 'developing' },
    { id: `${U1}-fresh`, status: 'spark', days: 20 },
    { id: `${U1}-sp3`, status: 'spark', days: 8 },
  ])
  await login(page)
  // set: [fresh (20d), sp3 (8d)] — fresh rides position 1
  await page.goto(`/spark.html?id=${U1}-fresh`)
  await expect(page.locator('.spark-queue-pos')).toHaveText('Review queue · 1 of 2')
  page.on('dialog', (d) => d.accept()) // the delete confirm
  await page.click('#spark-delete')
  // lands on the next (sp3), not the shelf
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U1}-sp3`))
  await expect(page.locator('#spark-title')).toHaveValue('s193 old idea #3')
  // the set is [sp3] alone now — no bar
  await expect(page.locator('#spark-queue')).toBeHidden()
})

test('the FA/RTL twin: mirrored arrows + Persian digits + the FA keys', async ({ page }) => {
  await arm([
    { id: `${U2}-sp1`, status: 'spark', days: 30 },
    { id: `${U2}-sp2`, status: 'spark', days: 14 },
    { id: `${U2}-sp3`, status: 'spark', days: 8 },
  ])
  await login(page, FA_EMAIL)
  await page.goto(`/spark.html?id=${U2}-sp2`)
  const bar = page.locator('#spark-queue')
  await expect(bar).toBeVisible()
  await expect(page.locator('.spark-queue-pos')).toHaveText('صفِ بررسی · ۲ از ۳')
  await expect(page.locator('#spark-queue-prev span')).toHaveText('ایدهٔ قبلی')
  await expect(page.locator('#spark-queue-next span')).toHaveText('ایدهٔ بعدی')
  // RTL: the chevrons flip (rtl.css .icon.arrow scaleX(-1) — a REAL computed proof)
  const flip = await page.locator('#spark-queue-next .icon.arrow').evaluate((el) => getComputedStyle(el).transform)
  expect(flip).toContain('-1')
  // the dir attribute rides the document
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  // the promote action speaks FA too
  await expect(page.locator('#spark-promote span')).toHaveText('ارتقا به پروژه')
  // the next hop still works under RTL
  await page.click('#spark-queue-next')
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U2}-sp3`))
  await expect(page.locator('.spark-queue-pos')).toHaveText('صفِ بررسی · ۳ از ۳')
})

test('the dark twin: the bar paints the dark --nav-active-* tokens', async ({ page }) => {
  await arm([
    { id: `${U2}-sp1`, status: 'spark', days: 30 },
    { id: `${U2}-sp2`, status: 'spark', days: 14 },
    { id: `${U2}-sp3`, status: 'spark', days: 8 },
  ])
  await login(page, FA_EMAIL, 'claude-dark')
  await page.goto(`/spark.html?id=${U2}-sp2`)
  const bar = page.locator('#spark-queue')
  await expect(bar).toBeVisible()
  const bg = await bar.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgba(143, 204, 207, 0.2)') // the dark tint twin (S189)
  const ink = await page.locator('.spark-queue-pos').evaluate((el) => getComputedStyle(el).color)
  expect(ink).toBe('rgb(154, 212, 215)') // the dark label ink #9AD4D7 (S189)
})

test('the dirty-confirm saves before the queue hop (never lose the words)', async ({ page }) => {
  await arm([
    { id: `${U1}-sp1`, status: 'spark', days: 25 },
    { id: `${U1}-sp2`, status: 'queued' },
    { id: `${U1}-sp3`, status: 'spark', days: 8 },
  ])
  await login(page)
  // set: [sp1 (25d), sp3 (8d)] — sp1 rides position 1
  await page.goto(`/spark.html?id=${U1}-sp1`)
  await expect(page.locator('.spark-queue-pos')).toHaveText('Review queue · 1 of 2')
  // edit the title, then hop — the confirm saves first
  await page.fill('#spark-title', 's193 mid-review edit')
  page.on('dialog', (d) => d.accept()) // the save-and-continue confirm
  await page.click('#spark-queue-next')
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U1}-sp3`))
  // the edit SAVED (not lost): verify via the API
  const r = await page.request.get(`/api/projects/${U1}-sp1`)
  const body = await r.json()
  expect(body.project.title).toBe('s193 mid-review edit')
})

test('0 console errors, 0 page errors through the flow', async ({ page }) => {
  // the listeners attach AFTER login (the s192 pattern): the logged-out shell's
  // /api/auth/me 401 is login-page noise, not part of the flow under test
  await arm([
    { id: `${U1}-sp1`, status: 'spark', days: 25 },
    { id: `${U1}-sp2`, status: 'queued' },
    { id: `${U1}-sp3`, status: 'spark', days: 8 },
  ])
  await login(page)
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.goto(`/spark.html?id=${U1}-sp1`)
  await expect(page.locator('#spark-queue')).toBeVisible()
  await page.click('#spark-queue-next')
  await page.waitForURL(new RegExp(`spark\\.html\\?id=${U1}-sp3`))
  await page.click('#spark-promote')
  await page.locator('#spark-promote-dialog #sp-status').selectOption('queued')
  await page.locator('#spark-promote-dialog #sp-save').click()
  await page.waitForURL(/(spark\.html\?id=|notifications\.html)/)
  await page.waitForTimeout(800)
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
})
