import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S76 (§10-C): the board's journal feed used to be UNBOUNDED — loadAll fetched every
// sadhana_updates row ever written and rendered them all. Now the LATEST 20 notes per
// task ride the board (window-function cap), the notes badge shows the TRUE per-task
// total, and a truncation hint ("showing latest k of n") renders when the cap bites.
// The legacy task-note column still merges and counts toward the total.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function addTask(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, title: string): Promise<string> {
  const res = await client.app.fetch(new Request('http://local/api/sadhana/quadrants/1', {
    method: 'POST', headers: client.auth, body: JSON.stringify({ title }),
  }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string }
  return body.id
}

async function addNote(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }, taskId: string, i: number): Promise<void> {
  const res = await client.app.fetch(new Request(`http://local/api/sadhana/tasks/${taskId}/notes`, {
    method: 'POST', headers: client.auth, body: JSON.stringify({ text: `cap note ${i}` }),
  }))
  expect([200, 201]).toContain(res.status)
}

async function boardHtml(client: { app: ReturnType<typeof createApp>; auth: Record<string, string> }): Promise<string> {
  const res = await client.app.fetch(new Request('http://local/api/sadhana', { headers: { ...client.auth, 'HX-Request': 'true' } }))
  expect(res.status).toBe(200)
  return res.text()
}

async function taskCard(html: string, taskId: string): Promise<string> {
  // The card <li> nests note <li>s AND carries inner sadhana-card-* classes — the
  // only reliable boundary is the NEXT card's opening <li class="sadhana-card …
  const start = html.indexOf(`data-task-id="${taskId}"`)
  expect(start).toBeGreaterThan(-1)
  const next = html.indexOf('<li class="sadhana-card', start + 20)
  return html.slice(start, next === -1 ? undefined : next)
}

describe('sadhana board journal cap (S76 — the unbounded feed fix)', () => {
  it('caps the rendered notes at the latest 20 per task, with the honest badge + hint', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const taskId = await addTask(client, 'cap-task')
      for (let i = 1; i <= 25; i++) await addNote(client, taskId, i)

      const html = await boardHtml(client)
      const card = await taskCard(html, taskId)

      // The latest 20 ride the board; the oldest 5 do not.
      expect(card).toContain('cap note 25<')
      expect(card).toContain('cap note 21<')
      expect(card).toContain('cap note 6<')
      expect(card).not.toContain('cap note 5<')
      expect(card).not.toContain('cap note 1<')

      // The badge carries the TRUE total; the hint says what was truncated.
      expect(card).toContain('data-task-note-badge aria-hidden="true">25<')
      expect(card).toContain('Showing the latest 20 of 25 notes')
      expect(card).toContain('task-notes-truncated')
    } finally {
      close()
    }
  })

  it('a task under the cap renders everything, no hint, plain badge', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const taskId = await addTask(client, 'small-task')
      for (let i = 1; i <= 4; i++) await addNote(client, taskId, i)

      const html = await boardHtml(client)
      const card = await taskCard(html, taskId)
      expect(card).toContain('cap note 4<')
      expect(card).toContain('cap note 1<')
      expect(card).not.toContain('task-notes-truncated')
      expect(card).toContain('data-task-note-badge aria-hidden="true">4<')
    } finally {
      close()
    }
  })

  it('a task at exactly 20 notes renders all 20 — the cap is inclusive, no hint', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const taskId = await addTask(client, 'edge-task')
      for (let i = 1; i <= 20; i++) await addNote(client, taskId, i)

      const html = await boardHtml(client)
      const card = await taskCard(html, taskId)
      expect(card).toContain('cap note 20<')
      expect(card).toContain('cap note 1<')
      expect(card).not.toContain('task-notes-truncated')
    } finally {
      close()
    }
  })

  it('other users\' journal rows never ride the board (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const mine = await makeUser(db)
      const other = await makeUser(db)
      const myClient = await makeClient(db, mine)
      const otherClient = await makeClient(db, other)
      const otherTask = await addTask(otherClient, 'their-task')
      await addNote(otherClient, otherTask, 1)

      const html = await boardHtml(myClient)
      expect(html).not.toContain('cap note 1<')
    } finally {
      close()
    }
  })
})
