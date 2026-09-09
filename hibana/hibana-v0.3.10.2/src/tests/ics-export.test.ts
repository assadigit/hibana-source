import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { buildIcs, loadIcsEvents } from '../services/ics-export'
import type { Db } from '../db/types'

// ICS calendar export (Session 19, cron round 1). Pins:
//  1. buildIcs() emits RFC 5545 VCALENDAR with correct folding/escaping + stable UIDs.
//  2. loadIcsEvents() is user-scoped (rule 1) — a second user's items never leak.
//  3. GET /api/export/calendar.ics is auth-gated, returns text/calendar, and the body
//     parses as a VCALENDAR with one VEVENT per dated item.
//  4. Undated items are skipped; soft-deleted rows are skipped.

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

const get = (cookie: string, path: string) =>
  new Request('http://local' + path, { headers: { Cookie: cookie } })

const today = () => new Date().toISOString().slice(0, 10)
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

describe('buildIcs (pure RFC 5545 emitter)', () => {
  it('emits a well-formed VCALENDAR with VEVENTs', () => {
    const ics = buildIcs([
      { uid: 'hibana-project-abc@hibana.ir', summary: 'Launch', date: '2026-09-10', url: 'https://hibana.ir/project.html?id=abc' },
      { uid: 'hibana-task-def@hibana.ir', summary: 'Ship ICS', description: 'Task in: Hibana', date: '2026-09-11', categories: 'Hibana' },
    ])
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//Hibana//Personal project manager//EN')
    expect(ics).toContain('X-WR-CALNAME:Hibana')
    // one VEVENT per event
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    // all-day date value, not a datetime
    expect(ics).toContain('DTSTART;VALUE=DATE:20260910')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260911')
    // stable UIDs
    expect(ics).toContain('UID:hibana-project-abc@hibana.ir')
    expect(ics).toContain('UID:hibana-task-def@hibana.ir')
  })

  it('escapes TEXT-valued properties (comma, semicolon, newline, backslash)', () => {
    const ics = buildIcs([
      { uid: 'u1@hibana.ir', summary: 'A, B; C\nD\\E', date: '2026-09-10' },
    ])
    expect(ics).toContain('SUMMARY:A\\, B\\; C\\nD\\\\E')
  })

  it('folds long lines to ≤75 octets with CRLF+space continuation', () => {
    const longSummary = 'x'.repeat(200)
    const ics = buildIcs([{ uid: 'u2@hibana.ir', summary: longSummary, date: '2026-09-10' }])
    // Every physical line (after splitting on CRLF) must be ≤75 octets.
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    }
    // Continuation lines start with a space (the fold char).
    const folded = ics.split('\r\n').filter((l) => l.startsWith(' '))
    expect(folded.length).toBeGreaterThan(0)
  })

  it('skips events with an invalid/missing date', () => {
    const ics = buildIcs([
      { uid: 'ok@hibana.ir', summary: 'Good', date: '2026-09-10' },
      { uid: 'bad@hibana.ir', summary: 'No date', date: '' },
      { uid: 'bad2@hibana.ir', summary: 'Bad date', date: 'not-a-date' },
    ])
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics).toContain('SUMMARY:Good')
  })

  it('uses CRLF line terminators (no bare LF)', () => {
    const ics = buildIcs([{ uid: 'u3@hibana.ir', summary: 'X', date: '2026-09-10' }])
    // Every LF must be part of a CRLF — strip CRLF, no LF should remain.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('loadIcsEvents (user-scoped DB loader)', () => {
  it("returns only the requesting user's dated items", async () => {
    const { db, close } = makeTestDb()
    try {
      const alice = await makeUser(db, { username: 'alice', email: 'a@x.local' })
      const bob = await makeUser(db, { username: 'bob', email: 'b@x.local' })
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), alice, 'Alice project', 'doing', inDays(3), new Date().toISOString(), new Date().toISOString()],
      )
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), bob, 'Bob project', 'doing', inDays(3), new Date().toISOString(), new Date().toISOString()],
      )
      const aEvents = await loadIcsEvents(db, alice, 6)
      const bEvents = await loadIcsEvents(db, bob, 6)
      expect(aEvents.some((e) => e.summary === 'Alice project')).toBe(true)
      expect(aEvents.some((e) => e.summary === 'Bob project')).toBe(false)
      expect(bEvents.some((e) => e.summary === 'Bob project')).toBe(true)
      expect(bEvents.some((e) => e.summary === 'Alice project')).toBe(false)
    } finally {
      close()
    }
  })

  it('skips soft-deleted rows and undated rows', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user, 'Deleted', 'doing', inDays(3), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()],
      )
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user, 'Undated', 'doing', new Date().toISOString(), new Date().toISOString()],
      )
      const events = await loadIcsEvents(db, user, 6)
      expect(events).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('excludes items outside the forward window', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      // 5 months out — inside the 6-month default window
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user, 'Soon', 'doing', inDays(150), new Date().toISOString(), new Date().toISOString()],
      )
      // 2 years out — outside the 6-month window
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user, 'Far', 'doing', inDays(730), new Date().toISOString(), new Date().toISOString()],
      )
      const events = await loadIcsEvents(db, user, 6)
      expect(events.some((e) => e.summary === 'Soon')).toBe(true)
      expect(events.some((e) => e.summary === 'Far')).toBe(false)
    } finally {
      close()
    }
  })
})

describe('GET /api/export/calendar.ics (route)', () => {
  it('is auth-gated (401 without session)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const res = await app.request(get('', '/api/export/calendar.ics'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('returns text/calendar with a VCALENDAR body for an authed user', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user, 'Ship ICS', 'doing', inDays(5), new Date().toISOString(), new Date().toISOString()],
      )
      const { app, cookie } = await makeAuthedApp(db, user)
      const res = await app.request(get(cookie, '/api/export/calendar.ics'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/calendar')
      expect(res.headers.get('content-disposition')).toContain('hibana-calendar-')
      const body = await res.text()
      expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
      expect(body).toContain('SUMMARY:Ship ICS')
      expect(body).toContain('UID:hibana-project-')
      const count = res.headers.get('x-hibana-events')
      expect(Number(count)).toBeGreaterThanOrEqual(1)
    } finally {
      close()
    }
  })

  it('honors the months query param (1..24, clamped)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await db.execute(
        'INSERT INTO projects (id, user_id, title, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), user, 'Far', 'doing', inDays(400), new Date().toISOString(), new Date().toISOString()],
      )
      const { app, cookie } = await makeAuthedApp(db, user)
      // 6-month default → excluded; 24-month → included
      const r6 = await app.request(get(cookie, '/api/export/calendar.ics?months=6'))
      const b6 = await r6.text()
      expect(b6).not.toContain('SUMMARY:Far')
      const r24 = await app.request(get(cookie, '/api/export/calendar.ics?months=24'))
      const b24 = await r24.text()
      expect(b24).toContain('SUMMARY:Far')
    } finally {
      close()
    }
  })
})
