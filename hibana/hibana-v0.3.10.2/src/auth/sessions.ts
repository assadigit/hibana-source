import type { Db } from '../db/types'

// Sessions (spec §4.13): Workers is stateless, so the session lives in D1.
// Defense in depth: only the SHA-256 hash of the token is stored — a DB leak never
// yields usable cookie values. 30-day rolling expiry; extended on activity.

export const SESSION_COOKIE = 'hibana_session'
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const EXTEND_BELOW_MS = 15 * 24 * 60 * 60 * 1000 // extend when less than 15 days remain

async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = crypto.getRandomValues(new Uint8Array(32)) // 256 bits of entropy
  const raw = btoa(String.fromCharCode(...token)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const id = await sha256Hex(raw)
  const now = new Date()
  await db.execute(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [id, userId, now.toISOString(), new Date(now.getTime() + LIFETIME_MS).toISOString()],
  )
  return raw
}

/** SHA-256 hash of a session token — this is sessions.id (never the raw token). */
export async function sessionHash(token: string): Promise<string> {
  return sha256Hex(token)
}

export async function destroySession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return
  await db.execute('DELETE FROM sessions WHERE id = ?', [await sha256Hex(token)])
}

/** Returns the authenticated user id, or null. Expired sessions are deleted here. */
export async function validateSession(db: Db, token: string | undefined): Promise<string | null> {
  if (!token) return null
  const id = await sha256Hex(token)
  const rows = await db.query<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM sessions WHERE id = ?',
    [id],
  )
  if (rows.length === 0) return null
  const { user_id, expires_at } = rows[0]
  const expires = new Date(expires_at).getTime()
  if (expires <= Date.now()) {
    await db.execute('DELETE FROM sessions WHERE id = ?', [id])
    return null
  }
  if (expires - Date.now() < EXTEND_BELOW_MS) {
    await db.execute('UPDATE sessions SET expires_at = ? WHERE id = ?', [
      new Date(Date.now() + LIFETIME_MS).toISOString(),
      id,
    ])
  }
  return user_id
}

/**
 * P3.3 (F-L1): validate the session AND fetch the user row in ONE JOIN query (was 2-3
 * round trips: validateSession's SELECT + maybe DELETE/UPDATE, then a separate
 * SELECT * FROM users). Returns { user, sessionId, expired } or null.
 *
 * The extend-on-activity + expired-session-cleanup are NOT done here — they stay as
 * separate best-effort writes (fire-and-forget via ctx.waitUntil per P1.3) so the read
 * path stays a single round trip. The caller (middleware.ts) handles those writes.
 */
export async function validateSessionWithUser<U>(
  db: Db,
  token: string | undefined,
): Promise<{ user: U; sessionId: string; expiresAt: string; needsExtend: boolean } | null> {
  if (!token) return null
  const id = await sha256Hex(token)
  const rows = await db.query<U & { s_id: string; s_expires_at: string }>(
    'SELECT u.*, s.id AS s_id, s.expires_at AS s_expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
    [id],
  )
  if (rows.length === 0) return null
  const row = rows[0] as U & { s_id: string; s_expires_at: string }
  const expiresAt = row.s_expires_at
  // strip the session-prefixed join columns before returning the user
  const user: U = (() => {
    const { s_id: _sid, s_expires_at: _sexp, ...rest } = row
    return rest as U
  })()
  return {
    user,
    sessionId: row.s_id,
    expiresAt,
    needsExtend: new Date(expiresAt).getTime() - Date.now() < EXTEND_BELOW_MS,
  }
}

/** Best-effort: extend a session's expiry (fire-and-forget via waitUntil). */
export async function extendSession(db: Db, sessionId: string): Promise<void> {
  await db.execute('UPDATE sessions SET expires_at = ? WHERE id = ?', [
    new Date(Date.now() + LIFETIME_MS).toISOString(),
    sessionId,
  ])
}

/** Best-effort: delete an expired session (fire-and-forget via waitUntil). */
export async function deleteSessionById(db: Db, sessionId: string): Promise<void> {
  await db.execute('DELETE FROM sessions WHERE id = ?', [sessionId])
}