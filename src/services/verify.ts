import type { Db } from '../db/types'
import { uuid } from '../lib/ids'
import { timingSafeEqualStr } from '../lib/crypto'
import { sha256Hex } from './reset'

// Email-code confirmation for NEW accounts (spec §4.14): register creates an UNVERIFIED
// account + mails a 6-digit code; /api/auth/verify consumes it and logs in. The code is
// hashed at rest (same guarantee as reset tokens), expires in 15 minutes, and is
// invalidated after 5 wrong attempts (resend starts a fresh code).

const EMAIL_CODE_TTL_MS = 15 * 60 * 1000
export const EMAIL_CODE_MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_MS = 60 * 1000

type VerifyResult = 'ok' | 'invalid' | 'expired' | 'too_many_attempts'

interface VerificationRow {
  id: string
  code_hash: string
  attempts: number
  created_at: string
  expires_at: string
}

function markUsed(db: Db, id: string): Promise<unknown> {
  return db.execute('UPDATE email_verifications SET used_at = ? WHERE id = ?', [new Date().toISOString(), id])
}

/** Generates a fresh 4-digit code, invalidating any earlier pending one. Returns the RAW code.
 *  4 digits per Ali's request (four verification boxes in the signup modal, 2026-08-24) —
 *  rate-limited + attempt-capped, so brute force is not practical.
 *
 *  P2.4 (F-L13): rejection sampling for uniform digits. The old `b % 10` had modulo bias
 *  (256 % 10 = 6 → digits 0-5 ~2.3% more likely than 6-9). Over-fetch 8 bytes and reject
 *  values >= 250 (floor(256/10)*10) so each accepted byte maps uniformly to 0-9. */
export async function createEmailCode(db: Db, userId: string): Promise<string> {
  const randBytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (let i = 0; i < randBytes.length && code.length < 4; i++) {
    if (randBytes[i] < 250) code += randBytes[i] % 10 // 250 = floor(256/10)*10 → uniform
  }
  // Astronomically unlikely (all 8 bytes >= 250 ≈ 1 in 10^15); re-fetch if it ever happens.
  if (code.length < 4) {
    const extra = crypto.getRandomValues(new Uint8Array(8))
    for (let i = 0; i < extra.length && code.length < 4; i++) {
      if (extra[i] < 250) code += extra[i] % 10
    }
  }
  const hash = await sha256Hex(code)
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    tx.sql('UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now, userId])
    tx.sql(
      'INSERT INTO email_verifications (id, user_id, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)',
      [uuid(), userId, hash, now, new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString()],
    )
  })
  return code
}

/** Checks a submitted code against the user's latest pending verification. Side effects:
 *  wrong attempts count up (and invalidate at the cap); expiry/over-limit invalidate. */
export async function verifyEmailCode(db: Db, userId: string, code: string): Promise<VerifyResult> {
  const rows = await db.query<VerificationRow>(
    'SELECT * FROM email_verifications WHERE user_id = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [userId],
  )
  if (rows.length === 0) return 'invalid'
  const row = rows[0]
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    await markUsed(db, row.id)
    return 'too_many_attempts'
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await markUsed(db, row.id)
    return 'expired'
  }
  const hash = await sha256Hex(code)
  // P2.3 (F-L12): constant-time compare. Both are SHA-256 hex (64 chars, fixed length) so
  // the length-leak in timingSafeEqualStr is not exploitable here. The 5-attempt cap makes
  // practical exploitation negligible, but this closes the discipline gap with password.ts
  // and captcha.ts (both already constant-time).
  if (!timingSafeEqualStr(hash, row.code_hash)) {
    const attempts = row.attempts + 1
    await db.execute('UPDATE email_verifications SET attempts = ? WHERE id = ?', [attempts, row.id])
    if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) await markUsed(db, row.id)
    return 'invalid'
  }
  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    tx.sql('UPDATE email_verifications SET used_at = ? WHERE id = ?', [now, row.id])
    tx.sql('UPDATE users SET email_verified_at = ? WHERE id = ?', [now, userId])
  })
  return 'ok'
}