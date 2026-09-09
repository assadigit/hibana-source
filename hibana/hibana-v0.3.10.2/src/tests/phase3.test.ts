import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { buildSnapshot } from '../services/backup'
import { hashPassword } from '../auth/password'
import type { Db } from '../db/types'

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json' } }
}

describe('Phase 3 — export, duplicate-check, revive, reports', () => {
  it('export snapshot carries schema_version and excludes credentials (rule 8 + §15)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      // seed a session + password hash so we can prove exclusion
      await createSession(db, userId)
      const snapshot = await buildSnapshot(db)
      expect(snapshot.schema_version).toBeTypeOf('number')
      expect(snapshot.exported_at).toBeTypeOf('string')
      expect(snapshot.data.users).toHaveLength(1)
      const firstUser = snapshot.data.users[0] as Record<string, unknown>
      expect(Object.keys(firstUser)).not.toContain('password_hash') // rule 8
      expect('sessions' in snapshot.data).toBe(false) // rule 8
      // everything else is there
      expect(snapshot.data.projects).toBeDefined()
      expect(snapshot.data.hurdles).toBeDefined()
    } finally {
      close()
    }
  })

  it('duplicate-check flags near-identical titles but never blocks creation', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Star Map Store' }) }))

      const dup = await app.fetch(new Request('http://local/api/projects/duplicate-check?title=star map store', { headers: auth }))
      const dupBody = (await dup.json()) as { duplicate: boolean }
      expect(dupBody.duplicate).toBe(true) // case-insensitive soft warning

      const ok = await app.fetch(new Request('http://local/api/projects/duplicate-check?title=Completely New Idea', { headers: auth }))
      const okBody = (await ok.json()) as { duplicate: boolean }
      expect(okBody.duplicate).toBe(false)

      // creation is never blocked (soft warning only)
      const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Star Map Store' }) }))
      expect(res.status).toBe(201)
    } finally {
      close()
    }
  })

  it('revive only works on halted projects and asks which status fits (§5.6)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)
      const create = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Old thing' }) }))
      const { id } = (await create.json()) as { id: string }

      // can't revive a project that isn't halted (the gate is the status, not ownership)
      const early = await app.fetch(new Request(`http://local/api/projects/${id}/revive`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'doing' }) }))
      expect(early.status).toBe(404)

      // the target must be one of the five live stages: 'halted' itself is not a revive
      // target (that would be a no-op), and legacy names (0031) are not mapped here —
      // only the new stages are accepted.
      const sameStage = await app.fetch(new Request(`http://local/api/projects/${id}/revive`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'halted' }) }))
      expect(sameStage.status).toBe(400)
      const legacy = await app.fetch(new Request(`http://local/api/projects/${id}/revive`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'working' }) }))
      expect(legacy.status).toBe(400)

      // halt it (the old "archived" era is the 'halted' stage now)
      await app.fetch(new Request(`http://local/api/projects/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'halted', archived_state: 'online' }) }))
      // revive as In Progress — the choice is always asked (§5.6)
      const revive = await app.fetch(new Request(`http://local/api/projects/${id}/revive`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'doing' }) }))
      expect(revive.status).toBe(200)
      const detail = await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))
      const d = (await detail.json()) as { project: { status: string; archived_state: string | null; history: { note: string }[] } }
      expect(d.project.status).toBe('doing')
      expect(d.project.archived_state).toBeNull()
      expect(d.project.history.map((h) => h.note)).toContain('Revived → In Progress')
    } finally {
      close()
    }
  })

  it('reports aggregate hurdle completions and creations per bucket', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, auth } = await makeClient(db, userId)

      const create = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Report Project' }) }))
      const { id } = (await create.json()) as { id: string }
      const h = await app.fetch(new Request(`http://local/api/projects/${id}/hurdles`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'Ship it' }) }))
      const { id: hid } = (await h.json()) as { id: string }
      await app.fetch(new Request(`http://local/api/hurdles/${hid}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'solved' }) }))

      const summary = await app.fetch(new Request('http://local/api/reports/summary', { headers: auth }))
      const s = (await summary.json()) as { status: Record<string, number>; totalProjects: number; recents: Record<string, { id: string; title: string }[]> }
      expect(s.status.spark).toBe(1)
      // the status counters cover the whole 7-stage taxonomy (keys initialized to 0)
      expect(Object.keys(s.status).sort()).toEqual(['awaiting', 'doing', 'halted', 'investigating', 'operational', 'spark', 'unreviewed'])
      expect(s.totalProjects).toBe(1)
      // The Operational/Halted boxes moved to Reports (user request 2026-08-21): the summary
      // carries up to 4 recents per status so the page can render the links.
      expect(Array.isArray(s.recents.operational)).toBe(true)
      expect(Array.isArray(s.recents.halted)).toBe(true)

      // move the project to Operational → it must appear in recents.operational with a link
      const move = await app.fetch(new Request(`http://local/api/projects/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'operational' }) }))
      expect(move.status).toBe(200)
      const s2 = (await (await app.fetch(new Request('http://local/api/reports/summary', { headers: auth }))).json()) as {
        recents: Record<string, { id: string; title: string }[]>
      }
      expect(s2.recents.operational.some((r) => r.id === id && r.title === 'Report Project')).toBe(true)
      expect(s2.recents.operational.length).toBeLessThanOrEqual(4)

      const activity = await app.fetch(new Request('http://local/api/reports/activity?granularity=day', { headers: auth }))
      const a = (await activity.json()) as { granularity: string; rows: { hurdlesCompleted: number }[] }
      expect(a.granularity).toBe('day')
      const todays = a.rows.filter((r) => r.hurdlesCompleted > 0)
      expect(todays.length).toBeGreaterThan(0) // the solved hurdle lands in today's bucket
    } finally {
      close()
    }
  })
})