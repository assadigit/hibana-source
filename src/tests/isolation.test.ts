import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession, validateSession, destroySession } from '../auth/sessions'
import { createApp } from '../app'
import { createSqliteDb } from '../db/sqlite'
import type { Db } from '../db/types'

// Spec §11: "user A's queries can never return user B's rows." This is the most
// load-bearing test in the suite — it would be invisible in normal use and the most
// damaging if it silently regressed. Every user-owned query must filter on user_id
// (rule 1) — these tests attack every read/write path from both directions.
async function makeAuthedApp(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    assets: undefined,
  })
  const token = await createSession(db, userId)
  return { app, cookie: `hibana_session=${token}` }
}

describe('user isolation (rule 1)', () => {
  it('list, get, update, delete of projects are scoped', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)

      // A creates one project (a pipeline stage, not a spark — sparks are excluded
      // from the default list since they live on their own shelf)
      let res = await appA.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: ca, Origin: 'http://local' },
          body: JSON.stringify({ title: 'A project', status: 'unreviewed' }),
        }),
      )
      const aProject = (await res.json()) as { id: string }
      expect(res.status).toBe(201)

      // B's list is empty — A's rows never leak
      res = await appB.fetch(new Request('http://local/api/projects', { headers: { Cookie: cb } }))
      const bList = (await res.json()) as { projects: unknown[] }
      expect(bList.projects).toHaveLength(0)

      // A's list has exactly A's row
      res = await appA.fetch(new Request('http://local/api/projects', { headers: { Cookie: ca } }))
      const aList = (await res.json()) as { projects: { id: string }[] }
      expect(aList.projects).toHaveLength(1)
      expect(aList.projects[0].id).toBe(aProject.id)

      // B cannot read, update, or delete A's project
      res = await appB.fetch(new Request(`http://local/api/projects/${aProject.id}`, { headers: { Cookie: cb } }))
      expect(res.status).toBe(404)
      res = await appB.fetch(
        new Request(`http://local/api/projects/${aProject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cb, Origin: 'http://local' },
          body: JSON.stringify({ title: 'hacked' }),
        }),
      )
      expect(res.status).toBe(404)
      res = await appB.fetch(new Request(`http://local/api/projects/${aProject.id}`, { method: 'DELETE', headers: { Cookie: cb, Origin: 'http://local' } }))
      expect(res.status).toBe(404)

      // A can still see the project
      res = await appA.fetch(new Request(`http://local/api/projects`, { headers: { Cookie: ca } }))
      const aAfter = (await res.json()) as { projects: unknown[] }
      expect(aAfter.projects).toHaveLength(1)

      // B cannot touch A's hurdles either (child tables scope through the project)
      res = await appB.fetch(
        new Request(`http://local/api/projects/${aProject.id}/hurdles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cb, Origin: 'http://local' },
          body: JSON.stringify({ text: 'intruder hurdle' }),
        }),
      )
      expect(res.status).toBe(404)
    } finally {
      close()
    }
  })

  it('search results are user-scoped', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)

      await appA.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: ca, Origin: 'http://local' },
          body: JSON.stringify({ title: 'secret treasure map', status: 'unreviewed' }),
        }),
      )
      const res = await appB.fetch(new Request('http://local/api/search?q=treasure', { headers: { Cookie: cb } }))
      const body = (await res.json()) as { projects: { id: string }[] }
      expect(body.projects).toHaveLength(0) // B must never find A's data, even via search

      const resA = await appA.fetch(new Request('http://local/api/search?q=treasure', { headers: { Cookie: ca } }))
      const bodyA = (await resA.json()) as { projects: { id: string }[] }
      expect(bodyA.projects).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('tags are user-scoped', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)

      await appA.fetch(
        new Request('http://local/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: ca, Origin: 'http://local' },
          body: JSON.stringify({ name: 'private-tag', color: '#ff0000' }),
        }),
      )
      const res = await appB.fetch(new Request('http://local/api/tags', { headers: { Cookie: cb } }))
      const body = (await res.json()) as { tags: unknown[] }
      expect(body.tags).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('protected routes require a valid session', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const { app } = await makeAuthedApp(db, a)
      // garbage cookie
      const res = await app.fetch(new Request('http://local/api/projects', { headers: { Cookie: 'hibana_session=garbage' } }))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })
})