import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function createProject(app: ReturnType<typeof createApp>, auth: Record<string, string>, title: string, status: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title, status }) }))
  expect(res.status).toBe(201)
  const { id } = (await res.json()) as { id: string }
  return id
}

// Drag-reorder (spec §5.3 + §4.3): the UI ships a full status-group / hurdle list to the reorder
// endpoints. These tests pin the server contract: it renumbers within one status group, touches
// nothing outside it (rule 1 + status coherence), and validates input (rule 10).
describe('reorder — projects', () => {
  it('reassigns sort_order within a status group so the list comes back in the new order', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const [a, b, c] = await Promise.all([
        createProject(app, auth, 'A', 'spark'),
        createProject(app, auth, 'B', 'spark'),
        createProject(app, auth, 'C', 'spark'),
      ])

      const reorder = await app.fetch(new Request('http://local/api/projects/reorder', { method: 'POST', headers: auth, body: JSON.stringify({ status: 'spark', ids: [b, a, c] }) }))
      expect(reorder.status).toBe(200)

      const list = await app.fetch(new Request('http://local/api/projects?status=spark', { headers: auth }))
      const { projects } = (await list.json()) as { projects: { id: string }[] }
      expect(projects.map((p) => p.id)).toEqual([b, a, c])
    } finally {
      close()
    }
  })

  it('never renumbers a project outside the given status or another user (rule 1 + status coherence)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u1 = await makeUser(db)
      const u2 = await makeUser(db)
      const { app, auth } = await makeClient(db, u1)
      const { app: app2, auth: auth2 } = await makeClient(db, u2)

      const sparkA = await createProject(app, auth, 'A', 'spark')
      const sparkB = await createProject(app, auth, 'B', 'spark')
      const doingC = await createProject(app, auth, 'C', 'developing')
      const otherUser = await createProject(app2, auth2, 'X', 'spark')

      // Try to drag a doing project and another user's spark into the spark group.
      const reorder = await app.fetch(new Request('http://local/api/projects/reorder', { method: 'POST', headers: auth, body: JSON.stringify({ status: 'spark', ids: [sparkB, sparkA, doingC, otherUser] }) }))
      expect(reorder.status).toBe(200)

      // The spark group lives on its own shelf: fetch it with the status filter (the
      // default list excludes sparks since 0031).
      const sparkList = await app.fetch(new Request('http://local/api/projects?status=spark', { headers: auth }))
      const { projects: sparks } = (await sparkList.json()) as { projects: { id: string; status: string; sort_order: number }[] }
      const byId = Object.fromEntries(sparks.map((p) => [p.id, p]))
      // Spark group reordered: B first, A second.
      expect(byId[sparkB].sort_order).toBe(0)
      expect(byId[sparkA].sort_order).toBe(1)

      // The default list (pipeline stages only, sparks excluded) shows the untouched
      // doing project: never renumbered as index 2, and the other user's row never leaks.
      const list = await app.fetch(new Request('http://local/api/projects', { headers: auth }))
      const { projects } = (await list.json()) as { projects: { id: string; status: string; sort_order: number }[] }
      const doingById = Object.fromEntries(projects.map((p) => [p.id, p]))
      expect(doingById[doingC].status).toBe('developing')
      expect(doingById[doingC].sort_order).toBe(0)
      expect(doingById[otherUser]).toBeUndefined()

      // And u2's data is intact (the spark shelf, via the same status filter).
      const list2 = await app2.fetch(new Request('http://local/api/projects?status=spark', { headers: auth2 }))
      const { projects: p2 } = (await list2.json()) as { projects: { id: string; sort_order: number }[] }
      expect(p2.map((p) => p.id)).toEqual([otherUser])
      expect(p2[0].sort_order).toBe(0)
    } finally {
      close()
    }
  })

  it('rejects malformed input and requires auth (rule 10 + auth boundary)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const id = await createProject(app, auth, 'A', 'spark')

      const badIds = await app.fetch(new Request('http://local/api/projects/reorder', { method: 'POST', headers: auth, body: JSON.stringify({ status: 'spark', ids: ['not-a-uuid'] }) }))
      expect(badIds.status).toBe(400)

      const missingStatus = await app.fetch(new Request('http://local/api/projects/reorder', { method: 'POST', headers: auth, body: JSON.stringify({ ids: [id] }) }))
      expect(missingStatus.status).toBe(400)

      const noAuth = await app.fetch(new Request('http://local/api/projects/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://local' }, body: JSON.stringify({ status: 'spark', ids: [id] }) }))
      expect(noAuth.status).toBe(401)
    } finally {
      close()
    }
  })
})

describe('reorder — hurdles', () => {
  it('renumbers hurdles within a project so the list comes back in the new order', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const pid = await createProject(app, auth, 'Ship', 'developing')

      const ids: string[] = []
      for (const text of ['one', 'two', 'three']) {
        const res = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, { method: 'POST', headers: auth, body: JSON.stringify({ text }) }))
        const { id } = (await res.json()) as { id: string }
        ids.push(id)
      }

      const before = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, { headers: auth }))
      const b = (await before.json()) as { hurdles: { id: string }[] }
      expect(b.hurdles.map((h) => h.id)).toEqual(ids)

      const reorder = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles/reorder`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: [ids[2], ids[0], ids[1]] }) }))
      expect(reorder.status).toBe(200)

      const after = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, { headers: auth }))
      const a = (await after.json()) as { hurdles: { id: string }[] }
      expect(a.hurdles.map((h) => h.id)).toEqual([ids[2], ids[0], ids[1]])
    } finally {
      close()
    }
  })

  it('scopes reorder to the owning project and the owning user (rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u1 = await makeUser(db)
      const u2 = await makeUser(db)
      const { app, auth } = await makeClient(db, u1)
      const { app: app2, auth: auth2 } = await makeClient(db, u2)

      const p1 = await createProject(app, auth, 'P1', 'developing')
      const p2 = await createProject(app, auth, 'P2', 'developing')
      const mk = async (pid: string, text: string) => {
        const res = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, { method: 'POST', headers: auth, body: JSON.stringify({ text }) }))
        return ((await res.json()) as { id: string }).id
      }
      const h1 = await mk(p1, 'h1')
      const h2 = await mk(p2, 'h2')

      // Reordering P1 with P2's hurdle id must not touch P2's hurdle.
      const reorder = await app.fetch(new Request(`http://local/api/projects/${p1}/hurdles/reorder`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: [h2] }) }))
      expect(reorder.status).toBe(200)

      const p2List = await app.fetch(new Request(`http://local/api/projects/${p2}/hurdles`, { headers: auth }))
      const { hurdles } = (await p2List.json()) as { hurdles: { id: string; sort_order: number }[] }
      expect(hurdles.map((h) => h.id)).toEqual([h2])
      expect(hurdles[0].sort_order).toBe(0)

      // Another user cannot reorder or even see u1's project hurdles.
      const denied = await app2.fetch(new Request(`http://local/api/projects/${p1}/hurdles/reorder`, { method: 'POST', headers: auth2, body: JSON.stringify({ ids: [h1] }) }))
      expect(denied.status).toBe(404)

      const noAuth = await app.fetch(new Request(`http://local/api/projects/${p1}/hurdles/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://local' }, body: JSON.stringify({ ids: [h1] }) }))
      expect(noAuth.status).toBe(401)
    } finally {
      close()
    }
  })
})

// User request (session 5): the hurdles composer behaves like the Quick Notebook — Enter (or a
// pasted block) can carry several lines, and each non-empty line becomes its own hurdle.
describe('hurdles — multiline composer', () => {
  it('splits a newline-joined batch into one hurdle per line, ignoring blank lines', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const pid = await createProject(app, auth, 'Blocks', 'developing')

      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ text: 'first\nsecond\n  \n third ' }),
      }))
      expect(res.status).toBe(201)
      const body = (await res.json()) as { ids: string[] }
      expect(body.ids).toHaveLength(3)

      const list = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, { headers: auth }))
      const { hurdles } = (await list.json()) as { hurdles: { text: string; sort_order: number }[] }
      expect(hurdles.map((h) => h.text)).toEqual(['first', 'second', 'third'])
      expect(hurdles.map((h) => h.sort_order)).toEqual([0, 1, 2])
    } finally {
      close()
    }
  })

  it('rejects an all-whitespace batch (nothing to record, rule 10)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const pid = await createProject(app, auth, 'Blocks', 'developing')

      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/hurdles`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ text: '\n  \n' }),
      }))
      expect(res.status).toBe(400)
    } finally {
      close()
    }
  })
})

// User request (session 5): Where-I-left-off autosaves while typing — repeated identical saves
// (debounce + blur) must not spam the history trail with duplicate entries.
describe('project note — autosave dedupe', () => {
  it('logs a history entry only when the note actually changes', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const pid = await createProject(app, auth, 'Note Me', 'developing')

      const post = (note: string) =>
        app.fetch(new Request(`http://local/api/projects/${pid}/note`, { method: 'POST', headers: auth, body: JSON.stringify({ note }) }))

      expect((await post('first draft')).status).toBe(200)
      expect((await post('first draft')).status).toBe(200) // autosave blur echoes the same text

      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: auth }))
      const { project } = (await detail.json()) as { project: { latest_note: string; history: { note: string }[] } }
      expect(project.latest_note).toBe('first draft')
      expect(project.history).toHaveLength(1) // identical repeat adds no entry

      expect((await post('second draft')).status).toBe(200)
      const detail2 = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: auth }))
      const d2 = (await detail2.json()) as { project: { history: { note: string }[] } }
      expect(d2.project.history).toHaveLength(2)
    } finally {
      close()
    }
  })
})
