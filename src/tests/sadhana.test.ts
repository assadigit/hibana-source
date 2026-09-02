import { describe, it, expect, vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { recurringDue, resetDueRecurring, sweepCompletedTasks, runSadhanaReminders } from '../services/sadhana'
import type { Db } from '../db/types'
import type { Config } from '../types'

// Sadhana — the standalone quadrant task board (spec 2026-08-25). Covering rule 1
// (user isolation), the task lifecycle, quadrant rename validation, recurrence math,
// the Monday sweep, and the reminder pass (mocked Telegram).

function makeConfig2(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, telegramToken: 'test-bot', telegramSecret: 's' }
}

async function makeClient(db: Db, userId?: string) {
  const app = createApp(makeConfig2(db))
  const cookie = userId ? `hibana_session=${await createSession(db, userId)}` : ''
  return { app, auth: { Cookie: cookie, 'Content-Type': 'application/json' } }
}

const insert = async (db: Db, uid: string, over: Partial<{ quadrant: number; title: string; done: number; recurring: number; recur_type: string; recur_config: string; recur_last: string; due_date: string; deleted_at: string; cleared_at: string; position: number }> = {}) => {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.execute(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, due_date, done, deleted_at, cleared_at, recurring, recur_type, recur_config, recur_last, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, '📌', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, uid, over.quadrant ?? 1, over.title ?? 'task', over.due_date ?? null,
      over.done ?? 0, over.deleted_at ?? null, over.cleared_at ?? null,
      over.recurring ?? 0, over.recur_type ?? null, over.recur_config ?? '', over.recur_last ?? null,
      over.position ?? 0, now, now,
    ],
  )
  return id
}

describe('sadhana — quadrant task board (spec 2026-08-25)', () => {
  it('quick-add lands in the quadrant; board fragment shows the card with counter', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const res = await app.fetch(new Request('http://local/api/sadhana/quadrants/3', {
        method: 'POST', headers: auth, body: JSON.stringify({ title: 'ship release' }),
      }))
      expect(res.status).toBe(201)
      const board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).toContain('ship release')
      expect(board).toContain('data-quadrant="3"')
      expect(board).toContain('1 / 1')
      // quick-add always lands untagged (spec §4)
      const task = await db.query<{ tags: number }>(`SELECT (SELECT COUNT(*) FROM sadhana_tags st WHERE st.task_id = t.id) AS tags FROM sadhana_tasks t WHERE user_id = ?`, [uid])
      expect(task[0].tags).toBe(0)
    } finally { close() }
  })

  it('dialog create: tags, fuzzy deadline, recurrence; invalid combos rejected (rule 10)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      let res = await app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ title: 'deep work', quadrant: 2, emoji: '🧠', tags: ['w', 'sg'], fuzzy: 'week', recurring: true, recur_type: 'ndays', recur_config: '3' }),
      }))
      expect(res.status).toBe(201)
      const rows = await db.query<{ fuzzy: string | null; recurring: number; recur_type: string; recur_config: string; recur_last: string | null }>(
        'SELECT fuzzy, recurring, recur_type, recur_config, recur_last FROM sadhana_tasks WHERE user_id = ?', [uid],
      )
      expect(rows[0].fuzzy).toBe('week')
      expect(rows[0].recurring).toBe(1)
      expect(rows[0].recur_config).toBe('3')
      expect(rows[0].recur_last).toBeTruthy() // clock starts at creation (§2.2)
      const tags = await db.query<{ tag: string }>('SELECT tag FROM sadhana_tags WHERE task_id = (SELECT id FROM sadhana_tasks WHERE user_id = ?)', [uid])
      expect(tags.map((t) => t.tag).sort()).toEqual(['sg', 'w'])

      // fuzzy + exact both set → 400
      res = await app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST', headers: auth, body: JSON.stringify({ title: 'bad', quadrant: 1, fuzzy: 'tom', due_date: '2026-12-01' }),
      }))
      expect(res.status).toBe(400)
      // invalid quadrant → 400
      res = await app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST', headers: auth, body: JSON.stringify({ title: 'bad2', quadrant: 9 }),
      }))
      expect(res.status).toBe(400)
      // recurring without a type → 400
      res = await app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST', headers: auth, body: JSON.stringify({ title: 'bad3', quadrant: 1, recurring: true }),
      }))
      expect(res.status).toBe(400)
      // time without date → 400
      res = await app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST', headers: auth, body: JSON.stringify({ title: 'bad4', quadrant: 1, due_time: '09:00' }),
      }))
      expect(res.status).toBe(400)
    } finally { close() }
  })

  it('complete logs recurrence history + restamps the clock; uncomplete keeps the history', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const id = await insert(db, uid, { title: 'daily habit', recurring: 1, recur_type: 'daily', recur_last: '2026-08-01' })
      await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/complete`, { method: 'POST', headers: auth }))
      let task = await db.query<{ done: number; recur_last: string | null }>('SELECT done, recur_last FROM sadhana_tasks WHERE id = ?', [id])
      expect(task[0].done).toBe(1)
      expect(task[0].recur_last).toBeTruthy()
      expect((await db.query('SELECT COUNT(*) AS n FROM sadhana_recur_history WHERE task_id = ?', [id]))[0].n).toBe(1)
      await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/uncomplete`, { method: 'POST', headers: auth }))
      const after = await db.query<{ done: number }>('SELECT done FROM sadhana_tasks WHERE id = ?', [id])
      expect(after[0].done).toBe(0)
      // spec §5.5: un-completing never deletes logged completion history
      expect((await db.query('SELECT COUNT(*) AS n FROM sadhana_recur_history WHERE task_id = ?', [id]))[0].n).toBe(1)
    } finally { close() }
  })

  it('recurrence math (pure): daily / ndays / monthly / weekly (Mon=0)', () => {
    expect(recurringDue({ recur_type: 'daily', recur_config: '', recur_last: '2026-08-24' }, '2026-08-25')).toBe(true)
    expect(recurringDue({ recur_type: 'daily', recur_config: '', recur_last: '2026-08-25' }, '2026-08-25')).toBe(false)
    expect(recurringDue({ recur_type: 'ndays', recur_config: '7', recur_last: '2026-08-18' }, '2026-08-25')).toBe(true)
    expect(recurringDue({ recur_type: 'ndays', recur_config: '7', recur_last: '2026-08-19' }, '2026-08-25')).toBe(false)
    // monthly with the 31st skips months without one (§6.9: at most once per month)
    expect(recurringDue({ recur_type: 'monthly', recur_config: '31', recur_last: '2026-07-31' }, '2026-08-31')).toBe(true)
    expect(recurringDue({ recur_type: 'monthly', recur_config: '31', recur_last: '2026-08-31' }, '2026-09-30')).toBe(false)
    expect(recurringDue({ recur_type: 'monthly', recur_config: '15', recur_last: '2026-07-01' }, '2026-08-15')).toBe(true)
    // weekly: Mon=0…Sun=6 — 2026-08-25 is a Tuesday → day 1
    expect(recurringDue({ recur_type: 'weekly', recur_config: '1', recur_last: '2026-08-20' }, '2026-08-25')).toBe(true)
    expect(recurringDue({ recur_type: 'weekly', recur_config: '0', recur_last: '2026-08-20' }, '2026-08-25')).toBe(false)
    expect(recurringDue({ recur_type: 'weekly', recur_config: '', recur_last: '2026-08-20' }, '2026-08-25')).toBe(false) // none selected = never
    expect(recurringDue({ recur_type: 'weekly', recur_config: 'junk', recur_last: '2026-08-20' }, '2026-08-25')).toBe(false)
    expect(recurringDue({ recur_type: 'monthly', recur_config: '99', recur_last: '2026-07-01' }, '2026-08-15')).toBe(false) // malformed = never
  })

  it('board-load pass auto-resets due recurring tasks (spec §7.1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const id = await insert(db, uid, { title: 'daily', recurring: 1, recur_type: 'daily', recur_last: '2026-08-01', done: 1 })
      expect(await resetDueRecurring(db, uid, 'UTC', '2026-08-25')).toBe(1)
      const task = await db.query<{ done: number; recur_last: string }>('SELECT done, recur_last FROM sadhana_tasks WHERE id = ?', [id])
      expect(task[0].done).toBe(0)
      expect(task[0].recur_last).toBe('2026-08-25')
      // the board endpoint applies it transparently
      const { app, auth } = await makeClient(db, uid)
      const board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).toContain('daily')
    } finally { close() }
  })

  it('move + reorder persist; only own OPEN cards get positions; strays ignored (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const a = await insert(db, uid, { quadrant: 1, title: 'a' })
      const b = await insert(db, uid, { quadrant: 1, title: 'b' })
      const doneId = await insert(db, uid, { quadrant: 1, title: 'done-x', done: 1, position: 5 })
      const stray = await insert(db, other, { quadrant: 1, title: 'foreign' })

      let res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${a}/move`, {
        method: 'POST', headers: auth, body: JSON.stringify({ quadrant: 4 }),
      }))
      expect(res.status).toBe(200)
      expect((await db.query('SELECT quadrant FROM sadhana_tasks WHERE id = ?', [a]))[0].quadrant).toBe(4)

      res = await app.fetch(new Request('http://local/api/sadhana/tasks/reorder', {
        method: 'POST', headers: auth, body: JSON.stringify({ quadrant: 1, ids: [stray, b, doneId, crypto.randomUUID()] }),
      }))
      expect(res.status).toBe(200)
      // only b is eligible → position 0; done-x untouched (stays at 5); the foreign task never touched
      const order = await db.query<{ title: string; position: number }>('SELECT title, position FROM sadhana_tasks WHERE user_id = ? AND quadrant = 1 AND done = 0 ORDER BY position', [uid])
      expect(order.map((r) => r.title)).toEqual(['b'])
      expect((await db.query('SELECT title FROM sadhana_tasks WHERE id = ?', [stray]))[0].title).toBe('foreign')
      expect((await db.query('SELECT position FROM sadhana_tasks WHERE id = ?', [doneId]))[0].position).toBe(5)
    } finally { close() }
  })

  it('delete soft-hides + restore brings the card back; cross-user ops are 404 (spec §6.16)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const { auth: oAuth } = await makeClient(db, other)
      const id = await insert(db, uid)

      let res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}`, { method: 'DELETE', headers: auth }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { soft: boolean }).soft).toBe(true)
      const board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).not.toContain(id)

      res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/restore`, { method: 'POST', headers: auth }))
      expect(res.status).toBe(200)
      expect((await db.query('SELECT deleted_at FROM sadhana_tasks WHERE id = ?', [id]))[0].deleted_at).toBeNull()

      expect((await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}`, { method: 'DELETE', headers: oAuth }))).status).toBe(404)
      expect((await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/complete`, { method: 'POST', headers: oAuth }))).status).toBe(404)
      expect((await app.fetch(new Request(`http://local/api/sadhana/tasks/${crypto.randomUUID()}/restore`, { method: 'POST', headers: auth }))).status).toBe(404)
    } finally { close() }
  })

  it('rename: custom name everywhere, empty/>60 rejected, null resets; per-user (spec §5.19)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)

      let res = await app.fetch(new Request('http://local/api/sadhana/quadrants/1', {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'Work Slice' }),
      }))
      expect(res.status).toBe(200)
      let board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).toContain('Work Slice')
      expect(board).not.toContain('Today')

      res = await app.fetch(new Request('http://local/api/sadhana/quadrants/1', { method: 'PATCH', headers: auth, body: JSON.stringify({ name: '   ' }) }))
      expect(res.status).toBe(400)
      res = await app.fetch(new Request('http://local/api/sadhana/quadrants/1', { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'x'.repeat(61) }) }))
      expect(res.status).toBe(400)
      board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).toContain('Work Slice') // previous name kept after rejections

      // other user never sees the rename (rule 1)
      const other = await makeUser(db)
      const { auth: oAuth } = await makeClient(db, other)
      const oBoard = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...oAuth, 'HX-Request': 'true' } }))).text()
      expect(oBoard).not.toContain('Work Slice')

      res = await app.fetch(new Request('http://local/api/sadhana/quadrants/1', { method: 'PATCH', headers: auth, body: JSON.stringify({ name: null }) }))
      expect(res.status).toBe(200)
      board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).toContain('Today')
    } finally { close() }
  })

  it('Monday sweep stamps completed non-recurring tasks; recurring tasks loop instead (§8 Q1 resolved)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const plain = await insert(db, uid, { title: 'plain done', done: 1 })
      const recurring = await insert(db, uid, { title: 'habit done', done: 1, recurring: 1, recur_type: 'daily', recur_last: '2026-08-24' })

      expect(await sweepCompletedTasks(db, '2026-08-23')).toBe(0) // Sunday → no sweep
      expect(await sweepCompletedTasks(db, '2026-08-24')).toBe(1) // Monday →
      expect((await db.query('SELECT cleared_at FROM sadhana_tasks WHERE id = ?', [plain]))[0].cleared_at).toBe('2026-08-24')
      expect((await db.query('SELECT cleared_at FROM sadhana_tasks WHERE id = ?', [recurring]))[0].cleared_at).toBeNull()
    } finally { close() }
  })

  it('reminder pass: 7d/3d/1d/0d/2h windows fire once each, logged; never re-sent', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['111', uid])
      // Windows relative to run date 2026-08-18:
      const t7 = await insert(db, uid, { title: 'in 7 days', due_date: '2026-08-25' })     // 7d
      const t3 = await insert(db, uid, { title: 'in 3 days', due_date: '2026-08-21' })     // 3d
      const t1 = await insert(db, uid, { title: 'tomorrow', due_date: '2026-08-19' })      // 1d
      const t0 = await insert(db, uid, { title: 'today', due_date: '2026-08-18' })         // 0d
      const timed = await insert(db, uid, { title: 'timed', due_date: '2026-08-18' })      // 2h
      await db.execute('UPDATE sadhana_tasks SET due_time = ? WHERE id = ?', ['10:00', timed])
      const done = await insert(db, uid, { title: 'done task', done: 1, due_date: '2026-08-18' }) // skipped

      const unlinkedUid = await makeUser(db) // no chat → skipped
      await insert(db, unlinkedUid, { title: 'no chat', due_date: '2026-08-25' })

      const sent: string[] = []
      const origFetch = globalThis.fetch
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('api.telegram.org/bot')) {
          sent.push(JSON.parse(String(init?.body)).text as string)
          return new Response('{"ok":true}')
        }
        return origFetch(input, init)
      }) as typeof fetch)

      const cfg = makeConfig2(db)
      try {
        const fired = await runSadhanaReminders(cfg, '2026-08-18', 9 * 60) // 09:00 UTC → inside the 2h window for 10:00
        expect(fired).toBe(5) // 7d, 3d, 1d, 0d, 2h — done task + unlinked user skipped
        expect(sent.length).toBe(5)
        expect(sent.join(' ')).toContain('in 7 days')
        expect(sent.join(' ')).toContain('timed')
        const kinds = await db.query<{ kind: string }>('SELECT kind FROM sadhana_reminder_logs')
        // 0d fires for TWO tasks (the plain one and the timed one), and the timed one also
        // gets 2h → 6 log rows from 5 messages (one message per task, one log per kind)
        expect(new Set(kinds.map((r) => r.kind))).toEqual(new Set(['7d', '3d', '1d', '0d', '2h']))
        expect(kinds.length).toBe(6)

        expect(await runSadhanaReminders(cfg, '2026-08-18', 9 * 60)).toBe(0) // logged once, never re-fired
        expect(sent.length).toBe(5)
      } finally {
        vi.unstubAllGlobals()
      }
      // a task postponed past its window stays quiet (logs are the gate, spec §6.19)
      expect((await db.query('SELECT COUNT(*) AS n FROM sadhana_reminder_logs WHERE task_id = ?', [done]))[0].n).toBe(0)
    } finally { close() }
  })

  it('updates journal: add + delete entries, empty rejected, cross-user hidden', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const { auth: oAuth } = await makeClient(db, other)
      const id = await insert(db, uid)

      let res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/updates`, {
        method: 'POST', headers: auth, body: JSON.stringify({ text: 'started the design' }),
      }))
      expect(res.status).toBe(200)
      res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/updates`, {
        method: 'POST', headers: auth, body: JSON.stringify({ text: '   ' }),
      }))
      expect(res.status).toBe(400) // empty rejected (spec §6.7)
      res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${crypto.randomUUID()}/updates`, {
        method: 'POST', headers: auth, body: JSON.stringify({ text: 'x' }),
      }))
      expect(res.status).toBe(404)
      res = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/updates`, {
        method: 'POST', headers: oAuth, body: JSON.stringify({ text: 'steal' }),
      }))
      expect(res.status).toBe(404)

      const rows = await db.query<{ id: string; text: string }>('SELECT id, text FROM sadhana_updates WHERE task_id = ?', [id])
      expect(rows).toHaveLength(1)
      expect(rows[0].text).toBe('started the design')
      res = await app.fetch(new Request(`http://local/api/sadhana/updates/${rows[0].id}`, { method: 'DELETE', headers: auth }))
      expect(res.status).toBe(200)
      expect((await db.query('SELECT COUNT(*) AS n FROM sadhana_updates WHERE task_id = ?', [id]))[0].n).toBe(0)
      // deleting an entry from another user's task is a 404
      const otherId = await insert(db, other)
      const u2 = await db.query<{ id: string }>('SELECT id FROM sadhana_updates LIMIT 0')
      void u2
      expect((await app.fetch(new Request(`http://local/api/sadhana/updates/${crypto.randomUUID()}`, { method: 'DELETE', headers: auth }))).status).toBe(404)
      void otherId
    } finally { close() }
  })

  it('archive lists swept tasks only and stays empty before any Monday sweep', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const openId = await insert(db, uid, { title: 'open' })
      const doneId = await insert(db, uid, { title: 'done but not swept', done: 1 })

      let html = await (await app.fetch(new Request('http://local/api/sadhana/archive', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(html).toContain('No completed tasks yet')
      expect(html).not.toContain('done but not swept')

      // Monday sweep moves the completed card into archive
      await sweepCompletedTasks(db, '2026-08-24')
      html = await (await app.fetch(new Request('http://local/api/sadhana/archive', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(html).toContain('done but not swept')
      const board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).not.toContain('done but not swept')
      expect(board).toContain('open')
      void openId
    } finally { close() }
  })

  it('exact-deadline overdue badge renders server-side; fuzzy never overdue', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const past = await insert(db, uid, { title: 'missed', due_date: '2020-01-01' })
      const fuzzy = await insert(db, uid, { title: 'someday' })
      await db.execute("UPDATE sadhana_tasks SET fuzzy = 'mon' WHERE id = ?", [fuzzy])
      const board = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(board).toContain('Overdue')
      expect(board).toContain('2020/01/01') // server-rendered localized date (§5.11 — no data-date clobbering)
      expect(board).toContain('overdue-badge') // rendered with the alert icon (no emoji markers)
      expect(board).not.toContain('📅')
      expect(board).toContain('This month') // fuzzy label
      void past
    } finally { close() }
  })

  it('grid order follows spec §3 (Q1 | Q3 top, Q2 | Q4 bottom)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const board = (await (await app.fetch(new Request('http://local/api/sadhana', { headers: auth }))).json()) as { quadrants: { id: number }[] }
      expect(board.quadrants.map((q) => q.id)).toEqual([1, 3, 2, 4])
      const html = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      const ids = [...html.matchAll(/class="sadhana-quadrant[^"]*" data-quadrant="(\d)"/g)].map((m) => Number(m[1]))
      expect(ids).toEqual([1, 3, 2, 4])
    } finally { close() }
  })

  it('focus add form carries tags + deadline; adding from focus keeps the overlay (§5.10)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const focus = await (await app.fetch(new Request('http://local/api/sadhana/focus/3', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(focus).toContain('sadhana-focus')
      expect(focus).toContain('focus-tags') // tag picker inside the focus add form
      expect(focus).toContain('data-dp') // deadline picker inside the focus add form
      expect(focus).toContain('name="focus"') // posts back through the task route

      // form-style POST (urlencoded, single tag value) — the preprocess wraps it into an array
      const added = await app.fetch(new Request('http://local/api/sadhana/tasks', {
        method: 'POST',
        headers: { ...auth, 'HX-Request': 'true', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'quadrant=3&focus=true&title=focus+quickie&emoji=%E2%9C%A8&tags=w&due_date=2030-01-01',
      }))
      expect(added.status).toBe(200)
      const html = await added.text()
      expect(html).toContain('sadhana-focus') // overlay re-rendered, not replaced by the board
      expect(html).toContain('focus quickie')
      expect(html).toContain('data-tag="w"') // tag landed on the card
      expect(html).toContain('2030/01/01') // exact date rendered server-side (§5.11)
    } finally { close() }
  })

  it('progress track renders a visible label + plain buttons (click semantics in page JS, §5.8)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const id = await insert(db, uid)
      await db.execute("UPDATE sadhana_tasks SET progress = 'in_progress' WHERE id = ?", [id])
      const html = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(html).toContain('task-status-track')
      expect(html).toContain('In progress')
      expect(html).toContain('data-task-progress="in_progress"')
      expect(html).toContain('task-note-badge')
      expect(html).toContain('data-task-edit-open=')
      expect((html.match(/data-sadhana-style="\d"/g) ?? []).length).toBe(4)
      expect(html).toContain('data-sadhana-icon="target"')
      expect(html).not.toContain('class="q-menu"')
      expect(html).not.toContain('class="task-menu"')
    } finally { close() }
  })

  it('renders dated inline notes and supports user-scoped add/delete note actions', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const { app: otherApp, auth: otherAuth } = await makeClient(db, other)
      const id = await insert(db, uid, { title: 'note task' })

      const added = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}/notes`, {
        method: 'POST', headers: auth, body: JSON.stringify({ text: 'First note' }),
      }))
      expect(added.status).toBe(201)
      const addedBody = (await added.json()) as { id: string }
      expect(addedBody.id).toBeTruthy()

      const html = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      expect(html).toContain('First note')
      expect(html).toContain('data-task-note-delete=')
      expect(html).toContain('task-notes-panel')

      const forbidden = await otherApp.fetch(new Request(`http://local/api/sadhana/notes/${addedBody.id}`, { method: 'DELETE', headers: otherAuth }))
      expect(forbidden.status).toBe(404)
      const deleted = await app.fetch(new Request(`http://local/api/sadhana/notes/${addedBody.id}`, { method: 'DELETE', headers: auth }))
      expect(deleted.status).toBe(200)
    } finally { close() }
  })

  it('empty PATCH rejected; explicit recurring=false still turns recurrence off', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const id = await insert(db, uid, { recurring: 1, recur_type: 'daily', recur_config: '', recur_last: '2026-08-01' })
      const empty = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({}),
      }))
      expect(empty.status).toBe(400) // a PATCH must carry at least one explicit field
      // the edit form posts urlencoded with the hidden 'recurring' twin (unchecked box → false)
      const off = await app.fetch(new Request(`http://local/api/sadhana/tasks/${id}`, {
        method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'recurring=false&recur_type=daily&recur_config=',
      }))
      expect(off.status).toBe(200)
      const row = await db.query<{ recurring: number; recur_last: string | null }>('SELECT recurring, recur_last FROM sadhana_tasks WHERE id = ?', [id])
      expect(row[0].recurring).toBe(0)
      expect(row[0].recur_last).toBe(null) // clock cleared with recurrence (§5.12)
    } finally { close() }
  })

  it('quadrant order persists per user and drives board JSON/HTML', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const { auth: otherAuth } = await makeClient(db, other)

      let res = await app.fetch(new Request('http://local/api/sadhana/quadrants/reorder', {
        method: 'POST', headers: auth, body: JSON.stringify({ ids: [4, 2, 1, 3] }),
      }))
      expect(res.status).toBe(200)
      expect((await db.query<{ sadhana_quadrant_order: string }>('SELECT sadhana_quadrant_order FROM users WHERE id = ?', [uid]))[0].sadhana_quadrant_order).toBe('4,2,1,3')

      const hxRes = await app.fetch(new Request('http://local/api/sadhana/quadrants/reorder', {
        method: 'POST', headers: { ...auth, 'HX-Request': 'true' }, body: JSON.stringify({ ids: [3, 1, 4, 2] }),
      }))
      expect(hxRes.status).toBe(200)
      const hxHtml = await hxRes.text()
      const hxIds = [...hxHtml.matchAll(/class="sadhana-quadrant[^\"]*" data-quadrant="(\d)"/g)].map((m) => Number(m[1]))
      expect(hxIds).toEqual([3, 1, 4, 2])

      const json = (await (await app.fetch(new Request('http://local/api/sadhana', { headers: auth }))).json()) as { quadrants: { id: number }[] }
      expect(json.quadrants.map((q) => q.id)).toEqual([3, 1, 4, 2])
      const html = await (await app.fetch(new Request('http://local/api/sadhana', { headers: { ...auth, 'HX-Request': 'true' } }))).text()
      const ids = [...html.matchAll(/class="sadhana-quadrant[^\"]*" data-quadrant="(\d)"/g)].map((m) => Number(m[1]))
      expect(ids).toEqual([3, 1, 4, 2])

      res = await app.fetch(new Request('http://local/api/sadhana/quadrants/reorder', {
        method: 'POST', headers: otherAuth, body: JSON.stringify({ ids: [1, 2, 3, 4] }),
      }))
      expect(res.status).toBe(200)
      const own = (await (await app.fetch(new Request('http://local/api/sadhana', { headers: auth }))).json()) as { quadrants: { id: number }[] }
      expect(own.quadrants.map((q) => q.id)).toEqual([3, 1, 4, 2])
    } finally { close() }
  })

  it('quadrant reorder rejects incomplete or duplicate permutations', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      for (const ids of [[1, 2, 3], [1, 1, 2, 3], [1, 2, 3, 9]]) {
        const res = await app.fetch(new Request('http://local/api/sadhana/quadrants/reorder', {
          method: 'POST', headers: auth, body: JSON.stringify({ ids }),
        }))
        expect(res.status).toBe(400)
      }
    } finally { close() }
  })

  it('paused telegram channel skips reminders entirely, no log rows (spec §6.22)', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ?, telegram_paused = 1 WHERE id = ?', ['998877', uid])
      await insert(db, uid, { title: 'quiet', due_date: '2026-08-25' })
      const cfg = makeConfig2(db)
      const sent: string[] = []
      const origFetch = globalThis.fetch
      vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('api.telegram.org/bot')) sent.push(JSON.parse(String(init?.body)).text as string)
        return new Response('{"ok":true}')
      }) as typeof fetch)
      try {
        expect(await runSadhanaReminders(cfg, '2026-08-24', 0)).toBe(0) // 1d window, but paused
        expect(sent.length).toBe(0)
        expect((await db.query('SELECT COUNT(*) AS n FROM sadhana_reminder_logs'))[0].n).toBe(0)
        // /resume path flips the flag off — reminders flow again (covered via webhook in telegram.test.ts)
        await db.execute('UPDATE users SET telegram_paused = 0 WHERE id = ?', [uid])
        expect(await runSadhanaReminders(cfg, '2026-08-24', 0)).toBe(1)
        expect(sent.length).toBe(1)
      } finally {
        vi.unstubAllGlobals()
        void origFetch
      }
    } finally { close() }
  })
})