import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config, Db } from '../types'

// S35 (user request 2026-09): the project/idea ARCHIVE — archived_state='offline'
// parks a row off every working surface (projects list, glance counts, ideas shelf,
// dashboard) onto /archive.html. NOT trash (no purge), NOT halted (paused mid-work).
// These pins: the archive/unarchive round-trip + history log, the list/counts
// exclusion, the archived=1 shelf fragment with its restore action, and rule 1.

afterEach(() => {
  vi.unstubAllGlobals()
})

async function makeProject(db: Db, userId: string, status: string, title = 'Idea'): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    [id, userId, title, 'desc', 'personal', status, '', new Date().toISOString(), new Date().toISOString()],
  )
  return id
}

function h(token: string) {
  return { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
}

describe('project/idea archive (S35)', () => {
  it('archive → excluded from lists + counts + shelf; unarchive restores; history logged', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const idea = await makeProject(db, userId, 'spark', 'Blockchain toaster')
      const live = await makeProject(db, userId, 'developing', 'Hibana')

      // archive the idea
      const arch = await app.fetch(new Request(`http://local/api/projects/${idea}/archive`, { method: 'POST', headers: h(token) }))
      expect(arch.status).toBe(200)
      expect(((await arch.json()) as { archived: boolean }).archived).toBe(true)
      // double-archive is a 409
      const again = await app.fetch(new Request(`http://local/api/projects/${idea}/archive`, { method: 'POST', headers: h(token) }))
      expect(again.status).toBe(409)

      // the JSON list EXCLUDES the archived row (the live one stays)
      const list = await app.fetch(new Request('http://local/api/projects', { headers: { Cookie: `hibana_session=${token}` } }))
      const { projects } = (await list.json()) as { projects: { id: string }[] }
      expect(projects.some((p) => p.id === idea)).toBe(false)
      expect(projects.some((p) => p.id === live)).toBe(true)

      // the ideas shelf (status=spark) HX fragment drops it too
      const shelf = await app.fetch(
        new Request('http://local/api/projects?status=spark&folder=all', { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const shelfHtml = await shelf.text()
      expect(shelfHtml).not.toContain('Blockchain toaster')

      // the ARCHIVE shelf lists it, with the restore action
      const arc = await app.fetch(
        new Request('http://local/api/projects?archived=1', { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const arcHtml = await arc.text()
      expect(arcHtml).toContain('Blockchain toaster')
      expect(arcHtml).toContain(`/api/projects/${idea}/unarchive?shelf=1`)

      // history carries both entries
      const hist = await db.query<{ note: string }>('SELECT note FROM project_history_log WHERE project_id = ? ORDER BY created_at', [idea])
      expect(hist.map((r) => r.note)).toContain('Archived — parked, not deleted')

      // unarchive (the shelf=1 path returns the refreshed SHELF fragment)
      const un = await app.fetch(
        new Request(`http://local/api/projects/${idea}/unarchive?shelf=1`, { method: 'POST', headers: { ...h(token), 'HX-Request': '1' } }),
      )
      expect(un.status).toBe(200)
      const unHtml = await un.text()
      expect(unHtml).not.toContain('Blockchain toaster') // gone from the shelf
      const row = await db.query<{ archived_state: string }>('SELECT archived_state FROM projects WHERE id = ?', [idea])
      expect(row[0].archived_state).toBe('online')
      const hist2 = await db.query<{ note: string }>('SELECT note FROM project_history_log WHERE project_id = ? ORDER BY created_at', [idea])
      expect(hist2.map((r) => r.note)).toContain('Restored from archive')

      // back on the IDEAS shelf (sparks never appear in the main projects list)
      const shelf2 = await app.fetch(
        new Request('http://local/api/projects?status=spark&folder=all', { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const shelf2Html = await shelf2.text()
      expect(shelf2Html).toContain('Blockchain toaster')
    } finally {
      close()
    }
  })

  it('the glance counts exclude archived rows; the detail page swaps in the archived banner', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const token = await createSession(db, userId)
      const a = await makeProject(db, userId, 'queued', 'A')
      await makeProject(db, userId, 'queued', 'B')

      // grid fragment counts BEFORE: awaiting = 2
      const before = await app.fetch(
        new Request('http://local/api/projects?view=grid', { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )
      const beforeHtml = await before.text()
      expect(beforeHtml).toContain('pglance-box')

      await app.fetch(new Request(`http://local/api/projects/${a}/archive`, { method: 'POST', headers: h(token) }))

      // AFTER: the archived row does not count
      const afterHtml = await (await app.fetch(
        new Request('http://local/api/projects?view=grid', { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )).text()
      const m = /data-pglance="queued"[\s\S]*?pglance-count"[^>]*>(\d+)</.exec(afterHtml)
      expect(m?.[1]).toBe('1')

      // the detail page shows the banner + restore button instead of the archive button
      // (attribute-exact: [data-pd-archive-done] — the board's archive-done button — must
      // still be there, so a substring match on 'data-pd-archive' would false-positive)
      const detailHtml = await (await app.fetch(
        new Request(`http://local/api/projects/${a}`, { headers: { Cookie: `hibana_session=${token}`, 'HX-Request': '1' } }),
      )).text()
      expect(detailHtml).toContain('pd-archived-banner')
      expect(detailHtml).toContain('data-pd-unarchive')
      // the plain archive button is gone — exact attribute match (the board's
      // data-pd-archive-done and the archives section's data-pd-archives-toggle stay)
      expect(detailHtml).not.toMatch(/data-pd-archive[ \"=]/)
    } finally {
      close()
    }
  })

  it('rule 1: another user cannot archive or restore my project', async () => {
    const { db, close } = makeTestDb()
    try {
      const ownerId = await makeUser(db)
      const otherId = await makeUser(db, { email: 'other@test.dev' })
      const app = createApp({ db, isProd: false, emailKey: undefined } as unknown as Config)
      const mine = await makeProject(db, ownerId, 'developing', 'Mine')
      const otherToken = await createSession(db, otherId)
      const res = await app.fetch(new Request(`http://local/api/projects/${mine}/archive`, { method: 'POST', headers: h(otherToken) }))
      expect(res.status).toBe(404)
      const row = await db.query<{ archived_state: string | null }>('SELECT archived_state FROM projects WHERE id = ?', [mine])
      expect(row[0].archived_state).toBeNull()
    } finally {
      close()
    }
  })
})
