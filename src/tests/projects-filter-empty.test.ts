import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S76: the honest filtered-miss empty state — a projects search/tag filter that finds
// nothing used to fall through to the generic capture CTA ("No projects yet — capture
// your first idea"), which is wrong when the user HAS projects: it implies emptiness
// and nudges capture instead of recovery. A miss now says so and offers the way back.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function seedProject(db: Db, userId: string, id: string, title: string) {
  const now = new Date().toISOString()
  await db.execute(
    'INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, title, 'doing', now, now],
  )
}

describe('projects filtered-miss empty state (S76)', () => {
  it('a search miss renders "No matches" + Clear filters, NOT the capture CTA', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 'p-1', 'Real project')
      const client = await makeClient(db, user)
      const res = await client.app.fetch(new Request('http://local/api/projects?q=zzznothing&view=cards', { headers: { ...client.auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('No matches')
      expect(html).toContain('Clear filters')
      expect(html).not.toContain('No projects yet')
      expect(html).toContain('pg-filter-empty')
    } finally {
      close()
    }
  })

  it('a tag miss renders the label-specific empty state', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 'p-1', 'Real project')
      // A tag with zero usage (created directly, not attached to anything).
      const tagId = crypto.randomUUID()
      await db.execute('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', [tagId, user, 'lonely-tag', '#f6d365', new Date().toISOString()])
      const client = await makeClient(db, user)
      const res = await client.app.fetch(new Request(`http://local/api/projects?tag=${tagId}&view=cards`, { headers: { ...client.auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('No projects with this label')
      expect(html).toContain('Clear filters')
      expect(html).not.toContain('No projects yet')
    } finally {
      close()
    }
  })

  it('a genuinely empty account (no filters) still gets the capture CTA', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const client = await makeClient(db, user)
      const res = await client.app.fetch(new Request('http://local/api/projects?view=cards', { headers: { ...client.auth, 'HX-Request': 'true' } }))
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('No projects yet')
      expect(html).not.toContain('pg-filter-empty')
    } finally {
      close()
    }
  })

  it('a search that HITS renders results (no empty state)', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      await seedProject(db, user, 'p-1', 'Real project')
      const client = await makeClient(db, user)
      const res = await client.app.fetch(new Request('http://local/api/projects?q=Real&view=cards', { headers: { ...client.auth, 'HX-Request': 'true' } }))
      const html = await res.text()
      expect(html).toContain('Real project')
      expect(html).not.toContain('pg-filter-empty')
    } finally {
      close()
    }
  })
})
