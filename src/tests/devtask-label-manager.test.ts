import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S30 batch 4 (user request 2026-09-12): the LABEL MANAGER — rename (colliding names
// MERGE), recolor, explicit merge, delete-unused-only. usage_count stays honest (B2)
// and renames REWRITE search_tags so FTS follows the new name.

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

type App = ReturnType<typeof createApp>

async function createProject(app: App, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const mkTask = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))

const tagsOf = async (app: App, headers: Record<string, string>) =>
  ((await (await app.fetch(new Request('http://local/api/tags', { headers }))).json()) as { tags: { id: string; name: string; color: string; usage_count: number }[] }).tags

describe('label manager (S30 batch 4)', () => {
  it('GET /api/tags lists with live usage; PATCH recolors; renames rewrite FTS', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe one')
      await mkTask(app, headers, pid, { title: 'styled button', tags: ['UI/UX'] })
      await mkTask(app, headers, pid, { title: 'second styled', tags: ['UI/UX'] })

      const tags = await tagsOf(app, headers)
      expect(tags).toHaveLength(1)
      expect(tags[0]).toMatchObject({ name: 'UI/UX', usage_count: 2 })
      expect(tags[0].color).toMatch(/^#[0-9a-fA-F]{6}$/)

      // recolor
      const recolor = await app.fetch(new Request(`http://local/api/tags/${tags[0].id}`, { method: 'PATCH', headers, body: JSON.stringify({ color: '#8FD3A9' }) }))
      expect(recolor.status).toBe(200)
      expect((await tagsOf(app, headers))[0].color).toBe('#8FD3A9')

      // plain rename: FTS follows (searching the NEW name finds the task, the OLD doesn't)
      const rename = await app.fetch(new Request(`http://local/api/tags/${tags[0].id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Design' }) }))
      expect(rename.status).toBe(200)
      expect((await tagsOf(app, headers))[0].name).toBe('Design')
      const hitsNew = await app.fetch(new Request('http://local/api/search?q=Design', { headers }))
      expect(((await hitsNew.json()) as { tasks: { title: string }[] }).tasks).toHaveLength(2)
      const hitsOld = await app.fetch(new Request('http://local/api/search?q=UI%2FUX', { headers }))
      expect(((await hitsOld.json()) as { tasks: unknown[] }).tasks).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('rename onto an EXISTING name MERGES (links move, source deleted, usage adds up)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe two')
      const t1 = (await (await mkTask(app, headers, pid, { title: 'one', tags: ['Refactor'] })).json()) as { id: string }
      await mkTask(app, headers, pid, { title: 'two', tags: ['Refactor'] })
      await mkTask(app, headers, pid, { title: 'three', tags: ['Tech-Debt'] })

      const tags = await tagsOf(app, headers)
      const refactor = tags.find((t) => t.name === 'Refactor')!
      const techDebt = tags.find((t) => t.name === 'Tech-Debt')!

      // rename Refactor → Tech-Debt: collision → merge
      const res = await app.fetch(new Request(`http://local/api/tags/${refactor.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'tech-debt' }) }))
      expect(res.status).toBe(200)
      expect(((await res.json()) as { merged_into: string }).merged_into).toBe(techDebt.id)

      const after = await tagsOf(app, headers)
      expect(after.map((t) => t.name)).toEqual(['Tech-Debt']) // Refactor is gone
      expect(after[0].usage_count).toBe(3) // 2 moved links + its own

      // FTS: the task that only had Refactor now matches Tech-Debt
      const hits = await app.fetch(new Request('http://local/api/search?q=Tech-Debt', { headers }))
      const titles = ((await hits.json()) as { tasks: { title: string }[] }).tasks.map((t) => t.title).sort()
      expect(titles).toEqual(['one', 'three', 'two'])
      // and the task detail still shows exactly ONE link (no duplicate rows)
      const detail = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
      const board = (await detail.json()) as { tasks: { id: string; tags: string[] }[] }
      expect(board.tasks.find((t) => t.id === t1.id)?.tags).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('explicit merge endpoint moves links; delete is unused-only (409 when used, 200 when not)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe three')
      await mkTask(app, headers, pid, { title: 'a', tags: ['Alpha'] })
      await mkTask(app, headers, pid, { title: 'b', tags: ['Beta'] })
      const tags = await tagsOf(app, headers)
      const alpha = tags.find((t) => t.name === 'Alpha')!
      const beta = tags.find((t) => t.name === 'Beta')!

      // delete while USED → 409 tag_in_use
      const usedDel = await app.fetch(new Request(`http://local/api/tags/${alpha.id}`, { method: 'DELETE', headers }))
      expect(usedDel.status).toBe(409)

      // explicit merge Alpha → Beta
      const merge = await app.fetch(new Request(`http://local/api/tags/${alpha.id}/merge`, { method: 'POST', headers, body: JSON.stringify({ into: beta.id }) }))
      expect(merge.status).toBe(200)
      const after = await tagsOf(app, headers)
      expect(after.map((t) => t.name)).toEqual(['Beta'])
      expect(after[0].usage_count).toBe(2)

      // now Alpha is gone; create a fresh unused tag and delete it
      await mkTask(app, headers, pid, { title: 'temp', tags: ['Gamma'] })
      const t2 = (await (await mkTask(app, headers, pid, { title: 'temp2', tags: ['Gamma'] })).json()) as { id: string }
      await app.fetch(new Request(`http://local/api/devtasks/${t2.id}`, { method: 'DELETE', headers }))
      const gamma = (await tagsOf(app, headers)).find((t) => t.name === 'Gamma')!
      expect(gamma.usage_count).toBe(1)
      const del = await app.fetch(new Request(`http://local/api/tags/${gamma.id}`, { method: 'DELETE', headers }))
      expect(del.status).toBe(409)
      // delete the carrying task → Gamma unused → delete succeeds
      const board = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { title: string; id: string }[] }
      const tempTask = board.tasks.find((t) => t.title === 'temp')!
      await app.fetch(new Request(`http://local/api/devtasks/${tempTask.id}`, { method: 'DELETE', headers }))
      const gamma2 = (await tagsOf(app, headers)).find((t) => t.name === 'Gamma')!
      expect(gamma2.usage_count).toBe(0)
      const del2 = await app.fetch(new Request(`http://local/api/tags/${gamma2.id}`, { method: 'DELETE', headers }))
      expect(del2.status).toBe(200)
    } finally {
      close()
    }
  })

  it('rule 1: a stranger cannot list, patch, merge, or delete the owner’s tags', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const strangerId = await makeUser(db)
      const { app, headers } = await makeApp(db, ownerId)
      const pid = await createProject(app, headers, 'isolated')
      await mkTask(app, headers, pid, { title: 'x', tags: ['Private'] })
      const ownerTag = (await tagsOf(app, headers))[0]

      const stranger = await makeApp(db, strangerId)
      const list = await stranger.app.fetch(new Request('http://local/api/tags', { headers: stranger.headers }))
      expect(((await list.json()) as { tags: unknown[] }).tags).toEqual([]) // own list is empty
      const patch = await stranger.app.fetch(new Request(`http://local/api/tags/${ownerTag.id}`, { method: 'PATCH', headers: stranger.headers, body: JSON.stringify({ name: 'stolen' }) }))
      expect(patch.status).toBe(404)
      const merge = await stranger.app.fetch(new Request(`http://local/api/tags/${ownerTag.id}/merge`, { method: 'POST', headers: stranger.headers, body: JSON.stringify({ into: ownerTag.id }) }))
      expect(merge.status).toBe(404)
      const del = await stranger.app.fetch(new Request(`http://local/api/tags/${ownerTag.id}`, { method: 'DELETE', headers: stranger.headers }))
      expect(del.status).toBe(404)
    } finally {
      close()
    }
  })
})
