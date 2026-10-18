import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'
import type { Config } from '../types'

// S208 (kanban task-option parity): every task row in the devboard payload
// carries its PIN COUNT — the screenshots pinned via screenshots.task_id
// (0054). The board cards render the same .pd-task-shots badge the project
// page's cards do. Contract:
//   1. A task with N pinned shots carries shot_count = N.
//   2. A task with none carries 0 (explicit field, never undefined).
//   3. Unpinning drops the count.
//   4. The field rides the SAME JSON body (additive — no shape change).

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const testApp = (db: Db) =>
  createApp({ db, isProd: false, github: { owner: 'o', repo: 'r', token: 't' }, emailKey: undefined, assets: undefined } as unknown as Config)

const jsonHeaders = (token: string) => ({ Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' })

async function makeProject(db: Db, userId: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    [id, userId, 'S208 board shots', '', 'personal', 'developing', '', new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

async function makeTask(app: ReturnType<typeof testApp>, headers: Record<string, string>, pid: string, title: string): Promise<string> {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify({ title, status: 'idea' }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function uploadShot(app: ReturnType<typeof testApp>, headers: Record<string, string>, pid: string): Promise<string> {
  const up = await app.fetch(
    new Request(`http://local/api/projects/${pid}/screenshots`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: 'proof.png', mimeType: 'image/png', dataBase64: PNG_B64, caption: '' }),
    }),
  )
  expect(up.status).toBe(201)
  return ((await up.json()) as { id: string }).id
}

async function pinShot(app: ReturnType<typeof testApp>, headers: Record<string, string>, shotId: string, taskId: string) {
  const res = await app.fetch(new Request(`http://local/api/screenshots/${shotId}`, { method: 'PATCH', headers, body: JSON.stringify({ taskId }) }))
  expect(res.status).toBe(200)
}

async function boardCounts(app: ReturnType<typeof testApp>, headers: Record<string, string>, pid: string) {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { tasks: { id: string; shot_count?: number }[] }
  return new Map(body.tasks.map((t) => [t.id, t.shot_count]))
}

describe('S208: the devboard payload carries per-task pin counts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shot_count counts pinned shots per task (0 for none, drops on unpin)', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ content: { html_url: 'u' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const pid = await makeProject(db, userId)
      const app = testApp(db)
      const token = await createSession(db, userId)
      const headers = jsonHeaders(token)

      const taskA = await makeTask(app, headers, pid, 'task with two proofs')
      const taskB = await makeTask(app, headers, pid, 'task with no proof')

      // nothing pinned yet — both rows carry an EXPLICIT 0 (never undefined)
      let counts = await boardCounts(app, headers, pid)
      expect(counts.get(taskA)).toBe(0)
      expect(counts.get(taskB)).toBe(0)

      // pin two shots onto taskA, one onto taskB
      const s1 = await uploadShot(app, headers, pid)
      const s2 = await uploadShot(app, headers, pid)
      const s3 = await uploadShot(app, headers, pid)
      await pinShot(app, headers, s1, taskA)
      await pinShot(app, headers, s2, taskA)
      await pinShot(app, headers, s3, taskB)

      counts = await boardCounts(app, headers, pid)
      expect(counts.get(taskA)).toBe(2)
      expect(counts.get(taskB)).toBe(1)

      // unpin one of taskA's — the count drops, taskB is untouched
      const res = await app.fetch(new Request(`http://local/api/screenshots/${s1}`, { method: 'PATCH', headers, body: JSON.stringify({ taskId: null }) }))
      expect(res.status).toBe(200)
      counts = await boardCounts(app, headers, pid)
      expect(counts.get(taskA)).toBe(1)
      expect(counts.get(taskB)).toBe(1)

      // every row carries the field (additive contract — no undefined holes)
      for (const v of counts.values()) expect(typeof v).toBe('number')
    } finally {
      close()
    }
  })
})
