import type { UserRow } from '../types'

// Suspension helpers (batch e admin console). A ban is either 'forever' or an ISO
// timestamp still in the future; an expired ban row means the account is active again.

const BANNED_PRESENT = 'forever'

export function isBanned(u: Pick<UserRow, 'banned_until' | 'ban_reason'>): boolean {
  if (!u.banned_until) return false
  if (u.banned_until === BANNED_PRESENT) return true
  return new Date(u.banned_until).getTime() > Date.now()
}

/** Login-page query string carrying the ban notice (`?banned=1&until=…&reason=…`). */
export function banQueryParams(u: Pick<UserRow, 'banned_until' | 'ban_reason'>): string {
  const p = new URLSearchParams({ banned: '1' })
  if (u.banned_until) p.set('until', u.banned_until)
  if (u.ban_reason) p.set('reason', u.ban_reason)
  return p.toString()
}
