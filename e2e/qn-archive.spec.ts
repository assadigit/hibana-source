// e2e/qn-archive.spec.ts — S65: the quick-note ARCHIVE, every note ever captured.
//
// The dashboard widget caps at 20 cards; anything older was stored but rendered NOWHERE
// (the S64 jump-to-note could only toast "older than the recent list"). The widget now
// carries a "Show all N notes" affordance (server-rendered only when total > shown) that
// opens a full-screen dialog: light rows (color dot, kind icon, excerpt, day stamp) each
// hiding a full markdown render the note-reader opens on demand (read-only — the Edit
// path edits live widget cards, which archive rows are not). Pagination (Load more /
// Newer notes), a client-side filter, and an FA/RTL pass with Persian digits.
// Run: npx playwright test e2e/qn-archive.spec.ts

import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const TEST_EMAIL = 'e2e-qn-archive@test.local'
const FA_EMAIL = 'e2e-qn-archive-fa@test.local'
const TEST_PASS = 'e2e-password-123'

// One shared seeding routine: idempotent user upsert against the local e2e DB.
async function seedUser(email: string, username: string, lang: 'en' | 'fa') {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const ITERATIONS = 100_000
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(TEST_PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try {
    db.exec(`DELETE FROM users WHERE email = '${email}'`) // cascades notes away (rule 1)
  } catch { /* may not exist yet */ }
  db.exec(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES ('${id}', '${username}', '${email}', '${hash.replace(/'/g, "''")}', 'owner', '${lang}', 'gregorian', 'UTC', '${now}', '${now}')`,
  )
  db.close()
}

// S66: backdate a quick note's updated_at directly (the API always stamps "now") — the
// date-group headers and the jump-to-date window key off this timestamp.
async function backdateNote(id: string, iso: string) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  db.prepare('UPDATE quick_notes SET updated_at = ? WHERE id = ?').run(iso, id)
  db.close()
}

test.beforeAll(async () => {
  await seedUser(TEST_EMAIL, 'e2e-qn-archive', 'en')
  await seedUser(FA_EMAIL, 'e2e-qn-archive-fa', 'fa')
})

async function login(page: Page, email: string) {
  await page.addInitScript(() => { try { localStorage.setItem('hibana-tour-done', '1') } catch { /* storage blocked */ } })
  await page.goto('/login.html')
  await page.fill('[name="login"]', email)
  await page.fill('[name="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8_000 }).catch(() => {})
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(400)
}

async function mkQuickNote(page: Page, content: string, kind: 'note' | 'list' = 'note', title = ''): Promise<string> {
  return await page.evaluate(async ({ content, kind, title }) => {
    const r = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, title, content }),
    })
    if (!r.ok) throw new Error('quick note create failed: ' + r.status)
    return ((await r.json()) as { ok: boolean; id: string }).id
  }, { content, kind, title })
}

test.describe('S65: the quick-note archive dialog', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL)
  })

  test('"Show all N notes" appears only beyond the 20-card cap; opens the archive; the reader opens read-only', async ({ page }) => {
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'hoard: the one searchable old-timer in the drawer'))
    for (let i = 0; i < 20; i++) ids.push(await mkQuickNote(page, `filler note number ${i} — window padding`))
    try {
      await page.goto('/app') // fresh dashboard render — the widget carries the new total
      // The affordance tells the truth about scale (21 stored, 20 rendered).
      const btn = page.locator('[data-note-archive]')
      await expect(btn).toBeVisible({ timeout: 10_000 })
      await expect(btn).toContainText('Show all 21 notes')
      // The oldest note is NOT among the 20 rendered cards…
      await expect(page.locator(`#note-${ids[0]}`)).toHaveCount(0)

      await btn.click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.qa-count')).toHaveText('21', { timeout: 8_000 })
      await expect(dlg.locator('.qa-row')).toHaveCount(21) // first page carries all 21 (limit 60)
      // …but the archive holds it (rows are newest-first: the old-timer ranks last).
      const row = dlg.locator(`#an-${ids[0]}`)
      await expect(row).toBeVisible()
      await expect(row).toContainText('hoard: the one searchable old-timer')

      // Row activation → the note-reader modal with the FULL body, Edit hidden (S65).
      await row.click()
      const reader = page.locator('#note-reader')
      await expect(reader).toBeVisible()
      await expect(reader.locator('.note-reader-body')).toContainText('hoard: the one searchable old-timer')
      await expect(reader.locator('[data-note-reader-edit]')).toBeHidden()
      await reader.locator('[data-note-reader-close]').last().click()
      await expect(reader).toBeHidden()

      // Client-side filter: 'hoard' narrows to the one row, count says 1 / 21.
      await dlg.locator('.qa-filter').fill('hoard')
      await expect(dlg.locator('.qa-row.qa-hidden')).toHaveCount(20)
      await expect(dlg.locator('.qa-count')).toHaveText('1 / 21')
      await dlg.locator('.qa-filter').fill('')
      await expect(dlg.locator('.qa-row.qa-hidden')).toHaveCount(0)
      await expect(dlg.locator('.qa-count')).toHaveText('21')

      // A widget open AFTER an archive open restores the reader's Edit path (no state leak).
      // (Direct call — the click path opens the reader only for clamped renders.)
      await page.evaluate(() => {
        const card = document.querySelector('.note-card[data-kind="note"]')
        const render = card?.querySelector('.note-render')
        if (card && render) (window as unknown as { __hib: { openNoteReader: (c: Element, r: Element) => void } }).__hib.openNoteReader(card, render)
      })
      await expect(reader).toBeVisible()
      await expect(reader.locator('[data-note-reader-edit]')).toBeVisible()
      await reader.locator('[data-note-reader-close]').last().click()
      await page.keyboard.press('Escape') // close the archive
      await expect(dlg).toBeHidden()
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })

  test('pagination: Load more reveals the 61st; an anchored open shows "Newer notes" which completes the window', async ({ page }) => {
    test.setTimeout(120_000)
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'the very oldest note in the whole archive')) // rank 61
    for (let i = 0; i < 60; i++) ids.push(await mkQuickNote(page, `bulk note number ${i} — pagination padding`))
    try {
      await page.goto('/app') // fresh dashboard render — the widget carries the new total
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.qa-row')).toHaveCount(60, { timeout: 15_000 })
      await expect(dlg.locator('#an-' + ids[0])).toHaveCount(0) // the 61st waits behind the pager

      // Downward: Load more appends the final row. The window now starts at the very
      // newest (lo = 0) — so the "Newer notes" pager correctly does NOT exist.
      const more = dlg.locator('.qa-more')
      await expect(more).toBeVisible()
      await more.click()
      await expect(dlg.locator('.qa-row')).toHaveCount(61, { timeout: 15_000 })
      await expect(dlg.locator(`#an-${ids[0]}`)).toBeVisible()
      await expect(dlg.locator('.qa-more')).toBeHidden()
      await expect(dlg.locator('.qa-newer')).toHaveCount(0)
      await expect(dlg.locator('.qa-count')).toHaveText('61')

      // Anchored open on the OLDEST (position 61, limit 60 → page starts at offset 31):
      // the window begins mid-list → "Newer notes" exists, and completing it loads the top.
      await page.keyboard.press('Escape')
      await expect(dlg).toBeHidden()
      await page.evaluate(async (id) => { await (window as unknown as { hibanaArchive: { openAt: (i: string, q?: string) => Promise<void> } }).hibanaArchive.openAt(id, '') }, ids[0])
      await expect(dlg).toBeVisible()
      const last = dlg.locator(`#an-${ids[0]}`)
      await expect(last).toBeVisible()
      await expect(last).toHaveClass(/note-jump/) // the anchored row flashes
      await expect(dlg.locator('.qa-row')).toHaveCount(30, { timeout: 15_000 }) // window 31..61
      await expect(dlg.locator('.qa-newer')).toBeVisible()
      await expect(dlg.locator('.qa-more')).toBeHidden() // nothing older below
      await dlg.locator('.qa-newer').click()
      await expect(dlg.locator('.qa-row')).toHaveCount(61, { timeout: 15_000 })
      await expect(dlg.locator('.qa-newer')).toBeHidden()
      await expect(dlg.locator('.qa-count')).toHaveText('61')
      await expect(dlg.locator(`#an-${ids[60]}`)).toBeVisible() // the newest completes the window
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })

  test('list notes render their kind; the done state strikes the excerpt', async ({ page }) => {
    const noteId = await mkQuickNote(page, '# Marked heading\n\nreader body text')
    const listId = await mkQuickNote(page, 'wash the dishes', 'list', 'Chores')
    for (let i = 0; i < 20; i++) await mkQuickNote(page, `filler note number ${i} — window padding`) // the affordance needs total > 20
    try {
      await page.goto('/app') // fresh dashboard render — the widget carries the new total
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      // List excerpt uses the TITLE, not the JSON items blob.
      const listRow = dlg.locator(`#an-${listId}`)
      await expect(listRow).toBeVisible()
      await expect(listRow).toContainText('Chores')
      await expect(listRow).not.toContainText('{"id"')

      // The note's hidden render carries real markdown (opened in the reader).
      await dlg.locator(`#an-${noteId}`).click()
      const reader = page.locator('#note-reader')
      await expect(reader).toBeVisible()
      await expect(reader.locator('.note-reader-body h1')).toHaveText('Marked heading')
    } finally {
      const all = await page.evaluate(async () => {
        const notes = await (await fetch('/api/notes')).json() as { notes: { id: string }[] }
        for (const n of notes.notes) await fetch(`/api/notes/${n.id}`, { method: 'DELETE' })
        return notes.notes.length
      })
      expect(all).toBeGreaterThan(0)
    }
  })
})

test.describe('S65: the archive in FA/RTL', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, FA_EMAIL)
  })

  test('FA wording, Persian digit count, RTL layout, filter placeholder', async ({ page }) => {
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'یادداشت کهن: سوزن در انبار'))
    for (let i = 0; i < 20; i++) ids.push(await mkQuickNote(page, `یادداشت پرکن شماره ${i}`))
    try {
      await page.goto('/app') // fresh dashboard render — the widget carries the new total
      const btn = page.locator('[data-note-archive]')
      await expect(btn).toBeVisible({ timeout: 10_000 })
      await expect(btn).toContainText('نمایش همهٔ ۲۱ یادداشت')

      await btn.click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.qa-title')).toHaveText('همهٔ یادداشت‌ها')
      await expect(dlg.locator('.qa-count')).toHaveText('۲۱', { timeout: 8_000 })
      await expect(dlg.locator('.qa-filter')).toHaveAttribute('placeholder', 'جست‌وجو…')
      await expect(dlg.locator(`#an-${ids[0]}`)).toContainText('سوزن')

      // RTL: the document is Persian; the dialog inherits direction.
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      // Filter works with Persian text: 'سوزن' narrows to the one row.
      await dlg.locator('.qa-filter').fill('سوزن')
      await expect(dlg.locator('.qa-count')).toHaveText('۱ / ۲۱')
      await expect(dlg.locator('.qa-row.qa-hidden')).toHaveCount(20)
      // Persian digit normalization: a query with Persian digits (۷) matches the LATIN
      // digits in the content (شماره 7) — both sides normalize before comparing.
      await dlg.locator('.qa-filter').fill('شماره ۷')
      await expect(dlg.locator('.qa-count')).toHaveText('۱ / ۲۱', { timeout: 5_000 })
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })

  test('S66 FA: group labels in Persian, reading time with Persian digits, jump aria-label', async ({ page }) => {
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'یادداشت کهن: هدف پرش به تاریخ'))
    const longBody = Array.from({ length: 500 }, (_, i) => `واژه${i}`).join(' ')
    ids.push(await mkQuickNote(page, longBody))
    for (let i = 0; i < 20; i++) ids.push(await mkQuickNote(page, `یادداشت پرکن شماره ${i} — گروه‌بندی`))
    await backdateNote(ids[0], new Date(Date.now() - 40 * 86400_000).toISOString())
    try {
      await page.goto('/app')
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.qa-row')).toHaveCount(22, { timeout: 10_000 })

      // The group labels are Persian: امروز over the fresh rows, قدیمی‌تر over the old.
      const groups = dlg.locator('.qa-group')
      await expect(groups).toHaveCount(2)
      await expect(groups.nth(0)).toHaveText('امروز')
      await expect(groups.nth(1)).toHaveText('قدیمی‌تر')

      // The jump control is labelled in Persian.
      await expect(dlg.locator('[data-qa-jump]')).toHaveAttribute('aria-label', 'پرش به تاریخ')
      await expect(dlg.locator('.qa-date')).toHaveAttribute('aria-label', 'پرش به تاریخ')
      // S67: the clear-jump affordance localizes too (hidden until a jump — attribute
      // assertions work on hidden elements; the button ships with the dialog's DOM).
      await expect(dlg.locator('[data-qa-clearjump]')).toHaveAttribute('aria-label', 'بازگشت به جدیدترین یادداشت‌ها')

      // Reading time localizes: 500 words → حدود ۳ دقیقه مطالعه (Persian digits).
      await dlg.locator(`#an-${ids[1]}`).click()
      const reader = page.locator('#note-reader')
      await expect(reader).toBeVisible()
      await expect(reader.locator('.note-reader-meta')).toBeVisible()
      await expect(reader.locator('.note-reader-meta')).toHaveText('حدود ۳ دقیقه مطالعه')
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })
})

// S66 feature batch: date-group headers (Today/Yesterday/This week/This month/Earlier —
// sticky, recomputed after every render, hidden while filtering), the reading-time
// estimate in the note-reader (~200 wpm, ≥200 words only), jump-to-date (a native date
// input revealed by the calendar button; the page re-anchors on the newest note of that
// local day, with an honest fallback toast when nothing is that old), and the filter's
// no-match dead end.
test.describe('S66: date-group headers + reading time + jump-to-date', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL)
  })

  test('group headers bucket rows (Today + Earlier via backdating) and hide while filtering', async ({ page }) => {
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'ancient: the forty-day-old note in the drawer'))
    for (let i = 0; i < 20; i++) ids.push(await mkQuickNote(page, `fresh note number ${i} — today padding`))
    await backdateNote(ids[0], new Date(Date.now() - 40 * 86400_000).toISOString())
    try {
      await page.goto('/app')
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.qa-row')).toHaveCount(21, { timeout: 10_000 })

      // Exactly two groups: Today over the 20 fresh rows, Earlier over the backdated one.
      const groups = dlg.locator('.qa-group')
      await expect(groups).toHaveCount(2)
      await expect(groups.nth(0)).toHaveText('Today')
      await expect(groups.nth(1)).toHaveText('Earlier')
      // The header rides ABOVE its bucket: body children run [Today, 20 rows, Earlier,
      // old row] — "Earlier" is child #22, immediately before the old row (child #23).
      await expect(dlg.locator('.qa-body > :nth-child(22)')).toHaveText('Earlier')
      await expect(dlg.locator(`#an-${ids[0]}`)).toBeVisible()

      // Sticky: scrolled mid-list, the Today header stays glued to the top of the body.
      await dlg.locator(`#an-${ids[15]}`).scrollIntoViewIfNeeded()
      const g = await groups.nth(0).boundingBox()
      const b = await dlg.locator('.qa-body').boundingBox()
      if (g && b) expect(Math.abs(g.y - b.y)).toBeLessThan(8) // still at the top edge

      // Filtering hides the groups (a header over zero visible rows would lie) and the
      // no-match notice shows for a query that hits nothing.
      await dlg.locator('.qa-filter').fill('zzz-no-such-needle')
      await expect(groups.nth(0)).toBeHidden()
      await expect(groups.nth(1)).toBeHidden()
      await expect(dlg.locator('.qa-nomatch')).toBeVisible()
      await expect(dlg.locator('.qa-nomatch')).toHaveText('No notes match the filter.')
      await expect(dlg.locator('.qa-count')).toHaveText('0 / 21')
      // Clearing the filter brings the groups back.
      await dlg.locator('.qa-filter').fill('')
      await expect(groups).toHaveCount(2)
      await expect(dlg.locator('.qa-nomatch')).toBeHidden()
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })

  test('the reader shows "~3 min read" for a 500-word note; nothing for a short one', async ({ page }) => {
    const longBody = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    const longId = await mkQuickNote(page, longBody)
    const shortId = await mkQuickNote(page, 'a short note — an instant read')
    for (let i = 0; i < 20; i++) await mkQuickNote(page, `filler note number ${i} — window padding`)
    try {
      await page.goto('/app')
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()

      // The long note: 500 words ÷ 200 wpm → ~3 min (rounds 2.5 up).
      await dlg.locator(`#an-${longId}`).click()
      const reader = page.locator('#note-reader')
      await expect(reader).toBeVisible()
      await expect(reader.locator('.note-reader-meta')).toBeVisible()
      await expect(reader.locator('.note-reader-meta')).toHaveText('~3 min read')
      await reader.locator('[data-note-reader-close]').last().click()

      // The short note: no estimate (an instant read needs no number).
      await dlg.locator(`#an-${shortId}`).click()
      await expect(reader).toBeVisible()
      await expect(reader.locator('.note-reader-meta')).toBeHidden()
    } finally {
      await page.evaluate(async () => {
        const notes = await (await fetch('/api/notes')).json() as { notes: { id: string }[] }
        for (const n of notes.notes) await fetch(`/api/notes/${n.id}`, { method: 'DELETE' })
      })
    }
  })

  test('jump-to-date re-anchors the window on the newest note of that day; too-old toasts the fallback', async ({ page }) => {
    test.setTimeout(120_000)
    const ids: string[] = []
    ids.push(await mkQuickNote(page, 'the forty-day-old jump target note'))
    for (let i = 0; i < 60; i++) ids.push(await mkQuickNote(page, `bulk note number ${i} — jump padding`))
    await backdateNote(ids[0], new Date(Date.now() - 40 * 86400_000).toISOString())
    try {
      await page.goto('/app')
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('.qa-row')).toHaveCount(60, { timeout: 15_000 })
      // The old note sits behind the first page (position 61 of 61).
      await expect(dlg.locator(`#an-${ids[0]}`)).toHaveCount(0)

      // Reveal the date input via the calendar button; pick the 35-days-ago date.
      // (fill() alone commits the value + fires change — a follow-up Enter would
      // re-commit the PICKER's selected date (today) and hijack the jump — native
      // input[type=date] behavior, not ours.)
      await dlg.locator('[data-qa-jump]').click()
      const dateInput = dlg.locator('.qa-date')
      await expect(dateInput).toBeVisible()
      const target = new Date(Date.now() - 35 * 86400_000)
      const ymd = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
      await dateInput.fill(ymd)
      // The window re-anchors: the old note is visible + marked (flash may have settled;
      // the server-set qa-anchored class persists for the life of the fragment).
      await expect(dlg.locator(`#an-${ids[0]}`)).toBeVisible({ timeout: 10_000 })
      await expect(dlg.locator(`#an-${ids[0]}`)).toHaveClass(/qa-anchored/)
      // The window started mid-list → the "Newer notes" pager exists.
      await expect(dlg.locator('.qa-newer')).toBeVisible()
      await expect(dlg.locator('.qa-count')).toHaveText('61')

      // A date older than every note: the fallback lands on the oldest + says so.
      await dateInput.fill('2000-01-01')
      await expect(page.locator('#toast .toast-msg').filter({ hasText: 'No notes that far back' })).toBeVisible({ timeout: 8_000 })
      await expect(dlg.locator(`#an-${ids[0]}`)).toBeVisible() // the oldest IS the backdated note

      // S67 clear-jump: the ↩ affordance is live after a jump (the input carries the
      // jump state) and returns the list to the newest window — input hidden + empty,
      // affordance gone, no Newer pager, the old note behind the first page again.
      await expect(dlg.locator('[data-qa-clearjump]')).toBeVisible()
      await expect(dateInput).toHaveAttribute('data-jump', '1')
      await dlg.locator('[data-qa-clearjump]').click()
      await expect(dlg.locator('[data-qa-clearjump]')).toBeHidden()
      await expect(dateInput).toBeHidden()
      await expect(dateInput).toHaveValue('')
      await expect(dateInput).not.toHaveAttribute('data-jump')
      await expect(dlg.locator('.qa-newer')).toBeHidden()
      await expect(dlg.locator(`#an-${ids[0]}`)).toHaveCount(0)
      await expect(dlg.locator('.qa-row')).toHaveCount(60, { timeout: 15_000 })
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })
})

// S65 feature batch: Copy as Markdown in the reader (clipboard-permissioned) + arrow-key
// row navigation + filter autofocus on open.
test.describe('S65: archive reader Copy as Markdown + keyboard nav', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL)
  })

  test('Copy as Markdown puts the note body (and the list checklist) on the clipboard; toast confirms', async ({ page }) => {
    const noteBody = 'clipboard needle: copy me out of the safe verbatim'
    const noteId = await mkQuickNote(page, noteBody)
    const listId = await mkQuickNote(page, 'first chore\nsecond chore', 'list', 'Chores')
    for (let i = 0; i < 20; i++) await mkQuickNote(page, `filler note number ${i} — window padding`)
    try {
      await page.goto('/app')
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()

      // A NOTE copies its raw markdown verbatim.
      await dlg.locator(`#an-${noteId}`).click()
      const reader = page.locator('#note-reader')
      await expect(reader).toBeVisible()
      await reader.locator('[data-note-reader-copy]').click()
      await expect(page.locator('#toast .toast-msg')).toContainText('Copied as Markdown')
      const clipNote = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipNote).toBe(noteBody)

      // A LIST copies title + checkbox lines (paste-ready anywhere).
      await reader.locator('[data-note-reader-close]').last().click()
      await dlg.locator(`#an-${listId}`).click()
      await expect(reader).toBeVisible()
      await reader.locator('[data-note-reader-copy]').click()
      await page.waitForTimeout(200)
      const clipList = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipList).toBe('# Chores\n- [ ] first chore\n- [ ] second chore')
    } finally {
      await page.evaluate(async () => {
        const notes = await (await fetch('/api/notes')).json() as { notes: { id: string }[] }
        for (const n of notes.notes) await fetch(`/api/notes/${n.id}`, { method: 'DELETE' })
      })
    }
  })

  test('the filter takes focus on open; ArrowDown/Up/Home/End walk the visible rows', async ({ page }) => {
    const ids: string[] = []
    for (let i = 0; i < 21; i++) ids.push(await mkQuickNote(page, `nav note number ${i}`))
    try {
      await page.goto('/app')
      await page.locator('[data-note-archive]').click()
      const dlg = page.locator('#quicknote-archive')
      await expect(dlg).toBeVisible()
      // Autofocus: the keyboard lands in the filter — the dialog's scanning control.
      await expect(dlg.locator('.qa-filter')).toBeFocused()

      // ArrowDown from the filter enters the list at the first row; further presses walk.
      await page.keyboard.press('ArrowDown')
      await expect(dlg.locator('.qa-row').nth(0)).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await expect(dlg.locator('.qa-row').nth(2)).toBeFocused()
      await page.keyboard.press('ArrowUp')
      await expect(dlg.locator('.qa-row').nth(1)).toBeFocused()
      await page.keyboard.press('End')
      await expect(dlg.locator('.qa-row').nth(20)).toBeFocused()
      await page.keyboard.press('Home')
      await expect(dlg.locator('.qa-row').nth(0)).toBeFocused()

      // Enter on the focused row opens the reader (the roving focus is functional).
      await page.keyboard.press('Enter')
      await expect(page.locator('#note-reader')).toBeVisible()
    } finally {
      for (const nid of ids) await page.evaluate(async (id) => { await fetch(`/api/notes/${id}`, { method: 'DELETE' }) }, nid)
    }
  })
})
