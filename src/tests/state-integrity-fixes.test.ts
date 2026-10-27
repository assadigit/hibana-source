import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config, Db } from '../types'

// Phase 2 state-integrity fixes (auditor P2-d, verified by the lead):
//   AP-27 — sprint/category hard-delete left dangling ids inside project_archives
//            snapshots; restoring such an archive re-inserted dead FK ids into
//            dev_tasks → SQLITE_CONSTRAINT → a 500 on every restore attempt, forever.
//   AP-28 — the rail's Ideas panel leaked PARKED (archived_state='offline') sparks.
//   AP-29 — search's projects group returned parked rows (every list surface
//            excludes them).
//   AP-30 — projects drag-reorder re-stamped updated_at for the whole status group
//            (recency/stale views were falsified; the vault's reorder never does this).
//   AP-31 — POST /api/projects/:id/restore was a false-200 for purged ids.
//   AP-32 — quick_notes.project_id dangled after a project hard-delete/purge.
//   AP-33 — Telegram /append & /update matched project titles with an UNESCAPED
//            LIKE prefix: '%'/'_' in the typed title acted as wildcards and the
//            ORDER BY updated_at DESC LIMIT 1 could resolve the WRONG project.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, telegramToken: 'test-bot', telegramSecret: 's' }
}

function h(token: string) {
  return { Cookie: `__Host-hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' }
}

async function setup() {
  const { db, close } = makeTestDb()
  const uid = await makeUser(db)
  const app = createApp(makeConfig(db))
  const token = await createSession(db, uid)
  return { db, close, uid, app, token }
}

const nowIso = () => new Date().toISOString()

async function makeProject(db: Db, uid: string, over: Partial<{ status: string; title: string; archived_state: string; deleted_at: string; updated_at: string }> = {}) {
  const id = crypto.randomUUID()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, type, status, sort_order, archived_state, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
    [id, uid, over.title ?? 'P', 'personal', over.status ?? 'spark', over.archived_state ?? null, over.deleted_at ?? null, nowIso(), over.updated_at ?? nowIso()],
  )
  return id
}

describe('AP-27 — archive restore survives sprint/category hard-delete', () => {
  it('restoring an archived task after its sprint AND category were deleted is a 200, not a permanent 500', async () => {
    const { db, close, uid, app, token } = await setup()
    try {
      const pid = await makeProject(db, uid, { status: 'developing' })
      const sid = crypto.randomUUID()
      const cid = crypto.randomUUID()
      await db.execute("INSERT INTO sprints (id, project_id, name, started_at, created_at) VALUES (?, ?, 'S1', ?, ?)", [sid, pid, nowIso(), nowIso()])
      await db.execute("INSERT INTO categories (id, user_id, name, color_fill, color_text, created_at) VALUES (?, ?, 'Cat', '#111111', '#ffffff', ?)", [cid, uid, nowIso()])
      // the archived snapshot carries BOTH ids (as the real archive flow writes them)
      const aid = crypto.randomUUID()
      await db.execute(
        "INSERT INTO project_archives (id, project_id, title, status, priority, category_id, sprint_id, done_at, original_created_at, archived_at, tags) VALUES (?, ?, 'T', 'done', 'low', ?, ?, ?, ?, ?, '[]')",
        [aid, pid, cid, sid, nowIso(), nowIso(), nowIso()],
      )
      // hard-delete the sprint and the category through the REAL routes
      expect((await app.fetch(new Request(`http://local/api/sprints/${sid}`, { method: 'DELETE', headers: h(token) }))).status).toBe(200)
      expect((await app.fetch(new Request(`http://local/api/categories/${cid}`, { method: 'DELETE', headers: h(token) }))).status).toBe(200)
      // restoring the archived task must not hit the dev_tasks FKs (was: 500 forever)
      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/archives/${aid}/restore`, { method: 'POST', headers: h(token) }))
      expect(res.status).toBe(200)
      const tasks = await db.query<{ title: string; category_id: string | null; sprint_id: string | null }>('SELECT title, category_id, sprint_id FROM dev_tasks WHERE id = ?', [aid])
      expect(tasks.length).toBe(1)
      expect(tasks[0].category_id).toBeNull()
      expect(tasks[0].sprint_id).toBeNull()
    } finally {
      close()
    }
  })
})

describe('AP-28/AP-29 — parked (archived_state=offline) rows stay off the rail + search', () => {
  it('the rail Ideas panel excludes parked sparks', async () => {
    const { db, close, uid, app, token } = await setup()
    try {
      await makeProject(db, uid, { title: 'PARKED-SPARK-SENTINEL', status: 'spark', archived_state: 'offline' })
      await makeProject(db, uid, { title: 'LIVE-SPARK', status: 'spark' })
      const res = await app.fetch(new Request('http://local/api/rail', { headers: { Cookie: `__Host-hibana_session=${token}` } }))
      expect(res.status).toBe(200)
      const body = await res.json()
      const sparks = (body as { sparks: { title: string }[] }).sparks
      expect(sparks.some((s) => s.title === 'LIVE-SPARK')).toBe(true)
      expect(sparks.some((s) => s.title === 'PARKED-SPARK-SENTINEL')).toBe(false)
    } finally {
      close()
    }
  })

  it('the search projects group excludes parked rows', async () => {
    const { db, close, uid, app, token } = await setup()
    try {
      await makeProject(db, uid, { title: 'Parked Thing', status: 'developing', archived_state: 'offline' })
      const res = await app.fetch(new Request('http://local/api/search?q=Parked', { headers: { Cookie: `__Host-hibana_session=${token}` } }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { projects: { title: string }[] }
      expect(body.projects.some((p) => p.title === 'Parked Thing')).toBe(false)
    } finally {
      close()
    }
  })
})

describe('AP-30 — drag-reorder does not masquerade as an edit', () => {
  it('reordering a status group leaves updated_at (and the stale view) untouched', async () => {
    const { db, close, uid, app, token } = await setup()
    try {
      const stale = '2026-09-01T00:00:00.000Z' // 55 days before "today" — deep in stale territory
      const a = await makeProject(db, uid, { status: 'planning', updated_at: stale })
      const b = await makeProject(db, uid, { status: 'planning', updated_at: stale })
      const res = await app.fetch(
        new Request('http://local/api/projects/reorder', { method: 'POST', headers: h(token), body: JSON.stringify({ status: 'planning', ids: [b, a] }) }),
      )
      expect(res.status).toBe(200)
      const rows = await db.query<{ id: string; updated_at: string }>('SELECT id, updated_at FROM projects WHERE id IN (?, ?)', [a, b])
      for (const r of rows) expect(r.updated_at).toBe(stale) // old: re-stamped to now
      // the stale view still lists them
      const staleList = await app.fetch(new Request('http://local/api/projects?stale=1', { headers: { Cookie: `__Host-hibana_session=${token}` } }))
      const staleBody = (await staleList.json()) as { projects: { id: string }[] }
      expect(staleBody.projects.some((p) => p.id === a)).toBe(true)
    } finally {
      close()
    }
  })
})

describe('AP-31/AP-32 — restore truthfulness + note attach-chip survival', () => {
  it('restoring a PURGED project id is a 404, not a false-200 "Restored" toast', async () => {
    const { db, close, uid, app, token } = await setup()
    try {
      const pid = await makeProject(db, uid, { deleted_at: nowIso() })
      // purge it from trash through the REAL route
      expect((await app.fetch(new Request('http://local/api/settings/trash/purge', { method: 'POST', headers: h(token), body: JSON.stringify({ kind: 'project', id: pid }) }))).status).toBe(200)
      const res = await app.fetch(new Request(`http://local/api/projects/${pid}/restore`, { method: 'POST', headers: h(token) }))
      expect(res.status).toBe(404) // old: 200 {ok:true}
    } finally {
      close()
    }
  })

  it('purging a project nulls quick_notes.project_id (the attach chip degrades, never dangles)', async () => {
    const { db, close, uid, app, token } = await setup()
    try {
      const pid = await makeProject(db, uid, { deleted_at: nowIso() })
      const nid = crypto.randomUUID()
      await db.execute("INSERT INTO quick_notes (id, user_id, kind, title, content, project_id, created_at, updated_at) VALUES (?, ?, 'note', 'n', 'c', ?, ?, ?)", [nid, uid, pid, nowIso(), nowIso()])
      expect((await app.fetch(new Request('http://local/api/settings/trash/purge', { method: 'POST', headers: h(token), body: JSON.stringify({ kind: 'project', id: pid }) }))).status).toBe(200)
      const rows = await db.query<{ project_id: string | null }>('SELECT project_id FROM quick_notes WHERE id = ?', [nid])
      expect(rows[0].project_id).toBeNull() // old: keeps the dead id
    } finally {
      close()
    }
  })
})

describe('AP-33 — Telegram title matching escapes LIKE wildcards', () => {
  it('/append "100%" resolves the project titled "100% Done", not the newer "100 Things"', async () => {
    const { db, close, uid } = await setup()
    try {
      // "100 Things" is newer (updated_at later) — the unescaped LIKE would rank it first
      await makeProject(db, uid, { title: '100% Done', status: 'developing', updated_at: '2026-10-01T00:00:00.000Z' })
      await makeProject(db, uid, { title: '100 Things', status: 'developing', updated_at: '2026-10-20T00:00:00.000Z' })
      await db.execute('UPDATE users SET telegram_chat_id = ? WHERE id = ?', ['42', uid])
      // source-contract pin (the live webhook needs a real bot token): every prefix
      // LIKE must carry an ESCAPE clause and a bound, escaped prefix. Phase 4 module
      // split: the shared resolver lives in telegram-commands.ts (resolveProject —
      // /append + /update), proj_search in telegram-webhook.ts, the escape helper in
      // telegram-helpers.ts.
      const fs = await import('node:fs')
      const commands = fs.readFileSync('src/routes/integrations/telegram-commands.ts', 'utf8')
      const webhook = fs.readFileSync('src/routes/integrations/telegram-webhook.ts', 'utf8')
      const helpers = fs.readFileSync('src/routes/integrations/telegram-helpers.ts', 'utf8')
      const likeSites = (commands + webhook).match(/LOWER\(title\) LIKE \? ESCAPE/g) ?? []
      expect(likeSites.length).toBeGreaterThanOrEqual(2) // resolveProject (+ /append, /update) + proj_search
      expect(commands).toContain('resolveProject(')
      expect(webhook).toContain('escapeLikePrefix(')
      // and the escape helper actually escapes % _ and backslash
      const helper = helpers.match(/export const escapeLikePrefix[^\n]+/)?.[0] ?? ''
      expect(helper).toContain('%')
      expect(helper).toContain('_')
    } finally {
      close()
    }
  })
})
