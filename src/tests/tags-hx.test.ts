import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// S43: the /api/tags CONSOLIDATION pins. devboard.ts used to register a JSON-only
// GET /api/tags BEFORE tagsRoutes (Hono first-match) — settings.html's
// hx-get="/api/tags" received raw JSON, and that unbreakable ~497px string dumped
// into #taglist overflowed the whole settings page sideways on phones (the S43
// mobile audit's settings +107px / zoomed-out layout). These pins hold the contract:
// HX-Request → chip HTML; fetch → JSON; the two never cross-serve (Vary).

async function makeApp(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, headers: { 'Content-Type': 'application/json', Cookie: `hibana_session=${token}`, Origin: 'http://local' } }
}

async function createProject(app: ReturnType<typeof createApp>, headers: Record<string, string>, title: string) {
  const res = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers, body: JSON.stringify({ title }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

describe('tags API (S43 consolidation)', () => {
  it('GET serves CHIP HTML for htmx (HX-Request) and JSON for fetch, with Vary: HX-Request', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe')

      // one USED tag (via the project tag link endpoint) + one unused
      await app.fetch(new Request(`http://local/api/projects/${pid}/tags`, { method: 'POST', headers, body: JSON.stringify({ name: 'UI' }) }))
      await app.fetch(new Request('http://local/api/tags', { method: 'POST', headers, body: JSON.stringify({ name: 'loose' }) }))

      const hx = await app.fetch(new Request('http://local/api/tags', { headers: { ...headers, 'HX-Request': 'true' } }))
      expect(hx.status).toBe(200)
      expect(hx.headers.get('Vary')).toBe('HX-Request')
      const hxBody = await hx.text()
      expect(hxBody).toContain('class="chip"')
      expect(hxBody).toContain('UI')
      expect(hxBody).not.toContain('{"tags"') // the S43 bug: JSON into the taglist

      const js = await app.fetch(new Request('http://local/api/tags', { headers }))
      const data = (await js.json()) as { tags: { name: string }[] }
      expect(data.tags.map((t) => t.name).sort()).toEqual(['UI', 'loose'])
    } finally {
      close()
    }
  })

  it('the chip row carries a delete button ONLY on unused tags; HX delete returns the refreshed chips', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const { app, headers } = await makeApp(db, userId)
      const pid = await createProject(app, headers, 'probe')
      await app.fetch(new Request(`http://local/api/projects/${pid}/tags`, { method: 'POST', headers, body: JSON.stringify({ name: 'used' }) }))
      const made = await app.fetch(new Request('http://local/api/tags', { method: 'POST', headers, body: JSON.stringify({ name: 'unused' }) }))
      const unusedId = ((await made.json()) as { id: string }).id

      const hx = await app.fetch(new Request('http://local/api/tags', { headers: { ...headers, 'HX-Request': 'true' } }))
      const body = await hx.text()
      expect(body).not.toContain(`hx-delete="/api/tags/"`) // the used tag has NO dead delete button
      // the unused tag's chip row does carry one (aria pattern, not name-matched)
      expect(body).toContain(`hx-delete="/api/tags/${unusedId}"`)

      // HX delete of the UNUSED tag → 200 + the refreshed chip list (for the settings
      // page's hx-target="#taglist" hx-swap="innerHTML")
      const del = await app.fetch(new Request(`http://local/api/tags/${unusedId}`, { method: 'DELETE', headers: { ...headers, 'HX-Request': 'true' } }))
      expect(del.status).toBe(200)
      const after = await del.text()
      expect(after).toContain('class="chip"')
      expect(after).not.toContain('unused')

      // the used tag: HX or not, 409 (delete-unused-only law, unchanged)
      const tagsNow = (await (await app.fetch(new Request('http://local/api/tags', { headers }))).json()) as { tags: { id: string; name: string }[] }
      const usedId = tagsNow.tags.find((t) => t.name === 'used')?.id
      const refuse = await app.fetch(new Request(`http://local/api/tags/${usedId}`, { method: 'DELETE', headers: { ...headers, 'HX-Request': 'true' } }))
      expect(refuse.status).toBe(409)
    } finally {
      close()
    }
  })
})
