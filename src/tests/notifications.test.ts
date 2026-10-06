import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S191 — THE ATTENTION SURFACE: the derived notifications aggregate gained (a) the
// ?counts=1 lightweight mode (the chrome badge's payload) and (b) severity GROUPS in
// the htmx fragment (sticky heads + count pills, non-empty groups only). This file
// also guards the NEVER-DEFINED --badge-pending-* regression at the contract level:
// the warning family's chips/icons/accents consume that token pair (qa script pins
// the palette floors). User-scoping + escaping stay pinned by isolation/security
// suites; the route-level contracts land here.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

const DAY = 24 * 3600 * 1000
const iso = (msAgo: number) => new Date(Date.now() + msAgo).toISOString()
const day = (msAgo: number) => iso(msAgo).slice(0, 10)

// One user carrying a notification of every severity:
//   urgent   — a client task overdue since yesterday
//   warning  — a client project due in 3 days
//   info ×2  — an unreviewed spark (10 days old) + a stale developing project (40d)
async function seedAllKinds(db: Db, me: string) {
  const now = iso(0)
  await db.execute(
    'INSERT INTO projects (id, user_id, title, status, type, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['p-due', me, 'Due soon project', 'developing', 'client', day(3 * DAY), now, now],
  )
  await db.execute(
    'INSERT INTO tasks (id, project_id, title, done, due_date, created_at) VALUES (?, ?, ?, 0, ?, ?)',
    ['t-old', 'p-due', 'The overdue client task', day(-DAY), now],
  )
  await db.execute(
    'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['p-spark', me, 'The old unreviewed spark', 'spark', iso(-10 * DAY), iso(-10 * DAY)],
  )
  await db.execute(
    'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['p-stale', me, 'The stale project', 'developing', iso(-60 * DAY), iso(-40 * DAY)],
  )
}

describe('GET /api/notifications (the attention surface)', () => {
  it('401 without a session — the auth gate', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db))
      const res = await app.fetch(new Request('http://local/api/notifications'))
      expect(res.status).toBe(401)
    } finally { close() }
  })

  it('?counts=1 — the chrome badge payload: four numbers, nothing else', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'notif-me' })
      await seedAllKinds(db, me)
      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/notifications?counts=1', { headers: auth }))
      expect(res.status).toBe(200)
      const data = (await res.json()) as { count: number; urgent: number; warning: number; info: number }
      expect(data).toEqual({ count: 4, urgent: 1, warning: 1, info: 2 })
    } finally { close() }
  })

  it('JSON mode keeps its shape (count + notifications with kind/severity)', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'notif-json' })
      await seedAllKinds(db, me)
      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/notifications', { headers: auth }))
      expect(res.status).toBe(200)
      const data = (await res.json()) as { count: number; notifications: Array<{ kind: string }> }
      expect(data.count).toBe(4)
      const kinds = data.notifications.map((n) => n.kind).sort()
      expect(kinds).toEqual(['overdue-task', 'stale-project', 'unreviewed-spark', 'upcoming-deadline'])
    } finally { close() }
  })

  it('the htmx fragment renders severity GROUPS in order, non-empty only, with count pills', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'notif-frag' })
      await seedAllKinds(db, me)
      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/notifications', { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      // The three non-empty groups, in severity order (urgent → warning → info)
      const u = html.indexOf('data-sev="urgent"')
      const w = html.indexOf('data-sev="warning"')
      const i = html.indexOf('data-sev="info"')
      expect(u).toBeGreaterThanOrEqual(0)
      expect(w).toBeGreaterThan(u)
      expect(i).toBeGreaterThan(w)
      // Sticky heads with their labels + count pills
      expect(html).toContain('notif-group-head notif-group-head-urgent')
      expect(html).toContain('>Urgent</span>')
      expect(html).toContain('notif-group-count" aria-hidden="true">1<')
      expect(html).toContain('>Heads up</span>')
      expect((html.match(/class="notif-group-count"/g) ?? []).length).toBe(3)
      // The items live inside their group's list
      expect(html).toContain('The overdue client task')
      expect(html).toContain('The old unreviewed spark')
      expect(html).toContain('The stale project')
      // S192: sparks link DIRECT to the LEAN page (no /project.html hop — every other
      // spark surface links direct; the hop flashed the empty heavy shell + wasted a
      // round trip). Projects keep /project.html.
      expect(html).toMatch(/href="\/spark\.html\?id=p-spark"/)
      expect(html).toMatch(/href="\/project\.html\?id=p-due"/)
      expect(html).not.toMatch(/href="\/project\.html\?id=p-spark"/)
      // The flat-list legacy shape is gone: the fragment's root is the groups
      // wrapper, and every list rides inside a group section (3 sections = 3 lists).
      expect(html.startsWith('<div class="notif-groups">')).toBe(true)
      expect((html.match(/<section class="notif-group"/g) ?? []).length).toBe(3)
      expect((html.match(/<ul class="notif-list">/g) ?? []).length).toBe(3)
      expect(html).toContain('notif-groups')
    } finally { close() }
  })

  it('empty groups render nothing (a user with only info rows gets ONE group)', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'notif-only-info' })
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['p-s', me, 'Only a spark', 'spark', iso(-10 * DAY), iso(-10 * DAY)],
      )
      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/notifications', { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('data-sev="info"')
      expect(html).not.toContain('data-sev="urgent"')
      expect(html).not.toContain('data-sev="warning"')
    } finally { close() }
  })

  it('the caught-up empty state renders when nothing needs attention', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'notif-empty' })
      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/notifications', { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('empty-state')
      expect(html).toContain('All caught up')
      const json = (await (await app.fetch(new Request('http://local/api/notifications?counts=1', { headers: auth }))).json()) as { count: number; urgent: number; warning: number; info: number }
      expect(json).toEqual({ count: 0, urgent: 0, warning: 0, info: 0 })
    } finally { close() }
  })

  it('user-scoped: another user’s overdue work never reaches my counts', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'notif-scope-me' })
      const other = await makeUser(db, { username: 'notif-scope-other' })
      await seedAllKinds(db, other)
      const { app, auth } = await makeClient(db, me)
      const data = (await (await app.fetch(new Request('http://local/api/notifications?counts=1', { headers: auth }))).json()) as { count: number; urgent: number; warning: number; info: number }
      expect(data).toEqual({ count: 0, urgent: 0, warning: 0, info: 0 })
    } finally { close() }
  })
})
