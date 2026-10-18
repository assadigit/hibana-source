// e2e/s208-kanban-shots.spec.ts — S208 (owner ask 2026-10-20): "When creating a
// new task, it doesn't let you (show the button) to upload a picture — but
// already established tasks give you the option. Make sure you've implemented
// all of the kanban options of the original hibana into this one."
//
// The task-editor parity contract:
//   1. THE BUTTON — the NEW-task modal shows the Upload File button (the
//      paperclip + the full S86 accept list) exactly like the edit modal does.
//   2. STAGED SHOTS — a picked file lands in the staged grid immediately; SAVE
//      creates the task AND pins the shot to it (PATCH taskId); CANCEL/Esc
//      deletes the staged shot (the composer's contract — nothing orphans).
//   3. THE EDIT MODAL — the same button + the inline PINNED grid (the task's
//      shots, zoom / edit-note / delete) — the pde-shots-grid contract.
//   4. TAGS ON CREATE — the new-task modal stages tags (chips + Enter) and they
//      ride the create body's tags[] (the server find-or-creates them).
//   5. THE CARD BADGE — a task with pinned shots carries the .pd-task-shots
//      badge (shot_count from the devboard payload); click opens the
//      pinned-pictures dialog (zoom + unpin); unpin reloads the board.
//   6. LIGHTBOX ESC PRECEDENCE — Esc over an open lightbox closes ONLY the
//      lightbox; the editor underneath stays (the second Esc closes it).
//
// Storage note: the e2e server has no real shot-store creds — the shot ROWS
// are seeded directly (the media-gallery recipe) and the upload POST + the
// file-serving GET are route-fulfilled with the seeded id + a real 1×1 PNG,
// so the full UI flow (staging → pinning → badge) runs against real DB state.

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { E2E_DB } from './fixtures/e2e-db'

const TEST_EMAIL = 'e2e-s208@test.local'
const TEST_PASS = 'e2e-password-123'

// a REAL 1×1 png — the served bytes for the seeded rows (the thumb renders)
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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
    db.exec(`DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}'))`)
    db.exec(`DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}'))`)
    db.exec(`DELETE FROM projects WHERE user_id IN (SELECT id FROM users WHERE email = '${TEST_EMAIL}')`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', 'e2e-s208', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
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

async function seedProject(page: Page, title: string): Promise<string> {
  return await page.evaluate(async (title) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'developing' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, title)
}

async function seedTask(page: Page, pid: string, title: string): Promise<string> {
  return await page.evaluate(async ([pid, title]) => {
    const res = await fetch(`/api/projects/${pid}/devtasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'in_progress' }) })
    const { id } = (await res.json()) as { id: string }
    return id
  }, [pid, title])
}

/** Seed a screenshot row directly (no storage creds in e2e) — media-gallery recipe. */
async function seedShot(pid: string, taskId: string | null): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(E2E_DB)
  const id = `s208shot${randomBytes(6).toString('hex')}`
  db.prepare('INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 100, ?)')
    .run(id, pid, `u/${id}.png`, 'image/png', '', taskId, new Date().toISOString())
  db.close()
  return id
}

async function listShots(page: Page, pid: string) {
  return await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/screenshots`)
    return ((await res.json()) as { screenshots: { id: string; task_id: string | null }[] }).screenshots
  }, pid)
}

/**
 * Route the UPLOAD POST to the seeded shot id (201, the API's own response
 * shape) and the FILE SERVE to a real 1×1 PNG — the UI flow runs against the
 * seeded DB row (pin PATCH + delete are REAL API calls).
 */
async function routeUploadAndFile(page: Page, shotId: string) {
  await page.route(/\/api\/projects\/[^/]+\/screenshots$/, async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, id: shotId, mimeType: 'image/png' }) })
    }
    return route.continue()
  })
  await page.route(/\/api\/media\/screenshots\/[^/]+\/file/, async (route) => {
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BUFFER })
  })
}

const expectedErrorPatterns = [/Failed to load resource.*401/, /Failed to load resource.*404/, /Failed to load resource.*500/]
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

const ACCEPT = '.pdf,.csv,.xlsx,.docx,.md,.txt,image/png,image/jpeg,image/webp,image/gif,video/webm'

test('the NEW-task modal shows the Upload File button (the owner\u2019s exact complaint) — paperclip, full S86 accept list, hidden multiple input', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's208 button board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await page.click('[data-add="idea"]')
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  // the button + the input it clicks — BOTH modes from now on
  await expect(modal.locator('[data-db-shots-add]')).toBeVisible()
  await expect(modal.locator('[data-db-shots-add]')).toContainText('Upload File')
  await expect(modal.locator('[data-db-shots-input]')).toHaveAttribute('accept', ACCEPT)
  await expect(modal.locator('[data-db-shots-input]')).toHaveAttribute('multiple', /.*/)
  // the tags field exists for NEW tasks too (the staged-chips variant)
  await expect(modal.locator('[data-db-newtag-in]')).toBeVisible()
  // the count span rides the button row
  await expect(modal.locator('[data-db-shots-count]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  expect(errors).toEqual([])
})

test('staged shots: pick → grid → SAVE pins to the created task (API-verified) → the card grows the pin badge', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's208 staged board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const shotId = await seedShot(pid, null)
  await routeUploadAndFile(page, shotId)
  await page.click('[data-add="idea"]')
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  await page.fill('[name=title]', 's208 staged task')
  // pick a "file" through the hidden input — the strip stages it immediately
  await modal.locator('[data-db-shots-input]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG_BUFFER })
  await expect(modal.locator('[data-db-shots-grid] .shot-card')).toBeVisible({ timeout: 10_000 })
  await expect(modal.locator('[data-db-shots-count]')).toContainText('1 attached')
  await modal.locator('[data-db-save]').click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
  // the pin landed on the created task (the PATCH was real)
  const shots = await listShots(page, pid)
  const shot = shots.find((s) => s.id === shotId)
  expect(shot?.task_id).toBeTruthy()
  // the board reloaded: the new card carries the pin badge with the count
  const badge = page.locator('.pd-task-wrap[data-task-card] .pd-task-shots')
  await expect(badge).toBeVisible({ timeout: 10_000 })
  await expect(badge).toContainText('1')
  expect(errors).toEqual([])
})

test('staged shots: CANCEL deletes them (nothing orphans in the gallery)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's208 cancel board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  const shotId = await seedShot(pid, null)
  await routeUploadAndFile(page, shotId)
  await page.click('[data-add="idea"]')
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  await page.fill('[name=title]', 's208 never created')
  await modal.locator('[data-db-shots-input]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG_BUFFER })
  await expect(modal.locator('[data-db-shots-grid] .shot-card')).toBeVisible({ timeout: 10_000 })
  // Esc = the native cancel path — the staged shot must be deleted
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  await page.waitForTimeout(800) // the cleanup DELETE is fire-and-forget
  const shots = await listShots(page, pid)
  expect(shots.find((s) => s.id === shotId)).toBeUndefined()
  expect(errors).toEqual([])
})

test('the EDIT modal: the same Upload File button + the inline PINNED grid; zoom opens the lightbox and Esc closes ONLY the lightbox', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's208 edit board')
  const tid = await seedTask(page, pid, 's208 established task')
  const shotId = await seedShot(pid, tid) // pinned directly (task_id set)
  await routeUploadAndFile(page, shotId)
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  // the established task's badge is live before we even open the editor
  const badge = page.locator('.pd-task-wrap[data-task-card] .pd-task-shots')
  await expect(badge).toBeVisible({ timeout: 10_000 })
  // open the editor (the card click — the established flow)
  await page.locator('.pd-task-wrap[data-task-card] .pd-task').first().click()
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  // the SAME button in edit mode + the pinned grid under it (the task's shot)
  await expect(modal.locator('[data-db-shots-add]')).toBeVisible()
  await expect(modal.locator('[data-db-shots-grid] .shot-card')).toBeVisible({ timeout: 10_000 })
  await expect(modal.locator('[data-db-shots-grid] [data-db-shot-zoom]')).toHaveCount(1)
  // zoom → the lightbox paints (above the z-90 modal); Esc closes ONLY it
  await modal.locator('[data-db-shot-zoom]').click()
  const lightbox = page.locator('.shot-lightbox')
  await expect(lightbox).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(lightbox).toHaveCount(0)
  await expect(modal).toBeVisible() // the editor SURVIVED the lightbox's Esc
  // the second Esc closes the editor as before
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  expect(errors).toEqual([])
})

test('tags on CREATE: stage chips in the new-task modal → they ride the create body → the card renders the chip', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's208 tags board')
  await page.goto(`/kanban?project=${pid}`)
  await expect(page.locator('.db-cols')).toBeVisible({ timeout: 10_000 })
  await page.click('[data-add="idea"]')
  const modal = page.locator('.db-modal-card')
  await expect(modal).toBeVisible()
  await page.fill('[name=title]', 's208 tagged task')
  const tagIn = modal.locator('[data-db-newtag-in]')
  await tagIn.fill('UI/UX')
  await tagIn.press('Enter')
  await expect(modal.locator('[data-db-newtags] .db-tag')).toContainText('UI/UX')
  await tagIn.fill('Security')
  await tagIn.press('Enter')
  await expect(modal.locator('[data-db-newtags] .db-tag')).toHaveCount(2)
  // ✕ removes a staged chip
  await modal.locator('[data-newtag-del]').first().click()
  await expect(modal.locator('[data-db-newtags] .db-tag')).toHaveCount(1)
  await modal.locator('[data-db-save]').click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
  // the task was created WITH the staged tag (API truth)
  const tagged = await page.evaluate(async ([pid]) => {
    const res = await fetch(`/api/projects/${pid}/devboard`)
    const body = (await res.json()) as { tasks: { title: string; tags: string[] }[]; task_tags: { task_id: string; name: string }[] }
    return body
  }, [pid])
  const task = tagged.tasks.find((t) => t.title === 's208 tagged task')
  expect(task?.tags?.length).toBe(1)
  const tagName = tagged.task_tags.find((tt) => task && tt.task_id === task.id)?.name
  expect(tagName).toBe('Security')
  // the board reloaded — the card carries the label chip
  await expect(page.locator('.pd-task-tags .pd-tag').first()).toBeVisible({ timeout: 10_000 })
  expect(errors).toEqual([])
})

test('the card\u2019s pin badge opens the pinned-pictures dialog; unpin reloads the board and drops the badge', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop Chromium only')
  const errors = trackErrors(page)
  await login(page)
  const pid = await seedProject(page, 's208 badge board')
  const tid = await seedTask(page, pid, 's208 badge task')
  await seedShot(pid, tid)
  await page.goto(`/kanban?project=${pid}`)
  const badge = page.locator('.pd-task-wrap[data-task-card] .pd-task-shots')
  await expect(badge).toBeVisible({ timeout: 10_000 })
  await expect(badge).toContainText('1')
  await page.route(/\/api\/media\/screenshots\/[^/]+\/file/, async (route) => {
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BUFFER })
  })
  await badge.click()
  const dlg = page.locator('#db-taskshots')
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('.shot-card')).toHaveCount(1)
  // zoom works from the dialog too (the lightbox mounts into its top layer)
  await dlg.locator('[data-tshots-zoom]').click()
  await expect(page.locator('.shot-lightbox')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(page.locator('.shot-lightbox')).toHaveCount(0)
  await expect(dlg).toBeVisible()
  // unpin → PATCH real → dialog closes → the board reloads → badge gone
  await dlg.locator('[data-tshots-unpin]').click()
  await expect(dlg).toBeHidden({ timeout: 10_000 })
  await expect(badge).toHaveCount(0, { timeout: 10_000 })
  expect(errors).toEqual([])
})
