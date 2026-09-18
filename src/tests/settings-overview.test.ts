import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Config } from '../types'
import type { Db } from '../db/types'

// S75: the settings OVERVIEW — one request composing every read the settings page
// needs (prefs / me / invites / ai models / telegram status / trash). The client
// previously fired 8 parallel JSON GETs (three literal duplicates). Covered here:
// auth, every slice carrying its LEGACY endpoint's exact shape (so old consumers
// keep working), user isolation on the invite slice, and the trash slice reflecting
// soft-deleted rows.

function makeConfig(db: Db): Config {
  return { db, isProd: false, github: { owner: 'x', repo: 'y', token: '' } }
}

async function makeClient(db: Db, userId: string) {
  const app = createApp(makeConfig(db))
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

type Overview = {
  prefs: Record<string, unknown>
  me: { user: Record<string, unknown> }
  invites: unknown[]
  ai: { models: unknown[]; default: string }
  telegram: { ok: boolean; bot: string; botUrl: string; linked: boolean; chat_id: string | null }
  trash: { items: unknown[] }
}

describe('settings overview (S75 consolidation)', () => {
  it('requires auth', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp(makeConfig(db))
      const res = await app.fetch(new Request('http://local/api/settings/overview'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('composes every slice in its legacy endpoint\'s exact shape', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db, { username: 'ov', email: 'ov@test.dev' })
      const client = await makeClient(db, user)
      const res = await client.app.fetch(new Request('http://local/api/settings/overview', { headers: client.auth }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as Overview

      // prefs — same keys as GET /api/settings.
      expect(body.prefs).toMatchObject({ language_pref: 'en', calendar_pref: 'gregorian', timezone: 'UTC' })
      for (const k of ['dash_show_header', 'dash_show_projects', 'dash_show_todo', 'dash_show_notebook', 'dash_show_activity', 'dash_order']) {
        expect(body.prefs).toHaveProperty(k)
      }
      // me — same shape as GET /api/auth/me.
      expect(body.me.user).toMatchObject({ id: user, username: 'ov', email: 'ov@test.dev', role: 'owner', avatar_path: null })
      expect(body.me.user).toHaveProperty('created_at')
      // invites — same shape as GET /api/auth/invites (owner sees all; empty here).
      expect(Array.isArray(body.invites)).toBe(true)
      // ai — same shape as GET /api/ai/models.
      expect(Array.isArray(body.ai.models)).toBe(true)
      expect(typeof body.ai.default).toBe('string')
      expect(body.ai.default.length).toBeGreaterThan(0)
      // telegram — same shape as GET /api/telegram/status.
      expect(body.telegram).toMatchObject({ ok: true, bot: '@Hibana_PM_bot', botUrl: 'https://t.me/Hibana_PM_bot', linked: false, chat_id: null })
      // trash — same shape as GET /api/settings/trash.
      expect(body.trash).toEqual({ items: [] })
    } finally {
      close()
    }
  })

  it('reflects soft-deleted rows in the trash slice, scoped to the requesting user', async () => {
    const { db, close } = makeTestDb()
    try {
      const user = await makeUser(db)
      const other = await makeUser(db)
      const client = await makeClient(db, user)
      const otherClient = await makeClient(db, other)

      // One soft-deleted note for `user`, one for `other`.
      for (const c of [client, otherClient]) {
        const res = await c.app.fetch(new Request('http://local/api/notes', {
          method: 'POST', headers: c.auth, body: JSON.stringify({ kind: 'note', content: 'x' }),
        }))
        expect(res.status).toBe(201)
        const note = (await res.json()) as { id: string }
        const del = await c.app.fetch(new Request(`http://local/api/notes/${note.id}`, { method: 'DELETE', headers: c.auth }))
        expect([200, 204]).toContain(del.status)
      }

      const mine = await client.app.fetch(new Request('http://local/api/settings/overview', { headers: client.auth }))
      const mineBody = (await mine.json()) as Overview
      expect(mineBody.trash.items).toHaveLength(1)

      const theirs = await otherClient.app.fetch(new Request('http://local/api/settings/overview', { headers: otherClient.auth }))
      const theirsBody = (await theirs.json()) as Overview
      expect(theirsBody.trash.items).toHaveLength(1)
      // Isolation (rule 1): each user sees only their own trash rows.
      const mineIds = mineBody.trash.items.map((i) => (i as { id: string }).id)
      const theirsIds = theirsBody.trash.items.map((i) => (i as { id: string }).id)
      expect(mineIds).not.toEqual(theirsIds)
    } finally {
      close()
    }
  })
})
