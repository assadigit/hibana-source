// e2e/s185-project-palette.spec.ts — S185 (the owner's batch-1 color round):
// the Project Detail page's role-named palette, scoped + verified.
//   Block 1 (tokens): the :root block exists with the table's roles and the five
//   kanban columns resolve THROUGH the --col-* tokens (one rule set, both themes).
//   Block 2 (canvas + cards): body.pd-page wears --page-bg #F5F4F1; every card
//   (.card + .pd-task) wears the warm-gray hairline #D5D2CA — and ONLY this page:
//   the dashboard's canvas stays #E7E7E7 with the neutral #D4D4D4 card line.
//   Block 3 (one family): the five column tints + dots share ONE lightness +
//   softness (the OKLCH set from qa/s185-palette.mjs); the title inks clear AA on
//   their tints (idea/planned were re-tuned).
//   Block 5 (the Notes field): #pd-note-textarea = white surface + visible hairline
//   + the teal --primary border on focus (accent + halo grammar); dark keeps its
//   own twins (clay primary, recessed surface).
// Run: npx playwright test e2e/s185-project-palette.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s185@test.local'
const TEST_PASS = 'e2e-password-123'
const USER_ID = randomBytes(16).toString('hex')
const PROJ_ID = randomBytes(16).toString('hex')
const PROJ_TITLE = 's185 palette project'

// One task per column so all five stage strips render open.
const STATUSES = ['idea', 'planned', 'in_progress', 'done', 'bug'] as const
const TASKS = STATUSES.map((status, i) => ({
  id: randomBytes(16).toString('hex'),
  status,
  sort: i + 1,
}))

// The S185 family (qa/s185-palette.mjs output) in Chromium's computed rgb() form.
const FAMILY = {
  idea:     { tint: 'rgb(235, 243, 255)', dot: 'rgb(123, 175, 255)', ink: 'rgb(84, 111, 142)' },
  planned:  { tint: 'rgb(252, 240, 230)', dot: 'rgb(231, 154, 78)',  ink: 'rgb(103, 110, 119)' },
  progress: { tint: 'rgb(247, 242, 229)', dot: 'rgb(204, 171, 62)',  ink: 'rgb(125, 90, 52)' },
  done:     { tint: 'rgb(234, 246, 237)', dot: 'rgb(104, 197, 132)', ink: 'rgb(67, 112, 79)' },
  bug:      { tint: 'rgb(255, 238, 237)', dot: 'rgb(245, 139, 136)', ink: 'rgb(135, 85, 95)' },
} as const
const STATUS_KEY: Record<string, keyof typeof FAMILY> = {
  idea: 'idea', planned: 'planned', in_progress: 'progress', done: 'done', bug: 'bug',
}

const PAGE_BG = 'rgb(245, 244, 241)'      // --page-bg #F5F4F1
const BORDER_SOFT = 'rgb(213, 210, 202)'  // --border-soft #D5D2CA
const PRIMARY = 'rgb(74, 159, 163)'       // --primary #4A9FA3 (light)

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
    db.exec(`DELETE FROM projects WHERE user_id = '${USER_ID}'`)
    db.exec(`DELETE FROM users WHERE email = '${TEST_EMAIL}'`)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${USER_ID}', 'e2e-s185', '${TEST_EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('${PROJ_ID}', '${USER_ID}', '${PROJ_TITLE}', '', 'personal', 'planning', 0, '${now}', '${now}')`,
  )
  for (const t of TASKS) {
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, sort_order, created_at)
       VALUES ('${t.id}', '${PROJ_ID}', 's185 ${t.status} task', '${t.status}', 'medium', ${t.sort}, '${now}')`,
    )
  }
  db.close()
})

async function login(page: Page, theme?: 'claude-dark') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      if (t) localStorage.setItem('hibana-theme', t)
    } catch { /* storage blocked */ }
  }, theme)
  await page.goto('/login.html')
  await page.fill('[name="login"]', TEST_EMAIL)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app')
}

test('light: the warm canvas + bordered cards + the editable Notes field', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  await expect(page.locator('#pd-board')).toBeVisible()

  // Block 2 — the page's own canvas: this page (and only it) wears the warm near-white.
  expect(await page.evaluate(() => document.body.classList.contains('pd-page'))).toBe(true)
  await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BG)

  // Every card wears the light warm gray hairline — the panel cards AND the task cards.
  await expect(page.locator('#pd-board')).toHaveCSS('border-color', BORDER_SOFT)
  await expect(page.locator('#detail-notes')).toHaveCSS('border-color', BORDER_SOFT)
  await expect(page.locator('.pd-task').first()).toHaveCSS('border-color', BORDER_SOFT)

  // Block 5 — the Notes tab's field: the card's own surface + a visible hairline.
  const note = page.locator('#pd-note-textarea')
  await expect(note).toBeVisible()
  await expect(note).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(note).toHaveCSS('border-color', BORDER_SOFT)
  // Focus re-arms the affordance: the teal --primary border + the halo ring.
  // (base.css transitions border-color 0.12s — wait past it before reading.)
  await note.focus()
  await page.waitForTimeout(500)
  const focused = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#pd-note-textarea') as HTMLTextAreaElement)
    return { borderColor: cs.borderTopColor, shadow: cs.boxShadow }
  })
  expect(focused.borderColor).toBe(PRIMARY)
  expect(focused.shadow).not.toBe('none')
})

test('light: the five columns are ONE family (tints, dots, inks through the tokens)', async ({ page }) => {
  await login(page)
  await page.goto(`/project.html?id=${PROJ_ID}`)
  await expect(page.locator('#pd-board')).toBeVisible()

  // Block 1 — the role tokens exist on :root with the table's values.
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const v = (n: string) => cs.getPropertyValue(n).trim()
    return {
      pageBg: v('--page-bg'), surface: v('--surface'), borderSoft: v('--border-soft'),
      textMuted: v('--text-muted'), primary: v('--primary'),
      urgentBg: v('--prio-urgent-bg'), urgentText: v('--prio-urgent-text'),
    }
  })
  expect(tokens.pageBg).toBe('#F5F4F1')
  expect(tokens.surface).toBe('#FFFFFF')
  expect(tokens.borderSoft).toBe('#D5D2CA')
  expect(tokens.textMuted).toBe('#5C5C5C')
  expect(tokens.primary).toBe('#4A9FA3')
  expect(tokens.urgentBg).toBe('#F9DFE6')
  expect(tokens.urgentText).toBe('#A81F42')

  // Block 3 — every column resolves through its --col-* tokens: tint strip, dot, ink.
  for (const status of STATUSES) {
    const key = STATUS_KEY[status]
    const col = page.locator(`.pd-col[data-status="${status}"]`)
    await expect(col.locator('.pd-col-head')).toHaveCSS('background-color', FAMILY[key].tint)
    await expect(col.locator('.pd-col-title')).toHaveCSS('color', FAMILY[key].ink)
    const dot = await col.locator('.pd-col-title').evaluate((el) => getComputedStyle(el, '::before').backgroundColor)
    expect(dot, `${status} dot`).toBe(FAMILY[key].dot)
  }

  // The prio options ride the --prio-* tokens (same values, now named).
  const urgentOption = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.pd-prio-select option.prio-urgent') as HTMLOptionElement)
    return { bg: cs.backgroundColor, color: cs.color }
  })
  expect(urgentOption.bg).toBe('rgb(249, 223, 230)')
  expect(urgentOption.color).toBe('rgb(168, 31, 66)')
})

test('dark: the palette twins resolve onto the clay/near-black identity', async ({ page }) => {
  await login(page, 'claude-dark')
  await page.goto(`/project.html?id=${PROJ_ID}`)
  await expect(page.locator('#pd-board')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('claude-dark')

  // The canvas + field surface + focus primary all flip with the theme. The dark
  // card line keeps its DESIGNED stronger top rung (claude-dark-theme.css .card
  // border-block-start-color --line-strong, a same-specificity later load) — the
  // warm twin owns the other three edges.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 20, 19)')
  await expect(page.locator('#pd-board')).toHaveCSS('border-bottom-color', 'rgb(52, 50, 47)')
  await expect(page.locator('#pd-board')).toHaveCSS('border-top-color', 'rgb(69, 66, 61)')
  await expect(page.locator('#detail-notes')).toHaveCSS('border-bottom-color', 'rgb(52, 50, 47)')
  const note = page.locator('#pd-note-textarea')
  await expect(note).toHaveCSS('background-color', 'rgb(31, 30, 28)')
  await note.focus()
  await page.waitForTimeout(500)
  const focused = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#pd-note-textarea') as HTMLTextAreaElement)
    return { borderColor: cs.borderTopColor, shadow: cs.boxShadow }
  })
  expect(focused.borderColor).toBe('rgb(217, 119, 87)') // --primary's dark twin: the clay accent
  expect(focused.shadow).not.toBe('none')

  // The columns re-point at the dark washes through the SAME rule set.
  await expect(page.locator('.pd-col[data-status="idea"] .pd-col-head')).toHaveCSS('background-color', 'rgba(80, 100, 128, 0.14)')
  const darkDot = await page.locator('.pd-col[data-status="idea"] .pd-col-title').evaluate((el) => getComputedStyle(el, '::before').backgroundColor)
  expect(darkDot).toBe('rgb(123, 154, 184)')
})

test('scoping: no other page moves — the dashboard keeps the neutral canvas', async ({ page }) => {
  await login(page)
  await page.goto('/app')
  await expect(page.locator('.dash-todo-panel, .card').first()).toBeVisible()
  expect(await page.evaluate(() => document.body.classList.contains('pd-page'))).toBe(false)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(231, 231, 231)') // --bg #E7E7E7
  const cardLine = await page.evaluate(() => {
    const card = document.querySelector('.card') as HTMLElement
    return card ? getComputedStyle(card).borderTopColor : 'missing'
  })
  expect(cardLine).toBe('rgb(212, 212, 212)') // --line #D4D4D4 — the neutral hairline
})
