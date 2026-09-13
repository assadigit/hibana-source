import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S33 (user request 2026-09-13 — «اسپرینت جدید» → modal → «ورود به اسپرینت» → the
// full-screen sprint editor): the sprints table carries version + description (0052).
//   1. POST /sprints accepts name + version + description (the modal's three fields);
//      the created DRAFT round-trips all three; the response carries them.
//   2. PATCH /sprints/:id edits the doc on a draft AND on a started sprint (the plan
//      stays writable for the sprint's whole lifetime) — dates stay /start-only on
//      drafts (0034 rule unchanged).
//   3. GET /:id (the project detail JSON — the project page's truth fetch) carries the
//      new fields, so the CTA's draft detection + the deep-link editor read real data.
//   4. Zod guards: version > 40 chars and description > 100k → 400, never a 500.
//   5. Isolation (rule 1): another user's sprint id → 404, no doc writes.

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

type App = Awaited<ReturnType<typeof createApp>>

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const mkSprint = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/sprints`, { method: 'POST', headers, body: JSON.stringify(body) }))

const patchSprint = (app: App, headers: Record<string, string>, sid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

type SprintJson = { id: string; name: string; version: string | null; description: string | null; draft?: boolean }

async function projectSprints(app: App, headers: Record<string, string>, pid: string): Promise<SprintJson[]> {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers }))
  expect(res.status).toBe(200)
  const data = (await res.json()) as { project: { sprints: SprintJson[] } }
  return data.project.sprints
}

describe('sprint doc (S33 — «اسپرینت جدید» modal + full-screen editor)', () => {
  it('create carries name + version + description; the draft round-trips them', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe one')

      const res = await mkSprint(app, headers, pid, {
        name: 'Payments flow', version: '12.1',
        description: '## Goal\nShip the new checkout.\n\n```ts\nconst x = 1\n```',
      })
      expect(res.status).toBe(201)
      const created = (await res.json()) as SprintJson
      expect(created.version).toBe('12.1')
      expect(created.draft).toBe(true)

      // the project detail JSON (the project page's truth fetch) carries the doc
      const sprints = await projectSprints(app, headers, pid)
      expect(sprints).toHaveLength(1)
      expect(sprints[0].name).toBe('Payments flow')
      expect(sprints[0].version).toBe('12.1')
      expect(sprints[0].description).toContain('```ts')
      expect(sprints[0].description).toContain('## Goal')
    } finally { close() }
  })

  it('PATCH edits the doc on a DRAFT (names/dates still guarded) and on a STARTED sprint', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe two')

      const created = (await (await mkSprint(app, headers, pid, { name: 'S1', description: 'first' })).json()) as SprintJson

      // draft: the doc + version + name are writable…
      const ok = await patchSprint(app, headers, created.id, { description: 'second **draft**', version: '0.2' })
      expect(ok.status).toBe(200)
      let sprints = await projectSprints(app, headers, pid)
      expect(sprints[0].description).toBe('second **draft**')
      expect(sprints[0].version).toBe('0.2')
      // …but the dates stay /start-only (0034 rule untouched)
      const badDates = await patchSprint(app, headers, created.id, { started_at: new Date().toISOString() })
      expect(badDates.status).toBe(400)

      // started: the doc remains writable for the sprint's whole lifetime
      const start = await app.fetch(new Request(`http://local/api/sprints/${created.id}/start`, { method: 'POST', headers }))
      expect(start.status).toBe(200)
      const ok2 = await patchSprint(app, headers, created.id, { description: 'plan v3 with code', version: null })
      expect(ok2.status).toBe(200)
      sprints = await projectSprints(app, headers, pid)
      expect(sprints[0].description).toBe('plan v3 with code')
      expect(sprints[0].version).toBeNull() // explicit null clears the label
    } finally { close() }
  })

  it('zod guards: oversized version / description → 400, never a 500', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe three')

      const badVersion = await mkSprint(app, headers, pid, { name: 'x', version: 'v'.repeat(41) })
      expect(badVersion.status).toBe(400)
      const badDoc = await mkSprint(app, headers, pid, { name: 'x', description: 'x'.repeat(100_001) })
      expect(badDoc.status).toBe(400)
      // nothing was created — the guards ran before any INSERT
      expect(await projectSprints(app, headers, pid)).toHaveLength(0)
    } finally { close() }
  })

  it('rule 1: another user’s sprint id → 404, no doc writes', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db)
      const other = await makeUser(db)
      const { app, headers } = await makeApp(db, owner)
      const { headers: otherHeaders } = await makeApp(db, other)
      const pid = await createProject(app, headers, 'owner project')

      const created = (await (await mkSprint(app, headers, pid, { name: 'S1', description: 'secret plan' })).json()) as SprintJson

      const res = await patchSprint(app, otherHeaders, created.id, { description: 'hijacked' })
      expect(res.status).toBe(404)
      const sprints = await projectSprints(app, headers, pid)
      expect(sprints[0].description).toBe('secret plan')
    } finally { close() }
  })

  it('the one-draft rule still holds (409 draft_exists carries the draft id)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe four')

      const first = await mkSprint(app, headers, pid, { name: 'A', description: 'a' })
      expect(first.status).toBe(201)
      const second = await mkSprint(app, headers, pid, { name: 'B', description: 'b' })
      expect(second.status).toBe(409)
      const j = (await second.json()) as { draft_id: string }
      const sprints = await projectSprints(app, headers, pid)
      expect(j.draft_id).toBe(sprints[0].id) // the client flips into PATCH mode against it
    } finally { close() }
  })
})
