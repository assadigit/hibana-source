// e2e/s181-opening-quartet.spec.ts — S181 (the owner's approved round): the
// dashboard's OPENING QUARTET (my own design in the advisor's register, numbered
// to continue the advisor's dashboard doc — the advisor's 5–16 were the system
// pass; 1–4 are the page's opening, never delivered, now designed and shipped):
//   (1) the page opens with its NAME — the visible h1 (the same opening every
//       page of the app speaks; it was sr-only since S51-A)
//   (2) the FIRST section speaks the ONE grammar — the resume strip's head moves
//       above its card into the shared .dash-sec-head row (the glowing accent dot
//       and the in-card 0.95rem/700 head retire)
//   (3) the nudges speak one quiet register — the vault banner joins the
//       stale-row grammar (tinted glyph tile, no uppercase label, fs-md title,
//       the text-link CTA)
//   (4) the zero page joins the empty register — the cold dashboard renders the
//       quiet muted strip + text action, not an unstyled div
// Plus the owner's promised resume additions: the summary line + progress bar
// ("where did I stop, and how far along was it?"), and the categories belt: the
// create-path duplicate is an honest 409 again (the COALESCE-NULL bugfix).
// Run: npx playwright test e2e/s181-opening-quartet.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-s181@test.local'
const FA_EMAIL = 'e2e-s181-fa@test.local'
const TEST_PASS = 'e2e-password-123'
const DB = '/tmp/hibana-e2e.db'
const SALT = randomBytes(16)

test.beforeAll(async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB)
  const ITERATIONS = 100_000
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(SALT)}$${toB64(Buffer.from(bits))}`
  const now = Date.now()
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  const esc = (s) => s.replace(/'/g, "''")
  try {
    db.exec(`DELETE FROM users WHERE email IN ('${TEST_EMAIL}', '${FA_EMAIL}')`)
    db.exec(`DELETE FROM projects WHERE user_id LIKE 's181-%'`)
    db.exec(`DELETE FROM dev_tasks WHERE project_id LIKE 's181-%'`)
    db.exec(`DELETE FROM categories WHERE user_id LIKE 's181-%'`)
    db.exec(`DELETE FROM vault_notes WHERE user_id LIKE 's181-%'`)
    db.exec(`DELETE FROM quick_notes WHERE user_id LIKE 's181-%'`)
  } catch { /* may not exist yet */ }
  const mkUser = (id: string, email: string, username: string, lang: string) =>
    db.exec(
      `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
       VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${iso(86400000 * 30)}', '${iso(86400000 * 30)}')`,
    )
  // EN user: ONE project with 4 dev_tasks (2 done) — the seed's hero; ZERO vault
  // notes so the quieted banner renders.
  mkUser('s181-user-en', TEST_EMAIL, 'e2e-s181', 'en')
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s181-proj', 's181-user-en', 'S181 orchard app', '', 'personal', 'developing', 0, '${iso(86400000 * 10)}', '${iso(3600000 * 2)}')`,
  )
  const mkTask = (id: string, status: string) =>
    db.exec(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, created_at, updated_at)
       VALUES ('${id}', 's181-proj', 'S181 task', '${status}', 'medium', '${iso(86400000)}', '${iso(86400000)}')`,
    )
  mkTask('s181-dt-1', 'done')
  mkTask('s181-dt-2', 'done')
  mkTask('s181-dt-3', 'in_progress')
  mkTask('s181-dt-4', 'bug')
  // FA user: the same shape for the RTL/Farsi pass.
  mkUser('s181-user-fa', FA_EMAIL, 'e2e-s181-fa', 'fa')
  db.exec(
    `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, created_at, updated_at)
     VALUES ('s181-proj-fa', 's181-user-fa', 'پروژهٔ باغ', '', 'personal', 'developing', 0, '${iso(86400000 * 10)}', '${iso(3600000 * 3)}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, created_at, updated_at)
     VALUES ('s181-dt-fa-1', 's181-proj-fa', 'کار', 'done', 'medium', '${iso(86400000)}', '${iso(86400000)}')`,
  )
  db.exec(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, created_at, updated_at)
     VALUES ('s181-dt-fa-2', 's181-proj-fa', 'کار', 'in_progress', 'medium', '${iso(86400000)}', '${iso(86400000)}')`,
  )
  db.close()
})

async function login(page: Page, email = TEST_EMAIL) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hibana-tour-done', '1')
      localStorage.setItem('hibana-ln-done', '1')
      localStorage.removeItem('hibana-resume')
      sessionStorage.removeItem('hibana-resume-seed-dismissed')
      localStorage.removeItem('hibana-vault-banner-dismissed')
    } catch { /* storage blocked */ }
  })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1400) // the htmx dashboard swap + the resume render + the seed fetch
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

/* ── 1. The page opens with its name ─────────────────────────────────────────── */

test('S181-1: the dashboard opens with a VISIBLE h1 (the same opening every page speaks)', async ({ page }) => {
  await login(page)
  const h1 = page.locator('main.shell-dash > h1')
  await expect(h1).toBeVisible({ timeout: 10_000 })
  await expect(h1).toHaveText('Dashboard')
  // It stays the first child of <main> (a11y: the heading leads the landmark).
  const idx = await h1.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
  expect(idx).toBe(0)
  // The house h1 register (not a section title): 24px desktop.
  await expect(h1).toHaveCSS('font-size', '24px')
})

/* ── 2. The first section speaks the one grammar ─────────────────────────────── */

test('S181-2 → S183: the resume head rides INSIDE its card (header strip + hairline); the title speaks the S157 ladder', async ({ page }) => {
  await login(page)
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  const card = strip.locator('.resume-strip.card')
  const head = strip.locator('.dash-sec-head.resume-dash-head')
  await expect(card).toHaveCount(1)
  await expect(head).toHaveCount(1)
  // S183 (the depth audit — L2 realized): the head is the CARD's first child —
  // the header-strip grammar every dashboard section now speaks (the S181
  // above-card placement retired with the S179 pattern it copied).
  const headIdx = await head.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
  expect(headIdx).toBe(0)
  const headInCard = await head.evaluate((el) => el.parentElement!.classList.contains('resume-strip'))
  expect(headInCard).toBe(true)
  // …with the hairline divider under it.
  const hairline = await head.evaluate((el) => getComputedStyle(el).borderBlockEndWidth)
  expect(parseFloat(hairline)).toBeGreaterThan(0)
  // The title rides the shared register: 18px / the S157 ladder's 500 (the S183
  // re-alignment — "use lesser weight for headings").
  const title = strip.locator('#resume-title.dash-sec-title')
  await expect(title).toHaveText('Continue where you left off')
  await expect(title).toHaveCSS('font-size', '18px')
  await expect(title).toHaveCSS('font-weight', '500')
  // The old glowing dot is GONE (no ::before on the title).
  const pseudo = await title.evaluate((el) => getComputedStyle(el, '::before').content)
  expect(pseudo).toBe('none')
  // The secondary actions (the hint + Clear recents) ride the head's inline-end.
  const actions = head.locator('.dash-sec-actions')
  await expect(actions).toContainText('Last edited')
  await expect(actions.locator('[data-resume-clear]')).toContainText('Clear recents')
})

/* ── 3. The progress bar is RETIRED (S183 — the owner: "remove this progress
   bar") — the hero still renders, nothing measures it ──────────────────────── */

test('S183-3: the hero project renders with NO progress line/meter (the bar retired, seed progress unconsumed)', async ({ page }) => {
  await login(page)
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  // The seed's hero = the project (newest) — still the hero, bar or no bar.
  await expect(strip.locator('.resume-hero-title')).toHaveText('S181 orchard app')
  // The S183 retirement: no line, no track, no fill — even though the seed's
  // progress map (2 of 4) still ships from the API.
  await expect(strip.locator('.resume-progress')).toHaveCount(0)
  await expect(strip.locator('.resume-progress-line')).toHaveCount(0)
  await expect(strip.locator('.resume-progress-track')).toHaveCount(0)
  await expect(strip.locator('[data-resume-progress]')).toHaveCount(0)
  await expect(strip.locator('[role="progressbar"]')).toHaveCount(0)
})

test('S181-3b: a NOTE hero renders (no bar to retire); the store wins over the seed', async ({ page }) => {
  await login(page)
  // Seed mode rendered first (the project hero). Now a REAL store entry lands —
  // recorded the way a mutation records it — and the strip's idempotent re-render
  // (the same path a language settle rides) must let the store WIN: the note
  // becomes the hero.
  await page.evaluate(() => {
    localStorage.setItem('hibana-resume', JSON.stringify([
      { k: 'note', id: 'vn-x', t: 'A store note hero', ts: Date.now() - 600_000 },
    ]))
    document.dispatchEvent(new Event('hibana:i18n'))
  })
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible()
  await expect(strip.locator('.resume-hero-title')).toHaveText('A store note hero')
  await expect(strip.locator('.resume-progress')).toHaveCount(0)
})

/* ── 4. The nudges speak one quiet register (the vault banner) ────────────────── */

test('S181-4: the vault banner speaks the quiet nudge register (tinted glyph, small flag, text-link CTA)', async ({ page }) => {
  await login(page)
  const banner = page.locator('[data-vault-banner]')
  await expect(banner).toBeVisible({ timeout: 10_000 })
  const probe = await banner.evaluate((el) => {
    const glyph = el.querySelector('.dash-vault-glyph')!
    const label = el.querySelector('.dash-vault-label')!
    const title = el.querySelector('.dash-vault-title')!
    const cta = el.querySelector('.dash-vault-cta')!
    return {
      glyphBg: getComputedStyle(glyph).backgroundColor,
      glyphImg: getComputedStyle(glyph).backgroundImage,
      labelTransform: getComputedStyle(label).textTransform,
      labelColor: getComputedStyle(label).color,
      titleSize: getComputedStyle(title).fontSize,
      titleWeight: getComputedStyle(title).fontWeight,
      ctaTag: cta.tagName,
      ctaClasses: cta.className,
    }
  })
  // The glyph is a TINTED tile (a translucent accent over the banner tint), not
  // the solid CTA badge (which painted a flat opaque teal + a gradient-free fill).
  expect(probe.glyphImg).toBe('none')
  expect(probe.glyphBg).not.toBe('rgb(74, 159, 163)') // not the solid brand fill
  // The flag lost its uppercase shout; the title stepped down to fs-md/600.
  expect(probe.labelTransform).toBe('none')
  expect(probe.titleSize).toBe('14px') // --fs-md (0.875rem) — the row-title register
  expect(probe.titleWeight).toBe('600')
  // The CTA is a text link (a.small), not a .btn.
  expect(probe.ctaTag).toBe('A')
  expect(probe.ctaClasses).not.toContain('btn')
  // The banner keeps the nudge-card grammar: the 4px accent lead bar.
  const lead = await banner.evaluate((el) => getComputedStyle(el).borderLeftWidth)
  expect(lead).toBe('4px')
})

/* ── 5. The categories belt: the create-path duplicate is an honest 409 ──────── */

test('S181-5: creating a near-duplicate category name answers 409 (the COALESCE-NULL bugfix)', async ({ page }) => {
  await login(page)
  const first = await api(page, '/api/categories', 'POST', { name: 's181 lib', color_fill: '#CCD5F0', color_text: '#273768' })
  expect(first.status).toBe(201)
  // Pre-S181 this 500'd (the unique index) — the route's 409 was unreachable.
  const dup = await api(page, '/api/categories', 'POST', { name: '  S181 LIB ', color_fill: '#CCD5F0', color_text: '#273768' })
  expect(dup.status).toBe(409)
  expect((dup.json as { error?: string }).error).toBe('duplicate')
})

/* ── 6. The zero page joins the empty register ────────────────────────────────── */

test('S181-6: every section hidden → the quiet empty strip + the settings text action', async ({ page }) => {
  await login(page)
  const res = await api(page, '/api/settings', 'PATCH', { dash_show_header: 0, dash_show_projects: 0, dash_show_todo: 0, dash_show_notebook: 0, dash_show_activity: 0 })
  expect(res.status).toBe(200)
  await page.goto('/app')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1400)
  const empty = page.locator('.dash-empty')
  await expect(empty).toBeVisible({ timeout: 10_000 })
  await expect(empty.locator('.dash-empty-text')).toContainText('Nothing on your dashboard')
  const action = empty.locator('.dash-empty-action')
  await expect(action).toHaveText(/Open settings/)
  // The quiet register: muted ink, the text-action register (brand ink).
  const probe = await empty.evaluate((el) => {
    const text = el.querySelector('.dash-empty-text')!
    const act = el.querySelector('.dash-empty-action')!
    return { muted: getComputedStyle(text).color, action: getComputedStyle(act).color, actionBg: getComputedStyle(act).backgroundColor }
  })
  expect(probe.action).toBe('rgb(74, 159, 163)') // the brand ink
  expect(probe.actionBg).toBe('rgba(0, 0, 0, 0)') // transparent — a text action
})

/* ── 7. FA/RTL: the page name + the FA hero (the progress line retired) ───────── */

test('S181-7: FA — «پیشخوان» opens the page; the FA hero renders; no progress artifacts', async ({ page }) => {
  await login(page, FA_EMAIL)
  const h1 = page.locator('main.shell-dash > h1')
  await expect(h1).toBeVisible({ timeout: 10_000 })
  await expect(h1).toHaveText('پیشخوان')
  const strip = page.locator('#resume-strip')
  await expect(strip).toBeVisible()
  await expect(strip.locator('.resume-hero-title')).toHaveText('پروژهٔ باغ')
  // S183: the retired bar leaves no artifacts in FA either (no line, no meter).
  await expect(strip.locator('.resume-progress')).toHaveCount(0)
  await expect(strip.locator('.resume-progress-line')).toHaveCount(0)
  await expect(strip.locator('[role="progressbar"]')).toHaveCount(0)
})
