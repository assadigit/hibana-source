import { mkdtempSync, rmSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDb } from '../db/sqlite'
import { applyMigrations } from '../db/migrate-node'
import { hashPassword } from '../auth/password'
import { issueMathCaptcha } from '../services/captcha'
import { vi } from 'vitest'
import type { Db } from '../db/types'

// Test database: real migrations applied by the real Node runner (rule 4 — tests exercise
// the same schema as prod), on a throwaway SQLite file. Using applyMigrations also creates
// the `_migrations` bookkeeping table, exactly as the Node runtime tracks it.
// No Cloudflare account, no network, no native deps.
export function makeTestDb(): { db: Db; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'hibana-test-'))
  const path = join(dir, 'test.db')

  // Migrate on a raw connection first, then hand the file to the adapter —
  // both connections must close before the temp dir can be removed on Windows.
  applyMigrations(path, join(process.cwd(), 'migrations'))

  const adapter = createSqliteDb(path)
  return {
    db: adapter,
    close: () => {
      adapter.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** S57: a test DB at an OLDER schema — what a remote D1 that hasn't applied the newest
 * migrations looks like to freshly deployed code (the deploy-ahead-of-D1 race). Copies
 * only migrations numbered ≤ upto into a temp dir and runs the real Node runner on it,
 * so the schema is byte-identical to a real lagging database (not a hand-rolled lookalike). */
export function makeTestDbUpto(upto: number): { db: Db; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'hibana-test-upto-'))
  const path = join(dir, 'test.db')
  const src = join(process.cwd(), 'migrations')
  const subset = join(dir, 'migrations')
  mkdirSync(subset)
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.sql')) continue
    const n = Number.parseInt(f.slice(0, 4), 10)
    if (Number.isFinite(n) && n <= upto) copyFileSync(join(src, f), join(subset, f))
  }
  applyMigrations(path, subset)
  const adapter = createSqliteDb(path)
  return {
    db: adapter,
    close: () => {
      adapter.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export async function makeUser(
  db: Db,
  over: Partial<{ username: string; email: string; role: string; password: string; emailVerifiedAt: string | null }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      over.username ?? null,
      over.email ?? `${id.slice(0, 8)}@test.dev`,
      await hashPassword(over.password ?? 'test-password-123'),
      over.role ?? 'owner',
      'en',
      'gregorian',
      'UTC',
      // Distinct from undefined: pass null explicitly to create an UNVERIFIED account.
      over.emailVerifiedAt !== undefined ? over.emailVerifiedAt : new Date().toISOString(),
      new Date().toISOString(),
    ],
  )
  return id
}

interface StubCall {
  url: string
  body?: { to?: string[]; subject?: string; html?: string }
}

/** Stubs the external HTTPS call the auth flows make (Resend emails) so tests run offline
 *  with no network. The math human-check (2026-08-30 (e)) is pure Web Crypto — no
 *  third-party call since Turnstile was dropped. Requests are recorded so tests can, e.g.,
 *  read the verification code out of the captured email HTML. */
export function stubAuthNetwork(over: { resendOk?: boolean } = {}) {
  const calls: StubCall[] = []
  const origFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as StubCall['body']) : undefined
    calls.push({ url, body })
    if (url.includes('api.resend.com')) {
      if ((over.resendOk ?? true) === false) return new Response(JSON.stringify({ error: 'down' }), { status: 500 })
      return new Response(JSON.stringify({ id: 'test-email' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return origFetch(input, init)
  })
  return { calls, restore: () => vi.unstubAllGlobals() }
}

/** Extracts the 4-digit confirmation code from the last captured registration email.
 *  The code is the only bare 4-digit text node in the branded body — a naive /\d{4}/
 *  would false-match the hex palette (#3A3226 → "3226"). */
export function lastVerificationCode(net: { calls: StubCall[] }): string {
  const mail = [...net.calls].reverse().find((c) => c.url.includes('api.resend.com'))
  const html = mail?.body?.html ?? ''
  const m = html.match(/>(\d{4})</)
  if (!m) throw new Error('no 4-digit code in captured email: ' + html)
  return m[1]
}

// --- Math human-check (2026-08-30 (e)) ------------------------------------------------
// The register flow's captcha fields: `captcha` is the user's answer, `captcha_token` the
// HMAC-signed challenge from GET /api/auth/captcha (or issueMathCaptcha directly — same
// secret, same ladder). Tests solve the arithmetic like the signup page's JS would.

/** Parses the arithmetic question the human-check issues ("7 + 5 =" / "12 - 3 ="). */
export function captchaAnswer(question: string): number {
  const m = question.match(/^(\d+)\s*([-+])\s*(\d+)\s*=$/)
  if (!m) throw new Error(`unparseable captcha question: ${question}`)
  const a = Number(m[1])
  const b = Number(m[3])
  return m[2] === '+' ? a + b : a - b
}

/** Issues a challenge under the test secret and solves it — a passing human check. */
export async function solvedCaptcha(secret = 'test-secret'): Promise<{ captcha: string; captcha_token: string }> {
  const { question, token } = await issueMathCaptcha(secret)
  return { captcha: String(captchaAnswer(question)), captcha_token: token }
}

/** Issues a challenge under the test secret and answers WRONG (off by one) — the
 *  register route's captcha_failed path. */
export async function wrongCaptcha(secret = 'test-secret'): Promise<{ captcha: string; captcha_token: string }> {
  const { question, token } = await issueMathCaptcha(secret)
  return { captcha: String(captchaAnswer(question) + 1), captcha_token: token }
}