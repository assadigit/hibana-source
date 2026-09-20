import { describe, it, expect } from 'vitest'
import { backupToGitHub, selectOldBackups, enforceRetention, buildSnapshot, buildUserSnapshot, SNAPSHOT_TABLES } from '../services/backup'
import { githubClient } from '../services/github'
import { makeTestDb, makeUser } from './helpers'

// Backup retention (ROADMAP P2): snapshots accumulate daily forever; the cron/admin backup
// must prune to the newest N. The GitHub client is stubbed at the fetch boundary — these
// tests need zero network, matching the telegram/obsidian test pattern.

type StubHandler = (url: string, init: RequestInit) => Response

/** Run `fn` with globalThis.fetch stubbed to `handler`; returns what `fn` returned. */
async function withGithubStub<T>(handler: StubHandler, fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init ?? {})
  }) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe('backup retention', () => {
  it('selectOldBackups keeps the newest N and returns the rest in oldest-first order', () => {
    const paths = [
      'backups/snapshot-2026-08-01T00-00-00-000Z.json',
      'backups/snapshot-2026-08-02T00-00-00-000Z.json',
      'backups/snapshot-2026-08-03T00-00-00-000Z.json',
      'backups/snapshot-2026-08-04T00-00-00-000Z.json',
      'backups/snapshot-2026-08-05T00-00-00-000Z.json',
    ]
    expect(selectOldBackups(paths, 3)).toEqual([paths[0], paths[1]])
    expect(selectOldBackups(paths, 5)).toEqual([])
  })

  it('selectOldBackups ignores non-snapshot files and clamps keepN to at least 1', () => {
    const paths = [
      'backups/README.md',
      'backups/.gitkeep',
      'backups/snapshot-2026-08-01T00-00-00-000Z.json',
      'backups/snapshot-2026-08-02T00-00-00-000Z.json',
    ]
    expect(selectOldBackups(paths, 0)).toEqual(['backups/snapshot-2026-08-01T00-00-00-000Z.json'])
    expect(selectOldBackups([], 5)).toEqual([])
  })

  it('github client lists a dir and deletes a file via the Contents API (with its SHA)', async () => {
    const client = githubClient({ owner: 'o', repo: 'r', token: 'tok' })
    const deletes: { url: string; body?: string }[] = []
    await withGithubStub((url, init) => {
      if (init.method === 'DELETE') {
        deletes.push({ url, body: String(init.body) })
        return new Response('{}', { status: 200 })
      }
      return new Response(
        JSON.stringify([
          { name: 'snapshot-a.json', path: 'backups/snapshot-a.json', sha: 'sha-a', type: 'file' },
          { name: 'sub', path: 'backups/sub', sha: 'sha-sub', type: 'dir' },
        ]),
        { status: 200 },
      )
    }, async () => {
      const entries = await client.listDir('backups')
      expect(entries).toEqual([{ name: 'snapshot-a.json', path: 'backups/snapshot-a.json', sha: 'sha-a' }])
      await client.deleteFile('backups/snapshot-a.json', 'sha-a')
    })
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('/contents/backups/snapshot-a.json')
    expect(deletes[0].body).toContain('"sha-a"')
  })

  it('enforceRetention deletes only the oldest snapshots beyond the keep window', async () => {
    const client = githubClient({ owner: 'o', repo: 'r', token: 't' })
    const deleted: string[] = []
    await withGithubStub((url, init) => {
      if (init.method === 'DELETE') {
        deleted.push(url)
        return new Response('{}', { status: 200 })
      }
      return new Response(
        JSON.stringify([
          { name: 'snapshot-2026-08-01T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-01T00-00-00-000Z.json', sha: 's1', type: 'file' },
          { name: 'snapshot-2026-08-02T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-02T00-00-00-000Z.json', sha: 's2', type: 'file' },
          { name: 'snapshot-2026-08-03T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-03T00-00-00-000Z.json', sha: 's3', type: 'file' },
          { name: 'snapshot-2026-08-04T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-04T00-00-00-000Z.json', sha: 's4', type: 'file' },
          { name: 'README.md', path: 'backups/README.md', sha: 'sr', type: 'file' },
        ]),
        { status: 200 },
      )
    }, async () => {
      const removed = await enforceRetention(client, 2)
      expect(removed).toEqual([
        'backups/snapshot-2026-08-01T00-00-00-000Z.json',
        'backups/snapshot-2026-08-02T00-00-00-000Z.json',
      ])
    })
    expect(deleted).toHaveLength(2)
    expect(deleted.every((u) => !u.includes('README'))).toBe(true) // unrelated files untouched
  })

  it('backupToGitHub pushes the snapshot, then prunes down to keepN', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const deleted: string[] = []
      const state: { pushedPath: string } = { pushedPath: '' }
      const result = await withGithubStub((url, init) => {
        if (init.method === 'PUT') {
          state.pushedPath = new URL(url).pathname.split('/contents/')[1]
          return new Response(JSON.stringify({ content: { html_url: 'https://github.com/x' } }), { status: 201 })
        }
        if (init.method === 'DELETE') {
          deleted.push(url)
          return new Response('{}', { status: 200 })
        }
        // The listing after the push sees two old snapshots + the one just written.
        const freshName = state.pushedPath.split('/').pop() ?? ''
        return new Response(
          JSON.stringify([
            { name: 'snapshot-2026-08-01T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-01T00-00-00-000Z.json', sha: 's1', type: 'file' },
            { name: 'snapshot-2026-08-02T00-00-00-000Z.json', path: 'backups/snapshot-2026-08-02T00-00-00-000Z.json', sha: 's2', type: 'file' },
            { name: freshName, path: state.pushedPath, sha: 'sf', type: 'file' },
          ]),
          { status: 200 },
        )
      }, async () => backupToGitHub(db, { owner: 'o', repo: 'r', token: 't' }, undefined, 2))

      expect(result.path).toContain('backups/snapshot-')
      expect(result.url).toBe('https://github.com/x')
      // keepN=2 → the oldest of the three is pruned; the fresh one is untouched
      expect(result.retained).toEqual(['backups/snapshot-2026-08-01T00-00-00-000Z.json'])
      expect(deleted).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('a failed retention listing never fails the backup itself', async () => {
    const { db, close } = makeTestDb()
    try {
      await makeUser(db)
      const result = await withGithubStub((url, init) => {
        if (init.method === 'GET') return new Response('boom', { status: 500 })
        return new Response(JSON.stringify({ content: { html_url: 'https://github.com/x' } }), { status: 201 })
      }, async () => backupToGitHub(db, { owner: 'o', repo: 'r', token: 't' }, undefined, 2))
      expect(result.path).toContain('backups/snapshot-')
      expect(result.retained).toEqual([]) // prune skipped; next run retries
    } finally {
      close()
    }
  })
})
// Session 20 (backup-coverage audit): project_archives (0046) + dev_task_tags (0029)
// were silently missing from snapshots — a restore would have dropped archived dev
// tasks and task-tag links ("never lose an idea" data). These tests pin coverage and
// the FK-safe restore order so the lists can never drift apart again.
describe('backup snapshot coverage', () => {
  it('SNAPSHOT_TABLES covers the archive + dev-board tables added since Phase 5', () => {
    const tables = [...SNAPSHOT_TABLES]
    for (const required of ['project_archives', 'dev_task_tags', 'dev_tasks', 'task_categories', 'sprints', 'backlog_docs', 'backlog_doc_revisions', 'spark_folders', 'quick_notes', 'sadhana_tasks']) {
      expect(tables).toContain(required)
    }
    expect(new Set(tables).size).toBe(tables.length) // no accidental duplicates
  })

  it('SNAPSHOT_TABLES is FK-safe: parents restore before children', () => {
    const idx = (t: string) => (SNAPSHOT_TABLES as readonly string[]).indexOf(t)
    expect(idx('spark_folders')).toBeLessThan(idx('projects'))            // projects.folder_id
    expect(idx('projects')).toBeLessThan(idx('project_archives'))        // project_archives.project_id
    expect(idx('task_categories')).toBeLessThan(idx('dev_tasks'))        // dev_tasks.category_id
    expect(idx('sprints')).toBeLessThan(idx('dev_tasks'))                // dev_tasks.sprint_id
    expect(idx('dev_tasks')).toBeLessThan(idx('dev_task_tags'))          // dev_task_tags.task_id
    expect(idx('tags')).toBeLessThan(idx('dev_task_tags'))               // dev_task_tags.tag_id
    expect(idx('backlog_docs')).toBeLessThan(idx('backlog_doc_revisions')) // revisions.doc_id
  })

  it('buildSnapshot carries archived dev tasks + dev-task tag links', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      await db.execute('INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ['p1', userId, 'X', 'developing', new Date().toISOString(), new Date().toISOString()])
      await db.execute('INSERT INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)', ['tag1', userId, 'UI', '#123456', new Date().toISOString()])
      await db.execute('INSERT INTO task_categories (id, project_id, name, created_at) VALUES (?, ?, ?, ?)', ['cat1', 'p1', 'C', new Date().toISOString()])
      await db.execute("INSERT INTO dev_tasks (id, project_id, title, status, priority, created_at) VALUES (?, ?, ?, 'done', 'medium', ?)", ['dt1', 'p1', 'T', new Date().toISOString()])
      await db.execute('INSERT INTO dev_task_tags (task_id, tag_id) VALUES (?, ?)', ['dt1', 'tag1'])
      await db.execute("INSERT INTO project_archives (id, project_id, title, status, priority, original_created_at, archived_at) VALUES (?, ?, ?, 'done', 'low', ?, ?)", ['ar1', 'p1', 'T', new Date().toISOString(), new Date().toISOString()])

      const snap = await buildSnapshot(db)
      expect(snap.schema_version).toBe(20260920)
      expect(snap.data.project_archives).toHaveLength(1)
      expect(snap.data.dev_task_tags).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('buildUserSnapshot exports the user own archived tasks (and only their project scope)', async () => {
    const { db, close } = makeTestDb()
    try {
      const userId = await makeUser(db)
      const otherId = await makeUser(db)
      const rows: [string, string][] = [['mine', userId], ['theirs', otherId]]
      for (const [pid, uid] of rows) {
        await db.execute('INSERT INTO projects (id, user_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [pid, uid, 'P', 'developing', new Date().toISOString(), new Date().toISOString()])
        await db.execute("INSERT INTO project_archives (id, project_id, title, status, priority, original_created_at, archived_at) VALUES (?, ?, ?, 'done', 'low', ?, ?)", [`ar-${pid}`, pid, 'A', new Date().toISOString(), new Date().toISOString()])
      }

      const mine = await buildUserSnapshot(db, userId)
      expect(mine.data.project_archives).toHaveLength(1)
      expect((mine.data.project_archives as { project_id: string }[])[0].project_id).toBe('mine')
    } finally {
      close()
    }
  })
})
