import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S196 (Track A coverage-gap audit): GET /api/timeline/on-this-day was the ONE
// feed endpoint with zero coverage anywhere (unit or e2e — reports-heatmap covers
// /heatmap, reports-tasks covers /activity-adjacent shapes, but nothing pinned this
// route). It's read-only but it OWNS three contracts worth guarding:
//   1. the auth gate (401 unauthenticated);
//   2. user-scoping (Rule 1 — another user's same-day items must never leak);
//   3. the window math: items land in the "1 week/1 month/3 months/1 year ago"
//      bucket whose target DATE they were touched on (substr(updated_at,1,10) match),
//      soft-deleted rows drop out, empty windows are omitted entirely.
// The route derives its target dates from Date.now(), so the seeds use EXACT
// offsets (7/30/90/365 days ago, truncated to the UTC date) — deterministic on any
// clock that doesn't cross a date boundary mid-test (the ±1s noise never moves the
// UTC date in practice; the targets are whole-day truncated).

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `__Host-hibana_session=${token}` } }
}

type Window = { label: string; items: { id: string; kind: string; title: string; href: string }[] }
type Payload = { windows: Window[] }

const dayMs = 24 * 3600 * 1000
/** UTC date (YYYY-MM-DD) exactly N days ago — the route's own window-target math. */
const dateAgo = (days: number): string => new Date(Date.now() - days * dayMs).toISOString().slice(0, 10)

describe('GET /api/timeline/on-this-day (S196 coverage-gap close)', () => {
  it('401 without a session', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const res = await app.fetch(new Request('http://local/api/timeline/on-this-day'))
      expect(res.status).toBe(401)
    } finally { close() }
  })

  it('sorts items into the exact "N ago" window by their touched date, soft-deletes drop, and other users never leak', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'me' })
      const other = await makeUser(db, { username: 'other' })
      const now = new Date().toISOString()
      // One project per window target + one on TODAY (no window targets today → must
      // not appear anywhere) + one soft-deleted on the 7-day target + another user's
      // project on the 30-day target.
      const seed = (id: string, userId: string, touched: string) =>
        db.execute(
          'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, userId, `Project ${id}`, 'developing', touched, touched],
        )
      await seed('w1', me, dateAgo(7) + 'T10:00:00.000Z')
      await seed('m1', me, dateAgo(30) + 'T10:00:00.000Z')
      await seed('q1', me, dateAgo(90) + 'T10:00:00.000Z')
      await seed('y1', me, dateAgo(365) + 'T10:00:00.000Z')
      await seed('today', me, now)
      await seed('gone', me, dateAgo(7) + 'T12:00:00.000Z')
      await db.execute("UPDATE projects SET deleted_at = ? WHERE id = 'gone'", [now])
      await seed('other30', other, dateAgo(30) + 'T11:00:00.000Z')
      // a sadhana task + a quick note on the 7-day target join the same window
      await db.execute(
        'INSERT INTO sadhana_tasks (id, user_id, quadrant, title, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['s1', me, 4, 'Sadhana s1', 0, dateAgo(7) + 'T09:00:00.000Z', dateAgo(7) + 'T09:00:00.000Z'],
      )
      await db.execute(
        'INSERT INTO quick_notes (id, user_id, content, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['n1', me, 'note one', 'note', dateAgo(7) + 'T08:00:00.000Z', dateAgo(7) + 'T08:00:00.000Z'],
      )

      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/timeline/on-this-day', { headers: auth }))
      expect(res.status).toBe(200)
      const payload = (await res.json()) as Payload
      const byLabel = new Map(payload.windows.map((w) => [w.label, w.items.map((i) => i.id)]))

      // four windows, in the route's order (1 week → 1 month → 3 months → 1 year)
      expect(payload.windows.map((w) => w.label)).toEqual(['1 week ago', '1 month ago', '3 months ago', '1 year ago'])
      expect(byLabel.get('1 week ago')).toEqual(['w1', 's1', 'n1']) // soft-deleted 'gone' + 'today' absent
      expect(byLabel.get('1 month ago')).toEqual(['m1']) // 'other30' (Rule 1) + 'today' never leak
      expect(byLabel.get('3 months ago')).toEqual(['q1'])
      expect(byLabel.get('1 year ago')).toEqual(['y1'])
      // the item shapes carry the right hrefs per kind
      const week = payload.windows[0]
      const shapes = new Map(week.items.map((i) => [i.id, i]))
      expect(shapes.get('w1')?.href).toBe('/project.html?id=w1')
      expect(shapes.get('s1')?.href).toBe('/to-do-list')
      expect(shapes.get('n1')?.href).toBe('/dashboard.html')
      expect(shapes.get('n1')?.title).toBe('note one')
    } finally { close() }
  })

  it('an empty history returns an empty windows array (not a null / 500)', async () => {
    const { db, close } = makeTestDb()
    try {
      const me = await makeUser(db, { username: 'fresh' })
      const { app, auth } = await makeClient(db, me)
      const res = await app.fetch(new Request('http://local/api/timeline/on-this-day', { headers: auth }))
      expect(res.status).toBe(200)
      const payload = (await res.json()) as Payload
      expect(payload.windows).toEqual([])
    } finally { close() }
  })
})
