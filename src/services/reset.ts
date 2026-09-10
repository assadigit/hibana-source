import type { Db } from '../db/types'
import { uuid } from '../lib/ids'

// Password-reset tokens shared by the email channel (routes/reset.ts) and the Telegram
// secondary channel (routes/integrations.ts webhook, spec §9). One-time, hashed in D1
// (rule: token never stored raw), 1-hour expiry — same guarantees as email.
export async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createResetToken(db: Db, userId: string): Promise<string> {
  const token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '')
  const hash = await sha256Hex(token)
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [uuid(), userId, hash, now, new Date(Date.now() + 60 * 60 * 1000).toISOString()],
  )
  return token
}
