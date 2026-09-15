import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { markdownFromZip, ZipLimitError } from '../lib/obsidian'
import type { Db } from '../db/types'

// Security regression suite (2026-08-28 hardening). Each test pins one fix from the
// Phase-1 audit so the exact class of bug can never silently return:
//   1. /api/export JSON is USER-SCOPED (was: whole-DB leak to any member).
//   2. /api/admin/purge is owner-only (was: missing isOwner check).
//   3. /api/notifications escapes user titles in the htmx fragment (was: stored XSS).
//   4. Every response carries the security-header set (nosniff, CSP, frame-ancestors…).
//   5. /api/export/tasks.csv neutralizes CSV formula injection.
//   6. markdownFromZip enforces its caps BEFORE decompression (zip-bomb guard).

async function makeAuthedApp(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    assets: undefined,
  })
  const token = await createSession(db, userId)
  return { app, cookie: `hibana_session=${token}` }
}

const post = (cookie: string, path: string, body: unknown) =>
  new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://local' },
    body: JSON.stringify(body),
  })
const get = (cookie: string, path: string, extra: Record<string, string> = {}) =>
  new Request('http://local' + path, { headers: { Cookie: cookie, ...extra } })

describe('security hardening (2026-08-28)', () => {
  it('export JSON is user-scoped: another user’s rows never appear (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db, { username: 'alice', email: 'alice@test.dev' })
      const b = await makeUser(db, { username: 'bob', email: 'bob@test.dev', role: 'member' })
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)

      // A and B each own a project
      await appA.fetch(post(ca, '/api/projects', { title: 'A-secret-project', status: 'spark' }))
      await appB.fetch(post(cb, '/api/projects', { title: 'B-secret-project', status: 'spark' }))
      // A also has a sadhana task (one of the newer export tables)
      await appA.fetch(
        post(ca, '/api/sadhana/tasks', { title: 'A secret todo', quadrant: 1 }),
      )

      // B exports JSON — must contain ONLY B's data
      const res = await appB.fetch(get(cb, '/api/export?format=json'))
      expect(res.status).toBe(200)
      const text = await res.text()
      const snap = JSON.parse(text) as { data: Record<string, Record<string, unknown>[]> }
      expect(text).not.toContain('A-secret-project')
      expect(text).not.toContain('A secret todo')
      expect(text).not.toContain('alice@test.dev')
      expect(text).not.toContain('alice')
      expect(snap.data.projects).toHaveLength(1)
      expect(String(snap.data.projects[0]?.title)).toBe('B-secret-project')
      // B's own row is present, and no password_hash anywhere (rule 8)
      expect(snap.data.users).toHaveLength(1)
      expect(snap.data.users[0]).not.toHaveProperty('password_hash')
      expect(text).not.toContain('password_hash')
    } finally {
      close()
    }
  })

  it('export JSON never carries password_resets or invites (auth state stays server-side)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app, cookie } = await makeAuthedApp(db, a)
      await app.fetch(post(cookie, '/api/projects', { title: 'p1' }))
      // A live reset row for this user
      await db.execute(
        "INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES ('r1', ?, 'h', ?, ?)",
        [a, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString()],
      )
      const res = await app.fetch(get(cookie, '/api/export?format=json'))
      const snap = (await res.json()) as { data: Record<string, unknown[]> }
      expect(snap.data).not.toHaveProperty('password_resets')
      expect(snap.data).not.toHaveProperty('invites')
      expect(snap.data).not.toHaveProperty('sessions')
    } finally {
      close()
    }
  })

  it('admin purge is owner-only: a member gets 403 and nothing is deleted', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { role: 'owner' })
      const member = await makeUser(db, { role: 'member' })
      const { app: appMember, cookie: cm } = await makeAuthedApp(db, member)
      const { app: appOwner, cookie: co } = await makeAuthedApp(db, owner)

      // Owner creates a project, soft-deletes it (inside the 7-day undo window)
      const created = await appOwner.fetch(post(co, '/api/projects', { title: 'to-purge-later' }))
      const { id } = (await created.json()) as { id: string }
      await appOwner.fetch(new Request(`http://local/api/projects/${id}`, { method: 'DELETE', headers: { Cookie: co, Origin: 'http://local' } }))

      // Member forces a purge — must be forbidden
      const res = await appMember.fetch(new Request('http://local/api/admin/purge', { method: 'POST', headers: { Cookie: cm, Origin: 'http://local' } }))
      expect(res.status).toBe(403)

      // The soft-deleted row is still there (undo window intact)
      const rows = await db.query('SELECT id FROM projects WHERE id = ?', [id])
      expect(rows).toHaveLength(1)

      // The owner may purge — and it becomes a set-based hard delete. Note: the soft-delete
      // stamp is NOW, so it is younger than the 7-day cutoff — the cron semantics say it
      // stays. Set the stamp back artificially to prove the delete path actually fires.
      await db.execute("UPDATE projects SET deleted_at = ? WHERE id = ?", [new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(), id])
      const resOwner = await appOwner.fetch(new Request('http://local/api/admin/purge', { method: 'POST', headers: { Cookie: co, Origin: 'http://local' } }))
      expect(resOwner.status).toBe(200)
      const body = (await resOwner.json()) as { ok: boolean; purged: number }
      expect(body.ok).toBe(true)
      expect(body.purged).toBe(1)
      const after = await db.query('SELECT id FROM projects WHERE id = ?', [id])
      expect(after).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('notifications fragment escapes user titles (stored-XSS regression)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app, cookie } = await makeAuthedApp(db, a)
      const payload = '<img src=x onerror=alert(1)>'

      // Overdue sadhana task carrying the hostile title
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
      await app.fetch(post(cookie, '/api/sadhana/tasks', { title: payload, quadrant: 1, due_date: yesterday }))
      // Overdue client project with the same payload as its title
      await app.fetch(
        post(cookie, '/api/projects', { title: payload + ' project', type: 'client', status: 'building', due_date: yesterday }),
      )

      const res = await app.fetch(get(cookie, '/api/notifications', { 'HX-Request': 'true' }))
      expect(res.status).toBe(200)
      const html = await res.text()
      // The raw executable markup must NOT appear; the escaped entity must
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;img src=x')
      expect(html).not.toContain('onerror=alert(1)"><')
      expect(html).toContain('onerror=alert(1)&gt;')
    } finally {
      close()
    }
  })

  it('every Worker response carries the security-header set', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app, cookie } = await makeAuthedApp(db, a)
      const res = await app.fetch(get(cookie, '/api/dashboard'))
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
      const csp = res.headers.get('Content-Security-Policy') ?? ''
      expect(csp).toContain("frame-ancestors 'self'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("form-action 'self'")
      // CF Web-Analytics beacon allowance (2026-09-16 owner decision, S49 probe finding):
      // the ONLY two external origins the CSP ever grants, both exact https hosts. Pinned
      // here so a future CSP rewrite cannot silently re-block the beacon (or widen it).
      expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com")
      expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com")
      // No wildcard crept in alongside the allowances
      expect(csp).not.toMatch(/(script|connect)-src[^\n]*\*/)
      // Even the 401 path (unauthenticated) carries them
      const anon = await app.fetch(new Request('http://local/api/dashboard'))
      expect(anon.headers.get('X-Content-Type-Options')).toBe('nosniff')
    } finally {
      close()
    }
  })

  it('tasks.csv neutralizes spreadsheet formula injection (=, +, -, @)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app, cookie } = await makeAuthedApp(db, a)
      const created = await app.fetch(
        post(cookie, '/api/projects', { title: '=HYPERLINK("http://evil","x") client', type: 'client', status: 'building' }),
      )
      const { id } = (await created.json()) as { id: string }
      await app.fetch(
        post(cookie, `/api/projects/${id}/tasks`, { title: '+SUM(1,2)', due_date: '2026-09-30' }),
      )
      const res = await app.fetch(get(cookie, '/api/export/tasks.csv'))
      expect(res.status).toBe(200)
      const csv = await res.text()
      // Dangerous leading chars are quoted away — no field may start the line as a formula
      expect(csv).not.toMatch(/(^|,)=HYPERLINK/)
      expect(csv).not.toMatch(/(^|,)\+SUM/)
      expect(csv).toContain("'=HYPERLINK")
      expect(csv).toContain("'+SUM")
    } finally {
      close()
    }
  })

  it('markdownFromZip enforces caps BEFORE decompression (zip-bomb guard)', async () => {
    // 5 tiny entries, budget 60 bytes → the 5th push past the budget must throw ZipLimitError
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 5; i++) files[`note${i}.md`] = strToU8('x'.repeat(16))
    const bomb = zipSync(files)
    expect(() => markdownFromZip(bomb, 60)).toThrow(ZipLimitError)

    // File-count cap: 3 markdown entries, max 2 → throws
    const few: Record<string, Uint8Array> = { 'a.md': strToU8('a'), 'b.md': strToU8('b'), 'c.md': strToU8('c') }
    expect(() => markdownFromZip(zipSync(few), 1024, 2)).toThrow(ZipLimitError)

    // A healthy archive still imports, and non-md entries are ignored
    const ok = markdownFromZip(zipSync({ 'keep.md': strToU8('# Title\nbody'), 'skip.bin': strToU8('junk') }))
    expect(ok).toHaveLength(1)
    expect(ok[0]?.fileName).toBe('keep.md')
    expect(ok[0]?.content).toContain('# Title')
  })

  it('export is rate-limited (10/min/IP)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app, cookie } = await makeAuthedApp(db, a)
      let last = 0
      for (let i = 0; i < 12; i++) {
        const res = await app.fetch(get(cookie, '/api/export?format=json'))
        last = res.status
      }
      expect(last).toBe(429)
    } finally {
      close()
    }
  })
})

// Session 20 (SW-navigation fix): a service worker's navigate-mode re-fetch re-stamps the
// request as worker-initiated — Sec-Fetch-Dest: document never reaches the origin. An
// unauthenticated /app reload therefore rendered the raw JSON 401 body (a JSON-viewer
// page — no JS, no login bounce) instead of the login redirect. The middleware now also
// treats Accept: text/html as a document request.
describe('unauthenticated document requests bounce to login (Session 20)', () => {
  it('Accept: text/html without a session → 302 login redirect (the SW navigate shape)', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const res = await app.fetch(
        new Request('http://local/app', { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }),
      )
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/login.html')
    } finally {
      close()
    }
  })

  it('JSON clients without Accept: text/html still get the 401 JSON body (offline queue, curl)', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const plain = await app.fetch(new Request('http://local/api/dashboard'))
      expect(plain.status).toBe(401)
      expect(await plain.json()).toEqual({ error: 'unauthorized' })
      const jsonAccept = await app.fetch(new Request('http://local/api/dashboard', { headers: { Accept: 'application/json' } }))
      expect(jsonAccept.status).toBe(401)
      expect(await jsonAccept.json()).toEqual({ error: 'unauthorized' })
    } finally {
      close()
    }
  })
})
