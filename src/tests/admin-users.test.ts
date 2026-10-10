import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser, stubAuthNetwork } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S196 (Track A coverage-gap audit): the admin console's USER MANAGEMENT surface had
// zero unit coverage — every other admin area (usage/errors/backup-status/purge) has a
// dedicated spec, but /users, ban/unban, role changes, and the cascade delete were only
// ever exercised by hand. These routes are the app's most destructive surface, so they
// get the full contract pin:
//   1. owner-only gate on every route (a member gets 403 everywhere);
//   2. GET /users — the list + summary counts + online calc + is_self;
//   3. PATCH ban — presets (incl. forever = the far-future date), custom-date validation,
//      owner protection, AND the live-session kill (a banned user's in-flight session
//      dies on the next request — requireAuth's isBanned check);
//   4. POST unban clears both columns;
//   5. POST role — cannot change own role, cannot demote the last owner;
//   6. DELETE — owner protected, confirm-name mismatch rejected, the invite cleanup
//      (created invites go, consumed invites survive with attribution dropped).

async function makeAuthedApp(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    // send-reset exercises the real email path — a stubbed-network key (verification.test.ts pattern)
    emailKey: 'test-key',
    assets: undefined,
  })
  const token = await createSession(db, userId)
  return { app, cookie: `hibana_session=${token}` }
}

const get = (cookie: string, path: string) =>
  new Request('http://local' + path, { headers: { Cookie: cookie } })
const post = (cookie: string, path: string, body?: unknown) =>
  new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://local' },
    body: JSON.stringify(body ?? {}),
  })
const patch = (cookie: string, path: string, body: unknown) =>
  new Request('http://local' + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://local' },
    body: JSON.stringify(body),
  })
const del = (cookie: string, path: string, body: unknown) =>
  new Request('http://local' + path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://local' },
    body: JSON.stringify(body),
  })

type UserRow = {
  id: string; username: string | null; email: string; role: string; banned_until: string | null
  online: boolean; suspended: boolean; is_self: boolean; projects: number; notes: number
}
type UsersPayload = { users: UserRow[]; summary: { total: number; verified: number; unverified: number; banned: number; online: number; owners: number } }

describe('admin user management (S196 coverage-gap close)', () => {
  it('is owner-only: a member gets 403 on every user-management route', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const memberId = await makeUser(db, { role: 'member', username: 'mem' })
      const victimId = await makeUser(db, { role: 'member', username: 'vic' })
      const { app, cookie } = await makeAuthedApp(db, memberId)

      expect((await app.fetch(get(cookie, '/api/admin/users'))).status).toBe(403)
      expect((await app.fetch(patch(cookie, `/api/admin/users/${victimId}/ban`, { preset: '1d' }))).status).toBe(403)
      expect((await app.fetch(post(cookie, `/api/admin/users/${victimId}/unban`))).status).toBe(403)
      expect((await app.fetch(post(cookie, `/api/admin/users/${victimId}/role`, { role: 'member' }))).status).toBe(403)
      expect((await app.fetch(del(cookie, `/api/admin/users/${victimId}`, { confirm: 'vic' }))).status).toBe(403)
      // sanity: the owner's own session stays valid on the same app instance
      const { cookie: co } = await makeAuthedApp(db, ownerId)
      expect((await app.fetch(get(co, '/api/admin/users'))).status).toBe(200)
    } finally { close() }
  })

  it('GET /users: list + summary + online + is_self + per-user counts', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const verifiedId = await makeUser(db, { role: 'member', username: 'ver' })
      await makeUser(db, { role: 'member', username: 'unv', emailVerifiedAt: null }) // counted via summary.unverified
      const now = new Date().toISOString()
      // owner has 2 live projects, verified member has 1 note; soft-deleted rows don't count
      for (const [id, u] of [['p1', ownerId], ['p2', ownerId], ['p3', ownerId]] as const) {
        await db.execute(
          'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, u, 'P', 'developing', now, now],
        )
      }
      await db.execute("UPDATE projects SET deleted_at = ? WHERE id = 'p3'", [now])
      await db.execute(
        'INSERT INTO quick_notes (id, user_id, content, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['n1', verifiedId, 'note', 'note', now, now],
      )
      // last_seen_at: requireAuth stamps it — the owner's session (via makeAuthedApp below)
      // counts as online; the unverified member never logged in → null.
      await db.execute("UPDATE users SET last_seen_at = ? WHERE id = ?", [new Date().toISOString(), verifiedId])

      const { app, cookie } = await makeAuthedApp(db, ownerId)
      const res = await app.fetch(get(cookie, '/api/admin/users'))
      expect(res.status).toBe(200)
      const payload = (await res.json()) as UsersPayload
      expect(payload.summary).toEqual({ total: 3, verified: 2, unverified: 1, banned: 0, online: 2, owners: 1 })
      const byName = new Map(payload.users.map((u) => [u.username, u]))
      expect(byName.get('own')?.is_self).toBe(true)
      expect(byName.get('ver')?.is_self).toBe(false)
      expect(byName.get('ver')?.online).toBe(true)
      expect(byName.get('unv')?.online).toBe(false)
      expect(byName.get('own')?.projects).toBe(2) // the soft-deleted p3 drops out
      expect(byName.get('ver')?.notes).toBe(1)
    } finally { close() }
  })

  it('PATCH ban: the forever preset writes the far-future date, kills the target session, and the banned user 401s on the next request', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const targetId = await makeUser(db, { role: 'member', username: 'tgt' })
      const { app, cookie: co } = await makeAuthedApp(db, ownerId)
      const { cookie: ct } = await makeAuthedApp(db, targetId)
      // the target's session is live before the ban
      expect((await app.fetch(get(ct, '/api/auth/me'))).status).toBe(200)

      const res = await app.fetch(patch(co, `/api/admin/users/${targetId}/ban`, { preset: 'forever', reason: 'spam' }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; banned_until: string; ban_reason: string | null }
      expect(body.ok).toBe(true)
      expect(body.banned_until).toBe('9999-12-31T23:59:59.999Z') // BANNED_FOREVER_DATE (L8)
      expect(body.ban_reason).toBe('spam')

      // the session kill + the auth gate: the same cookie now fails
      const me = await app.fetch(get(ct, '/api/auth/me'))
      expect(me.status).toBe(401)
      // and the users list reports the suspension
      const list = (await (await app.fetch(get(co, '/api/admin/users'))).json()) as UsersPayload
      expect(list.summary.banned).toBe(1)
      expect(list.users.find((u) => u.id === targetId)?.suspended).toBe(true)
    } finally { close() }
  })

  it('PATCH ban: a finite preset and the custom-date validation rails', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const t1Id = await makeUser(db, { role: 'member', username: 't1' })
      const t2Id = await makeUser(db, { role: 'member', username: 't2' })
      const t3Id = await makeUser(db, { role: 'member', username: 't3' })
      const t4Id = await makeUser(db, { role: 'member', username: 't4' })
      const { app, cookie } = await makeAuthedApp(db, ownerId)

      // '1d' preset → ~24h out
      const r1 = await app.fetch(patch(cookie, `/api/admin/users/${t1Id}/ban`, { preset: '1d' }))
      expect(r1.status).toBe(200)
      const b1 = (await r1.json()) as { banned_until: string }
      const delta = new Date(b1.banned_until).getTime() - Date.now()
      expect(delta).toBeGreaterThan(23.9 * 3600 * 1000)
      expect(delta).toBeLessThan(24.1 * 3600 * 1000)

      // custom date beyond the 10-year ceiling → invalid_until
      const far = new Date(Date.now() + 11 * 365 * 24 * 3600 * 1000).toISOString()
      expect((await app.fetch(patch(cookie, `/api/admin/users/${t2Id}/ban`, { until: far }))).status).toBe(400)
      // no duration at all → invalid_input (the schema refine)
      expect((await app.fetch(patch(cookie, `/api/admin/users/${t3Id}/ban`, { reason: 'x' }))).status).toBe(400)
      // unknown user → 404
      expect((await app.fetch(patch(cookie, '/api/admin/users/nope/ban', { preset: '1d' }))).status).toBe(404)
      // the OWNER is protected from banning
      expect((await app.fetch(patch(cookie, `/api/admin/users/${ownerId}/ban`, { preset: '1d' }))).status).toBe(403)
      // t4 untouched
      const list = (await (await app.fetch(get(cookie, '/api/admin/users'))).json()) as UsersPayload
      expect(list.users.find((u) => u.id === t4Id)?.suspended).toBe(false)
    } finally { close() }
  })

  it('POST unban clears both columns and the account logs in again', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const targetId = await makeUser(db, { role: 'member', username: 'tgt', password: 'target-pass-123' })
      const { app, cookie } = await makeAuthedApp(db, ownerId)
      await app.fetch(patch(cookie, `/api/admin/users/${targetId}/ban`, { preset: 'forever', reason: 'oops' }))

      const res = await app.fetch(post(cookie, `/api/admin/users/${targetId}/unban`))
      expect(res.status).toBe(200)
      const row = (await db.query<{ banned_until: string | null; ban_reason: string | null }>(
        'SELECT banned_until, ban_reason FROM users WHERE id = ?', [targetId],
      ))[0]
      expect(row.banned_until).toBeNull()
      expect(row.ban_reason).toBeNull()
      // the login flow accepts the account again (the ban branch no longer fires)
      const login = await app.fetch(new Request('http://local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://local' },
        body: JSON.stringify({ login: 'tgt', password: 'target-pass-123' }),
      }))
      expect(login.status).toBe(200)
    } finally { close() }
  })

  it('POST role: self-change and last-owner guards, and a working promotion', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const secondId = await makeUser(db, { role: 'member', username: 'sec' })
      const thirdId = await makeUser(db, { role: 'member', username: 'thi' })
      const { app, cookie } = await makeAuthedApp(db, ownerId)

      // cannot change your own role
      expect((await app.fetch(post(cookie, `/api/admin/users/${ownerId}/role`, { role: 'member' }))).status).toBe(403)
      // promote second → owner (works)
      const promo = await app.fetch(post(cookie, `/api/admin/users/${secondId}/role`, { role: 'owner' }))
      expect(promo.status).toBe(200)
      // now demote the original owner — the self-change guard means the SECOND owner's
      // session does it (two owners remain, so last_owner doesn't fire)
      const { cookie: cookie2 } = await makeAuthedApp(db, secondId)
      const demo = await app.fetch(post(cookie2, `/api/admin/users/${ownerId}/role`, { role: 'member' }))
      expect(demo.status).toBe(200)
      // demote second (the last owner) → 403 last_owner
      const last = await app.fetch(post(cookie2, `/api/admin/users/${secondId}/role`, { role: 'member' }))
      expect(last.status).toBe(403)
      // third stays a member; the DB agrees with the successful changes
      const roles = new Map((await db.query<{ id: string; role: string }>('SELECT id, role FROM users')).map((r) => [r.id, r.role]))
      expect(roles.get(ownerId)).toBe('member')
      expect(roles.get(secondId)).toBe('owner')
      expect(roles.get(thirdId)).toBe('member')
    } finally { close() }
  })

  it('DELETE /users: confirm-name mismatch rejected, invite cleanup, and the row is gone', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const targetId = await makeUser(db, { role: 'member', username: 'tgt' })
      const survivorId = await makeUser(db, { role: 'member', username: 'sur' })
      const now = new Date().toISOString()
      // target created 1 invite, consumed 1 invite created by the owner; survivor consumed 1 created by the target
      await db.execute(
        'INSERT INTO invites (id, code, created_by, created_at, used_at, used_by) VALUES (?, ?, ?, ?, ?, ?)',
        ['i-created-by-target', 'AAA1', targetId, now, now, survivorId],
      )
      await db.execute(
        'INSERT INTO invites (id, code, created_by, created_at, used_at, used_by) VALUES (?, ?, ?, ?, ?, ?)',
        ['i-used-by-target', 'BBB2', ownerId, now, now, targetId],
      )
      await db.execute(
        'INSERT INTO invites (id, code, created_by, created_at) VALUES (?, ?, ?, ?)',
        ['i-unused-by-target', 'CCC3', targetId, now],
      )

      const { app, cookie } = await makeAuthedApp(db, ownerId)
      // wrong confirm string → 400 + the expected name echoed back
      const wrong = await app.fetch(del(cookie, `/api/admin/users/${targetId}`, { confirm: 'not-the-name' }))
      expect(wrong.status).toBe(400)
      const wb = (await wrong.json()) as { error: string; expected: string }
      expect(wb.error).toBe('confirm_mismatch')
      expect(wb.expected).toBe('tgt')
      // the OWNER is protected from deletion
      expect((await app.fetch(del(cookie, `/api/admin/users/${ownerId}`, { confirm: 'own' }))).status).toBe(403)

      // correct confirm → deleted + invites: created-by-target gone (both), used-by→NULL
      const ok = await app.fetch(del(cookie, `/api/admin/users/${targetId}`, { confirm: 'tgt' }))
      expect(ok.status).toBe(200)
      const rows = await db.query<{ id: string; used_by: string | null }>('SELECT id, used_by FROM invites')
      const byId = new Map(rows.map((r) => [r.id, r.used_by]))
      expect(byId.has('i-created-by-target')).toBe(false)
      expect(byId.has('i-unused-by-target')).toBe(false)
      expect(byId.get('i-used-by-target')).toBeNull() // attribution dropped, invite survives
      expect((await db.query('SELECT id FROM users WHERE id = ?', [targetId])).length).toBe(0)
      expect((await db.query('SELECT id FROM users WHERE id = ?', [survivorId])).length).toBe(1)
    } finally { close() }
  })

  it('POST send-reset: creates the token and sends the email (stubbed network)', async () => {
    const net = stubAuthNetwork()
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db, { role: 'owner', username: 'own' })
      const targetEmail = 'reset-target@test.dev'
      const targetId = await makeUser(db, { role: 'member', username: 'tgt', email: targetEmail })
      const { app, cookie } = await makeAuthedApp(db, ownerId)

      const res = await app.fetch(post(cookie, `/api/admin/users/${targetId}/send-reset`))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; sent_to: string }
      expect(body.ok).toBe(true)
      expect(body.sent_to).toBe(targetEmail)
      // the email actually went out through the stubbed Resend call
      expect(net.calls.some((c) => c.url.includes('api.resend.com'))).toBe(true)
      // a reset token row exists for the target
      const tokens = await db.query<{ user_id: string }>('SELECT user_id FROM password_resets WHERE user_id = ?', [targetId])
      expect(tokens.length).toBe(1)
    } finally {
      net.restore()
      close()
    }
  })
})
