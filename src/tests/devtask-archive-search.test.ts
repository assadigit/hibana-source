import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S30 (2026-09-12) — the four task-label fixes that rode 0051:
//   B1: labels survive archive → restore (project_archives.tags JSON snapshot).
//   B2: tags.usage_count is MAINTAINED (was written 0 and never touched) — every link
//       mutation recomputes it: create/PATCH tags, tag add/remove endpoints, task
//       delete, archive (cascade), restore, project-tag attach/detach.
//   B3: dev_tasks are searchable — FTS5 over title + label names (search_tags).
//   B4: new tags spread across the palette (least-used color), no more hash collisions.

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

const mkTask = (app: App, headers: Record<string, string>, pid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify(body) }))

const patchTask = (app: App, headers: Record<string, string>, tid: string, body: Record<string, unknown>) =>
  app.fetch(new Request(`http://local/api/devtasks/${tid}`, { method: 'PATCH', headers, body: JSON.stringify(body) }))

const search = (app: App, headers: Record<string, string>, q: string) =>
  app.fetch(new Request(`http://local/api/search?q=${encodeURIComponent(q)}`, { headers }))

const usage = async (db: Db, userId: string) => {
  const rows = await db.query<{ name: string; usage_count: number }>('SELECT name, usage_count FROM tags WHERE user_id = ? ORDER BY name', [userId])
  return new Map(rows.map((r) => [r.name, r.usage_count]))
}

describe('B1: labels survive archive → restore', () => {
  it('archive snapshots tag names; restore relinks them; the GET carries the snapshot', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'b1 probe')

      // two done tasks, one labeled, one not
      const a = (await (await mkTask(app, headers, pid, { title: 'fix auth leak', status: 'done', priority: 'urgent', tags: ['Security', 'UI/UX'] })).json()) as { id: string }
      const b = (await (await mkTask(app, headers, pid, { title: 'plain done', status: 'done' })).json()) as { id: string }

      // Archive: the done tasks move to project_archives WITH their labels.
      const arch = await app.fetch(new Request(`http://local/api/projects/${pid}/devtasks/archive-done`, { method: 'POST', headers }))
      expect(arch.status).toBe(200)
      expect(((await arch.json()) as { archived: number }).archived).toBe(2)

      // the snapshot rides the GET (names + colors), the labeled one only
      const list = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/archives`, { headers }))).json()) as { archives: { id: string; tags: { name: string; color: string }[] }[] }
      const aRow = list.archives.find((r) => r.id === a.id)!
      expect(aRow.tags.map((t) => t.name).sort()).toEqual(['Security', 'UI/UX'])
      expect(aRow.tags.every((t) => /^#[0-9a-fA-F]{6}$/.test(t.color))).toBe(true)
      expect(list.archives.find((r) => r.id === b.id)!.tags).toEqual([])
      // B2 rode along: the cascade deleted the link rows, usage dropped to 0
      expect((await usage(db, userId)).get('Security')).toBe(0)

      // Restore: the labeled task comes back LABELED (relink by name), the plain one plain.
      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/archives/${a.id}/restore`, { method: 'POST', headers }))
      expect(res.status).toBe(200)
      const board = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string; title: string; priority: string; tags: string[] }[]; task_tags: { task_id: string; name: string }[] }
      const restored = board.tasks.find((t) => t.id === a.id)!
      expect(restored.priority).toBe('urgent') // priority always survived
      expect(restored.tags).toHaveLength(2) // labels now survive too
      expect(board.task_tags.filter((t) => t.task_id === a.id).map((t) => t.name).sort()).toEqual(['Security', 'UI/UX'])
      // and usage came back with the links
      expect((await usage(db, userId)).get('Security')).toBe(1)
    } finally {
      close()
    }
  })
})

describe('B2: usage_count is maintained on every link mutation', () => {
  it('create → 1, shared → 2, replace-set drop → back, [] clear → 0, task delete → 0', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'b2 probe')

      const a = (await (await mkTask(app, headers, pid, { title: 'a', tags: ['UI/UX'] })).json()) as { id: string }
      expect((await usage(db, userId)).get('UI/UX')).toBe(1)

      const b = (await (await mkTask(app, headers, pid, { title: 'b', tags: ['ui/ux'] })).json()) as { id: string }
      expect((await usage(db, userId)).get('UI/UX')).toBe(2) // same row, two links

      await patchTask(app, headers, b.id, { tags: [] }) // clear b's links
      expect((await usage(db, userId)).get('UI/UX')).toBe(1)

      // the tag add/remove endpoints keep it honest too
      const add = (await (await app.fetch(new Request(`http://local/api/devtasks/${b.id}/tags`, { method: 'POST', headers, body: JSON.stringify({ name: 'Security' }) }))).json()) as { id: string }
      expect((await usage(db, userId)).get('Security')).toBe(1)
      await app.fetch(new Request(`http://local/api/devtasks/${b.id}/tags/${add.id}`, { method: 'DELETE', headers }))
      expect((await usage(db, userId)).get('Security')).toBe(0)

      // deleting the task drops the last link
      await app.fetch(new Request(`http://local/api/devtasks/${a.id}`, { method: 'DELETE', headers }))
      expect((await usage(db, userId)).get('UI/UX')).toBe(0)
    } finally {
      close()
    }
  })

  it('project-tag chips count toward the same usage number', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'b2b probe')
      const mk = await mkTask(app, headers, pid, { title: 't', tags: ['UI/UX'] })
      expect(mk.status).toBe(201)

      const t = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/tags`, { method: 'POST', headers, body: JSON.stringify({ name: 'UI/UX' }) }))).json()) as { id: string }
      expect((await usage(db, userId)).get('UI/UX')).toBe(2) // 1 task link + 1 project chip
      await app.fetch(new Request(`http://local/api/projects/${pid}/tags/${t.id}`, { method: 'DELETE', headers }))
      expect((await usage(db, userId)).get('UI/UX')).toBe(1)
    } finally {
      close()
    }
  })
})

describe('B3: dev_tasks in FTS search (title + labels)', () => {
  it('a title hit and a LABEL hit both surface, with project + priority; strangers see none', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const strangerId = await makeUser(db)
      const { app, headers } = await makeApp(db, ownerId)
      const pid = await createProject(app, headers, 'b3 probe')

      await mkTask(app, headers, pid, { title: 'rotate auth token quarterly', status: 'in_progress', priority: 'urgent', tags: ['Security'] })
      await mkTask(app, headers, pid, { title: 'unrelated title', tags: ['Security'] })
      await mkTask(app, headers, pid, { title: 'totally different', tags: ['Docs'] })

      // exact-phrase title hit
      const byTitle = (await (await search(app, headers, 'auth token')).json()) as { tasks: { title: string; project_title: string; priority: string }[] }
      expect(byTitle.tasks.map((t) => t.title)).toEqual(['rotate auth token quarterly'])
      expect(byTitle.tasks[0].priority).toBe('urgent')
      expect(byTitle.tasks[0].project_title).toBe('b3 probe')

      // LABEL hit: searching "Security" finds both labeled tasks even though only one
      // title mentions it — that was the whole point of B3.
      const byLabel = (await (await search(app, headers, 'Security')).json()) as { tasks: { title: string }[] }
      expect(byLabel.tasks.map((t) => t.title).sort()).toEqual(['rotate auth token quarterly', 'unrelated title'])

      // label changes re-index: clearing the tags removes the label hit
      const board = (await (await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))).json()) as { tasks: { id: string; title: string }[] }
      const sec = board.tasks.find((t) => t.title === 'unrelated title')!
      await patchTask(app, headers, sec.id, { tags: [] })
      const after = (await (await search(app, headers, 'Security')).json()) as { tasks: { title: string }[] }
      expect(after.tasks.map((t) => t.title)).toEqual(['rotate auth token quarterly'])

      // rule 1: the stranger's search sees none of the owner's tasks
      const stranger = await makeApp(db, strangerId)
      const theirs = (await (await search(stranger.app, stranger.headers, 'auth token')).json()) as { tasks: unknown[] }
      expect(theirs.tasks).toEqual([])
    } finally {
      close()
    }
  })
})

describe('B4: new tags spread across the palette (no hash collisions)', () => {
  it('eight fresh tags get eight DISTINCT colors; the 9th reuses the least-used', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'b4 probe')

      // "Refactor" and "Tech-Debt" both hashed to #E59AA5 under the old scheme — with
      // least-used assignment the first 8 fresh names cover all 8 palette colors.
      const names = ['Refactor', 'Tech-Debt', 'UI/UX', 'Security', 'Docs', 'Backend', 'Infra', 'Polish']
      for (const n of names) {
        const r = await mkTask(app, headers, pid, { title: 't ' + n, tags: [n] })
        expect(r.status).toBe(201)
      }
      const rows = await db.query<{ name: string; color: string }>('SELECT name, color FROM tags WHERE user_id = ? ORDER BY name', [userId])
      const colors = new Set(rows.map((r) => r.color.toLowerCase()))
      expect(rows).toHaveLength(8)
      expect(colors.size).toBe(8) // all distinct — the old hash gave 7 or fewer

      // the 9th name must reuse SOME palette color (the least-used one)
      await mkTask(app, headers, pid, { title: 't9', tags: ['Extra'] })
      const nine = await db.query<{ name: string; color: string }>('SELECT name, color FROM tags WHERE user_id = ? AND name = ?', [userId, 'Extra'])
      expect(nine).toHaveLength(1)
      expect(['#8ab8f0', '#e8b27d', '#e59aa5', '#8fd3a9', '#b3a5d6', '#7cc7c1', '#f2d58a', '#c9cdd2']).toContain(nine[0].color.toLowerCase())
    } finally {
      close()
    }
  })
})
