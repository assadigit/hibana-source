// e2e/resume-continue.spec.ts — S85: the merged "Continue where you left off"
// component (owner redesign instruction #1).
//
// WHY THIS FILE EXISTS: the dashboard used to render TWO resume surfaces — the
// server "Resume work" card (project.updated_at, doing-status only) AND the client
// "Pick up where you left off" strip (open-time) — the same project with two
// different timestamps and no explanation (Nielsen #6). S85 merged them: the ONE
// client component (hero + chips), ONE store (hibana-resume localStorage), ONE
// definition (last touched = last OPENED, labeled "Last opened"). These specs pin:
//   1. the server card NEVER renders (even with a fresh doing project)
//   2. seeded history renders the merged component — hero (newest, with the
//      fixed-palette stage badge for projects) + up to 3 chips + the definition hint
//   3. the Clear button wipes the store and removes the component
//   4. completing a to-do task updates the quadrant COUNT PILL in place (the S85
//      fix for the stale-counter regex that never matched "Active N")
// Run: npx playwright test e2e/resume-continue.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-continue@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const USER_ID = randomBytes(16).toString('hex')

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  try {
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM sadhana_tasks WHERE user_id = '${USER_ID}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-continue', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  // One DOING project (the exact shape that used to summon the server card)…
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('e2e-continue-doing', '${USER_ID}', 'Continue developing project', '', 'personal', 'developing', 0, '${now}', '${now}')`,
  )
  // …and three open quadrant-1 tasks for the count-pill spec.
  for (let i = 0; i < 3; i++) {
    db.exec(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, pinned, position, progress, created_at, updated_at)
       VALUES ('e2e-continue-task-${i}', '${USER_ID}', 1, 'continue spec task ${i}', 0, 0, ${i}, 'untouched', '${now}', '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page) {
  // The first-visit onboarding coachmark backdrop (tour-overlay) intercepts pointer
  // clicks — suppress both onboarding gates for this fresh e2e user (the tour key
  // is 'hibana-tour-done' per tour.js; 'hibana-ln-done' is the older ln coachmark).
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
  await page.waitForTimeout(1200) // the htmx dashboard swap + strip render
}

test('the server "Resume work" card never renders — even with a fresh doing project', async ({ page }) => {
  await login(page)
  await expect(page.locator('.dash-resume')).toHaveCount(0)
  await expect(page.locator('main.shell-dash')).toBeVisible()
  // The doing project still surfaces through the stage carousel (nothing else regressed).
  await expect(page.locator('.skc-title', { hasText: 'Continue developing project' })).toBeVisible()
})

test('seeded history renders the merged component: hero + chips + definition hint', async ({ page }) => {
  await page.goto('/login.html') // clean context first — storage states don't leak
  await login(page)
  // Seed the ONE store (the exact shape record() writes — last opened, stage badge).
  await page.evaluate(() => {
    localStorage.setItem('hibana-resume', JSON.stringify([
      { k: 'project', id: 'e2e-continue-doing', t: 'Continue developing project', ts: Date.now() - 60_000, b: 'developing' },
      { k: 'note', id: 'n-1', t: 'Reading list note', ts: Date.now() - 3_600_000 },
      { k: 'project', id: 'p-old', t: 'An older project', ts: Date.now() - 86_400_000, b: 'planning' },
      { k: 'note', id: 'n-2', t: 'Another note', ts: Date.now() - 172_800_000 },
    ]))
  })
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)

  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible()
  // The merged component's header speaks the ONE definition explicitly.
  await expect(page.locator('#resume-title')).toHaveText('Continue where you left off')
  await expect(page.locator('.resume-hint')).toHaveText('Last opened')
  // HERO = the newest entry (the doing project) with its fixed-palette stage badge + CTA.
  await expect(page.locator('.resume-hero-title')).toHaveText('Continue developing project')
  await expect(page.locator('.resume-stage-badge')).toHaveText('Developing')
  await expect(page.locator('.resume-hero-cta')).toContainText('Open')
  // The remaining three ride the chips row — NOT a second hero.
  await expect(page.locator('.resume-chip')).toHaveCount(3)
  await expect(page.locator('.resume-chip-title').first()).toHaveText('Reading list note')
})

test('Clear wipes the store and removes the component', async ({ page }) => {
  await page.goto('/login.html')
  await login(page)
  await page.evaluate(() => {
    localStorage.setItem('hibana-resume', JSON.stringify([
      { k: 'project', id: 'e2e-continue-doing', t: 'Continue developing project', ts: Date.now(), b: 'developing' },
    ]))
  })
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  await expect(page.locator('#resume-strip')).toBeVisible()

  await page.click('[data-resume-clear]')
  await expect(page.locator('#resume-strip')).toHaveCount(0)
  const stored = await page.evaluate(() => localStorage.getItem('hibana-resume'))
  expect(stored).toBeNull()
})

test('completing a to-do task updates the quadrant count pill in place', async ({ page }) => {
  await page.goto('/login.html')
  await login(page)
  // No resume history — this spec is about the pill, keep storage clean.
  await page.evaluate(() => localStorage.removeItem('hibana-resume'))

  const pill = page.locator('.dash-todo-quadrant[data-dash-quadrant="1"] .dash-todo-counter')
  await expect(pill).toHaveText('3')

  // Complete the first task via its checkbox (the only completion surface — S82).
  await page.locator('.dash-todo-quadrant[data-dash-quadrant="1"] input[data-task-complete]').first().click()
  // The pill flips to 2 WITHOUT a full page reload (updateDashTaskCounter now writes
  // the bare digits — the old "…: N" regex never matched "Active N" and left the
  // counter stale between htmx sweeps).
  await expect(pill).toHaveText('2')
  await page.waitForTimeout(2500) // let the htmx refresh settle too
  await expect(pill).toHaveText('2')
})
