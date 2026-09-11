import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { clientProgress, isBehindPace } from '../services/progress'
import { findBehindProjects } from '../services/reminders'
import type { Db } from '../db/types'

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key', assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function seedClientProject(db: Db, app: ReturnType<typeof createApp>, auth: Record<string, string>, over: Record<string, unknown> = {}) {
  const res = await app.fetch(new Request('http://local/api/projects', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Client Site', type: 'client', client_name: 'Acme', due_date: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10), reminders_enabled: 1, ...over }),
  }))
  return (await res.json()) as { id: string }
}

describe('client module (spec §6)', () => {
  it('task-time progress matches the spec example (10 tasks / 5 done = 50%)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const { id } = await seedClientProject(db, app, auth)

      const ids: string[] = []
      for (let i = 0; i < 10; i++) {
        const r = await app.fetch(new Request(`http://local/api/projects/${id}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ title: `task ${i}` }) }))
        const t = (await r.json()) as { id: string }
        ids.push(t.id)
      }
      for (let i = 0; i < 5; i++) {
        await app.fetch(new Request(`http://local/api/tasks/${ids[i]}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ done: 1 }) }))
      }
      const dash = await app.fetch(new Request('http://local/api/clients', { headers: auth }))
      const body = (await dash.json()) as { rows: { progress: number; tasks: { done: number }[] }[] }
      expect(body.rows[0].progress).toBe(50) // spec §6.1's exact example
      expect(body.rows[0].tasks.filter((t) => t.done === 1)).toHaveLength(5)
    } finally {
      close()
    }
  })

  it('payments track partial contracts (deposit paid, final pending)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const { id } = await seedClientProject(db, app, auth)

      const d = await app.fetch(new Request(`http://local/api/projects/${id}/payments`, { method: 'POST', headers: auth, body: JSON.stringify({ label: 'Deposit', amount: 500, currency: 'USD' }) }))
      const { id: depId } = (await d.json()) as { id: string }
      const f = await app.fetch(new Request(`http://local/api/projects/${id}/payments`, { method: 'POST', headers: auth, body: JSON.stringify({ label: 'Final payment', amount: 1500, currency: 'USD' }) }))

      await app.fetch(new Request(`http://local/api/payments/${depId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'paid' }) }))

      const dash = await app.fetch(new Request('http://local/api/clients', { headers: auth }))
      const body = (await dash.json()) as { rows: { payments: { label: string; status: string }[] }[] }
      const pays = body.rows[0].payments
      expect(pays.find((p) => p.label === 'Deposit')?.status).toBe('paid')
      expect(pays.find((p) => p.label === 'Final payment')?.status).toBe('pending')
    } finally {
      close()
    }
  })

  it('reminder engine: only behind-pace opted-in client projects trigger; on-pace never nags', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)

      // behind pace: due in 5 days, 2 of 10 tasks done at 7% elapsed (21-day window) → 20% done vs ~67% expected → behind
      const behind = await seedClientProject(db, app, auth, { status: 'building', due_date: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10), reminders_enabled: 1 })
      for (let i = 0; i < 10; i++) {
        await app.fetch(new Request(`http://local/api/projects/${behind.id}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ title: `t${i}` }) }))
      }

      const tasks = await db.query<{ id: string }>('SELECT id FROM tasks WHERE project_id = ?', [behind.id])
      for (let i = 0; i < 2; i++) {
        await app.fetch(new Request(`http://local/api/tasks/${tasks[i].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ done: 1 }) }))
      }

      const candidates = await findBehindProjects({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key' } as never)
      expect(candidates.map((c) => c.project.id)).toContain(behind.id)

      // same project with reminders disabled → no candidate
      await app.fetch(new Request(`http://local/api/projects/${behind.id}/reminders`, { method: 'POST', headers: auth, body: JSON.stringify({ enabled: 0 }) }))
      const after = await findBehindProjects({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key' } as never)
      expect(after.map((c) => c.project.id)).not.toContain(behind.id)

      // on-pace project: due in 20 days, 5/10 done at 5% elapsed → on pace → no nag
      const onpace = await seedClientProject(db, app, auth, { status: 'building', due_date: new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString().slice(0, 10), reminders_enabled: 1 })
      for (let i = 0; i < 10; i++) {
        await app.fetch(new Request(`http://local/api/projects/${onpace.id}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ title: `t${i}` }) }))
      }
      const tasks2 = await db.query<{ id: string }>('SELECT id FROM tasks WHERE project_id = ?', [onpace.id])
      for (let i = 0; i < 5; i++) {
        await app.fetch(new Request(`http://local/api/tasks/${tasks2[i].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ done: 1 }) }))
      }
      const final = await findBehindProjects({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: 'test-key' } as never)
      expect(final.map((c) => c.project.id)).not.toContain(onpace.id)
    } finally {
      close()
    }
  })

  it('task/payment records are user-isolated', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, auth: authA } = await makeClient(db, a)
      const { app: appB, auth: authB } = await makeClient(db, b)

      const { id } = await seedClientProject(db, appA, authA)
      const t = await appA.fetch(new Request(`http://local/api/projects/${id}/tasks`, { method: 'POST', headers: authA, body: JSON.stringify({ title: 'secret task' }) }))
      const { id: taskId } = (await t.json()) as { id: string }

      // B cannot see or toggle A's task
      const dashB = await appB.fetch(new Request('http://local/api/clients', { headers: authB }))
      const bBody = (await dashB.json()) as { rows: unknown[] }
      expect(bBody.rows).toHaveLength(0)

      const toggle = await appB.fetch(new Request(`http://local/api/tasks/${taskId}`, { method: 'PATCH', headers: authB, body: JSON.stringify({ done: 1 }) }))
      expect(toggle.status).toBe(404)
    } finally {
      close()
    }
  })
})