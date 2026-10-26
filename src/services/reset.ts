import type { Db } from '../db/types'
import { sha256Hex } from '../lib/crypto'
export { sha256Hex }
import { uuid } from '../lib/ids'

// Password-reset tokens shared by the email channel (routes/reset.ts) and the Telegram
// secondary channel (routes/integrations.ts webhook, spec §9). One-time, hashed in D1
// (rule: token never stored raw), 1-hour expiry — same guarantees as email.
// sha256Hex: shared idiom in lib/crypto.ts (CQ-6); re-exported for the existing importers (routes/reset, services/verify)

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
