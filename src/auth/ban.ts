import type { UserRow } from '../types'

// Suspension helpers (batch e admin console). A ban is either a permanent ban or an ISO
// timestamp still in the future; an expired ban row means the account is active again.
//
// L8 fix (2026-09-10): the 'forever' string sentinel was replaced with a far-future ISO
// date (year 9999). The TEXT column otherwise holds ISO timestamps, so the sentinel was a
// type smell + a special case in isBanned/banQueryParams/every consumer. A far-future date
// behaves identically (banned indefinitely) without the special case. Legacy 'forever'
// values in the DB are still handled by isBanned for backwards compatibility.
export const BANNED_FOREVER_DATE = '9999-12-31T23:59:59.999Z'
const LEGACY_FOREVER = 'forever'

export function isBanned(u: Pick<UserRow, 'banned_until' | 'ban_reason'>): boolean {
  if (!u.banned_until) return false
  if (u.banned_until === LEGACY_FOREVER) return true // legacy compatibility
  return new Date(u.banned_until).getTime() > Date.now()
}

/** Login-page query string carrying the ban notice (`?banned=1&until=…&reason=…`). */
export function banQueryParams(u: Pick<UserRow, 'banned_until' | 'ban_reason'>): string {
  const p = new URLSearchParams({ banned: '1' })
  if (u.banned_until) {
    // Show "permanent" for both the legacy 'forever' sentinel and the new far-future date
    const isPermanent = u.banned_until === LEGACY_FOREVER || u.banned_until === BANNED_FOREVER_DATE
    p.set('until', isPermanent ? 'forever' : u.banned_until)
  }
  if (u.ban_reason) p.set('reason', u.ban_reason)
  return p.toString()
}
