// e2e/s260-tag-edit-merge.spec.ts — S260 (the S259 finding's micro-fix,
// AUDIT-REMEDIATION-SPEC.md §14's Phase-8 recorded regression): the editor's
// immediate tag add/remove on an EXISTING task must merge into
// HibanaBoard.state.tasks[].tags so Phase 3's post-save repaint (FE-1 — the
// S254 lane repaint that renders from state, zero board refetch) shows the
// chip on the CARD. Pre-fix the POST landed (201, data safe server-side) but
// the card stayed chipless until the next reload — and the ✕ remove path left
// a STALE chip in the same window. Only tags-on-CREATE was pinned before
// (s208 — the create body rides tags[] + the one lean reload); this spec pins
// the EDIT round:
//   1. ADD — card ⋯ → Edit → [data-db-tag-in] + Enter → Save → the card
//      carries the chip WITHOUT any board GET (the FE-1 repaint contract) and
//      the server truth agrees (201 landed).
//   2. REMOVE — the same editor's ✕ → Save → the card's chip is GONE without
//      any board GET (the stale-chip half of the finding).
//   3. CANCEL — a tag added then the editor closed WITHOUT saving keeps the
//      chip on the card (the add was immediate + already merged — the server
//      has it; the card must not lie the other way). This is the immediate-
//      mutation contract the editor has always carried (the S208 live-add
//      design), now rendered truthfully.
// (live-s259-probe.mjs's "(B4) kanban TAG" line is the live twin of leg 1.)

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s260@test.local'
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
    db.exec(`DELETE FROM dev_task_tags WHERE task_id IN (SELECT id FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')))`)
    db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}'))`)
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s260', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
})

async function login(page: Page) {
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForTimeout(400)
}

async function boardReady(page: Page) {
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('#db-loading')).toBeHidden()
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/, /Failed to load resource.*409/, /Failed to load resource.*400/]
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

// ---------------------------------------------------------------------- tests

test('tag-on-EDIT (add): the editor round merges into state → the card shows the chip on the FE-1 repaint, ZERO board refetch, server truth agrees', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's260 tag edit board', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const task = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's260 established task', status: 'idea' }) })).json()) as { id: string }
    return { pid, tid: task.id }
  }, undefined)
  await page.goto(`/kanban?project=${ids.pid}`)
  await boardReady(page)
  const card = page.locator(`.pd-task-wrap[data-task-card="${ids.tid}"]`)
  await expect(card).toBeVisible()

  // count every devboard GET the round fires (the FE-1 repaint contract: zero)
  const boardGets: string[] = []
  page.on('request', (r) => { if (/\/devboard/.test(r.url()) && r.method() === 'GET') boardGets.push(r.url()) })

  // the editor round: ⋯ → Edit → tag input + Enter → the MODAL shows the chip
  await card.locator('.pd-task').hover()
  await card.locator('.db-card-menu [data-menu-open]').click()
  await page.locator('.spark-menu-pop:not([hidden]) [data-db-edit-card]').click()
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  await page.waitForTimeout(700) // let the editor's async shots round settle before typing
  const tagIn = modal.locator('[data-db-tag-in]')
  await tagIn.fill('s260-proof')
  await tagIn.press('Enter')
  await expect(modal.locator('.db-tag:has-text("s260-proof")')).toBeVisible({ timeout: 5_000 })
  // save → the modal closes → the touched lane repaints FROM STATE
  await modal.locator('[data-db-save]').click()
  await expect(modal).toBeHidden({ timeout: 10_000 })

  // THE PIN (the S259 finding): the chip is on the CARD without any reload
  await expect(card.locator('.pd-task-tags .pd-tag', { hasText: 's260-proof' })).toBeVisible({ timeout: 5_000 })
  // the repaint contract held: ZERO board GETs in the whole edit round
  expect(boardGets, 'the edit-save repainted from state, no board refetch').toHaveLength(0)

  // the server truth agrees (the POST landed — the data was always safe)
  const truth = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), ids.pid)
  const row = (truth as { tasks: { id: string; tags: string[] }[] }).tasks.find((t) => t.id === ids.tid)
  expect((row?.tags || []).length).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('tag-on-EDIT (remove): the ✕ round splices from state → the stale chip is GONE on the repaint, ZERO board refetch', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's260 tag remove board', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const task = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's260 tagged task', status: 'idea', tags: ['s260-doomed'] }) })).json()) as { id: string }
    return { pid, tid: task.id }
  }, undefined)
  await page.goto(`/kanban?project=${ids.pid}`)
  await boardReady(page)
  const card = page.locator(`.pd-task-wrap[data-task-card="${ids.tid}"]`)
  // the created task's chip rides the boot payload
  await expect(card.locator('.pd-task-tags .pd-tag', { hasText: 's260-doomed' })).toBeVisible({ timeout: 10_000 })

  const boardGets: string[] = []
  page.on('request', (r) => { if (/\/devboard/.test(r.url()) && r.method() === 'GET') boardGets.push(r.url()) })

  // the remove round: ⋯ → Edit → the chip's ✕ → Save
  await card.locator('.pd-task').hover()
  await card.locator('.db-card-menu [data-menu-open]').click()
  await page.locator('.spark-menu-pop:not([hidden]) [data-db-edit-card]').click()
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  await page.waitForTimeout(700)
  await modal.locator('[data-untag]').first().click()
  await expect(modal.locator('.db-tag')).toHaveCount(0, { timeout: 5_000 })
  await modal.locator('[data-db-save]').click()
  await expect(modal).toBeHidden({ timeout: 10_000 })

  // THE PIN (the finding's stale-chip half): the chip left the CARD too
  await expect(card.locator('.pd-task-tags .pd-tag')).toHaveCount(0, { timeout: 5_000 })
  expect(boardGets, 'the remove-save repainted from state, no board refetch').toHaveLength(0)

  // the server truth agrees (the DELETE landed)
  const truth = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), ids.pid)
  const row = (truth as { tasks: { id: string; tags: string[] }[] }).tasks.find((t) => t.id === ids.tid)
  expect(row?.tags || []).toHaveLength(0)
  expect(errors).toEqual([])
})

test('tag-on-EDIT (cancel): the immediate add lives in state — the next state-render (the priority cycle) paints the chip, no refetch', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const ids = await page.evaluate(async () => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's260 tag cancel board', status: 'developing' }) })
    const pid = ((await res.json()) as { id: string }).id
    const task = (await (await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 's260 cancel task', status: 'idea' }) })).json()) as { id: string }
    return { pid, tid: task.id }
  }, undefined)
  await page.goto(`/kanban?project=${ids.pid}`)
  await boardReady(page)
  const card = page.locator(`.pd-task-wrap[data-task-card="${ids.tid}"]`)

  // add the tag, then CLOSE without saving (Esc = the native cancel path — the
  // S254 contract repaints ONLY on save, so no render fires here by design)
  await card.locator('.pd-task').hover()
  await card.locator('.db-card-menu [data-menu-open]').click()
  await page.locator('.spark-menu-pop:not([hidden]) [data-db-edit-card]').click()
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  await page.waitForTimeout(700)
  const tagIn = modal.locator('[data-db-tag-in]')
  await tagIn.fill('s260-kept')
  await tagIn.press('Enter')
  await expect(modal.locator('.db-tag:has-text("s260-kept")')).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden({ timeout: 10_000 })

  // the add was immediate (the S208 live-add design — the POST landed at
  // Enter) and S260 merged it into state: the NEXT state-render paints it.
  // The priority banner's optimistic renderColumn is that proof — no save, no
  // refetch, just a render from the merged state.
  const boardGets: string[] = []
  page.on('request', (r) => { if (/\/devboard/.test(r.url()) && r.method() === 'GET') boardGets.push(r.url()) })
  await card.locator('[data-db-cycle-prio]').click()
  await expect(card.locator('.pd-task-tags .pd-tag', { hasText: 's260-kept' })).toBeVisible({ timeout: 5_000 })
  expect(boardGets, 'the cycle repainted from state, no board refetch').toHaveLength(0)

  // the server truth agrees (the add landed even though the editor was cancelled)
  const truth = await page.evaluate(async (pid) => await (await fetch(`/api/projects/${pid}/devboard`)).json(), ids.pid)
  const row = (truth as { tasks: { id: string; tags: string[] }[] }).tasks.find((t) => t.id === ids.tid)
  expect((row?.tags || []).length).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
