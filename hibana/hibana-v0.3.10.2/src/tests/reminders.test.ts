import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { runReminders } from '../services/reminders'
import type { Db } from '../db/types'

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key', assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json' } }
}

/** A client project that is clearly behind pace (see client.test.ts: due in 5 days, 2/10 done → 20% vs ~67% expected). */
async function seedBehind(db: Db, app: ReturnType<typeof createApp>, auth: Record<string, string>): Promise<string> {
  const res = await app.fetch(new Request('http://local/api/projects', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Behind Client', type: 'client', client_name: 'Acme', due_date: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10), reminders_enabled: 1, status: 'building' }),
  }))
  const { id } = (await res.json()) as { id: string }
  for (let i = 0; i < 10; i++) {
    await app.fetch(new Request(`http://local/api/projects/${id}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ title: `t${i}` }) }))
  }
  const tasks = await db.query<{ id: string }>('SELECT id FROM tasks WHERE project_id = ?', [id])
  for (let i = 0; i < 2; i++) {
    await app.fetch(new Request(`http://local/api/tasks/${tasks[i].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ done: 1 }) }))
  }
  return id
}

describe('client reminders — delivery channels (spec §6.3: email + Telegram)', () => {
  it('pushes to the owner’s linked Telegram chat AND email; deep link points at hibana.ir', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['4242', userId])
      const { app, auth } = await makeClient(db, userId)
      await seedBehind(db, app, auth)

      const calls: Array<{ kind: 'email' | 'telegram'; body: string }> = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.resend.com')) {
          calls.push({ kind: 'email', body: String(init?.body ?? '') })
          return new Response(JSON.stringify({ id: 'm1' }), { status: 200 })
        }
        if (url.includes('api.telegram.org')) {
          calls.push({ kind: 'telegram', body: String(init?.body ?? '') })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return originalFetch(input, init)
      }) as typeof fetch
      try {
        const sent = await runReminders(
          { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'resend-key', telegramToken: 'tg-bot-token' },
          'owner@example.com',
        )
        expect(sent).toBe(2) // one email + one Telegram push
        const tg = calls.find((c) => c.kind === 'telegram')
        const mail = calls.find((c) => c.kind === 'email')
        expect(tg).toBeTruthy()
        expect(mail).toBeTruthy()
        const body = JSON.parse(tg!.body) as { chat_id: string; parse_mode: string; text: string }
        expect(body.chat_id).toBe('4242')
        expect(body.parse_mode).toBe('HTML')
        expect(body.text).toContain('Behind Client')
        expect(body.text).toContain('behind pace')
        expect(body.text).toContain('https://hibana.ir/project.html?id=')
        expect(mail!.body).toContain('https://hibana.ir/project.html?id=')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      close()
    }
  })

  it('sends email only when no Telegram chat is linked', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db) // no telegram_chat_id
      const { app, auth } = await makeClient(db, userId)
      await seedBehind(db, app, auth)

      let telegramCalls = 0
      let emailCalls = 0
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('api.resend.com')) { emailCalls++; return new Response(JSON.stringify({ id: 'm1' }), { status: 200 }) }
        if (url.includes('api.telegram.org')) { telegramCalls++; return new Response(JSON.stringify({ ok: true }), { status: 200 }) }
        return originalFetch(input, init)
      }) as typeof fetch
      try {
        const sent = await runReminders(
          { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'resend-key', telegramToken: 'tg-bot-token' },
          'owner@example.com',
        )
        expect(sent).toBe(1)
        expect(emailCalls).toBe(1)
        expect(telegramCalls).toBe(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      close()
    }
  })

  it('the reminder toggle route re-renders the client fragment (HX-Redirect)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const id = await seedBehind(db, app, auth)

      const res = await app.fetch(new Request(`http://local/api/projects/${id}/reminders`, {
        method: 'POST',
        headers: { ...auth, 'HX-Request': 'true' },
        body: JSON.stringify({ enabled: 0 }),
      }))
      expect(res.status).toBe(200)
      expect(res.headers.get('HX-Redirect')).toBe('/api/clients')
      const row = await db.query<{ reminders_enabled: number }>('SELECT reminders_enabled FROM projects WHERE id = ?', [id])
      expect(row[0].reminders_enabled).toBe(0)
    } finally {
      close()
    }
  })
})