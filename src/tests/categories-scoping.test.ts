import { describe, it, expect } from 'vitest'
import { makeTestDb, makeTestDbUpto, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S181 (0064, the owner's written approval): the category library is USER-SCOPED.
// Before 0064 the table had no owner column — every account on a shared install
// saw and could mutate the SAME library (the routes even carried `void user`
// placeholders where scoping was deliberately skipped). These tests attack every
// category path from both directions, the isolation.test.ts way: user A's
// queries can never return user B's rows, and same-named rows in two libraries
// are LEGAL now (per-user uniqueness replaced the global one).
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

const json = { 'Content-Type': 'application/json', Origin: 'http://local' }

type FetchApp = { fetch: (req: Request) => Response | Promise<Response> }

async function createCategory(app: FetchApp, cookie: string, name: string) {
  const res = await app.fetch(
    new Request('http://local/api/categories', {
      method: 'POST',
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ name, color_fill: '#CCD5F0', color_text: '#273768' }),
    }),
  )
  return { status: res.status, body: (await res.json()) as { id?: string; error?: string } }
}

async function createProject(app: FetchApp, cookie: string, title: string) {
  const res = await app.fetch(
    new Request('http://local/api/projects', {
      method: 'POST',
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ title, status: 'developing' }),
    }),
  )
  return (await res.json()) as { id: string }
}

describe('category library user-scoping (S181 / 0064)', () => {
  it('two users may hold the SAME live name — per-user uniqueness, zero cross-leak', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)

      // The PRE-0064 behavior: the second same-named create was a 409 duplicate
      // (the global library deduped). Post-0064 both libraries carry their own row.
      const ra = await createCategory(appA, ca, 'ui/ux')
      const rb = await createCategory(appB, cb, ' UI/UX ')
      expect(ra.status).toBe(201)
      expect(rb.status).toBe(201)
      expect(ra.body.id).not.toBe(rb.body.id) // two DISTINCT rows

      // Each list sees exactly its own row (case/trim-insensitive match was per-user).
      const la = await (await appA.fetch(new Request('http://local/api/categories', { headers: { Cookie: ca } }))).json() as { categories: { id: string; user_id: string }[] }
      const lb = await (await appB.fetch(new Request('http://local/api/categories', { headers: { Cookie: cb } }))).json() as { categories: { id: string; user_id: string }[] }
      expect(la.categories).toHaveLength(1)
      expect(lb.categories).toHaveLength(1)
      expect(la.categories[0].id).toBe(ra.body.id)
      expect(lb.categories[0].id).toBe(rb.body.id)

      // A duplicate WITHIN one library is still a 409 (the per-user unique index
      // folds case + trim: "  Ui/Ux  " is the same name as "ui/ux").
      const dup = await createCategory(appA, ca, '  Ui/Ux  ')
      expect(dup.status).toBe(409)
    } finally {
      close()
    }
  })

  it('rename / archive / delete of a foreign category is a 404 — the row is invisible', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)
      const { body } = await createCategory(appA, ca, 'backend')

      // B cannot rename A's row (a same-named rename would otherwise collide).
      let res = await appB.fetch(
        new Request(`http://local/api/categories/${body.id}`, {
          method: 'PATCH',
          headers: { ...json, Cookie: cb },
          body: JSON.stringify({ name: 'stolen' }),
        }),
      )
      expect(res.status).toBe(404)

      // B cannot archive it.
      res = await appB.fetch(new Request(`http://local/api/categories/${body.id}/archive`, { method: 'POST', headers: { ...json, Cookie: cb } }))
      expect(res.status).toBe(404)

      // B cannot delete it (the transaction would have nulled A's task references).
      res = await appB.fetch(new Request(`http://local/api/categories/${body.id}`, { method: 'DELETE', headers: { ...json, Cookie: cb } }))
      expect(res.status).toBe(404)

      // A still can — ownership is intact after the attacks.
      res = await appA.fetch(new Request(`http://local/api/categories/${body.id}`, { method: 'DELETE', headers: { ...json, Cookie: ca } }))
      expect(res.status).toBe(200)
    } finally {
      close()
    }
  })

  it('the per-project enable-set rejects a foreign category id (400, not half-applied)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)
      const foreign = await createCategory(appA, ca, 'a-lib')
      const bProject = await createProject(appB, cb, 'B project')

      // B tries to enable A's category on B's own project: a foreign id is a 400.
      const res = await appB.fetch(
        new Request(`http://local/api/projects/${bProject.id}/categories`, {
          method: 'PUT',
          headers: { ...json, Cookie: cb },
          body: JSON.stringify({ ids: [foreign.body.id] }),
        }),
      )
      expect(res.status).toBe(400)

      // And the read side never OFFERS the foreign row (B's toggle list = B's library).
      const list = await (await appB.fetch(new Request(`http://local/api/projects/${bProject.id}/categories`, { headers: { Cookie: cb } }))).json() as { categories: { id: string }[] }
      expect(list.categories.map((c) => c.id)).not.toContain(foreign.body.id)
    } finally {
      close()
    }
  })

  it('the devboard quick-add reuses only the CALLER\'S same-named row (not a foreign library\'s)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db)
      const b = await makeUser(db)
      const { app: appA, cookie: ca } = await makeAuthedApp(db, a)
      const { app: appB, cookie: cb } = await makeAuthedApp(db, b)

      // A already has "perf" in A's library; B quick-adds "perf" on B's project.
      const aCat = await createCategory(appA, ca, 'perf')
      const bProject = await createProject(appB, cb, 'B dev project')
      const res = await appB.fetch(
        new Request(`http://local/api/projects/${bProject.id}/categories`, {
          method: 'POST',
          headers: { ...json, Cookie: cb },
          body: JSON.stringify({ name: 'perf', color_fill: '#D0F0CC', color_text: '#2F6827' }),
        }),
      )
      const body = (await res.json()) as { ok?: boolean; id?: string; existing?: boolean }
      expect(res.status).toBe(201)
      expect(body.existing).toBeUndefined() // a NEW row — A's "perf" was NOT attached
      expect(body.id).not.toBe(aCat.body.id)

      // B's project is enabled on B's row only; A's library is untouched.
      const enabled = await (await appB.fetch(new Request(`http://local/api/projects/${bProject.id}/categories`, { headers: { Cookie: cb } }))).json() as { enabled: string[] }
      expect(enabled.enabled).toEqual([body.id])
    } finally {
      close()
    }
  })

  it('S181 belt: a D1 that has not applied 0064 yet stays fully usable (the probe\'s un-scoped fallback)', async () => {
    const { db, close } = makeTestDbUpto(63) // schema 63: categories has NO user_id
    try {
      const u = await makeUser(db)
      const { app, cookie } = await makeAuthedApp(db, u)

      // Create + list + project-enable all work exactly like the pre-0064 install
      // (the deploy-ahead window behaves, never 500s).
      const created = await createCategory(app, cookie, 'legacy-window')
      expect(created.status).toBe(201)
      const list = await (await app.fetch(new Request('http://local/api/categories', { headers: { Cookie: cookie } }))).json() as { categories: { id: string }[] }
      expect(list.categories.map((c) => c.id)).toContain(created.body.id)
      const p = await createProject(app, cookie, 'window project')
      const res = await app.fetch(
        new Request(`http://local/api/projects/${p.id}/categories`, {
          method: 'PUT',
          headers: { ...json, Cookie: cookie },
          body: JSON.stringify({ ids: [created.body.id as string] }),
        }),
      )
      expect(res.status).toBe(200)
    } finally {
      close()
    }
  })
})
