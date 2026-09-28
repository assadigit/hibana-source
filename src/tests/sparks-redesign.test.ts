import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { diskShotsFromEnv } from '../services/disk-shots'
import type { Db } from '../db/types'

// S161 (0063) — the Ideas redesign's server contracts, per the owner's spec:
//   #3  folder header metrics + updated_at bumps on EVERY field edit (links/tags/images)
//   #4  manual cover: ownership-checked, survives newer uploads, purged with its shot
//   #5  pins: server-stamped pinned_at, pins float first (most-recently-pinned)
//   #6  sparks land on the LEAN page (both HX hand-offs)
//   #12 search spans title/desc/links/tags/folder-name and overrides the folder scope
//   #13 pins-then-recency order (sort_order dead); #16 the verbatim empty-folder copy
//   + the banner byte round-trip on the shared object-store chain (disk store here)

let shotsRoot = ''
beforeAll(() => { shotsRoot = mkdtempSync(join(tmpdir(), 'hibana-s161-shots-')) })
afterAll(() => { rmSync(shotsRoot, { recursive: true, force: true }) })

async function makeClient(db: Db, userId: string, opts: { shots?: boolean } = {}) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    emailKey: undefined,
    assets: undefined,
    // S61/S163: the disk store = the e2e/QA parity path (HIBANA_SHOTS_DIR) — the
    // banner + screenshot bytes land in a real store, not a stub.
    ...(opts.shots ? { objectStore: diskShotsFromEnv({ HIBANA_SHOTS_DIR: shotsRoot })! } : {}),
  })
  const token = await createSession(db, userId)
  return { app, auth: { Cookie: `hibana_session=${token}`, 'Content-Type': 'application/json', Origin: 'http://local' } }
}

async function makeFolder(app: ReturnType<typeof createApp>, auth: Record<string, string>, name: string, extra: Record<string, unknown> = {}) {
  const res = await app.fetch(new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name, ...extra }) }))
  expect(res.status).toBe(201)
  return ((await res.json()) as { folder: { id: string } }).folder.id
}

async function createSpark(app: ReturnType<typeof createApp>, auth: Record<string, string>, title: string, folderId?: string, over: Record<string, unknown> = {}) {
  const res = await app.fetch(
    new Request('http://local/api/projects', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ title, status: 'spark', ...(folderId ? { folder_id: folderId } : {}), ...over }),
    }),
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function addImage(app: ReturnType<typeof createApp>, auth: Record<string, string>, projectId: string, name: string) {
  const res = await app.fetch(
    new Request(`http://local/api/projects/${projectId}/screenshots`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ dataBase64: Buffer.from(`png-bytes-${name}`).toString('base64'), mimeType: 'image/png', fileName: `${name}.png`, caption: '' }),
    }),
  )
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

const hx = (auth: Record<string, string>, url: string) =>
  new Request(url, { headers: { ...auth, 'HX-Request': 'true' } })

describe('S161 — the Ideas redesign contracts', () => {
  // ---- spec #5: pins ------------------------------------------------------------
  it('pinned:true stamps pinned_at server-side; pinned:false clears it; pins float first (most-recently-pinned), then updated_at DESC', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const a = await createSpark(app, auth, 'Older idea')
      const b = await createSpark(app, auth, 'Pinned later')
      const c = await createSpark(app, auth, 'Pinned first')
      // pin c, then b (b is the NEWER pin)
      expect((await app.fetch(new Request(`http://local/api/projects/${c}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ pinned: true }) }))).status).toBe(200)
      expect((await app.fetch(new Request(`http://local/api/projects/${b}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ pinned: true }) }))).status).toBe(200)
      // stamps live on the rows
      const rowC = (await (await app.fetch(new Request(`http://local/api/projects/${c}`, { headers: auth }))).json()) as { project: { pinned_at: string | null } }
      expect(rowC.project.pinned_at).toBeTruthy()
      // unpin clears
      await app.fetch(new Request(`http://local/api/projects/${c}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ pinned: false }) }))
      const rowC2 = (await (await app.fetch(new Request(`http://local/api/projects/${c}`, { headers: auth }))).json()) as { project: { pinned_at: string | null } }
      expect(rowC2.project.pinned_at).toBeNull()
      // pin c again (c is now the newest pin) → order: c, b, a
      await app.fetch(new Request(`http://local/api/projects/${c}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ pinned: true }) }))
      const html = await (await app.fetch(hx(auth, 'http://local/api/projects?status=spark&view=list&folder=all'))).text()
      const iC = html.indexOf(c), iB = html.indexOf(b), iA = html.indexOf(a)
      expect(iC).toBeGreaterThanOrEqual(0)
      expect(iB).toBeGreaterThan(iC)
      expect(iA).toBeGreaterThan(iB)
      // the list rows carry the pin affordance + the pinned state
      expect(html).toContain('data-spark-pin')
      expect(html).toContain('data-pinned="1"')
    } finally {
      close()
    }
  })

  // ---- spec #4: the manual cover -------------------------------------------------
  it('cover_shot_id must be one of the idea\u2019s OWN images — foreign/missing shots 404 (shot_not_found)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const other = await makeUser(db)
      const { app, auth } = await makeClient(db, u, { shots: true })
      const { auth: otherAuth } = await makeClient(db, other, { shots: true })
      const mine = await createSpark(app, auth, 'My idea')
      const theirs = await createSpark(app, otherAuth, 'Their idea')
      const theirShot = await addImage(app, otherAuth, theirs, 'theirs')

      // a nonexistent shot
      const r1 = await app.fetch(new Request(`http://local/api/projects/${mine}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ cover_shot_id: crypto.randomUUID() }) }))
      expect(r1.status).toBe(404)
      expect(((await r1.json()) as { error: string }).error).toBe('shot_not_found')
      // a real shot — but someone else's
      const r2 = await app.fetch(new Request(`http://local/api/projects/${mine}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ cover_shot_id: theirShot }) }))
      expect(r2.status).toBe(404)
      const body2 = (await r2.json()) as { error: string }
      expect(body2.error).toBe('shot_not_found')
      // an own image shot passes
      const myShot = await addImage(app, auth, mine, 'mine')
      const r3 = await app.fetch(new Request(`http://local/api/projects/${mine}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ cover_shot_id: myShot }) }))
      expect(r3.status).toBe(200)
    } finally {
      close()
    }
  })

  it('a manual cover SURVIVES a newer upload (the card thumb stays the chosen cover) and purges with its shot', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u, { shots: true })
      const id = await createSpark(app, auth, 'Covered idea')
      const cover = await addImage(app, auth, id, 'chosen-cover')
      await app.fetch(new Request(`http://local/api/projects/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ cover_shot_id: cover }) }))
      const newer = await addImage(app, auth, id, 'newer-upload')

      // the cards view: the thumb serves the COVER (star-marked), not the newer upload
      const cards = await (await app.fetch(hx(auth, 'http://local/api/projects?status=spark&view=cards&folder=all'))).text()
      expect(cards).toContain(`screenshots/${cover}/file?variant=thumb`)
      expect(cards).not.toContain(`screenshots/${newer}/file?variant=thumb`)
      expect(cards).toContain('spark-cover-mark')

      // deleting the cover shot clears the reference AND falls back to the newest upload
      await app.fetch(new Request(`http://local/api/screenshots/${cover}`, { method: 'DELETE', headers: auth }))
      const after = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))).json()) as { project: { cover_shot_id: string | null } }
      expect(after.project.cover_shot_id).toBeNull()
      const cards2 = await (await app.fetch(hx(auth, 'http://local/api/projects?status=spark&view=cards&folder=all'))).text()
      expect(cards2).toContain(`screenshots/${newer}/file?variant=thumb`)
      expect(cards2).not.toContain('spark-cover-mark')
    } finally {
      close()
    }
  })

  // ---- spec #3: the pastel pair ---------------------------------------------------
  it('folder pair: whole-tile or nothing — a mismatched/foreign pair 400s, a curated pair stores, nulls return to the hash default', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      // a fill from one tile + an ink from another → rejected (whole tiles only)
      const bad = await app.fetch(new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Bad pair', color_fill: '#F0CCCC', color_text: '#476827' }) }))
      expect(bad.status).toBe(400)
      // only one half → rejected
      const half = await app.fetch(new Request('http://local/api/projects/sparks/folders', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Half pair', color_fill: '#F0CCCC' }) }))
      expect(half.status).toBe(400)
      // a curated tile → stored
      const fid = await makeFolder(app, auth, 'Green folder', { color_fill: '#DEF0CC', color_text: '#476827' })
      const fidB = await makeFolder(app, auth, 'Rose folder', { color_fill: '#F0CCCC', color_text: '#682727' })
      const list = await (await app.fetch(new Request('http://local/api/projects/sparks/folders', { headers: auth }))).json() as { folders: { id: string; color_fill: string | null; color_text: string | null }[] }
      expect(list.folders.find((f) => f.id === fid)?.color_fill).toBe('#DEF0CC')
      // PATCH nulls → back to the default (stored NULL; render resolves the hash-of-id)
      await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'Green folder', color_fill: null, color_text: null }) }))
      const list2 = await (await app.fetch(new Request('http://local/api/projects/sparks/folders', { headers: auth }))).json() as { folders: { id: string; color_fill: string | null }[] }
      expect(list2.folders.find((f) => f.id === fid)?.color_fill).toBeNull()
      // the grid home renders the DEFAULT pair (a deterministic fill either way)
      const home = await (await app.fetch(hx(auth, 'http://local/api/projects?status=spark&view=cards'))).text()
      expect(home).toContain('--folder-fill:#')
      // and a folder view renders the STORED pair on its header
      const inFolder = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=cards&folder=${fidB}`))).text()
      expect(inFolder).toContain('--folder-fill:#F0CCCC')
    } finally {
      close()
    }
  })

  it('the 0063 dangling-FK fix: deleting a folder sweeps its ideas back to UNFILED (folder_id NULL)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Doomed folder')
      const id = await createSpark(app, auth, 'Swept idea', fid)
      expect((await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}`, { method: 'DELETE', headers: auth }))).status).toBe(200)
      const after = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))).json()) as { project: { folder_id: string | null } }
      expect(after.project.folder_id).toBeNull()
    } finally {
      close()
    }
  })

  // ---- spec #12: the cross-field search -------------------------------------------
  it('the spark search spans title, description, link label/url, tag name, and folder name — from one query', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Content Creation')
      const byTitle = await createSpark(app, auth, 'Podcast about mountains')
      const byDesc = await createSpark(app, auth, 'Untitled', undefined, { description: 'a loom weaving metaphor' })
      const byLink = await createSpark(app, auth, 'Untitled 2')
      await app.fetch(new Request(`http://local/api/projects/${byLink}/links`, { method: 'POST', headers: auth, body: JSON.stringify({ label: 'Figma board', url: 'https://figma.com/x' }) }))
      const byTag = await createSpark(app, auth, 'Untitled 3')
      await app.fetch(new Request(`http://local/api/projects/${byTag}/tags`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'growth-hacking' }) }))
      const filed = await createSpark(app, auth, 'Untitled 4', fid)
      const noise = await createSpark(app, auth, 'Unrelated grocery list')

      const hits = async (q: string) => {
        const html = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=list&q=${encodeURIComponent(q)}`))).text()
        return { html, has: (id: string) => html.includes(id) }
      }
      expect((await hits('mountains')).has(byTitle)).toBe(true)
      expect((await hits('loom')).has(byDesc)).toBe(true)
      expect((await hits('figma')).has(byLink)).toBe(true)
      expect((await hits('growth')).has(byTag)).toBe(true)
      expect((await hits('creation')).has(filed)).toBe(true)
      const miss = await hits('quantum-xylophone')
      expect(miss.has(noise)).toBe(false)
      expect(miss.html).toContain('spark-search-empty')
    } finally {
      close()
    }
  })

  it('a search OVERRIDES the folder scope — matches from other folders appear while a folder param rides the request', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fidA = await makeFolder(app, auth, 'Folder A')
      const fidB = await makeFolder(app, auth, 'Folder B')
      await createSpark(app, auth, 'Mountain idea in A', fidA)
      const inB = await createSpark(app, auth, 'Mountain idea in B', fidB)
      // folder=A is open, but the query owns the view: B's mountain appears
      const html = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=list&folder=${fidA}&q=mountain`))).text()
      expect(html).toContain(inB)
      // and no chip is marked active while a search rides the request
      expect(html).not.toContain('sf-chip is-active" data-sf="' + fidA)
      // the folder header does NOT render during a search (the matches own the view)
      expect(html).not.toContain('class="sfh"')
    } finally {
      close()
    }
  })

  // ---- spec #1/#2: the banner bytes ------------------------------------------------
  it('the folder banner round-trips REAL bytes through the shared store chain: PUT → GET bytes → DELETE → 404', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u, { shots: true })
      const fid = await makeFolder(app, auth, 'Bannered folder')
      const bytes = Buffer.from('fake-banner-png-bytes-0123456789')
      const put = await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}/banner`, {
        method: 'PUT', headers: auth,
        body: JSON.stringify({ dataBase64: bytes.toString('base64'), mimeType: 'image/png' }),
      }))
      expect(put.status).toBe(200)
      // the HX folder view now renders the banner <img> (not the pastel placeholder)
      const view = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=cards&folder=${fid}`))).text()
      expect(view).toContain(`src="/api/projects/sparks/folders/${fid}/banner/file"`)
      expect(view).toContain('sfh-banner-img')
      expect(view).toContain('data-sfh-remove')
      // the bytes serve verbatim
      const file = await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}/banner/file`, { headers: auth }))
      expect(file.status).toBe(200)
      expect(Buffer.from(await file.arrayBuffer()).toString()).toBe(bytes.toString())
      // remove → the placeholder returns + the bytes 404
      expect((await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}/banner`, { method: 'DELETE', headers: auth }))).status).toBe(200)
      const view2 = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=cards&folder=${fid}`))).text()
      expect(view2).toContain('data-sfh-upload')
      expect(view2).not.toContain('sfh-banner-img')
      expect((await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}/banner/file`, { headers: auth }))).status).toBe(404)
      // rule 1: another user's folder banner is invisible + unwritable
      const other = await makeUser(db)
      const { auth: otherAuth } = await makeClient(db, other, { shots: true })
      expect((await app.fetch(new Request(`http://local/api/projects/sparks/folders/${fid}/banner/file`, { headers: otherAuth }))).status).toBe(404)
    } finally {
      close()
    }
  })

  // ---- spec #6: both HX hand-offs to the LEAN page ----------------------------------
  it('a captured spark redirects HX to /spark.html, and a spark\u2019s HX detail request hands off to the lean page too', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const created = await app.fetch(new Request('http://local/api/projects', {
        method: 'POST',
        headers: { ...auth, 'HX-Request': 'true' },
        body: JSON.stringify({ title: 'Fresh capture', status: 'spark' }),
      }))
      expect(created.headers.get('HX-Redirect')).toMatch(/^\/spark\.html\?id=/)
      const id = created.headers.get('HX-Redirect')!.split('id=')[1]
      // the spark's own detail HX request hands off as well (project.html's boot fetch)
      const detail = await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(detail.headers.get('HX-Redirect')).toBe(`/spark.html?id=${id}`)
      // …while a PROJECT's detail HX still renders the heavy template
      const proj = await app.fetch(new Request('http://local/api/projects', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Real project', status: 'developing' }) }))
      const pid = ((await proj.json()) as { id: string }).id
      const projDetail = await app.fetch(new Request(`http://local/api/projects/${pid}`, { headers: { ...auth, 'HX-Request': 'true' } }))
      expect(projDetail.headers.get('HX-Redirect')).toBeNull()
      expect((await projDetail.text()).length).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  // ---- spec #3: updated_at bumps on EVERY field edit --------------------------------
  it('link/tag/image adds + image deletes bump the idea\u2019s updated_at (the folder\u2019s Updated metric rides it)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u, { shots: true })
      const id = await createSpark(app, auth, 'Bump me')
      const before = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))).json()) as { project: { updated_at: string } }
      const bump = async () => {
        await new Promise((r) => setTimeout(r, 15)) // ISO stamps share millisecond granularity in fast tests
        const after = (await (await app.fetch(new Request(`http://local/api/projects/${id}`, { headers: auth }))).json()) as { project: { updated_at: string } }
        expect(after.project.updated_at > before.project.updated_at).toBe(true)
        before.project.updated_at = after.project.updated_at
      }
      // link add
      await app.fetch(new Request(`http://local/api/projects/${id}/links`, { method: 'POST', headers: auth, body: JSON.stringify({ label: 'L', url: 'https://x.dev' }) }))
      await bump()
      // tag attach
      await app.fetch(new Request(`http://local/api/projects/${id}/tags`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 't' }) }))
      await bump()
      // image add
      const shot = await addImage(app, auth, id, 'bump')
      await bump()
      // image delete
      await app.fetch(new Request(`http://local/api/screenshots/${shot}`, { method: 'DELETE', headers: auth }))
      await bump()
    } finally {
      close()
    }
  })

  // ---- spec #9 + #16: the list + the empty copy --------------------------------------
  it('the spark LIST drops the Tags/Signals columns for the icon column (pin + link/image glyphs + row thumbs)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u, { shots: true })
      const id = await createSpark(app, auth, 'Iconful idea')
      await app.fetch(new Request(`http://local/api/projects/${id}/links`, { method: 'POST', headers: auth, body: JSON.stringify({ label: 'Docs', url: 'https://docs.example' }) }))
      await addImage(app, auth, id, 'rowthumb')
      const html = await (await app.fetch(hx(auth, 'http://local/api/projects?status=spark&view=list&folder=all'))).text()
      expect(html).toContain('spark-table')
      expect(html).toContain('data-spark-pin')
      expect(html).toContain('spark-row-thumb')
      // the dead columns are GONE (their headers never render)
      expect(html).not.toContain('<th>Signals</th>')
      expect(html).not.toContain('<th>Tags</th>')
      // the row title deep-links the LEAN page
      expect(html).toContain(`href="/spark.html?id=${id}"`)
    } finally {
      close()
    }
  })

  it('an empty folder speaks the verbatim spec #16 line and carries the folder header (name + metrics)', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Quiet folder')
      const html = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=cards&folder=${fid}`))).text()
      expect(html).toContain('No ideas yet in this folder.')
      expect(html).toContain('data-sfh-folder')
      expect(html).toContain('Quiet folder')
      expect(html).toContain('0 ideas')
    } finally {
      close()
    }
  })

  it('the folder header metrics speak the count + Updated line, and the header renders the curated pair variables', async () => {
    const { db, close } = makeTestDb()
    try {
      const u = await makeUser(db)
      const { app, auth } = await makeClient(db, u)
      const fid = await makeFolder(app, auth, 'Metrics folder')
      await createSpark(app, auth, 'One', fid)
      await createSpark(app, auth, 'Two', fid)
      await createSpark(app, auth, 'Three', fid)
      const html = await (await app.fetch(hx(auth, `http://local/api/projects?status=spark&view=cards&folder=${fid}`))).text()
      expect(html).toContain('3 ideas')
      expect(html).toContain('Updated')
      expect(html).toContain('--folder-fill:')
      expect(html).toContain('--folder-ink:')
    } finally {
      close()
    }
  })
})
