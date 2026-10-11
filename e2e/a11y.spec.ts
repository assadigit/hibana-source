// e2e/a11y.spec.ts — accessibility regression test (S199: the gate is REAL now).
//
// Runs the existing audit-fn.js (viewport overflow, small touch targets, clipped
// text, missing alt, dir mismatches) + contrast-fn.js (WCAG luminance) against the
// live pages via Playwright — and now ASSERTS the results against pinned baselines
// (S198 UX-2: the old spec eval'd the fixtures, discarded their JSON, and asserted
// nothing — a vacuous green).
//
// BASELINE DISCIPLINE: counts may only go DOWN. If a fix lowers a count, re-pin the
// constant to the new floor in the same PR. If a count would go UP, the test fails —
// that is the point. The baselines were measured on 2026-10-11 (S199, v0.4.1.24):
//   - login smallTouch 2: theme-floater 28×28 + pw-toggle 30×30 — VISUAL boxes of
//     the RINGED controls (the S197 tap-law: their ::after hit rings make them
//     42/44.4px EFFECTIVE; audit-fn measures visual boxes only).
//   - login contrast 2: the brand wordmark ("H" + "Hibana") on the tinted hero —
//     decorative brand mark, tracked as the UX-3 class.
//   - dashboard overflow 6 / touch 49: the known compact-control + wide-row set
//     (effective-hit rings cover the touch floor; see the S197 audit).
//   - dashboard contrast 4: the wordmark pair + the "New" chip + breadcrumb label
//     (accent-as-text, the UX-3 finding — fixed only by the --accent-ink round).

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const auditFn = readFileSync(join(ROOT, 'e2e', 'fixtures', 'audit-fn.js'), 'utf8')
const contrastFn = readFileSync(join(ROOT, 'e2e', 'fixtures', 'contrast-fn.js'), 'utf8')

// ---- pinned baselines (re-pin DOWN only) ------------------------------------------
const BASELINE = {
  login: { overflow: 0, touch: 2, clipped: 0, contrast: 2 },
  dashboard: { overflow: 6, touch: 49, clipped: 0, contrast: 4 },
} as const

type AuditOut = {
  pageHScroll: boolean
  viewportOverflowCount: number
  viewportOverflows: string[]
  smallTouchCount: number
  smallTouchTargets: string[]
  clippedCount: number
  clippedText: string[]
  imgNoAlt: string[]
  dirMismatch: boolean
}
type ContrastOut = { url: string; lang: string; theme: string; offenders: { txt: string; color: string; size: string; ratio: number; need: number }[] }

// NOTE (the S193/S199 lesson): pass REAL functions to page.evaluate — string
// bodies return undefined. The fixtures are IIFEs returning JSON strings.
async function runAudits(page: { evaluate: (fn: (s: string) => string, s: string) => Promise<string> }) {
  const audit: AuditOut = JSON.parse(await page.evaluate((s) => eval(s), auditFn))
  const contrast: ContrastOut = JSON.parse(await page.evaluate((s) => eval(s), contrastFn))
  return { audit, contrast }
}

function assertPage(label: keyof typeof BASELINE, audit: AuditOut, contrast: ContrastOut) {
  const b = BASELINE[label]
  // hard invariants — these are never allowed at ANY count
  expect(audit.pageHScroll, `${label}: page must not scroll horizontally`).toBe(false)
  expect(audit.imgNoAlt, `${label}: every img needs alt`).toEqual([])
  expect(audit.dirMismatch, `${label}: lang=fa must pair with dir=rtl`).toBe(false)
  // ratcheted counts — <= baseline only
  expect(audit.viewportOverflowCount, `${label}: viewport overflows grew past baseline ${b.overflow}\n  ${audit.viewportOverflows.join('\n  ')}`).toBeLessThanOrEqual(b.overflow)
  expect(audit.smallTouchCount, `${label}: sub-40px visual boxes grew past baseline ${b.touch} (the ringed family is exempt-by-doctrine — new UNRINGED small controls belong in esc… no, in a floor fix, not a baseline bump)\n  ${audit.smallTouchTargets.join('\n  ')}`).toBeLessThanOrEqual(b.touch)
  expect(audit.clippedCount, `${label}: clipped text grew past baseline ${b.clipped}\n  ${audit.clippedText.join('\n  ')}`).toBeLessThanOrEqual(b.clipped)
  expect(contrast.offenders.length, `${label}: contrast offenders grew past baseline ${b.contrast} (the UX-3 accent-as-text class — shrink with --accent-ink, never bump)\n  ${contrast.offenders.map((o) => `${o.txt} ${o.color} ${o.size} ${o.ratio}:1 (need ${o.need})`).join('\n  ')}`).toBeLessThanOrEqual(b.contrast)
}

test('login page a11y audit (baseline-asserted)', async ({ page }) => {
  await page.goto('/login.html')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  const { audit, contrast } = await runAudits(page)
  // COLLECT (UX-2): the report always prints the current state — the evidence trail
  console.log(`login a11y: overflow ${audit.viewportOverflowCount}/${BASELINE.login.overflow} · touch ${audit.smallTouchCount}/${BASELINE.login.touch} · clipped ${audit.clippedCount}/${BASELINE.login.clipped} · contrast ${contrast.offenders.length}/${BASELINE.login.contrast}`)
  if (contrast.offenders.length) console.log('login contrast offenders:', JSON.stringify(contrast.offenders))
  assertPage('login', audit, contrast)
})

test('dashboard a11y audit (baseline-asserted)', async ({ page }) => {
  // Login first (the direct-DB seed — the established e2e pattern)
  const { randomBytes } = await import('node:crypto')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('/tmp/hibana-e2e.db')
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('e2e-password-123'), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const toB64 = (buf: Uint8Array) => Buffer.from(buf).toString('base64')
  const hash = `pbkdf2$100000$${toB64(salt)}$${toB64(Buffer.from(bits))}`
  const now = new Date().toISOString()
  const id = randomBytes(16).toString('hex')
  try { db.exec(`DELETE FROM users WHERE email = 'e2e@test.local'`) } catch {}
  db.exec(`INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at) VALUES ('${id}', 'e2e', 'e2e@test.local', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}')`)
  db.close()

  await page.goto('/login.html')
  await page.fill('[name="login"]', 'e2e@test.local')
  await page.fill('[name="password"]', 'e2e-password-123')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/app', { timeout: 10_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2000)

  const { audit, contrast } = await runAudits(page)
  console.log(`dashboard a11y: overflow ${audit.viewportOverflowCount}/${BASELINE.dashboard.overflow} · touch ${audit.smallTouchCount}/${BASELINE.dashboard.touch} · clipped ${audit.clippedCount}/${BASELINE.dashboard.clipped} · contrast ${contrast.offenders.length}/${BASELINE.dashboard.contrast}`)
  if (contrast.offenders.length) console.log('dashboard contrast offenders:', JSON.stringify(contrast.offenders))
  assertPage('dashboard', audit, contrast)
})
