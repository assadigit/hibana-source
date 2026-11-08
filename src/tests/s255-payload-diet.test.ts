import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S255 (BE-3 — AUDIT-REMEDIATION-SPEC §7 step 1): the payload & network diet's
// additive read surfaces.
//   1. ?lean=1 omits sprints[].description and adds the derived doc_checked (the
//      exact "- [x] " line grammar the sprint page's chip stat folds client-side).
//   2. The DEFAULT payload keeps every sprint row verbatim (description included,
//      doc_checked absent) — the desktop mirror + the s241 contract ride it.
//   3. GET /api/sprints/:id/doc returns the FULL sprint row, owner-gated — a
//      stranger's sprint id is a 404, never a doc leak.

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `__Host-hibana_session=${token}`, Origin: 'http://local' } }
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

type SprintRow = Record<string, unknown> & { id: string }

async function boardSprints(app: App, headers: Record<string, string>, pid: string, query = ''): Promise<SprintRow[]> {
  const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard${query}`, { headers }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { sprints: SprintRow[] }
  return body.sprints
}

const DOC = '## Plan\n- [x] First step done\n- [x] Second step done\n- [ ] Third step pending\nnot a checkbox line\n- [x] fourth done'

describe('S255 BE-25 — the board GET\'s version-stamp weak ETag (real 304s, no assembly)', () => {
  const getTag = async (app: App, headers: Record<string, string>, pid: string, query = '') => {
    const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard${query}`, { headers }))
    expect(res.status).toBe(200)
    return res.headers.get('etag')
  }
  const condGet = (app: App, headers: Record<string, string>, pid: string, etag: string, query = '') =>
    app.fetch(new Request(`http://local/api/projects/${pid}/devboard${query}`, { headers: { ...headers, 'If-None-Match': etag } }))

  const createTask = (app: App, headers: Record<string, string>, pid: string, title: string) =>
    app.fetch(new Request(`http://local/api/projects/${pid}/devtasks`, { method: 'POST', headers, body: JSON.stringify({ title }) }))

  it('a matching If-None-Match answers 304 with an empty body; a stale/foreign validator gets the full 200', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'etag probe')
      expect((await createTask(app, headers, pid, 'one')).status).toBe(201)

      const tag = await getTag(app, headers, pid)
      expect(tag).toBeTruthy()
      const hit = await condGet(app, headers, pid, tag!)
      expect(hit.status).toBe(304)
      expect(await hit.text()).toBe('')
      expect(hit.headers.get('etag')).toBe(tag)
      expect(hit.headers.get('cache-control')).toBe('private, no-cache')

      const miss = await condGet(app, headers, pid, 'W/"stale"')
      expect(miss.status).toBe(200)
      expect((await miss.json()) as object).toHaveProperty('tasks')
    } finally { close() }
  })

  it('a NON-conditional request never 304s (the desktop RequestFresh + web no-store contract)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'fresh probe')
      expect((await createTask(app, headers, pid, 'one')).status).toBe(201)
      // two back-to-back fresh GETs — both full 200s (a 304 without If-None-Match
      // is the desktop client's "unexpected 304 on fresh" hard error)
      for (let i = 0; i < 2; i++) {
        const res = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
        expect(res.status).toBe(200)
        expect((await res.json()) as object).toHaveProperty('tasks')
      }
    } finally { close() }
  })

  it('every payload-affecting mutation moves the stamp — the next conditional poll gets the fresh 200', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'coverage probe')
      const t1 = ((await (await createTask(app, headers, pid, 'one')).json()) as { id: string }).id
      expect((await createTask(app, headers, pid, 'two')).status).toBe(201)
      const created = await mkSprint(app, headers, pid, { name: 'S1', description: '- [x] done\n- [ ] todo' })
      const sid = ((await created.json()) as { id: string }).id

      const cases: Array<[string, () => Response | Promise<Response>]> = [
        ['task PATCH (column edit)', () => app.fetch(new Request(`http://local/api/devtasks/${t1}`, { method: 'PATCH', headers, body: JSON.stringify({ priority: 'urgent' }) }))],
        ['task tag link change', () => app.fetch(new Request(`http://local/api/devtasks/${t1}/tags`, { method: 'POST', headers, body: JSON.stringify({ name: 'UI/UX' }) }))],
        ['sprint PATCH (doc edit)', () => patchSprint(app, headers, sid, { description: '- [x] now both\n- [x] done' })],
        ['task REORDER (sort_order — the S255 coverage fix)', () => app.fetch(new Request(`http://local/api/projects/${pid}/devtasks/reorder`, { method: 'POST', headers, body: JSON.stringify({ ids: [t1] }) }))],
        ['sprint lifecycle (/start)', () => app.fetch(new Request(`http://local/api/sprints/${sid}/start`, { method: 'POST', headers }))],
      ]
      for (const [label, mutate] of cases) {
        const tag = await getTag(app, headers, pid)
        expect((await condGet(app, headers, pid, tag!)).status).toBe(304)
        expect((await mutate()).status).toBeLessThan(500)
        const after = await condGet(app, headers, pid, tag!)
        expect(after.status, `${label} must move the stamp`).toBe(200)
        // …and the fresh validator 304s again (the round is stable)
        const tag2 = after.headers.get('etag')
        expect((await condGet(app, headers, pid, tag2!)).status).toBe(304)
      }
    } finally { close() }
  })

  it('a tag RENAME (no updated_at column on tags — content fingerprint coverage) moves the stamp', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'tag rename probe')
      const t1 = ((await (await createTask(app, headers, pid, 'one')).json()) as { id: string }).id
      expect((await app.fetch(new Request(`http://local/api/devtasks/${t1}/tags`, { method: 'POST', headers, body: JSON.stringify({ name: 'design' }) }))).status).toBe(201)

      const tag = await getTag(app, headers, pid)
      expect((await condGet(app, headers, pid, tag!)).status).toBe(304)

      // the global label manager's rename — nothing but the tags row's name changes
      // (the JSON GET answers {tags: [...]}; the HTML variant needs HX-Request)
      const tags = (await app.fetch(new Request('http://local/api/tags', { headers }))) as Response
      const list = ((await tags.json()) as { tags: Array<{ id: string; name: string }> }).tags
      const design = list.find((x) => x.name === 'design')!
      expect(design).toBeTruthy()
      expect((await app.fetch(new Request(`http://local/api/tags/${design.id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Design System' }) }))).status).toBe(200)

      const after = await condGet(app, headers, pid, tag!)
      expect(after.status).toBe(200)
    } finally { close() }
  })
})

describe('S255 BE-3 — the lean board payload (?lean=1) + the sprint doc endpoint', () => {
  it('default payload: sprint rows ride verbatim — description present, doc_checked ABSENT', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'lean probe')
      const created = await mkSprint(app, headers, pid, { name: 'Diet', description: DOC })
      expect(created.status).toBe(201)

      const rows = await boardSprints(app, headers, pid)
      expect(rows).toHaveLength(1)
      expect(rows[0].description).toBe(DOC)
      expect('doc_checked' in rows[0]).toBe(false)
    } finally { close() }
  })

  it('lean payload: description omitted, doc_checked carries the ☑ grammar count; every other column rides', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'lean probe two')
      const created = await mkSprint(app, headers, pid, { name: 'Diet', description: DOC, version: '3.1', emoji: '🔐' })
      expect(created.status).toBe(201)
      const sid = ((await created.json()) as { id: string }).id

      const rows = await boardSprints(app, headers, pid, '?lean=1')
      expect(rows).toHaveLength(1)
      // the diet: the heavy field is GONE…
      expect('description' in rows[0]).toBe(false)
      // …and the derived stat rides with the island's exact grammar (3 checked lines)
      expect(rows[0].doc_checked).toBe(3)
      // every other column rides verbatim
      expect(rows[0].id).toBe(sid)
      expect(rows[0].name).toBe('Diet')
      expect(rows[0].version).toBe('3.1')
      expect(rows[0].emoji).toBe('🔐')
      expect(rows[0].is_draft).toBe(1)

      // a doc edit moves the count (PATCH is the doc's only writer)
      expect((await patchSprint(app, headers, sid, { description: '- [x] one\n- [ ] two' })).status).toBe(200)
      const after = await boardSprints(app, headers, pid, '?lean=1')
      expect(after[0].doc_checked).toBe(1)

      // an empty/missing doc folds to 0 (never undefined — the chip stat reads a number)
      expect((await patchSprint(app, headers, sid, { description: '' })).status).toBe(200)
      expect((await boardSprints(app, headers, pid, '?lean=1'))[0].doc_checked).toBe(0)
    } finally { close() }
  })

  it('the two variants carry distinct ETags (a lean 304 can never satisfy a default poll and vice versa)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'etag split probe')
      expect((await mkSprint(app, headers, pid, { name: 'E', description: DOC })).status).toBe(201)

      const def = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers }))
      const lean = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard?lean=1`, { headers }))
      const defTag = def.headers.get('etag')
      const leanTag = lean.headers.get('etag')
      expect(defTag).toBeTruthy()
      expect(leanTag).toBeTruthy()
      expect(defTag).not.toBe(leanTag)
      // each variant 304s against ITS OWN validator, not the other's
      const defAgain = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard`, { headers: { ...headers, 'If-None-Match': defTag! } }))
      expect(defAgain.status).toBe(304)
      const leanWrong = await app.fetch(new Request(`http://local/api/projects/${pid}/devboard?lean=1`, { headers: { ...headers, 'If-None-Match': defTag! } }))
      expect(leanWrong.status).toBe(200)
    } finally { close() }
  })

  it('GET /api/sprints/:id/doc — the full row owner-gated; a stranger 404s; the doc round-trips', async () => {
    const { db, close } = makeTestDb()
    try {
      const owner = await makeUser(db, { username: 'owner' })
      const stranger = await makeUser(db, { username: 'stranger' })
      const a = await makeApp(db, owner)
      const b = await makeApp(db, stranger)
      const pid = await createProject(a.app, a.headers, 'doc endpoint probe')
      const created = await mkSprint(a.app, a.headers, pid, { name: 'Doc Sprint', description: DOC, version: '9.9' })
      expect(created.status).toBe(201)
      const sid = ((await created.json()) as { id: string }).id

      // the owner reads the FULL row (description included)
      const res = await a.app.fetch(new Request(`http://local/api/sprints/${sid}/doc`, { headers: a.headers }))
      expect(res.status).toBe(200)
      const row = (await res.json()) as Record<string, unknown>
      expect(row.description).toBe(DOC)
      expect(row.name).toBe('Doc Sprint')
      expect(row.version).toBe('9.9')
      expect(row.id).toBe(sid)

      // a stranger's id is simply not found (rule 1) — never a doc leak
      const foreign = await b.app.fetch(new Request(`http://local/api/sprints/${sid}/doc`, { headers: b.headers }))
      expect(foreign.status).toBe(404)

      // a missing id is a 404, not a 500
      const missing = await a.app.fetch(new Request('http://local/api/sprints/nope/doc', { headers: a.headers }))
      expect(missing.status).toBe(404)
    } finally { close() }
  })
})
