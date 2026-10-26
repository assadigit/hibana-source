import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { runSadhanaReminders } from '../services/sadhana'
import { loadIcsEvents } from '../services/ics-export'
import type { Db } from '../db/types'
import type { Config } from '../types'

// Phase 2 date-logic fixes (auditors P2-a F1/F2/F5, P2-c F1/F4):
//   AP-24 — /api/reports/activity week/month/year buckets matched events by the
//            bucket's anniversary DAY only (a month row counted events on the
//            month-start day, nothing else), and setUTCMonth on day 29-31 rolled
//            into duplicate/skipped month keys.
//   AP-25 — the sadhana "2h before deadline" reminder compared the run clock in
//            UTC against due_time in the USER's local wall clock: for +03:30 the
//            window sat 1.5-3.5h AFTER the deadline (fired late or post-deadline).
//   AP-26 — notifications' today/weekAhead and rail's due-soon window used the UTC
//            day, while every sibling surface uses todayIn(user.timezone): between
//            00:00-03:30 Tehran an overdue item counted as "upcoming" instead.
//   ICS    — months*30-day windows dropped events in the tail days of long months.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, telegramToken: 'test-bot', telegramSecret: 's' }
}

async function makeClient(db: Db, userId?: string) {
  const app = createApp(makeConfig(db))
  const cookie = userId ? `__Host-hibana_session=${await createSession(db, userId)}` : ''
  return { app, auth: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

const insertProject = async (db: Db, uid: string, over: Partial<{ title: string; status: string; type: string; due_date: string; created_at: string }> = {}) => {
  const id = crypto.randomUUID()
  await db.execute(
    "INSERT INTO projects (id, user_id, title, status, type, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, uid, over.title ?? 'p', over.status ?? 'developing', over.type ?? 'client', over.due_date ?? null, over.created_at ?? new Date().toISOString(), over.created_at ?? new Date().toISOString()],
  )
  return id
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AP-24 — /api/reports/activity buckets aggregate their full RANGE', () => {
  it('month rows count every event in the month, not just the anniversary day', async () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      await insertProject(db, uid, { created_at: '2026-10-01T09:00:00Z' }) // month start
      await insertProject(db, uid, { created_at: '2026-10-15T10:00:00Z' }) // mid-month
      const res = await app.fetch(new Request('http://local/api/reports/activity?granularity=month', { headers: auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: { key: string; label: string; projectsCreated: number }[] }
      const oct = body.rows.find((r) => r.label === '2026-10')
      expect(oct).toBeDefined()
      expect(oct!.projectsCreated).toBe(2) // old: 1 (only the day-15 anniversary matched)
    } finally {
      close()
    }
  })

  it('week rows count all 7 days of their window', async () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z')) // Thursday
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const pid = await insertProject(db, uid, {})
      for (const day of ['2026-10-13', '2026-10-12', '2026-10-11']) {
        await db.execute("INSERT INTO hurdles (id, project_id, text, status, sort_order, solved_at, created_at) VALUES (?, ?, 'h', 'solved', 0, ?, ?)", [
          crypto.randomUUID(), pid, `${day}T18:00:00Z`, `${day}T09:00:00Z`,
        ])
      }
      const res = await app.fetch(new Request('http://local/api/reports/activity?granularity=week', { headers: auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: { key: string; hurdlesCompleted: number }[] }
      // the week containing Oct 8-14 (key anchored at its start)
      const week = body.rows.find((r) => r.key === '2026-10-08')
      expect(week).toBeDefined()
      expect(week!.hurdlesCompleted).toBe(3) // old: 0 (only an Oct-8 event would match)
    } finally {
      close()
    }
  })

  it('12 month buckets are 12 DISTINCT consecutive months even when today is day 31', async () => {
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const res = await app.fetch(new Request('http://local/api/reports/activity?granularity=month', { headers: auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { rows: { label: string }[] }
      const labels = body.rows.map((r) => r.label)
      expect(new Set(labels).size).toBe(12) // old: setUTCMonth rollover duplicates months
      expect(labels).toContain('2026-10')
      expect(labels).toContain('2025-11')
      expect(labels).not.toContain('2026-10\u0000dup')
    } finally {
      close()
    }
  })
})

describe('AP-25 — the 2h-before-deadline reminder runs in the USER\'s timezone', () => {
  async function seedTehranTask(db: Db) {
    const uid = await makeUser(db)
    await db.execute('UPDATE users SET timezone = ?, telegram_chat_id = ? WHERE id = ?', ['Asia/Tehran', '111', uid])
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, due_date, due_time, done, deleted_at, cleared_at, recurring, recur_type, recur_config, recur_last, position, created_at, updated_at)
       VALUES (?, ?, 1, 'tehran deadline', '📌', '2026-10-26', '10:00', 0, NULL, NULL, 0, NULL, '', NULL, 0, ?, ?)`,
      [id, uid, now, now],
    )
    return uid
  }

  it('fires exactly 2h before a 10:00 Tehran deadline when the UTC clock reads 04:30 (08:00 Tehran)', async () => {
    vi.setSystemTime(new Date('2026-10-26T04:30:00Z'))
    const { db, close } = makeTestDb()
    try {
      await seedTehranTask(db)
      const sent: string[] = []
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('api.telegram.org/bot')) {
          sent.push(JSON.parse(String(init?.body)).text as string)
          return new Response('{"ok":true}')
        }
        return new Response('{}')
      }) as typeof fetch)
      await runSadhanaReminders(makeConfig(db))
      const kinds = await db.query<{ kind: string }>('SELECT kind FROM sadhana_reminder_logs')
      expect(kinds.map((k) => k.kind)).toContain('2h') // old: UTC 270min missed the [480,600) window
    } finally {
      close()
    }
  })

  it('never fires AFTER the deadline: 09:00 UTC is 12:30 Tehran — past a 10:00 deadline', async () => {
    vi.setSystemTime(new Date('2026-10-26T09:00:00Z'))
    const { db, close } = makeTestDb()
    try {
      await seedTehranTask(db)
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).includes('api.telegram.org/bot')) return new Response('{"ok":true}')
        return new Response('{}')
      }) as typeof fetch)
      await runSadhanaReminders(makeConfig(db))
      const kinds = await db.query<{ kind: string }>('SELECT kind FROM sadhana_reminder_logs')
      expect(kinds.map((k) => k.kind)).not.toContain('2h') // old: UTC 540min sat inside [480,600) → fired post-deadline
    } finally {
      close()
    }
  })
})

describe('AP-26 — notifications windows use the user\'s timezone day', () => {
  it('at 21:00 UTC (00:30 Tehran next day) an Oct-26 deadline is OVERDUE, not upcoming', async () => {
    vi.setSystemTime(new Date('2026-10-26T21:00:00Z'))
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      await db.execute('UPDATE users SET timezone = ? WHERE id = ?', ['Asia/Tehran', uid])
      await insertProject(db, uid, { due_date: '2026-10-26' })
      const { app, auth } = await makeClient(db, uid)
      const res = await app.fetch(new Request('http://local/api/notifications', { headers: auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { notifications: { kind: string; detail: string }[] }
      const kinds = body.notifications.map((n) => `${n.kind}:${n.detail}`)
      expect(kinds).toContain('overdue-project:p')
      expect(kinds).not.toContain('upcoming-deadline:p') // old: UTC day = Oct 26 → still "upcoming"
    } finally {
      close()
    }
  })
})

describe('ICS export — month windows use real calendar months, not 30-day approximations', () => {
  it('a 6-month window from Oct 31 covers events through the end of April (not Apr 29)', async () => {
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      await insertProject(db, uid, { due_date: '2027-04-30' })
      const events = await loadIcsEvents(db, uid, 'https://hibana.example', 6)
      expect(events.some((e) => e.summary === 'p')).toBe(true) // old: +180d = Apr 29 → dropped
    } finally {
      close()
    }
  })
})
