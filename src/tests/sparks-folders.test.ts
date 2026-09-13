import { describe, it, expect } from 'vitest'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import type { Db } from '../db/types'

// Session 28 regression — the Ideas page's «نمایش همهٔ ایده‌ها» (folder=all) flow:
// 1. folder=all used to fall into the folder_id = 'all' SQL filter (matches nothing —
//    ids are UUIDs), so the shelf came back empty and rendered the folder GRID again:
//    "the ideas don't appear".
// 2. Capturing while a folder is open now files the new spark INTO that folder
//    (folder_id on POST /api/projects, ownership re-validated; foreign folders ignored).

async function makeClient(db: Db, userId: string) {
  const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, emailKey: undefined, assets: undefined })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function makeFolder(app: ReturnType<typeof createApp>, auth: Record<string, string>, name: string) {
  const res = await app.fetch(new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name }) }))
  expect(res.status).toBe(201)
  const body = (await res.json()) as { folder: { id: string } }
  return body.folder.id
}

async function createSpark(app: ReturnType<typeof createApp>, auth: Record<string, string>, title: string, folderId?: string) {
  const res = await app.fetch(
    new Request('http://local/api/projects', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ title, status: 'spark', ...(folderId ? { folder_id: folderId } : {}) }),
    }),
  )
  const body = (await res.json()) as { id: string; ok?: boolean }
  return body.id
}

describe('sparks shelf — folder views (Session 28)', () => {
  it('folder=all lists EVERY spark (all folders + unfiled), not the folder grid', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Personal')
      const filedId = await createSpark(app, auth, 'Filed idea', fid)
      const looseId = await createSpark(app, auth, 'Unfiled idea')

      const res = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=cards&folder=all', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      expect(res.status).toBe(200)
      const html = await res.text()
      // The flat idea list shows BOTH ideas…
      expect(html).toContain(filedId)
      expect(html).toContain(looseId)
      expect(html).toContain('Filed idea')
      expect(html).toContain('Unfiled idea')
      // …and the breadcrumb folder bar rides above it (not the file-manager grid).
      expect(html).toContain('data-sf-bar')
      expect(html).not.toContain('spark-folder-grid')
      expect(html).not.toContain('spark-folder-card')
    } finally {
      close()
    }
  })

  it('folder=<uuid> narrows the shelf to that folder; folder=none to the unfiled', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Work')
      await createSpark(app, auth, 'Filed idea', fid)
      await createSpark(app, auth, 'Unfiled idea')

      const inFolder = await app.fetch(
        new Request(`http://local/api/projects?status=spark&view=cards&folder=${fid}`, { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const inHtml = await inFolder.text()
      expect(inHtml).toContain('Filed idea')
      expect(inHtml).not.toContain('Unfiled idea')

      const unfiled = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=cards&folder=none', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const unHtml = await unfiled.text()
      expect(unHtml).toContain('Unfiled idea')
      expect(unHtml).not.toContain('Filed idea')
    } finally {
      close()
    }
  })

  it('creating a spark with folder_id files it (and a foreign folder id is ignored, rule 1)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const { auth: otherAuth } = await makeClient(db, other)
      const mine = await makeFolder(app, auth, 'Mine')
      const foreign = await makeFolder(app, otherAuth, 'Someone else')

      // Own folder → filed.
      const id = await createSpark(app, auth, 'Born in a folder', mine)
      const detail = await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))
      const body = (await detail.json()) as { project: { folder_id: string | null; status: string } }
      expect(body.project.folder_id).toBe(mine)
      expect(body.project.status).toBe('spark')

      // Foreign folder → silently unfiled (never 500, never cross-user writes).
      const id2 = await createSpark(app, auth, 'Foreign folder attempt', foreign)
      const detail2 = await app.fetch(new Request(`http://local/api/projects/${id2}`, { headers: auth }))
      const body2 = (await detail2.json()) as { project: { folder_id: string | null } }
      expect(body2.project.folder_id).toBeNull()
    } finally {
      close()
    }
  })

  it('a non-spark create ignores folder_id (folders only exist while status=spark)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Projects folder')

      const res = await app.fetch(
        new Request('http://local/api/projects', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ title: 'A real project', status: 'unreviewed', folder_id: fid }),
        }),
      )
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string }
      const detail = await app.fetch(new Request(`http://local/api/projects/${body.id}`, { headers: auth }))
      const proj = (await detail.json()) as { project: { folder_id: string | null } }
      expect(proj.project.folder_id).toBeNull()
    } finally {
      close()
    }
  })

  // S40 (user report: "I can't enter a folder which I made and add an idea there"):
  // an EMPTY folder must still be enterable — the old `projects.length === 0 → grid`
  // fallback re-rendered the file-manager grid, so clicking a fresh folder looked
  // like a dead click and no capture context ever opened.
  it('an EMPTY folder opens as a folder view (bar + scoped empty state), never the grid', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Fresh empty folder')
      await createSpark(app, auth, 'Unfiled idea')

      const res = await app.fetch(
        new Request(`http://local/api/projects?status=spark&view=cards&folder=${fid}`, { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      expect(res.status).toBe(200)
      const html = await res.text()
      // The folder BAR rides above the scoped empty state — the user is INSIDE the folder.
      expect(html).toContain('data-sf-bar')
      expect(html).toContain('data-spark-empty="folder"')
      expect(html).toContain('Fresh empty folder')
      expect(html).toContain('data-quickadd-open') // the capture CTA files into the open folder
      // The file-manager grid is GONE — the click visibly went somewhere.
      expect(html).not.toContain('spark-folder-grid')
      expect(html).not.toContain('spark-folder-card')
      // The unfiled idea is NOT in this folder view.
      expect(html).not.toContain('Unfiled idea')
    } finally {
      close()
    }
  })

  it('folder=all with ZERO sparks shows the bar + empty state (never silently back to the grid)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      await makeFolder(app, auth, 'Holding folder')

      const res = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=cards&folder=all', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      expect(html).toContain('data-sf-bar')
      expect(html).toContain('data-spark-empty="all"')
      expect(html).not.toContain('spark-folder-grid')
      expect(html).not.toContain('spark-folder-card')
    } finally {
      close()
    }
  })

  it('folder=none with zero unfiled ideas shows the bar + the none empty state', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Only folder')
      await createSpark(app, auth, 'Filed idea', fid)

      const res = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=cards&folder=none', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      expect(html).toContain('data-sf-bar')
      expect(html).toContain('data-spark-empty="none"')
      expect(html).not.toContain('Filed idea')
      expect(html).not.toContain('spark-folder-grid')
    } finally {
      close()
    }
  })

  it('kanban view with a folder param keeps the folder bar (the filter must stay visible)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Kanban folder')
      await createSpark(app, auth, 'Filed idea', fid)

      const res = await app.fetch(
        new Request(`http://local/api/projects?status=spark&view=kanban&folder=${fid}`, { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      expect(html).toContain('data-sf-bar')
      expect(html).toContain('kanban-col')
      expect(html).toContain('Filed idea')
    } finally {
      close()
    }
  })

  // ---- S41: folder emoji icons + the fresh-account empty state ---------------------
  it('a folder created with an icon carries its emoji through every render (grid card, chip, kanban header) + the folders API', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      // makeFolder() posts name-only — post with the icon directly here.
      const res = await app.fetch(
        new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Rocket lab', icon: '🚀' }) }),
      )
      expect(res.status).toBe(201)
      const created = (await res.json()) as { folder: { id: string; icon: string | null } }
      expect(created.folder.icon).toBe('🚀')
      await createSpark(app, auth, 'Filed idea', created.folder.id)

      // The folders API feeds the move dialog — the emoji rides along.
      const foldersJson = await app.fetch(new Request('http://local/api/projects/sparks/folders', { headers: auth }))
      const folders = (await foldersJson.json()) as { folders: { icon: string | null }[] }
      expect(folders.folders[0]?.icon).toBe('🚀')

      // Home (no folder param): the file-manager GRID card renders the emoji…
      const home = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=cards', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const homeHtml = await home.text()
      expect(homeHtml).toContain('spark-folder-emoji')
      expect(homeHtml).toContain('🚀')
      expect(homeHtml).toContain('data-sf-icon="🚀"') // the rename dialog's prefill source

      // …inside the folder: the BAR chip leads with the emoji…
      const inFolder = await app.fetch(
        new Request(`http://local/api/projects?status=spark&view=cards&folder=${created.folder.id}`, { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const barHtml = await inFolder.text()
      expect(barHtml).toContain('sf-emoji')
      expect(barHtml).toContain('🚀')
      // …and the bar carries the S41 HOME chip — the exit back to the folder grid.
      expect(barHtml).toContain('sf-home')
      expect(barHtml).toContain('data-sf=""')

      // …and the kanban column header swaps folder-plus for the emoji.
      const kanban = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=kanban', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const kbHtml = await kanban.text()
      expect(kbHtml).toContain('🚀')
      expect(kbHtml).toContain('kanban-col')
    } finally {
      close()
    }
  })

  it('icon PATCH semantics: rename-only keeps the emoji, icon:null clears it, plain text is rejected', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const created = await app.fetch(
        new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'UI bugs', icon: '🐞' }) }),
      )
      const fid = ((await created.json()) as { folder: { id: string } }).folder.id

      // Rename WITHOUT touching the icon — the emoji must survive.
      const rename = await app.fetch(
        new Request(`http://local/api/projects/sparks/folders/${fid}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'UI bugs v2' }) }),
      )
      expect(rename.status).toBe(200)
      const afterRename = await app.fetch(new Request('http://local/api/projects/sparks/folders', { headers: auth }))
      expect(((await afterRename.json()) as { folders: { icon: string | null; name: string }[] }).folders[0]?.icon).toBe('🐞')

      // icon:null — an explicit clear back to the folder-plus glyph.
      const clear = await app.fetch(
        new Request(`http://local/api/projects/sparks/folders/${fid}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'UI bugs v2', icon: null }) }),
      )
      expect(clear.status).toBe(200)
      const afterClear = await app.fetch(new Request('http://local/api/projects/sparks/folders', { headers: auth }))
      expect(((await afterClear.json()) as { folders: { icon: string | null }[] }).folders[0]?.icon).toBeNull()

      // Non-emoji text is rejected at the schema gate (the contract is one emoji token).
      const bad = await app.fetch(
        new Request(`http://local/api/projects/sparks/folders/${fid}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'UI bugs v2', icon: '<script>' }) }),
      )
      expect(bad.status).toBe(400)
    } finally {
      close()
    }
  })

  it('the fresh-account boot state (0 folders + 0 ideas) offers the New-folder CTA, not just capture', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)

      const res = await app.fetch(
        new Request('http://local/api/projects?status=spark&view=cards', { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      // The empty state carries BOTH affordances: capture (data-quickadd-open) AND the
      // folder creation (data-sf-new) — S41's "doesn't show adding a new folder" fix.
      expect(html).toContain('empty-state')
      expect(html).toContain('data-quickadd-open')
      expect(html).toContain('data-sf-new')
    } finally {
      close()
    }
  })

  it('an empty folder WITH an icon shows the emoji in its scoped empty state', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const created = await app.fetch(
        new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Empty art', icon: '🎨' }) }),
      )
      const fid = ((await created.json()) as { folder: { id: string } }).folder.id

      const res = await app.fetch(
        new Request(`http://local/api/projects?status=spark&view=cards&folder=${fid}`, { headers: { ...auth, 'HX-Request': 'true' } }),
      )
      const html = await res.text()
      expect(html).toContain('data-spark-empty="folder"')
      expect(html).toContain('🎨')
    } finally {
      close()
    }
  })
})
