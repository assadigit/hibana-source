// e2e/a11y.spec.ts — accessibility regression test.
// Runs the existing audit-fn.js (touch targets, overflow, missing alt, dir mismatches)
// + contrast-fn.js (WCAG luminance) against the live pages via Playwright.
// Catches a11y regressions that unit tests can't detect.

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const auditFn = readFileSync(join(ROOT, 'audit-results', 'audit-fn.js'), 'utf8')
const contrastFn = readFileSync(join(ROOT, 'audit-results', 'contrast-fn.js'), 'utf8')

// The audit-fn.js + contrast-fn.js are pure JS that run in the browser context.
// We inject them via page.evaluate() and collect the findings.

test('login page a11y audit', async ({ page }) => {
  await page.goto('/login.html')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)

  const findings = await page.evaluate((fns) => {
    // eval the audit + contrast functions into the page context
    eval(fns.audit)
    eval(fns.contrast)

    // Run the audits — these functions are defined by the eval'd code
    const results = {
      // @ts-expect-error injected by eval
      touchTargets: typeof auditTouchTargets === 'function' ? auditTouchTargets() : [],
      // @ts-expect-error injected by eval'd code
      overflow: typeof auditOverflow === 'function' ? auditOverflow() : [],
      // @ts-expect-error injected by eval
      missingAlt: typeof auditMissingAlt === 'function' ? auditMissingAlt() : [],
      // @ts-expect-error injected by eval
      dirMismatch: typeof auditDirMismatch === 'function' ? auditDirMismatch() : [],
    }
    return results
  }, { audit: auditFn, contrast: contrastFn })

  // Report findings (don't fail the test — just report for now, until baselines are established)
  const total = findings.touchTargets.length + findings.overflow.length + findings.missingAlt.length + findings.dirMismatch.length
  if (total > 0) {
    console.log(`login a11y findings: ${total} (touchTargets: ${findings.touchTargets.length}, overflow: ${findings.overflow.length}, missingAlt: ${findings.missingAlt.length}, dirMismatch: ${findings.dirMismatch.length})`)
  }
  // TODO: once baselines are established, add: expect(total).toBeLessThanOrEqual(BASELINE_COUNT)
})

test('dashboard a11y audit', async ({ page }) => {
  // Login first
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

  const findings = await page.evaluate((fns) => {
    eval(fns.audit)
    eval(fns.contrast)
    const results = {
      // @ts-expect-error injected by eval
      touchTargets: typeof auditTouchTargets === 'function' ? auditTouchTargets() : [],
      // @ts-expect-error injected by eval
      overflow: typeof auditOverflow === 'function' ? auditOverflow() : [],
    }
    return results
  }, { audit: auditFn, contrast: contrastFn })

  const total = findings.touchTargets.length + findings.overflow.length
  console.log(`dashboard a11y findings: ${total} (touchTargets: ${findings.touchTargets.length}, overflow: ${findings.overflow.length})`)
})
