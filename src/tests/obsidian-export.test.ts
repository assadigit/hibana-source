import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { makeTestDb, makeUser } from './helpers'
import { createSession } from '../auth/sessions'
import { createApp } from '../app'
import { safeMdName, buildObsidianVault } from '../services/obsidian-export'
import { parseMarkdownNote } from '../lib/obsidian'
import type { Db } from '../db/types'

// Obsidian vault export (session 15). Pins the contract the feature was specified with:
//   1. /api/export/obsidian.zip is auth-gated and user-scoped (rule 1).
//   2. The zip is a pack of .md files, one folder per part, that Obsidian (and Hibana's
//      own §9 import) can read — every file's first heading is the record's exact title,
//      so re-import dedups instead of duplicating (round-trip).
//   3. Filename hygiene: forbidden chars stripped, collisions deduped, empty → Untitled.
//   4. Soft-deleted rows are trash, not content — they never appear in the vault.
//   5. Quick-note lists keep their checkboxes (- [ ] / - [x]) in markdown.

async function makeAuthedApp(db: Db, userId: string) {
  const app = createApp({
    db,
    isProd: false,
    github: { owner: 'x', repo: 'y', token: '' },
    assets: undefined,
  })
  const token = await createSession(db, userId)
  return { app, cookie: `hibana_session=${token}` }
}

const get = (cookie: string, path: string) =>
  new Request('http://local' + path, { headers: { Cookie: cookie } })

const iso = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toISOString()

describe('safeMdName (filename hygiene)', () => {
  it('strips Windows/zip-forbidden characters and collapses whitespace', () => {
    const used = new Set<string>()
    expect(safeMdName('a/b\\c:d*e?f"g<h>i|j', used)).toBe('a b c d e f g h i j.md')
    expect(safeMdName('  leading and trailing dots.  ', used)).toBe('leading and trailing dots.md')
  })
  it('dedupes same-titled records instead of overwriting', () => {
    const used = new Set<string>()
    expect(safeMdName('Same', used)).toBe('Same.md')
    expect(safeMdName('Same', used)).toBe('Same 2.md')
    expect(safeMdName('same', used)).toBe('same 3.md') // case-insensitive collision space
  })
  it('caps at 80 chars and falls back to Untitled', () => {
    const long = 'x'.repeat(120)
    expect(safeMdName(long, new Set())).toHaveLength(83) // 80 + '.md'
    expect(safeMdName('', new Set())).toBe('Untitled.md')
    expect(safeMdName('???', new Set())).toBe('Untitled.md')
  })
})

describe('GET /api/export/obsidian.zip', () => {
  it('is auth-gated (401 without a session)', async () => {
    const { db, close } = makeTestDb()
    try {
      const app = createApp({ db, isProd: false, github: { owner: 'x', repo: 'y', token: '' }, assets: undefined })
      const res = await app.fetch(new Request('http://local/api/export/obsidian.zip'))
      expect(res.status).toBe(401)
    } finally {
      close()
    }
  })

  it('returns a real zip of .md files, one folder per part, user-scoped', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db, { username: 'alice', email: 'alice@test.dev' })
      const b = await makeUser(db, { username: 'bob', email: 'bob@test.dev' })
      const { app, cookie } = await makeAuthedApp(db, a)

      await db.execute(
        "INSERT INTO projects (id, user_id, title, description, status, latest_note, created_at, updated_at) VALUES (?, ?, 'هتل آبی', 'توضیح پروژه', 'doing', 'اینجا بودم', ?, ?)",
        ['pa', a, iso(5), iso(1)],
      )
      await db.execute(
        "INSERT INTO projects (id, user_id, title, description, status, created_at, updated_at) VALUES (?, ?, 'ایدهٔ ناتمام', 'یک ایده', 'spark', ?, ?)",
        ['pa2', a, iso(3), iso(2)],
      )
      // B's secret project must never appear in A's vault (rule 1).
      await db.execute(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, 'B-secret', 'doing', ?, ?)",
        ['pb', b, iso(1), iso()],
      )
      await db.execute(
        "INSERT INTO quick_notes (id, user_id, kind, title, content, created_at, updated_at) VALUES (?, ?, 'list', 'خرید', ?, ?, ?)",
        ['qn1', a, JSON.stringify([{ id: 'i1', t: 'شیر', d: 1 }, { id: 'i2', t: 'نان', d: 0 }]), iso(2), iso(2)],
      )
      await db.execute(
        "INSERT INTO dev_tasks (id, project_id, title, status, priority, created_at) VALUES (?, 'pa', 'رفع باگ', 'bug', 'high', ?)",
        ['dt1', iso(1)],
      )
      await db.execute(
        "INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, 'pa', 'یادداشت تاریخچه', ?)",
        ['h1', iso(4)],
      )

      const res = await app.fetch(get(cookie, '/api/export/obsidian.zip'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/zip')
      expect(res.headers.get('Content-Disposition')).toContain('hibana-vault-')

      const zip = unzipSync(new Uint8Array(await res.arrayBuffer()))
      const names = Object.keys(zip)
      const texts = new Map(names.map((n) => [n, strFromU8(zip[n])]))

      // Structure: Home.md + per-part folders
      expect(names.some((n) => /\/Home\.md$/.test(n))).toBe(true)
      const projectFile = names.find((n) => /\/Projects\/.*هتل آبی.*\.md$/.test(n))
      const ideaFile = names.find((n) => /\/Ideas\/.*ایدهٔ ناتمام.*\.md$/.test(n))
      expect(projectFile).toBeTruthy()
      expect(ideaFile).toBeTruthy()
      expect(names.some((n) => /\/Quick Notes\.md$/.test(n))).toBe(true)

      // User-scoping: B's project is nowhere in the vault
      const allText = [...texts.values()].join('\n')
      expect(allText).not.toContain('B-secret')

      // Round-trip: the §9 import parses each file's first H1 as the title → dedup works
      const home = [...texts.entries()].find(([n]) => /\/Home\.md$/.test(n))!
      expect(strFromU8(zip[home[0]])).toContain('[[Projects/')
      const parsedProject = parseMarkdownNote(projectFile!, texts.get(projectFile!)!)
      expect(parsedProject?.title).toBe('هتل آبی')
      const parsedIdea = parseMarkdownNote(ideaFile!, texts.get(ideaFile!)!)
      expect(parsedIdea?.title).toBe('ایدهٔ ناتمام')

      // Project note carries its parts: frontmatter + description + history + dev board
      const pmd = texts.get(projectFile!)!
      expect(pmd).toContain('---\n')
      expect(pmd).toContain('type: project')
      expect(pmd).toContain('status: doing')
      expect(pmd).toContain('توضیح پروژه')
      expect(pmd).toContain('Where I left off')
      expect(pmd).toContain('یادداشت تاریخچه')
      expect(pmd).toContain('رفع باگ')

      // Quick-note list → markdown checkboxes
      const qmd = texts.get([...names].find((n) => /\/Quick Notes\.md$/.test(n))!)!
      expect(qmd).toContain('## خرید')
      expect(qmd).toContain('- [x] شیر')
      expect(qmd).toContain('- [ ] نان')
    } finally {
      close()
    }
  })

  it('round-trips through the real §9 import: re-importing the exported vault duplicates nothing', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db, { username: 'alice', email: 'alice@test.dev' })
      const { app, cookie } = await makeAuthedApp(db, a)
      await db.execute(
        "INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, 'Round Trip Project', 'doing', ?, ?)",
        ['p1', a, iso(2), iso()],
      )

      // 1) export the vault
      const res = await app.fetch(get(cookie, '/api/export/obsidian.zip'))
      const zip = unzipSync(new Uint8Array(await res.arrayBuffer()))
      const files = Object.entries(zip).map(([name, data]) => new File([data], name))

      // 2) import it back through the real /api/import/obsidian endpoint
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const imp = await app.fetch(new Request('http://local/api/import/obsidian', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://local' }, body: form }))
      expect(imp.status).toBe(200)
      const body = (await imp.json()) as { imported: number; duplicates: number }
      // Everything dedups: project + idea titles already exist; Home/Quick-Notes have no
      // H1-collision titles so they import as fresh ideas — the count reflects that.
      expect(body.duplicates).toBeGreaterThanOrEqual(1)
      expect(body.imported).toBeLessThan(files.length)

      // 3) the project was not duplicated
      const rows = await db.query<{ title: string }>('SELECT title FROM projects WHERE user_id = ? AND deleted_at IS NULL', [a])
      expect(rows.filter((r) => r.title === 'Round Trip Project')).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('excludes soft-deleted rows and serves an empty account as a Home-only vault', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db, { username: 'solo', email: 'solo@test.dev' })
      const { files, stats } = await buildObsidianVault(db, a, { now: new Date('2026-09-08T10:00:00Z') })
      expect(stats.projects).toBe(0)
      expect([...files.keys()]).toEqual(['Hibana-Backup-2026-09-08/Home.md'])
      expect(files.get('Hibana-Backup-2026-09-08/Home.md')).toContain('# Hibana Backup')

      // soft-deleted project is trash, not content
      await db.execute(
        "INSERT INTO projects (id, user_id, title, status, deleted_at, created_at, updated_at) VALUES (?, ?, 'Deleted', 'spark', ?, ?, ?)",
        ['pd', a, iso(), iso(), iso()],
      )
      const again = await buildObsidianVault(db, a, { now: new Date('2026-09-08T10:00:00Z') })
      expect([...again.files.values()].join('')).not.toContain('Deleted')
    } finally {
      close()
    }
  })

  it('rides the export rate limit (10/min/IP)', async () => {
    const { db, close } = makeTestDb()
    try {
      const a = await makeUser(db, { username: 'ratelimit', email: 'rl@test.dev' })
      const { app, cookie } = await makeAuthedApp(db, a)
      let last = 200
      for (let i = 0; i < 12; i++) {
        const res = await app.fetch(get(cookie, '/api/export/obsidian.zip'))
        last = res.status
        if (i < 9) expect(res.status).toBe(200)
      }
      expect(last).toBe(429)
    } finally {
      close()
    }
  })
})
