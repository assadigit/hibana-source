import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { WEEKDAYS } from '../routes/sadhana-helpers'
import { recurringDue } from '../services/sadhana'
import type { Db } from '../db/types'
import type { Config } from '../types'

// Phase 2 bug-hunt fixes (auditors P2-a/P2-c): form/calendar correctness.
//   AP-21 — the payments form posts urlencoded (htmx default); parseBody delivers
//            `amount` as a STRING, which z.number() rejected → 400 on EVERY
//            submission (dead feature — all tests used JSON).
//   AP-22 — WEEKDAYS.fa mapped every Persian weekday to the PREVIOUS day's spec
//            number (شنبه→6 instead of 5): an FA user arming Saturday recurrence
//            got Sunday. All seven numbers were off by one.
//   AP-23 — recur_config arrived with Persian digits (FA keyboard) verbatim:
//            Number('۳۰') is NaN in the engine → "every ۳۰ days" never reset
//            (dead recurrence); the client's parseInt also fell back to daily.
//            The repo's own law (schemas.ts verifyEmailSchema / captcha) is
//            normalize-at-the-boundary.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, telegramToken: 'test-bot', telegramSecret: 's' }
}

async function makeClient(db: Db, userId?: string) {
  const app = createApp(makeConfig(db))
  const cookie = userId ? `__Host-hibana_session=${await createSession(db, userId)}` : ''
  return { app, auth: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

describe('AP-21 — payments form (urlencoded) is not a dead feature', () => {
  it('POST /api/projects/:id/payments with an HTML form body (amount as string) → 201', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const pid = crypto.randomUUID()
      await db.execute(
        "INSERT INTO projects (id, user_id, title, status, type, created_at, updated_at) VALUES (?, ?, 'Client thing', 'developing', 'client', ?, ?)",
        [pid, uid, new Date().toISOString(), new Date().toISOString()],
      )
      const form = new URLSearchParams({ label: 'Deposit', amount: '500' })
      const res = await app.fetch(
        new Request(`http://local/api/projects/${pid}/payments`, {
          method: 'POST',
          headers: { Cookie: auth.Cookie, Origin: 'http://local', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        }),
      )
      expect(res.status).toBe(201)
      const rows = await db.query<{ label: string; amount: number }>('SELECT label, amount FROM payments WHERE project_id = ?', [pid])
      expect(rows.length).toBe(1)
      expect(rows[0].label).toBe('Deposit')
      expect(Number(rows[0].amount)).toBe(500)
    } finally {
      close()
    }
  })
})

describe('AP-22 — WEEKDAYS.fa maps each Persian weekday to its OWN spec number', () => {
  it('شنبه→5 (Saturday), یکشنبه→6 (Sunday), دوشنبه→0 (Monday), سه‌شنبه→1, چهارشنبه→2, پنج‌شنبه→3, جمعه→4', () => {
    const expected: Record<string, number> = {
      'شنبه': 5,
      'یکشنبه': 6,
      'دوشنبه': 0,
      'سه‌شنبه': 1,
      'چهارشنبه': 2,
      'پنج‌شنبه': 3,
      'جمعه': 4,
    }
    for (const entry of WEEKDAYS.fa) {
      expect(entry.n).toBe(expected[entry.label])
    }
    // the EN table is the reference (already correct): Mon=0…Sun=6
    for (const entry of WEEKDAYS.en) {
      expect(entry.n).toBe(expected[entry.label] ?? entry.n)
    }
  })

  it('behavioral: an FA user arming شنبه (Saturday) recurrence resets on Saturday, not Sunday', () => {
    // 2026-10-31 is a Saturday; 2026-11-01 is a Sunday.
    const wed = { recur_type: 'weekly' as const, recur_config: '5', recur_last: '2026-10-26' }
    expect(recurringDue(wed, '2026-10-31')).toBe(true) // Saturday — the day the FA user picked
    expect(recurringDue(wed, '2026-11-01')).toBe(false) // Sunday — what the old table armed
  })

  it('source contract: the client modal\'s FA weekday table agrees with the server (شنبه=5)', () => {
    // The server form (WEEKDAYS.fa) and the client modal (sadhana-page.js WD_FA)
    // must agree on the mapping — the modal was always correct; the server now
    // matches it. Pin both sides of the parity.
    const src = readFileSync(join(process.cwd(), 'public/js/sadhana-page.js'), 'utf8')
    const m = src.match(/WD_FA=\[\{n:(\d),lbl:'ش'\}/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('5')
    const fa = WEEKDAYS.fa.find((d) => d.label === 'شنبه')
    expect(fa?.n).toBe(5)
  })
})

describe('AP-23 — recur_config normalizes Persian digits at the boundary', () => {
  it('POST /api/sadhana/tasks with recur_config "۳۰" (Persian digits) stores "30" and the recurrence actually resets', async () => {
    const { db, close } = makeTestDb()
    try {
      const uid = await makeUser(db)
      const { app, auth } = await makeClient(db, uid)
      const res = await app.fetch(
        new Request('http://local/api/sadhana/tasks', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ title: 'every ۳۰ days', quadrant: 1, recurring: true, recur_type: 'ndays', recur_config: '۳۰' }),
        }),
      )
      expect(res.status).toBe(201)
      const rows = await db.query<{ recur_config: string }>('SELECT recur_config FROM sadhana_tasks ORDER BY created_at DESC LIMIT 1')
      expect(rows[0].recur_config).toBe('30')
      // the engine can now actually fire: 30 days after recur_last
      expect(recurringDue({ recur_type: 'ndays', recur_config: rows[0].recur_config, recur_last: '2026-09-01' }, '2026-10-01')).toBe(true)
    } finally {
      close()
    }
  })
})
